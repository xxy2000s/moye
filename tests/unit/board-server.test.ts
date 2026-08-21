import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveAgentArtifactFile, startBoardServer } from "../../src/board/server.js";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("board static server", () => {
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
