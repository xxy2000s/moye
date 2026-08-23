#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TrustedTestRunManifest } from "../src/testing/trusted-test-runner.js";
import type { CoreV2AcceptanceProfile, CoreV2WorkflowInput, CoreV2WorkflowProjection } from "../src/restate/core-v2-services.js";
import { invoke, send } from "../src/restate/ingress.js";

type ScenarioName = "HAPPY" | CoreV2AcceptanceProfile;
interface Scenario { readonly name: ScenarioName; readonly profile?: CoreV2AcceptanceProfile }

const mode = option("--mode") ?? "happy";
if (mode !== "happy" && mode !== "faults") throw new Error("--mode must be happy or faults");
const ingressUrl = process.env["MOYE_CORE_V2_ACCEPTANCE_INGRESS"] ?? process.env["RESTATE_INGRESS_URL"] ?? "http://127.0.0.1:8080";
const boardUrl = process.env["MOYE_CORE_V2_ACCEPTANCE_BOARD"] ?? "http://127.0.0.1:3000";
const projectId = process.env["MOYE_CORE_V2_ACCEPTANCE_PROJECT"] ?? process.env["MOYE_PROJECT_ID"] ?? "moye";
const acceptanceRoot = path.resolve(process.env["MOYE_CORE_V2_ACCEPTANCE_ROOT"] ?? ".moye-runtime/acceptance/core-v2");
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const runRoot = path.join(acceptanceRoot, `${mode}-${stamp}-${process.pid}`);
const allFaultScenarios: readonly Scenario[] = [
      { name: "IMPLEMENTATION_SELF_REVIEW", profile: "IMPLEMENTATION_SELF_REVIEW" },
      { name: "FINAL_REVIEW", profile: "FINAL_REVIEW" },
      { name: "DOCUMENTATION", profile: "DOCUMENTATION" },
      { name: "TEST_FAILURE", profile: "TEST_FAILURE" },
      { name: "DESIGN_REPLAN", profile: "DESIGN_REPLAN" },
    ];
const requestedScenarios = (process.env["MOYE_CORE_V2_ACCEPTANCE_SCENARIOS"] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const scenarios: readonly Scenario[] = mode === "happy"
  ? [{ name: "HAPPY" }]
  : requestedScenarios.length === 0 ? allFaultScenarios : allFaultScenarios.filter((item) => requestedScenarios.includes(item.name));
if (mode === "faults" && requestedScenarios.length > 0 && (scenarios.length === 0 || scenarios.length !== requestedScenarios.length)) throw new Error("MOYE_CORE_V2_ACCEPTANCE_SCENARIOS contains an unknown or duplicate scenario");

await assertProductService();
await mkdir(runRoot, { recursive: true });
const summaries: unknown[] = [];
let failures = 0;
for (const [index, scenario] of scenarios.entries()) {
  try {
    const summary = await executeScenario(scenario, index);
    summaries.push(summary);
    process.stdout.write(`${scenario.name}: ${summary.taskId} ${summary.outcome}/${summary.archiveStatus}\n`);
  } catch (error) {
    failures += 1;
    const failure = { scenario: scenario.name, error: error instanceof Error ? error.message : String(error) };
    summaries.push(failure);
    await writeJson(path.join(runRoot, scenario.name.toLowerCase(), "harness-failure.json"), failure);
    process.stderr.write(`${scenario.name}: FAILED ${failure.error}\n`);
  }
}
const matrix = { schemaVersion: 1, validationKind: "PRODUCT_ACCEPTANCE", executedAt: new Date().toISOString(), mode, ingressUrl, boardUrl, projectId, runRoot, scenarios: summaries };
await writeJson(path.join(runRoot, "matrix-summary.json"), matrix);
process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
if (failures > 0) throw new Error(`${failures} Core v2 acceptance scenario(s) failed; evidence was preserved under ${runRoot}`);

async function executeScenario(scenario: Scenario, index: number) {
  const slug = scenario.name.replaceAll("_", "-");
  const taskId = `TASK-ACCEPT-${stamp}-${String(index + 1).padStart(2, "0")}-${slug}`.slice(0, 69);
  const scenarioRoot = path.join(runRoot, scenario.name.toLowerCase());
  const repositoryRoot = path.join(scenarioRoot, "repository");
  const artifactRoot = path.join(scenarioRoot, "artifacts");
  await createFixture(repositoryRoot);
  await mkdir(artifactRoot, { recursive: true });
  const baseCommit = git(repositoryRoot, "rev-parse", "HEAD");
  const input: CoreV2WorkflowInput = {
    taskId,
    projectId,
    title: `Core v2 real acceptance: ${scenario.name}`,
    objective: "Create src/value.txt containing exactly accepted-value followed by one newline; add the exact README.md heading `## Accepted behavior` describing that fact; and create SECURITY.md with a `# Security` heading.",
    acceptanceCriteria: [
      "src/value.txt contains exactly accepted-value followed by one newline",
      "README.md contains the exact heading ## Accepted behavior",
      "SECURITY.md exists and contains a # Security heading",
      "the authorized npm test command is executed by the Trusted Runner",
    ],
    repositoryRoot,
    artifactRoot,
    runnerKind: "CODEX_EXEC",
    baseCommit,
    targetRef: "refs/heads/release",
    testCommands: [["npm", "test"]],
    ...(scenario.profile === undefined ? {} : { acceptanceControl: { profile: scenario.profile } }),
    acceptanceMetadata: { kind: "PRODUCT_ACCEPTANCE" as const, suite: "core-v2", scenario: scenario.name },
  };
  await writeJson(path.join(scenarioRoot, "task-input.json"), input);
  const receipt = await send(ingressUrl, "CoreV2Workflow", taskId, "run", input);
  await writeJson(path.join(scenarioRoot, "submission-receipt.json"), receipt);
  const projection = await waitForTerminal(taskId, 25 * 60_000);
  await writeJson(path.join(scenarioRoot, "final-projection.json"), projection);
  const trace = await fetchJson<Record<string, unknown>>(`${boardUrl}/api/tasks/${encodeURIComponent(taskId)}/trace`);
  await writeJson(path.join(scenarioRoot, "final-trace.json"), trace);
  const manifests = await Promise.all((projection.lifecycle.trustedTestRuns ?? []).map(async (run) => {
    const manifest = JSON.parse(await readFile(run.manifestRef, "utf8")) as TrustedTestRunManifest;
    assert(manifest.manifestDigest === run.manifestDigest, `${taskId} Trusted Test manifest digest drift`);
    return manifest;
  }));
  const roleEvents = await Promise.all(projection.roleRuns.map(async (run) => {
    const page = await fetchJson<{ total: number; completed: boolean }>(`${boardUrl}/api/tasks/${encodeURIComponent(taskId)}/roles/${encodeURIComponent(run.runId)}/events?cursor=0&limit=200`);
    assert(page.completed && page.total > 0, `${taskId} missing real Role events for ${run.phase}`);
    return { runId: run.runId, phase: run.phase, total: page.total };
  }));
  auditCommon(input, projection, trace, manifests);
  auditScenario(scenario.name, projection, manifests);
  const lifecycle = projection.lifecycle;
  const mergeCommit = required(lifecycle.mergeCommit, "mergeCommit");
  const candidateCommit = required(lifecycle.candidateCommit, "candidateCommit");
  const mergeParents = git(repositoryRoot, "rev-list", "--parents", "-n", "1", mergeCommit).split(/\s+/);
  assert(mergeParents.length === 3 && mergeParents[1] === baseCommit && mergeParents[2] === candidateCommit, `${taskId} Merge DAG is not base + verified Candidate`);
  assert(git(repositoryRoot, "rev-parse", "refs/heads/release") === mergeCommit, `${taskId} target ref does not name Merge Commit`);
  const checkpointCommits = lifecycle.implementationCheckpoints.map((item) => item.candidateCommit);
  assert(new Set(checkpointCommits).size === checkpointCommits.length, `${taskId} duplicate Candidate Commit`);
  for (const checkpoint of lifecycle.implementationCheckpoints) {
    assert(git(repositoryRoot, "log", "-1", "--format=%B", checkpoint.candidateCommit).includes(`Moye-Task: ${taskId}`), `${taskId} checkpoint trailer missing`);
  }
  const summary = {
    schemaVersion: 1,
    requirementRefs: ["REQ-0043-01", scenario.name === "HAPPY" ? "REQ-0043-02" : requirementFor(scenario.name), "REQ-0043-07", "REQ-0043-08", "REQ-0043-09"],
    scenario: scenario.name,
    testCase: `TC-CORE-V2-${scenario.name}`,
    taskId,
    workflowRef: `restate://CoreV2Workflow/${taskId}`,
    invocationId: receipt.invocationId,
    state: projection.state,
    outcome: projection.outcome,
    archiveStatus: lifecycle.archive?.status,
    specRevision: lifecycle.specRevision,
    implementationGeneration: lifecycle.implementationGeneration,
    roleRuns: projection.roleRuns.map((run) => ({ role: run.role, phase: run.phase, attemptId: run.attemptId, sessionId: run.sessionId, runId: run.runId, generation: run.generation, specRevision: run.specRevision, recommendation: run.output?.recommendation, eventsDigest: run.eventsDigest, manifestDigest: run.manifestDigest })),
    roleEvents,
    candidateCommit,
    checkpoints: lifecycle.implementationCheckpoints.map((item) => ({ generation: item.generation, candidateCommit: item.candidateCommit, treeDigest: item.treeDigest, checkpointDigest: item.checkpointDigest })),
    trustedTests: manifests.map((manifest) => ({ runId: manifest.runId, candidateCommit: manifest.candidateCommit, argv: manifest.cases.map((item) => item.argv), exitCodes: manifest.cases.map((item) => item.exitCode), outcome: manifest.outcome, manifestDigest: manifest.manifestDigest })),
    verificationGateDigest: lifecycle.verificationGateDigest,
    knowledgeDispositionDigest: lifecycle.knowledgeDispositionDigest,
    mergeCommit,
    mergeReceiptDigest: lifecycle.mergeReceipt?.receiptDigest,
    closureDigest: lifecycle.successClosure?.closureDigest,
    archiveReceipt: lifecycle.archive?.receiptRef,
    archiveReceiptDigest: lifecycle.archive?.receiptDigest,
    projectionDigest: lifecycle.projectionDigest,
    eventCount: lifecycle.events.length,
    pageUrl: `${boardUrl}/tasks/${encodeURIComponent(taskId)}`,
  };
  await writeJson(path.join(scenarioRoot, "evidence-summary.json"), summary);
  return summary;
}

function auditCommon(input: CoreV2WorkflowInput, projection: CoreV2WorkflowProjection, trace: Record<string, unknown>, manifests: readonly TrustedTestRunManifest[]): void {
  const taskId = input.taskId;
  const lifecycle = projection.lifecycle;
  assert(projection.state === "CLOSED" && projection.outcome === "SUCCEEDED" && lifecycle.archive?.status === "ARCHIVED", `${taskId} did not close and archive successfully: ${projection.state}/${projection.outcome}/${lifecycle.archive?.status}: ${projection.error}`);
  assert(lifecycle.successClosure?.outcome === "SUCCEEDED" && lifecycle.failureClosure === null, `${taskId} has invalid success Closure`);
  assert(lifecycle.verificationGateDigest !== null && lifecycle.knowledgeDispositionDigest !== null, `${taskId} is missing Gate or Knowledge Disposition`);
  assert(lifecycle.mergeReceipt !== null && lifecycle.mergeCommit !== lifecycle.candidateCommit, `${taskId} does not have a real Merge Receipt`);
  assert(projection.roleRuns.length === projection.attempts.length, `${taskId} Role Run / Attempt mismatch`);
  assert(unique(projection.roleRuns.map((run) => run.runId)), `${taskId} duplicate Role Run`);
  assert(unique(projection.roleRuns.map((run) => run.attemptId)), `${taskId} duplicate Attempt`);
  assert(unique(projection.roleRuns.map((run) => required(run.sessionId, `${run.phase} sessionId`))), `${taskId} duplicate or missing Session`);
  assert(projection.roleRuns.every((run) => run.runnerKind === "CODEX_EXEC" && run.outcome === "SUCCEEDED" && run.eventsDigest.startsWith("sha256:") && run.manifestDigest.startsWith("sha256:")), `${taskId} contains a non-real or failed Role Run`);
  assert(manifests.length === lifecycle.trustedTestRuns.length && unique(manifests.map((item) => item.runId)), `${taskId} duplicate or missing Trusted Test Manifest`);
  assert(manifests.every((manifest) => manifest.taskId === taskId && manifest.repositoryRoot === input.repositoryRoot && manifest.cases.length === 1 && JSON.stringify(manifest.cases[0]?.argv) === JSON.stringify(["npm", "test"])), `${taskId} Trusted Test binding is invalid`);
  const task = trace["task"] as Record<string, unknown> | undefined;
  const tracedLifecycle = trace["lifecycle"] as Record<string, unknown> | undefined;
  assert(task?.["outcome"] === "SUCCEEDED" && task["archiveStatus"] === "ARCHIVED", `${taskId} Board Trace terminal mismatch`);
  assert(tracedLifecycle?.["projectionDigest"] === lifecycle.projectionDigest, `${taskId} Projection and Trace differ`);
  assert(lifecycle.events.every((event, index) => event.sequence === index + 1), `${taskId} Event sequence is not contiguous`);
}

function auditScenario(name: ScenarioName, projection: CoreV2WorkflowProjection, manifests: readonly TrustedTestRunManifest[]): void {
  const runs = projection.roleRuns;
  const lifecycle = projection.lifecycle;
  const count = (phase: string, generation?: number, revision?: number) => runs.filter((run) => run.phase === phase && (generation === undefined || run.generation === generation) && (revision === undefined || run.specRevision === revision)).length;
  const recommendation = (phase: string, generation: number, revision = lifecycle.specRevision) => runs.find((run) => run.phase === phase && run.generation === generation && run.specRevision === revision)?.output?.recommendation;
  if (name === "HAPPY") {
    assert(runs.length === 7 && lifecycle.implementationCheckpoints.length === 1 && manifests.length === 1 && manifests[0]?.outcome === "PASSED", `${projection.taskId} Happy Path shape mismatch`);
    return;
  }
  assert(lifecycle.invalidatedGenerations.length === (name === "DESIGN_REPLAN" ? 0 : 1), `${projection.taskId} invalidated Generation ledger mismatch`);
  if (name === "IMPLEMENTATION_SELF_REVIEW") {
    assert(runs.length === 8 && count("IMPLEMENTATION") === 2 && recommendation("IMPLEMENTATION", 0, 1) === "FINDINGS" && recommendation("IMPLEMENTATION", 1, 1) === "PASS", `${projection.taskId} Self Review repair path mismatch`);
    assert(lifecycle.implementationCheckpoints.length === 2 && manifests.length === 1 && manifests[0]?.candidateCommit === lifecycle.candidateCommit, `${projection.taskId} Self Review evidence was duplicated or stale`);
  } else if (name === "FINAL_REVIEW") {
    assert(runs.length === 12 && count("FINAL_REVIEW", 0) === 1 && count("FINAL_REVIEW", 1) === 1 && recommendation("FINAL_REVIEW", 0) === "FINDINGS" && recommendation("FINAL_REVIEW", 1) === "PASS", `${projection.taskId} Final Review repair path mismatch`);
    assert(manifests.length === 2 && manifests.every((item) => item.outcome === "PASSED"), `${projection.taskId} Final Review tests were not rerun exactly once per Candidate`);
    assert(lifecycle.invalidatedGenerations[0]?.artifactRefs.some((ref) => ref.kind === "FINAL_REVIEW"), `${projection.taskId} old Final Review evidence was not invalidated`);
  } else if (name === "DOCUMENTATION") {
    assert(runs.length === 9 && count("DOCUMENTATION", 0) === 1 && count("DOCUMENTATION", 1) === 1 && recommendation("DOCUMENTATION", 0) === "FINDINGS" && recommendation("DOCUMENTATION", 1) === "PASS", `${projection.taskId} Documentation repair path mismatch`);
    assert(manifests.length === 1 && manifests[0]?.candidateCommit === lifecycle.candidateCommit, `${projection.taskId} Documentation Finding bypassed or duplicated Test Gate`);
  } else if (name === "TEST_FAILURE") {
    assert(runs.length === 11 && count("TEST_ASSESSMENT", 0) === 1 && count("TEST_ASSESSMENT", 1) === 1, `${projection.taskId} Test repair Role shape mismatch`);
    assert(manifests.length === 2 && manifests[0]?.outcome === "FAILED" && manifests[1]?.outcome === "PASSED", `${projection.taskId} real failed and repaired tests are not both preserved`);
    assert(lifecycle.invalidatedGenerations[0]?.trustedTestRun?.manifestDigest === manifests[0]?.manifestDigest, `${projection.taskId} failed Test Evidence was not invalidated`);
  } else {
    assert(lifecycle.specRevision === 2 && lifecycle.invalidatedRevisions.length === 1 && lifecycle.invalidatedRevisions[0]?.specRevision === 1, `${projection.taskId} Replan revision ledger mismatch`);
    assert(runs.length === 9 && count("ARCHITECT", 0, 1) === 1 && count("DESIGN_REVIEW", 0, 1) === 1 && count("ARCHITECT", 0, 2) === 1 && count("DESIGN_REVIEW", 0, 2) === 1, `${projection.taskId} Architect / Design Review did not rerun for R2`);
    assert(recommendation("DESIGN_REVIEW", 0, 1) === "FINDINGS" && recommendation("DESIGN_REVIEW", 0, 2) === "PASS", `${projection.taskId} Replan verdicts are invalid`);
    assert(manifests.length === 1 && manifests[0]?.specRevision === 2, `${projection.taskId} R1 Evidence reached the R2 Gate`);
  }
}

async function createFixture(repositoryRoot: string): Promise<void> {
  await mkdir(repositoryRoot, { recursive: true });
  git(repositoryRoot, "init", "-b", "master");
  git(repositoryRoot, "config", "user.name", "Moye Core v2 Acceptance");
  git(repositoryRoot, "config", "user.email", "moye-core-v2@example.test");
  await writeFile(path.join(repositoryRoot, "README.md"), "# Core v2 acceptance fixture\n");
  await writeFile(path.join(repositoryRoot, "package.json"), `${JSON.stringify({ name: "moye-core-v2-acceptance", private: true, scripts: { test: "node test.cjs" } }, null, 2)}\n`);
  await writeFile(path.join(repositoryRoot, "test.cjs"), "const fs=require('node:fs');const value=fs.readFileSync('src/value.txt','utf8');if(value!=='accepted-value\\n'){console.error('expected accepted-value');process.exit(17)}console.log('trusted value accepted')\n");
  git(repositoryRoot, "add", "README.md", "package.json", "test.cjs");
  git(repositoryRoot, "commit", "-m", "fixture base");
  git(repositoryRoot, "update-ref", "refs/heads/release", "HEAD");
  git(repositoryRoot, "switch", "--detach", "HEAD");
}

async function waitForTerminal(taskId: string, timeoutMs: number): Promise<CoreV2WorkflowProjection> {
  const deadline = Date.now() + timeoutMs;
  let last: CoreV2WorkflowProjection | null = null;
  while (Date.now() < deadline) {
    last = await invoke<CoreV2WorkflowProjection | null>(ingressUrl, "CoreV2Workflow", taskId, "status");
    if (last !== null && (last.state === "CLOSED" || last.state === "ARCHIVE_FAILED")) return last;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`Timed out waiting for ${taskId}; last=${JSON.stringify(last)}`);
}

async function assertProductService(): Promise<void> {
  const response = await fetch(`${boardUrl}/api/board`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Moye Board is unavailable at ${boardUrl}: ${response.status}`);
  const disabledProbe: CoreV2WorkflowInput = {
    taskId: `TASK-ACCEPT-PROBE-${stamp}`,
    projectId,
    title: "acceptance capability probe",
    objective: "probe only",
    acceptanceCriteria: ["probe"],
    repositoryRoot: runRoot,
    artifactRoot: path.join(runRoot, "probe"),
    runnerKind: "CODEX_EXEC",
    baseCommit: "0".repeat(40),
    testCommands: [["npm", "test"]],
    acceptanceControl: { profile: "TEST_FAILURE" },
  };
  // The service has no capability endpoint for this opt-in. The actual Workflow validates it before TaskAuthority claim;
  // the first real fault Task therefore remains the authoritative authorization check without creating a probe Workflow key.
  void disabledProbe;
}

function requirementFor(name: Exclude<ScenarioName, "HAPPY">): string {
  return ({ IMPLEMENTATION_SELF_REVIEW: "REQ-0043-03", FINAL_REVIEW: "REQ-0043-04", DOCUMENTATION: "REQ-0043-05", TEST_FAILURE: "REQ-0043-05", DESIGN_REPLAN: "REQ-0043-06", REPAIR_BUDGET: "REQ-0045-01", REPLAN_BUDGET: "REQ-0045-02" })[name];
}
function required<T>(value: T | null | undefined, label: string): T { if (value === null || value === undefined || value === "") throw new Error(`${label} is required`); return value; }
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length; }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function git(cwd: string, ...argv: string[]): string { return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
async function writeJson(filePath: string, value: unknown): Promise<void> { await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`); }
async function fetchJson<T>(url: string): Promise<T> { const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error(`${url} returned ${response.status}: ${await response.text()}`); return response.json() as Promise<T>; }
