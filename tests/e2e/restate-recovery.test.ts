import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ProjectBoardSnapshot } from "../../src/domain/board.js";
import type { TaskProjection } from "../../src/domain/task.js";
import { invoke, send } from "../../src/restate/ingress.js";
import type { TaskWorkflowInput } from "../../src/restate/services.js";

const root = process.cwd();
const containerName = `moye-restate-e2e-${process.pid}`;
let restateIngressPort = 0;
let restateAdminPort = 0;
let servicePort = 0;
let boardPort = 0;
let service: ChildProcess | undefined;
let serviceLogs = "";

describe("Restate process-loss recovery", () => {
  beforeAll(async () => {
    [restateIngressPort, restateAdminPort, servicePort, boardPort] = await Promise.all([
      freePort(), freePort(), freePort(), freePort(),
    ]);
    docker([
      "run", "--rm", "-d", "--name", containerName,
      "-p", `127.0.0.1:${restateIngressPort}:8080`,
      "-p", `127.0.0.1:${restateAdminPort}:9070`,
      "docker.restate.dev/restatedev/restate:1.7.4",
    ]);
    await waitUntil(async () => (await fetch(adminUrl("/health"))).ok, 20_000);
    service = await startService();
    const registration = await fetch(adminUrl("/deployments"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uri: `http://host.docker.internal:${servicePort}` }),
    });
    if (!registration.ok) throw new Error(`Discovery failed: ${await registration.text()}`);
  }, 40_000);

  afterAll(async () => {
    service?.kill("SIGTERM");
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  });

  it("recovers after SIGKILL between rename and step acknowledgement", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moye-e2e-"));
    const activeTasksRoot = path.join(fixtureRoot, "tasks");
    const archiveRoot = path.join(activeTasksRoot, "archive");
    const taskId = "TASK-E2E-RECOVERY";
    const taskRoot = path.join(activeTasksRoot, taskId);
    const markerPath = path.join(fixtureRoot, "fault", "move-completed.marker");
    const counterPath = path.join(fixtureRoot, "effects", "counter.txt");
    await mkdir(taskRoot, { recursive: true });
    await writeFile(path.join(taskRoot, "spec.md"), "# recovery fixture\n");

    const input: TaskWorkflowInput = {
      taskId,
      projectId: "moye-e2e",
      title: "Recover an uncertain archive move",
      specRevision: 1,
      backlogRefs: ["BL-E2E"],
      activeTasksRoot,
      archiveRoot,
      effectCounterPath: counterPath,
      archivedAt: "2026-08-19T00:00:00.000Z",
      fault: { exitAfterMoveOnce: true, markerPath },
    };

    await send(ingressUrl(), "TaskWorkflow", taskId, "run", input);
    await waitUntil(async () => existsSync(markerPath), 20_000);
    await waitForExit(service, 10_000);

    const archivePath = path.join(archiveRoot, `2026-08-19-${taskId}`);
    expect(existsSync(taskRoot)).toBe(false);
    expect(existsSync(archivePath)).toBe(true);

    service = await startService();
    const finalTask = await waitForTask(taskId, (task) => task.archiveStatus === "ARCHIVED", 30_000);
    const board = await invoke<ProjectBoardSnapshot>(ingressUrl(), "ProjectBoard", "moye-e2e", "get");

    expect(finalTask.state).toBe("CLOSED");
    expect(finalTask.archiveStatus).toBe("ARCHIVED");
    expect(finalTask.events.filter((event) => event.type === "ArchiveArchived")).toHaveLength(1);
    expect(await readFile(counterPath, "utf8")).toBe("1\n");
    expect((await readdir(archiveRoot)).filter((name) => name.endsWith(taskId))).toEqual([
      `2026-08-19-${taskId}`,
    ]);
    expect(board.archived.map((task) => task.taskId)).toContain(taskId);
    expect(board.active).toHaveLength(0);
    expect(board.archivePending).toHaveLength(0);
    const detailResponse = await fetch(`http://127.0.0.1:${boardPort}/api/tasks/${taskId}`);
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toEqual(finalTask);
    const traceResponse = await fetch(`http://127.0.0.1:${boardPort}/api/tasks/${taskId}/trace`);
    expect(traceResponse.status).toBe(200);
    expect(await traceResponse.json()).toMatchObject({
      traceKind: "TASK",
      stateMachine: {
        authority: "derived-from-runtime-projection",
        workflow: "TaskWorkflow",
        current: { overall: "ARCHIVED", historyCurrent: "ARCHIVED", consistency: "VERIFIED" },
      },
      durableRuntime: { workflowService: "TaskWorkflow", workflowKey: taskId },
    });
  }, 70_000);

  it("exhausts a broken pipeline step, closes as terminal failure, then archives evidence", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moye-e2e-failure-"));
    const activeTasksRoot = path.join(fixtureRoot, "tasks");
    const archiveRoot = path.join(activeTasksRoot, "archive");
    const taskId = "TASK-E2E-FAILURE";
    const taskRoot = path.join(activeTasksRoot, taskId);
    const blockedParent = path.join(fixtureRoot, "not-a-directory");
    await mkdir(taskRoot, { recursive: true });
    await writeFile(path.join(taskRoot, "spec.md"), "# terminal failure fixture\n");
    await writeFile(blockedParent, "file blocks mkdir\n");

    const input: TaskWorkflowInput = {
      taskId,
      projectId: "moye-e2e",
      title: "Bound retries and archive terminal failure evidence",
      specRevision: 1,
      backlogRefs: ["BL-E2E-FAILURE"],
      activeTasksRoot,
      archiveRoot,
      effectCounterPath: path.join(blockedParent, "counter.txt"),
      archivedAt: "2026-08-19T00:00:00.000Z",
    };

    await send(ingressUrl(), "TaskWorkflow", taskId, "run", input);
    const finalTask = await waitForTask(taskId, (task) => task.archiveStatus === "ARCHIVED", 35_000);

    expect(finalTask.state).toBe("CLOSED");
    expect(finalTask.outcome).toBe("FAILED_TERMINAL");
    expect(finalTask.error).toContain("ENOTDIR");
    expect(finalTask.events.filter((event) => event.type === "TaskClosed")).toHaveLength(1);
    expect(existsSync(path.join(archiveRoot, `2026-08-19-${taskId}`))).toBe(true);
  }, 45_000);
});

async function startService(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      RESTATE_SERVICE_PORT: String(servicePort),
      MOYE_BOARD_PORT: String(boardPort),
      RESTATE_INGRESS_URL: ingressUrl(),
      MOYE_PROJECT_ID: "moye-e2e",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => { serviceLogs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { serviceLogs += chunk.toString(); });
  await waitUntil(async () => canConnect(servicePort), 10_000);
  return child;
}

async function waitForTask(
  taskId: string,
  predicate: (task: TaskProjection) => boolean,
  timeoutMs: number,
): Promise<TaskProjection> {
  let latest: TaskProjection | null = null;
  await waitUntil(async () => {
    try {
      latest = await invoke<TaskProjection | null>(ingressUrl(), "TaskWorkflow", taskId, "status");
      return latest !== null && predicate(latest);
    } catch {
      return false;
    }
  }, timeoutMs);
  if (latest === null) throw new Error("Task projection remained empty");
  return latest;
}

async function waitForExit(child: ChildProcess | undefined, timeoutMs: number): Promise<void> {
  if (child === undefined) throw new Error("Service was not started");
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Service did not exit\n${serviceLogs}`)), timeoutMs)),
  ]);
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Unable to allocate port"));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolveConnection) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolveConnection(true); });
    socket.once("error", () => resolveConnection(false));
  });
}

function docker(args: readonly string[]): void {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed: ${result.stderr}`);
}

function ingressUrl(): string {
  return `http://127.0.0.1:${restateIngressPort}`;
}

function adminUrl(pathname: string): string {
  return `http://127.0.0.1:${restateAdminPort}${pathname}`;
}
