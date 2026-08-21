import { describe, expect, it } from "vitest";

import { createTaskEnvelope, type TaskEnvelope } from "../../src/domain/coding-task.js";
import {
  applyControlDecision,
  applyReviewGateResult,
  completeRoleDispatch,
  createInitialCoreProjection,
  proposeDeterministicControlDecision,
  type ControlDecision,
  type CoreProjection,
} from "../../src/domain/core-control.js";
import {
  createImplementationSelfReview,
  createReviewExecutionFailure,
  createReviewFinding,
  createReviewInput,
  createReviewResult,
  evaluateReviewGate,
  parseImplementationSelfReview,
  parseReviewExecutionFailure,
  parseReviewFinding,
  parseReviewGateResult,
  parseReviewInput,
  parseReviewResult,
  reviewFindingRef,
  transitionReviewFinding,
  type ImplementationSelfReview,
  type ReviewFinding,
  type ReviewInput,
  type ReviewResult,
} from "../../src/domain/review-finding.js";

describe("Review and Finding domain", () => {
  it("binds a READY Self Review to Candidate, Diff, Checkpoint and evidence with restart-safe digests", () => {
    const selfReview = readySelfReview();
    const restored = parseImplementationSelfReview(
      JSON.parse(JSON.stringify(selfReview)),
      selfReview.selfReviewDigest,
    );
    const reviewInput = createReviewInput({
      selfReview: restored,
      selfReviewRef: "role-artifact://implementation/self-review.md",
      verificationEvidenceRefs: ["evidence://unit-tests", "evidence://typecheck"],
    });

    expect(reviewInput).toMatchObject({
      taskId: "TASK-REVIEW-FINDING",
      specRevision: 1,
      candidateCommit: "b".repeat(40),
      diffDigest: digest("d"),
      selfReviewDigest: selfReview.selfReviewDigest,
    });
    expect(parseReviewInput(
      JSON.parse(JSON.stringify(reviewInput)),
      restored,
      reviewInput.reviewInputDigest,
    )).toEqual(reviewInput);

    const tampered = { ...JSON.parse(JSON.stringify(selfReview)), candidateCommit: "c".repeat(40) };
    expect(() => parseImplementationSelfReview(tampered, selfReview.selfReviewDigest))
      .toThrow(/does not match its digest/);
  });

  it("does not authorize Review when Self Review requires changes", () => {
    const selfReview = createImplementationSelfReview({
      ...selfReviewInput(),
      verdict: "CHANGES_REQUIRED",
      checklist: [{
        checkId: "TESTS",
        conclusion: "FAIL",
        evidenceRefs: ["evidence://failed-tests"],
        note: "Tests still fail",
      }],
    });
    expect(() => createReviewInput({
      selfReview,
      selfReviewRef: "role-artifact://implementation/self-review.md",
      verificationEvidenceRefs: ["evidence://failed-tests"],
    })).toThrow(/cannot authorize Review/);
  });

  it("keeps stable Finding identity and append-only disposition history across Repair", () => {
    const fixture = reviewFixture("BLOCKING");
    const initialRef = reviewFindingRef(fixture.finding);
    const blocked = evaluateReviewGate(fixture.reviewInput, fixture.reviewResult, [fixture.finding]);
    expect(blocked).toMatchObject({
      verdict: "BLOCKED",
      unresolvedBlockingFindingRefs: [initialRef],
    });

    const disposition = {
      expectedFindingDigest: fixture.finding.findingDigest,
      toStatus: "RESOLVED" as const,
      actorRef: "role-attempt://TASK-REVIEW-FINDING/CORE-IMPLEMENTATION/attempt-002",
      reason: "Repair commit adds the missing fence check",
      evidenceRefs: ["commit://" + "c".repeat(40), "evidence://repair-tests"],
    };
    const resolved = transitionReviewFinding(fixture.finding, disposition);

    expect(resolved.findingId).toBe(fixture.finding.findingId);
    expect(resolved.originDigest).toBe(fixture.finding.originDigest);
    expect(resolved.findingDigest).not.toBe(fixture.finding.findingDigest);
    expect(resolved).toMatchObject({ status: "RESOLVED", dispositions: [{ fromStatus: "OPEN", toStatus: "RESOLVED" }] });
    expect(transitionReviewFinding(resolved, disposition)).toBe(resolved);
    expect(() => transitionReviewFinding(resolved, {
      ...disposition,
      expectedFindingDigest: resolved.findingDigest,
      reason: "try to rewrite history",
    })).toThrow(/already RESOLVED/);

    const restored = parseReviewFinding(JSON.parse(JSON.stringify(resolved)), fixture.reviewInput, resolved.findingDigest);
    expect(restored).toEqual(resolved);
    const passed = evaluateReviewGate(fixture.reviewInput, fixture.reviewResult, [restored]);
    expect(passed).toMatchObject({ verdict: "PASSED", unresolvedBlockingFindingRefs: [] });
  });

  it("treats Review execution failure as distinct from a successful Review with Findings", () => {
    const reviewInput = readyReviewInput();
    const failure = createReviewExecutionFailure({
      reviewInput,
      reviewAttemptId: reviewAttemptId(),
      reviewRunId: digest("2"),
      roleRunResultDigest: digest("4"),
      errorCode: "REVIEW_PROCESS_EXITED",
      errorCategory: "TRANSIENT_IO",
      message: "reviewer process exited before producing a verdict",
    });
    expect(failure).toMatchObject({ executionOutcome: "FAILED", errorCategory: "TRANSIENT_IO" });
    expect(parseReviewExecutionFailure(
      JSON.parse(JSON.stringify(failure)),
      reviewInput,
      failure.failureDigest,
    )).toEqual(failure);
    expect(() => evaluateReviewGate(reviewInput, failure as unknown as ReviewResult, []))
      .toThrow(/must come from its domain protocol/);
  });

  it("requires exact Review Finding bindings and rejects verdict contradictions or tampering", () => {
    const reviewInput = readyReviewInput();
    const finding = findingFor(reviewInput, "MAJOR");
    expect(() => createReviewResult({
      reviewInput,
      reviewAttemptId: reviewAttemptId(),
      reviewRunId: digest("2"),
      roleRunResultDigest: digest("3"),
      verdict: "PASSED",
      findings: [finding],
      summary: "contradiction",
    })).toThrow(/PASSED Review cannot contain Findings/);

    const result = reviewResultFor(reviewInput, [finding]);
    expect(parseReviewResult(
      JSON.parse(JSON.stringify(result)),
      reviewInput,
      [finding],
      result.reviewResultDigest,
    )).toEqual(result);
    const gate = evaluateReviewGate(reviewInput, result, [finding]);
    expect(gate.verdict).toBe("PASSED");
    expect(parseReviewGateResult(
      JSON.parse(JSON.stringify(gate)), reviewInput, result, [finding], gate.gateDigest,
    )).toEqual(gate);

    const tampered = { ...JSON.parse(JSON.stringify(result)), summary: "tampered" };
    expect(() => parseReviewResult(tampered, reviewInput, [finding], result.reviewResultDigest))
      .toThrow(/does not match its digest/);
    expect(() => evaluateReviewGate(reviewInput, result, [])).toThrow(/exact Finding set/);
  });

  it("holds Core at the Review Gate, sends Blocking Findings to Repair, and permits resolved Findings", () => {
    const envelope = taskEnvelope();
    const blockedFixture = reviewFixture("BLOCKING");
    const blockedProjection = projectionAwaitingReviewGate(envelope, blockedFixture.reviewResult.roleRunResultDigest);
    expect(blockedProjection.stage).toBe("REVIEW_GATE_REQUIRED");
    const blockedGate = evaluateReviewGate(
      blockedFixture.reviewInput,
      blockedFixture.reviewResult,
      [blockedFixture.finding],
    );
    const repair = applyReviewGateResult(blockedProjection, blockedGate);
    expect(repair).toMatchObject({
      stage: "REPAIR_REQUIRED",
      reviewGate: { verdict: "BLOCKED", gateDigest: blockedGate.gateDigest },
    });
    expect(applyReviewGateResult(repair, blockedGate)).toBe(repair);
    const mismatchedProjection = projectionAwaitingReviewGate(envelope, digest("9"));
    expect(() => applyReviewGateResult(mismatchedProjection, blockedGate))
      .toThrow(/does not bind the latest completed Review Result/);

    const resolved = transitionReviewFinding(blockedFixture.finding, {
      expectedFindingDigest: blockedFixture.finding.findingDigest,
      toStatus: "RESOLVED",
      actorRef: "role-attempt://TASK-REVIEW-FINDING/CORE-IMPLEMENTATION/attempt-002",
      reason: "repair verified",
      evidenceRefs: ["evidence://repair-tests"],
    });
    const passedGate = evaluateReviewGate(blockedFixture.reviewInput, blockedFixture.reviewResult, [resolved]);
    expect(() => applyReviewGateResult(repair, passedGate)).toThrow(/different Review Gate Result/);
    const passedProjection = projectionAwaitingReviewGate(envelope, blockedFixture.reviewResult.roleRunResultDigest);
    expect(applyReviewGateResult(passedProjection, passedGate)).toMatchObject({
      stage: "VERIFICATION_REQUIRED",
      reviewGate: { verdict: "PASSED", unresolvedBlockingFindingRefs: [] },
    });
  });
});

function readySelfReview(): ImplementationSelfReview {
  return createImplementationSelfReview(selfReviewInput());
}

function selfReviewInput() {
  return {
    taskId: "TASK-REVIEW-FINDING",
    specRevision: 1,
    implementationAttemptId: "TASK-REVIEW-FINDING/CORE-IMPLEMENTATION/attempt-001",
    implementationRunId: digest("1"),
    candidateCommit: "b".repeat(40),
    diffRef: "git-diff://" + "b".repeat(40),
    diffDigest: digest("d"),
    checkpointRef: "git-checkpoint://" + "b".repeat(40),
    testEvidenceRefs: ["evidence://unit-tests"],
    verdict: "READY_FOR_REVIEW" as const,
    summary: "Implementation is ready for independent review",
    checklist: [{
      checkId: "TESTS",
      conclusion: "PASS" as const,
      evidenceRefs: ["evidence://unit-tests"],
      note: "All declared tests pass",
    }],
  };
}

function readyReviewInput(): ReviewInput {
  return createReviewInput({
    selfReview: readySelfReview(),
    selfReviewRef: "role-artifact://implementation/self-review.md",
    verificationEvidenceRefs: ["evidence://unit-tests"],
  });
}

function reviewFixture(severity: "BLOCKING" | "MAJOR") {
  const reviewInput = readyReviewInput();
  const finding = findingFor(reviewInput, severity);
  return { reviewInput, finding, reviewResult: reviewResultFor(reviewInput, [finding]) };
}

function findingFor(reviewInput: ReviewInput, severity: "BLOCKING" | "MAJOR"): ReviewFinding {
  return createReviewFinding({
    reviewInput,
    reviewAttemptId: reviewAttemptId(),
    reviewRunId: digest("2"),
    category: "IMPLEMENTATION",
    severity,
    requirementRefs: ["requirement://REQ-0015-04"],
    evidenceRefs: ["git-diff://line-42", "evidence://review-analysis"],
    summary: "Missing fence check allows an old attempt to overwrite the current result",
    recommendedAction: "REPAIR",
  });
}

function reviewResultFor(reviewInput: ReviewInput, findings: readonly ReviewFinding[]): ReviewResult {
  return createReviewResult({
    reviewInput,
    reviewAttemptId: reviewAttemptId(),
    reviewRunId: digest("2"),
    roleRunResultDigest: digest("3"),
    verdict: findings.length === 0 ? "PASSED" : "FINDINGS",
    findings,
    summary: findings.length === 0 ? "Review passed" : "Review produced findings",
  });
}

function projectionAwaitingReviewGate(envelope: TaskEnvelope, reviewResultDigest: string): CoreProjection {
  let projection = createInitialCoreProjection(envelope, {
    operationRetries: 2,
    roleAttempts: 4,
    repairs: 2,
    replans: 1,
    modelCalls: 4,
    totalTimeMs: 60_000,
  });
  projection = schedule(envelope, projection);
  projection = complete(projection, digest("1"));
  projection = schedule(envelope, projection);
  projection = complete(projection, digest("2"));
  projection = schedule(envelope, projection);
  return complete(projection, reviewResultDigest);
}

function schedule(envelope: TaskEnvelope, projection: CoreProjection): CoreProjection {
  return applyControlDecision(projection, decision(proposeDeterministicControlDecision(envelope, projection)));
}

function complete(projection: CoreProjection, resultDigest: string): CoreProjection {
  const pending = projection.pendingRole;
  if (pending === null) throw new Error("expected Pending Role Dispatch");
  return completeRoleDispatch(projection, {
    dispatchId: pending.dispatchId,
    role: pending.role,
    attemptId: `${projection.taskId}/CORE-${pending.role}/attempt-001`,
    attemptGeneration: 1,
    inputDigest: pending.inputDigest,
    resultDigest,
    outcome: "SUCCEEDED",
  });
}

function taskEnvelope(): TaskEnvelope {
  return createTaskEnvelope({
    taskId: "TASK-REVIEW-FINDING",
    specRevision: 1,
    baseSha: "a".repeat(40),
    requirements: [{
      requirementId: "REQ-REVIEW-01",
      title: "Blocking Review Finding gates Verification",
      acceptanceCriteria: ["Open blocking findings route to repair"],
    }],
    validationCommands: [{ commandId: "CMD-REVIEW", argv: ["npm", "test"] }],
    contextPlan: {
      graphRevision: 37,
      intents: ["task-runtime-change"],
      requiredRead: ["task-runtime-kernel"],
      requiredReview: ["architecture-overview"],
    },
  });
}

function reviewAttemptId(): string {
  return "TASK-REVIEW-FINDING/CORE-REVIEW/attempt-001";
}

function decision(value: ControlDecision | null): ControlDecision {
  if (value === null) throw new Error("expected Control Decision");
  return value;
}

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
