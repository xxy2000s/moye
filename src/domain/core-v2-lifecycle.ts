import { createHash } from "node:crypto";

import { MoyeError } from "./errors.js";
import {
  createLifecycleArtifact,
  createLifecycleArtifactGate,
  lifecycleArtifactRef,
  lifecycleReviewSubjectDigest,
} from "./lifecycle-artifact.js";
import type {
  DesignPayload,
  DocsImpactPayload,
  KnowledgeDispositionPayload,
  LifecycleArtifact,
  LifecycleArtifactRef,
  PlanPayload,
  SpecPayload,
  TestPlanPayload,
  TestReportPayload,
} from "./lifecycle-artifact.js";
import { parseRoleAttemptV2 } from "./role-runtime-v2.js";
import type { RoleAttemptV2 } from "./role-runtime-v2.js";
import { assertTaskId } from "./task.js";

export type CoreV2LifecycleState =
  | "ARCHITECT_REQUIRED"
  | "DESIGN_REVIEW_REQUIRED"
  | "REPLAN_REQUIRED"
  | "IMPLEMENTATION_REQUIRED"
  | "REPAIR_REQUIRED"
  | "DOCUMENTATION_REQUIRED"
  | "TEST_PLAN_REQUIRED"
  | "TEST_EXECUTION_REQUIRED"
  | "TEST_ASSESSMENT_REQUIRED"
  | "WAITING_RECONCILE"
  | "FINAL_REVIEW_REQUIRED"
  | "VERIFICATION_GATE_REQUIRED"
  | "MERGE_REQUIRED"
  | "FAILED_TERMINAL"
  | "ARCHIVE_PENDING"
  | "ARCHIVE_FAILED"
  | "CLOSED";

export interface CoreV2LifecycleEvent {
  readonly sequence: number;
  readonly type: string;
  readonly at: string;
  readonly detail: string;
}

export interface InvalidatedRevisionV2 {
  readonly specRevision: number;
  readonly artifactRefs: readonly LifecycleArtifactRef[];
  readonly reason: string;
}

export interface ImplementationCheckpointV2 {
  readonly attemptId: string;
  readonly generation: number;
  readonly baseCommit: string;
  readonly candidateCommit: string;
  readonly treeDigest: string;
  readonly checkpointRef: string;
  readonly testEvidenceRefs: readonly string[];
  readonly selfReview: {
    readonly verdict: "PASSED" | "FINDINGS";
    readonly findingRefs: readonly string[];
  };
  readonly checkpointDigest: string;
}

export interface FailureArtifactV2 {
  readonly originalStage: string;
  readonly reason: string;
  readonly failedAt: string;
  readonly sourceWorkflowRef: string;
  readonly sourceProjectionDigest: string;
  readonly attemptIds: readonly string[];
  readonly sessionIds: readonly string[];
  readonly artifactRef: string | null;
  readonly artifactContentDigest: string | null;
  readonly failureDigest: string;
}

export interface FailureClosureV2 {
  readonly outcome: "FAILED_TERMINAL";
  readonly failureDigest: string;
  readonly knowledgeDispositionDigest: string;
  readonly closureArtifactRef: string;
  readonly closureContentDigest: string;
  readonly closedAt: string;
  readonly closureDigest: string;
}

export interface CoreV2ArchiveV2 {
  readonly status: "PENDING" | "ARCHIVED" | "FAILED";
  readonly effectId: string;
  readonly attempts: number;
  readonly receiptRef: string | null;
  readonly receiptDigest: string | null;
  readonly error: string | null;
}

export interface CoreV2LifecycleProjection {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly subjectCommit: string;
  readonly candidateCommit: string | null;
  readonly implementationGeneration: number;
  readonly state: CoreV2LifecycleState;
  readonly artifacts: readonly LifecycleArtifact[];
  readonly implementationCheckpoints: readonly ImplementationCheckpointV2[];
  readonly trustedTestRun: { readonly runId: string; readonly manifestRef: string; readonly manifestDigest: string } | null;
  readonly verificationGateDigest: string | null;
  readonly knowledgeDispositionDigest: string | null;
  readonly mergeCommit: string | null;
  readonly failure: FailureArtifactV2 | null;
  readonly failureClosure: FailureClosureV2 | null;
  readonly archive: CoreV2ArchiveV2 | null;
  readonly outcome: "SUCCEEDED" | "FAILED_TERMINAL" | null;
  readonly invalidatedRevisions: readonly InvalidatedRevisionV2[];
  readonly events: readonly CoreV2LifecycleEvent[];
  readonly projectionDigest: string;
}

export interface ArchitectDeliverableV2 {
  readonly spec: SpecPayload;
  readonly design: DesignPayload;
  readonly plan: PlanPayload;
}

export function createCoreV2Lifecycle(input: {
  readonly taskId: string;
  readonly specRevision: number;
  readonly subjectCommit: string;
  readonly at: string;
}): CoreV2LifecycleProjection {
  assertTaskId(input.taskId);
  if (!Number.isSafeInteger(input.specRevision) || input.specRevision < 1) throw validation("CORE_V2_REVISION_INVALID", "Spec Revision must be positive");
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(input.subjectCommit)) throw validation("CORE_V2_COMMIT_INVALID", "subjectCommit must be full Git commit id");
  const at = instant(input.at);
  return seal({
    schemaVersion: 1,
    taskId: input.taskId,
    specRevision: input.specRevision,
    subjectCommit: input.subjectCommit,
    candidateCommit: null,
    implementationGeneration: 0,
    state: "ARCHITECT_REQUIRED",
    artifacts: [],
    implementationCheckpoints: [],
    trustedTestRun: null,
    verificationGateDigest: null,
    knowledgeDispositionDigest: null,
    mergeCommit: null,
    failure: null,
    failureClosure: null,
    archive: null,
    outcome: null,
    invalidatedRevisions: [],
    events: [{ sequence: 1, type: "ArchitectRequired", at, detail: `r${input.specRevision}` }],
  });
}

export function workflowAcceptArchitectV2(
  projectionInput: CoreV2LifecycleProjection,
  attemptInput: RoleAttemptV2,
  deliverable: ArchitectDeliverableV2,
  atInput: string,
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "ARCHITECT_REQUIRED") throw conflict("CORE_V2_ARCHITECT_NOT_REQUIRED", "Architect result is not currently required");
  const attempt = successfulAttempt(attemptInput, projection, "ARCHITECT", "ARCHITECT");
  const producer = producerFrom(attempt);
  const spec = createLifecycleArtifact({
    taskId: projection.taskId, specRevision: projection.specRevision, kind: "SPEC",
    subjectCommit: projection.subjectCommit, producer, dependencies: [], payload: deliverable.spec,
  });
  const design = createLifecycleArtifact({
    taskId: projection.taskId, specRevision: projection.specRevision, kind: "DESIGN",
    subjectCommit: projection.subjectCommit, producer, dependencies: [lifecycleArtifactRef(spec)], payload: deliverable.design,
  });
  const plan = createLifecycleArtifact({
    taskId: projection.taskId, specRevision: projection.specRevision, kind: "PLAN",
    subjectCommit: projection.subjectCommit, producer,
    dependencies: [lifecycleArtifactRef(spec), lifecycleArtifactRef(design)], payload: deliverable.plan,
  });
  return next(projection, {
    state: "DESIGN_REVIEW_REQUIRED",
    artifacts: [spec, design, plan],
    type: "ArchitectArtifactsAccepted",
    at: instant(atInput),
    detail: attempt.attemptId,
  });
}

export function workflowAcceptDesignReviewV2(
  projectionInput: CoreV2LifecycleProjection,
  attemptInput: RoleAttemptV2,
  input: { readonly verdict: "PASSED" | "FINDINGS"; readonly findingRefs: readonly string[] },
  atInput: string,
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "DESIGN_REVIEW_REQUIRED") throw conflict("CORE_V2_DESIGN_REVIEW_NOT_REQUIRED", "Design Review is not currently required");
  const attempt = successfulAttempt(attemptInput, projection, "REVIEW", "DESIGN_REVIEW");
  const dependencies = [requiredArtifact(projection, "SPEC"), requiredArtifact(projection, "DESIGN"), requiredArtifact(projection, "PLAN")]
    .map(lifecycleArtifactRef);
  const review = createLifecycleArtifact({
    taskId: projection.taskId, specRevision: projection.specRevision, kind: "DESIGN_REVIEW",
    subjectCommit: projection.subjectCommit, producer: producerFrom(attempt), dependencies,
    payload: {
      type: "DESIGN_REVIEW",
      verdict: input.verdict,
      subjectDigest: lifecycleReviewSubjectDigest(dependencies),
      findingRefs: input.findingRefs,
    },
  });
  return next(projection, {
    state: input.verdict === "PASSED" ? "IMPLEMENTATION_REQUIRED" : "REPLAN_REQUIRED",
    artifacts: [...projection.artifacts, review],
    type: input.verdict === "PASSED" ? "DesignReviewPassed" : "DesignReviewRequestedReplan",
    at: instant(atInput),
    detail: review.artifactDigest,
  });
}

export function workflowAcceptImplementationV2(
  projectionInput: CoreV2LifecycleProjection,
  attemptInput: RoleAttemptV2,
  input: {
    readonly candidateCommit: string;
    readonly treeDigest: string;
    readonly checkpointRef: string;
    readonly testEvidenceRefs: readonly string[];
    readonly selfReview: { readonly verdict: "PASSED" | "FINDINGS"; readonly findingRefs: readonly string[] };
  },
  atInput: string,
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "IMPLEMENTATION_REQUIRED") {
    throw conflict("CORE_V2_IMPLEMENTATION_NOT_REQUIRED", "Implementation result is not currently required");
  }
  if (attemptInput.generation !== projection.implementationGeneration) {
    throw conflict("CORE_V2_IMPLEMENTATION_GENERATION_INVALID", "Implementation Attempt does not match the authorized Generation");
  }
  const attempt = successfulAttempt(
    attemptInput,
    projection,
    "IMPLEMENTATION",
    "IMPLEMENTATION",
    projection.candidateCommit ?? projection.subjectCommit,
  );
  const checkpointCore = {
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    baseCommit: attempt.subjectCommit,
    candidateCommit: commit(input.candidateCommit, "candidateCommit"),
    treeDigest: gitObject(input.treeDigest, "treeDigest"),
    checkpointRef: required(input.checkpointRef, "checkpointRef"),
    testEvidenceRefs: stableRefs(input.testEvidenceRefs, "testEvidenceRefs"),
    selfReview: {
      verdict: choice(input.selfReview.verdict, ["PASSED", "FINDINGS"] as const, "selfReview.verdict"),
      findingRefs: stableRefs(input.selfReview.findingRefs, "selfReview.findingRefs"),
    },
  };
  if (checkpointCore.candidateCommit === checkpointCore.baseCommit) {
    throw conflict("CORE_V2_CANDIDATE_UNCHANGED", "Implementation must produce a distinct Candidate Commit");
  }
  if (checkpointCore.selfReview.verdict === "FINDINGS" && checkpointCore.selfReview.findingRefs.length === 0) {
    throw validation("CORE_V2_FINDING_REQUIRED", "FINDINGS requires at least one Finding reference");
  }
  const checkpoint = deepFreeze({ ...checkpointCore, checkpointDigest: digest(checkpointCore) });
  return seal({
    ...withoutDigest(projection),
    candidateCommit: checkpoint.candidateCommit,
    state: checkpoint.selfReview.verdict === "PASSED" ? "DOCUMENTATION_REQUIRED" : "REPAIR_REQUIRED",
    implementationCheckpoints: [...projection.implementationCheckpoints, checkpoint],
    events: append(
      projection.events,
      checkpoint.selfReview.verdict === "PASSED" ? "ImplementationAccepted" : "ImplementationRepairRequired",
      instant(atInput),
      checkpoint.checkpointDigest,
    ),
  });
}

export function workflowAuthorizeRepairV2(
  projectionInput: CoreV2LifecycleProjection,
  input: { readonly reason: string; readonly at: string },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "REPAIR_REQUIRED") throw conflict("CORE_V2_REPAIR_NOT_REQUIRED", "REPAIR requires blocking Implementation Findings");
  const reason = required(input.reason, "reason");
  return seal({
    ...withoutDigest(projection),
    state: "IMPLEMENTATION_REQUIRED",
    implementationGeneration: projection.implementationGeneration + 1,
    artifacts: projection.artifacts.filter((artifact) => ["SPEC", "DESIGN", "PLAN", "DESIGN_REVIEW"].includes(artifact.kind)),
    trustedTestRun: null,
    verificationGateDigest: null,
    knowledgeDispositionDigest: null,
    mergeCommit: null,
    outcome: null,
    events: append(projection.events, "ImplementationRepairAuthorized", instant(input.at), `g${projection.implementationGeneration + 1}:${reason}`),
  });
}

export function workflowRequestRepairV2(
  projectionInput: CoreV2LifecycleProjection,
  input: { readonly reason: string; readonly at: string },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "DOCUMENTATION_REQUIRED") throw conflict("CORE_V2_REPAIR_REQUEST_INVALID", "Only a blocking Documentation result can request Repair directly");
  return seal({ ...withoutDigest(projection), state: "REPAIR_REQUIRED",
    events: append(projection.events, "DocumentationRequestedRepair", instant(input.at), required(input.reason, "reason")) });
}

export function workflowWaitForTestReconcileV2(
  projectionInput: CoreV2LifecycleProjection,
  input: { readonly token: string; readonly reason: string; readonly at: string },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "TEST_EXECUTION_REQUIRED") throw conflict("CORE_V2_TEST_RECONCILE_NOT_REQUIRED", "Only an unknown Trusted Test effect can wait for reconcile");
  return seal({ ...withoutDigest(projection), state: "WAITING_RECONCILE",
    events: append(projection.events, "TrustedTestReconcileRequired", instant(input.at), `${required(input.token, "token")}:${required(input.reason, "reason")}`) });
}

export function workflowResumeTestReconcileV2(
  projectionInput: CoreV2LifecycleProjection,
  input: { readonly token: string; readonly evidence: string; readonly at: string },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "WAITING_RECONCILE") throw conflict("CORE_V2_TEST_RECONCILE_NOT_WAITING", "Trusted Test is not waiting for reconcile");
  return seal({ ...withoutDigest(projection), state: "TEST_EXECUTION_REQUIRED",
    events: append(projection.events, "TrustedTestReconcileResumed", instant(input.at), `${required(input.token, "token")}:${required(input.evidence, "evidence")}`) });
}

export function workflowAcceptDocumentationV2(
  projectionInput: CoreV2LifecycleProjection,
  attemptInput: RoleAttemptV2,
  payload: DocsImpactPayload,
  atInput: string,
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "DOCUMENTATION_REQUIRED" || projection.candidateCommit === null) {
    throw conflict("CORE_V2_DOCUMENTATION_NOT_REQUIRED", "Documentation result is not currently required");
  }
  const attempt = successfulAttempt(attemptInput, projection, "DOCUMENTATION", "DOCUMENTATION", projection.candidateCommit);
  if (attempt.generation !== projection.implementationGeneration) {
    throw conflict("CORE_V2_DOCUMENTATION_GENERATION_INVALID", "Documentation Attempt does not match the active Implementation Generation");
  }
  const dependencies = [requiredArtifact(projection, "SPEC"), requiredArtifact(projection, "DESIGN")].map(lifecycleArtifactRef);
  const artifact = createLifecycleArtifact({
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    kind: "DOCS_IMPACT",
    subjectCommit: projection.candidateCommit,
    producer: { role: "DOCUMENTATION", phase: attempt.phase, attemptId: attempt.attemptId, generation: attempt.generation, sessionId: attempt.run!.sessionId! },
    dependencies,
    payload,
  });
  return next(projection, {
    state: "TEST_PLAN_REQUIRED",
    artifacts: [...projection.artifacts, artifact],
    type: "DocumentationGateAccepted",
    at: instant(atInput),
    detail: artifact.artifactDigest,
  });
}

export function workflowAcceptTestPlanV2(
  projectionInput: CoreV2LifecycleProjection,
  attemptInput: RoleAttemptV2,
  payload: TestPlanPayload,
  atInput: string,
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "TEST_PLAN_REQUIRED" || projection.candidateCommit === null) throw conflict("CORE_V2_TEST_PLAN_NOT_REQUIRED", "Test Plan is not currently required");
  const attempt = successfulAttempt(attemptInput, projection, "TEST_VERIFICATION", "TEST_PLAN", projection.candidateCommit);
  if (attempt.generation !== projection.implementationGeneration) throw conflict("CORE_V2_TEST_GENERATION_INVALID", "Test Plan does not match Implementation Generation");
  const dependencies = [requiredArtifact(projection, "SPEC"), requiredArtifact(projection, "DESIGN")].map(lifecycleArtifactRef);
  const artifact = createLifecycleArtifact({ taskId: projection.taskId, specRevision: projection.specRevision, kind: "TEST_PLAN",
    subjectCommit: projection.candidateCommit, producer: producerFromTest(attempt), dependencies, payload });
  return next(projection, { state: "TEST_EXECUTION_REQUIRED", artifacts: [...projection.artifacts, artifact], type: "TestPlanAccepted", at: instant(atInput), detail: artifact.artifactDigest });
}

export function workflowRecordTrustedTestRunV2(
  projectionInput: CoreV2LifecycleProjection,
  input: { readonly runId: string; readonly manifestRef: string; readonly manifestDigest: string; readonly at: string },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "TEST_EXECUTION_REQUIRED") throw conflict("CORE_V2_TEST_EXECUTION_NOT_REQUIRED", "Trusted Test execution is not currently required");
  const trustedTestRun = { runId: required(input.runId, "runId"), manifestRef: required(input.manifestRef, "manifestRef"), manifestDigest: sha(input.manifestDigest, "manifestDigest") };
  return seal({ ...withoutDigest(projection), state: "TEST_ASSESSMENT_REQUIRED", trustedTestRun,
    events: append(projection.events, "TrustedTestRunRecorded", instant(input.at), trustedTestRun.manifestDigest) });
}

export function workflowAcceptTestAssessmentV2(
  projectionInput: CoreV2LifecycleProjection,
  attemptInput: RoleAttemptV2,
  payload: TestReportPayload,
  atInput: string,
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "TEST_ASSESSMENT_REQUIRED" || projection.candidateCommit === null || projection.trustedTestRun === null) {
    throw conflict("CORE_V2_TEST_ASSESSMENT_NOT_REQUIRED", "Test Assessment requires recorded Trusted Runner Evidence");
  }
  const attempt = successfulAttempt(attemptInput, projection, "TEST_VERIFICATION", "TEST_ASSESSMENT", projection.candidateCommit);
  if (attempt.generation !== projection.implementationGeneration || !payload.outcomes.every((item) => item.evidenceRefs.includes(projection.trustedTestRun!.manifestRef))) {
    throw conflict("CORE_V2_TEST_EVIDENCE_BINDING_INVALID", "Test Report outcomes must bind the Trusted Runner Manifest");
  }
  const plan = requiredArtifact(projection, "TEST_PLAN");
  const artifact = createLifecycleArtifact({ taskId: projection.taskId, specRevision: projection.specRevision, kind: "TEST_REPORT",
    subjectCommit: projection.candidateCommit, producer: producerFromTest(attempt), dependencies: [lifecycleArtifactRef(plan)], payload });
  const state = payload.recommendation === "PASS" ? "FINAL_REVIEW_REQUIRED" : payload.recommendation === "FINDINGS" ? "REPAIR_REQUIRED" : "WAITING_RECONCILE";
  return next(projection, { state, artifacts: [...projection.artifacts, artifact], type: state === "FINAL_REVIEW_REQUIRED" ? "TestVerificationPassed" : state === "REPAIR_REQUIRED" ? "TestVerificationRequestedRepair" : "TestVerificationUnknown", at: instant(atInput), detail: artifact.artifactDigest });
}

export function workflowAcceptFinalReviewV2(
  projectionInput: CoreV2LifecycleProjection,
  attemptInput: RoleAttemptV2,
  input: { readonly verdict: "PASSED" | "FINDINGS"; readonly findingRefs: readonly string[] },
  atInput: string,
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "FINAL_REVIEW_REQUIRED" || projection.candidateCommit === null) throw conflict("CORE_V2_FINAL_REVIEW_NOT_REQUIRED", "Final Review is not currently required");
  const attempt = successfulAttempt(attemptInput, projection, "REVIEW", "FINAL_REVIEW", projection.candidateCommit);
  const dependencies = [requiredArtifact(projection, "DOCS_IMPACT"), requiredArtifact(projection, "TEST_REPORT")].map(lifecycleArtifactRef);
  const artifact = createLifecycleArtifact({ taskId: projection.taskId, specRevision: projection.specRevision, kind: "FINAL_REVIEW",
    subjectCommit: projection.candidateCommit, producer: { role: "REVIEW", phase: attempt.phase, attemptId: attempt.attemptId, generation: attempt.generation, sessionId: attempt.run!.sessionId! }, dependencies,
    payload: { type: "FINAL_REVIEW", verdict: input.verdict, subjectDigest: lifecycleReviewSubjectDigest(dependencies), findingRefs: input.findingRefs } });
  return next(projection, { state: input.verdict === "PASSED" ? "VERIFICATION_GATE_REQUIRED" : "REPAIR_REQUIRED", artifacts: [...projection.artifacts, artifact],
    type: input.verdict === "PASSED" ? "FinalReviewPassed" : "FinalReviewRequestedRepair", at: instant(atInput), detail: artifact.artifactDigest });
}

export function workflowPassVerificationGateV2(projectionInput: CoreV2LifecycleProjection, atInput: string): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "VERIFICATION_GATE_REQUIRED") throw conflict("CORE_V2_GATE_NOT_REQUIRED", "Verification Gate is not currently required");
  const requiredKinds = ["SPEC", "DESIGN", "PLAN", "DESIGN_REVIEW", "DOCS_IMPACT", "TEST_PLAN", "TEST_REPORT", "FINAL_REVIEW"] as const;
  const artifacts = requiredKinds.map((kind) => requiredArtifact(projection, kind));
  const gate = createLifecycleArtifactGate({ taskId: projection.taskId, specRevision: projection.specRevision,
    requirements: artifacts.map((artifact) => ({ kind: artifact.kind, artifactDigest: artifact.artifactDigest, subjectCommit: artifact.subjectCommit })), artifacts });
  return seal({ ...withoutDigest(projection), state: "MERGE_REQUIRED", verificationGateDigest: gate.gateDigest,
    events: append(projection.events, "VerificationGatePassed", instant(atInput), gate.gateDigest) });
}

export function workflowRecordKnowledgeDispositionV2(
  projectionInput: CoreV2LifecycleProjection,
  payload: KnowledgeDispositionPayload,
  atInput: string,
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.knowledgeDispositionDigest !== null) throw conflict("CORE_V2_KNOWLEDGE_ALREADY_DISPOSED", "Knowledge Disposition is append-only");
  const artifact = createLifecycleArtifact({ taskId: projection.taskId, specRevision: projection.specRevision, kind: "KNOWLEDGE_DISPOSITION",
    subjectCommit: projection.candidateCommit ?? projection.subjectCommit,
    producer: { role: "WORKFLOW", phase: "KNOWLEDGE_DISPOSITION", attemptId: `${projection.taskId}.KNOWLEDGE.r${projection.specRevision}.g0`, generation: 0, sessionId: "workflow" },
    dependencies: [], payload });
  return seal({ ...withoutDigest(projection), artifacts: [...projection.artifacts, artifact], knowledgeDispositionDigest: artifact.artifactDigest,
    events: append(projection.events, "KnowledgeDispositionRecorded", instant(atInput), `${payload.disposition}:${artifact.artifactDigest}`) });
}

export function workflowEnterFailureTerminalV2(
  projectionInput: CoreV2LifecycleProjection,
  input: {
    readonly originalStage: string;
    readonly reason: string;
    readonly failedAt: string;
    readonly sourceWorkflowRef: string;
    readonly sourceProjectionDigest: string;
    readonly attemptIds: readonly string[];
    readonly sessionIds: readonly string[];
  },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (["FAILED_TERMINAL", "ARCHIVE_PENDING", "ARCHIVE_FAILED", "CLOSED"].includes(projection.state)) {
    throw conflict("CORE_V2_FAILURE_TERMINAL_ALREADY_ENTERED", "Failure terminal facts are append-only");
  }
  const failedAt = instant(input.failedAt);
  const core = {
    originalStage: required(input.originalStage, "originalStage"),
    reason: required(input.reason, "reason"),
    failedAt,
    sourceWorkflowRef: required(input.sourceWorkflowRef, "sourceWorkflowRef"),
    sourceProjectionDigest: sha(input.sourceProjectionDigest, "sourceProjectionDigest"),
    attemptIds: stableRefs(input.attemptIds, "attemptIds"),
    sessionIds: stableRefs(input.sessionIds, "sessionIds"),
    artifactRef: null,
    artifactContentDigest: null,
  };
  const failure = deepFreeze({ ...core, failureDigest: digest(core) });
  return seal({
    ...withoutDigest(projection),
    state: "FAILED_TERMINAL",
    failure,
    outcome: "FAILED_TERMINAL",
    events: append(
      append(projection.events, "WorkflowFailedTerminal", failedAt, `${failure.originalStage}:${failure.reason}`),
      "FailureClosureStarted",
      failedAt,
      failure.failureDigest,
    ),
  });
}

export function workflowRecordFailureArtifactV2(
  projectionInput: CoreV2LifecycleProjection,
  input: { readonly artifactRef: string; readonly contentDigest: string; readonly at: string },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "FAILED_TERMINAL" || projection.failure === null || projection.failure.artifactRef !== null) {
    throw conflict("CORE_V2_FAILURE_ARTIFACT_NOT_REQUIRED", "Failure Artifact is not currently required");
  }
  const failure = deepFreeze({
    ...projection.failure,
    artifactRef: required(input.artifactRef, "artifactRef"),
    artifactContentDigest: sha(input.contentDigest, "contentDigest"),
  });
  return seal({
    ...withoutDigest(projection),
    failure,
    events: append(projection.events, "FailureArtifactRecorded", instant(input.at), failure.artifactContentDigest!),
  });
}

export function workflowCloseFailureV2(
  projectionInput: CoreV2LifecycleProjection,
  input: {
    readonly closureArtifactRef: string;
    readonly closureContentDigest: string;
    readonly closedAt: string;
  },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "FAILED_TERMINAL" || projection.failure?.artifactRef === null ||
      projection.failure === null || projection.knowledgeDispositionDigest === null) {
    throw conflict("CORE_V2_FAILURE_CLOSURE_GATE_FAILED", "Failure Closure requires frozen Failure Artifact and Knowledge Disposition");
  }
  const closedAt = instant(input.closedAt);
  const closureCore = {
    outcome: "FAILED_TERMINAL" as const,
    failureDigest: projection.failure.failureDigest,
    knowledgeDispositionDigest: projection.knowledgeDispositionDigest,
    closureArtifactRef: required(input.closureArtifactRef, "closureArtifactRef"),
    closureContentDigest: sha(input.closureContentDigest, "closureContentDigest"),
    closedAt,
  };
  const failureClosure = deepFreeze({ ...closureCore, closureDigest: digest(closureCore) });
  const effectId = digest({ namespace: "core-v2-failure-archive", taskId: projection.taskId, specRevision: projection.specRevision, closureDigest: failureClosure.closureDigest });
  return seal({
    ...withoutDigest(projection),
    state: "ARCHIVE_PENDING",
    failureClosure,
    archive: { status: "PENDING", effectId, attempts: 1, receiptRef: null, receiptDigest: null, error: null },
    events: append(
      append(projection.events, "FailureClosureCompleted", closedAt, failureClosure.closureDigest),
      "ArchivePending",
      closedAt,
      effectId,
    ),
  });
}

export function workflowArchiveFailureV2(
  projectionInput: CoreV2LifecycleProjection,
  input: { readonly receiptRef: string; readonly receiptDigest: string; readonly at: string },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "ARCHIVE_PENDING" || projection.archive?.status !== "PENDING" || projection.failureClosure === null) {
    throw conflict("CORE_V2_FAILURE_ARCHIVE_NOT_PENDING", "Failure Archive is not pending");
  }
  const at = instant(input.at);
  const archive: CoreV2ArchiveV2 = deepFreeze({
    ...projection.archive,
    status: "ARCHIVED",
    receiptRef: required(input.receiptRef, "receiptRef"),
    receiptDigest: sha(input.receiptDigest, "receiptDigest"),
    error: null,
  });
  return seal({
    ...withoutDigest(projection),
    state: "CLOSED",
    archive,
    events: append(append(projection.events, "TaskClosed", at, "FAILED_TERMINAL"), "ArchiveArchived", at, archive.receiptDigest!),
  });
}

export function workflowFailFailureArchiveV2(
  projectionInput: CoreV2LifecycleProjection,
  input: { readonly error: string; readonly at: string },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "ARCHIVE_PENDING" || projection.archive?.status !== "PENDING") {
    throw conflict("CORE_V2_FAILURE_ARCHIVE_NOT_PENDING", "Failure Archive is not pending");
  }
  const archive: CoreV2ArchiveV2 = deepFreeze({ ...projection.archive, status: "FAILED", error: required(input.error, "error") });
  return seal({ ...withoutDigest(projection), state: "ARCHIVE_FAILED", archive,
    events: append(projection.events, "ArchiveFailed", instant(input.at), archive.error!) });
}

export function workflowRetryFailureArchiveV2(
  projectionInput: CoreV2LifecycleProjection,
  input: { readonly at: string },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "ARCHIVE_FAILED" || projection.archive?.status !== "FAILED") {
    throw conflict("CORE_V2_FAILURE_ARCHIVE_RETRY_INVALID", "Only a failed Failure Archive can be retried");
  }
  const archive: CoreV2ArchiveV2 = deepFreeze({ ...projection.archive, status: "PENDING", attempts: projection.archive.attempts + 1, error: null });
  return seal({ ...withoutDigest(projection), state: "ARCHIVE_PENDING", archive,
    events: append(projection.events, "ArchiveRetryStarted", instant(input.at), archive.effectId) });
}

export function workflowCloseCoreV2(
  projectionInput: CoreV2LifecycleProjection,
  input: { readonly mergeCommit: string; readonly at: string },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "MERGE_REQUIRED" || projection.verificationGateDigest === null || projection.knowledgeDispositionDigest === null || projection.candidateCommit === null) {
    throw conflict("CORE_V2_CLOSURE_GATE_FAILED", "Closure requires Merge state, Verification Gate and Knowledge Disposition");
  }
  if (commit(input.mergeCommit, "mergeCommit") !== projection.candidateCommit) throw conflict("CORE_V2_MERGE_COMMIT_MISMATCH", "Merge commit must equal verified Candidate Commit");
  const at = instant(input.at);
  const events = append(append(append(projection.events, "MergeConfirmed", at, input.mergeCommit), "TaskClosed", at, "SUCCEEDED"), "ArchiveArchived", at, projection.taskId);
  return seal({ ...withoutDigest(projection), state: "CLOSED", mergeCommit: input.mergeCommit, outcome: "SUCCEEDED", events });
}

export function workflowReplanV2(
  projectionInput: CoreV2LifecycleProjection,
  input: { readonly nextSubjectCommit: string; readonly reason: string; readonly at: string },
): CoreV2LifecycleProjection {
  const projection = parseProjection(projectionInput);
  if (projection.state !== "REPLAN_REQUIRED") throw conflict("CORE_V2_REPLAN_NOT_REQUIRED", "REPLAN requires a blocking Design Review");
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(input.nextSubjectCommit)) throw validation("CORE_V2_COMMIT_INVALID", "nextSubjectCommit must be full Git commit id");
  const reason = required(input.reason, "reason");
  const invalidated = {
    specRevision: projection.specRevision,
    artifactRefs: projection.artifacts.map(lifecycleArtifactRef),
    reason,
  };
  return seal({
    ...withoutDigest(projection),
    specRevision: projection.specRevision + 1,
    subjectCommit: input.nextSubjectCommit,
    candidateCommit: null,
    implementationGeneration: 0,
    state: "ARCHITECT_REQUIRED",
    artifacts: [],
    implementationCheckpoints: [],
    trustedTestRun: null,
    verificationGateDigest: null,
    knowledgeDispositionDigest: null,
    mergeCommit: null,
    failure: null,
    failureClosure: null,
    archive: null,
    outcome: null,
    invalidatedRevisions: [...projection.invalidatedRevisions, invalidated],
    events: append(projection.events, "SpecRevisionReplanned", instant(input.at), `r${projection.specRevision + 1}:${reason}`),
  });
}

function successfulAttempt(
  input: RoleAttemptV2,
  projection: CoreV2LifecycleProjection,
  role: "ARCHITECT" | "IMPLEMENTATION" | "DOCUMENTATION" | "TEST_VERIFICATION" | "REVIEW",
  phase: "ARCHITECT" | "IMPLEMENTATION" | "DOCUMENTATION" | "TEST_PLAN" | "TEST_ASSESSMENT" | "DESIGN_REVIEW" | "FINAL_REVIEW",
  expectedCommit = projection.subjectCommit,
): RoleAttemptV2 {
  const attempt = parseRoleAttemptV2(JSON.parse(JSON.stringify(input)), input.attemptDigest);
  if (attempt.state !== "SUCCEEDED" || attempt.run?.outcome !== "SUCCEEDED" || attempt.run.sessionId === undefined ||
      attempt.taskId !== projection.taskId || attempt.specRevision !== projection.specRevision ||
      attempt.subjectCommit !== expectedCommit || attempt.role !== role || attempt.phase !== phase) {
    throw conflict("CORE_V2_ROLE_RESULT_BINDING_INVALID", `${role}/${phase} Attempt does not bind the current Task Revision`);
  }
  return attempt;
}

function producerFrom(attempt: RoleAttemptV2) {
  return { role: attempt.role as "ARCHITECT" | "REVIEW", phase: attempt.phase, attemptId: attempt.attemptId, generation: attempt.generation, sessionId: attempt.run!.sessionId! };
}

function producerFromTest(attempt: RoleAttemptV2) {
  return { role: "TEST_VERIFICATION" as const, phase: attempt.phase, attemptId: attempt.attemptId, generation: attempt.generation, sessionId: attempt.run!.sessionId! };
}

function requiredArtifact(projection: CoreV2LifecycleProjection, kind: "SPEC" | "DESIGN" | "PLAN" | "DESIGN_REVIEW" | "DOCS_IMPACT" | "TEST_PLAN" | "TEST_REPORT" | "FINAL_REVIEW"): LifecycleArtifact {
  const artifact = projection.artifacts.find((item) => item.kind === kind);
  if (artifact === undefined) throw conflict("CORE_V2_ARTIFACT_MISSING", `${kind} Artifact is missing`);
  return artifact;
}

function next(projection: CoreV2LifecycleProjection, change: {
  state: CoreV2LifecycleState; artifacts: LifecycleArtifact[]; type: string; at: string; detail: string;
}): CoreV2LifecycleProjection {
  return seal({ ...withoutDigest(projection), state: change.state, artifacts: change.artifacts, events: append(projection.events, change.type, change.at, change.detail) });
}

function parseProjection(input: CoreV2LifecycleProjection): CoreV2LifecycleProjection {
  const { projectionDigest, ...core } = JSON.parse(JSON.stringify(input)) as CoreV2LifecycleProjection;
  if (digest(core) !== projectionDigest) throw conflict("CORE_V2_PROJECTION_INTEGRITY_FAILED", "Lifecycle Projection differs from its digest");
  return input;
}

export function parseCoreV2LifecycleV2(input: CoreV2LifecycleProjection): CoreV2LifecycleProjection { return parseProjection(input); }

function seal(core: Omit<CoreV2LifecycleProjection, "projectionDigest">): CoreV2LifecycleProjection {
  return deepFreeze({ ...core, projectionDigest: digest(core) });
}
function withoutDigest(value: CoreV2LifecycleProjection): Omit<CoreV2LifecycleProjection, "projectionDigest"> { const { projectionDigest: _, ...core } = value; return core; }
function append(events: readonly CoreV2LifecycleEvent[], type: string, at: string, detail: string): CoreV2LifecycleEvent[] { return [...events, { sequence: events.length + 1, type, at, detail }]; }
function instant(value: string): string { if (Number.isNaN(Date.parse(value))) throw validation("CORE_V2_TIME_INVALID", "time is invalid"); return value; }
function required(value: string, field: string): string { if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw validation("CORE_V2_STRING_REQUIRED", `${field} is required`); return value; }
function commit(value: string, field: string): string { if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)) throw validation("CORE_V2_COMMIT_INVALID", `${field} must be a full Git commit id`); return value; }
function gitObject(value: string, field: string): string { if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)) throw validation("CORE_V2_GIT_OBJECT_INVALID", `${field} must be a full Git object id`); return value; }
function stableRefs(values: readonly string[], field: string): string[] { if (!Array.isArray(values)) throw validation("CORE_V2_REFS_INVALID", `${field} must be an array`); const refs = values.map((value) => required(value, field)).sort(); if (new Set(refs).size !== refs.length) throw validation("CORE_V2_REFS_DUPLICATE", `${field} must be unique`); return refs; }
function sha(value: string, field: string): string { if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw validation("CORE_V2_DIGEST_INVALID", `${field} must be SHA-256`); return value; }
function choice<const T extends readonly string[]>(value: string, values: T, field: string): T[number] { if (!values.includes(value)) throw validation("CORE_V2_ENUM_INVALID", `${field} is invalid`); return value as T[number]; }
function digest(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
function deepFreeze<T>(value: T): T { if (typeof value === "object" && value !== null && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); } return value; }
function validation(code: string, message: string): MoyeError { return new MoyeError({ code, category: "VALIDATION", message }); }
function conflict(code: string, message: string): MoyeError { return new MoyeError({ code, category: "CONFLICT", message }); }
