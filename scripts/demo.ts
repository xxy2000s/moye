#!/usr/bin/env node

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import type { AgentRunResult } from "../src/agent/runner.js";
import type { CodingWorkflowProjection } from "../src/coding/workflow.js";
import { cleanupCodingDemoWorktree, createCodingDemoFixture, type CodingDemoFixture } from "../src/demo/coding-fixture.js";
import type { ProjectBoardSnapshot } from "../src/domain/board.js";
import { invoke } from "../src/restate/ingress.js";

const containerName = process.env["MOYE_DEMO_CONTAINER_NAME"] ?? "moye-restate-demo";
const demoRoot = path.resolve(process.env["MOYE_DEMO_ROOT"] ?? ".moye-runtime/demo");
const projectId = "moye-demo";
const runnerKind = readRunnerKind(process.env["MOYE_DEMO_RUNNER"] ?? "FAKE");
let ingressPort = 0;
let adminPort = 0;
let servicePort = 0;
let boardPort = 0;
let ingressUrl = "";
let adminUrl = "";
let boardUrl = "";
let service: ChildProcess | undefined;
let restateProcess: ChildProcess | undefined;
let serviceErrorLog = "";
let startedContainer = false;
let stopping = false;
let fixture: CodingDemoFixture | undefined;
let taskId = "";
let backlogId = "";

process.once("SIGINT", () => void cleanup(0));
process.once("SIGTERM", () => void cleanup(0));

try {
  validateContainerName(containerName);
  requireCommand("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (runnerKind === "CODEX_EXEC") requireCommand("codex", ["--version"]);
  if (runnerKind === "CLAUDE_PRINT") requireCommand("claude", ["--version"]);
  await mkdir(demoRoot, { recursive: true });
  const suffix = Date.now().toString(36).toUpperCase();
  taskId = `TASK-DEMO-${suffix}`;
  backlogId = `BL-DEMO-${suffix}`;
  const createdAt = new Date().toISOString();
  fixture = await createCodingDemoFixture({
    demoRoot,
    taskId,
    backlogId,
    projectId,
    graphRevision: 28,
    createdAt,
    runnerKind,
  });
  const ports = await allocateDistinctPorts(4);
  ingressPort = ports[0]!;
  adminPort = ports[1]!;
  servicePort = ports[2]!;
  boardPort = ports[3]!;
  ingressUrl = `http://127.0.0.1:${ingressPort}`;
  adminUrl = `http://127.0.0.1:${adminPort}`;
  boardUrl = `http://127.0.0.1:${boardPort}`;
  startRestate();
  await waitUntil(async () => (await fetch(`${adminUrl}/health`)).ok, 20_000, "Restate health");

  service = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RESTATE_INGRESS_URL: ingressUrl,
      RESTATE_ADMIN_URL: adminUrl,
      RESTATE_SERVICE_PORT: String(servicePort),
      MOYE_BOARD_PORT: String(boardPort),
      MOYE_PROJECT_ID: projectId,
      MOYE_REPOSITORY_ROOT: process.cwd(),
      MOYE_ARTIFACT_ROOTS: demoRoot,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  service.stderr?.on("data", (chunk: Buffer) => { serviceErrorLog += chunk.toString(); });
  service.once("exit", (code) => {
    if (!stopping) {
      process.stderr.write(`Moye service unexpectedly exited with ${code ?? "unknown"}\n${serviceErrorLog}`);
      void cleanup(1);
    }
  });

  await waitUntil(async () => {
    const response = await fetch(boardUrl);
    return response.ok && (await response.text()).includes("Moye · Task Control Plane");
  }, 15_000, "Moye board");
  await registerDeployment();

  await postJson(`${boardUrl}/api/backlog`, {
    backlogId,
    title: "体验 Agent 编码、验证、合并与归档",
    kind: "FEATURE",
    status: "SCHEDULED",
    priority: "MEDIUM",
    sourceRefs: ["demo"],
    taskRefs: [taskId],
    updatedAt: createdAt,
  });
  const workflow = invoke<CodingWorkflowProjection>(
    ingressUrl, "CodingTaskWorkflow", taskId, "run", fixture.input,
  );
  process.stdout.write("\nMoye Coding Demo 已启动\n\n");
  process.stdout.write(`  项目看板: ${boardUrl}\n`);
  process.stdout.write(`  Demo Task: ${taskId}\n`);
  process.stdout.write(`  Agent Runner: ${runnerLabel(runnerKind)}\n\n`);
  process.stdout.write("现在即可打开看板；Agent Events 会在运行中持续刷新。\n");
  const projection = await workflow;
  assertCompleted(projection);
  await waitUntil(async () => {
    const board = await fetchJson<ProjectBoardSnapshot>(`${boardUrl}/api/board`);
    return board.archived.some((task) => task.taskId === taskId && task.archiveStatus === "ARCHIVED");
  }, 10_000, "Coding Task projection");
  await cleanupCodingDemoWorktree(fixture);

  process.stdout.write("\nMoye Coding Demo 已就绪\n\n");
  process.stdout.write(`  项目看板: ${boardUrl}\n`);
  process.stdout.write(`  Restate 排障: ${adminUrl}/ui/overview\n`);
  if (process.env["MOYE_OBSERVABILITY_ENABLED"] === "true") {
    process.stdout.write(`  Trace 看板: ${process.env["MOYE_TRACE_UI_URL"] ?? "http://127.0.0.1:6006"}\n`);
  }
  process.stdout.write(`  Demo Task: ${taskId}\n`);
  process.stdout.write(`  Agent Session: ${projection.agent?.sessionId ?? "—"}\n`);
  process.stdout.write(`  Result / Merge: ${projection.checkpoint?.commitSha.slice(0, 10) ?? "—"} / ${projection.merge?.mergeCommit?.slice(0, 10) ?? "—"}\n\n`);
  process.stdout.write("打开项目看板，点击“已归档”列里的 Task 查看中文研发流水线。\n");
  process.stdout.write(`Restate 只用于高级排障；按 Ctrl-C 停止，证据保留在 ${demoRoot}。\n`);

  await new Promise(() => {});
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  await cleanup(1);
}

function startRestate(): void {
  const existing = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", containerName], { encoding: "utf8" });
  if (existing.status === 0 && existing.stdout.trim() === "true") {
    throw new Error(`已有 ${containerName} 正在运行；请先执行 docker stop ${containerName}`);
  }
  restateProcess = spawn("docker", [
    "run", "--rm", "--name", containerName,
    "--add-host", "host.docker.internal:host-gateway",
    "-p", `127.0.0.1:${ingressPort}:8080`,
    "-p", `127.0.0.1:${adminPort}:9070`,
    "docker.restate.dev/restatedev/restate:1.7.4",
  ], { stdio: "ignore" });
  restateProcess.once("error", (error) => {
    process.stderr.write(`无法启动 Restate：${error.message}\n`);
    void cleanup(1);
  });
  restateProcess.once("exit", (code) => {
    if (!stopping) {
      process.stderr.write(`Restate unexpectedly exited with ${code ?? "unknown"}\n`);
      void cleanup(1);
    }
  });
  startedContainer = true;
}

async function registerDeployment(): Promise<void> {
  const response = await fetch(`${adminUrl}/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: `http://host.docker.internal:${servicePort}` }),
  });
  if (!response.ok) {
    const body = await response.text();
    if (!body.includes("already")) throw new Error(`Restate 服务注册失败：${body}`);
  }
}

async function postJson(url: string, value: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`请求失败 ${response.status}：${await response.text()}`);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`请求失败 ${response.status}：${await response.text()}`);
  return response.json() as Promise<T>;
}

function assertCompleted(projection: CodingWorkflowProjection): void {
  if (projection.state !== "CLOSED" || projection.outcome !== "SUCCEEDED" || projection.archiveStatus !== "ARCHIVED") {
    throw new Error(`Coding Demo 未闭环：${projection.state}/${projection.outcome ?? "—"}/${projection.archiveStatus}`);
  }
  if (projection.agent?.sessionId === undefined || projection.checkpoint === undefined || projection.merge?.mergeCommit === undefined) {
    throw new Error("Coding Demo 缺少 Agent Session、Result Commit 或 Merge Commit");
  }
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const detail = lastError instanceof Error ? `：${lastError.message}` : "";
  throw new Error(`等待 ${label} 超时${detail}\n${serviceErrorLog}`);
}

function requireCommand(command: string, args: readonly string[]): void {
  const result = spawnSync(command, [...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`需要可用的 ${command}：${result.stderr.trim()}`);
}

async function allocateDistinctPorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  for (let index = 0; index < count; index += 1) ports.push(await freePort());
  return ports;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("无法分配本地端口"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<true>((resolve) => child.once("exit", () => resolve(true))),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

async function cleanup(exitCode: number): Promise<never> {
  if (stopping) return new Promise(() => {});
  stopping = true;
  await stopChild(service);
  if (restateProcess && restateProcess.exitCode === null && restateProcess.signalCode === null) restateProcess.kill("SIGINT");
  if (startedContainer) {
    spawnSync("docker", ["stop", containerName], { stdio: "ignore" });
    startedContainer = false;
  }
  process.exit(exitCode);
}

function validateContainerName(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)) throw new Error(`非法 Demo 容器名：${value}`);
}

function readRunnerKind(value: string): AgentRunResult["runnerKind"] {
  const normalized = value.trim().toUpperCase().replace(/-/g, "_");
  if (normalized === "FAKE" || normalized === "CODEX_EXEC" || normalized === "CLAUDE_PRINT") return normalized;
  throw new Error(`MOYE_DEMO_RUNNER 仅支持 FAKE、CODEX_EXEC 或 CLAUDE_PRINT，收到：${value}`);
}

function runnerLabel(value: AgentRunResult["runnerKind"]): string {
  return value === "CODEX_EXEC" ? "真实 Codex CLI" : value === "CLAUDE_PRINT" ? "真实 Claude CLI" : "Fake Agent（确定性演示）";
}
