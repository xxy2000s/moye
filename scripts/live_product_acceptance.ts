#!/usr/bin/env node

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { CodingWorkflowProjection } from "../src/coding/workflow.js";
import type { ProjectBoardSnapshot } from "../src/domain/board.js";
import { invoke } from "../src/restate/ingress.js";

const root = process.cwd();
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moye-live-product-"));
const repositoryRoot = path.join(fixtureRoot, "repository");
const runtimeRoot = path.join(fixtureRoot, "runtime");
const projectId = `moye-live-${Date.now().toString(36)}`;
const containerName = `moye-live-${process.pid}-${Date.now().toString(36)}`;
const [ingressPort, adminPort, servicePort, boardPort] = await allocatePorts(4);
const ingressUrl = `http://127.0.0.1:${ingressPort}`;
const adminUrl = `http://127.0.0.1:${adminPort}`;
const boardUrl = `http://127.0.0.1:${boardPort}`;
let restate: ChildProcess | undefined;
let service: ChildProcess | undefined;
let logs = "";

try {
  requireCommand("docker", ["version", "--format", "{{.Server.Version}}"]);
  const codexVersion = requireCommand("codex", ["--version"]);
  await mkdir(repositoryRoot);
  git(repositoryRoot, "init", "-b", "master");
  git(repositoryRoot, "config", "user.name", "Moye Live Acceptance");
  git(repositoryRoot, "config", "user.email", "moye-live@example.test");
  await writeFile(path.join(repositoryRoot, "README.md"), "# Real Moye product acceptance\n");
  git(repositoryRoot, "add", "README.md");
  git(repositoryRoot, "commit", "-m", "fixture base");
  const baseSha = git(repositoryRoot, "rev-parse", "HEAD");
  git(repositoryRoot, "switch", "--detach", baseSha);

  restate = spawn("docker", [
    "run", "--rm", "--name", containerName,
    "--add-host", "host.docker.internal:host-gateway",
    "-p", `127.0.0.1:${ingressPort}:8080`,
    "-p", `127.0.0.1:${adminPort}:9070`,
    "docker.restate.dev/restatedev/restate:1.7.4",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  restate.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  restate.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  await waitUntil(async () => (await fetch(`${adminUrl}/health`)).ok, 30_000, "Restate health");

  service = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      RESTATE_INGRESS_URL: ingressUrl,
      RESTATE_ADMIN_URL: adminUrl,
      RESTATE_SERVICE_PORT: String(servicePort),
      MOYE_BOARD_PORT: String(boardPort),
      MOYE_PROJECT_ID: projectId,
      MOYE_LIVE_RUNTIME_ROOT: runtimeRoot,
      MOYE_REPOSITORY_ROOTS: repositoryRoot,
      MOYE_ARTIFACT_ROOTS: runtimeRoot,
      MOYE_OBSERVABILITY_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  service.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  service.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  await waitUntil(async () => (await fetch(boardUrl)).ok, 20_000, "Moye board");
  const registration = await fetch(`${adminUrl}/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: `http://host.docker.internal:${servicePort}` }),
  });
  if (!registration.ok) throw new Error(`Restate discovery failed: ${await registration.text()}`);

  const capabilities = await fetchJson<{ fakeAllowed: boolean; runners: string[]; repositoryRoots: string[] }>(
    `${boardUrl}/api/live-capabilities`,
  );
  if (capabilities.fakeAllowed || !capabilities.runners.includes("CODEX_EXEC")) {
    throw new Error(`Product capabilities are not real-runner-only: ${JSON.stringify(capabilities)}`);
  }
  const fakeResponse = await fetch(`${boardUrl}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submission(repositoryRoot, "FAKE")),
  });
  if (fakeResponse.status !== 400 || (await fakeResponse.json()).code !== "REAL_RUNNER_REQUIRED") {
    throw new Error("Product API did not reject FAKE runner");
  }

  const submitResponse = await fetch(`${boardUrl}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submission(repositoryRoot, "CODEX_EXEC")),
  });
  const receipt = await submitResponse.json() as { taskId?: string; error?: string; invocationId?: string };
  if (submitResponse.status !== 202 || receipt.taskId === undefined) {
    throw new Error(`Live submission failed: ${submitResponse.status} ${JSON.stringify(receipt)}`);
  }
  const taskId = receipt.taskId;
  const projection = await waitForProjection(taskId, 12 * 60_000);
  if (projection.state !== "CLOSED" || projection.outcome !== "SUCCEEDED" || projection.archiveStatus !== "ARCHIVED"
      || projection.agent?.runnerKind !== "CODEX_EXEC" || projection.agent.outcome !== "SUCCEEDED"
      || projection.verification?.passed !== true || projection.merge?.mergeCommit === undefined
      || projection.checkpoint?.commitSha === undefined || projection.archive?.archivePath === undefined
      || projection.review?.outcome !== "SUCCEEDED" || projection.review.verdict !== "PASSED"
      || projection.reviews?.length !== 1) {
    throw new Error(`Real task did not close: ${JSON.stringify(projection, null, 2)}\n${logs}`);
  }
  const resultContent = git(repositoryRoot, "show", "moye/results:result.txt");
  if (resultContent !== "real Moye task complete") throw new Error(`Unexpected merged content: ${JSON.stringify(resultContent)}`);
  const eventsPage = await fetchJson<{ completed: boolean; runnerKind: string; total: number }>(
    `${boardUrl}/api/tasks/${taskId}/agent-events?cursor=0&limit=200`,
  );
  if (!eventsPage.completed || eventsPage.runnerKind !== "CODEX_EXEC" || eventsPage.total < 3) {
    throw new Error(`Agent events are not a completed real stream: ${JSON.stringify(eventsPage)}`);
  }
  const board = await fetchJson<ProjectBoardSnapshot>(`${boardUrl}/api/board`);
  if (!board.archived.some((task) => task.taskId === taskId)) throw new Error("Archived task is missing from Board projection");
  const archivedSpec = await readFile(path.join(projection.archive.archivePath, "spec.md"), "utf8");
  const summary = {
    schemaVersion: 1,
    executedAt: new Date().toISOString(),
    productEntry: `${boardUrl}/api/tasks`,
    fakeRejected: true,
    codexVersion,
    taskId,
    invocationId: receipt.invocationId,
    sessionId: projection.agent.sessionId,
    agentRunId: projection.agent.runId,
    agentRunDigest: projection.agent.runDigest,
    reviewSessionId: projection.review.sessionId,
    reviewRunId: projection.review.runId,
    reviewDigest: projection.review.resultDigest,
    reviewVerdict: projection.review.verdict,
    reviewFindingCount: projection.review.findings.length,
    baseSha,
    resultCommit: projection.checkpoint.commitSha,
    verificationDigest: projection.verification.verificationDigest,
    mergeCommit: projection.merge.mergeCommit,
    targetHead: git(repositoryRoot, "rev-parse", "moye/results"),
    archivePath: projection.archive.archivePath,
    archivedSpecDigestSource: archivedSpec.trim().split("\n")[0],
    agentEventCount: eventsPage.total,
    outcome: projection.outcome,
    archiveStatus: projection.archiveStatus,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  if (service !== undefined && service.exitCode === null) {
    service.kill("SIGTERM");
    await waitForExit(service, 5_000);
  }
  try { execFileSync("docker", ["stop", "-t", "2", containerName], { stdio: "ignore" }); } catch { /* already stopped */ }
  if (restate !== undefined) await waitForExit(restate, 5_000);
  await rm(fixtureRoot, { recursive: true, force: true });
}

function submission(repository: string, runnerKind: string) {
  return {
    title: "Real Codex product acceptance",
    objective: "Create and commit result.txt containing exactly real Moye task complete followed by one newline.",
    acceptanceCriteria: [
      "result.txt is the only new file",
      "result.txt contains exactly real Moye task complete followed by one newline",
      "the change is committed",
    ],
    repositoryRoot: repository,
    baseBranch: "master",
    targetBranch: "moye/results",
    runnerKind,
    docsDisposition: "not_applicable",
    validationCommands: [{
      commandId: "CMD-LIVE-ACCEPTANCE",
      argv: [process.execPath, "-e", "const fs=require('node:fs');const names=fs.readdirSync('.').filter(x=>x!=='.git'&&x!=='README.md');if(names.length!==1||names[0]!=='result.txt'||fs.readFileSync('result.txt','utf8')!=='real Moye task complete\\n')process.exit(2);console.log('real product task verified')"],
    }],
  };
}

async function waitForProjection(taskId: string, timeoutMs: number): Promise<CodingWorkflowProjection> {
  let last: CodingWorkflowProjection | null = null;
  await waitUntil(async () => {
    last = await invoke<CodingWorkflowProjection | null>(ingressUrl, "CodingTaskWorkflow", taskId, "status");
    return last?.state === "FAILED" || (last?.state === "CLOSED" && (
      last.archiveStatus === "ARCHIVED" || last.archiveStatus === "FAILED"
    ));
  }, timeoutMs, `CodingTaskWorkflow/${taskId}`);
  return last!;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function git(cwd: string, ...argv: string[]): string {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function requireCommand(command: string, argv: string[]): string {
  return execFileSync(command, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function allocatePorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  while (ports.length < count) ports.push(await freePort());
  return ports;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) return reject(new Error("No port allocated"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* retry until the deadline */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}\n${logs}`);
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
