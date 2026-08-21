import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTaskEnvelope } from "../../src/domain/coding-task.js";
import { invoke, send } from "../../src/restate/ingress.js";
import type {
  CoreClosureWorkflowInput,
  CoreClosureWorkflowProjection,
} from "../../src/restate/core-services.js";
import type { CoreScenario } from "../../src/core/workflow.js";

const root = process.cwd();
const containerName = `moye-core-e2e-${process.pid}`;
const fixtureRoots: string[] = [];
let ingressPort = 0;
let adminPort = 0;
let servicePort = 0;
let boardPort = 0;
let service: ChildProcess | undefined;
let logs = "";

describe("Restate Core Closure Workflow", () => {
  beforeAll(async () => {
    [ingressPort, adminPort, servicePort, boardPort] = await Promise.all([
      freePort(), freePort(), freePort(), freePort(),
    ]);
    docker([
      "run", "--rm", "-d", "--name", containerName,
      "-p", `127.0.0.1:${ingressPort}:8080`,
      "-p", `127.0.0.1:${adminPort}:9070`,
      "docker.restate.dev/restatedev/restate:1.7.4",
    ]);
    await waitUntil(async () => {
      try { return (await fetch(adminUrl("/health"))).ok; } catch { return false; }
    }, 20_000);
    await startService();
    await registerService();
  }, 40_000);

  afterAll(async () => {
    await stopService("SIGTERM");
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    for (const fixtureRoot of fixtureRoots.splice(0)) await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("converges the six Core scenarios through real Restate with one immutable Closure", async () => {
    const matrix = [
      ["SUCCESS", "SUCCEEDED"],
      ["REPAIR", "SUCCEEDED"],
      ["REPLAN", "SUCCEEDED"],
      ["UNKNOWN", "SUCCEEDED"],
      ["BUDGET_EXHAUSTED", "FAILED_TERMINAL"],
      ["CANCELLED", "CANCELLED"],
    ] as const;

    for (const [scenario, outcome] of matrix) {
      const input = await fixture(scenarioId(scenario), scenario, {
        observerFailure: scenario === "UNKNOWN",
        docsGateFailureOnce: scenario === "SUCCESS",
      });
      const result = await invoke<CoreClosureWorkflowProjection>(
        ingressUrl(), "CoreClosureWorkflow", input.envelope.taskId, "run", input,
      );
      const status = await invoke<CoreClosureWorkflowProjection | null>(
        ingressUrl(), "CoreClosureWorkflow", input.envelope.taskId, "status",
      );

      expect(result).toMatchObject({ state: "CLOSED", currentStep: "CLOSED", outcome, effectExecutionCount: 1 });
      expect(status).toEqual(result);
      expect(result.closureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.sourceProjectionDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      if (scenario === "SUCCESS") expect(result.docsGateAttempts).toBe(2);
      if (scenario === "UNKNOWN") expect(result.observerError).toBe("injected observer failure");
      if (scenario === "REPLAN") expect(result.specRevision).toBe(2);
    }
  }, 40_000);

  it("recovers a lost asynchronous close acknowledgement by replaying read-only status", async () => {
    const input = await fixture("TASK-CORE-ACK-LOSS", "SUCCESS");
    const receipt = await send(
      ingressUrl(), "CoreClosureWorkflow", input.envelope.taskId, "run", input,
    );
    expect(receipt.invocationId).toBeTruthy();
    const first = await waitForClosed(input.envelope.taskId, 20_000);
    const replay = await invoke<CoreClosureWorkflowProjection | null>(
      ingressUrl(), "CoreClosureWorkflow", input.envelope.taskId, "status",
    );

    expect(replay).toEqual(first);
    expect(replay?.effectExecutionCount).toBe(1);
    expect(replay?.closureDigest).toBe(first.closureDigest);
  }, 30_000);

  it("reconciles the persisted scenario artifact after Worker SIGKILL without rerunning it", async () => {
    const fixtureRoot = await temporaryRoot();
    const markerPath = path.join(fixtureRoot, "fault", "result-persisted.marker");
    const input = await fixture("TASK-CORE-WORKER-EXIT", "REPAIR", {
      artifactRoot: path.join(fixtureRoot, "artifacts"),
      fault: { exitAfterResultOnce: true, markerPath },
    });

    await send(ingressUrl(), "CoreClosureWorkflow", input.envelope.taskId, "run", input);
    await waitUntil(async () => existsSync(markerPath), 20_000);
    await waitForExit(service, 10_000);
    await stopService("SIGTERM");
    await startService();

    const recovered = await waitForClosed(input.envelope.taskId, 30_000);
    expect(recovered).toMatchObject({ state: "CLOSED", outcome: "SUCCEEDED", effectExecutionCount: 1 });
    const operationId = (await readFile(markerPath, "utf8")).trim();
    expect(await readFile(path.join(input.artifactRoot, operationId.replace(":", "-"), "execution-count.txt"), "utf8"))
      .toBe("1\n");
    const replay = await invoke<CoreClosureWorkflowProjection | null>(
      ingressUrl(), "CoreClosureWorkflow", input.envelope.taskId, "status",
    );
    expect(replay?.closureDigest).toBe(recovered.closureDigest);
  }, 50_000);
});

async function fixture(
  taskId: string,
  scenario: CoreScenario,
  options: Partial<Pick<CoreClosureWorkflowInput, "observerFailure" | "docsGateFailureOnce" | "fault" | "artifactRoot">> = {},
): Promise<CoreClosureWorkflowInput> {
  const fixtureRoot = await temporaryRoot();
  const envelope = createTaskEnvelope({
    taskId,
    specRevision: 1,
    baseSha: "a".repeat(40),
    requirements: [{ requirementId: "REQ-CORE-E2E", title: "close Core", acceptanceCriteria: ["converges once"] }],
    validationCommands: [{ commandId: "CMD-CORE-E2E", argv: ["npm", "test"] }],
    contextPlan: {
      graphRevision: 43,
      intents: ["task-runtime-change"],
      requiredRead: ["agent-contract", "task-runtime-kernel"],
      requiredReview: ["architecture-overview"],
    },
  });
  return {
    envelope,
    scenario,
    artifactRoot: options.artifactRoot ?? path.join(fixtureRoot, "artifacts"),
    ...(options.observerFailure === undefined ? {} : { observerFailure: options.observerFailure }),
    ...(options.docsGateFailureOnce === undefined ? {} : { docsGateFailureOnce: options.docsGateFailureOnce }),
    ...(options.fault === undefined ? {} : { fault: options.fault }),
  };
}

async function temporaryRoot(): Promise<string> {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moye-core-e2e-"));
  fixtureRoots.push(fixtureRoot);
  return fixtureRoot;
}

async function startService(): Promise<void> {
  service = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      RESTATE_SERVICE_PORT: String(servicePort),
      MOYE_BOARD_PORT: String(boardPort),
      RESTATE_INGRESS_URL: ingressUrl(),
      RESTATE_ADMIN_URL: adminUrl(""),
      MOYE_TEST_FAULT_INJECTION: "enabled",
      MOYE_PROJECT_ID: "moye-core-e2e",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  service.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  service.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  await waitUntil(() => canConnect(servicePort), 10_000);
}

async function stopService(signal: NodeJS.Signals): Promise<void> {
  const current = service;
  service = undefined;
  if (current === undefined || current.exitCode !== null || current.signalCode !== null) return;
  current.kill(signal);
  await Promise.race([
    new Promise<void>((resolve) => current.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function registerService(): Promise<void> {
  const response = await fetch(adminUrl("/deployments"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: `http://host.docker.internal:${servicePort}` }),
  });
  if (!response.ok) throw new Error(`Discovery failed: ${await response.text()}\n${logs}`);
}

async function waitForClosed(taskId: string, timeoutMs: number): Promise<CoreClosureWorkflowProjection> {
  let latest: CoreClosureWorkflowProjection | null = null;
  await waitUntil(async () => {
    try {
      latest = await invoke<CoreClosureWorkflowProjection | null>(
        ingressUrl(), "CoreClosureWorkflow", taskId, "status",
      );
      return latest?.state === "CLOSED";
    } catch { return false; }
  }, timeoutMs);
  if (latest === null) throw new Error(`Core projection remained empty\n${logs}`);
  return latest;
}

async function waitForExit(child: ChildProcess | undefined, timeoutMs: number): Promise<void> {
  if (child === undefined) throw new Error("Service was not started");
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Service did not exit\n${logs}`)), timeoutMs)),
  ]);
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms${lastError instanceof Error ? `: ${lastError.message}` : ""}\n${logs}`);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("Unable to allocate port"));
      server.close(() => resolve(address.port));
    });
  });
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

function docker(args: readonly string[]): void {
  const result = spawnSync("docker", [...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed: ${result.stderr}`);
}

function ingressUrl(): string {
  return `http://127.0.0.1:${ingressPort}`;
}

function adminUrl(pathname: string): string {
  return `http://127.0.0.1:${adminPort}${pathname}`;
}

function scenarioId(scenario: CoreScenario): string {
  return `TASK-E2E-${({
    SUCCESS: "SUCCESS",
    REPAIR: "REPAIR",
    REPLAN: "REPLAN",
    UNKNOWN: "UNKNOWN",
    BUDGET_EXHAUSTED: "BUDGET",
    CANCELLED: "CANCEL",
  } as const)[scenario]}`;
}
