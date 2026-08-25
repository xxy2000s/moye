import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  advanceActiveRoleRunLocatorV1,
  assertSessionEvidenceBindingV1,
  assertTranscriptIntentManifestV1,
  assertSessionTranscriptManifestTimelineV1,
  assertTranscriptReceiptManifestV1,
  claimSessionTranscriptCaptureV1,
  createActiveRoleRunLocatorV1,
  createArtifactDescriptorV1,
  createCapturedContentV1,
  createHistoricalEnrichmentBaselineV1,
  createLegacyPromptBindingEvidenceV1,
  createNormalizedTimelineEventV1,
  createNormalizedTimelineArtifactV1,
  createPromptEnvelopeV1,
  createSessionEvidenceAuthorityV1,
  createSessionEvidenceBindingFromRoleManifestV2,
  createSessionTranscriptCaptureIntentV1,
  createSessionTranscriptImportReceiptV1,
  createSessionTranscriptManifestV1,
  markSessionTranscriptCaptureUnknownV1,
  parseActiveRoleRunLocatorV1,
  parseNormalizedTimelineEventV1,
  parsePromptEnvelopeV1,
  parseSessionEvidenceAuthorityV1,
  parseSessionTranscriptImportReceiptV1,
  parseSessionTranscriptManifestV1,
  reconcileSessionTranscriptCaptureV1,
  recordSessionTranscriptReconcileDecisionV1,
  recordSessionTranscriptReceiptV1,
  recordSessionTranscriptUnknownV1,
  sessionEvidenceBoardSummaryV1,
  sessionTranscriptCaptureIdV1,
} from "../../src/domain/session-transcript.js";
import type { SessionEvidenceBindingV1 } from "../../src/domain/session-transcript.js";

const sha = (letter: string) => `sha256:${letter.repeat(64)}`;
const commit = "a".repeat(40);

describe("Agent Session evidence v1", () => {
  it("enforces digest_only, redacted, and full content without confusing integrity with privacy", () => {
    const digestOnly = createCapturedContentV1({ originalValue: "secret prompt", policy: "digest_only" });
    expect(digestOnly).toMatchObject({ disposition: "DIGEST_ONLY", originalByteLength: 13 });
    expect(digestOnly).not.toHaveProperty("storedValue");

    const redacted = createCapturedContentV1({
      originalValue: "token=secret", policy: "redacted", storedValue: "token=[redacted]",
      redaction: { profile: "secrets", version: "1", rulesDigest: sha("1"), matchCount: 1 },
    });
    expect(redacted).toMatchObject({ disposition: "REDACTED", storedValue: "token=[redacted]" });
    expect(redacted.storedDigest).not.toBe(redacted.originalDigest);

    const full = createCapturedContentV1({ originalValue: "你好 Codex", policy: "full" });
    expect(full).toMatchObject({ disposition: "FULL", storedValue: "你好 Codex" });
    expect(full.storedDigest).toBe(full.originalDigest);
    expect(() => createCapturedContentV1({ originalValue: "secret", policy: "digest_only", storedValue: "leak" })).toThrow(/cannot include stored/);
    expect(() => createCapturedContentV1({ originalValue: "secret", policy: "redacted", storedValue: "x" })).toThrow(/requires redaction/);
  });

  it("round-trips a canonical Prompt Envelope and rejects unknown fields, tampering, and false permissions", () => {
    const envelope = promptEnvelope();
    expect(parsePromptEnvelopeV1(JSON.parse(JSON.stringify(envelope)), envelope.envelopeDigest)).toEqual(envelope);
    const unknown = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
    unknown["providerHome"] = "/Users/example/.codex";
    expect(() => parsePromptEnvelopeV1(unknown, envelope.envelopeDigest)).toThrow(/unknown fields/);
    const tampered = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
    tampered["generation"] = 2;
    expect(() => parsePromptEnvelopeV1(tampered, envelope.envelopeDigest)).toThrow(/differs from its expected digest|not canonical|does not bind/);
    expect(() => createPromptEnvelopeV1({ ...promptEnvelopeInput(), permission: "WORKSPACE_WRITE" })).toThrow(/requires READ_ONLY/);

    const crossTask = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
    crossTask["sourceWorkflowRef"] = "restate://SealedTaskWorkflow/TASK-9999";
    crossTask["envelopeDigest"] = contractDigest("prompt-envelope-v1", withoutKey(crossTask, "envelopeDigest"));
    expect(() => parsePromptEnvelopeV1(crossTask, crossTask["envelopeDigest"] as string)).toThrow(/owning .* keyed by/);

    const forged = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
    forged["renderedPrompt"] = createCapturedContentV1({ originalValue: "forged unrelated prompt", policy: "full" });
    const forgedRenderer = forged["renderer"] as Record<string, unknown>;
    const forgedRenderPlan = forged["renderPlan"] as Record<string, unknown>;
    const forgedSegments = forged["segments"] as Array<Record<string, unknown>>;
    forged["renderInputsDigest"] = contractDigest("prompt-render-inputs-v1", {
      renderer: forgedRenderer, renderPlan: forgedRenderPlan,
      segments: forgedSegments.map((segment) => ({ ordinal: segment["ordinal"], kind: segment["kind"], originalDigest: (segment["content"] as Record<string, unknown>)["originalDigest"] })),
      renderedPromptDigest: (forged["renderedPrompt"] as Record<string, unknown>)["originalDigest"],
    });
    forged["envelopeId"] = `prompt-envelope:${contractDigest("prompt-envelope-identity-v1", {
      taskId: forged["taskId"], attemptDigest: forged["attemptDigest"], runId: forged["runId"], requestDigest: forged["requestDigest"], capture: forged["capturePolicy"],
      renderer: forgedRenderer, renderInputsDigest: forged["renderInputsDigest"], createdAt: forged["createdAt"],
    }).slice(7)}`;
    forged["envelopeDigest"] = contractDigest("prompt-envelope-v1", withoutKey(forged, "envelopeDigest"));
    expect(() => parsePromptEnvelopeV1(forged, forged["envelopeDigest"] as string)).toThrow(/stored segments must reproduce/);
  });

  it("publishes a pre-execution locator without requiring a fabricated Session ID", () => {
    const envelope = promptEnvelope();
    const locator = createActiveRoleRunLocatorV1({
      binding: preRunBinding(), stage: "PREPARED", locatorVersion: 1, promptEnvelope: descriptor("artifact://prompt", envelope.envelopeDigest, 400),
      expectedExecutionEventsRef: "artifact://events", expectedStderrRef: "artifact://stderr", preparedAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
    });
    expect(locator).not.toHaveProperty("providerSessionId");
    expect(parseActiveRoleRunLocatorV1(JSON.parse(JSON.stringify(locator)), locator.locatorDigest)).toEqual(locator);
    expect(() => createActiveRoleRunLocatorV1({ ...locatorInput(), binding: { ...preRunBinding(), provider: "CLAUDE" } })).toThrow(/must match/);
    expect(() => createActiveRoleRunLocatorV1({ ...locatorInput(), binding: { ...preRunBinding(), sourceWorkflowRef: "restate://workflow" } })).toThrow(/Workflow ref|canonical restate/);
  });

  it("normalizes Provider events in source order and never presents a tool result as user dialogue", () => {
    const event = createNormalizedTimelineEventV1({
      captureId: "session-capture:one", provider: "CLAUDE", providerSessionId: "claude-session-1", capturePolicy: "full", sequence: 2,
      source: { recordSequence: 7, partIndex: 1, providerType: "user", providerId: "uuid-7", recordDigest: sha("2") },
      timestampState: "MISSING", category: "TOOL_RESULT", actor: "TOOL", origin: "PROVIDER_TOOL",
      parts: [{ kind: "TOOL_RESULT", toolCallId: "tool-1", content: { originalValue: "result", policy: "full" } }],
      correlation: { toolCallId: "tool-1", parentSessionId: "parent-session" },
    });
    expect(event).not.toHaveProperty("occurredAt");
    expect(parseNormalizedTimelineEventV1(JSON.parse(JSON.stringify(event)), event.eventDigest)).toEqual(event);
    const replay = createNormalizedTimelineEventV1({ ...eventInput(), sequence: 99 });
    expect(replay.eventId).toBe(createNormalizedTimelineEventV1(eventInput()).eventId);
    expect(() => createNormalizedTimelineEventV1({ ...eventInput(), category: "TOOL_RESULT", actor: "USER" })).toThrow(/classification contract/);
    expect(() => createNormalizedTimelineEventV1({ ...eventInput(), timestampState: "MISSING", occurredAt: "2026-08-25T00:00:00Z" })).toThrow(/exists exactly/);
  });

  it("binds Manifest identity to parser options and permits raw bytes only for explicit full capture", () => {
    const manifest = transcriptManifest();
    expect(parseSessionTranscriptManifestV1(JSON.parse(JSON.stringify(manifest)), manifest.manifestDigest)).toEqual(manifest);
    expect(sessionTranscriptCaptureIdV1({ binding: binding(), parserName: "codex-rollout", parserVersion: "1.0.1", optionsDigest: sha("4"), capturePolicy: "full" })).not.toBe(manifest.captureId);
    expect(() => createSessionTranscriptManifestV1({ ...manifestInput(), capturePolicy: "digest_only" })).toThrow(/Raw Transcript Artifact is allowed only/);
    expect(() => createSessionTranscriptManifestV1({ ...manifestInput(), metrics: { ...manifestInput().metrics, parseErrors: 1 } })).toThrow(/COMPLETE Transcript requires/);
  });

  it("seals append-only live and historical Receipts without granting Task authority", () => {
    const manifest = transcriptManifest();
    const receipt = createSessionTranscriptImportReceiptV1({
      enrichmentId: "enrichment:live-1", workflowRef: "restate://TranscriptEnrichmentWorkflow/enrichment:live-1", receiptRef: "artifact://receipt", importMode: "LIVE",
      captureOperationId: manifest.captureOperationId, captureId: manifest.captureId, capturePolicy: manifest.capturePolicy, parserVersion: manifest.parser.version, parserOptionsDigest: manifest.parser.optionsDigest,
      captureIntentDigest: sha("8"), captureAttempt: 1, binding: binding(),
      promptBinding: "PROMPT_ENVELOPE_V1", promptEnvelope: descriptor("artifact://prompt", promptEnvelope().envelopeDigest, 400),
      captureState: "COMPLETE", manifest: descriptor("artifact://manifest", manifest.manifestDigest, 900), sourceDigest: sha("5"),
      errors: [], reconciledAfterUnknown: false, startedAt: "2026-08-25T00:00:00Z", finishedAt: "2026-08-25T00:00:02Z", executorId: "worker-1",
    });
    expect(receipt.authorityScope).toBe("DIAGNOSTIC_SUPPLEMENT_ONLY");
    expect(parseSessionTranscriptImportReceiptV1(JSON.parse(JSON.stringify(receipt)), receipt.receiptDigest)).toEqual(receipt);
    expect(() => createSessionTranscriptImportReceiptV1({ ...unavailableHistoricalReceipt(), errors: [] })).toThrow(/requires at least one/);
    expect(() => createSessionTranscriptImportReceiptV1({ ...unavailableHistoricalReceipt(), captureAttempt: 2 })).toThrow(/predecessor/);
    expect(() => createSessionTranscriptImportReceiptV1({ ...unavailableHistoricalReceipt(), importMode: "LIVE" })).toThrow(/LIVE capture must bind/);
  });

  it("rejects stale Attempt, Revision, Generation, Run, or Role Manifest bindings", () => {
    const current = binding();
    for (const stale of [
      { ...current, specRevision: 2 }, { ...current, generation: 1 }, { ...current, attemptId: "attempt:stale" },
      { ...current, runId: "run:stale" }, { ...current, roleManifestDigest: sha("f") },
    ]) expect(() => assertSessionEvidenceBindingV1(current, stale)).toThrow();
    expect(() => assertSessionEvidenceBindingV1(current, { ...current })).not.toThrow();
  });

  it("binds rendered Prompt to the ordered render plan and gives policy/time changes distinct identities", () => {
    expect(() => createPromptEnvelopeV1({ ...promptEnvelopeInput(), renderedPrompt: { originalValue: "unrelated", policy: "full" } })).toThrow(/exact trusted rendering/);
    const unpaired = promptEnvelopeInput();
    const { sourceDigest: _sourceDigest, ...sourceOnly } = unpaired.segments[0]!;
    expect(() => createPromptEnvelopeV1({ ...unpaired, segments: [sourceOnly, unpaired.segments[1]!] })).toThrow(/appear together/);
    const base = promptEnvelope();
    expect(createPromptEnvelopeV1({ ...promptEnvelopeInput(), createdAt: "2026-08-25T00:00:01Z" }).envelopeId).not.toBe(base.envelopeId);
    expect(() => createCapturedContentV1({ originalValue: "secret", policy: "redacted", storedValue: "secret", redaction: { profile: "secrets", version: "1", rulesDigest: sha("1"), matchCount: 1 } })).toThrow(/must differ/);
  });

  it("fences Active Locator stages and rejects stale or skipped transitions", () => {
    const prepared = createActiveRoleRunLocatorV1({ ...locatorInput(), stage: "PREPARED", locatorVersion: 1, startedAt: undefined } as never);
    const running = advanceActiveRoleRunLocatorV1(prepared, { stage: "RUNNING", updatedAt: "2026-08-25T00:00:01Z" });
    expect(running).toMatchObject({ stage: "RUNNING", locatorVersion: 2, previousLocatorDigest: prepared.locatorDigest });
    expect(() => advanceActiveRoleRunLocatorV1(prepared, { stage: "CAPTURE_PENDING", providerSessionId: "session", updatedAt: "2026-08-25T00:00:02Z" })).toThrow(/cannot transition/);
    expect(() => createActiveRoleRunLocatorV1({ ...locatorInput(), stage: "CAPTURE_PENDING", providerSessionId: undefined } as never)).toThrow(/requires the confirmed/);
  });

  it("validates a canonical Timeline collection, prompt binding, sequence, and policy", () => {
    const first = createNormalizedTimelineEventV1(eventInput());
    const second = createNormalizedTimelineEventV1({
      ...eventInput(), sequence: 2, source: { ...eventInput().source, recordSequence: 2 }, category: "ASSISTANT", actor: "ASSISTANT",
      origin: "PROVIDER_ASSISTANT", parts: [{ kind: "TEXT", content: { originalValue: "answer", policy: "full" } }],
    });
    const artifact = createNormalizedTimelineArtifactV1({
      ref: "artifact://normalized", captureId: first.captureId, provider: first.provider, providerSessionId: first.providerSessionId,
      capturePolicy: "full", events: [first, second], renderedPromptDigest: first.parts[0]!.content.originalDigest,
    });
    expect(artifact.canonicalJsonl.endsWith("\n")).toBe(true);
    const third = createNormalizedTimelineEventV1({ ...eventInput(), sequence: 3, source: { ...eventInput().source, recordSequence: 2 }, category: "ASSISTANT", actor: "ASSISTANT", origin: "PROVIDER_ASSISTANT", parts: [{ kind: "TEXT", content: { originalValue: "answer", policy: "full" } }] });
    expect(() => createNormalizedTimelineArtifactV1({ ...artifactInput(first), events: [first, third] })).toThrow(/contiguous/);
    const sourceInversion = createNormalizedTimelineEventV1({ ...eventInput(), sequence: 2, source: { ...eventInput().source, recordSequence: 0 }, category: "ASSISTANT", actor: "ASSISTANT", origin: "PROVIDER_ASSISTANT", parts: [{ kind: "TEXT", content: { originalValue: "answer", policy: "full" } }] });
    expect(() => createNormalizedTimelineArtifactV1({ ...artifactInput(first), events: [first, sourceInversion] })).toThrow(/source order/);
    expect(() => createNormalizedTimelineEventV1({ ...eventInput(), capturePolicy: "digest_only" })).toThrow(/capture policy/);
  });

  it("fences the Manifest to the exact Capture Intent limits and Artifact targets", () => {
    const prompt = promptEnvelope();
    const intent = captureIntent(prompt);
    const manifest = createSessionTranscriptManifestV1({ ...manifestInput(), captureOperationId: intent.captureOperationId });
    expect(() => assertTranscriptIntentManifestV1(intent, manifest)).not.toThrow();
    const wrongLocator = createSessionTranscriptManifestV1({ ...manifestInput(), captureOperationId: intent.captureOperationId, source: { ...manifestInput().source, locatorDigest: sha("f") } });
    expect(() => assertTranscriptIntentManifestV1(intent, wrongLocator)).toThrow(/exact fenced Capture Intent/);
    const tooSmall = createSessionTranscriptCaptureIntentV1({ ...captureIntentInput(prompt), maxSourceBytes: 100 });
    const tooSmallManifest = createSessionTranscriptManifestV1({ ...manifestInput(), captureOperationId: tooSmall.captureOperationId });
    expect(() => assertTranscriptIntentManifestV1(tooSmall, tooSmallManifest)).toThrow(/exact fenced Capture Intent/);
    const wrongTarget = createSessionTranscriptCaptureIntentV1({ ...captureIntentInput(prompt), expectedNormalizedRef: "artifact://other-normalized" });
    const wrongTargetManifest = createSessionTranscriptManifestV1({ ...manifestInput(), captureOperationId: wrongTarget.captureOperationId });
    expect(() => assertTranscriptIntentManifestV1(wrongTarget, wrongTargetManifest)).toThrow(/exact fenced Capture Intent/);
  });

  it("requires exact raw/source and honest COMPLETE semantics", () => {
    const complete = manifestInput();
    expect(() => createSessionTranscriptManifestV1({ ...complete, source: { ...complete.source, terminalMarkerState: "ABSENT" } })).toThrow(/COMPLETE Transcript requires/);
    expect(() => createSessionTranscriptManifestV1({ ...complete, completeness: { ...complete.completeness, prompt: "UNAVAILABLE" } })).toThrow(/COMPLETE Transcript requires/);
    expect(() => createSessionTranscriptManifestV1({ ...complete, source: { ...complete.source, recordCount: 8 } })).toThrow(/metrics must agree/);
    expect(() => createSessionTranscriptManifestV1({ ...complete, artifacts: { ...complete.artifacts, raw: descriptor("artifact://raw", sha("f"), 1234, "application/x-ndjson") } })).toThrow(/exact-byte/);
  });

  it("uses an attempt-specific Capture Intent, token-bound reconcile, and append-only Authority CAS", () => {
    const prompt = promptEnvelope();
    const intent = captureIntent(prompt);
    const unknown = markSessionTranscriptCaptureUnknownV1(intent, sha("a"));
    expect(() => reconcileSessionTranscriptCaptureV1(intent, unknown, { token: sha("f"), action: "NOT_APPLIED", externalEvidenceDigest: sha("b") })).toThrow(/token/);
    const decision = reconcileSessionTranscriptCaptureV1(intent, unknown, { token: unknown.reconcileToken, action: "NOT_APPLIED", externalEvidenceDigest: sha("b") });
    expect(decision.action).toBe("NOT_APPLIED");

    const claimed = claimSessionTranscriptCaptureV1(createSessionEvidenceAuthorityV1(binding()), intent, 0);
    expect(claimSessionTranscriptCaptureV1(claimed, intent, 0)).toEqual(claimed);
    const waiting = recordSessionTranscriptUnknownV1(claimed, intent, unknown, 1);
    expect(recordSessionTranscriptUnknownV1(waiting, intent, unknown, 1)).toEqual(waiting);
    expect(sessionEvidenceBoardSummaryV1(waiting)).toMatchObject({ state: "WAITING_RECONCILE", workflowRef: intent.workflowRef, receiptRef: intent.expectedReceiptRef, unknownDigest: unknown.unknownDigest });
    const conflictingUnknown = markSessionTranscriptCaptureUnknownV1(intent, sha("c"));
    expect(() => recordSessionTranscriptUnknownV1(waiting, intent, conflictingUnknown, 1)).toThrow(/version changed|does not own/);
    const reconciled = recordSessionTranscriptReconcileDecisionV1(waiting, intent, decision, 2);
    expect(recordSessionTranscriptReconcileDecisionV1(reconciled, intent, decision, 2)).toEqual(reconciled);
    expect(() => recordSessionTranscriptReconcileDecisionV1(waiting, intent, { ...decision, reconcileToken: sha("f") }, 2)).toThrow(/Digest|token proof/);
    const manifest = createSessionTranscriptManifestV1({ ...manifestInput(), captureOperationId: intent.captureOperationId });
    const receipt = receiptForIntent(intent, manifest, prompt, decision.decisionDigest);
    assertTranscriptReceiptManifestV1(receipt, manifest);
    const recorded = recordSessionTranscriptReceiptV1(reconciled, intent, receipt, 3, manifest, decision);
    expect(recorded).toMatchObject({ authorityVersion: 4, headReceiptDigest: receipt.receiptDigest });
    expect(recordSessionTranscriptReceiptV1(recorded, intent, receipt, 3, manifest, decision)).toEqual(recorded);
    expect(sessionEvidenceBoardSummaryV1(recorded)).toMatchObject({ state: "COMPLETE", workflowRef: intent.workflowRef, receiptRef: intent.expectedReceiptRef, manifestRef: intent.expectedManifestRef });
    const otherManifest = createSessionTranscriptManifestV1({ ...manifestInput(), captureOperationId: "capture-operation:other" });
    expect(() => assertTranscriptReceiptManifestV1(receipt, otherManifest)).toThrow(/does not bind/);
    expect(() => recordSessionTranscriptReceiptV1(reconciled, intent, receipt, 3, manifest)).toThrow(/exact Reconcile Decision|required|token-bound Decision/);
    const authorityReplay = JSON.parse(JSON.stringify(recorded)) as Record<string, unknown>;
    authorityReplay["authorityVersion"] = 3;
    expect(() => parseSessionEvidenceAuthorityV1(authorityReplay, recorded.stateDigest)).toThrow(/journal|expected digest|not canonical/);
  });

  it("derives Capture Effect identity from all frozen inputs and forbids Artifact ref aliasing", () => {
    const prompt = promptEnvelope();
    const first = captureIntent(prompt);
    const second = createSessionTranscriptCaptureIntentV1({
      ...captureIntentInput(prompt), enrichmentId: "enrichment:live-other", workflowRef: "restate://TranscriptEnrichmentWorkflow/enrichment:live-other",
      sourceLocatorDigest: sha("f"), expectedNormalizedRef: "artifact://normalized-other", expectedManifestRef: "artifact://manifest-other", expectedReceiptRef: "artifact://receipt-other", expectedRawRef: "artifact://raw-other",
    });
    expect(second.captureOperationId).not.toBe(first.captureOperationId);
    expect(second.captureAttemptId).not.toBe(first.captureAttemptId);
    expect(() => createSessionTranscriptCaptureIntentV1({
      ...captureIntentInput(prompt), expectedRawRef: "artifact://same", expectedNormalizedRef: "artifact://same", expectedManifestRef: "artifact://same", expectedReceiptRef: "artifact://same",
    })).toThrow(/pairwise distinct/);
  });

  it("reserves enrichment Workflow and Artifact targets across Capture Attempts", () => {
    const prompt = promptEnvelope();
    const firstIntent = captureIntent(prompt);
    const initial = createSessionEvidenceAuthorityV1(binding());
    const claimed = claimSessionTranscriptCaptureV1(initial, firstIntent, 0);
    const firstReceipt = unavailableLiveReceipt(firstIntent, prompt);
    const recorded = recordSessionTranscriptReceiptV1(claimed, firstIntent, firstReceipt, 1);
    const validSecondInput = {
      ...captureIntentInput(prompt), captureAttempt: 2, predecessorReceiptDigest: firstReceipt.receiptDigest,
      enrichmentId: "enrichment:attempt-2", workflowRef: "restate://TranscriptEnrichmentWorkflow/enrichment:attempt-2",
      expectedRawRef: "artifact://raw-2", expectedNormalizedRef: "artifact://normalized-2", expectedManifestRef: "artifact://manifest-2", expectedReceiptRef: "artifact://receipt-2",
    } as const;
    const validSecond = createSessionTranscriptCaptureIntentV1(validSecondInput);
    const claimedSecond = claimSessionTranscriptCaptureV1(recorded, validSecond, 2);
    const forgedAuthority = JSON.parse(JSON.stringify(claimedSecond)) as Record<string, unknown>;
    forgedAuthority["activeCapture"] = {
      ...(forgedAuthority["activeCapture"] as Record<string, unknown>), enrichmentId: firstIntent.enrichmentId, workflowRef: firstIntent.workflowRef,
      expectedNormalizedRef: firstIntent.expectedNormalizedRef,
    };
    forgedAuthority["stateDigest"] = contractDigest("session-evidence-authority-v1", withoutKey(forgedAuthority, "stateDigest"));
    expect(() => parseSessionEvidenceAuthorityV1(forgedAuthority, forgedAuthority["stateDigest"] as string)).toThrow(/cross-attempt targets/);
    const reusedWorkflow = createSessionTranscriptCaptureIntentV1({ ...validSecondInput, enrichmentId: firstIntent.enrichmentId, workflowRef: firstIntent.workflowRef });
    expect(() => claimSessionTranscriptCaptureV1(recorded, reusedWorkflow, 2)).toThrow(/unique enrichment Workflow/);
    const reusedArtifact = createSessionTranscriptCaptureIntentV1({ ...validSecondInput, expectedNormalizedRef: firstIntent.expectedNormalizedRef });
    expect(() => claimSessionTranscriptCaptureV1(recorded, reusedArtifact, 2)).toThrow(/cannot reuse/);
  });

  it("requires historical baseline and Provider-observed proof without inventing a legacy Prompt Envelope", () => {
    const observed = createLegacyPromptBindingEvidenceV1({ executionIntentDigest: sha("1"), instructionsDigest: sha("2"), providerPromptRecordDigest: sha("3"), recoveredRenderedPromptDigest: sha("4") });
    const historical = { ...unavailableHistoricalReceipt(), promptBinding: "PROVIDER_NATIVE_OBSERVED" as const, legacyPromptEvidence: observed };
    expect(createSessionTranscriptImportReceiptV1(historical).promptBinding).toBe("PROVIDER_NATIVE_OBSERVED");
    expect(() => createSessionTranscriptImportReceiptV1({ ...historical, legacyPromptEvidence: undefined } as never)).toThrow(/observation evidence/);
    expect(() => createSessionTranscriptImportReceiptV1({ ...historical, historicalBaseline: undefined } as never)).toThrow(/immutable pre-import baseline/);
    const foreignBaseline = createHistoricalEnrichmentBaselineV1({
      ...historicalBaseline(), taskId: "TASK-9999", sourceWorkflowRef: "restate://SealedTaskWorkflow/TASK-9999",
    });
    expect(() => createSessionTranscriptImportReceiptV1({ ...historical, historicalBaseline: foreignBaseline })).toThrow(/exact Receipt source identity/);
  });

});

function promptEnvelopeInput() {
  return {
    taskId: "TASK-0058", sourceWorkflowRef: "restate://SealedTaskWorkflow/TASK-0058", specRevision: 1, generation: 0,
    role: "ARCHITECT" as const, phase: "ARCHITECT" as const, attemptId: "TASK-0058.ARCHITECT.r1.g0", attemptDigest: sha("a"),
    runId: "run:architect:1", operationId: "operation:architect:1", requestDigest: sha("b"), runnerKind: "CODEX_EXEC" as const,
    permission: "READ_ONLY" as const, subjectCommit: commit, capturePolicy: "full" as const,
    renderer: { name: "core-v2-role-prompt", version: "1", optionsDigest: sha("0") }, renderPlan: { separator: "\n\n" },
    segments: [
      { ordinal: 0, kind: "TASK_INPUT" as const, sourceRef: "artifact://task-input", sourceDigest: sha("c"), content: { originalValue: "用户需求", policy: "full" as const } },
      { ordinal: 1, kind: "ROLE_INSTRUCTIONS" as const, content: { originalValue: "设计协议", policy: "full" as const } },
    ],
    renderedPrompt: { originalValue: "用户需求\n\n设计协议", policy: "full" as const }, createdAt: "2026-08-25T00:00:00.000Z",
  };
}

function promptEnvelope() { return createPromptEnvelopeV1(promptEnvelopeInput()); }

function preRunBinding() {
  const { providerSessionId: _session, roleManifestRef: _ref, roleManifestDigest: _digest, ...pre } = binding();
  return pre;
}

function binding(): SessionEvidenceBindingV1 {
  return {
    taskId: "TASK-0058", sourceWorkflowRef: "restate://SealedTaskWorkflow/TASK-0058", specRevision: 1, generation: 0,
    role: "ARCHITECT", phase: "ARCHITECT", attemptId: "TASK-0058.ARCHITECT.r1.g0", attemptDigest: sha("a"),
    runId: "run:architect:1", operationId: "operation:architect:1", requestDigest: sha("b"), runnerKind: "CODEX_EXEC", provider: "CODEX",
    providerSessionId: "019c-1234", roleManifestRef: "artifact://role-manifest", roleManifestDigest: sha("d"),
  };
}

function descriptor(ref: string, digest: string, byteLength: number, mediaType = "application/json") {
  return createArtifactDescriptorV1({ ref, digest, byteLength, mediaType });
}

function locatorInput() {
  return {
    binding: preRunBinding(), stage: "RUNNING" as const, locatorVersion: 1, promptEnvelope: descriptor("artifact://prompt", promptEnvelope().envelopeDigest, 400),
    expectedExecutionEventsRef: "artifact://events", expectedStderrRef: "artifact://stderr", preparedAt: "2026-08-25T00:00:00Z", startedAt: "2026-08-25T00:00:00Z", updatedAt: "2026-08-25T00:00:00Z",
  };
}

function eventInput() {
  return {
    captureId: "session-capture:one", provider: "CODEX" as const, providerSessionId: "codex-session-1", capturePolicy: "full" as const, sequence: 1,
    source: { recordSequence: 1, partIndex: 0, providerType: "event_msg", recordDigest: sha("2") },
    occurredAt: "2026-08-25T00:00:01Z", timestampState: "PROVIDED" as const, category: "PROMPT" as const,
    actor: "USER" as const, origin: "MOYE_RENDERED_PROMPT" as const,
    parts: [{ kind: "TEXT" as const, content: { originalValue: "prompt", policy: "full" as const } }],
  };
}

function artifactInput(first: ReturnType<typeof createNormalizedTimelineEventV1>) {
  return {
    ref: "artifact://normalized", captureId: first.captureId, provider: first.provider, providerSessionId: first.providerSessionId,
    capturePolicy: first.capturePolicy, events: [first], renderedPromptDigest: first.parts[0]!.content.originalDigest,
  };
}

function manifestInput() {
  const optionsDigest = sha("4");
  const captureId = sessionTranscriptCaptureIdV1({ binding: binding(), parserName: "codex-rollout", parserVersion: "1.0.0", optionsDigest, capturePolicy: "full" });
  return {
    captureId, captureOperationId: "capture-operation:one", binding: binding(), capturePolicy: "full" as const, captureState: "COMPLETE" as const,
    parser: { name: "codex-rollout", version: "1.0.0", normalizedSchemaVersion: 1 as const, optionsDigest },
    source: { kind: "CODEX_ROLLOUT_JSONL" as const, sessionId: binding().providerSessionId, locatorDigest: sha("6"), sourceDigest: sha("5"), byteLength: 1234, recordCount: 7, terminalMarkerState: "PRESENT" as const },
    artifacts: { promptEnvelope: descriptor("artifact://prompt", promptEnvelope().envelopeDigest, 400), raw: descriptor("artifact://raw", sha("5"), 1234, "application/x-ndjson"), normalized: descriptor("artifact://normalized", sha("7"), 800, "application/x-ndjson"), stderr: descriptor("artifact://stderr", sha("8"), 10, "text/plain") },
    completeness: { prompt: "COMPLETE" as const, messages: "COMPLETE" as const, tools: "COMPLETE" as const, timestamps: "COMPLETE" as const, hierarchy: "NOT_EXPOSED" as const, raw: "FULL" as const, providerScope: "PROVIDER_EXPOSED" as const },
    metrics: { sourceRecords: 7, normalizedEvents: 6, parseErrors: 0, unknownEvents: 0, droppedEvents: 0 },
    parentSessionIds: [], childSessionIds: [], errors: [], capturedAt: "2026-08-25T00:00:02Z",
  };
}

function transcriptManifest() { return createSessionTranscriptManifestV1(manifestInput()); }

function captureIntent(prompt: ReturnType<typeof promptEnvelope>) {
  return createSessionTranscriptCaptureIntentV1(captureIntentInput(prompt));
}

function captureIntentInput(prompt: ReturnType<typeof promptEnvelope>) {
  return {
    importMode: "LIVE", enrichmentId: "enrichment:live-authority", workflowRef: "restate://TranscriptEnrichmentWorkflow/enrichment:live-authority", captureAttempt: 1, binding: binding(), capturePolicy: "full",
    parser: { name: "codex-rollout", version: "1.0.0", optionsDigest: sha("4") }, sourceLocatorDigest: sha("6"), maxSourceBytes: 2_000_000,
    promptBinding: "PROMPT_ENVELOPE_V1", promptEnvelope: descriptor("artifact://prompt", prompt.envelopeDigest, 400),
    expectedRawRef: "artifact://raw", expectedNormalizedRef: "artifact://normalized", expectedManifestRef: "artifact://manifest", expectedReceiptRef: "artifact://receipt-authority", requestedAt: "2026-08-25T00:00:00Z",
  } as const;
}

function receiptForIntent(intent: ReturnType<typeof captureIntent>, manifest: ReturnType<typeof transcriptManifest>, prompt: ReturnType<typeof promptEnvelope>, reconcileDecisionDigest?: string) {
  return createSessionTranscriptImportReceiptV1({
    enrichmentId: intent.enrichmentId, workflowRef: intent.workflowRef, receiptRef: intent.expectedReceiptRef, importMode: intent.importMode,
    captureOperationId: intent.captureOperationId, captureId: intent.captureId, capturePolicy: intent.capturePolicy,
    parserVersion: intent.parser.version, parserOptionsDigest: intent.parser.optionsDigest, captureIntentDigest: intent.intentDigest, captureAttempt: intent.captureAttempt,
    binding: intent.binding, promptBinding: intent.promptBinding, promptEnvelope: descriptor("artifact://prompt", prompt.envelopeDigest, 400),
    captureState: "COMPLETE", manifest: descriptor("artifact://manifest", manifest.manifestDigest, 900), sourceDigest: manifest.source.sourceDigest,
    errors: [], reconciledAfterUnknown: reconcileDecisionDigest !== undefined,
    ...(reconcileDecisionDigest === undefined ? {} : { reconcileDecisionDigest }),
    startedAt: "2026-08-25T00:00:00Z", finishedAt: "2026-08-25T00:00:02Z", executorId: "worker-1",
  });
}

function unavailableHistoricalReceipt() {
  return {
    enrichmentId: "enrichment:legacy-1", workflowRef: "restate://TranscriptEnrichmentWorkflow/enrichment:legacy-1", receiptRef: "artifact://receipt-legacy", importMode: "HISTORICAL_ENRICHMENT" as const,
    captureOperationId: "capture-operation:legacy-1", captureId: "session-capture:legacy-1", capturePolicy: "digest_only" as const, parserVersion: "1.0.0", parserOptionsDigest: sha("4"), captureIntentDigest: sha("9"), captureAttempt: 1, binding: binding(),
    promptBinding: "UNVERIFIED" as const, historicalBaseline: historicalBaseline(), captureState: "UNAVAILABLE" as const,
    errors: [{ code: "SOURCE_MISSING" as const, scope: "SOURCE" as const, detailDigest: sha("e") }],
    reconciledAfterUnknown: false, startedAt: "2026-08-25T00:00:00Z", finishedAt: "2026-08-25T00:00:01Z", executorId: "worker-1",
  };
}

function unavailableLiveReceipt(intent: ReturnType<typeof captureIntent>, prompt: ReturnType<typeof promptEnvelope>) {
  return createSessionTranscriptImportReceiptV1({
    enrichmentId: intent.enrichmentId, workflowRef: intent.workflowRef, receiptRef: intent.expectedReceiptRef, importMode: "LIVE",
    captureOperationId: intent.captureOperationId, captureId: intent.captureId, capturePolicy: intent.capturePolicy, parserVersion: intent.parser.version,
    parserOptionsDigest: intent.parser.optionsDigest, captureIntentDigest: intent.intentDigest, captureAttempt: intent.captureAttempt, binding: intent.binding,
    promptBinding: "PROMPT_ENVELOPE_V1", promptEnvelope: descriptor("artifact://prompt", prompt.envelopeDigest, 400), captureState: "UNAVAILABLE",
    errors: [{ code: "SOURCE_MISSING", scope: "SOURCE", detailDigest: sha("e") }], reconciledAfterUnknown: false,
    startedAt: "2026-08-25T00:00:00Z", finishedAt: "2026-08-25T00:00:01Z", executorId: "worker-1",
  });
}

function historicalBaseline() {
  return createHistoricalEnrichmentBaselineV1({
    taskId: binding().taskId, sourceWorkflowRef: binding().sourceWorkflowRef, runId: binding().runId, roleManifestDigest: binding().roleManifestDigest,
    workflowProjectionDigest: sha("1"), domainEventHistoryDigest: sha("2"), roleManifestSnapshotDigest: sha("3"),
    outcome: "SUCCEEDED" as const, archiveStatus: "ARCHIVED" as const, observedAt: "2026-08-25T00:00:00.000Z",
  });
}

function contractDigest(namespace: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(`${namespace}:${JSON.stringify(sortJson(value))}`, "utf8").digest("hex")}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortJson(item)]));
  return value;
}

function withoutKey(input: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([name]) => name !== key));
}
