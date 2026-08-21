import { createHash } from "node:crypto";

import type { TaskEnvelope } from "./coding-task.js";
import { parseTaskEnvelope } from "./coding-task.js";
import { MoyeError } from "./errors.js";
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
  readonly pendingRole: PendingRoleDispatch | null;
  readonly projectionDigest: string;
}

const trustedDecisions = new WeakSet<object>();
const trustedProjections = new WeakSet<object>();

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
  if (input.action !== "SCHEDULE_ROLE" && targetRole !== null) {
    throw validation("CONTROL_TARGET_ROLE_INVALID", `${input.action} cannot carry targetRole`);
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
      budgetRequest: { roleAttempts: 1, modelCalls: 1 },
    });
  }
  return null;
}

export function applyControlDecision(
  projection: CoreProjection,
  decision: ControlDecision,
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
  if (decision.action !== "SCHEDULE_ROLE") {
    throw conflict(
      "CONTROL_ACTION_NOT_AVAILABLE_IN_SLICE",
      `${decision.action} is reserved for a later Core Closure slice`,
    );
  }
  assertBudgetAvailable(projection.budget, decision.budgetRequest);
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
  const pendingCore = {
    decisionId: decision.decisionId,
    role: decision.targetRole,
    generation: 1,
    inputDigest: digest("role-dispatch-input", {
      taskId: projection.taskId,
      specRevision: projection.specRevision,
      envelopeDigest: projection.envelopeDigest,
      role: decision.targetRole,
      decisionDigest: decision.decisionDigest,
    }),
  };
  const pendingRole: PendingRoleDispatch = {
    dispatchId: `dispatch:${digestHex("role-dispatch-id", pendingCore)}`,
    ...pendingCore,
  };
  return finalizeProjection({
    ...projectionWithoutDigest(projection),
    projectionVersion: nextVersion,
    stage: runningStageForRole(requiredRole),
    budget: consumeBudget(projection.budget, decision.budgetRequest),
    appliedDecisions: [...projection.appliedDecisions, {
      decisionId: decision.decisionId,
      decisionDigest: decision.decisionDigest,
      appliedAtProjectionVersion: nextVersion,
      action: decision.action,
    }],
    pendingRole,
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
      pending.inputDigest !== normalized.inputDigest) {
    throw conflict("ROLE_COMPLETION_DISPATCH_MISMATCH", "Role completion does not match the current Pending Role Dispatch");
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

export function parseCoreProjection(
  value: unknown,
  envelope: TaskEnvelope,
  expectedDigest: string,
): CoreProjection {
  const trustedEnvelope = revalidateEnvelope(envelope);
  if (!isRecord(value) || value["schemaVersion"] !== 1 || !isRecord(value["budget"]) ||
      !Array.isArray(value["appliedDecisions"]) || !Array.isArray(value["completedRoleDispatches"])) {
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
  if (request.roleAttempts !== 1 || request.modelCalls > 1 || request.operationRetries > 0 ||
      request.repairs > 0 || request.replans > 0) {
    throw conflict("INVALID_ROLE_BUDGET_REQUEST", "initial Role scheduling consumes exactly one Role Attempt and at most one model call");
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
