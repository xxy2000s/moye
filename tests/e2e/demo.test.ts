import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
    expect(trace.observability).toMatchObject({ enabled: false, provider: "disabled" });
    expect(trace.agentEvents).toMatchObject({
      viewUrl: `/api/tasks/${taskId}/agent-events`, completed: true,
    });
    const eventPage = await fetchJson<{ total: number; completed: boolean; events: unknown[] }>(
      `${boardUrl}/api/tasks/${taskId}/agent-events?cursor=0&limit=2`,
    );
    expect(eventPage).toMatchObject({ total: 4, completed: true });
    expect(eventPage.events).toHaveLength(2);
    const eventsUrl = trace.technical.artifacts.find((artifact) => artifact.kind === "agent-events")?.downloadUrl;
    expect(eventsUrl).toBe(`/api/tasks/${taskId}/artifacts/agent-events`);
    const events = await (await fetch(`${boardUrl}${eventsUrl}`)).text();
    expect(events).toContain(`agent-session-${taskId}`);

    const html = await (await fetch(boardUrl)).text();
    const directTaskPage = await fetch(`${boardUrl}/tasks/${taskId}`);
    expect(directTaskPage.status).toBe(200);
    expect(await directTaskPage.text()).toContain('id="task-detail-page"');
    expect((await fetch(`${boardUrl}/tasks/not-a-task`)).status).toBe(404);
    const app = await (await fetch(`${boardUrl}/app.js`)).text();
    const styles = await (await fetch(`${boardUrl}/styles.css`)).text();
    const compose = await readFile(path.join(process.cwd(), "compose.yaml"), "utf8");
    const runtimeCompose = await readFile(path.join(process.cwd(), "scripts/runtime-compose.ts"), "utf8");
    const packageJson = await readFile(path.join(process.cwd(), "package.json"), "utf8");
    expect(html).toContain("不是进度条");
    expect(html).toContain("本页面只读，不创建或推进 Task");
    expect(html).toContain("等待归档，或失败终止后等待后续动作");
    expect(app).toContain("Runtime State Machine");
    expect(app).toContain("renderMachineGraphCanvas");
    expect(app).toContain("data-machine-graph");
    expect(app).toContain("data-machine-filter");
    expect(app).toContain("本次路径");
    expect(app).toContain("恢复 / 回滚");
    expect(app).toContain("WAITING_RECONCILE");
    expect(app).toContain("renderMachineNodeInspector");
    expect(app).toContain("machine.definition.edges");
    expect(app).toContain("function visibleTaskState(task)");
    expect(app).toContain('task.runtimeState === "WAITING_RECONCILE"');
    expect(app).toContain('task.archiveStatus === "FAILED" || task.runtimeState === "ARCHIVE_FAILED"');
    expect(app).toContain("实际路径 ·");
    expect(app).toContain("查看完整合法边");
    expect(app).toContain("查看 Agent Events");
    expect(html).toContain('id="agent-events-dialog"');
    expect(html).toContain("data-agent-events-viewer");
    expect(html).not.toContain('<dialog id="task-detail"');
    expect(html).toMatch(/<main id="task-detail-page"[\s\S]*?<\/main>\s*<dialog id="agent-events-dialog"/);
    expect(html).toContain('class="task-detail-frame"');
    expect(html).toContain('id="task-detail-back"');
    expect(app).toContain('history.pushState({ moyeRoute: "task"');
    expect(app).toContain('window.addEventListener("popstate"');
    expect(app).toContain("returnToProject");
    expect(app).toContain("renderDomainEventPanel");
    expect(app).toContain("Domain Event 证明状态如何变化");
    expect(styles).toContain(".domain-event-timeline");
    expect(styles).toContain(".task-detail-page");
    expect(compose).toContain("restate_data:/restate-data");
    expect(runtimeCompose).toContain('spawnSync("docker", ["compose", "version"]');
    expect(runtimeCompose).toContain('spawnSync("docker-compose", ["version"]');
    expect(packageJson).toContain('"runtime:down": "tsx scripts/runtime-compose.ts down"');
    expect(app).toContain("data-machine-graph-stage");
    expect(app).toContain("data-machine-inspector-close");
    expect(app).toContain("machineGraphUiState.inspectorOpen");
    expect(app).toContain("renderMachineExecutionDetail");
    expect(app).toContain("renderMachineControlFacts");
    expect(app).toContain("renderMachineAgentActivity");
    expect(app).toContain("bindMachineAgentEventPreviews");
    expect(app).toContain("查看全部 Agent Events");
    expect(app).toContain("状态流转记录");
    expect(app).toContain("它不是 Agent 的聊天或工具日志");
    expect(app).toContain("合法但未发生");
    expect(app).toContain("这里列出代码允许的路径");
    expect(app).toContain("renderMachineTransitionRow");
    expect(app).not.toContain('class="machine-inspector-grid"');
    expect(styles).toContain(".machine-transition-row");
    expect(styles).toContain(".machine-edge-proof text");
    expect(app).toContain("系统管控与结果");
    expect(app).toContain("machineExecutionBelongsToNode");
    expect(app).toContain('nodeId === "DOCS" && execution.step === "DOCS_GATE"');
    expect(app).toContain("trigger.dataset.agentEventsBound");
    expect(app).toContain('class="machine-history-drawer"');
    expect(app).toContain('class="task-evidence-panel"');
    expect(styles).toContain('.machine-graph-stage[data-inspector-open="true"]');
    expect(styles).toContain(".machine-node-execution");
    expect(styles).toContain(".machine-node-control");
    expect(styles).toContain(".machine-agent-activity");
    expect(styles).toContain(".machine-agent-preview-list");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("min-height: 100dvh");
    expect(app).toContain("openAgentEventsDialog");
    expect(app).toContain("await applyRoute(board)");
    expect(app).toContain("taskTraceSignature(trace)");
    expect(app).toContain("elements.eventsDialog.open || taskDetailRefreshInFlight");
    expect(app).not.toContain('id="agent-events-viewer"');
    expect(app).toContain("data-agent-event-filter");
    expect(app).toContain("实时跟随中");
    expect(app).not.toContain("下载原始 JSONL");
    expect(app).toContain("sessionEventsButton");
    expect(app).toContain("在弹窗查看对话");
    expect(app).toContain("eventSpeaker");
    expect(app).toContain('aria-label="Agent 会话记录"');
    expect(app).not.toContain("查看原始 Events ↗");
    expect(app).not.toMatch(/eventsUrl\)}" target="_blank"/);
    expect(app).not.toContain("MAX_AGENT_EVENTS");
    expect(app).not.toContain("查看 Agent Events ↗");
    expect(app).toContain("打开 Trace（Phoenix）");
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
