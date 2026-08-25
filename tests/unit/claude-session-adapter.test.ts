import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CLAUDE_SESSION_PARSER_V1,
  ClaudeNativeSessionAdapterV1,
  claudeSessionSourceLocatorDigestV1,
  readManagedClaudeSessionV1,
} from "../../src/agent/claude-session-adapter.js";
import {
  createArtifactDescriptorV1,
  createPromptEnvelopeV1,
  createSessionTranscriptCaptureIntentV1,
  sessionTranscriptCaptureIdV1,
} from "../../src/domain/session-transcript.js";
import type { SessionEvidenceBindingV1 } from "../../src/domain/session-transcript.js";

const roots: string[] = [];
const sessionId = "01a03967-052b-7970-a14a-421a78ed6698";
const promptText = "需求输入\n\n只读分析并返回结构化结论";

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("ClaudeNativeSessionAdapterV1", () => {
  it("captures a complete real-format session and remains readable after the Provider source moves", async () => {
    const fixture = await setup();
    const sourcePath = await writeSession(fixture.sessionsRoot, sessionId, completeSession());
    const { prompt, intent } = contract();
    const adapter = new ClaudeNativeSessionAdapterV1({ providerSessionsRoot: fixture.sessionsRoot, managedArtifactRoot: fixture.artifactRoot });

    const captured = await adapter.capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" });
    expect(captured.manifest).toMatchObject({ captureState: "COMPLETE", capturePolicy: "full" });
    expect(captured.manifest.binding.providerSessionId).toBe(sessionId);
    expect(captured.timeline.filter((event) => event.category === "PROMPT")).toHaveLength(1);
    expect(captured.timeline.some((event) => event.category === "ASSISTANT")).toBe(true);
    expect(captured.timeline.some((event) => event.category === "TOOL_CALL")).toBe(true);
    expect(captured.timeline.some((event) => event.category === "TOOL_RESULT")).toBe(true);
    expect(captured.manifest.childSessionIds).toEqual(["claude-agent:agent-child-1"]);
    expect(captured.timeline.find((event) => event.category === "TOOL_RESULT")?.actor).toBe("TOOL");
    expect(captured.timeline.some((event) => event.category === "SYSTEM" && event.parts[0]?.content.storedValue?.includes("claude-sonnet"))).toBe(true);

    const replay = await adapter.capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" });
    expect(replay.manifest.manifestDigest).toBe(captured.manifest.manifestDigest);

    await rename(sourcePath, `${sourcePath}.moved`);
    const managed = await readManagedClaudeSessionV1({ managedArtifactRoot: fixture.artifactRoot, captureId: intent.captureId, manifestDigest: captured.manifest.manifestDigest });
    expect(managed.manifest).toEqual(captured.manifest);
    expect(managed.timeline).toEqual(captured.timeline);
  });

  it("fails closed for malformed JSONL, source limits, and mismatched session identity", async () => {
    for (const scenario of [
      { bytes: `${completeSession()}not-json\n`, max: 1_000_000, message: /malformed JSON/ },
      { bytes: completeSession(), max: 4, message: /exceeds maxSourceBytes/ },
      { bytes: completeSession().replaceAll(sessionId, "wrong-session"), max: 1_000_000, message: /confirm the expected sessionId/ },
    ]) {
      const fixture = await setup();
      await writeSession(fixture.sessionsRoot, sessionId, scenario.bytes);
      const { prompt, intent } = contract(scenario.max);
      const adapter = new ClaudeNativeSessionAdapterV1({ providerSessionsRoot: fixture.sessionsRoot, managedArtifactRoot: fixture.artifactRoot });
      await expect(adapter.capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" })).rejects.toThrow(scenario.message);
    }
  });

  it("rejects symlinks anywhere below the allowlisted Provider root", async () => {
    const fixture = await setup();
    const outside = path.join(fixture.root, "outside.jsonl");
    await writeFile(outside, completeSession());
    const day = path.join(fixture.sessionsRoot, "2026", "08", "25");
    await mkdir(day, { recursive: true });
    await symlink(outside, path.join(day, `${sessionId}.jsonl`));
    const { prompt, intent } = contract();
    const adapter = new ClaudeNativeSessionAdapterV1({ providerSessionsRoot: fixture.sessionsRoot, managedArtifactRoot: fixture.artifactRoot });
    await expect(adapter.capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" })).rejects.toThrow(/Symlink is forbidden/);
  });

  it("rejects ambiguous thread sources and content conflicts in managed Artifacts", async () => {
    const fixture = await setup();
    await writeSession(fixture.sessionsRoot, sessionId, completeSession(), "25");
    await writeSession(fixture.sessionsRoot, sessionId, completeSession(), "26");
    const { prompt, intent } = contract();
    const adapter = new ClaudeNativeSessionAdapterV1({ providerSessionsRoot: fixture.sessionsRoot, managedArtifactRoot: fixture.artifactRoot });
    await expect(adapter.capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" })).rejects.toThrow(/Multiple Claude sessions/);
  });

  it("matches the rendered Prompt by original digest when digest_only intentionally omits its body", async () => {
    const fixture = await setup();
    await writeSession(fixture.sessionsRoot, sessionId, completeSession());
    const { prompt, intent } = contract(1_000_000, "digest_only");
    expect(prompt.renderedPrompt).not.toHaveProperty("storedValue");
    const captured = await new ClaudeNativeSessionAdapterV1({ providerSessionsRoot: fixture.sessionsRoot, managedArtifactRoot: fixture.artifactRoot })
      .capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" });
    expect(captured.manifest.completeness.raw).toBe("OMITTED_BY_POLICY");
    expect(captured.managedPaths).not.toHaveProperty("raw");
    expect(captured.timeline.find((event) => event.category === "PROMPT")?.parts[0]?.content).not.toHaveProperty("storedValue");
  });
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-claude-session-"));
  roots.push(root);
  const sessionsRoot = path.join(root, "sessions");
  const artifactRoot = path.join(root, "artifacts");
  await mkdir(sessionsRoot);
  return { root, sessionsRoot, artifactRoot };
}

async function writeSession(sessionsRoot: string, id: string, content: string, day = "25") {
  const directory = path.join(sessionsRoot, "2026", "08", day);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${id}.jsonl`);
  await writeFile(target, content);
  return target;
}

function completeSession(): string {
  const rows = [
    { type: "permission-mode", permissionMode: "plan", sessionId },
    { parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content: promptText }, uuid: "user-1", timestamp: "2026-08-25T17:00:01.000Z", sessionId, version: "2.1.104" },
    { parentUuid: "user-1", isSidechain: false, type: "assistant", message: { role: "assistant", model: "claude-sonnet", content: [{ type: "thinking", thinking: "先检查" }], stop_reason: "tool_use" }, uuid: "assistant-1", timestamp: "2026-08-25T17:00:02.000Z", sessionId },
    { parentUuid: "assistant-1", isSidechain: false, type: "assistant", message: { role: "assistant", model: "claude-sonnet", content: [{ type: "tool_use", id: "call-1", name: "Bash", input: { command: "git status --short" } }], stop_reason: "tool_use" }, uuid: "assistant-2", timestamp: "2026-08-25T17:00:03.000Z", sessionId },
    { parentUuid: "assistant-2", isSidechain: false, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "clean", is_error: false }] }, uuid: "tool-result-1", timestamp: "2026-08-25T17:00:04.000Z", sessionId },
    { parentUuid: "tool-result-1", isSidechain: true, agentId: "agent-child-1", type: "assistant", message: { role: "assistant", model: "claude-haiku", content: [{ type: "text", text: "子任务事实" }], stop_reason: "end_turn" }, uuid: "assistant-child", timestamp: "2026-08-25T17:00:05.000Z", sessionId },
    { parentUuid: "assistant-child", isSidechain: false, type: "assistant", message: { role: "assistant", model: "claude-sonnet", content: [{ type: "text", text: "完成" }], stop_reason: "end_turn" }, uuid: "assistant-final", timestamp: "2026-08-25T17:00:06.000Z", sessionId },
    { parentUuid: "assistant-final", type: "system", subtype: "turn_duration", durationMs: 6000, uuid: "system-final", timestamp: "2026-08-25T17:00:07.000Z", sessionId },
  ];
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function contract(maxSourceBytes = 1_000_000, capturePolicy: "full" | "digest_only" = "full") {
  const binding: SessionEvidenceBindingV1 = {
    taskId: "TASK-0060", sourceWorkflowRef: "restate://SealedTaskWorkflow/TASK-0060", specRevision: 1, generation: 0,
    role: "ARCHITECT", phase: "ARCHITECT", attemptId: "TASK-0060.ARCHITECT.r1.g0", attemptDigest: sha("a"),
    runId: "run:claude-session-product", operationId: "operation:claude-session-product", requestDigest: sha("b"),
    runnerKind: "CLAUDE_PRINT", provider: "CLAUDE", providerSessionId: sessionId,
    roleManifestRef: "artifact://role-manifest", roleManifestDigest: sha("d"),
  };
  const prompt = createPromptEnvelopeV1({
    taskId: binding.taskId, sourceWorkflowRef: binding.sourceWorkflowRef, specRevision: binding.specRevision, generation: binding.generation,
    role: binding.role, phase: binding.phase, attemptId: binding.attemptId, attemptDigest: binding.attemptDigest, runId: binding.runId,
    operationId: binding.operationId, requestDigest: binding.requestDigest, runnerKind: binding.runnerKind, permission: "READ_ONLY",
    subjectCommit: "a".repeat(40), capturePolicy, renderer: { name: "core-v2-role-prompt", version: "1", optionsDigest: sha("0") },
    renderPlan: { separator: "\n\n" }, segments: [
      { ordinal: 0, kind: "TASK_INPUT", content: { originalValue: "需求输入", policy: capturePolicy } },
      { ordinal: 1, kind: "ROLE_INSTRUCTIONS", content: { originalValue: "只读分析并返回结构化结论", policy: capturePolicy } },
    ], renderedPrompt: { originalValue: promptText, policy: capturePolicy }, createdAt: "2026-08-25T16:59:59.000Z",
  });
  const promptDescriptor = createArtifactDescriptorV1({ ref: "artifact://prompt-envelope", digest: prompt.envelopeDigest, byteLength: Buffer.byteLength(JSON.stringify(prompt)), mediaType: "application/json" });
  const captureId = sessionTranscriptCaptureIdV1({ binding, parserName: CLAUDE_SESSION_PARSER_V1.name, parserVersion: CLAUDE_SESSION_PARSER_V1.version, optionsDigest: CLAUDE_SESSION_PARSER_V1.optionsDigest, capturePolicy });
  const intent = createSessionTranscriptCaptureIntentV1({
    importMode: "LIVE", enrichmentId: "enrichment:claude-session-product", workflowRef: "restate://TranscriptEnrichmentWorkflow/enrichment:claude-session-product",
    captureAttempt: 1, binding, capturePolicy, parser: CLAUDE_SESSION_PARSER_V1,
    sourceLocatorDigest: claudeSessionSourceLocatorDigestV1(sessionId), maxSourceBytes, promptBinding: "PROMPT_ENVELOPE_V1", promptEnvelope: promptDescriptor,
    ...(capturePolicy === "full" ? { expectedRawRef: `artifact://session/${captureId}/raw` } : {}), expectedNormalizedRef: `artifact://session/${captureId}/normalized`,
    expectedManifestRef: `artifact://session/${captureId}/manifest`, expectedReceiptRef: `artifact://session/${captureId}/receipt`, requestedAt: "2026-08-25T17:00:08.000Z",
  });
  return { prompt, intent };
}

function sha(letter: string): string {
  return `sha256:${letter.repeat(64)}`;
}
