import { createHash } from "node:crypto";

import type {
  SessionCapturePolicyV1,
  SessionTranscriptImportReceiptV1,
  SessionTranscriptManifestV1,
  TranscriptCaptureErrorV1,
  TranscriptTerminalStateV1,
} from "./session-transcript.js";

export const SESSION_EVIDENCE_AVAILABILITY_V1 = [
  "PENDING",
  "AVAILABLE",
  "WAITING_RECONCILE",
  "UNAVAILABLE",
  "FAILED",
] as const;
export const SESSION_CONTENT_COMPLETENESS_V1 = ["COMPLETE", "PARTIAL"] as const;
export const SESSION_BINDING_CONFIDENCE_V1 = ["VERIFIED", "UNVERIFIED", "NOT_APPLICABLE"] as const;
export const SESSION_EVIDENCE_LIMITATIONS_V1 = [
  "OMITTED_BY_POLICY",
  "NOT_EXPOSED",
  "REDACTED",
  "NONE",
] as const;

export type SessionEvidenceAvailabilityV1 = (typeof SESSION_EVIDENCE_AVAILABILITY_V1)[number];
export type SessionContentCompletenessV1 = (typeof SESSION_CONTENT_COMPLETENESS_V1)[number];
export type SessionBindingConfidenceV1 = (typeof SESSION_BINDING_CONFIDENCE_V1)[number];
export type SessionEvidenceLimitationV1 = (typeof SESSION_EVIDENCE_LIMITATIONS_V1)[number];

export type SessionEvidenceSourceStateV1 =
  | TranscriptTerminalStateV1
  | "PENDING"
  | "WAITING_RECONCILE"
  | "INTEGRITY_ERROR";

export interface SessionContentReasonV1 {
  readonly kind:
    | "DIMENSION_PARTIAL"
    | "DIMENSION_UNAVAILABLE"
    | "PARSE_ERRORS"
    | "UNKNOWN_EVENTS"
    | "DROPPED_EVENTS"
    | "TERMINAL_MARKER_ABSENT"
    | "CAPTURE_ERROR";
  readonly dimension?: "messages" | "tools" | "timestamps" | "hierarchy" | "raw";
  readonly count?: number;
  readonly errorCode?: TranscriptCaptureErrorV1["code"];
  readonly errorScope?: TranscriptCaptureErrorV1["scope"];
}

export interface SessionEvidenceSemanticsV1 {
  readonly schemaVersion: 1;
  readonly availability: {
    readonly state: SessionEvidenceAvailabilityV1;
    readonly reason:
      | "CAPTURE_PENDING"
      | "EVIDENCE_READABLE"
      | "CAPTURE_WAITING_RECONCILE"
      | "TRANSCRIPT_UNAVAILABLE"
      | "CAPTURE_FAILED"
      | "ARTIFACT_INTEGRITY_FAILED";
  };
  readonly content: {
    readonly evaluated: boolean;
    readonly state?: SessionContentCompletenessV1;
    readonly reasons: readonly SessionContentReasonV1[];
  };
  readonly binding: {
    readonly state: SessionBindingConfidenceV1;
    readonly reason: "PROMPT_ENVELOPE_BOUND" | "HISTORICAL_BINDING_UNVERIFIED" | "NO_READABLE_TRANSCRIPT";
  };
  readonly limitation: {
    readonly state: SessionEvidenceLimitationV1;
    readonly reasons: readonly Exclude<SessionEvidenceLimitationV1, "NONE">[];
  };
}

export interface DeriveSessionEvidenceSemanticsInputV1 {
  readonly state: SessionEvidenceSourceStateV1;
  readonly capturePolicy?: SessionCapturePolicyV1;
  readonly promptBinding?: SessionTranscriptImportReceiptV1["promptBinding"];
  readonly completeness?: SessionTranscriptManifestV1["completeness"];
  readonly metrics?: SessionTranscriptManifestV1["metrics"];
  readonly terminalMarkerState?: SessionTranscriptManifestV1["source"]["terminalMarkerState"];
  readonly errors?: readonly TranscriptCaptureErrorV1[];
}

const LEGACY_PROMPT_BINDING_SENTINELS = new Set([
  digest("historical-prompt-binding:PROVIDER_NATIVE_OBSERVED"),
  digest("historical-prompt-binding:UNVERIFIED"),
]);

export function deriveSessionEvidenceSemanticsV1(
  input: DeriveSessionEvidenceSemanticsInputV1,
): SessionEvidenceSemanticsV1 {
  const availability = deriveAvailability(input.state);
  if (availability.state !== "AVAILABLE") {
    return freezeSemantics({
      schemaVersion: 1,
      availability,
      content: { evaluated: false, reasons: [] },
      binding: { state: "NOT_APPLICABLE", reason: "NO_READABLE_TRANSCRIPT" },
      limitation: { state: "NONE", reasons: [] },
    });
  }

  const reasons = contentReasons(input);
  const limitationReasons = limitations(input);
  const limitation = limitationReasons[0] ?? "NONE";
  const verified = input.promptBinding === "PROMPT_ENVELOPE_V1";
  return freezeSemantics({
    schemaVersion: 1,
    availability,
    content: {
      evaluated: true,
      state: reasons.length === 0 ? "COMPLETE" : "PARTIAL",
      reasons,
    },
    binding: verified
      ? { state: "VERIFIED", reason: "PROMPT_ENVELOPE_BOUND" }
      : { state: "UNVERIFIED", reason: "HISTORICAL_BINDING_UNVERIFIED" },
    limitation: { state: limitation, reasons: limitationReasons },
  });
}

function deriveAvailability(state: SessionEvidenceSourceStateV1): SessionEvidenceSemanticsV1["availability"] {
  if (state === "PENDING") return { state: "PENDING", reason: "CAPTURE_PENDING" };
  if (state === "WAITING_RECONCILE") return { state: "WAITING_RECONCILE", reason: "CAPTURE_WAITING_RECONCILE" };
  if (state === "UNAVAILABLE") return { state: "UNAVAILABLE", reason: "TRANSCRIPT_UNAVAILABLE" };
  if (state === "FAILED") return { state: "FAILED", reason: "CAPTURE_FAILED" };
  if (state === "INTEGRITY_ERROR") return { state: "FAILED", reason: "ARTIFACT_INTEGRITY_FAILED" };
  return { state: "AVAILABLE", reason: "EVIDENCE_READABLE" };
}

function contentReasons(input: DeriveSessionEvidenceSemanticsInputV1): readonly SessionContentReasonV1[] {
  const reasons: SessionContentReasonV1[] = [];
  const completeness = input.completeness;
  if (completeness === undefined || input.metrics === undefined || input.terminalMarkerState === undefined) {
    return Object.freeze([{ kind: "CAPTURE_ERROR", errorCode: "INTERNAL", errorScope: "INTERNAL" }]);
  }

  addDimension(reasons, "messages", completeness.messages);
  addDimension(reasons, "tools", completeness.tools);
  addDimension(reasons, "timestamps", completeness.timestamps);
  addDimension(reasons, "hierarchy", completeness.hierarchy);
  if (completeness.raw === "UNAVAILABLE") reasons.push({ kind: "DIMENSION_UNAVAILABLE", dimension: "raw" });
  if (input.metrics.parseErrors > 0) reasons.push({ kind: "PARSE_ERRORS", count: input.metrics.parseErrors });
  if (input.metrics.unknownEvents > 0) reasons.push({ kind: "UNKNOWN_EVENTS", count: input.metrics.unknownEvents });
  if (input.metrics.droppedEvents > 0) reasons.push({ kind: "DROPPED_EVENTS", count: input.metrics.droppedEvents });
  if (input.terminalMarkerState === "ABSENT") reasons.push({ kind: "TERMINAL_MARKER_ABSENT" });

  for (const error of [...(input.errors ?? [])].sort(compareErrors)) {
    if (isLegacyPromptBindingSentinel(error)) continue;
    reasons.push({ kind: "CAPTURE_ERROR", errorCode: error.code, errorScope: error.scope });
  }
  return Object.freeze(reasons.map((reason) => Object.freeze(reason)));
}

function addDimension(
  target: SessionContentReasonV1[],
  dimension: "messages" | "tools" | "timestamps" | "hierarchy",
  state: string,
): void {
  if (state === "PARTIAL") target.push({ kind: "DIMENSION_PARTIAL", dimension });
  if (state === "UNAVAILABLE") target.push({ kind: "DIMENSION_UNAVAILABLE", dimension });
}

function limitations(input: DeriveSessionEvidenceSemanticsInputV1): readonly Exclude<SessionEvidenceLimitationV1, "NONE">[] {
  const values = new Set<Exclude<SessionEvidenceLimitationV1, "NONE">>();
  if (input.capturePolicy === "redacted") values.add("REDACTED");
  else if (input.capturePolicy === "digest_only" || input.completeness?.raw === "OMITTED_BY_POLICY") {
    values.add("OMITTED_BY_POLICY");
  }
  if (input.completeness?.tools === "NOT_EXPOSED" || input.completeness?.hierarchy === "NOT_EXPOSED") {
    values.add("NOT_EXPOSED");
  }
  return Object.freeze((["REDACTED", "OMITTED_BY_POLICY", "NOT_EXPOSED"] as const).filter((value) => values.has(value)));
}

function isLegacyPromptBindingSentinel(error: TranscriptCaptureErrorV1): boolean {
  return error.code === "UNSUPPORTED_FORMAT"
    && error.scope === "PARSER"
    && LEGACY_PROMPT_BINDING_SENTINELS.has(error.detailDigest);
}

function compareErrors(left: TranscriptCaptureErrorV1, right: TranscriptCaptureErrorV1): number {
  return `${left.scope}\u0000${left.code}\u0000${left.detailDigest}`
    .localeCompare(`${right.scope}\u0000${right.code}\u0000${right.detailDigest}`);
}

function freezeSemantics(value: SessionEvidenceSemanticsV1): SessionEvidenceSemanticsV1 {
  Object.freeze(value.availability);
  Object.freeze(value.content.reasons);
  Object.freeze(value.content);
  Object.freeze(value.binding);
  Object.freeze(value.limitation.reasons);
  Object.freeze(value.limitation);
  return Object.freeze(value);
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

