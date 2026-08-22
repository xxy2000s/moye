import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CliLiveRoleRunner, prepareLiveRoleRequest } from "../../src/agent/live-role.js";
import type { AgentProcessRunner } from "../../src/agent/codex-exec.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("live role runner", () => {
  it("persists and reuses a real CLI session manifest and raw event stream", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-live-role-"));
    roots.push(root);
    const scopeRoot = path.join(root, "scope");
    const artifactRoot = path.join(root, "artifacts");
    await Promise.all([mkdir(scopeRoot), mkdir(artifactRoot)]);
    let calls = 0;
    let streamedPath = "";
    const processRunner: AgentProcessRunner = {
      async run(invocation, observer) {
        calls += 1;
        expect(invocation).toMatchObject({ executable: "codex", cwd: await realpath(scopeRoot), shell: false });
        const message = JSON.stringify({
          verdict: "PASSED",
          summary: "context is actionable",
          findings: [],
          revisedAcceptanceCriteria: [],
        });
        const lines = [
          JSON.stringify({ type: "thread.started", thread_id: "session-context-real" }),
            JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: message } }),
            JSON.stringify({ type: "turn.completed" }),
        ];
        await observer?.onStdoutChunk?.(`${lines[0]}\n`);
        expect(await readFile(streamedPath, "utf8")).toBe(`${lines[0]}\n`);
        await observer?.onStdoutChunk?.(`${lines.slice(1).join("\n")}\n`);
        return {
          stdout: `${lines.join("\n")}\n`,
          stderr: "",
          exitCode: 0,
          signal: null,
        };
      },
    };
    const runner = new CliLiveRoleRunner({ processRunner });
    const request = {
      taskId: "TASK-LIVE-ROLE-UNIT",
      specRevision: 1,
      kind: "CONTEXT" as const,
      attempt: 1,
      runnerKind: "CODEX_EXEC" as const,
      scopeRoot,
      artifactRoot,
      instructions: "Inspect the repository and validate the task envelope.",
    };
    const prepared = await prepareLiveRoleRequest(request);
    expect((await prepareLiveRoleRequest(prepared)).runId).toBe(prepared.runId);
    streamedPath = path.join(artifactRoot, `run-${prepared.runId.slice(-64)}`, "events.jsonl");

    const first = await runner.run(request);
    const replayed = await runner.run(request);

    expect(first).toMatchObject({
      outcome: "SUCCEEDED", verdict: "PASSED", sessionId: "session-context-real", summary: "context is actionable",
    });
    expect(replayed).toEqual(first);
    expect(calls).toBe(1);
    expect(first.eventsContentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.manifestArtifactRef).toContain(first.runId);
  });
});
