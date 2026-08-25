import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, opendir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { MoyeError } from "../domain/errors.js";
import {
  assertSessionTranscriptManifestTimelineV1,
  assertTranscriptIntentManifestV1,
  createArtifactDescriptorV1,
  createNormalizedTimelineArtifactV1,
  createNormalizedTimelineEventV1,
  createSessionTranscriptManifestV1,
  parseNormalizedTimelineEventV1,
  parsePromptEnvelopeV1,
  parseSessionTranscriptCaptureIntentV1,
  parseSessionTranscriptManifestV1,
} from "../domain/session-transcript.js";
import type {
  CapturedContentInputV1,
  NormalizedTimelineEventV1,
  PromptEnvelopeV1,
  RedactionMetadataV1,
  SessionCapturePolicyV1,
  SessionTranscriptCaptureIntentV1,
  SessionTranscriptManifestV1,
  TimelineActorV1,
  TimelineCategoryV1,
  TimelineOriginV1,
  TimelinePartKindV1,
} from "../domain/session-transcript.js";

export const CLAUDE_SESSION_PARSER_V1 = Object.freeze({
  name: "claude-session",
  version: "1.0.0",
  normalizedSchemaVersion: 1 as const,
  optionsDigest: sha256(stableJson({
    provider: "CLAUDE",
    source: "session-jsonl",
    contentBlocks: "one-normalized-event-per-block",
    userToolResults: "tool-result-not-human-user",
    assistantMetadata: "model-message-stop-sidechain-system-part",
    terminalMarker: "assistant-end-turn",
    unknownRecords: "provider-system-json",
    malformedRecords: "fail-closed",
  })),
});

export interface ClaudeSessionAdapterOptionsV1 {
  readonly providerSessionsRoot: string;
  readonly managedArtifactRoot: string;
  readonly redactor?: (value: string) => {
    readonly storedValue: string;
    readonly metadata: RedactionMetadataV1;
  };
}

export interface CaptureClaudeSessionRequestV1 {
  readonly intent: SessionTranscriptCaptureIntentV1;
  readonly promptEnvelope?: PromptEnvelopeV1;
  readonly capturedAt: string;
}

export interface CapturedClaudeSessionV1 {
  readonly manifest: SessionTranscriptManifestV1;
  readonly timeline: readonly NormalizedTimelineEventV1[];
  readonly sourcePath: string;
  readonly managedPaths: {
    readonly raw?: string;
    readonly normalized: string;
    readonly manifest: string;
  };
  readonly manifestBytesDigest: string;
}

export interface ReadManagedClaudeSessionRequestV1 {
  readonly managedArtifactRoot: string;
  readonly captureId: string;
  readonly manifestDigest: string;
}

interface ParsedRecord {
  readonly lineNumber: number;
  readonly rawLine: string;
  readonly value: Record<string, unknown>;
  readonly recordDigest: string;
}

interface ParsedClaudeSession {
  readonly records: readonly ParsedRecord[];
  readonly timeline: readonly NormalizedTimelineEventV1[];
  readonly parentSessionIds: readonly string[];
  readonly childSessionIds: readonly string[];
  readonly terminalMarkerPresent: boolean;
  readonly promptCount: number;
  readonly messageCount: number;
  readonly toolCount: number;
  readonly timestampCount: number;
  readonly coreTimestampCount: number;
  readonly coreEventCount: number;
}

interface TimelineShape {
  readonly category: TimelineCategoryV1;
  readonly actor: TimelineActorV1;
  readonly origin: TimelineOriginV1;
  readonly kind: TimelinePartKindV1;
  readonly value: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly correlation?: NormalizedTimelineEventV1["correlation"];
}

export function claudeSessionSourceLocatorDigestV1(providerSessionId: string): string {
  return sha256(stableJson({ schemaVersion: 1, provider: "CLAUDE", kind: "CONFIRMED_SESSION_ID", providerSessionId: required(providerSessionId, "providerSessionId") }));
}

export class ClaudeNativeSessionAdapterV1 {
  readonly #providerSessionsRoot: string;
  readonly #managedArtifactRoot: string;
  readonly #redactor?: ClaudeSessionAdapterOptionsV1["redactor"];

  constructor(options: ClaudeSessionAdapterOptionsV1) {
    this.#providerSessionsRoot = path.resolve(required(options.providerSessionsRoot, "providerSessionsRoot"));
    this.#managedArtifactRoot = path.resolve(required(options.managedArtifactRoot, "managedArtifactRoot"));
    this.#redactor = options.redactor;
  }

  async capture(request: CaptureClaudeSessionRequestV1): Promise<CapturedClaudeSessionV1> {
    const intent = parseSessionTranscriptCaptureIntentV1(JSON.parse(JSON.stringify(request.intent)), request.intent.intentDigest);
    if (intent.binding.provider !== "CLAUDE" || intent.binding.runnerKind !== "CLAUDE_PRINT") {
      throw failure("UNSUPPORTED_PROVIDER", "Claude adapter requires a CLAUDE/CLAUDE_PRINT binding");
    }
    if (intent.parser.name !== CLAUDE_SESSION_PARSER_V1.name || intent.parser.version !== CLAUDE_SESSION_PARSER_V1.version ||
        intent.parser.optionsDigest !== CLAUDE_SESSION_PARSER_V1.optionsDigest) {
      throw failure("UNSUPPORTED_FORMAT", "Capture Intent parser identity does not match Claude session parser v1");
    }
    const expectedLocator = claudeSessionSourceLocatorDigestV1(intent.binding.providerSessionId);
    if (intent.sourceLocatorDigest !== expectedLocator) {
      throw failure("SESSION_MISMATCH", "Capture Intent locator does not bind the confirmed Claude sessionId");
    }
    const promptEnvelope = request.promptEnvelope === undefined ? undefined :
      parsePromptEnvelopeV1(JSON.parse(JSON.stringify(request.promptEnvelope)), request.promptEnvelope.envelopeDigest);
    if (intent.promptBinding === "PROMPT_ENVELOPE_V1") {
      if (promptEnvelope === undefined || intent.promptEnvelope?.digest !== promptEnvelope.envelopeDigest) {
        throw failure("DIGEST_MISMATCH", "Live Claude capture requires the exact Prompt Envelope");
      }
    }
    if (intent.capturePolicy === "redacted" && this.#redactor === undefined) {
      throw failure("UNSUPPORTED_FORMAT", "redacted capture requires an explicitly configured trusted redactor");
    }

    const providerRoot = await physicalDirectory(this.#providerSessionsRoot, "providerSessionsRoot");
    const sourcePath = await locateSession(providerRoot, intent.binding.providerSessionId);
    const source = await stableSnapshot(sourcePath, intent.maxSourceBytes);
    const parsed = parseClaudeSession({
      bytes: source.bytes,
      intent,
      ...(promptEnvelope === undefined ? {} : { promptEnvelope }),
      ...(this.#redactor === undefined ? {} : { redactor: this.#redactor }),
    });
    const renderedPromptDigest = promptEnvelope?.renderedPrompt.originalDigest ?? intent.legacyPromptEvidence?.recoveredRenderedPromptDigest;
    const normalized = createNormalizedTimelineArtifactV1({
      ref: intent.expectedNormalizedRef,
      captureId: intent.captureId,
      provider: "CLAUDE",
      providerSessionId: intent.binding.providerSessionId,
      capturePolicy: intent.capturePolicy,
      events: parsed.timeline,
      ...(renderedPromptDigest === undefined ? {} : { renderedPromptDigest }),
    });
    const raw = intent.capturePolicy === "full" ? createArtifactDescriptorV1({
      ref: required(intent.expectedRawRef, "expectedRawRef"),
      digest: source.digest,
      byteLength: source.bytes.byteLength,
      mediaType: "application/x-ndjson",
    }) : undefined;
    const manifest = createSessionTranscriptManifestV1({
      captureId: intent.captureId,
      captureOperationId: intent.captureOperationId,
      binding: intent.binding,
      capturePolicy: intent.capturePolicy,
      captureState: "COMPLETE",
      parser: CLAUDE_SESSION_PARSER_V1,
      source: {
        kind: "CLAUDE_SESSION_JSONL",
        sessionId: intent.binding.providerSessionId,
        locatorDigest: expectedLocator,
        sourceDigest: source.digest,
        byteLength: source.bytes.byteLength,
        recordCount: parsed.records.length,
        terminalMarkerState: parsed.terminalMarkerPresent ? "PRESENT" : "ABSENT",
      },
      artifacts: {
        ...(intent.promptEnvelope === undefined ? {} : { promptEnvelope: intent.promptEnvelope }),
        ...(raw === undefined ? {} : { raw }),
        normalized: normalized.descriptor,
      },
      completeness: {
        prompt: parsed.promptCount === 1 ? "COMPLETE" : "UNAVAILABLE",
        messages: parsed.messageCount > 0 ? "COMPLETE" : "UNAVAILABLE",
        tools: parsed.toolCount > 0 ? "COMPLETE" : "NOT_EXPOSED",
        timestamps: parsed.coreTimestampCount === parsed.coreEventCount ? "COMPLETE" : "PARTIAL",
        hierarchy: "COMPLETE",
        raw: intent.capturePolicy === "full" ? "FULL" : "OMITTED_BY_POLICY",
        providerScope: "PROVIDER_EXPOSED",
      },
      metrics: {
        sourceRecords: parsed.records.length,
        normalizedEvents: normalized.eventCount,
        parseErrors: 0,
        unknownEvents: normalized.unknownEventCount,
        droppedEvents: 0,
      },
      parentSessionIds: parsed.parentSessionIds,
      childSessionIds: parsed.childSessionIds,
      errors: [],
      capturedAt: request.capturedAt,
    });
    assertTranscriptIntentManifestV1(intent, manifest);
    assertSessionTranscriptManifestTimelineV1(manifest, parsed.timeline, renderedPromptDigest);

    const managedRoot = await ensureManagedRoot(this.#managedArtifactRoot);
    const captureDirectory = await ensureCaptureDirectory(managedRoot, intent.captureId);
    const normalizedPath = path.join(captureDirectory, "session-transcript.normalized.jsonl");
    const manifestPath = path.join(captureDirectory, "session-transcript.manifest.json");
    const rawPath = raw === undefined ? undefined : path.join(captureDirectory, "session-transcript.raw.jsonl");
    if (rawPath !== undefined) await writeContentChecked(rawPath, source.bytes);
    await writeContentChecked(normalizedPath, Buffer.from(normalized.canonicalJsonl, "utf8"));
    const manifestBytes = Buffer.from(`${stableJson(manifest)}\n`, "utf8");
    await writeContentChecked(manifestPath, manifestBytes);

    return Object.freeze({
      manifest,
      timeline: parsed.timeline,
      sourcePath,
      managedPaths: Object.freeze({ ...(rawPath === undefined ? {} : { raw: rawPath }), normalized: normalizedPath, manifest: manifestPath }),
      manifestBytesDigest: sha256(manifestBytes),
    });
  }
}

export async function readManagedClaudeSessionV1(request: ReadManagedClaudeSessionRequestV1): Promise<{
  readonly manifest: SessionTranscriptManifestV1;
  readonly timeline: readonly NormalizedTimelineEventV1[];
}> {
  const managedRoot = await physicalDirectory(path.resolve(request.managedArtifactRoot), "managedArtifactRoot");
  const captureDirectory = path.join(managedRoot, captureDirectoryName(request.captureId));
  await assertContainedDirectory(managedRoot, captureDirectory);
  const manifestBytes = await readManagedFile(captureDirectory, "session-transcript.manifest.json");
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw failure("MALFORMED", "Managed Claude Transcript Manifest is malformed", error);
  }
  const manifest = parseSessionTranscriptManifestV1(manifestValue, request.manifestDigest);
  if (manifest.captureId !== request.captureId || manifest.binding.provider !== "CLAUDE") {
    throw failure("DIGEST_MISMATCH", "Managed Claude Transcript identity does not match the requested capture");
  }
  const normalizedBytes = await readManagedFile(captureDirectory, "session-transcript.normalized.jsonl");
  if (sha256(normalizedBytes) !== manifest.artifacts.normalized.digest || normalizedBytes.byteLength !== manifest.artifacts.normalized.byteLength) {
    throw failure("DIGEST_MISMATCH", "Managed normalized Claude Transcript bytes do not match the Manifest");
  }
  const timeline = parseNormalizedJsonl(normalizedBytes);
  assertSessionTranscriptManifestTimelineV1(manifest, timeline);
  if (manifest.artifacts.raw !== undefined) {
    const rawBytes = await readManagedFile(captureDirectory, "session-transcript.raw.jsonl");
    if (sha256(rawBytes) !== manifest.artifacts.raw.digest || rawBytes.byteLength !== manifest.artifacts.raw.byteLength) {
      throw failure("DIGEST_MISMATCH", "Managed raw Claude Transcript bytes do not match the Manifest");
    }
  }
  return Object.freeze({ manifest, timeline });
}

function parseClaudeSession(input: {
  readonly bytes: Buffer;
  readonly intent: SessionTranscriptCaptureIntentV1;
  readonly promptEnvelope?: PromptEnvelopeV1;
  readonly redactor?: ClaudeSessionAdapterOptionsV1["redactor"];
}): ParsedClaudeSession {
  let records: ParsedRecord[];
  try {
    records = parseRecords(input.bytes);
  } catch (error) {
    if (error instanceof MoyeError) throw error;
    throw failure("MALFORMED", "Claude session contains malformed JSONL", error);
  }
  if (records.length === 0) throw failure("MALFORMED", "Claude session is empty");
  const confirmed = records.filter((item) => item.value["sessionId"] === input.intent.binding.providerSessionId);
  if (confirmed.length === 0) throw failure("SESSION_MISMATCH", "Claude session does not confirm the expected sessionId");
  const parentIds = new Set<string>();
  const childIds = new Set<string>();
  const timeline: NormalizedTimelineEventV1[] = [];
  let terminalMarkerPresent = false;
  let promptCount = 0;
  let messageCount = 0;
  let toolCount = 0;
  let timestampCount = 0;
  let coreTimestampCount = 0;
  let coreEventCount = 0;
  const renderedPromptDigest = input.promptEnvelope?.renderedPrompt.originalDigest ?? input.intent.legacyPromptEvidence?.recoveredRenderedPromptDigest;
  const promptRecordLine = renderedPromptDigest === undefined ? undefined : findPromptRecordLine(records, renderedPromptDigest);

  for (const source of records) {
    const outerType = required(source.value["type"], `line ${source.lineNumber} type`);
    const sessionId = stringOrUndefined(source.value["sessionId"]);
    if (sessionId !== undefined && sessionId !== input.intent.binding.providerSessionId) {
      throw failure("SESSION_MISMATCH", `Claude session line ${source.lineNumber} changes sessionId`);
    }
    const agentId = stringOrUndefined(source.value["agentId"]);
    if (agentId !== undefined) childIds.add(`claude-agent:${agentId}`);
    const parentSessionId = stringOrUndefined(source.value["parentSessionId"]);
    if (parentSessionId !== undefined) parentIds.add(parentSessionId);
    const message = record(source.value["message"]);
    if (outerType === "assistant" && message["stop_reason"] === "end_turn") terminalMarkerPresent = true;
    const timestamp = timestampOf(source.value, message);
    if (timestamp.state === "PROVIDED") timestampCount += 1;
    const shapes = normalizeRecord(source, renderedPromptDigest, source.lineNumber === promptRecordLine);
    for (const [partIndex, shape] of shapes.entries()) {
      if (shape.category === "PROMPT") promptCount += 1;
      if (shape.category === "USER" || shape.category === "ASSISTANT") messageCount += 1;
      if (shape.category === "TOOL_CALL" || shape.category === "TOOL_RESULT") toolCount += 1;
      if (shape.category !== "SYSTEM") {
        coreEventCount += 1;
        if (timestamp.state === "PROVIDED") coreTimestampCount += 1;
      }
      const parentEventId = stringOrUndefined(source.value["parentUuid"]);
      const correlation = {
        ...(shape.correlation ?? {}),
        ...(parentEventId === undefined ? {} : { parentEventId }),
        ...(parentSessionId === undefined ? {} : { parentSessionId }),
        ...(agentId === undefined ? {} : { agentId, childSessionId: `claude-agent:${agentId}` }),
      };
      timeline.push(createNormalizedTimelineEventV1({
        captureId: input.intent.captureId,
        provider: "CLAUDE",
        providerSessionId: input.intent.binding.providerSessionId,
        capturePolicy: input.intent.capturePolicy,
        sequence: timeline.length + 1,
        source: {
          recordSequence: source.lineNumber,
          partIndex,
          providerType: `${outerType}/${shape.kind.toLowerCase()}`,
          ...(stringOrUndefined(source.value["uuid"]) === undefined ? {} : { providerId: stringOrUndefined(source.value["uuid"])! }),
          recordDigest: source.recordDigest,
        },
        ...(timestamp.occurredAt === undefined ? {} : { occurredAt: timestamp.occurredAt }),
        timestampState: timestamp.state,
        category: shape.category,
        actor: shape.actor,
        origin: shape.origin,
        parts: [{ kind: shape.kind, content: captureContent(shape.value, input.intent.capturePolicy, input.redactor),
          ...(shape.toolName === undefined ? {} : { toolName: shape.toolName }),
          ...(shape.toolCallId === undefined ? {} : { toolCallId: shape.toolCallId }) }],
        ...(Object.keys(correlation).length === 0 ? {} : { correlation }),
      }));
    }
  }
  if (promptCount !== 1) throw failure("SESSION_MISMATCH", `Claude session must contain exactly one rendered Prompt event; found ${promptCount}`);
  if (!terminalMarkerPresent) throw failure("SOURCE_CHANGED", "Claude session has no terminal assistant end_turn marker");
  return Object.freeze({ records, timeline, parentSessionIds: [...parentIds].sort(), childSessionIds: [...childIds].sort(), terminalMarkerPresent, promptCount, messageCount, toolCount, timestampCount, coreTimestampCount, coreEventCount });
}

function normalizeRecord(source: ParsedRecord, renderedPromptDigest: string | undefined, isPromptRecord: boolean): readonly TimelineShape[] {
  const outerType = required(source.value["type"], `line ${source.lineNumber} type`);
  const message = record(source.value["message"]);
  const content = message["content"];
  const blocks = Array.isArray(content) ? content : content === undefined ? [] : [{ type: "text", text: content }];
  const shapes: TimelineShape[] = [];
  for (const value of blocks) {
    const block = record(value);
    const blockType = stringOrUndefined(block["type"]) ?? "unknown";
    if (outerType === "user" && blockType === "tool_result") {
      const callId = stringOrUndefined(block["tool_use_id"]) ?? `line-${source.lineNumber}`;
      shapes.push({ category: "TOOL_RESULT", actor: "TOOL", origin: "PROVIDER_TOOL", kind: "TOOL_RESULT", value: stringValue(block["content"]), toolCallId: callId, correlation: { toolCallId: callId } });
    } else if (outerType === "user" && blockType === "text") {
      const text = stringValue(block["text"]);
      shapes.push(isPromptRecord && renderedPromptDigest !== undefined && sha256(text) === renderedPromptDigest ?
        { category: "PROMPT", actor: "USER", origin: "MOYE_RENDERED_PROMPT", kind: "TEXT", value: text } :
        { category: "USER", actor: "USER", origin: "PROVIDER_USER", kind: "TEXT", value: text });
    } else if (outerType === "assistant" && blockType === "text") {
      shapes.push({ category: "ASSISTANT", actor: "ASSISTANT", origin: "PROVIDER_ASSISTANT", kind: "TEXT", value: stringValue(block["text"]) });
    } else if (outerType === "assistant" && blockType === "thinking") {
      shapes.push({ category: "ASSISTANT", actor: "ASSISTANT", origin: "PROVIDER_ASSISTANT", kind: "PROVIDER_EXPOSED_THINKING", value: stringValue(block["thinking"]) });
    } else if (outerType === "assistant" && blockType === "tool_use") {
      const callId = stringOrUndefined(block["id"]) ?? `line-${source.lineNumber}`;
      shapes.push({ category: "TOOL_CALL", actor: "ASSISTANT", origin: "PROVIDER_TOOL", kind: "TOOL_CALL", value: stableJson(block["input"] ?? {}), toolName: stringOrUndefined(block["name"]) ?? "tool", toolCallId: callId, correlation: { toolCallId: callId } });
    } else {
      shapes.push({ category: "SYSTEM", actor: "SYSTEM", origin: "PROVIDER_SYSTEM", kind: "JSON", value: stableJson(block) });
    }
  }
  if (outerType === "assistant" && (message["model"] !== undefined || message["id"] !== undefined || message["stop_reason"] !== undefined || source.value["isSidechain"] !== undefined)) {
    shapes.push({
      category: "SYSTEM", actor: "SYSTEM", origin: "PROVIDER_SYSTEM", kind: "JSON",
      value: stableJson({
        messageId: message["id"] ?? null,
        model: message["model"] ?? null,
        stopReason: message["stop_reason"] ?? null,
        isSidechain: source.value["isSidechain"] ?? null,
        agentId: source.value["agentId"] ?? null,
      }),
    });
  }
  if (shapes.length === 0) shapes.push({ category: "SYSTEM", actor: "SYSTEM", origin: "PROVIDER_SYSTEM", kind: "JSON", value: stableJson(source.value) });
  return shapes;
}

function findPromptRecordLine(records: readonly ParsedRecord[], renderedPromptDigest: string): number | undefined {
  return records.find((source) => {
    if (source.value["type"] !== "user") return false;
    const content = record(source.value["message"])["content"];
    if (typeof content === "string") return sha256(content) === renderedPromptDigest;
    return Array.isArray(content) && content.some((part) => isRecord(part) && part["type"] === "text" && typeof part["text"] === "string" && sha256(part["text"]) === renderedPromptDigest);
  })?.lineNumber;
}

function parseRecords(bytes: Buffer): ParsedRecord[] {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw failure("MALFORMED", "Claude session is not valid UTF-8");
  const result: ParsedRecord[] = [];
  const lines = text.split(/\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!.endsWith("\r") ? lines[index]!.slice(0, -1) : lines[index]!;
    if (rawLine.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(rawLine);
    } catch (error) {
      throw failure("MALFORMED", `Claude session line ${index + 1} is malformed JSON`, error);
    }
    if (!isRecord(value)) throw failure("MALFORMED", `Claude session line ${index + 1} is not an object`);
    result.push({ lineNumber: index + 1, rawLine, value, recordDigest: sha256(rawLine) });
  }
  return result;
}

function parseNormalizedJsonl(bytes: Buffer): readonly NormalizedTimelineEventV1[] {
  const records = parseRecords(bytes);
  return records.map((item) => parseNormalizedTimelineEventV1(item.value, required(item.value["eventDigest"], "eventDigest")));
}

async function locateSession(root: string, providerSessionId: string): Promise<string> {
  const matches: string[] = [];
  const suffix = `${providerSessionId}.jsonl`;
  await walk(root);
  if (matches.length === 0) throw failure("SOURCE_MISSING", `No Claude session exists for confirmed sessionId ${providerSessionId}`);
  if (matches.length > 1) throw failure("SOURCE_AMBIGUOUS", `Multiple Claude sessions exist for confirmed sessionId ${providerSessionId}`);
  return matches[0]!;

  async function walk(directory: string): Promise<void> {
    const stream = await opendir(directory);
    for await (const entry of stream) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw failure("UNSAFE_FILE_TYPE", `Symlink is forbidden below the Claude Session root: ${entry.name}`);
      if (entry.isDirectory()) await walk(candidate);
      else if (entry.isFile() && entry.name === suffix) matches.push(candidate);
      else if (entry.name.endsWith(suffix)) throw failure("UNSAFE_FILE_TYPE", `Claude session candidate is not a regular file: ${entry.name}`);
    }
  }
}

async function stableSnapshot(sourcePath: string, maxBytes: number): Promise<{ readonly bytes: Buffer; readonly digest: string }> {
  const before = await lstat(sourcePath);
  if (!before.isFile() || before.isSymbolicLink()) throw failure("UNSAFE_FILE_TYPE", "Claude session source must be a physical regular file");
  if (before.size > maxBytes) throw failure("TOO_LARGE", `Claude session exceeds maxSourceBytes ${maxBytes}`);
  let handle;
  try {
    handle = await open(sourcePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const openedBefore = await handle.stat();
    if (!openedBefore.isFile() || openedBefore.size > maxBytes) throw failure(openedBefore.size > maxBytes ? "TOO_LARGE" : "UNSAFE_FILE_TYPE", "Claude session failed stable source checks");
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat();
    if (openedBefore.dev !== openedAfter.dev || openedBefore.ino !== openedAfter.ino || openedBefore.size !== openedAfter.size || openedBefore.mtimeMs !== openedAfter.mtimeMs || bytes.byteLength !== openedAfter.size) {
      throw failure("SOURCE_CHANGED", "Claude session changed while being snapshotted");
    }
    return Object.freeze({ bytes, digest: sha256(bytes) });
  } catch (error) {
    if (error instanceof MoyeError) throw error;
    throw failure("ACCESS_DENIED", "Unable to snapshot Claude session safely", error);
  } finally {
    await handle?.close();
  }
}

async function ensureManagedRoot(root: string): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  return physicalDirectory(root, "managedArtifactRoot");
}

async function ensureCaptureDirectory(root: string, captureId: string): Promise<string> {
  const target = path.join(root, captureDirectoryName(captureId));
  await mkdir(target, { recursive: true, mode: 0o700 });
  await assertContainedDirectory(root, target);
  return target;
}

function captureDirectoryName(captureId: string): string {
  return `capture-${sha256(required(captureId, "captureId")).slice(7, 39)}`;
}

async function physicalDirectory(input: string, label: string): Promise<string> {
  let stats;
  try {
    stats = await lstat(input);
  } catch (error) {
    throw failure("SOURCE_MISSING", `${label} does not exist`, error);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw failure("UNSAFE_FILE_TYPE", `${label} must be a physical directory`);
  return realpath(input);
}

async function assertContainedDirectory(root: string, target: string): Promise<void> {
  const physical = await physicalDirectory(target, "captureDirectory");
  if (physical !== root && !physical.startsWith(`${root}${path.sep}`)) throw failure("OUTSIDE_ALLOWLIST", "Managed capture directory escapes the configured Artifact root");
}

async function readManagedFile(root: string, name: string): Promise<Buffer> {
  const candidate = path.join(root, name);
  const stats = await lstat(candidate);
  if (!stats.isFile() || stats.isSymbolicLink()) throw failure("UNSAFE_FILE_TYPE", `Managed Artifact ${name} must be a physical regular file`);
  return readFile(candidate);
}

async function writeContentChecked(target: string, bytes: Buffer): Promise<void> {
  try {
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw failure("INTERNAL", `Unable to write managed Artifact ${path.basename(target)}`, error);
    const existing = await readManagedFile(path.dirname(target), path.basename(target));
    if (!existing.equals(bytes)) throw failure("ARTIFACT_CONFLICT", `Managed Artifact conflicts with an existing capture: ${path.basename(target)}`);
  }
}

function captureContent(value: string, policy: SessionCapturePolicyV1, redactor: ClaudeSessionAdapterOptionsV1["redactor"]): CapturedContentInputV1 {
  if (policy !== "redacted") return { originalValue: value, policy };
  const result = redactor!(value);
  return { originalValue: value, policy, storedValue: result.storedValue, redaction: result.metadata };
}

function timestampOf(raw: Record<string, unknown>, payload: Record<string, unknown>): { readonly state: "PROVIDED" | "MISSING" | "INVALID"; readonly occurredAt?: string } {
  const value = stringOrUndefined(raw["timestamp"]) ?? stringOrUndefined(payload["timestamp"]) ?? stringOrUndefined(payload["started_at"]);
  if (value === undefined) return { state: "MISSING" };
  if (Number.isNaN(Date.parse(value))) return { state: "INVALID" };
  return { state: "PROVIDED", occurredAt: new Date(value).toISOString() };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  return stableJson(value ?? null);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw failure("MALFORMED", `${label} must be a non-empty string`);
  return value;
}

function failure(code: string, message: string, cause?: unknown): MoyeError {
  return new MoyeError({ code, category: code === "SOURCE_MISSING" ? "NOT_FOUND" : code === "ARTIFACT_CONFLICT" || code === "SESSION_MISMATCH" || code === "DIGEST_MISMATCH" ? "CONFLICT" : "VALIDATION", message, ...(cause === undefined ? {} : { cause }) });
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
