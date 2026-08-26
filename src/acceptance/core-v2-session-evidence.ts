import os from "node:os";
import path from "node:path";

import type { CoreV2WorkflowInput, CoreV2WorkflowProjection } from "../restate/core-v2-services.js";

export interface CoreV2AcceptanceSessionEvidenceSummaryV1 {
  readonly attemptId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly captureState: "COMPLETE" | "PARTIAL";
  readonly receiptDigest: string;
  readonly manifestDigest: string;
}

/** Acceptance policy only; the public Framework privacy default remains capture=none. */
export function coreV2AcceptanceSessionEvidence(
  environment: NodeJS.ProcessEnv = process.env,
): NonNullable<CoreV2WorkflowInput["sessionEvidence"]> {
  return Object.freeze({
    enabled: true as const,
    capturePolicy: "full" as const,
    codexSessionsRoot: codexSessionsRoot(environment),
    maxSourceBytes: 64 * 1024 * 1024,
  });
}

/** Explicit Provider roots accepted by local product-acceptance and GA services. */
export function coreV2AcceptanceSessionSourceRoots(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const roots = [
    ...splitPaths(environment["MOYE_SESSION_SOURCE_ROOTS"]),
    codexSessionsRoot(environment),
    path.resolve(environment["MOYE_CLAUDE_PROJECTS_ROOT"] ?? path.join(os.homedir(), ".claude", "projects")),
  ];
  return [...new Set(roots.map((root) => path.resolve(root)))].join(path.delimiter);
}

export function auditCoreV2AcceptanceSessionEvidence(
  projection: CoreV2WorkflowProjection,
): readonly CoreV2AcceptanceSessionEvidenceSummaryV1[] {
  const records = projection.sessionEvidence ?? [];
  if (records.length < projection.roleRuns.length) {
    throw new Error(`${projection.taskId} has ${projection.roleRuns.length} Role Runs but only ${records.length} Session Evidence records`);
  }
  const summaries = projection.roleRuns.map((run) => {
    if (run.sessionId === undefined) throw new Error(`${projection.taskId} Role Run ${run.runId} has no Provider Session ID`);
    const record = records.find((candidate) => candidate.attemptId === run.attemptId && candidate.runId === run.runId);
    if (record === undefined) throw new Error(`${projection.taskId} Role Run ${run.runId} has no identity-bound Session Evidence`);
    const state = record.receipt?.captureState;
    if (state !== "COMPLETE" && state !== "PARTIAL") {
      throw new Error(`${projection.taskId} Role Run ${run.runId} Session Evidence is ${state ?? record.summary?.state ?? record.locator.stage}`);
    }
    if (record.receipt === undefined || record.receipt.manifest === undefined || record.authority?.headReceiptDigest !== record.receipt.receiptDigest) {
      throw new Error(`${projection.taskId} Role Run ${run.runId} Session Receipt/Manifest/Authority is incomplete`);
    }
    if (record.executionEventsRef !== run.eventsRef || record.stderrRef !== run.stderrRef) {
      throw new Error(`${projection.taskId} Role Run ${run.runId} execution evidence binding changed`);
    }
    return Object.freeze({
      attemptId: run.attemptId,
      runId: run.runId,
      sessionId: run.sessionId,
      captureState: state,
      receiptDigest: record.receipt.receiptDigest,
      manifestDigest: record.receipt.manifest.digest,
    });
  });
  if (new Set(summaries.map((item) => item.receiptDigest)).size !== summaries.length) {
    throw new Error(`${projection.taskId} has duplicate Session Receipt digests`);
  }
  return Object.freeze(summaries);
}

function codexSessionsRoot(environment: NodeJS.ProcessEnv): string {
  const codexHome = environment["CODEX_HOME"] ?? path.join(os.homedir(), ".codex");
  return path.resolve(environment["MOYE_CODEX_SESSIONS_ROOT"] ?? path.join(codexHome, "sessions"));
}

function splitPaths(value: string | undefined): readonly string[] {
  return value === undefined ? [] : value.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}
