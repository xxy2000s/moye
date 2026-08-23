#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  auditCoreV2ScenarioBundle,
  auditDocumentGraph,
  contentDigest,
  createCoreV2MatrixAuditReport,
  validateCoreV2MatrixAuditInput,
  type CoreV2AuditScenarioSpec,
} from "../src/acceptance/core-v2-matrix-audit.js";
import { invoke } from "../src/restate/ingress.js";

const inputPath = requiredOption("--file");
const outputPath = requiredOption("--output");
const input = validateCoreV2MatrixAuditInput(JSON.parse(await readFile(inputPath, "utf8")));
const suiteDigests: Record<string, string> = {};
const results = [];

for (const suite of input.suites) {
  const summaryBytes = await readFile(suite.summaryPath);
  suiteDigests[suite.suite] = contentDigest(summaryBytes);
  const suiteSummary = JSON.parse(summaryBytes.toString("utf8"));
  for (const scenario of suite.scenarios) {
    const root = path.resolve(scenario.scenarioRoot);
    const [evidenceText, taskInput, submissionReceipt, projection, trace] = await Promise.all([
      readFile(path.join(root, "evidence-summary.json"), "utf8"),
      readJson(path.join(root, "task-input.json")),
      readJson(path.join(root, "submission-receipt.json")),
      readJson(path.join(root, "final-projection.json")),
      readJson(path.join(root, "final-trace.json")),
    ]);
    const evidenceSummary = JSON.parse(evidenceText);
    const taskId = requiredString((evidenceSummary as Record<string, unknown>)["taskId"], `${scenario.scenario}.taskId`);
    const [liveProjection, authority, liveTrace] = await Promise.all([
      invoke(input.ingressUrl, "CoreV2Workflow", taskId, "status"),
      invoke(input.ingressUrl, "TaskAuthority", taskId, "get"),
      fetchJson(`${input.boardUrl}/api/tasks/${encodeURIComponent(taskId)}/trace`),
    ]);
    results.push(auditCoreV2ScenarioBundle(suite, scenario, {
      suiteSummary,
      evidenceSummary,
      taskInput,
      submissionReceipt,
      projection,
      trace,
      liveProjection,
      authority,
      liveTrace,
      artifactChecks: await artifactChecks(projection),
      gitChecks: gitChecks(root, taskId, projection),
    }, contentDigest(evidenceText)));
  }
}

const graphValue = parseYaml(await readFile(input.documentGraph.path, "utf8"));
const report = createCoreV2MatrixAuditReport(input, suiteDigests, results, new Date().toISOString(), auditDocumentGraph(input, graphValue));
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;

async function artifactChecks(projectionValue: unknown) {
  const projection = projectionValue as { artifactRoot?: string; roleRuns?: Array<{ runId?: string; manifestDigest?: string; eventsDigest?: string }>; lifecycle?: { trustedTestRuns?: Array<{ manifestRef?: string; manifestDigest?: string }> } };
  const checks: Array<{ ref: string; exists: boolean; declaredDigest?: string; embeddedDigest?: string }> = [];
  for (const run of projection.roleRuns ?? []) {
    const runHex = requiredString(run.runId, "role runId").replace(/^sha256:/, "");
    const roleRoot = path.join(requiredString(projection.artifactRoot, "artifactRoot"), "roles", `run-${runHex}`);
    for (const [name, declaredDigest, embeddedField] of [["manifest.json", run.manifestDigest, "manifestDigest"], ["events.jsonl", run.eventsDigest, undefined]] as const) {
      try {
        const bytes = await readFile(path.join(roleRoot, name));
        const embeddedDigest = embeddedField === undefined ? contentDigest(bytes) : requiredString((JSON.parse(bytes.toString("utf8")) as Record<string, unknown>)[embeddedField], embeddedField);
        checks.push({ ref: path.join(roleRoot, name), exists: true, ...(declaredDigest === undefined ? {} : { declaredDigest }), embeddedDigest });
      } catch { checks.push({ ref: path.join(roleRoot, name), exists: false, ...(declaredDigest === undefined ? {} : { declaredDigest }) }); }
    }
  }
  for (const run of projection.lifecycle?.trustedTestRuns ?? []) {
    const ref = requiredString(run.manifestRef, "trusted test manifestRef");
    try {
      const bytes = await readFile(ref);
      const embeddedDigest = requiredString((JSON.parse(bytes.toString("utf8")) as Record<string, unknown>)["manifestDigest"], "manifestDigest");
      checks.push({ ref, exists: true, ...(run.manifestDigest === undefined ? {} : { declaredDigest: run.manifestDigest }), embeddedDigest });
    } catch { checks.push({ ref, exists: false, ...(run.manifestDigest === undefined ? {} : { declaredDigest: run.manifestDigest }) }); }
  }
  return checks;
}

function gitChecks(root: string, taskId: string, projectionValue: unknown) {
  const projection = projectionValue as { lifecycle?: { candidateCommit?: string | null; mergeCommit?: string | null } };
  const repository = path.join(root, "repository");
  const candidate = projection.lifecycle?.candidateCommit ?? null;
  const merge = projection.lifecycle?.mergeCommit ?? null;
  return {
    candidateExists: candidate !== null && gitOk(repository, "cat-file", "-e", `${candidate}^{commit}`),
    mergeExists: merge !== null && gitOk(repository, "cat-file", "-e", `${merge}^{commit}`),
    targetMatchesMerge: merge !== null && git(repository, "rev-parse", "refs/heads/release") === merge,
    mergeParents: merge === null ? [] : git(repository, "rev-list", "--parents", "-n", "1", merge).split(/\s+/),
    candidateCommitsForTask: git(repository, "log", "--all", "--fixed-strings", "--grep", `Moye-Task: ${taskId}`, "--format=%H").split("\n").filter(Boolean),
  };
}

async function readJson(file: string) { return JSON.parse(await readFile(file, "utf8")); }
async function fetchJson(url: string) { const response = await fetch(url); if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${await response.text()}`); return response.json(); }
function git(root: string, ...args: string[]) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim(); }
function gitOk(root: string, ...args: string[]) { try { execFileSync("git", ["-C", root, ...args], { stdio: "ignore" }); return true; } catch { return false; } }
function requiredString(value: unknown, field: string) { if (typeof value !== "string" || value.length === 0) throw new Error(`${field} is required`); return value; }
function requiredOption(name: string) { const index = process.argv.indexOf(name); const value = index < 0 ? undefined : process.argv[index + 1]; return requiredString(value, name); }
