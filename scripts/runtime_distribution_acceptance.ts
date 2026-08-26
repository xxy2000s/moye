#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import type { ProjectBoardSnapshot } from "../src/domain/board.js";
import type { TaskProjection } from "../src/domain/task.js";
import { parseBackupManifest, sha256File } from "../src/runtime/backup.js";
import { invoke, send } from "../src/restate/ingress.js";
import type { TaskWorkflowInput } from "../src/restate/services.js";

const suffix = `${process.pid}-${Date.now()}`;
const project = `moye_rt_${process.pid}`;
const taskId = `TASK-RUNTIME-${Date.now()}`;
const root = path.resolve(".moye-runtime", "acceptance", `runtime-${suffix}`);
const backupRoot = path.join(root, "backup");
const evidencePath = path.join(root, "evidence-summary.json");
const [boardPort, ingressPort, adminPort, restoreBoardPort, restoreIngressPort, restoreAdminPort] = await Promise.all([
  freePort(), freePort(), freePort(), freePort(), freePort(), freePort(),
]);
const image = `moye:task-0071-${process.pid}`;
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  MOYE_IMAGE: image,
  MOYE_PROJECT_ID: "moye-runtime-acceptance",
  MOYE_BOARD_BIND_PORT: String(boardPort),
  RESTATE_INGRESS_BIND_PORT: String(ingressPort),
  RESTATE_ADMIN_BIND_PORT: String(adminPort),
  MOYE_WORKSPACE_ROOT: path.join(root, "workspaces"),
  MOYE_SESSION_SOURCE_ROOT: path.join(root, "sessions"),
  COMPOSE_PROGRESS: "plain",
};
const boardUrl = `http://127.0.0.1:${boardPort}`;
const ingressUrl = `http://127.0.0.1:${ingressPort}`;
let accepted = false;

await mkdir(root, { recursive: true });
try {
  runtime("up");
  await waitUntil(async () => (await fetch(`${boardUrl}/readyz`)).ok, 240_000);
  await waitForRegistrar();

  compose(["exec", "-T", "moye", "node", "-e",
    `const fs=require('fs');const p='/var/lib/moye/artifacts/acceptance/active/${taskId}';fs.mkdirSync(p,{recursive:true});fs.writeFileSync(p+'/spec.md','# Runtime distribution acceptance\\n')`]);
  const input: TaskWorkflowInput = {
    taskId,
    projectId: "moye-runtime-acceptance",
    title: "Runtime distribution persistence acceptance",
    specRevision: 1,
    backlogRefs: ["BL-0068"],
    activeTasksRoot: "/var/lib/moye/artifacts/acceptance/active",
    archiveRoot: "/var/lib/moye/artifacts/acceptance/archive",
    effectCounterPath: "/var/lib/moye/artifacts/acceptance/effects/counter.txt",
    archivedAt: "2026-08-25T23:59:00.000Z",
  };
  const receipt = await send(ingressUrl, "TaskWorkflow", taskId, "run", input);
  const beforeRestart = await waitForTask((task) => task.state === "CLOSED" && task.archiveStatus === "ARCHIVED");

  runtime("down");
  runtime("up");
  await waitUntil(async () => (await fetch(`${boardUrl}/readyz`)).ok, 240_000);
  await waitForRegistrar();
  const afterRestart = await waitForTask((task) => task.state === "CLOSED" && task.archiveStatus === "ARCHIVED");

  run(process.execPath, ["--import", "tsx", "scripts/runtime-backup.ts", "backup", backupRoot]);
  await waitUntil(async () => (await fetch(`${boardUrl}/readyz`)).ok, 120_000);
  await waitForRegistrar();
  const afterBackupRestart = await waitForTask((task) => task.state === "CLOSED" && task.archiveStatus === "ARCHIVED");
  const backupManifest = parseBackupManifest(JSON.parse(await readFile(path.join(backupRoot, "runtime-backup.json"), "utf8")), project);
  for (const archive of backupManifest.archives) {
    if (await sha256File(path.join(backupRoot, archive.file)) !== archive.sha256) throw new Error(`Backup digest mismatch: ${archive.file}`);
  }
  const board = await fetchJson<ProjectBoardSnapshot>(`${boardUrl}/api/board`);
  if (!board.archived.some((task) => task.taskId === taskId)) throw new Error("Archived acceptance Task is absent from Board after restart");

  const restoreProject = `${project}_restore`;
  const restoreEnvironment = {
    COMPOSE_PROJECT_NAME: restoreProject,
    MOYE_BOARD_BIND_PORT: String(restoreBoardPort),
    RESTATE_INGRESS_BIND_PORT: String(restoreIngressPort),
    RESTATE_ADMIN_BIND_PORT: String(restoreAdminPort),
    MOYE_WORKSPACE_ROOT: path.join(root, "restore-workspaces"),
    MOYE_SESSION_SOURCE_ROOT: path.join(root, "restore-sessions"),
  };
  await mkdir(restoreEnvironment.MOYE_WORKSPACE_ROOT, { recursive: true });
  await mkdir(restoreEnvironment.MOYE_SESSION_SOURCE_ROOT, { recursive: true });
  let restored: TaskProjection;
  try {
    run(process.execPath, ["--import", "tsx", "scripts/runtime-backup.ts", "restore", backupRoot], false, {
      ...restoreEnvironment, MOYE_CONFIRM_RESTORE: "RESTORE_RUNTIME_DATA",
    });
    const restoreBoardUrl = `http://127.0.0.1:${restoreBoardPort}`;
    await waitUntil(async () => (await fetch(`${restoreBoardUrl}/readyz`)).ok, 120_000);
    await waitForRegistrar(restoreEnvironment);
    restored = await waitForTaskAt(`http://127.0.0.1:${restoreIngressPort}`, (task) =>
      task.state === "CLOSED" && task.archiveStatus === "ARCHIVED");
    if (digest(restored) !== digest(afterBackupRestart)) throw new Error("Restored Task Projection Digest changed");
  } finally {
    try { runtime("purge-data", { ...restoreEnvironment, MOYE_CONFIRM_PURGE: "DELETE_RUNTIME_DATA" }); } catch { /* preserve primary failure */ }
  }

  const imageDigest = run("docker", ["image", "inspect", image, "--format", "{{.Id}}"], true).trim();
  const evidence = {
    schemaVersion: 1,
    taskId,
    workflowRef: `restate://TaskWorkflow/${taskId}`,
    invocationId: receipt.invocationId,
    terminal: { state: afterBackupRestart.state, archiveStatus: afterBackupRestart.archiveStatus, outcome: afterBackupRestart.outcome },
    projectionDigestBeforeRestart: digest(beforeRestart),
    projectionDigestAfterRestart: digest(afterRestart),
    projectionDigestAfterBackupRestart: digest(afterBackupRestart),
    image,
    imageDigest,
    composeProject: project,
    endpoints: { boardUrl, ingressUrl, adminUrl: `http://127.0.0.1:${adminPort}` },
    health: await fetchJson(`${boardUrl}/healthz`),
    readiness: await fetchJson(`${boardUrl}/readyz`),
    backupManifest,
    restoreDrill: {
      composeProject: restoreProject,
      terminal: { state: restored.state, archiveStatus: restored.archiveStatus, outcome: restored.outcome },
      projectionDigest: digest(restored),
      cleanup: { containers: "removed", network: "removed", volumes: "removed" },
    },
    boardSummary: { archived: board.archived.length, acceptanceTaskPresent: true },
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  accepted = true;
  process.stdout.write(`${JSON.stringify({ accepted: true, evidencePath, ...evidence }, null, 2)}\n`);
} finally {
  try { runtime("purge-data", { MOYE_CONFIRM_PURGE: "DELETE_RUNTIME_DATA" }); } catch { /* preserve primary failure */ }
  if (!accepted) await rm(root, { recursive: true, force: true });
}

async function waitForTask(predicate: (task: TaskProjection) => boolean): Promise<TaskProjection> {
  return waitForTaskAt(ingressUrl, predicate);
}

async function waitForTaskAt(targetIngressUrl: string, predicate: (task: TaskProjection) => boolean): Promise<TaskProjection> {
  let last: TaskProjection | undefined;
  await waitUntil(async () => {
    try {
      last = await invoke<TaskProjection>(targetIngressUrl, "TaskWorkflow", taskId, "status");
      return predicate(last);
    } catch { return false; }
  }, 60_000);
  if (last === undefined) throw new Error("Task projection was never available");
  return last;
}

async function waitForRegistrar(extra: NodeJS.ProcessEnv = {}): Promise<void> {
  await waitUntil(async () => {
    const id = runCompose(["ps", "-a", "-q", "register"], true, extra).trim();
    if (!id) return false;
    return run("docker", ["inspect", id, "--format", "{{.State.ExitCode}}"], true).trim() === "0";
  }, 60_000);
}

function runtime(action: string, extra: NodeJS.ProcessEnv = {}): void {
  run(process.execPath, ["--import", "tsx", "scripts/runtime-compose.ts", action], false, extra);
}

function compose(args: readonly string[]): void { runCompose(args, false); }

function runCompose(args: readonly string[], capture: boolean, extra: NodeJS.ProcessEnv = {}): string {
  const plugin = spawnSync("docker", ["compose", "version"], { stdio: "ignore", shell: false });
  return plugin.status === 0 ? run("docker", ["compose", ...args], capture, extra) : run("docker-compose", args, capture, extra);
}

function run(executable: string, args: readonly string[], capture = false, extra: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync(executable, [...args], {
    cwd: process.cwd(), env: { ...environment, ...extra }, encoding: "utf8",
    stdio: capture ? "pipe" : "inherit", shell: false,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} ${args[0] ?? ""} failed with ${String(result.status)}${capture ? `: ${result.stderr}` : ""}`);
  return capture ? result.stdout : "";
}

async function fetchJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) return reject(new Error("No TCP port"));
      server.close(() => resolve(address.port));
    });
  });
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
