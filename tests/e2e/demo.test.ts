import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ProjectBoardSnapshot } from "../../src/domain/board.js";
import type { CodingTaskTrace } from "../../src/trace/coding-trace.js";

const containerName = `moye-demo-e2e-${process.pid}`;
let demoRoot = "";
let demo: ChildProcess | undefined;
let output = "";
let boardUrl = "";
let taskId = "";

describe("npm run demo", () => {
  beforeAll(async () => {
    demoRoot = await mkdtemp(path.join(os.tmpdir(), "moye-demo-e2e-"));
    demo = spawn(process.execPath, ["--import", "tsx", "scripts/demo.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, MOYE_DEMO_CONTAINER_NAME: containerName, MOYE_DEMO_ROOT: demoRoot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    demo.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    demo.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    await waitUntil(() => output.includes("Moye Coding Demo 已就绪"), 35_000);
    boardUrl = requiredMatch(output, /项目看板: (http:\/\/127\.0\.0\.1:\d+)/, "board URL");
    taskId = requiredMatch(output, /Demo Task: (TASK-DEMO-[A-Z0-9]+)/, "task ID");
  }, 40_000);

  afterAll(async () => {
    if (demo && demo.exitCode === null && demo.signalCode === null) {
      demo.kill("SIGINT");
      await Promise.race([
        new Promise<void>((resolve) => demo?.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 6_000)),
      ]);
    }
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    if (demoRoot) await rm(demoRoot, { recursive: true, force: true });
  });

  it("creates a real closed Coding Task and exposes its Chinese journey", async () => {
    const board = await fetchJson<ProjectBoardSnapshot>(`${boardUrl}/api/board`);
    expect(board.archived.find((task) => task.taskId === taskId)).toMatchObject({
      state: "CLOSED", archiveStatus: "ARCHIVED", currentStep: "ARCHIVE",
    });

    const trace = await fetchJson<CodingTaskTrace>(`${boardUrl}/api/tasks/${taskId}/trace`);
    expect(trace).toMatchObject({
      task: { taskId, state: "CLOSED", archiveStatus: "ARCHIVED" },
      agent: { sessionId: `agent-session-${taskId}`, runnerKind: "FAKE", outcome: "SUCCEEDED" },
      verification: { passed: true },
      recovery: { classification: "NONE" },
      durableRuntime: { workflowService: "CodingTaskWorkflow", workflowKey: taskId },
    });
    expect(trace.business.attempts).toHaveLength(6);
    expect(trace.git.resultCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(trace.git.mergeCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(trace.durableRuntime.invocationsUrl).toContain(encodeURIComponent(taskId));

    const html = await (await fetch(boardUrl)).text();
    const app = await (await fetch(`${boardUrl}/app.js`)).text();
    expect(html).toContain("任务控制面 · Coding Demo");
    expect(app).toContain("七个阶段，一眼看清做到哪里");
    await expect(stat(path.join(demoRoot, "coding-fixtures", taskId, "worktrees", taskId))).rejects.toMatchObject({ code: "ENOENT" });
  }, 10_000);
});

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`request failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function requiredMatch(value: string, pattern: RegExp, label: string): string {
  const result = value.match(pattern)?.[1];
  if (!result) throw new Error(`missing ${label} in demo output:\n${value}`);
  return result;
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    if (demo?.exitCode !== null || demo?.signalCode !== null) throw new Error(`demo exited before ready:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`demo did not become ready:\n${output}`);
}
