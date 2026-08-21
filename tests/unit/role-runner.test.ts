import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FakeRoleAgentRunner,
  cancelRoleAttempt,
  claimRoleExecution,
  createInitialRoleAttempt,
  createRetryRoleAttempt,
  createRoleRunRequest,
  finishRoleAttempt,
  parseRoleRunResult,
  parseRoleRunRequest,
  startRoleAttempt,
  type FakeRoleScript,
  type RoleRunRequest,
  type RoleRunResult,
} from "../../src/agent/role-runner.js";
import { createTaskEnvelope, type TaskEnvelope } from "../../src/domain/coding-task.js";
import {
  applyControlDecision,
  completeRoleDispatch,
  createInitialCoreProjection,
  proposeDeterministicControlDecision,
  type ControlDecision,
  type CoreProjection,
} from "../../src/domain/core-control.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Role Agent Runner", () => {
  it("runs Docs, Implementation and Review as independent Attempts from Pending Role dispatches", async () => {
    const fixture = await roleFixture();
    let projection = schedule(fixture.envelope, fixture.initial);

    const docs = await runPendingRole(fixture, projection, docsScript());
    expect(docs.runner.executionCount).toBe(1);
    expect(docs.result.output).toMatchObject({ type: "DOCS_RESULT", phase: "SPEC_DESIGN" });
    expect(docs.finished.status).toBe("SUCCEEDED");
    const restartedRunner = new FakeRoleAgentRunner(docsScript());
    const replayedDocs = await restartedRunner.run(docs.request);
    expect(replayedDocs).toEqual(docs.result);
    expect(docs.runner.executionCount).toBe(1);
    expect(restartedRunner.executionCount).toBe(0);
    expect(() => createRetryRoleAttempt(
      fixture.envelope,
      projection,
      [docs.finished],
      "2026-08-22T00:00:03.000Z",
    )).toThrow(/successful Role Attempt cannot be retried/);
    const docsCompletion = completionInput(projection, docs.result);
    projection = completeRoleDispatch(projection, docsCompletion);
    expect(projection).toMatchObject({ stage: "IMPLEMENTATION_REQUIRED", pendingRole: null });
    expect(completeRoleDispatch(projection, docsCompletion)).toBe(projection);
    expect(() => completeRoleDispatch(projection, {
      ...docsCompletion,
      resultDigest: `sha256:${"f".repeat(64)}`,
    })).toThrow(/already completed with another result/);

    projection = schedule(fixture.envelope, projection);
    const implementation = await runPendingRole(fixture, projection, implementationScript());
    expect(implementation.result.output).toMatchObject({
      type: "IMPLEMENTATION_RESULT",
      resultCommit: "b".repeat(40),
    });
    projection = complete(projection, implementation.result);
    expect(projection.stage).toBe("REVIEW_REQUIRED");

    projection = schedule(fixture.envelope, projection);
    const review = await runPendingRole(fixture, projection, reviewScript());
    expect(review.result.output).toMatchObject({
      type: "REVIEW_RESULT",
      verdict: "PASSED",
      findingRefs: [],
    });
    projection = complete(projection, review.result);

    expect(projection).toMatchObject({
      projectionVersion: 7,
      stage: "VERIFICATION_REQUIRED",
      pendingRole: null,
      completedRoleDispatches: [
        { role: "DOCS", attemptGeneration: 1 },
        { role: "IMPLEMENTATION", attemptGeneration: 1 },
        { role: "REVIEW", attemptGeneration: 1 },
      ],
    });
    expect(proposeDeterministicControlDecision(fixture.envelope, projection)).toBeNull();
  });

  it("creates a new Attempt generation after failure and never revives a terminal Attempt", async () => {
    const fixture = await roleFixture();
    const scheduled = schedule(fixture.envelope, fixture.initial);
    const first = await runPendingRole(fixture, scheduled, failureScript());

    expect(first.finished).toMatchObject({ status: "FAILED", generation: 1 });
    expect(() => startRoleAttempt(first.finished, "2026-08-22T00:00:03.000Z"))
      .toThrow(/cannot start from FAILED/);
    expect(() => cancelRoleAttempt(first.finished, "2026-08-22T00:00:03.000Z"))
      .toThrow(/already FAILED/);

    const retry = createRetryRoleAttempt(
      fixture.envelope,
      scheduled,
      [first.finished],
      "2026-08-22T00:00:03.000Z",
    );
    expect(retry).toMatchObject({
      generation: 2,
      status: "SCHEDULED",
      attemptId: `${fixture.envelope.taskId}/CORE-DOCS/attempt-002`,
    });
    expect(retry.attemptDigest).not.toBe(first.finished.attemptDigest);
    expect(() => createRetryRoleAttempt(
      fixture.envelope,
      scheduled,
      [first.finished, { ...retry, status: "FAILED" }],
      "2026-08-22T00:00:04.000Z",
    )).toThrow(/must come from the Role Attempt protocol/);
  });

  it("marks an intent without a manifest UNKNOWN and refuses a duplicate external execution", async () => {
    const fixture = await roleFixture();
    const scheduled = schedule(fixture.envelope, fixture.initial);
    const attempt = startRoleAttempt(
      createInitialRoleAttempt(fixture.envelope, scheduled, "2026-08-22T00:00:00.000Z"),
      "2026-08-22T00:00:01.000Z",
    );
    const request = await requestFor(fixture, attempt);
    expect(await claimRoleExecution(request)).toBe(true);

    const runner = new FakeRoleAgentRunner(docsScript());
    await expect(runner.run(request)).rejects.toMatchObject({
      code: "ROLE_RUN_RESULT_UNKNOWN",
      category: "UNKNOWN_SIDE_EFFECT",
      retryable: false,
    });
    expect(runner.executionCount).toBe(0);
    expect(await claimRoleExecution(request)).toBe(false);
  });

  it("rejects tampered artifacts and role outputs when reconciling a persisted manifest", async () => {
    const fixture = await roleFixture();
    const scheduled = schedule(fixture.envelope, fixture.initial);
    const executed = await runPendingRole(fixture, scheduled, docsScript());
    const specPath = path.join(executed.request.artifactPath, "spec.md");
    await writeFile(specPath, "tampered\n");

    await expect(parseRoleRunResult(
      JSON.parse(await readFile(path.join(executed.request.artifactPath, "manifest.json"), "utf8")),
      executed.request,
    )).rejects.toThrow(/content differs from manifest/);

    const serialized = JSON.parse(JSON.stringify(executed.result)) as Record<string, unknown>;
    serialized["output"] = { type: "IMPLEMENTATION_RESULT" };
    await expect(parseRoleRunResult(serialized, executed.request)).rejects.toThrow(/does not match DOCS/);

    const tamperedRequest = JSON.parse(JSON.stringify(executed.request)) as Record<string, unknown>;
    tamperedRequest["taskId"] = "TASK-TAMPERED";
    await expect(parseRoleRunRequest(tamperedRequest, executed.request.runId))
      .rejects.toThrow(/identity is not canonical/);
  });

  it("enforces required artifacts for each successful role output", async () => {
    const fixture = await roleFixture();
    const scheduled = schedule(fixture.envelope, fixture.initial);
    const attempt = startRoleAttempt(
      createInitialRoleAttempt(fixture.envelope, scheduled, "2026-08-22T00:00:00.000Z"),
      "2026-08-22T00:00:01.000Z",
    );
    const request = await requestFor(fixture, attempt);
    const missingDesign = new FakeRoleAgentRunner({
      ...docsScript(),
      artifacts: docsScript().artifacts.filter((item) => item.kind !== "DOC_DESIGN"),
    });
    await expect(missingDesign.run(request)).rejects.toThrow(/requires exactly one DOC_DESIGN/);
    expect(missingDesign.executionCount).toBe(1);

    const implementationFixture = await roleFixture();
    let implementationProjection = schedule(implementationFixture.envelope, implementationFixture.initial);
    const docs = await runPendingRole(implementationFixture, implementationProjection, docsScript());
    implementationProjection = schedule(
      implementationFixture.envelope,
      complete(implementationProjection, docs.result),
    );
    const { resultCommit: _missingCommit, ...withoutCommit } = implementationScript();
    await expect(runPendingRole(implementationFixture, implementationProjection, withoutCommit))
      .rejects.toThrow(/resultCommit must be a full Git object ID/);
  });

  it("rejects artifact roots inside the input scope and filesystem-root artifact storage", async () => {
    const fixture = await roleFixture();
    const scheduled = schedule(fixture.envelope, fixture.initial);
    const attempt = startRoleAttempt(
      createInitialRoleAttempt(fixture.envelope, scheduled, "2026-08-22T00:00:00.000Z"),
      "2026-08-22T00:00:01.000Z",
    );
    const nestedArtifacts = path.join(fixture.scope, "artifacts");
    await mkdir(nestedArtifacts);

    await expect(createRoleRunRequest({
      attempt,
      runnerKind: "FAKE",
      workspaceOrArtifactScope: fixture.scope,
      artifactRoot: nestedArtifacts,
      prompt: "unsafe overlap",
    })).rejects.toThrow(/cannot be inside the Role input scope/);
    await expect(createRoleRunRequest({
      attempt,
      runnerKind: "FAKE",
      workspaceOrArtifactScope: fixture.scope,
      artifactRoot: path.parse(fixture.scope).root,
      prompt: "unsafe root",
    })).rejects.toThrow(/Filesystem root cannot be a Role Artifact Root/);
  });
});

async function roleFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-role-runner-"));
  temporaryRoots.push(root);
  const scope = path.join(root, "workspace");
  const artifactRoot = path.join(root, "artifacts");
  await Promise.all([mkdir(scope), mkdir(artifactRoot)]);
  const envelope = taskEnvelope();
  return {
    envelope,
    scope,
    artifactRoot,
    initial: createInitialCoreProjection(envelope, {
      operationRetries: 2,
      roleAttempts: 5,
      repairs: 2,
      replans: 1,
      modelCalls: 5,
      totalTimeMs: 60_000,
    }),
  };
}

async function runPendingRole(
  fixture: Awaited<ReturnType<typeof roleFixture>>,
  projection: CoreProjection,
  script: FakeRoleScript,
) {
  const attempt = startRoleAttempt(
    createInitialRoleAttempt(fixture.envelope, projection, "2026-08-22T00:00:00.000Z"),
    "2026-08-22T00:00:01.000Z",
  );
  const request = await requestFor(fixture, attempt);
  const runner = new FakeRoleAgentRunner(script);
  const result = await runner.run(request);
  const finished = finishRoleAttempt(attempt, result, result.finishedAt);
  return { attempt, request, runner, result, finished };
}

async function requestFor(
  fixture: Awaited<ReturnType<typeof roleFixture>>,
  attempt: Parameters<typeof createRoleRunRequest>[0]["attempt"],
): Promise<RoleRunRequest> {
  return createRoleRunRequest({
    attempt,
    runnerKind: "FAKE",
    workspaceOrArtifactScope: fixture.scope,
    artifactRoot: fixture.artifactRoot,
    prompt: `Execute ${attempt.role} for ${attempt.taskId}`,
  });
}

function schedule(envelope: TaskEnvelope, projection: CoreProjection): CoreProjection {
  return applyControlDecision(projection, requireDecision(proposeDeterministicControlDecision(envelope, projection)));
}

function complete(projection: CoreProjection, result: RoleRunResult): CoreProjection {
  return completeRoleDispatch(projection, completionInput(projection, result));
}

function completionInput(projection: CoreProjection, result: RoleRunResult) {
  const pending = projection.pendingRole;
  if (pending === null) throw new Error("expected Pending Role Dispatch");
  if (result.outcome !== "SUCCEEDED") throw new Error("expected successful Role Result");
  return {
    dispatchId: pending.dispatchId,
    role: result.role,
    attemptId: result.attemptId,
    attemptGeneration: result.generation,
    inputDigest: result.inputDigest,
    resultDigest: result.resultDigest,
    outcome: result.outcome,
  } as const;
}

function requireDecision(value: ControlDecision | null): ControlDecision {
  if (value === null) throw new Error("expected Control Decision");
  return value;
}

function taskEnvelope(): TaskEnvelope {
  return createTaskEnvelope({
    taskId: "TASK-ROLE-RUNNER",
    specRevision: 1,
    baseSha: "a".repeat(40),
    requirements: [{
      requirementId: "REQ-ROLE-01",
      title: "Run independent role attempts",
      acceptanceCriteria: ["each role writes a typed manifest"],
    }],
    validationCommands: [{ commandId: "CMD-ROLE", argv: ["npm", "test"] }],
    contextPlan: {
      graphRevision: 35,
      intents: ["task-runtime-change"],
      requiredRead: ["agent-contract"],
      requiredReview: ["task-runtime-kernel"],
    },
  });
}

function docsScript(): FakeRoleScript {
  return {
    startedAt: "2026-08-22T00:00:01.000Z",
    durationMs: 1_000,
    outcome: "SUCCEEDED",
    docsPhase: "SPEC_DESIGN",
    artifacts: [
      { name: "spec.md", kind: "DOC_SPEC", content: "# Spec\n" },
      { name: "plan.md", kind: "DOC_PLAN", content: "# Plan\n" },
      { name: "design.md", kind: "DOC_DESIGN", content: "# Design\n" },
    ],
  };
}

function implementationScript(): FakeRoleScript {
  return {
    startedAt: "2026-08-22T00:00:01.000Z",
    durationMs: 1_000,
    outcome: "SUCCEEDED",
    resultCommit: "b".repeat(40),
    artifacts: [
      { name: "checkpoint.json", kind: "CHECKPOINT", content: "{}\n" },
      { name: "tests.txt", kind: "TEST_EVIDENCE", content: "passed\n" },
      { name: "self-review.md", kind: "SELF_REVIEW", content: "No findings.\n" },
    ],
  };
}

function reviewScript(): FakeRoleScript {
  return {
    startedAt: "2026-08-22T00:00:01.000Z",
    durationMs: 1_000,
    outcome: "SUCCEEDED",
    reviewVerdict: "PASSED",
    artifacts: [
      { name: "review.json", kind: "REVIEW_RESULT", content: "{\"verdict\":\"PASSED\"}\n" },
    ],
  };
}

function failureScript(): FakeRoleScript {
  return {
    startedAt: "2026-08-22T00:00:01.000Z",
    durationMs: 1_000,
    outcome: "FAILED",
    artifacts: [{ name: "diagnostic.txt", kind: "DIAGNOSTIC", content: "runner failed\n" }],
    error: { code: "FAKE_FAILURE", category: "TRANSIENT_IO", message: "runner failed" },
  };
}
