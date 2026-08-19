#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const containerName = "moye-restate-demo";
let ingressPort;
let adminPort;
let servicePort;
let boardPort;
let ingressUrl;
let adminUrl;
let boardUrl;
let service;
let restateProcess;
let serviceErrorLog = "";
let startedContainer = false;
let stopping = false;

process.once("SIGINT", () => void cleanup(0));
process.once("SIGTERM", () => void cleanup(0));
process.once("exit", () => {
  if (startedContainer) {
    spawnSync("docker", ["stop", containerName], { stdio: "ignore" });
  }
});

try {
  requireCommand("docker", ["version", "--format", "{{.Server.Version}}"]);
  [ingressPort, adminPort, servicePort, boardPort] = await allocateDistinctPorts(4);
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
      RESTATE_SERVICE_PORT: String(servicePort),
      MOYE_BOARD_PORT: String(boardPort),
      MOYE_PROJECT_ID: "moye-demo",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  service.stderr?.on("data", (chunk) => {
    serviceErrorLog += chunk.toString();
  });
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
  const taskId = await submitDemoTask();
  await waitUntil(async () => {
    const response = await fetch(`${boardUrl}/api/tasks/${taskId}`);
    if (!response.ok) return false;
    const task = await response.json();
    return task.archiveStatus === "ARCHIVED";
  }, 20_000, "demo task archive");

  process.stdout.write(`\nMoye demo 已就绪\n\n`);
  process.stdout.write(`  项目看板: ${boardUrl}\n`);
  process.stdout.write(`  Restate:  ${adminUrl}\n`);
  process.stdout.write(`  Demo Task: ${taskId}\n\n`);
  process.stdout.write("打开项目看板，点击 Archived 列里的 Task 查看完整事件轨迹。\n");
  process.stdout.write("按 Ctrl-C 停止 Demo；运行数据保留在 .moye-runtime/demo。\n");

  await new Promise(() => {});
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  await cleanup(1);
}

function startRestate() {
  const existing = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", containerName], {
    encoding: "utf8",
  });
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

async function registerDeployment() {
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

async function submitDemoTask() {
  const suffix = Date.now().toString(36).toUpperCase();
  const taskId = `TASK-DEMO-${suffix}`;
  const backlogId = `BL-DEMO-${suffix}`;
  const demoRoot = path.resolve(".moye-runtime/demo");
  const activeTasksRoot = path.join(demoRoot, "tasks");
  const taskRoot = path.join(activeTasksRoot, taskId);
  await mkdir(taskRoot, { recursive: true });
  await writeFile(path.join(taskRoot, "spec.md"), `# ${taskId}\n\n一键体验生成的演示任务。\n`);

  const now = new Date().toISOString();
  await postJson(`${boardUrl}/api/backlog`, {
    backlogId,
    title: "体验可恢复 Task 与归档闭环",
    kind: "FEATURE",
    status: "SCHEDULED",
    priority: "MEDIUM",
    sourceRefs: ["demo"],
    taskRefs: [taskId],
    updatedAt: now,
  });
  await postJson(`${boardUrl}/api/tasks`, {
    taskId,
    projectId: "moye-demo",
    title: "一键体验 Moye 完整任务闭环",
    specRevision: 1,
    backlogRefs: [backlogId],
    activeTasksRoot,
    archiveRoot: path.join(activeTasksRoot, "archive"),
    effectCounterPath: path.join(demoRoot, "effects", `${taskId}.txt`),
    archivedAt: now,
  });
  return taskId;
}

async function postJson(url, value) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`请求失败 ${response.status}：${await response.text()}`);
}

async function waitUntil(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const detail = lastError instanceof Error ? `：${lastError.message}` : "";
  throw new Error(`等待 ${label} 超时${detail}`);
}

function requireCommand(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`需要可用的 ${command}：${result.stderr.trim()}`);
}

async function allocateDistinctPorts(count) {
  const ports = [];
  for (let index = 0; index < count; index += 1) {
    ports.push(await freePort());
  }
  return ports;
}

async function freePort() {
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

async function cleanup(exitCode) {
  if (stopping) return;
  stopping = true;
  if (service && service.exitCode === null) {
    service.kill("SIGTERM");
  }
  if (restateProcess && restateProcess.exitCode === null) {
    restateProcess.kill("SIGINT");
  }
  if (startedContainer) {
    spawnSync("docker", ["stop", containerName], { stdio: "ignore" });
    startedContainer = false;
  }
  process.exit(exitCode);
}
