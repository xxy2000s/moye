#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { MoyeClient } from "../framework/client.js";
import { applyStandardDocumentationScaffold, planStandardDocumentationScaffold, STANDARD_DOCUMENTATION_TEMPLATE_VERSION } from "../framework/documentation-scaffold.js";
import { runProjectDoctor } from "../framework/doctor.js";
import { initializeProjectManifest, loadProjectManifest } from "../framework/project-manifest.js";

const [command = "help", ...args] = process.argv.slice(2);

try {
  if (command === "init") {
    const requestedId = option(args, "--project-id");
    const docs = option(args, "--docs");
    const directory = resolve(option(args, "--dir") ?? process.cwd());
    if (docs === undefined) {
      if (args.includes("--apply") || option(args, "--template-version") !== undefined) throw new Error("--apply/--template-version require --docs standard");
      const loaded = await initializeProjectManifest(directory, {
        force: args.includes("--force"),
        ...(requestedId === undefined ? {} : { projectId: requestedId }),
      });
      print({ initialized: true, manifestPath: loaded.manifestPath, projectId: loaded.manifest.project.id, digest: loaded.digest });
    } else {
      if (docs !== "standard") throw new Error(`Unsupported documentation scaffold: ${docs}`);
      if (args.includes("--force")) throw new Error("--force cannot be used with --docs standard; existing files are never overwritten");
      const scaffoldOptions = {
        ...(requestedId === undefined ? {} : { projectId: requestedId }),
        templateVersion: option(args, "--template-version") ?? STANDARD_DOCUMENTATION_TEMPLATE_VERSION,
      };
      const result = args.includes("--apply")
        ? await applyStandardDocumentationScaffold(directory, scaffoldOptions)
        : await planStandardDocumentationScaffold(directory, scaffoldOptions);
      print({ initialized: "applied" in result ? result.applied : false, mode: args.includes("--apply") ? "apply" : "plan", ...result });
      if (result.conflicts.length > 0) process.exitCode = 2;
    }
  } else if (command === "project" && args[0] === "validate") {
    const loaded = await loadProjectManifest(resolve(option(args.slice(1), "--file") ?? ".moye/project.yaml"));
    print({
      valid: true,
      manifestPath: loaded.manifestPath,
      projectId: loaded.manifest.project.id,
      schemaVersion: loaded.manifest.schemaVersion,
      apiVersion: 1,
      pluginApiVersion: 1,
      digest: loaded.digest,
      repositoryRoot: loaded.repositoryRoot,
      workflowProfile: loaded.manifest.workflow.profile,
      documentationPolicy: loaded.manifest.documentation.policy,
      ...(loaded.migratedFrom === undefined ? {} : { migratedFrom: loaded.migratedFrom }),
    });
  } else if (command === "doctor") {
    const report = await runProjectDoctor({
      manifestPath: resolve(option(args, "--file") ?? ".moye/project.yaml"),
      ingressUrl: httpUrl(process.env["RESTATE_INGRESS_URL"] ?? "http://127.0.0.1:8080", "RESTATE_INGRESS_URL"),
      boardUrl: httpUrl(process.env["MOYE_BOARD_URL"] ?? "http://127.0.0.1:3000", "MOYE_BOARD_URL"),
      ...(process.env["MOYE_FRAMEWORK_RUNTIME_ROOT"] === undefined ? {} : { runtimeRoot: process.env["MOYE_FRAMEWORK_RUNTIME_ROOT"] }),
    });
    print(report);
    if (!report.ok) process.exitCode = 1;
  } else if (command === "task") {
    await taskCommand(args);
  } else if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(help());
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function taskCommand(args: readonly string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const client = new MoyeClient({
    ingressUrl: httpUrl(process.env["RESTATE_INGRESS_URL"] ?? "http://127.0.0.1:8080", "RESTATE_INGRESS_URL"),
    boardUrl: httpUrl(process.env["MOYE_BOARD_URL"] ?? "http://127.0.0.1:3000", "MOYE_BOARD_URL"),
    ...(process.env["MOYE_FRAMEWORK_RUNTIME_ROOT"] === undefined ? {} : { runtimeRoot: process.env["MOYE_FRAMEWORK_RUNTIME_ROOT"] }),
  });
  if (subcommand === "start") {
    const objectiveFile = option(rest, "--objective-file");
    const objective = objectiveFile === undefined ? requiredOption(rest, "--objective") : (await readFile(resolve(objectiveFile), "utf8")).trim();
    print(await client.startTask({
      manifestPath: resolve(option(rest, "--file") ?? ".moye/project.yaml"),
      objective,
      acceptanceCriteria: options(rest, "--accept"),
      ...(option(rest, "--title") === undefined ? {} : { title: option(rest, "--title")! }),
      ...(option(rest, "--task-id") === undefined ? {} : { taskId: option(rest, "--task-id")! }),
    }));
  } else if (subcommand === "status") {
    print(await client.status(argument(rest, "task id")));
  } else if (subcommand === "watch") {
    const taskId = argument(rest, "task id");
    const timeoutMs = Number(option(rest, "--timeout-ms") ?? "3600000");
    for await (const status of client.watch(taskId, { timeoutMs })) process.stdout.write(`${JSON.stringify(status)}\n`);
  } else if (subcommand === "open") {
    const url = client.taskUrl(argument(rest, "task id"));
    if (!rest.includes("--print")) launch(url);
    print({ url, launched: !rest.includes("--print") });
  } else {
    throw new Error(`Unknown task command: ${subcommand ?? ""}`);
  }
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function requiredOption(args: readonly string[], name: string): string {
  const value = option(args, name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function options(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === name) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
    values.push(value);
  }
  return values;
}

function argument(args: readonly string[], label: string): string {
  const value = args.find((item) => !item.startsWith("--"));
  if (value === undefined) throw new Error(`${label} is required`);
  return value;
}

function httpUrl(value: string, label: string): string {
  const url = new URL(value);
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password || url.hash) throw new Error(`${label} must be a safe HTTP URL`);
  return url.toString().replace(/\/$/, "");
}

function launch(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const argv = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, argv, { detached: true, stdio: "ignore", shell: false });
  child.unref();
}

function print(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function help(): string {
  return `moye 0.1.0\n\nCommands:\n  init [--dir PATH] [--project-id ID]\n  init --docs standard [--apply] [--dir PATH] [--project-id ID] [--template-version standard-docs-v1]\n  project validate [--file PATH]\n  doctor [--file PATH]\n  task start --objective TEXT --accept TEXT [--file PATH]\n  task status TASK-ID\n  task watch TASK-ID [--timeout-ms N]\n  task open TASK-ID [--print]\n`;
}
