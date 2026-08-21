import { createHash } from "node:crypto";

import type { TaskEnvelope } from "./coding-task.js";
import { parseTaskEnvelope } from "./coding-task.js";
import type { CoreProjection } from "./core-control.js";
import { parseCoreProjection } from "./core-control.js";
import { MoyeError } from "./errors.js";

export type CoreOutcome = "SUCCEEDED" | "FAILED_TERMINAL" | "CANCELLED";

export interface CoreTraceIndexInput {
  readonly decisionRefs: readonly string[];
  readonly attemptRefs: readonly string[];
  readonly sessionRefs: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly findingRefs: readonly string[];
  readonly verificationRefs: readonly string[];
  readonly docsImpactRefs: readonly string[];
  readonly observerRefs: readonly string[];
  readonly invocationRefs: readonly string[];
}

export interface CoreTraceIndex extends CoreTraceIndexInput {
  readonly traceDigest: string;
}

export interface CoreClosureResult {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly envelopeDigest: string;
  readonly sourceProjectionDigest: string;
  readonly outcome: CoreOutcome;
  readonly candidateCommit: string | null;
  readonly reviewGateDigest: string | null;
  readonly verificationDigest: string | null;
  readonly docsImpactGateDigest: string | null;
  readonly failure: {
    readonly classification: "BUDGET_EXHAUSTED";
    readonly terminalCandidateDigest: string;
    readonly lastAttemptId: string | null;
    readonly findingRefs: readonly string[];
    readonly artifactRefs: readonly string[];
  } | null;
  readonly cancellation: {
    readonly candidateDigest: string;
    readonly reason: string;
    readonly lastAttemptId: string | null;
    readonly artifactRefs: readonly string[];
    readonly evidenceRefs: readonly string[];
  } | null;
  readonly trace: CoreTraceIndex;
  readonly closureDigest: string;
}

export interface ClosedCoreProjection {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly state: "CLOSED";
  readonly stage: "CLOSED";
  readonly outcome: CoreOutcome;
  readonly sourceProjectionDigest: string;
  readonly closureResult: CoreClosureResult;
  readonly closedProjectionDigest: string;
}

const trustedClosures = new WeakSet<object>();

export function createCoreClosureResult(input: {
  readonly envelope: TaskEnvelope;
  readonly projection: CoreProjection;
  readonly trace: CoreTraceIndexInput;
}): CoreClosureResult {
  const envelope = parseTaskEnvelope(
    JSON.parse(JSON.stringify(input.envelope)) as unknown,
    input.envelope.envelopeDigest,
  );
  const projection = parseCoreProjection(
    JSON.parse(JSON.stringify(input.projection)) as unknown,
    envelope,
    input.projection.projectionDigest,
  );
  if (projection.pendingRole !== null || projection.pendingReconcile !== null) {
    throw conflict("CORE_CLOSURE_ACTIVE_WORK", "Core Closure requires zero Active Attempts and no unresolved Unknown Effect");
  }
  const trace = createTraceIndex(projection, input.trace);
  const passedDocsGate = [...projection.docsImpactGates].reverse().find((item) => item.verdict === "PASSED") ?? null;
  let outcome: CoreOutcome;
  let candidateCommit: string | null = null;
  let reviewGateDigest: string | null = null;
  let verificationDigest: string | null = null;
  let docsImpactGateDigest: string | null = null;
  let failure: CoreClosureResult["failure"] = null;
  let cancellation: CoreClosureResult["cancellation"] = null;

  if (projection.state === "RUNNING" && projection.stage === "CLOSURE_REQUIRED") {
    if (projection.reviewGate?.verdict !== "PASSED" || projection.verification === null || passedDocsGate === null ||
        projection.terminalCandidate !== null || projection.cancellationCandidate !== null) {
      throw conflict("CORE_SUCCESS_GATE_INCOMPLETE", "Successful Core Closure requires Review, Verification and Docs Impact to pass");
    }
    outcome = "SUCCEEDED";
    candidateCommit = projection.reviewGate.candidateCommit;
    reviewGateDigest = projection.reviewGate.gateDigest;
    verificationDigest = projection.verification.verificationDigest;
    docsImpactGateDigest = passedDocsGate.gateDigest;
  } else if (projection.state === "CLOSING" && projection.stage === "CLOSURE_REQUIRED" &&
      projection.terminalCandidate !== null && projection.cancellationCandidate === null) {
    outcome = "FAILED_TERMINAL";
    const lastAttempt = latestAttemptId(projection);
    failure = {
      classification: "BUDGET_EXHAUSTED",
      terminalCandidateDigest: projection.terminalCandidate.candidateDigest,
      lastAttemptId: lastAttempt,
      findingRefs: projection.reviewGate?.unresolvedBlockingFindingRefs ?? [],
      artifactRefs: trace.artifactRefs,
    };
  } else if (projection.state === "CLOSING" && projection.stage === "CLOSURE_REQUIRED" &&
      projection.cancellationCandidate !== null && projection.terminalCandidate === null) {
    outcome = "CANCELLED";
    cancellation = {
      candidateDigest: projection.cancellationCandidate.candidateDigest,
      reason: projection.cancellationCandidate.reason,
      lastAttemptId: projection.cancellationCandidate.lastAttemptId,
      artifactRefs: projection.cancellationCandidate.artifactRefs,
      evidenceRefs: projection.cancellationCandidate.evidenceRefs,
    };
  } else {
    throw conflict("CORE_CLOSURE_NOT_READY", `Core Projection ${projection.state}/${projection.stage} is not ready to close`);
  }
  const core = {
    schemaVersion: 1 as const,
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    envelopeDigest: projection.envelopeDigest,
    sourceProjectionDigest: projection.projectionDigest,
    outcome,
    candidateCommit,
    reviewGateDigest,
    verificationDigest,
    docsImpactGateDigest,
    failure,
    cancellation,
    trace,
  };
  const result: CoreClosureResult = { ...core, closureDigest: digest("core-closure-result", core) };
  trustedClosures.add(result);
  return deepFreeze(result);
}

export function parseCoreClosureResult(
  value: unknown,
  envelope: TaskEnvelope,
  projection: CoreProjection,
  expectedDigest: string,
): CoreClosureResult {
  const input = record(value, "CoreClosureResult");
  const parsed = createCoreClosureResult({
    envelope,
    projection,
    trace: input["trace"] as CoreTraceIndexInput,
  });
  if (input["schemaVersion"] !== 1 || canonicalJson(input) !== canonicalJson(parsed) ||
      parsed.closureDigest !== expectedDigest) {
    throw conflict("CORE_CLOSURE_INTEGRITY_FAILED", "Core Closure Result differs from its source Projection or digest");
  }
  return parsed;
}

export function closeCoreProjection(result: CoreClosureResult): ClosedCoreProjection {
  assertTrustedClosure(result);
  const core = {
    schemaVersion: 1 as const,
    taskId: result.taskId,
    specRevision: result.specRevision,
    state: "CLOSED" as const,
    stage: "CLOSED" as const,
    outcome: result.outcome,
    sourceProjectionDigest: result.sourceProjectionDigest,
    closureResult: result,
  };
  return deepFreeze({ ...core, closedProjectionDigest: digest("closed-core-projection", core) });
}

function createTraceIndex(projection: CoreProjection, input: CoreTraceIndexInput): CoreTraceIndex {
  const core = {
    decisionRefs: refs(input.decisionRefs, "decisionRefs"),
    attemptRefs: refs(input.attemptRefs, "attemptRefs"),
    sessionRefs: refs(input.sessionRefs, "sessionRefs"),
    artifactRefs: refs(input.artifactRefs, "artifactRefs"),
    findingRefs: refs(input.findingRefs, "findingRefs"),
    verificationRefs: refs(input.verificationRefs, "verificationRefs"),
    docsImpactRefs: refs(input.docsImpactRefs, "docsImpactRefs"),
    observerRefs: refs(input.observerRefs, "observerRefs"),
    invocationRefs: refs(input.invocationRefs, "invocationRefs"),
  };
  const expectedDecisions = projection.appliedDecisions.map((item) => `control-decision://${item.decisionDigest}`).sort();
  const expectedAttempts = [
    ...projection.completedRoleDispatches.map((item) => `role-attempt://${item.attemptId}`),
    ...projection.roleAttemptFailures.map((item) => `role-attempt://${item.attemptId}`),
    ...(projection.cancellationCandidate?.lastAttemptId === null || projection.cancellationCandidate === null
      ? []
      : [`role-attempt://${projection.cancellationCandidate.lastAttemptId}`]),
  ].sort();
  const expectedFindings = [...new Set([
    ...projection.reviewGateHistory.flatMap((item) => item.unresolvedBlockingFindingRefs),
    ...(projection.reviewGate?.unresolvedBlockingFindingRefs ?? []),
  ])].sort();
  assertCoverage(core.decisionRefs, expectedDecisions, "Decision");
  assertCoverage(core.attemptRefs, expectedAttempts, "Attempt");
  assertCoverage(core.findingRefs, expectedFindings, "Finding");
  if (core.sessionRefs.length < expectedAttempts.length) {
    throw conflict("CORE_TRACE_COVERAGE_INCOMPLETE", "Session trace refs must cover every Attempt");
  }
  if (projection.verification !== null) {
    assertCoverage(core.verificationRefs, [`core-verification://${projection.verification.verificationDigest}`], "Verification");
  }
  const passedDocs = [...projection.docsImpactGates].reverse().find((item) => item.verdict === "PASSED");
  if (passedDocs !== undefined) {
    assertCoverage(core.docsImpactRefs, [`docs-impact-gate://${passedDocs.gateDigest}`], "Docs Impact");
  }
  if (core.artifactRefs.length === 0) throw conflict("CORE_TRACE_ARTIFACT_REQUIRED", "Core Trace requires retained Artifact evidence");
  if (core.invocationRefs.length === 0) throw validation("CORE_TRACE_INVOCATION_REQUIRED", "Core Trace requires a Workflow Invocation ref");
  return deepFreeze({ ...core, traceDigest: digest("core-trace-index", core) });
}

function latestAttemptId(projection: CoreProjection): string | null {
  const values = [
    ...projection.completedRoleDispatches.map((item) => ({ id: item.attemptId, version: item.completedAtProjectionVersion })),
    ...projection.roleAttemptFailures.map((item) => ({ id: item.attemptId, version: item.recordedAtProjectionVersion })),
  ].sort((left, right) => right.version - left.version);
  return values[0]?.id ?? null;
}

function assertCoverage(actual: readonly string[], expected: readonly string[], label: string): void {
  const missing = expected.filter((item) => !actual.includes(item));
  if (missing.length > 0) throw conflict("CORE_TRACE_COVERAGE_INCOMPLETE", `${label} trace refs missing: ${missing.join(", ")}`);
}

function assertTrustedClosure(result: CoreClosureResult): void {
  if (!trustedClosures.has(result) || !Object.isFrozen(result)) {
    throw validation("UNTRUSTED_CORE_CLOSURE", "Core Closure Result must come from its domain protocol");
  }
  const { closureDigest, ...core } = result;
  if (closureDigest !== digest("core-closure-result", core)) {
    throw conflict("CORE_CLOSURE_INTEGRITY_FAILED", "Core Closure Result digest is stale");
  }
}

function refs(values: readonly string[], field: string): string[] {
  if (!Array.isArray(values)) throw validation("INVALID_CORE_TRACE_REFS", `${field} must be an array`);
  const normalized = values.map((item) => requiredString(item, field)).sort();
  if (new Set(normalized).size !== normalized.length) throw validation("DUPLICATE_CORE_TRACE_REF", `${field} must be unique`);
  return normalized;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw validation("INVALID_CORE_CLOSURE_STRING", `${field} must be a non-empty string without NUL bytes`);
  }
  return value.trim();
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validation("INVALID_CORE_CLOSURE_OBJECT", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(namespace).update("\0").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]));
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
