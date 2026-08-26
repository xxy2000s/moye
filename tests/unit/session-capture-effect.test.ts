import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RealRoleRuntimeV2, prepareRealRoleRunV2 } from "../../src/agent/role-runtime-v2.js";
import {
  advanceAndPersistLiveRoleLocatorV1,
  captureHistoricalRoleSessionV1,
  captureLiveRoleSessionV1,
  prepareLiveRoleSessionEvidenceV1,
} from "../../src/agent/session-capture-effect.js";
import { createRoleAttemptV2, renderRoleAgentPromptV2, startRoleAttemptV2 } from "../../src/domain/role-runtime-v2.js";
import {
  claimSessionTranscriptCaptureV1,
  createHistoricalEnrichmentBaselineV1,
  createSessionEvidenceAuthorityV1,
  createSessionEvidenceBindingFromRoleManifestV2,
  recordSessionTranscriptReceiptV1,
  sessionEvidenceBoardSummaryV1,
} from "../../src/domain/session-transcript.js";
import {
  readBoardSessionMetadataV1,
  readBoardSessionStderrV1,
  readBoardSessionTimelinePageV1,
} from "../../src/board/session-timeline.js";

const roots: string[] = [];
const taskId = "TASK-0061";
const sessionId = "01a03ae6-3d1f-7c39-a98a-311a0b4a9610";
const commit = "6".repeat(40);

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("live Role Session Capture Effect", () => {
  it("persists Prompt before Agent execution and recovers a lost capture receipt without a second Agent run", async () => {
    const fixture = await setup();
    const attempt = startRoleAttemptV2(createRoleAttemptV2({
      taskId, specRevision: 1, role: "ARCHITECT", phase: "ARCHITECT", generation: 0, runnerKind: "CODEX_EXEC",
      inputDigest: sha("1"), subjectCommit: commit, inputArtifactRefs: ["artifact://spec"],
      scheduledAt: "2026-08-25T18:00:00.000Z",
    }), "2026-08-25T18:00:01.000Z");
    const instructions = "Inspect the repository and return a real structured result.";
    const roleInput = { attempt, scopeRoot: fixture.scope, artifactRoot: fixture.roles, instructions };
    const request = await prepareRealRoleRunV2(roleInput);
    const prepared = await prepareLiveRoleSessionEvidenceV1({
      request,
      sourceWorkflowRef: `restate://CoreV2Workflow/${taskId}`,
      capturePolicy: "full",
      createdAt: "2026-08-25T18:00:02.000Z",
    });
    expect(JSON.parse(await readFile(prepared.promptEnvelopePath, "utf8"))).toMatchObject({ artifactKind: "PROMPT_ENVELOPE" });
    expect(prepared.locator.stage).toBe("PREPARED");
    const runningLocator = await advanceAndPersistLiveRoleLocatorV1({
      runRoot: request.runRoot,
      current: prepared.locator,
      stage: "RUNNING",
      updatedAt: "2026-08-25T18:00:03.000Z",
    });

    let agentRuns = 0;
    const runtime = new RealRoleRuntimeV2({
      processRunner: {
        async run() {
          agentRuns += 1;
          return {
            stdout: [
              JSON.stringify({ type: "thread.started", thread_id: sessionId }),
              JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: ["git", "status"] } }),
              JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ summary: "complete", recommendation: "PASS", artifactRefs: [], findingRefs: [], deliverable: "{}" }) } }),
              JSON.stringify({ type: "turn.completed" }),
              "",
            ].join("\n"),
            stderr: "diagnostic stderr",
            exitCode: 0,
            signal: null,
          };
        },
      },
    });
    const role = await runtime.run(roleInput);
    const agentCompleted = await advanceAndPersistLiveRoleLocatorV1({
      runRoot: request.runRoot,
      current: runningLocator,
      stage: "AGENT_COMPLETED",
      providerSessionId: sessionId,
      updatedAt: "2026-08-25T18:00:04.000Z",
    });
    const capturePending = await advanceAndPersistLiveRoleLocatorV1({
      runRoot: request.runRoot,
      current: agentCompleted,
      stage: "CAPTURE_PENDING",
      updatedAt: "2026-08-25T18:00:05.000Z",
    });
    expect(capturePending.providerSessionId).toBe(sessionId);

    const prompt = renderRoleAgentPromptV2({ role: attempt.role, phase: attempt.phase, instructions, permission: attempt.permission });
    const sourcePath = await writeRollout(fixture.sessions, prompt);
    const captureInput = {
      sourceWorkflowRef: `restate://CoreV2Workflow/${taskId}`,
      roleManifest: role.manifest,
      promptEnvelope: prepared.promptEnvelope,
      promptEnvelopeDescriptor: prepared.promptEnvelopeDescriptor,
      managedArtifactRoot: fixture.sessionArtifacts,
      config: { capturePolicy: "full" as const, codexSessionsRoot: fixture.sessions },
      requestedAt: "2026-08-25T18:00:06.000Z",
      capturedAt: "2026-08-25T18:00:07.000Z",
      startedAt: "2026-08-25T18:00:06.000Z",
      finishedAt: "2026-08-25T18:00:08.000Z",
      executorId: "worker:TASK-0061",
    };
    await expect(captureLiveRoleSessionV1({
      ...captureInput,
      afterManifest: async () => { throw new Error("controlled lost acknowledgement"); },
    })).rejects.toThrow(/controlled lost acknowledgement/);
    await rename(sourcePath, `${sourcePath}.moved`);

    const recovered = await captureLiveRoleSessionV1(captureInput);
    const replay = await captureLiveRoleSessionV1(captureInput);
    expect(recovered.recovery).toBe("RECOVERED_MANIFEST");
    expect(replay.recovery).toBe("REUSED_RECEIPT");
    expect(replay.receipt.receiptDigest).toBe(recovered.receipt.receiptDigest);
    expect(recovered.summary).toMatchObject({ state: "COMPLETE", providerSessionId: sessionId });
    expect(recovered.receipt.authorityScope).toBe("DIAGNOSTIC_SUPPLEMENT_ONLY");
    expect(agentRuns).toBe(1);
    expect(role.manifest.eventsRef).toBe(capturePending.expectedExecutionEventsRef);
    expect(role.manifest.stderrRef).toBe(capturePending.expectedStderrRef);

    const evidence = {
      attemptId: role.manifest.attemptId,
      runId: role.manifest.runId,
      promptEnvelope: prepared.promptEnvelopeDescriptor,
      locator: capturePending,
      executionEventsRef: role.manifest.eventsRef,
      stderrRef: role.manifest.stderrRef,
      authority: recovered.authority,
      receipt: recovered.receipt,
      summary: recovered.summary,
    };
    const resolver = {
      artifactRoots: [fixture.root],
      declaredArtifactRoot: fixture.taskArtifacts,
      taskId,
      run: role.manifest,
      evidence,
    };
    const metadata = await readBoardSessionMetadataV1(resolver);
    expect(metadata).toMatchObject({
      state: "COMPLETE",
      semantics: {
        availability: { state: "AVAILABLE" },
        content: { evaluated: true, state: "COMPLETE", reasons: [] },
        binding: { state: "VERIFIED" },
        limitation: { state: "NONE" },
      },
      provider: "CODEX",
      providerSessionId: sessionId,
      source: { kind: "CODEX_ROLLOUT_JSONL" },
      relationships: { parentSessionIds: [], childSessionIds: [] },
      capturedAt: "2026-08-25T18:00:07.000Z",
    });
    expect(metadata.artifacts).toHaveProperty("raw");
    const firstPage = await readBoardSessionTimelinePageV1({ ...resolver, cursor: 0, limit: 2 });
    const secondPage = await readBoardSessionTimelinePageV1({ ...resolver, cursor: firstPage.nextCursor, limit: 200 });
    expect(firstPage).toMatchObject({ cursor: 0, nextCursor: 2, hasMore: true, completed: true });
    expect([...firstPage.events, ...secondPage.events]).toHaveLength(firstPage.total);
    expect([...firstPage.events, ...secondPage.events].some((event) => event.category === "PROMPT")).toBe(true);
    expect((await readBoardSessionStderrV1(resolver)).content).toBe("diagnostic stderr");

    const { authority: _authority, receipt: _receipt, summary: _summary, ...pendingEvidence } = evidence;
    expect(await readBoardSessionMetadataV1({ ...resolver, evidence: pendingEvidence })).toMatchObject({
      state: "PENDING",
      semantics: { availability: { state: "PENDING" }, content: { evaluated: false }, binding: { state: "NOT_APPLICABLE" } },
    });
    await expect(readBoardSessionTimelinePageV1({ ...resolver, evidence: pendingEvidence, cursor: 0, limit: 20 }))
      .rejects.toMatchObject({ code: "SESSION_CAPTURE_PENDING", status: 409 });
  });

  it("captures append-only historical Provider evidence, exposes it through the Board resolver, and records missing sources", async () => {
    const fixture = await setup();
    const attempt = startRoleAttemptV2(createRoleAttemptV2({
      taskId, specRevision: 1, role: "ARCHITECT", phase: "ARCHITECT", generation: 0, runnerKind: "CODEX_EXEC",
      inputDigest: sha("2"), subjectCommit: commit, inputArtifactRefs: ["artifact://spec"],
      scheduledAt: "2026-08-25T19:00:00.000Z",
    }), "2026-08-25T19:00:01.000Z");
    const roleInput = { attempt, scopeRoot: fixture.scope, artifactRoot: fixture.roles, instructions: "Historical role" };
    const role = await new RealRoleRuntimeV2({
      processRunner: { async run() { return {
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: sessionId }),
          JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ summary: "done", recommendation: "PASS", artifactRefs: [], findingRefs: [], deliverable: "{}" }) } }),
          JSON.stringify({ type: "turn.completed" }), "",
        ].join("\n"),
        stderr: "historical stderr", exitCode: 0, signal: null,
      }; } },
    }).run(roleInput);
    await writeRollout(fixture.sessions, "legacy Provider prompt");
    const sourceWorkflowRef = `restate://CoreV2Workflow/${taskId}`;
    const baseline = createHistoricalEnrichmentBaselineV1({
      taskId,
      sourceWorkflowRef,
      runId: role.manifest.runId,
      roleManifestDigest: role.manifest.manifestDigest,
      workflowProjectionDigest: sha("3"),
      domainEventHistoryDigest: sha("4"),
      roleManifestSnapshotDigest: sha("5"),
      outcome: "SUCCEEDED",
      archiveStatus: "ARCHIVED",
      observedAt: "2026-08-25T19:00:02.000Z",
    });
    const historicalRoot = path.join(fixture.root, "historical-session-evidence");
    const input = {
      enrichmentId: "history:TASK-0061:architect",
      sourceWorkflowRef,
      roleManifest: role.manifest,
      historicalBaseline: baseline,
      captureAttempt: 1,
      promptBinding: "UNVERIFIED" as const,
      managedArtifactRoot: historicalRoot,
      config: { capturePolicy: "full" as const, codexSessionsRoot: fixture.sessions },
      requestedAt: "2026-08-25T19:00:03.000Z",
      capturedAt: "2026-08-25T19:00:03.000Z",
      startedAt: "2026-08-25T19:00:03.000Z",
      finishedAt: "2026-08-25T19:00:03.000Z",
      executorId: "history-worker:TASK-0061",
    };
    const captured = await captureHistoricalRoleSessionV1(input);
    const replay = await captureHistoricalRoleSessionV1(input);
    expect(captured).toMatchObject({ recovery: "EXECUTED", receipt: { importMode: "HISTORICAL_ENRICHMENT", captureState: "PARTIAL", promptBinding: "UNVERIFIED", errors: [{ code: "UNSUPPORTED_FORMAT" }] } });
    expect(replay).toMatchObject({ recovery: "REUSED_RECEIPT", receipt: { receiptDigest: captured.receipt.receiptDigest } });

    if (captured.manifest === undefined) throw new Error("expected historical Manifest");
    const binding = createSessionEvidenceBindingFromRoleManifestV2({ sourceWorkflowRef, manifest: role.manifest });
    const claimed = claimSessionTranscriptCaptureV1(createSessionEvidenceAuthorityV1(binding), captured.intent, 0);
    const authority = recordSessionTranscriptReceiptV1(claimed, captured.intent, captured.receipt, 1, captured.manifest);
    const historicalEvidence = {
      schemaVersion: 1 as const,
      taskId,
      attemptId: role.manifest.attemptId,
      runId: role.manifest.runId,
      taskArtifactRoot: fixture.taskArtifacts,
      managedArtifactRoot: historicalRoot,
      authority,
      intent: captured.intent,
      receipt: captured.receipt,
      manifest: captured.manifest,
      summary: sessionEvidenceBoardSummaryV1(authority),
      recordDigest: sha("6"),
    };
    const resolver = { artifactRoots: [fixture.root], declaredArtifactRoot: fixture.taskArtifacts, taskId, run: role.manifest, historicalEvidence };
    expect(await readBoardSessionMetadataV1(resolver)).toMatchObject({
      state: "PARTIAL",
      provider: "CODEX",
      providerSessionId: sessionId,
      semantics: {
        availability: { state: "AVAILABLE" },
        content: { evaluated: true, state: "COMPLETE", reasons: [] },
        binding: { state: "UNVERIFIED" },
        limitation: { state: "NONE" },
      },
    });
    const timeline = await readBoardSessionTimelinePageV1({ ...resolver, cursor: 0, limit: 200 });
    expect(timeline.events.some((event) => event.category === "USER" && event.origin === "PROVIDER_USER")).toBe(true);
    expect((await readBoardSessionStderrV1(resolver)).content).toBe("historical stderr");

    const missing = await captureHistoricalRoleSessionV1({
      ...input,
      enrichmentId: "history:TASK-0061:architect-missing",
      managedArtifactRoot: path.join(fixture.root, "missing-history"),
      config: { capturePolicy: "full", codexSessionsRoot: path.join(fixture.root, "empty-sessions") },
    });
    expect(missing).toMatchObject({ recovery: "RECORDED_UNAVAILABLE", receipt: { captureState: "UNAVAILABLE", errors: [{ code: "SOURCE_MISSING", scope: "SOURCE" }] } });
    expect(missing.manifest).toBeUndefined();
  });
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-session-effect-"));
  roots.push(root);
  const scope = path.join(root, "scope");
  const taskArtifacts = path.join(root, "artifacts");
  const roles = path.join(taskArtifacts, "roles");
  const sessions = path.join(root, "sessions");
  const sessionArtifacts = path.join(taskArtifacts, "session-evidence");
  await Promise.all([mkdir(scope), mkdir(sessions), mkdir(path.join(root, "empty-sessions"))]);
  return { root, scope, roles, sessions, sessionArtifacts, taskArtifacts };
}

async function writeRollout(sessionsRoot: string, prompt: string): Promise<string> {
  const directory = path.join(sessionsRoot, "2026", "08", "25");
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `rollout-2026-08-25T18-00-00-${sessionId}.jsonl`);
  const rows = [
    { timestamp: "2026-08-25T18:00:00.000Z", type: "session_meta", payload: { id: sessionId } },
    { timestamp: "2026-08-25T18:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: prompt } },
    { timestamp: "2026-08-25T18:00:02.000Z", type: "event_msg", payload: { type: "agent_message", message: "Inspecting" } },
    { timestamp: "2026-08-25T18:00:03.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"git status\"}", call_id: "call-1" } },
    { timestamp: "2026-08-25T18:00:04.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "clean" } },
    { timestamp: "2026-08-25T18:00:05.000Z", type: "event_msg", payload: { type: "agent_message", message: "Complete", phase: "final_answer" } },
    { timestamp: "2026-08-25T18:00:06.000Z", type: "event_msg", payload: { type: "task_complete" } },
  ];
  await writeFile(target, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return target;
}

function sha(letter: string): string {
  return `sha256:${letter.repeat(64)}`;
}
