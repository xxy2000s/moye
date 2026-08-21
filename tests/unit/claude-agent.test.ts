import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildClaudeTelemetryEnvironment,
  ClaudePrintAgentRunner,
  createClaudePrintInvocation,
  prepareClaudeRawApiDirectory,
} from "../../src/agent/claude-print.js";
import type { AgentProcessInvocation, AgentProcessRunner } from "../../src/agent/codex-exec.js";
import { createAgentRunRequest } from "../../src/agent/runner.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Claude Print Agent adapter", () => {
  it("uses print + stream-json argv and privacy-safe process-scoped telemetry", async () => {
    const request = await createRequest("review; $(never-run)");
    const telemetry = {
      enabled: true,
      endpoint: "http://127.0.0.1:6006/v1/traces",
      projectName: "moye-demo",
    } as const;
    const invocation = createClaudePrintInvocation("/usr/local/bin/claude", request, telemetry);

    expect(invocation).toMatchObject({
      executable: "/usr/local/bin/claude",
      cwd: request.workspaceRoot,
      shell: false,
      argv: ["-p", "--verbose", "--output-format", "stream-json", "--permission-mode", "acceptEdits", request.prompt],
    });
    expect(invocation.env).toMatchObject({
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_LOG_USER_PROMPTS: "0",
      OTEL_LOG_ASSISTANT_RESPONSES: "0",
      OTEL_LOG_TOOL_DETAILS: "0",
      OTEL_LOG_TOOL_CONTENT: "0",
    });
    expect(invocation.env?.["TRACEPARENT"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(invocation.env?.["OTEL_LOG_RAW_API_BODIES"]).toBeUndefined();
    expect(buildClaudeTelemetryEnvironment(request, { ...telemetry, enabled: false })).toEqual({});
  });

  it("parses Claude stream-json and only captures raw API bodies after explicit opt-in", async () => {
    const request = await createRequest("implement fixture");
    const invocations: AgentProcessInvocation[] = [];
    const processRunner: AgentProcessRunner = {
      async run(invocation) {
        invocations.push(invocation);
        const target = invocation.env?.["OTEL_LOG_RAW_API_BODIES"];
        if (target === undefined || !target.startsWith("file:")) throw new Error("raw body destination missing");
        const directory = target.slice("file:".length);
        await writeFile(path.join(directory, "request-001.json"), JSON.stringify({ model: "claude", secret: "explicit-test" }));
        return {
          stdout: jsonl([
            { type: "system", subtype: "init", session_id: "claude-session-1" },
            { type: "assistant", message: { content: [{ type: "text", text: "working" }] } },
            { type: "result", subtype: "success", is_error: false, session_id: "claude-session-1", result: "implemented" },
          ]),
          stderr: "claude progress\n",
          exitCode: 0,
          signal: null,
        };
      },
    };
    const times = [new Date("2026-08-21T01:00:00.000Z"), new Date("2026-08-21T01:00:02.000Z")];
    const result = await new ClaudePrintAgentRunner({
      executable: "claude",
      processRunner,
      now: () => times.shift()!,
      telemetry: {
        enabled: true,
        endpoint: "http://127.0.0.1:6006/v1/traces",
        captureUserPrompts: true,
        captureAssistantResponses: true,
        captureToolDetails: true,
        captureToolContent: true,
        captureRawApiBodies: true,
      },
    }).run(request);

    expect(result).toMatchObject({
      runnerKind: "CLAUDE_PRINT",
      outcome: "SUCCEEDED",
      sessionId: "claude-session-1",
      finalMessage: "implemented",
      durationMs: 2000,
    });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.env).toMatchObject({
      OTEL_LOG_USER_PROMPTS: "1",
      OTEL_LOG_ASSISTANT_RESPONSES: "1",
      OTEL_LOG_TOOL_DETAILS: "1",
      OTEL_LOG_TOOL_CONTENT: "1",
    });
    expect(result.artifacts.rawModelIo?.artifactRef).toBe(`agent-artifact://${request.runId}/raw-model-io.jsonl`);
    const raw = await readFile(path.join(request.artifactPath, "raw-model-io.jsonl"), "utf8");
    expect(raw).toContain("request-001.json");
    expect(raw).toContain("explicit-test");
    expect(await readFile(path.join(request.artifactPath, "events.jsonl"), "utf8")).toContain("claude-session-1");
  });

  it("keeps a failed Claude result as evidence", async () => {
    const request = await createRequest("failure fixture");
    const processRunner: AgentProcessRunner = {
      async run() {
        return {
          stdout: jsonl([
            { type: "system", subtype: "init", session_id: "claude-failed" },
            { type: "result", subtype: "error", is_error: true, result: "tool failed" },
          ]),
          stderr: "tool failed\n",
          exitCode: 1,
          signal: null,
        };
      },
    };
    const times = [new Date("2026-08-21T01:00:00.000Z"), new Date("2026-08-21T01:00:00.010Z")];
    const result = await new ClaudePrintAgentRunner({ processRunner, now: () => times.shift()! }).run(request);
    expect(result).toMatchObject({ outcome: "FAILED", sessionId: "claude-failed", finalMessage: "tool failed", exitCode: 1 });
  });

  it("rejects a raw API destination symlink before launching Claude", async () => {
    const request = await createRequest("do not escape artifacts");
    const escaped = path.join(path.dirname(request.artifactRoot), "escaped");
    await mkdir(request.artifactPath, { recursive: true });
    await mkdir(escaped);
    await symlink(escaped, path.join(request.artifactPath, "raw-api"));

    await expect(prepareClaudeRawApiDirectory(request)).rejects.toMatchObject({
      code: "UNSAFE_RAW_API_DIRECTORY",
    });
  });
});

async function createRequest(prompt: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-claude-agent-"));
  roots.push(root);
  const repositoryRoot = path.join(root, "repository");
  await mkdir(repositoryRoot);
  git(repositoryRoot, "init", "-b", "master");
  git(repositoryRoot, "config", "user.name", "Moye Test");
  git(repositoryRoot, "config", "user.email", "moye@example.test");
  await writeFile(path.join(repositoryRoot, "README.md"), "fixture\n");
  git(repositoryRoot, "add", "README.md");
  git(repositoryRoot, "commit", "-m", "base");
  return createAgentRunRequest({
    taskId: "TASK-CLAUDE-UNIT",
    specRevision: 1,
    stepId: "IMPLEMENT",
    attemptId: "TASK-CLAUDE-UNIT/IMPLEMENT/attempt-001",
    runnerKind: "CLAUDE_PRINT",
    workspaceRoot: repositoryRoot,
    artifactRoot: path.join(root, "artifacts", "agent"),
    prompt,
  });
}

function git(cwd: string, ...argv: string[]): string {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function jsonl(events: readonly unknown[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}
