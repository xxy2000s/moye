#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { digestCanonical } from "../src/release/manifest.js";
import { runSessionHistoryAcceptance, type SessionHistoryAcceptanceReportV1 } from "./session_history_acceptance.js";

type Disposition = "COMPLETE" | "PARTIAL" | "UNAVAILABLE";

const taskIds = explicitTaskIds();
const matrixRoot = path.resolve(process.env["MOYE_SESSION_HISTORY_MATRIX_ROOT"] ?? path.join(".moye-runtime", "acceptance", "session-history-matrix"));
const ingressUrl = process.env["MOYE_SESSION_HISTORY_INGRESS"] ?? process.env["RESTATE_INGRESS_URL"] ?? "http://127.0.0.1:8080";
const boardUrl = process.env["MOYE_SESSION_HISTORY_BOARD"] ?? "http://127.0.0.1:3000";
await mkdir(matrixRoot, { recursive: true });

const results: Array<{ taskId: string; disposition?: Disposition; report?: SessionHistoryAcceptanceReportV1; error?: string }> = [];
for (const taskId of taskIds) {
  try {
    const report = await runSessionHistoryAcceptance({
      taskId,
      ingressUrl,
      boardUrl,
      managedArtifactRoot: path.join(matrixRoot, taskId, "artifacts"),
      reportPath: path.join(matrixRoot, taskId, "report.json"),
      allowUnavailable: true,
      quiet: true,
      requirementId: "REQ-0076-03",
    });
    results.push({ taskId, disposition: disposition(report), report });
    process.stdout.write(`${taskId}: ${disposition(report)} (${report.executions.length} Role Sessions)\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ taskId, error: message });
    process.stderr.write(`${taskId}: ERROR ${message}\n`);
  }
}

const core = Object.freeze({
  schemaVersion: 1 as const,
  suite: "AGENT_SESSION_HISTORY_MATRIX" as const,
  requirementId: "REQ-0076-03" as const,
  executedAt: new Date().toISOString(),
  taskIds,
  results,
});
const summary = Object.freeze({ ...core, evidenceDigest: digestCanonical(core) });
await writeFile(path.join(matrixRoot, "matrix-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ matrixRoot, evidenceDigest: summary.evidenceDigest, results: results.map(({ taskId, disposition: state, error }) => ({ taskId, disposition: state, error })) }, null, 2)}\n`);
if (results.some((result) => result.error !== undefined)) throw new Error("Session history matrix contains technical errors; evidence was preserved");

function disposition(report: SessionHistoryAcceptanceReportV1): Disposition {
  const states = report.executions.map((execution) => execution.terminalState);
  if (states.every((state) => state === "UNAVAILABLE")) return "UNAVAILABLE";
  if (states.some((state) => state !== "COMPLETE")) return "PARTIAL";
  return "COMPLETE";
}

function explicitTaskIds(): readonly string[] {
  const argv = process.argv.slice(2).filter((value) => value.trim() !== "");
  const environment = (process.env["MOYE_SESSION_HISTORY_TASK_IDS"] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const selected = [...new Set([...argv, ...environment])];
  if (selected.length === 0) throw new Error("Provide explicit Task IDs as argv or MOYE_SESSION_HISTORY_TASK_IDS; directory/Board discovery is intentionally unsupported");
  for (const taskId of selected) {
    if (!/^TASK-[A-Z0-9][A-Z0-9-]{0,127}$/u.test(taskId)) throw new Error(`Invalid Task ID: ${taskId}`);
  }
  return Object.freeze(selected);
}
