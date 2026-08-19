import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FixtureCodingAgentRunner } from "../../src/agent/fixture-coding.js";
import { CODING_WORKFLOW_STEPS, runCodingWorkflow } from "../../src/coding/workflow.js";
import { createTaskEnvelope } from "../../src/domain/coding-task.js";
import { MoyeError } from "../../src/domain/errors.js";
import { nodeGitCommandRunner } from "../../src/git/workspace-effect.js";
import type { GitCommandRunner } from "../../src/git/workspace-effect.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("coding workflow", () => {
  it("runs CONTEXT through ARCHIVE and merges one verified Fake result", async () => {
    const fixture = await createFixture();
    const projections: string[] = [];
    const result = await runCodingWorkflow(fixture.input, {
      agentRunner: fixture.runner,
      now: clock(),
      observe(projection) { projections.push(`${projection.state}:${projection.currentStep}:${projection.events.length}`); },
    });

    expect(result).toMatchObject({ state: "CLOSED", outcome: "SUCCEEDED", archiveStatus: "ARCHIVED", currentStep: "ARCHIVE" });
    expect(result.agent).toMatchObject({ outcome: "SUCCEEDED", sessionId: "session-workflow" });
    expect(result.verification).toMatchObject({ passed: true, verifiedCommit: result.checkpoint?.commitSha });
    expect(result.merge).toMatchObject({ outcome: "APPLIED" });
    expect(result.docs).toMatchObject({ disposition: "not_applicable" });
    expect(result.events.filter((event) => event.type === "STEP_STARTED").map((event) => event.step))
      .toEqual(CODING_WORKFLOW_STEPS);
    expect(result.steps.map((step) => step.stepId)).toEqual(CODING_WORKFLOW_STEPS.slice(0, 6));
    expect(result.attempts).toHaveLength(6);
    expect(result.attempts.every((attempt) => attempt.status === "SUCCEEDED" && attempt.evidenceRecords.length === 1)).toBe(true);
    expect(result.evidenceBindings).toHaveLength(6);
    expect(result.evidenceBindings.map((binding) => binding.attemptId)).toEqual(result.attempts.map((attempt) => attempt.attemptId));
    expect(new Set(result.events.map((event) => event.sequence)).size).toBe(result.events.length);
    expect(projections.length).toBeGreaterThan(result.events.length);
    const master = git(fixture.repositoryRoot, "rev-parse", "master").trim();
    expect(master).toBe(result.merge?.mergeCommit);
    expect(git(fixture.repositoryRoot, "log", "master", "--fixed-strings", "--grep", result.merge!.effectId, "--format=%H").trim())
      .toBe(master);
  });

  it("fails at VERIFY and leaves master unchanged when a command fails", async () => {
    const fixture = await createFixture(true);
    const result = await runCodingWorkflow(fixture.input, { agentRunner: fixture.runner, now: clock() });
    expect(result).toMatchObject({ state: "FAILED", outcome: "FAILED_TERMINAL", currentStep: "VERIFY" });
    expect(result.verification).toMatchObject({ passed: false, code: "COMMAND_FAILED" });
    expect(result.attempts.map(({ stepId, status }) => ({ stepId, status }))).toEqual([
      { stepId: "CONTEXT", status: "SUCCEEDED" },
      { stepId: "WORKSPACE", status: "SUCCEEDED" },
      { stepId: "IMPLEMENT", status: "SUCCEEDED" },
      { stepId: "VERIFY", status: "FAILED" },
    ]);
    expect(result.evidenceBindings).toHaveLength(3);
    expect(result.merge).toBeUndefined();
    expect(result.docs).toBeUndefined();
    expect(git(fixture.repositoryRoot, "rev-parse", "master").trim()).toBe(fixture.baseSha);
  });

  it("closes successfully when Merge completed but its acknowledgement was lost", async () => {
    const fixture = await createFixture();
    let mergeCalls = 0;
    const lostAck: GitCommandRunner = {
      async run(invocation) {
        const result = await nodeGitCommandRunner.run(invocation);
        if (invocation.argv[0] === "update-ref") {
          mergeCalls += 1;
          throw new Error("lost merge acknowledgement");
        }
        return result;
      },
    };
    const result = await runCodingWorkflow(fixture.input, {
      agentRunner: fixture.runner,
      gitRunner: lostAck,
      now: clock(),
    });
    expect(result).toMatchObject({ state: "CLOSED", archiveStatus: "ARCHIVED" });
    expect(result.merge).toMatchObject({ outcome: "ALREADY_APPLIED", reconciledAfterUnknown: true });
    expect(mergeCalls).toBe(1);
  });

  it("keeps business closure when the independent Archive effect fails", async () => {
    const fixture = await createFixture();
    const result = await runCodingWorkflow(fixture.input, {
      agentRunner: fixture.runner,
      now: clock(),
      archive: async () => { throw new Error("archive storage unavailable"); },
    });
    expect(result).toMatchObject({
      state: "CLOSED",
      outcome: "SUCCEEDED",
      archiveStatus: "FAILED",
      currentStep: "ARCHIVE",
      error: "archive storage unavailable",
    });
    expect(result.events.at(-1)).toMatchObject({ type: "ARCHIVE_FAILED", step: "ARCHIVE" });
    expect(result.merge?.mergeCommit).toBe(git(fixture.repositoryRoot, "rev-parse", "master").trim());
  });

  it("preserves an unknown Agent side effect for recovery instead of suggesting a new task", async () => {
    const fixture = await createFixture();
    const result = await runCodingWorkflow(fixture.input, {
      agentRunner: {
        async run() {
          throw unknown("AGENT_RESULT_UNKNOWN", "Agent intent exists but the result is not confirmed");
        },
      },
      now: clock(),
    });
    expect(result).toMatchObject({
      state: "FAILED", currentStep: "IMPLEMENT", errorCode: "AGENT_RESULT_UNKNOWN", errorCategory: "UNKNOWN_SIDE_EFFECT",
    });
  });

  it("preserves an unknown Workspace side effect for recovery", async () => {
    const fixture = await createFixture();
    const result = await runCodingWorkflow(fixture.input, {
      agentRunner: fixture.runner,
      gitRunner: { async run() { throw unknown("WORKSPACE_EFFECT_UNKNOWN", "Worktree facts are unavailable"); } },
      now: clock(),
    });
    expect(result).toMatchObject({
      state: "FAILED", currentStep: "WORKSPACE", errorCode: "WORKSPACE_EFFECT_UNKNOWN", errorCategory: "UNKNOWN_SIDE_EFFECT",
    });
  });

  it("preserves an unknown Merge side effect for recovery", async () => {
    const fixture = await createFixture();
    const mergeUnknown: GitCommandRunner = {
      async run(invocation) {
        if (invocation.argv[0] === "log" && invocation.argv.includes("--grep")) {
          throw unknown("LOCAL_MERGE_UNKNOWN", "Target ref cannot be reconciled");
        }
        return nodeGitCommandRunner.run(invocation);
      },
    };
    const result = await runCodingWorkflow(fixture.input, {
      agentRunner: fixture.runner,
      gitRunner: mergeUnknown,
      now: clock(),
    });
    expect(result).toMatchObject({
      state: "FAILED", currentStep: "MERGE", errorCode: "LOCAL_MERGE_UNKNOWN", errorCategory: "UNKNOWN_SIDE_EFFECT",
    });
  });
});

async function createFixture(failValidation = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-coding-workflow-"));
  roots.push(root);
  const repositoryRoot = path.join(root, "repo");
  const artifactRoot = path.join(root, "artifacts");
  await mkdir(repositoryRoot);
  await mkdir(artifactRoot);
  git(repositoryRoot, "init", "-b", "master");
  git(repositoryRoot, "config", "user.name", "Moye Test");
  git(repositoryRoot, "config", "user.email", "moye@example.test");
  await writeFile(path.join(repositoryRoot, "README.md"), "fixture\n");
  git(repositoryRoot, "add", "README.md");
  git(repositoryRoot, "commit", "-m", "base");
  const baseSha = git(repositoryRoot, "rev-parse", "HEAD").trim();
  git(repositoryRoot, "switch", "--detach", baseSha);
  const command = failValidation
    ? "console.error('gate failed');process.exit(6)"
    : "const fs=require('fs');if(fs.readFileSync('result.txt','utf8')!=='workflow done\\n')process.exit(2);console.log('gate passed')";
  const envelope = createTaskEnvelope({
    taskId: `TASK-WORKFLOW-${failValidation ? "FAIL" : "OK"}`,
    specRevision: 1,
    baseSha,
    requirements: [{ requirementId: "REQ-WORKFLOW-01", title: "fixture", acceptanceCriteria: ["merged"] }],
    validationCommands: [{ commandId: "CMD-WORKFLOW", argv: [process.execPath, "-e", command] }],
    contextPlan: { graphRevision: 17, intents: ["coding-task-poc"], requiredRead: ["agent-contract"], requiredReview: [] },
  });
  const runner = new FixtureCodingAgentRunner({
    events: [
      { type: "thread.started", thread_id: "session-workflow" },
      { type: "turn.started" },
      { type: "item.completed", item: { type: "agent_message", text: "fixture committed" } },
      { type: "turn.completed" },
    ],
    stderr: "fake coding\n",
    exitCode: 0,
    startedAt: "2026-08-20T00:00:00.000Z",
    durationMs: 20,
  }, { fileName: "result.txt", content: "workflow done\n" });
  return {
    root,
    repositoryRoot,
    artifactRoot,
    baseSha,
    runner,
    input: {
      envelope,
      expectedEnvelopeDigest: envelope.envelopeDigest,
      repositoryRoot,
      worktreeRoot: path.join(root, "worktrees"),
      artifactRoot,
      baseRef: "refs/heads/master",
      targetRef: "refs/heads/master",
      runnerKind: "FAKE" as const,
      prompt: "implement fixture",
      docsDisposition: "not_applicable" as const,
    },
  };
}

function clock(): () => Date {
  let value = Date.parse("2026-08-20T00:00:00.000Z");
  return () => { const current = new Date(value); value += 10; return current; };
}

function git(cwd: string, ...argv: string[]): string {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function unknown(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "UNKNOWN_SIDE_EFFECT", retryable: true, message });
}
