import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CODEX_SESSION_PARSER_V1,
  CodexNativeSessionAdapterV1,
  codexSessionSourceLocatorDigestV1,
  inspectManagedCodexSessionV1,
} from "./codex-session-adapter.js";
import {
  CLAUDE_SESSION_PARSER_V1,
  ClaudeNativeSessionAdapterV1,
  claudeSessionSourceLocatorDigestV1,
  inspectManagedClaudeSessionV1,
} from "./claude-session-adapter.js";
import type { PreparedRealRoleRunV2, RoleRunManifestV2 } from "./role-runtime-v2.js";
import { MoyeError } from "../domain/errors.js";
import {
  advanceActiveRoleRunLocatorV1,
  assertPromptEnvelopePreparedRoleRunV2,
  claimSessionTranscriptCaptureV1,
  createActiveRoleRunLocatorV1,
  createArtifactDescriptorV1,
  createPromptEnvelopeV1,
  createSessionEvidenceAuthorityV1,
  createSessionEvidenceBindingFromRoleManifestV2,
  createSessionTranscriptCaptureIntentV1,
  createSessionTranscriptImportReceiptV1,
  parseSessionTranscriptCaptureIntentV1,
  parseSessionTranscriptImportReceiptV1,
  recordSessionTranscriptReceiptV1,
  sessionEvidenceBoardSummaryV1,
} from "../domain/session-transcript.js";
import type {
  ActiveRoleRunLocatorV1,
  ArtifactDescriptorV1,
  HistoricalEnrichmentBaselineV1,
  LegacyPromptBindingEvidenceV1,
  PromptEnvelopeV1,
  SessionCapturePolicyV1,
  SessionEvidenceAuthorityV1,
  SessionTranscriptCaptureIntentV1,
  SessionTranscriptImportReceiptV1,
  SessionTranscriptManifestV1,
} from "../domain/session-transcript.js";
import { renderRoleAgentPromptV2 } from "../domain/role-runtime-v2.js";

export interface LiveSessionCaptureConfigV1 {
  readonly capturePolicy: SessionCapturePolicyV1;
  readonly codexSessionsRoot?: string;
  readonly claudeProjectsRoot?: string;
  readonly maxSourceBytes?: number;
}

export interface PreparedLiveRoleSessionEvidenceV1 {
  readonly promptEnvelope: PromptEnvelopeV1;
  readonly promptEnvelopeDescriptor: ArtifactDescriptorV1;
  readonly locator: ActiveRoleRunLocatorV1;
  readonly promptEnvelopePath: string;
}

export interface LiveSessionCaptureResultV1 {
  readonly recovery: "EXECUTED" | "RECOVERED_MANIFEST" | "REUSED_RECEIPT";
  readonly intent: SessionTranscriptCaptureIntentV1;
  readonly manifest: SessionTranscriptManifestV1;
  readonly receipt: SessionTranscriptImportReceiptV1;
  readonly authority: SessionEvidenceAuthorityV1;
  readonly summary: ReturnType<typeof sessionEvidenceBoardSummaryV1>;
}

export interface HistoricalSessionCaptureResultV1 {
  readonly recovery: "EXECUTED" | "RECOVERED_MANIFEST" | "REUSED_RECEIPT" | "RECORDED_UNAVAILABLE";
  readonly intent: SessionTranscriptCaptureIntentV1;
  readonly manifest?: SessionTranscriptManifestV1;
  readonly receipt: SessionTranscriptImportReceiptV1;
}

export interface HistoricalSessionCaptureInputV1 {
  readonly enrichmentId: string;
  readonly sourceWorkflowRef: string;
  readonly roleManifest: RoleRunManifestV2;
  readonly historicalBaseline: HistoricalEnrichmentBaselineV1;
  readonly captureAttempt: number;
  readonly predecessorReceiptDigest?: string;
  readonly promptBinding: "PROVIDER_NATIVE_OBSERVED" | "UNVERIFIED";
  readonly legacyPromptEvidence?: LegacyPromptBindingEvidenceV1;
  readonly managedArtifactRoot: string;
  readonly config: LiveSessionCaptureConfigV1;
  readonly requestedAt: string;
  readonly capturedAt: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly executorId: string;
  readonly preparedIntent?: SessionTranscriptCaptureIntentV1;
}

export function prepareHistoricalRoleSessionCaptureV1(input: HistoricalSessionCaptureInputV1): SessionTranscriptCaptureIntentV1 {
  const binding = createSessionEvidenceBindingFromRoleManifestV2({
    sourceWorkflowRef: input.sourceWorkflowRef,
    manifest: input.roleManifest,
  });
  const parser = binding.provider === "CODEX" ? CODEX_SESSION_PARSER_V1 : CLAUDE_SESSION_PARSER_V1;
  const sourceLocatorDigest = binding.provider === "CODEX"
    ? codexSessionSourceLocatorDigestV1(binding.providerSessionId)
    : claudeSessionSourceLocatorDigestV1(binding.providerSessionId);
  const artifactPrefix = `artifact://session-transcript/${input.enrichmentId}`;
  return createSessionTranscriptCaptureIntentV1({
    importMode: "HISTORICAL_ENRICHMENT",
    enrichmentId: input.enrichmentId,
    workflowRef: `restate://TranscriptEnrichmentWorkflow/${input.enrichmentId}`,
    captureAttempt: input.captureAttempt,
    binding,
    capturePolicy: input.config.capturePolicy,
    parser,
    sourceLocatorDigest,
    maxSourceBytes: input.config.maxSourceBytes ?? 64 * 1024 * 1024,
    promptBinding: input.promptBinding,
    ...(input.legacyPromptEvidence === undefined ? {} : { legacyPromptEvidence: input.legacyPromptEvidence }),
    historicalBaseline: input.historicalBaseline,
    ...(input.config.capturePolicy === "full" ? { expectedRawRef: `${artifactPrefix}/raw.jsonl` } : {}),
    expectedNormalizedRef: `${artifactPrefix}/normalized.jsonl`,
    expectedManifestRef: `${artifactPrefix}/manifest.json`,
    expectedReceiptRef: `${artifactPrefix}/receipt.json`,
    ...(input.predecessorReceiptDigest === undefined ? {} : { predecessorReceiptDigest: input.predecessorReceiptDigest }),
    requestedAt: input.requestedAt,
  });
}

export async function captureHistoricalRoleSessionV1(input: HistoricalSessionCaptureInputV1): Promise<HistoricalSessionCaptureResultV1> {
  const binding = createSessionEvidenceBindingFromRoleManifestV2({
    sourceWorkflowRef: input.sourceWorkflowRef,
    manifest: input.roleManifest,
  });
  const expectedIntent = prepareHistoricalRoleSessionCaptureV1(input);
  const intent = input.preparedIntent === undefined
    ? expectedIntent
    : parseSessionTranscriptCaptureIntentV1(input.preparedIntent, input.preparedIntent.intentDigest);
  if (intent.intentDigest !== expectedIntent.intentDigest) {
    throw conflict("SESSION_PREPARED_INTENT_MISMATCH", "Prepared historical Capture Intent does not match the execution input");
  }
  const operationRoot = path.join(path.resolve(input.managedArtifactRoot), `operation-${sha256(intent.captureOperationId).slice(7)}`);
  await mkdir(operationRoot, { recursive: true });
  await writeContentChecked(path.join(operationRoot, "capture-intent.json"), Buffer.from(`${stableJson(intent)}\n`, "utf8"));
  const receiptPath = path.join(operationRoot, "capture-receipt.json");
  const existingReceipt = await readJsonIfPresent(receiptPath);
  if (existingReceipt !== undefined) {
    const receiptDigest = requiredString((existingReceipt as Record<string, unknown>)["receiptDigest"], "receiptDigest");
    const receipt = parseSessionTranscriptImportReceiptV1(existingReceipt, receiptDigest);
    if (receipt.captureIntentDigest !== intent.intentDigest) {
      throw conflict("SESSION_RECEIPT_INTENT_CONFLICT", "Existing historical Receipt belongs to a different Capture Intent");
    }
    if (receipt.manifest === undefined) return Object.freeze({ recovery: "REUSED_RECEIPT", intent, receipt });
    const managed = await inspectManaged(binding.provider, input.managedArtifactRoot, intent.captureId);
    if (managed === null || managed.manifest.manifestDigest !== receipt.manifest.digest) {
      throw conflict("SESSION_RECEIPT_WITHOUT_MANIFEST", "Historical Receipt exists but its managed Manifest is missing or changed");
    }
    return Object.freeze({ recovery: "REUSED_RECEIPT", intent, manifest: managed.manifest, receipt });
  }

  let managed = await inspectManaged(binding.provider, input.managedArtifactRoot, intent.captureId);
  let recovery: HistoricalSessionCaptureResultV1["recovery"] = "RECOVERED_MANIFEST";
  if (managed === null) {
    try {
      const providerSessionsRoot = binding.provider === "CODEX"
        ? requiredString(input.config.codexSessionsRoot, "codexSessionsRoot")
        : requiredString(input.config.claudeProjectsRoot, "claudeProjectsRoot");
      const captured = binding.provider === "CODEX"
        ? await new CodexNativeSessionAdapterV1({ providerSessionsRoot, managedArtifactRoot: input.managedArtifactRoot })
          .capture({ intent, capturedAt: input.capturedAt })
        : await new ClaudeNativeSessionAdapterV1({ providerSessionsRoot, managedArtifactRoot: input.managedArtifactRoot })
          .capture({ intent, capturedAt: input.capturedAt });
      managed = { manifest: captured.manifest, timeline: captured.timeline };
      recovery = "EXECUTED";
    } catch (error) {
      const failure = transcriptFailure(error);
      const receipt = historicalReceipt(input, intent, binding, {
        captureState: failure.state,
        errors: [{ code: failure.code, scope: failure.scope, detailDigest: sha256(failure.detail) }],
      });
      await writeContentChecked(receiptPath, Buffer.from(`${stableJson(receipt)}\n`, "utf8"));
      return Object.freeze({ recovery: "RECORDED_UNAVAILABLE", intent, receipt });
    }
  }
  const manifestPath = managedManifestPath(input.managedArtifactRoot, intent.captureId);
  const receipt = historicalReceipt(input, intent, binding, {
    captureState: managed.manifest.captureState,
    manifest: createArtifactDescriptorV1({
      ref: intent.expectedManifestRef,
      digest: managed.manifest.manifestDigest,
      byteLength: (await stat(manifestPath)).size,
      mediaType: "application/json",
    }),
    sourceDigest: managed.manifest.source.sourceDigest,
    errors: managed.manifest.errors,
  });
  await writeContentChecked(receiptPath, Buffer.from(`${stableJson(receipt)}\n`, "utf8"));
  return Object.freeze({ recovery, intent, manifest: managed.manifest, receipt });
}

function historicalReceipt(
  input: HistoricalSessionCaptureInputV1,
  intent: SessionTranscriptCaptureIntentV1,
  binding: SessionTranscriptCaptureIntentV1["binding"],
  result: Pick<SessionTranscriptImportReceiptV1, "captureState" | "errors"> & {
    readonly manifest?: ArtifactDescriptorV1;
    readonly sourceDigest?: string;
  },
): SessionTranscriptImportReceiptV1 {
  return createSessionTranscriptImportReceiptV1({
    enrichmentId: intent.enrichmentId,
    workflowRef: intent.workflowRef,
    receiptRef: intent.expectedReceiptRef,
    importMode: "HISTORICAL_ENRICHMENT",
    captureOperationId: intent.captureOperationId,
    captureId: intent.captureId,
    capturePolicy: intent.capturePolicy,
    parserVersion: intent.parser.version,
    parserOptionsDigest: intent.parser.optionsDigest,
    captureIntentDigest: intent.intentDigest,
    captureAttempt: intent.captureAttempt,
    binding,
    promptBinding: intent.promptBinding,
    ...(intent.legacyPromptEvidence === undefined ? {} : { legacyPromptEvidence: intent.legacyPromptEvidence }),
    historicalBaseline: input.historicalBaseline,
    captureState: result.captureState,
    ...(result.manifest === undefined ? {} : { manifest: result.manifest }),
    ...(result.sourceDigest === undefined ? {} : { sourceDigest: result.sourceDigest }),
    errors: result.errors,
    reconciledAfterUnknown: false,
    ...(intent.predecessorReceiptDigest === undefined ? {} : { predecessorReceiptDigest: intent.predecessorReceiptDigest }),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    executorId: input.executorId,
  });
}

function transcriptFailure(error: unknown): {
  readonly state: "UNAVAILABLE" | "FAILED";
  readonly code: SessionTranscriptImportReceiptV1["errors"][number]["code"];
  readonly scope: SessionTranscriptImportReceiptV1["errors"][number]["scope"];
  readonly detail: string;
} {
  const code = error instanceof MoyeError && [
    "SOURCE_MISSING", "SOURCE_AMBIGUOUS", "OUTSIDE_ALLOWLIST", "ACCESS_DENIED", "UNSAFE_FILE_TYPE", "TOO_LARGE",
    "SESSION_MISMATCH", "SOURCE_CHANGED", "MALFORMED", "UNSUPPORTED_PROVIDER", "UNSUPPORTED_FORMAT", "PARSER_FAILED",
    "DIGEST_MISMATCH", "ARTIFACT_CONFLICT", "CAPTURE_UNKNOWN", "INTERNAL",
  ].includes(error.code) ? error.code as SessionTranscriptImportReceiptV1["errors"][number]["code"] : "INTERNAL";
  const unavailable = ["SOURCE_MISSING", "SOURCE_AMBIGUOUS", "OUTSIDE_ALLOWLIST", "ACCESS_DENIED", "UNSAFE_FILE_TYPE", "TOO_LARGE"].includes(code);
  return {
    state: unavailable ? "UNAVAILABLE" : "FAILED",
    code,
    scope: ["SOURCE_MISSING", "SOURCE_AMBIGUOUS", "OUTSIDE_ALLOWLIST", "ACCESS_DENIED", "UNSAFE_FILE_TYPE", "TOO_LARGE", "SESSION_MISMATCH", "SOURCE_CHANGED"].includes(code) ? "SOURCE" : code === "ARTIFACT_CONFLICT" ? "ARTIFACT" : code === "INTERNAL" ? "INTERNAL" : "PARSER",
    detail: error instanceof Error ? error.message : String(error),
  };
}

export async function prepareLiveRoleSessionEvidenceV1(input: {
  readonly request: PreparedRealRoleRunV2;
  readonly sourceWorkflowRef: string;
  readonly capturePolicy: SessionCapturePolicyV1;
  readonly createdAt: string;
}): Promise<PreparedLiveRoleSessionEvidenceV1> {
  const request = input.request;
  const segments = [
    { ordinal: 0, kind: "MOYE_CONTROL" as const, value: `You are the ${request.attempt.role}/${request.attempt.phase} Agent for a real Moye Task.` },
    { ordinal: 1, kind: "ROLE_INSTRUCTIONS" as const, value: request.instructions },
    { ordinal: 2, kind: "PERMISSION_BOUNDARY" as const, value: `Permission boundary: ${request.attempt.permission}.` },
    { ordinal: 3, kind: "OUTPUT_CONTRACT" as const, value: "Return only the required structured output. Do not claim artifacts or findings that do not exist." },
  ];
  const renderedPrompt = renderRoleAgentPromptV2({
    role: request.attempt.role,
    phase: request.attempt.phase,
    instructions: request.instructions,
    permission: request.attempt.permission,
  });
  const promptEnvelope = createPromptEnvelopeV1({
    taskId: request.attempt.taskId,
    sourceWorkflowRef: input.sourceWorkflowRef,
    specRevision: request.attempt.specRevision,
    generation: request.attempt.generation,
    role: request.attempt.role,
    phase: request.attempt.phase,
    attemptId: request.attempt.attemptId,
    attemptDigest: request.attempt.attemptDigest,
    runId: request.runId,
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    runnerKind: request.attempt.runnerKind,
    permission: request.attempt.permission,
    subjectCommit: request.attempt.subjectCommit,
    capturePolicy: input.capturePolicy,
    renderer: {
      name: "core-v2-role-prompt",
      version: "1",
      optionsDigest: sha256(stableJson({ separator: "\\n", segmentKinds: segments.map((item) => item.kind) })),
    },
    renderPlan: { separator: "\n" },
    segments: segments.map((segment) => ({
      ordinal: segment.ordinal,
      kind: segment.kind,
      content: { originalValue: segment.value, policy: input.capturePolicy },
    })),
    renderedPrompt: { originalValue: renderedPrompt, policy: input.capturePolicy },
    createdAt: input.createdAt,
  });
  assertPromptEnvelopePreparedRoleRunV2(promptEnvelope, request);
  await mkdir(request.runRoot, { recursive: true });
  const promptEnvelopePath = path.join(request.runRoot, "prompt-envelope.json");
  const promptBytes = Buffer.from(`${stableJson(promptEnvelope)}\n`, "utf8");
  await writeContentChecked(promptEnvelopePath, promptBytes);
  const promptPrefix = roleArtifactPrefix(request.runId);
  const executionPrefix = roleRuntimeArtifactPrefix(request.runId);
  const promptEnvelopeDescriptor = createArtifactDescriptorV1({
    ref: `${promptPrefix}/prompt-envelope.json`,
    digest: promptEnvelope.envelopeDigest,
    byteLength: promptBytes.byteLength,
    mediaType: "application/json",
  });
  const locator = createActiveRoleRunLocatorV1({
    binding: {
      taskId: request.attempt.taskId,
      sourceWorkflowRef: input.sourceWorkflowRef,
      specRevision: request.attempt.specRevision,
      generation: request.attempt.generation,
      role: request.attempt.role,
      phase: request.attempt.phase,
      attemptId: request.attempt.attemptId,
      attemptDigest: request.attempt.attemptDigest,
      runId: request.runId,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      runnerKind: request.attempt.runnerKind,
      provider: request.attempt.runnerKind === "CODEX_EXEC" ? "CODEX" : "CLAUDE",
    },
    stage: "PREPARED",
    locatorVersion: 1,
    promptEnvelope: promptEnvelopeDescriptor,
    expectedExecutionEventsRef: `${executionPrefix}/events.jsonl`,
    expectedStderrRef: `${executionPrefix}/stderr.log`,
    preparedAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  await persistLocatorV1(request.runRoot, locator);
  return Object.freeze({ promptEnvelope, promptEnvelopeDescriptor, locator, promptEnvelopePath });
}

export async function advanceAndPersistLiveRoleLocatorV1(input: {
  readonly runRoot: string;
  readonly current: ActiveRoleRunLocatorV1;
  readonly stage: "RUNNING" | "AGENT_COMPLETED" | "CAPTURE_PENDING";
  readonly providerSessionId?: string;
  readonly updatedAt: string;
}): Promise<ActiveRoleRunLocatorV1> {
  const locator = advanceActiveRoleRunLocatorV1(input.current, {
    stage: input.stage,
    ...(input.providerSessionId === undefined ? {} : { providerSessionId: input.providerSessionId }),
    updatedAt: input.updatedAt,
  });
  await persistLocatorV1(input.runRoot, locator);
  return locator;
}

export async function captureLiveRoleSessionV1(input: {
  readonly sourceWorkflowRef: string;
  readonly roleManifest: RoleRunManifestV2;
  readonly promptEnvelope: PromptEnvelopeV1;
  readonly promptEnvelopeDescriptor: ArtifactDescriptorV1;
  readonly managedArtifactRoot: string;
  readonly config: LiveSessionCaptureConfigV1;
  readonly requestedAt: string;
  readonly capturedAt: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly executorId: string;
  readonly afterManifest?: (manifest: SessionTranscriptManifestV1) => Promise<void>;
}): Promise<LiveSessionCaptureResultV1> {
  const binding = createSessionEvidenceBindingFromRoleManifestV2({ sourceWorkflowRef: input.sourceWorkflowRef, manifest: input.roleManifest });
  const parser = binding.provider === "CODEX" ? CODEX_SESSION_PARSER_V1 : CLAUDE_SESSION_PARSER_V1;
  const sourceLocatorDigest = binding.provider === "CODEX"
    ? codexSessionSourceLocatorDigestV1(binding.providerSessionId)
    : claudeSessionSourceLocatorDigestV1(binding.providerSessionId);
  const enrichmentId = `live:${binding.runId.slice("sha256:".length)}`;
  const artifactPrefix = `artifact://session-transcript/${enrichmentId}`;
  const intent = createSessionTranscriptCaptureIntentV1({
    importMode: "LIVE",
    enrichmentId,
    workflowRef: `restate://TranscriptEnrichmentWorkflow/${enrichmentId}`,
    captureAttempt: 1,
    binding,
    capturePolicy: input.config.capturePolicy,
    parser,
    sourceLocatorDigest,
    maxSourceBytes: input.config.maxSourceBytes ?? 64 * 1024 * 1024,
    promptBinding: "PROMPT_ENVELOPE_V1",
    promptEnvelope: input.promptEnvelopeDescriptor,
    ...(input.config.capturePolicy === "full" ? { expectedRawRef: `${artifactPrefix}/raw.jsonl` } : {}),
    expectedNormalizedRef: `${artifactPrefix}/normalized.jsonl`,
    expectedManifestRef: `${artifactPrefix}/manifest.json`,
    expectedReceiptRef: `${artifactPrefix}/receipt.json`,
    requestedAt: input.requestedAt,
  });
  const operationRoot = path.join(path.resolve(input.managedArtifactRoot), `operation-${sha256(intent.captureOperationId).slice(7)}`);
  await mkdir(operationRoot, { recursive: true });
  await writeContentChecked(path.join(operationRoot, "capture-intent.json"), Buffer.from(`${stableJson(intent)}\n`, "utf8"));
  const receiptPath = path.join(operationRoot, "capture-receipt.json");
  const existingReceipt = await readJsonIfPresent(receiptPath);
  if (existingReceipt !== undefined) {
    const receiptDigest = requiredString((existingReceipt as Record<string, unknown>)["receiptDigest"], "receiptDigest");
    const receipt = parseSessionTranscriptImportReceiptV1(existingReceipt, receiptDigest);
    const managed = await inspectManaged(binding.provider, input.managedArtifactRoot, intent.captureId);
    if (managed === null) throw conflict("SESSION_RECEIPT_WITHOUT_MANIFEST", "Capture Receipt exists but its managed Manifest is missing");
    const authority = authorityWithReceipt(binding, intent, receipt, managed.manifest);
    return Object.freeze({ recovery: "REUSED_RECEIPT", intent, manifest: managed.manifest, receipt, authority, summary: sessionEvidenceBoardSummaryV1(authority) });
  }

  let managed = await inspectManaged(binding.provider, input.managedArtifactRoot, intent.captureId);
  let recovery: LiveSessionCaptureResultV1["recovery"] = "RECOVERED_MANIFEST";
  if (managed === null) {
    const providerSessionsRoot = binding.provider === "CODEX"
      ? requiredString(input.config.codexSessionsRoot, "codexSessionsRoot")
      : requiredString(input.config.claudeProjectsRoot, "claudeProjectsRoot");
    const captured = binding.provider === "CODEX"
      ? await new CodexNativeSessionAdapterV1({ providerSessionsRoot, managedArtifactRoot: input.managedArtifactRoot })
        .capture({ intent, promptEnvelope: input.promptEnvelope, capturedAt: input.capturedAt })
      : await new ClaudeNativeSessionAdapterV1({ providerSessionsRoot, managedArtifactRoot: input.managedArtifactRoot })
        .capture({ intent, promptEnvelope: input.promptEnvelope, capturedAt: input.capturedAt });
    managed = { manifest: captured.manifest, timeline: captured.timeline };
    recovery = "EXECUTED";
    await input.afterManifest?.(managed.manifest);
  }
  const manifestPath = managedManifestPath(input.managedArtifactRoot, intent.captureId);
  const manifestSize = (await stat(manifestPath)).size;
  const receipt = createSessionTranscriptImportReceiptV1({
    enrichmentId: intent.enrichmentId,
    workflowRef: intent.workflowRef,
    receiptRef: intent.expectedReceiptRef,
    importMode: "LIVE",
    captureOperationId: intent.captureOperationId,
    captureId: intent.captureId,
    capturePolicy: intent.capturePolicy,
    parserVersion: intent.parser.version,
    parserOptionsDigest: intent.parser.optionsDigest,
    captureIntentDigest: intent.intentDigest,
    captureAttempt: intent.captureAttempt,
    binding,
    promptBinding: "PROMPT_ENVELOPE_V1",
    promptEnvelope: input.promptEnvelopeDescriptor,
    captureState: managed.manifest.captureState,
    manifest: createArtifactDescriptorV1({
      ref: intent.expectedManifestRef,
      digest: managed.manifest.manifestDigest,
      byteLength: manifestSize,
      mediaType: "application/json",
    }),
    sourceDigest: managed.manifest.source.sourceDigest,
    errors: managed.manifest.errors,
    reconciledAfterUnknown: false,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    executorId: input.executorId,
  });
  await writeContentChecked(receiptPath, Buffer.from(`${stableJson(receipt)}\n`, "utf8"));
  const authority = authorityWithReceipt(binding, intent, receipt, managed.manifest);
  return Object.freeze({ recovery, intent, manifest: managed.manifest, receipt, authority, summary: sessionEvidenceBoardSummaryV1(authority) });
}

async function inspectManaged(provider: "CODEX" | "CLAUDE", root: string, captureId: string) {
  return provider === "CODEX"
    ? inspectManagedCodexSessionV1({ managedArtifactRoot: root, captureId })
    : inspectManagedClaudeSessionV1({ managedArtifactRoot: root, captureId });
}

function authorityWithReceipt(
  binding: ReturnType<typeof createSessionEvidenceBindingFromRoleManifestV2>,
  intent: SessionTranscriptCaptureIntentV1,
  receipt: SessionTranscriptImportReceiptV1,
  manifest: SessionTranscriptManifestV1,
): SessionEvidenceAuthorityV1 {
  const initial = createSessionEvidenceAuthorityV1(binding);
  const claimed = claimSessionTranscriptCaptureV1(initial, intent, 0);
  return recordSessionTranscriptReceiptV1(claimed, intent, receipt, 1, manifest);
}

async function persistLocatorV1(runRoot: string, locator: ActiveRoleRunLocatorV1): Promise<void> {
  await mkdir(runRoot, { recursive: true });
  await writeContentChecked(
    path.join(runRoot, `active-role-run-locator.v${locator.locatorVersion}.json`),
    Buffer.from(`${stableJson(locator)}\n`, "utf8"),
  );
}

async function writeContentChecked(target: string, content: Buffer): Promise<void> {
  try {
    await writeFile(target, content, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const existing = await readFile(target);
    if (!existing.equals(content)) throw conflict("SESSION_ARTIFACT_CONFLICT", `Existing Artifact differs at ${path.basename(target)}`);
  }
}

async function readJsonIfPresent(target: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(target, "utf8")) as unknown;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function managedManifestPath(root: string, captureId: string): string {
  return path.join(path.resolve(root), `capture-${sha256(captureId).slice(7, 39)}`, "session-transcript.manifest.json");
}

function roleArtifactPrefix(runId: string): string {
  return `artifact://role-v2/${runId.slice("sha256:".length)}`;
}

function roleRuntimeArtifactPrefix(runId: string): string {
  return `role-v2-artifact://${runId.slice("sha256:".length)}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new MoyeError({ code: "SESSION_CAPTURE_INPUT_INVALID", category: "VALIDATION", message: `${field} must be a non-empty string` });
  return value;
}

function conflict(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "CONFLICT", message });
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
