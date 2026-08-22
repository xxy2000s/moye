import { createHash } from "node:crypto";

import { MoyeError } from "./errors.js";
import {
  createLifecycleArtifact,
  lifecycleArtifactRef,
  lifecycleReviewSubjectDigest,
} from "./lifecycle-artifact.js";
import type {
  DesignPayload,
  LifecycleArtifact,
  LifecycleArtifactRef,
  PlanPayload,
  SpecPayload,
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
  | "DOCUMENTATION_REQUIRED";

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
  const attempt = successfulAttempt(attemptInput, projection, "IMPLEMENTATION", "IMPLEMENTATION");
  if (attempt.generation !== projection.implementationGeneration) {
    throw conflict("CORE_V2_IMPLEMENTATION_GENERATION_INVALID", "Implementation Attempt does not match the authorized Generation");
  }
  const checkpointCore = {
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    baseCommit: projection.subjectCommit,
    candidateCommit: commit(input.candidateCommit, "candidateCommit"),
    treeDigest: gitObject(input.treeDigest, "treeDigest"),
    checkpointRef: required(input.checkpointRef, "checkpointRef"),
    testEvidenceRefs: stableRefs(input.testEvidenceRefs, "testEvidenceRefs"),
    selfReview: {
      verdict: choice(input.selfReview.verdict, ["PASSED", "FINDINGS"] as const, "selfReview.verdict"),
      findingRefs: stableRefs(input.selfReview.findingRefs, "selfReview.findingRefs"),
    },
  };
  if (checkpointCore.candidateCommit === projection.subjectCommit) {
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
    events: append(projection.events, "ImplementationRepairAuthorized", instant(input.at), `g${projection.implementationGeneration + 1}:${reason}`),
  });
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
    invalidatedRevisions: [...projection.invalidatedRevisions, invalidated],
    events: append(projection.events, "SpecRevisionReplanned", instant(input.at), `r${projection.specRevision + 1}:${reason}`),
  });
}

function successfulAttempt(
  input: RoleAttemptV2,
  projection: CoreV2LifecycleProjection,
  role: "ARCHITECT" | "IMPLEMENTATION" | "REVIEW",
  phase: "ARCHITECT" | "IMPLEMENTATION" | "DESIGN_REVIEW",
): RoleAttemptV2 {
  const attempt = parseRoleAttemptV2(JSON.parse(JSON.stringify(input)), input.attemptDigest);
  if (attempt.state !== "SUCCEEDED" || attempt.run?.outcome !== "SUCCEEDED" || attempt.run.sessionId === undefined ||
      attempt.taskId !== projection.taskId || attempt.specRevision !== projection.specRevision ||
      attempt.subjectCommit !== projection.subjectCommit || attempt.role !== role || attempt.phase !== phase) {
    throw conflict("CORE_V2_ROLE_RESULT_BINDING_INVALID", `${role}/${phase} Attempt does not bind the current Task Revision`);
  }
  return attempt;
}

function producerFrom(attempt: RoleAttemptV2) {
  return { role: attempt.role as "ARCHITECT" | "REVIEW", phase: attempt.phase, attemptId: attempt.attemptId, generation: attempt.generation, sessionId: attempt.run!.sessionId! };
}

function requiredArtifact(projection: CoreV2LifecycleProjection, kind: "SPEC" | "DESIGN" | "PLAN"): LifecycleArtifact {
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
function choice<const T extends readonly string[]>(value: string, values: T, field: string): T[number] { if (!values.includes(value)) throw validation("CORE_V2_ENUM_INVALID", `${field} is invalid`); return value as T[number]; }
function digest(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
function deepFreeze<T>(value: T): T { if (typeof value === "object" && value !== null && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); } return value; }
function validation(code: string, message: string): MoyeError { return new MoyeError({ code, category: "VALIDATION", message }); }
function conflict(code: string, message: string): MoyeError { return new MoyeError({ code, category: "CONFLICT", message }); }
