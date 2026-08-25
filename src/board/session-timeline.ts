import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { inspectManagedClaudeSessionV1 } from "../agent/claude-session-adapter.js";
import { inspectManagedCodexSessionV1 } from "../agent/codex-session-adapter.js";
import type { RoleRunManifestV2 } from "../agent/role-runtime-v2.js";
import {
  parseActiveRoleRunLocatorV1,
  parseSessionEvidenceAuthorityV1,
  parseSessionTranscriptImportReceiptV1,
  type ArtifactDescriptorV1,
  type NormalizedTimelineEventV1,
  type SessionTranscriptManifestV1,
  type TranscriptTerminalStateV1,
} from "../domain/session-transcript.js";
import type { CoreV2SessionEvidenceRecordV1 } from "../restate/core-v2-services.js";

export type BoardSessionState = TranscriptTerminalStateV1 | "PENDING" | "WAITING_RECONCILE";

export class SessionTimelineError extends Error {
  constructor(
    readonly code: "SESSION_EVIDENCE_NOT_FOUND" | "SESSION_CAPTURE_PENDING" | "SESSION_WAITING_RECONCILE"
      | "SESSION_TRANSCRIPT_UNAVAILABLE" | "SESSION_TRANSCRIPT_FAILED" | "SESSION_ARTIFACT_FORBIDDEN"
      | "SESSION_ARTIFACT_INTEGRITY_FAILED" | "SESSION_CURSOR_INVALID",
    readonly status: 400 | 403 | 404 | 409 | 422,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "SessionTimelineError";
  }
}

export interface BoardSessionMetadataV1 {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly runnerKind: string;
  readonly provider?: "CODEX" | "CLAUDE";
  readonly providerSessionId?: string;
  readonly state: BoardSessionState;
  readonly capturePolicy?: "full" | "redacted" | "digest_only";
  readonly completeness?: SessionTranscriptManifestV1["completeness"];
  readonly metrics?: SessionTranscriptManifestV1["metrics"];
  readonly source?: SessionTranscriptManifestV1["source"];
  readonly parser?: SessionTranscriptManifestV1["parser"];
  readonly relationships?: {
    readonly parentSessionIds: readonly string[];
    readonly childSessionIds: readonly string[];
  };
  readonly capturedAt?: string;
  readonly errors: readonly SessionTranscriptManifestV1["errors"][number][];
  readonly artifacts: {
    readonly promptEnvelope?: ArtifactDescriptorV1;
    readonly raw?: ArtifactDescriptorV1;
    readonly normalized?: ArtifactDescriptorV1;
    readonly manifest?: ArtifactDescriptorV1;
    readonly stderr: { readonly ref: string; readonly digest: string };
  };
  readonly receiptDigest?: string;
  readonly manifestDigest?: string;
}

export interface BoardSessionTimelinePageV1 {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly provider: "CODEX" | "CLAUDE";
  readonly providerSessionId: string;
  readonly state: "COMPLETE" | "PARTIAL";
  readonly cursor: number;
  readonly nextCursor: number;
  readonly total: number;
  readonly hasMore: boolean;
  readonly completed: true;
  readonly events: readonly NormalizedTimelineEventV1[];
}

export interface BoardSessionStderrV1 {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly ref: string;
  readonly digest: string;
  readonly byteLength: number;
  readonly content: string;
}

interface ResolverInput {
  readonly artifactRoots: readonly string[];
  readonly declaredArtifactRoot: string;
  readonly taskId: string;
  readonly run: RoleRunManifestV2;
  readonly evidence?: CoreV2SessionEvidenceRecordV1;
}

export async function readBoardSessionMetadataV1(input: ResolverInput): Promise<BoardSessionMetadataV1> {
  assertRunBinding(input);
  const evidence = input.evidence;
  const state = evidence === undefined ? "UNAVAILABLE" : evidenceState(evidence);
  const base = {
    schemaVersion: 1 as const,
    taskId: input.taskId,
    runId: input.run.runId,
    attemptId: input.run.attemptId,
    runnerKind: input.run.runnerKind,
    ...(evidence?.locator.binding.provider === undefined ? {} : { provider: evidence.locator.binding.provider }),
    ...(evidence?.locator.providerSessionId === undefined ? {} : { providerSessionId: evidence.locator.providerSessionId }),
    state,
    ...(evidence?.receipt === undefined ? {} : { capturePolicy: evidence.receipt.capturePolicy }),
    errors: evidence?.receipt?.errors ?? [],
    artifacts: {
      ...(evidence === undefined ? {} : { promptEnvelope: evidence.promptEnvelope }),
      ...(evidence?.receipt?.manifest === undefined ? {} : { manifest: evidence.receipt.manifest }),
      stderr: { ref: input.run.stderrRef, digest: input.run.stderrDigest },
    },
    ...(evidence?.receipt === undefined ? {} : { receiptDigest: evidence.receipt.receiptDigest }),
  };
  if (state !== "COMPLETE" && state !== "PARTIAL") return base;
  const managed = await loadManaged(input);
  return {
    ...base,
    state: managed.manifest.captureState,
    completeness: managed.manifest.completeness,
    metrics: managed.manifest.metrics,
    source: managed.manifest.source,
    parser: managed.manifest.parser,
    relationships: {
      parentSessionIds: managed.manifest.parentSessionIds,
      childSessionIds: managed.manifest.childSessionIds,
    },
    capturedAt: managed.manifest.capturedAt,
    errors: managed.manifest.errors,
    artifacts: {
      ...base.artifacts,
      ...(managed.manifest.artifacts.raw === undefined ? {} : { raw: managed.manifest.artifacts.raw }),
      normalized: managed.manifest.artifacts.normalized,
    },
    manifestDigest: managed.manifest.manifestDigest,
  };
}

export async function readBoardSessionTimelinePageV1(input: ResolverInput & {
  readonly cursor: number;
  readonly limit: number;
}): Promise<BoardSessionTimelinePageV1> {
  if (!Number.isSafeInteger(input.cursor) || input.cursor < 0 || !Number.isSafeInteger(input.limit)
      || input.limit < 1 || input.limit > 200) {
    throw new SessionTimelineError("SESSION_CURSOR_INVALID", 400, "cursor must be non-negative and limit must be between 1 and 200");
  }
  assertReadable(input.evidence);
  const managed = await loadManaged(input);
  const events = managed.timeline.slice(input.cursor, input.cursor + input.limit);
  const nextCursor = input.cursor + events.length;
  return {
    schemaVersion: 1,
    taskId: input.taskId,
    runId: input.run.runId,
    attemptId: input.run.attemptId,
    provider: managed.manifest.binding.provider,
    providerSessionId: managed.manifest.binding.providerSessionId,
    state: managed.manifest.captureState,
    cursor: input.cursor,
    nextCursor,
    total: managed.timeline.length,
    hasMore: nextCursor < managed.timeline.length,
    completed: true,
    events,
  };
}

export async function readBoardSessionStderrV1(input: ResolverInput): Promise<BoardSessionStderrV1> {
  assertRunBinding(input);
  const taskRoot = await allowedTaskRoot(input.artifactRoots, input.declaredArtifactRoot);
  const token = roleRunToken(input.run.runId);
  if (input.run.stderrRef !== `role-v2-artifact://${token}/stderr.log`) {
    throw integrity("Role stderr reference does not match the Role Run");
  }
  const target = path.join(taskRoot, "roles", `run-${token}`, "stderr.log");
  const content = await safeFile(taskRoot, target, 4 * 1024 * 1024);
  if (sha256(content) !== input.run.stderrDigest) throw integrity("Role stderr digest mismatch");
  return {
    schemaVersion: 1,
    taskId: input.taskId,
    runId: input.run.runId,
    attemptId: input.run.attemptId,
    ref: input.run.stderrRef,
    digest: input.run.stderrDigest,
    byteLength: content.byteLength,
    content: content.toString("utf8"),
  };
}

function evidenceState(evidence: CoreV2SessionEvidenceRecordV1): BoardSessionState {
  if (evidence.authority?.pendingUnknown !== undefined && evidence.authority.reconcileDecision === undefined) return "WAITING_RECONCILE";
  if (evidence.receipt === undefined) return "PENDING";
  return evidence.receipt.captureState;
}

function assertReadable(evidence: CoreV2SessionEvidenceRecordV1 | undefined): asserts evidence is CoreV2SessionEvidenceRecordV1 & { readonly receipt: NonNullable<CoreV2SessionEvidenceRecordV1["receipt"]> } {
  if (evidence === undefined) throw new SessionTimelineError("SESSION_EVIDENCE_NOT_FOUND", 404, "No Session Evidence is bound to this Role Run");
  const state = evidenceState(evidence);
  if (state === "PENDING") throw new SessionTimelineError("SESSION_CAPTURE_PENDING", 409, "Session capture has not produced a Receipt yet");
  if (state === "WAITING_RECONCILE") throw new SessionTimelineError("SESSION_WAITING_RECONCILE", 409, "Session capture is waiting for reconciliation");
  if (state === "UNAVAILABLE") throw new SessionTimelineError("SESSION_TRANSCRIPT_UNAVAILABLE", 422, "Provider transcript is unavailable");
  if (state === "FAILED") throw new SessionTimelineError("SESSION_TRANSCRIPT_FAILED", 422, "Provider transcript capture failed");
}

async function loadManaged(input: ResolverInput): Promise<{ readonly manifest: SessionTranscriptManifestV1; readonly timeline: readonly NormalizedTimelineEventV1[] }> {
  assertRunBinding(input);
  assertReadable(input.evidence);
  const receipt = parseSessionTranscriptImportReceiptV1(input.evidence.receipt, input.evidence.receipt.receiptDigest);
  if (input.evidence.authority !== undefined) parseSessionEvidenceAuthorityV1(input.evidence.authority, input.evidence.authority.stateDigest);
  const taskRoot = await allowedTaskRoot(input.artifactRoots, input.declaredArtifactRoot);
  const managedRoot = path.join(taskRoot, "session-evidence");
  const managed = receipt.binding.provider === "CODEX"
    ? await inspectManagedCodexSessionV1({ managedArtifactRoot: managedRoot, captureId: receipt.captureId })
    : await inspectManagedClaudeSessionV1({ managedArtifactRoot: managedRoot, captureId: receipt.captureId });
  if (managed === null) throw integrity("Session Transcript Manifest is missing from the managed Artifact Root");
  const manifest = managed.manifest;
  if (receipt.manifest?.digest !== manifest.manifestDigest || receipt.captureState !== manifest.captureState
      || receipt.captureId !== manifest.captureId || receipt.binding.runId !== input.run.runId
      || manifest.binding.runId !== input.run.runId || manifest.binding.attemptId !== input.run.attemptId
      || manifest.binding.roleManifestDigest !== input.run.manifestDigest || manifest.binding.taskId !== input.taskId
      || manifest.binding.providerSessionId !== input.run.sessionId) {
    throw integrity("Session Receipt, Manifest and Role Run bindings disagree");
  }
  return managed;
}

function assertRunBinding(input: ResolverInput): void {
  if (input.run.taskId !== input.taskId) throw integrity("Role Run does not belong to the requested Task");
  if (input.evidence === undefined) return;
  parseActiveRoleRunLocatorV1(input.evidence.locator, input.evidence.locator.locatorDigest);
  if (input.evidence.authority !== undefined) {
    parseSessionEvidenceAuthorityV1(input.evidence.authority, input.evidence.authority.stateDigest);
  }
  if (input.evidence.receipt !== undefined) {
    parseSessionTranscriptImportReceiptV1(input.evidence.receipt, input.evidence.receipt.receiptDigest);
  }
  const binding = input.evidence.locator.binding;
  if (input.evidence.runId !== input.run.runId || input.evidence.attemptId !== input.run.attemptId
      || binding.taskId !== input.taskId || binding.runId !== input.run.runId || binding.attemptId !== input.run.attemptId
      || input.evidence.promptEnvelope.digest !== input.evidence.locator.promptEnvelope.digest
      || input.evidence.promptEnvelope.ref !== input.evidence.locator.promptEnvelope.ref
      || (input.evidence.locator.providerSessionId !== undefined && input.evidence.locator.providerSessionId !== input.run.sessionId)
      || input.evidence.executionEventsRef !== input.run.eventsRef || input.evidence.stderrRef !== input.run.stderrRef) {
    throw integrity("Session Evidence locator does not match the Role Run");
  }
}

async function allowedTaskRoot(roots: readonly string[], declared: string): Promise<string> {
  let taskRoot: string;
  try { taskRoot = await realpath(declared); }
  catch (cause) { throw integrity("Declared Task Artifact Root is unavailable", cause); }
  for (const configured of roots) {
    try {
      if (isSameOrWithin(await realpath(configured), taskRoot)) return taskRoot;
    } catch { continue; }
  }
  throw new SessionTimelineError("SESSION_ARTIFACT_FORBIDDEN", 403, "Task Artifact Root is outside configured roots");
}

async function safeFile(root: string, target: string, maxBytes: number): Promise<Buffer> {
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error("unsafe file");
    const actual = await realpath(target);
    if (actual !== target || !isSameOrWithin(root, actual)) throw new Error("path escaped root");
    return readFile(actual);
  } catch (cause) {
    throw integrity("Managed Session Artifact is missing or unsafe", cause);
  }
}

function roleRunToken(runId: string): string {
  const token = runId.slice("sha256:".length);
  if (!/^[0-9a-f]{64}$/.test(token)) throw integrity("Invalid Core v2 Role Run identity");
  return token;
}

function sha256(value: Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

function isSameOrWithin(root: string, candidate: string): boolean {
  const fromRoot = path.relative(root, candidate);
  return fromRoot === "" || (!path.isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${path.sep}`));
}

function integrity(message: string, cause?: unknown): SessionTimelineError {
  return new SessionTimelineError("SESSION_ARTIFACT_INTEGRITY_FAILED", 422, message, { cause });
}
