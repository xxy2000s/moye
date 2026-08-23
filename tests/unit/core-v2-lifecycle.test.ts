import { describe, expect, it } from "vitest";

import { createCoreV2Lifecycle, workflowAcceptArchitectV2, workflowAcceptDesignReviewV2, workflowAcceptDocumentationV2, workflowAcceptFinalReviewV2, workflowAcceptImplementationV2, workflowAcceptTestAssessmentV2, workflowAcceptTestPlanV2, workflowArchiveFailureV2, workflowAuthorizeRepairV2, workflowCloseCoreV2, workflowCloseFailureV2, workflowEnterFailureTerminalV2, workflowFailFailureArchiveV2, workflowPassVerificationGateV2, workflowRecordFailureArtifactV2, workflowRecordKnowledgeDispositionV2, workflowRecordTrustedTestRunV2, workflowReplanV2, workflowResumeTestReconcileV2, workflowRetryFailureArchiveV2, workflowWaitForTestReconcileV2 } from "../../src/domain/core-v2-lifecycle.js";
import { completeRoleAttemptV2, createRoleAttemptV2, createRoleRunEvidenceV2, startRoleAttemptV2 } from "../../src/domain/role-runtime-v2.js";
import type { AgentRoleV2, RolePhaseV2 } from "../../src/domain/role-runtime-v2.js";

const base = "a".repeat(40);
const sha = (c: string) => `sha256:${c.repeat(64)}`;

describe("Core v2 Architect and Design Review lifecycle", () => {
  it("accepts revision-bound Architect artifacts and isolated Design Review", () => {
    const initial = createCoreV2Lifecycle({ taskId: "TASK-LIFECYCLE", specRevision: 1, subjectCommit: base, at: time(0) });
    const architect = workflowAcceptArchitectV2(initial, success("ARCHITECT", "ARCHITECT"), deliverable(), time(3));
    expect(architect.state).toBe("DESIGN_REVIEW_REQUIRED");
    expect(architect.artifacts.map((item) => item.kind)).toEqual(["SPEC", "DESIGN", "PLAN"]);
    const reviewed = workflowAcceptDesignReviewV2(architect, success("REVIEW", "DESIGN_REVIEW"), { verdict: "PASSED", findingRefs: [] }, time(4));
    expect(reviewed.state).toBe("IMPLEMENTATION_REQUIRED");
    expect(reviewed.artifacts.at(-1)?.kind).toBe("DESIGN_REVIEW");
    expect(() => workflowAcceptDesignReviewV2(reviewed, success("REVIEW", "DESIGN_REVIEW"), { verdict: "PASSED", findingRefs: [] }, time(5)))
      .toThrow(/not currently required/);
  });

  it("invalidates the complete old Revision after blocking Design findings", () => {
    const initial = createCoreV2Lifecycle({ taskId: "TASK-LIFECYCLE", specRevision: 1, subjectCommit: base, at: time(0) });
    const architect = workflowAcceptArchitectV2(initial, success("ARCHITECT", "ARCHITECT"), deliverable(), time(3));
    const blocked = workflowAcceptDesignReviewV2(architect, success("REVIEW", "DESIGN_REVIEW"), {
      verdict: "FINDINGS", findingRefs: ["finding://design-1"],
    }, time(4));
    const replanned = workflowReplanV2(blocked, { nextSubjectCommit: "b".repeat(40), reason: "requirement ambiguity", at: time(5) });
    expect(replanned).toMatchObject({ state: "ARCHITECT_REQUIRED", specRevision: 2, artifacts: [] });
    expect(replanned.invalidatedRevisions[0]?.artifactRefs).toHaveLength(4);
    expect(() => workflowAcceptArchitectV2(replanned, success("ARCHITECT", "ARCHITECT"), deliverable(), time(6)))
      .toThrow(/does not bind the current Task Revision/);
  });

  it("rejects cross-role and tampered projections", () => {
    const initial = createCoreV2Lifecycle({ taskId: "TASK-LIFECYCLE", specRevision: 1, subjectCommit: base, at: time(0) });
    expect(() => workflowAcceptArchitectV2(initial, success("REVIEW", "DESIGN_REVIEW"), deliverable(), time(3))).toThrow(/does not bind/);
    const tampered = { ...initial, state: "IMPLEMENTATION_REQUIRED" as const };
    expect(() => workflowAcceptArchitectV2(tampered, success("ARCHITECT", "ARCHITECT"), deliverable(), time(3))).toThrow(/differs from its digest/);
  });

  it("accepts a candidate checkpoint only after passing Self Review", () => {
    const ready = implementationReady();
    const accepted = workflowAcceptImplementationV2(ready, success("IMPLEMENTATION", "IMPLEMENTATION"), checkpoint("PASSED"), time(5));
    expect(accepted).toMatchObject({ state: "DOCUMENTATION_REQUIRED", candidateCommit: "c".repeat(40), implementationGeneration: 0 });
    expect(accepted.implementationCheckpoints).toHaveLength(1);
    expect(accepted.implementationCheckpoints[0]?.checkpointDigest).toMatch(/^sha256:/);
  });

  it("preserves the failed Generation and requires an explicitly authorized Repair Generation", () => {
    const blocked = workflowAcceptImplementationV2(
      implementationReady(), success("IMPLEMENTATION", "IMPLEMENTATION"), checkpoint("FINDINGS"), time(5),
    );
    expect(blocked.state).toBe("REPAIR_REQUIRED");
    expect(() => workflowAcceptImplementationV2(blocked, success("IMPLEMENTATION", "IMPLEMENTATION"), checkpoint("PASSED"), time(6)))
      .toThrow(/not currently required/);
    const authorized = workflowAuthorizeRepairV2(blocked, { reason: "blocking self-review finding", at: time(6) });
    expect(authorized.implementationGeneration).toBe(1);
    expect(() => workflowAcceptImplementationV2(authorized, success("IMPLEMENTATION", "IMPLEMENTATION"), checkpoint("PASSED"), time(7)))
      .toThrow(/authorized Generation/);
  });

  it("accepts Documentation evidence bound to the Candidate Commit", () => {
    const implemented = workflowAcceptImplementationV2(implementationReady(), success("IMPLEMENTATION", "IMPLEMENTATION"), checkpoint("PASSED"), time(5));
    const documented = workflowAcceptDocumentationV2(implemented, success("DOCUMENTATION", "DOCUMENTATION", "c".repeat(40)), {
      type: "DOCS_IMPACT", routeDigest: sha("8"), reportRef: "artifact://docs-impact",
      dispositions: [{ documentId: "codemap", outcome: "updated", reason: "module changed" }],
    }, time(6));
    expect(documented.state).toBe("TEST_PLAN_REQUIRED");
    expect(documented.artifacts.at(-1)).toMatchObject({ kind: "DOCS_IMPACT", subjectCommit: "c".repeat(40) });
    expect(() => workflowAcceptDocumentationV2(implemented, success("DOCUMENTATION", "DOCUMENTATION"), {
      type: "DOCS_IMPACT", routeDigest: sha("8"), reportRef: "artifact://docs-impact", dispositions: [],
    }, time(6))).toThrow(/does not bind/);
  });

  it("requires Trusted Runner Evidence between Test Plan and Assessment", () => {
    const documented = documentedReady();
    let planned = workflowAcceptTestPlanV2(documented, success("TEST_VERIFICATION", "TEST_PLAN", "c".repeat(40)), testPlan(), time(7));
    expect(planned.state).toBe("TEST_EXECUTION_REQUIRED");
    expect(() => workflowAcceptTestAssessmentV2(planned, success("TEST_VERIFICATION", "TEST_ASSESSMENT", "c".repeat(40)), report("PASS"), time(8)))
      .toThrow(/requires recorded/);
    planned = workflowRecordTrustedTestRunV2(planned, { runId: "run-1", manifestRef: "artifact://test-manifest", manifestDigest: sha("9"), at: time(8) });
    const assessed = workflowAcceptTestAssessmentV2(planned, success("TEST_VERIFICATION", "TEST_ASSESSMENT", "c".repeat(40)), report("PASS"), time(9));
    expect(assessed.state).toBe("FINAL_REVIEW_REQUIRED");
  });

  it("models Trusted Test UNKNOWN and explicit reconcile without a second hidden state machine", () => {
    const planned = workflowAcceptTestPlanV2(documentedReady(), success("TEST_VERIFICATION", "TEST_PLAN", "c".repeat(40)), testPlan(), time(7));
    const waiting = workflowWaitForTestReconcileV2(planned, { token: sha("a"), reason: "intent without manifest", at: time(8) });
    expect(waiting.state).toBe("WAITING_RECONCILE");
    const resumed = workflowResumeTestReconcileV2(waiting, { token: sha("a"), evidence: "trusted ledger", at: time(9) });
    expect(resumed.state).toBe("TEST_EXECUTION_REQUIRED");
    expect(resumed.events.slice(-2).map((event) => event.type)).toEqual(["TrustedTestReconcileRequired", "TrustedTestReconcileResumed"]);
  });

  it("invalidates downstream artifacts when a Test Finding authorizes Repair", () => {
    let projection = workflowAcceptTestPlanV2(documentedReady(), success("TEST_VERIFICATION", "TEST_PLAN", "c".repeat(40)), testPlan(), time(7));
    projection = workflowRecordTrustedTestRunV2(projection, { runId: "run-1", manifestRef: "artifact://test-manifest", manifestDigest: sha("9"), at: time(8) });
    projection = workflowAcceptTestAssessmentV2(projection, success("TEST_VERIFICATION", "TEST_ASSESSMENT", "c".repeat(40)), report("FINDINGS"), time(9));
    const repaired = workflowAuthorizeRepairV2(projection, { reason: "test failed", at: time(10) });
    expect(repaired).toMatchObject({ state: "IMPLEMENTATION_REQUIRED", implementationGeneration: 1, trustedTestRun: null });
    expect(repaired.artifacts.map((artifact) => artifact.kind)).toEqual(["SPEC", "DESIGN", "PLAN", "DESIGN_REVIEW"]);
  });

  it("lets only isolated Final Review plus deterministic Artifact Gate reach Merge", () => {
    const assessed = assessedReady();
    const reviewed = workflowAcceptFinalReviewV2(assessed, success("REVIEW", "FINAL_REVIEW", "c".repeat(40)), { verdict: "PASSED", findingRefs: [] }, time(10));
    expect(reviewed.state).toBe("VERIFICATION_GATE_REQUIRED");
    const gated = workflowPassVerificationGateV2(reviewed, time(11));
    expect(gated.state).toBe("MERGE_REQUIRED");
    expect(gated.verificationGateDigest).toMatch(/^sha256:/);
  });

  it("closes only with a real Merge Receipt distinct from the Candidate Commit", () => {
    const reviewed = workflowAcceptFinalReviewV2(
      assessedReady(), success("REVIEW", "FINAL_REVIEW", "c".repeat(40)), { verdict: "PASSED", findingRefs: [] }, time(10),
    );
    let gated = workflowPassVerificationGateV2(reviewed, time(11));
    gated = workflowRecordKnowledgeDispositionV2(gated, {
      type: "KNOWLEDGE_DISPOSITION", disposition: "none", candidateRefs: [], rationale: "none",
    }, time(12));
    const effectId = `local-merge-effect:${sha("f")}`;
    expect(() => workflowCloseCoreV2(gated, {
      effectId, outcome: "APPLIED", targetRef: "refs/heads/master", mergeCommit: "c".repeat(40),
      reconciledAfterUnknown: false, at: time(13),
    })).toThrow(/distinct from the verified Candidate/);
    const closed = workflowCloseCoreV2(gated, {
      effectId, outcome: "ALREADY_APPLIED", targetRef: "refs/heads/master", mergeCommit: "d".repeat(40),
      reconciledAfterUnknown: true, at: time(13),
    });
    expect(closed).toMatchObject({
      state: "CLOSED", outcome: "SUCCEEDED", candidateCommit: "c".repeat(40), mergeCommit: "d".repeat(40),
      mergeReceipt: { effectId, outcome: "ALREADY_APPLIED", targetRef: "refs/heads/master", reconciledAfterUnknown: true },
    });
    expect(closed.mergeReceipt?.receiptDigest).toMatch(/^sha256:/);
  });

  it("closes and archives a failed Task without re-entering product stages", () => {
    let projection = workflowEnterFailureTerminalV2(implementationReady(), {
      originalStage: "IMPLEMENTATION_REQUIRED", reason: "repair budget exhausted", failedAt: time(5),
      sourceWorkflowRef: "restate://CoreV2Workflow/TASK-LIFECYCLE", sourceProjectionDigest: sha("a"),
      attemptIds: ["TASK-LIFECYCLE.IMPLEMENTATION.r1.g0.a1"], sessionIds: ["session-implementation"],
    });
    expect(projection).toMatchObject({ state: "FAILED_TERMINAL", outcome: "FAILED_TERMINAL" });
    projection = workflowRecordFailureArtifactV2(projection, { artifactRef: "artifact://failure", contentDigest: sha("b"), at: time(6) });
    projection = workflowRecordKnowledgeDispositionV2(projection, {
      type: "KNOWLEDGE_DISPOSITION", disposition: "none", candidateRefs: [], rationale: "none",
    }, time(7));
    projection = workflowCloseFailureV2(projection, { closureArtifactRef: "artifact://closure", closureContentDigest: sha("c"), closedAt: time(8) });
    expect(projection).toMatchObject({ state: "ARCHIVE_PENDING", archive: { status: "PENDING", attempts: 1 } });
    const archived = workflowArchiveFailureV2(projection, { receiptRef: "artifact://archive", receiptDigest: sha("d"), at: time(9) });
    expect(archived).toMatchObject({ state: "CLOSED", outcome: "FAILED_TERMINAL", archive: { status: "ARCHIVED" } });
    expect(archived.events.slice(-6).map((event) => event.type)).toEqual([
      "FailureArtifactRecorded", "KnowledgeDispositionRecorded", "FailureClosureCompleted", "ArchivePending", "TaskClosed", "ArchiveArchived",
    ]);
    expect(() => workflowAcceptImplementationV2(archived, success("IMPLEMENTATION", "IMPLEMENTATION"), checkpoint("PASSED"), time(10)))
      .toThrow(/not currently required/);
  });

  it("retries only a failed Failure Archive with the same Effect identity", () => {
    let projection = failedArchivePending();
    const effectId = projection.archive!.effectId;
    projection = workflowFailFailureArchiveV2(projection, { error: "storage unavailable", at: time(9) });
    expect(projection).toMatchObject({ state: "ARCHIVE_FAILED", archive: { status: "FAILED", attempts: 1 } });
    projection = workflowRetryFailureArchiveV2(projection, { at: time(10) });
    expect(projection).toMatchObject({ state: "ARCHIVE_PENDING", archive: { status: "PENDING", attempts: 2, effectId } });
    expect(() => workflowRetryFailureArchiveV2(projection, { at: time(11) })).toThrow(/Only a failed/);
  });
});

function failedArchivePending() {
  let projection = workflowEnterFailureTerminalV2(implementationReady(), {
    originalStage: "IMPLEMENTATION_REQUIRED", reason: "failed", failedAt: time(5),
    sourceWorkflowRef: "restate://CoreV2Workflow/TASK-LIFECYCLE", sourceProjectionDigest: sha("a"), attemptIds: [], sessionIds: [],
  });
  projection = workflowRecordFailureArtifactV2(projection, { artifactRef: "artifact://failure", contentDigest: sha("b"), at: time(6) });
  projection = workflowRecordKnowledgeDispositionV2(projection, { type: "KNOWLEDGE_DISPOSITION", disposition: "none", candidateRefs: [], rationale: "none" }, time(7));
  return workflowCloseFailureV2(projection, { closureArtifactRef: "artifact://closure", closureContentDigest: sha("c"), closedAt: time(8) });
}

function implementationReady() {
  const initial = createCoreV2Lifecycle({ taskId: "TASK-LIFECYCLE", specRevision: 1, subjectCommit: base, at: time(0) });
  const architect = workflowAcceptArchitectV2(initial, success("ARCHITECT", "ARCHITECT"), deliverable(), time(3));
  return workflowAcceptDesignReviewV2(architect, success("REVIEW", "DESIGN_REVIEW"), { verdict: "PASSED", findingRefs: [] }, time(4));
}

function documentedReady() {
  const implemented = workflowAcceptImplementationV2(implementationReady(), success("IMPLEMENTATION", "IMPLEMENTATION"), checkpoint("PASSED"), time(5));
  return workflowAcceptDocumentationV2(implemented, success("DOCUMENTATION", "DOCUMENTATION", "c".repeat(40)), {
    type: "DOCS_IMPACT", routeDigest: sha("8"), reportRef: "artifact://docs-impact",
    dispositions: [{ documentId: "codemap", outcome: "updated", reason: "changed" }],
  }, time(6));
}

function assessedReady() {
  let projection = workflowAcceptTestPlanV2(documentedReady(), success("TEST_VERIFICATION", "TEST_PLAN", "c".repeat(40)), testPlan(), time(7));
  projection = workflowRecordTrustedTestRunV2(projection, { runId: "run-1", manifestRef: "artifact://test-manifest", manifestDigest: sha("9"), at: time(8) });
  return workflowAcceptTestAssessmentV2(projection, success("TEST_VERIFICATION", "TEST_ASSESSMENT", "c".repeat(40)), report("PASS"), time(9));
}

function testPlan() { return { type: "TEST_PLAN" as const, cases: [{ id: "TC-1", requirementIds: ["REQ-1"], category: "NORMAL" as const, argv: ["node", "--version"] }] }; }
function report(recommendation: "PASS" | "FINDINGS" | "INCONCLUSIVE") { return { type: "TEST_REPORT" as const, candidateCommit: "c".repeat(40),
  outcomes: [{ caseId: "TC-1", status: recommendation === "PASS" ? "PASSED" as const : recommendation === "FINDINGS" ? "FAILED" as const : "UNKNOWN" as const,
    evidenceRefs: ["artifact://test-manifest"] }], recommendation, findingRefs: recommendation === "FINDINGS" ? ["finding://test"] : [] }; }

function checkpoint(verdict: "PASSED" | "FINDINGS") { return {
  candidateCommit: "c".repeat(40), treeDigest: "d".repeat(40), checkpointRef: "artifact://checkpoint",
  testEvidenceRefs: ["artifact://unit-tests"], selfReview: { verdict, findingRefs: verdict === "PASSED" ? [] : ["finding://self-review"] },
}; }

function success(role: AgentRoleV2, phase: RolePhaseV2, subjectCommit = base) {
  const scheduled = createRoleAttemptV2({
    taskId: "TASK-LIFECYCLE", specRevision: 1, role, phase, generation: 0, runnerKind: "CODEX_EXEC",
    inputDigest: sha("1"), subjectCommit, inputArtifactRefs: [], scheduledAt: time(0),
  });
  const running = startRoleAttemptV2(scheduled, time(1));
  return completeRoleAttemptV2(running, createRoleRunEvidenceV2({
    runId: sha(role === "ARCHITECT" ? "2" : "3"), taskId: running.taskId, specRevision: 1, role, phase,
    attemptId: running.attemptId, generation: 0, runnerKind: "CODEX_EXEC", sessionId: `session-${phase}`,
    outcome: "SUCCEEDED", startedAt: time(1), finishedAt: time(2), eventsRef: "a://events", eventsDigest: sha("4"),
    stderrRef: "a://stderr", stderrDigest: sha("5"), outputRef: "a://output", outputDigest: sha("6"),
    manifestRef: "a://manifest", manifestDigest: sha("7"), artifactRefs: [], findingRefs: [],
  }), time(2));
}

function deliverable() { return {
  spec: { type: "SPEC" as const, requirements: [{ id: "REQ-1", statement: "close lifecycle", acceptanceCriteria: ["evidence"] }] },
  design: { type: "DESIGN" as const, decisions: ["workflow owns state"], components: ["core-v2"], risks: ["stale revision"] },
  plan: { type: "PLAN" as const, items: [{ id: "P1", description: "implement", dependsOn: [], status: "PENDING" as const }] },
}; }
function time(n: number) { return `2026-08-23T00:00:${String(n).padStart(2, "0")}.000Z`; }
