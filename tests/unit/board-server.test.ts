import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { enrichBoardSnapshot, readAgentEventPage, resolveAgentArtifactFile, startBoardServer } from "../../src/board/server.js";
import { buildBoardSnapshot } from "../../src/domain/board.js";
import { createTaskProjection } from "../../src/domain/task.js";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("board static server", () => {
  it("keeps the Core v2 audit UI focused on runtime facts without hiding the legal definition", async () => {
    const [script, styles] = await Promise.all([
      readFile(new URL("../../public/app.js", import.meta.url), "utf8"),
      readFile(new URL("../../public/styles.css", import.meta.url), "utf8"),
    ]);

    expect(script).toContain('filter: "ACTUAL"');
    expect(script).toContain('if (initialRoute.kind === "task") void applyRoute().finally(loadBoard)');
    expect(script).toContain("const snapshot = board || latestBoardSnapshot");
    expect(script).toContain("CORE_V2_MACHINE_GRAPH_SIZE");
    expect(script).toContain("ARCHIVE_PENDING: [1260, 350]");
    expect(script).toContain("Workflow 状态事实");
    expect(script).toContain("本次节点路径");
    expect(script).toContain("renderMachineSystemOwner");
    expect(script).toContain("查看原始 detail");
    expect(styles).toContain(".machine-graph-node.is-filter-muted");
    expect(styles).toContain(".machine-node-route-proof");
    expect(styles).toContain(".domain-event-raw");
  });

  it("serves files inside publicRoot but rejects a symlink to an outside file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-board-static-"));
    roots.push(root);
    const publicRoot = path.join(root, "public");
    const outside = path.join(root, "secret.txt");
    await mkdir(publicRoot);
    await writeFile(path.join(publicRoot, "index.html"), "safe\n");
    await writeFile(outside, "secret\n");
    await symlink(outside, path.join(publicRoot, "leak.txt"));
    const { server, origin } = await start(publicRoot);
    servers.push(server);

    const index = await fetch(origin);
    expect(index.status).toBe(200);
    expect(await index.text()).toBe("safe\n");
    const leak = await fetch(`${origin}/leak.txt`);
    expect(leak.status).toBe(404);
    expect(await leak.text()).not.toContain("secret");
  });

  it("returns a controlled 400 for malformed Task ID encoding", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-board-uri-"));
    roots.push(root);
    const publicRoot = path.join(root, "public");
    await mkdir(publicRoot);
    await writeFile(path.join(publicRoot, "index.html"), "safe\n");
    const { server, origin } = await start(publicRoot);
    servers.push(server);

    const response = await fetch(`${origin}/api/tasks/%E0%A4%A`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Malformed Task ID encoding" });
    const escapedSeparator = await fetch(`${origin}/api/tasks/TASK-OK%2FTRACE`);
    expect(escapedSeparator.status).toBe(400);
    expect(await escapedSeparator.json()).toEqual({ error: "Invalid Task ID" });
  });

  it("resolves only allowlisted, digest-matched Agent artifacts inside configured roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-board-artifact-"));
    roots.push(root);
    const artifactRoot = path.join(root, "artifacts");
    const token = "a".repeat(64);
    const runId = `agent-run:sha256:${token}`;
    const runRoot = path.join(artifactRoot, "agent", `run-${token}`);
    await mkdir(runRoot, { recursive: true });
    const content = Buffer.from('{"type":"thread.started"}\n');
    await writeFile(path.join(runRoot, "events.jsonl"), content);
    const artifact = {
      artifactRef: `agent-artifact://${runId}/events.jsonl`,
      contentDigest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      bytes: content.byteLength,
    };

    await expect(resolveAgentArtifactFile([root], artifactRoot, runId, "agent-events", artifact))
      .resolves.toBe(await realpath(path.join(runRoot, "events.jsonl")));
    await expect(resolveAgentArtifactFile([root], artifactRoot, runId, "agent-events", { ...artifact, bytes: artifact.bytes + 1 }))
      .rejects.toThrow(/size mismatch/);

    const outside = path.join(root, "outside.jsonl");
    await writeFile(outside, content);
    await rm(path.join(runRoot, "events.jsonl"));
    await symlink(outside, path.join(runRoot, "events.jsonl"));
    await expect(resolveAgentArtifactFile([root], artifactRoot, runId, "agent-events", artifact))
      .rejects.toThrow(/escaped/);
  });

  it("pages and classifies a growing Agent Event stream without accepting a URL path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-board-live-events-"));
    roots.push(root);
    const artifactRoot = path.join(root, "artifacts");
    const token = "b".repeat(64);
    const runId = `agent-run:sha256:${token}`;
    const runRoot = path.join(artifactRoot, "agent", `run-${token}`);
    await mkdir(runRoot, { recursive: true });
    const locator = {
      runId,
      runnerKind: "CODEX_EXEC" as const,
      taskId: "TASK-LIVE-001",
      specRevision: 1,
      stepId: "IMPLEMENT" as const,
      attemptId: "TASK-LIVE-001/IMPLEMENT/attempt-001",
      eventsArtifactRef: `agent-artifact://${runId}/events.jsonl`,
    };
    await writeFile(path.join(runRoot, "execution-intent.json"), `${JSON.stringify({
      schemaVersion: 1,
      runId,
      taskId: locator.taskId,
      specRevision: locator.specRevision,
      attemptId: locator.attemptId,
      runnerKind: locator.runnerKind,
    })}\n`);
    await writeFile(path.join(runRoot, "events.jsonl"), [
      { type: "thread.started", thread_id: "live-session" },
      { type: "item.started", item: { type: "command_execution", command: "git status" } },
      { type: "item.completed", item: { type: "command_execution", exit_code: 0 } },
      { type: "item.completed", item: { type: "error", message: "hook failed" } },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n");

    const first = await readAgentEventPage({
      artifactRoots: [root], declaredArtifactRoot: artifactRoot, locator, cursor: 0, limit: 2,
    });
    expect(first).toMatchObject({ cursor: 0, nextCursor: 2, total: 4, hasMore: true, completed: false });
    expect(first.events.map((event) => event.category)).toEqual(["system", "tool"]);
    const second = await readAgentEventPage({
      artifactRoots: [root], declaredArtifactRoot: artifactRoot, locator, cursor: first.nextCursor, limit: 2,
    });
    expect(second).toMatchObject({ nextCursor: 4, total: 4, hasMore: false, completed: false });
    expect(second.events[0]).toMatchObject({ sequence: 3, category: "tool_result" });
    expect(second.events[1]).toMatchObject({ sequence: 4, category: "error" });

    await writeFile(path.join(runRoot, "execution-intent.json"), `${JSON.stringify({ taskId: "TASK-OTHER" })}\n`);
    await expect(readAgentEventPage({
      artifactRoots: [root], declaredArtifactRoot: artifactRoot, locator, cursor: 0, limit: 2,
    })).rejects.toThrow(/does not match/);
  });

  it("enriches legacy Board rows from TaskAuthority without mutating the source snapshot", async () => {
    const task = createTaskProjection({
      taskId: "TASK-LIVE-BOARD-1",
      projectId: "moye",
      title: "Historical acceptance",
      specRevision: 1,
      backlogRefs: [],
    }, "2026-08-23T00:00:00.000Z");
    const snapshot = buildBoardSnapshot("moye", { [task.taskId]: task }, {}, "2026-08-23T00:01:00.000Z");
    const enriched = await enrichBoardSnapshot(snapshot, async () => ({ owner: "CORE_V2_WORKFLOW", specRevision: 1 }));

    expect(snapshot.active[0]?.workflowKind).toBe("UNKNOWN");
    expect(enriched.active[0]).toMatchObject({
      workflowKind: "CORE_V2",
      historyKind: "PRODUCT_ACCEPTANCE",
      runtimeState: "RECEIVED",
    });
  });
});

async function start(publicRoot: string): Promise<{ server: Server; origin: string }> {
  const server = startBoardServer({
    port: 0,
    projectId: "test",
    ingressUrl: "http://127.0.0.1:1",
    restateAdminUrl: "http://127.0.0.1:2",
    publicRoot,
  });
  await once(server, "listening");
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("Board did not bind a TCP port");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}
