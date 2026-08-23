#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { loadBacklogSyncBatch } from "../backlog/document-sync.js";
import { loadConfig } from "../config.js";
import type { ArchiveInput } from "../domain/archive.js";
import type { TaskProjection } from "../domain/task.js";
import type { CodingWorkflowProjection } from "../coding/workflow.js";
import type { BacklogSyncResult } from "../domain/backlog.js";
import { createTaskProjection } from "../domain/task.js";
import { invoke, send } from "../restate/ingress.js";
import type { TaskWorkflowInput } from "../restate/services.js";
import type { TaskAuthorityState } from "../restate/services.js";
import type { BootstrapFailureRecoveryInput } from "../restate/services.js";
import type { SealedTaskRecoveryInput } from "../restate/services.js";
import { buildLiveCodingTask } from "../product/live-task.js";
import type { CodingReconcileInput } from "../restate/coding-services.js";
import { verifyBootstrapPreflight } from "../archive/bootstrap-closure.js";
import { createSealIntent, stageSealedTaskPackage } from "../archive/sealed-result-commit.js";
import type {
  SealEvidence,
  SealIntent,
  SealedTaskInput,
} from "../archive/sealed-result-commit.js";
import type { SealedTaskStatus } from "../restate/services.js";
import type { CoreV2ArchiveRetryInput, CoreV2FailureRecoveryInput, CoreV2ReconcileInput, CoreV2WorkflowInput, CoreV2WorkflowProjection } from "../restate/core-v2-services.js";
import { inspectCoreV2SourceInvocation } from "../restate/invocation-inspector.js";

const [command = "help", ...args] = process.argv.slice(2);
const config = loadConfig();

try {
  switch (command) {
    case "validate": {
      const input = await loadTaskInput(requiredOption(args, "--file"));
      createTaskProjection(input, new Date().toISOString());
      await preflightBootstrap(input);
      print({ valid: true, taskId: input.taskId, specRevision: input.specRevision });
      break;
    }
    case "route":
      await runDocsGraph("route", args);
      break;
    case "backlog": {
      const subcommand = args[0];
      if (subcommand !== "sync") throw new Error(`Unknown backlog command: ${subcommand ?? ""}`);
      const directory = optionalOption(args, "--dir") ?? "docs/delivery/backlog";
      const projectId = optionalOption(args, "--project") ?? config.projectId;
      const batch = await loadBacklogSyncBatch(directory);
      const result = await invoke<BacklogSyncResult>(
        config.restateIngressUrl,
        "ProjectBoard",
        projectId,
        "syncBacklog",
        batch,
      );
      print({ projectId, directory, ...result });
      break;
    }
    case "status": {
      const taskId = requiredArgument(args, "task id");
      print(await taskStatus(taskId));
      break;
    }
    case "wait": {
      const taskId = requiredArgument(args, "task id");
      const timeoutMs = Number(optionalOption(args, "--timeout-ms") ?? "3600000");
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("--timeout-ms must be a positive integer");
      print(await waitForTask(taskId, timeoutMs));
      break;
    }
    case "create": {
      const value = await loadJson<unknown>(requiredOption(args, "--file"));
      if (isCodingSubmission(value)) {
        const built = await buildLiveCodingTask(value, {
          projectId: config.projectId,
          runtimeRoot: config.liveRuntimeRoot,
          allowedRepositoryRoots: config.repositoryRoots,
        });
        const receipt = await send(config.restateIngressUrl, "CodingTaskWorkflow", built.taskId, "run", built.input);
        print({ accepted: true, taskId: built.taskId, workflow: "CodingTaskWorkflow", ...receipt });
      } else {
        const input = value as TaskWorkflowInput;
        createTaskProjection(input, new Date().toISOString());
        await preflightBootstrap(input);
        const receipt = await send(config.restateIngressUrl, "TaskWorkflow", input.taskId, "run", input);
        print({ accepted: true, taskId: input.taskId, workflow: "TaskWorkflow", ...receipt });
      }
      break;
    }
    case "core-v2-start": {
      const input = await loadJson<CoreV2WorkflowInput>(requiredOption(args, "--file"));
      print({ accepted: true, taskId: input.taskId, workflow: "CoreV2Workflow", ...await send(config.restateIngressUrl, "CoreV2Workflow", input.taskId, "run", input) });
      break;
    }
    case "core-v2-status": {
      const taskId = requiredArgument(args, "task id");
      print(await taskStatus(taskId));
      break;
    }
    case "core-v2-recover-failure": {
      const input = await loadJson<CoreV2FailureRecoveryInput>(requiredOption(args, "--file"));
      print(await invoke<CoreV2WorkflowProjection>(
        config.restateIngressUrl,
        input.recoveryId === undefined ? "CoreV2FailureRecoveryWorkflow" : "CoreV2FailureRecoveryAttemptWorkflow",
        input.recoveryId ?? input.taskId,
        "run",
        input,
      ));
      break;
    }
    case "core-v2-recovery-plan": {
      const taskId = requiredArgument(args, "task id");
      const invocationId = requiredOption(args, "--invocation");
      const authority = await invoke<TaskAuthorityState | null>(config.restateIngressUrl, "TaskAuthority", taskId, "get");
      if (authority?.owner !== "CORE_V2_WORKFLOW" || authority.recoveryWorkflowRef !== undefined) {
        throw new Error(`Task ${taskId} is not an unrecovered CoreV2Workflow`);
      }
      const source = await invoke<CoreV2WorkflowProjection | null>(config.restateIngressUrl, "CoreV2Workflow", taskId, "status");
      if (source === null) throw new Error(`CoreV2Workflow ${taskId} has no Projection`);
      const fact = await inspectCoreV2SourceInvocation(config.restateAdminUrl, taskId, invocationId);
      const input: CoreV2FailureRecoveryInput = {
        taskId,
        projectId: source.projectId,
        artifactRoot: source.artifactRoot,
        sourceWorkflowRef: `restate://CoreV2Workflow/${taskId}`,
        expectedSourceProjectionDigest: cliDigest(source),
        sourceInvocationId: fact.invocationId,
        expectedInvocationFactDigest: fact.factDigest,
      };
      print({ input, invocationFact: fact });
      break;
    }
    case "core-v2-retry-archive": {
      const taskId = requiredArgument(args, "task id");
      const authority = await invoke<TaskAuthorityState | null>(config.restateIngressUrl, "TaskAuthority", taskId, "get");
      if (authority?.owner !== "CORE_V2_WORKFLOW") throw new Error(`Task ${taskId} is not owned by CoreV2Workflow`);
      const target = authority.recoveryWorkflowRef === undefined ? { service: "CoreV2Workflow", key: taskId } : parseWorkflowRef(authority.recoveryWorkflowRef);
      const input: CoreV2ArchiveRetryInput = { token: requiredOption(args, "--token"), evidence: requiredOption(args, "--evidence") };
      print(await invoke<CoreV2WorkflowProjection>(config.restateIngressUrl, target.service, target.key, "retryArchive", input));
      break;
    }
    case "core-v2-reconcile": {
      const taskId = requiredArgument(args, "task id");
      const action = requiredOption(args, "--action");
      if (action !== "CONFIRMED" && action !== "NOT_APPLIED") throw new Error("--action must be CONFIRMED or NOT_APPLIED");
      const input: CoreV2ReconcileInput = { token: requiredOption(args, "--token"), action, evidence: requiredOption(args, "--evidence") };
      print(await invoke<CoreV2WorkflowProjection>(config.restateIngressUrl, "CoreV2Workflow", taskId, "reconcile", input));
      break;
    }
    case "close": {
      const input = await loadTaskInput(requiredOption(args, "--file"));
      await preflightBootstrap(input);
      const result = await invoke<TaskProjection>(config.restateIngressUrl, "TaskWorkflow", input.taskId, "run", input);
      if (result.state !== "CLOSED") throw new Error(`Task ended in ${result.state}`);
      print(result);
      break;
    }
    case "recover-bootstrap-failure": {
      const input = await loadJson<BootstrapFailureRecoveryInput>(requiredOption(args, "--file"));
      const result = await invoke<TaskProjection>(
        config.restateIngressUrl,
        "BootstrapFailureRecoveryWorkflow",
        input.taskId,
        "run",
        input,
      );
      print(result);
      break;
    }
    case "seal-start": {
      const input = await loadJson<SealedTaskInput>(requiredOption(args, "--file"));
      createTaskProjection(input, new Date().toISOString());
      await createSealIntent(resolve(process.env["MOYE_REPOSITORY_ROOT"] ?? process.cwd()), input);
      const receipt = await send(
        config.restateIngressUrl, "SealedTaskWorkflow", input.taskId, "run", input,
      );
      print({ accepted: true, taskId: input.taskId, workflow: "SealedTaskWorkflow", ...receipt });
      break;
    }
    case "seal-status": {
      const taskId = requiredArgument(args, "task id");
      print(await invoke<SealedTaskStatus | null>(
        config.restateIngressUrl, "SealedTaskWorkflow", taskId, "sealStatus",
      ));
      break;
    }
    case "recover-sealed-failure": {
      const input = await loadJson<SealedTaskRecoveryInput>(requiredOption(args, "--file"));
      print(await invoke<TaskProjection>(
        config.restateIngressUrl,
        input.recoveryId === undefined ? "SealedTaskRecoveryWorkflow" : "SealRecoveryAttemptWorkflow",
        input.recoveryId ?? input.taskId,
        "run",
        input,
      ));
      break;
    }
    case "seal-stage": {
      const intent = await loadJson<SealIntent>(requiredOption(args, "--file"));
      await stageSealedTaskPackage(resolve(process.env["MOYE_REPOSITORY_ROOT"] ?? process.cwd()), intent);
      print({ staged: true, taskId: intent.taskId, archivePath: intent.archivePath, intentDigest: intent.intentDigest });
      break;
    }
    case "seal-submit": {
      const taskId = requiredArgument(args, "task id");
      const status = await invoke<SealedTaskStatus | null>(
        config.restateIngressUrl, "SealedTaskWorkflow", taskId, "sealStatus",
      );
      if (status === null) throw new Error(`No Seal Intent exists for ${taskId}`);
      const resultCommit = requiredOption(args, "--commit");
      await assertLocalGitCommit(resultCommit);
      const evidence: SealEvidence = {
        token: requiredOption(args, "--token"),
        resultCommit,
        executorId: requiredOption(args, "--executor"),
        verificationPath: status.intent.verificationPath,
        docsImpactPath: status.intent.docsImpactPath,
      };
      print(await invoke<SealedTaskStatus>(
        config.restateIngressUrl, "SealedTaskWorkflow", taskId, "seal", evidence,
      ));
      break;
    }
    case "reconcile-task": {
      const taskId = requiredArgument(args, "task id");
      const input: CodingReconcileInput = {
        token: requiredOption(args, "--token"),
        action: "RESUME_AFTER_RECONCILE",
        evidence: requiredOption(args, "--evidence"),
      };
      print(await invoke<CodingWorkflowProjection>(
        config.restateIngressUrl, "CodingTaskWorkflow", taskId, "reconcile", input,
      ));
      break;
    }
    case "archive":
    case "reconcile": {
      const input = await loadJson<ArchiveInput & { readonly task: TaskProjection }>(requiredOption(args, "--file"));
      const result = await invoke<TaskProjection>(config.restateIngressUrl, "ArchiveWorkflow", input.taskId, "run", input);
      print(result);
      break;
    }
    case "graph":
      await runDocsGraph(args.includes("--mermaid") ? "mermaid" : "validate", []);
      break;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(helpText());
      break;
    default:
      throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function taskStatus(taskId: string): Promise<TaskProjection | CodingWorkflowProjection | CoreV2WorkflowProjection | null> {
  const authority = await invoke<TaskAuthorityState | null>(config.restateIngressUrl, "TaskAuthority", taskId, "get");
  if (authority === null) return null;
  if (authority.owner === "CODING_WORKFLOW") {
    return invoke<CodingWorkflowProjection | null>(config.restateIngressUrl, "CodingTaskWorkflow", taskId, "status");
  }
  if (authority.owner === "CORE_V2_WORKFLOW") {
    const target = authority.recoveryWorkflowRef === undefined ? { service: "CoreV2Workflow", key: taskId } : parseWorkflowRef(authority.recoveryWorkflowRef);
    return invoke(config.restateIngressUrl, target.service, target.key, "status");
  }
  if (authority.owner === "TASK_WORKFLOW") {
    if (authority.recoveryWorkflowRef !== undefined) {
      return invoke<TaskProjection | null>(
        config.restateIngressUrl, "BootstrapFailureRecoveryWorkflow", taskId, "status",
      );
    }
    return invoke<TaskProjection | null>(config.restateIngressUrl, "TaskWorkflow", taskId, "status");
  }
  if (authority.owner === "SEALED_TASK_WORKFLOW") {
    const recovery = authority.recoveryWorkflowRef === undefined ? undefined : parseWorkflowRef(authority.recoveryWorkflowRef);
    return invoke<TaskProjection | null>(
      config.restateIngressUrl,
      recovery?.service ?? "SealedTaskWorkflow",
      recovery?.key ?? taskId,
      "status",
    );
  }
  throw new Error(`Task ${taskId} is owned by ${authority.owner}; no unified product projection is available`);
}

function parseWorkflowRef(value: string): { service: string; key: string } {
  const match = /^restate:\/\/([A-Za-z][A-Za-z0-9]*)\/([A-Z0-9-]+)$/.exec(value);
  if (match === null) throw new Error(`Invalid Workflow ref: ${value}`);
  return { service: match[1]!, key: match[2]! };
}

async function waitForTask(taskId: string, timeoutMs: number): Promise<TaskProjection | CodingWorkflowProjection | CoreV2WorkflowProjection> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const projection = await taskStatus(taskId);
    if (projection !== null) {
      if ("archiveStatus" in projection && projection.archiveStatus === "ARCHIVED") return projection;
      if ("state" in projection && projection.state === "WAITING_RECONCILE") return projection;
      if ("archiveStatus" in projection && projection.archiveStatus === "FAILED") return projection;
      if ("lifecycle" in projection && (projection.state === "CLOSED" || projection.state === "ARCHIVE_FAILED")) return projection;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`Timed out waiting for ${taskId} after ${timeoutMs} ms`);
}

function isCodingSubmission(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && "objective" in value && "repositoryRoot" in value && "runnerKind" in value;
}

async function loadTaskInput(path: string): Promise<TaskWorkflowInput> {
  return loadJson<TaskWorkflowInput>(path);
}

async function preflightBootstrap(input: TaskWorkflowInput): Promise<void> {
  if (input.bootstrapEvidence === undefined) return;
  await verifyBootstrapPreflight({
    repositoryRoot: resolve(process.env["MOYE_REPOSITORY_ROOT"] ?? process.cwd()),
    taskId: input.taskId,
  });
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as T;
}

function requiredOption(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function requiredArgument(args: readonly string[], label: string): string {
  const value = args.find((argument) => !argument.startsWith("--"));
  if (value === undefined) throw new Error(`${label} is required`);
  return value;
}

async function runDocsGraph(subcommand: string, args: readonly string[]): Promise<void> {
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn("ruby", ["scripts/docs_graph.rb", subcommand, ...args], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`docs graph command failed with exit code ${exitCode}`);
}

async function assertLocalGitCommit(commit: string): Promise<void> {
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit)) throw new Error("--commit must be a full Git object id");
  const repositoryRoot = resolve(process.env["MOYE_REPOSITORY_ROOT"] ?? process.cwd());
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn("git", ["-C", repositoryRoot, "cat-file", "-e", `${commit}^{commit}`], {
      cwd: repositoryRoot,
      stdio: "ignore",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`--commit does not identify a local Git commit: ${commit}`);
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function cliDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function helpText(): string {
  return `Moye Task Control CLI

Usage:
  moye backlog sync [--dir PATH] [--project PROJECT-ID]
  moye validate --file task.json
  moye route --intent NAME --path PATH
  moye status TASK-ID
  moye wait TASK-ID [--timeout-ms N]
  moye create --file task.json
  moye core-v2-start --file core-v2-task.json
  moye core-v2-status TASK-ID
  moye core-v2-recovery-plan TASK-ID --invocation INVOCATION-ID
  moye core-v2-recover-failure --file recovery.json
  moye core-v2-retry-archive TASK-ID --token TOKEN --evidence TEXT
  moye core-v2-reconcile TASK-ID --token TOKEN --action CONFIRMED|NOT_APPLIED --evidence TEXT
  moye close --file task.json
  moye recover-bootstrap-failure --file recovery.json
  moye seal-start --file sealed-task.json
  moye seal-status TASK-ID
  moye recover-sealed-failure --file recovery.json
  moye seal-stage --file seal-intent.json
  moye seal-submit TASK-ID --token TOKEN --commit SHA --executor ID
  moye archive --file archive.json
  moye reconcile --file archive.json
  moye reconcile-task TASK-ID --token TOKEN --evidence TEXT
  moye graph [--mermaid]

create accepts either a bootstrap TaskWorkflow JSON or a real coding-task
submission and submits it asynchronously. status/wait resolve TaskAuthority
before querying the owning workflow. close attaches to the same durable
workflow and waits for its business terminal state. archive and reconcile use
the same keyed ArchiveWorkflow, so they cannot create a second lifecycle.

backlog sync validates every BL-*.yaml before a single ProjectBoard batch call.
Runtime-only records are preserved and reported; no implicit delete occurs.
`;
}
