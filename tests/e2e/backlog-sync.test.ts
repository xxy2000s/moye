import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadBacklogSyncBatch } from "../../src/backlog/document-sync.js";
import { backlogBatchId } from "../../src/domain/backlog.js";
import type { BacklogProjection, BacklogSyncResult } from "../../src/domain/backlog.js";
import type { ProjectBoardSnapshot } from "../../src/domain/board.js";
import { invoke } from "../../src/restate/ingress.js";

const root = process.cwd();
const containerName = `moye-restate-backlog-e2e-${process.pid}`;
let ingressPort = 0;
let adminPort = 0;
let servicePort = 0;
let boardPort = 0;
let service: ChildProcess | undefined;
let logs = "";

describe("Backlog document to ProjectBoard sync", () => {
  beforeAll(async () => {
    [ingressPort, adminPort, servicePort, boardPort] = await Promise.all([
      freePort(), freePort(), freePort(), freePort(),
    ]);
    docker([
      "run", "--rm", "-d", "--name", containerName,
      "-p", `127.0.0.1:${ingressPort}:8080`,
      "-p", `127.0.0.1:${adminPort}:9070`,
      "docker.restate.dev/restatedev/restate:1.7.4",
    ]);
    await waitUntil(async () => (await fetch(`${adminUrl()}/health`)).ok, 20_000);
    service = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: root,
      env: {
        ...process.env,
        RESTATE_SERVICE_PORT: String(servicePort),
        MOYE_BOARD_PORT: String(boardPort),
        RESTATE_INGRESS_URL: ingressUrl(),
        MOYE_PROJECT_ID: "moye-backlog-e2e",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    service.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    service.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    await waitUntil(async () => canConnect(servicePort), 10_000);
    const registration = await fetch(`${adminUrl()}/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uri: `http://host.docker.internal:${servicePort}` }),
    });
    if (!registration.ok) throw new Error(`Discovery failed: ${await registration.text()}`);
  }, 40_000);

  afterAll(() => {
    service?.kill("SIGTERM");
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  });

  it("atomically syncs documents, preserves runtime-only data, and stays idempotent", async () => {
    const runtimeOnly: BacklogProjection = {
      backlogId: "BL-RUNTIME-ONLY",
      title: "Runtime only",
      kind: "INVESTIGATION",
      status: "CAPTURED",
      priority: "LOW",
      sourceRefs: ["e2e"],
      taskRefs: [],
      updatedAt: "2026-08-20T00:00:00.000Z",
    };
    await invoke<void>(ingressUrl(), "ProjectBoard", "moye-backlog-e2e", "upsertBacklog", runtimeOnly);
    const batch = await loadBacklogSyncBatch("docs/delivery/backlog", root);

    const cli = spawnSync(process.execPath, [
      "--import", "tsx", "src/cli/index.ts", "backlog", "sync",
      "--dir", "docs/delivery/backlog", "--project", "moye-backlog-e2e",
    ], {
      cwd: root,
      env: { ...process.env, RESTATE_INGRESS_URL: ingressUrl() },
      encoding: "utf8",
    });
    if (cli.status !== 0) throw new Error(`CLI sync failed: ${cli.stderr}`);
    const first = JSON.parse(cli.stdout) as BacklogSyncResult;
    const second = await invoke<BacklogSyncResult>(
      ingressUrl(), "ProjectBoard", "moye-backlog-e2e", "syncBacklog", batch,
    );
    const boardResponse = await fetch(`http://127.0.0.1:${boardPort}/api/board`);
    expect(boardResponse.ok).toBe(true);
    const board = await boardResponse.json() as ProjectBoardSnapshot;

    expect(first.changed).toBe(true);
    expect(first).toMatchObject({ received: batch.items.length, inserted: batch.items.length });
    expect(first.preservedIds).toContain("BL-RUNTIME-ONLY");
    expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: batch.items.length, changed: false });
    const visible = board.backlog.map((item) => item.backlogId);
    const expectedVisible = batch.items
      .filter((item) => item.status !== "CONVERTED_TO_TASK")
      .map((item) => item.backlogId);
    const converted = batch.items
      .filter((item) => item.status === "CONVERTED_TO_TASK")
      .map((item) => item.backlogId);
    expect(visible).toEqual(expect.arrayContaining([...expectedVisible, "BL-RUNTIME-ONLY"]));
    for (const backlogId of converted) expect(visible).not.toContain(backlogId);

    const beforeInvalid = await invoke<ProjectBoardSnapshot>(
      ingressUrl(), "ProjectBoard", "moye-backlog-e2e", "get",
    );
    await expect(invoke<BacklogSyncResult>(
      ingressUrl(), "ProjectBoard", "moye-backlog-e2e", "syncBacklog",
      {
        ...batch,
        batchId: backlogBatchId([batch.items[0]!, batch.items[0]!], "PRESERVE"),
        items: [batch.items[0], batch.items[0]],
      },
    )).rejects.toThrow(/Duplicate backlog id/);
    const afterInvalid = await invoke<ProjectBoardSnapshot>(
      ingressUrl(), "ProjectBoard", "moye-backlog-e2e", "get",
    );
    expect(afterInvalid.backlog).toEqual(beforeInvalid.backlog);
  }, 30_000);
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("No port"));
      server.close(() => resolve(address.port));
    });
  });
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms\n${logs}`);
}

function docker(args: readonly string[]): void {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed: ${result.stderr}`);
}

function ingressUrl(): string { return `http://127.0.0.1:${ingressPort}`; }
function adminUrl(): string { return `http://127.0.0.1:${adminPort}`; }
