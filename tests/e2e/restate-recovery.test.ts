import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ProjectBoardSnapshot } from "../../src/domain/board.js";
import type { TaskProjection } from "../../src/domain/task.js";
import { stageSealedTaskPackage } from "../../src/archive/sealed-result-commit.js";
import type { SealEvidence, SealedTaskInput } from "../../src/archive/sealed-result-commit.js";
import { invoke, send } from "../../src/restate/ingress.js";
import type {
  BootstrapFailureRecoveryInput,
  SealedTaskStatus,
  TaskWorkflowInput,
} from "../../src/restate/services.js";

const root = process.cwd();
const containerName = `moye-restate-e2e-${process.pid}`;
let restateIngressPort = 0;
let restateAdminPort = 0;
let servicePort = 0;
let boardPort = 0;
let legacyServicePort = 0;
let service: ChildProcess | undefined;
let legacyService: ChildProcess | undefined;
let serviceLogs = "";
let bootstrapRepositoryRoot = "";
let legacyRecoveryInput: BootstrapFailureRecoveryInput;

describe("Restate process-loss recovery", () => {
  beforeAll(async () => {
    [restateIngressPort, restateAdminPort, servicePort, boardPort, legacyServicePort] = await Promise.all([
      freePort(), freePort(), freePort(), freePort(), freePort(),
    ]);
    docker([
      "run", "--rm", "-d", "--name", containerName,
      "-p", `127.0.0.1:${restateIngressPort}:8080`,
      "-p", `127.0.0.1:${restateAdminPort}:9070`,
      "docker.restate.dev/restatedev/restate:1.7.4",
    ]);
    await waitUntil(async () => (await fetch(adminUrl("/health"))).ok, 20_000);
    const bootstrapFixture = await bootstrapEvidenceRepository();
    bootstrapRepositoryRoot = bootstrapFixture.root;
    legacyRecoveryInput = bootstrapFixture.recoveryInput;
    legacyService = await startLegacyService();
    await registerDeployment(legacyServicePort);
    const legacyReceipt = await send(
      ingressUrl(),
      "TaskWorkflow",
      legacyRecoveryInput.taskId,
      "run",
      legacyRecoveryInput.sourceInput,
    );
    legacyRecoveryInput = { ...legacyRecoveryInput, sourceInvocationRef: legacyReceipt.invocationId };
    await waitForTask(legacyRecoveryInput.taskId, (task) => task.state === "EXECUTING", 10_000);
    await waitUntil(
      async () => serviceLogs.includes("BOOTSTRAP_BASE_COMMIT_NOT_FROZEN"),
      10_000,
    );
    legacyService.kill("SIGKILL");
    await waitForExit(legacyService, 10_000);
    service = await startService();
    await registerDeployment(servicePort);
  }, 40_000);

  afterAll(async () => {
    service?.kill("SIGTERM");
    legacyService?.kill("SIGTERM");
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  });

  it("recovers after SIGKILL between rename and step acknowledgement", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moye-e2e-"));
    const activeTasksRoot = path.join(fixtureRoot, "tasks");
    const archiveRoot = path.join(activeTasksRoot, "archive");
    const taskId = "TASK-E2E-RECOVERY";
    const taskRoot = path.join(activeTasksRoot, taskId);
    const markerPath = path.join(fixtureRoot, "fault", "move-completed.marker");
    const counterPath = path.join(fixtureRoot, "effects", "counter.txt");
    await mkdir(taskRoot, { recursive: true });
    await writeFile(path.join(taskRoot, "spec.md"), "# recovery fixture\n");

    const input: TaskWorkflowInput = {
      taskId,
      projectId: "moye-e2e",
      title: "Recover an uncertain archive move",
      specRevision: 1,
      backlogRefs: ["BL-E2E"],
      activeTasksRoot,
      archiveRoot,
      effectCounterPath: counterPath,
      archivedAt: "2026-08-19T00:00:00.000Z",
      fault: { exitAfterMoveOnce: true, markerPath },
    };

    await send(ingressUrl(), "TaskWorkflow", taskId, "run", input);
    await waitUntil(async () => existsSync(markerPath), 20_000);
    await waitForExit(service, 10_000);

    const archivePath = path.join(archiveRoot, `2026-08-19-${taskId}`);
    expect(existsSync(taskRoot)).toBe(false);
    expect(existsSync(archivePath)).toBe(true);

    service = await startService();
    const finalTask = await waitForTask(taskId, (task) => task.archiveStatus === "ARCHIVED", 30_000);
    const board = await invoke<ProjectBoardSnapshot>(ingressUrl(), "ProjectBoard", "moye-e2e", "get");

    expect(finalTask.state).toBe("CLOSED");
    expect(finalTask.archiveStatus).toBe("ARCHIVED");
    expect(finalTask.events.filter((event) => event.type === "ArchiveArchived")).toHaveLength(1);
    expect(await readFile(counterPath, "utf8")).toBe("1\n");
    expect((await readdir(archiveRoot)).filter((name) => name.endsWith(taskId))).toEqual([
      `2026-08-19-${taskId}`,
    ]);
    expect(board.archived.map((task) => task.taskId)).toContain(taskId);
    expect(board.active.filter((task) => task.taskId === taskId)).toHaveLength(0);
    expect(board.archivePending.filter((task) => task.taskId === taskId)).toHaveLength(0);
    const detailResponse = await fetch(`http://127.0.0.1:${boardPort}/api/tasks/${taskId}`);
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toEqual(finalTask);
    const traceResponse = await fetch(`http://127.0.0.1:${boardPort}/api/tasks/${taskId}/trace`);
    expect(traceResponse.status).toBe(200);
    expect(await traceResponse.json()).toMatchObject({
      traceKind: "TASK",
      stateMachine: {
        authority: "derived-from-runtime-projection",
        workflow: "TaskWorkflow",
        current: { overall: "ARCHIVED", historyCurrent: "ARCHIVED", consistency: "VERIFIED" },
      },
      durableRuntime: { workflowService: "TaskWorkflow", workflowKey: taskId },
    });
  }, 70_000);

  it("exhausts a broken pipeline step, closes as terminal failure, then archives evidence", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moye-e2e-failure-"));
    const activeTasksRoot = path.join(fixtureRoot, "tasks");
    const archiveRoot = path.join(activeTasksRoot, "archive");
    const taskId = "TASK-E2E-FAILURE";
    const taskRoot = path.join(activeTasksRoot, taskId);
    const blockedParent = path.join(fixtureRoot, "not-a-directory");
    await mkdir(taskRoot, { recursive: true });
    await writeFile(path.join(taskRoot, "spec.md"), "# terminal failure fixture\n");
    await writeFile(blockedParent, "file blocks mkdir\n");

    const input: TaskWorkflowInput = {
      taskId,
      projectId: "moye-e2e",
      title: "Bound retries and archive terminal failure evidence",
      specRevision: 1,
      backlogRefs: ["BL-E2E-FAILURE"],
      activeTasksRoot,
      archiveRoot,
      effectCounterPath: path.join(blockedParent, "counter.txt"),
      archivedAt: "2026-08-19T00:00:00.000Z",
    };

    await send(ingressUrl(), "TaskWorkflow", taskId, "run", input);
    const finalTask = await waitForTask(taskId, (task) => task.archiveStatus === "ARCHIVED", 35_000);

    expect(finalTask.state).toBe("CLOSED");
    expect(finalTask.outcome).toBe("FAILED_TERMINAL");
    expect(finalTask.error).toContain("ENOTDIR");
    expect(finalTask.events.filter((event) => event.type === "TaskClosed")).toHaveLength(1);
    expect(existsSync(path.join(archiveRoot, `2026-08-19-${taskId}`))).toBe(true);
  }, 45_000);

  it("rejects an invalid bootstrap baseline before creating authority or projection", async () => {
    const taskId = "TASK-E2E-PREFLIGHT";
    const input = bootstrapTaskInput(taskId, "moye-e2e", bootstrapRepositoryRoot);
    await expect(invoke(ingressUrl(), "TaskWorkflow", taskId, "run", input))
      .rejects.toThrow(/base_commit was not frozen/);
    expect(await invoke(ingressUrl(), "TaskAuthority", taskId, "get")).toBeNull();
    expect(await invoke(ingressUrl(), "TaskWorkflow", taskId, "status")).toBeNull();
    const board = await invoke<ProjectBoardSnapshot>(ingressUrl(), "ProjectBoard", "moye-e2e", "get");
    expect([...board.active, ...board.archivePending, ...board.archived].map((task) => task.taskId))
      .not.toContain(taskId);
  }, 20_000);

  it("terminalizes and archives a deterministic bootstrap failure after dispatch", async () => {
    const taskId = "TASK-E2E-BOOTSTRAP-FAILURE";
    const input = bootstrapTaskInput(taskId, "moye-e2e", bootstrapRepositoryRoot);
    const finalTask = await invoke<TaskProjection>(ingressUrl(), "TaskWorkflow", taskId, "run", input);
    expect(finalTask).toMatchObject({
      state: "CLOSED",
      outcome: "FAILED_TERMINAL",
      archiveStatus: "ARCHIVED",
    });
    expect(finalTask.events.filter((event) => event.type === "TaskClosed")).toHaveLength(1);
    const repeated = await invoke<TaskProjection>(ingressUrl(), "TaskWorkflow", taskId, "status");
    expect(repeated).toEqual(finalTask);
    const board = await invoke<ProjectBoardSnapshot>(ingressUrl(), "ProjectBoard", "moye-e2e", "get");
    expect(board.archived.find((task) => task.taskId === taskId)).toEqual(finalTask);
  }, 30_000);

  it("hands a legacy failed Workflow to one append-only recovery successor", async () => {
    const original = await invoke<TaskProjection | null>(
      ingressUrl(), "TaskWorkflow", legacyRecoveryInput.taskId, "status",
    );
    expect(original).toMatchObject({ state: "EXECUTING", archiveStatus: "NOT_READY" });
    const recovered = await invoke<TaskProjection>(
      ingressUrl(),
      "BootstrapFailureRecoveryWorkflow",
      legacyRecoveryInput.taskId,
      "run",
      legacyRecoveryInput,
    );
    expect(recovered).toMatchObject({
      state: "CLOSED",
      outcome: "FAILED_TERMINAL",
      archiveStatus: "ARCHIVED",
    });
    expect(recovered.events.filter((event) => event.type === "TaskRecoveryStarted")).toHaveLength(1);
    expect(recovered.events.filter((event) => event.type === "TaskClosed")).toHaveLength(1);
    expect(await invoke(ingressUrl(), "TaskWorkflow", legacyRecoveryInput.taskId, "status"))
      .toEqual(original);
    expect(await invoke(ingressUrl(), "TaskAuthority", legacyRecoveryInput.taskId, "get"))
      .toMatchObject({ recoveryWorkflowRef: expect.stringContaining("BootstrapFailureRecoveryWorkflow") });
    const detailResponse = await fetch(`http://127.0.0.1:${boardPort}/api/tasks/${legacyRecoveryInput.taskId}`);
    expect(await detailResponse.json()).toEqual(recovered);
  }, 30_000);

  it("waits durably for one real Git Result Commit and closes without post-commit writes", async () => {
    const fixture = await sealedTaskRepository();
    service?.kill("SIGKILL");
    await waitForExit(service, 10_000);
    service = await startService(fixture.root);
    await registerDeployment(servicePort);
    await send(ingressUrl(), "SealedTaskWorkflow", fixture.input.taskId, "run", fixture.input);

    let sealStatus = await waitForSeal(fixture.input.taskId, (status) =>
      status.projection.currentStep === "waiting-result-commit", 15_000);
    const originalIntent = sealStatus.intent;
    service.kill("SIGKILL");
    await waitForExit(service, 10_000);
    service = await startService(fixture.root);
    await registerDeployment(servicePort);
    sealStatus = await waitForSeal(fixture.input.taskId, () => true, 15_000);
    expect(sealStatus.intent).toEqual(originalIntent);

    await stageSealedTaskPackage(fixture.root, sealStatus.intent);
    const resultCommit = commit(fixture.root, "feat(TASK-E2E-SEAL): sealed result");
    const evidence: SealEvidence = {
      token: sealStatus.intent.token,
      resultCommit,
      executorId: "e2e/root",
      verificationPath: sealStatus.intent.verificationPath,
      docsImpactPath: sealStatus.intent.docsImpactPath,
    };
    await expect(invoke(
      ingressUrl(), "SealedTaskWorkflow", fixture.input.taskId, "seal", { ...evidence, token: "sha256:wrong" },
    )).rejects.toThrow(/does not match the Seal Intent/);
    await invoke(ingressUrl(), "SealedTaskWorkflow", fixture.input.taskId, "seal", evidence);
    const finalTask = await waitForSealedTask(
      fixture.input.taskId, (task) => task.archiveStatus === "ARCHIVED", 30_000,
    );
    const headAfterClosure = git(fixture.root, ["rev-parse", "HEAD"]).trim();
    expect(finalTask).toMatchObject({ state: "CLOSED", outcome: "SUCCEEDED", archiveStatus: "ARCHIVED" });
    expect(finalTask.seal).toMatchObject({ resultCommit });
    expect(headAfterClosure).toBe(resultCommit);
    expect(git(fixture.root, ["status", "--porcelain"])).toBe("");
    expect(git(fixture.root, ["rev-list", "--count", `${fixture.input.baseCommit}..HEAD`]).trim()).toBe("1");
    await invoke(ingressUrl(), "SealedTaskWorkflow", fixture.input.taskId, "seal", evidence);
    expect(git(fixture.root, ["rev-parse", "HEAD"]).trim()).toBe(headAfterClosure);
    const detailResponse = await fetch(`http://127.0.0.1:${boardPort}/api/tasks/${fixture.input.taskId}`);
    expect(await detailResponse.json()).toEqual(finalTask);
    const traceResponse = await fetch(`http://127.0.0.1:${boardPort}/api/tasks/${fixture.input.taskId}/trace`);
    expect(await traceResponse.json()).toMatchObject({
      stateMachine: { workflow: "SealedTaskWorkflow", current: { overall: "ARCHIVED", consistency: "VERIFIED" } },
      durableRuntime: { workflowService: "SealedTaskWorkflow" },
    });
  }, 60_000);
});

async function registerDeployment(port: number): Promise<void> {
  const registration = await fetch(adminUrl("/deployments"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: `http://host.docker.internal:${port}` }),
  });
  if (!registration.ok) throw new Error(`Discovery failed: ${await registration.text()}`);
}

async function startService(repositoryRoot = bootstrapRepositoryRoot): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      RESTATE_SERVICE_PORT: String(servicePort),
      MOYE_BOARD_PORT: String(boardPort),
      RESTATE_INGRESS_URL: ingressUrl(),
      MOYE_PROJECT_ID: "moye-e2e",
      MOYE_REPOSITORY_ROOT: repositoryRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => { serviceLogs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { serviceLogs += chunk.toString(); });
  await waitUntil(async () => canConnect(servicePort), 10_000);
  return child;
}

async function startLegacyService(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/legacy-bootstrap-service.ts"], {
    cwd: root,
    env: { ...process.env, RESTATE_SERVICE_PORT: String(legacyServicePort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => { serviceLogs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { serviceLogs += chunk.toString(); });
  await waitUntil(async () => canConnect(legacyServicePort), 10_000);
  return child;
}

async function bootstrapEvidenceRepository(): Promise<{
  root: string;
  recoveryInput: BootstrapFailureRecoveryInput;
}> {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moye-bootstrap-e2e-"));
  git(fixtureRoot, ["init", "-b", "master"]);
  git(fixtureRoot, ["config", "user.email", "moye@example.invalid"]);
  git(fixtureRoot, ["config", "user.name", "Moye E2E"]);
  await writeFile(path.join(fixtureRoot, "README.md"), "bootstrap e2e\n");
  const oldBase = commit(fixtureRoot, "base");
  await writeFile(path.join(fixtureRoot, "intermediate.txt"), "parent of invalid introductions\n");
  commit(fixtureRoot, "intermediate");
  for (const taskId of ["TASK-E2E-PREFLIGHT", "TASK-E2E-LEGACY-RECOVERY"]) {
    const taskRoot = path.join(fixtureRoot, "docs", "delivery", "tasks", taskId);
    await mkdir(taskRoot, { recursive: true });
    await writeFile(path.join(taskRoot, "task.yaml"), bootstrapManifest(taskId, oldBase));
  }
  commit(fixtureRoot, "introduce invalid bootstrap tasks");

  const validTaskId = "TASK-E2E-BOOTSTRAP-FAILURE";
  const validBase = git(fixtureRoot, ["rev-parse", "HEAD"]).trim();
  const validRoot = path.join(fixtureRoot, "docs", "delivery", "tasks", validTaskId);
  await mkdir(validRoot, { recursive: true });
  await mkdir(path.join(fixtureRoot, "scripts"), { recursive: true });
  await writeFile(path.join(validRoot, "task.yaml"), bootstrapManifest(validTaskId, validBase));
  await writeFile(path.join(validRoot, "verification.md"), "> 状态：Pending\n");
  await writeFile(path.join(validRoot, "docs-impact.yaml"), [
    "schema_version: 1",
    `task_id: ${validTaskId}`,
    "changed_paths:",
    `  - docs/delivery/tasks/${validTaskId}/task.yaml`,
    `  - docs/delivery/tasks/${validTaskId}/verification.md`,
    `  - docs/delivery/tasks/${validTaskId}/docs-impact.yaml`,
    "  - scripts/docs_graph.rb",
    "docs:",
    "  read: []",
    "  reviewed: {}",
    "",
  ].join("\n"));
  await writeFile(path.join(fixtureRoot, "scripts", "docs_graph.rb"), "exit 0\n");
  commit(fixtureRoot, "introduce valid bootstrap failure task");

  const sourceInput = bootstrapTaskInput("TASK-E2E-LEGACY-RECOVERY", "moye-e2e", fixtureRoot);
  return {
    root: fixtureRoot,
    recoveryInput: {
      taskId: sourceInput.taskId,
      projectId: sourceInput.projectId,
      specRevision: sourceInput.specRevision,
      sourceWorkflowRef: `restate://TaskWorkflow/${sourceInput.taskId}`,
      sourceInvocationRef: "legacy-bootstrap-e2e-invocation",
      expectedFailureCode: "BOOTSTRAP_BASE_COMMIT_NOT_FROZEN",
      sourceInput,
    },
  };
}

async function sealedTaskRepository(): Promise<{ root: string; input: SealedTaskInput }> {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moye-sealed-e2e-"));
  git(fixtureRoot, ["init", "-b", "master"]);
  git(fixtureRoot, ["config", "user.email", "moye@example.invalid"]);
  git(fixtureRoot, ["config", "user.name", "Moye E2E"]);
  await mkdir(path.join(fixtureRoot, "scripts"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "README.md"), "sealed E2E\n");
  await writeFile(path.join(fixtureRoot, "scripts", "docs_graph.rb"), "exit 0\n");
  const baseCommit = commit(fixtureRoot, "base");
  const taskId = "TASK-E2E-SEAL";
  const activeRoot = path.join(fixtureRoot, "docs", "delivery", "tasks", taskId);
  const archivePath = `docs/delivery/tasks/archive/2026-08-23-${taskId}`;
  await mkdir(activeRoot, { recursive: true });
  await writeFile(path.join(activeRoot, "task.yaml"), [
    "schema_version: 1",
    `id: ${taskId}`,
    "status: received",
    "spec_revision: 1",
    "execution_mode: sealed-result-commit",
    `base_commit: ${baseCommit}`,
    "archive: { status: not_ready }",
    "result: {}",
    "",
  ].join("\n"));
  await writeFile(path.join(activeRoot, "verification.md"), "> 状态：Accepted\n");
  await writeFile(path.join(activeRoot, "docs-impact.yaml"), [
    "schema_version: 1",
    `task_id: ${taskId}`,
    "changed_paths:",
    `  - ${archivePath}/task.yaml`,
    `  - ${archivePath}/verification.md`,
    `  - ${archivePath}/docs-impact.yaml`,
    "",
  ].join("\n"));
  return {
    root: fixtureRoot,
    input: {
      taskId,
      projectId: "moye-e2e",
      title: "Seal one real Result Commit",
      specRevision: 1,
      backlogRefs: [],
      baseCommit,
      archivedAt: "2026-08-23T00:00:00.000Z",
      executorId: "e2e/root",
    },
  };
}

function bootstrapManifest(taskId: string, baseCommit: string): string {
  return [
    "schema_version: 1",
    `id: ${taskId}`,
    "status: received",
    "spec_revision: 1",
    "execution_mode: goal-bootstrap",
    `base_commit: ${baseCommit}`,
    "archive:",
    "  status: not_ready",
    "result: {}",
    "",
  ].join("\n");
}

function bootstrapTaskInput(taskId: string, projectId: string, repositoryRoot: string): TaskWorkflowInput {
  const resultCommit = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const activeTasksRoot = path.join(repositoryRoot, "docs", "delivery", "tasks");
  return {
    taskId,
    projectId,
    title: `Bootstrap ${taskId}`,
    specRevision: 1,
    backlogRefs: [],
    activeTasksRoot,
    archiveRoot: path.join(activeTasksRoot, "archive"),
    effectCounterPath: path.join(repositoryRoot, ".runtime", `${taskId}.txt`),
    archivedAt: "2026-08-23T00:00:00.000Z",
    bootstrapEvidence: {
      kind: "GOAL_BOOTSTRAP",
      executorId: "e2e/root",
      resultCommit,
      verificationRefs: [`task-artifact://${taskId}/verification.md`],
      docsImpactRef: `task-artifact://${taskId}/docs-impact.yaml`,
    },
  };
}

function commit(repositoryRoot: string, message: string): string {
  git(repositoryRoot, ["add", "."]);
  git(repositoryRoot, ["commit", "-m", message]);
  return git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
}

function git(repositoryRoot: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8" });
}

async function waitForTask(
  taskId: string,
  predicate: (task: TaskProjection) => boolean,
  timeoutMs: number,
): Promise<TaskProjection> {
  let latest: TaskProjection | null = null;
  await waitUntil(async () => {
    try {
      latest = await invoke<TaskProjection | null>(ingressUrl(), "TaskWorkflow", taskId, "status");
      return latest !== null && predicate(latest);
    } catch {
      return false;
    }
  }, timeoutMs);
  if (latest === null) throw new Error("Task projection remained empty");
  return latest;
}

async function waitForSealedTask(
  taskId: string,
  predicate: (task: TaskProjection) => boolean,
  timeoutMs: number,
): Promise<TaskProjection> {
  let latest: TaskProjection | null = null;
  await waitUntil(async () => {
    latest = await invoke<TaskProjection | null>(ingressUrl(), "SealedTaskWorkflow", taskId, "status");
    return latest !== null && predicate(latest);
  }, timeoutMs);
  if (latest === null) throw new Error("Sealed Task projection remained empty");
  return latest;
}

async function waitForSeal(
  taskId: string,
  predicate: (status: SealedTaskStatus) => boolean,
  timeoutMs: number,
): Promise<SealedTaskStatus> {
  let latest: SealedTaskStatus | null = null;
  await waitUntil(async () => {
    latest = await invoke<SealedTaskStatus | null>(ingressUrl(), "SealedTaskWorkflow", taskId, "sealStatus");
    return latest !== null && predicate(latest);
  }, timeoutMs);
  if (latest === null) throw new Error("Seal Intent remained empty");
  return latest;
}

async function waitForExit(child: ChildProcess | undefined, timeoutMs: number): Promise<void> {
  if (child === undefined) throw new Error("Service was not started");
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Service did not exit\n${serviceLogs}`)), timeoutMs)),
  ]);
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Unable to allocate port"));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolveConnection) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolveConnection(true); });
    socket.once("error", () => resolveConnection(false));
  });
}

function docker(args: readonly string[]): void {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed: ${result.stderr}`);
}

function ingressUrl(): string {
  return `http://127.0.0.1:${restateIngressPort}`;
}

function adminUrl(pathname: string): string {
  return `http://127.0.0.1:${restateAdminPort}${pathname}`;
}
