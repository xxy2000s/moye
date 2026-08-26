#!/usr/bin/env node

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import type { CoreV2AttemptFenceResult, CoreV2WorkflowInput, CoreV2WorkflowProjection } from "../src/restate/core-v2-services.js";
import { IngressError, invoke, send } from "../src/restate/ingress.js";

type Scenario = "REPAIR_BUDGET" | "REPLAN_BUDGET" | "OBSERVER_TIMEOUT" | "STALE_FENCING";
const ingressUrl = process.env["MOYE_CORE_V2_ACCEPTANCE_INGRESS"] ?? "http://127.0.0.1:50889";
const adminUrl = process.env["MOYE_CORE_V2_ACCEPTANCE_ADMIN"] ?? "http://127.0.0.1:50890";
const projectId = process.env["MOYE_CORE_V2_ACCEPTANCE_PROJECT"] ?? "moye";
const acceptanceRoot = path.resolve(process.env["MOYE_CORE_V2_ACCEPTANCE_ROOT"] ?? ".moye-runtime/acceptance/core-v2");
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const runRoot = path.resolve(process.env["MOYE_CORE_V2_ACCEPTANCE_RUN_ROOT"] ?? path.join(acceptanceRoot, `guards-${stamp}-${process.pid}`));
const servicePort = await freePort();
let boardPort = await freePort();
while (boardPort === servicePort) boardPort = await freePort();
const boardUrl = `http://127.0.0.1:${boardPort}`;
const pageBoardUrl = process.env["MOYE_CORE_V2_ACCEPTANCE_PAGE_BOARD"] ?? boardUrl;
const reauditRoot = process.env["MOYE_CORE_V2_GUARD_REAUDIT_ROOT"];
const allScenarios = ["REPAIR_BUDGET", "REPLAN_BUDGET", "OBSERVER_TIMEOUT", "STALE_FENCING"] as const;
const selectedScenarios = selectScenarios(process.env["MOYE_CORE_V2_GUARD_SCENARIOS"]);
const fixtureKindInput = process.env["MOYE_CORE_V2_FIXTURE_KIND"] ?? "node";
if (fixtureKindInput !== "node" && fixtureKindInput !== "minimal-git") throw new Error("MOYE_CORE_V2_FIXTURE_KIND must be node or minimal-git");
const fixtureKind = fixtureKindInput as "node" | "minimal-git";
const trustedTestArgv = fixtureKind === "minimal-git" ? ["git", "diff", "--check", "HEAD"] : ["npm", "test"];
let service: ChildProcess | undefined;
let logs = "";

await mkdir(runRoot, { recursive: true });
await startService();
await registerService();
const summaries: unknown[] = [];
try {
  for (const scenario of selectedScenarios) {
    const index = allScenarios.indexOf(scenario);
    const summary = await executeScenario(scenario, index);
    summaries.push(summary);
    process.stdout.write(`${scenario}: ${summary.taskId} ${summary.outcome}/${summary.archiveStatus}\n`);
  }
  const matrix = { schemaVersion: 1, validationKind: "PRODUCT_ACCEPTANCE", executedAt: new Date().toISOString(), runRoot, ingressUrl, boardUrl, scenarios: summaries };
  await writeJson(path.join(runRoot, "matrix-summary.json"), matrix);
  process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
} finally {
  await stopService();
}
process.exit(0);

async function executeScenario(scenario: Scenario, index: number) {
  const code: Readonly<Record<Scenario, string>> = { REPAIR_BUDGET: "REPAIR-BUDGET", REPLAN_BUDGET: "REPLAN-BUDGET", OBSERVER_TIMEOUT: "OBSERVER-TIMEOUT", STALE_FENCING: "STALE-FENCING" };
  let taskId = `TASK-GRD-${stamp}-${String(index + 1).padStart(2, "0")}-${code[scenario]}`;
  assert(/^TASK-[A-Z0-9][A-Z0-9-]{0,63}$/.test(taskId), `invalid Task ID ${taskId}`);
  const root = reauditRoot === undefined ? path.join(runRoot, scenario.toLowerCase()) : path.resolve(reauditRoot);
  const repositoryRoot = path.join(root, "repository");
  const artifactRoot = path.join(root, "artifacts");
  const executionLedger = path.join(root, "trusted-test-executions.log");
  let input: CoreV2WorkflowInput;
  let receipt: Awaited<ReturnType<typeof send>>;
  if (reauditRoot !== undefined) {
    input = JSON.parse(await readFile(path.join(root, "task-input.json"), "utf8")) as CoreV2WorkflowInput;
    receipt = JSON.parse(await readFile(path.join(root, "submission-receipt.json"), "utf8")) as Awaited<ReturnType<typeof send>>;
    taskId = input.taskId;
    assert(input.acceptanceMetadata?.scenario === scenario, `${taskId} re-audit scenario binding mismatch`);
  } else {
    await mkdir(artifactRoot, { recursive: true });
    await createFixture(repositoryRoot, executionLedger, fixtureKind);
    const baseCommit = git(repositoryRoot, "rev-parse", "HEAD");
    input = {
      taskId, projectId, title: `Core v2 real guard acceptance: ${scenario}`,
      objective: "Create src/value.txt whose complete content is exactly `accepted-value\\n`; add a README line exactly `## Accepted behavior`; create SECURITY.md whose complete content is exactly `# Security\\n`.",
      acceptanceCriteria: ["src/value.txt contains accepted-value", "README contains ## Accepted behavior", "SECURITY.md contains # Security", "Trusted Runner executes npm test"],
      repositoryRoot, artifactRoot, runnerKind: "CODEX_EXEC", baseCommit, targetRef: "refs/heads/release", testCommands: [trustedTestArgv],
      ...(scenario === "REPAIR_BUDGET" ? { acceptanceControl: { profile: "REPAIR_BUDGET" as const } } : {}),
      ...(scenario === "REPLAN_BUDGET" ? { acceptanceControl: { profile: "REPLAN_BUDGET" as const } } : {}),
      ...(scenario === "STALE_FENCING" ? { acceptanceControl: { profile: "IMPLEMENTATION_SELF_REVIEW" as const } } : {}),
      acceptanceMetadata: { kind: "PRODUCT_ACCEPTANCE" as const, suite: "core-v2-guards", scenario },
      ...(scenario === "OBSERVER_TIMEOUT" ? { observerKnowledge: { enabled: true, timeoutMs: 4_000 } } : {}),
    };
    await writeJson(path.join(root, "task-input.json"), input);
    receipt = await send(ingressUrl, "CoreV2Workflow", taskId, "run", input);
    await writeJson(path.join(root, "submission-receipt.json"), receipt);
  }
  const final = await waitForProjection(taskId, (value) => value.state === "CLOSED", 20 * 60_000);
  const trace = await fetchJson<Record<string, unknown>>(`${boardUrl}/api/tasks/${encodeURIComponent(taskId)}/trace`);
  await writeJson(path.join(root, "final-projection.json"), final);
  await writeJson(path.join(root, "final-trace.json"), trace);
  assertUniqueRuns(final);

  let fence: { wrongDigestRejected: boolean; first: CoreV2AttemptFenceResult; replay: CoreV2AttemptFenceResult } | null = null;
  if (scenario !== "OBSERVER_TIMEOUT") {
    const stale = required(final.roleRuns.find((run) => scenario === "REPAIR_BUDGET" || scenario === "STALE_FENCING"
      ? run.phase === "IMPLEMENTATION" && run.generation === 0
      : run.phase === "DESIGN_REVIEW" && run.specRevision === 1), "stale Role Manifest");
    await expectConflict(() => invoke(ingressUrl, "CoreV2Workflow", taskId, "auditAttemptFence", { attemptId: stale.attemptId, manifestDigest: `sha256:${"0".repeat(64)}` }));
    const before = required(await invoke<CoreV2WorkflowProjection | null>(ingressUrl, "CoreV2Workflow", taskId, "status"), "projection before fence audit");
    const request = { attemptId: stale.attemptId, manifestDigest: stale.manifestDigest };
    const first = await invoke<CoreV2AttemptFenceResult>(ingressUrl, "CoreV2Workflow", taskId, "auditAttemptFence", request);
    const replay = await invoke<CoreV2AttemptFenceResult>(ingressUrl, "CoreV2Workflow", taskId, "auditAttemptFence", request);
    const after = required(await invoke<CoreV2WorkflowProjection | null>(ingressUrl, "CoreV2Workflow", taskId, "status"), "projection after fence audit");
    assert(!first.accepted && first.decision === (scenario === "REPAIR_BUDGET" || scenario === "STALE_FENCING" ? "STALE_GENERATION" : "STALE_REVISION"), `${taskId} stale decision mismatch`);
    assert(JSON.stringify(first) === JSON.stringify(replay), `${taskId} repeated fence audit was not idempotent`);
    assert(before.lifecycle.projectionDigest === after.lifecycle.projectionDigest
      && before.lifecycle.successClosure?.closureDigest === after.lifecycle.successClosure?.closureDigest
      && before.lifecycle.failureClosure?.closureDigest === after.lifecycle.failureClosure?.closureDigest, `${taskId} fence audit mutated Projection`);
    fence = { wrongDigestRejected: true, first, replay };
  }

  const executions = await readLines(executionLedger);
  const disposition = final.lifecycle.artifacts.findLast((item) => item.kind === "KNOWLEDGE_DISPOSITION")?.payload as { disposition?: string; candidateRefs?: readonly string[] } | undefined;
  if (scenario === "REPAIR_BUDGET") {
    assert(final.outcome === "FAILED_TERMINAL" && final.lifecycle.archive?.status === "ARCHIVED", `${taskId} Repair budget did not failure-archive`);
    assert(final.lifecycle.implementationGeneration === 1 && final.lifecycle.invalidatedGenerations.length === 1, `${taskId} Repair generation ledger mismatch`);
    assert(final.roleRuns.filter((run) => run.phase === "IMPLEMENTATION").length === 2, `${taskId} expected two Implementation runs`);
    assert(!final.roleRuns.some((run) => ["DOCUMENTATION", "TEST_PLAN", "TEST_ASSESSMENT", "FINAL_REVIEW"].includes(run.phase)), `${taskId} called downstream Agent after Repair budget`);
    assert(executions.length === 0 && final.lifecycle.trustedTestRuns.length === 0 && final.lifecycle.mergeCommit === null, `${taskId} executed Test or Merge after Repair budget`);
    assert(git(repositoryRoot, "log", "--all", "--fixed-strings", "--grep", `Moye-Task: ${taskId}`, "--format=%H").split("\n").filter(Boolean).length === 2, `${taskId} Candidate count mismatch`);
    assert(disposition?.disposition === "none", `${taskId} failure Knowledge Disposition missing`);
  } else if (scenario === "REPLAN_BUDGET") {
    assert(final.outcome === "FAILED_TERMINAL" && final.lifecycle.archive?.status === "ARCHIVED", `${taskId} Replan budget did not failure-archive`);
    assert(final.lifecycle.specRevision === 2 && final.lifecycle.invalidatedRevisions.length === 1 && final.lifecycle.invalidatedRevisions[0]?.specRevision === 1, `${taskId} Revision invalidation mismatch`);
    assert(final.roleRuns.filter((run) => run.phase === "ARCHITECT").length === 2 && final.roleRuns.filter((run) => run.phase === "DESIGN_REVIEW").length === 2, `${taskId} expected two Architect/Design Review pairs`);
    assert(!final.roleRuns.some((run) => run.phase === "IMPLEMENTATION") && final.lifecycle.implementationCheckpoints.length === 0 && executions.length === 0 && final.lifecycle.mergeCommit === null, `${taskId} crossed Replan budget boundary`);
    assert(disposition?.disposition === "none", `${taskId} failure Knowledge Disposition missing`);
  } else if (scenario === "OBSERVER_TIMEOUT") {
    assert(final.outcome === "SUCCEEDED" && final.lifecycle.archive?.status === "ARCHIVED", `${taskId} Observer timeout blocked main closure`);
    const observer = required(final.roleRuns.find((run) => run.phase === "OBSERVER_KNOWLEDGE"), "Observer Role Manifest");
    const observerAttempt = required(final.attempts.find((attempt) => attempt.attemptId === observer.attemptId), "Observer Attempt");
    assert(observerAttempt.state === "FAILED" && observer.outcome !== "SUCCEEDED", `${taskId} Observer timeout did not persist a failed Attempt`);
    assert(observer.sessionId !== undefined && observer.events.length > 0, `${taskId} real Observer Session/Event missing`);
    assert(disposition?.disposition === "deferred" && disposition.candidateRefs?.length === 1, `${taskId} Observer timeout did not record deferred disposition`);
    assert(final.lifecycle.mergeCommit !== null && final.lifecycle.successClosure !== null && executions.length === 1, `${taskId} main flow did not continue after Observer timeout`);
    const observerTrace = (trace["observer"] ?? {}) as { facts?: { attempts?: number; failures?: number }; reportDigest?: string };
    assert(observerTrace.reportDigest?.startsWith("sha256:") && (observerTrace.facts?.failures ?? 0) >= 1, `${taskId} deterministic Observer unavailable after intelligent sidecar failure`);
  } else {
    assert(final.outcome === "SUCCEEDED" && final.lifecycle.archive?.status === "ARCHIVED", `${taskId} stale fencing task did not close successfully`);
    assert(final.lifecycle.implementationGeneration === 1 && final.lifecycle.invalidatedGenerations.length === 1, `${taskId} stale Generation history missing`);
    assert(final.roleRuns.filter((run) => run.phase === "IMPLEMENTATION").length === 2, `${taskId} expected G0/G1 Implementation runs`);
    assert(fence?.first.decision === "STALE_GENERATION" && fence.first.accepted === false, `${taskId} stale G0 result was not rejected`);
    assert(final.lifecycle.successClosure !== null && final.lifecycle.mergeCommit !== null && executions.length === 1, `${taskId} current Generation did not complete uniquely`);
  }

  const summary = {
    schemaVersion: 1, scenario, taskId, workflowRef: `restate://CoreV2Workflow/${taskId}`, invocationId: receipt.invocationId,
    state: final.state, outcome: final.outcome, archiveStatus: final.lifecycle.archive?.status,
    specRevision: final.lifecycle.specRevision, implementationGeneration: final.lifecycle.implementationGeneration,
    roleRuns: final.roleRuns.map((run) => ({ phase: run.phase, attemptId: run.attemptId, specRevision: run.specRevision, generation: run.generation, sessionId: run.sessionId, runId: run.runId, outcome: run.outcome, eventsDigest: run.eventsDigest, manifestDigest: run.manifestDigest })),
    candidateCommit: final.lifecycle.candidateCommit, mergeCommit: final.lifecycle.mergeCommit,
    checkpoints: final.lifecycle.implementationCheckpoints.map((item) => ({ generation: item.generation, candidateCommit: item.candidateCommit, treeDigest: item.treeDigest, checkpointDigest: item.checkpointDigest })),
    trustedTestRuns: final.lifecycle.trustedTestRuns,
    verificationGateDigest: final.lifecycle.verificationGateDigest, knowledgeDispositionDigest: final.lifecycle.knowledgeDispositionDigest,
    knowledgeDisposition: disposition, failure: final.lifecycle.failure, failureClosureDigest: final.lifecycle.failureClosure?.closureDigest,
    successClosureDigest: final.lifecycle.successClosure?.closureDigest, archiveReceiptDigest: final.lifecycle.archive?.receiptDigest,
    projectionDigest: final.lifecycle.projectionDigest, fenceAudit: fence, pageUrl: `${pageBoardUrl}/tasks/${encodeURIComponent(taskId)}`,
  };
  await writeJson(path.join(root, "evidence-summary.json"), summary);
  return summary;
}

function assertUniqueRuns(projection: CoreV2WorkflowProjection) {
  assert(new Set(projection.attempts.map((item) => item.attemptId)).size === projection.attempts.length, `${projection.taskId} duplicate Attempt`);
  assert(new Set(projection.roleRuns.map((item) => item.runId)).size === projection.roleRuns.length, `${projection.taskId} duplicate Role Run`);
  const sessions = projection.roleRuns.flatMap((item) => item.sessionId === undefined ? [] : [item.sessionId]);
  assert(new Set(sessions).size === sessions.length, `${projection.taskId} duplicate Session`);
  assert(projection.lifecycle.failureClosure !== null || projection.lifecycle.successClosure !== null, `${projection.taskId} Closure missing`);
  assert(projection.lifecycle.archive?.receiptDigest?.startsWith("sha256:"), `${projection.taskId} Archive Receipt missing`);
}

async function startService() {
  await appendFile(path.join(runRoot, "service.log"), `--- service start ${new Date().toISOString()} port=${servicePort} ---\n`);
  service = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: process.cwd(), env: { ...process.env,
    RESTATE_SERVICE_PORT: String(servicePort), MOYE_BOARD_PORT: String(boardPort), RESTATE_INGRESS_URL: ingressUrl, RESTATE_ADMIN_URL: adminUrl,
    MOYE_PROJECT_ID: projectId, MOYE_LIVE_RUNTIME_ROOT: runRoot, MOYE_REPOSITORY_ROOTS: runRoot, MOYE_ARTIFACT_ROOTS: runRoot,
    MOYE_ACCEPTANCE_FAULT_INJECTION: "enabled", MOYE_OBSERVABILITY_ENABLED: "false",
  }, stdio: ["ignore", "pipe", "pipe"] });
  service.stdout?.on("data", (value: Buffer) => { const text = value.toString(); logs += text; void appendFile(path.join(runRoot, "service.log"), text); });
  service.stderr?.on("data", (value: Buffer) => { const text = value.toString(); logs += text; void appendFile(path.join(runRoot, "service.log"), text); });
  await waitUntil(() => canConnect(servicePort), 20_000);
}
async function registerService() { const response = await fetch(`${adminUrl}/deployments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uri: `http://host.docker.internal:${servicePort}` }) }); if (!response.ok) throw new Error(`registration failed ${await response.text()}\n${logs}`); }
async function stopService() {
  const child = service; service = undefined;
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid; child.kill("SIGTERM"); if (pid === undefined) return;
  const graceful = Date.now() + 3_000; while (Date.now() < graceful && processExists(pid)) await delay(50);
  if (processExists(pid)) child.kill("SIGKILL");
  const forced = Date.now() + 2_000; while (Date.now() < forced && processExists(pid)) await delay(25);
  if (processExists(pid)) throw new Error(`service pid ${pid} survived SIGKILL`);
}
async function waitForProjection(taskId: string, predicate: (value: CoreV2WorkflowProjection) => boolean, timeout: number) { let latest: CoreV2WorkflowProjection | null = null; await waitUntil(async () => { latest = await invoke(ingressUrl, "CoreV2Workflow", taskId, "status"); return latest !== null && predicate(latest); }, timeout); return latest as unknown as CoreV2WorkflowProjection; }
async function expectConflict(fn: () => Promise<unknown>) { try { await fn(); throw new Error("expected conflict"); } catch (error) { if (!(error instanceof IngressError) || error.status !== 409) throw error; } }
async function waitUntil(check: () => boolean | Promise<boolean>, timeout: number) { const deadline = Date.now() + timeout; let error: unknown; while (Date.now() < deadline) { try { if (await check()) return; } catch (value) { error = value; } await delay(1_000); } throw new Error(`timeout${error instanceof Error ? `: ${error.message}` : ""}`); }
async function canConnect(port: number) { return new Promise<boolean>((resolveResult) => { const socket = net.createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolveResult(true); }); socket.once("error", () => resolveResult(false)); }); }
function processExists(pid: number) { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } }
async function freePort() { return new Promise<number>((resolvePort, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (address === null || typeof address === "string") return reject(new Error("port unavailable")); server.close(() => resolvePort(address.port)); }); }); }
async function createFixture(root: string, ledger: string, kind: "node" | "minimal-git") { await mkdir(root, { recursive: true }); git(root, "init", "-b", "master"); git(root, "config", "user.name", "Moye Guards Acceptance"); git(root, "config", "user.email", "moye@example.test"); await writeFile(path.join(root, "README.md"), "# Guards fixture\n"); if (kind === "node") { await writeFile(path.join(root, "package.json"), `${JSON.stringify({ private: true, scripts: { test: "node test.cjs" } }, null, 2)}\n`); await writeFile(path.join(root, "test.cjs"), `const fs=require('node:fs');if(process.env.MOYE_TRUSTED_RUNNER_EXECUTION==='1')fs.appendFileSync(${JSON.stringify(ledger)},'run\\n');const ok=fs.readFileSync('src/value.txt','utf8')==='accepted-value\\n'&&fs.readFileSync('SECURITY.md','utf8')==='# Security\\n'&&fs.readFileSync('README.md','utf8').split(/\\r?\\n/).includes('## Accepted behavior');if(!ok)process.exit(17);\n`); } else { await writeFile(path.join(root, "project.txt"), "Minimal Git failure fixture\n"); } git(root, "add", "."); git(root, "commit", "-m", "fixture base"); git(root, "update-ref", "refs/heads/release", "HEAD"); git(root, "switch", "--detach", "HEAD"); }
function git(cwd: string, ...argv: string[]) { const result = spawnSync("git", argv, { cwd, encoding: "utf8" }); if (result.status !== 0) throw new Error(result.stderr || `git ${argv[0]} failed`); return result.stdout.trim(); }
async function readLines(file: string) { try { return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
async function fetchJson<T>(url: string) { const response = await fetch(url); if (!response.ok) throw new Error(`${response.status} ${await response.text()}`); return response.json() as Promise<T>; }
async function writeJson(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
async function delay(ms: number) { await new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
function required<T>(value: T | null | undefined, name: string): T { if (value === null || value === undefined) throw new Error(`${name} missing`); return value; }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function selectScenarios(value: string | undefined): readonly Scenario[] {
  if (value === undefined || value.trim() === "") return allScenarios;
  const selected = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  for (const scenario of selected) if (!allScenarios.includes(scenario as Scenario)) throw new Error(`unknown guard scenario ${scenario}`);
  if (selected.length === 0) throw new Error("MOYE_CORE_V2_GUARD_SCENARIOS selected no scenarios");
  if (reauditRoot !== undefined && selected.length !== 1) throw new Error("MOYE_CORE_V2_GUARD_REAUDIT_ROOT requires exactly one selected scenario");
  return allScenarios.filter((scenario) => selected.includes(scenario));
}
