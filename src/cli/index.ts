#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
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
import { buildLiveCodingTask } from "../product/live-task.js";
import type { CodingReconcileInput } from "../restate/coding-services.js";
import { verifyBootstrapPreflight } from "../archive/bootstrap-closure.js";
import { stageSealedTaskPackage } from "../archive/sealed-result-commit.js";
import type {
  SealEvidence,
  SealIntent,
  SealedTaskInput,
} from "../archive/sealed-result-commit.js";
import type { SealedTaskStatus } from "../restate/services.js";

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
      const evidence: SealEvidence = {
        token: requiredOption(args, "--token"),
        resultCommit: requiredOption(args, "--commit"),
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

async function taskStatus(taskId: string): Promise<TaskProjection | CodingWorkflowProjection | null> {
  const authority = await invoke<TaskAuthorityState | null>(config.restateIngressUrl, "TaskAuthority", taskId, "get");
  if (authority === null) return null;
  if (authority.owner === "CODING_WORKFLOW") {
    return invoke<CodingWorkflowProjection | null>(config.restateIngressUrl, "CodingTaskWorkflow", taskId, "status");
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
    return invoke<TaskProjection | null>(config.restateIngressUrl, "SealedTaskWorkflow", taskId, "status");
  }
  throw new Error(`Task ${taskId} is owned by ${authority.owner}; no unified product projection is available`);
}

async function waitForTask(taskId: string, timeoutMs: number): Promise<TaskProjection | CodingWorkflowProjection> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const projection = await taskStatus(taskId);
    if (projection !== null) {
      if ("archiveStatus" in projection && projection.archiveStatus === "ARCHIVED") return projection;
      if ("state" in projection && projection.state === "WAITING_RECONCILE") return projection;
      if ("archiveStatus" in projection && projection.archiveStatus === "FAILED") return projection;
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

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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
  moye close --file task.json
  moye recover-bootstrap-failure --file recovery.json
  moye seal-start --file sealed-task.json
  moye seal-status TASK-ID
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
