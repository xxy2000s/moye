import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FixtureCodingAgentRunner, StreamingFixtureCodingAgentRunner } from "../../src/agent/fixture-coding.js";
import type { AgentRunner } from "../../src/agent/runner.js";
import type { LiveRoleRunner } from "../../src/agent/live-role.js";
import { CODING_WORKFLOW_STEPS, runCodingWorkflow } from "../../src/coding/workflow.js";
import { createTaskEnvelope } from "../../src/domain/coding-task.js";
import { MoyeError } from "../../src/domain/errors.js";
import { nodeGitCommandRunner } from "../../src/git/workspace-effect.js";
import type { GitCommandRunner } from "../../src/git/workspace-effect.js";
import type { LiveReviewRunner } from "../../src/review/live-review.js";
import { buildCodingStateMachine } from "../../src/trace/state-machine.js";

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

  it("records Review findings as a real Repair edge with a new IMPLEMENT Attempt", async () => {
    const fixture = await createFixture();
    const implementation = streamingRunner("session-implementation", "result.txt", "workflow done\n");
    const repair = streamingRunner("session-repair", "repair.txt", "review finding repaired\n");
    const agentRunner: AgentRunner = {
      run(request) {
        return (request.attemptId.endsWith("attempt-001") ? implementation : repair).run(request);
      },
    };
    let reviewCalls = 0;
    const reviewRunner: LiveReviewRunner = {
      async run(request) {
        reviewCalls += 1;
        const findings = reviewCalls === 1
          ? [{ severity: "BLOCKING" as const, title: "missing repair marker", details: "repair.txt must be committed" }]
          : [];
        return {
          schemaVersion: 1,
          runId: `review-run-${reviewCalls}`,
          taskId: request.taskId,
          specRevision: request.specRevision,
          attempt: request.attempt,
          runnerKind: request.runnerKind,
          sessionId: `session-review-${reviewCalls}`,
          commitSha: request.commitSha,
          outcome: "SUCCEEDED",
          verdict: findings.length > 0 ? "FINDINGS" : "PASSED",
          summary: findings.length > 0 ? "one blocking finding" : "repair accepted",
          findings,
          exitCode: 0,
          signal: null,
          startedAt: `2026-08-20T00:00:0${reviewCalls}.000Z`,
          finishedAt: `2026-08-20T00:00:0${reviewCalls}.100Z`,
          eventsArtifactRef: `review-artifact://review-run-${reviewCalls}/events.jsonl`,
          manifestArtifactRef: `review-artifact://review-run-${reviewCalls}/manifest.json`,
          resultDigest: `review-result:${reviewCalls}`,
        };
      },
    };

    const result = await runCodingWorkflow({
      ...fixture.input,
      runnerKind: "CODEX_EXEC",
      reviewMode: "REAL",
      maxRepairAttempts: 1,
    }, { agentRunner, reviewRunner, now: clock() });

    expect(result).toMatchObject({ state: "CLOSED", archiveStatus: "ARCHIVED", repairCount: 1 });
    expect(result.reviews?.map(({ verdict }) => verdict)).toEqual(["FINDINGS", "PASSED"]);
    expect(result.agentRuns?.map(({ attemptId, sessionId }) => ({ attemptId, sessionId }))).toEqual([
      { attemptId: `${result.taskId}/IMPLEMENT/attempt-001`, sessionId: "session-implementation" },
      { attemptId: `${result.taskId}/IMPLEMENT/attempt-002`, sessionId: "session-repair" },
    ]);
    expect(result.attempts.filter(({ stepId }) => stepId === "IMPLEMENT").map(({ generation, status }) => ({ generation, status })))
      .toEqual([{ generation: 1, status: "SUCCEEDED" }, { generation: 2, status: "SUCCEEDED" }]);
    expect(result.attempts.filter(({ stepId }) => stepId === "VERIFY").map(({ generation, status }) => ({ generation, status })))
      .toEqual([{ generation: 1, status: "SUCCEEDED" }, { generation: 2, status: "SUCCEEDED" }]);

    const machine = buildCodingStateMachine(result);
    expect(machine.current).toMatchObject({ overall: "ARCHIVED", historyCurrent: "ARCHIVED", consistency: "VERIFIED" });
    expect(machine.history.map(({ from, to }) => `${from}->${to}`)).toContain("REVIEW->IMPLEMENT");
    expect(machine.definition.edges).toContainEqual(expect.objectContaining({
      from: "REVIEW", to: "IMPLEMENT", kind: "REPAIR", traversed: true,
    }));
  });

  it("creates Spec Revision N+1 for a real Replan and binds later Attempts to it", async () => {
    const fixture = await createFixture();
    const initial = streamingRunner("session-r1", "result.txt", "workflow done\n");
    const revised = streamingRunner("session-r2", "replan.txt", "revision two\n");
    const agentRunner: AgentRunner = {
      run(request) { return (request.specRevision === 1 ? initial : revised).run(request); },
    };
    const roleRunner: LiveRoleRunner = {
      async run(request) {
        return {
          schemaVersion: 1,
          runId: `role:${request.kind}:${request.attempt}:${request.specRevision}`,
          taskId: request.taskId,
          specRevision: request.specRevision,
          kind: request.kind,
          attempt: request.attempt,
          runnerKind: request.runnerKind,
          sessionId: `session-${request.kind.toLowerCase()}-${request.specRevision}`,
          ...(request.commitSha === undefined ? {} : { commitSha: request.commitSha }),
          outcome: "SUCCEEDED",
          verdict: "PASSED",
          summary: `${request.kind} accepted`,
          findings: [],
          revisedAcceptanceCriteria: request.kind === "REPLAN" ? ["result.txt remains valid", "replan.txt is committed"] : [],
          exitCode: 0,
          signal: null,
          startedAt: "2026-08-20T00:00:00.000Z",
          finishedAt: "2026-08-20T00:00:00.001Z",
          eventsArtifactRef: `role-artifact://role:${request.kind}:${request.attempt}:${request.specRevision}/events.jsonl`,
          stderrArtifactRef: `role-artifact://role:${request.kind}:${request.attempt}:${request.specRevision}/stderr.log`,
          manifestArtifactRef: `role-artifact://role:${request.kind}:${request.attempt}:${request.specRevision}/manifest.json`,
          eventsContentDigest: `sha256:${"a".repeat(64)}`,
          stderrContentDigest: `sha256:${"b".repeat(64)}`,
          resultDigest: `role-result:${request.kind}:${request.specRevision}`,
        };
      },
    };
    let reviewCalls = 0;
    const reviewRunner: LiveReviewRunner = {
      async run(request) {
        reviewCalls += 1;
        const findings = reviewCalls === 1 ? [{
          severity: "BLOCKING" as const,
          recommendedAction: "REPLAN" as const,
          title: "acceptance is incomplete",
          details: "the accepted spec must require a revision marker",
        }] : [];
        return {
          schemaVersion: 1,
          runId: `review-replan-${reviewCalls}`,
          taskId: request.taskId,
          specRevision: request.specRevision,
          attempt: request.attempt,
          runnerKind: request.runnerKind,
          sessionId: `session-review-replan-${reviewCalls}`,
          commitSha: request.commitSha,
          outcome: "SUCCEEDED",
          verdict: findings.length ? "FINDINGS" : "PASSED",
          summary: findings.length ? "specification defect" : "revision accepted",
          findings,
          exitCode: 0,
          signal: null,
          startedAt: "2026-08-20T00:00:00.000Z",
          finishedAt: "2026-08-20T00:00:00.001Z",
          eventsArtifactRef: `review-artifact://review-replan-${reviewCalls}/events.jsonl`,
          manifestArtifactRef: `review-artifact://review-replan-${reviewCalls}/manifest.json`,
          resultDigest: `review-replan-result:${reviewCalls}`,
        };
      },
    };

    const result = await runCodingWorkflow({
      ...fixture.input,
      runnerKind: "CODEX_EXEC",
      reviewMode: "REAL",
      maxRepairAttempts: 1,
      maxReplanAttempts: 1,
    }, { agentRunner, roleRunner, reviewRunner, now: clock() });

    expect(result).toMatchObject({ state: "CLOSED", archiveStatus: "ARCHIVED", specRevision: 2 });
    expect(result.specRevisions?.map(({ specRevision }) => specRevision)).toEqual([1, 2]);
    expect(result.agentRuns?.map(({ specRevision }) => specRevision)).toEqual([1, 2]);
    expect(result.attempts.filter(({ stepId }) => stepId === "IMPLEMENT").map(({ generation, specRevision }) => ({ generation, specRevision })))
      .toEqual([{ generation: 1, specRevision: 1 }, { generation: 2, specRevision: 2 }]);
    expect(result.events.map(({ type }) => type)).toContain("SPEC_REVISED");
    expect(buildCodingStateMachine(result).definition.edges).toContainEqual(expect.objectContaining({
      from: "REVIEW", to: "REPLAN", kind: "REPAIR", traversed: true,
    }));
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

  it("waits for explicit reconcile evidence and resumes the same Agent Attempt", async () => {
    const fixture = await createFixture();
    let calls = 0;
    const states: string[] = [];
    const result = await runCodingWorkflow(fixture.input, {
      agentRunner: {
        async run(request) {
          calls += 1;
          if (calls === 1) throw unknown("AGENT_RESULT_UNKNOWN", "Agent result requires external reconciliation");
          return fixture.runner.run(request);
        },
      },
      async awaitReconcile(fact) {
        expect(fact).toMatchObject({ step: "IMPLEMENT", code: "AGENT_RESULT_UNKNOWN", round: 1 });
        expect(fact.token).toMatch(/^coding-reconcile:sha256:/);
      },
      observe(projection) { states.push(projection.state); },
      now: clock(),
    });

    expect(result).toMatchObject({ state: "CLOSED", archiveStatus: "ARCHIVED" });
    expect(calls).toBe(2);
    expect(states).toContain("WAITING_RECONCILE");
    expect(result.events.map(({ type }) => type)).toEqual(expect.arrayContaining(["RECONCILE_REQUIRED", "RECONCILE_RESUMED"]));
    expect(result.attempts.filter(({ stepId }) => stepId === "IMPLEMENT")).toHaveLength(1);
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

function streamingRunner(sessionId: string, fileName: string, content: string): StreamingFixtureCodingAgentRunner {
  return new StreamingFixtureCodingAgentRunner({
    events: [
      { type: "thread.started", thread_id: sessionId },
      { type: "turn.started" },
      { type: "item.completed", item: { type: "agent_message", text: `${fileName} committed` } },
      { type: "turn.completed" },
    ],
    mutation: { fileName, content },
    delayMs: 0,
  });
}

function git(cwd: string, ...argv: string[]): string {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function unknown(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "UNKNOWN_SIDE_EFFECT", retryable: true, message });
}
