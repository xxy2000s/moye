import { execFile, spawn, type ChildProcess } from "node:child_process";
import { appendFile, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { handoffRestateDeployment, latestRestateServiceEndpoint } from "../src/acceptance/restate-deployment-handoff.js";
import { coreV2AcceptanceSessionSourceRoots } from "../src/acceptance/core-v2-session-evidence.js";
import { digestCanonical } from "../src/release/manifest.js";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const matrixRoot = path.resolve(process.env["MOYE_FRAMEWORK_MATRIX_ROOT"] ?? path.join(root, ".moye-runtime", "acceptance", `framework-matrix-${stamp}`));
const ingressUrl = process.env["RESTATE_INGRESS_URL"] ?? "http://127.0.0.1:50889";
const adminUrl = process.env["RESTATE_ADMIN_URL"] ?? "http://127.0.0.1:50890";
const boardUrl = process.env["MOYE_BOARD_URL"] ?? "http://127.0.0.1:3000";
const resumeRoot = process.env["MOYE_FRAMEWORK_MATRIX_RESUME_ROOT"] === undefined ? undefined : path.resolve(process.env["MOYE_FRAMEWORK_MATRIX_RESUME_ROOT"]);
const faultResumeRoot = process.env["MOYE_FRAMEWORK_MATRIX_FAULT_RESUME_ROOT"] === undefined ? undefined : path.resolve(process.env["MOYE_FRAMEWORK_MATRIX_FAULT_RESUME_ROOT"]);
const oldRoot = path.join(matrixRoot, "old-release-checkout");
const snapshotContainer = await mkdtemp(path.join(os.tmpdir(), "moye-w09-snapshot-"));
const newRoot = path.join(snapshotContainer, "moye");
const result: Array<Record<string, unknown>> = [];
const acceptanceServicePort = await freePort();
let acceptanceBoardPort = await freePort();
while (acceptanceBoardPort === acceptanceServicePort) acceptanceBoardPort = await freePort();
let acceptanceService: ChildProcess | undefined;
let acceptanceServiceLogs = "";
let acceptanceDeploymentId: string | undefined;

await mkdir(matrixRoot, { recursive: true });
const predecessorEndpoint = process.env["MOYE_MAIN_SERVICE_ENDPOINT"] ?? await latestRestateServiceEndpoint(adminUrl, "CoreV2Workflow");
try {
  await startAcceptanceService();
  await registerService(acceptanceServicePort);
  if (resumeRoot === undefined) await runStage("node-happy", "npx", ["tsx", "scripts/core_v2_acceptance.ts", "--mode", "happy"], {
      MOYE_CORE_V2_ACCEPTANCE_RUN_ROOT: path.join(matrixRoot, "node-happy"),
      MOYE_CORE_V2_FIXTURE_KIND: "node",
    });
  const nodeHappy = await matrixScenario(path.join(resumeRoot ?? matrixRoot, "node-happy"), 0);
  result.push({ requirement: "REQ-0074-01", project: "node-typescript", scenario: "HAPPY", ...nodeHappy });

  if (resumeRoot === undefined) await runStage("node-repair", "npx", ["tsx", "scripts/core_v2_acceptance.ts", "--mode", "faults"], {
      MOYE_CORE_V2_ACCEPTANCE_RUN_ROOT: path.join(matrixRoot, "node-repair"),
      MOYE_CORE_V2_ACCEPTANCE_SCENARIOS: "IMPLEMENTATION_SELF_REVIEW",
      MOYE_CORE_V2_FIXTURE_KIND: "node",
    });
  result.push({ requirement: "REQ-0074-01", project: "node-typescript", scenario: "IMPLEMENTATION_SELF_REVIEW", ...await matrixScenario(path.join(resumeRoot ?? matrixRoot, "node-repair"), 0) });

  if (resumeRoot === undefined) await runStage("python-test-repair", "npx", ["tsx", "scripts/core_v2_acceptance.ts", "--mode", "faults"], {
      MOYE_CORE_V2_ACCEPTANCE_RUN_ROOT: path.join(matrixRoot, "python-test-repair"),
      MOYE_CORE_V2_ACCEPTANCE_SCENARIOS: "TEST_FAILURE",
      MOYE_CORE_V2_FIXTURE_KIND: "python",
    });
  result.push({ requirement: "REQ-0074-02", project: "python", scenario: "TEST_FAILURE_REPAIR", ...await matrixScenario(path.join(resumeRoot ?? matrixRoot, "python-test-repair"), 0) });

  if (faultResumeRoot === undefined) await runStage("minimal-reconcile", "npx", ["tsx", "scripts/core_v2_recovery_acceptance.ts"], {
      MOYE_CORE_V2_ACCEPTANCE_RUN_ROOT: path.join(matrixRoot, "minimal-reconcile"),
      MOYE_CORE_V2_RECOVERY_SCENARIOS: "TEST_NOT_APPLIED",
      MOYE_CORE_V2_FIXTURE_KIND: "minimal-git",
    });
  result.push({ requirement: "REQ-0074-03", project: "minimal-git", scenario: "TEST_UNKNOWN_NOT_APPLIED", ...await matrixScenario(path.join(faultResumeRoot ?? matrixRoot, "minimal-reconcile"), 0) });

  if (faultResumeRoot === undefined) await runStage("minimal-failure", "npx", ["tsx", "scripts/core_v2_guards_acceptance.ts"], {
      MOYE_CORE_V2_ACCEPTANCE_RUN_ROOT: path.join(matrixRoot, "minimal-failure"),
      MOYE_CORE_V2_GUARD_SCENARIOS: "REPAIR_BUDGET",
      MOYE_CORE_V2_FIXTURE_KIND: "minimal-git",
    });
  result.push({ requirement: "REQ-0074-04", project: "minimal-git", scenario: "FAILED_TERMINAL_ARCHIVE", ...await matrixScenario(path.join(faultResumeRoot ?? matrixRoot, "minimal-failure"), 0) });

  await handoffAcceptanceDeployment();
  await stopAcceptanceService();
  await prepareOldCheckout(oldRoot);
  await prepareCurrentSnapshot(newRoot);
  await runStage("cross-version-recovery", "npx", ["tsx", "scripts/core_v2_recovery_acceptance.ts"], {
    MOYE_CORE_V2_ACCEPTANCE_RUN_ROOT: path.join(matrixRoot, "cross-version-recovery"),
    MOYE_CORE_V2_RECOVERY_SCENARIOS: "ROLE_WORKER_RECOVERY",
    MOYE_CORE_V2_FIXTURE_KIND: "node",
    MOYE_CORE_V2_RECOVERY_INITIAL_CWD: oldRoot,
    MOYE_CORE_V2_RECOVERY_CURRENT_CWD: newRoot,
    MOYE_CORE_V2_UPGRADE_ARCHIVED_TASK_ID: String(nodeHappy["taskId"]),
    ...(predecessorEndpoint === undefined ? {} : { MOYE_MAIN_SERVICE_ENDPOINT: predecessorEndpoint }),
  });
  const upgradeMatrix = await readJson<{ serviceTransitions: Array<{ commit: string; releaseVersion: string }>; archivedUpgrade: { taskId: string; beforeDigest: string; afterDigest: string }; scenarios: Array<Record<string, unknown>> }>(path.join(matrixRoot, "cross-version-recovery", "matrix-summary.json"));
  const upgradeScenario = upgradeMatrix.scenarios[0];
  if (upgradeScenario === undefined || new Set(upgradeMatrix.serviceTransitions.map((item) => item.commit)).size < 2 || upgradeMatrix.archivedUpgrade.beforeDigest !== upgradeMatrix.archivedUpgrade.afterDigest) throw new Error("cross-version evidence did not bind two commits and an unchanged archived Projection");
  result.push({ requirement: "REQ-0074-05", project: "upgrade-fixture", scenario: "RUNNING_AND_ARCHIVED_CROSS_VERSION", ...upgradeScenario, serviceTransitions: upgradeMatrix.serviceTransitions, archivedUpgrade: upgradeMatrix.archivedUpgrade });

  await runStage("clean-install", "npm", ["run", "acceptance:framework:release"], {
    MOYE_RELEASE_OUTPUT: path.join(matrixRoot, "clean-install", "release"),
    MOYE_RELEASE_IMAGE: "moye:0.1.0-rc.2",
    MOYE_RELEASE_VERSION: "0.1.0-rc.2",
  });
  const release = await readJson<Record<string, unknown>>(path.join(matrixRoot, "clean-install", "release", "evidence-summary.json"));
  result.push({ requirement: "REQ-0074-06", project: "clean-install", scenario: "TARBALL_AND_CONTAINER", release });

  const summaryCore = { schemaVersion: 1, validationKind: "REAL_EXTERNAL_FRAMEWORK_PRODUCT_MATRIX", executedAt: new Date().toISOString(), scenarios: result };
  const summary = { ...summaryCore, evidenceDigest: digestCanonical(summaryCore) };
  await writeFile(path.join(matrixRoot, "framework-product-matrix.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await handoffAcceptanceDeployment().catch(() => undefined);
  await stopAcceptanceService().catch(() => undefined);
  await removeOldCheckout(oldRoot).catch(() => undefined);
  await rm(snapshotContainer, { recursive: true, force: true });
}

async function startAcceptanceService(): Promise<void> {
  const logPath = path.join(matrixRoot, "logs", "acceptance-service.log");
  await mkdir(path.dirname(logPath), { recursive: true });
  const sourceRevision = await run("git", ["rev-parse", "HEAD"], root);
  acceptanceService = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      RESTATE_SERVICE_PORT: String(acceptanceServicePort),
      MOYE_BOARD_PORT: String(acceptanceBoardPort),
      RESTATE_INGRESS_URL: ingressUrl,
      RESTATE_ADMIN_URL: adminUrl,
      MOYE_PROJECT_ID: process.env["MOYE_PROJECT_ID"] ?? "moye",
      MOYE_LIVE_RUNTIME_ROOT: matrixRoot,
      MOYE_REPOSITORY_ROOTS: matrixRoot,
      MOYE_ARTIFACT_ROOTS: matrixRoot,
      MOYE_ACCEPTANCE_FAULT_INJECTION: "enabled",
      MOYE_TEST_FAULT_INJECTION: "enabled",
      MOYE_OBSERVABILITY_ENABLED: "false",
      MOYE_RELEASE_VERSION: "0.1.0-rc.2",
      MOYE_SOURCE_REVISION: sourceRevision.stdout.trim(),
      MOYE_SESSION_SOURCE_ROOTS: coreV2AcceptanceSessionSourceRoots(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (value: Buffer) => { const text = value.toString(); acceptanceServiceLogs += text; void appendFile(logPath, text); };
  acceptanceService.stdout?.on("data", capture);
  acceptanceService.stderr?.on("data", capture);
  await waitUntil(() => canConnect(acceptanceServicePort), 20_000);
}

async function stopAcceptanceService(): Promise<void> {
  const child = acceptanceService;
  acceptanceService = undefined;
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3_000)),
  ]);
}

async function registerService(port: number): Promise<void> {
  const response = await fetch(`${adminUrl}/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: `http://host.docker.internal:${port}` }),
  });
  if (!response.ok) throw new Error(`acceptance service registration failed: ${response.status} ${await response.text()}\n${acceptanceServiceLogs}`);
  const deployment = await response.json() as { id?: string };
  if (typeof deployment.id !== "string") throw new Error("acceptance service registration response has no deployment id");
  acceptanceDeploymentId = deployment.id;
}

async function handoffAcceptanceDeployment(): Promise<void> {
  if (acceptanceDeploymentId === undefined || predecessorEndpoint === undefined) return;
  await handoffRestateDeployment(adminUrl, acceptanceDeploymentId, predecessorEndpoint);
}

async function waitUntil(check: () => Promise<boolean> | boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for acceptance service\n${acceptanceServiceLogs}`);
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("free port unavailable"));
      server.close(() => resolve(address.port));
    });
  });
}

async function runStage(name: string, command: string, args: readonly string[], extraEnv: Record<string, string>): Promise<void> {
  const logRoot = path.join(matrixRoot, "logs");
  await mkdir(logRoot, { recursive: true });
  const execution = await run(command, args, root, 90 * 60_000, {
    ...process.env,
    RESTATE_INGRESS_URL: ingressUrl,
    MOYE_CORE_V2_ACCEPTANCE_INGRESS: ingressUrl,
    MOYE_CORE_V2_ACCEPTANCE_ADMIN: adminUrl,
    MOYE_CORE_V2_ACCEPTANCE_BOARD: boardUrl,
    MOYE_CORE_V2_ACCEPTANCE_PAGE_BOARD: boardUrl,
    MOYE_BOARD_URL: boardUrl,
    ...extraEnv,
  });
  await writeFile(path.join(logRoot, `${name}.stdout.log`), execution.stdout);
  await writeFile(path.join(logRoot, `${name}.stderr.log`), execution.stderr);
}

async function matrixScenario(directory: string, index: number): Promise<Record<string, unknown>> {
  const matrix = await readJson<{ scenarios: Array<Record<string, unknown>> }>(path.join(directory, "matrix-summary.json"));
  const scenario = matrix.scenarios[index];
  if (scenario === undefined || scenario["state"] !== "CLOSED" || scenario["archiveStatus"] !== "ARCHIVED") throw new Error(`matrix scenario missing terminal evidence under ${directory}`);
  return scenario;
}

async function prepareOldCheckout(target: string): Promise<void> {
  await run("git", ["worktree", "add", "--detach", target, "9b6714e71db887391d8783a27df2ebacb06615e1"], root);
  await run("npm", ["ci"], target, 300_000);
}

async function removeOldCheckout(target: string): Promise<void> {
  await run("git", ["worktree", "remove", "--force", target], root);
}

async function prepareCurrentSnapshot(target: string): Promise<void> {
  const excluded = new Set([".git", "node_modules", "dist", "package-dist", ".moye-runtime", ".playwright-cli", "coverage", "output"]);
  await cp(root, target, { recursive: true, filter: (source) => { const relative = path.relative(root, source); return relative === "" || !excluded.has(relative.split(path.sep)[0]!); } });
  await run("git", ["init", "-b", "release-snapshot"], target);
  await run("git", ["config", "user.name", "Moye W09 Snapshot"], target);
  await run("git", ["config", "user.email", "w09@moye.invalid"], target);
  await run("git", ["add", "."], target);
  await run("git", ["commit", "-m", "chore: freeze W09 runtime snapshot"], target);
  const commit = (await run("git", ["rev-parse", "HEAD"], target)).stdout.trim();
  const tree = (await run("git", ["rev-parse", "HEAD^{tree}"], target)).stdout.trim();
  await run("git", ["bundle", "create", path.join(matrixRoot, "service-upgrade-snapshot.bundle"), "HEAD"], target);
  await writeFile(path.join(matrixRoot, "service-upgrade-snapshot.json"), `${JSON.stringify({ schemaVersion: 1, commit, tree, bundle: "service-upgrade-snapshot.bundle" }, null, 2)}\n`);
  await run("npm", ["ci"], target, 300_000);
}

async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, "utf8")) as T; }

async function run(command: string, args: readonly string[], cwd: string, timeout = 120_000, env = process.env): Promise<{ stdout: string; stderr: string }> {
  try { return await execFileAsync(command, [...args], { cwd, timeout, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...env, npm_config_update_notifier: "false" } }); }
  catch (error) { const detail = error as { message?: string; stdout?: string; stderr?: string }; throw new Error(`${command} ${args.join(" ")} failed: ${detail.message ?? "unknown"}\n${detail.stdout ?? ""}\n${detail.stderr ?? ""}`); }
}
