#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { loadConfig } from "../config.js";
import type { ArchiveInput } from "../domain/archive.js";
import type { TaskProjection } from "../domain/task.js";
import { createTaskProjection } from "../domain/task.js";
import { invoke, send } from "../restate/ingress.js";
import type { TaskWorkflowInput } from "../restate/services.js";

const [command = "help", ...args] = process.argv.slice(2);
const config = loadConfig();

try {
  switch (command) {
    case "validate": {
      const input = await loadTaskInput(requiredOption(args, "--file"));
      createTaskProjection(input, new Date().toISOString());
      print({ valid: true, taskId: input.taskId, specRevision: input.specRevision });
      break;
    }
    case "route":
      await runDocsGraph("route", args);
      break;
    case "status": {
      const taskId = requiredArgument(args, "task id");
      print(await taskStatus(taskId));
      break;
    }
    case "create": {
      const input = await loadTaskInput(requiredOption(args, "--file"));
      const receipt = await send(config.restateIngressUrl, "TaskWorkflow", input.taskId, "run", input);
      print({ accepted: true, taskId: input.taskId, ...receipt });
      break;
    }
    case "close": {
      const input = await loadTaskInput(requiredOption(args, "--file"));
      const result = await invoke<TaskProjection>(config.restateIngressUrl, "TaskWorkflow", input.taskId, "run", input);
      if (result.state !== "CLOSED") throw new Error(`Task ended in ${result.state}`);
      print(result);
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

async function taskStatus(taskId: string): Promise<TaskProjection | null> {
  return invoke<TaskProjection | null>(
    config.restateIngressUrl,
    "TaskWorkflow",
    taskId,
    "status",
  );
}

async function loadTaskInput(path: string): Promise<TaskWorkflowInput> {
  return loadJson<TaskWorkflowInput>(path);
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
  moye validate --file task.json
  moye route --intent NAME --path PATH
  moye status TASK-ID
  moye create --file task.json
  moye close --file task.json
  moye archive --file archive.json
  moye reconcile --file archive.json
  moye graph [--mermaid]

create submits a workflow asynchronously; close attaches to the same durable
workflow and waits for its business terminal state. archive and reconcile use
the same keyed ArchiveWorkflow, so they cannot create a second lifecycle.
`;
}
