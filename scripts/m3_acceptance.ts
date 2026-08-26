import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const canonicalIngressUrl = process.env["RESTATE_INGRESS_URL"] ?? "http://127.0.0.1:50889";
const canonicalAdminUrl = process.env["RESTATE_ADMIN_URL"] ?? "http://127.0.0.1:50890";
const evidenceRoot = path.join(root, "docs/delivery/tasks/archive/2026-08-27-TASK-0083");
const output = path.resolve(process.env["MOYE_M3_ACCEPTANCE_REPORT"] ?? path.join(evidenceRoot, "m3-product-acceptance.json"));
const scaffoldOutput = path.resolve(process.env["MOYE_M3_SCAFFOLD_REPORT"] ?? path.join(evidenceRoot, "m3-scaffold-rerun.json"));
const logs = path.resolve(process.env["MOYE_M3_ACCEPTANCE_LOG"] ?? path.join(root, ".moye-runtime/logs/m3-acceptance-current-board.log"));

const tasks = Object.freeze([
  { taskId: "TASK-0077", baseCommit: "d356eb770b90ae77609cb9a213453c3abdd66d00", resultCommit: "1f6760808dcf78a418fbbff8bbca73c3d22c9a6a", packageDigest: "sha256:b8eb6079e8ce307f1fce67fe1443f41e4ab01d8a4b7ff17d31c725c8412a90db" },
  { taskId: "TASK-0078", baseCommit: "1f6760808dcf78a418fbbff8bbca73c3d22c9a6a", resultCommit: "6c8cbb74b9260bc0ff8a2cdb4101deb2aaee9060", packageDigest: "sha256:ee4c3b099eaacd64ae5d2ee11a8653354d909d2a2b62cb7211a825a913619c34" },
  { taskId: "TASK-0079", baseCommit: "6c8cbb74b9260bc0ff8a2cdb4101deb2aaee9060", resultCommit: "2567fc9093b13eee225001d903a90564d8c62d3f", packageDigest: "sha256:d0662c8445c16bd2a7ae68dec817cea66c16719b1c15a05b7010fffec51d88fb" },
  { taskId: "TASK-0080", baseCommit: "2567fc9093b13eee225001d903a90564d8c62d3f", resultCommit: "f262522c1bc05f81c9339c4e5fa151f511521b1f", packageDigest: "sha256:bc5a5e9ea9c21cc3c10dd0b8d4c1d76c22c8ea6e48bc010d9c7390fb75f6ba1c" },
  { taskId: "TASK-0081", baseCommit: "f262522c1bc05f81c9339c4e5fa151f511521b1f", resultCommit: "d369e9d3d9621391999e2db48a959a2e7fa29d7b", packageDigest: "sha256:98084d60f45912e763c3739349bed40a40444c3b36e7dc266477d90067eb53b5" },
  { taskId: "TASK-0082", baseCommit: "d369e9d3d9621391999e2db48a959a2e7fa29d7b", resultCommit: "241a81938065f9e4efec32507e4af2aa43380779", packageDigest: "sha256:f951eb5c90ad3d1bb2caeb5da1fd515d13593f87619224845ef80703947bb71b" },
]);
const historicalTaskId = "TASK-RCV-20260826114418-01-ROLE-RECOVERY";
const historicalRunId = "sha256:0f7e26c3e614aefa95e9de29e91b1fccdb9db9e4c9f10f7d6440982967f0ec31";
const evidencePaths = Object.freeze({
  backlogSync: "docs/delivery/tasks/archive/2026-08-27-TASK-0078/backlog-sync-receipt.json",
  backlogBrowser: "docs/delivery/tasks/archive/2026-08-27-TASK-0079/browser-acceptance.json",
  sessionSemantics: "docs/delivery/tasks/archive/2026-08-27-TASK-0080/session-semantics-acceptance.json",
  sessionBrowser: "docs/delivery/tasks/archive/2026-08-27-TASK-0081/browser-acceptance.json",
  scaffoldPackage: "docs/delivery/tasks/archive/2026-08-27-TASK-0082/scaffold-package-acceptance.json",
  scaffoldTask: "docs/delivery/tasks/archive/2026-08-27-TASK-0082/scaffold-task-authoritative-acceptance.json",
});

let currentService: ChildProcess | undefined;
let currentServiceLog = "";
const servicePort = await freePort();
let boardPort = await freePort();
while (boardPort === servicePort) boardPort = await freePort();
const boardUrl = `http://127.0.0.1:${boardPort}`;

try {
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(path.dirname(logs), { recursive: true });
  await startCurrentSourceBoard();
  await run("npm", ["run", "acceptance:framework:scaffold"], root, 5 * 60_000, {
    ...process.env,
    MOYE_DOCUMENTATION_SCAFFOLD_OUTPUT: scaffoldOutput,
  });

  const taskResults = [];
  for (const expected of tasks) {
    const parent = (await run("git", ["rev-parse", `${expected.resultCommit}^`], root)).stdout.trim();
    if (parent !== expected.baseCommit) throw new Error(`${expected.taskId} Result Commit parent mismatch`);
    const projection = await getJson<any>(`${boardUrl}/api/tasks/${expected.taskId}`);
    if (projection.state !== "CLOSED" || projection.archiveStatus !== "ARCHIVED" || projection.outcome !== "SUCCEEDED") throw new Error(`${expected.taskId} Runtime is not uniquely archived`);
    if (projection.seal?.resultCommit !== expected.resultCommit || projection.seal?.baseCommit !== expected.baseCommit || projection.seal?.packageDigest !== expected.packageDigest) throw new Error(`${expected.taskId} Seal receipt mismatch`);
    taskResults.push({ ...expected, currentStep: projection.currentStep, intentDigest: projection.seal.intentDigest });
  }

  const board = await getJson<any>(`${boardUrl}/api/board`);
  const expectedBacklogIds = ["BL-0004", "BL-0005", "BL-0006", "BL-0007", "BL-0083"];
  const backlogIds = board.backlog.map((item: any) => item.backlogId).sort();
  if (JSON.stringify(backlogIds) !== JSON.stringify(expectedBacklogIds)) throw new Error(`canonical backlog mismatch: ${backlogIds.join(",")}`);
  if (board.backlog.some((item: any) => item.schemaVersion !== 2 || !item.problem?.observed || !item.problem?.expected || !item.problem?.impact)) throw new Error("canonical backlog lost v2 problem facts");
  const bl0083 = board.backlog.find((item: any) => item.backlogId === "BL-0083");
  if (bl0083?.source?.digest !== "a3b48aaf9a0f7624c860f60cccddb3484408b2d68d74de770338b8835863e240") throw new Error("BL-0083 source digest drifted");

  const sessionUrl = `${boardUrl}/api/tasks/${historicalTaskId}/roles/${encodeURIComponent(historicalRunId)}/session`;
  const timelineUrl = `${boardUrl}/api/tasks/${historicalTaskId}/roles/${encodeURIComponent(historicalRunId)}/timeline?cursor=0&limit=100`;
  const session = await getJson<any>(sessionUrl);
  const timeline = await getJson<any>(timelineUrl);
  const semantics = session.semantics;
  if (semantics?.availability?.state !== "AVAILABLE" || semantics?.content?.state !== "COMPLETE" || semantics?.binding?.state !== "UNVERIFIED" || semantics?.limitation?.state !== "NONE") throw new Error("historical Session four-dimensional semantics drifted");
  if (session.state !== "PARTIAL" || session.promptBinding !== "UNVERIFIED" || timeline.total !== 32 || timeline.events.length !== 32) throw new Error("historical Session raw facts drifted");
  if (session.receiptDigest !== "sha256:7b69b895a1f043c5ed46fc653d69797d64c5e63b2a221e87dab90ae6684b2fb3" || session.manifestDigest !== "sha256:99576df390720f7793f85e1b7d530ae96b228ad0c4b289c1b8fb00a568634be8") throw new Error("historical Session managed Digests drifted");

  const backlogSync = await readJson<any>(evidencePaths.backlogSync);
  if (backlogSync.batchId !== "98457bb9ead7d73f657f4cd00391590e2b3e8ff49aa86162b5cf12caad49b955" || backlogSync.idempotentReplay?.unchanged !== 6 || backlogSync.after?.bl0031Visible !== false) throw new Error("W02 Sync Receipt drifted");
  const backlogBrowser = await readJson<any>(evidencePaths.backlogBrowser);
  if (backlogBrowser.checks?.desktop1440x1000 !== "PASS" || backlogBrowser.checks?.narrow390x844 !== "PASS" || backlogBrowser.checks?.escapeClosesDialog !== "PASS" || backlogBrowser.checks?.focusReturnsToTrigger !== "PASS" || backlogBrowser.checks?.consoleErrorsWithoutInjectedFailure !== 0 || backlogBrowser.checks?.runtimeWritesFromDialog !== 0) throw new Error("W03 browser evidence is not entirely passed");
  const sessionSemantics = await readJson<any>(evidencePaths.sessionSemantics);
  if (sessionSemantics.rawEvidenceDigest !== "sha256:fff5c71addaaa2d9a334c1529e38c5064e76ecb56e27da99f703fc657e9f5b3e") throw new Error("W04 immutable source evidence drifted");
  const sessionBrowser = await readJson<any>(evidencePaths.sessionBrowser);
  if (!sessionBrowser.checks?.every((item: any) => item.result === "passed")) throw new Error("W05 browser evidence is not entirely passed");
  const scaffoldTask = await readJson<any>(evidencePaths.scaffoldTask);
  if (scaffoldTask.status?.state !== "CLOSED" || scaffoldTask.status?.archiveStatus !== "ARCHIVED" || scaffoldTask.status?.outcome !== "SUCCEEDED" || scaffoldTask.documentationPolicyEvidence?.[0]?.verdict !== "PASSED") throw new Error("W06 authoritative real Task evidence drifted");
  const scaffoldRerun = await readJson<any>(path.relative(root, scaffoldOutput));
  if (scaffoldRerun.blank?.fileCount !== 14 || scaffoldRerun.blank?.cleanGit !== true || scaffoldRerun.occupied?.exitCode !== 2 || scaffoldRerun.symlink?.outsideWriteCount !== 0) throw new Error("final packed scaffold rerun failed its product matrix");

  const evidenceFiles: Record<string, string> = {};
  for (const [name, relative] of Object.entries(evidencePaths)) evidenceFiles[name] = await fileDigest(path.join(root, relative));
  evidenceFiles["scaffoldRerun"] = await fileDigest(scaffoldOutput);
  const core = {
    schemaVersion: 1,
    validationKind: "M3_PRODUCT_ACCEPTANCE",
    executedAt: new Date().toISOString(),
    runtime: { ingressUrl: canonicalIngressUrl, adminUrl: canonicalAdminUrl, boardUrl, mode: "temporary-current-source-board-read-only-canonical-runtime", serviceRegistered: false },
    taskResults,
    backlog: { ids: backlogIds, schemaVersion: 2, bl0031Visible: false, bl0083SourceDigest: bl0083.source.digest, syncBatchId: backlogSync.batchId, syncReceiptDigest: await fileDigest(path.join(root, evidencePaths.backlogSync)) },
    session: { taskId: historicalTaskId, runId: historicalRunId, providerSessionId: session.providerSessionId, receiptDigest: session.receiptDigest, manifestDigest: session.manifestDigest, rawState: session.state, semantics, eventCount: timeline.total },
    scaffold: { packageDigest: scaffoldRerun.package.digest, scaffoldDigest: scaffoldRerun.blank.scaffoldDigest, evidenceDigest: scaffoldRerun.evidenceDigest, authoritativeTaskId: scaffoldTask.taskId, authoritativeEvidenceDigest: scaffoldTask.evidenceDigest, authoritativeBundleDigest: scaffoldTask.bundleDigest },
    browserEvidence: { backlog: backlogBrowser.checks, session: sessionBrowser.checks },
    evidenceFiles,
    mutations: "none: current-source Board was not registered; all canonical Runtime queries were read-only; scaffold fixtures were OS temporary directories outside Moye",
  };
  const report = { ...core, reportDigest: digestCanonical(core) };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ report: path.relative(root, output), reportDigest: report.reportDigest, taskCount: taskResults.length, backlogCount: backlogIds.length, session: semantics, scaffoldEvidenceDigest: scaffoldRerun.evidenceDigest }, null, 2)}\n`);
} finally {
  await stopCurrentSourceBoard();
}

async function startCurrentSourceBoard(): Promise<void> {
  await writeFile(logs, "");
  currentService = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      RESTATE_SERVICE_PORT: String(servicePort),
      MOYE_BOARD_PORT: String(boardPort),
      RESTATE_INGRESS_URL: canonicalIngressUrl,
      RESTATE_ADMIN_URL: canonicalAdminUrl,
      MOYE_PROJECT_ID: "moye",
      MOYE_ARTIFACT_ROOTS: path.join(root, ".moye-runtime"),
      MOYE_LIVE_RUNTIME_ROOT: path.join(root, ".moye-runtime", "live"),
      MOYE_REPOSITORY_ROOTS: root,
      MOYE_OBSERVABILITY_ENABLED: "false",
      MOYE_RELEASE_VERSION: "0.1.0",
      MOYE_SOURCE_REVISION: (await run("git", ["rev-parse", "HEAD"], root)).stdout.trim(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (chunk: Buffer) => { const text = chunk.toString(); currentServiceLog += text; void appendFile(logs, text); };
  currentService.stdout?.on("data", capture);
  currentService.stderr?.on("data", capture);
  await waitUntil(async () => {
    try { return (await fetch(`${boardUrl}/readyz`)).ok; } catch { return false; }
  }, 20_000);
}

async function stopCurrentSourceBoard(): Promise<void> {
  const child = currentService;
  currentService = undefined;
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3_000)),
  ]);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${await response.text()}\n${currentServiceLog}`);
  return await response.json() as T;
}

async function readJson<T>(relative: string): Promise<T> { return JSON.parse(await readFile(path.resolve(root, relative), "utf8")) as T; }
async function fileDigest(target: string): Promise<string> { return `sha256:${createHash("sha256").update(await readFile(target)).digest("hex")}`; }
function digestCanonical(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`; }

async function run(command: string, argv: readonly string[], cwd: string, timeout = 120_000, env: NodeJS.ProcessEnv = process.env): Promise<{ stdout: string; stderr: string }> {
  try { return await execFileAsync(command, [...argv], { cwd, timeout, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); }
  catch (error) { const detail = error as { message?: string; stdout?: string; stderr?: string }; throw new Error(`${command} ${argv.join(" ")} failed: ${detail.message ?? "unknown"}\n${detail.stdout ?? ""}\n${detail.stderr ?? ""}`); }
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<void> { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(`timed out waiting for current-source Board\n${currentServiceLog}`); }
async function freePort(): Promise<number> { return await new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (address === null || typeof address === "string") return reject(new Error("free port unavailable")); server.close(() => resolve(address.port)); }); }); }
