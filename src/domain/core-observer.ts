import { createHash } from "node:crypto";

import type { TaskEnvelope } from "./coding-task.js";
import { parseTaskEnvelope } from "./coding-task.js";
import type { CoreBudgetInput, CoreProjection, CoreRole } from "./core-control.js";
import { parseCoreProjection } from "./core-control.js";
import { MoyeError } from "./errors.js";

export type ObserverAlertKind = "STALLED" | "REPEATED_FAILURE" | "BUDGET_NEAR_LIMIT" | "UNKNOWN_EFFECT";
export type KnowledgeCandidateKind = "FINDING" | "BACKLOG" | "PITFALL" | "RUNBOOK" | "DOCS_IMPACT";

export interface ObserverAttemptFactInput {
  readonly role: CoreRole;
  readonly attemptId: string;
  readonly generation: number;
  readonly sessionId?: string;
  readonly commit?: string;
  readonly artifactRefs: readonly string[];
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly modelCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number;
}

export interface ObserverAttemptFact extends ObserverAttemptFactInput {
  readonly durationMs: number | null;
}

export interface KnowledgeCandidateSeed {
  readonly targetKind: KnowledgeCandidateKind;
  readonly sourceRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly summary: string;
}

export interface KnowledgeCandidate {
  readonly schemaVersion: 1;
  readonly candidateId: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly targetKind: KnowledgeCandidateKind;
  readonly promotionStatus: "PROPOSED";
  readonly sourceRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly summary: string;
  readonly candidateDigest: string;
}

export interface ObserverAlertCandidate {
  readonly alertId: string;
  readonly kind: ObserverAlertKind;
  readonly severity: "WARNING" | "CRITICAL";
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly alertDigest: string;
}

export interface CoreObserverInput {
  readonly envelope: TaskEnvelope;
  readonly projection: CoreProjection;
  readonly attempts: readonly ObserverAttemptFactInput[];
  readonly findingRefs: readonly string[];
  readonly verificationRefs: readonly string[];
  readonly invocationRefs: readonly string[];
  readonly initialBudget: CoreBudgetInput;
  readonly observedAt: string;
  readonly lastProgressAt: string;
  readonly staleAfterMs: number;
  readonly budgetWarningRatio: number;
  readonly knowledgeSeeds?: readonly KnowledgeCandidateSeed[];
}

export interface CoreObserverReport {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly projectionDigest: string;
  readonly observedAt: string;
  readonly state: CoreProjection["state"];
  readonly stage: CoreProjection["stage"];
  readonly trace: {
    readonly workflowRef: string;
    readonly attemptIds: readonly string[];
    readonly sessionIds: readonly string[];
    readonly commitRefs: readonly string[];
    readonly artifactRefs: readonly string[];
    readonly findingRefs: readonly string[];
    readonly verificationRefs: readonly string[];
    readonly invocationRefs: readonly string[];
  };
  readonly usage: {
    readonly durationMs: number;
    readonly modelCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costMicros: number;
  };
  readonly recovery: {
    readonly operationRetries: number;
    readonly roleAttemptRetries: number;
    readonly repairs: number;
    readonly replans: number;
    readonly roleFailures: number;
    readonly reconciles: number;
  };
  readonly alerts: readonly ObserverAlertCandidate[];
  readonly knowledgeCandidates: readonly KnowledgeCandidate[];
  readonly reportDigest: string;
}

export function createKnowledgeCandidate(
  taskId: string,
  specRevision: number,
  seed: KnowledgeCandidateSeed,
): KnowledgeCandidate {
  const targetKind = readKnowledgeKind(seed.targetKind);
  const sourceRefs = refs(seed.sourceRefs, "sourceRefs", true);
  const evidenceRefs = refs(seed.evidenceRefs, "evidenceRefs", true);
  const summary = requiredString(seed.summary, "summary");
  const identity = { taskId, specRevision, targetKind, sourceRefs, evidenceRefs, summary };
  const candidateId = `knowledge-candidate:${digestHex("knowledge-candidate-id", identity)}`;
  const core = {
    schemaVersion: 1 as const,
    candidateId,
    ...identity,
    promotionStatus: "PROPOSED" as const,
  };
  return deepFreeze({ ...core, candidateDigest: digest("knowledge-candidate", core) });
}

export function createCoreObserverReport(input: CoreObserverInput): CoreObserverReport {
  const envelope = parseTaskEnvelope(
    JSON.parse(JSON.stringify(input.envelope)) as unknown,
    input.envelope.envelopeDigest,
  );
  const projection = parseCoreProjection(
    JSON.parse(JSON.stringify(input.projection)) as unknown,
    envelope,
    input.projection.projectionDigest,
  );
  const observedAt = isoInstant(input.observedAt, "observedAt");
  const lastProgressAt = isoInstant(input.lastProgressAt, "lastProgressAt");
  if (Date.parse(lastProgressAt) > Date.parse(observedAt)) {
    throw validation("OBSERVER_TIME_ORDER_INVALID", "lastProgressAt cannot be after observedAt");
  }
  const staleAfterMs = nonNegativeInteger(input.staleAfterMs, "staleAfterMs");
  if (!Number.isFinite(input.budgetWarningRatio) || input.budgetWarningRatio <= 0 || input.budgetWarningRatio > 1) {
    throw validation("INVALID_BUDGET_WARNING_RATIO", "budgetWarningRatio must be in (0, 1]");
  }
  const attempts = input.attempts.map(normalizeAttempt);
  unique(attempts.map((item) => `${item.attemptId}:${item.generation}`), "Observer Attempt");
  const knownAttempts = new Set([
    ...projection.completedRoleDispatches.map((item) => item.attemptId),
    ...projection.roleAttemptFailures.map((item) => item.attemptId),
    ...(projection.pendingRole === null ? [] : [
      `${projection.taskId}/CORE-${projection.pendingRole.role}/attempt-${String(projection.pendingRole.generation).padStart(3, "0")}`,
    ]),
  ]);
  for (const attempt of attempts) {
    const expected = `${projection.taskId}/CORE-${attempt.role}/attempt-${String(attempt.generation).padStart(3, "0")}`;
    if (attempt.attemptId !== expected || !knownAttempts.has(attempt.attemptId)) {
      throw conflict("OBSERVER_ATTEMPT_NOT_IN_PROJECTION", `Observer Attempt ${attempt.attemptId} is not a persisted Core fact`);
    }
  }
  const findingRefs = refs(input.findingRefs, "findingRefs", false);
  const verificationRefs = refs(input.verificationRefs, "verificationRefs", false);
  const invocationRefs = refs(input.invocationRefs, "invocationRefs", true);
  const initialBudget = normalizeInitialBudget(input.initialBudget);
  const alerts = deriveAlerts(
    projection,
    initialBudget,
    observedAt,
    lastProgressAt,
    staleAfterMs,
    input.budgetWarningRatio,
  );
  const knowledgeCandidates = (input.knowledgeSeeds ?? [])
    .map((seed) => createKnowledgeCandidate(projection.taskId, projection.specRevision, seed))
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  unique(knowledgeCandidates.map((item) => item.candidateId), "Knowledge Candidate");
  const core = {
    schemaVersion: 1 as const,
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    projectionDigest: projection.projectionDigest,
    observedAt,
    state: projection.state,
    stage: projection.stage,
    trace: {
      workflowRef: `restate-workflow://CoreClosureWorkflow/${projection.taskId}`,
      attemptIds: sorted(attempts.map((item) => item.attemptId)),
      sessionIds: sorted(attempts.flatMap((item) => item.sessionId === undefined ? [] : [item.sessionId])),
      commitRefs: sorted(attempts.flatMap((item) => item.commit === undefined ? [] : [`git-commit://${item.commit}`])),
      artifactRefs: sorted(attempts.flatMap((item) => item.artifactRefs)),
      findingRefs,
      verificationRefs,
      invocationRefs,
    },
    usage: {
      durationMs: attempts.reduce((sum, item) => sum + (item.durationMs ?? 0), 0),
      modelCalls: attempts.reduce((sum, item) => sum + item.modelCalls, 0),
      inputTokens: attempts.reduce((sum, item) => sum + item.inputTokens, 0),
      outputTokens: attempts.reduce((sum, item) => sum + item.outputTokens, 0),
      costMicros: attempts.reduce((sum, item) => sum + item.costMicros, 0),
    },
    recovery: {
      operationRetries: projection.recoveryActions.filter((item) => item.action === "OPERATION_RETRY").length,
      roleAttemptRetries: projection.recoveryActions.filter((item) => item.action === "ROLE_ATTEMPT_RETRY").length,
      repairs: projection.recoveryActions.filter((item) => item.action === "REPAIR").length,
      replans: projection.recoveryActions.filter((item) => item.action === "REPLAN").length,
      roleFailures: projection.roleAttemptFailures.length,
      reconciles: projection.reconcileHistory.length,
    },
    alerts,
    knowledgeCandidates,
  };
  return deepFreeze({ ...core, reportDigest: digest("core-observer-report", core) });
}

function deriveAlerts(
  projection: CoreProjection,
  initial: ReturnType<typeof normalizeInitialBudget>,
  observedAt: string,
  lastProgressAt: string,
  staleAfterMs: number,
  warningRatio: number,
): ObserverAlertCandidate[] {
  const seeds: Array<Omit<ObserverAlertCandidate, "alertId" | "alertDigest">> = [];
  if (projection.state === "RUNNING" && Date.parse(observedAt) - Date.parse(lastProgressAt) >= staleAfterMs) {
    seeds.push({
      kind: "STALLED",
      severity: "WARNING",
      summary: `No Core progress for at least ${staleAfterMs}ms`,
      evidenceRefs: [`core-projection://${projection.projectionDigest}`],
    });
  }
  const failuresByCode = new Map<string, CoreProjection["roleAttemptFailures"][number][]>();
  for (const failure of projection.roleAttemptFailures) {
    failuresByCode.set(failure.errorCode, [...(failuresByCode.get(failure.errorCode) ?? []), failure]);
  }
  const repeated = [...failuresByCode.entries()]
    .filter(([, failures]) => failures.length >= 2)
    .map(([code, failures]) => ({ code, failures }));
  for (const item of repeated) {
    seeds.push({
      kind: "REPEATED_FAILURE",
      severity: "CRITICAL",
      summary: `Role failure ${item.code} repeated ${item.failures.length} times`,
      evidenceRefs: item.failures.map((failure) => `role-failure://${failure.failureDigest}`).sort(),
    });
  }
  if (nearBudgetLimit(projection, initial, warningRatio)) {
    seeds.push({
      kind: "BUDGET_NEAR_LIMIT",
      severity: "WARNING",
      summary: "One or more Core budgets are near their configured limit",
      evidenceRefs: [`core-projection://${projection.projectionDigest}`],
    });
  }
  if (projection.pendingReconcile !== null) {
    seeds.push({
      kind: "UNKNOWN_EFFECT",
      severity: "CRITICAL",
      summary: `External operation ${projection.pendingReconcile.operationId} requires reconciliation`,
      evidenceRefs: [`unknown-effect://${projection.pendingReconcile.waitDigest}`],
    });
  }
  return seeds.map((seed) => {
    const normalized = { ...seed, evidenceRefs: refs(seed.evidenceRefs, "alert.evidenceRefs", true) };
    const alertId = `observer-alert:${digestHex("observer-alert-id", {
      taskId: projection.taskId,
      specRevision: projection.specRevision,
      ...normalized,
    })}`;
    return deepFreeze({ ...normalized, alertId, alertDigest: digest("observer-alert", { alertId, ...normalized }) });
  }).sort((left, right) => left.alertId.localeCompare(right.alertId));
}

function nearBudgetLimit(
  projection: CoreProjection,
  initial: ReturnType<typeof normalizeInitialBudget>,
  ratio: number,
): boolean {
  const pairs = [
    [projection.budget.operationRetriesRemaining, initial.operationRetries],
    [projection.budget.roleAttemptsRemaining, initial.roleAttempts],
    [projection.budget.repairsRemaining, initial.repairs],
    [projection.budget.replansRemaining, initial.replans],
    [projection.budget.modelCallsRemaining, initial.modelCalls],
    [projection.budget.totalTimeRemainingMs, initial.totalTimeMs],
  ] as const;
  return pairs.some(([remaining, total]) => total > 0 && remaining / total <= ratio);
}

function normalizeAttempt(value: ObserverAttemptFactInput): ObserverAttemptFact {
  const role: CoreRole = value.role;
  if (!["DOCS", "IMPLEMENTATION", "REVIEW"].includes(role)) {
    throw validation("INVALID_OBSERVER_ROLE", `Invalid Observer role: ${String(role)}`);
  }
  const attemptId = requiredString(value.attemptId, "attemptId");
  const generation = positiveInteger(value.generation, "generation");
  const startedAt = isoInstant(value.startedAt, "startedAt");
  const finishedAt = value.finishedAt === undefined ? undefined : isoInstant(value.finishedAt, "finishedAt");
  if (finishedAt !== undefined && Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw validation("OBSERVER_ATTEMPT_TIME_INVALID", "Attempt finishedAt cannot precede startedAt");
  }
  const commit = value.commit;
  if (commit !== undefined && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit)) {
    throw validation("INVALID_OBSERVER_COMMIT", "Observer commit must be a full Git object ID");
  }
  return {
    role,
    attemptId,
    generation,
    ...(value.sessionId === undefined ? {} : { sessionId: requiredString(value.sessionId, "sessionId") }),
    ...(commit === undefined ? {} : { commit }),
    artifactRefs: refs(value.artifactRefs, "artifactRefs", false),
    startedAt,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    modelCalls: nonNegativeInteger(value.modelCalls, "modelCalls"),
    inputTokens: nonNegativeInteger(value.inputTokens, "inputTokens"),
    outputTokens: nonNegativeInteger(value.outputTokens, "outputTokens"),
    costMicros: nonNegativeInteger(value.costMicros, "costMicros"),
    durationMs: finishedAt === undefined ? null : Date.parse(finishedAt) - Date.parse(startedAt),
  };
}

function normalizeInitialBudget(input: CoreBudgetInput) {
  return {
    operationRetries: nonNegativeInteger(input.operationRetries, "initialBudget.operationRetries"),
    roleAttempts: nonNegativeInteger(input.roleAttempts, "initialBudget.roleAttempts"),
    repairs: nonNegativeInteger(input.repairs, "initialBudget.repairs"),
    replans: nonNegativeInteger(input.replans, "initialBudget.replans"),
    modelCalls: nonNegativeInteger(input.modelCalls, "initialBudget.modelCalls"),
    totalTimeMs: nonNegativeInteger(input.totalTimeMs, "initialBudget.totalTimeMs"),
  };
}

function readKnowledgeKind(value: KnowledgeCandidateKind): KnowledgeCandidateKind {
  const values: readonly KnowledgeCandidateKind[] = ["FINDING", "BACKLOG", "PITFALL", "RUNBOOK", "DOCS_IMPACT"];
  if (!values.includes(value)) throw validation("INVALID_KNOWLEDGE_KIND", `Invalid Knowledge Candidate kind: ${String(value)}`);
  return value;
}

function refs(values: readonly string[], field: string, required: boolean): string[] {
  if (!Array.isArray(values)) throw validation("INVALID_OBSERVER_REFS", `${field} must be an array`);
  const normalized = sorted(values.map((item) => requiredString(item, field)));
  unique(normalized, field);
  if (required && normalized.length === 0) throw validation("OBSERVER_REFS_REQUIRED", `${field} cannot be empty`);
  return normalized;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw validation("DUPLICATE_OBSERVER_FACT", `${label} must be unique`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw validation("INVALID_OBSERVER_STRING", `${field} must be a non-empty string without NUL bytes`);
  }
  return value.trim();
}

function isoInstant(value: unknown, field: string): string {
  const string = requiredString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(string) || !Number.isFinite(Date.parse(string))) {
    throw validation("INVALID_OBSERVER_TIME", `${field} must be an ISO timestamp`);
  }
  return string;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw validation("INVALID_OBSERVER_INTEGER", `${field} must be a positive integer`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw validation("INVALID_OBSERVER_INTEGER", `${field} must be a non-negative integer`);
  }
  return value as number;
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
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function validation(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "VALIDATION", message });
}

function conflict(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "CONFLICT", message });
}
