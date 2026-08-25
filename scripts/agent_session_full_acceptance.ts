#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readManagedClaudeSessionV1 } from "../src/agent/claude-session-adapter.js";
import { readManagedCodexSessionV1 } from "../src/agent/codex-session-adapter.js";
import { runClaudeSessionProductAcceptance, type ClaudeSessionProductAcceptanceResult } from "./claude_session_product_acceptance.js";
import { runCodexSessionProductAcceptance, type CodexSessionProductAcceptanceResult } from "./codex_session_product_acceptance.js";
import { runSessionHistoryAcceptance } from "./session_history_acceptance.js";

interface RecoveryRole {
  readonly phase: string;
  readonly attemptId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly manifestDigest: string;
}

interface RecoveryEvidence {
  readonly attemptId: string;
  readonly runId: string;
  readonly promptEnvelopeDigest: string;
  readonly receiptDigest: string;
  readonly manifestDigest: string;
  readonly captureState: string;
}

export interface SessionCaptureRecoverySummary {
  readonly schemaVersion: 1;
  readonly scenario: "SESSION_CAPTURE_RECOVERY";
  readonly taskId: string;
  readonly workflowRef: string;
  readonly state: "CLOSED";
  readonly outcome: "SUCCEEDED";
  readonly archiveStatus: "ARCHIVED";
  readonly roleRuns: readonly RecoveryRole[];
  readonly sessionEvidence: readonly RecoveryEvidence[];
  readonly projectionDigest: string;
  readonly closureDigest: string;
  readonly archiveReceiptDigest: string;
}

const requiredPhases = ["ARCHITECT", "DESIGN_REVIEW", "IMPLEMENTATION", "DOCUMENTATION", "TEST_PLAN", "TEST_ASSESSMENT", "FINAL_REVIEW"] as const;

export function validateSessionCaptureRecoverySummary(value: unknown): SessionCaptureRecoverySummary {
  if (value === null || typeof value !== "object") throw new Error("Session Capture Recovery summary must be an object");
  const summary = value as Partial<SessionCaptureRecoverySummary>;
  if (summary.schemaVersion !== 1 || summary.scenario !== "SESSION_CAPTURE_RECOVERY") throw new Error("Explicit summary is not SESSION_CAPTURE_RECOVERY evidence");
  if (summary.state !== "CLOSED" || summary.outcome !== "SUCCEEDED" || summary.archiveStatus !== "ARCHIVED") throw new Error("Session Capture Recovery task is not successfully archived");
  if (typeof summary.taskId !== "string" || typeof summary.workflowRef !== "string" || !summary.workflowRef.endsWith(`/${summary.taskId}`)) throw new Error("Recovery Workflow identity is invalid");
  if (!Array.isArray(summary.roleRuns) || !Array.isArray(summary.sessionEvidence) || summary.roleRuns.length !== requiredPhases.length || summary.sessionEvidence.length !== requiredPhases.length) throw new Error("Recovery summary must contain exactly seven Role Runs and Session Receipts");
  for (const phase of requiredPhases) {
    const role = summary.roleRuns.find((item) => item.phase === phase);
    if (role === undefined || !isDigest(role.runId) || !isDigest(role.manifestDigest) || role.sessionId.length === 0 || role.attemptId.length === 0) throw new Error(`Recovery summary is missing valid ${phase} Role evidence`);
    const evidence = summary.sessionEvidence.find((item) => item.runId === role.runId && item.attemptId === role.attemptId);
    if (evidence === undefined || evidence.captureState !== "COMPLETE" || !isDigest(evidence.promptEnvelopeDigest) || !isDigest(evidence.receiptDigest) || !isDigest(evidence.manifestDigest)) throw new Error(`Recovery summary is missing COMPLETE ${phase} Session evidence`);
  }
  if (new Set(summary.roleRuns.map((item) => item.runId)).size !== requiredPhases.length || new Set(summary.roleRuns.map((item) => item.sessionId)).size !== requiredPhases.length) throw new Error("Recovery summary contains duplicate Run or Session identities");
  if (!isDigest(summary.projectionDigest) || !isDigest(summary.closureDigest) || !isDigest(summary.archiveReceiptDigest)) throw new Error("Recovery summary lacks terminal digests");
  return summary as SessionCaptureRecoverySummary;
}

export async function verifyRecoveryBoard(summary: SessionCaptureRecoverySummary, boardUrl: string) {
  const root = boardUrl.replace(/\/$/u, "");
  const trace = await json(`${root}/api/tasks/${encodeURIComponent(summary.taskId)}/trace`) as {
    task?: { taskId?: string; state?: string; outcome?: string; archiveStatus?: string };
    lifecycle?: { projectionDigest?: string };
    roles?: readonly { runId?: string; sessionId?: string }[];
  };
  if (trace.task?.taskId !== summary.taskId || trace.task.state !== "CLOSED" || trace.task.outcome !== "SUCCEEDED" || trace.task.archiveStatus !== "ARCHIVED") throw new Error("Recovery Board Trace terminal facts do not match explicit evidence");
  if (trace.lifecycle?.projectionDigest !== summary.projectionDigest || trace.roles?.length !== requiredPhases.length) throw new Error("Recovery Board Trace drifted from explicit Projection evidence");
  const roles = [];
  for (const role of summary.roleRuns) {
    if (!trace.roles.some((item) => item.runId === role.runId && item.sessionId === role.sessionId)) throw new Error(`Board Trace is missing exact Run ${role.runId}`);
    const base = `${root}/api/tasks/${encodeURIComponent(summary.taskId)}/roles/${encodeURIComponent(role.runId)}`;
    const [session, timeline, execution, stderr] = await Promise.all([
      json(`${base}/session`) as Promise<{ state?: string; manifestDigest?: string; artifacts?: { promptEnvelope?: { digest?: string } } }>,
      json(`${base}/timeline?cursor=0&limit=200`) as Promise<{ total?: number; events?: readonly unknown[] }>,
      json(`${base}/events?cursor=0&limit=200`) as Promise<{ total?: number; events?: readonly unknown[] }>,
      json(`${base}/stderr`) as Promise<{ byteLength?: number }>,
    ]);
    const evidence = summary.sessionEvidence.find((item) => item.runId === role.runId)!;
    if (session.state !== "COMPLETE" || session.manifestDigest !== evidence.manifestDigest || session.artifacts?.promptEnvelope?.digest !== evidence.promptEnvelopeDigest) throw new Error(`Board Session metadata drifted for ${role.runId}`);
    if (!Number.isInteger(timeline.total) || (timeline.total ?? 0) === 0 || timeline.total !== timeline.events?.length) throw new Error(`Board canonical Timeline is incomplete for ${role.runId}`);
    if (!Number.isInteger(execution.total) || execution.total !== execution.events?.length || !Number.isInteger(stderr.byteLength)) throw new Error(`Board execution/stderr evidence is invalid for ${role.runId}`);
    roles.push({ phase: role.phase, attemptId: role.attemptId, runId: role.runId, sessionId: role.sessionId, roleManifestDigest: role.manifestDigest, promptEnvelopeDigest: evidence.promptEnvelopeDigest, transcriptManifestDigest: evidence.manifestDigest, receiptDigest: evidence.receiptDigest, normalizedEvents: timeline.total, executionEvents: execution.total, stderrBytes: stderr.byteLength });
  }
  return Object.freeze({ taskId: summary.taskId, workflowRef: summary.workflowRef, projectionDigest: summary.projectionDigest, closureDigest: summary.closureDigest, archiveReceiptDigest: summary.archiveReceiptDigest, pageUrl: `${root}/tasks/${encodeURIComponent(summary.taskId)}`, roles });
}

export async function runAgentSessionFullAcceptance() {
  const recoverySummaryPath = process.env["MOYE_AGENT_SESSION_RECOVERY_SUMMARY"];
  if (recoverySummaryPath === undefined) throw new Error("MOYE_AGENT_SESSION_RECOVERY_SUMMARY must explicitly identify SESSION_CAPTURE_RECOVERY evidence");
  const boardUrl = process.env["MOYE_AGENT_SESSION_ACCEPTANCE_BOARD"] ?? "http://127.0.0.1:3000";
  const outputPath = path.resolve(process.env["MOYE_AGENT_SESSION_ACCEPTANCE_REPORT"] ?? ".moye-runtime/acceptance/agent-sessions-report.json");
  const recovery = validateSessionCaptureRecoverySummary(JSON.parse(await readFile(path.resolve(recoverySummaryPath), "utf8")));
  const startedAt = new Date().toISOString();
  const codex = await loadOrRunCodex();
  const claude = await loadOrRunClaude();
  const captureRecovery = await verifyRecoveryBoard(recovery, boardUrl);
  const history = await runSessionHistoryAcceptance();
  const core = {
    schemaVersion: 1 as const,
    suite: "AGENT_SESSION_PRODUCT_ACCEPTANCE" as const,
    startedAt,
    completedAt: new Date().toISOString(),
    requirements: [
      { id: "REQ-0065-01", status: "PASS", evidence: [codex.transcriptManifestDigest, claude.transcriptManifestDigest] },
      { id: "REQ-0065-02", status: "PASS", evidence: [captureRecovery.projectionDigest, captureRecovery.archiveReceiptDigest] },
      { id: "REQ-0065-03", status: "PASS", evidence: [history.reportDigest, history.sourceProjectionDigestAfter] },
      { id: "REQ-0065-04", status: "PASS", evidence: ["this-report"] },
    ],
    codex,
    claude,
    captureRecovery,
    history,
  };
  const report = Object.freeze({ ...core, reportDigest: digest("agent-session-product-acceptance-v1", core) });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ...report, reportPath: outputPath }, null, 2)}\n`);
  return report;
}

async function loadOrRunCodex(): Promise<CodexSessionProductAcceptanceResult> {
  const explicit = process.env["MOYE_AGENT_SESSION_CODEX_RESULT"];
  if (explicit === undefined) return runCodexSessionProductAcceptance();
  const result = JSON.parse(await readFile(path.resolve(explicit), "utf8")) as CodexSessionProductAcceptanceResult;
  assertProviderResult(result, "TASK-0059");
  const managed = await readManagedCodexSessionV1({ managedArtifactRoot: path.join(result.evidenceRoot, "transcript-artifacts"), captureId: result.captureId, manifestDigest: result.transcriptManifestDigest });
  assertCanonicalProviderTimeline(managed.timeline, "Codex");
  return result;
}

async function loadOrRunClaude(): Promise<ClaudeSessionProductAcceptanceResult> {
  const explicit = process.env["MOYE_AGENT_SESSION_CLAUDE_RESULT"];
  if (explicit === undefined) return runClaudeSessionProductAcceptance();
  const result = JSON.parse(await readFile(path.resolve(explicit), "utf8")) as ClaudeSessionProductAcceptanceResult;
  assertProviderResult(result, "TASK-0060");
  const managed = await readManagedClaudeSessionV1({ managedArtifactRoot: path.join(result.evidenceRoot, "transcript-artifacts"), captureId: result.captureId, manifestDigest: result.transcriptManifestDigest });
  assertCanonicalProviderTimeline(managed.timeline, "Claude");
  return result;
}

function assertProviderResult(result: CodexSessionProductAcceptanceResult | ClaudeSessionProductAcceptanceResult, taskId: string): void {
  if (result.taskId !== taskId || result.sessionId.length === 0 || !isDigest(result.runId) || !isDigest(result.roleManifestDigest) || !isDigest(result.promptEnvelopeDigest) || !isDigest(result.transcriptManifestDigest) || !isDigest(result.normalizedDigest) || !isDigest(result.sourceDigest)) throw new Error(`Explicit ${taskId} Provider result is invalid`);
}

function assertCanonicalProviderTimeline(timeline: readonly { readonly category: string }[], provider: string): void {
  for (const category of ["PROMPT", "ASSISTANT", "TOOL_CALL", "TOOL_RESULT"]) {
    if (!timeline.some((event) => event.category === category)) throw new Error(`Explicit ${provider} evidence lacks ${category}`);
  }
}

async function json(url: string): Promise<unknown> {
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${body}`);
  return JSON.parse(body) as unknown;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
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

if (import.meta.url === new URL(process.argv[1]!, "file:").href) await runAgentSessionFullAcceptance();
