import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { MoyeClient, type ProjectTaskStatusV1 } from "../src/framework/client.js";

const execFileAsync = promisify(execFile);
const sourceRoot = process.cwd();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "moye-standard-docs-task-"));
const repositoryRoot = path.join(temporaryRoot, "external-project");
const runtimeRoot = path.join(temporaryRoot, "runtime");
const toolRoot = path.join(temporaryRoot, "tool");
const packRoot = path.join(temporaryRoot, "pack");
const projectId = "standard-docs-task-acceptance";
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const taskId = `TASK-SCAFFOLD-${stamp}`;
const ingressPort = await freePort();
let adminPort = await freePort();
while (adminPort === ingressPort) adminPort = await freePort();
let servicePort = await freePort();
while ([ingressPort, adminPort].includes(servicePort)) servicePort = await freePort();
let boardPort = await freePort();
while ([ingressPort, adminPort, servicePort].includes(boardPort)) boardPort = await freePort();
const ingressUrl = `http://127.0.0.1:${ingressPort}`;
const adminUrl = `http://127.0.0.1:${adminPort}`;
const boardUrl = `http://127.0.0.1:${boardPort}`;
const containerName = `moye-standard-docs-${process.pid}-${Date.now()}`;
const outputPath = path.resolve(process.env["MOYE_DOCUMENTATION_SCAFFOLD_TASK_OUTPUT"] ?? path.join(sourceRoot, ".moye-runtime", "acceptance", "documentation-scaffold-task.json"));
const tracePath = path.resolve(process.env["MOYE_DOCUMENTATION_SCAFFOLD_TASK_TRACE"] ?? path.join(sourceRoot, ".moye-runtime", "acceptance", "documentation-scaffold-task-trace.json"));
const bundlePath = path.resolve(process.env["MOYE_DOCUMENTATION_SCAFFOLD_TASK_BUNDLE"] ?? path.join(sourceRoot, ".moye-runtime", "acceptance", "documentation-scaffold-task.bundle"));
let service: ChildProcess | undefined;
let serviceLogs = "";

try {
  await Promise.all([repositoryRoot, runtimeRoot, toolRoot, packRoot].map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(path.join(toolRoot, "package.json"), `${JSON.stringify({ private: true }, null, 2)}\n`);
  const pack = JSON.parse((await run("npm", ["pack", "--json", "--pack-destination", packRoot], sourceRoot, 180_000)).stdout) as Array<{ filename: string; integrity: string }>;
  const tarball = path.join(packRoot, pack[0]!.filename);
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], toolRoot, 180_000);
  const cli = path.join(toolRoot, "node_modules", ".bin", "moye");

  await run("git", ["init", "-q", "-b", "main"], repositoryRoot);
  await mkdir(path.join(repositoryRoot, "src"));
  await mkdir(path.join(repositoryRoot, "test"));
  await writeFile(path.join(repositoryRoot, "package.json"), `${JSON.stringify({ name: projectId, private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
  await writeFile(path.join(repositoryRoot, "src", "value.txt"), "before\n");
  await writeFile(path.join(repositoryRoot, "test", "value.test.mjs"), `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\ntest("value", async () => assert.equal(await readFile(new URL("../src/value.txt", import.meta.url), "utf8"), "after\\n"));\n`);
  const scaffold = json(await run(cli, ["init", "--docs", "standard", "--apply", "--dir", repositoryRoot, "--project-id", projectId], repositoryRoot));
  await writeFile(path.join(repositoryRoot, "docs", "knowledge", "product.md"), "# Product facts\n\nCurrent value: before.\n");
  const manifestPath = path.join(repositoryRoot, ".moye", "project.yaml");
  const projectManifest = JSON.parse(await readFile(manifestPath, "utf8")) as { repository: { targetRef: string }; workflow: { repairBudget: number; replanBudget: number }; tests: unknown };
  projectManifest.repository.targetRef = "refs/heads/release";
  projectManifest.workflow.repairBudget = 1;
  projectManifest.tests = [{ id: "node-test", argv: ["node", "--test"], cwd: "." }];
  await writeFile(manifestPath, `${JSON.stringify(projectManifest, null, 2)}\n`);
  await run(process.execPath, ["scripts/docs_validate.mjs"], repositoryRoot);
  await git(["add", "."]);
  await git(["diff", "--cached", "--check"]);
  await git(["-c", "user.name=Moye Acceptance", "-c", "user.email=acceptance@moye.invalid", "commit", "-qm", "scaffolded external project"]);
  const baseCommit = await git(["rev-parse", "HEAD"]);
  await git(["update-ref", "refs/heads/release", baseCommit]);

  await run("docker", ["run", "--rm", "-d", "--name", containerName, "-p", `127.0.0.1:${ingressPort}:8080`, "-p", `127.0.0.1:${adminPort}:9070`, "docker.restate.dev/restatedev/restate:1.7.4"], sourceRoot, 120_000);
  await waitUntil(async () => { try { return (await fetch(`${adminUrl}/deployments`)).ok; } catch { return false; } }, 30_000, "temporary Restate Admin");
  service = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: sourceRoot,
    env: {
      ...process.env,
      RESTATE_SERVICE_PORT: String(servicePort),
      MOYE_BOARD_PORT: String(boardPort),
      RESTATE_INGRESS_URL: ingressUrl,
      RESTATE_ADMIN_URL: adminUrl,
      MOYE_PROJECT_ID: projectId,
      MOYE_LIVE_RUNTIME_ROOT: runtimeRoot,
      MOYE_REPOSITORY_ROOTS: temporaryRoot,
      MOYE_ARTIFACT_ROOTS: runtimeRoot,
      MOYE_OBSERVABILITY_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collectLog = (value: Buffer) => { serviceLogs = `${serviceLogs}${value.toString("utf8")}`.slice(-2_000_000); };
  service.stdout?.on("data", collectLog);
  service.stderr?.on("data", collectLog);
  await waitUntil(async () => (await Promise.all([canConnect(servicePort), canConnect(boardPort)])).every(Boolean), 30_000, "temporary Moye service");
  const registration = await fetch(`${adminUrl}/deployments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uri: `http://host.docker.internal:${servicePort}` }) });
  if (!registration.ok) throw new Error(`service registration failed: ${registration.status} ${await registration.text()}\n${serviceLogs}`);
  const deployment = await registration.json() as { id?: string };
  if (typeof deployment.id !== "string") throw new Error("service registration returned no deployment id");

  const cliEnvironment = { ...process.env, RESTATE_INGRESS_URL: ingressUrl, MOYE_BOARD_URL: boardUrl, MOYE_FRAMEWORK_RUNTIME_ROOT: runtimeRoot };
  const doctor = json(await run(cli, ["doctor", "--file", manifestPath], repositoryRoot, 120_000, cliEnvironment));
  if (doctor.ok !== true) throw new Error(`external project doctor failed: ${JSON.stringify(doctor)}`);
  const receipt = json(await run(cli, [
    "task", "start", "--file", manifestPath, "--task-id", taskId, "--title", "Standard scaffold documentation policy task",
    "--objective", "Change the complete content of src/value.txt to after followed by one newline. Update docs/knowledge/product.md so it contains the exact fact Current value: after. Do not modify scaffold-managed files or .moye/documentation-scaffold.json.",
    "--accept", "src/value.txt contains exactly after followed by one newline",
    "--accept", "docs/knowledge/product.md contains the exact text Current value: after",
    "--accept", "the configured node --test command passes",
    "--accept", "the standard documentation custom policy produces PASSED deterministic evidence",
  ], repositoryRoot, 120_000, cliEnvironment));

  const client = new MoyeClient({ ingressUrl, boardUrl, runtimeRoot });
  let status: ProjectTaskStatusV1 | undefined;
  for await (const observed of client.watch(taskId, { timeoutMs: 30 * 60_000, intervalMs: 1_000 })) {
    status = observed;
    process.stdout.write(`${JSON.stringify({ taskId, state: observed.state, currentStep: observed.currentStep, archiveStatus: observed.archiveStatus, outcome: observed.outcome })}\n`);
  }
  if (status?.archiveStatus !== "ARCHIVED" || status.outcome !== "SUCCEEDED") throw new Error(`real scaffold task ended ${status?.state}/${status?.archiveStatus}/${status?.outcome}`);
  const trace = await client.trace(taskId);
  await mkdir(path.dirname(tracePath), { recursive: true });
  await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`);

  const policyEvidence: unknown[] = [];
  for (let revision = 1; revision <= projectManifest.workflow.replanBudget + 1; revision += 1) for (let generation = 0; generation <= projectManifest.workflow.repairBudget; generation += 1) {
    const target = path.join(runtimeRoot, projectId, taskId, ".moye", "artifacts", "documentation-policy", `r${revision}-g${generation}`, "evidence.json");
    try { policyEvidence.push(JSON.parse(await readFile(target, "utf8"))); }
    catch (error) { if (!isCode(error, "ENOENT")) throw error; }
  }
  if (!policyEvidence.some((item) => (item as { verdict?: string }).verdict === "PASSED")) throw new Error("real task produced no PASSED Documentation Policy Evidence");
  const releaseCommit = await git(["rev-parse", "refs/heads/release"]);
  const value = await git(["show", "refs/heads/release:src/value.txt"]);
  const productFacts = await git(["show", "refs/heads/release:docs/knowledge/product.md"]);
  if (value !== "after" || !productFacts.includes("Current value: after")) throw new Error("release ref does not contain accepted product facts");
  await mkdir(path.dirname(bundlePath), { recursive: true });
  await run("git", ["-C", repositoryRoot, "bundle", "create", bundlePath, "--all"], repositoryRoot, 120_000);

  const evidenceCore = {
    schemaVersion: 1,
    validationKind: "REAL_STANDARD_DOCUMENTATION_SCAFFOLD_TASK",
    taskId,
    deploymentId: deployment.id,
    runtime: { kind: "temporary-real-restate-and-current-service", image: "docker.restate.dev/restatedev/restate:1.7.4" },
    package: { filename: path.basename(tarball), integrity: pack[0]!.integrity, digest: await fileDigest(tarball) },
    scaffold: { templateVersion: scaffold.templateVersion, scaffoldDigest: scaffold.scaffoldDigest, fileCount: scaffold.files.length },
    baseCommit,
    releaseCommit,
    receipt,
    status,
    doctor: { ok: doctor.ok, checks: doctor.checks },
    documentationPolicyEvidence: policyEvidence,
    traceDigest: digestCanonical(trace),
    bundleDigest: await fileDigest(bundlePath),
    acceptedFacts: { value: "after", productDocumentation: "Current value: after" },
    fixtureRootKind: "os-temporary-directory-outside-moye",
  };
  const evidence = { ...evidenceCore, evidenceDigest: digestCanonical(evidenceCore) };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ taskId, outcome: status.outcome, archiveStatus: status.archiveStatus, policyEvidenceCount: policyEvidence.length, evidenceDigest: evidence.evidenceDigest, bundleDigest: evidenceCore.bundleDigest })}\n`);
} finally {
  await stopService();
  try { await run("docker", ["stop", "-t", "3", containerName], sourceRoot, 30_000); } catch { /* already stopped */ }
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function git(argv: readonly string[]): Promise<string> { return (await run("git", ["-C", repositoryRoot, ...argv], repositoryRoot)).stdout.trim(); }
async function fileDigest(target: string): Promise<string> { return `sha256:${createHash("sha256").update(await readFile(target)).digest("hex")}`; }
function json(result: { stdout: string }): any { return JSON.parse(result.stdout); }
function isCode(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code; }
function digestCanonical(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`; }
async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs: number, label: string): Promise<void> { const deadline = Date.now() + timeoutMs; let last: unknown; while (Date.now() < deadline) { try { if (await check()) return; } catch (error) { last = error; } await new Promise((resolveWait) => setTimeout(resolveWait, 250)); } throw new Error(`timeout waiting for ${label}${last === undefined ? "" : `: ${String(last)}`}`); }
async function canConnect(port: number): Promise<boolean> { return new Promise((resolveDone) => { const socket = net.createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolveDone(true); }); socket.once("error", () => resolveDone(false)); }); }
async function freePort(): Promise<number> { return new Promise((resolveDone, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (address === null || typeof address === "string") return reject(new Error("free port unavailable")); server.close(() => resolveDone(address.port)); }); }); }
async function stopService(): Promise<void> { const child = service; service = undefined; if (child === undefined || child.exitCode !== null) return; child.kill("SIGTERM"); await Promise.race([new Promise<void>((resolveDone) => child.once("exit", () => resolveDone())), new Promise<void>((resolveDone) => setTimeout(resolveDone, 3_000))]); if (child.exitCode === null) child.kill("SIGKILL"); }
async function run(command: string, argv: readonly string[], cwd: string, timeout = 120_000, env: NodeJS.ProcessEnv = process.env): Promise<{ stdout: string; stderr: string }> { try { return await execFileAsync(command, [...argv], { cwd, timeout, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); } catch (error) { const detail = error as { message?: string; stdout?: string; stderr?: string }; throw new Error(`${command} ${argv.join(" ")} failed: ${detail.message ?? "unknown"}\n${detail.stdout ?? ""}\n${detail.stderr ?? ""}`); } }
