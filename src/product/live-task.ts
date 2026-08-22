import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createTaskEnvelope } from "../domain/coding-task.js";
import { MoyeError } from "../domain/errors.js";
import type { CodingTaskWorkflowInput } from "../restate/coding-services.js";

const execFileAsync = promisify(execFile);

export interface LiveTaskSubmission {
  readonly taskId?: string;
  readonly title: string;
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly repositoryRoot: string;
  readonly baseBranch: string;
  readonly targetBranch: string;
  readonly runnerKind: "CODEX_EXEC" | "CLAUDE_PRINT";
  readonly validationCommands: readonly {
    readonly commandId: string;
    readonly argv: readonly string[];
  }[];
  readonly docsDisposition: "updated" | "unchanged" | "not_applicable";
}

export interface LiveTaskBuildOptions {
  readonly projectId: string;
  readonly runtimeRoot: string;
  readonly allowedRepositoryRoots: readonly string[];
  readonly now?: () => Date;
}

export interface LiveTaskBuildResult {
  readonly taskId: string;
  readonly input: CodingTaskWorkflowInput;
}

export async function buildLiveCodingTask(
  value: unknown,
  options: LiveTaskBuildOptions,
): Promise<LiveTaskBuildResult> {
  const submission = parseSubmission(value);
  const repositoryRoot = await resolveAllowedRepository(
    submission.repositoryRoot,
    options.allowedRepositoryRoots,
  );
  const taskId = submission.taskId ?? generatedTaskId(options.now?.() ?? new Date());
  const baseRef = branchRef(submission.baseBranch, "baseBranch");
  const targetRef = branchRef(submission.targetBranch, "targetBranch");
  const [baseSha, worktrees] = await Promise.all([
    git(repositoryRoot, ["rev-parse", "--verify", `${baseRef}^{commit}`]),
    git(repositoryRoot, ["worktree", "list", "--porcelain", "-z"]),
  ]);
  let targetSha = await gitOptional(repositoryRoot, ["rev-parse", "--verify", `${targetRef}^{commit}`]);
  if (targetSha === undefined) {
    const zero = "0".repeat(baseSha.length);
    await git(repositoryRoot, ["update-ref", targetRef, baseSha, zero]);
    targetSha = baseSha;
  }
  if (baseSha !== targetSha) {
    throw validation("LIVE_TARGET_NOT_AT_BASE", "targetBranch must point at the same commit as baseBranch when the task is submitted");
  }
  if (worktrees.split("\0").some((field) => field === `branch ${targetRef}`)) {
    throw validation(
      "LIVE_TARGET_CHECKED_OUT",
      "targetBranch is checked out in a Worktree; use a dedicated, non-checked-out integration branch",
    );
  }

  const runtimeRoot = path.resolve(options.runtimeRoot);
  if (runtimeRoot === path.parse(runtimeRoot).root || isSameOrWithin(repositoryRoot, runtimeRoot)) {
    throw validation("UNSAFE_LIVE_RUNTIME_ROOT", "Moye live runtime root must be outside the target repository");
  }
  const taskRoot = path.join(runtimeRoot, "tasks", taskId);
  const archiveRoot = path.join(runtimeRoot, "tasks", "archive");
  const artifactRoot = path.join(runtimeRoot, "artifacts", taskId);
  const worktreeRoot = path.join(runtimeRoot, "worktrees");
  await Promise.all([
    mkdir(path.join(runtimeRoot, "tasks"), { recursive: true }),
    mkdir(artifactRoot, { recursive: true }),
    mkdir(worktreeRoot, { recursive: true }),
  ]);
  await Promise.all([
    mkdir(taskRoot, { recursive: false }),
    mkdir(archiveRoot, { recursive: true }),
  ]);

  const envelope = createTaskEnvelope({
    taskId,
    specRevision: 1,
    baseSha,
    requirements: [{
      requirementId: `REQ-LIVE-${taskId.slice("TASK-LIVE-".length).replaceAll("-", "")}`,
      title: submission.objective,
      acceptanceCriteria: submission.acceptanceCriteria,
    }],
    validationCommands: submission.validationCommands,
    contextPlan: {
      graphRevision: 1,
      intents: ["live-coding-task"],
      requiredRead: ["repository-instructions"],
      requiredReview: [],
    },
  });
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const input: CodingTaskWorkflowInput = {
    projectId: options.projectId,
    title: submission.title,
    backlogRefs: [],
    activeTasksRoot: path.join(runtimeRoot, "tasks"),
    archiveRoot,
    archivedAt: createdAt,
    envelope,
    expectedEnvelopeDigest: envelope.envelopeDigest,
    repositoryRoot,
    worktreeRoot,
    artifactRoot,
    baseRef,
    targetRef,
    runnerKind: submission.runnerKind,
    prompt: implementationPrompt(submission),
    docsDisposition: submission.docsDisposition,
    reviewMode: "REAL",
    roleMode: "REAL",
    maxRepairAttempts: 1,
    maxReplanAttempts: 1,
  };
  await Promise.all([
    writeFile(path.join(taskRoot, "spec.md"), taskSpec(taskId, submission), { flag: "wx" }),
    writeFile(path.join(taskRoot, "task.json"), `${JSON.stringify({
      schemaVersion: 1,
      taskId,
      projectId: options.projectId,
      createdAt,
      runnerKind: submission.runnerKind,
      repositoryRoot,
      baseRef,
      targetRef,
      envelopeDigest: envelope.envelopeDigest,
    }, null, 2)}\n`, { flag: "wx" }),
  ]);
  return { taskId, input };
}

export async function listLiveCapabilities(options: LiveTaskBuildOptions): Promise<{
  readonly runners: readonly ["CODEX_EXEC", "CLAUDE_PRINT"];
  readonly repositoryRoots: readonly string[];
  readonly fakeAllowed: false;
}> {
  const repositoryRoots = await Promise.all(options.allowedRepositoryRoots.map((root) => realpath(path.resolve(root))));
  return { runners: ["CODEX_EXEC", "CLAUDE_PRINT"], repositoryRoots, fakeAllowed: false };
}

function parseSubmission(value: unknown): LiveTaskSubmission {
  const input = record(value, "LiveTaskSubmission");
  const runnerKind = input["runnerKind"];
  if (runnerKind !== "CODEX_EXEC" && runnerKind !== "CLAUDE_PRINT") {
    throw validation("REAL_RUNNER_REQUIRED", "runnerKind must be CODEX_EXEC or CLAUDE_PRINT; FAKE is forbidden on the product API");
  }
  const docsDisposition = input["docsDisposition"];
  if (docsDisposition !== "updated" && docsDisposition !== "unchanged" && docsDisposition !== "not_applicable") {
    throw validation("INVALID_DOCS_DISPOSITION", "docsDisposition must be updated, unchanged, or not_applicable");
  }
  const acceptanceCriteria = stringArray(input["acceptanceCriteria"], "acceptanceCriteria");
  const rawCommands = input["validationCommands"];
  if (!Array.isArray(rawCommands) || rawCommands.length === 0) {
    throw validation("VALIDATION_COMMANDS_REQUIRED", "at least one argv validation command is required");
  }
  const validationCommands = rawCommands.map((candidate, index) => {
    const command = record(candidate, `validationCommands[${index}]`);
    return {
      commandId: text(command["commandId"], `validationCommands[${index}].commandId`),
      argv: stringArray(command["argv"], `validationCommands[${index}].argv`),
    };
  });
  return {
    ...(input["taskId"] === undefined ? {} : { taskId: text(input["taskId"], "taskId") }),
    title: text(input["title"], "title"),
    objective: text(input["objective"], "objective"),
    acceptanceCriteria,
    repositoryRoot: text(input["repositoryRoot"], "repositoryRoot"),
    baseBranch: text(input["baseBranch"], "baseBranch"),
    targetBranch: text(input["targetBranch"], "targetBranch"),
    runnerKind,
    validationCommands,
    docsDisposition,
  };
}

async function resolveAllowedRepository(value: string, roots: readonly string[]): Promise<string> {
  if (roots.length === 0) throw validation("LIVE_REPOSITORIES_NOT_CONFIGURED", "No live repository root is configured");
  const repositoryRoot = await realpath(path.resolve(value));
  const allowedRoots = await Promise.all(roots.map((root) => realpath(path.resolve(root))));
  if (!allowedRoots.some((root) => isSameOrWithin(root, repositoryRoot))) {
    throw validation("LIVE_REPOSITORY_NOT_ALLOWED", "repositoryRoot is outside MOYE_REPOSITORY_ROOTS");
  }
  const topLevel = await git(repositoryRoot, ["rev-parse", "--show-toplevel"]);
  if (await realpath(topLevel) !== repositoryRoot) {
    throw validation("LIVE_REPOSITORY_NOT_TOP_LEVEL", "repositoryRoot must be a Git top-level directory");
  }
  return repositoryRoot;
}

async function git(cwd: string, argv: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", [...argv], { cwd, encoding: "utf8", shell: false });
    return result.stdout.trim();
  } catch (error) {
    const candidate = error as { stderr?: string; message?: string };
    throw validation("LIVE_GIT_PREFLIGHT_FAILED", candidate.stderr?.trim() || candidate.message || `git ${argv[0]} failed`);
  }
}

async function gitOptional(cwd: string, argv: readonly string[]): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", [...argv], { cwd, encoding: "utf8", shell: false });
    return result.stdout.trim();
  } catch {
    return undefined;
  }
}

function implementationPrompt(input: LiveTaskSubmission): string {
  return [
    "You are the implementation agent for a real Moye coding task in an isolated Git Worktree.",
    "Read the repository instructions and relevant code before editing.",
    `Objective: ${input.objective}`,
    "Acceptance criteria:",
    ...input.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "Run the repository checks needed to validate the change.",
    "Commit every intended change on the current task branch. Do not merge or modify another Worktree.",
    "Finish with a concise factual summary of changed files, checks, and commit.",
  ].join("\n");
}

function taskSpec(taskId: string, input: LiveTaskSubmission): string {
  return `# ${taskId}: ${input.title}\n\n## Objective\n\n${input.objective}\n\n## Acceptance criteria\n\n${input.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}\n\nRunner: ${input.runnerKind}\n`;
}

function generatedTaskId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `TASK-LIVE-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function branchRef(value: string, field: string): string {
  const branch = value.replace(/^refs\/heads\//, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes("..") || branch.endsWith(".lock")) {
    throw validation("INVALID_LIVE_BRANCH", `${field} must be a valid local branch name`);
  }
  return `refs/heads/${branch}`;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw validation("INVALID_LIVE_TASK_INPUT", `${field} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw validation("INVALID_LIVE_TASK_INPUT", `${field} must be a non-empty string`);
  return value.trim();
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw validation("INVALID_LIVE_TASK_INPUT", `${field} must be a non-empty string array`);
  return value.map((item, index) => text(item, `${field}[${index}]`));
}

function isSameOrWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validation(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "VALIDATION", message });
}
