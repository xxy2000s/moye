import { createHash } from "node:crypto";

import { MoyeError } from "./errors.js";
import { assertTaskId } from "./task.js";

const trustedEnvelopes = new WeakSet<object>();
const trustedSteps = new WeakSet<object>();
const trustedAttempts = new WeakSet<object>();
const trustedEvidenceRecords = new WeakSet<object>();
const trustedEvidenceBindings = new WeakSet<object>();

export const CODING_PIPELINE_STEP_IDS = Object.freeze([
  "CONTEXT",
  "WORKSPACE",
  "IMPLEMENT",
  "VERIFY",
  "MERGE",
  "DOCS",
] as const);

export type CodingPipelineStepId = (typeof CODING_PIPELINE_STEP_IDS)[number];
export type AttemptStatus = "SCHEDULED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface RequirementInput {
  readonly requirementId: string;
  readonly title: string;
  readonly acceptanceCriteria: readonly string[];
}

export interface ValidationCommandInput {
  readonly commandId: string;
  readonly argv: readonly string[];
}

export interface ContextPlanInput {
  readonly graphRevision: number;
  readonly intents: readonly string[];
  readonly requiredRead: readonly string[];
  readonly requiredReview: readonly string[];
}

export interface TaskEnvelopeInput {
  readonly taskId: string;
  readonly specRevision: number;
  readonly baseSha: string;
  readonly requirements: readonly RequirementInput[];
  readonly validationCommands: readonly ValidationCommandInput[];
  readonly contextPlan: ContextPlanInput;
}

export interface RequirementSpec {
  readonly requirementId: string;
  readonly title: string;
  readonly acceptanceCriteria: readonly string[];
}

export interface ValidationCommandSpec {
  readonly commandId: string;
  readonly argv: readonly [string, ...string[]];
  readonly execution: { readonly shell: false };
}

export interface ContextPlan {
  readonly graphRevision: number;
  readonly intents: readonly string[];
  readonly requiredRead: readonly string[];
  readonly requiredReview: readonly string[];
}

export interface CodingStep {
  readonly taskId: string;
  readonly stepId: CodingPipelineStepId;
  readonly sequence: number;
  readonly dependencies: readonly CodingPipelineStepId[];
  readonly specRevision: number;
  readonly envelopeDigest: string;
}

export interface TaskEnvelope {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly baseSha: string;
  readonly requirements: readonly RequirementSpec[];
  readonly validationCommands: readonly ValidationCommandSpec[];
  readonly contextPlan: ContextPlan;
  readonly pipeline: readonly CodingStep[];
  readonly envelopeDigest: string;
}

export interface StepAttempt {
  readonly attemptId: string;
  readonly taskId: string;
  readonly stepId: CodingPipelineStepId;
  readonly generation: number;
  readonly specRevision: number;
  readonly envelopeDigest: string;
  readonly status: AttemptStatus;
  readonly scheduledAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly evidenceRecords: readonly AttemptEvidenceRecord[];
  readonly error?: string;
  readonly attemptDigest: string;
}

export interface AttemptEvidenceRecord {
  readonly artifactName: string;
  readonly artifactRef: string;
  readonly contentDigest: string;
  readonly producer: {
    readonly taskId: string;
    readonly specRevision: number;
    readonly envelopeDigest: string;
    readonly stepId: CodingPipelineStepId;
    readonly attemptId: string;
    readonly generation: number;
  };
  readonly evidenceDigest: string;
}

export interface EvidenceBinding {
  readonly taskId: string;
  readonly specRevision: number;
  readonly envelopeDigest: string;
  readonly stepId: CodingPipelineStepId;
  readonly attemptId: string;
  readonly generation: number;
  readonly evidenceRecords: readonly AttemptEvidenceRecord[];
  readonly bindingDigest: string;
}

const TERMINAL_ATTEMPT_STATUSES: readonly AttemptStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED"];

export function createTaskEnvelope(input: TaskEnvelopeInput): TaskEnvelope {
  assertTaskId(input.taskId);
  assertPositiveInteger(input.specRevision, "specRevision");
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(input.baseSha)) {
    throw validation("INVALID_BASE_SHA", "baseSha must be a full 40 or 64 character Git object id");
  }

  if (!Array.isArray(input.requirements)) {
    throw validation("INVALID_REQUIREMENTS", "requirements must be an array");
  }
  const requirements = input.requirements.map(normalizeRequirement);
  if (requirements.length === 0) throw validation("REQUIREMENTS_REQUIRED", "at least one Requirement is required");
  assertUnique(requirements.map((item) => item.requirementId), "Requirement ID");

  if (!Array.isArray(input.validationCommands)) {
    throw validation("INVALID_VALIDATION_COMMANDS", "validationCommands must be an array");
  }
  const validationCommands = input.validationCommands.map(normalizeValidationCommand);
  if (validationCommands.length === 0) {
    throw validation("VALIDATION_COMMANDS_REQUIRED", "at least one validation command is required");
  }
  assertUnique(validationCommands.map((item) => item.commandId), "validation command ID");

  const contextPlan = normalizeContextPlan(input.contextPlan);
  const digestInput = {
    schemaVersion: 1 as const,
    taskId: input.taskId,
    specRevision: input.specRevision,
    baseSha: input.baseSha,
    requirements,
    validationCommands,
    contextPlan,
    pipeline: CODING_PIPELINE_STEP_IDS.map((stepId, index) => ({
      stepId,
      sequence: index + 1,
      dependencies: index === 0 ? [] : [CODING_PIPELINE_STEP_IDS[index - 1]!],
    })),
  };
  const envelopeDigest = `sha256:${createHash("sha256").update(JSON.stringify(digestInput)).digest("hex")}`;
  const pipeline: CodingStep[] = digestInput.pipeline.map((step) => ({
    taskId: input.taskId,
    stepId: step.stepId,
    sequence: step.sequence,
    dependencies: [...step.dependencies],
    specRevision: input.specRevision,
    envelopeDigest,
  }));
  for (const step of pipeline) trustedSteps.add(step);

  const envelope: TaskEnvelope = {
    schemaVersion: 1 as const,
    taskId: input.taskId,
    specRevision: input.specRevision,
    baseSha: input.baseSha,
    requirements,
    validationCommands,
    contextPlan,
    pipeline,
    envelopeDigest,
  };
  trustedEnvelopes.add(envelope);
  return deepFreeze(envelope);
}

export function parseTaskEnvelope(value: unknown, expectedDigest: string): TaskEnvelope {
  if (!isRecord(value) || value["schemaVersion"] !== 1) {
    throw validation("INVALID_TASK_ENVELOPE", "serialized TaskEnvelope must be a schemaVersion 1 object");
  }
  const parsed = createTaskEnvelope({
    taskId: value["taskId"] as string,
    specRevision: value["specRevision"] as number,
    baseSha: value["baseSha"] as string,
    requirements: value["requirements"] as readonly RequirementInput[],
    validationCommands: value["validationCommands"] as readonly ValidationCommandInput[],
    contextPlan: value["contextPlan"] as unknown as ContextPlanInput,
  });
  if (value["envelopeDigest"] !== parsed.envelopeDigest || expectedDigest !== parsed.envelopeDigest ||
      !pipelineSemanticallyEquals(value["pipeline"], parsed.pipeline)) {
    throw conflict("TASK_ENVELOPE_INTEGRITY_FAILED", "serialized TaskEnvelope content does not match its digest or fixed Pipeline");
  }
  return parsed;
}

export function createInitialAttempt(
  step: CodingStep,
  scheduledAt: string,
): StepAttempt {
  return newAttempt(step, 1, scheduledAt);
}

function newAttempt(
  step: CodingStep,
  generation: number,
  scheduledAt: string,
): StepAttempt {
  assertCodingStep(step);
  assertPositiveInteger(generation, "generation");
  assertIsoTime(scheduledAt, "scheduledAt");
  return finalizeAttempt({
    attemptId: `${step.taskId}/${step.stepId}/attempt-${String(generation).padStart(3, "0")}`,
    taskId: step.taskId,
    stepId: step.stepId,
    generation,
    specRevision: step.specRevision,
    envelopeDigest: step.envelopeDigest,
    status: "SCHEDULED" as const,
    scheduledAt,
    evidenceRecords: [],
  });
}

export function createRetryAttempt(
  step: CodingStep,
  previousAttempts: readonly StepAttempt[],
  scheduledAt: string,
): StepAttempt {
  assertCodingStep(step);
  if (previousAttempts.length === 0) {
    throw validation("ATTEMPT_HISTORY_REQUIRED", "retry requires the complete non-empty Attempt history");
  }
  for (const [index, attempt] of previousAttempts.entries()) {
    assertTrustedAttempt(attempt);
    assertAttemptBelongsToStep(attempt, step);
    if (attempt.generation !== index + 1) {
      throw conflict("ATTEMPT_HISTORY_INCOMPLETE", "Attempt history generations must be continuous and ordered from 1");
    }
    if (!TERMINAL_ATTEMPT_STATUSES.includes(attempt.status)) {
      throw conflict("ATTEMPT_STILL_ACTIVE", `Attempt ${attempt.attemptId} is not terminal`);
    }
    if (index > 0) {
      const previous = previousAttempts[index - 1]!;
      if (previous.finishedAt === undefined) {
        throw conflict("ATTEMPT_HISTORY_INCOMPLETE", "terminal Attempt history is missing finishedAt");
      }
      assertTimeOrder(previous.finishedAt, attempt.scheduledAt, "Attempt history scheduledAt");
    }
  }
  assertUnique(previousAttempts.map((attempt) => attempt.attemptId), "Attempt ID");
  assertUnique(previousAttempts.map((attempt) => String(attempt.generation)), "Attempt generation");
  const generation = previousAttempts.length + 1;
  const previousFinishedAt = previousAttempts.at(-1)!.finishedAt;
  if (previousFinishedAt === undefined) {
    throw conflict("ATTEMPT_HISTORY_INCOMPLETE", "terminal Attempt history is missing finishedAt");
  }
  assertIsoTime(scheduledAt, "scheduledAt");
  assertTimeOrder(previousFinishedAt, scheduledAt, "scheduledAt");
  return newAttempt(step, generation, scheduledAt);
}

export function createReplannedAttempt(
  step: CodingStep,
  previousAttempts: readonly StepAttempt[],
  scheduledAt: string,
): StepAttempt {
  assertCodingStep(step);
  if (previousAttempts.length === 0) {
    throw validation("ATTEMPT_HISTORY_REQUIRED", "replanned Attempt requires prior Attempt history");
  }
  for (const [index, attempt] of previousAttempts.entries()) {
    assertTrustedAttempt(attempt);
    if (attempt.taskId !== step.taskId || attempt.stepId !== step.stepId) {
      throw conflict("ATTEMPT_STEP_MISMATCH", "replanned Attempt history belongs to another Task or Step");
    }
    if (attempt.generation !== index + 1 || !TERMINAL_ATTEMPT_STATUSES.includes(attempt.status)) {
      throw conflict("ATTEMPT_HISTORY_INCOMPLETE", "replanned Attempt history must be continuous and terminal");
    }
  }
  const previous = previousAttempts.at(-1)!;
  if (step.specRevision <= previous.specRevision || step.envelopeDigest === previous.envelopeDigest) {
    throw conflict("SPEC_REVISION_NOT_ADVANCED", "replanned Attempt requires a newer Spec Revision and Envelope");
  }
  if (previous.finishedAt === undefined) throw conflict("ATTEMPT_HISTORY_INCOMPLETE", "terminal Attempt is missing finishedAt");
  assertIsoTime(scheduledAt, "scheduledAt");
  assertTimeOrder(previous.finishedAt, scheduledAt, "scheduledAt");
  return newAttempt(step, previousAttempts.length + 1, scheduledAt);
}

export function startAttempt(attempt: StepAttempt, startedAt: string): StepAttempt {
  assertTrustedAttempt(attempt);
  if (attempt.status !== "SCHEDULED") {
    throw conflict("ATTEMPT_NOT_SCHEDULED", `Attempt ${attempt.attemptId} cannot start from ${attempt.status}`);
  }
  assertIsoTime(startedAt, "startedAt");
  assertTimeOrder(attempt.scheduledAt, startedAt, "startedAt");
  const { attemptDigest: _digest, ...current } = attempt;
  return finalizeAttempt({ ...current, status: "RUNNING" as const, startedAt });
}

export function recordAttemptEvidence(
  attempt: StepAttempt,
  artifactName: string,
  contentDigest: string,
): AttemptEvidenceRecord {
  assertTrustedAttempt(attempt);
  if (attempt.status !== "RUNNING") {
    throw conflict("EVIDENCE_ATTEMPT_NOT_RUNNING", `Attempt ${attempt.attemptId} is not RUNNING`);
  }
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/.test(artifactName)) {
    throw validation("INVALID_ARTIFACT_NAME", `Invalid Artifact name: ${artifactName}`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(contentDigest)) {
    throw validation("INVALID_ARTIFACT_DIGEST", "Artifact contentDigest must be SHA-256");
  }
  const producer = {
    taskId: attempt.taskId,
    specRevision: attempt.specRevision,
    envelopeDigest: attempt.envelopeDigest,
    stepId: attempt.stepId,
    attemptId: attempt.attemptId,
    generation: attempt.generation,
  };
  const core = {
    artifactName,
    artifactRef: `artifact://${attempt.attemptId}/${artifactName}`,
    contentDigest,
    producer,
  };
  const record: AttemptEvidenceRecord = {
    ...core,
    evidenceDigest: digest("evidence", core),
  };
  trustedEvidenceRecords.add(record);
  return deepFreeze(record);
}

export function finishAttempt(
  attempt: StepAttempt,
  outcome: "SUCCEEDED" | "FAILED",
  finishedAt: string,
  options: { readonly evidenceRecords?: readonly AttemptEvidenceRecord[]; readonly error?: string } = {},
): StepAttempt {
  assertTrustedAttempt(attempt);
  if (attempt.status !== "RUNNING") {
    throw conflict("ATTEMPT_NOT_RUNNING", `Attempt ${attempt.attemptId} cannot finish from ${attempt.status}`);
  }
  assertIsoTime(finishedAt, "finishedAt");
  if (attempt.startedAt === undefined) {
    throw conflict("ATTEMPT_START_MISSING", `Attempt ${attempt.attemptId} has no startedAt`);
  }
  assertTimeOrder(attempt.startedAt, finishedAt, "finishedAt");
  const evidenceRecords = [...(options.evidenceRecords ?? [])];
  for (const record of evidenceRecords) assertEvidenceProducedByAttempt(record, attempt);
  assertUnique(evidenceRecords.map((record) => record.artifactName), "Attempt Artifact name");
  if (outcome === "SUCCEEDED" && evidenceRecords.length === 0) {
    throw validation("ATTEMPT_EVIDENCE_REQUIRED", "a succeeded Attempt requires evidenceRecords");
  }
  if (outcome === "SUCCEEDED" && options.error !== undefined) {
    throw validation("ATTEMPT_SUCCESS_ERROR_INVALID", "a succeeded Attempt cannot carry an error");
  }
  if (outcome === "FAILED" && (options.error === undefined || options.error.trim().length === 0)) {
    throw validation("ATTEMPT_ERROR_REQUIRED", "a failed Attempt requires an error");
  }
  const { attemptDigest: _digest, ...current } = attempt;
  return finalizeAttempt({
    ...current,
    status: outcome,
    finishedAt,
    evidenceRecords,
    ...(options.error === undefined ? {} : { error: options.error.trim() }),
  });
}

export function cancelAttempt(attempt: StepAttempt, finishedAt: string): StepAttempt {
  assertTrustedAttempt(attempt);
  if (attempt.status !== "SCHEDULED" && attempt.status !== "RUNNING") {
    throw conflict("ATTEMPT_ALREADY_TERMINAL", `Attempt ${attempt.attemptId} is already ${attempt.status}`);
  }
  assertIsoTime(finishedAt, "finishedAt");
  assertTimeOrder(attempt.startedAt ?? attempt.scheduledAt, finishedAt, "finishedAt");
  const { attemptDigest: _digest, ...current } = attempt;
  return finalizeAttempt({ ...current, status: "CANCELLED" as const, finishedAt });
}

export function parseStepAttempt(
  value: unknown,
  envelope: TaskEnvelope,
  expectedAttemptDigest: string,
): StepAttempt {
  assertTrustedEnvelope(envelope);
  if (!isRecord(value)) throw validation("INVALID_STEP_ATTEMPT", "serialized StepAttempt must be an object");
  const stepId = value["stepId"] as CodingPipelineStepId;
  const step = envelope.pipeline.find((candidate) => candidate.stepId === stepId);
  if (step === undefined) throw validation("INVALID_STEP_ATTEMPT", `Unknown Step ID: ${String(stepId)}`);
  const generation = value["generation"] as number;
  const scheduledAt = value["scheduledAt"] as string;
  let attempt = newAttempt(step, generation, scheduledAt);
  if (value["taskId"] !== attempt.taskId || value["attemptId"] !== attempt.attemptId ||
      value["specRevision"] !== attempt.specRevision || value["envelopeDigest"] !== attempt.envelopeDigest) {
    throw conflict("ATTEMPT_IDENTITY_INVALID", "serialized Attempt identity does not match its Envelope and Generation");
  }
  const status = value["status"];
  const records = value["evidenceRecords"];
  if (!Array.isArray(records)) throw validation("INVALID_EVIDENCE_RECORDS", "Attempt evidenceRecords must be an array");
  if (status === "RUNNING" || status === "SUCCEEDED" || status === "FAILED" ||
      (status === "CANCELLED" && value["startedAt"] !== undefined)) {
    attempt = startAttempt(attempt, value["startedAt"] as string);
  }
  if (status === "SUCCEEDED" || status === "FAILED") {
    const parsedRecords = records.map((record) => parseAttemptEvidence(record, attempt));
    attempt = finishAttempt(attempt, status, value["finishedAt"] as string, {
      evidenceRecords: parsedRecords,
      ...(value["error"] === undefined ? {} : { error: value["error"] as string }),
    });
  } else if (status === "CANCELLED") {
    if (records.length > 0 || value["error"] !== undefined) {
      throw validation("INVALID_CANCELLED_ATTEMPT", "cancelled Attempt cannot contain evidence or error");
    }
    attempt = cancelAttempt(attempt, value["finishedAt"] as string);
  } else if (status === "SCHEDULED" || status === "RUNNING") {
    if (records.length > 0 || value["finishedAt"] !== undefined || value["error"] !== undefined ||
        (status === "SCHEDULED" && value["startedAt"] !== undefined)) {
      throw validation("INVALID_ACTIVE_ATTEMPT", "active Attempt contains terminal fields");
    }
  } else {
    throw validation("INVALID_ATTEMPT_STATUS", `Invalid Attempt status: ${String(status)}`);
  }
  if (value["attemptDigest"] !== attempt.attemptDigest || expectedAttemptDigest !== attempt.attemptDigest) {
    throw conflict("ATTEMPT_INTEGRITY_FAILED", "serialized Attempt content does not match attemptDigest");
  }
  return attempt;
}

function parseAttemptEvidence(
  value: unknown,
  runningAttempt: StepAttempt,
): AttemptEvidenceRecord {
  if (!isRecord(value)) throw validation("INVALID_EVIDENCE_RECORD", "serialized Evidence Record must be an object");
  const parsed = recordAttemptEvidence(
    runningAttempt,
    value["artifactName"] as string,
    value["contentDigest"] as string,
  );
  if (value["artifactRef"] !== parsed.artifactRef ||
      value["evidenceDigest"] !== parsed.evidenceDigest ||
      !producerSemanticallyEquals(value["producer"], parsed.producer)) {
    throw conflict("EVIDENCE_INTEGRITY_FAILED", "serialized Evidence Record does not match its producer or digest");
  }
  return parsed;
}

export function parseEvidenceBinding(
  value: unknown,
  envelope: TaskEnvelope,
  succeededAttempt: StepAttempt,
  expectedBindingDigest: string,
): EvidenceBinding {
  if (!isRecord(value)) throw validation("INVALID_EVIDENCE_BINDING", "serialized Evidence Binding must be an object");
  const parsed = bindEvidence(envelope, succeededAttempt);
  if (value["bindingDigest"] !== parsed.bindingDigest || expectedBindingDigest !== parsed.bindingDigest ||
      value["taskId"] !== parsed.taskId || value["specRevision"] !== parsed.specRevision ||
      value["envelopeDigest"] !== parsed.envelopeDigest || value["stepId"] !== parsed.stepId ||
      value["attemptId"] !== parsed.attemptId || value["generation"] !== parsed.generation ||
      !evidenceListSemanticallyEquals(value["evidenceRecords"], parsed.evidenceRecords)) {
    throw conflict("EVIDENCE_BINDING_INTEGRITY_FAILED", "serialized Evidence Binding does not match its Attempt");
  }
  return parsed;
}

export function bindEvidence(
  envelope: TaskEnvelope,
  attempt: StepAttempt,
): EvidenceBinding {
  assertTrustedEnvelope(envelope);
  assertTrustedAttempt(attempt);
  const step = envelope.pipeline.find((candidate) => candidate.stepId === attempt.stepId);
  if (step === undefined) throw conflict("EVIDENCE_STEP_MISSING", `Envelope has no Step ${attempt.stepId}`);
  assertAttemptBelongsToStep(attempt, step);
  if (attempt.status !== "SUCCEEDED") {
    throw conflict("EVIDENCE_ATTEMPT_NOT_SUCCEEDED", `Attempt ${attempt.attemptId} is not SUCCEEDED`);
  }
  if (attempt.evidenceRecords.length === 0) {
    throw validation("EVIDENCE_RECORDS_REQUIRED", "a succeeded Attempt must contain Evidence Records");
  }
  const core = {
    taskId: envelope.taskId,
    specRevision: envelope.specRevision,
    envelopeDigest: envelope.envelopeDigest,
    stepId: attempt.stepId,
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    evidenceRecords: [...attempt.evidenceRecords],
  };
  const binding: EvidenceBinding = { ...core, bindingDigest: digest("binding", core) };
  trustedEvidenceBindings.add(binding);
  return deepFreeze(binding);
}

export function isEvidenceCurrent(envelope: TaskEnvelope, binding: EvidenceBinding): boolean {
  try {
    assertTrustedEnvelope(envelope);
    assertTrustedEvidence(binding);
  } catch {
    return false;
  }
  return binding.taskId === envelope.taskId &&
    binding.specRevision === envelope.specRevision &&
    binding.envelopeDigest === envelope.envelopeDigest;
}

export function assertEvidenceCurrent(envelope: TaskEnvelope, binding: EvidenceBinding): void {
  assertTrustedEnvelope(envelope);
  assertTrustedEvidence(binding);
  if (!isEvidenceCurrent(envelope, binding)) {
    throw conflict(
      "STALE_TASK_EVIDENCE",
      `Evidence does not match ${envelope.taskId} spec revision ${envelope.specRevision}`,
    );
  }
}

function normalizeRequirement(input: RequirementInput): RequirementSpec {
  if (!isRecord(input)) throw validation("INVALID_REQUIREMENT", "Requirement must be an object");
  if (!/^REQ-[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(input.requirementId)) {
    throw validation("INVALID_REQUIREMENT_ID", `Invalid Requirement ID: ${input.requirementId}`);
  }
  const title = requiredString(input.title, "Requirement title");
  const acceptanceCriteria = normalizeStringList(input.acceptanceCriteria, "acceptanceCriteria", false);
  return { requirementId: input.requirementId, title, acceptanceCriteria };
}

function normalizeValidationCommand(input: ValidationCommandInput): ValidationCommandSpec {
  if (!isRecord(input)) throw validation("INVALID_VALIDATION_COMMAND", "validation command must be an object");
  if (!/^CMD-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(input.commandId)) {
    throw validation("INVALID_COMMAND_ID", `Invalid validation command ID: ${input.commandId}`);
  }
  if (!Array.isArray(input.argv) || input.argv.length === 0) {
    throw validation("INVALID_ARGV", "argv must be a non-empty string array");
  }
  const executable = requiredString(input.argv[0], "argv executable");
  if (executable !== input.argv[0]) {
    throw validation("INVALID_EXECUTABLE", "argv executable cannot have leading or trailing whitespace");
  }
  const args = input.argv.slice(1).map((argument) => exactArgument(argument));
  return {
    commandId: input.commandId,
    argv: [executable, ...args],
    execution: { shell: false },
  };
}

function normalizeContextPlan(input: ContextPlanInput): ContextPlan {
  if (!isRecord(input)) throw validation("INVALID_CONTEXT_PLAN", "contextPlan must be an object");
  assertPositiveInteger(input.graphRevision, "contextPlan.graphRevision");
  const intents = normalizeIdList(input.intents, "contextPlan.intents");
  const requiredRead = normalizeIdList(input.requiredRead, "contextPlan.requiredRead");
  const requiredReview = normalizeIdList(input.requiredReview, "contextPlan.requiredReview", true);
  return { graphRevision: input.graphRevision, intents, requiredRead, requiredReview };
}

function normalizeIdList(values: readonly string[], field: string, allowEmpty = false): string[] {
  const normalized = normalizeStringList(values, field, allowEmpty);
  if (normalized.some((value) => !/^[a-z0-9][a-z0-9-]*$/.test(value))) {
    throw validation("INVALID_CONTEXT_ID", `${field} contains an invalid stable ID`);
  }
  assertUnique(normalized, field);
  return normalized;
}

function normalizeStringList(values: readonly string[], field: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw validation("INVALID_STRING_LIST", `${field} must be a${allowEmpty ? "" : " non-empty"} string array`);
  }
  return values.map((value) => requiredString(value, field));
}

function assertAttemptBelongsToStep(attempt: StepAttempt, step: CodingStep): void {
  const expectedAttemptId = `${step.taskId}/${step.stepId}/attempt-${String(attempt.generation).padStart(3, "0")}`;
  if (attempt.taskId !== step.taskId || attempt.stepId !== step.stepId ||
      attempt.specRevision !== step.specRevision || attempt.envelopeDigest !== step.envelopeDigest ||
      attempt.attemptId !== expectedAttemptId) {
    throw conflict("ATTEMPT_STEP_MISMATCH", `Attempt ${attempt.attemptId} does not belong to ${step.stepId}`);
  }
}

function assertCodingStep(step: CodingStep): void {
  if (!isRecord(step)) throw validation("INVALID_CODING_STEP", "CodingStep must be an object");
  if (!trustedSteps.has(step) || !Object.isFrozen(step)) {
    throw validation("UNTRUSTED_CODING_STEP", "CodingStep must come from a validated TaskEnvelope");
  }
  assertTaskId(step.taskId);
  const index = CODING_PIPELINE_STEP_IDS.indexOf(step.stepId);
  const expectedDependencies: readonly CodingPipelineStepId[] = index <= 0
    ? []
    : [CODING_PIPELINE_STEP_IDS[index - 1]!];
  if (index < 0 || step.sequence !== index + 1 ||
      JSON.stringify(step.dependencies) !== JSON.stringify(expectedDependencies)) {
    throw validation("INVALID_CODING_STEP", `CodingStep ${String(step.stepId)} is not part of the fixed Pipeline`);
  }
  assertPositiveInteger(step.specRevision, "step.specRevision");
  if (!/^sha256:[0-9a-f]{64}$/.test(step.envelopeDigest)) {
    throw validation("INVALID_ENVELOPE_DIGEST", "CodingStep requires a valid Envelope Digest");
  }
}

function assertTrustedEnvelope(envelope: TaskEnvelope): void {
  if (!isRecord(envelope) || !trustedEnvelopes.has(envelope) || !Object.isFrozen(envelope)) {
    throw validation("UNTRUSTED_TASK_ENVELOPE", "TaskEnvelope must come from createTaskEnvelope or parseTaskEnvelope");
  }
  const reparsed = parseTaskEnvelope(JSON.parse(JSON.stringify(envelope)) as unknown, envelope.envelopeDigest);
  if (reparsed.envelopeDigest !== envelope.envelopeDigest) {
    throw conflict("TASK_ENVELOPE_INTEGRITY_FAILED", "TaskEnvelope digest is stale");
  }
}

function assertTrustedAttempt(attempt: StepAttempt): void {
  if (!isRecord(attempt) || !trustedAttempts.has(attempt) || !Object.isFrozen(attempt)) {
    throw validation("UNTRUSTED_STEP_ATTEMPT", "StepAttempt must come from the Attempt protocol");
  }
  assertPositiveInteger(attempt.generation, "attempt.generation");
  if (!/^sha256:[0-9a-f]{64}$/.test(attempt.envelopeDigest)) {
    throw validation("INVALID_ENVELOPE_DIGEST", "StepAttempt requires a valid Envelope Digest");
  }
  const { attemptDigest, ...core } = attempt;
  if (attemptDigest !== digest("attempt", core)) {
    throw conflict("ATTEMPT_INTEGRITY_FAILED", `Attempt ${attempt.attemptId} digest is stale`);
  }
}

function assertTrustedEvidence(binding: EvidenceBinding): void {
  if (!isRecord(binding) || !trustedEvidenceBindings.has(binding) || !Object.isFrozen(binding)) {
    throw validation("UNTRUSTED_EVIDENCE_BINDING", "EvidenceBinding must be produced from a succeeded Attempt");
  }
  const { bindingDigest, ...core } = binding;
  if (bindingDigest !== digest("binding", core)) {
    throw conflict("EVIDENCE_BINDING_INTEGRITY_FAILED", "Evidence Binding digest is stale");
  }
  for (const record of binding.evidenceRecords) assertTrustedEvidenceRecord(record);
}

function assertEvidenceProducedByAttempt(record: AttemptEvidenceRecord, attempt: StepAttempt): void {
  assertTrustedEvidenceRecord(record);
  const producer = record.producer;
  if (producer.taskId !== attempt.taskId || producer.specRevision !== attempt.specRevision ||
      producer.envelopeDigest !== attempt.envelopeDigest || producer.stepId !== attempt.stepId ||
      producer.attemptId !== attempt.attemptId || producer.generation !== attempt.generation ||
      record.artifactRef !== `artifact://${attempt.attemptId}/${record.artifactName}`) {
    throw conflict("EVIDENCE_PRODUCER_MISMATCH", "Evidence Record was not produced by this Attempt");
  }
}

function assertTrustedEvidenceRecord(record: AttemptEvidenceRecord): void {
  if (!isRecord(record) || !trustedEvidenceRecords.has(record) || !Object.isFrozen(record)) {
    throw validation("UNTRUSTED_EVIDENCE_RECORD", "Evidence Record must come from the Attempt evidence protocol");
  }
  const { evidenceDigest, ...core } = record;
  if (evidenceDigest !== digest("evidence", core)) {
    throw conflict("EVIDENCE_INTEGRITY_FAILED", "Evidence Record digest is stale");
  }
}

function finalizeAttempt(core: Omit<StepAttempt, "attemptDigest">): StepAttempt {
  const attempt: StepAttempt = { ...core, attemptDigest: digest("attempt", core) };
  trustedAttempts.add(attempt);
  return deepFreeze(attempt);
}

function pipelineSemanticallyEquals(value: unknown, expected: readonly CodingStep[]): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  return value.every((candidate, index) => {
    if (!isRecord(candidate)) return false;
    const step = expected[index]!;
    return candidate["taskId"] === step.taskId && candidate["stepId"] === step.stepId &&
      candidate["sequence"] === step.sequence && candidate["specRevision"] === step.specRevision &&
      candidate["envelopeDigest"] === step.envelopeDigest &&
      Array.isArray(candidate["dependencies"]) &&
      candidate["dependencies"].length === step.dependencies.length &&
      candidate["dependencies"].every((dependency, dependencyIndex) => dependency === step.dependencies[dependencyIndex]);
  });
}

function producerSemanticallyEquals(value: unknown, expected: AttemptEvidenceRecord["producer"]): boolean {
  return isRecord(value) && value["taskId"] === expected.taskId &&
    value["specRevision"] === expected.specRevision && value["envelopeDigest"] === expected.envelopeDigest &&
    value["stepId"] === expected.stepId && value["attemptId"] === expected.attemptId &&
    value["generation"] === expected.generation;
}

function evidenceListSemanticallyEquals(
  value: unknown,
  expected: readonly AttemptEvidenceRecord[],
): boolean {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((record, index) => isRecord(record) && record["evidenceDigest"] === expected[index]!.evidenceDigest);
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(namespace).update("\0").update(JSON.stringify(value)).digest("hex")}`;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw validation("DUPLICATE_STABLE_ID", `${label} values must be unique`);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw validation("INVALID_STRING", `${field} must be a non-empty string without NUL bytes`);
  }
  return value.trim();
}

function exactArgument(value: unknown): string {
  if (typeof value !== "string" || value.includes("\0")) {
    throw validation("INVALID_ARGV_ARGUMENT", "argv arguments must be strings without NUL bytes");
  }
  return value;
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw validation("INVALID_POSITIVE_INTEGER", `${field} must be a positive integer`);
  }
}

function assertIsoTime(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw validation("INVALID_TIMESTAMP", `${field} must be a canonical RFC3339 UTC timestamp`);
  }
}

function assertTimeOrder(earlier: string, later: string, field: string): void {
  if (Date.parse(later) < Date.parse(earlier)) {
    throw validation("INVALID_TIME_ORDER", `${field} cannot be earlier than the preceding Attempt time`);
  }
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
