import { describe, expect, it } from "vitest";

import { createTaskEnvelope, type TaskEnvelope } from "../../src/domain/coding-task.js";
import {
  applyControlDecision,
  applyReviewGateResult,
  completeRoleDispatch,
  createControlDecision,
  createInitialCoreProjection,
  parseCoreProjection,
  proposeDeterministicControlDecision,
  reconcileUnknownEffect,
  recordRoleAttemptFailure,
  type ControlDecision,
  type CoreProjection,
} from "../../src/domain/core-control.js";
import {
  createImplementationSelfReview,
  createReviewFinding,
  createReviewInput,
  createReviewResult,
  evaluateReviewGate,
  type ReviewFindingCategory,
  type ReviewRecommendedAction,
} from "../../src/domain/review-finding.js";

describe("Core recovery control", () => {
  it("separates Role Attempt Retry from Operation Retry and advances only the Role generation", () => {
    const envelope = taskEnvelope();
    let projection = schedule(envelope, createInitialCoreProjection(envelope, budget()));
    const original = projection.pendingRole!;
    projection = recordRoleAttemptFailure(projection, {
      dispatchId: original.dispatchId,
      role: original.role,
      attemptId: attemptId(projection, original.role, original.generation),
      attemptGeneration: original.generation,
      inputDigest: original.inputDigest,
      resultDigest: digest("f"),
      outcome: "FAILED",
      errorCode: "DOCS_AGENT_EXITED",
      errorCategory: "TRANSIENT_IO",
    });
    const failure = projection.roleAttemptFailures.at(-1)!;
    const retry = createControlDecision({
      ...decisionBase(projection),
      action: "RETRY",
      targetRole: "DOCS",
      evidenceRefs: [`role-failure://${failure.failureDigest}`],
      reason: "retry the explicitly failed role attempt",
      budgetRequest: { roleAttempts: 1, modelCalls: 1 },
    });
    const roleRetried = applyControlDecision(projection, retry);

    expect(roleRetried.pendingRole).toMatchObject({ role: "DOCS", generation: 2 });
    expect(roleRetried.pendingRole?.dispatchId).not.toBe(original.dispatchId);
    expect(roleRetried.budget).toMatchObject({
      operationRetriesRemaining: 2,
      roleAttemptsRemaining: 6,
      modelCallsRemaining: 6,
    });
    expect(roleRetried.recoveryActions.at(-1)).toMatchObject({ action: "ROLE_ATTEMPT_RETRY" });
    expect(applyControlDecision(roleRetried, retry)).toBe(roleRetried);

    const operationRetry = createControlDecision({
      ...decisionBase(roleRetried),
      action: "RETRY",
      operationId: "artifact-upload:docs",
      evidenceRefs: ["reconcile://artifact-upload/not-applied"],
      reason: "the idempotent upload was proven not applied",
      budgetRequest: { operationRetries: 1 },
    });
    const operationRetried = applyControlDecision(roleRetried, operationRetry);
    expect(operationRetried.pendingRole).toEqual(roleRetried.pendingRole);
    expect(operationRetried.budget).toMatchObject({
      operationRetriesRemaining: 1,
      roleAttemptsRemaining: 6,
      modelCallsRemaining: 6,
    });
    expect(operationRetried.recoveryActions.at(-1)).toMatchObject({ action: "OPERATION_RETRY" });
  });

  it("waits for UNKNOWN external effects and permits retry only after reconciliation", () => {
    const envelope = taskEnvelope();
    const running = schedule(envelope, createInitialCoreProjection(envelope, budget()));
    const pending = running.pendingRole;
    const wait = createControlDecision({
      ...decisionBase(running),
      action: "WAIT",
      operationId: "publish:docs-manifest",
      evidenceRefs: ["effect-intent://publish-docs"],
      reason: "the write intent exists without a confirmed result",
      budgetRequest: {},
    });
    const waiting = applyControlDecision(running, wait);
    expect(waiting).toMatchObject({ state: "WAITING_RECONCILE", pendingRole: pending });
    expect(proposeDeterministicControlDecision(envelope, waiting)).toBeNull();

    const blindRetry = createControlDecision({
      ...decisionBase(waiting),
      action: "RETRY",
      operationId: "publish:docs-manifest",
      evidenceRefs: ["effect-intent://publish-docs"],
      reason: "blind retry is forbidden",
      budgetRequest: { operationRetries: 1 },
    });
    expect(() => applyControlDecision(waiting, blindRetry)).toThrow(/requires RUNNING state/);

    const reconciled = reconcileUnknownEffect(waiting, {
      expectedWaitDigest: waiting.pendingReconcile!.waitDigest,
      outcome: "NOT_APPLIED",
      evidenceRefs: ["reconcile://publish-docs/not-applied"],
    });
    expect(reconciled).toMatchObject({ state: "RUNNING", pendingReconcile: null, pendingRole: pending });
    expect(reconcileUnknownEffect(reconciled, {
      expectedWaitDigest: waiting.pendingReconcile!.waitDigest,
      outcome: "NOT_APPLIED",
      evidenceRefs: ["reconcile://publish-docs/not-applied"],
    })).toBe(reconciled);
    expect(parseCoreProjection(
      JSON.parse(JSON.stringify(reconciled)),
      envelope,
      reconciled.projectionDigest,
    )).toEqual(reconciled);
  });

  it("routes Review Fail through exact Finding-driven Repair and then Review Pass", () => {
    const envelope = taskEnvelope();
    const blockedReview = reviewBundle(envelope, 1, 1, digest("3"), "IMPLEMENTATION", "REPAIR", true);
    let projection = advanceToReviewGate(envelope, blockedReview.roleRunResultDigest);
    const blockedGate = evaluateReviewGate(blockedReview.input, blockedReview.result, blockedReview.findings);
    projection = applyReviewGateResult(projection, blockedGate);

    const repairDecision = requireDecision(proposeDeterministicControlDecision(envelope, projection));
    expect(repairDecision).toMatchObject({ action: "REPAIR", targetRole: "IMPLEMENTATION" });
    expect(repairDecision.sourceFindingRefs).toEqual(blockedGate.unresolvedBlockingFindingRefs);
    projection = applyControlDecision(projection, repairDecision);
    expect(projection).toMatchObject({
      stage: "IMPLEMENTATION_RUNNING",
      pendingRole: { role: "IMPLEMENTATION", generation: 2 },
      reviewGate: null,
      reviewGateHistory: [{ gateDigest: blockedGate.gateDigest }],
      budget: { repairsRemaining: 1 },
    });

    projection = complete(projection, digest("4"));
    projection = schedule(envelope, projection);
    expect(projection.pendingRole).toMatchObject({ role: "REVIEW", generation: 2 });
    const passedReview = reviewBundle(envelope, 2, 2, digest("5"), "IMPLEMENTATION", "ACCEPT", false);
    projection = complete(projection, passedReview.roleRunResultDigest);
    const passedGate = evaluateReviewGate(passedReview.input, passedReview.result, []);
    projection = applyReviewGateResult(projection, passedGate);
    expect(projection).toMatchObject({
      stage: "VERIFICATION_REQUIRED",
      reviewGate: { verdict: "PASSED", unresolvedBlockingFindingRefs: [] },
      reviewGateHistory: [{ verdict: "BLOCKED" }],
    });
  });

  it("replans Design findings onto Spec Revision N+1 and invalidates old evidence", () => {
    const envelope = taskEnvelope();
    const blockedReview = reviewBundle(envelope, 1, 1, digest("3"), "DESIGN", "REPLAN", true);
    let projection = advanceToReviewGate(envelope, blockedReview.roleRunResultDigest);
    const gate = evaluateReviewGate(blockedReview.input, blockedReview.result, blockedReview.findings);
    projection = applyReviewGateResult(projection, gate);
    const nextEnvelope = taskEnvelope(2);
    const replan = createControlDecision({
      ...decisionBase(projection),
      action: "REPLAN",
      targetRole: "DOCS",
      sourceFindingRefs: gate.unresolvedBlockingFindingRefs,
      evidenceRefs: [`task-envelope://${nextEnvelope.envelopeDigest}`],
      reason: "the accepted design must change before implementation continues",
      budgetRequest: { replans: 1, roleAttempts: 1, modelCalls: 1 },
    });
    const replanned = applyControlDecision(projection, replan, nextEnvelope);

    expect(replanned).toMatchObject({
      specRevision: 2,
      envelopeDigest: nextEnvelope.envelopeDigest,
      stage: "DOCS_RUNNING",
      pendingRole: { role: "DOCS", generation: 1 },
      budget: { replansRemaining: 0 },
      recoveryActions: expect.arrayContaining([expect.objectContaining({ action: "REPLAN" })]),
    });
    expect(replanned.completedRoleDispatches).toHaveLength(3);
    expect(replanned.invalidatedEvidence).toHaveLength(1);
    expect(replanned.invalidatedEvidence[0]!.invalidatedRefs).toEqual(expect.arrayContaining([
      `task-envelope://${envelope.envelopeDigest}`,
      `review-gate://${gate.gateDigest}`,
      ...gate.unresolvedBlockingFindingRefs,
    ]));
    expect(parseCoreProjection(
      JSON.parse(JSON.stringify(replanned)),
      nextEnvelope,
      replanned.projectionDigest,
    )).toEqual(replanned);
  });

  it("rejects mixed budget shapes and converges once on a budget terminal candidate", () => {
    const envelope = taskEnvelope();
    const initial = createInitialCoreProjection(envelope, { ...budget(), roleAttempts: 0 });
    const terminal = requireDecision(proposeDeterministicControlDecision(envelope, initial));
    const closing = applyControlDecision(initial, terminal);
    expect(closing).toMatchObject({
      state: "CLOSING",
      stage: "CLOSURE_REQUIRED",
      terminalCandidate: { outcome: "FAILED_TERMINAL", reason: "BUDGET_EXHAUSTED" },
    });
    expect(applyControlDecision(closing, terminal)).toBe(closing);
    expect(proposeDeterministicControlDecision(envelope, closing)).toBeNull();

    const schedulable = createInitialCoreProjection(envelope, budget());
    const disguised = createControlDecision({
      ...decisionBase(schedulable),
      action: "SCHEDULE_ROLE",
      targetRole: "DOCS",
      reason: "try to hide an operation retry in a role dispatch",
      budgetRequest: { roleAttempts: 1, modelCalls: 1, operationRetries: 1 },
    });
    expect(() => applyControlDecision(schedulable, disguised)).toThrow(/budget shape/);
  });
});

function advanceToReviewGate(envelope: TaskEnvelope, reviewResultDigest: string): CoreProjection {
  let projection = createInitialCoreProjection(envelope, budget());
  projection = schedule(envelope, projection);
  projection = complete(projection, digest("1"));
  projection = schedule(envelope, projection);
  projection = complete(projection, digest("2"));
  projection = schedule(envelope, projection);
  return complete(projection, reviewResultDigest);
}

function schedule(envelope: TaskEnvelope, projection: CoreProjection): CoreProjection {
  return applyControlDecision(projection, requireDecision(proposeDeterministicControlDecision(envelope, projection)));
}

function complete(projection: CoreProjection, resultDigest: string): CoreProjection {
  const pending = projection.pendingRole;
  if (pending === null) throw new Error("expected Pending Role Dispatch");
  return completeRoleDispatch(projection, {
    dispatchId: pending.dispatchId,
    role: pending.role,
    attemptId: attemptId(projection, pending.role, pending.generation),
    attemptGeneration: pending.generation,
    inputDigest: pending.inputDigest,
    resultDigest,
    outcome: "SUCCEEDED",
  });
}

function reviewBundle(
  envelope: TaskEnvelope,
  implementationGeneration: number,
  reviewGeneration: number,
  roleRunResultDigest: string,
  category: ReviewFindingCategory,
  recommendedAction: ReviewRecommendedAction,
  blocked: boolean,
) {
  const candidateCommit = (implementationGeneration === 1 ? "b" : "c").repeat(40);
  const selfReview = createImplementationSelfReview({
    taskId: envelope.taskId,
    specRevision: envelope.specRevision,
    implementationAttemptId: attemptIdFor(envelope.taskId, "IMPLEMENTATION", implementationGeneration),
    implementationRunId: digest(implementationGeneration === 1 ? "a" : "b"),
    candidateCommit,
    diffRef: `git-diff://${candidateCommit}`,
    diffDigest: digest(implementationGeneration === 1 ? "d" : "e"),
    checkpointRef: `git-checkpoint://${candidateCommit}`,
    testEvidenceRefs: ["evidence://tests"],
    verdict: "READY_FOR_REVIEW",
    summary: "candidate is ready for review",
    checklist: [{ checkId: "TESTS", conclusion: "PASS", evidenceRefs: ["evidence://tests"], note: "pass" }],
  });
  const input = createReviewInput({
    selfReview,
    selfReviewRef: "role-artifact://implementation/self-review.md",
    verificationEvidenceRefs: ["evidence://tests"],
  });
  const findings = blocked ? [createReviewFinding({
    reviewInput: input,
    reviewAttemptId: attemptIdFor(envelope.taskId, "REVIEW", reviewGeneration),
    reviewRunId: digest(reviewGeneration === 1 ? "6" : "7"),
    category,
    severity: "BLOCKING",
    requirementRefs: ["requirement://REQ-0016"],
    evidenceRefs: ["evidence://review"],
    summary: `${category} blocks the candidate`,
    recommendedAction,
  })] : [];
  const result = createReviewResult({
    reviewInput: input,
    reviewAttemptId: attemptIdFor(envelope.taskId, "REVIEW", reviewGeneration),
    reviewRunId: digest(reviewGeneration === 1 ? "6" : "7"),
    roleRunResultDigest,
    verdict: blocked ? "FINDINGS" : "PASSED",
    findings,
    summary: blocked ? "blocking finding" : "review passed",
  });
  return { input, findings, result, roleRunResultDigest };
}

function taskEnvelope(specRevision = 1): TaskEnvelope {
  return createTaskEnvelope({
    taskId: "TASK-CORE-RECOVERY",
    specRevision,
    baseSha: "a".repeat(40),
    requirements: [{
      requirementId: `REQ-CORE-RECOVERY-${specRevision}`,
      title: "Recovery actions are distinct",
      acceptanceCriteria: ["recovery is bounded and restart-safe"],
    }],
    validationCommands: [{ commandId: "CMD-RECOVERY", argv: ["npm", "test"] }],
    contextPlan: {
      graphRevision: 39,
      intents: ["task-runtime-change"],
      requiredRead: ["task-runtime-kernel"],
      requiredReview: ["architecture-overview"],
    },
  });
}

function budget() {
  return {
    operationRetries: 2,
    roleAttempts: 8,
    repairs: 2,
    replans: 1,
    modelCalls: 8,
    totalTimeMs: 60_000,
  };
}

function decisionBase(projection: CoreProjection) {
  return {
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    expectedProjectionVersion: projection.projectionVersion,
    expectedState: projection.state,
  } as const;
}

function attemptId(projection: CoreProjection, role: NonNullable<CoreProjection["pendingRole"]>["role"], generation: number): string {
  return attemptIdFor(projection.taskId, role, generation);
}

function attemptIdFor(taskId: string, role: "DOCS" | "IMPLEMENTATION" | "REVIEW", generation: number): string {
  return `${taskId}/CORE-${role}/attempt-${String(generation).padStart(3, "0")}`;
}

function requireDecision(value: ControlDecision | null): ControlDecision {
  if (value === null) throw new Error("expected Control Decision");
  return value;
}

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
