import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTaskEnvelope } from "../../src/domain/coding-task.js";
import type { ProjectBoardSnapshot } from "../../src/domain/board.js";
import { invoke, send } from "../../src/restate/ingress.js";
import type { CodingTaskWorkflowInput } from "../../src/restate/coding-services.js";
import type { CodingWorkflowProjection } from "../../src/coding/workflow.js";

const root = process.cwd();
const containerName = `moye-coding-e2e-${process.pid}`;
const fixtureRoots: string[] = [];
let ingressPort = 0;
let adminPort = 0;
let servicePort = 0;
let boardPort = 0;
let service: ChildProcess | undefined;
let logs = "";

describe("Restate coding workflow", () => {
  beforeAll(async () => {
    [ingressPort, adminPort, servicePort, boardPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
    docker(["run", "--rm", "-d", "--name", containerName,
      "-p", `127.0.0.1:${ingressPort}:8080`, "-p", `127.0.0.1:${adminPort}:9070`,
      "docker.restate.dev/restatedev/restate:1.7.4"]);
    await waitUntil(async () => {
      try { return (await fetch(`http://127.0.0.1:${adminPort}/health`)).ok; }
      catch { return false; }
    }, 20_000);
    await startService();
    await registerService();
  }, 40_000);

  afterAll(async () => {
    await stopService("SIGTERM");
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    for (const fixture of fixtureRoots.splice(0)) await rm(fixture, { recursive: true, force: true });
  });

  it("durably executes the Fake coding loop and creates one Merge Commit", async () => {
    const fixture = await workflowFixture("TASK-CODING-E2E", false);
    const result = await invoke<CodingWorkflowProjection>(
      `http://127.0.0.1:${ingressPort}`, "CodingTaskWorkflow", "TASK-CODING-E2E", "run", fixture.input,
    );
    const status = await invoke<CodingWorkflowProjection | null>(
      `http://127.0.0.1:${ingressPort}`, "CodingTaskWorkflow", "TASK-CODING-E2E", "status",
    );
    expect(result).toMatchObject({ state: "CLOSED", outcome: "SUCCEEDED", archiveStatus: "ARCHIVED" });
    expect(status).toEqual(result);
    expect(result.agent).toMatchObject({ sessionId: "session-TASK-CODING-E2E", outcome: "SUCCEEDED" });
    expect(result.verification).toMatchObject({ passed: true });
    expect(git(fixture.repositoryRoot, "rev-parse", "master").trim()).toBe(result.merge?.mergeCommit);
    expect(git(fixture.repositoryRoot, "log", "master", "--fixed-strings", "--grep", result.merge!.effectId, "--format=%H").trim().split("\n"))
      .toEqual([result.merge?.mergeCommit]);
    const board = await invoke<ProjectBoardSnapshot>(
      `http://127.0.0.1:${ingressPort}`, "ProjectBoard", "moye-coding-e2e", "get", undefined,
    );
    expect(board.archived.find((task) => task.taskId === "TASK-CODING-E2E")).toMatchObject({
      state: "CLOSED", archiveStatus: "ARCHIVED", currentStep: "ARCHIVE",
    });
    await expect(invoke(
      `http://127.0.0.1:${ingressPort}`, "TaskWorkflow", "TASK-CODING-E2E", "run", {
        taskId: "TASK-CODING-E2E",
        projectId: "moye-coding-e2e",
        title: "conflicting legacy owner",
        specRevision: 1,
        backlogRefs: ["BL-0002"],
        activeTasksRoot: fixture.input.activeTasksRoot,
        archiveRoot: fixture.input.archiveRoot,
        effectCounterPath: path.join(fixture.input.artifactRoot, "counter.txt"),
        archivedAt: fixture.input.archivedAt,
      },
    )).rejects.toThrow(/already owned by CODING_WORKFLOW/);
  }, 30_000);

  it("keeps target master unchanged when the Verification Gate fails", async () => {
    const fixture = await workflowFixture("TASK-CODING-GATE-FAIL", true);
    const result = await invoke<CodingWorkflowProjection>(
      `http://127.0.0.1:${ingressPort}`, "CodingTaskWorkflow", "TASK-CODING-GATE-FAIL", "run", fixture.input,
    );
    expect(result).toMatchObject({ state: "FAILED", currentStep: "VERIFY", outcome: "FAILED_TERMINAL" });
    expect(result.merge).toBeUndefined();
    expect(git(fixture.repositoryRoot, "rev-parse", "master").trim()).toBe(fixture.baseSha);
  }, 30_000);

  it("reconciles a lost Merge activity acknowledgement without a second ref update", async () => {
    const fixture = await workflowFixture("TASK-CODING-MERGE-UNKNOWN", false);
    const marker = path.join(path.dirname(fixture.repositoryRoot), "merge-ack-lost.marker");
    const input: CodingTaskWorkflowInput = { ...fixture.input, fault: { loseMergeAcknowledgementOnceAt: marker } };
    const result = await invoke<CodingWorkflowProjection>(
      `http://127.0.0.1:${ingressPort}`, "CodingTaskWorkflow", "TASK-CODING-MERGE-UNKNOWN", "run", input,
    );
    expect(result).toMatchObject({ state: "CLOSED", archiveStatus: "ARCHIVED" });
    expect(result.merge).toMatchObject({ outcome: "ALREADY_APPLIED", reconciledAfterUnknown: true });
    expect(git(fixture.repositoryRoot, "log", "master", "--fixed-strings", "--grep", result.merge!.effectId, "--format=%H").trim().split("\n"))
      .toEqual([result.merge?.mergeCommit]);
  }, 30_000);

  it("hands an interrupted Verification activity to a restarted Worker without rerunning the command", async () => {
    const marker = path.join(os.tmpdir(), `moye-verification-restart-${process.pid}.log`);
    await rm(marker, { force: true });
    const script = [
      "const fs=require('fs')",
      `fs.appendFileSync(${JSON.stringify(marker)},'run\\n')`,
      "setTimeout(()=>{console.log('late verification result')},2000)",
    ].join(";");
    const fixture = await workflowFixture("TASK-CODING-WORKER-RESTART", false, script);
    await send(
      `http://127.0.0.1:${ingressPort}`, "CodingTaskWorkflow", "TASK-CODING-WORKER-RESTART", "run", fixture.input,
    );
    await waitUntil(async () => {
      try { return (await readFile(marker, "utf8")).includes("run"); } catch { return false; }
    }, 10_000);
    await stopService("SIGKILL");
    await startService();
    await registerService();
    let result: CodingWorkflowProjection | null = null;
    await waitUntil(async () => {
      try {
        result = await invoke<CodingWorkflowProjection | null>(
          `http://127.0.0.1:${ingressPort}`, "CodingTaskWorkflow", "TASK-CODING-WORKER-RESTART", "status", undefined,
        );
        return result?.state === "FAILED";
      } catch { return false; }
    }, 25_000);
    const recovered = result as CodingWorkflowProjection | null;
    if (recovered === null) throw new Error(`Coding projection did not recover\n${logs}`);
    expect(recovered).toMatchObject({ state: "FAILED", currentStep: "VERIFY", outcome: "FAILED_TERMINAL" });
    expect(recovered.verification).toMatchObject({ passed: false, code: "RESULT_UNKNOWN" });
    expect(recovered.merge).toBeUndefined();
    expect((await readFile(marker, "utf8")).trim().split("\n")).toEqual(["run"]);
    expect(git(fixture.repositoryRoot, "rev-parse", "master").trim()).toBe(fixture.baseSha);
    await rm(marker, { force: true });
  }, 30_000);
});

async function workflowFixture(taskId: string, fail: boolean, validationScript?: string) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moye-coding-restate-"));
  fixtureRoots.push(fixtureRoot);
  const repositoryRoot = path.join(fixtureRoot, "repo");
  const artifactRoot = path.join(fixtureRoot, "artifacts");
  const activeTasksRoot = path.join(fixtureRoot, "tasks");
  const archiveRoot = path.join(activeTasksRoot, "archive");
  await mkdir(repositoryRoot);
  await mkdir(artifactRoot);
  await mkdir(path.join(activeTasksRoot, taskId), { recursive: true });
  await writeFile(path.join(activeTasksRoot, taskId, "spec.md"), `# ${taskId}\n`);
  git(repositoryRoot, "init", "-b", "master");
  git(repositoryRoot, "config", "user.name", "Moye E2E");
  git(repositoryRoot, "config", "user.email", "moye-e2e@example.test");
  await writeFile(path.join(repositoryRoot, "README.md"), "fixture\n");
  git(repositoryRoot, "add", "README.md");
  git(repositoryRoot, "commit", "-m", "base");
  const baseSha = git(repositoryRoot, "rev-parse", "HEAD").trim();
  git(repositoryRoot, "switch", "--detach", baseSha);
  const envelope = createTaskEnvelope({
    taskId,
    specRevision: 1,
    baseSha,
    requirements: [{ requirementId: "REQ-CODING-E2E-01", title: "fixture", acceptanceCriteria: ["result merged"] }],
    validationCommands: [{
      commandId: "CMD-CODING-E2E",
      argv: [process.execPath, "-e", validationScript ?? (fail
        ? "console.error('intentional gate failure');process.exit(11)"
        : "const fs=require('fs');if(fs.readFileSync('result.txt','utf8')!=='restated\\n')process.exit(2);console.log('verified')")],
    }],
    contextPlan: { graphRevision: 17, intents: ["coding-task-poc"], requiredRead: ["agent-contract"], requiredReview: [] },
  });
  const input: CodingTaskWorkflowInput = {
    projectId: "moye-coding-e2e",
    title: `Coding fixture ${taskId}`,
    backlogRefs: ["BL-0002"],
    activeTasksRoot,
    archiveRoot,
    archivedAt: "2026-08-20T00:10:00.000Z",
    envelope,
    expectedEnvelopeDigest: envelope.envelopeDigest,
    repositoryRoot,
    worktreeRoot: path.join(fixtureRoot, "worktrees"),
    artifactRoot,
    baseRef: "refs/heads/master",
    targetRef: "refs/heads/master",
    runnerKind: "FAKE",
    prompt: "implement the fixture",
    docsDisposition: "not_applicable",
    fake: {
      script: {
        events: [
          { type: "thread.started", thread_id: `session-${taskId}` },
          { type: "turn.started" },
          { type: "item.completed", item: { type: "agent_message", text: "fixture committed" } },
          { type: "turn.completed" },
        ],
        stderr: "fake runner\n",
        exitCode: 0,
        startedAt: "2026-08-20T00:00:00.000Z",
        durationMs: 10,
      },
      mutation: { fileName: "result.txt", content: "restated\n" },
    },
  };
  return { repositoryRoot, baseSha, input };
}

async function startService(): Promise<void> {
  service = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      RESTATE_SERVICE_PORT: String(servicePort),
      MOYE_BOARD_PORT: String(boardPort),
      RESTATE_INGRESS_URL: `http://127.0.0.1:${ingressPort}`,
      MOYE_PROJECT_ID: "moye-coding-e2e",
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
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    current.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}

async function registerService(): Promise<void> {
  const registration = await fetch(`http://127.0.0.1:${adminPort}/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: `http://host.docker.internal:${servicePort}` }),
  });
  if (!registration.ok) throw new Error(`Discovery failed: ${await registration.text()}\n${logs}`);
}

function docker(args: readonly string[]): string {
  const result = spawnSync("docker", [...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) return reject(new Error("no port"));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms\n${logs}`);
}

function git(cwd: string, ...argv: string[]): string {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
