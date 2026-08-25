import { createHash } from "node:crypto";

import { MoyeError } from "./errors.js";
import type { PreparedRealRoleRunV2, RoleRunManifestV2 } from "../agent/role-runtime-v2.js";
import { parseRoleRunEvidenceV2, renderRoleAgentPromptV2 } from "./role-runtime-v2.js";
import type { AgentRoleV2, RealRoleRunnerKind, RolePermission, RolePhaseV2 } from "./role-runtime-v2.js";
import { assertTaskId } from "./task.js";

export const SESSION_PROVIDERS_V1 = ["CODEX", "CLAUDE"] as const;
export const SESSION_CAPTURE_POLICIES_V1 = ["digest_only", "redacted", "full"] as const;
export const TRANSCRIPT_ERROR_CODES_V1 = [
  "SOURCE_MISSING",
  "SOURCE_AMBIGUOUS",
  "OUTSIDE_ALLOWLIST",
  "ACCESS_DENIED",
  "UNSAFE_FILE_TYPE",
  "TOO_LARGE",
  "SESSION_MISMATCH",
  "SOURCE_CHANGED",
  "MALFORMED",
  "UNSUPPORTED_PROVIDER",
  "UNSUPPORTED_FORMAT",
  "PARSER_FAILED",
  "DIGEST_MISMATCH",
  "ARTIFACT_CONFLICT",
  "CAPTURE_UNKNOWN",
  "INTERNAL",
] as const;

export type SessionProviderV1 = (typeof SESSION_PROVIDERS_V1)[number];
export type SessionCapturePolicyV1 = (typeof SESSION_CAPTURE_POLICIES_V1)[number];
export type TranscriptErrorCodeV1 = (typeof TRANSCRIPT_ERROR_CODES_V1)[number];
export type ContentDispositionV1 = "DIGEST_ONLY" | "REDACTED" | "FULL";
export type PromptSegmentKindV1 =
  | "MOYE_CONTROL"
  | "TASK_INPUT"
  | "ROLE_INSTRUCTIONS"
  | "PERMISSION_BOUNDARY"
  | "OUTPUT_CONTRACT";
export type TimelineCategoryV1 =
  | "PROMPT"
  | "USER"
  | "ASSISTANT"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "SYSTEM"
  | "ERROR"
  | "STDERR"
  | "OTHER";
export type TimelineActorV1 = "USER" | "ASSISTANT" | "TOOL" | "SYSTEM" | "RUNTIME" | "UNKNOWN";
export type TimelineOriginV1 =
  | "MOYE_RENDERED_PROMPT"
  | "PROVIDER_USER"
  | "PROVIDER_ASSISTANT"
  | "PROVIDER_TOOL"
  | "PROVIDER_SYSTEM"
  | "MOYE_RUNTIME"
  | "UNKNOWN";
export type TimelinePartKindV1 =
  | "TEXT"
  | "PROVIDER_EXPOSED_THINKING"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "JSON"
  | "UNKNOWN";
export type TranscriptTerminalStateV1 = "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "FAILED";

export interface RedactionMetadataV1 {
  readonly profile: string;
  readonly version: string;
  readonly rulesDigest: string;
  readonly matchCount: number;
}

export interface CapturedContentV1 {
  readonly originalDigest: string;
  readonly originalByteLength: number;
  readonly disposition: ContentDispositionV1;
  readonly storedDigest?: string;
  readonly storedByteLength?: number;
  readonly storedValue?: string;
  readonly redaction?: RedactionMetadataV1;
  readonly contentDigest: string;
}

export interface ArtifactDescriptorV1 {
  readonly ref: string;
  readonly digest: string;
  readonly byteLength: number;
  readonly mediaType: string;
}

export interface PromptSegmentV1 {
  readonly ordinal: number;
  readonly kind: PromptSegmentKindV1;
  readonly sourceRef?: string;
  readonly sourceDigest?: string;
  readonly content: CapturedContentV1;
}

export interface PromptEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly artifactKind: "PROMPT_ENVELOPE";
  readonly envelopeId: string;
  readonly taskId: string;
  readonly sourceWorkflowRef: string;
  readonly specRevision: number;
  readonly generation: number;
  readonly role: AgentRoleV2;
  readonly phase: RolePhaseV2;
  readonly attemptId: string;
  readonly attemptDigest: string;
  readonly runId: string;
  readonly operationId: string;
  readonly requestDigest: string;
  readonly runnerKind: RealRoleRunnerKind;
  readonly permission: RolePermission;
  readonly subjectCommit: string;
  readonly capturePolicy: SessionCapturePolicyV1;
  readonly renderer: { readonly name: string; readonly version: string; readonly optionsDigest: string };
  readonly renderPlan: { readonly separator: string; readonly separatorDigest: string };
  readonly renderInputsDigest: string;
  readonly segments: readonly PromptSegmentV1[];
  readonly renderedPrompt: CapturedContentV1;
  readonly createdAt: string;
  readonly envelopeDigest: string;
}

export interface SessionEvidenceBindingV1 {
  readonly taskId: string;
  readonly sourceWorkflowRef: string;
  readonly specRevision: number;
  readonly generation: number;
  readonly role: AgentRoleV2;
  readonly phase: RolePhaseV2;
  readonly attemptId: string;
  readonly attemptDigest: string;
  readonly runId: string;
  readonly operationId: string;
  readonly requestDigest: string;
  readonly runnerKind: RealRoleRunnerKind;
  readonly provider: SessionProviderV1;
  readonly providerSessionId: string;
  readonly roleManifestRef: string;
  readonly roleManifestDigest: string;
}

export interface ActiveRoleRunLocatorV1 {
  readonly schemaVersion: 1;
  readonly locatorKind: "ACTIVE_ROLE_RUN";
  readonly binding: Omit<SessionEvidenceBindingV1, "providerSessionId" | "roleManifestRef" | "roleManifestDigest">;
  readonly stage: "PREPARED" | "RUNNING" | "AGENT_COMPLETED" | "CAPTURE_PENDING";
  readonly locatorVersion: number;
  readonly previousLocatorDigest?: string;
  readonly providerSessionId?: string;
  readonly promptEnvelope: ArtifactDescriptorV1;
  readonly expectedExecutionEventsRef: string;
  readonly expectedStderrRef: string;
  readonly preparedAt: string;
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly locatorDigest: string;
}

export interface NormalizedTimelinePartV1 {
  readonly kind: TimelinePartKindV1;
  readonly content: CapturedContentV1;
  readonly toolName?: string;
  readonly toolCallId?: string;
}

export interface NormalizedTimelineEventV1 {
  readonly schemaVersion: 1;
  readonly captureId: string;
  readonly provider: SessionProviderV1;
  readonly providerSessionId: string;
  readonly capturePolicy: SessionCapturePolicyV1;
  readonly sequence: number;
  readonly eventId: string;
  readonly source: {
    readonly recordSequence: number;
    readonly partIndex: number;
    readonly providerType: string;
    readonly providerId?: string;
    readonly recordDigest: string;
  };
  readonly occurredAt?: string;
  readonly timestampState: "PROVIDED" | "MISSING" | "INVALID";
  readonly category: TimelineCategoryV1;
  readonly actor: TimelineActorV1;
  readonly origin: TimelineOriginV1;
  readonly parts: readonly NormalizedTimelinePartV1[];
  readonly correlation?: {
    readonly toolCallId?: string;
    readonly parentEventId?: string;
    readonly parentSessionId?: string;
    readonly childSessionId?: string;
    readonly agentId?: string;
  };
  readonly eventDigest: string;
}

export interface TranscriptCaptureErrorV1 {
  readonly code: TranscriptErrorCodeV1;
  readonly scope: "SOURCE" | "PARSER" | "ARTIFACT" | "RECONCILE" | "INTERNAL";
  readonly detailDigest: string;
}

export interface SessionTranscriptManifestV1 {
  readonly schemaVersion: 1;
  readonly artifactKind: "SESSION_TRANSCRIPT_MANIFEST";
  readonly captureId: string;
  readonly captureOperationId: string;
  readonly binding: SessionEvidenceBindingV1;
  readonly capturePolicy: SessionCapturePolicyV1;
  readonly captureState: "COMPLETE" | "PARTIAL";
  readonly parser: {
    readonly name: string;
    readonly version: string;
    readonly normalizedSchemaVersion: 1;
    readonly optionsDigest: string;
    readonly buildId?: string;
  };
  readonly source: {
    readonly kind: "CODEX_ROLLOUT_JSONL" | "CLAUDE_SESSION_JSONL";
    readonly sessionId: string;
    readonly locatorDigest: string;
    readonly sourceDigest: string;
    readonly byteLength: number;
    readonly recordCount: number;
    readonly terminalMarkerState: "PRESENT" | "ABSENT" | "NOT_APPLICABLE";
  };
  readonly artifacts: {
    readonly promptEnvelope?: ArtifactDescriptorV1;
    readonly raw?: ArtifactDescriptorV1;
    readonly normalized: ArtifactDescriptorV1;
    readonly stderr?: ArtifactDescriptorV1;
  };
  readonly completeness: {
    readonly prompt: "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "PROVIDER_OBSERVED" | "UNVERIFIED";
    readonly messages: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
    readonly tools: "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "NOT_EXPOSED";
    readonly timestamps: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
    readonly hierarchy: "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "NOT_EXPOSED";
    readonly raw: "FULL" | "OMITTED_BY_POLICY" | "UNAVAILABLE";
    readonly providerScope: "PROVIDER_EXPOSED";
  };
  readonly metrics: {
    readonly sourceRecords: number;
    readonly normalizedEvents: number;
    readonly parseErrors: number;
    readonly unknownEvents: number;
    readonly droppedEvents: number;
  };
  readonly parentSessionIds: readonly string[];
  readonly childSessionIds: readonly string[];
  readonly errors: readonly TranscriptCaptureErrorV1[];
  readonly capturedAt: string;
  readonly manifestDigest: string;
}

export interface SessionTranscriptImportReceiptV1 {
  readonly schemaVersion: 1;
  readonly artifactKind: "SESSION_TRANSCRIPT_IMPORT_RECEIPT";
  readonly enrichmentId: string;
  readonly workflowRef: string;
  readonly receiptRef: string;
  readonly importMode: "LIVE" | "HISTORICAL_ENRICHMENT";
  readonly authorityScope: "DIAGNOSTIC_SUPPLEMENT_ONLY";
  readonly captureOperationId: string;
  readonly captureId: string;
  readonly capturePolicy: SessionCapturePolicyV1;
  readonly parserVersion: string;
  readonly parserOptionsDigest: string;
  readonly captureIntentDigest: string;
  readonly captureAttempt: number;
  readonly binding: SessionEvidenceBindingV1;
  readonly promptBinding: "PROMPT_ENVELOPE_V1" | "PROVIDER_NATIVE_OBSERVED" | "UNVERIFIED";
  readonly promptEnvelope?: ArtifactDescriptorV1;
  readonly legacyPromptEvidence?: LegacyPromptBindingEvidenceV1;
  readonly historicalBaseline?: HistoricalEnrichmentBaselineV1;
  readonly captureState: TranscriptTerminalStateV1;
  readonly manifest?: ArtifactDescriptorV1;
  readonly sourceDigest?: string;
  readonly errors: readonly TranscriptCaptureErrorV1[];
  readonly reconciledAfterUnknown: boolean;
  readonly reconcileDecisionDigest?: string;
  readonly predecessorReceiptDigest?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly executorId: string;
  readonly receiptDigest: string;
}

export interface LegacyPromptBindingEvidenceV1 {
  readonly executionIntentDigest: string;
  readonly instructionsDigest: string;
  readonly providerPromptRecordDigest: string;
  readonly recoveredRenderedPromptDigest: string;
  readonly observationMethod: "PROVIDER_NATIVE_RECORD";
  readonly evidenceDigest: string;
}

export interface HistoricalEnrichmentBaselineV1 {
  readonly taskId: string;
  readonly sourceWorkflowRef: string;
  readonly runId: string;
  readonly roleManifestDigest: string;
  readonly workflowProjectionDigest: string;
  readonly domainEventHistoryDigest: string;
  readonly roleManifestSnapshotDigest: string;
  readonly outcome: "SUCCEEDED" | "FAILED_TERMINAL" | "CANCELLED";
  readonly archiveStatus: "ARCHIVED";
  readonly observedAt: string;
  readonly baselineDigest: string;
}

export interface SessionTranscriptCaptureIntentV1 {
  readonly schemaVersion: 1;
  readonly intentKind: "SESSION_TRANSCRIPT_CAPTURE";
  readonly importMode: "LIVE" | "HISTORICAL_ENRICHMENT";
  readonly enrichmentId: string;
  readonly workflowRef: string;
  readonly captureId: string;
  readonly captureAttempt: number;
  readonly captureAttemptId: string;
  readonly captureOperationId: string;
  readonly binding: SessionEvidenceBindingV1;
  readonly capturePolicy: SessionCapturePolicyV1;
  readonly parser: { readonly name: string; readonly version: string; readonly optionsDigest: string };
  readonly sourceLocatorDigest: string;
  readonly maxSourceBytes: number;
  readonly promptBinding: SessionTranscriptImportReceiptV1["promptBinding"];
  readonly promptEnvelope?: ArtifactDescriptorV1;
  readonly legacyPromptEvidence?: LegacyPromptBindingEvidenceV1;
  readonly historicalBaseline?: HistoricalEnrichmentBaselineV1;
  readonly expectedRawRef?: string;
  readonly expectedNormalizedRef: string;
  readonly expectedManifestRef: string;
  readonly expectedReceiptRef: string;
  readonly predecessorReceiptDigest?: string;
  readonly requestedAt: string;
  readonly intentDigest: string;
}

export interface SessionTranscriptUnknownEffectV1 {
  readonly captureOperationId: string;
  readonly captureAttemptId: string;
  readonly reasonDigest: string;
  readonly reconcileToken: string;
  readonly unknownDigest: string;
}

export interface SessionTranscriptReconcileDecisionV1 {
  readonly captureOperationId: string;
  readonly captureAttemptId: string;
  readonly intentDigest: string;
  readonly unknownDigest: string;
  readonly reconcileToken: string;
  readonly action: "CONFIRMED" | "NOT_APPLIED";
  readonly externalEvidenceDigest: string;
  readonly manifestDigest?: string;
  readonly decisionDigest: string;
}

export interface SessionEvidenceAuthorityV1 {
  readonly schemaVersion: 1;
  readonly authorityKey: string;
  readonly binding: SessionEvidenceBindingV1;
  readonly authorityVersion: number;
  readonly activeIntentDigest?: string;
  readonly activeCapture?: {
    readonly intentDigest: string;
    readonly enrichmentId: string;
    readonly workflowRef: string;
    readonly expectedRawRef?: string;
    readonly expectedNormalizedRef: string;
    readonly expectedManifestRef: string;
    readonly expectedReceiptRef: string;
  };
  readonly pendingUnknown?: SessionTranscriptUnknownEffectV1;
  readonly reconcileDecision?: SessionTranscriptReconcileDecisionV1;
  readonly headReceiptDigest?: string;
  readonly transitionDigests: readonly string[];
  readonly history: readonly {
    readonly captureAttempt: number;
    readonly captureOperationId: string;
    readonly captureId: string;
    readonly intentDigest: string;
    readonly enrichmentId: string;
    readonly workflowRef: string;
    readonly receiptRef: string;
    readonly receiptDigest: string;
    readonly captureState: TranscriptTerminalStateV1;
    readonly rawRef?: string;
    readonly normalizedRef: string;
    readonly predecessorReceiptDigest?: string;
    readonly unknownDigest?: string;
    readonly reconcileDecisionDigest?: string;
    readonly manifestRef: string;
    readonly manifestDigest?: string;
  }[];
  readonly stateDigest: string;
}

export interface CapturedContentInputV1 {
  readonly originalValue: string;
  readonly policy: SessionCapturePolicyV1;
  readonly storedValue?: string;
  readonly redaction?: RedactionMetadataV1;
}

export function createCapturedContentV1(input: CapturedContentInputV1): CapturedContentV1 {
  const policy = capturePolicy(input.policy);
  const originalValue = stringValue(input.originalValue, "originalValue");
  const originalBytes = Buffer.byteLength(originalValue, "utf8");
  const originalDigest = sha256Bytes(originalValue);
  if (policy === "digest_only") {
    if (input.storedValue !== undefined || input.redaction !== undefined) {
      throw validation("SESSION_CONTENT_POLICY_INVALID", "digest_only content cannot include stored content or redaction metadata");
    }
    const core = { originalDigest, originalByteLength: originalBytes, disposition: "DIGEST_ONLY" as const };
    return deepFreeze({ ...core, contentDigest: digest("captured-content-v1", core) });
  }
  if (policy === "full") {
    if (input.redaction !== undefined || (input.storedValue !== undefined && input.storedValue !== originalValue)) {
      throw validation("SESSION_CONTENT_POLICY_INVALID", "full content must preserve the exact original UTF-8 bytes");
    }
    const core = {
      originalDigest,
      originalByteLength: originalBytes,
      disposition: "FULL" as const,
      storedDigest: originalDigest,
      storedByteLength: originalBytes,
      storedValue: originalValue,
    };
    return deepFreeze({ ...core, contentDigest: digest("captured-content-v1", core) });
  }
  const storedValue = requiredString(input.storedValue, "storedValue");
  if (input.redaction === undefined) {
    throw validation("SESSION_REDACTION_REQUIRED", "redacted content requires redaction metadata");
  }
  const redaction = normalizeRedaction(input.redaction);
  if (storedValue === originalValue || redaction.matchCount < 1) {
    throw conflict("SESSION_REDACTION_NOT_APPLIED", "redacted content must differ from the original and report at least one trusted match");
  }
  const core = {
    originalDigest,
    originalByteLength: originalBytes,
    disposition: "REDACTED" as const,
    storedDigest: sha256Bytes(storedValue),
    storedByteLength: Buffer.byteLength(storedValue, "utf8"),
    storedValue,
    redaction,
  };
  return deepFreeze({ ...core, contentDigest: digest("captured-content-v1", core) });
}

export function createArtifactDescriptorV1(input: ArtifactDescriptorV1): ArtifactDescriptorV1 {
  return deepFreeze({
    ref: artifactRef(input.ref, "artifact.ref"),
    digest: shaDigest(input.digest, "artifact.digest"),
    byteLength: nonNegativeInteger(input.byteLength, "artifact.byteLength"),
    mediaType: requiredString(input.mediaType, "artifact.mediaType"),
  });
}

export function createPromptEnvelopeV1(input: Omit<PromptEnvelopeV1, "schemaVersion" | "artifactKind" | "envelopeId" | "segments" | "renderedPrompt" | "renderPlan" | "renderInputsDigest" | "envelopeDigest"> & {
  readonly segments: readonly (Omit<PromptSegmentV1, "content"> & { readonly content: CapturedContentInputV1 })[];
  readonly renderedPrompt: CapturedContentInputV1;
  readonly renderPlan: { readonly separator: string };
}): PromptEnvelopeV1 {
  const taskId = task(input.taskId);
  const attemptDigest = shaDigest(input.attemptDigest, "attemptDigest");
  const runId = stableId(input.runId, "runId");
  const capture = capturePolicy(input.capturePolicy);
  assertRolePhaseAndPermission(input.role, input.phase, input.permission);
  const sourceWorkflowRef = owningTaskWorkflowRef(input.sourceWorkflowRef, taskId, "sourceWorkflowRef");
  const expectedAttemptId = `${taskId}.${input.phase}.r${input.specRevision}.g${input.generation}`;
  if (input.attemptId !== expectedAttemptId) throw conflict("PROMPT_ATTEMPT_ID_MISMATCH", `Prompt attemptId must equal ${expectedAttemptId}`);
  const separator = stringValue(input.renderPlan.separator, "renderPlan.separator");
  if (input.segments.map((segment) => segment.content.originalValue).join(separator) !== input.renderedPrompt.originalValue) {
    throw conflict("PROMPT_RENDER_MISMATCH", "Rendered Prompt must be the exact trusted rendering of the ordered Prompt segments");
  }
  const segments = input.segments.map((segment, index) => {
    if (segment.ordinal !== index) throw validation("PROMPT_SEGMENT_SEQUENCE_INVALID", "Prompt segment ordinals must be contiguous from zero");
    if (segment.content.policy !== capture) throw conflict("PROMPT_CAPTURE_POLICY_MISMATCH", "Every Prompt segment must use the Envelope capture policy");
    if ((segment.sourceRef === undefined) !== (segment.sourceDigest === undefined)) {
      throw validation("PROMPT_SEGMENT_SOURCE_INVALID", "Prompt segment sourceRef and sourceDigest must appear together");
    }
    return deepFreeze({
      ordinal: index,
      kind: enumeration(segment.kind, ["MOYE_CONTROL", "TASK_INPUT", "ROLE_INSTRUCTIONS", "PERMISSION_BOUNDARY", "OUTPUT_CONTRACT"] as const, "segment.kind"),
      ...(segment.sourceRef === undefined ? {} : { sourceRef: requiredString(segment.sourceRef, "segment.sourceRef") }),
      ...(segment.sourceDigest === undefined ? {} : { sourceDigest: shaDigest(segment.sourceDigest, "segment.sourceDigest") }),
      content: createCapturedContentV1(segment.content),
    });
  });
  if (input.renderedPrompt.policy !== capture) throw conflict("PROMPT_CAPTURE_POLICY_MISMATCH", "Rendered Prompt must use the Envelope capture policy");
  const renderer = { name: requiredString(input.renderer.name, "renderer.name"), version: requiredString(input.renderer.version, "renderer.version"), optionsDigest: shaDigest(input.renderer.optionsDigest, "renderer.optionsDigest") };
  const renderPlan = { separator, separatorDigest: sha256Bytes(separator) };
  const renderInputsDigest = digest("prompt-render-inputs-v1", { renderer, renderPlan, segments: segments.map((segment) => ({ ordinal: segment.ordinal, kind: segment.kind, originalDigest: segment.content.originalDigest })), renderedPromptDigest: sha256Bytes(input.renderedPrompt.originalValue) });
  const identity = { taskId, attemptDigest, runId, requestDigest: shaDigest(input.requestDigest, "requestDigest"), capture, renderer, renderInputsDigest, createdAt: instant(input.createdAt, "createdAt") };
  const core = {
    schemaVersion: 1 as const,
    artifactKind: "PROMPT_ENVELOPE" as const,
    envelopeId: `prompt-envelope:${digest("prompt-envelope-identity-v1", identity).slice(7)}`,
    taskId,
    sourceWorkflowRef,
    specRevision: positiveInteger(input.specRevision, "specRevision"),
    generation: nonNegativeInteger(input.generation, "generation"),
    role: agentRole(input.role),
    phase: rolePhase(input.phase),
    attemptId: stableId(input.attemptId, "attemptId"),
    attemptDigest,
    runId,
    operationId: stableId(input.operationId, "operationId"),
    requestDigest: identity.requestDigest,
    runnerKind: runnerKind(input.runnerKind),
    permission: enumeration(input.permission, ["READ_ONLY", "WORKSPACE_WRITE"] as const, "permission"),
    subjectCommit: commitId(input.subjectCommit, "subjectCommit"),
    capturePolicy: capture,
    renderer, renderPlan, renderInputsDigest, segments,
    renderedPrompt: createCapturedContentV1(input.renderedPrompt),
    createdAt: instant(input.createdAt, "createdAt"),
  };
  return deepFreeze({ ...core, envelopeDigest: digest("prompt-envelope-v1", core) });
}

export function parsePromptEnvelopeV1(value: unknown, expectedDigest: string): PromptEnvelopeV1 {
  const input = exactRecord(value, "PromptEnvelopeV1", ["schemaVersion", "artifactKind", "envelopeId", "taskId", "sourceWorkflowRef", "specRevision", "generation", "role", "phase", "attemptId", "attemptDigest", "runId", "operationId", "requestDigest", "runnerKind", "permission", "subjectCommit", "capturePolicy", "renderer", "renderPlan", "renderInputsDigest", "segments", "renderedPrompt", "createdAt", "envelopeDigest"]);
  literal(input["schemaVersion"], 1, "schemaVersion");
  literal(input["artifactKind"], "PROMPT_ENVELOPE", "artifactKind");
  const rendererInput = exactRecord(input["renderer"], "renderer", ["name", "version", "optionsDigest"]);
  const renderer = { name: requiredString(rendererInput["name"], "renderer.name"), version: requiredString(rendererInput["version"], "renderer.version"), optionsDigest: shaDigest(rendererInput["optionsDigest"], "renderer.optionsDigest") };
  const renderPlanInput = exactRecord(input["renderPlan"], "renderPlan", ["separator", "separatorDigest"]);
  const renderPlan = { separator: stringValue(renderPlanInput["separator"], "renderPlan.separator"), separatorDigest: shaDigest(renderPlanInput["separatorDigest"], "renderPlan.separatorDigest") };
  if (sha256Bytes(renderPlan.separator) !== renderPlan.separatorDigest) throw conflict("PROMPT_RENDER_PLAN_DIGEST_MISMATCH", "Prompt separator differs from its Digest");
  const segments = array(input["segments"], "segments").map((value, ordinal) => {
    const segment = exactRecord(value, `segments[${ordinal}]`, ["ordinal", "kind", "sourceRef", "sourceDigest", "content"]);
    return {
      ordinal: nonNegativeInteger(segment["ordinal"], `segments[${ordinal}].ordinal`),
      kind: enumeration(segment["kind"], ["MOYE_CONTROL", "TASK_INPUT", "ROLE_INSTRUCTIONS", "PERMISSION_BOUNDARY", "OUTPUT_CONTRACT"] as const, "segment.kind"),
      ...(segment["sourceRef"] === undefined ? {} : { sourceRef: requiredString(segment["sourceRef"], "segment.sourceRef") }),
      ...(segment["sourceDigest"] === undefined ? {} : { sourceDigest: shaDigest(segment["sourceDigest"], "segment.sourceDigest") }),
      content: parseCapturedContentV1(segment["content"]),
    };
  });
  if (segments.some((segment) => (segment.sourceRef === undefined) !== (segment.sourceDigest === undefined))) throw validation("PROMPT_SEGMENT_SOURCE_INVALID", "Prompt segment sourceRef and sourceDigest must appear together");
  if (segments.some((segment, ordinal) => segment.ordinal !== ordinal)) throw validation("PROMPT_SEGMENT_SEQUENCE_INVALID", "Prompt segment ordinals must be contiguous from zero");
  const taskId = task(requiredString(input["taskId"], "taskId"));
  const attemptDigest = shaDigest(input["attemptDigest"], "attemptDigest");
  const runId = stableId(input["runId"], "runId");
  const requestDigest = shaDigest(input["requestDigest"], "requestDigest");
  const renderInputsDigest = shaDigest(input["renderInputsDigest"], "renderInputsDigest");
  const createdAt = instant(input["createdAt"], "createdAt");
  const identity = { taskId, attemptDigest, runId, requestDigest, capture: capturePolicy(input["capturePolicy"]), renderer, renderInputsDigest, createdAt };
  const core = {
    schemaVersion: 1 as const, artifactKind: "PROMPT_ENVELOPE" as const,
    envelopeId: `prompt-envelope:${digest("prompt-envelope-identity-v1", identity).slice(7)}`,
    taskId, sourceWorkflowRef: owningTaskWorkflowRef(input["sourceWorkflowRef"], taskId, "sourceWorkflowRef"),
    specRevision: positiveInteger(input["specRevision"], "specRevision"), generation: nonNegativeInteger(input["generation"], "generation"),
    role: agentRole(input["role"]), phase: rolePhase(input["phase"]), attemptId: stableId(input["attemptId"], "attemptId"),
    attemptDigest, runId, operationId: stableId(input["operationId"], "operationId"), requestDigest,
    runnerKind: runnerKind(input["runnerKind"]), permission: enumeration(input["permission"], ["READ_ONLY", "WORKSPACE_WRITE"] as const, "permission"),
    subjectCommit: commitId(input["subjectCommit"], "subjectCommit"), capturePolicy: identity.capture,
    renderer, renderPlan, renderInputsDigest,
    segments, renderedPrompt: parseCapturedContentV1(input["renderedPrompt"]), createdAt,
  };
  const expectedRenderInputs = digest("prompt-render-inputs-v1", { renderer, renderPlan, segments: segments.map((segment) => ({ ordinal: segment.ordinal, kind: segment.kind, originalDigest: segment.content.originalDigest })), renderedPromptDigest: core.renderedPrompt.originalDigest });
  if (renderInputsDigest !== expectedRenderInputs) throw conflict("PROMPT_RENDER_INPUTS_DIGEST_MISMATCH", "Prompt render inputs differ from their Digest");
  assertRolePhaseAndPermission(core.role, core.phase, core.permission);
  if (core.attemptId !== `${core.taskId}.${core.phase}.r${core.specRevision}.g${core.generation}`) throw conflict("PROMPT_ATTEMPT_ID_MISMATCH", "Prompt attemptId does not bind its Revision/Generation/Phase");
  const expectedDisposition = contentDispositionForPolicy(core.capturePolicy);
  if (core.renderedPrompt.disposition !== expectedDisposition || core.segments.some((segment) => segment.content.disposition !== expectedDisposition)) {
    throw conflict("PROMPT_CAPTURE_POLICY_MISMATCH", "Stored Prompt content must match the Envelope capture policy");
  }
  if (core.capturePolicy === "full") {
    const renderedFromSegments = core.segments.map((segment) => segment.content.storedValue!).join(core.renderPlan.separator);
    if (renderedFromSegments !== core.renderedPrompt.storedValue) throw conflict("PROMPT_RENDER_MISMATCH", "FULL Prompt Envelope stored segments must reproduce the exact rendered Prompt bytes");
  }
  const rebuilt: PromptEnvelopeV1 = deepFreeze({ ...core, envelopeDigest: digest("prompt-envelope-v1", core) });
  assertExactAndDigest(input, rebuilt as unknown as Record<string, unknown>, expectedDigest, "envelopeDigest", "PromptEnvelopeV1");
  return rebuilt;
}

export function assertPromptEnvelopePreparedRoleRunV2(envelopeInput: PromptEnvelopeV1, request: PreparedRealRoleRunV2): void {
  const envelope = parsePromptEnvelopeV1(JSON.parse(JSON.stringify(envelopeInput)), envelopeInput.envelopeDigest);
  const renderedPrompt = renderRoleAgentPromptV2({ role: request.attempt.role, phase: request.attempt.phase, instructions: request.instructions, permission: request.attempt.permission });
  const instructionSegments = envelope.segments.filter((segment) => segment.kind === "ROLE_INSTRUCTIONS");
  if (envelope.taskId !== request.attempt.taskId || envelope.specRevision !== request.attempt.specRevision || envelope.generation !== request.attempt.generation ||
      envelope.role !== request.attempt.role || envelope.phase !== request.attempt.phase || envelope.attemptId !== request.attempt.attemptId || envelope.attemptDigest !== request.attempt.attemptDigest ||
      envelope.runId !== request.runId || envelope.operationId !== request.operationId || envelope.requestDigest !== request.requestDigest || envelope.runnerKind !== request.attempt.runnerKind ||
      envelope.permission !== request.attempt.permission || envelope.subjectCommit !== request.attempt.subjectCommit || instructionSegments.length !== 1 ||
      instructionSegments[0]!.content.originalDigest !== request.instructionsDigest || envelope.renderedPrompt.originalDigest !== sha256Bytes(renderedPrompt)) {
    throw conflict("PROMPT_ROLE_REQUEST_MISMATCH", "Prompt Envelope does not bind the exact prepared Role request, instructions, and rendered CLI Prompt");
  }
}

export function createActiveRoleRunLocatorV1(input: Omit<ActiveRoleRunLocatorV1, "schemaVersion" | "locatorKind" | "binding" | "promptEnvelope" | "locatorDigest"> & {
  readonly binding: Omit<SessionEvidenceBindingV1, "providerSessionId" | "roleManifestRef" | "roleManifestDigest">;
  readonly promptEnvelope: ArtifactDescriptorV1;
}): ActiveRoleRunLocatorV1 {
  const locatorVersion = positiveInteger(input.locatorVersion, "locatorVersion");
  if ((locatorVersion > 1) !== (input.previousLocatorDigest !== undefined)) throw conflict("ROLE_LOCATOR_PREDECESSOR_INVALID", "Locator versions after the first require previousLocatorDigest");
  const stage = enumeration(input.stage, ["PREPARED", "RUNNING", "AGENT_COMPLETED", "CAPTURE_PENDING"] as const, "stage");
  if (stage === "PREPARED" && (input.providerSessionId !== undefined || input.startedAt !== undefined)) throw conflict("ROLE_LOCATOR_STAGE_INVALID", "PREPARED Locator cannot claim a Session or Agent start");
  if (stage !== "PREPARED" && input.startedAt === undefined) throw conflict("ROLE_LOCATOR_STAGE_INVALID", `${stage} Locator requires startedAt`);
  if ((stage === "AGENT_COMPLETED" || stage === "CAPTURE_PENDING") && input.providerSessionId === undefined) throw conflict("ROLE_LOCATOR_SESSION_REQUIRED", `${stage} Locator requires the confirmed Provider Session ID`);
  const preparedAt = instant(input.preparedAt, "preparedAt");
  const updatedAt = instant(input.updatedAt, "updatedAt");
  const startedAt = input.startedAt === undefined ? undefined : instant(input.startedAt, "startedAt");
  if (Date.parse(updatedAt) < Date.parse(preparedAt) || (startedAt !== undefined && Date.parse(startedAt) < Date.parse(preparedAt))) throw validation("ROLE_LOCATOR_TIME_INVALID", "Locator timestamps must be monotonic");
  const core = {
    schemaVersion: 1 as const,
    locatorKind: "ACTIVE_ROLE_RUN" as const,
    binding: normalizePreRunBinding(input.binding),
    stage, locatorVersion,
    ...(input.previousLocatorDigest === undefined ? {} : { previousLocatorDigest: shaDigest(input.previousLocatorDigest, "previousLocatorDigest") }),
    ...(input.providerSessionId === undefined ? {} : { providerSessionId: requiredString(input.providerSessionId, "providerSessionId") }),
    promptEnvelope: createArtifactDescriptorV1(input.promptEnvelope),
    expectedExecutionEventsRef: requiredString(input.expectedExecutionEventsRef, "expectedExecutionEventsRef"),
    expectedStderrRef: requiredString(input.expectedStderrRef, "expectedStderrRef"),
    preparedAt, ...(startedAt === undefined ? {} : { startedAt }), updatedAt,
  };
  return deepFreeze({ ...core, locatorDigest: digest("active-role-run-locator-v1", core) });
}

export function parseActiveRoleRunLocatorV1(value: unknown, expectedDigest: string): ActiveRoleRunLocatorV1 {
  const input = exactRecord(value, "ActiveRoleRunLocatorV1", ["schemaVersion", "locatorKind", "binding", "stage", "locatorVersion", "previousLocatorDigest", "providerSessionId", "promptEnvelope", "expectedExecutionEventsRef", "expectedStderrRef", "preparedAt", "startedAt", "updatedAt", "locatorDigest"]);
  literal(input["schemaVersion"], 1, "schemaVersion");
  literal(input["locatorKind"], "ACTIVE_ROLE_RUN", "locatorKind");
  const rebuilt = createActiveRoleRunLocatorV1({
    binding: parsePreRunBinding(input["binding"]),
    stage: enumeration(input["stage"], ["PREPARED", "RUNNING", "AGENT_COMPLETED", "CAPTURE_PENDING"] as const, "stage"),
    locatorVersion: positiveInteger(input["locatorVersion"], "locatorVersion"),
    ...(input["previousLocatorDigest"] === undefined ? {} : { previousLocatorDigest: shaDigest(input["previousLocatorDigest"], "previousLocatorDigest") }),
    ...(input["providerSessionId"] === undefined ? {} : { providerSessionId: requiredString(input["providerSessionId"], "providerSessionId") }),
    promptEnvelope: parseArtifactDescriptorV1(input["promptEnvelope"]),
    expectedExecutionEventsRef: requiredString(input["expectedExecutionEventsRef"], "expectedExecutionEventsRef"),
    expectedStderrRef: requiredString(input["expectedStderrRef"], "expectedStderrRef"),
    preparedAt: instant(input["preparedAt"], "preparedAt"),
    ...(input["startedAt"] === undefined ? {} : { startedAt: instant(input["startedAt"], "startedAt") }),
    updatedAt: instant(input["updatedAt"], "updatedAt"),
  });
  assertExactAndDigest(input, rebuilt as unknown as Record<string, unknown>, expectedDigest, "locatorDigest", "ActiveRoleRunLocatorV1");
  return rebuilt;
}

export function advanceActiveRoleRunLocatorV1(currentInput: ActiveRoleRunLocatorV1, input: {
  readonly stage: "RUNNING" | "AGENT_COMPLETED" | "CAPTURE_PENDING";
  readonly providerSessionId?: string;
  readonly updatedAt: string;
}): ActiveRoleRunLocatorV1 {
  const current = parseActiveRoleRunLocatorV1(JSON.parse(JSON.stringify(currentInput)), currentInput.locatorDigest);
  const stages = ["PREPARED", "RUNNING", "AGENT_COMPLETED", "CAPTURE_PENDING"] as const;
  const currentIndex = stages.indexOf(current.stage);
  const nextIndex = stages.indexOf(input.stage);
  if (nextIndex !== currentIndex + 1) throw conflict("ROLE_LOCATOR_TRANSITION_INVALID", `Locator cannot transition ${current.stage} → ${input.stage}`);
  const providerSessionId = input.providerSessionId ?? current.providerSessionId;
  return createActiveRoleRunLocatorV1({
    binding: current.binding, stage: input.stage, locatorVersion: current.locatorVersion + 1, previousLocatorDigest: current.locatorDigest,
    ...(providerSessionId === undefined ? {} : { providerSessionId }), promptEnvelope: current.promptEnvelope,
    expectedExecutionEventsRef: current.expectedExecutionEventsRef, expectedStderrRef: current.expectedStderrRef,
    preparedAt: current.preparedAt, startedAt: current.startedAt ?? instant(input.updatedAt, "updatedAt"), updatedAt: input.updatedAt,
  });
}

export function createNormalizedTimelineEventV1(input: Omit<NormalizedTimelineEventV1, "schemaVersion" | "eventId" | "parts" | "eventDigest"> & {
  readonly parts: readonly (Omit<NormalizedTimelinePartV1, "content"> & { readonly content: CapturedContentInputV1 })[];
}): NormalizedTimelineEventV1 {
  const provider = sessionProvider(input.provider);
  const captureId = stableId(input.captureId, "captureId");
  const eventCapturePolicy = capturePolicy(input.capturePolicy);
  const source = {
    recordSequence: nonNegativeInteger(input.source.recordSequence, "source.recordSequence"),
    partIndex: nonNegativeInteger(input.source.partIndex, "source.partIndex"),
    providerType: requiredString(input.source.providerType, "source.providerType"),
    ...(input.source.providerId === undefined ? {} : { providerId: requiredString(input.source.providerId, "source.providerId") }),
    recordDigest: shaDigest(input.source.recordDigest, "source.recordDigest"),
  };
  const timestampState = enumeration(input.timestampState, ["PROVIDED", "MISSING", "INVALID"] as const, "timestampState");
  if ((timestampState === "PROVIDED") !== (input.occurredAt !== undefined)) {
    throw validation("TIMELINE_TIMESTAMP_STATE_INVALID", "occurredAt exists exactly when timestampState is PROVIDED");
  }
  const category = enumeration(input.category, ["PROMPT", "USER", "ASSISTANT", "TOOL_CALL", "TOOL_RESULT", "SYSTEM", "ERROR", "STDERR", "OTHER"] as const, "category");
  const actor = enumeration(input.actor, ["USER", "ASSISTANT", "TOOL", "SYSTEM", "RUNTIME", "UNKNOWN"] as const, "actor");
  const origin = enumeration(input.origin, ["MOYE_RENDERED_PROMPT", "PROVIDER_USER", "PROVIDER_ASSISTANT", "PROVIDER_TOOL", "PROVIDER_SYSTEM", "MOYE_RUNTIME", "UNKNOWN"] as const, "origin");
  const parts = input.parts.map((part) => deepFreeze({
    kind: enumeration(part.kind, ["TEXT", "PROVIDER_EXPOSED_THINKING", "TOOL_CALL", "TOOL_RESULT", "JSON", "UNKNOWN"] as const, "part.kind"),
    content: createCapturedContentV1(part.content),
    ...(part.toolName === undefined ? {} : { toolName: requiredString(part.toolName, "part.toolName") }),
    ...(part.toolCallId === undefined ? {} : { toolCallId: requiredString(part.toolCallId, "part.toolCallId") }),
  }));
  assertTimelineClassification(category, actor, origin, parts);
  const expectedDisposition = contentDispositionForPolicy(eventCapturePolicy);
  if (parts.some((part) => part.content.disposition !== expectedDisposition)) throw conflict("TIMELINE_CAPTURE_POLICY_MISMATCH", "Every Timeline part must follow the Event capture policy");
  const eventIdentity = { captureId, recordSequence: source.recordSequence, partIndex: source.partIndex };
  const core = {
    schemaVersion: 1 as const,
    captureId,
    provider,
    providerSessionId: requiredString(input.providerSessionId, "providerSessionId"), capturePolicy: eventCapturePolicy,
    sequence: positiveInteger(input.sequence, "sequence"),
    eventId: `timeline-event:${digest("timeline-event-identity-v1", eventIdentity).slice(7)}`,
    source,
    ...(input.occurredAt === undefined ? {} : { occurredAt: instant(input.occurredAt, "occurredAt") }),
    timestampState,
    category,
    actor,
    origin,
    parts,
    ...(input.correlation === undefined ? {} : { correlation: normalizeCorrelation(input.correlation) }),
  };
  return deepFreeze({ ...core, eventDigest: digest("normalized-timeline-event-v1", core) });
}

export function parseNormalizedTimelineEventV1(value: unknown, expectedDigest: string): NormalizedTimelineEventV1 {
  const input = exactRecord(value, "NormalizedTimelineEventV1", ["schemaVersion", "captureId", "provider", "providerSessionId", "capturePolicy", "sequence", "eventId", "source", "occurredAt", "timestampState", "category", "actor", "origin", "parts", "correlation", "eventDigest"]);
  literal(input["schemaVersion"], 1, "schemaVersion");
  const sourceInput = exactRecord(input["source"], "source", ["recordSequence", "partIndex", "providerType", "providerId", "recordDigest"]);
  const source = {
    recordSequence: nonNegativeInteger(sourceInput["recordSequence"], "source.recordSequence"),
    partIndex: nonNegativeInteger(sourceInput["partIndex"], "source.partIndex"),
    providerType: requiredString(sourceInput["providerType"], "source.providerType"),
    ...(sourceInput["providerId"] === undefined ? {} : { providerId: requiredString(sourceInput["providerId"], "source.providerId") }),
    recordDigest: shaDigest(sourceInput["recordDigest"], "source.recordDigest"),
  };
  const timestampState = enumeration(input["timestampState"], ["PROVIDED", "MISSING", "INVALID"] as const, "timestampState");
  if ((timestampState === "PROVIDED") !== (input["occurredAt"] !== undefined)) throw validation("TIMELINE_TIMESTAMP_STATE_INVALID", "occurredAt exists exactly when timestampState is PROVIDED");
  const category = enumeration(input["category"], ["PROMPT", "USER", "ASSISTANT", "TOOL_CALL", "TOOL_RESULT", "SYSTEM", "ERROR", "STDERR", "OTHER"] as const, "category");
  const actor = enumeration(input["actor"], ["USER", "ASSISTANT", "TOOL", "SYSTEM", "RUNTIME", "UNKNOWN"] as const, "actor");
  const origin = enumeration(input["origin"], ["MOYE_RENDERED_PROMPT", "PROVIDER_USER", "PROVIDER_ASSISTANT", "PROVIDER_TOOL", "PROVIDER_SYSTEM", "MOYE_RUNTIME", "UNKNOWN"] as const, "origin");
  const parts = array(input["parts"], "parts").map((value, index) => {
    const part = exactRecord(value, `parts[${index}]`, ["kind", "content", "toolName", "toolCallId"]);
    return deepFreeze({
      kind: enumeration(part["kind"], ["TEXT", "PROVIDER_EXPOSED_THINKING", "TOOL_CALL", "TOOL_RESULT", "JSON", "UNKNOWN"] as const, "part.kind"),
      content: parseCapturedContentV1(part["content"]),
      ...(part["toolName"] === undefined ? {} : { toolName: requiredString(part["toolName"], "part.toolName") }),
      ...(part["toolCallId"] === undefined ? {} : { toolCallId: requiredString(part["toolCallId"], "part.toolCallId") }),
    });
  });
  assertTimelineClassification(category, actor, origin, parts);
  const eventCapturePolicy = capturePolicy(input["capturePolicy"]);
  if (parts.some((part) => part.content.disposition !== contentDispositionForPolicy(eventCapturePolicy))) throw conflict("TIMELINE_CAPTURE_POLICY_MISMATCH", "Every Timeline part must follow the Event capture policy");
  const captureId = stableId(input["captureId"], "captureId");
  const eventIdentity = { captureId, recordSequence: source.recordSequence, partIndex: source.partIndex };
  const core = {
    schemaVersion: 1 as const, captureId, provider: sessionProvider(input["provider"]),
    providerSessionId: requiredString(input["providerSessionId"], "providerSessionId"), capturePolicy: eventCapturePolicy, sequence: positiveInteger(input["sequence"], "sequence"),
    eventId: `timeline-event:${digest("timeline-event-identity-v1", eventIdentity).slice(7)}`, source,
    ...(input["occurredAt"] === undefined ? {} : { occurredAt: instant(input["occurredAt"], "occurredAt") }),
    timestampState, category, actor,
    origin,
    parts,
    ...(input["correlation"] === undefined ? {} : { correlation: parseCorrelation(input["correlation"]) }),
  };
  const rebuilt: NormalizedTimelineEventV1 = deepFreeze({ ...core, eventDigest: digest("normalized-timeline-event-v1", core) });
  assertExactAndDigest(input, rebuilt as unknown as Record<string, unknown>, expectedDigest, "eventDigest", "NormalizedTimelineEventV1");
  return rebuilt;
}

export function createNormalizedTimelineArtifactV1(input: {
  readonly ref: string;
  readonly captureId: string;
  readonly provider: SessionProviderV1;
  readonly providerSessionId: string;
  readonly capturePolicy: SessionCapturePolicyV1;
  readonly events: readonly NormalizedTimelineEventV1[];
  readonly renderedPromptDigest?: string;
}): { readonly descriptor: ArtifactDescriptorV1; readonly canonicalJsonl: string; readonly eventCount: number; readonly unknownEventCount: number } {
  const captureId = stableId(input.captureId, "captureId");
  const provider = sessionProvider(input.provider);
  const providerSessionId = requiredString(input.providerSessionId, "providerSessionId");
  const policy = capturePolicy(input.capturePolicy);
  const parsed = input.events.map((event) => parseNormalizedTimelineEventV1(JSON.parse(JSON.stringify(event)), event.eventDigest));
  parsed.forEach((event, index) => {
    if (event.sequence !== index + 1) throw conflict("TIMELINE_SEQUENCE_INVALID", "Normalized Timeline sequence must be contiguous from one in source order");
    if (event.captureId !== captureId || event.provider !== provider || event.providerSessionId !== providerSessionId || event.capturePolicy !== policy) {
      throw conflict("TIMELINE_COLLECTION_BINDING_MISMATCH", "Every Timeline Event must bind the exact Capture, Provider, Session, and policy");
    }
  });
  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1]!.source;
    const current = parsed[index]!.source;
    if (current.recordSequence < previous.recordSequence || (current.recordSequence === previous.recordSequence && current.partIndex <= previous.partIndex)) {
      throw conflict("TIMELINE_SOURCE_ORDER_INVALID", "Normalized Timeline must preserve unique Provider recordSequence/partIndex source order");
    }
  }
  if (new Set(parsed.map((event) => event.eventId)).size !== parsed.length) throw conflict("TIMELINE_EVENT_ID_DUPLICATE", "Normalized Timeline eventId must be unique");
  if (input.renderedPromptDigest !== undefined) {
    const expected = shaDigest(input.renderedPromptDigest, "renderedPromptDigest");
    const prompts = parsed.filter((event) => event.category === "PROMPT");
    if (prompts.length !== 1 || prompts[0]?.parts.length !== 1 || prompts[0].parts[0]?.content.originalDigest !== expected) {
      throw conflict("TIMELINE_PROMPT_BINDING_MISMATCH", "Exactly one PROMPT Event must bind the rendered Prompt Digest");
    }
  }
  const canonicalJsonl = parsed.map((event) => canonical(event)).join("\n") + (parsed.length === 0 ? "" : "\n");
  return deepFreeze({
    descriptor: createArtifactDescriptorV1({ ref: input.ref, digest: sha256Bytes(canonicalJsonl), byteLength: Buffer.byteLength(canonicalJsonl, "utf8"), mediaType: "application/x-ndjson" }),
    canonicalJsonl, eventCount: parsed.length, unknownEventCount: parsed.filter((event) => event.category === "OTHER").length,
  });
}

export function createSessionTranscriptManifestV1(input: Omit<SessionTranscriptManifestV1, "schemaVersion" | "artifactKind" | "binding" | "artifacts" | "errors" | "manifestDigest"> & {
  readonly binding: SessionEvidenceBindingV1;
  readonly artifacts: SessionTranscriptManifestV1["artifacts"];
  readonly errors: readonly TranscriptCaptureErrorV1[];
}): SessionTranscriptManifestV1 {
  const binding = normalizeBinding(input.binding);
  if (input.source.sessionId !== binding.providerSessionId) throw conflict("TRANSCRIPT_SESSION_BINDING_MISMATCH", "Source Session must equal binding providerSessionId");
  const capturePolicyValue = capturePolicy(input.capturePolicy);
  const captureState = enumeration(input.captureState, ["COMPLETE", "PARTIAL"] as const, "captureState");
  const metrics = {
    sourceRecords: nonNegativeInteger(input.metrics.sourceRecords, "metrics.sourceRecords"),
    normalizedEvents: nonNegativeInteger(input.metrics.normalizedEvents, "metrics.normalizedEvents"),
    parseErrors: nonNegativeInteger(input.metrics.parseErrors, "metrics.parseErrors"),
    unknownEvents: nonNegativeInteger(input.metrics.unknownEvents, "metrics.unknownEvents"),
    droppedEvents: nonNegativeInteger(input.metrics.droppedEvents, "metrics.droppedEvents"),
  };
  if (metrics.sourceRecords !== input.source.recordCount || metrics.unknownEvents > metrics.normalizedEvents || metrics.droppedEvents > metrics.sourceRecords) {
    throw conflict("TRANSCRIPT_METRICS_INVALID", "Transcript metrics must agree with source records and normalized event bounds");
  }
  const coreCompletenessValues = [input.completeness.prompt, input.completeness.messages, input.completeness.timestamps];
  if (captureState === "COMPLETE" && (metrics.parseErrors > 0 || metrics.droppedEvents > 0 || metrics.unknownEvents > 0 || input.errors.length > 0 ||
      input.source.terminalMarkerState === "ABSENT" || metrics.normalizedEvents === 0 || coreCompletenessValues.some((value) => value !== "COMPLETE") ||
      input.completeness.tools === "PARTIAL" || input.completeness.tools === "UNAVAILABLE" || input.completeness.hierarchy === "PARTIAL" || input.completeness.hierarchy === "UNAVAILABLE")) {
    throw conflict("TRANSCRIPT_COMPLETE_WITH_GAPS", "COMPLETE Transcript requires terminal, non-empty, error-free Provider-exposed evidence with complete core dimensions");
  }
  if (captureState === "PARTIAL" && input.errors.length === 0) throw conflict("TRANSCRIPT_PARTIAL_WITHOUT_ERROR", "PARTIAL Transcript must include a stable, explainable Capture Error");
  if (capturePolicyValue !== "full" && input.artifacts.raw !== undefined) {
    throw conflict("TRANSCRIPT_RAW_POLICY_INVALID", "Raw Transcript Artifact is allowed only under full capture policy");
  }
  if (capturePolicyValue === "full" && input.artifacts.raw === undefined) {
    throw conflict("TRANSCRIPT_RAW_REQUIRED", "full capture policy requires an exact-byte raw Transcript Artifact");
  }
  const parser = {
    name: requiredString(input.parser.name, "parser.name"), version: requiredString(input.parser.version, "parser.version"),
    normalizedSchemaVersion: literal(input.parser.normalizedSchemaVersion, 1, "parser.normalizedSchemaVersion"),
    optionsDigest: shaDigest(input.parser.optionsDigest, "parser.optionsDigest"),
    ...(input.parser.buildId === undefined ? {} : { buildId: requiredString(input.parser.buildId, "parser.buildId") }),
  };
  const source = {
    kind: enumeration(input.source.kind, ["CODEX_ROLLOUT_JSONL", "CLAUDE_SESSION_JSONL"] as const, "source.kind"),
    sessionId: requiredString(input.source.sessionId, "source.sessionId"), locatorDigest: shaDigest(input.source.locatorDigest, "source.locatorDigest"),
    sourceDigest: shaDigest(input.source.sourceDigest, "source.sourceDigest"), byteLength: nonNegativeInteger(input.source.byteLength, "source.byteLength"),
    recordCount: nonNegativeInteger(input.source.recordCount, "source.recordCount"),
    terminalMarkerState: enumeration(input.source.terminalMarkerState, ["PRESENT", "ABSENT", "NOT_APPLICABLE"] as const, "source.terminalMarkerState"),
  };
  const expectedSourceKind = binding.provider === "CODEX" ? "CODEX_ROLLOUT_JSONL" : "CLAUDE_SESSION_JSONL";
  if (source.kind !== expectedSourceKind) throw conflict("TRANSCRIPT_PROVIDER_SOURCE_MISMATCH", "Transcript source kind must match the bound Provider");
  const artifacts = {
    ...(input.artifacts.promptEnvelope === undefined ? {} : { promptEnvelope: createArtifactDescriptorV1(input.artifacts.promptEnvelope) }),
    ...(input.artifacts.raw === undefined ? {} : { raw: createArtifactDescriptorV1(input.artifacts.raw) }),
    normalized: createArtifactDescriptorV1(input.artifacts.normalized),
    ...(input.artifacts.stderr === undefined ? {} : { stderr: createArtifactDescriptorV1(input.artifacts.stderr) }),
  };
  if (artifacts.raw !== undefined && (artifacts.raw.digest !== source.sourceDigest || artifacts.raw.byteLength !== source.byteLength || artifacts.raw.mediaType !== "application/x-ndjson")) {
    throw conflict("TRANSCRIPT_RAW_SOURCE_MISMATCH", "Raw Transcript Artifact must be the exact-byte Provider source snapshot");
  }
  if (artifacts.normalized.mediaType !== "application/x-ndjson") throw validation("TRANSCRIPT_NORMALIZED_MEDIA_TYPE_INVALID", "Normalized Transcript must use application/x-ndjson");
  if ((capturePolicyValue === "full") !== (input.completeness.raw === "FULL")) {
    throw conflict("TRANSCRIPT_RAW_COMPLETENESS_INVALID", "Raw completeness must reflect the selected capture policy");
  }
  if (capturePolicyValue !== "full" && input.completeness.raw !== "OMITTED_BY_POLICY") {
    throw conflict("TRANSCRIPT_RAW_COMPLETENESS_INVALID", "Non-full capture must mark raw as OMITTED_BY_POLICY");
  }
  const errors = sortCaptureErrors(input.errors.map(normalizeCaptureError));
  const parentSessionIds = sortedUniqueStrings(input.parentSessionIds, "parentSessionIds");
  const childSessionIds = sortedUniqueStrings(input.childSessionIds, "childSessionIds");
  if (parentSessionIds.includes(binding.providerSessionId) || childSessionIds.includes(binding.providerSessionId) || parentSessionIds.some((id) => childSessionIds.includes(id))) {
    throw conflict("TRANSCRIPT_SESSION_HIERARCHY_INVALID", "Session hierarchy cannot reference itself or classify one Session as both parent and child");
  }
  const expectedCaptureId = sessionTranscriptCaptureIdV1({ binding, parserName: parser.name, parserVersion: parser.version, optionsDigest: parser.optionsDigest, capturePolicy: capturePolicyValue });
  if (input.captureId !== expectedCaptureId) throw conflict("TRANSCRIPT_CAPTURE_ID_MISMATCH", "captureId must bind the exact source Role, parser version/options, and policy");
  const core = {
    schemaVersion: 1 as const, artifactKind: "SESSION_TRANSCRIPT_MANIFEST" as const,
    captureId: stableId(input.captureId, "captureId"), captureOperationId: stableId(input.captureOperationId, "captureOperationId"),
    binding, capturePolicy: capturePolicyValue, captureState, parser, source, artifacts,
    completeness: normalizeCompleteness(input.completeness), metrics,
    parentSessionIds, childSessionIds, errors,
    capturedAt: instant(input.capturedAt, "capturedAt"),
  };
  return deepFreeze({ ...core, manifestDigest: digest("session-transcript-manifest-v1", core) });
}

export function parseSessionTranscriptManifestV1(value: unknown, expectedDigest: string): SessionTranscriptManifestV1 {
  const input = exactRecord(value, "SessionTranscriptManifestV1", ["schemaVersion", "artifactKind", "captureId", "captureOperationId", "binding", "capturePolicy", "captureState", "parser", "source", "artifacts", "completeness", "metrics", "parentSessionIds", "childSessionIds", "errors", "capturedAt", "manifestDigest"]);
  literal(input["schemaVersion"], 1, "schemaVersion"); literal(input["artifactKind"], "SESSION_TRANSCRIPT_MANIFEST", "artifactKind");
  const parser = exactRecord(input["parser"], "parser", ["name", "version", "normalizedSchemaVersion", "optionsDigest", "buildId"]);
  const source = exactRecord(input["source"], "source", ["kind", "sessionId", "locatorDigest", "sourceDigest", "byteLength", "recordCount", "terminalMarkerState"]);
  const artifacts = exactRecord(input["artifacts"], "artifacts", ["promptEnvelope", "raw", "normalized", "stderr"]);
  const completeness = exactRecord(input["completeness"], "completeness", ["prompt", "messages", "tools", "timestamps", "hierarchy", "raw", "providerScope"]);
  const metrics = exactRecord(input["metrics"], "metrics", ["sourceRecords", "normalizedEvents", "parseErrors", "unknownEvents", "droppedEvents"]);
  const rebuilt = createSessionTranscriptManifestV1({
    captureId: requiredString(input["captureId"], "captureId"), captureOperationId: requiredString(input["captureOperationId"], "captureOperationId"),
    binding: parseBinding(input["binding"]), capturePolicy: capturePolicy(input["capturePolicy"]),
    captureState: enumeration(input["captureState"], ["COMPLETE", "PARTIAL"] as const, "captureState"),
    parser: { name: requiredString(parser["name"], "parser.name"), version: requiredString(parser["version"], "parser.version"), normalizedSchemaVersion: literal(parser["normalizedSchemaVersion"], 1, "parser.normalizedSchemaVersion"), optionsDigest: shaDigest(parser["optionsDigest"], "parser.optionsDigest"), ...(parser["buildId"] === undefined ? {} : { buildId: requiredString(parser["buildId"], "parser.buildId") }) },
    source: { kind: enumeration(source["kind"], ["CODEX_ROLLOUT_JSONL", "CLAUDE_SESSION_JSONL"] as const, "source.kind"), sessionId: requiredString(source["sessionId"], "source.sessionId"), locatorDigest: shaDigest(source["locatorDigest"], "source.locatorDigest"), sourceDigest: shaDigest(source["sourceDigest"], "source.sourceDigest"), byteLength: nonNegativeInteger(source["byteLength"], "source.byteLength"), recordCount: nonNegativeInteger(source["recordCount"], "source.recordCount"), terminalMarkerState: enumeration(source["terminalMarkerState"], ["PRESENT", "ABSENT", "NOT_APPLICABLE"] as const, "source.terminalMarkerState") },
    artifacts: { ...(artifacts["promptEnvelope"] === undefined ? {} : { promptEnvelope: parseArtifactDescriptorV1(artifacts["promptEnvelope"]) }), ...(artifacts["raw"] === undefined ? {} : { raw: parseArtifactDescriptorV1(artifacts["raw"]) }), normalized: parseArtifactDescriptorV1(artifacts["normalized"]), ...(artifacts["stderr"] === undefined ? {} : { stderr: parseArtifactDescriptorV1(artifacts["stderr"]) }) },
    completeness: { prompt: enumeration(completeness["prompt"], ["COMPLETE", "PARTIAL", "UNAVAILABLE", "PROVIDER_OBSERVED", "UNVERIFIED"] as const, "completeness.prompt"), messages: enumeration(completeness["messages"], ["COMPLETE", "PARTIAL", "UNAVAILABLE"] as const, "completeness.messages"), tools: enumeration(completeness["tools"], ["COMPLETE", "PARTIAL", "UNAVAILABLE", "NOT_EXPOSED"] as const, "completeness.tools"), timestamps: enumeration(completeness["timestamps"], ["COMPLETE", "PARTIAL", "UNAVAILABLE"] as const, "completeness.timestamps"), hierarchy: enumeration(completeness["hierarchy"], ["COMPLETE", "PARTIAL", "UNAVAILABLE", "NOT_EXPOSED"] as const, "completeness.hierarchy"), raw: enumeration(completeness["raw"], ["FULL", "OMITTED_BY_POLICY", "UNAVAILABLE"] as const, "completeness.raw"), providerScope: literal(completeness["providerScope"], "PROVIDER_EXPOSED", "completeness.providerScope") },
    metrics: { sourceRecords: nonNegativeInteger(metrics["sourceRecords"], "metrics.sourceRecords"), normalizedEvents: nonNegativeInteger(metrics["normalizedEvents"], "metrics.normalizedEvents"), parseErrors: nonNegativeInteger(metrics["parseErrors"], "metrics.parseErrors"), unknownEvents: nonNegativeInteger(metrics["unknownEvents"], "metrics.unknownEvents"), droppedEvents: nonNegativeInteger(metrics["droppedEvents"], "metrics.droppedEvents") },
    parentSessionIds: array(input["parentSessionIds"], "parentSessionIds").map((item) => requiredString(item, "parentSessionId")),
    childSessionIds: array(input["childSessionIds"], "childSessionIds").map((item) => requiredString(item, "childSessionId")),
    errors: array(input["errors"], "errors").map(parseCaptureError), capturedAt: instant(input["capturedAt"], "capturedAt"),
  });
  assertExactAndDigest(input, rebuilt as unknown as Record<string, unknown>, expectedDigest, "manifestDigest", "SessionTranscriptManifestV1");
  return rebuilt;
}

export function assertSessionTranscriptManifestTimelineV1(manifestInput: SessionTranscriptManifestV1, events: readonly NormalizedTimelineEventV1[], renderedPromptDigest?: string): void {
  const manifest = parseSessionTranscriptManifestV1(JSON.parse(JSON.stringify(manifestInput)), manifestInput.manifestDigest);
  const normalized = createNormalizedTimelineArtifactV1({
    ref: manifest.artifacts.normalized.ref, captureId: manifest.captureId, provider: manifest.binding.provider,
    providerSessionId: manifest.binding.providerSessionId, capturePolicy: manifest.capturePolicy, events,
    ...(renderedPromptDigest === undefined ? {} : { renderedPromptDigest }),
  });
  if (canonical(normalized.descriptor) !== canonical(manifest.artifacts.normalized) || normalized.eventCount !== manifest.metrics.normalizedEvents || normalized.unknownEventCount !== manifest.metrics.unknownEvents) {
    throw conflict("TRANSCRIPT_NORMALIZED_ARTIFACT_MISMATCH", "Normalized Timeline bytes/counts differ from the Transcript Manifest");
  }
}

export function assertSessionTranscriptManifestPromptV1(manifestInput: SessionTranscriptManifestV1, envelopeInput: PromptEnvelopeV1, request: PreparedRealRoleRunV2): void {
  const manifest = parseSessionTranscriptManifestV1(JSON.parse(JSON.stringify(manifestInput)), manifestInput.manifestDigest);
  const envelope = parsePromptEnvelopeV1(JSON.parse(JSON.stringify(envelopeInput)), envelopeInput.envelopeDigest);
  assertPromptEnvelopePreparedRoleRunV2(envelope, request);
  const descriptor = manifest.artifacts.promptEnvelope;
  if (descriptor === undefined || descriptor.digest !== envelope.envelopeDigest || manifest.capturePolicy !== envelope.capturePolicy ||
      manifest.binding.taskId !== envelope.taskId || manifest.binding.sourceWorkflowRef !== envelope.sourceWorkflowRef || manifest.binding.specRevision !== envelope.specRevision ||
      manifest.binding.generation !== envelope.generation || manifest.binding.role !== envelope.role || manifest.binding.phase !== envelope.phase ||
      manifest.binding.attemptId !== envelope.attemptId || manifest.binding.attemptDigest !== envelope.attemptDigest || manifest.binding.runId !== envelope.runId ||
      manifest.binding.operationId !== envelope.operationId || manifest.binding.requestDigest !== envelope.requestDigest || manifest.binding.runnerKind !== envelope.runnerKind) {
    throw conflict("TRANSCRIPT_PROMPT_ENVELOPE_MISMATCH", "Transcript Manifest does not bind the exact pre-execution Prompt Envelope");
  }
}

export function createLegacyPromptBindingEvidenceV1(input: Omit<LegacyPromptBindingEvidenceV1, "observationMethod" | "evidenceDigest">): LegacyPromptBindingEvidenceV1 {
  const core = {
    executionIntentDigest: shaDigest(input.executionIntentDigest, "executionIntentDigest"),
    instructionsDigest: shaDigest(input.instructionsDigest, "instructionsDigest"),
    providerPromptRecordDigest: shaDigest(input.providerPromptRecordDigest, "providerPromptRecordDigest"),
    recoveredRenderedPromptDigest: shaDigest(input.recoveredRenderedPromptDigest, "recoveredRenderedPromptDigest"),
    observationMethod: "PROVIDER_NATIVE_RECORD" as const,
  };
  return deepFreeze({ ...core, evidenceDigest: digest("legacy-prompt-binding-evidence-v1", core) });
}

export function createHistoricalEnrichmentBaselineV1(input: Omit<HistoricalEnrichmentBaselineV1, "baselineDigest">): HistoricalEnrichmentBaselineV1 {
  const core = {
    taskId: task(input.taskId), sourceWorkflowRef: workflowRef(input.sourceWorkflowRef, "sourceWorkflowRef"), runId: stableId(input.runId, "runId"), roleManifestDigest: shaDigest(input.roleManifestDigest, "roleManifestDigest"),
    workflowProjectionDigest: shaDigest(input.workflowProjectionDigest, "workflowProjectionDigest"),
    domainEventHistoryDigest: shaDigest(input.domainEventHistoryDigest, "domainEventHistoryDigest"),
    roleManifestSnapshotDigest: shaDigest(input.roleManifestSnapshotDigest, "roleManifestSnapshotDigest"),
    outcome: enumeration(input.outcome, ["SUCCEEDED", "FAILED_TERMINAL", "CANCELLED"] as const, "outcome"),
    archiveStatus: literal(input.archiveStatus, "ARCHIVED", "archiveStatus"),
    observedAt: instant(input.observedAt, "observedAt"),
  };
  return deepFreeze({ ...core, baselineDigest: digest("historical-enrichment-baseline-v1", core) });
}

export function createSessionTranscriptImportReceiptV1(input: Omit<SessionTranscriptImportReceiptV1, "schemaVersion" | "artifactKind" | "authorityScope" | "binding" | "promptEnvelope" | "manifest" | "legacyPromptEvidence" | "historicalBaseline" | "errors" | "receiptDigest"> & {
  readonly binding: SessionEvidenceBindingV1;
  readonly promptEnvelope?: ArtifactDescriptorV1;
  readonly manifest?: ArtifactDescriptorV1;
  readonly legacyPromptEvidence?: LegacyPromptBindingEvidenceV1;
  readonly historicalBaseline?: HistoricalEnrichmentBaselineV1;
  readonly errors: readonly TranscriptCaptureErrorV1[];
}): SessionTranscriptImportReceiptV1 {
  const binding = normalizeBinding(input.binding);
  const captureState = enumeration(input.captureState, ["COMPLETE", "PARTIAL", "UNAVAILABLE", "FAILED"] as const, "captureState");
  const manifest = input.manifest === undefined ? undefined : createArtifactDescriptorV1(input.manifest);
  if ((captureState === "COMPLETE" || captureState === "PARTIAL") !== (manifest !== undefined)) {
    throw conflict("TRANSCRIPT_RECEIPT_MANIFEST_INVALID", "COMPLETE/PARTIAL receipts require a Manifest; UNAVAILABLE/FAILED receipts forbid one");
  }
  const errors = sortCaptureErrors(input.errors.map(normalizeCaptureError));
  if (captureState === "COMPLETE" && errors.length > 0) throw conflict("TRANSCRIPT_COMPLETE_WITH_ERRORS", "COMPLETE Receipt cannot contain errors");
  if (captureState !== "COMPLETE" && errors.length === 0) throw validation("TRANSCRIPT_ERROR_REQUIRED", "Non-complete Receipt requires at least one stable error");
  const captureAttempt = positiveInteger(input.captureAttempt, "captureAttempt");
  if ((captureAttempt > 1) !== (input.predecessorReceiptDigest !== undefined)) {
    throw conflict("TRANSCRIPT_PREDECESSOR_INVALID", "Only capture attempts after the first require predecessorReceiptDigest");
  }
  if (input.reconciledAfterUnknown !== (input.reconcileDecisionDigest !== undefined)) {
    throw conflict("TRANSCRIPT_RECONCILE_EVIDENCE_INVALID", "Reconcile evidence exists exactly when reconciledAfterUnknown is true");
  }
  const promptBinding = enumeration(input.promptBinding, ["PROMPT_ENVELOPE_V1", "PROVIDER_NATIVE_OBSERVED", "UNVERIFIED"] as const, "promptBinding");
  if ((promptBinding === "PROMPT_ENVELOPE_V1") !== (input.promptEnvelope !== undefined)) {
    throw conflict("TRANSCRIPT_PROMPT_BINDING_INVALID", "Only PROMPT_ENVELOPE_V1 receipts require a Prompt Envelope descriptor");
  }
  if (input.importMode === "LIVE" && promptBinding !== "PROMPT_ENVELOPE_V1") {
    throw conflict("TRANSCRIPT_LIVE_PROMPT_REQUIRED", "LIVE capture must bind the pre-execution Prompt Envelope");
  }
  if ((promptBinding === "PROVIDER_NATIVE_OBSERVED") !== (input.legacyPromptEvidence !== undefined)) throw conflict("TRANSCRIPT_LEGACY_PROMPT_EVIDENCE_INVALID", "PROVIDER_NATIVE_OBSERVED requires exact observation evidence; other bindings forbid it");
  const importMode = enumeration(input.importMode, ["LIVE", "HISTORICAL_ENRICHMENT"] as const, "importMode");
  const enrichmentId = stableId(input.enrichmentId, "enrichmentId");
  const owningWorkflowRef = workflowRef(input.workflowRef, "workflowRef");
  if (owningWorkflowRef !== `restate://TranscriptEnrichmentWorkflow/${enrichmentId}`) throw conflict("TRANSCRIPT_WORKFLOW_IDENTITY_MISMATCH", "Receipt Workflow ref must be keyed by enrichmentId");
  if ((importMode === "HISTORICAL_ENRICHMENT") !== (input.historicalBaseline !== undefined)) throw conflict("TRANSCRIPT_HISTORICAL_BASELINE_REQUIRED", "Historical enrichment requires an immutable pre-import baseline; live capture forbids one");
  if ((captureState === "COMPLETE" || captureState === "PARTIAL") && input.sourceDigest === undefined) throw validation("TRANSCRIPT_SOURCE_DIGEST_REQUIRED", "Usable Transcript Receipt requires sourceDigest");
  const historicalBaseline = input.historicalBaseline === undefined ? undefined : parseHistoricalEnrichmentBaselineV1(input.historicalBaseline);
  if (historicalBaseline !== undefined && (historicalBaseline.taskId !== binding.taskId || historicalBaseline.sourceWorkflowRef !== binding.sourceWorkflowRef || historicalBaseline.runId !== binding.runId || historicalBaseline.roleManifestDigest !== binding.roleManifestDigest)) throw conflict("TRANSCRIPT_HISTORICAL_BASELINE_MISMATCH", "Historical baseline must bind the exact Receipt source identity");
  const startedAt = instant(input.startedAt, "startedAt");
  const finishedAt = instant(input.finishedAt, "finishedAt");
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw validation("TRANSCRIPT_TIME_INVALID", "finishedAt precedes startedAt");
  const core = {
    schemaVersion: 1 as const, artifactKind: "SESSION_TRANSCRIPT_IMPORT_RECEIPT" as const,
    enrichmentId, workflowRef: owningWorkflowRef, receiptRef: artifactRef(input.receiptRef, "receiptRef"),
    importMode,
    authorityScope: "DIAGNOSTIC_SUPPLEMENT_ONLY" as const,
    captureOperationId: stableId(input.captureOperationId, "captureOperationId"), captureId: stableId(input.captureId, "captureId"),
    capturePolicy: capturePolicy(input.capturePolicy), parserVersion: requiredString(input.parserVersion, "parserVersion"), parserOptionsDigest: shaDigest(input.parserOptionsDigest, "parserOptionsDigest"),
    captureIntentDigest: shaDigest(input.captureIntentDigest, "captureIntentDigest"), captureAttempt,
    binding, promptBinding,
    ...(input.promptEnvelope === undefined ? {} : { promptEnvelope: createArtifactDescriptorV1(input.promptEnvelope) }),
    ...(input.legacyPromptEvidence === undefined ? {} : { legacyPromptEvidence: parseLegacyPromptBindingEvidenceV1(input.legacyPromptEvidence) }),
    ...(historicalBaseline === undefined ? {} : { historicalBaseline }),
    captureState, ...(manifest === undefined ? {} : { manifest }),
    ...(input.sourceDigest === undefined ? {} : { sourceDigest: shaDigest(input.sourceDigest, "sourceDigest") }),
    errors, reconciledAfterUnknown: booleanValue(input.reconciledAfterUnknown, "reconciledAfterUnknown"),
    ...(input.reconcileDecisionDigest === undefined ? {} : { reconcileDecisionDigest: shaDigest(input.reconcileDecisionDigest, "reconcileDecisionDigest") }),
    ...(input.predecessorReceiptDigest === undefined ? {} : { predecessorReceiptDigest: shaDigest(input.predecessorReceiptDigest, "predecessorReceiptDigest") }),
    startedAt, finishedAt, executorId: stableId(input.executorId, "executorId"),
  };
  return deepFreeze({ ...core, receiptDigest: digest("session-transcript-import-receipt-v1", core) });
}

export function parseSessionTranscriptImportReceiptV1(value: unknown, expectedDigest: string): SessionTranscriptImportReceiptV1 {
  const input = exactRecord(value, "SessionTranscriptImportReceiptV1", ["schemaVersion", "artifactKind", "enrichmentId", "workflowRef", "receiptRef", "importMode", "authorityScope", "captureOperationId", "captureId", "capturePolicy", "parserVersion", "parserOptionsDigest", "captureIntentDigest", "captureAttempt", "binding", "promptBinding", "promptEnvelope", "legacyPromptEvidence", "historicalBaseline", "captureState", "manifest", "sourceDigest", "errors", "reconciledAfterUnknown", "reconcileDecisionDigest", "predecessorReceiptDigest", "startedAt", "finishedAt", "executorId", "receiptDigest"]);
  literal(input["schemaVersion"], 1, "schemaVersion"); literal(input["artifactKind"], "SESSION_TRANSCRIPT_IMPORT_RECEIPT", "artifactKind"); literal(input["authorityScope"], "DIAGNOSTIC_SUPPLEMENT_ONLY", "authorityScope");
  const rebuilt = createSessionTranscriptImportReceiptV1({
    enrichmentId: requiredString(input["enrichmentId"], "enrichmentId"), workflowRef: requiredString(input["workflowRef"], "workflowRef"), receiptRef: requiredString(input["receiptRef"], "receiptRef"),
    importMode: enumeration(input["importMode"], ["LIVE", "HISTORICAL_ENRICHMENT"] as const, "importMode"),
    captureOperationId: requiredString(input["captureOperationId"], "captureOperationId"), captureId: requiredString(input["captureId"], "captureId"), capturePolicy: capturePolicy(input["capturePolicy"]),
    parserVersion: requiredString(input["parserVersion"], "parserVersion"), parserOptionsDigest: shaDigest(input["parserOptionsDigest"], "parserOptionsDigest"), captureIntentDigest: shaDigest(input["captureIntentDigest"], "captureIntentDigest"),
    captureAttempt: positiveInteger(input["captureAttempt"], "captureAttempt"), binding: parseBinding(input["binding"]),
    promptBinding: enumeration(input["promptBinding"], ["PROMPT_ENVELOPE_V1", "PROVIDER_NATIVE_OBSERVED", "UNVERIFIED"] as const, "promptBinding"),
    ...(input["promptEnvelope"] === undefined ? {} : { promptEnvelope: parseArtifactDescriptorV1(input["promptEnvelope"]) }),
    ...(input["legacyPromptEvidence"] === undefined ? {} : { legacyPromptEvidence: parseLegacyPromptBindingEvidenceV1(input["legacyPromptEvidence"]) }),
    ...(input["historicalBaseline"] === undefined ? {} : { historicalBaseline: parseHistoricalEnrichmentBaselineV1(input["historicalBaseline"]) }),
    captureState: enumeration(input["captureState"], ["COMPLETE", "PARTIAL", "UNAVAILABLE", "FAILED"] as const, "captureState"),
    ...(input["manifest"] === undefined ? {} : { manifest: parseArtifactDescriptorV1(input["manifest"]) }),
    ...(input["sourceDigest"] === undefined ? {} : { sourceDigest: shaDigest(input["sourceDigest"], "sourceDigest") }),
    errors: array(input["errors"], "errors").map(parseCaptureError),
    reconciledAfterUnknown: booleanValue(input["reconciledAfterUnknown"], "reconciledAfterUnknown"),
    ...(input["reconcileDecisionDigest"] === undefined ? {} : { reconcileDecisionDigest: shaDigest(input["reconcileDecisionDigest"], "reconcileDecisionDigest") }),
    ...(input["predecessorReceiptDigest"] === undefined ? {} : { predecessorReceiptDigest: shaDigest(input["predecessorReceiptDigest"], "predecessorReceiptDigest") }),
    startedAt: instant(input["startedAt"], "startedAt"), finishedAt: instant(input["finishedAt"], "finishedAt"), executorId: requiredString(input["executorId"], "executorId"),
  });
  assertExactAndDigest(input, rebuilt as unknown as Record<string, unknown>, expectedDigest, "receiptDigest", "SessionTranscriptImportReceiptV1");
  return rebuilt;
}

export function assertTranscriptReceiptManifestV1(receiptInput: SessionTranscriptImportReceiptV1, manifestInput: SessionTranscriptManifestV1): void {
  const receipt = parseSessionTranscriptImportReceiptV1(JSON.parse(JSON.stringify(receiptInput)), receiptInput.receiptDigest);
  const manifest = parseSessionTranscriptManifestV1(JSON.parse(JSON.stringify(manifestInput)), manifestInput.manifestDigest);
  assertSessionEvidenceBindingV1(receipt.binding, manifest.binding);
  if (receipt.manifest?.digest !== manifest.manifestDigest || receipt.captureId !== manifest.captureId || receipt.captureOperationId !== manifest.captureOperationId ||
      receipt.capturePolicy !== manifest.capturePolicy || receipt.parserVersion !== manifest.parser.version || receipt.parserOptionsDigest !== manifest.parser.optionsDigest ||
      receipt.sourceDigest !== manifest.source.sourceDigest || (receipt.captureState === "COMPLETE" ? "COMPLETE" : "PARTIAL") !== manifest.captureState) {
    throw conflict("TRANSCRIPT_RECEIPT_MANIFEST_MISMATCH", "Receipt does not bind the exact parsed Transcript Manifest and source Evidence");
  }
  if (receipt.promptBinding === "PROMPT_ENVELOPE_V1") {
    if (canonical(receipt.promptEnvelope) !== canonical(manifest.artifacts.promptEnvelope)) throw conflict("TRANSCRIPT_RECEIPT_PROMPT_MISMATCH", "Receipt Prompt Envelope differs from the Manifest binding");
  } else if (manifest.artifacts.promptEnvelope !== undefined) {
    throw conflict("TRANSCRIPT_RECEIPT_PROMPT_MISMATCH", "Provider-observed or unverified historical Prompt cannot claim a pre-execution Prompt Envelope Artifact");
  }
  if (canonical(receipt.errors) !== canonical(manifest.errors)) throw conflict("TRANSCRIPT_RECEIPT_ERRORS_MISMATCH", "Receipt errors must equal the parsed Manifest errors");
}

export function assertTranscriptIntentManifestV1(intentInput: SessionTranscriptCaptureIntentV1, manifestInput: SessionTranscriptManifestV1): void {
  const intent = parseSessionTranscriptCaptureIntentV1(JSON.parse(JSON.stringify(intentInput)), intentInput.intentDigest);
  const manifest = parseSessionTranscriptManifestV1(JSON.parse(JSON.stringify(manifestInput)), manifestInput.manifestDigest);
  assertSessionEvidenceBindingV1(intent.binding, manifest.binding);
  if (intent.captureId !== manifest.captureId || intent.captureOperationId !== manifest.captureOperationId || intent.capturePolicy !== manifest.capturePolicy ||
      intent.parser.name !== manifest.parser.name || intent.parser.version !== manifest.parser.version || intent.parser.optionsDigest !== manifest.parser.optionsDigest ||
      intent.sourceLocatorDigest !== manifest.source.locatorDigest || manifest.source.byteLength > intent.maxSourceBytes ||
      intent.expectedNormalizedRef !== manifest.artifacts.normalized.ref || intent.expectedRawRef !== manifest.artifacts.raw?.ref ||
      canonical(intent.promptEnvelope) !== canonical(manifest.artifacts.promptEnvelope)) {
    throw conflict("TRANSCRIPT_INTENT_MANIFEST_MISMATCH", "Transcript Manifest exceeds or differs from the exact fenced Capture Intent");
  }
}

export function createSessionEvidenceBindingFromRoleManifestV2(input: {
  readonly sourceWorkflowRef: string;
  readonly manifest: RoleRunManifestV2;
}): SessionEvidenceBindingV1 {
  const { manifestDigest, evidence: evidenceInput, ...manifestCore } = input.manifest;
  // RoleRunManifestV2 predates this sidecar contract and uses the Role Runtime's
  // NUL-delimited digest namespace. Preserve that exact wire identity here.
  const calculatedManifestDigest = sha256Bytes(`real-role-manifest-v2\0${canonical(manifestCore)}`);
  const evidence = parseRoleRunEvidenceV2(JSON.parse(JSON.stringify(evidenceInput)), evidenceInput.evidenceDigest);
  const mismatches = [
    manifestDigest !== calculatedManifestDigest && "manifestDigest",
    evidence.manifestDigest !== manifestDigest && "evidence.manifestDigest",
    evidence.taskId !== input.manifest.taskId && "evidence.taskId",
    evidence.specRevision !== input.manifest.specRevision && "evidence.specRevision",
    evidence.generation !== input.manifest.generation && "evidence.generation",
    evidence.role !== input.manifest.role && "evidence.role",
    evidence.phase !== input.manifest.phase && "evidence.phase",
    evidence.attemptId !== input.manifest.attemptId && "evidence.attemptId",
    evidence.runId !== input.manifest.runId && "evidence.runId",
    evidence.runnerKind !== input.manifest.runnerKind && "evidence.runnerKind",
    evidence.sessionId !== input.manifest.sessionId && "evidence.sessionId",
    evidence.outcome !== input.manifest.outcome && "evidence.outcome",
    evidence.startedAt !== input.manifest.startedAt && "evidence.startedAt",
    evidence.finishedAt !== input.manifest.finishedAt && "evidence.finishedAt",
    evidence.eventsRef !== input.manifest.eventsRef && "evidence.eventsRef",
    evidence.eventsDigest !== input.manifest.eventsDigest && "evidence.eventsDigest",
    evidence.stderrRef !== input.manifest.stderrRef && "evidence.stderrRef",
    evidence.stderrDigest !== input.manifest.stderrDigest && "evidence.stderrDigest",
    evidence.outputRef !== input.manifest.outputRef && "evidence.outputRef",
    evidence.outputDigest !== input.manifest.outputDigest && "evidence.outputDigest",
    evidence.manifestRef !== input.manifest.manifestRef && "evidence.manifestRef",
    canonical(evidence.artifactRefs) !== canonical(input.manifest.output?.artifactRefs ?? []) && "evidence.artifactRefs",
    canonical(evidence.findingRefs) !== canonical(input.manifest.output?.findingRefs ?? []) && "evidence.findingRefs",
  ].filter((field): field is string => field !== false);
  if (mismatches.length > 0) {
    throw conflict("SESSION_ROLE_MANIFEST_INTEGRITY_FAILED", `Session binding requires a canonical, internally consistent RoleRunManifestV2; mismatched: ${mismatches.join(", ")}`);
  }
  if (input.manifest.sessionId === undefined) throw conflict("SESSION_ROLE_MANIFEST_SESSION_MISSING", "Role Manifest must contain a confirmed Provider Session ID before Transcript capture");
  return normalizeBinding({
    taskId: input.manifest.taskId, sourceWorkflowRef: input.sourceWorkflowRef, specRevision: input.manifest.specRevision, generation: input.manifest.generation,
    role: input.manifest.role, phase: input.manifest.phase, attemptId: input.manifest.attemptId, attemptDigest: input.manifest.attemptDigest,
    runId: input.manifest.runId, operationId: input.manifest.operationId, requestDigest: input.manifest.requestDigest, runnerKind: input.manifest.runnerKind,
    provider: input.manifest.runnerKind === "CODEX_EXEC" ? "CODEX" : "CLAUDE", providerSessionId: input.manifest.sessionId,
    roleManifestRef: input.manifest.manifestRef, roleManifestDigest: input.manifest.manifestDigest,
  });
}

export function createSessionTranscriptCaptureIntentV1(input: Omit<SessionTranscriptCaptureIntentV1, "schemaVersion" | "intentKind" | "captureId" | "captureAttemptId" | "captureOperationId" | "binding" | "promptEnvelope" | "legacyPromptEvidence" | "historicalBaseline" | "intentDigest"> & {
  readonly binding: SessionEvidenceBindingV1;
  readonly promptEnvelope?: ArtifactDescriptorV1;
  readonly legacyPromptEvidence?: LegacyPromptBindingEvidenceV1;
  readonly historicalBaseline?: HistoricalEnrichmentBaselineV1;
}): SessionTranscriptCaptureIntentV1 {
  const binding = normalizeBinding(input.binding);
  const enrichmentId = stableId(input.enrichmentId, "enrichmentId");
  const owningWorkflowRef = workflowRef(input.workflowRef, "workflowRef");
  if (owningWorkflowRef !== `restate://TranscriptEnrichmentWorkflow/${enrichmentId}`) throw conflict("TRANSCRIPT_WORKFLOW_IDENTITY_MISMATCH", "Capture Workflow ref must be keyed by enrichmentId");
  const capturePolicyValue = capturePolicy(input.capturePolicy);
  const parser = { name: requiredString(input.parser.name, "parser.name"), version: requiredString(input.parser.version, "parser.version"), optionsDigest: shaDigest(input.parser.optionsDigest, "parser.optionsDigest") };
  const captureId = sessionTranscriptCaptureIdV1({ binding, parserName: parser.name, parserVersion: parser.version, optionsDigest: parser.optionsDigest, capturePolicy: capturePolicyValue });
  const captureAttempt = positiveInteger(input.captureAttempt, "captureAttempt");
  if ((captureAttempt > 1) !== (input.predecessorReceiptDigest !== undefined)) throw conflict("TRANSCRIPT_PREDECESSOR_INVALID", "Capture attempts after the first require predecessorReceiptDigest");
  const promptBinding = enumeration(input.promptBinding, ["PROMPT_ENVELOPE_V1", "PROVIDER_NATIVE_OBSERVED", "UNVERIFIED"] as const, "promptBinding");
  if ((promptBinding === "PROMPT_ENVELOPE_V1") !== (input.promptEnvelope !== undefined)) throw conflict("TRANSCRIPT_PROMPT_BINDING_INVALID", "Only PROMPT_ENVELOPE_V1 requires a Prompt Envelope descriptor");
  if ((promptBinding === "PROVIDER_NATIVE_OBSERVED") !== (input.legacyPromptEvidence !== undefined)) throw conflict("TRANSCRIPT_LEGACY_PROMPT_EVIDENCE_INVALID", "PROVIDER_NATIVE_OBSERVED requires observation evidence");
  const importMode = enumeration(input.importMode, ["LIVE", "HISTORICAL_ENRICHMENT"] as const, "importMode");
  if (importMode === "LIVE" && promptBinding !== "PROMPT_ENVELOPE_V1") throw conflict("TRANSCRIPT_LIVE_PROMPT_REQUIRED", "LIVE capture requires the pre-execution Prompt Envelope");
  if ((importMode === "HISTORICAL_ENRICHMENT") !== (input.historicalBaseline !== undefined)) throw conflict("TRANSCRIPT_HISTORICAL_BASELINE_REQUIRED", "Historical capture requires its immutable baseline");
  const historicalBaseline = input.historicalBaseline === undefined ? undefined : parseHistoricalEnrichmentBaselineV1(input.historicalBaseline);
  if (historicalBaseline !== undefined && (historicalBaseline.taskId !== binding.taskId || historicalBaseline.sourceWorkflowRef !== binding.sourceWorkflowRef || historicalBaseline.runId !== binding.runId || historicalBaseline.roleManifestDigest !== binding.roleManifestDigest)) {
    throw conflict("TRANSCRIPT_HISTORICAL_BASELINE_MISMATCH", "Historical baseline must bind the exact Task, Workflow, Run, and Role Manifest");
  }
  if ((capturePolicyValue === "full") !== (input.expectedRawRef !== undefined)) throw conflict("TRANSCRIPT_RAW_POLICY_INVALID", "Only full capture has an expected raw Artifact");
  const promptEnvelope = input.promptEnvelope === undefined ? undefined : createArtifactDescriptorV1(input.promptEnvelope);
  const legacyPromptEvidence = input.legacyPromptEvidence === undefined ? undefined : parseLegacyPromptBindingEvidenceV1(input.legacyPromptEvidence);
  const expectedRawRef = input.expectedRawRef === undefined ? undefined : artifactRef(input.expectedRawRef, "expectedRawRef");
  const expectedNormalizedRef = artifactRef(input.expectedNormalizedRef, "expectedNormalizedRef");
  const expectedManifestRef = artifactRef(input.expectedManifestRef, "expectedManifestRef");
  const expectedReceiptRef = artifactRef(input.expectedReceiptRef, "expectedReceiptRef");
  const targetRefs = [promptEnvelope?.ref, expectedRawRef, expectedNormalizedRef, expectedManifestRef, expectedReceiptRef].filter((ref): ref is string => ref !== undefined);
  if (new Set(targetRefs).size !== targetRefs.length) throw conflict("TRANSCRIPT_ARTIFACT_REF_ALIAS", "Prompt and Capture output Artifact refs must be pairwise distinct");
  const sourceLocatorDigest = shaDigest(input.sourceLocatorDigest, "sourceLocatorDigest");
  const maxSourceBytes = positiveInteger(input.maxSourceBytes, "maxSourceBytes");
  const predecessorReceiptDigest = input.predecessorReceiptDigest === undefined ? undefined : shaDigest(input.predecessorReceiptDigest, "predecessorReceiptDigest");
  const captureAttemptId = `${captureId}:attempt:${captureAttempt}:${digest("session-capture-attempt-v1", { enrichmentId, workflowRef: owningWorkflowRef, predecessorReceiptDigest: predecessorReceiptDigest ?? null }).slice(7, 23)}`;
  const effectIdentity = {
    importMode, enrichmentId, workflowRef: owningWorkflowRef, binding, captureId, captureAttempt, captureAttemptId,
    capturePolicy: capturePolicyValue, parser, sourceLocatorDigest, maxSourceBytes, promptBinding,
    promptEnvelope: promptEnvelope ?? null, legacyPromptEvidence: legacyPromptEvidence ?? null, historicalBaseline: historicalBaseline ?? null,
    expectedRawRef: expectedRawRef ?? null, expectedNormalizedRef, expectedManifestRef, expectedReceiptRef,
    predecessorReceiptDigest: predecessorReceiptDigest ?? null,
  };
  const captureOperationId = `session-capture-operation:${digest("session-capture-operation-v1", effectIdentity).slice(7)}`;
  const core = {
    schemaVersion: 1 as const, intentKind: "SESSION_TRANSCRIPT_CAPTURE" as const, importMode, enrichmentId, workflowRef: owningWorkflowRef, captureId, captureAttempt, captureAttemptId, captureOperationId,
    binding, capturePolicy: capturePolicyValue, parser,
    sourceLocatorDigest, maxSourceBytes,
    promptBinding, ...(promptEnvelope === undefined ? {} : { promptEnvelope }),
    ...(legacyPromptEvidence === undefined ? {} : { legacyPromptEvidence }),
    ...(historicalBaseline === undefined ? {} : { historicalBaseline }),
    ...(expectedRawRef === undefined ? {} : { expectedRawRef }), expectedNormalizedRef, expectedManifestRef, expectedReceiptRef,
    ...(predecessorReceiptDigest === undefined ? {} : { predecessorReceiptDigest }),
    requestedAt: instant(input.requestedAt, "requestedAt"),
  };
  return deepFreeze({ ...core, intentDigest: digest("session-transcript-capture-intent-v1", core) });
}

export function markSessionTranscriptCaptureUnknownV1(intentInput: SessionTranscriptCaptureIntentV1, reasonDigestInput: string): SessionTranscriptUnknownEffectV1 {
  const intent = parseSessionTranscriptCaptureIntentV1(JSON.parse(JSON.stringify(intentInput)), intentInput.intentDigest);
  const reasonDigest = shaDigest(reasonDigestInput, "reasonDigest");
  const tokenCore = { captureOperationId: intent.captureOperationId, captureAttemptId: intent.captureAttemptId, intentDigest: intent.intentDigest };
  const core = { captureOperationId: intent.captureOperationId, captureAttemptId: intent.captureAttemptId, reasonDigest, reconcileToken: digest("session-transcript-reconcile-token-v1", tokenCore) };
  return deepFreeze({ ...core, unknownDigest: digest("session-transcript-unknown-effect-v1", core) });
}

export function reconcileSessionTranscriptCaptureV1(intentInput: SessionTranscriptCaptureIntentV1, unknownInput: SessionTranscriptUnknownEffectV1, input: {
  readonly token: string; readonly action: "CONFIRMED" | "NOT_APPLIED"; readonly externalEvidenceDigest: string; readonly manifestDigest?: string;
}): SessionTranscriptReconcileDecisionV1 {
  const intent = parseSessionTranscriptCaptureIntentV1(JSON.parse(JSON.stringify(intentInput)), intentInput.intentDigest);
  const unknown = normalizeUnknownEffect(unknownInput);
  const expected = markSessionTranscriptCaptureUnknownV1(intent, unknown.reasonDigest);
  if (canonical(unknown) !== canonical(expected) || input.token !== expected.reconcileToken) throw conflict("TRANSCRIPT_RECONCILE_SCOPE_INVALID", "Reconcile token or UNKNOWN Effect does not match the pending Capture Attempt");
  const action = enumeration(input.action, ["CONFIRMED", "NOT_APPLIED"] as const, "action");
  if ((action === "CONFIRMED") !== (input.manifestDigest !== undefined)) throw conflict("TRANSCRIPT_RECONCILE_MANIFEST_INVALID", "CONFIRMED requires Manifest Digest and NOT_APPLIED forbids it");
  const core = {
    captureOperationId: intent.captureOperationId, captureAttemptId: intent.captureAttemptId, intentDigest: intent.intentDigest, unknownDigest: unknown.unknownDigest,
    reconcileToken: expected.reconcileToken,
    action, externalEvidenceDigest: shaDigest(input.externalEvidenceDigest, "externalEvidenceDigest"),
    ...(input.manifestDigest === undefined ? {} : { manifestDigest: shaDigest(input.manifestDigest, "manifestDigest") }),
  };
  return deepFreeze({ ...core, decisionDigest: digest("session-transcript-reconcile-decision-v1", core) });
}

export function createSessionEvidenceAuthorityV1(bindingInput: SessionEvidenceBindingV1): SessionEvidenceAuthorityV1 {
  const binding = normalizeBinding(bindingInput);
  return sealSessionEvidenceAuthority({ schemaVersion: 1, authorityKey: `session-evidence:${binding.runId}`, binding, authorityVersion: 0, transitionDigests: [], history: [] });
}

export function claimSessionTranscriptCaptureV1(stateInput: SessionEvidenceAuthorityV1, intentInput: SessionTranscriptCaptureIntentV1, expectedVersion: number): SessionEvidenceAuthorityV1 {
  const state = parseSessionEvidenceAuthorityV1(stateInput, stateInput.stateDigest);
  const intent = parseSessionTranscriptCaptureIntentV1(JSON.parse(JSON.stringify(intentInput)), intentInput.intentDigest);
  assertSessionEvidenceBindingV1(state.binding, intent.binding);
  if (state.activeIntentDigest === intent.intentDigest) return state;
  if (state.authorityVersion !== expectedVersion) throw conflict("SESSION_AUTHORITY_FENCE_REJECTED", "Session Evidence Authority version changed");
  if (state.activeIntentDigest !== undefined) throw conflict("SESSION_CAPTURE_ALREADY_ACTIVE", "Another Capture Intent owns this Session Evidence Authority");
  if (intent.captureAttempt !== state.history.length + 1 || intent.predecessorReceiptDigest !== state.headReceiptDigest) throw conflict("SESSION_CAPTURE_CHAIN_INVALID", "Capture Attempt must append exactly after the Authority head");
  if (state.history.some((entry) => entry.enrichmentId === intent.enrichmentId || entry.workflowRef === intent.workflowRef)) throw conflict("SESSION_CAPTURE_WORKFLOW_REUSED", "A new Capture Attempt requires a unique enrichment Workflow identity");
  const reservedArtifactRefs = new Set(state.history.flatMap((entry) => [entry.rawRef, entry.normalizedRef, entry.manifestRef, entry.receiptRef].filter((ref): ref is string => ref !== undefined)));
  const requestedArtifactRefs = [intent.expectedRawRef, intent.expectedNormalizedRef, intent.expectedManifestRef, intent.expectedReceiptRef].filter((ref): ref is string => ref !== undefined);
  if (requestedArtifactRefs.some((ref) => reservedArtifactRefs.has(ref))) throw conflict("SESSION_CAPTURE_ARTIFACT_REUSED", "A new Capture Attempt cannot reuse any append-only Artifact target from Authority history");
  const last = state.history.at(-1);
  if (last?.captureState === "COMPLETE" && last.captureId === intent.captureId) throw conflict("SESSION_CAPTURE_ALREADY_COMPLETE", "A completed captureId cannot be appended again");
  const activeCapture = {
    intentDigest: intent.intentDigest, enrichmentId: intent.enrichmentId, workflowRef: intent.workflowRef,
    ...(intent.expectedRawRef === undefined ? {} : { expectedRawRef: intent.expectedRawRef }),
    expectedNormalizedRef: intent.expectedNormalizedRef, expectedManifestRef: intent.expectedManifestRef, expectedReceiptRef: intent.expectedReceiptRef,
  };
  return sealSessionEvidenceAuthority({ ...withoutStateDigest(state), authorityVersion: state.authorityVersion + 1, activeIntentDigest: intent.intentDigest, activeCapture, transitionDigests: [...state.transitionDigests, intent.intentDigest] });
}

export function recordSessionTranscriptUnknownV1(stateInput: SessionEvidenceAuthorityV1, intentInput: SessionTranscriptCaptureIntentV1, unknownInput: SessionTranscriptUnknownEffectV1, expectedVersion: number): SessionEvidenceAuthorityV1 {
  const state = parseSessionEvidenceAuthorityV1(stateInput, stateInput.stateDigest);
  const intent = parseSessionTranscriptCaptureIntentV1(JSON.parse(JSON.stringify(intentInput)), intentInput.intentDigest);
  const unknown = normalizeUnknownEffect(unknownInput);
  if (canonical(markSessionTranscriptCaptureUnknownV1(intent, unknown.reasonDigest)) !== canonical(unknown)) throw conflict("TRANSCRIPT_UNKNOWN_INTENT_MISMATCH", "UNKNOWN Effect does not bind the active Capture Intent");
  if (state.pendingUnknown?.unknownDigest === unknown.unknownDigest && state.activeIntentDigest === intent.intentDigest) return state;
  if (state.authorityVersion !== expectedVersion || state.activeIntentDigest !== intent.intentDigest || state.pendingUnknown !== undefined) throw conflict("SESSION_AUTHORITY_FENCE_REJECTED", "UNKNOWN writer does not own the active Capture Intent");
  return sealSessionEvidenceAuthority({ ...withoutStateDigest(state), authorityVersion: state.authorityVersion + 1, pendingUnknown: unknown, transitionDigests: [...state.transitionDigests, unknown.unknownDigest] });
}

export function recordSessionTranscriptReconcileDecisionV1(stateInput: SessionEvidenceAuthorityV1, intentInput: SessionTranscriptCaptureIntentV1, decisionInput: SessionTranscriptReconcileDecisionV1, expectedVersion: number): SessionEvidenceAuthorityV1 {
  const state = parseSessionEvidenceAuthorityV1(stateInput, stateInput.stateDigest);
  const intent = parseSessionTranscriptCaptureIntentV1(JSON.parse(JSON.stringify(intentInput)), intentInput.intentDigest);
  const decision = normalizeReconcileDecision(decisionInput);
  if (state.reconcileDecision?.decisionDigest === decision.decisionDigest && state.activeIntentDigest === intent.intentDigest) return state;
  if (state.authorityVersion !== expectedVersion || state.activeIntentDigest !== intent.intentDigest || state.pendingUnknown === undefined || state.reconcileDecision !== undefined) throw conflict("SESSION_AUTHORITY_FENCE_REJECTED", "Reconcile writer does not own one pending UNKNOWN Capture");
  if (decision.intentDigest !== intent.intentDigest || decision.unknownDigest !== state.pendingUnknown.unknownDigest || decision.captureAttemptId !== intent.captureAttemptId || decision.captureOperationId !== intent.captureOperationId || decision.reconcileToken !== state.pendingUnknown.reconcileToken) throw conflict("TRANSCRIPT_RECONCILE_SCOPE_INVALID", "Decision does not bind the Authority's pending UNKNOWN Capture and token proof");
  return sealSessionEvidenceAuthority({ ...withoutStateDigest(state), authorityVersion: state.authorityVersion + 1, reconcileDecision: decision, transitionDigests: [...state.transitionDigests, decision.decisionDigest] });
}

export function recordSessionTranscriptReceiptV1(stateInput: SessionEvidenceAuthorityV1, intentInput: SessionTranscriptCaptureIntentV1, receiptInput: SessionTranscriptImportReceiptV1, expectedVersion: number, manifestInput?: SessionTranscriptManifestV1, decisionInput?: SessionTranscriptReconcileDecisionV1): SessionEvidenceAuthorityV1 {
  const state = parseSessionEvidenceAuthorityV1(stateInput, stateInput.stateDigest);
  const intent = parseSessionTranscriptCaptureIntentV1(JSON.parse(JSON.stringify(intentInput)), intentInput.intentDigest);
  const receipt = parseSessionTranscriptImportReceiptV1(JSON.parse(JSON.stringify(receiptInput)), receiptInput.receiptDigest);
  assertSessionEvidenceBindingV1(state.binding, receipt.binding);
  assertReceiptIntentV1(receipt, intent);
  if (state.headReceiptDigest === receipt.receiptDigest && state.activeIntentDigest === undefined) return state;
  if (state.authorityVersion !== expectedVersion) throw conflict("SESSION_AUTHORITY_FENCE_REJECTED", "Session Evidence Authority version changed");
  if (state.activeIntentDigest !== intent.intentDigest) throw conflict("SESSION_AUTHORITY_FENCE_REJECTED", "Receipt writer does not own the active fenced Capture Intent");
  if (receipt.reconciledAfterUnknown) {
    if (decisionInput === undefined || state.reconcileDecision === undefined) throw validation("TRANSCRIPT_RECONCILE_DECISION_REQUIRED", "Reconciled Receipt requires the Authority's token-bound Decision");
    const decision = normalizeReconcileDecision(decisionInput);
    if (canonical(decision) !== canonical(state.reconcileDecision) || receipt.reconcileDecisionDigest !== decision.decisionDigest) throw conflict("TRANSCRIPT_RECONCILE_DECISION_MISMATCH", "Receipt does not bind the Authority's exact Reconcile Decision");
    if (decision.action === "CONFIRMED" && decision.manifestDigest !== receipt.manifest?.digest) throw conflict("TRANSCRIPT_RECONCILE_MANIFEST_MISMATCH", "CONFIRMED Decision must bind the Receipt Manifest");
  } else if (state.pendingUnknown !== undefined || state.reconcileDecision !== undefined || decisionInput !== undefined) {
    throw conflict("TRANSCRIPT_RECONCILE_STATE_UNCONSUMED", "Pending UNKNOWN/Reconcile state must be consumed by an explicitly reconciled Receipt");
  }
  if (receipt.manifest !== undefined) {
    if (manifestInput === undefined) throw validation("TRANSCRIPT_MANIFEST_EVIDENCE_REQUIRED", "Usable Receipt must be recorded with its parsed Manifest Evidence");
    assertTranscriptIntentManifestV1(intent, manifestInput);
    assertTranscriptReceiptManifestV1(receipt, manifestInput);
  }
  const entry = {
    captureAttempt: receipt.captureAttempt, captureOperationId: receipt.captureOperationId, captureId: receipt.captureId, intentDigest: receipt.captureIntentDigest, enrichmentId: receipt.enrichmentId, workflowRef: receipt.workflowRef,
    receiptRef: receipt.receiptRef, receiptDigest: receipt.receiptDigest, captureState: receipt.captureState,
    ...(intent.expectedRawRef === undefined ? {} : { rawRef: intent.expectedRawRef }), normalizedRef: intent.expectedNormalizedRef, manifestRef: intent.expectedManifestRef,
    ...(receipt.predecessorReceiptDigest === undefined ? {} : { predecessorReceiptDigest: receipt.predecessorReceiptDigest }),
    ...(state.pendingUnknown === undefined ? {} : { unknownDigest: state.pendingUnknown.unknownDigest }),
    ...(state.reconcileDecision === undefined ? {} : { reconcileDecisionDigest: state.reconcileDecision.decisionDigest }),
    ...(receipt.manifest === undefined ? {} : { manifestDigest: receipt.manifest.digest }),
  };
  const { activeIntentDigest: _active, activeCapture: _capture, pendingUnknown: _unknown, reconcileDecision: _decision, ...inactiveState } = withoutStateDigest(state);
  return sealSessionEvidenceAuthority({ ...inactiveState, authorityVersion: state.authorityVersion + 1, headReceiptDigest: receipt.receiptDigest, transitionDigests: [...state.transitionDigests, receipt.receiptDigest], history: [...state.history, entry] });
}

export function sessionEvidenceBoardSummaryV1(stateInput: SessionEvidenceAuthorityV1) {
  const state = parseSessionEvidenceAuthorityV1(stateInput, stateInput.stateDigest);
  const latest = state.history.at(-1);
  return deepFreeze({
    runId: state.binding.runId, providerSessionId: state.binding.providerSessionId,
    state: state.activeIntentDigest === undefined ? (latest?.captureState ?? "NOT_REQUESTED") : (state.pendingUnknown !== undefined && state.reconcileDecision === undefined ? "WAITING_RECONCILE" : "PENDING"),
    captureAttempts: state.history.length + (state.activeIntentDigest === undefined ? 0 : 1),
    ...(state.activeCapture === undefined ? {} : { enrichmentId: state.activeCapture.enrichmentId, workflowRef: state.activeCapture.workflowRef, receiptRef: state.activeCapture.expectedReceiptRef, manifestRef: state.activeCapture.expectedManifestRef }),
    ...(state.activeCapture !== undefined || latest === undefined ? {} : { enrichmentId: latest.enrichmentId, workflowRef: latest.workflowRef, receiptRef: latest.receiptRef, ...(latest.manifestRef === undefined ? {} : { manifestRef: latest.manifestRef }) }),
    ...(state.pendingUnknown === undefined ? {} : { unknownDigest: state.pendingUnknown.unknownDigest }),
    ...(state.reconcileDecision === undefined ? {} : { reconcileDecisionDigest: state.reconcileDecision.decisionDigest }),
    ...(state.headReceiptDigest === undefined ? {} : { headReceiptDigest: state.headReceiptDigest }),
    ...(latest?.manifestDigest === undefined ? {} : { manifestDigest: latest.manifestDigest }),
    stateDigest: state.stateDigest,
  });
}

export function parseSessionTranscriptCaptureIntentV1(value: unknown, expectedDigest: string): SessionTranscriptCaptureIntentV1 {
  const input = exactRecord(value, "SessionTranscriptCaptureIntentV1", ["schemaVersion", "intentKind", "importMode", "enrichmentId", "workflowRef", "captureId", "captureAttempt", "captureAttemptId", "captureOperationId", "binding", "capturePolicy", "parser", "sourceLocatorDigest", "maxSourceBytes", "promptBinding", "promptEnvelope", "legacyPromptEvidence", "historicalBaseline", "expectedRawRef", "expectedNormalizedRef", "expectedManifestRef", "expectedReceiptRef", "predecessorReceiptDigest", "requestedAt", "intentDigest"]);
  literal(input["schemaVersion"], 1, "schemaVersion"); literal(input["intentKind"], "SESSION_TRANSCRIPT_CAPTURE", "intentKind");
  const parser = exactRecord(input["parser"], "parser", ["name", "version", "optionsDigest"]);
  const rebuilt = createSessionTranscriptCaptureIntentV1({
    importMode: enumeration(input["importMode"], ["LIVE", "HISTORICAL_ENRICHMENT"] as const, "importMode"), enrichmentId: requiredString(input["enrichmentId"], "enrichmentId"), workflowRef: requiredString(input["workflowRef"], "workflowRef"), captureAttempt: positiveInteger(input["captureAttempt"], "captureAttempt"),
    binding: parseBinding(input["binding"]), capturePolicy: capturePolicy(input["capturePolicy"]),
    parser: { name: requiredString(parser["name"], "parser.name"), version: requiredString(parser["version"], "parser.version"), optionsDigest: shaDigest(parser["optionsDigest"], "parser.optionsDigest") },
    sourceLocatorDigest: shaDigest(input["sourceLocatorDigest"], "sourceLocatorDigest"), maxSourceBytes: positiveInteger(input["maxSourceBytes"], "maxSourceBytes"),
    promptBinding: enumeration(input["promptBinding"], ["PROMPT_ENVELOPE_V1", "PROVIDER_NATIVE_OBSERVED", "UNVERIFIED"] as const, "promptBinding"),
    ...(input["promptEnvelope"] === undefined ? {} : { promptEnvelope: parseArtifactDescriptorV1(input["promptEnvelope"]) }),
    ...(input["legacyPromptEvidence"] === undefined ? {} : { legacyPromptEvidence: parseLegacyPromptBindingEvidenceV1(input["legacyPromptEvidence"]) }),
    ...(input["historicalBaseline"] === undefined ? {} : { historicalBaseline: parseHistoricalEnrichmentBaselineV1(input["historicalBaseline"]) }),
    ...(input["expectedRawRef"] === undefined ? {} : { expectedRawRef: artifactRef(input["expectedRawRef"], "expectedRawRef") }),
    expectedNormalizedRef: artifactRef(input["expectedNormalizedRef"], "expectedNormalizedRef"),
    expectedManifestRef: artifactRef(input["expectedManifestRef"], "expectedManifestRef"), expectedReceiptRef: artifactRef(input["expectedReceiptRef"], "expectedReceiptRef"),
    ...(input["predecessorReceiptDigest"] === undefined ? {} : { predecessorReceiptDigest: shaDigest(input["predecessorReceiptDigest"], "predecessorReceiptDigest") }),
    requestedAt: instant(input["requestedAt"], "requestedAt"),
  });
  assertExactAndDigest(input, rebuilt as unknown as Record<string, unknown>, expectedDigest, "intentDigest", "SessionTranscriptCaptureIntentV1");
  return rebuilt;
}

export function parseSessionEvidenceAuthorityV1(value: unknown, expectedDigest: string): SessionEvidenceAuthorityV1 {
  const input = exactRecord(value, "SessionEvidenceAuthorityV1", ["schemaVersion", "authorityKey", "binding", "authorityVersion", "activeIntentDigest", "activeCapture", "pendingUnknown", "reconcileDecision", "headReceiptDigest", "transitionDigests", "history", "stateDigest"]);
  literal(input["schemaVersion"], 1, "schemaVersion");
  const history = array(input["history"], "history").map((value, index) => {
    const entry = exactRecord(value, `history[${index}]`, ["captureAttempt", "captureOperationId", "captureId", "intentDigest", "enrichmentId", "workflowRef", "receiptRef", "receiptDigest", "captureState", "rawRef", "normalizedRef", "predecessorReceiptDigest", "unknownDigest", "reconcileDecisionDigest", "manifestRef", "manifestDigest"]);
    const captureState = enumeration(entry["captureState"], ["COMPLETE", "PARTIAL", "UNAVAILABLE", "FAILED"] as const, "captureState");
    if ((captureState === "COMPLETE" || captureState === "PARTIAL") !== (entry["manifestDigest"] !== undefined)) throw conflict("SESSION_AUTHORITY_HISTORY_INVALID", "Authority history Manifest presence must match Receipt state");
    if ((entry["unknownDigest"] === undefined) !== (entry["reconcileDecisionDigest"] === undefined)) throw conflict("SESSION_AUTHORITY_HISTORY_INVALID", "Authority history UNKNOWN and Reconcile Decision must appear together");
    const enrichmentId = stableId(entry["enrichmentId"], "enrichmentId");
    const owningWorkflowRef = workflowRef(entry["workflowRef"], "workflowRef");
    if (owningWorkflowRef !== `restate://TranscriptEnrichmentWorkflow/${enrichmentId}`) throw conflict("SESSION_AUTHORITY_HISTORY_INVALID", "Authority history Workflow must be keyed by enrichmentId");
    return deepFreeze({ captureAttempt: positiveInteger(entry["captureAttempt"], "captureAttempt"), captureOperationId: stableId(entry["captureOperationId"], "captureOperationId"), captureId: stableId(entry["captureId"], "captureId"), intentDigest: shaDigest(entry["intentDigest"], "intentDigest"), enrichmentId, workflowRef: owningWorkflowRef, receiptRef: artifactRef(entry["receiptRef"], "receiptRef"), receiptDigest: shaDigest(entry["receiptDigest"], "receiptDigest"), captureState, ...(entry["rawRef"] === undefined ? {} : { rawRef: artifactRef(entry["rawRef"], "rawRef") }), normalizedRef: artifactRef(entry["normalizedRef"], "normalizedRef"), manifestRef: artifactRef(entry["manifestRef"], "manifestRef"), ...(entry["predecessorReceiptDigest"] === undefined ? {} : { predecessorReceiptDigest: shaDigest(entry["predecessorReceiptDigest"], "predecessorReceiptDigest") }), ...(entry["unknownDigest"] === undefined ? {} : { unknownDigest: shaDigest(entry["unknownDigest"], "unknownDigest"), reconcileDecisionDigest: shaDigest(entry["reconcileDecisionDigest"], "reconcileDecisionDigest") }), ...(entry["manifestDigest"] === undefined ? {} : { manifestDigest: shaDigest(entry["manifestDigest"], "manifestDigest") }) });
  });
  history.forEach((entry, index) => {
    if (entry.captureAttempt !== index + 1 || entry.predecessorReceiptDigest !== history[index - 1]?.receiptDigest) throw conflict("SESSION_AUTHORITY_HISTORY_INVALID", "Authority history attempts and predecessor Receipts must form one contiguous chain");
  });
  const historyWorkflowRefs = history.flatMap((entry) => [entry.enrichmentId, entry.workflowRef]);
  const historyArtifactRefs = history.flatMap((entry) => [entry.rawRef, entry.normalizedRef, entry.manifestRef, entry.receiptRef].filter((ref): ref is string => ref !== undefined));
  if (new Set(historyWorkflowRefs).size !== historyWorkflowRefs.length || new Set(historyArtifactRefs).size !== historyArtifactRefs.length) throw conflict("SESSION_AUTHORITY_HISTORY_INVALID", "Authority history Workflow identities and append-only Artifact targets must be globally unique");
  const core = {
    schemaVersion: 1 as const, authorityKey: requiredString(input["authorityKey"], "authorityKey"), binding: parseBinding(input["binding"]),
    authorityVersion: nonNegativeInteger(input["authorityVersion"], "authorityVersion"),
    ...(input["activeIntentDigest"] === undefined ? {} : { activeIntentDigest: shaDigest(input["activeIntentDigest"], "activeIntentDigest") }),
    ...(input["activeCapture"] === undefined ? {} : { activeCapture: parseActiveCaptureLocatorV1(input["activeCapture"]) }),
    ...(input["pendingUnknown"] === undefined ? {} : { pendingUnknown: normalizeUnknownEffect(input["pendingUnknown"] as SessionTranscriptUnknownEffectV1) }),
    ...(input["reconcileDecision"] === undefined ? {} : { reconcileDecision: normalizeReconcileDecision(input["reconcileDecision"] as SessionTranscriptReconcileDecisionV1) }),
    ...(input["headReceiptDigest"] === undefined ? {} : { headReceiptDigest: shaDigest(input["headReceiptDigest"], "headReceiptDigest") }), history,
    transitionDigests: array(input["transitionDigests"], "transitionDigests").map((item) => shaDigest(item, "transitionDigest")),
  };
  const expectedTransitionDigests = history.flatMap((entry) => [entry.intentDigest, ...(entry.unknownDigest === undefined ? [] : [entry.unknownDigest, entry.reconcileDecisionDigest!]), entry.receiptDigest]);
  if (core.activeIntentDigest !== undefined) expectedTransitionDigests.push(core.activeIntentDigest);
  if (core.pendingUnknown !== undefined) expectedTransitionDigests.push(core.pendingUnknown.unknownDigest);
  if (core.reconcileDecision !== undefined) expectedTransitionDigests.push(core.reconcileDecision.decisionDigest);
  const activeArtifactRefs = core.activeCapture === undefined ? [] : [core.activeCapture.expectedRawRef, core.activeCapture.expectedNormalizedRef, core.activeCapture.expectedManifestRef, core.activeCapture.expectedReceiptRef].filter((ref): ref is string => ref !== undefined);
  const activeReusesHistory = core.activeCapture !== undefined && (history.some((entry) => entry.enrichmentId === core.activeCapture!.enrichmentId || entry.workflowRef === core.activeCapture!.workflowRef) || activeArtifactRefs.some((ref) => historyArtifactRefs.includes(ref)));
  if (core.authorityKey !== `session-evidence:${core.binding.runId}` || core.headReceiptDigest !== history.at(-1)?.receiptDigest || core.authorityVersion !== core.transitionDigests.length || canonical(core.transitionDigests) !== canonical(expectedTransitionDigests) ||
      (core.activeIntentDigest === undefined) !== (core.activeCapture === undefined) || core.activeCapture?.intentDigest !== core.activeIntentDigest ||
      activeReusesHistory || (core.reconcileDecision !== undefined && core.pendingUnknown === undefined) || (core.pendingUnknown !== undefined && core.activeIntentDigest === undefined)) throw conflict("SESSION_AUTHORITY_IDENTITY_INVALID", "Authority key/head/version/active locator/pending state and cross-attempt targets must match its fixed Run and append-only journal");
  const rebuilt = sealSessionEvidenceAuthority(core);
  assertExactAndDigest(input, rebuilt as unknown as Record<string, unknown>, expectedDigest, "stateDigest", "SessionEvidenceAuthorityV1");
  return rebuilt;
}

function assertReceiptIntentV1(receipt: SessionTranscriptImportReceiptV1, intent: SessionTranscriptCaptureIntentV1): void {
  assertSessionEvidenceBindingV1(receipt.binding, intent.binding);
  if (receipt.enrichmentId !== intent.enrichmentId || receipt.workflowRef !== intent.workflowRef || receipt.receiptRef !== intent.expectedReceiptRef || receipt.manifest?.ref !== (receipt.manifest === undefined ? undefined : intent.expectedManifestRef) ||
      receipt.captureIntentDigest !== intent.intentDigest || receipt.captureId !== intent.captureId || receipt.captureAttempt !== intent.captureAttempt ||
      receipt.captureOperationId !== intent.captureOperationId || receipt.capturePolicy !== intent.capturePolicy || receipt.parserVersion !== intent.parser.version ||
      receipt.parserOptionsDigest !== intent.parser.optionsDigest || receipt.predecessorReceiptDigest !== intent.predecessorReceiptDigest || receipt.importMode !== intent.importMode ||
      receipt.promptBinding !== intent.promptBinding || canonical(receipt.promptEnvelope) !== canonical(intent.promptEnvelope) ||
      canonical(receipt.legacyPromptEvidence) !== canonical(intent.legacyPromptEvidence) || canonical(receipt.historicalBaseline) !== canonical(intent.historicalBaseline)) {
    throw conflict("TRANSCRIPT_RECEIPT_INTENT_MISMATCH", "Receipt does not bind the exact fenced Capture Intent");
  }
}

function normalizeUnknownEffect(input: SessionTranscriptUnknownEffectV1): SessionTranscriptUnknownEffectV1 {
  const core = {
    captureOperationId: stableId(input.captureOperationId, "captureOperationId"), captureAttemptId: stableId(input.captureAttemptId, "captureAttemptId"),
    reasonDigest: shaDigest(input.reasonDigest, "reasonDigest"), reconcileToken: shaDigest(input.reconcileToken, "reconcileToken"),
  };
  const rebuilt = deepFreeze({ ...core, unknownDigest: digest("session-transcript-unknown-effect-v1", core) });
  if (rebuilt.unknownDigest !== input.unknownDigest) throw conflict("TRANSCRIPT_UNKNOWN_DIGEST_MISMATCH", "UNKNOWN Effect differs from its Digest");
  return rebuilt;
}

function normalizeReconcileDecision(input: SessionTranscriptReconcileDecisionV1): SessionTranscriptReconcileDecisionV1 {
  const core = {
    captureOperationId: stableId(input.captureOperationId, "captureOperationId"), captureAttemptId: stableId(input.captureAttemptId, "captureAttemptId"),
    intentDigest: shaDigest(input.intentDigest, "intentDigest"), unknownDigest: shaDigest(input.unknownDigest, "unknownDigest"), reconcileToken: shaDigest(input.reconcileToken, "reconcileToken"),
    action: enumeration(input.action, ["CONFIRMED", "NOT_APPLIED"] as const, "action"), externalEvidenceDigest: shaDigest(input.externalEvidenceDigest, "externalEvidenceDigest"),
    ...(input.manifestDigest === undefined ? {} : { manifestDigest: shaDigest(input.manifestDigest, "manifestDigest") }),
  };
  if ((core.action === "CONFIRMED") !== (core.manifestDigest !== undefined)) throw conflict("TRANSCRIPT_RECONCILE_MANIFEST_INVALID", "CONFIRMED requires Manifest Digest and NOT_APPLIED forbids it");
  const rebuilt = deepFreeze({ ...core, decisionDigest: digest("session-transcript-reconcile-decision-v1", core) });
  if (rebuilt.decisionDigest !== input.decisionDigest) throw conflict("TRANSCRIPT_RECONCILE_DECISION_DIGEST_MISMATCH", "Reconcile Decision differs from its Digest");
  return rebuilt;
}

function sealSessionEvidenceAuthority(input: Omit<SessionEvidenceAuthorityV1, "stateDigest">): SessionEvidenceAuthorityV1 {
  return deepFreeze({ ...input, stateDigest: digest("session-evidence-authority-v1", input) });
}

function withoutStateDigest(state: SessionEvidenceAuthorityV1): Omit<SessionEvidenceAuthorityV1, "stateDigest"> {
  const { stateDigest: _digest, ...core } = state;
  return core;
}

export function sessionTranscriptCaptureIdV1(input: {
  readonly binding: SessionEvidenceBindingV1;
  readonly parserName: string;
  readonly parserVersion: string;
  readonly optionsDigest: string;
  readonly capturePolicy: SessionCapturePolicyV1;
}): string {
  const identity = {
    binding: normalizeBinding(input.binding), parserName: requiredString(input.parserName, "parserName"),
    parserVersion: requiredString(input.parserVersion, "parserVersion"), optionsDigest: shaDigest(input.optionsDigest, "optionsDigest"),
    capturePolicy: capturePolicy(input.capturePolicy),
  };
  return `session-capture:${digest("session-transcript-capture-identity-v1", identity).slice(7)}`;
}

export function assertSessionEvidenceBindingV1(expected: SessionEvidenceBindingV1, actual: SessionEvidenceBindingV1): void {
  if (canonical(normalizeBinding(expected)) !== canonical(normalizeBinding(actual))) {
    throw conflict("SESSION_EVIDENCE_STALE_BINDING", "Session evidence does not bind the exact Task/Attempt/Revision/Generation/Run/Session");
  }
}

function normalizeBinding(input: SessionEvidenceBindingV1): SessionEvidenceBindingV1 {
  const pre = normalizePreRunBinding(input);
  return deepFreeze({
    ...pre,
    providerSessionId: requiredString(input.providerSessionId, "binding.providerSessionId"),
    roleManifestRef: requiredString(input.roleManifestRef, "binding.roleManifestRef"),
    roleManifestDigest: shaDigest(input.roleManifestDigest, "binding.roleManifestDigest"),
  });
}

function parseBinding(value: unknown): SessionEvidenceBindingV1 {
  const input = exactRecord(value, "SessionEvidenceBindingV1", ["taskId", "sourceWorkflowRef", "specRevision", "generation", "role", "phase", "attemptId", "attemptDigest", "runId", "operationId", "requestDigest", "runnerKind", "provider", "providerSessionId", "roleManifestRef", "roleManifestDigest"]);
  return normalizeBinding({
    ...parsePreRunBinding(input),
    providerSessionId: requiredString(input["providerSessionId"], "binding.providerSessionId"),
    roleManifestRef: requiredString(input["roleManifestRef"], "binding.roleManifestRef"),
    roleManifestDigest: shaDigest(input["roleManifestDigest"], "binding.roleManifestDigest"),
  });
}

function parsePreRunBinding(value: unknown): Omit<SessionEvidenceBindingV1, "providerSessionId" | "roleManifestRef" | "roleManifestDigest"> {
  const input = record(value, "PreRunSessionEvidenceBindingV1");
  return normalizePreRunBinding({
    taskId: requiredString(input["taskId"], "binding.taskId"), sourceWorkflowRef: requiredString(input["sourceWorkflowRef"], "binding.sourceWorkflowRef"),
    specRevision: positiveInteger(input["specRevision"], "binding.specRevision"), generation: nonNegativeInteger(input["generation"], "binding.generation"),
    role: agentRole(input["role"]), phase: rolePhase(input["phase"]), attemptId: requiredString(input["attemptId"], "binding.attemptId"),
    attemptDigest: shaDigest(input["attemptDigest"], "binding.attemptDigest"), runId: requiredString(input["runId"], "binding.runId"), operationId: requiredString(input["operationId"], "binding.operationId"),
    requestDigest: shaDigest(input["requestDigest"], "binding.requestDigest"), runnerKind: runnerKind(input["runnerKind"]),
    provider: sessionProvider(input["provider"]),
  });
}

function normalizePreRunBinding(input: Omit<SessionEvidenceBindingV1, "providerSessionId" | "roleManifestRef" | "roleManifestDigest">) {
  const runner = runnerKind(input.runnerKind);
  const provider = sessionProvider(input.provider);
  if ((runner === "CODEX_EXEC" ? "CODEX" : "CLAUDE") !== provider) {
    throw conflict("SESSION_PROVIDER_RUNNER_MISMATCH", "Session Provider must match the real Role Runner kind");
  }
  const taskId = task(input.taskId);
  const roleValue = agentRole(input.role);
  const phaseValue = rolePhase(input.phase);
  const specRevision = positiveInteger(input.specRevision, "binding.specRevision");
  const generation = nonNegativeInteger(input.generation, "binding.generation");
  const expectedAttemptId = `${taskId}.${phaseValue}.r${specRevision}.g${generation}`;
  if (input.attemptId !== expectedAttemptId) throw conflict("SESSION_ATTEMPT_ID_MISMATCH", `binding.attemptId must equal ${expectedAttemptId}`);
  const allowedPhases: Readonly<Record<AgentRoleV2, readonly RolePhaseV2[]>> = {
    ARCHITECT: ["ARCHITECT"], IMPLEMENTATION: ["IMPLEMENTATION"], DOCUMENTATION: ["DOCUMENTATION"],
    TEST_VERIFICATION: ["TEST_PLAN", "TEST_ASSESSMENT"], REVIEW: ["DESIGN_REVIEW", "FINAL_REVIEW"], OBSERVER_KNOWLEDGE: ["OBSERVER_KNOWLEDGE"],
  };
  if (!allowedPhases[roleValue].includes(phaseValue)) throw conflict("SESSION_ROLE_PHASE_MISMATCH", `${roleValue} cannot execute ${phaseValue}`);
  return deepFreeze({
    taskId, sourceWorkflowRef: owningTaskWorkflowRef(input.sourceWorkflowRef, taskId, "binding.sourceWorkflowRef"),
    specRevision, generation,
    role: roleValue, phase: phaseValue, attemptId: stableId(input.attemptId, "binding.attemptId"),
    attemptDigest: shaDigest(input.attemptDigest, "binding.attemptDigest"), runId: stableId(input.runId, "binding.runId"),
    operationId: stableId(input.operationId, "binding.operationId"), requestDigest: shaDigest(input.requestDigest, "binding.requestDigest"), runnerKind: runner,
    provider,
  });
}

function normalizeCompleteness(input: SessionTranscriptManifestV1["completeness"]): SessionTranscriptManifestV1["completeness"] {
  return deepFreeze({
    prompt: enumeration(input.prompt, ["COMPLETE", "PARTIAL", "UNAVAILABLE", "PROVIDER_OBSERVED", "UNVERIFIED"] as const, "completeness.prompt"),
    messages: enumeration(input.messages, ["COMPLETE", "PARTIAL", "UNAVAILABLE"] as const, "completeness.messages"),
    tools: enumeration(input.tools, ["COMPLETE", "PARTIAL", "UNAVAILABLE", "NOT_EXPOSED"] as const, "completeness.tools"),
    timestamps: enumeration(input.timestamps, ["COMPLETE", "PARTIAL", "UNAVAILABLE"] as const, "completeness.timestamps"),
    hierarchy: enumeration(input.hierarchy, ["COMPLETE", "PARTIAL", "UNAVAILABLE", "NOT_EXPOSED"] as const, "completeness.hierarchy"),
    raw: enumeration(input.raw, ["FULL", "OMITTED_BY_POLICY", "UNAVAILABLE"] as const, "completeness.raw"),
    providerScope: literal(input.providerScope, "PROVIDER_EXPOSED", "completeness.providerScope"),
  });
}

function normalizeCaptureError(input: TranscriptCaptureErrorV1): TranscriptCaptureErrorV1 {
  return deepFreeze({
    code: enumeration(input.code, TRANSCRIPT_ERROR_CODES_V1, "error.code"),
    scope: enumeration(input.scope, ["SOURCE", "PARSER", "ARTIFACT", "RECONCILE", "INTERNAL"] as const, "error.scope"),
    detailDigest: shaDigest(input.detailDigest, "error.detailDigest"),
  });
}

function parseCaptureError(value: unknown): TranscriptCaptureErrorV1 {
  const input = exactRecord(value, "TranscriptCaptureErrorV1", ["code", "scope", "detailDigest"]);
  return normalizeCaptureError({
    code: enumeration(input["code"], TRANSCRIPT_ERROR_CODES_V1, "error.code"),
    scope: enumeration(input["scope"], ["SOURCE", "PARSER", "ARTIFACT", "RECONCILE", "INTERNAL"] as const, "error.scope"),
    detailDigest: shaDigest(input["detailDigest"], "error.detailDigest"),
  });
}

function parseLegacyPromptBindingEvidenceV1(value: unknown): LegacyPromptBindingEvidenceV1 {
  const input = exactRecord(value, "LegacyPromptBindingEvidenceV1", ["executionIntentDigest", "instructionsDigest", "providerPromptRecordDigest", "recoveredRenderedPromptDigest", "observationMethod", "evidenceDigest"]);
  literal(input["observationMethod"], "PROVIDER_NATIVE_RECORD", "observationMethod");
  const rebuilt = createLegacyPromptBindingEvidenceV1({
    executionIntentDigest: shaDigest(input["executionIntentDigest"], "executionIntentDigest"), instructionsDigest: shaDigest(input["instructionsDigest"], "instructionsDigest"),
    providerPromptRecordDigest: shaDigest(input["providerPromptRecordDigest"], "providerPromptRecordDigest"), recoveredRenderedPromptDigest: shaDigest(input["recoveredRenderedPromptDigest"], "recoveredRenderedPromptDigest"),
  });
  assertExactAndDigest(input, rebuilt as unknown as Record<string, unknown>, requiredString(input["evidenceDigest"], "evidenceDigest"), "evidenceDigest", "LegacyPromptBindingEvidenceV1");
  return rebuilt;
}

function parseHistoricalEnrichmentBaselineV1(value: unknown): HistoricalEnrichmentBaselineV1 {
  const input = exactRecord(value, "HistoricalEnrichmentBaselineV1", ["taskId", "sourceWorkflowRef", "runId", "roleManifestDigest", "workflowProjectionDigest", "domainEventHistoryDigest", "roleManifestSnapshotDigest", "outcome", "archiveStatus", "observedAt", "baselineDigest"]);
  const rebuilt = createHistoricalEnrichmentBaselineV1({
    taskId: requiredString(input["taskId"], "taskId"), sourceWorkflowRef: requiredString(input["sourceWorkflowRef"], "sourceWorkflowRef"), runId: requiredString(input["runId"], "runId"), roleManifestDigest: shaDigest(input["roleManifestDigest"], "roleManifestDigest"),
    workflowProjectionDigest: shaDigest(input["workflowProjectionDigest"], "workflowProjectionDigest"), domainEventHistoryDigest: shaDigest(input["domainEventHistoryDigest"], "domainEventHistoryDigest"),
    roleManifestSnapshotDigest: shaDigest(input["roleManifestSnapshotDigest"], "roleManifestSnapshotDigest"), outcome: enumeration(input["outcome"], ["SUCCEEDED", "FAILED_TERMINAL", "CANCELLED"] as const, "outcome"),
    archiveStatus: literal(input["archiveStatus"], "ARCHIVED", "archiveStatus"), observedAt: instant(input["observedAt"], "observedAt"),
  });
  assertExactAndDigest(input, rebuilt as unknown as Record<string, unknown>, requiredString(input["baselineDigest"], "baselineDigest"), "baselineDigest", "HistoricalEnrichmentBaselineV1");
  return rebuilt;
}

function parseActiveCaptureLocatorV1(value: unknown): NonNullable<SessionEvidenceAuthorityV1["activeCapture"]> {
  const input = exactRecord(value, "ActiveSessionCaptureLocatorV1", ["intentDigest", "enrichmentId", "workflowRef", "expectedRawRef", "expectedNormalizedRef", "expectedManifestRef", "expectedReceiptRef"]);
  const enrichmentId = stableId(input["enrichmentId"], "enrichmentId");
  const owningWorkflowRef = workflowRef(input["workflowRef"], "workflowRef");
  if (owningWorkflowRef !== `restate://TranscriptEnrichmentWorkflow/${enrichmentId}`) throw conflict("TRANSCRIPT_WORKFLOW_IDENTITY_MISMATCH", "Active Capture Workflow ref must be keyed by enrichmentId");
  const expectedRawRef = input["expectedRawRef"] === undefined ? undefined : artifactRef(input["expectedRawRef"], "expectedRawRef");
  const expectedNormalizedRef = artifactRef(input["expectedNormalizedRef"], "expectedNormalizedRef");
  const expectedManifestRef = artifactRef(input["expectedManifestRef"], "expectedManifestRef");
  const expectedReceiptRef = artifactRef(input["expectedReceiptRef"], "expectedReceiptRef");
  const refs = [expectedRawRef, expectedNormalizedRef, expectedManifestRef, expectedReceiptRef].filter((ref): ref is string => ref !== undefined);
  if (new Set(refs).size !== refs.length) throw conflict("TRANSCRIPT_ARTIFACT_REF_ALIAS", "Active Capture output Artifact refs must be pairwise distinct");
  return deepFreeze({
    intentDigest: shaDigest(input["intentDigest"], "intentDigest"), enrichmentId, workflowRef: owningWorkflowRef,
    ...(expectedRawRef === undefined ? {} : { expectedRawRef }), expectedNormalizedRef, expectedManifestRef, expectedReceiptRef,
  });
}

function normalizeCorrelation(input: NonNullable<NormalizedTimelineEventV1["correlation"]>) {
  const result = {
    ...(input.toolCallId === undefined ? {} : { toolCallId: requiredString(input.toolCallId, "correlation.toolCallId") }),
    ...(input.parentEventId === undefined ? {} : { parentEventId: requiredString(input.parentEventId, "correlation.parentEventId") }),
    ...(input.parentSessionId === undefined ? {} : { parentSessionId: requiredString(input.parentSessionId, "correlation.parentSessionId") }),
    ...(input.childSessionId === undefined ? {} : { childSessionId: requiredString(input.childSessionId, "correlation.childSessionId") }),
    ...(input.agentId === undefined ? {} : { agentId: requiredString(input.agentId, "correlation.agentId") }),
  };
  if (Object.keys(result).length === 0) throw validation("TIMELINE_CORRELATION_EMPTY", "correlation must contain at least one stable identifier");
  return deepFreeze(result);
}

function parseCorrelation(value: unknown): NonNullable<NormalizedTimelineEventV1["correlation"]> {
  const input = exactRecord(value, "TimelineCorrelationV1", ["toolCallId", "parentEventId", "parentSessionId", "childSessionId", "agentId"]);
  return normalizeCorrelation({
    ...(input["toolCallId"] === undefined ? {} : { toolCallId: requiredString(input["toolCallId"], "correlation.toolCallId") }),
    ...(input["parentEventId"] === undefined ? {} : { parentEventId: requiredString(input["parentEventId"], "correlation.parentEventId") }),
    ...(input["parentSessionId"] === undefined ? {} : { parentSessionId: requiredString(input["parentSessionId"], "correlation.parentSessionId") }),
    ...(input["childSessionId"] === undefined ? {} : { childSessionId: requiredString(input["childSessionId"], "correlation.childSessionId") }),
    ...(input["agentId"] === undefined ? {} : { agentId: requiredString(input["agentId"], "correlation.agentId") }),
  });
}

function parseArtifactDescriptorV1(value: unknown): ArtifactDescriptorV1 {
  const input = exactRecord(value, "ArtifactDescriptorV1", ["ref", "digest", "byteLength", "mediaType"]);
  return createArtifactDescriptorV1({
    ref: requiredString(input["ref"], "artifact.ref"), digest: shaDigest(input["digest"], "artifact.digest"),
    byteLength: nonNegativeInteger(input["byteLength"], "artifact.byteLength"), mediaType: requiredString(input["mediaType"], "artifact.mediaType"),
  });
}

export function parseCapturedContentV1(value: unknown): CapturedContentV1 {
  const content = exactRecord(value, "CapturedContentV1", ["originalDigest", "originalByteLength", "disposition", "storedDigest", "storedByteLength", "storedValue", "redaction", "contentDigest"]);
  const originalDigest = shaDigest(content["originalDigest"], "content.originalDigest");
  const originalByteLength = nonNegativeInteger(content["originalByteLength"], "content.originalByteLength");
  const disposition = enumeration(content["disposition"], ["DIGEST_ONLY", "REDACTED", "FULL"] as const, "content.disposition");
  let core: Omit<CapturedContentV1, "contentDigest">;
  if (disposition === "DIGEST_ONLY") {
    if (content["storedDigest"] !== undefined || content["storedByteLength"] !== undefined || content["storedValue"] !== undefined || content["redaction"] !== undefined) {
      throw validation("SESSION_CONTENT_POLICY_INVALID", "DIGEST_ONLY content forbids stored fields");
    }
    core = { originalDigest, originalByteLength, disposition };
  } else {
    const storedValue = stringValue(content["storedValue"], "content.storedValue");
    const storedDigest = shaDigest(content["storedDigest"], "content.storedDigest");
    const storedByteLength = nonNegativeInteger(content["storedByteLength"], "content.storedByteLength");
    if (sha256Bytes(storedValue) !== storedDigest || Buffer.byteLength(storedValue, "utf8") !== storedByteLength) {
      throw conflict("SESSION_CONTENT_STORED_DIGEST_MISMATCH", "Stored content bytes differ from their Digest or byteLength");
    }
    if (disposition === "FULL") {
      if (content["redaction"] !== undefined || storedDigest !== originalDigest || storedByteLength !== originalByteLength) {
        throw conflict("SESSION_CONTENT_FULL_MISMATCH", "FULL content must preserve exact original Digest and byteLength");
      }
      core = { originalDigest, originalByteLength, disposition, storedDigest, storedByteLength, storedValue };
    } else {
      const redactionValue = record(content["redaction"], "content.redaction");
      core = {
        originalDigest, originalByteLength, disposition, storedDigest, storedByteLength, storedValue,
        redaction: normalizeRedaction({ profile: requiredString(redactionValue["profile"], "redaction.profile"), version: requiredString(redactionValue["version"], "redaction.version"), rulesDigest: shaDigest(redactionValue["rulesDigest"], "redaction.rulesDigest"), matchCount: positiveInteger(redactionValue["matchCount"], "redaction.matchCount") }),
      };
    }
  }
  const rebuilt = deepFreeze({ ...core, contentDigest: digest("captured-content-v1", core) });
  if (shaDigest(content["contentDigest"], "content.contentDigest") !== rebuilt.contentDigest || canonical(content) !== canonical(rebuilt)) {
    throw conflict("SESSION_CONTENT_DIGEST_MISMATCH", "CapturedContent differs from its canonical Digest");
  }
  return rebuilt;
}

function assertExactAndDigest(input: Record<string, unknown>, rebuilt: Record<string, unknown>, expectedDigest: string, digestKey: string, label: string): void {
  const supplied = shaDigest(input[digestKey], digestKey);
  if (supplied !== shaDigest(expectedDigest, "expectedDigest") || supplied !== rebuilt[digestKey]) {
    throw conflict("SESSION_EVIDENCE_DIGEST_MISMATCH", `${label} differs from its expected digest`);
  }
  if (canonical(input) !== canonical(rebuilt)) throw conflict("SESSION_EVIDENCE_CANONICAL_MISMATCH", `${label} is not canonical or was tampered with`);
}

function normalizeRedaction(input: RedactionMetadataV1): RedactionMetadataV1 {
  return deepFreeze({ profile: requiredString(input.profile, "redaction.profile"), version: requiredString(input.version, "redaction.version"), rulesDigest: shaDigest(input.rulesDigest, "redaction.rulesDigest"), matchCount: positiveInteger(input.matchCount, "redaction.matchCount") });
}

function sortedUniqueStrings(values: readonly string[], name: string): readonly string[] {
  const normalized = values.map((value, index) => requiredString(value, `${name}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw validation("SESSION_DUPLICATE_VALUE", `${name} must not contain duplicates`);
  return deepFreeze([...normalized].sort());
}

function uniqueEnums<T extends string>(values: readonly T[], allowed: readonly T[], name: string): readonly T[] {
  const normalized = values.map((value, index) => enumeration(value, allowed, `${name}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw validation("SESSION_DUPLICATE_VALUE", `${name} must not contain duplicates`);
  return deepFreeze([...normalized]);
}

function sortCaptureErrors(values: readonly TranscriptCaptureErrorV1[]): readonly TranscriptCaptureErrorV1[] {
  const keyed = values.map((value) => [canonical(value), value] as const).sort(([a], [b]) => a.localeCompare(b));
  if (new Set(keyed.map(([key]) => key)).size !== keyed.length) throw validation("SESSION_DUPLICATE_VALUE", "Transcript errors must not contain duplicates");
  return deepFreeze(keyed.map(([, value]) => value));
}

function contentDispositionForPolicy(policy: SessionCapturePolicyV1): ContentDispositionV1 {
  if (policy === "digest_only") return "DIGEST_ONLY";
  if (policy === "redacted") return "REDACTED";
  return "FULL";
}

function assertTimelineClassification(category: TimelineCategoryV1, actor: TimelineActorV1, origin: TimelineOriginV1, parts: readonly NormalizedTimelinePartV1[]): void {
  const allowed: Readonly<Record<TimelineCategoryV1, readonly [readonly TimelineActorV1[], readonly TimelineOriginV1[], readonly TimelinePartKindV1[]]>> = {
    PROMPT: [["USER"], ["MOYE_RENDERED_PROMPT"], ["TEXT", "JSON"]],
    USER: [["USER"], ["PROVIDER_USER"], ["TEXT", "JSON"]],
    ASSISTANT: [["ASSISTANT"], ["PROVIDER_ASSISTANT"], ["TEXT", "PROVIDER_EXPOSED_THINKING", "JSON"]],
    TOOL_CALL: [["ASSISTANT"], ["PROVIDER_ASSISTANT", "PROVIDER_TOOL"], ["TOOL_CALL", "JSON"]],
    TOOL_RESULT: [["TOOL"], ["PROVIDER_TOOL"], ["TOOL_RESULT", "TEXT", "JSON"]],
    SYSTEM: [["SYSTEM"], ["PROVIDER_SYSTEM"], ["TEXT", "JSON"]],
    ERROR: [["SYSTEM", "RUNTIME", "UNKNOWN"], ["PROVIDER_SYSTEM", "MOYE_RUNTIME", "UNKNOWN"], ["TEXT", "JSON", "UNKNOWN"]],
    STDERR: [["RUNTIME"], ["MOYE_RUNTIME"], ["TEXT"]],
    OTHER: [["UNKNOWN", "SYSTEM", "RUNTIME"], ["UNKNOWN", "PROVIDER_SYSTEM", "MOYE_RUNTIME"], ["UNKNOWN", "TEXT", "JSON"]],
  };
  const [actors, origins, partKinds] = allowed[category];
  if (!actors.includes(actor) || !origins.includes(origin) || parts.length === 0 || parts.some((part) => !partKinds.includes(part.kind))) {
    throw conflict("TIMELINE_CLASSIFICATION_INVALID", `${category}/${actor}/${origin} does not satisfy the normalized Timeline classification contract`);
  }
  if (category === "TOOL_CALL" && !parts.some((part) => part.kind === "TOOL_CALL")) throw conflict("TIMELINE_CLASSIFICATION_INVALID", "TOOL_CALL Event requires a TOOL_CALL part");
  if (category === "TOOL_RESULT" && !parts.some((part) => part.kind === "TOOL_RESULT")) throw conflict("TIMELINE_CLASSIFICATION_INVALID", "TOOL_RESULT Event requires a TOOL_RESULT part");
}

function assertRolePhaseAndPermission(roleValue: AgentRoleV2, phaseValue: RolePhaseV2, permissionValue: RolePermission): void {
  const phases: Readonly<Record<AgentRoleV2, readonly RolePhaseV2[]>> = {
    ARCHITECT: ["ARCHITECT"], IMPLEMENTATION: ["IMPLEMENTATION"], DOCUMENTATION: ["DOCUMENTATION"],
    TEST_VERIFICATION: ["TEST_PLAN", "TEST_ASSESSMENT"], REVIEW: ["DESIGN_REVIEW", "FINAL_REVIEW"], OBSERVER_KNOWLEDGE: ["OBSERVER_KNOWLEDGE"],
  };
  if (!phases[roleValue].includes(phaseValue)) throw conflict("SESSION_ROLE_PHASE_MISMATCH", `${roleValue} cannot execute ${phaseValue}`);
  const expectedPermission: RolePermission = roleValue === "IMPLEMENTATION" || roleValue === "DOCUMENTATION" ? "WORKSPACE_WRITE" : "READ_ONLY";
  if (permissionValue !== expectedPermission) throw conflict("SESSION_ROLE_PERMISSION_MISMATCH", `${roleValue} requires ${expectedPermission}`);
}

function task(value: string): string { assertTaskId(value); return value; }
function capturePolicy(value: unknown): SessionCapturePolicyV1 { return enumeration(value, SESSION_CAPTURE_POLICIES_V1, "capturePolicy"); }
function sessionProvider(value: unknown): SessionProviderV1 { return enumeration(value, SESSION_PROVIDERS_V1, "provider"); }
function runnerKind(value: unknown): RealRoleRunnerKind { return enumeration(value, ["CODEX_EXEC", "CLAUDE_PRINT"] as const, "runnerKind"); }
function agentRole(value: unknown): AgentRoleV2 { return enumeration(value, ["ARCHITECT", "IMPLEMENTATION", "DOCUMENTATION", "TEST_VERIFICATION", "REVIEW", "OBSERVER_KNOWLEDGE"] as const, "role"); }
function rolePhase(value: unknown): RolePhaseV2 { return enumeration(value, ["ARCHITECT", "IMPLEMENTATION", "DOCUMENTATION", "TEST_PLAN", "TEST_ASSESSMENT", "DESIGN_REVIEW", "FINAL_REVIEW", "OBSERVER_KNOWLEDGE"] as const, "phase"); }
function shaDigest(value: unknown, name: string): string { const text = requiredString(value, name); if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw validation("SESSION_SHA_INVALID", `${name} must be a sha256 digest`); return text; }
function commitId(value: unknown, name: string): string { const text = requiredString(value, name); if (!/^[a-f0-9]{40}$/.test(text)) throw validation("SESSION_COMMIT_INVALID", `${name} must be a 40-character Git commit`); return text; }
function stableId(value: unknown, name: string): string { const text = requiredString(value, name); if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/.test(text)) throw validation("SESSION_ID_INVALID", `${name} is not a stable identifier`); return text; }
function instant(value: unknown, name: string): string { const text = requiredString(value, name); const epoch = Date.parse(text); if (Number.isNaN(epoch)) throw validation("SESSION_TIME_INVALID", `${name} must be an ISO timestamp`); return new Date(epoch).toISOString(); }
function positiveInteger(value: unknown, name: string): number { if (!Number.isInteger(value) || Number(value) < 1) throw validation("SESSION_NUMBER_INVALID", `${name} must be a positive integer`); return Number(value); }
function nonNegativeInteger(value: unknown, name: string): number { if (!Number.isInteger(value) || Number(value) < 0) throw validation("SESSION_NUMBER_INVALID", `${name} must be a non-negative integer`); return Number(value); }
function stringValue(value: unknown, name: string): string { if (typeof value !== "string") throw validation("SESSION_STRING_INVALID", `${name} must be a string`); return value; }
function requiredString(value: unknown, name: string): string { const text = stringValue(value, name); if (text.trim().length === 0 || text.includes("\0")) throw validation("SESSION_STRING_REQUIRED", `${name} is required and cannot contain NUL`); return text; }
function workflowRef(value: unknown, name: string): string { const text = requiredString(value, name); if (!/^restate:\/\/[A-Z][A-Za-z0-9]+\/[A-Za-z0-9._:/-]+$/.test(text)) throw validation("SESSION_WORKFLOW_REF_INVALID", `${name} must use the repository's canonical restate://Service/key format`); return text; }
function owningTaskWorkflowRef(value: unknown, taskId: string, name: string): string {
  const text = workflowRef(value, name);
  const match = /^restate:\/\/(SealedTaskWorkflow|CoreV2Workflow)\/(.+)$/.exec(text);
  if (match === null || match[2] !== taskId) throw conflict("SESSION_WORKFLOW_TASK_MISMATCH", `${name} must identify the owning SealedTaskWorkflow or CoreV2Workflow keyed by ${taskId}`);
  return text;
}
function artifactRef(value: unknown, name: string): string { const text = requiredString(value, name); if (!/^(artifact|moye-artifact):\/\/[A-Za-z0-9._~:/%-]+$/.test(text)) throw validation("SESSION_ARTIFACT_REF_INVALID", `${name} must be a managed Artifact URI`); return text; }
function enumeration<T extends string>(value: unknown, allowed: readonly T[], name: string): T { if (typeof value !== "string" || !allowed.includes(value as T)) throw validation("SESSION_ENUM_INVALID", `${name} must be one of ${allowed.join(", ")}`); return value as T; }
function literal<T extends string | number>(value: unknown, expected: T, name: string): T { if (value !== expected) throw validation("SESSION_LITERAL_INVALID", `${name} must equal ${String(expected)}`); return expected; }
function record(value: unknown, name: string): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw validation("SESSION_OBJECT_INVALID", `${name} must be an object`); return value as Record<string, unknown>; }
function exactRecord(value: unknown, name: string, keys: readonly string[]): Record<string, unknown> { const result = record(value, name); const extras = Object.keys(result).filter((key) => !keys.includes(key)); if (extras.length > 0) throw validation("SESSION_UNKNOWN_FIELD", `${name} has unknown fields: ${extras.join(", ")}`); return result; }
function array(value: unknown, name: string): unknown[] { if (!Array.isArray(value)) throw validation("SESSION_ARRAY_INVALID", `${name} must be an array`); return value; }
function booleanValue(value: unknown, name: string): boolean { if (typeof value !== "boolean") throw validation("SESSION_BOOLEAN_INVALID", `${name} must be a boolean`); return value; }
function sha256Bytes(value: string): string { return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`; }
function digest(namespace: string, value: unknown): string { return sha256Bytes(`${namespace}:${canonical(value)}`); }
function canonical(value: unknown): string { return JSON.stringify(sortJson(value)); }
function sortJson(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortJson); if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortJson(item)])); return value; }
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); } return value; }
function validation(code: string, message: string): MoyeError { return new MoyeError({ code, category: "VALIDATION", message }); }
function conflict(code: string, message: string): MoyeError { return new MoyeError({ code, category: "CONFLICT", message }); }
