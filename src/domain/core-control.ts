import { createHash } from "node:crypto";

import type { TaskEnvelope } from "./coding-task.js";
import { parseTaskEnvelope } from "./coding-task.js";
import type { CoreDocsImpactGateResult } from "./core-docs-impact.js";
import { assertTrustedCoreDocsImpactGateResult } from "./core-docs-impact.js";
import { MoyeError, type MoyeErrorCategory } from "./errors.js";
import type { ReviewGateResult } from "./review-finding.js";
import { assertTrustedReviewGateResult } from "./review-finding.js";
import { assertTaskId } from "./task.js";

export const CORE_ROLES = Object.freeze(["DOCS", "IMPLEMENTATION", "REVIEW"] as const);
export type CoreRole = (typeof CORE_ROLES)[number];

export const CONTROL_ACTIONS = Object.freeze([
  "RETRY",
  "REPAIR",
  "REPLAN",
  "SCHEDULE_ROLE",
  "WAIT",
  "CLOSE",
] as const);
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export type CoreControlState = "RUNNING" | "WAITING_RECONCILE" | "WAITING_HUMAN" | "CLOSING" | "CLOSED";
export type CoreControlStage =
  | "DOCS_REQUIRED"
  | "DOCS_RUNNING"
  | "IMPLEMENTATION_REQUIRED"
  | "IMPLEMENTATION_RUNNING"
  | "REVIEW_REQUIRED"
  | "REVIEW_RUNNING"
  | "REVIEW_GATE_REQUIRED"
  | "REPAIR_REQUIRED"
  | "VERIFICATION_REQUIRED"
  | "DOCS_IMPACT_REQUIRED"
  | "CLOSURE_REQUIRED"
  | "CLOSED";

export interface CoreBudgetInput {
  readonly operationRetries: number;
  readonly roleAttempts: number;
  readonly repairs: number;
  readonly replans: number;
  readonly modelCalls: number;
  readonly totalTimeMs: number;
}

export interface CoreBudgetRequestInput {
  readonly operationRetries?: number;
  readonly roleAttempts?: number;
  readonly repairs?: number;
  readonly replans?: number;
  readonly modelCalls?: number;
  readonly totalTimeMs?: number;
}

export interface CoreBudget {
  readonly operationRetriesRemaining: number;
  readonly roleAttemptsRemaining: number;
  readonly repairsRemaining: number;
  readonly replansRemaining: number;
  readonly modelCallsRemaining: number;
  readonly totalTimeRemainingMs: number;
}

export interface CoreBudgetRequest {
  readonly operationRetries: number;
  readonly roleAttempts: number;
  readonly repairs: number;
  readonly replans: number;
  readonly modelCalls: number;
  readonly totalTimeMs: number;
}

export interface ControlDecisionInput {
  readonly taskId: string;
  readonly specRevision: number;
  readonly expectedProjectionVersion: number;
  readonly expectedState: CoreControlState;
  readonly action: ControlAction;
  readonly targetRole?: CoreRole;
  readonly operationId?: string;
  readonly sourceFindingRefs?: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly reason: string;
  readonly budgetRequest?: CoreBudgetRequestInput;
}

export interface ControlDecision {
  readonly schemaVersion: 1;
  readonly decisionId: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly expectedProjectionVersion: number;
  readonly expectedState: CoreControlState;
  readonly action: ControlAction;
  readonly targetRole: CoreRole | null;
  readonly operationId: string | null;
  readonly sourceFindingRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly reason: string;
  readonly budgetRequest: CoreBudgetRequest;
  readonly decisionDigest: string;
}

export interface AppliedControlDecision {
  readonly decisionId: string;
  readonly decisionDigest: string;
  readonly appliedAtProjectionVersion: number;
  readonly action: ControlAction;
}

export interface PendingRoleDispatch {
  readonly dispatchId: string;
  readonly decisionId: string;
  readonly role: CoreRole;
  readonly generation: number;
  readonly inputDigest: string;
}

export interface RoleDispatchCompletionInput {
  readonly dispatchId: string;
  readonly role: CoreRole;
  readonly attemptId: string;
  readonly attemptGeneration: number;
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly outcome: "SUCCEEDED";
}

export interface CompletedRoleDispatch extends RoleDispatchCompletionInput {
  readonly completedAtProjectionVersion: number;
}

export interface AppliedReviewGate {
  readonly gateDigest: string;
  readonly roleRunResultDigest: string;
  readonly reviewResultDigest: string;
  readonly candidateCommit: string;
  readonly verdict: "PASSED" | "BLOCKED";
  readonly unresolvedBlockingFindingRefs: readonly string[];
  readonly appliedAtProjectionVersion: number;
}

export interface RoleAttemptFailureInput {
  readonly dispatchId: string;
  readonly role: CoreRole;
  readonly attemptId: string;
  readonly attemptGeneration: number;
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly outcome: "FAILED" | "INVALID_OUTPUT";
  readonly errorCode: string;
  readonly errorCategory: MoyeErrorCategory;
}

export interface RoleAttemptFailure extends RoleAttemptFailureInput {
  readonly failureDigest: string;
  readonly recordedAtProjectionVersion: number;
}

export interface RecoveryActionRecord {
  readonly decisionId: string;
  readonly action: "OPERATION_RETRY" | "ROLE_ATTEMPT_RETRY" | "REPAIR" | "REPLAN";
  readonly targetRole: CoreRole | null;
  readonly sourceRefs: readonly string[];
  readonly appliedAtProjectionVersion: number;
}

export interface UnknownEffectInput {
  readonly effectId: string;
  readonly operationId: string;
  readonly evidenceRefs: readonly string[];
  readonly reason: string;
}

export interface PendingReconcile extends UnknownEffectInput {
  readonly waitDigest: string;
  readonly enteredAtProjectionVersion: number;
}

export interface ReconcileInput {
  readonly expectedWaitDigest: string;
  readonly outcome: "CONFIRMED" | "NOT_APPLIED";
  readonly evidenceRefs: readonly string[];
}

export interface ReconcileRecord {
  readonly waitDigest: string;
  readonly operationId: string;
  readonly outcome: "CONFIRMED" | "NOT_APPLIED";
  readonly evidenceRefs: readonly string[];
  readonly reconcileDigest: string;
  readonly appliedAtProjectionVersion: number;
}

export interface EvidenceInvalidation {
  readonly invalidationId: string;
  readonly fromSpecRevision: number;
  readonly toSpecRevision: number;
  readonly invalidatedRefs: readonly string[];
  readonly reason: string;
  readonly appliedAtProjectionVersion: number;
}

export interface CoreTerminalCandidate {
  readonly candidateId: string;
  readonly outcome: "FAILED_TERMINAL";
  readonly reason: "BUDGET_EXHAUSTED";
  readonly evidenceRefs: readonly string[];
  readonly candidateDigest: string;
  readonly createdAtProjectionVersion: number;
}

export interface CoreVerificationResultInput {
  readonly taskId: string;
  readonly specRevision: number;
  readonly candidateCommit: string;
  readonly evidenceRefs: readonly string[];
}

export interface CoreVerificationResult extends CoreVerificationResultInput {
  readonly schemaVersion: 1;
  readonly verdict: "PASSED";
  readonly verificationDigest: string;
}

export interface AppliedDocsImpactGate {
  readonly gateDigest: string;
  readonly routeDigest: string;
  readonly reportDigest: string;
  readonly verdict: "PASSED" | "BLOCKED";
  readonly appliedAtProjectionVersion: number;
}

export interface CoreProjection {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly envelopeDigest: string;
  readonly projectionVersion: number;
  readonly state: CoreControlState;
  readonly stage: CoreControlStage;
  readonly budget: CoreBudget;
  readonly appliedDecisions: readonly AppliedControlDecision[];
  readonly completedRoleDispatches: readonly CompletedRoleDispatch[];
  readonly reviewGate: AppliedReviewGate | null;
  readonly reviewGateHistory: readonly AppliedReviewGate[];
  readonly roleAttemptFailures: readonly RoleAttemptFailure[];
  readonly recoveryActions: readonly RecoveryActionRecord[];
  readonly pendingReconcile: PendingReconcile | null;
  readonly reconcileHistory: readonly ReconcileRecord[];
  readonly invalidatedEvidence: readonly EvidenceInvalidation[];
  readonly terminalCandidate: CoreTerminalCandidate | null;
  readonly verification: CoreVerificationResult | null;
  readonly docsImpactGates: readonly AppliedDocsImpactGate[];
  readonly pendingRole: PendingRoleDispatch | null;
  readonly projectionDigest: string;
}

const trustedDecisions = new WeakSet<object>();
const trustedProjections = new WeakSet<object>();
const trustedVerifications = new WeakSet<object>();

export function createInitialCoreProjection(
  envelope: TaskEnvelope,
  budgetInput: CoreBudgetInput,
): CoreProjection {
  const trustedEnvelope = revalidateEnvelope(envelope);
  const budget = normalizeBudget(budgetInput);
  return finalizeProjection({
    schemaVersion: 1,
    taskId: trustedEnvelope.taskId,
    specRevision: trustedEnvelope.specRevision,
    envelopeDigest: trustedEnvelope.envelopeDigest,
    projectionVersion: 1,
    state: "RUNNING",
    stage: "DOCS_REQUIRED",
    budget,
    appliedDecisions: [],
    completedRoleDispatches: [],
    reviewGate: null,
    reviewGateHistory: [],
    roleAttemptFailures: [],
    recoveryActions: [],
    pendingReconcile: null,
    reconcileHistory: [],
    invalidatedEvidence: [],
    terminalCandidate: null,
    verification: null,
    docsImpactGates: [],
    pendingRole: null,
  });
}

export function createControlDecision(input: ControlDecisionInput): ControlDecision {
  assertTaskId(input.taskId);
  assertPositiveInteger(input.specRevision, "specRevision");
  assertPositiveInteger(input.expectedProjectionVersion, "expectedProjectionVersion");
  assertControlState(input.expectedState);
  assertControlAction(input.action);
  const targetRole = input.targetRole ?? null;
  if (targetRole !== null) assertCoreRole(targetRole);
  if (input.action === "SCHEDULE_ROLE" && targetRole === null) {
    throw validation("CONTROL_TARGET_ROLE_REQUIRED", "SCHEDULE_ROLE requires targetRole");
  }
  if (input.action === "REPAIR" && targetRole !== "IMPLEMENTATION") {
    throw validation("CONTROL_TARGET_ROLE_INVALID", "REPAIR requires targetRole IMPLEMENTATION");
  }
  if (input.action === "REPLAN" && targetRole !== "DOCS") {
    throw validation("CONTROL_TARGET_ROLE_INVALID", "REPLAN requires targetRole DOCS");
  }
  if ((input.action === "WAIT" || input.action === "CLOSE") && targetRole !== null) {
    throw validation("CONTROL_TARGET_ROLE_INVALID", `${input.action} cannot carry targetRole`);
  }
  const operationId = input.operationId === undefined ? null : requiredString(input.operationId, "operationId");
  if ((input.action === "WAIT" || (input.action === "RETRY" && targetRole === null)) && operationId === null) {
    throw validation("CONTROL_OPERATION_ID_REQUIRED", `${input.action} operation control requires operationId`);
  }
  if (input.action !== "WAIT" && !(input.action === "RETRY" && targetRole === null) && operationId !== null) {
    throw validation("CONTROL_OPERATION_ID_INVALID", `${input.action} cannot carry operationId`);
  }
  const reason = requiredString(input.reason, "reason");
  const sourceFindingRefs = normalizeRefs(input.sourceFindingRefs ?? [], "sourceFindingRefs");
  const evidenceRefs = normalizeRefs(input.evidenceRefs ?? [], "evidenceRefs");
  const budgetRequest = normalizeBudgetRequest(input.budgetRequest ?? {});
  const core = {
    schemaVersion: 1 as const,
    taskId: input.taskId,
    specRevision: input.specRevision,
    expectedProjectionVersion: input.expectedProjectionVersion,
    expectedState: input.expectedState,
    action: input.action,
    targetRole,
    operationId,
    sourceFindingRefs,
    evidenceRefs,
    reason,
    budgetRequest,
  };
  const decisionId = `decision:${digestHex("control-decision-id", core)}`;
  const decision: ControlDecision = {
    ...core,
    decisionId,
    decisionDigest: digest("control-decision", { decisionId, ...core }),
  };
  trustedDecisions.add(decision);
  return deepFreeze(decision);
}

export function parseControlDecision(value: unknown, expectedDigest: string): ControlDecision {
  if (!isRecord(value) || value["schemaVersion"] !== 1) {
    throw validation("INVALID_CONTROL_DECISION", "serialized ControlDecision must be a schemaVersion 1 object");
  }
  const parsed = createControlDecision({
    taskId: value["taskId"] as string,
    specRevision: value["specRevision"] as number,
    expectedProjectionVersion: value["expectedProjectionVersion"] as number,
    expectedState: value["expectedState"] as CoreControlState,
    action: value["action"] as ControlAction,
    ...((value["targetRole"] === null || value["targetRole"] === undefined)
      ? {}
      : { targetRole: value["targetRole"] as CoreRole }),
    ...((value["operationId"] === null || value["operationId"] === undefined)
      ? {}
      : { operationId: value["operationId"] as string }),
    sourceFindingRefs: value["sourceFindingRefs"] as readonly string[],
    evidenceRefs: value["evidenceRefs"] as readonly string[],
    reason: value["reason"] as string,
    budgetRequest: value["budgetRequest"] as CoreBudgetRequest,
  });
  if (value["decisionId"] !== parsed.decisionId || value["decisionDigest"] !== parsed.decisionDigest ||
      expectedDigest !== parsed.decisionDigest) {
    throw conflict("CONTROL_DECISION_INTEGRITY_FAILED", "serialized ControlDecision does not match its digest");
  }
  return parsed;
}

export function proposeDeterministicControlDecision(
  envelope: TaskEnvelope,
  projection: CoreProjection,
): ControlDecision | null {
  const trustedEnvelope = revalidateEnvelope(envelope);
  assertTrustedProjection(projection);
  assertProjectionMatchesEnvelope(projection, trustedEnvelope);
  if (projection.pendingRole !== null) return null;
  const requiredRole = requiredRoleForStage(projection.stage);
  if (projection.state === "RUNNING" && requiredRole !== null) {
    const request = normalizeBudgetRequest({ roleAttempts: 1, modelCalls: 1 });
    if (!budgetAvailable(projection.budget, request)) {
      return budgetExhaustionDecision(projection, `No budget remains to schedule ${requiredRole}`);
    }
    return createControlDecision({
      taskId: projection.taskId,
      specRevision: projection.specRevision,
      expectedProjectionVersion: projection.projectionVersion,
      expectedState: projection.state,
      action: "SCHEDULE_ROLE",
      targetRole: requiredRole,
      evidenceRefs: projection.completedRoleDispatches.length === 0
        ? [`task-envelope://${projection.envelopeDigest}`]
        : [`role-result://${projection.completedRoleDispatches.at(-1)!.resultDigest}`],
      reason: roleScheduleReason(requiredRole),
      budgetRequest: request,
    });
  }
  if (projection.state === "RUNNING" && projection.stage === "REPAIR_REQUIRED" && projection.reviewGate !== null) {
    const request = normalizeBudgetRequest({ repairs: 1, roleAttempts: 1, modelCalls: 1 });
    if (!budgetAvailable(projection.budget, request)) {
      return budgetExhaustionDecision(projection, "No budget remains for the required Repair");
    }
    return createControlDecision({
      taskId: projection.taskId,
      specRevision: projection.specRevision,
      expectedProjectionVersion: projection.projectionVersion,
      expectedState: projection.state,
      action: "REPAIR",
      targetRole: "IMPLEMENTATION",
      sourceFindingRefs: projection.reviewGate.unresolvedBlockingFindingRefs,
      evidenceRefs: [`review-gate://${projection.reviewGate.gateDigest}`],
      reason: "Blocking Review Findings require a bounded Implementation Repair",
      budgetRequest: request,
    });
  }
  return null;
}

export function applyControlDecision(
  projection: CoreProjection,
  decision: ControlDecision,
  nextEnvelope?: TaskEnvelope,
): CoreProjection {
  assertTrustedProjection(projection);
  assertTrustedDecision(decision);

  const prior = projection.appliedDecisions.find((candidate) => candidate.decisionId === decision.decisionId);
  if (prior !== undefined) {
    if (prior.decisionDigest !== decision.decisionDigest) {
      throw conflict("CONTROL_DECISION_ID_CONFLICT", `Decision ${decision.decisionId} was already applied with another digest`);
    }
    return projection;
  }

  if (decision.taskId !== projection.taskId || decision.specRevision !== projection.specRevision) {
    throw conflict("CONTROL_DECISION_TASK_MISMATCH", "Decision Task or Spec Revision does not match Core Projection");
  }
  if (decision.expectedState !== projection.state) {
    throw conflict("CONTROL_DECISION_STALE_STATE", `Expected ${decision.expectedState}, current state is ${projection.state}`);
  }
  if (decision.expectedProjectionVersion !== projection.projectionVersion) {
    throw conflict(
      "CONTROL_DECISION_STALE_VERSION",
      `Expected Projection version ${decision.expectedProjectionVersion}, current version is ${projection.projectionVersion}`,
    );
  }
  assertBudgetRequestForDecision(decision);
  assertBudgetAvailable(projection.budget, decision.budgetRequest);

  if (decision.action === "SCHEDULE_ROLE") {
    return applyScheduleRole(projection, decision);
  }
  if (decision.action === "RETRY") {
    return decision.targetRole === null
      ? applyOperationRetry(projection, decision)
      : applyRoleAttemptRetry(projection, decision);
  }
  if (decision.action === "REPAIR") {
    return applyRepair(projection, decision);
  }
  if (decision.action === "REPLAN") {
    return applyReplan(projection, decision, nextEnvelope);
  }
  if (decision.action === "WAIT") {
    return applyWaitForReconcile(projection, decision);
  }
  return applyTerminalCandidate(projection, decision);
}

export function recordRoleAttemptFailure(
  projection: CoreProjection,
  input: RoleAttemptFailureInput,
): CoreProjection {
  assertTrustedProjection(projection);
  const normalized = normalizeRoleFailure(input);
  const prior = projection.roleAttemptFailures.find((item) => item.dispatchId === normalized.dispatchId);
  if (prior !== undefined) {
    if (canonicalJson(failureWithoutProjection(prior)) !== canonicalJson(normalized)) {
      throw conflict("ROLE_FAILURE_CONFLICT", `Dispatch ${normalized.dispatchId} already failed with another result`);
    }
    return projection;
  }
  if (projection.state !== "RUNNING" || projection.stage !== runningStageForRole(normalized.role)) {
    throw conflict("ROLE_FAILURE_NOT_ACTIVE", `Role failure cannot be recorded from stage ${projection.stage}`);
  }
  const pending = projection.pendingRole;
  if (pending === null || pending.dispatchId !== normalized.dispatchId || pending.role !== normalized.role ||
      pending.generation !== normalized.attemptGeneration || pending.inputDigest !== normalized.inputDigest) {
    throw conflict("ROLE_FAILURE_DISPATCH_MISMATCH", "Role failure does not match the current Pending Role Dispatch");
  }
  assertCanonicalAttemptId(projection.taskId, normalized.role, normalized.attemptGeneration, normalized.attemptId);
  const nextVersion = projection.projectionVersion + 1;
  const failureCore = { ...normalized, recordedAtProjectionVersion: nextVersion };
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    roleAttemptFailures: [...projection.roleAttemptFailures, {
      ...failureCore,
      failureDigest: digest("role-attempt-failure", failureCore),
    }],
  });
}

export function reconcileUnknownEffect(
  projection: CoreProjection,
  input: ReconcileInput,
): CoreProjection {
  assertTrustedProjection(projection);
  assertDigest(input.expectedWaitDigest, "expectedWaitDigest");
  const outcome = input.outcome;
  if (outcome !== "CONFIRMED" && outcome !== "NOT_APPLIED") {
    throw validation("INVALID_RECONCILE_OUTCOME", `Invalid Reconcile outcome: ${String(outcome)}`);
  }
  const evidenceRefs = normalizeRefs(input.evidenceRefs, "reconcile.evidenceRefs");
  if (evidenceRefs.length === 0) throw validation("RECONCILE_EVIDENCE_REQUIRED", "Reconcile requires evidence");
  const prior = projection.reconcileHistory.find((item) => item.waitDigest === input.expectedWaitDigest);
  if (prior !== undefined) {
    if (prior.outcome !== outcome || canonicalJson(prior.evidenceRefs) !== canonicalJson(evidenceRefs)) {
      throw conflict("RECONCILE_CONFLICT", "Unknown Effect was already reconciled with another outcome");
    }
    return projection;
  }
  if (projection.state !== "WAITING_RECONCILE" || projection.pendingReconcile === null ||
      projection.pendingReconcile.waitDigest !== input.expectedWaitDigest) {
    throw conflict("RECONCILE_NOT_PENDING", "No matching Unknown Effect is waiting for reconciliation");
  }
  const nextVersion = projection.projectionVersion + 1;
  const core = {
    waitDigest: input.expectedWaitDigest,
    operationId: projection.pendingReconcile.operationId,
    outcome,
    evidenceRefs,
  };
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    state: "RUNNING",
    pendingReconcile: null,
    reconcileHistory: [...projection.reconcileHistory, {
      ...core,
      reconcileDigest: digest("effect-reconcile", core),
      appliedAtProjectionVersion: nextVersion,
    }],
  });
}

function applyScheduleRole(projection: CoreProjection, decision: ControlDecision): CoreProjection {
  if (projection.pendingRole !== null) {
    throw conflict("ACTIVE_ROLE_EXISTS", `Role ${projection.pendingRole.role} is already pending`);
  }
  const requiredRole = requiredRoleForStage(projection.stage);
  if (projection.state !== "RUNNING" || requiredRole === null || decision.targetRole !== requiredRole) {
    throw conflict(
      "ILLEGAL_CONTROL_TRANSITION",
      `Stage ${projection.stage} only permits its required Role and Required Gates cannot be skipped`,
    );
  }
  if (decision.sourceFindingRefs.length > 0) {
    throw conflict("FINDING_REFS_NOT_ALLOWED", "Linear Role scheduling cannot be driven by Review Findings");
  }
  const nextVersion = projection.projectionVersion + 1;
  const pendingRole = createPendingRole({
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    envelopeDigest: projection.envelopeDigest,
    decision,
    role: requiredRole,
    generation: nextRoleGeneration(projection, requiredRole),
  });
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    stage: runningStageForRole(requiredRole),
    budget: consumeBudget(projection.budget, decision.budgetRequest),
    appliedDecisions: appendAppliedDecision(projection, decision, nextVersion),
    pendingRole,
  });
}

function applyOperationRetry(projection: CoreProjection, decision: ControlDecision): CoreProjection {
  if (projection.state !== "RUNNING" || decision.operationId === null || decision.evidenceRefs.length === 0 ||
      decision.sourceFindingRefs.length > 0) {
    throw conflict("OPERATION_RETRY_NOT_ALLOWED", "Operation Retry requires RUNNING state, operationId and not-applied evidence");
  }
  const nextVersion = projection.projectionVersion + 1;
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    budget: consumeBudget(projection.budget, decision.budgetRequest),
    appliedDecisions: appendAppliedDecision(projection, decision, nextVersion),
    recoveryActions: [...projection.recoveryActions, {
      decisionId: decision.decisionId,
      action: "OPERATION_RETRY",
      targetRole: null,
      sourceRefs: decision.evidenceRefs,
      appliedAtProjectionVersion: nextVersion,
    }],
  });
}

function applyRoleAttemptRetry(projection: CoreProjection, decision: ControlDecision): CoreProjection {
  const pending = projection.pendingRole;
  if (projection.state !== "RUNNING" || pending === null || decision.targetRole !== pending.role) {
    throw conflict("ROLE_RETRY_NOT_ALLOWED", "Role Attempt Retry requires the current failed Pending Role");
  }
  const failure = projection.roleAttemptFailures.at(-1);
  if (failure === undefined || failure.dispatchId !== pending.dispatchId || failure.role !== pending.role ||
      failure.attemptGeneration !== pending.generation) {
    throw conflict("ROLE_RETRY_FAILURE_REQUIRED", "Role Attempt Retry requires the latest Pending Attempt failure");
  }
  const failureRef = `role-failure://${failure.failureDigest}`;
  if (canonicalJson(decision.evidenceRefs) !== canonicalJson([failureRef]) || decision.sourceFindingRefs.length > 0) {
    throw conflict("ROLE_RETRY_EVIDENCE_MISMATCH", "Role Attempt Retry must bind the latest Failure Record only");
  }
  const nextVersion = projection.projectionVersion + 1;
  const pendingRole = createPendingRole({
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    envelopeDigest: projection.envelopeDigest,
    decision,
    role: pending.role,
    generation: pending.generation + 1,
    priorInputDigest: pending.inputDigest,
    sourceDigest: failure.failureDigest,
  });
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    budget: consumeBudget(projection.budget, decision.budgetRequest),
    appliedDecisions: appendAppliedDecision(projection, decision, nextVersion),
    recoveryActions: [...projection.recoveryActions, {
      decisionId: decision.decisionId,
      action: "ROLE_ATTEMPT_RETRY",
      targetRole: pending.role,
      sourceRefs: [failureRef],
      appliedAtProjectionVersion: nextVersion,
    }],
    pendingRole,
  });
}

function applyRepair(projection: CoreProjection, decision: ControlDecision): CoreProjection {
  const gate = projection.reviewGate;
  if (projection.state !== "RUNNING" || projection.stage !== "REPAIR_REQUIRED" ||
      projection.pendingRole !== null || gate === null || gate.verdict !== "BLOCKED" ||
      decision.targetRole !== "IMPLEMENTATION") {
    throw conflict("REPAIR_NOT_REQUIRED", "Repair requires a Blocking Review Gate and no Active Role");
  }
  if (canonicalJson(decision.sourceFindingRefs) !== canonicalJson([...gate.unresolvedBlockingFindingRefs].sort())) {
    throw conflict("REPAIR_FINDING_MISMATCH", "Repair must bind the exact unresolved Blocking Finding set");
  }
  if (canonicalJson(decision.evidenceRefs) !== canonicalJson([`review-gate://${gate.gateDigest}`])) {
    throw conflict("REPAIR_EVIDENCE_MISMATCH", "Repair must bind the current Blocking Review Gate");
  }
  const nextVersion = projection.projectionVersion + 1;
  const pendingRole = createPendingRole({
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    envelopeDigest: projection.envelopeDigest,
    decision,
    role: "IMPLEMENTATION",
    generation: nextRoleGeneration(projection, "IMPLEMENTATION"),
    sourceDigest: gate.gateDigest,
  });
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    stage: "IMPLEMENTATION_RUNNING",
    budget: consumeBudget(projection.budget, decision.budgetRequest),
    appliedDecisions: appendAppliedDecision(projection, decision, nextVersion),
    recoveryActions: [...projection.recoveryActions, {
      decisionId: decision.decisionId,
      action: "REPAIR",
      targetRole: "IMPLEMENTATION",
      sourceRefs: decision.sourceFindingRefs,
      appliedAtProjectionVersion: nextVersion,
    }],
    reviewGateHistory: [...projection.reviewGateHistory, gate],
    reviewGate: null,
    pendingRole,
  });
}

function applyReplan(
  projection: CoreProjection,
  decision: ControlDecision,
  nextEnvelope: TaskEnvelope | undefined,
): CoreProjection {
  if (projection.state !== "RUNNING" || projection.stage !== "REPAIR_REQUIRED" ||
      projection.pendingRole !== null || projection.reviewGate?.verdict !== "BLOCKED" ||
      decision.targetRole !== "DOCS") {
    throw conflict("REPLAN_NOT_REQUIRED", "Replan requires a Blocking Review Gate and no Active Role");
  }
  if (nextEnvelope === undefined) throw validation("REPLAN_ENVELOPE_REQUIRED", "Replan requires the next TaskEnvelope");
  const envelope = revalidateEnvelope(nextEnvelope);
  if (envelope.taskId !== projection.taskId || envelope.specRevision !== projection.specRevision + 1) {
    throw conflict("REPLAN_ENVELOPE_MISMATCH", "Replan TaskEnvelope must use the same Task and Spec Revision N+1");
  }
  const envelopeRef = `task-envelope://${envelope.envelopeDigest}`;
  if (!decision.evidenceRefs.includes(envelopeRef) ||
      canonicalJson(decision.sourceFindingRefs) !==
        canonicalJson([...projection.reviewGate.unresolvedBlockingFindingRefs].sort())) {
    throw conflict("REPLAN_EVIDENCE_MISMATCH", "Replan must bind the next Envelope and exact Blocking Findings");
  }
  const nextVersion = projection.projectionVersion + 1;
  const invalidatedRefs = normalizeRefs([
    `task-envelope://${projection.envelopeDigest}`,
    ...projection.completedRoleDispatches.map((item) => `role-result://${item.resultDigest}`),
    ...projection.reviewGateHistory.map((item) => `review-gate://${item.gateDigest}`),
    `review-gate://${projection.reviewGate.gateDigest}`,
    ...projection.reviewGate.unresolvedBlockingFindingRefs,
  ], "invalidatedRefs");
  const invalidationCore = {
    fromSpecRevision: projection.specRevision,
    toSpecRevision: envelope.specRevision,
    invalidatedRefs,
    reason: decision.reason,
  };
  const pendingRole = createPendingRole({
    taskId: projection.taskId,
    specRevision: envelope.specRevision,
    envelopeDigest: envelope.envelopeDigest,
    decision,
    role: "DOCS",
    generation: 1,
    sourceDigest: projection.reviewGate.gateDigest,
  });
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    specRevision: envelope.specRevision,
    envelopeDigest: envelope.envelopeDigest,
    projectionVersion: nextVersion,
    stage: "DOCS_RUNNING",
    budget: consumeBudget(projection.budget, decision.budgetRequest),
    appliedDecisions: appendAppliedDecision(projection, decision, nextVersion),
    recoveryActions: [...projection.recoveryActions, {
      decisionId: decision.decisionId,
      action: "REPLAN",
      targetRole: "DOCS",
      sourceRefs: [...decision.sourceFindingRefs, envelopeRef].sort(),
      appliedAtProjectionVersion: nextVersion,
    }],
    reviewGateHistory: [...projection.reviewGateHistory, projection.reviewGate],
    reviewGate: null,
    invalidatedEvidence: [...projection.invalidatedEvidence, {
      invalidationId: `invalidation:${digestHex("evidence-invalidation-id", invalidationCore)}`,
      ...invalidationCore,
      appliedAtProjectionVersion: nextVersion,
    }],
    pendingRole,
  });
}

function applyWaitForReconcile(projection: CoreProjection, decision: ControlDecision): CoreProjection {
  if (projection.state !== "RUNNING" || projection.pendingReconcile !== null ||
      decision.operationId === null || decision.evidenceRefs.length === 0 || decision.sourceFindingRefs.length > 0) {
    throw conflict("WAIT_NOT_ALLOWED", "WAIT requires one unknown operation and evidence from RUNNING state");
  }
  const nextVersion = projection.projectionVersion + 1;
  const waitCore = {
    effectId: `unknown-effect:${digestHex("unknown-effect-id", {
      taskId: projection.taskId,
      specRevision: projection.specRevision,
      operationId: decision.operationId,
      evidenceRefs: decision.evidenceRefs,
    })}`,
    operationId: decision.operationId,
    evidenceRefs: decision.evidenceRefs,
    reason: decision.reason,
  };
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    state: "WAITING_RECONCILE",
    appliedDecisions: appendAppliedDecision(projection, decision, nextVersion),
    pendingReconcile: {
      ...waitCore,
      waitDigest: digest("pending-reconcile", waitCore),
      enteredAtProjectionVersion: nextVersion,
    },
  });
}

function applyTerminalCandidate(projection: CoreProjection, decision: ControlDecision): CoreProjection {
  if (projection.state !== "RUNNING" || projection.pendingRole !== null ||
      !budgetDeficitForStage(projection)) {
    throw conflict("TERMINAL_CANDIDATE_NOT_ALLOWED", "FAILED_TERMINAL candidate requires a Required Gate with exhausted budget");
  }
  const budgetRef = `budget://${digest("core-budget", projection.budget)}`;
  if (canonicalJson(decision.evidenceRefs) !== canonicalJson([budgetRef]) || decision.sourceFindingRefs.length > 0) {
    throw conflict("TERMINAL_CANDIDATE_EVIDENCE_MISMATCH", "FAILED_TERMINAL candidate must bind the exhausted Budget");
  }
  const nextVersion = projection.projectionVersion + 1;
  const core = {
    outcome: "FAILED_TERMINAL" as const,
    reason: "BUDGET_EXHAUSTED" as const,
    evidenceRefs: decision.evidenceRefs,
  };
  const candidateId = `terminal-candidate:${digestHex("core-terminal-candidate-id", {
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    ...core,
  })}`;
  const terminalCandidate: CoreTerminalCandidate = {
    candidateId,
    ...core,
    candidateDigest: digest("core-terminal-candidate", { candidateId, ...core }),
    createdAtProjectionVersion: nextVersion,
  };
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    state: "CLOSING",
    stage: "CLOSURE_REQUIRED",
    appliedDecisions: appendAppliedDecision(projection, decision, nextVersion),
    terminalCandidate,
  });
}

export function completeRoleDispatch(
  projection: CoreProjection,
  input: RoleDispatchCompletionInput,
): CoreProjection {
  assertTrustedProjection(projection);
  const normalized = normalizeRoleCompletion(input);
  const prior = projection.completedRoleDispatches.find((item) => item.dispatchId === normalized.dispatchId);
  if (prior !== undefined) {
    if (canonicalJson(completionWithoutVersion(prior)) !== canonicalJson(normalized)) {
      throw conflict("ROLE_COMPLETION_CONFLICT", `Dispatch ${normalized.dispatchId} already completed with another result`);
    }
    return projection;
  }
  const pending = projection.pendingRole;
  if (pending === null) {
    throw conflict("ROLE_DISPATCH_NOT_PENDING", `Dispatch ${normalized.dispatchId} is not pending`);
  }
  if (pending.dispatchId !== normalized.dispatchId || pending.role !== normalized.role ||
      pending.generation !== normalized.attemptGeneration || pending.inputDigest !== normalized.inputDigest) {
    throw conflict("ROLE_COMPLETION_DISPATCH_MISMATCH", "Role completion does not match the current Pending Role Dispatch");
  }
  const failedAttempt = projection.roleAttemptFailures.find((item) => item.attemptId === normalized.attemptId);
  if (failedAttempt !== undefined) {
    throw conflict("ROLE_COMPLETION_AFTER_FAILURE", `Attempt ${normalized.attemptId} is already terminal Failed`);
  }
  if (projection.state !== "RUNNING" || projection.stage !== runningStageForRole(normalized.role)) {
    throw conflict("ILLEGAL_ROLE_COMPLETION", `Role ${normalized.role} cannot complete from stage ${projection.stage}`);
  }
  const expectedAttemptPrefix = `${projection.taskId}/CORE-${normalized.role}/attempt-`;
  const expectedAttemptId = `${expectedAttemptPrefix}${String(normalized.attemptGeneration).padStart(3, "0")}`;
  if (normalized.attemptId !== expectedAttemptId) {
    throw conflict("ROLE_COMPLETION_ATTEMPT_MISMATCH", "Role completion Attempt ID and generation disagree");
  }
  const nextVersion = projection.projectionVersion + 1;
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    stage: completedStageForRole(normalized.role),
    completedRoleDispatches: [...projection.completedRoleDispatches, {
      ...normalized,
      completedAtProjectionVersion: nextVersion,
    }],
    pendingRole: null,
  });
}

export function applyReviewGateResult(
  projection: CoreProjection,
  gate: ReviewGateResult,
): CoreProjection {
  assertTrustedProjection(projection);
  assertTrustedReviewGateResult(gate);
  if (projection.reviewGate !== null) {
    if (projection.reviewGate.gateDigest !== gate.gateDigest) {
      throw conflict("REVIEW_GATE_CONFLICT", "A different Review Gate Result was already applied");
    }
    return projection;
  }
  if (projection.state !== "RUNNING" || projection.stage !== "REVIEW_GATE_REQUIRED" ||
      projection.pendingRole !== null) {
    throw conflict("REVIEW_GATE_NOT_REQUIRED", `Review Gate cannot apply from stage ${projection.stage}`);
  }
  if (gate.taskId !== projection.taskId || gate.specRevision !== projection.specRevision) {
    throw conflict("REVIEW_GATE_TASK_MISMATCH", "Review Gate Task or Spec Revision does not match Core Projection");
  }
  const completedReview = projection.completedRoleDispatches.at(-1);
  if (completedReview?.role !== "REVIEW" || completedReview.resultDigest !== gate.roleRunResultDigest) {
    throw conflict("REVIEW_GATE_RESULT_MISMATCH", "Review Gate does not bind the latest completed Review Result");
  }
  if (gate.verdict === "PASSED" && gate.unresolvedBlockingFindingRefs.length > 0) {
    throw conflict("REVIEW_GATE_VERDICT_CONTRADICTION", "PASSED Review Gate cannot retain Blocking Findings");
  }
  if (gate.verdict === "BLOCKED" && gate.unresolvedBlockingFindingRefs.length === 0) {
    throw conflict("REVIEW_GATE_VERDICT_CONTRADICTION", "BLOCKED Review Gate requires Blocking Findings");
  }
  const nextVersion = projection.projectionVersion + 1;
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    stage: gate.verdict === "PASSED" ? "VERIFICATION_REQUIRED" : "REPAIR_REQUIRED",
    reviewGate: {
      gateDigest: gate.gateDigest,
      roleRunResultDigest: gate.roleRunResultDigest,
      reviewResultDigest: gate.reviewResultDigest,
      candidateCommit: gate.candidateCommit,
      verdict: gate.verdict,
      unresolvedBlockingFindingRefs: gate.unresolvedBlockingFindingRefs,
      appliedAtProjectionVersion: nextVersion,
    },
  });
}

export function createCoreVerificationResult(input: CoreVerificationResultInput): CoreVerificationResult {
  assertTaskId(input.taskId);
  assertPositiveInteger(input.specRevision, "verification.specRevision");
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(input.candidateCommit)) {
    throw validation("INVALID_VERIFICATION_COMMIT", "Verification candidateCommit must be a full Git object ID");
  }
  const evidenceRefs = normalizeRefs(input.evidenceRefs, "verification.evidenceRefs");
  if (evidenceRefs.length === 0) {
    throw validation("VERIFICATION_EVIDENCE_REQUIRED", "Core Verification requires evidence");
  }
  const core = {
    schemaVersion: 1 as const,
    taskId: input.taskId,
    specRevision: input.specRevision,
    candidateCommit: input.candidateCommit,
    evidenceRefs,
    verdict: "PASSED" as const,
  };
  const result: CoreVerificationResult = {
    ...core,
    verificationDigest: digest("core-verification-result", core),
  };
  trustedVerifications.add(result);
  return deepFreeze(result);
}

export function applyCoreVerificationResult(
  projection: CoreProjection,
  verification: CoreVerificationResult,
): CoreProjection {
  assertTrustedProjection(projection);
  assertTrustedVerification(verification);
  if (projection.verification !== null) {
    if (projection.verification.verificationDigest !== verification.verificationDigest) {
      throw conflict("CORE_VERIFICATION_CONFLICT", "A different Core Verification Result was already applied");
    }
    return projection;
  }
  if (projection.state !== "RUNNING" || projection.stage !== "VERIFICATION_REQUIRED" ||
      projection.pendingRole !== null || projection.reviewGate?.verdict !== "PASSED") {
    throw conflict("CORE_VERIFICATION_NOT_REQUIRED", `Core Verification cannot apply from stage ${projection.stage}`);
  }
  if (verification.taskId !== projection.taskId || verification.specRevision !== projection.specRevision ||
      verification.candidateCommit !== projection.reviewGate.candidateCommit) {
    throw conflict("CORE_VERIFICATION_TASK_MISMATCH", "Verification does not bind the passed Review candidate");
  }
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: projection.projectionVersion + 1,
    stage: "DOCS_IMPACT_REQUIRED",
    verification,
  });
}

export function applyCoreDocsImpactGate(
  projection: CoreProjection,
  gate: CoreDocsImpactGateResult,
): CoreProjection {
  assertTrustedProjection(projection);
  assertTrustedCoreDocsImpactGateResult(gate);
  const prior = projection.docsImpactGates.find((item) => item.gateDigest === gate.gateDigest);
  if (prior !== undefined) return projection;
  if (projection.state !== "RUNNING" || projection.stage !== "DOCS_IMPACT_REQUIRED" ||
      projection.pendingRole !== null || projection.verification === null) {
    throw conflict("DOCS_IMPACT_GATE_NOT_REQUIRED", `Docs Impact Gate cannot apply from stage ${projection.stage}`);
  }
  if (gate.taskId !== projection.taskId || gate.specRevision !== projection.specRevision) {
    throw conflict("DOCS_IMPACT_GATE_TASK_MISMATCH", "Docs Impact Gate Task or Spec Revision does not match Core Projection");
  }
  const nextVersion = projection.projectionVersion + 1;
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    stage: gate.verdict === "PASSED" ? "CLOSURE_REQUIRED" : "DOCS_IMPACT_REQUIRED",
    docsImpactGates: [...projection.docsImpactGates, {
      gateDigest: gate.gateDigest,
      routeDigest: gate.routeDigest,
      reportDigest: gate.reportDigest,
      verdict: gate.verdict,
      appliedAtProjectionVersion: nextVersion,
    }],
  });
}

export function parseCoreProjection(
  value: unknown,
  envelope: TaskEnvelope,
  expectedDigest: string,
): CoreProjection {
  const trustedEnvelope = revalidateEnvelope(envelope);
  if (!isRecord(value) || value["schemaVersion"] !== 1 || !isRecord(value["budget"]) ||
      !Array.isArray(value["appliedDecisions"]) || !Array.isArray(value["completedRoleDispatches"]) ||
      !Array.isArray(value["reviewGateHistory"]) || !Array.isArray(value["roleAttemptFailures"]) ||
      !Array.isArray(value["recoveryActions"]) || !Array.isArray(value["reconcileHistory"]) ||
      !Array.isArray(value["invalidatedEvidence"]) || !Array.isArray(value["docsImpactGates"])) {
    throw validation("INVALID_CORE_PROJECTION", "serialized CoreProjection has an invalid shape");
  }
  assertTaskId(value["taskId"] as string);
  assertPositiveInteger(value["specRevision"] as number, "specRevision");
  assertPositiveInteger(value["projectionVersion"] as number, "projectionVersion");
  assertControlState(value["state"] as CoreControlState);
  assertControlStage(value["stage"] as CoreControlStage);
  const budget = normalizeRemainingBudget(value["budget"]);
  const appliedDecisions = value["appliedDecisions"].map(parseAppliedDecision);
  const completedRoleDispatches = value["completedRoleDispatches"].map(parseCompletedRoleDispatch);
  const reviewGate = value["reviewGate"] === null ? null : parseAppliedReviewGate(value["reviewGate"]);
  const reviewGateHistory = value["reviewGateHistory"].map(parseAppliedReviewGate);
  const roleAttemptFailures = value["roleAttemptFailures"].map(parseRoleAttemptFailure);
  const recoveryActions = value["recoveryActions"].map(parseRecoveryAction);
  const pendingReconcile = value["pendingReconcile"] === null ? null : parsePendingReconcile(value["pendingReconcile"]);
  const reconcileHistory = value["reconcileHistory"].map(parseReconcileRecord);
  const invalidatedEvidence = value["invalidatedEvidence"].map(parseEvidenceInvalidation);
  const terminalCandidate = value["terminalCandidate"] === null ? null : parseTerminalCandidate(value["terminalCandidate"]);
  const verification = value["verification"] === null ? null : parseCoreVerificationResult(value["verification"]);
  const docsImpactGates = value["docsImpactGates"].map(parseAppliedDocsImpactGate);
  const pendingRole = value["pendingRole"] === null
    ? null
    : parsePendingRole(value["pendingRole"]);
  const core = {
    schemaVersion: 1 as const,
    taskId: value["taskId"] as string,
    specRevision: value["specRevision"] as number,
    envelopeDigest: value["envelopeDigest"] as string,
    projectionVersion: value["projectionVersion"] as number,
    state: value["state"] as CoreControlState,
    stage: value["stage"] as CoreControlStage,
    budget,
    appliedDecisions,
    completedRoleDispatches,
    reviewGate,
    reviewGateHistory,
    roleAttemptFailures,
    recoveryActions,
    pendingReconcile,
    reconcileHistory,
    invalidatedEvidence,
    terminalCandidate,
    verification,
    docsImpactGates,
    pendingRole,
  };
  const parsed = finalizeProjection(core);
  assertProjectionMatchesEnvelope(parsed, trustedEnvelope);
  if (value["projectionDigest"] !== parsed.projectionDigest || expectedDigest !== parsed.projectionDigest) {
    throw conflict("CORE_PROJECTION_INTEGRITY_FAILED", "serialized CoreProjection does not match its digest");
  }
  return parsed;
}

function normalizeBudget(input: CoreBudgetInput): CoreBudget {
  return {
    operationRetriesRemaining: nonNegativeInteger(input.operationRetries, "budget.operationRetries"),
    roleAttemptsRemaining: nonNegativeInteger(input.roleAttempts, "budget.roleAttempts"),
    repairsRemaining: nonNegativeInteger(input.repairs, "budget.repairs"),
    replansRemaining: nonNegativeInteger(input.replans, "budget.replans"),
    modelCallsRemaining: nonNegativeInteger(input.modelCalls, "budget.modelCalls"),
    totalTimeRemainingMs: nonNegativeInteger(input.totalTimeMs, "budget.totalTimeMs"),
  };
}

function normalizeRemainingBudget(value: Record<string, unknown>): CoreBudget {
  return {
    operationRetriesRemaining: nonNegativeInteger(value["operationRetriesRemaining"], "budget.operationRetriesRemaining"),
    roleAttemptsRemaining: nonNegativeInteger(value["roleAttemptsRemaining"], "budget.roleAttemptsRemaining"),
    repairsRemaining: nonNegativeInteger(value["repairsRemaining"], "budget.repairsRemaining"),
    replansRemaining: nonNegativeInteger(value["replansRemaining"], "budget.replansRemaining"),
    modelCallsRemaining: nonNegativeInteger(value["modelCallsRemaining"], "budget.modelCallsRemaining"),
    totalTimeRemainingMs: nonNegativeInteger(value["totalTimeRemainingMs"], "budget.totalTimeRemainingMs"),
  };
}

function normalizeBudgetRequest(input: CoreBudgetRequestInput): CoreBudgetRequest {
  return {
    operationRetries: nonNegativeInteger(input.operationRetries ?? 0, "budgetRequest.operationRetries"),
    roleAttempts: nonNegativeInteger(input.roleAttempts ?? 0, "budgetRequest.roleAttempts"),
    repairs: nonNegativeInteger(input.repairs ?? 0, "budgetRequest.repairs"),
    replans: nonNegativeInteger(input.replans ?? 0, "budgetRequest.replans"),
    modelCalls: nonNegativeInteger(input.modelCalls ?? 0, "budgetRequest.modelCalls"),
    totalTimeMs: nonNegativeInteger(input.totalTimeMs ?? 0, "budgetRequest.totalTimeMs"),
  };
}

function budgetAvailable(budget: CoreBudget, request: CoreBudgetRequest): boolean {
  return request.operationRetries <= budget.operationRetriesRemaining &&
    request.roleAttempts <= budget.roleAttemptsRemaining &&
    request.repairs <= budget.repairsRemaining &&
    request.replans <= budget.replansRemaining &&
    request.modelCalls <= budget.modelCallsRemaining &&
    request.totalTimeMs <= budget.totalTimeRemainingMs;
}

function budgetDeficitForStage(projection: CoreProjection): boolean {
  if (projection.state !== "RUNNING" || projection.pendingRole !== null) return false;
  if (requiredRoleForStage(projection.stage) !== null) {
    return !budgetAvailable(projection.budget, normalizeBudgetRequest({ roleAttempts: 1, modelCalls: 1 }));
  }
  if (projection.stage === "REPAIR_REQUIRED") {
    return !budgetAvailable(
      projection.budget,
      normalizeBudgetRequest({ repairs: 1, roleAttempts: 1, modelCalls: 1 }),
    );
  }
  return false;
}

function budgetExhaustionDecision(projection: CoreProjection, reason: string): ControlDecision {
  return createControlDecision({
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    expectedProjectionVersion: projection.projectionVersion,
    expectedState: projection.state,
    action: "CLOSE",
    evidenceRefs: [`budget://${digest("core-budget", projection.budget)}`],
    reason,
    budgetRequest: {},
  });
}

function assertBudgetRequestForDecision(decision: ControlDecision): void {
  const request = decision.budgetRequest;
  const hasOnly = (expected: Partial<CoreBudgetRequest>): boolean =>
    request.operationRetries === (expected.operationRetries ?? 0) &&
    request.roleAttempts === (expected.roleAttempts ?? 0) &&
    request.repairs === (expected.repairs ?? 0) &&
    request.replans === (expected.replans ?? 0) &&
    request.totalTimeMs === (expected.totalTimeMs ?? 0) &&
    request.modelCalls <= (expected.modelCalls ?? 0);

  let valid = false;
  if (decision.action === "SCHEDULE_ROLE" || (decision.action === "RETRY" && decision.targetRole !== null)) {
    valid = request.roleAttempts === 1 && hasOnly({ roleAttempts: 1, modelCalls: 1 });
  } else if (decision.action === "RETRY") {
    valid = request.operationRetries === 1 && hasOnly({ operationRetries: 1 });
  } else if (decision.action === "REPAIR") {
    valid = request.repairs === 1 && request.roleAttempts === 1 &&
      hasOnly({ repairs: 1, roleAttempts: 1, modelCalls: 1 });
  } else if (decision.action === "REPLAN") {
    valid = request.replans === 1 && request.roleAttempts === 1 &&
      hasOnly({ replans: 1, roleAttempts: 1, modelCalls: 1 });
  } else {
    valid = hasOnly({});
  }
  if (!valid) {
    throw conflict(
      "INVALID_CONTROL_BUDGET_REQUEST",
      `${decision.action} carries a budget shape that does not match its recovery class`,
    );
  }
}

function assertBudgetAvailable(budget: CoreBudget, request: CoreBudgetRequest): void {
  const pairs = [
    ["operationRetries", request.operationRetries, budget.operationRetriesRemaining],
    ["roleAttempts", request.roleAttempts, budget.roleAttemptsRemaining],
    ["repairs", request.repairs, budget.repairsRemaining],
    ["replans", request.replans, budget.replansRemaining],
    ["modelCalls", request.modelCalls, budget.modelCallsRemaining],
    ["totalTimeMs", request.totalTimeMs, budget.totalTimeRemainingMs],
  ] as const;
  const exhausted = pairs.find(([, requested, remaining]) => requested > remaining);
  if (exhausted !== undefined) {
    throw conflict("CORE_BUDGET_EXHAUSTED", `${exhausted[0]} requested ${exhausted[1]}, remaining ${exhausted[2]}`);
  }
}

function consumeBudget(budget: CoreBudget, request: CoreBudgetRequest): CoreBudget {
  return {
    operationRetriesRemaining: budget.operationRetriesRemaining - request.operationRetries,
    roleAttemptsRemaining: budget.roleAttemptsRemaining - request.roleAttempts,
    repairsRemaining: budget.repairsRemaining - request.repairs,
    replansRemaining: budget.replansRemaining - request.replans,
    modelCallsRemaining: budget.modelCallsRemaining - request.modelCalls,
    totalTimeRemainingMs: budget.totalTimeRemainingMs - request.totalTimeMs,
  };
}

function parseAppliedDecision(value: unknown): AppliedControlDecision {
  if (!isRecord(value) || typeof value["decisionId"] !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(value["decisionDigest"] as string)) {
    throw validation("INVALID_APPLIED_DECISION", "applied Decision summary is invalid");
  }
  assertPositiveInteger(value["appliedAtProjectionVersion"] as number, "appliedAtProjectionVersion");
  assertControlAction(value["action"] as ControlAction);
  return {
    decisionId: value["decisionId"],
    decisionDigest: value["decisionDigest"] as string,
    appliedAtProjectionVersion: value["appliedAtProjectionVersion"] as number,
    action: value["action"] as ControlAction,
  };
}

function parsePendingRole(value: unknown): PendingRoleDispatch {
  if (!isRecord(value) || typeof value["dispatchId"] !== "string" ||
      !value["dispatchId"].startsWith("dispatch:") || typeof value["decisionId"] !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(value["inputDigest"] as string)) {
    throw validation("INVALID_PENDING_ROLE", "pending Role Dispatch is invalid");
  }
  assertCoreRole(value["role"] as CoreRole);
  assertPositiveInteger(value["generation"] as number, "pendingRole.generation");
  return {
    dispatchId: value["dispatchId"],
    decisionId: value["decisionId"],
    role: value["role"] as CoreRole,
    generation: value["generation"] as number,
    inputDigest: value["inputDigest"] as string,
  };
}

function createPendingRole(input: {
  readonly taskId: string;
  readonly specRevision: number;
  readonly envelopeDigest: string;
  readonly decision: ControlDecision;
  readonly role: CoreRole;
  readonly generation: number;
  readonly priorInputDigest?: string;
  readonly sourceDigest?: string;
}): PendingRoleDispatch {
  const inputCore = {
    taskId: input.taskId,
    specRevision: input.specRevision,
    envelopeDigest: input.envelopeDigest,
    role: input.role,
    generation: input.generation,
    decisionDigest: input.decision.decisionDigest,
    priorInputDigest: input.priorInputDigest ?? null,
    sourceDigest: input.sourceDigest ?? null,
  };
  const inputDigest = digest("role-dispatch-input", inputCore);
  return {
    dispatchId: `dispatch:${digestHex("role-dispatch-id", {
      taskId: input.taskId,
      specRevision: input.specRevision,
      role: input.role,
      generation: input.generation,
      decisionId: input.decision.decisionId,
      inputDigest,
    })}`,
    decisionId: input.decision.decisionId,
    role: input.role,
    generation: input.generation,
    inputDigest,
  };
}

function nextRoleGeneration(projection: CoreProjection, role: CoreRole): number {
  const generations = [
    ...projection.completedRoleDispatches.filter((item) => item.role === role).map((item) => item.attemptGeneration),
    ...projection.roleAttemptFailures.filter((item) => item.role === role).map((item) => item.attemptGeneration),
    ...(projection.pendingRole?.role === role ? [projection.pendingRole.generation] : []),
  ];
  return Math.max(0, ...generations) + 1;
}

function appendAppliedDecision(
  projection: CoreProjection,
  decision: ControlDecision,
  nextVersion: number,
): readonly AppliedControlDecision[] {
  return [...projection.appliedDecisions, {
    decisionId: decision.decisionId,
    decisionDigest: decision.decisionDigest,
    appliedAtProjectionVersion: nextVersion,
    action: decision.action,
  }];
}

function normalizeRoleFailure(input: RoleAttemptFailureInput): RoleAttemptFailureInput {
  if (typeof input.dispatchId !== "string" || !input.dispatchId.startsWith("dispatch:")) {
    throw validation("INVALID_ROLE_FAILURE", "Role failure dispatchId is invalid");
  }
  assertCoreRole(input.role);
  const attemptId = requiredString(input.attemptId, "attemptId");
  assertPositiveInteger(input.attemptGeneration, "attemptGeneration");
  assertDigest(input.inputDigest, "inputDigest");
  assertDigest(input.resultDigest, "resultDigest");
  if (input.outcome !== "FAILED" && input.outcome !== "INVALID_OUTPUT") {
    throw validation("INVALID_ROLE_FAILURE", "Role failure outcome must be FAILED or INVALID_OUTPUT");
  }
  const errorCode = requiredString(input.errorCode, "errorCode");
  assertErrorCategory(input.errorCategory);
  return {
    dispatchId: input.dispatchId,
    role: input.role,
    attemptId,
    attemptGeneration: input.attemptGeneration,
    inputDigest: input.inputDigest,
    resultDigest: input.resultDigest,
    outcome: input.outcome,
    errorCode,
    errorCategory: input.errorCategory,
  };
}

function failureWithoutProjection(value: RoleAttemptFailure): RoleAttemptFailureInput {
  const { failureDigest: _digest, recordedAtProjectionVersion: _version, ...input } = value;
  return input;
}

function assertCanonicalAttemptId(taskId: string, role: CoreRole, generation: number, attemptId: string): void {
  const expected = `${taskId}/CORE-${role}/attempt-${String(generation).padStart(3, "0")}`;
  if (attemptId !== expected) {
    throw conflict("ROLE_ATTEMPT_IDENTITY_INVALID", `Expected canonical Attempt ID ${expected}`);
  }
}

function parseRoleAttemptFailure(value: unknown): RoleAttemptFailure {
  if (!isRecord(value)) throw validation("INVALID_ROLE_FAILURE", "Role Attempt Failure is invalid");
  const normalized = normalizeRoleFailure({
    dispatchId: value["dispatchId"] as string,
    role: value["role"] as CoreRole,
    attemptId: value["attemptId"] as string,
    attemptGeneration: value["attemptGeneration"] as number,
    inputDigest: value["inputDigest"] as string,
    resultDigest: value["resultDigest"] as string,
    outcome: value["outcome"] as "FAILED" | "INVALID_OUTPUT",
    errorCode: value["errorCode"] as string,
    errorCategory: value["errorCategory"] as MoyeErrorCategory,
  });
  assertPositiveInteger(value["recordedAtProjectionVersion"], "recordedAtProjectionVersion");
  const core = { ...normalized, recordedAtProjectionVersion: value["recordedAtProjectionVersion"] as number };
  const failureDigest = digest("role-attempt-failure", core);
  if (value["failureDigest"] !== failureDigest) {
    throw conflict("ROLE_FAILURE_INTEGRITY_FAILED", "Role Attempt Failure does not match its digest");
  }
  return { ...core, failureDigest };
}

function parseRecoveryAction(value: unknown): RecoveryActionRecord {
  if (!isRecord(value) || typeof value["decisionId"] !== "string" || !Array.isArray(value["sourceRefs"])) {
    throw validation("INVALID_RECOVERY_ACTION", "Recovery Action is invalid");
  }
  const action = value["action"];
  const actions: readonly RecoveryActionRecord["action"][] = [
    "OPERATION_RETRY", "ROLE_ATTEMPT_RETRY", "REPAIR", "REPLAN",
  ];
  if (!actions.includes(action as RecoveryActionRecord["action"])) {
    throw validation("INVALID_RECOVERY_ACTION", "Recovery Action kind is invalid");
  }
  const targetRole = value["targetRole"] === null ? null : value["targetRole"] as CoreRole;
  if (targetRole !== null) assertCoreRole(targetRole);
  assertPositiveInteger(value["appliedAtProjectionVersion"], "appliedAtProjectionVersion");
  return {
    decisionId: value["decisionId"],
    action: action as RecoveryActionRecord["action"],
    targetRole,
    sourceRefs: normalizeRefs(value["sourceRefs"] as string[], "recoveryAction.sourceRefs"),
    appliedAtProjectionVersion: value["appliedAtProjectionVersion"] as number,
  };
}

function parsePendingReconcile(value: unknown): PendingReconcile {
  if (!isRecord(value) || typeof value["effectId"] !== "string" ||
      !value["effectId"].startsWith("unknown-effect:") || !Array.isArray(value["evidenceRefs"])) {
    throw validation("INVALID_PENDING_RECONCILE", "Pending Reconcile is invalid");
  }
  const core = {
    effectId: value["effectId"],
    operationId: requiredString(value["operationId"], "operationId"),
    evidenceRefs: normalizeRefs(value["evidenceRefs"] as string[], "pendingReconcile.evidenceRefs"),
    reason: requiredString(value["reason"], "reason"),
  };
  assertPositiveInteger(value["enteredAtProjectionVersion"], "enteredAtProjectionVersion");
  const waitDigest = digest("pending-reconcile", core);
  if (value["waitDigest"] !== waitDigest) {
    throw conflict("PENDING_RECONCILE_INTEGRITY_FAILED", "Pending Reconcile does not match its digest");
  }
  return { ...core, waitDigest, enteredAtProjectionVersion: value["enteredAtProjectionVersion"] as number };
}

function parseReconcileRecord(value: unknown): ReconcileRecord {
  if (!isRecord(value) || !Array.isArray(value["evidenceRefs"])) {
    throw validation("INVALID_RECONCILE_RECORD", "Reconcile Record is invalid");
  }
  assertDigest(value["waitDigest"], "waitDigest");
  if (value["outcome"] !== "CONFIRMED" && value["outcome"] !== "NOT_APPLIED") {
    throw validation("INVALID_RECONCILE_OUTCOME", "Reconcile outcome is invalid");
  }
  const core = {
    waitDigest: value["waitDigest"],
    operationId: requiredString(value["operationId"], "operationId"),
    outcome: value["outcome"] as ReconcileRecord["outcome"],
    evidenceRefs: normalizeRefs(value["evidenceRefs"] as string[], "reconcile.evidenceRefs"),
  };
  assertPositiveInteger(value["appliedAtProjectionVersion"], "appliedAtProjectionVersion");
  const reconcileDigest = digest("effect-reconcile", core);
  if (value["reconcileDigest"] !== reconcileDigest) {
    throw conflict("RECONCILE_INTEGRITY_FAILED", "Reconcile Record does not match its digest");
  }
  return { ...core, reconcileDigest, appliedAtProjectionVersion: value["appliedAtProjectionVersion"] as number };
}

function parseEvidenceInvalidation(value: unknown): EvidenceInvalidation {
  if (!isRecord(value) || typeof value["invalidationId"] !== "string" ||
      !value["invalidationId"].startsWith("invalidation:") || !Array.isArray(value["invalidatedRefs"])) {
    throw validation("INVALID_EVIDENCE_INVALIDATION", "Evidence Invalidation is invalid");
  }
  assertPositiveInteger(value["fromSpecRevision"], "fromSpecRevision");
  assertPositiveInteger(value["toSpecRevision"], "toSpecRevision");
  assertPositiveInteger(value["appliedAtProjectionVersion"], "appliedAtProjectionVersion");
  const core = {
    fromSpecRevision: value["fromSpecRevision"] as number,
    toSpecRevision: value["toSpecRevision"] as number,
    invalidatedRefs: normalizeRefs(value["invalidatedRefs"] as string[], "invalidatedRefs"),
    reason: requiredString(value["reason"], "reason"),
  };
  const expectedId = `invalidation:${digestHex("evidence-invalidation-id", core)}`;
  if (value["invalidationId"] !== expectedId) {
    throw conflict("EVIDENCE_INVALIDATION_INTEGRITY_FAILED", "Evidence Invalidation identity is stale");
  }
  return {
    invalidationId: expectedId,
    ...core,
    appliedAtProjectionVersion: value["appliedAtProjectionVersion"] as number,
  };
}

function parseTerminalCandidate(value: unknown): CoreTerminalCandidate {
  if (!isRecord(value) || typeof value["candidateId"] !== "string" ||
      !value["candidateId"].startsWith("terminal-candidate:") || !Array.isArray(value["evidenceRefs"]) ||
      value["outcome"] !== "FAILED_TERMINAL" || value["reason"] !== "BUDGET_EXHAUSTED") {
    throw validation("INVALID_TERMINAL_CANDIDATE", "Terminal Candidate is invalid");
  }
  const core = {
    outcome: "FAILED_TERMINAL" as const,
    reason: "BUDGET_EXHAUSTED" as const,
    evidenceRefs: normalizeRefs(value["evidenceRefs"] as string[], "terminalCandidate.evidenceRefs"),
  };
  const candidateDigest = digest("core-terminal-candidate", { candidateId: value["candidateId"], ...core });
  assertPositiveInteger(value["createdAtProjectionVersion"], "createdAtProjectionVersion");
  if (value["candidateDigest"] !== candidateDigest) {
    throw conflict("TERMINAL_CANDIDATE_INTEGRITY_FAILED", "Terminal Candidate does not match its digest");
  }
  return {
    candidateId: value["candidateId"],
    ...core,
    candidateDigest,
    createdAtProjectionVersion: value["createdAtProjectionVersion"] as number,
  };
}

function parseCoreVerificationResult(value: unknown): CoreVerificationResult {
  if (!isRecord(value) || value["schemaVersion"] !== 1 || value["verdict"] !== "PASSED") {
    throw validation("INVALID_CORE_VERIFICATION", "Core Verification Result is invalid");
  }
  const result = createCoreVerificationResult({
    taskId: value["taskId"] as string,
    specRevision: value["specRevision"] as number,
    candidateCommit: value["candidateCommit"] as string,
    evidenceRefs: value["evidenceRefs"] as readonly string[],
  });
  if (value["verificationDigest"] !== result.verificationDigest) {
    throw conflict("CORE_VERIFICATION_INTEGRITY_FAILED", "Core Verification Result does not match its digest");
  }
  return result;
}

function parseAppliedDocsImpactGate(value: unknown): AppliedDocsImpactGate {
  if (!isRecord(value) || (value["verdict"] !== "PASSED" && value["verdict"] !== "BLOCKED")) {
    throw validation("INVALID_APPLIED_DOCS_GATE", "Applied Docs Impact Gate is invalid");
  }
  assertDigest(value["gateDigest"], "docsImpactGate.gateDigest");
  assertDigest(value["routeDigest"], "docsImpactGate.routeDigest");
  assertDigest(value["reportDigest"], "docsImpactGate.reportDigest");
  assertPositiveInteger(value["appliedAtProjectionVersion"], "docsImpactGate.appliedAtProjectionVersion");
  return {
    gateDigest: value["gateDigest"],
    routeDigest: value["routeDigest"],
    reportDigest: value["reportDigest"],
    verdict: value["verdict"],
    appliedAtProjectionVersion: value["appliedAtProjectionVersion"] as number,
  };
}

function normalizeRoleCompletion(input: RoleDispatchCompletionInput): RoleDispatchCompletionInput {
  if (typeof input.dispatchId !== "string" || !input.dispatchId.startsWith("dispatch:")) {
    throw validation("INVALID_ROLE_COMPLETION", "Role completion dispatchId is invalid");
  }
  assertCoreRole(input.role);
  const attemptId = requiredString(input.attemptId, "attemptId");
  assertPositiveInteger(input.attemptGeneration, "attemptGeneration");
  assertDigest(input.inputDigest, "inputDigest");
  assertDigest(input.resultDigest, "resultDigest");
  if (input.outcome !== "SUCCEEDED") {
    throw conflict("ROLE_COMPLETION_NOT_SUCCESSFUL", "Only a successful Role Result can complete a Pending Role Dispatch");
  }
  return {
    dispatchId: input.dispatchId,
    role: input.role,
    attemptId,
    attemptGeneration: input.attemptGeneration,
    inputDigest: input.inputDigest,
    resultDigest: input.resultDigest,
    outcome: input.outcome,
  };
}

function parseCompletedRoleDispatch(value: unknown): CompletedRoleDispatch {
  if (!isRecord(value)) throw validation("INVALID_ROLE_COMPLETION", "completed Role Dispatch is invalid");
  const normalized = normalizeRoleCompletion({
    dispatchId: value["dispatchId"] as string,
    role: value["role"] as CoreRole,
    attemptId: value["attemptId"] as string,
    attemptGeneration: value["attemptGeneration"] as number,
    inputDigest: value["inputDigest"] as string,
    resultDigest: value["resultDigest"] as string,
    outcome: value["outcome"] as "SUCCEEDED",
  });
  assertPositiveInteger(value["completedAtProjectionVersion"], "completedAtProjectionVersion");
  return { ...normalized, completedAtProjectionVersion: value["completedAtProjectionVersion"] as number };
}

function completionWithoutVersion(value: CompletedRoleDispatch): RoleDispatchCompletionInput {
  const { completedAtProjectionVersion: _version, ...input } = value;
  return input;
}

function requiredRoleForStage(stage: CoreControlStage): CoreRole | null {
  if (stage === "DOCS_REQUIRED") return "DOCS";
  if (stage === "IMPLEMENTATION_REQUIRED") return "IMPLEMENTATION";
  if (stage === "REVIEW_REQUIRED") return "REVIEW";
  return null;
}

function runningStageForRole(role: CoreRole): CoreControlStage {
  if (role === "DOCS") return "DOCS_RUNNING";
  if (role === "IMPLEMENTATION") return "IMPLEMENTATION_RUNNING";
  return "REVIEW_RUNNING";
}

function completedStageForRole(role: CoreRole): CoreControlStage {
  if (role === "DOCS") return "IMPLEMENTATION_REQUIRED";
  if (role === "IMPLEMENTATION") return "REVIEW_REQUIRED";
  return "REVIEW_GATE_REQUIRED";
}

function parseAppliedReviewGate(value: unknown): AppliedReviewGate {
  if (!isRecord(value)) throw validation("INVALID_APPLIED_REVIEW_GATE", "applied Review Gate is invalid");
  assertDigest(value["gateDigest"], "reviewGate.gateDigest");
  assertDigest(value["roleRunResultDigest"], "reviewGate.roleRunResultDigest");
  assertDigest(value["reviewResultDigest"], "reviewGate.reviewResultDigest");
  if (typeof value["candidateCommit"] !== "string" ||
      !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value["candidateCommit"])) {
    throw validation("INVALID_APPLIED_REVIEW_GATE", "reviewGate candidateCommit is invalid");
  }
  if (value["verdict"] !== "PASSED" && value["verdict"] !== "BLOCKED") {
    throw validation("INVALID_APPLIED_REVIEW_GATE", "reviewGate verdict is invalid");
  }
  if (!Array.isArray(value["unresolvedBlockingFindingRefs"]) ||
      !value["unresolvedBlockingFindingRefs"].every((item) => typeof item === "string")) {
    throw validation("INVALID_APPLIED_REVIEW_GATE", "reviewGate Finding refs are invalid");
  }
  assertPositiveInteger(value["appliedAtProjectionVersion"], "reviewGate.appliedAtProjectionVersion");
  return {
    gateDigest: value["gateDigest"],
    roleRunResultDigest: value["roleRunResultDigest"],
    reviewResultDigest: value["reviewResultDigest"],
    candidateCommit: value["candidateCommit"],
    verdict: value["verdict"],
    unresolvedBlockingFindingRefs: [...value["unresolvedBlockingFindingRefs"]],
    appliedAtProjectionVersion: value["appliedAtProjectionVersion"] as number,
  };
}

function roleScheduleReason(role: CoreRole): string {
  if (role === "DOCS") return "Initial Spec, plan and design artifacts are required before implementation";
  if (role === "IMPLEMENTATION") return "Accepted Docs artifacts authorize an implementation Attempt";
  return "Implementation evidence requires an independent Review verdict";
}

function finalizeProjection(core: Omit<CoreProjection, "projectionDigest">): CoreProjection {
  const projection: CoreProjection = { ...core, projectionDigest: digest("core-projection", core) };
  trustedProjections.add(projection);
  return deepFreeze(projection);
}

function projectionWithoutDigest(projection: CoreProjection): Omit<CoreProjection, "projectionDigest"> {
  const { projectionDigest: _digest, ...core } = projection;
  return core;
}

function assertTrustedDecision(decision: ControlDecision): void {
  if (!isRecord(decision) || !trustedDecisions.has(decision) || !Object.isFrozen(decision)) {
    throw validation("UNTRUSTED_CONTROL_DECISION", "ControlDecision must come from createControlDecision or parseControlDecision");
  }
  const parsed = parseControlDecision(JSON.parse(JSON.stringify(decision)) as unknown, decision.decisionDigest);
  if (parsed.decisionId !== decision.decisionId) {
    throw conflict("CONTROL_DECISION_INTEGRITY_FAILED", "ControlDecision identity is stale");
  }
}

function assertTrustedProjection(projection: CoreProjection): void {
  if (!isRecord(projection) || !trustedProjections.has(projection) || !Object.isFrozen(projection)) {
    throw validation("UNTRUSTED_CORE_PROJECTION", "CoreProjection must come from the Core Control protocol");
  }
  const { projectionDigest, ...core } = projection;
  if (projectionDigest !== digest("core-projection", core)) {
    throw conflict("CORE_PROJECTION_INTEGRITY_FAILED", "CoreProjection digest is stale");
  }
}

function assertTrustedVerification(verification: CoreVerificationResult): void {
  if (!trustedVerifications.has(verification) || !Object.isFrozen(verification)) {
    throw validation("UNTRUSTED_CORE_VERIFICATION", "Core Verification Result must come from its domain protocol");
  }
  const { verificationDigest, ...core } = verification;
  if (verificationDigest !== digest("core-verification-result", core)) {
    throw conflict("CORE_VERIFICATION_INTEGRITY_FAILED", "Core Verification Result digest is stale");
  }
}

function assertProjectionMatchesEnvelope(projection: CoreProjection, envelope: TaskEnvelope): void {
  if (projection.taskId !== envelope.taskId || projection.specRevision !== envelope.specRevision ||
      projection.envelopeDigest !== envelope.envelopeDigest) {
    throw conflict("CORE_ENVELOPE_MISMATCH", "CoreProjection does not belong to the TaskEnvelope");
  }
}

function revalidateEnvelope(envelope: TaskEnvelope): TaskEnvelope {
  return parseTaskEnvelope(JSON.parse(JSON.stringify(envelope)) as unknown, envelope.envelopeDigest);
}

function normalizeRefs(values: readonly string[], field: string): string[] {
  if (!Array.isArray(values)) throw validation("INVALID_REFERENCE_LIST", `${field} must be an array`);
  const normalized = values.map((value) => requiredString(value, field)).sort();
  if (new Set(normalized).size !== normalized.length) {
    throw validation("DUPLICATE_REFERENCE", `${field} must not contain duplicate references`);
  }
  return normalized;
}

function assertCoreRole(value: CoreRole): void {
  if (!CORE_ROLES.includes(value)) throw validation("INVALID_CORE_ROLE", `Invalid Core Role: ${String(value)}`);
}

function assertControlAction(value: ControlAction): void {
  if (!CONTROL_ACTIONS.includes(value)) throw validation("INVALID_CONTROL_ACTION", `Invalid Control action: ${String(value)}`);
}

function assertControlState(value: CoreControlState): void {
  const states: readonly CoreControlState[] = ["RUNNING", "WAITING_RECONCILE", "WAITING_HUMAN", "CLOSING", "CLOSED"];
  if (!states.includes(value)) throw validation("INVALID_CORE_STATE", `Invalid Core state: ${String(value)}`);
}

function assertErrorCategory(value: MoyeErrorCategory): void {
  const categories: readonly MoyeErrorCategory[] = [
    "VALIDATION", "CONFLICT", "NOT_FOUND", "TRANSIENT_IO", "UNKNOWN_SIDE_EFFECT", "TERMINAL",
  ];
  if (!categories.includes(value)) {
    throw validation("INVALID_ERROR_CATEGORY", `Invalid error category: ${String(value)}`);
  }
}

function assertControlStage(value: CoreControlStage): void {
  const stages: readonly CoreControlStage[] = [
    "DOCS_REQUIRED", "DOCS_RUNNING", "IMPLEMENTATION_REQUIRED", "IMPLEMENTATION_RUNNING",
    "REVIEW_REQUIRED", "REVIEW_RUNNING", "REVIEW_GATE_REQUIRED", "REPAIR_REQUIRED",
    "VERIFICATION_REQUIRED", "DOCS_IMPACT_REQUIRED",
    "CLOSURE_REQUIRED", "CLOSED",
  ];
  if (!stages.includes(value)) throw validation("INVALID_CORE_STAGE", `Invalid Core stage: ${String(value)}`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw validation("INVALID_STRING", `${field} must be a non-empty string without NUL bytes`);
  }
  return value.trim();
}

function assertPositiveInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw validation("INVALID_POSITIVE_INTEGER", `${field} must be a positive integer`);
  }
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw validation("INVALID_NON_NEGATIVE_INTEGER", `${field} must be a non-negative integer`);
  }
  return value as number;
}

function assertDigest(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw validation("INVALID_DIGEST", `${field} must be a SHA-256 digest`);
  }
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${digestHex(namespace, value)}`;
}

function digestHex(namespace: string, value: unknown): string {
  return createHash("sha256").update(namespace).update("\0").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validation(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "VALIDATION", message });
}

function conflict(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "CONFLICT", message });
}
