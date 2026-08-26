import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CoreV2WorkflowProjection } from "../src/restate/core-v2-services.js";
import { invoke, send } from "../src/restate/ingress.js";
import type { TaskAuthorityState } from "../src/restate/services.js";
import type {
  HistoricalSessionEvidenceRecordV1,
  TranscriptEnrichmentInputV1,
  TranscriptEnrichmentProjectionV1,
} from "../src/restate/transcript-enrichment-services.js";

export interface SessionHistoryAcceptanceReportV1 {
  readonly schemaVersion: 1;
  readonly suite: "AGENT_SESSION_HISTORY";
  readonly taskId: string;
  readonly sourceWorkflowRef: string;
  readonly sourceProjectionDigestBefore: string;
  readonly sourceProjectionDigestAfter: string;
  readonly sourceUnchanged: true;
  readonly executions: readonly {
    readonly requirementId: "REQ-0064-08" | "REQ-0076-03";
    readonly enrichmentId: string;
    readonly runId: string;
    readonly attemptId: string;
    readonly sessionId: string;
    readonly role: string;
    readonly phase: string;
    readonly specRevision: number;
    readonly generation: number;
    readonly terminalState: string;
    readonly receiptDigest: string;
    readonly manifestDigest?: string;
    readonly sourceDigest?: string;
    readonly authorityDigest: string;
    readonly recordDigest: string;
    readonly normalizedEvents: number;
    readonly executionEvents: number;
    readonly stderrBytes: number;
    readonly idempotentReplay: true;
  }[];
  readonly completedAt: string;
  readonly reportDigest: string;
}

export interface SessionHistoryAcceptanceOptions {
  readonly taskId?: string;
  readonly ingressUrl?: string;
  readonly boardUrl?: string;
  readonly codexSessionsRoot?: string;
  readonly managedArtifactRoot?: string;
  readonly reportPath?: string;
  readonly allowUnavailable?: boolean;
  readonly quiet?: boolean;
  readonly requirementId?: "REQ-0064-08" | "REQ-0076-03";
}

export async function runSessionHistoryAcceptance(options: SessionHistoryAcceptanceOptions = {}): Promise<SessionHistoryAcceptanceReportV1> {
  const taskId = options.taskId ?? process.env["MOYE_SESSION_HISTORY_TASK_ID"] ?? "TASK-CORE-V2-LIVE-006";
  const ingressUrl = options.ingressUrl ?? process.env["MOYE_SESSION_HISTORY_INGRESS"] ?? process.env["RESTATE_INGRESS_URL"] ?? "http://127.0.0.1:8080";
  const boardUrl = (options.boardUrl ?? process.env["MOYE_SESSION_HISTORY_BOARD"] ?? "http://127.0.0.1:3000").replace(/\/$/u, "");
  const codexSessionsRoot = path.resolve(options.codexSessionsRoot ?? process.env["MOYE_CODEX_SESSIONS_ROOT"] ?? path.join(os.homedir(), ".codex", "sessions"));
  const managedArtifactRoot = path.resolve(options.managedArtifactRoot ?? process.env["MOYE_SESSION_HISTORY_ARTIFACT_ROOT"] ?? path.join(".moye-runtime", "session-history", taskId));
  const reportPath = path.resolve(options.reportPath ?? process.env["MOYE_SESSION_HISTORY_REPORT"] ?? path.join(".moye-runtime", "acceptance", `${taskId}-session-history.json`));
  const requirementId = options.requirementId ?? "REQ-0064-08";
  await mkdir(managedArtifactRoot, { recursive: true });
  const authority = await invoke<TaskAuthorityState | null>(ingressUrl, "TaskAuthority", taskId, "get");
  if (authority?.owner !== "CORE_V2_WORKFLOW") throw new Error(`${taskId} is not owned by CoreV2Workflow`);
  const sourceTarget = authority.recoveryWorkflowRef === undefined
    ? { service: "CoreV2Workflow", key: taskId, ref: `restate://CoreV2Workflow/${taskId}` }
    : parseWorkflowRef(authority.recoveryWorkflowRef);
  const before = await invoke<CoreV2WorkflowProjection | null>(ingressUrl, sourceTarget.service, sourceTarget.key, "status");
  if (before === null || before.state !== "CLOSED" || !hasOwningWorkflowArchiveProof(before) || before.outcome === null) {
    throw new Error(`${taskId} is not an archived terminal Core v2 Task`);
  }
  const sourceProjectionDigestBefore = digest("core-v2-source-projection", before);
  const runs = [...before.roleRuns].sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId));
  if (runs.length === 0 || runs.some((run) => run.sessionId === undefined)) throw new Error(`${taskId} has incomplete Role Session identities`);
  const executions: SessionHistoryAcceptanceReportV1["executions"][number][] = [];
  for (const run of runs) {
    const token = `${run.phase.toLowerCase().replaceAll("_", "-")}-r${run.specRevision}-g${run.generation}`;
    const enrichmentId = `history:${taskId}:${token}`;
    const input: TranscriptEnrichmentInputV1 = {
      enrichmentId,
      taskId,
      runId: run.runId,
      managedArtifactRoot,
      capturePolicy: "full",
      codexSessionsRoot,
      promptBinding: "UNVERIFIED",
      executorId: `acceptance:TASK-0064:${token}`,
    };
    await send(ingressUrl, "TranscriptEnrichmentWorkflow", enrichmentId, "run", input);
    const result = await waitForClosed(ingressUrl, enrichmentId, 60_000);
    if (result.receipt === undefined || (!["COMPLETE", "PARTIAL"].includes(result.receipt.captureState) && !(options.allowUnavailable === true && result.receipt.captureState === "UNAVAILABLE"))) {
      throw new Error(`${enrichmentId} did not produce usable Provider evidence: ${JSON.stringify(result)}`);
    }
    const record = await invoke<HistoricalSessionEvidenceRecordV1 | null>(ingressUrl, "SessionEvidenceRegistry", run.runId, "get");
    if (record === null || record.receipt?.receiptDigest !== result.receipt.receiptDigest || record.authority.history.length !== 1) {
      throw new Error(`${enrichmentId} Registry did not converge to one append-only Receipt`);
    }
    const roleUrl = `${boardUrl}/api/tasks/${encodeURIComponent(taskId)}/roles/${encodeURIComponent(run.runId)}`;
    const [metadata, execution, stderr] = await Promise.all([
      json(`${roleUrl}/session`),
      json(`${roleUrl}/events?cursor=0&limit=200`),
      json(`${roleUrl}/stderr`),
    ]) as [
      { state: string; manifestDigest?: string; metrics?: { normalizedEvents: number } },
      { total: number; events: readonly unknown[] },
      { byteLength: number },
    ];
    const usable = result.receipt.captureState === "COMPLETE" || result.receipt.captureState === "PARTIAL";
    let normalizedEvents = 0;
    if (usable) {
      const timeline = await json(`${roleUrl}/timeline?cursor=0&limit=200`) as { total: number; events: readonly unknown[] };
      if (metadata.state !== result.receipt.captureState || timeline.total !== timeline.events.length || timeline.total === 0) {
        throw new Error(`${enrichmentId} Board API did not expose the canonical historical timeline`);
      }
      normalizedEvents = timeline.total;
    } else {
      if (metadata.state !== "UNAVAILABLE") throw new Error(`${enrichmentId} Board API did not expose the UNAVAILABLE disposition`);
      const timeline = await fetch(`${roleUrl}/timeline?cursor=0&limit=200`);
      if (timeline.status !== 404 || !((await timeline.text()).includes("SESSION_EVIDENCE_NOT_FOUND"))) {
        throw new Error(`${enrichmentId} unavailable timeline did not remain explicitly unavailable`);
      }
    }
    await send(ingressUrl, "TranscriptEnrichmentWorkflow", enrichmentId, "run", input);
    const replay = await waitForClosed(ingressUrl, enrichmentId, 20_000);
    const replayRecord = await invoke<HistoricalSessionEvidenceRecordV1>(ingressUrl, "SessionEvidenceRegistry", run.runId, "get");
    if (replay.receipt?.receiptDigest !== result.receipt.receiptDigest || replayRecord.authority.history.length !== 1) {
      throw new Error(`${enrichmentId} replay produced a duplicate or conflicting result`);
    }
    executions.push({
      requirementId,
      enrichmentId,
      runId: run.runId,
      attemptId: run.attemptId,
      sessionId: run.sessionId!,
      role: run.role,
      phase: run.phase,
      specRevision: run.specRevision,
      generation: run.generation,
      terminalState: result.receipt.captureState,
      receiptDigest: result.receipt.receiptDigest,
      ...(result.receipt.manifest === undefined ? {} : { manifestDigest: result.receipt.manifest.digest }),
      ...(result.receipt.sourceDigest === undefined ? {} : { sourceDigest: result.receipt.sourceDigest }),
      authorityDigest: replayRecord.authority.stateDigest,
      recordDigest: replayRecord.recordDigest,
      normalizedEvents,
      executionEvents: execution.total,
      stderrBytes: stderr.byteLength,
      idempotentReplay: true,
    });
  }
  const after = await invoke<CoreV2WorkflowProjection | null>(ingressUrl, sourceTarget.service, sourceTarget.key, "status");
  const sourceProjectionDigestAfter = digest("core-v2-source-projection", after);
  if (sourceProjectionDigestAfter !== sourceProjectionDigestBefore) throw new Error("Archived Core v2 Projection changed during historical enrichment");
  const completedAt = new Date().toISOString();
  const core = {
    schemaVersion: 1 as const,
    suite: "AGENT_SESSION_HISTORY" as const,
    taskId,
    sourceWorkflowRef: sourceTarget.ref,
    sourceProjectionDigestBefore,
    sourceProjectionDigestAfter,
    sourceUnchanged: true as const,
    executions,
    completedAt,
  };
  const report = Object.freeze({ ...core, reportDigest: digest("session-history-acceptance-report-v1", core) });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (options.quiet !== true) process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
  return report;
}

function hasOwningWorkflowArchiveProof(projection: CoreV2WorkflowProjection): boolean {
  if (projection.lifecycle.archive?.status === "ARCHIVED") return true;
  return projection.currentStep === "ARCHIVED" && projection.lifecycle.events.some((event) =>
    event.type === "ArchiveArchived" && event.detail === projection.taskId);
}

async function waitForClosed(ingressUrl: string, enrichmentId: string, timeoutMs: number): Promise<TranscriptEnrichmentProjectionV1> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await invoke<TranscriptEnrichmentProjectionV1 | null>(ingressUrl, "TranscriptEnrichmentWorkflow", enrichmentId, "status");
    if (result?.state === "CLOSED") return result;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${enrichmentId} did not close within ${timeoutMs}ms`);
}

async function json(url: string): Promise<unknown> {
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${body}`);
  return JSON.parse(body) as unknown;
}

function parseWorkflowRef(ref: string): { readonly service: string; readonly key: string; readonly ref: string } {
  const match = /^restate:\/\/([A-Za-z0-9]+)\/(.+)$/u.exec(ref);
  if (match === null || !["CoreV2FailureRecoveryWorkflow", "CoreV2FailureRecoveryAttemptWorkflow"].includes(match[1]!)) {
    throw new Error(`Unsupported owning Workflow: ${ref}`);
  }
  return { service: match[1]!, key: match[2]!, ref };
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(`${namespace}:${stableJson(value)}`).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  await runSessionHistoryAcceptance();
}
