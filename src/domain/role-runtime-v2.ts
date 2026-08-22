import { createHash } from "node:crypto";

import { MoyeError } from "./errors.js";
import { assertTaskId } from "./task.js";

export const AGENT_ROLES_V2 = [
  "ARCHITECT",
  "IMPLEMENTATION",
  "DOCUMENTATION",
  "TEST_VERIFICATION",
  "REVIEW",
  "OBSERVER_KNOWLEDGE",
] as const;

export const ROLE_PHASES_V2 = [
  "ARCHITECT",
  "IMPLEMENTATION",
  "DOCUMENTATION",
  "TEST_PLAN",
  "TEST_ASSESSMENT",
  "DESIGN_REVIEW",
  "FINAL_REVIEW",
  "OBSERVER_KNOWLEDGE",
] as const;

export type AgentRoleV2 = (typeof AGENT_ROLES_V2)[number];
export type RolePhaseV2 = (typeof ROLE_PHASES_V2)[number];
export type RealRoleRunnerKind = "CODEX_EXEC" | "CLAUDE_PRINT";
export type RolePermission = "READ_ONLY" | "WORKSPACE_WRITE";
export type RoleAttemptState = "SCHEDULED" | "RUNNING" | "WAITING_RECONCILE" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface RoleAttemptEventV2 {
  readonly sequence: number;
  readonly type: string;
  readonly at: string;
  readonly detail?: string;
}

export interface RoleUnknownEffectV2 {
  readonly runId: string;
  readonly operationId: string;
  readonly reconcileToken: string;
  readonly reason: string;
  readonly unknownDigest: string;
}

export interface RoleRunEvidenceV2 {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly role: AgentRoleV2;
  readonly phase: RolePhaseV2;
  readonly attemptId: string;
  readonly generation: number;
  readonly runnerKind: RealRoleRunnerKind;
  readonly sessionId?: string;
  readonly outcome: "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly eventsRef: string;
  readonly eventsDigest: string;
  readonly stderrRef: string;
  readonly stderrDigest: string;
  readonly outputRef: string;
  readonly outputDigest: string;
  readonly manifestRef: string;
  readonly manifestDigest: string;
  readonly artifactRefs: readonly string[];
  readonly findingRefs: readonly string[];
  readonly evidenceDigest: string;
}

export interface RoleAttemptV2 {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly role: AgentRoleV2;
  readonly phase: RolePhaseV2;
  readonly attemptId: string;
  readonly generation: number;
  readonly runnerKind: RealRoleRunnerKind;
  readonly permission: RolePermission;
  readonly inputDigest: string;
  readonly subjectCommit: string;
  readonly inputArtifactRefs: readonly string[];
  readonly state: RoleAttemptState;
  readonly scheduledAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly run?: RoleRunEvidenceV2;
  readonly unknown?: RoleUnknownEffectV2;
  readonly error?: string;
  readonly retryAuthorized?: boolean;
  readonly events: readonly RoleAttemptEventV2[];
  readonly attemptDigest: string;
}

export interface CreateRoleAttemptV2Input {
  readonly taskId: string;
  readonly specRevision: number;
  readonly role: AgentRoleV2;
  readonly phase: RolePhaseV2;
  readonly generation: number;
  readonly runnerKind: RealRoleRunnerKind;
  readonly inputDigest: string;
  readonly subjectCommit: string;
  readonly inputArtifactRefs: readonly string[];
  readonly scheduledAt: string;
}

const rolePhases: Readonly<Record<AgentRoleV2, readonly RolePhaseV2[]>> = {
  ARCHITECT: ["ARCHITECT"],
  IMPLEMENTATION: ["IMPLEMENTATION"],
  DOCUMENTATION: ["DOCUMENTATION"],
  TEST_VERIFICATION: ["TEST_PLAN", "TEST_ASSESSMENT"],
  REVIEW: ["DESIGN_REVIEW", "FINAL_REVIEW"],
  OBSERVER_KNOWLEDGE: ["OBSERVER_KNOWLEDGE"],
};

export function createRoleAttemptV2(input: CreateRoleAttemptV2Input): RoleAttemptV2 {
  const normalized = normalizeCreate(input);
  const attemptId = `${normalized.taskId}/${normalized.phase}/r${normalized.specRevision}/g${normalized.generation}`;
  return sealAttempt({
    schemaVersion: 1,
    ...normalized,
    attemptId,
    state: "SCHEDULED",
    events: [{ sequence: 1, type: "RoleAttemptScheduled", at: normalized.scheduledAt }],
  });
}

export function createNextRoleAttemptV2(input: {
  readonly previous: RoleAttemptV2;
  readonly inputDigest: string;
  readonly subjectCommit: string;
  readonly inputArtifactRefs: readonly string[];
  readonly scheduledAt: string;
}): RoleAttemptV2 {
  const previous = parseRoleAttemptV2(JSON.parse(JSON.stringify(input.previous)), input.previous.attemptDigest);
  if (previous.state !== "FAILED") {
    throw conflict("ROLE_RETRY_PREVIOUS_NOT_FAILED", "A new Generation requires a FAILED previous Attempt");
  }
  if (previous.unknown !== undefined && previous.retryAuthorized !== true) {
    throw conflict("ROLE_RETRY_RECONCILE_REQUIRED", "An UNKNOWN Role Run requires NOT_APPLIED reconcile evidence before retry");
  }
  return createRoleAttemptV2({
    taskId: previous.taskId,
    specRevision: previous.specRevision,
    role: previous.role,
    phase: previous.phase,
    generation: previous.generation + 1,
    runnerKind: previous.runnerKind,
    inputDigest: input.inputDigest,
    subjectCommit: input.subjectCommit,
    inputArtifactRefs: input.inputArtifactRefs,
    scheduledAt: input.scheduledAt,
  });
}

export function startRoleAttemptV2(attemptInput: RoleAttemptV2, at: string): RoleAttemptV2 {
  const attempt = parseRoleAttemptV2(JSON.parse(JSON.stringify(attemptInput)), attemptInput.attemptDigest);
  if (attempt.state !== "SCHEDULED") throw conflict("ROLE_ATTEMPT_START_INVALID", "Only SCHEDULED Attempt can start");
  const timestamp = instant(at, "startedAt");
  return sealAttempt({
    ...withoutDigest(attempt),
    state: "RUNNING",
    startedAt: timestamp,
    events: appendEvent(attempt.events, "RoleAttemptStarted", timestamp),
  });
}

export function completeRoleAttemptV2(
  attemptInput: RoleAttemptV2,
  evidenceInput: RoleRunEvidenceV2,
  at: string,
): RoleAttemptV2 {
  const attempt = parseRoleAttemptV2(JSON.parse(JSON.stringify(attemptInput)), attemptInput.attemptDigest);
  if (attempt.state !== "RUNNING" && attempt.state !== "WAITING_RECONCILE") {
    throw conflict("ROLE_ATTEMPT_COMPLETE_INVALID", "Only RUNNING or reconciled WAITING Attempt can complete");
  }
  const evidence = parseRoleRunEvidenceV2(JSON.parse(JSON.stringify(evidenceInput)), evidenceInput.evidenceDigest);
  assertEvidenceBinding(attempt, evidence);
  const timestamp = instant(at, "finishedAt");
  const succeeded = evidence.outcome === "SUCCEEDED";
  return sealAttempt({
    ...withoutDigest(attempt),
    state: succeeded ? "SUCCEEDED" : "FAILED",
    finishedAt: timestamp,
    run: evidence,
    ...(succeeded ? {} : { error: `Role Run ${evidence.outcome}` }),
    events: appendEvent(
      attempt.events,
      succeeded ? "RoleAttemptSucceeded" : "RoleAttemptFailed",
      timestamp,
      evidence.runId,
    ),
  });
}

export function failRoleAttemptV2(attemptInput: RoleAttemptV2, error: string, at: string): RoleAttemptV2 {
  const attempt = parseRoleAttemptV2(JSON.parse(JSON.stringify(attemptInput)), attemptInput.attemptDigest);
  if (attempt.state !== "RUNNING") throw conflict("ROLE_ATTEMPT_FAIL_INVALID", "Only RUNNING Attempt can fail");
  const timestamp = instant(at, "finishedAt");
  const detail = requiredString(error, "error");
  return sealAttempt({
    ...withoutDigest(attempt),
    state: "FAILED",
    finishedAt: timestamp,
    error: detail,
    events: appendEvent(attempt.events, "RoleAttemptFailed", timestamp, detail),
  });
}

export function markRoleAttemptUnknownV2(
  attemptInput: RoleAttemptV2,
  input: { readonly runId: string; readonly operationId: string; readonly reason: string },
  at: string,
): RoleAttemptV2 {
  const attempt = parseRoleAttemptV2(JSON.parse(JSON.stringify(attemptInput)), attemptInput.attemptDigest);
  if (attempt.state !== "RUNNING") throw conflict("ROLE_UNKNOWN_INVALID_STATE", "Only RUNNING Attempt can become UNKNOWN");
  const core = {
    runId: requiredString(input.runId, "runId"),
    operationId: requiredString(input.operationId, "operationId"),
    reason: requiredString(input.reason, "reason"),
  };
  const reconcileToken = roleReconcileTokenV2(attempt, core.runId, core.operationId);
  const unknownCore = { ...core, reconcileToken };
  const unknown = { ...unknownCore, unknownDigest: digest("role-unknown-effect", unknownCore) };
  const timestamp = instant(at, "unknownAt");
  return sealAttempt({
    ...withoutDigest(attempt),
    state: "WAITING_RECONCILE",
    unknown,
    events: appendEvent(attempt.events, "RoleRunUnknown", timestamp, reconcileToken),
  });
}

export function reconcileRoleAttemptV2(
  attemptInput: RoleAttemptV2,
  input: {
    readonly token: string;
    readonly action: "CONFIRMED" | "NOT_APPLIED";
    readonly externalEvidence: string;
    readonly runEvidence?: RoleRunEvidenceV2;
  },
  at: string,
): RoleAttemptV2 {
  const attempt = parseRoleAttemptV2(JSON.parse(JSON.stringify(attemptInput)), attemptInput.attemptDigest);
  if (attempt.state !== "WAITING_RECONCILE" || attempt.unknown === undefined || input.token !== attempt.unknown.reconcileToken) {
    throw conflict("ROLE_RECONCILE_SCOPE_INVALID", "Reconcile token does not match the pending Role Run");
  }
  const externalEvidence = requiredString(input.externalEvidence, "externalEvidence");
  if (input.action === "CONFIRMED") {
    if (input.runEvidence === undefined) throw validation("ROLE_RECONCILE_RESULT_REQUIRED", "CONFIRMED reconcile requires Run Evidence");
    const reconciled = {
      ...withoutDigest(attempt),
      events: appendEvent(attempt.events, "RoleRunReconciledConfirmed", instant(at, "reconciledAt"), externalEvidence),
    };
    return completeRoleAttemptV2(sealAttempt(reconciled), input.runEvidence, at);
  }
  if (input.runEvidence !== undefined) throw validation("ROLE_RECONCILE_RESULT_FORBIDDEN", "NOT_APPLIED cannot include Run Evidence");
  const timestamp = instant(at, "reconciledAt");
  return sealAttempt({
    ...withoutDigest(attempt),
    state: "FAILED",
    finishedAt: timestamp,
    error: `Reconciled NOT_APPLIED: ${externalEvidence}`,
    retryAuthorized: true,
    events: appendEvent(attempt.events, "RoleRunReconciledNotApplied", timestamp, externalEvidence),
  });
}

export function createRoleRunEvidenceV2(input: Omit<RoleRunEvidenceV2, "schemaVersion" | "evidenceDigest">): RoleRunEvidenceV2 {
  assertTaskId(input.taskId);
  const core = {
    schemaVersion: 1 as const,
    runId: requiredString(input.runId, "runId"),
    taskId: input.taskId,
    specRevision: positiveInteger(input.specRevision, "specRevision"),
    role: role(input.role),
    phase: phase(input.phase),
    attemptId: requiredString(input.attemptId, "attemptId"),
    generation: nonNegativeInteger(input.generation, "generation"),
    runnerKind: runnerKind(input.runnerKind),
    ...(input.sessionId === undefined ? {} : { sessionId: requiredString(input.sessionId, "sessionId") }),
    outcome: enumeration(input.outcome, ["SUCCEEDED", "FAILED", "INVALID_OUTPUT"] as const, "outcome"),
    startedAt: instant(input.startedAt, "startedAt"),
    finishedAt: instant(input.finishedAt, "finishedAt"),
    eventsRef: requiredString(input.eventsRef, "eventsRef"),
    eventsDigest: shaDigest(input.eventsDigest, "eventsDigest"),
    stderrRef: requiredString(input.stderrRef, "stderrRef"),
    stderrDigest: shaDigest(input.stderrDigest, "stderrDigest"),
    outputRef: requiredString(input.outputRef, "outputRef"),
    outputDigest: shaDigest(input.outputDigest, "outputDigest"),
    manifestRef: requiredString(input.manifestRef, "manifestRef"),
    manifestDigest: shaDigest(input.manifestDigest, "manifestDigest"),
    artifactRefs: refs(input.artifactRefs, "artifactRefs"),
    findingRefs: refs(input.findingRefs, "findingRefs"),
  };
  if (!rolePhases[core.role].includes(core.phase)) throw validation("ROLE_PHASE_INVALID", `${core.role} cannot execute ${core.phase}`);
  if (Date.parse(core.finishedAt) < Date.parse(core.startedAt)) throw validation("ROLE_TIME_INVALID", "finishedAt precedes startedAt");
  return deepFreeze({ ...core, evidenceDigest: digest("role-run-evidence-v2", core) });
}

export function parseRoleRunEvidenceV2(value: unknown, expectedDigest: string): RoleRunEvidenceV2 {
  const input = record(value, "RoleRunEvidenceV2");
  const rebuilt = createRoleRunEvidenceV2({
    runId: requiredString(input["runId"], "runId"),
    taskId: requiredString(input["taskId"], "taskId"),
    specRevision: positiveInteger(input["specRevision"], "specRevision"),
    role: role(input["role"]),
    phase: phase(input["phase"]),
    attemptId: requiredString(input["attemptId"], "attemptId"),
    generation: nonNegativeInteger(input["generation"], "generation"),
    runnerKind: runnerKind(input["runnerKind"]),
    ...(input["sessionId"] === undefined ? {} : { sessionId: requiredString(input["sessionId"], "sessionId") }),
    outcome: enumeration(input["outcome"], ["SUCCEEDED", "FAILED", "INVALID_OUTPUT"] as const, "outcome"),
    startedAt: instant(input["startedAt"], "startedAt"),
    finishedAt: instant(input["finishedAt"], "finishedAt"),
    eventsRef: requiredString(input["eventsRef"], "eventsRef"),
    eventsDigest: shaDigest(input["eventsDigest"], "eventsDigest"),
    stderrRef: requiredString(input["stderrRef"], "stderrRef"),
    stderrDigest: shaDigest(input["stderrDigest"], "stderrDigest"),
    outputRef: requiredString(input["outputRef"], "outputRef"),
    outputDigest: shaDigest(input["outputDigest"], "outputDigest"),
    manifestRef: requiredString(input["manifestRef"], "manifestRef"),
    manifestDigest: shaDigest(input["manifestDigest"], "manifestDigest"),
    artifactRefs: refs(input["artifactRefs"] as readonly string[], "artifactRefs"),
    findingRefs: refs(input["findingRefs"] as readonly string[], "findingRefs"),
  });
  if (input["schemaVersion"] !== 1 || rebuilt.evidenceDigest !== expectedDigest || canonicalJson(input) !== canonicalJson(rebuilt)) {
    throw conflict("ROLE_EVIDENCE_INTEGRITY_FAILED", "Role Run Evidence differs from its digest");
  }
  return rebuilt;
}

export function parseRoleAttemptV2(value: unknown, expectedDigest: string): RoleAttemptV2 {
  const input = record(value, "RoleAttemptV2");
  const { attemptDigest: _ignored, ...core } = input;
  if (input["schemaVersion"] !== 1 || digest("role-attempt-v2", core) !== expectedDigest || input["attemptDigest"] !== expectedDigest) {
    throw conflict("ROLE_ATTEMPT_INTEGRITY_FAILED", "Role Attempt differs from its digest");
  }
  validateAttemptCore(input);
  return deepFreeze(JSON.parse(JSON.stringify(input)) as unknown as RoleAttemptV2);
}

export function rolePermission(roleInput: AgentRoleV2): RolePermission {
  const value = role(roleInput);
  return value === "IMPLEMENTATION" || value === "DOCUMENTATION" ? "WORKSPACE_WRITE" : "READ_ONLY";
}

export function roleReconcileTokenV2(
  attemptInput: Pick<RoleAttemptV2, "taskId" | "specRevision" | "attemptId" | "generation">,
  runIdInput: string,
  operationIdInput: string,
): string {
  return digest("role-reconcile-token-v2", {
    taskId: attemptInput.taskId,
    specRevision: attemptInput.specRevision,
    attemptId: attemptInput.attemptId,
    generation: attemptInput.generation,
    runId: requiredString(runIdInput, "runId"),
    operationId: requiredString(operationIdInput, "operationId"),
  });
}

function normalizeCreate(input: CreateRoleAttemptV2Input) {
  assertTaskId(input.taskId);
  const normalizedRole = role(input.role);
  const normalizedPhase = phase(input.phase);
  if (!rolePhases[normalizedRole].includes(normalizedPhase)) throw validation("ROLE_PHASE_INVALID", `${normalizedRole} cannot execute ${normalizedPhase}`);
  return {
    taskId: input.taskId,
    specRevision: positiveInteger(input.specRevision, "specRevision"),
    role: normalizedRole,
    phase: normalizedPhase,
    generation: nonNegativeInteger(input.generation, "generation"),
    runnerKind: runnerKind(input.runnerKind),
    permission: rolePermission(normalizedRole),
    inputDigest: shaDigest(input.inputDigest, "inputDigest"),
    subjectCommit: commitId(input.subjectCommit, "subjectCommit"),
    inputArtifactRefs: refs(input.inputArtifactRefs, "inputArtifactRefs"),
    scheduledAt: instant(input.scheduledAt, "scheduledAt"),
  };
}

function validateAttemptCore(input: Record<string, unknown>): void {
  const normalized = normalizeCreate({
    taskId: requiredString(input["taskId"], "taskId"),
    specRevision: positiveInteger(input["specRevision"], "specRevision"),
    role: role(input["role"]),
    phase: phase(input["phase"]),
    generation: nonNegativeInteger(input["generation"], "generation"),
    runnerKind: runnerKind(input["runnerKind"]),
    inputDigest: shaDigest(input["inputDigest"], "inputDigest"),
    subjectCommit: commitId(input["subjectCommit"], "subjectCommit"),
    inputArtifactRefs: refs(input["inputArtifactRefs"] as readonly string[], "inputArtifactRefs"),
    scheduledAt: instant(input["scheduledAt"], "scheduledAt"),
  });
  const expectedAttemptId = `${normalized.taskId}/${normalized.phase}/r${normalized.specRevision}/g${normalized.generation}`;
  if (input["attemptId"] !== expectedAttemptId || input["permission"] !== normalized.permission ||
      !(["SCHEDULED", "RUNNING", "WAITING_RECONCILE", "SUCCEEDED", "FAILED", "CANCELLED"] as const).includes(input["state"] as RoleAttemptState)) {
    throw validation("ROLE_ATTEMPT_SHAPE_INVALID", "Role Attempt identity, permission or state is invalid");
  }
  const events = input["events"];
  if (!Array.isArray(events) || events.length === 0 || events.some((event, index) =>
    typeof event !== "object" || event === null || (event as Record<string, unknown>)["sequence"] !== index + 1)) {
    throw validation("ROLE_ATTEMPT_EVENTS_INVALID", "Role Attempt events must be continuous");
  }
}

function assertEvidenceBinding(attempt: RoleAttemptV2, evidence: RoleRunEvidenceV2): void {
  if (evidence.taskId !== attempt.taskId || evidence.specRevision !== attempt.specRevision ||
      evidence.role !== attempt.role || evidence.phase !== attempt.phase || evidence.attemptId !== attempt.attemptId ||
      evidence.generation !== attempt.generation || evidence.runnerKind !== attempt.runnerKind ||
      (attempt.unknown !== undefined && evidence.runId !== attempt.unknown.runId)) {
    throw conflict("ROLE_EVIDENCE_BINDING_MISMATCH", "Run Evidence does not bind the current Role Attempt");
  }
}

function sealAttempt(core: Omit<RoleAttemptV2, "attemptDigest">): RoleAttemptV2 {
  return deepFreeze({ ...core, attemptDigest: digest("role-attempt-v2", core) });
}

function withoutDigest(attempt: RoleAttemptV2): Omit<RoleAttemptV2, "attemptDigest"> {
  const { attemptDigest: _ignored, ...core } = attempt;
  return core;
}

function appendEvent(events: readonly RoleAttemptEventV2[], type: string, at: string, detail?: string): RoleAttemptEventV2[] {
  return [...events, { sequence: events.length + 1, type, at, ...(detail === undefined ? {} : { detail }) }];
}

function role(value: unknown): AgentRoleV2 { return enumeration(value, AGENT_ROLES_V2, "role"); }
function phase(value: unknown): RolePhaseV2 { return enumeration(value, ROLE_PHASES_V2, "phase"); }
function runnerKind(value: unknown): RealRoleRunnerKind { return enumeration(value, ["CODEX_EXEC", "CLAUDE_PRINT"] as const, "runnerKind"); }

function refs(values: readonly string[], field: string): string[] {
  if (!Array.isArray(values)) throw validation("ROLE_REFS_INVALID", `${field} must be an array`);
  const result = values.map((value) => requiredString(value, field)).sort();
  if (new Set(result).size !== result.length) throw validation("ROLE_REFS_DUPLICATE", `${field} must be unique`);
  return result;
}

function enumeration<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) throw validation("ROLE_ENUM_INVALID", `${field} must be one of ${values.join(", ")}`);
  return value as T[number];
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw validation("ROLE_STRING_INVALID", `${field} is required`);
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw validation("ROLE_INTEGER_INVALID", `${field} must be positive`);
  return value as number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw validation("ROLE_INTEGER_INVALID", `${field} must be non-negative`);
  return value as number;
}

function instant(value: unknown, field: string): string {
  const result = requiredString(value, field);
  if (Number.isNaN(Date.parse(result))) throw validation("ROLE_TIME_INVALID", `${field} must be an ISO instant`);
  return result;
}

function commitId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)) throw validation("ROLE_COMMIT_INVALID", `${field} must be a full Git commit id`);
  return value;
}

function shaDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) throw validation("ROLE_DIGEST_INVALID", `${field} must be a SHA-256 digest`);
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw validation("ROLE_OBJECT_INVALID", `${field} must be an object`);
  return value as Record<string, unknown>;
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(`${namespace}\0${canonicalJson(value)}`).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function validation(code: string, message: string): MoyeError { return new MoyeError({ code, category: "VALIDATION", message }); }
function conflict(code: string, message: string): MoyeError { return new MoyeError({ code, category: "CONFLICT", message }); }
