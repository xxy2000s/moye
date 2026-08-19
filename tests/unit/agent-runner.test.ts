import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertTrustedAgentResult,
  createAgentRunRequest,
  FakeAgentRunner,
  parseAgentRunRequest,
  parseAgentRunResult,
  reconcileAgentRun,
} from "../../src/agent/runner.js";
import type { AgentRunRequest, AgentRunResult } from "../../src/agent/runner.js";
import {
  CodexExecAgentRunner,
  createCodexExecInvocation,
  SpawnAgentProcessRunner,
} from "../../src/agent/codex-exec.js";
import type { AgentProcessInvocation, AgentProcessRunner } from "../../src/agent/codex-exec.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("agent runner", () => {
  it("creates a deterministic path-safe request and requires an external Expected Run ID", async () => {
    const fixture = await createFixture();
    const first = await requestFor(fixture, "FAKE");
    const second = await requestFor(fixture, "FAKE");
    expect(first.runId).toBe(second.runId);
    expect(first.artifactPath).toBe(path.join(first.artifactRoot, `run-${first.runId.split(":").at(-1)}`));
    expect(Object.isFrozen(first)).toBe(true);
    expect((await parseAgentRunRequest(JSON.parse(JSON.stringify(first)), first.runId)).runId).toBe(first.runId);
    await expect(parseAgentRunRequest(JSON.parse(JSON.stringify(first)), "wrong-id")).rejects.toThrow(/Expected Run ID/);
    const tampered = JSON.parse(JSON.stringify(first)) as Record<string, unknown>;
    tampered["promptDigest"] = `sha256:${"0".repeat(64)}`;
    await expect(parseAgentRunRequest(tampered, first.runId)).rejects.toThrow(/canonical input/);
    await expect(new FakeAgentRunner(successScript()).run({ ...first })).rejects.toThrow(/must be created or parsed/);

    await mkdir(path.join(fixture.repositoryRoot, "nested"));
    await expect(createAgentRunRequest({ ...requestInput(fixture, "FAKE"), workspaceRoot: path.join(fixture.repositoryRoot, "nested") }))
      .rejects.toThrow(/Git top-level/);
    await expect(createAgentRunRequest({ ...requestInput(fixture, "FAKE"), artifactRoot: path.join(fixture.repositoryRoot, ".git", "agent") }))
      .rejects.toThrow(/Git metadata/);
    await expect(createAgentRunRequest({ ...requestInput(fixture, "FAKE"), artifactRoot: path.parse(fixture.root).root }))
      .rejects.toThrow(/Filesystem root/);
    const outside = path.join(fixture.root, "outside");
    const link = path.join(fixture.root, "artifact-link");
    await mkdir(outside);
    await symlink(outside, link, "dir");
    await expect(createAgentRunRequest({ ...requestInput(fixture, "FAKE"), artifactRoot: link }))
      .rejects.toThrow(/symbolic link/);
    await expect(createAgentRunRequest({ ...requestInput(fixture, "FAKE"), stepId: "VERIFY" }))
      .rejects.toThrow(/IMPLEMENT/);
  });

  it("persists Fake JSONL, Session, final message, stderr and a tamper-evident manifest", async () => {
    const fixture = await createFixture();
    const request = await requestFor(fixture, "FAKE");
    const runner = new FakeAgentRunner(successScript());
    const first = await runner.run(request);
    const second = await runner.run(request);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      runnerKind: "FAKE",
      sessionId: "session-fixture-1",
      outcome: "SUCCEEDED",
      exitCode: 0,
      durationMs: 1250,
      finalMessage: "implemented fixture",
    });
    expect(first.runDigest).toMatch(/^agent-result:sha256:[0-9a-f]{64}$/);
    expect(await readFile(path.join(request.artifactPath, "events.jsonl"), "utf8")).toContain("thread.started");
    expect(await readFile(path.join(request.artifactPath, "stderr.log"), "utf8")).toBe("fake progress\n");
    expect(await readFile(path.join(request.artifactPath, "final-message.txt"), "utf8")).toBe("implemented fixture");
    const manifest = JSON.parse(await readFile(path.join(request.artifactPath, "manifest.json"), "utf8")) as unknown;
    const restored = await parseAgentRunResult(manifest, request, first.runDigest);
    assertTrustedAgentResult(restored);
    expect(() => assertTrustedAgentResult({ ...restored })).toThrow(/persisted or parsed/);

    const eventsPath = path.join(request.artifactPath, "events.jsonl");
    await writeFile(eventsPath, "tampered\n");
    await expect(reconcileAgentRun(request)).rejects.toThrow(/does not match the Agent manifest/);
  });

  it("records non-zero and turn.failed executions as FAILED without hiding logs", async () => {
    const fixture = await createFixture();
    const request = await requestFor(fixture, "FAKE", "failure case");
    const result = await new FakeAgentRunner({
      events: [
        { type: "thread.started", thread_id: "session-failed" },
        { type: "item.completed", item: { type: "agent_message", text: "could not finish" } },
        { type: "turn.failed", error: { message: "tool failed" } },
      ],
      stderr: "tool failed\n",
      exitCode: 7,
      startedAt: "2026-08-20T00:00:00.000Z",
      durationMs: 50,
    }).run(request);
    expect(result).toMatchObject({ outcome: "FAILED", exitCode: 7, sessionId: "session-failed" });
    expect(await readFile(path.join(request.artifactPath, "stderr.log"), "utf8")).toBe("tool failed\n");
  });

  it("keeps malformed JSONL as INVALID_OUTPUT evidence", async () => {
    const fixture = await createFixture();
    const request = await requestFor(fixture, "CODEX_EXEC", "malformed output");
    const times = [new Date("2026-08-20T00:00:00.000Z"), new Date("2026-08-20T00:00:00.010Z")];
    const processRunner: AgentProcessRunner = {
      async run() { return { stdout: "not-json\n", stderr: "bad stream\n", exitCode: 0, signal: null }; },
    };
    const result = await new CodexExecAgentRunner({ processRunner, now: () => times.shift()! }).run(request);
    expect(result.outcome).toBe("INVALID_OUTPUT");
    expect(result.parserError).toContain("invalid JSON");
    expect(await readFile(path.join(request.artifactPath, "events.jsonl"), "utf8")).toBe("not-json\n");

    const wrongOrder = await requestFor(fixture, "FAKE", "wrong event order");
    const wrongOrderResult = await new FakeAgentRunner({
      events: [
        { type: "turn.started" },
        { type: "thread.started", thread_id: "late-session" },
        { type: "item.completed", item: { type: "agent_message", text: "late" } },
        { type: "turn.completed" },
      ],
      exitCode: 0,
      startedAt: "2026-08-20T00:00:00.000Z",
      durationMs: 1,
    }).run(wrongOrder);
    expect(wrongOrderResult).toMatchObject({ outcome: "INVALID_OUTPUT", parserError: expect.stringContaining("must start") });

    const noMessage = await requestFor(fixture, "FAKE", "missing final message");
    const noMessageResult = await new FakeAgentRunner({
      events: [{ type: "thread.started", thread_id: "no-message" }, { type: "turn.completed" }],
      exitCode: 0,
      startedAt: "2026-08-20T00:00:00.000Z",
      durationMs: 1,
    }).run(noMessage);
    expect(noMessageResult).toMatchObject({ outcome: "INVALID_OUTPUT", parserError: expect.stringContaining("agent_message") });
  });

  it("reconciles a pending manifest but rejects an unknowable partial bundle", async () => {
    const fixture = await createFixture();
    const request = await requestFor(fixture, "FAKE", "pending manifest");
    const result = await new FakeAgentRunner(successScript()).run(request);
    const manifest = path.join(request.artifactPath, "manifest.json");
    await rename(manifest, `${manifest}.pending`);
    expect((await reconcileAgentRun(request))?.runDigest).toBe(result.runDigest);
    expect(await readFile(manifest, "utf8")).toContain(result.runDigest);

    const partial = await requestFor(fixture, "FAKE", "partial bundle");
    await mkdir(partial.artifactPath, { recursive: true });
    await writeFile(path.join(partial.artifactPath, "events.jsonl"), "partial");
    await expect(new FakeAgentRunner(successScript()).run(partial)).rejects.toThrow(/without a complete manifest/);
  });

  it("builds the documented Codex argv without a shell and captures a controlled adapter result", async () => {
    const fixture = await createFixture();
    const prompt = "edit fixture; $(do-not-run)";
    const request = await requestFor(fixture, "CODEX_EXEC", prompt);
    const invocations: AgentProcessInvocation[] = [];
    const processRunner: AgentProcessRunner = {
      async run(invocation) {
        invocations.push(invocation);
        return {
          stdout: jsonl(successEvents("session-codex", "codex finished")),
          stderr: "codex progress\n",
          exitCode: 0,
          signal: null,
        };
      },
    };
    const times = [new Date("2026-08-20T01:00:00.000Z"), new Date("2026-08-20T01:00:02.000Z")];
    const result = await new CodexExecAgentRunner({ executable: "/usr/local/bin/codex", processRunner, now: () => times.shift()! })
      .run(request);
    expect(result).toMatchObject({ outcome: "SUCCEEDED", runnerKind: "CODEX_EXEC", sessionId: "session-codex", durationMs: 2000 });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toEqual(createCodexExecInvocation("/usr/local/bin/codex", request));
    expect(invocations[0]).toMatchObject({ cwd: request.workspaceRoot, shell: false });
    expect(invocations[0]?.argv).toEqual([
      "exec", "--json", "--sandbox", "workspace-write", "--cd", request.workspaceRoot, prompt,
    ]);
    expect(invocations[0]?.argv).not.toContain("--skip-git-repo-check");
  });

  it("does not launch Codex again when a prior Run ID has an unknown result", async () => {
    const fixture = await createFixture();
    const request = await requestFor(fixture, "CODEX_EXEC", "unknown result fixture");
    let processCalls = 0;
    const processRunner: AgentProcessRunner = {
      async run() {
        processCalls += 1;
        return { stdout: jsonl(successEvents("session-unknown", "may have committed")), stderr: "", exitCode: 0, signal: null };
      },
    };
    let clockCalls = 0;
    const first = new CodexExecAgentRunner({
      processRunner,
      now: () => {
        clockCalls += 1;
        if (clockCalls === 2) throw new Error("simulated worker loss before persist");
        return new Date("2026-08-20T01:00:00.000Z");
      },
    });
    await expect(first.run(request)).rejects.toThrow(/simulated worker loss/);
    await expect(new CodexExecAgentRunner({ processRunner }).run(request)).rejects.toMatchObject({
      code: "AGENT_RESULT_UNKNOWN",
      category: "UNKNOWN_SIDE_EFFECT",
    });
    expect(processCalls).toBe(1);
    expect(await readFile(path.join(request.artifactPath, "result-unknown.json"), "utf8")).toContain(request.runId);
  });

  it("executes a controlled child process with argv and shell=false", async () => {
    const fixture = await createFixture();
    const runner = new SpawnAgentProcessRunner({ timeoutMs: 10_000, maxOutputBytes: 4096 });
    const result = await runner.run({
      executable: process.execPath,
      argv: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", "literal;$(safe)"],
      cwd: fixture.repositoryRoot,
      shell: false,
    });
    expect(result).toMatchObject({ exitCode: 0, signal: null, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual(["literal;$(safe)"]);
  });
});

interface Fixture {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly artifactRoot: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-agent-runner-"));
  temporaryRoots.push(root);
  const repositoryRoot = path.join(root, "repository");
  const artifactRoot = path.join(root, "artifacts");
  await mkdir(repositoryRoot);
  git(repositoryRoot, "init", "-b", "master");
  git(repositoryRoot, "config", "user.name", "Moye Test");
  git(repositoryRoot, "config", "user.email", "moye@example.test");
  await writeFile(path.join(repositoryRoot, "README.md"), "fixture\n");
  git(repositoryRoot, "add", "README.md");
  git(repositoryRoot, "commit", "-m", "base");
  return { root, repositoryRoot, artifactRoot };
}

function requestInput(
  fixture: Fixture,
  runnerKind: AgentRunResult["runnerKind"],
  prompt = "implement fixture",
) {
  return {
    taskId: "TASK-0005",
    specRevision: 1,
    stepId: "IMPLEMENT" as const,
    attemptId: "TASK-0005/IMPLEMENT/attempt-001",
    runnerKind,
    workspaceRoot: fixture.repositoryRoot,
    artifactRoot: fixture.artifactRoot,
    prompt,
  };
}

function requestFor(
  fixture: Fixture,
  runnerKind: AgentRunResult["runnerKind"],
  prompt = "implement fixture",
): Promise<AgentRunRequest> {
  return createAgentRunRequest(requestInput(fixture, runnerKind, prompt));
}

function successScript() {
  return {
    events: successEvents("session-fixture-1", "implemented fixture"),
    stderr: "fake progress\n",
    exitCode: 0,
    startedAt: "2026-08-20T00:00:00.000Z",
    durationMs: 1250,
  } as const;
}

function successEvents(sessionId: string, finalMessage: string) {
  return [
    { type: "thread.started", thread_id: sessionId },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "message-1", type: "agent_message", text: finalMessage } },
    { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 3 } },
  ];
}

function jsonl(events: readonly unknown[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function git(cwd: string, ...argv: string[]): string {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
