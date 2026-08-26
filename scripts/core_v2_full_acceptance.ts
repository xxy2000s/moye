#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { handoffRestateDeployment, latestRestateServiceEndpoint } from "../src/acceptance/restate-deployment-handoff.js";
import { coreV2AcceptanceSessionSourceRoots } from "../src/acceptance/core-v2-session-evidence.js";
import { buildCoreV2MatrixAuditInput } from "../src/acceptance/core-v2-matrix-manifest.js";

const ingressUrl = process.env["MOYE_CORE_V2_ACCEPTANCE_INGRESS"] ?? "http://127.0.0.1:50889";
const adminUrl = process.env["MOYE_CORE_V2_ACCEPTANCE_ADMIN"] ?? "http://127.0.0.1:50890";
const projectId = process.env["MOYE_CORE_V2_ACCEPTANCE_PROJECT"] ?? "moye";
const acceptanceRoot = path.resolve(process.env["MOYE_CORE_V2_ACCEPTANCE_ROOT"] ?? ".moye-runtime/acceptance/core-v2");
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const runRoot = path.resolve(process.env["MOYE_CORE_V2_MATRIX_RUN_ROOT"] ?? path.join(acceptanceRoot, `matrix-${stamp}-${process.pid}`));
const pageBoardUrl = process.env["MOYE_CORE_V2_ACCEPTANCE_PAGE_BOARD"] ?? "http://127.0.0.1:3000";
const servicePort = await freePort();
let boardPort = await freePort();
while (boardPort === servicePort) boardPort = await freePort();
const auditBoardUrl = `http://127.0.0.1:${boardPort}`;
const logPath = path.join(runRoot, "matrix.log");
let service: ChildProcess | undefined;
let registrationSequence = 0;
let serviceDeploymentId: string | undefined;

await mkdir(runRoot, { recursive: true });
await assertReachable(`${adminUrl}/deployments`, "Restate Admin");
const predecessorEndpoint = process.env["MOYE_MAIN_SERVICE_ENDPOINT"] ?? await latestRestateServiceEndpoint(adminUrl, "CoreV2Workflow");
await startService();
try {
  await registerService();
  await runSuite("happy", "scripts/core_v2_acceptance.ts", ["--mode", "happy"]);
  await runSuite("faults", "scripts/core_v2_acceptance.ts", ["--mode", "faults"]);
  await runSuite("recovery", "scripts/core_v2_recovery_acceptance.ts", []);
  await registerService();
  await runSuite("guards", "scripts/core_v2_guards_acceptance.ts", []);
  await registerService();

  const auditInput = buildCoreV2MatrixAuditInput({ projectId, ingressUrl, boardUrl: auditBoardUrl, runRoot, documentGraphPath: path.resolve("docs/graph.yaml") });
  const auditInputPath = path.join(runRoot, "audit-input.json");
  const auditReportPath = path.join(runRoot, "audit-report.json");
  await writeJson(auditInputPath, auditInput);
  await runProcess("audit", "scripts/core_v2_matrix_audit.ts", ["--file", auditInputPath, "--output", auditReportPath], process.env);
  const report = JSON.parse(await readFile(auditReportPath, "utf8")) as { passed?: boolean; findingCount?: number; reportDigest?: string; scenarios?: unknown[] };
  if (report.passed !== true || report.findingCount !== 0 || report.scenarios?.length !== 16) throw new Error(`matrix audit did not pass: ${JSON.stringify(report)}`);
  const summary = {
    schemaVersion: 1,
    validationKind: "PRODUCT_ACCEPTANCE_MATRIX",
    executedAt: new Date().toISOString(),
    projectId,
    runRoot,
    suiteSummaryPaths: ["happy", "faults", "recovery", "guards"].map((suite) => path.join(runRoot, suite, "matrix-summary.json")),
    auditInputPath,
    auditReportPath,
    auditReportDigest: report.reportDigest,
    scenarioCount: report.scenarios.length,
    passed: true,
  };
  await writeJson(path.join(runRoot, "matrix-acceptance-summary.json"), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  if (serviceDeploymentId !== undefined && predecessorEndpoint !== undefined) {
    await handoffRestateDeployment(adminUrl, serviceDeploymentId, predecessorEndpoint);
  }
  await stopService();
}

async function runSuite(name: string, script: string, args: readonly string[]) {
  const suiteRoot = path.join(runRoot, name);
  await runProcess(name, script, args, {
    ...process.env,
    MOYE_CORE_V2_ACCEPTANCE_INGRESS: ingressUrl,
    MOYE_CORE_V2_ACCEPTANCE_ADMIN: adminUrl,
    MOYE_CORE_V2_ACCEPTANCE_PROJECT: projectId,
    MOYE_CORE_V2_ACCEPTANCE_ROOT: runRoot,
    MOYE_CORE_V2_ACCEPTANCE_RUN_ROOT: suiteRoot,
    MOYE_CORE_V2_ACCEPTANCE_BOARD: auditBoardUrl,
    MOYE_CORE_V2_ACCEPTANCE_PAGE_BOARD: pageBoardUrl,
    MOYE_MAIN_SERVICE_ENDPOINT: `http://host.docker.internal:${servicePort}`,
  });
}

async function runProcess(label: string, script: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  await appendFile(logPath, `\n--- ${label} start ${new Date().toISOString()} ---\n`);
  const child = spawn(process.execPath, ["--import", "tsx", script, ...args], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (value: Buffer) => { process.stdout.write(value); void appendFile(logPath, value); });
  child.stderr?.on("data", (value: Buffer) => { process.stderr.write(value); void appendFile(logPath, value); });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  await appendFile(logPath, `--- ${label} end code=${result.code} signal=${result.signal ?? "none"} ${new Date().toISOString()} ---\n`);
  if (result.code !== 0) throw new Error(`${label} exited with ${result.code ?? result.signal}`);
}

async function startService() {
  service = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { cwd: process.cwd(), env: {
    ...process.env,
    RESTATE_SERVICE_PORT: String(servicePort),
    MOYE_BOARD_PORT: String(boardPort),
    RESTATE_INGRESS_URL: ingressUrl,
    RESTATE_ADMIN_URL: adminUrl,
    MOYE_PROJECT_ID: projectId,
    MOYE_LIVE_RUNTIME_ROOT: runRoot,
    MOYE_REPOSITORY_ROOTS: runRoot,
    MOYE_ARTIFACT_ROOTS: runRoot,
    MOYE_ACCEPTANCE_FAULT_INJECTION: "enabled",
    MOYE_TEST_FAULT_INJECTION: "enabled",
    MOYE_OBSERVABILITY_ENABLED: "false",
    MOYE_SESSION_SOURCE_ROOTS: coreV2AcceptanceSessionSourceRoots(),
  }, stdio: ["ignore", "pipe", "pipe"] });
  service.stdout?.on("data", (value: Buffer) => { void appendFile(logPath, value); });
  service.stderr?.on("data", (value: Buffer) => { void appendFile(logPath, value); });
  await waitUntil(() => canConnect(servicePort), 20_000, "matrix service");
}

async function registerService() {
  const response = await fetch(`${adminUrl}/deployments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uri: `http://host.docker.internal:${servicePort}` }) });
  if (!response.ok) throw new Error(`matrix service registration failed: ${response.status} ${await response.text()}`);
  const deployment = await response.json() as { id?: string };
  if (typeof deployment.id !== "string") throw new Error("matrix service registration response has no deployment id");
  serviceDeploymentId = deployment.id;
  const probeTaskId = `TASK-MATRIX-PROBE-${stamp}-${++registrationSequence}`;
  await waitUntil(async () => (await fetch(`${ingressUrl}/CoreV2Workflow/${probeTaskId}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: "null" })).status !== 404, 20_000, "CoreV2Workflow registration");
}

async function stopService() {
  const child = service; service = undefined;
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  child.kill("SIGTERM");
  if (pid === undefined) return;
  const graceful = Date.now() + 3_000;
  while (Date.now() < graceful && processExists(pid)) await delay(50);
  if (processExists(pid)) child.kill("SIGKILL");
  const forced = Date.now() + 2_000;
  while (Date.now() < forced && processExists(pid)) await delay(25);
  if (processExists(pid)) throw new Error(`matrix service pid ${pid} survived SIGKILL`);
}

async function assertReachable(url: string, name: string) { try { const response = await fetch(url); if (response.status >= 500) throw new Error(String(response.status)); } catch (error) { throw new Error(`${name} unavailable at ${url}: ${String(error)}`); } }
async function waitUntil(check: () => boolean | Promise<boolean>, timeout: number, label: string) { const deadline = Date.now() + timeout; let last: unknown; while (Date.now() < deadline) { try { if (await check()) return; } catch (error) { last = error; } await delay(250); } throw new Error(`timeout waiting for ${label}${last === undefined ? "" : `: ${String(last)}`}`); }
async function canConnect(port: number) { return new Promise<boolean>((resolve) => { const socket = net.createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); }); }
async function freePort() { return new Promise<number>((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (address === null || typeof address === "string") return reject(new Error("port unavailable")); server.close(() => resolve(address.port)); }); }); }
async function writeJson(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
async function delay(ms: number) { await new Promise((resolve) => setTimeout(resolve, ms)); }
function processExists(pid: number) { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } }
