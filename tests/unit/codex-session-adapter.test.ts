import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_SESSION_PARSER_V1,
  CodexNativeSessionAdapterV1,
  codexSessionSourceLocatorDigestV1,
  readManagedCodexSessionV1,
} from "../../src/agent/codex-session-adapter.js";
import {
  createArtifactDescriptorV1,
  createPromptEnvelopeV1,
  createSessionTranscriptCaptureIntentV1,
  sessionTranscriptCaptureIdV1,
} from "../../src/domain/session-transcript.js";
import type { SessionEvidenceBindingV1 } from "../../src/domain/session-transcript.js";

const roots: string[] = [];
const threadId = "01a03967-052b-7970-a14a-421a78ed6698";
const promptText = "需求输入\n\n只读分析并返回结构化结论";

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("CodexNativeSessionAdapterV1", () => {
  it("captures a complete real-format rollout and remains readable after the Provider source moves", async () => {
    const fixture = await setup();
    const sourcePath = await writeRollout(fixture.sessionsRoot, threadId, completeRollout());
    const { prompt, intent } = contract();
    const adapter = new CodexNativeSessionAdapterV1({ providerSessionsRoot: fixture.sessionsRoot, managedArtifactRoot: fixture.artifactRoot });

    const captured = await adapter.capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" });
    expect(captured.manifest).toMatchObject({ captureState: "COMPLETE", capturePolicy: "full" });
    expect(captured.manifest.binding.providerSessionId).toBe(threadId);
    expect(captured.timeline.filter((event) => event.category === "PROMPT")).toHaveLength(1);
    expect(captured.timeline.some((event) => event.category === "ASSISTANT")).toBe(true);
    expect(captured.timeline.some((event) => event.category === "TOOL_CALL")).toBe(true);
    expect(captured.timeline.some((event) => event.category === "TOOL_RESULT")).toBe(true);
    expect(captured.manifest.childSessionIds).toEqual(["child-thread-1"]);

    const replay = await adapter.capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" });
    expect(replay.manifest.manifestDigest).toBe(captured.manifest.manifestDigest);

    await rename(sourcePath, `${sourcePath}.moved`);
    const managed = await readManagedCodexSessionV1({ managedArtifactRoot: fixture.artifactRoot, captureId: intent.captureId, manifestDigest: captured.manifest.manifestDigest });
    expect(managed.manifest).toEqual(captured.manifest);
    expect(managed.timeline).toEqual(captured.timeline);
  });

  it("fails closed for malformed JSONL, source limits, and a mismatched first session_meta", async () => {
    for (const scenario of [
      { bytes: `${completeRollout()}not-json\n`, max: 1_000_000, message: /malformed JSON/ },
      { bytes: completeRollout(), max: 4, message: /exceeds maxSourceBytes/ },
      { bytes: completeRollout().replace(threadId, "wrong-thread"), max: 1_000_000, message: /confirm the expected thread_id/ },
    ]) {
      const fixture = await setup();
      await writeRollout(fixture.sessionsRoot, threadId, scenario.bytes);
      const { prompt, intent } = contract(scenario.max);
      const adapter = new CodexNativeSessionAdapterV1({ providerSessionsRoot: fixture.sessionsRoot, managedArtifactRoot: fixture.artifactRoot });
      await expect(adapter.capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" })).rejects.toThrow(scenario.message);
    }
  });

  it("rejects symlinks anywhere below the allowlisted Provider root", async () => {
    const fixture = await setup();
    const outside = path.join(fixture.root, "outside.jsonl");
    await writeFile(outside, completeRollout());
    const day = path.join(fixture.sessionsRoot, "2026", "08", "25");
    await mkdir(day, { recursive: true });
    await symlink(outside, path.join(day, `rollout-${threadId}.jsonl`));
    const { prompt, intent } = contract();
    const adapter = new CodexNativeSessionAdapterV1({ providerSessionsRoot: fixture.sessionsRoot, managedArtifactRoot: fixture.artifactRoot });
    await expect(adapter.capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" })).rejects.toThrow(/Symlink is forbidden/);
  });

  it("rejects ambiguous thread sources and content conflicts in managed Artifacts", async () => {
    const fixture = await setup();
    await writeRollout(fixture.sessionsRoot, threadId, completeRollout(), "25");
    await writeRollout(fixture.sessionsRoot, threadId, completeRollout(), "26");
    const { prompt, intent } = contract();
    const adapter = new CodexNativeSessionAdapterV1({ providerSessionsRoot: fixture.sessionsRoot, managedArtifactRoot: fixture.artifactRoot });
    await expect(adapter.capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" })).rejects.toThrow(/Multiple Codex rollouts/);
  });

  it("matches the rendered Prompt by original digest when digest_only intentionally omits its body", async () => {
    const fixture = await setup();
    await writeRollout(fixture.sessionsRoot, threadId, completeRollout());
    const { prompt, intent } = contract(1_000_000, "digest_only");
    expect(prompt.renderedPrompt).not.toHaveProperty("storedValue");
    const captured = await new CodexNativeSessionAdapterV1({ providerSessionsRoot: fixture.sessionsRoot, managedArtifactRoot: fixture.artifactRoot })
      .capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" });
    expect(captured.manifest.completeness.raw).toBe("OMITTED_BY_POLICY");
    expect(captured.managedPaths).not.toHaveProperty("raw");
    expect(captured.timeline.find((event) => event.category === "PROMPT")?.parts[0]?.content).not.toHaveProperty("storedValue");
  });

  it("parses current Codex item_completed and response_item message records as dialogue", async () => {
    const fixture = await setup();
    await writeRollout(fixture.sessionsRoot, threadId, currentCodexRollout());
    const { prompt, intent } = contract();
    const captured = await new CodexNativeSessionAdapterV1({ providerSessionsRoot: fixture.sessionsRoot, managedArtifactRoot: fixture.artifactRoot })
      .capture({ intent, promptEnvelope: prompt, capturedAt: "2026-08-25T17:30:00.000Z" });
    expect(captured.manifest.captureState).toBe("COMPLETE");
    expect(captured.manifest.completeness.messages).toBe("COMPLETE");
    expect(captured.timeline.some((event) => event.category === "ASSISTANT" && event.parts[0]?.content.storedValue === "完成")).toBe(true);
  });
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-codex-session-"));
  roots.push(root);
  const sessionsRoot = path.join(root, "sessions");
  const artifactRoot = path.join(root, "artifacts");
  await mkdir(sessionsRoot);
  return { root, sessionsRoot, artifactRoot };
}

async function writeRollout(sessionsRoot: string, id: string, content: string, day = "25") {
  const directory = path.join(sessionsRoot, "2026", "08", day);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `rollout-2026-08-${day}T17-00-00-${id}.jsonl`);
  await writeFile(target, content);
  return target;
}

function completeRollout(): string {
  const rows = [
    { timestamp: "2026-08-25T17:00:00.000Z", type: "session_meta", payload: { id: threadId, timestamp: "2026-08-25T17:00:00.000Z", cwd: "/managed/worktree", thread_source: "user", model_provider: "openai" } },
    { timestamp: "2026-08-25T17:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: promptText }] } },
    { timestamp: "2026-08-25T17:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: promptText } },
    { timestamp: "2026-08-25T17:00:02.000Z", type: "event_msg", payload: { type: "agent_message", message: "开始检查", phase: "commentary" } },
    { timestamp: "2026-08-25T17:00:03.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"git status --short\"}", call_id: "call-1" } },
    { timestamp: "2026-08-25T17:00:04.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "clean" } },
    { timestamp: "2026-08-25T17:00:05.000Z", type: "event_msg", payload: { type: "sub_agent_activity", agent_thread_id: "child-thread-1", kind: "started" } },
    { timestamp: "2026-08-25T17:00:06.000Z", type: "event_msg", payload: { type: "agent_message", message: "完成", phase: "final_answer" } },
    { timestamp: "2026-08-25T17:00:07.000Z", type: "event_msg", payload: { type: "task_complete", turn_id: "turn-1", completed_at: 1787677207 } },
  ];
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function currentCodexRollout(): string {
  const rows = [
    { timestamp: "2026-08-25T17:00:00.000Z", type: "session_meta", payload: { id: threadId } },
    { timestamp: "2026-08-25T17:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: promptText }] } },
    { timestamp: "2026-08-25T17:00:02.000Z", type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: promptText }] } } },
    { timestamp: "2026-08-25T17:00:03.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "完成" }] } },
    { timestamp: "2026-08-25T17:00:04.000Z", type: "event_msg", payload: { type: "item_completed", item: { type: "AgentMessage", content: [{ type: "Text", text: "完成" }] } } },
    { timestamp: "2026-08-25T17:00:05.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 10 } } } },
    { timestamp: "2026-08-25T17:00:06.000Z", type: "event_msg", payload: { type: "task_complete" } },
  ];
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function contract(maxSourceBytes = 1_000_000, capturePolicy: "full" | "digest_only" = "full") {
  const binding: SessionEvidenceBindingV1 = {
    taskId: "TASK-0059", sourceWorkflowRef: "restate://SealedTaskWorkflow/TASK-0059", specRevision: 1, generation: 0,
    role: "ARCHITECT", phase: "ARCHITECT", attemptId: "TASK-0059.ARCHITECT.r1.g0", attemptDigest: sha("a"),
    runId: "run:codex-session-product", operationId: "operation:codex-session-product", requestDigest: sha("b"),
    runnerKind: "CODEX_EXEC", provider: "CODEX", providerSessionId: threadId,
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
  const captureId = sessionTranscriptCaptureIdV1({ binding, parserName: CODEX_SESSION_PARSER_V1.name, parserVersion: CODEX_SESSION_PARSER_V1.version, optionsDigest: CODEX_SESSION_PARSER_V1.optionsDigest, capturePolicy });
  const intent = createSessionTranscriptCaptureIntentV1({
    importMode: "LIVE", enrichmentId: "enrichment:codex-session-product", workflowRef: "restate://TranscriptEnrichmentWorkflow/enrichment:codex-session-product",
    captureAttempt: 1, binding, capturePolicy, parser: CODEX_SESSION_PARSER_V1,
    sourceLocatorDigest: codexSessionSourceLocatorDigestV1(threadId), maxSourceBytes, promptBinding: "PROMPT_ENVELOPE_V1", promptEnvelope: promptDescriptor,
    ...(capturePolicy === "full" ? { expectedRawRef: `artifact://session/${captureId}/raw` } : {}), expectedNormalizedRef: `artifact://session/${captureId}/normalized`,
    expectedManifestRef: `artifact://session/${captureId}/manifest`, expectedReceiptRef: `artifact://session/${captureId}/receipt`, requestedAt: "2026-08-25T17:00:08.000Z",
  });
  return { prompt, intent };
}

function sha(letter: string): string {
  return `sha256:${letter.repeat(64)}`;
}
