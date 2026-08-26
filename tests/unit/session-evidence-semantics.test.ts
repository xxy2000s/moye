import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { deriveSessionEvidenceSemanticsV1 } from "../../src/domain/session-evidence-semantics.js";
import type { SessionTranscriptManifestV1 } from "../../src/domain/session-transcript.js";

describe("Session Evidence four-dimensional semantics", () => {
  it("classifies readable historical content as complete while preserving unverified binding", () => {
    const result = deriveSessionEvidenceSemanticsV1({
      ...availableInput(),
      state: "PARTIAL",
      promptBinding: "UNVERIFIED",
      errors: [{
        code: "UNSUPPORTED_FORMAT",
        scope: "PARSER",
        detailDigest: sha("historical-prompt-binding:UNVERIFIED"),
      }],
    });

    expect(result).toEqual({
      schemaVersion: 1,
      availability: { state: "AVAILABLE", reason: "EVIDENCE_READABLE" },
      content: { evaluated: true, state: "COMPLETE", reasons: [] },
      binding: { state: "UNVERIFIED", reason: "HISTORICAL_BINDING_UNVERIFIED" },
      limitation: { state: "NONE", reasons: [] },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("does not excuse a real parser error that only shares the legacy error code", () => {
    const result = deriveSessionEvidenceSemanticsV1({
      ...availableInput(),
      state: "PARTIAL",
      promptBinding: "UNVERIFIED",
      errors: [{ code: "UNSUPPORTED_FORMAT", scope: "PARSER", detailDigest: sha("real-parser-gap") }],
    });

    expect(result.content).toEqual({
      evaluated: true,
      state: "PARTIAL",
      reasons: [{ kind: "CAPTURE_ERROR", errorCode: "UNSUPPORTED_FORMAT", errorScope: "PARSER" }],
    });
  });

  it("produces deterministic, dimension-specific reasons for genuine content loss", () => {
    const input = availableInput();
    const result = deriveSessionEvidenceSemanticsV1({
      ...input,
      state: "PARTIAL",
      completeness: {
        ...input.completeness,
        messages: "PARTIAL",
        tools: "UNAVAILABLE",
        timestamps: "UNAVAILABLE",
        raw: "UNAVAILABLE",
      },
      metrics: { ...input.metrics, parseErrors: 2, unknownEvents: 1, droppedEvents: 3 },
      terminalMarkerState: "ABSENT",
      errors: [
        { code: "PARSER_FAILED", scope: "PARSER", detailDigest: sha("z") },
        { code: "SOURCE_CHANGED", scope: "SOURCE", detailDigest: sha("a") },
      ],
    });

    expect(result.content.state).toBe("PARTIAL");
    expect(result.content.reasons).toEqual([
      { kind: "DIMENSION_PARTIAL", dimension: "messages" },
      { kind: "DIMENSION_UNAVAILABLE", dimension: "tools" },
      { kind: "DIMENSION_UNAVAILABLE", dimension: "timestamps" },
      { kind: "DIMENSION_UNAVAILABLE", dimension: "raw" },
      { kind: "PARSE_ERRORS", count: 2 },
      { kind: "UNKNOWN_EVENTS", count: 1 },
      { kind: "DROPPED_EVENTS", count: 3 },
      { kind: "TERMINAL_MARKER_ABSENT" },
      { kind: "CAPTURE_ERROR", errorCode: "PARSER_FAILED", errorScope: "PARSER" },
      { kind: "CAPTURE_ERROR", errorCode: "SOURCE_CHANGED", errorScope: "SOURCE" },
    ]);
    expect(deriveSessionEvidenceSemanticsV1({ ...input, state: "PARTIAL", errors: [] }))
      .toEqual(deriveSessionEvidenceSemanticsV1({ ...input, state: "COMPLETE", errors: [] }));
  });

  it("keeps policy and provider limitations out of content-loss classification", () => {
    const input = availableInput();
    const notExposed = deriveSessionEvidenceSemanticsV1({
      ...input,
      completeness: { ...input.completeness, tools: "NOT_EXPOSED", hierarchy: "NOT_EXPOSED" },
    });
    const omitted = deriveSessionEvidenceSemanticsV1({
      ...input,
      capturePolicy: "digest_only",
      completeness: { ...input.completeness, raw: "OMITTED_BY_POLICY", tools: "NOT_EXPOSED" },
    });
    const redacted = deriveSessionEvidenceSemanticsV1({
      ...input,
      capturePolicy: "redacted",
      completeness: { ...input.completeness, raw: "OMITTED_BY_POLICY", tools: "NOT_EXPOSED" },
    });

    expect(notExposed).toMatchObject({ content: { state: "COMPLETE" }, limitation: { state: "NOT_EXPOSED", reasons: ["NOT_EXPOSED"] } });
    expect(omitted).toMatchObject({ content: { state: "COMPLETE" }, limitation: { state: "OMITTED_BY_POLICY", reasons: ["OMITTED_BY_POLICY", "NOT_EXPOSED"] } });
    expect(redacted).toMatchObject({ content: { state: "COMPLETE" }, limitation: { state: "REDACTED", reasons: ["REDACTED", "NOT_EXPOSED"] } });
  });

  it("keeps every unavailable or recovery state distinct without inventing content", () => {
    const matrix = [
      ["PENDING", "PENDING", "CAPTURE_PENDING"],
      ["WAITING_RECONCILE", "WAITING_RECONCILE", "CAPTURE_WAITING_RECONCILE"],
      ["UNAVAILABLE", "UNAVAILABLE", "TRANSCRIPT_UNAVAILABLE"],
      ["FAILED", "FAILED", "CAPTURE_FAILED"],
      ["INTEGRITY_ERROR", "FAILED", "ARTIFACT_INTEGRITY_FAILED"],
    ] as const;

    for (const [source, availability, reason] of matrix) {
      expect(deriveSessionEvidenceSemanticsV1({ state: source })).toEqual({
        schemaVersion: 1,
        availability: { state: availability, reason },
        content: { evaluated: false, reasons: [] },
        binding: { state: "NOT_APPLICABLE", reason: "NO_READABLE_TRANSCRIPT" },
        limitation: { state: "NONE", reasons: [] },
      });
    }
  });

  it("reports verified binding only for a readable pre-execution Prompt Envelope", () => {
    expect(deriveSessionEvidenceSemanticsV1({
      ...availableInput(),
      promptBinding: "PROMPT_ENVELOPE_V1",
    })).toMatchObject({
      availability: { state: "AVAILABLE" },
      content: { state: "COMPLETE" },
      binding: { state: "VERIFIED", reason: "PROMPT_ENVELOPE_BOUND" },
    });
  });
});

function availableInput() {
  return {
    state: "COMPLETE" as const,
    capturePolicy: "full" as const,
    promptBinding: "UNVERIFIED" as const,
    completeness: {
      prompt: "UNVERIFIED",
      messages: "COMPLETE",
      tools: "COMPLETE",
      timestamps: "COMPLETE",
      hierarchy: "COMPLETE",
      raw: "FULL",
      providerScope: "PROVIDER_EXPOSED",
    } satisfies SessionTranscriptManifestV1["completeness"],
    metrics: { sourceRecords: 7, normalizedEvents: 6, parseErrors: 0, unknownEvents: 0, droppedEvents: 0 },
    terminalMarkerState: "PRESENT" as const,
    errors: [],
  };
}

function sha(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

