import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { CoreV2WorkflowInput, CoreV2WorkflowProjection } from "../restate/core-v2-services.js";
import type { TaskAuthorityState } from "../restate/services.js";
import { invoke, send } from "../restate/ingress.js";
import { loadProjectManifest } from "./project-manifest.js";
import type { LoadedProjectManifest } from "./project-manifest.js";
import { ProjectManifestError } from "./project-manifest.js";

const execFileAsync = promisify(execFile);

export interface MoyeClientOptions {
  readonly ingressUrl: string;
  readonly boardUrl: string;
  readonly runtimeRoot?: string;
  readonly providerRoots?: {
    readonly codexSessions?: string;
    readonly claudeProjects?: string;
  };
}

export interface StartProjectTaskRequest {
  readonly manifestPath: string;
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly title?: string;
  readonly taskId?: string;
}

export interface ProjectTaskReceiptV1 {
  readonly apiVersion: 1;
  readonly taskId: string;
  readonly workflowRef: string;
  readonly invocationId: string;
  readonly boardUrl: string;
  readonly projectId: string;
  readonly manifestDigest: string;
  readonly baseCommit: string;
}

export interface ProjectTaskStatusV1 {
  readonly apiVersion: 1;
  readonly taskId: string;
  readonly workflowRef: string;
  readonly state: string;
  readonly currentStep: string;
  readonly archiveStatus: "NOT_READY" | "PENDING" | "ARCHIVED" | "FAILED";
  readonly outcome: string | null;
  readonly startedAt?: string;
  readonly completedAt?: string | null;
  readonly boardUrl: string;
}

export class MoyeClient {
  readonly #ingressUrl: string;
  readonly #boardUrl: string;
  readonly #runtimeRoot: string;
  readonly #providerRoots: MoyeClientOptions["providerRoots"];

  public constructor(options: MoyeClientOptions) {
    this.#ingressUrl = safeHttpUrl(options.ingressUrl, "ingressUrl");
    this.#boardUrl = safeHttpUrl(options.boardUrl, "boardUrl");
    this.#runtimeRoot = path.resolve(options.runtimeRoot ?? path.join(os.homedir(), ".moye", "runtime"));
    this.#providerRoots = options.providerRoots;
  }

  public async startTask(request: StartProjectTaskRequest): Promise<ProjectTaskReceiptV1> {
    const prepared = await prepareProjectTask(request, {
      runtimeRoot: this.#runtimeRoot,
      providerRoots: this.#providerRoots,
    });
    const receipt = await send(this.#ingressUrl, "CoreV2Workflow", prepared.input.taskId, "run", prepared.input);
    return Object.freeze({
      apiVersion: 1,
      taskId: prepared.input.taskId,
      workflowRef: `restate://CoreV2Workflow/${prepared.input.taskId}`,
      invocationId: receipt.invocationId,
      boardUrl: this.taskUrl(prepared.input.taskId),
      projectId: prepared.manifest.manifest.project.id,
      manifestDigest: prepared.manifest.digest,
      baseCommit: prepared.input.baseCommit,
    });
  }

  public async status(taskIdInput: string): Promise<ProjectTaskStatusV1 | null> {
    const taskId = taskIdValue(taskIdInput);
    const authority = await invoke<TaskAuthorityState | null>(this.#ingressUrl, "TaskAuthority", taskId, "get");
    if (authority === null) return null;
    if (authority.owner !== "CORE_V2_WORKFLOW") throw new ProjectManifestError("PROJECT_TASK_WORKFLOW_UNSUPPORTED", `${taskId} is owned by ${authority.owner}`);
    const target = authority.recoveryWorkflowRef === undefined
      ? { service: "CoreV2Workflow", key: taskId }
      : workflowRef(authority.recoveryWorkflowRef);
    const projection = await invoke<CoreV2WorkflowProjection | null>(this.#ingressUrl, target.service, target.key, "status");
    if (projection === null) return null;
    return publicStatus(projection, `restate://${target.service}/${target.key}`, this.taskUrl(taskId));
  }

  public async wait(taskId: string, options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {}): Promise<ProjectTaskStatusV1> {
    let latest: ProjectTaskStatusV1 | undefined;
    for await (const status of this.watch(taskId, options)) latest = status;
    if (latest === undefined) throw new ProjectManifestError("PROJECT_TASK_NOT_FOUND", `no status exists for ${taskId}`);
    return latest;
  }

  public async *watch(taskId: string, options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {}): AsyncGenerator<ProjectTaskStatusV1> {
    const timeoutMs = options.timeoutMs ?? 3_600_000;
    const intervalMs = options.intervalMs ?? 1_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(intervalMs) || intervalMs < 50) {
      throw new ProjectManifestError("PROJECT_WATCH_INTERVAL_INVALID", "timeoutMs and intervalMs must be positive integers");
    }
    const deadline = Date.now() + timeoutMs;
    let previous = "";
    for (;;) {
      const status = await this.status(taskId);
      if (status !== null) {
        const identity = JSON.stringify(status);
        if (identity !== previous) { previous = identity; yield status; }
        if (status.archiveStatus === "ARCHIVED" || status.archiveStatus === "FAILED" || status.state === "WAITING_RECONCILE") return;
      }
      if (Date.now() >= deadline) throw new ProjectManifestError("PROJECT_TASK_WATCH_TIMEOUT", `timed out waiting for ${taskId}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
    }
  }

  public taskUrl(taskId: string): string {
    return `${this.#boardUrl}/tasks/${encodeURIComponent(taskIdValue(taskId))}`;
  }

  public async trace(taskId: string): Promise<unknown> {
    const response = await fetch(`${this.#boardUrl}/api/tasks/${encodeURIComponent(taskIdValue(taskId))}/trace`, { cache: "no-store" });
    if (!response.ok) throw new ProjectManifestError("PROJECT_BOARD_REQUEST_FAILED", `Board returned ${response.status}`);
    return response.json() as Promise<unknown>;
  }
}

export async function prepareProjectTask(
  request: StartProjectTaskRequest,
  options: { readonly runtimeRoot: string; readonly providerRoots?: MoyeClientOptions["providerRoots"] },
): Promise<{ readonly manifest: LoadedProjectManifest; readonly input: CoreV2WorkflowInput }> {
  const objective = requiredText(request.objective, "objective");
  const criteria = request.acceptanceCriteria.map((item) => requiredText(item, "acceptanceCriteria"));
  if (criteria.length === 0) throw new ProjectManifestError("PROJECT_ACCEPTANCE_REQUIRED", "at least one acceptance criterion is required");
  const loaded = await loadProjectManifest(request.manifestPath);
  if (loaded.manifest.tests.length === 0) throw new ProjectManifestError("PROJECT_TEST_COMMAND_REQUIRED", "at least one trusted test command is required before task start");
  const repositoryRoot = await realpath(loaded.repositoryRoot);
  const status = await git(repositoryRoot, ["status", "--porcelain=v1"]);
  if (status.trim()) throw new ProjectManifestError("PROJECT_GIT_DIRTY", "repository must be clean; commit the Manifest and project changes before task start");
  const baseCommit = await git(repositoryRoot, ["rev-parse", `${loaded.manifest.repository.baseRef}^{commit}`]);
  const head = await git(repositoryRoot, ["rev-parse", "HEAD"]);
  if (baseCommit !== head) throw new ProjectManifestError("PROJECT_BASE_NOT_HEAD", "repository.baseRef must resolve to current HEAD in Framework MVP");
  let targetCommit: string;
  try { targetCommit = await git(repositoryRoot, ["rev-parse", `${loaded.manifest.repository.targetRef}^{commit}`]); }
  catch { throw new ProjectManifestError("PROJECT_TARGET_REF_MISSING", `target ref ${loaded.manifest.repository.targetRef} must exist before task start`); }
  if (targetCommit !== baseCommit) throw new ProjectManifestError("PROJECT_TARGET_REF_DIVERGED", "target ref must equal the frozen base commit before task start");

  const taskId = request.taskId === undefined ? generatedTaskId() : taskIdValue(request.taskId);
  const runtimeRoot = path.resolve(options.runtimeRoot);
  if (sameOrWithin(repositoryRoot, runtimeRoot) || sameOrWithin(runtimeRoot, repositoryRoot)) {
    throw new ProjectManifestError("PROJECT_RUNTIME_ROOT_OVERLAP", "managed runtime root must be outside the repository");
  }
  const artifactRoot = path.join(runtimeRoot, loaded.manifest.project.id, taskId, loaded.manifest.artifacts.root);
  await mkdir(artifactRoot, { recursive: true });
  const runnerKind = loaded.manifest.agent.runner === "codex" ? "CODEX_EXEC" as const : "CLAUDE_PRINT" as const;
  const sessionEvidence = sessionEvidenceInput(loaded, options.providerRoots);
  const input: CoreV2WorkflowInput = Object.freeze({
    taskId,
    projectId: loaded.manifest.project.id,
    title: request.title === undefined ? objective.slice(0, 120) : requiredText(request.title, "title"),
    objective,
    acceptanceCriteria: Object.freeze(criteria),
    repositoryRoot,
    artifactRoot,
    runnerKind,
    baseCommit,
    targetRef: loaded.manifest.repository.targetRef,
    testCommands: Object.freeze(loaded.manifest.tests.map((command) => Object.freeze([...command.argv]))),
    ...(sessionEvidence === undefined ? {} : { sessionEvidence }),
  });
  return Object.freeze({ manifest: loaded, input });
}

function sessionEvidenceInput(loaded: LoadedProjectManifest, roots: MoyeClientOptions["providerRoots"]): CoreV2WorkflowInput["sessionEvidence"] {
  const policy = loaded.manifest.agent.captureTranscripts;
  if (policy === "none") return undefined;
  if (!loaded.manifest.privacy.capturePrompts) throw new ProjectManifestError("PROJECT_PROMPT_CAPTURE_NOT_ALLOWED", "transcript capture requires privacy.capturePrompts: true");
  if (policy === "redacted") throw new ProjectManifestError("PROJECT_CAPTURE_POLICY_UNSUPPORTED", "Core v2 currently supports digest_only or full capture; redacted requires a compatible plugin");
  const home = os.homedir();
  if (loaded.manifest.agent.runner === "codex") {
    return { enabled: true, capturePolicy: policy, codexSessionsRoot: roots?.codexSessions ?? path.join(home, ".codex", "sessions") };
  }
  return { enabled: true, capturePolicy: policy, claudeProjectsRoot: roots?.claudeProjects ?? path.join(home, ".claude", "projects") };
}

function publicStatus(projection: CoreV2WorkflowProjection, workflow: string, boardUrl: string): ProjectTaskStatusV1 {
  const archiveStatus = projection.lifecycle.archive?.status ?? "NOT_READY";
  return Object.freeze({
    apiVersion: 1,
    taskId: projection.taskId,
    workflowRef: workflow,
    state: projection.state,
    currentStep: projection.currentStep,
    archiveStatus,
    outcome: projection.outcome,
    startedAt: projection.startedAt,
    completedAt: projection.completedAt,
    boardUrl,
  });
}

function workflowRef(value: string): { service: string; key: string } {
  const match = /^restate:\/\/([A-Za-z][A-Za-z0-9]*)\/([A-Z0-9-]+)$/.exec(value);
  if (match === null) throw new ProjectManifestError("PROJECT_WORKFLOW_REF_INVALID", `invalid owning workflow ref ${value}`);
  return { service: match[1]!, key: match[2]! };
}

function generatedTaskId(): string {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `TASK-${timestamp}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function taskIdValue(value: string): string {
  if (!/^TASK-[A-Z0-9][A-Z0-9-]{0,63}$/.test(value)) throw new ProjectManifestError("PROJECT_TASK_ID_INVALID", `invalid Task ID ${value}`);
  return value;
}

function requiredText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ProjectManifestError("PROJECT_TEXT_REQUIRED", `${label} must be non-empty`);
  return value.trim();
}

async function git(root: string, args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", root, ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    return result.stdout.trim();
  } catch (error) {
    throw new ProjectManifestError("PROJECT_GIT_FAILED", error instanceof Error ? error.message : String(error));
  }
}

function sameOrWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeHttpUrl(value: string, label: string): string {
  const url = new URL(value);
  if (!(["http:", "https:"] as const).includes(url.protocol as "http:" | "https:") || url.username || url.password || url.hash) {
    throw new ProjectManifestError("PROJECT_URL_INVALID", `${label} must be a safe HTTP URL`);
  }
  return url.toString().replace(/\/$/, "");
}
