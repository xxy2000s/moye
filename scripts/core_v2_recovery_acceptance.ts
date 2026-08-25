#!/usr/bin/env node

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { CoreV2WorkflowInput, CoreV2WorkflowProjection } from "../src/restate/core-v2-services.js";
import { IngressError, invoke, send } from "../src/restate/ingress.js";

type Scenario = "TEST_CONFIRMED" | "TEST_NOT_APPLIED" | "ROLE_WORKER_RECOVERY" | "CHECKPOINT_UNKNOWN" | "MERGE_UNKNOWN" | "ROLE_NOT_APPLIED" | "SESSION_CAPTURE_RECOVERY";
const ingressUrl = process.env["MOYE_CORE_V2_ACCEPTANCE_INGRESS"] ?? "http://127.0.0.1:50889";
const adminUrl = process.env["MOYE_CORE_V2_ACCEPTANCE_ADMIN"] ?? "http://127.0.0.1:50890";
const projectId = process.env["MOYE_CORE_V2_ACCEPTANCE_PROJECT"] ?? "moye";
const acceptanceRoot = path.resolve(process.env["MOYE_CORE_V2_ACCEPTANCE_ROOT"] ?? ".moye-runtime/acceptance/core-v2");
const cleanupSmoke = process.env["MOYE_CORE_V2_RECOVERY_CLEANUP_SMOKE"] === "enabled";
const requestedScenarios = (process.env["MOYE_CORE_V2_RECOVERY_SCENARIOS"] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const runRoot = path.resolve(process.env["MOYE_CORE_V2_ACCEPTANCE_RUN_ROOT"] ?? path.join(acceptanceRoot, `recovery-${stamp}-${process.pid}`));
const servicePort = await freePort();
let boardPort = await freePort();
while (boardPort === servicePort) boardPort = await freePort();
const boardUrl = `http://127.0.0.1:${boardPort}`;
const pageBoardUrl = process.env["MOYE_CORE_V2_ACCEPTANCE_PAGE_BOARD"] ?? boardUrl;
let service: ChildProcess | undefined;
let logs = "";

await mkdir(runRoot, { recursive: true });
await startService();
await registerService();
const summaries: unknown[] = [];
try {
  const allScenarios = ["TEST_CONFIRMED", "TEST_NOT_APPLIED", "ROLE_WORKER_RECOVERY", "CHECKPOINT_UNKNOWN", "MERGE_UNKNOWN", "ROLE_NOT_APPLIED"] as const;
  const selectableScenarios: readonly Scenario[] = [...allScenarios, "SESSION_CAPTURE_RECOVERY"];
  const selectedScenarios = cleanupSmoke ? [] : requestedScenarios.length === 0 ? [...allScenarios]
    : selectableScenarios.filter((scenario) => requestedScenarios.includes(scenario));
  if (!cleanupSmoke && requestedScenarios.length > 0 && (selectedScenarios.length === 0 || selectedScenarios.length !== requestedScenarios.length)) {
    throw new Error("MOYE_CORE_V2_RECOVERY_SCENARIOS contains an unknown or duplicate scenario");
  }
  for (const [index, scenario] of selectedScenarios.entries()) {
    const summary = await executeScenario(scenario, index);
    summaries.push(summary);
    process.stdout.write(`${scenario}: ${summary.taskId} ${summary.outcome}/${summary.archiveStatus}\n`);
  }
  const matrix = { schemaVersion: 1, validationKind: cleanupSmoke ? "HARNESS_CLEANUP_SMOKE" : "PRODUCT_ACCEPTANCE", executedAt: new Date().toISOString(), runRoot, ingressUrl, boardUrl, scenarios: summaries };
  await writeJson(path.join(runRoot, "matrix-summary.json"), matrix);
  process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
} finally {
  await stopService("SIGTERM");
}
process.exit(0);

async function executeScenario(scenario: Scenario, index: number) {
  const scenarioCode: Readonly<Record<Scenario, string>> = {
    TEST_CONFIRMED: "TEST-CONFIRMED",
    TEST_NOT_APPLIED: "TEST-NOT-APPLIED",
    ROLE_WORKER_RECOVERY: "ROLE-RECOVERY",
    CHECKPOINT_UNKNOWN: "CHECKPOINT-UNKNOWN",
    MERGE_UNKNOWN: "MERGE-UNKNOWN",
    ROLE_NOT_APPLIED: "ROLE-NOT-APPLIED",
    SESSION_CAPTURE_RECOVERY: "SESSION-CAPTURE",
  };
  const taskId = `TASK-RCV-${stamp}-${String(index + 1).padStart(2, "0")}-${scenarioCode[scenario]}`;
  assert(/^TASK-[A-Z0-9][A-Z0-9-]{0,63}$/.test(taskId), `invalid generated Task ID: ${taskId}`);
  const scenarioRoot = path.join(runRoot, scenario.toLowerCase());
  const repositoryRoot = path.join(scenarioRoot, "repository");
  const artifactRoot = path.join(scenarioRoot, "artifacts");
  const executionLedger = path.join(scenarioRoot, "trusted-test-executions.log");
  await mkdir(artifactRoot, { recursive: true });
  await createFixture(repositoryRoot, executionLedger);
  const baseCommit = git(repositoryRoot, "rev-parse", "HEAD");
  const marker = (name: string) => path.join(artifactRoot, `${name}.marker`);
  const codexHome = process.env["CODEX_HOME"] ?? path.join(os.homedir(), ".codex");
  const input: CoreV2WorkflowInput = {
    taskId, projectId, title: `Core v2 real recovery acceptance: ${scenario}`,
    objective: "Create src/value.txt whose complete content is exactly `accepted-value\\n`; add a README line exactly `## Accepted behavior`; create SECURITY.md whose complete content is exactly `# Security\\n` (the period ends this sentence and is not file content).",
    acceptanceCriteria: ["src/value.txt complete content is exactly accepted-value plus one newline", "README contains a line exactly ## Accepted behavior", "SECURITY.md complete content is exactly # Security plus one newline", "Trusted Runner executes npm test"],
    repositoryRoot, artifactRoot, runnerKind: "CODEX_EXEC", baseCommit, targetRef: "refs/heads/release", testCommands: [["npm", "test"]],
    ...(scenario === "TEST_CONFIRMED" ? { recoveryControl: { testExitAfterManifestOnceAt: marker("test-manifest") } } : {}),
    ...(scenario === "TEST_NOT_APPLIED" ? { recoveryControl: { testExitAfterIntentOnceAt: marker("test-intent") } } : {}),
    ...(scenario === "ROLE_WORKER_RECOVERY" ? { recoveryControl: { roleExitAfterManifestOnceAt: {
      ARCHITECT: marker("role-architect"), IMPLEMENTATION: marker("role-implementation"), FINAL_REVIEW: marker("role-final-review"),
    } } } : {}),
    ...(scenario === "ROLE_NOT_APPLIED" ? { recoveryControl: { roleExitAfterIntentOnceAt: { FINAL_REVIEW: marker("role-final-review-intent") } } } : {}),
    ...(scenario === "CHECKPOINT_UNKNOWN" ? { recoveryControl: { checkpointExitAfterCommitOnceAt: marker("checkpoint") } } : {}),
    ...(scenario === "SESSION_CAPTURE_RECOVERY" ? {
      sessionEvidence: {
        enabled: true as const,
        capturePolicy: "full" as const,
        codexSessionsRoot: process.env["MOYE_CODEX_SESSIONS_ROOT"] ?? path.join(codexHome, "sessions"),
        maxSourceBytes: 64 * 1024 * 1024,
      },
      recoveryControl: { captureExitAfterManifestOnceAt: marker("session-capture-manifest") },
    } : {}),
    acceptanceMetadata: { kind: "PRODUCT_ACCEPTANCE" as const, suite: "core-v2-recovery", scenario },
    ...(scenario === "MERGE_UNKNOWN" ? { mergeFault: { exitAfterRefUpdateOnceAt: marker("merge") } } : {}),
  };
  await writeJson(path.join(scenarioRoot, "task-input.json"), input);
  const receipt = await send(ingressUrl, "CoreV2Workflow", taskId, "run", input);
  await writeJson(path.join(scenarioRoot, "submission-receipt.json"), receipt);

  const exitCount = scenario === "ROLE_WORKER_RECOVERY" ? 3 : 1;
  for (let i = 0; i < exitCount; i += 1) { await waitForExit(15 * 60_000); await startService(); await registerService(); }

  let pending: CoreV2WorkflowProjection | undefined;
  if (scenario === "TEST_CONFIRMED" || scenario === "TEST_NOT_APPLIED" || scenario === "ROLE_NOT_APPLIED") {
    pending = await waitForProjection(taskId, (value) => value.state === "WAITING_RECONCILE", 10 * 60_000);
    const token = required(pending.error, "reconcile token");
    await expectConflict(() => invoke(ingressUrl, "CoreV2Workflow", taskId, "reconcile", { token: "sha256:invalid", action: scenario === "TEST_CONFIRMED" ? "CONFIRMED" : "NOT_APPLIED", evidence: "wrong token" }));
    const reconciliation = { token, action: scenario === "TEST_CONFIRMED" ? "CONFIRMED" as const : "NOT_APPLIED" as const, evidence: `real ledger evidence for ${scenario}` };
    await invoke(ingressUrl, "CoreV2Workflow", taskId, "reconcile", reconciliation);
    const final = await waitForProjection(taskId, (value) => value.state === "CLOSED", 15 * 60_000);
    const replayReconcile = await invoke<CoreV2WorkflowProjection>(ingressUrl, "CoreV2Workflow", taskId, "reconcile", reconciliation);
    const afterReplay = required(await invoke<CoreV2WorkflowProjection | null>(ingressUrl, "CoreV2Workflow", taskId, "status"), "projection after reconcile replay");
    assert(replayReconcile.lifecycle.projectionDigest === final.lifecycle.projectionDigest
      && afterReplay.lifecycle.projectionDigest === final.lifecycle.projectionDigest
      && afterReplay.lifecycle.events.length === final.lifecycle.events.length
      && afterReplay.attempts.length === final.attempts.length
      && afterReplay.roleRuns.length === final.roleRuns.length,
    `${taskId} identical reconciliation changed final Projection or started duplicate work`);
    await expectConflict(() => invoke(ingressUrl, "CoreV2Workflow", taskId, "reconcile", { ...reconciliation, evidence: "conflicting evidence" }));
    return persistSummary(scenarioRoot, scenario, final, receipt.invocationId, executionLedger, pending, {
      wrongTokenRejected: true,
      replayIdempotent: true,
      conflictEvidenceRejected: true,
      action: reconciliation.action,
    });
  }
  const final = await waitForProjection(taskId, (value) => value.state === "CLOSED", 15 * 60_000);
  return persistSummary(scenarioRoot, scenario, final, receipt.invocationId, executionLedger);
}

async function persistSummary(root: string, scenario: Scenario, projection: CoreV2WorkflowProjection, invocationId: string, ledger: string, pending?: CoreV2WorkflowProjection, reconciliationAudit?: { wrongTokenRejected: boolean; replayIdempotent: boolean; conflictEvidenceRejected: boolean; action: "CONFIRMED" | "NOT_APPLIED" }) {
  const trace = await fetchJson<Record<string, unknown>>(`${boardUrl}/api/tasks/${encodeURIComponent(projection.taskId)}/trace`);
  await writeJson(path.join(root, "final-projection.json"), projection); await writeJson(path.join(root, "final-trace.json"), trace);
  const expectedOutcome = scenario === "ROLE_NOT_APPLIED" ? "FAILED_TERMINAL" : "SUCCEEDED";
  assert(projection.state === "CLOSED" && projection.outcome === expectedOutcome && projection.lifecycle.archive?.status === "ARCHIVED", `${projection.taskId} terminal mismatch`);
  const expectedPhases = ["ARCHITECT", "DESIGN_REVIEW", "IMPLEMENTATION", "DOCUMENTATION", "TEST_PLAN", "TEST_ASSESSMENT", "FINAL_REVIEW"];
  for (const phase of expectedPhases.filter((phase) => scenario !== "ROLE_NOT_APPLIED" || phase !== "FINAL_REVIEW")) assert(projection.roleRuns.some((run) => run.phase === phase), `${projection.taskId} missing ${phase} Role Run`);
  if (scenario === "ROLE_NOT_APPLIED") {
    assert(!projection.roleRuns.some((run) => run.phase === "FINAL_REVIEW"), `${projection.taskId} must not claim a Final Review Manifest`);
    const failedFinal = projection.attempts.find((attempt) => attempt.phase === "FINAL_REVIEW");
    assert(failedFinal?.state === "FAILED" && failedFinal.retryAuthorized === true, `${projection.taskId} must preserve the reconciled NOT_APPLIED Final Review Attempt`);
    assert(projection.lifecycle.failure?.originalStage === "FINAL_REVIEW_REQUIRED" && projection.lifecycle.mergeCommit === null, `${projection.taskId} failure stage or Merge boundary mismatch`);
  }
  assert(new Set(projection.roleRuns.map((run) => run.attemptId)).size === projection.roleRuns.length, `${projection.taskId} duplicate logical Attempt`);
  assert(new Set(projection.roleRuns.map((run) => run.runId)).size === projection.roleRuns.length, `${projection.taskId} duplicate Role Run`);
  assert(new Set(projection.roleRuns.map((run) => run.sessionId)).size === projection.roleRuns.length, `${projection.taskId} duplicate Session`);
  if (scenario === "SESSION_CAPTURE_RECOVERY") {
    const sessionEvidence = projection.sessionEvidence ?? [];
    assert(sessionEvidence.length === projection.roleRuns.length, `${projection.taskId} does not have one Session Evidence record per Role Run`);
    for (const run of projection.roleRuns) {
      const captured = sessionEvidence.find((item) => item.attemptId === run.attemptId);
      assert(captured !== undefined, `${projection.taskId} missing Session Evidence for ${run.attemptId}`);
      assert(captured.runId === run.runId && captured.locator.stage === "CAPTURE_PENDING", `${projection.taskId} Session locator identity/stage mismatch`);
      assert(captured.executionEventsRef === run.eventsRef && captured.stderrRef === run.stderrRef, `${projection.taskId} execution stream refs were replaced by Transcript evidence`);
      assert(captured.receipt?.captureState === "COMPLETE" && captured.receipt.authorityScope === "DIAGNOSTIC_SUPPLEMENT_ONLY", `${projection.taskId} Session Receipt is not a complete diagnostic sidecar`);
      assert(captured.summary?.state === "COMPLETE" && captured.authority?.headReceiptDigest === captured.receipt.receiptDigest, `${projection.taskId} Session Evidence Authority is incomplete`);
    }
    assert(new Set(sessionEvidence.map((item) => item.receipt?.receiptDigest)).size === sessionEvidence.length, `${projection.taskId} duplicate Session Receipt`);
  }
  const executions = (await readFile(ledger, "utf8")).trim().split("\n").filter(Boolean);
  assert(executions.length === 1 && projection.lifecycle.trustedTestRuns.length === 1, `${projection.taskId} test executed more than once`);
  const repositoryRoot = path.dirname(ledger) + "/repository";
  const candidates = git(repositoryRoot, "log", "--all", "--fixed-strings", "--grep", `Moye-Task: ${projection.taskId}`, "--format=%H").split("\n").filter(Boolean);
  assert(candidates.length === projection.lifecycle.invalidatedGenerations.length + 1, `${projection.taskId} Candidate Commit count ${candidates.length} does not match valid plus invalidated generations`);
  assert(new Set(projection.lifecycle.implementationCheckpoints.map((item) => item.generation)).size === projection.lifecycle.implementationCheckpoints.length, `${projection.taskId} duplicate Checkpoint generation`);
  const mergeCommit = projection.lifecycle.mergeCommit;
  if (scenario !== "ROLE_NOT_APPLIED") {
    assert(mergeCommit !== null, `${projection.taskId} mergeCommit missing`);
    assert(git(repositoryRoot, "rev-list", "--parents", "-n", "1", mergeCommit).split(/\s+/).length === 3, `${projection.taskId} Merge is not two-parent`);
    assert(git(repositoryRoot, "rev-parse", "refs/heads/release") === mergeCommit, `${projection.taskId} target ref does not equal Merge Commit`);
  }
  assert(projection.lifecycle.implementationCheckpoints.filter((item) => item.generation === projection.lifecycle.implementationGeneration && item.candidateCommit === projection.lifecycle.candidateCommit).length === 1, `${projection.taskId} expected exactly one current Candidate Checkpoint`);
  if (scenario === "MERGE_UNKNOWN") assert(projection.lifecycle.mergeReceipt?.outcome === "ALREADY_APPLIED" && projection.lifecycle.mergeReceipt.reconciledAfterUnknown, `${projection.taskId} Merge UNKNOWN did not reconcile an already-applied ref update`);
  const artifactRoot = path.join(root, "artifacts");
  const faultMarkers = (await readdir(artifactRoot)).filter((name) => name.endsWith(".marker")).sort();
  const expectedFaultMarkers = scenario === "ROLE_WORKER_RECOVERY" ? 3 : 1;
  assert(faultMarkers.length === expectedFaultMarkers, `${projection.taskId} expected ${expectedFaultMarkers} fault markers, received ${faultMarkers.length}`);
  const summary = { schemaVersion: 1, scenario, taskId: projection.taskId, workflowRef: `restate://CoreV2Workflow/${projection.taskId}`, invocationId,
    waitingReconcile: pending === undefined ? null : { token: pending.error, kind: pending.pendingReconcile?.kind,
      phase: pending.pendingReconcile?.phase, attemptId: pending.pendingReconcile?.attemptId, runId: pending.pendingReconcile?.runId,
      operationId: pending.pendingReconcile?.operationId, eventCount: pending.lifecycle.events.length }, state: projection.state, outcome: projection.outcome,
    archiveStatus: projection.lifecycle.archive?.status, roleRuns: projection.roleRuns.map((run) => ({ phase: run.phase, attemptId: run.attemptId, sessionId: run.sessionId, runId: run.runId, manifestDigest: run.manifestDigest })),
    sessionEvidence: (projection.sessionEvidence ?? []).map((item) => ({ attemptId: item.attemptId, runId: item.runId, locatorStage: item.locator.stage,
      promptEnvelopeDigest: item.promptEnvelope.digest, receiptDigest: item.receipt?.receiptDigest, manifestDigest: item.summary?.manifestDigest,
      captureState: item.summary?.state, executionEventsRef: item.executionEventsRef, stderrRef: item.stderrRef })),
    testRun: projection.lifecycle.trustedTestRuns[0], candidateCommit: projection.lifecycle.candidateCommit, mergeCommit,
    mergeReceipt: projection.lifecycle.mergeReceipt, verificationGateDigest: projection.lifecycle.verificationGateDigest,
    closureDigest: projection.lifecycle.successClosure?.closureDigest, archiveReceiptDigest: projection.lifecycle.archive?.receiptDigest,
    projectionDigest: projection.lifecycle.projectionDigest, eventCount: projection.lifecycle.events.length, faultMarkers,
    reconciliationAudit: reconciliationAudit === undefined ? null : { ...reconciliationAudit, trustedTestExecutionCount: executions.length },
    pageUrl: `${pageBoardUrl}/tasks/${encodeURIComponent(projection.taskId)}` };
  await writeJson(path.join(root, "evidence-summary.json"), summary); return summary;
}

async function startService() {
  await appendFile(path.join(runRoot, "service.log"), `\n--- service start ${new Date().toISOString()} port=${servicePort} ---\n`);
  service = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: process.cwd(), env: { ...process.env,
    RESTATE_SERVICE_PORT: String(servicePort), MOYE_BOARD_PORT: String(boardPort), RESTATE_INGRESS_URL: ingressUrl, RESTATE_ADMIN_URL: adminUrl,
    MOYE_PROJECT_ID: projectId, MOYE_LIVE_RUNTIME_ROOT: runRoot, MOYE_REPOSITORY_ROOTS: runRoot, MOYE_ARTIFACT_ROOTS: runRoot,
    MOYE_ACCEPTANCE_FAULT_INJECTION: "enabled", MOYE_TEST_FAULT_INJECTION: "enabled", MOYE_OBSERVABILITY_ENABLED: "false",
  }, stdio: ["ignore", "pipe", "pipe"] });
  service.stdout?.on("data", (value: Buffer) => { const text = value.toString(); logs += text; void appendFile(path.join(runRoot, "service.log"), text); });
  service.stderr?.on("data", (value: Buffer) => { const text = value.toString(); logs += text; void appendFile(path.join(runRoot, "service.log"), text); });
  await waitUntil(() => canConnect(servicePort), 20_000);
}
async function registerService() { const response = await fetch(`${adminUrl}/deployments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uri: `http://host.docker.internal:${servicePort}` }) }); if (!response.ok) throw new Error(`registration failed ${await response.text()}\n${logs}`); }
async function stopService(signal: NodeJS.Signals) {
  const child = service; service = undefined;
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  child.kill(signal);
  if (pid === undefined) return;
  const gracefulDeadline = Date.now() + 3_000;
  while (Date.now() < gracefulDeadline && processExists(pid)) await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  if (processExists(pid)) {
    await appendFile(path.join(runRoot, "service.log"), `\n--- forcing service stop ${new Date().toISOString()} pid=${pid} ---\n`);
    child.kill("SIGKILL");
  }
  const forceDeadline = Date.now() + 2_000;
  while (Date.now() < forceDeadline && processExists(pid)) await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  if (processExists(pid)) throw new Error(`service pid ${pid} survived SIGKILL`);
}
async function waitForExit(timeout: number) { const child = service; if (child === undefined) throw new Error("service absent"); await Promise.race([child.exitCode !== null ? Promise.resolve() : new Promise<void>((resolveDone) => child.once("exit", () => resolveDone())), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`service did not exit\n${logs}`)), timeout))]); service = undefined; }
async function waitForProjection(taskId: string, predicate: (value: CoreV2WorkflowProjection) => boolean, timeout: number) { let latest: CoreV2WorkflowProjection | null = null; await waitUntil(async () => { latest = await invoke(ingressUrl, "CoreV2Workflow", taskId, "status"); return latest !== null && predicate(latest); }, timeout); return latest as unknown as CoreV2WorkflowProjection; }
async function expectConflict(fn: () => Promise<unknown>) { try { await fn(); throw new Error("expected conflict"); } catch (error) { if (!(error instanceof IngressError) || error.status !== 409) throw error; } }
async function waitUntil(check: () => boolean | Promise<boolean>, timeout: number) { const deadline = Date.now() + timeout; let error: unknown; while (Date.now() < deadline) { try { if (await check()) return; } catch (value) { error = value; } await new Promise((resolveDelay) => setTimeout(resolveDelay, 250)); } throw new Error(`timeout${error instanceof Error ? `: ${error.message}` : ""}`); }
async function canConnect(port: number) { return new Promise<boolean>((resolveResult) => { const socket = net.createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolveResult(true); }); socket.once("error", () => resolveResult(false)); }); }
function processExists(pid: number) { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } }
async function freePort() { return new Promise<number>((resolvePort, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (address === null || typeof address === "string") return reject(new Error("port unavailable")); server.close(() => resolvePort(address.port)); }); }); }
async function createFixture(root: string, ledger: string) { await mkdir(root, { recursive: true }); git(root, "init", "-b", "master"); git(root, "config", "user.name", "Moye Recovery Acceptance"); git(root, "config", "user.email", "moye@example.test"); await writeFile(path.join(root, "README.md"), "# Recovery fixture\n"); await writeFile(path.join(root, "package.json"), `${JSON.stringify({ private: true, scripts: { test: "node test.cjs" } }, null, 2)}\n`); await writeFile(path.join(root, "test.cjs"), `const fs=require('node:fs');if(process.env.MOYE_TRUSTED_RUNNER_EXECUTION==='1')fs.appendFileSync(${JSON.stringify(ledger)},'run\\n');const ok=fs.readFileSync('src/value.txt','utf8')==='accepted-value\\n'&&fs.readFileSync('SECURITY.md','utf8')==='# Security\\n'&&fs.readFileSync('README.md','utf8').split(/\\r?\\n/).includes('## Accepted behavior');if(!ok)process.exit(17);\n`); git(root, "add", "."); git(root, "commit", "-m", "fixture base"); git(root, "update-ref", "refs/heads/release", "HEAD"); git(root, "switch", "--detach", "HEAD"); }
function git(cwd: string, ...argv: string[]) { const result = spawnSync("git", argv, { cwd, encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr || `git ${argv[0]} failed`); return result.stdout.trim(); }
async function fetchJson<T>(url: string) { const response = await fetch(url); if (!response.ok) throw new Error(`${response.status} ${await response.text()}`); return response.json() as Promise<T>; }
async function writeJson(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
function required<T>(value: T | null | undefined, name: string): T { if (value === null || value === undefined) throw new Error(`${name} missing`); return value; }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
