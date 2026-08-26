import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RealRoleRuntimeV2 } from "../../src/agent/role-runtime-v2.js";
import type { RoleRunManifestV2 } from "../../src/agent/role-runtime-v2.js";
import { createRoleAttemptV2, startRoleAttemptV2 } from "../../src/domain/role-runtime-v2.js";
import { invoke, send } from "../../src/restate/ingress.js";
import type { CoreV2WorkflowProjection } from "../../src/restate/core-v2-services.js";
import type {
  HistoricalSessionEvidenceRecordV1,
  TranscriptEnrichmentInputV1,
  TranscriptEnrichmentProjectionV1,
} from "../../src/restate/transcript-enrichment-services.js";

const repositoryRoot = process.cwd();
const taskId = "TASK-HISTORICAL-SESSION-E2E";
const containerName = `moye-session-enrichment-e2e-${process.pid}`;
let ingressPort = 0;
let adminPort = 0;
let fixtureServicePort = 0;
let servicePort = 0;
let boardPort = 0;
let service: ChildProcess | undefined;
let fixtureRoot = "";
let taskArtifactRoot = "";
let providerRoot = "";
let managedRoot = "";
let projection: CoreV2WorkflowProjection;
let completeRun: RoleRunManifestV2;
let missingRun: RoleRunManifestV2;
let logs = "";

describe("TranscriptEnrichmentWorkflow on real Restate", () => {
  beforeAll(async () => {
    [ingressPort, adminPort, fixtureServicePort, servicePort, boardPort] = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort()]);
    fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moye-transcript-enrichment-e2e-"));
    taskArtifactRoot = path.join(fixtureRoot, "task-artifacts");
    providerRoot = path.join(fixtureRoot, "codex-sessions");
    managedRoot = path.join(fixtureRoot, "historical-evidence");
    await Promise.all([mkdir(taskArtifactRoot), mkdir(providerRoot), mkdir(managedRoot)]);
    completeRun = await createRoleRun("ARCHITECT", "ARCHITECT", "01a00000-0000-7000-8000-000000000001", 0);
    missingRun = await createRoleRun("REVIEW", "DESIGN_REVIEW", "01a00000-0000-7000-8000-000000000002", 0);
    await writeCodexRollout(completeRun.sessionId!, "legacy prompt preserved by Provider");
    projection = archivedProjection([completeRun, missingRun]);

    docker([
      "run", "--rm", "-d", "--name", containerName,
      "--add-host", "host.docker.internal:host-gateway",
      "-p", `127.0.0.1:${ingressPort}:8080`,
      "-p", `127.0.0.1:${adminPort}:9070`,
      "docker.restate.dev/restatedev/restate:1.7.4",
    ]);
    await waitUntil(async () => {
      try { return (await fetch(`${adminUrl()}/health`)).ok; } catch { return false; }
    }, 20_000);
    await startService("tests/fixtures/historical-core-v2-service.ts", fixtureServicePort);
    await registerService(fixtureServicePort);
    await invoke(ingressUrl(), "CoreV2Workflow", taskId, "run", projection);
    await stopService();
    await startService("src/index.ts", servicePort);
    await registerService(servicePort);
  }, 60_000);

  afterAll(async () => {
    await stopService();
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("records one append-only historical Receipt, joins it into Board APIs, and rejects a conflicting successor", async () => {
    const before = await invoke<CoreV2WorkflowProjection>(ingressUrl(), "CoreV2Workflow", taskId, "status");
    const input = enrichmentInput("history-e2e-complete", completeRun, providerRoot);
    const sent = await send(ingressUrl(), "TranscriptEnrichmentWorkflow", input.enrichmentId, "run", input);
    expect(sent.invocationId).toBeTruthy();
    const result = await waitForEnrichment(input.enrichmentId);
    expect(result).toMatchObject({ state: "CLOSED", outcome: "PARTIAL", recovery: "EXECUTED", receipt: { importMode: "HISTORICAL_ENRICHMENT", promptBinding: "UNVERIFIED" } });

    const registry = await invoke<HistoricalSessionEvidenceRecordV1 | null>(ingressUrl(), "SessionEvidenceRegistry", completeRun.runId, "get");
    expect(registry).toMatchObject({ taskId, runId: completeRun.runId, receipt: { receiptDigest: result.receipt?.receiptDigest }, summary: { state: "PARTIAL", captureAttempts: 1 } });
    const metadata = await fetch(`${boardUrl()}/api/tasks/${taskId}/roles/${encodeURIComponent(completeRun.runId)}/session`);
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      state: "PARTIAL",
      provider: "CODEX",
      providerSessionId: completeRun.sessionId,
      semantics: {
        availability: { state: "AVAILABLE" },
        content: { evaluated: true, state: "COMPLETE", reasons: [] },
        binding: { state: "UNVERIFIED" },
        limitation: { state: "NONE" },
      },
    });
    const timeline = await fetch(`${boardUrl()}/api/tasks/${taskId}/roles/${encodeURIComponent(completeRun.runId)}/timeline?limit=200`);
    expect(timeline.status).toBe(200);
    expect((await timeline.json() as { events: readonly { category: string }[] }).events.some((event) => event.category === "USER")).toBe(true);

    await send(ingressUrl(), "TranscriptEnrichmentWorkflow", input.enrichmentId, "run", input);
    expect(await waitForEnrichment(input.enrichmentId)).toEqual(result);
    const replayRegistry = await invoke<HistoricalSessionEvidenceRecordV1>(ingressUrl(), "SessionEvidenceRegistry", completeRun.runId, "get");
    expect(replayRegistry.authority.history).toHaveLength(1);

    const conflicting = enrichmentInput("history-e2e-conflict", completeRun, providerRoot);
    await expect(invoke(ingressUrl(), "TranscriptEnrichmentWorkflow", conflicting.enrichmentId, "run", conflicting)).rejects.toThrow();
    const afterConflict = await invoke<HistoricalSessionEvidenceRecordV1>(ingressUrl(), "SessionEvidenceRegistry", completeRun.runId, "get");
    expect(afterConflict.authority.history).toHaveLength(1);
    expect(afterConflict.authority.headReceiptDigest).toBe(result.receipt?.receiptDigest);

    const after = await invoke<CoreV2WorkflowProjection>(ingressUrl(), "CoreV2Workflow", taskId, "status");
    expect(after).toEqual(before);
  }, 40_000);

  it("records a deterministic UNAVAILABLE Receipt when the confirmed Provider source is absent", async () => {
    const input = enrichmentInput("history-e2e-missing", missingRun, providerRoot);
    await send(ingressUrl(), "TranscriptEnrichmentWorkflow", input.enrichmentId, "run", input);
    const result = await waitForEnrichment(input.enrichmentId);
    expect(result).toMatchObject({ state: "CLOSED", outcome: "UNAVAILABLE", recovery: "RECORDED_UNAVAILABLE", receipt: { captureState: "UNAVAILABLE", errors: [{ code: "SOURCE_MISSING", scope: "SOURCE" }] } });
    const registry = await invoke<HistoricalSessionEvidenceRecordV1>(ingressUrl(), "SessionEvidenceRegistry", missingRun.runId, "get");
    expect(registry.authority.history).toHaveLength(1);
    expect(registry.receipt?.manifest).toBeUndefined();
    const response = await fetch(`${boardUrl()}/api/tasks/${taskId}/roles/${encodeURIComponent(missingRun.runId)}/timeline`);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "SESSION_TRANSCRIPT_UNAVAILABLE" } });
  }, 30_000);

  it("rejects Provider roots outside the operator allowlist before claiming Registry state", async () => {
    const input = enrichmentInput("history-e2e-forbidden-source", missingRun, path.join(fixtureRoot, "not-allowlisted"));
    await expect(invoke(ingressUrl(), "TranscriptEnrichmentWorkflow", input.enrichmentId, "run", input)).rejects.toThrow();
    const record = await invoke<HistoricalSessionEvidenceRecordV1>(ingressUrl(), "SessionEvidenceRegistry", missingRun.runId, "get");
    expect(record.authority.history).toHaveLength(1);
  }, 20_000);
});

function enrichmentInput(enrichmentId: string, run: RoleRunManifestV2, sourceRoot: string): TranscriptEnrichmentInputV1 {
  return {
    enrichmentId,
    taskId,
    runId: run.runId,
    managedArtifactRoot: managedRoot,
    capturePolicy: "full",
    codexSessionsRoot: sourceRoot,
    promptBinding: "UNVERIFIED",
    executorId: `e2e:${enrichmentId}`,
  };
}

async function createRoleRun(role: "ARCHITECT" | "REVIEW", phase: "ARCHITECT" | "DESIGN_REVIEW", sessionId: string, generation: number): Promise<RoleRunManifestV2> {
  const attempt = startRoleAttemptV2(createRoleAttemptV2({
    taskId,
    specRevision: 1,
    role,
    phase,
    generation,
    runnerKind: "CODEX_EXEC",
    inputDigest: sha(`${role}:input`),
    subjectCommit: "a".repeat(40),
    inputArtifactRefs: ["artifact://spec"],
    scheduledAt: "2026-08-25T20:00:00.000Z",
  }), "2026-08-25T20:00:01.000Z");
  return (await new RealRoleRuntimeV2({
    processRunner: { async run() { return {
      stdout: [
        JSON.stringify({ type: "thread.started", thread_id: sessionId }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ summary: "fixture", recommendation: "PASS", artifactRefs: [], findingRefs: [], deliverable: "{}" }) } }),
        JSON.stringify({ type: "turn.completed" }), "",
      ].join("\n"),
      stderr: `stderr:${phase}`,
      exitCode: 0,
      signal: null,
    }; } },
    now: () => new Date("2026-08-25T20:00:02.000Z"),
  }).run({ attempt, scopeRoot: repositoryRoot, artifactRoot: path.join(taskArtifactRoot, "roles"), instructions: `fixture ${phase}` })).manifest;
}

function archivedProjection(roleRuns: readonly RoleRunManifestV2[]): CoreV2WorkflowProjection {
  return {
    schemaVersion: 1,
    taskId,
    projectId: "moye-session-enrichment-e2e",
    title: "Historical Session Enrichment E2E",
    state: "CLOSED",
    currentStep: "ARCHIVED",
    lifecycle: {
      schemaVersion: 1,
      taskId,
      specRevision: 1,
      subjectCommit: "a".repeat(40),
      candidateCommit: "b".repeat(40),
      implementationGeneration: 0,
      state: "CLOSED",
      artifacts: [], implementationCheckpoints: [], trustedTestRun: null, trustedTestRuns: [],
      verificationGateDigest: sha("gate"), knowledgeDispositionDigest: sha("knowledge"), mergeCommit: "c".repeat(40), mergeReceipt: null,
      failure: null, failureClosure: null, successClosure: null,
      archive: { status: "ARCHIVED", effectId: "archive:e2e", attempts: 1, receiptRef: "artifact://archive", receiptDigest: sha("archive"), error: null },
      outcome: "SUCCEEDED", invalidatedRevisions: [], invalidatedGenerations: [],
      events: [
        { sequence: 1, type: "TaskCreated", at: "2026-08-25T20:00:00.000Z", detail: "fixture" },
        { sequence: 2, type: "TaskArchived", at: "2026-08-25T20:01:00.000Z", detail: "fixture" },
      ],
      projectionDigest: sha("lifecycle"),
    },
    attempts: [], roleRuns,
    artifactRoot: taskArtifactRoot,
    startedAt: "2026-08-25T20:00:00.000Z",
    completedAt: "2026-08-25T20:01:00.000Z",
    outcome: "SUCCEEDED",
    error: null,
  };
}

async function writeCodexRollout(sessionId: string, prompt: string): Promise<void> {
  const directory = path.join(providerRoot, "2026", "08", "25");
  await mkdir(directory, { recursive: true });
  const rows = [
    { timestamp: "2026-08-25T20:00:00.000Z", type: "session_meta", payload: { id: sessionId } },
    { timestamp: "2026-08-25T20:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: prompt } },
    { timestamp: "2026-08-25T20:00:02.000Z", type: "event_msg", payload: { type: "agent_message", message: "working" } },
    { timestamp: "2026-08-25T20:00:03.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: "{}", call_id: "call-1" } },
    { timestamp: "2026-08-25T20:00:04.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "ok" } },
    { timestamp: "2026-08-25T20:00:05.000Z", type: "event_msg", payload: { type: "agent_message", message: "done" } },
    { timestamp: "2026-08-25T20:00:06.000Z", type: "event_msg", payload: { type: "task_complete" } },
  ];
  await writeFile(path.join(directory, `rollout-${sessionId}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function startService(entry: string, port: number): Promise<void> {
  service = spawn(process.execPath, ["--import", "tsx", entry], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      RESTATE_SERVICE_PORT: String(port),
      MOYE_BOARD_PORT: String(boardPort),
      RESTATE_INGRESS_URL: ingressUrl(),
      RESTATE_ADMIN_URL: adminUrl(),
      MOYE_PROJECT_ID: "moye-session-enrichment-e2e",
      MOYE_ARTIFACT_ROOTS: fixtureRoot,
      MOYE_SESSION_SOURCE_ROOTS: providerRoot,
      MOYE_LIVE_RUNTIME_ROOT: fixtureRoot,
      MOYE_REPOSITORY_ROOTS: repositoryRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  service.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  service.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  await waitUntil(() => canConnect(port), 10_000);
}

async function stopService(): Promise<void> {
  const current = service;
  service = undefined;
  if (current === undefined || current.exitCode !== null || current.signalCode !== null) return;
  current.kill("SIGTERM");
  await Promise.race([once(current, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

async function registerService(port: number): Promise<void> {
  const response = await fetch(`${adminUrl()}/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: `http://host.docker.internal:${port}` }),
  });
  if (!response.ok) throw new Error(`Service registration failed: ${await response.text()}\n${logs}`);
}

async function waitForEnrichment(enrichmentId: string): Promise<TranscriptEnrichmentProjectionV1> {
  let result: TranscriptEnrichmentProjectionV1 | null = null;
  await waitUntil(async () => {
    try {
      result = await invoke<TranscriptEnrichmentProjectionV1 | null>(ingressUrl(), "TranscriptEnrichmentWorkflow", enrichmentId, "status");
      return result?.state === "CLOSED";
    } catch { return false; }
  }, 20_000);
  if (result === null) throw new Error(`Enrichment did not produce a Projection\n${logs}`);
  return result;
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out${last instanceof Error ? `: ${last.message}` : ""}\n${logs}`);
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("Unable to allocate port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

function docker(args: readonly string[]): void {
  const result = spawnSync("docker", [...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed: ${result.stderr}`);
}

function ingressUrl(): string { return `http://127.0.0.1:${ingressPort}`; }
function adminUrl(): string { return `http://127.0.0.1:${adminPort}`; }
function boardUrl(): string { return `http://127.0.0.1:${boardPort}`; }
function sha(value: string): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
