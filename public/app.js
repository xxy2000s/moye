const elements = {
  dot: document.querySelector("#connection-dot"),
  connection: document.querySelector("#connection-label"),
  project: document.querySelector("#project-id"),
  active: document.querySelector("#active-count"),
  pending: document.querySelector("#pending-count"),
  generated: document.querySelector("#generated-at"),
  empty: document.querySelector("#empty-state"),
  projectMasthead: document.querySelector("#project-masthead"),
  projectView: document.querySelector("#project-view"),
  detailPage: document.querySelector("#task-detail-page"),
  detailBack: document.querySelector("#task-detail-back"),
  detail: document.querySelector("#detail-content"),
  detailKicker: document.querySelector("#task-detail-kicker"),
  detailTitle: document.querySelector("#task-detail-title"),
  detailMeta: document.querySelector("#task-detail-meta"),
  eventsDialog: document.querySelector("#agent-events-dialog"),
  eventsViewer: document.querySelector("#agent-events-dialog [data-agent-events-viewer]"),
};

const lanes = {
  backlog: [document.querySelector("#backlog-list"), document.querySelector("#backlog-count")],
  active: [document.querySelector("#active-list"), document.querySelector("#active-lane-count")],
  archivePending: [document.querySelector("#pending-list"), document.querySelector("#pending-lane-count")],
  archived: [document.querySelector("#archived-list"), document.querySelector("#archived-count")],
};

const PIPELINE_STAGES = [
  { id: "CONTEXT", label: "需求与上下文", description: "冻结规格、验收条件和必读文档" },
  { id: "WORKSPACE", label: "隔离工作区", description: "创建独立 Worktree 与任务分支" },
  { id: "IMPLEMENT", label: "Agent 编码", description: "绑定一次可追踪的 Agent Session" },
  { id: "SELF_REVIEW", label: "实现者自审", description: "真实只读会话先检查自己的提交" },
  { id: "VERIFY", label: "自动验证", description: "运行固定命令并固化验证证据" },
  { id: "REVIEW", label: "独立审查", description: "只读 Agent 审查；阻断问题进入 Repair" },
  { id: "REPLAN", label: "规格修订", description: "仅当规格缺陷被确认时产生 Revision N+1" },
  { id: "MERGE", label: "合入分支", description: "检查 Git 事实并合入目标分支" },
  { id: "DOCS", label: "文档检查", description: "确认关联文档、影响声明与知识沉淀" },
  { id: "ARCHIVE", label: "归档", description: "固化结果与回执，完成闭环" },
];

let lastProjectionSignature = "";
let openedTaskSummary;
let openedTaskTraceSignature = "";
let taskDetailRefreshInFlight = false;
let boardScrollPosition = 0;
let stopAgentEventsFollower = () => {};
let agentEventsReturnFocus;
let shouldRestoreAgentEventsFocus = true;
let machineGraphUiState = { filter: "ALL", zoom: undefined, selectedId: undefined, inspectorOpen: false, scrollLeft: 0, scrollTop: 0 };
let closeMachineGraphInspector = () => false;
elements.eventsDialog.addEventListener("close", () => {
  const returnFocus = agentEventsReturnFocus;
  stopAgentEventsFollower();
  stopAgentEventsFollower = () => {};
  if (returnFocus instanceof HTMLButtonElement) updateAgentEventsTrigger(returnFocus, false);
  agentEventsReturnFocus = undefined;
  if (shouldRestoreAgentEventsFocus && !elements.detailPage.hidden && returnFocus?.isConnected) {
    window.requestAnimationFrame(() => returnFocus.focus());
  }
  shouldRestoreAgentEventsFocus = true;
});
elements.detailBack.addEventListener("click", returnToProject);
window.addEventListener("popstate", () => { void applyRoute(); });
window.addEventListener("keydown", event => {
  if (event.key !== "Escape" || !machineGraphUiState.inspectorOpen || elements.eventsDialog.open) return;
  event.preventDefault();
  closeMachineGraphInspector(true);
});
document.querySelector("#refresh").addEventListener("click", loadBoard);
initializeHistoryState();
void loadBoard();
setInterval(loadBoard, 5000);

async function loadBoard() {
  try {
    const response = await fetch("/api/board", { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    const board = await response.json();
    renderBoard(board);
    await applyRoute(board);
    elements.dot.className = "connection-dot online";
    elements.connection.textContent = "运行时已连接";
  } catch (error) {
    elements.dot.className = "connection-dot offline";
    elements.connection.textContent = "运行时不可用";
    console.error(error);
  }
}

function renderBoard(board) {
  elements.project.textContent = board.projectId;
  elements.active.textContent = String(board.active.length);
  elements.pending.textContent = String(board.archivePending.length);
  elements.generated.textContent = formatTime(board.generatedAt);
  const signature = JSON.stringify([board.backlog, board.active, board.archivePending, board.archived]);
  if (signature !== lastProjectionSignature) {
    renderLane("backlog", board.backlog, backlogCard);
    renderLane("active", board.active, taskCard);
    renderLane("archivePending", board.archivePending, taskCard);
    renderLane("archived", board.archived, taskCard);
    lastProjectionSignature = signature;
  }
  elements.empty.hidden = board.backlog.length + board.active.length + board.archivePending.length + board.archived.length !== 0;
}

function renderLane(name, items, renderer) {
  const [container, count] = lanes[name];
  count.textContent = String(items.length);
  if (items.length === 0) {
    container.innerHTML = '<div class="placeholder">暂无条目</div>';
    return;
  }
  container.replaceChildren(...items.map((item, index) => renderer(item, index)));
}

function backlogCard(item, index) {
  const card = cardShell(index, "div");
  card.classList.add("static");
  card.innerHTML = `
    <div class="card-meta"><span>${escapeHtml(item.backlogId)}</span><span>${escapeHtml(item.priority)}</span></div>
    <h3>${escapeHtml(item.title)}</h3>
    <div class="card-footer"><span class="tag ${item.status === "SCHEDULED" ? "green" : "yellow"}">${escapeHtml(backlogStatusLabel(item.status))}</span><span class="tag blue">${escapeHtml(item.kind)}</span></div>`;
  return card;
}

function taskCard(task, index) {
  const card = cardShell(index, "button");
  card.type = "button";
  card.setAttribute("aria-label", `查看任务 ${task.taskId}：${task.title}`);
  const visibleState = task.outcome === "FAILED_TERMINAL" ? "FAILED" : task.state;
  card.innerHTML = `
    <div class="card-meta"><span>${escapeHtml(task.taskId)}</span><span>R${task.specRevision}</span></div>
    <h3>${escapeHtml(task.title)}</h3>
    <div class="card-footer">
      <span class="tag ${stateColor(visibleState)}">${escapeHtml(taskStateLabel(visibleState))}</span>
      <span class="tag ${archiveColor(task.archiveStatus)}">${escapeHtml(archiveStatusLabel(task.archiveStatus))}</span>
    </div>`;
  card.addEventListener("click", () => navigateToTask(task));
  return card;
}

function cardShell(index, tagName) {
  const card = document.createElement(tagName);
  card.className = "card";
  card.style.setProperty("--index", String(index));
  return card;
}

function initializeHistoryState() {
  const route = readRoute();
  const current = history.state && typeof history.state === "object" ? history.state : {};
  history.replaceState({ ...current, moyeRoute: route.kind, fromProject: false }, "", window.location.href);
}

function readRoute() {
  if (window.location.pathname === "/" || window.location.pathname === "") return { kind: "project" };
  const match = window.location.pathname.match(/^\/tasks\/([^/]+)\/?$/);
  if (!match) return { kind: "not-found" };
  try {
    const taskId = decodeURIComponent(match[1]);
    return /^TASK-[A-Z0-9][A-Z0-9-]{0,63}$/.test(taskId) ? { kind: "task", taskId } : { kind: "not-found" };
  } catch {
    return { kind: "not-found" };
  }
}

function navigateToTask(summary) {
  boardScrollPosition = window.scrollY;
  history.pushState({ moyeRoute: "task", fromProject: true }, "", `/tasks/${encodeURIComponent(summary.taskId)}`);
  void openTask(summary);
}

function returnToProject() {
  if (history.state?.fromProject) {
    history.back();
    return;
  }
  history.pushState({ moyeRoute: "project", fromProject: false }, "", "/");
  void applyRoute();
}

async function applyRoute(board) {
  const route = readRoute();
  if (route.kind === "project") {
    if (!elements.detailPage.hidden) showProjectPage();
    return;
  }
  if (route.kind === "not-found") {
    showTaskPage();
    renderTaskRouteError("这个页面地址不是有效的 Moye Task 路由。");
    return;
  }
  const snapshot = board || await fetch("/api/board", { cache: "no-store" }).then(response => {
    if (!response.ok) throw new Error(`项目投影查询失败（${response.status}）`);
    return response.json();
  });
  const summaries = [...snapshot.active, ...snapshot.archivePending, ...snapshot.archived];
  const summary = summaries.find(item => item.taskId === route.taskId) || {
    taskId: route.taskId,
    title: route.taskId,
    specRevision: 1,
    state: "RECEIVED",
    archiveStatus: "NOT_READY",
  };
  if (openedTaskSummary?.taskId === summary.taskId) {
    openedTaskSummary = summary;
    showTaskPage(false);
    await refreshOpenTask(snapshot);
    return;
  }
  await openTask(summary);
}

function showProjectPage() {
  closeAgentEventsDialog(false);
  closeMachineGraphInspector = () => false;
  openedTaskSummary = undefined;
  openedTaskTraceSignature = "";
  document.body.classList.remove("task-route");
  elements.projectMasthead.hidden = false;
  elements.projectView.hidden = false;
  elements.detailPage.hidden = true;
  document.title = "Moye · Task Control Plane";
  window.requestAnimationFrame(() => window.scrollTo({ top: boardScrollPosition, behavior: "instant" }));
}

function showTaskPage(resetScroll = true) {
  document.body.classList.add("task-route");
  elements.projectMasthead.hidden = true;
  elements.projectView.hidden = true;
  elements.detailPage.hidden = false;
  if (resetScroll) window.scrollTo({ top: 0, behavior: "instant" });
}

function renderTaskRouteError(message) {
  openedTaskSummary = undefined;
  openedTaskTraceSignature = "";
  elements.detailKicker.textContent = "Task route";
  elements.detailTitle.textContent = "无法打开任务";
  elements.detailMeta.innerHTML = "";
  elements.detail.innerHTML = `<p class="error-box">${escapeHtml(message)}</p><p class="trace-note">请返回项目总览后重新选择 Task。</p>`;
  document.title = "无法打开任务 · Moye";
}

async function openTask(summary) {
  openedTaskSummary = summary;
  openedTaskTraceSignature = "";
  machineGraphUiState = { filter: "ALL", zoom: undefined, selectedId: undefined, inspectorOpen: false, scrollLeft: 0, scrollTop: 0 };
  renderTaskDetailHeader(summary, summary.title, [
    ["状态", taskStateLabel(summary.state)],
    ["归档", archiveStatusLabel(summary.archiveStatus)],
  ]);
  elements.detail.innerHTML = '<div class="task-detail-loading" role="status">正在读取 Runtime Definition、Event History 与执行证据…</div>';
  showTaskPage();
  document.title = `${summary.taskId} · Moye`;
  await loadTaskDetail(summary, true);
}

async function refreshOpenTask(board) {
  if (elements.detailPage.hidden || !openedTaskSummary || elements.eventsDialog.open || taskDetailRefreshInFlight) return;
  const summaries = [...board.active, ...board.archivePending, ...board.archived];
  const latest = summaries.find(item => item.taskId === openedTaskSummary.taskId) || openedTaskSummary;
  openedTaskSummary = latest;
  await loadTaskDetail(latest, false);
}

async function loadTaskDetail(summary, resetScroll) {
  taskDetailRefreshInFlight = true;
  try {
    const taskId = summary.taskId;
    const traceResponse = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/trace`, { cache: "no-store" });
    if (!traceResponse.ok) throw new Error(`轨迹查询失败（${traceResponse.status}）`);
    const trace = await traceResponse.json();
    const signature = taskTraceSignature(trace);
    if (signature !== openedTaskTraceSignature) {
      const scrollTop = window.scrollY;
      if (trace.traceKind === "CODING") renderCodingTrace(trace, summary);
      else if (trace.traceKind === "TASK") renderTaskTrace(trace);
      else throw new Error(`未知 Trace 类型：${String(trace.traceKind)}`);
      openedTaskTraceSignature = signature;
      if (!resetScroll) window.requestAnimationFrame(() => window.scrollTo({ top: scrollTop, behavior: "instant" }));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements.detail.innerHTML = `
      <span class="detail-id">轨迹暂不可用</span>
      <h2 class="detail-title">暂时无法读取任务详情</h2>
      <p class="error-box">${escapeHtml(message)}</p>
      <p class="trace-note"><strong>下一步：</strong>确认 Moye 服务与 Restate Ingress 正常，然后点击“刷新投影”重试。任务状态不会因此改变。</p>`;
  } finally {
    taskDetailRefreshInFlight = false;
  }
}

function taskTraceSignature(trace) {
  if (trace.traceKind === "CODING") {
    return JSON.stringify([
      trace.task.state,
      trace.task.currentStep,
      trace.task.archiveStatus,
      trace.task.outcome,
      trace.task.specRevision,
      trace.business.events.length,
      trace.stateMachine.executions.map(item => [item.id, item.state, item.sessionId]),
      (trace.roles || []).map(item => [item.runId, item.outcome, item.verdict]),
      (trace.agents || []).map(item => [item.runId, item.outcome]),
      (trace.reviews || []).map(item => [item.runId, item.outcome, item.verdict]),
    ]);
  }
  return JSON.stringify([
    trace.task.state,
    trace.task.currentStep,
    trace.task.archiveStatus,
    trace.task.events.length,
    trace.task.attempt,
  ]);
}

function renderTaskDetailHeader(task, title, facts = []) {
  elements.detailKicker.textContent = `${task.taskId} · 规格版本 R${task.specRevision}`;
  elements.detailTitle.textContent = title || task.taskId;
  elements.detailMeta.innerHTML = facts.map(([label, value, tone = "neutral"]) => `
    <span class="detail-meta-item tone-${escapeHtml(tone)}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || "—")}</strong></span>`).join("");
}

function renderTaskTrace(trace) {
  const task = trace.task;
  renderTaskDetailHeader(task, task.title, [
    ["状态", taskStateLabel(task.state), task.state === "CLOSED" ? "success" : "progress"],
    ["归档", archiveStatusLabel(task.archiveStatus), task.archiveStatus === "ARCHIVED" ? "success" : "neutral"],
    ["Workflow", `TaskWorkflow/${task.taskId}`],
    ["Attempt", String(task.attempt)],
  ]);
  elements.detail.innerHTML = `
    <section class="task-workspace-summary" aria-label="TaskWorkflow 摘要">
      <div><span class="workspace-summary-mark" aria-hidden="true">T</span><p><strong>TaskWorkflow 业务聚合</strong><small>只展示 Runtime Projection 与 Event 证明的事实，不补画 Coding Agent、Worktree 或 Git 记录。</small></p></div>
      <dl><div><dt>当前步骤</dt><dd>${escapeHtml(task.currentStep)}</dd></div><div><dt>需求来源</dt><dd>${task.backlogRefs.map(escapeHtml).join(", ") || "—"}</dd></div></dl>
    </section>
    ${renderStateMachine(trace.stateMachine, trace)}
    ${task.archivePath ? `<p class="result-ref"><span>归档结果</span><code>${escapeHtml(task.archivePath)}</code></p>` : ""}
    ${task.error ? `<p class="error-box">${escapeHtml(task.error)}</p>` : ""}
    ${renderDomainEventPanel(task.events, trace.stateMachine)}
    <div class="domain-event-runtime-link">
      ${trace.durableRuntime.invocationsUrl ? `<a class="runtime-link" href="${escapeAttribute(trace.durableRuntime.invocationsUrl)}" target="_blank" rel="noreferrer">在 Restate 中核对 Journal ↗</a>` : ""}
    </div>`;
  bindStateMachineGraph(trace.stateMachine, trace);
}

function renderCodingTrace(trace, summary) {
  closeAgentEventsDialog(false);
  const task = trace.task;
  const conclusion = task.archiveStatus === "ARCHIVED" && task.outcome === "FAILED_TERMINAL"
    ? { icon: "!", title: "任务已失败并归档", text: "失败事实、执行证据与归档回执均已固化；没有把失败伪装成成功。", tone: "danger" }
    : task.state === "CLOSED" && task.archiveStatus === "ARCHIVED"
      ? { icon: "✓", title: "任务已闭环", text: "编码、验证、合入、文档与归档证据均已确认。", tone: "success" }
    : task.state === "FAILED"
      ? { icon: "!", title: "任务已停止，需要处理", text: trace.recovery.summary, tone: "danger" }
      : { icon: "●", title: `任务正在${stepLabel(task.currentStep)}`, text: trace.recovery.summary, tone: "progress" };
  const workflowRef = `${trace.durableRuntime.workflowService}/${trace.durableRuntime.workflowKey}`;
  const sessionRef = trace.agent?.sessionId || "等待 Agent Session";
  const mergeRef = trace.git.mergeCommit ? shortSha(trace.git.mergeCommit) : "等待合入";
  const journey = PIPELINE_STAGES.map((definition, index) => renderJourneyStage(trace, definition, index)).join("");
  const artifacts = trace.technical.artifacts.map(artifact => `
    <li><span>${escapeHtml(artifact.kind)}</span><code>${escapeHtml(artifact.artifactRef)}</code><small>${escapeHtml(shortDigest(artifact.contentDigest))}${artifact.bytes === undefined ? "" : ` · ${artifact.bytes} B`}</small>${artifact.downloadUrl ? `<a href="${escapeAttribute(artifact.downloadUrl)}" target="_blank" rel="noreferrer">${artifact.kind === "agent-events" ? "下载原始 JSONL" : "打开 ↗"}</a>` : ""}</li>`).join("");
  const agentEvents = trace.agentEvents;
  const rawModelIo = trace.technical.artifacts.find(artifact => artifact.kind === "raw-model-io" && artifact.downloadUrl);
  const actions = trace.recovery.actions.map(action => `
    <li><strong>${escapeHtml(action.label)}</strong><span class="tag ${action.automatic ? "blue" : "yellow"}">${action.automatic ? "自动" : "人工"}</span><p>${escapeHtml(action.reason)}</p></li>`).join("");
  const roleSessions = (trace.roles || []).map(role => `
    <li><strong>${escapeHtml(role.kind)}</strong><code>${escapeHtml(role.sessionId || "无 Session ID")}</code><span>R${role.specRevision} · #${role.attempt} · ${escapeHtml(role.verdict || role.outcome)}</span><p>${escapeHtml(role.summary)}</p>${sessionEventsButton({
      eventsUrl: role.eventsUrl,
      kind: role.kind,
      binding: `R${role.specRevision} · Attempt #${role.attempt} · ${role.sessionId || "等待 Session"}`,
      runnerKind: role.runnerKind,
    })}</li>`).join("");
  const implementationSessions = (trace.agents || []).map(agent => `
    <li><strong>IMPLEMENTATION</strong><code>${escapeHtml(agent.sessionId || "无 Session ID")}</code><span>R${agent.specRevision} · ${escapeHtml(agent.attemptId)} · ${escapeHtml(agent.outcome)}</span>${sessionEventsButton({
      eventsUrl: agent.eventsUrl,
      kind: "IMPLEMENTATION",
      binding: `R${agent.specRevision} · ${agent.attemptId} · ${agent.sessionId || "等待 Session"}`,
      runnerKind: agent.runnerKind,
    })}</li>`).join("");
  const reviewSessions = (trace.reviews || []).map(review => `
    <li><strong>INDEPENDENT_REVIEW</strong><code>${escapeHtml(review.sessionId || "无 Session ID")}</code><span>#${review.attempt} · ${escapeHtml(review.verdict || review.outcome)}</span><p>${escapeHtml(review.summary)}</p>${sessionEventsButton({
      eventsUrl: review.eventsUrl,
      kind: "INDEPENDENT_REVIEW",
      binding: `Attempt #${review.attempt} · ${review.sessionId || "等待 Session"}`,
      runnerKind: review.runnerKind,
    })}</li>`).join("");

  renderTaskDetailHeader(task, summary.title || task.taskId, [
    ["状态", taskStateLabel(task.state), task.state === "CLOSED" ? "success" : task.state === "FAILED" ? "danger" : "progress"],
    ["归档", archiveStatusLabel(task.archiveStatus), task.archiveStatus === "ARCHIVED" ? "success" : "neutral"],
    ["Workflow", workflowRef],
    ["Session", sessionRef],
    ["Commit", mergeRef],
  ]);
  elements.detail.innerHTML = `
    <section class="task-workspace-summary tone-${conclusion.tone}" aria-label="任务结论">
      <div><span class="workspace-summary-mark" aria-hidden="true">${conclusion.icon}</span><p><strong>${escapeHtml(conclusion.title)}</strong><small>${escapeHtml(conclusion.text)}</small></p></div>
      <dl><div><dt>当前阶段</dt><dd>${escapeHtml(stepLabel(task.currentStep))}</dd></div><div><dt>执行者</dt><dd>${escapeHtml(runnerLabel(trace.agent?.runnerKind))}</dd></div></dl>
      ${agentEvents ? `<button type="button" class="workspace-events-trigger" data-agent-events-trigger data-agent-events-url="${escapeAttribute(agentEvents.viewUrl)}" data-agent-events-download-url="${escapeAttribute(agentEvents.downloadUrl || agentEvents.viewUrl)}" data-agent-events-kind="IMPLEMENTATION" data-agent-events-binding="${escapeHtml(`${agentEvents.attemptId || "等待 Attempt"} · ${runnerLabel(agentEvents.runnerKind)}`)}" data-agent-events-runner="${escapeHtml(agentEvents.runnerKind)}" aria-controls="agent-events-dialog" aria-haspopup="dialog" aria-expanded="false">查看完整对话</button>` : ""}
    </section>
    ${task.error ? `<p class="error-box"><strong>失败原因：</strong>${escapeHtml(task.error)}<br><span>下一步：${escapeHtml(trace.recovery.summary)}</span></p>` : ""}

    ${renderStateMachine(trace.stateMachine, trace)}

    <details class="task-evidence-panel">
      <summary><span>执行证据与角色会话</span><small>${PIPELINE_STAGES.length} 个阶段 · ${(trace.roles || []).length + (trace.reviews || []).length + (trace.agent ? 1 : 0)} 个真实执行会话</small></summary>
      <div class="task-evidence-content">
        <div class="correlation-strip" aria-label="任务关联链">
          ${correlationNode("任务", task.taskId)}<span aria-hidden="true">→</span>
          ${correlationNode("工作流", workflowRef)}<span aria-hidden="true">→</span>
          ${correlationNode("Agent 会话", sessionRef)}<span aria-hidden="true">→</span>
          ${correlationNode("合入提交", mergeRef)}
        </div>
        <section class="diagnostic-actions" aria-label="诊断入口">
      <div><small>Trace ID</small><code>${escapeHtml(trace.observability.traceId)}</code></div>
      ${trace.observability.enabled && trace.observability.uiBaseUrl
        ? `<a href="${escapeAttribute(trace.observability.uiBaseUrl)}" target="_blank" rel="noreferrer">打开 Trace（Phoenix）↗</a>`
        : `<span class="diagnostic-disabled">Trace 后端未启用</span>`}
      ${rawModelIo ? `<a class="sensitive-link" href="${escapeAttribute(rawModelIo.downloadUrl)}" target="_blank" rel="noreferrer">查看 Raw Model IO（敏感）↗</a>` : ""}
        </section>
        <p class="trace-note">Trace 与 JSONL 只用于诊断；任务状态以 Moye Projection / Domain Event 为准，中断恢复以 Restate Journal 为准。</p>

        <section class="journey-section" aria-labelledby="journey-title">
      <div class="trace-heading"><div><p class="eyebrow">Step / Attempt Evidence</p><h3 id="journey-title">按阶段核对 Attempt 与 Evidence</h3></div><span>状态由上方 Event History 证明</span></div>
      <div class="journey">${journey}</div>
        </section>

        <section class="journey-section" aria-label="真实角色会话">
      <div class="trace-heading"><div><p class="eyebrow">Role / Agent Sessions</p><h3>角色、会话、版本与结论</h3></div><span>${(trace.roles || []).length + (trace.reviews || []).length + (trace.agent ? 1 : 0)} 个真实执行会话</span></div>
      <ul class="action-list">${implementationSessions + roleSessions + reviewSessions || "<li>尚无角色会话</li>"}</ul>
        </section>
      </div>
    </details>

    ${renderDomainEventPanel(trace.business.events, trace.stateMachine)}

    <details class="advanced-panel">
      <summary><span>高级诊断</span><small>Restate Journal、恢复建议、Artifact 与原始事件</small></summary>
      <div class="advanced-content">
        <section>
          <div class="trace-heading"><div><p class="eyebrow">Restate 定位</p><h3>耐久执行与中断恢复</h3></div><span>执行证据</span></div>
          <p class="trace-note">Restate Journal 负责记录执行与重放；任务是否完成，以 Moye 的业务投影为准。</p>
          <code class="wide-code">${escapeHtml(trace.durableRuntime.workflowRef)}</code>
          ${trace.durableRuntime.invocationsUrl ? `<a class="runtime-link" href="${escapeAttribute(trace.durableRuntime.invocationsUrl)}" target="_blank" rel="noreferrer">在 Restate 中打开这个任务 ↗</a>` : ""}
        </section>
        <section class="recovery ${trace.recovery.classification === "NONE" ? "settled" : "attention"}">
          <div class="trace-heading"><div><p class="eyebrow">恢复判断</p><h3>${escapeHtml(recoveryLabel(trace.recovery.classification))}</h3></div><span>只读建议</span></div>
          <p>${escapeHtml(trace.recovery.summary)}</p>
          ${actions ? `<ul class="action-list">${actions}</ul>` : ""}
        </section>
        <section>
          <p class="subheading">技术 Artifact</p>
          <ul class="artifact-list">${artifacts || "<li>尚无技术 Artifact</li>"}</ul>
        </section>
      </div>
    </details>`;

  bindStateMachineGraph(trace.stateMachine, trace);
  bindAgentEventsDialog(trace);
}

function renderDomainEventPanel(events, machine) {
  const historyBySequence = new Map(machine.history.map(item => [item.sequence, item]));
  const rows = events.map(event => {
    const transition = historyBySequence.get(event.sequence);
    const transitionLabel = transition
      ? `${transition.from} → ${transition.to}`
      : event.step ? stepLabel(event.step) : "业务事实已记录";
    const detail = event.detail || transition?.detail;
    return `<li class="domain-event-row">
      <span class="domain-event-sequence">#${String(event.sequence).padStart(2, "0")}</span>
      <div class="domain-event-body">
        <div class="domain-event-heading"><strong>${escapeHtml(transitionLabel)}</strong><time datetime="${escapeAttribute(event.at)}">${formatTime(event.at)}</time></div>
        <div class="domain-event-meta"><span>${escapeHtml(event.type)}</span>${transition?.kind ? `<em>${escapeHtml(transition.kind)}</em>` : ""}</div>
        ${detail ? `<code class="domain-event-detail">${escapeHtml(detail)}</code>` : ""}
      </div>
    </li>`;
  }).join("");
  return `<details class="domain-events-panel">
    <summary><span><strong>完整 Domain Event 记录</strong><small>Workflow 写入的 ${events.length} 条业务事实</small></span><em>按 sequence 展开</em></summary>
    <div class="domain-events-intro"><strong>这是状态事实，不是 Agent 对话。</strong><p>每一行来自 Runtime Event；状态转换只在 History 有同 sequence 证据时显示。Agent 的聊天、工具调用和工具结果仍在 Agent Events 中查看。</p></div>
    <ol class="domain-event-timeline">${rows || "<li class=\"domain-event-empty\">尚无 Domain Event。</li>"}</ol>
  </details>`;
}

function renderStateMachine(machine, trace) {
  const transitions = machine.history.map(item => `
    <li class="machine-transition domain-${item.domain.toLowerCase()}">
      <span class="sequence">${String(item.sequence).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(item.from)} <i aria-hidden="true">→</i> ${escapeHtml(item.to)}</strong><small>${escapeHtml(item.eventType)} · ${formatTime(item.at)}</small>${item.detail ? `<code>${escapeHtml(shortDigest(item.detail))}</code>` : ""}</div>
    </li>`).join("");
  const edges = machine.definition.edges.map(item => `
    <li class="machine-edge kind-${item.kind.toLowerCase()} ${item.traversed ? "traversed" : ""}">
      <code>${escapeHtml(item.from)} → ${escapeHtml(item.to)}</code><span>${escapeHtml(machineEdgeLabel(item.kind))}</span><small>${escapeHtml(item.label)}</small>
    </li>`).join("");
  const executions = machine.executions.map(item => `
    <li class="machine-execution">
      <div><span class="tag ${executionColor(item.state)}">${escapeHtml(executionKindLabel(item.kind))}</span><strong>${escapeHtml(item.step)}${item.generation === undefined ? "" : ` · G${item.generation}`}</strong><em>${escapeHtml(item.state)}</em></div>
      <code>${escapeHtml(item.id)}</code>
      ${item.attemptId ? `<small>Attempt ${escapeHtml(item.attemptId)}</small>` : ""}
      ${item.sessionId ? `<small>Session ${escapeHtml(item.sessionId)}</small>` : ""}
      ${item.producer ? `<small>Producer ${escapeHtml(item.producer)}</small>` : ""}
      ${item.evidenceDigests.length ? `<small>Evidence ${item.evidenceDigests.map(value => escapeHtml(shortDigest(value))).join(" · ")}</small>` : ""}
    </li>`).join("");
  return `<section class="state-machine-section" data-machine-graph aria-labelledby="state-machine-title">
    <div class="trace-heading"><div><p class="eyebrow">Runtime State Machine</p><h3 id="state-machine-title">合法转换与本次实际路径</h3></div><span class="machine-integrity ${machine.current.consistency.toLowerCase()}">${machine.current.consistency === "VERIFIED" ? "Event / Projection 一致" : "Event / Projection 不一致"}</span></div>
    <p class="trace-note">Graph 直接消费 Runtime Definition、Event History 与 Execution Evidence。粗实线是本次实际路径；虚线是合法但未发生的 Repair、Replan、Reconcile、失败与 Archive 分支。页面不能写状态。</p>
    <div class="machine-current">
      <div><span>业务状态</span><strong>${escapeHtml(machine.current.business)}</strong></div>
      <div><span>Archive 状态</span><strong>${escapeHtml(machine.current.archive)}</strong></div>
      <div><span>整体落点</span><strong>${escapeHtml(machine.current.overall)}</strong></div>
      <div><span>Event 重建</span><strong>${escapeHtml(machine.current.historyCurrent)}</strong></div>
    </div>
    ${renderMachineGraphCanvas(machine, transitions, trace)}
    <details class="machine-evidence-panel"><summary><span>执行实例 · ${machine.executions.length} 个</span><small>Attempt、Agent Run、Verification、Session 与 Evidence</small></summary><div class="machine-executions"><ul>${executions || "<li>这个 Workflow 没有 Agent/Attempt 执行实例。</li>"}</ul></div></details>
    <details class="machine-definition"><summary><span>查看完整合法边</span><small>实线标记本次已走过；Repair/Failure/Archive 分支不会隐藏</small></summary><ul>${edges}</ul></details>
  </section>`;
}

const MACHINE_GRAPH_SIZE = { width: 1640, height: 760 };
const CODING_GRAPH_POSITIONS = {
  START: [30, 195], CONTEXT: [185, 195], WORKSPACE: [340, 195], IMPLEMENT: [495, 195],
  SELF_REVIEW: [650, 195], VERIFY: [805, 195], REVIEW: [960, 195], MERGE: [1115, 195],
  DOCS: [1270, 195], CLOSED: [1425, 195], REPLAN: [805, 35], WAITING_RECONCILE: [690, 440],
  FAILED: [1080, 605], ARCHIVING: [1430, 405], ARCHIVED: [1430, 535], ARCHIVE_FAILED: [1260, 665],
};
const TASK_GRAPH_POSITIONS = {
  START: [55, 195], RECEIVED: [260, 195], EXECUTING: [465, 195], VERIFYING: [670, 195], CLOSED: [875, 195],
  ARCHIVE_PENDING: [1090, 405], ARCHIVED: [1350, 405], ARCHIVE_FAILED: [1350, 605],
};

function renderMachineGraphCanvas(machine, transitions) {
  const positions = machineGraphPositions(machine);
  const traversedCount = machine.definition.edges.filter(edge => edge.traversed).length;
  const filter = (id, label, count) => `<button type="button" data-machine-filter="${id}" aria-pressed="${machineGraphUiState.filter === id}">${label}<span>${count}</span></button>`;
  const edges = machine.definition.edges.map((edge, index) => renderMachineGraphEdge(edge, index, positions, machine)).join("");
  const nodes = machine.definition.nodes.map(node => renderMachineGraphNode(node, positions.get(node.id))).join("");
  return `<div class="machine-graph-shell">
    <div class="machine-graph-toolbar">
      <div class="machine-graph-filters" role="group" aria-label="状态机路径筛选">
        ${filter("ALL", "全部流程", machine.definition.edges.length)}
        ${filter("ACTUAL", "本次点亮", traversedCount)}
        ${filter("NORMAL", "主流程", machine.definition.edges.filter(edge => edge.kind === "NORMAL").length)}
        ${filter("REPAIR", "恢复 / 回滚", machine.definition.edges.filter(edge => edge.kind === "REPAIR").length)}
        ${filter("FAILURE", "异常 / 失败", machine.definition.edges.filter(edge => edge.kind === "FAILURE").length)}
        ${filter("ARCHIVE", "归档", machine.definition.edges.filter(edge => edge.kind === "ARCHIVE").length)}
      </div>
      <div class="machine-graph-zoom" role="group" aria-label="画布缩放">
        <button type="button" data-machine-zoom="out" aria-label="缩小状态机画布">−</button>
        <output data-machine-zoom-label>${Math.round((machineGraphUiState.zoom ?? 1) * 100)}%</output>
        <button type="button" data-machine-zoom="in" aria-label="放大状态机画布">＋</button>
        <button type="button" data-machine-zoom="fit">适配</button>
      </div>
    </div>
    <div class="machine-graph-legend" aria-label="状态机图例">
      <span class="legend-actual">实际经过</span><span class="legend-normal">合法主路径</span><span class="legend-repair">Repair / Replan / 恢复</span><span class="legend-failure">异常 / Reconcile / 失败</span><span class="legend-archive">Archive</span>
    </div>
    <div class="machine-graph-stage" data-machine-graph-stage data-inspector-open="${machineGraphUiState.inspectorOpen}">
      <div class="machine-graph-scroll" data-machine-graph-scroll tabindex="0" aria-label="完整状态机 Graph 画布，可横向滚动">
        <svg class="machine-graph-svg" data-machine-svg viewBox="0 0 ${MACHINE_GRAPH_SIZE.width} ${MACHINE_GRAPH_SIZE.height}" width="${MACHINE_GRAPH_SIZE.width}" height="${MACHINE_GRAPH_SIZE.height}" role="img" aria-labelledby="machine-graph-svg-title machine-graph-svg-desc">
        <title id="machine-graph-svg-title">${escapeHtml(machine.workflow)} 完整状态机</title>
        <desc id="machine-graph-svg-desc">包含 ${machine.definition.nodes.length} 个状态和 ${machine.definition.edges.length} 条合法转换；本次实际经过 ${traversedCount} 条。</desc>
        <defs>
          <marker id="machine-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker>
          <filter id="machine-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <g class="machine-graph-lanes" aria-hidden="true">
          <rect x="18" y="130" width="1535" height="155" rx="18" class="lane-business"/><text x="40" y="158">BUSINESS / HAPPY PATH</text>
          <rect x="18" y="330" width="1215" height="410" rx="18" class="lane-recovery"/><text x="40" y="360">RECOVERY / EXCEPTION</text>
          <rect x="1250" y="330" width="303" height="410" rx="18" class="lane-archive"/><text x="1275" y="360">ARCHIVE</text>
        </g>
        <g class="machine-graph-edges">${edges}</g>
        <g class="machine-graph-nodes">${nodes}</g>
        </svg>
      </div>
      <aside class="machine-graph-inspector" data-machine-inspector aria-label="节点详情" aria-live="polite"${machineGraphUiState.inspectorOpen ? "" : " hidden"}></aside>
    </div>
    <details class="machine-history-drawer"><summary><span><strong>实际路径 · ${machine.history.length} 条</strong><small>${escapeHtml(machine.history[0]?.from || machine.current.overall)} → ${escapeHtml(machine.current.historyCurrent)}</small></span><em>展开文本事实</em></summary><div class="machine-history"><ol>${transitions || "<li>尚无可还原的状态转换</li>"}</ol></div></details>
  </div>`;
}

function machineGraphPositions(machine) {
  const source = machine.workflow === "CodingTaskWorkflow" ? CODING_GRAPH_POSITIONS : TASK_GRAPH_POSITIONS;
  const positions = new Map();
  let fallback = 0;
  machine.definition.nodes.forEach(node => {
    const position = source[node.id] || [80 + (fallback % 8) * 180, 500 + Math.floor(fallback / 8) * 105];
    positions.set(node.id, position);
    if (!source[node.id]) fallback += 1;
  });
  return positions;
}

function renderMachineGraphNode(node, position = [40, 600]) {
  const [x, y] = position;
  const state = node.status === "CURRENT" ? "当前状态" : node.status === "VISITED" ? "实际经过" : "尚未经过";
  return `<foreignObject x="${x}" y="${y}" width="136" height="84">
    <button xmlns="http://www.w3.org/1999/xhtml" type="button" class="machine-graph-node status-${node.status.toLowerCase()} domain-${node.domain.toLowerCase()} ${node.terminal ? "terminal" : ""}" data-machine-node="${escapeHtml(node.id)}" aria-label="${escapeHtml(`${node.label}，${state}`)}" aria-pressed="false">
      <small>${escapeHtml(node.id)}</small><strong>${escapeHtml(node.label)}</strong><span>${state}</span>
    </button>
  </foreignObject>`;
}

function renderMachineGraphEdge(edge, index, positions, machine) {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return "";
  const path = machineGraphEdgePath(edge, from, to, index);
  const transition = machine.history.find(item => item.from === edge.from && item.to === edge.to);
  const marker = edge.traversed ? "machine-arrow" : "machine-arrow";
  const labelPosition = machineGraphEdgeLabelPosition(from, to, edge);
  return `<g class="machine-graph-edge-group kind-${edge.kind.toLowerCase()} ${edge.traversed ? "traversed" : ""}" data-machine-edge-kind="${edge.kind}" data-machine-edge-traversed="${edge.traversed}">
    <path d="${path}" class="machine-graph-edge" marker-end="url(#${marker})"><title>${escapeHtml(`${edge.from} → ${edge.to} · ${edge.label}${edge.traversed ? " · 本次实际经过" : ""}`)}</title></path>
    ${edge.traversed ? `<g class="machine-edge-proof" transform="translate(${labelPosition[0]} ${labelPosition[1]})" role="img" aria-label="本次经过，事件序号 ${transition?.sequence ?? "未知"}"><rect x="-21" y="-12" width="42" height="24" rx="12"/><text text-anchor="middle" dominant-baseline="central">#${transition?.sequence ?? "✓"}</text></g>` : ""}
  </g>`;
}

function machineGraphEdgePath(edge, fromPosition, toPosition, index) {
  const from = graphNodeCenter(fromPosition);
  const to = graphNodeCenter(toPosition);
  const endpoints = graphEdgeEndpoints(from, to);
  const [sx, sy, tx, ty] = endpoints;
  if (edge.to === "FAILED") {
    const bend = 510 + (index % 5) * 12;
    return `M ${sx} ${sy} C ${sx} ${bend}, ${tx - 150} ${ty}, ${tx} ${ty}`;
  }
  if (edge.to === "WAITING_RECONCILE") {
    return `M ${sx} ${sy} C ${sx} ${sy + 115}, ${tx} ${ty - 115}, ${tx} ${ty}`;
  }
  if (edge.from === "WAITING_RECONCILE") {
    return `M ${sx} ${sy} C ${sx} ${sy - 105}, ${tx} ${ty + 150}, ${tx} ${ty}`;
  }
  if (edge.kind === "REPAIR" || tx < sx || Math.abs(tx - sx) > 220) {
    const lift = Math.min(sy, ty) - (edge.kind === "REPAIR" ? 75 : 55) - (index % 3) * 12;
    return `M ${sx} ${sy} C ${sx} ${lift}, ${tx} ${lift}, ${tx} ${ty}`;
  }
  return `M ${sx} ${sy} C ${(sx + tx) / 2} ${sy}, ${(sx + tx) / 2} ${ty}, ${tx} ${ty}`;
}

function graphNodeCenter([x, y]) {
  return [x + 68, y + 42];
}

function graphEdgeEndpoints([fx, fy], [tx, ty]) {
  const dx = tx - fx;
  const dy = ty - fy;
  const length = Math.max(1, Math.hypot(dx, dy));
  const xInset = Math.min(64, Math.abs(dx) / length * 68);
  const yInset = Math.min(38, Math.abs(dy) / length * 42);
  return [fx + Math.sign(dx) * xInset, fy + Math.sign(dy) * yInset, tx - Math.sign(dx) * xInset, ty - Math.sign(dy) * yInset];
}

function machineGraphEdgeLabelPosition(fromPosition, toPosition, edge) {
  const [fx, fy] = graphNodeCenter(fromPosition);
  const [tx, ty] = graphNodeCenter(toPosition);
  if (edge.to === "FAILED") return [(fx + tx) / 2, Math.max(fy, ty) - 24];
  if (edge.to === "WAITING_RECONCILE" || edge.from === "WAITING_RECONCILE") return [(fx + tx) / 2, (fy + ty) / 2];
  return [(fx + tx) / 2, (fy + ty) / 2 - 15];
}

function renderMachineNodeInspector(machine, nodeId, trace) {
  const node = machine.definition.nodes.find(item => item.id === nodeId) || machine.definition.nodes[0];
  if (!node) return "";
  const incoming = machine.definition.edges.filter(edge => edge.to === node.id);
  const outgoing = machine.definition.edges.filter(edge => edge.from === node.id);
  const history = machine.history.filter(item => item.from === node.id || item.to === node.id);
  const executions = machine.executions.filter(item => machineExecutionBelongsToNode(item, node.id));
  const agentExecutions = executions.filter(item => machineSessionForExecution(item, trace));
  const technicalExecutions = executions.filter(item => !machineSessionForExecution(item, trace));
  const edgeItems = (items, direction) => items.map(edge => renderMachineTransitionRow(edge, direction, machine)).join("");
  return `<header><div><span>${escapeHtml(node.domain)} · ${node.terminal ? "终态" : "可转换状态"}</span><h4>${escapeHtml(node.label)}</h4><code>${escapeHtml(node.id)}</code></div><div class="machine-inspector-actions"><strong class="status-${node.status.toLowerCase()}">${node.status === "CURRENT" ? "当前" : node.status === "VISITED" ? "已进入" : "未进入"}</strong><button type="button" data-machine-inspector-close aria-label="关闭节点详情">关闭详情</button></div></header>
    <div class="machine-inspector-counts" aria-label="节点事实计数"><span><strong>${agentExecutions.length}</strong> Agent</span><span><strong>${history.length}</strong> 状态记录</span><span><strong>${executions.length}</strong> 执行实例</span></div>
    ${agentExecutions.length ? `<section class="machine-node-section machine-node-agent-section"><div class="machine-node-section-heading"><p class="machine-node-section-kicker">Agent activity</p><h5>Agent 活动</h5><p>来自这个节点实际 Run / Session 的对话、工具调用、工具结果、系统和错误事件。</p></div><div class="machine-agent-activities">${agentExecutions.map(item => renderMachineAgentActivity(item, trace)).join("")}</div></section>` : ""}
    ${history.length ? `<section class="machine-node-section"><div class="machine-node-section-heading"><p class="machine-node-section-kicker">Workflow facts</p><h5>状态流转记录</h5><p><strong>Domain Event</strong> 是 Workflow 写入的业务事实，只证明这个状态如何进入和离开；它不是 Agent 的聊天或工具日志。</p></div><ol class="machine-node-events">${history.map(item => `<li><span class="sequence">#${String(item.sequence).padStart(2, "0")}</span><div><strong>${escapeHtml(item.from)} → ${escapeHtml(item.to)}</strong><small>${escapeHtml(item.eventType)} · ${formatTime(item.at)}</small>${item.detail ? `<code>${escapeHtml(shortDigest(item.detail))}</code>` : ""}</div></li>`).join("")}</ol></section>` : `<p class="machine-node-empty"><strong>本次运行没有进入这个状态。</strong><span>只展示代码允许的合法转换，不会虚构 Agent、Session、Attempt 或 Evidence。</span></p>`}
    ${renderMachineControlFacts(trace, node.id)}
    ${technicalExecutions.length ? `<details class="machine-node-technical"><summary>执行 ID 与 Evidence <span>${technicalExecutions.length}</span></summary><div class="machine-node-executions">${technicalExecutions.map(item => renderMachineExecutionDetail(item, trace)).join("")}</div></details>` : ""}
    <details class="machine-node-transitions"><summary><span>合法转换</span><small>进入 ${incoming.length} · 离开 ${outgoing.length}</small></summary><p class="machine-transition-help">这里列出代码允许的路径；“本次经过”必须有 Workflow Event 证明。</p><div class="machine-transition-groups">
      <section><header><span>进入</span><strong>${incoming.length}</strong></header><ol>${edgeItems(incoming, "in") || '<li class="machine-transition-empty">这是起始状态，没有合法进入路径。</li>'}</ol></section>
      <section><header><span>离开</span><strong>${outgoing.length}</strong></header><ol>${edgeItems(outgoing, "out") || '<li class="machine-transition-empty">这是终止状态，没有合法离开路径。</li>'}</ol></section>
    </div></details>`;
}

function renderMachineTransitionRow(edge, direction, machine) {
  const transition = machine.history.find(item => item.from === edge.from && item.to === edge.to);
  const state = edge.traversed ? `本次经过 · #${transition?.sequence ?? "?"}` : "合法但未发生";
  return `<li class="machine-transition-row kind-${edge.kind.toLowerCase()} ${edge.traversed ? "traversed" : ""}">
    <div class="machine-transition-route"><code>${escapeHtml(edge.from)}</code><span aria-hidden="true">→</span><code>${escapeHtml(edge.to)}</code></div>
    <div class="machine-transition-meta"><span class="machine-transition-kind">${escapeHtml(machineEdgeLabel(edge.kind))}</span><strong>${state}</strong></div>
    <p>${escapeHtml(edge.label)}</p>
  </li>`;
}

function machineSessionForExecution(execution, trace) {
  return trace?.agents?.find(item => item.runId === execution.id)
    || trace?.roles?.find(item => item.runId === execution.id)
    || trace?.reviews?.find(item => item.runId === execution.id);
}

function renderMachineAgentActivity(execution, trace) {
  const session = machineSessionForExecution(execution, trace);
  if (!session) return "";
  const role = trace?.roles?.find(item => item.runId === execution.id);
  const review = trace?.reviews?.find(item => item.runId === execution.id);
  const kind = role?.kind || (review ? "INDEPENDENT_REVIEW" : "IMPLEMENTATION");
  const verdict = role?.verdict || review?.verdict;
  const findings = review ? `${review.findingCount} Finding · ${review.blockingFindingCount} Blocking` : role ? `${role.findingCount} Finding` : "";
  const summary = role?.summary || review?.summary;
  const eventButton = sessionEventsButton({
    eventsUrl: session.eventsUrl,
    kind,
    binding: `${execution.attemptId || execution.id} · ${execution.sessionId || "等待 Session"}`,
    runnerKind: execution.producer || session.runnerKind,
    label: "查看全部 Agent Events",
  });
  return `<article class="machine-agent-activity">
    <header><div><span class="machine-agent-mark" aria-hidden="true">A</span><div><small>${escapeHtml(roleLabel(kind))}</small><h6>${escapeHtml(runnerLabel(execution.producer || session.runnerKind))}</h6></div></div><strong class="state-${executionColor(execution.state)}">${escapeHtml(execution.state)}</strong></header>
    <div class="machine-agent-glance"><span>Session <code>${escapeHtml(execution.sessionId || "等待建立")}</code></span>${execution.startedAt ? `<span>${formatDuration(execution.startedAt, execution.finishedAt)}</span>` : ""}${execution.generation === undefined ? "" : `<span>Generation ${execution.generation}</span>`}${verdict ? `<span>${escapeHtml(verdict)}</span>` : ""}</div>
    ${summary ? `<p class="machine-agent-summary">${escapeHtml(summary)}</p>` : ""}
    ${findings ? `<p class="machine-agent-findings">${escapeHtml(findings)}</p>` : ""}
    <div class="machine-agent-primary-action">${eventButton}</div>
    ${session.eventsUrl ? `<div class="machine-agent-preview" data-machine-agent-preview data-events-url="${escapeAttribute(session.eventsUrl)}" aria-live="polite"><div class="machine-agent-preview-loading">正在读取这个 Session 的真实 Agent Events…</div></div>` : ""}
    <details class="machine-agent-technical"><summary>Run、Attempt 与 Evidence</summary>${renderMachineExecutionTechnical(execution, trace)}</details>
  </article>`;
}

function renderMachineExecutionTechnical(execution, trace) {
  const attempt = trace?.business?.attempts?.find(item => item.attemptId === (execution.attemptId || execution.id));
  const evidence = attempt?.evidenceRecords || [];
  return `<dl class="machine-node-facts">
    <div><dt>Run ID</dt><dd><code>${escapeHtml(execution.id)}</code></dd></div>
    ${execution.attemptId ? `<div><dt>Attempt</dt><dd><code>${escapeHtml(execution.attemptId)}</code></dd></div>` : ""}
    ${attempt?.specRevision === undefined ? "" : `<div><dt>证据绑定</dt><dd>R${attempt.specRevision} · G${attempt.generation}</dd></div>`}
  </dl>${(evidence.length || execution.evidenceDigests.length) ? `<ul class="machine-agent-evidence">${evidence.length ? evidence.map(record => `<li><strong>${escapeHtml(record.artifactName)}</strong><code>${escapeHtml(record.artifactRef)}</code><small>${escapeHtml(record.contentDigest)}</small></li>`).join("") : execution.evidenceDigests.map(digest => `<li><code>${escapeHtml(digest)}</code></li>`).join("")}</ul>` : ""}`;
}

function machineExecutionBelongsToNode(execution, nodeId) {
  if (execution.step === nodeId) return true;
  if (nodeId === "DOCS" && execution.step === "DOCS_GATE") return true;
  if (nodeId === "ARCHIVING" && execution.step === "ARCHIVE") return true;
  return false;
}

function renderMachineExecutionDetail(execution, trace) {
  const attempt = trace?.business?.attempts?.find(item => item.attemptId === (execution.attemptId || execution.id));
  const evidence = attempt?.evidenceRecords || [];
  return `<article class="machine-node-execution">
    <div class="machine-node-execution-heading"><span class="tag ${executionColor(execution.state)}">${escapeHtml(executionKindLabel(execution.kind))}</span><strong>${escapeHtml(execution.state)}</strong>${execution.generation === undefined ? "" : `<em>Generation ${execution.generation}</em>`}</div>
    <dl class="machine-node-facts">
      <div><dt>${execution.attemptId ? "Run ID" : "执行 ID"}</dt><dd><code>${escapeHtml(execution.id)}</code></dd></div>
      ${execution.attemptId ? `<div><dt>Attempt</dt><dd><code>${escapeHtml(execution.attemptId)}</code></dd></div>` : ""}
      ${execution.producer ? `<div><dt>执行者</dt><dd>${escapeHtml(runnerLabel(execution.producer))}</dd></div>` : ""}
      ${execution.sessionId ? `<div><dt>Session</dt><dd><code>${escapeHtml(execution.sessionId)}</code></dd></div>` : ""}
      ${execution.startedAt ? `<div><dt>开始</dt><dd>${formatTime(execution.startedAt)}</dd></div><div><dt>耗时</dt><dd>${formatDuration(execution.startedAt, execution.finishedAt)}</dd></div>` : ""}
      ${attempt?.specRevision === undefined ? "" : `<div><dt>证据绑定</dt><dd>R${attempt.specRevision} · G${attempt.generation}</dd></div>`}
    </dl>
    ${(evidence.length || execution.evidenceDigests.length) ? `<details class="machine-node-evidence"><summary>Evidence · ${evidence.length || execution.evidenceDigests.length} 项</summary>${evidence.length ? `<ul>${evidence.map(record => `<li><strong>${escapeHtml(record.artifactName)}</strong><code>${escapeHtml(record.artifactRef)}</code><small>${escapeHtml(record.contentDigest)}</small></li>`).join("")}</ul>` : `<ul>${execution.evidenceDigests.map(digest => `<li><code>${escapeHtml(digest)}</code></li>`).join("")}</ul>`}</details>` : ""}
  </article>`;
}

function renderMachineControlFacts(trace, nodeId) {
  if (!trace) return "";
  const rows = [];
  const details = [];
  if (trace.durableRuntime?.workflowRef) rows.push(["Workflow", trace.durableRuntime.workflowRef, true]);
  if (nodeId === "CONTEXT") {
    rows.push(["规格版本", `R${trace.task.specRevision}`]);
    const latest = trace.specRevisions?.at(-1);
    if (latest?.envelopeDigest) rows.push(["Envelope", latest.envelopeDigest, true]);
  }
  if (nodeId === "WORKSPACE") {
    if (trace.git?.workspaceEffectId) rows.push(["Worktree Effect", trace.git.workspaceEffectId, true]);
    if (trace.git?.branch) rows.push(["任务分支", trace.git.branch, true]);
    if (trace.git?.baseCommit) rows.push(["Base Commit", trace.git.baseCommit, true]);
  }
  if (nodeId === "IMPLEMENT") {
    if (trace.git?.resultCommit) rows.push(["Result Commit", trace.git.resultCommit, true]);
    if (trace.git?.resultTree) rows.push(["Result Tree", trace.git.resultTree, true]);
    if (trace.agent) rows.push(["进程结果", `exit ${trace.agent.exitCode ?? "signal"}${trace.agent.signal ? ` · ${trace.agent.signal}` : ""}`]);
  }
  if (nodeId === "VERIFY" && trace.verification) {
    rows.push(["验证结论", trace.verification.passed ? "PASSED" : trace.verification.code || "FAILED"]);
    if (trace.verification.verifiedCommit) rows.push(["验证提交", trace.verification.verifiedCommit, true]);
    details.push(...trace.verification.commands.map(command => `<li><strong>${escapeHtml(command.commandId)}</strong><span>exit ${command.exitCode ?? command.signal ?? "unknown"} · ${command.durationMs} ms</span><code>stdout ${escapeHtml(shortDigest(command.stdoutDigest))}</code><code>stderr ${escapeHtml(shortDigest(command.stderrDigest))}</code></li>`));
  }
  if (nodeId === "MERGE") {
    if (trace.git?.mergeEffectId) rows.push(["Merge Effect", trace.git.mergeEffectId, true]);
    if (trace.git?.targetRef) rows.push(["Target Ref", trace.git.targetRef, true]);
    if (trace.git?.mergeCommit) rows.push(["Merge Commit", trace.git.mergeCommit, true]);
    if (trace.git?.reconciledAfterUnknown !== undefined) rows.push(["未知结果对账", trace.git.reconciledAfterUnknown ? "已通过 Git facts 对账" : "未触发"]);
  }
  if (["WAITING_RECONCILE", "FAILED"].includes(nodeId) && trace.recovery) {
    rows.push(["恢复分类", recoveryLabel(trace.recovery.classification)]);
    rows.push(["恢复判断", trace.recovery.summary]);
    details.push(...trace.recovery.actions.map(action => `<li><strong>${escapeHtml(action.label)}</strong><span>${action.automatic ? "自动" : "人工"} · ${escapeHtml(action.reason)}</span></li>`));
  }
  if (["CLOSED", "FAILED"].includes(nodeId)) {
    if (trace.task.outcome) rows.push(["业务 Outcome", trace.task.outcome]);
    if (trace.task.error) rows.push(["错误", trace.task.error]);
  }
  if (["ARCHIVING", "ARCHIVED", "ARCHIVE_FAILED"].includes(nodeId)) rows.push(["Archive 状态", trace.task.archiveStatus]);
  if (rows.length === 0 && details.length === 0) return "";
  return `<section class="machine-node-section machine-node-control"><div class="machine-node-section-heading"><p class="machine-node-section-kicker">Control plane</p><h5>系统控制与结果</h5><p>Workflow、Git、Verification、Recovery 与 Archive 对这个节点的约束和结果。</p></div><dl class="machine-node-facts">${rows.map(([label, value, code]) => `<div><dt>${escapeHtml(label)}</dt><dd>${code ? `<code>${escapeHtml(value)}</code>` : escapeHtml(value)}</dd></div>`).join("")}</dl>${details.length ? `<ul class="machine-node-control-list">${details.join("")}</ul>` : ""}</section>`;
}

function bindStateMachineGraph(machine, trace) {
  const section = elements.detail.querySelector("[data-machine-graph]");
  if (!(section instanceof HTMLElement)) return;
  const stage = section.querySelector("[data-machine-graph-stage]");
  const svg = section.querySelector("[data-machine-svg]");
  const scroll = section.querySelector("[data-machine-graph-scroll]");
  const inspector = section.querySelector("[data-machine-inspector]");
  if (!(stage instanceof HTMLElement) || !(svg instanceof SVGElement) || !(scroll instanceof HTMLElement) || !(inspector instanceof HTMLElement)) return;
  const nodeExists = machine.definition.nodes.some(node => node.id === machineGraphUiState.selectedId);
  if (!nodeExists) machineGraphUiState.selectedId = machine.definition.nodes.find(node => node.status === "CURRENT")?.id || machine.definition.nodes[0]?.id;

  const markSelectedNode = () => {
    section.querySelectorAll("[data-machine-node]").forEach(button => {
      button.setAttribute("aria-pressed", String(machineGraphUiState.inspectorOpen && button.dataset.machineNode === machineGraphUiState.selectedId));
    });
  };
  const setInspectorOpen = (open, moveFocus = false) => {
    machineGraphUiState.inspectorOpen = open;
    stage.dataset.inspectorOpen = String(open);
    inspector.hidden = !open;
    inspector.setAttribute("aria-hidden", String(!open));
    if (open) {
      inspector.innerHTML = renderMachineNodeInspector(machine, machineGraphUiState.selectedId, trace);
      if (trace?.traceKind === "CODING") {
        bindAgentEventsDialog(trace, inspector);
        bindMachineAgentEventPreviews(inspector);
      }
      const close = inspector.querySelector("[data-machine-inspector-close]");
      close?.addEventListener("click", () => setInspectorOpen(false, true));
      if (moveFocus && close instanceof HTMLButtonElement) window.requestAnimationFrame(() => close.focus());
    } else {
      inspector.replaceChildren();
      if (moveFocus) {
        const selected = section.querySelector(`[data-machine-node="${CSS.escape(machineGraphUiState.selectedId || "")}"]`);
        if (selected instanceof HTMLButtonElement) window.requestAnimationFrame(() => selected.focus());
      }
    }
    markSelectedNode();
  };
  const selectNode = nodeId => {
    if (!nodeId) return;
    machineGraphUiState.scrollLeft = scroll.scrollLeft;
    machineGraphUiState.scrollTop = scroll.scrollTop;
    machineGraphUiState.selectedId = nodeId;
    setInspectorOpen(true, true);
    window.requestAnimationFrame(() => stage.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    }));
  };
  section.querySelectorAll("[data-machine-node]").forEach(button => button.addEventListener("click", () => selectNode(button.dataset.machineNode)));
  closeMachineGraphInspector = restoreFocus => {
    if (!section.isConnected || !machineGraphUiState.inspectorOpen) return false;
    setInspectorOpen(false, restoreFocus);
    return true;
  };

  const applyFilter = filter => {
    machineGraphUiState.filter = filter;
    section.querySelectorAll("[data-machine-filter]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.machineFilter === filter)));
    section.querySelectorAll("[data-machine-edge-kind]").forEach(group => {
      const visible = filter === "ALL" || (filter === "ACTUAL" ? group.dataset.machineEdgeTraversed === "true" : group.dataset.machineEdgeKind === filter);
      group.toggleAttribute("hidden", !visible);
    });
  };
  section.querySelectorAll("[data-machine-filter]").forEach(button => button.addEventListener("click", () => applyFilter(button.dataset.machineFilter)));

  const applyZoom = value => {
    machineGraphUiState.zoom = Math.min(1.6, Math.max(.5, value));
    svg.style.width = `${MACHINE_GRAPH_SIZE.width * machineGraphUiState.zoom}px`;
    svg.style.height = `${MACHINE_GRAPH_SIZE.height * machineGraphUiState.zoom}px`;
    section.querySelector("[data-machine-zoom-label]").textContent = `${Math.round(machineGraphUiState.zoom * 100)}%`;
  };
  const fitZoom = () => Math.min(1, scroll.clientWidth / MACHINE_GRAPH_SIZE.width, scroll.clientHeight / MACHINE_GRAPH_SIZE.height);
  section.querySelectorAll("[data-machine-zoom]").forEach(button => button.addEventListener("click", () => {
    const action = button.dataset.machineZoom;
    if (action === "in") applyZoom(machineGraphUiState.zoom + .15);
    else if (action === "out") applyZoom(machineGraphUiState.zoom - .15);
    else applyZoom(fitZoom());
  }));

  applyFilter(machineGraphUiState.filter);
  applyZoom(machineGraphUiState.zoom ?? fitZoom());
  setInspectorOpen(machineGraphUiState.inspectorOpen, false);
  scroll.scrollLeft = machineGraphUiState.scrollLeft;
  scroll.scrollTop = machineGraphUiState.scrollTop;
  if (machineGraphUiState.scrollLeft === 0 && svg.clientWidth > scroll.clientWidth) {
    const current = section.querySelector(`[data-machine-node="${CSS.escape(machine.current.overall)}"]`)?.closest("foreignObject");
    const x = current instanceof SVGElement ? Number(current.getAttribute("x")) : 0;
    scroll.scrollLeft = Math.max(0, (x + 68) * machineGraphUiState.zoom - scroll.clientWidth / 2);
  }
  scroll.addEventListener("scroll", () => {
    machineGraphUiState.scrollLeft = scroll.scrollLeft;
    machineGraphUiState.scrollTop = scroll.scrollTop;
  }, { passive: true });
}

function machineEdgeLabel(kind) {
  return ({ NORMAL: "主路径", REPAIR: "Repair 回边", FAILURE: "失败分支", ARCHIVE: "归档分支" })[kind] || kind;
}

function executionKindLabel(kind) {
  return ({ STEP_ATTEMPT: "Step Attempt", AGENT_RUN: "Agent Run", ROLE_RUN: "Role Run", REVIEW_RUN: "Review Run", VERIFICATION: "Verification", BOOTSTRAP_EVIDENCE: "Bootstrap Evidence" })[kind] || kind;
}

function executionColor(state) {
  if (["SUCCEEDED", "PASSED", "ACCEPTED"].includes(state)) return "green";
  if (["FAILED", "FAILED_TERMINAL", "COMMAND_FAILED"].includes(state)) return "red";
  return "blue";
}

function sessionEventsButton({ eventsUrl, kind, binding, runnerKind, label = "在弹窗查看对话" }) {
  if (!eventsUrl) return '<span class="session-events-unavailable">Events 尚未就绪</span>';
  return `<button type="button" class="session-events-trigger" data-agent-events-trigger data-agent-events-url="${escapeAttribute(eventsUrl)}" data-agent-events-download-url="${escapeAttribute(eventsUrl)}" data-agent-events-kind="${escapeHtml(kind)}" data-agent-events-binding="${escapeHtml(`${binding} · ${runnerLabel(runnerKind)}`)}" data-agent-events-runner="${escapeHtml(runnerKind)}" aria-controls="agent-events-dialog" aria-haspopup="dialog" aria-expanded="false">${escapeHtml(label)}</button>`;
}

function bindMachineAgentEventPreviews(root) {
  root.querySelectorAll("[data-machine-agent-preview]").forEach(preview => {
    if (!(preview instanceof HTMLElement) || !preview.dataset.eventsUrl) return;
    const load = async () => {
      preview.innerHTML = '<div class="machine-agent-preview-loading" role="status">正在读取这个 Session 的真实 Agent Events…</div>';
      try {
        const source = new URL(preview.dataset.eventsUrl, window.location.origin);
        source.searchParams.set("cursor", "0");
        source.searchParams.set("limit", "200");
        const response = await fetch(source, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const page = await response.json();
        preview.innerHTML = renderMachineAgentEventPreview(page);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        preview.innerHTML = `<div class="machine-agent-preview-error"><p>Agent Events 预览读取失败：${escapeHtml(message)}</p><button type="button" data-machine-agent-preview-retry>重新读取</button></div>`;
        preview.querySelector("[data-machine-agent-preview-retry]")?.addEventListener("click", () => void load(), { once: true });
      }
    };
    void load();
  });
}

function renderMachineAgentEventPreview(page) {
  const events = Array.isArray(page.events) ? page.events : [];
  if (events.length === 0) return `<p class="machine-agent-preview-empty">${page.completed ? "这个 Session 没有输出 Agent Event。" : "Agent 已启动，正在等待第一条事件。"}</p>`;
  const categories = ["conversation", "tool", "tool_result", "system", "error"];
  const labels = { conversation: "对话", tool: "工具调用", tool_result: "工具结果", system: "系统", error: "错误" };
  const counts = categories.map(category => `<span><strong>${events.filter(event => event.category === category).length}</strong>${labels[category]}</span>`).join("");
  const latest = events.slice(-3).map(event => {
    const speaker = eventSpeaker(event);
    const summary = event.parsed === undefined ? "原始事件解析失败，完整文本仍保留在 Events 弹窗。" : eventSummary(event.parsed, event.type);
    return `<li><span class="machine-agent-event-mark" aria-hidden="true">${escapeHtml(speaker.mark)}</span><div><p><strong>${escapeHtml(speaker.label)}</strong><small>#${String(event.sequence).padStart(2, "0")} · ${escapeHtml(categoryLabel(event.category))}</small></p><span>${escapeHtml(summary)}</span></div></li>`;
  }).join("");
  const total = page.total ?? events.length;
  const previewLabel = events.length < total ? "当前预览末尾" : "最近活动";
  return `<div class="machine-agent-event-counts" aria-label="Agent Event 分类计数">${counts}</div><div class="machine-agent-preview-heading"><strong>${previewLabel}</strong><small>已读取 ${events.length} / ${total} 条${page.completed ? " · Session 已完成" : " · 运行中"}</small></div><ol class="machine-agent-preview-list">${latest}</ol>`;
}

function bindAgentEventsDialog(trace, root = elements.detail) {
  root.querySelectorAll("[data-agent-events-trigger]").forEach(trigger => {
    if (!(trigger instanceof HTMLButtonElement)) return;
    if (trigger.dataset.agentEventsBound === "true") return;
    trigger.dataset.agentEventsBound = "true";
    trigger.dataset.agentEventsDefaultLabel = trigger.textContent.trim();
    trigger.addEventListener("click", () => openAgentEventsDialog(trigger, {
      taskId: trace.task.taskId,
      sourceUrl: trigger.dataset.agentEventsUrl,
      downloadUrl: trigger.dataset.agentEventsDownloadUrl,
      kind: trigger.dataset.agentEventsKind || "AGENT",
      binding: trigger.dataset.agentEventsBinding || "等待 Session",
      runnerKind: trigger.dataset.agentEventsRunner || "",
    }));
  });
}

function openAgentEventsDialog(trigger, source) {
  if (!source.sourceUrl) return;
  closeAgentEventsDialog(false);
  const viewer = elements.eventsViewer;
  const dialog = elements.eventsDialog;
  viewer.dataset.sourceUrl = source.sourceUrl;
  viewer.dataset.downloadUrl = source.downloadUrl || source.sourceUrl;
  viewer.dataset.state = "loading";
  viewer.querySelector("[data-agent-events-title]").textContent = `${roleLabel(source.kind)} · 交互记录`;
  viewer.querySelector("[data-agent-events-task]").textContent = source.taskId;
  viewer.querySelector("[data-agent-events-binding]").textContent = source.binding;
  viewer.querySelector("[data-agent-events-toolbar]").replaceChildren();
  viewer.querySelector("[data-agent-events-content]").innerHTML = '<div class="agent-events-loading" role="status">正在加载会话消息与工具事件…</div>';
  viewer.querySelector("[data-agent-events-footer]").replaceChildren();
  const download = viewer.querySelector("[data-agent-events-download]");
  download.href = "#";
  download.hidden = true;
  setAgentEventsStatus(viewer, "正在加载");
  agentEventsReturnFocus = trigger;
  updateAgentEventsTrigger(trigger, true, true);
  const state = { cursor: 0, total: 0, events: [], completed: false, hasMore: false, filter: "all", loading: false, stopped: false, timer: 0 };
  stopAgentEventsFollower = () => {
    state.stopped = true;
    if (state.timer) window.clearTimeout(state.timer);
  };
  const schedule = () => {
    if (state.stopped || state.completed || state.hasMore || !dialog.open) return;
    state.timer = window.setTimeout(() => void loadPage(false), 1000);
  };
  const loadPage = async (drain) => {
    if (state.loading || state.stopped) return;
    state.loading = true;
    viewer.dataset.state = "loading";
    updateAgentEventsTrigger(trigger, true, true);
    try {
      do {
        const source = new URL(viewer.dataset.sourceUrl, window.location.origin);
        source.searchParams.set("cursor", String(state.cursor));
        source.searchParams.set("limit", "200");
        const response = await fetch(source, { cache: "no-store" });
        if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`);
        const page = await response.json();
        if (state.stopped) return;
        const known = new Set(state.events.map(event => event.sequence));
        state.events.push(...page.events.filter(event => !known.has(event.sequence)));
        state.cursor = page.nextCursor;
        state.total = page.total;
        state.hasMore = page.hasMore;
        state.completed = page.completed;
        if (state.stopped || !drain) break;
      } while (state.hasMore);
      viewer.dataset.state = state.completed ? "complete" : "following";
      renderAgentEventsState(viewer, state, loadPage);
      schedule();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      viewer.dataset.state = "error";
      setAgentEventsStatus(viewer, "读取失败");
      viewer.querySelector("[data-agent-events-content]").innerHTML = `<div class="agent-events-error" role="alert"><strong>Agent Events 暂时无法读取</strong><p>${escapeHtml(message)}</p><button type="button" data-agent-events-retry>重新加载</button></div>`;
      viewer.querySelector("[data-agent-events-retry]")?.addEventListener("click", () => void loadPage(false), { once: true });
    } finally {
      state.loading = false;
      if (!state.stopped) updateAgentEventsTrigger(trigger, true);
    }
  };
  dialog.showModal();
  void loadPage(true);
}

function closeAgentEventsDialog(restoreFocus = true) {
  shouldRestoreAgentEventsFocus = restoreFocus;
  stopAgentEventsFollower();
  if (elements.eventsDialog.open) {
    elements.eventsDialog.close();
    return;
  }
  const returnFocus = agentEventsReturnFocus;
  if (returnFocus instanceof HTMLButtonElement) updateAgentEventsTrigger(returnFocus, false);
  agentEventsReturnFocus = undefined;
  shouldRestoreAgentEventsFocus = true;
}

function renderAgentEventsState(viewer, state, loadPage) {
  const target = viewer.querySelector("[data-agent-events-content]");
  const visible = state.filter === "all" ? state.events : state.events.filter(event => event.category === state.filter);
  setAgentEventsStatus(viewer, `已加载 ${state.events.length} / ${state.total} 条 · ${state.completed ? "已完成" : "实时跟随中"}`);
  const download = viewer.querySelector("[data-agent-events-download]");
  if (download instanceof HTMLAnchorElement && state.completed) {
    download.href = viewer.dataset.downloadUrl;
    download.hidden = false;
  }
  const categories = [["all", "全部"], ["conversation", "对话"], ["tool", "工具调用"], ["tool_result", "工具结果"], ["system", "系统"], ["error", "错误"]];
  const toolbar = viewer.querySelector("[data-agent-events-toolbar]");
  toolbar.innerHTML = categories.map(([id, label]) => {
    const count = id === "all" ? state.events.length : state.events.filter(event => event.category === id).length;
    return `<button type="button" data-agent-event-filter="${id}" class="${state.filter === id ? "active" : ""}" aria-pressed="${state.filter === id}">${label}<span>${count}</span></button>`;
  }).join("");
  toolbar.querySelectorAll("[data-agent-event-filter]").forEach(button => button.addEventListener("click", () => {
    state.filter = button.dataset.agentEventFilter;
    renderAgentEventsState(viewer, state, loadPage);
  }));
  if (state.events.length === 0) {
    target.innerHTML = `<div class="agent-events-empty">${state.completed ? "这个 Agent Run 没有输出事件。" : "Agent 已启动，正在等待第一条 JSONL 事件…"}</div>`;
  } else if (visible.length === 0) {
    target.innerHTML = '<div class="agent-events-empty">当前分类暂无事件；切换到“全部”可查看完整原始流。</div>';
  } else {
    target.innerHTML = `<ol class="agent-events-list" aria-label="Agent 会话记录">${visible.map(renderAgentEvent).join("")}</ol>`;
  }
  const footer = viewer.querySelector("[data-agent-events-footer]");
  footer.innerHTML = state.hasMore
    ? `<button type="button" data-agent-events-more>加载后续 200 条</button><button type="button" data-agent-events-all>加载到当前末尾</button>`
    : `<span>${state.completed ? "完整事件流已加载" : "已到当前末尾，等待新事件…"}</span>`;
  footer.querySelector("[data-agent-events-more]")?.addEventListener("click", () => void loadPage(false));
  footer.querySelector("[data-agent-events-all]")?.addEventListener("click", () => void loadPage(true));
}

function renderAgentEvent(event) {
  const sequence = String(event.sequence).padStart(2, "0");
  if (event.parsed !== undefined) {
    const speaker = eventSpeaker(event);
    return `<li class="agent-event category-${escapeHtml(event.category)} speaker-${escapeHtml(speaker.id)}">
      <span class="agent-event-avatar" aria-hidden="true">${escapeHtml(speaker.mark)}</span>
      <article class="agent-event-bubble">
        <div class="agent-event-heading"><strong>${escapeHtml(speaker.label)}</strong><em>${escapeHtml(categoryLabel(event.category))}</em><span>#${sequence} · ${escapeHtml(event.type)}</span></div>
        <p>${escapeHtml(eventSummary(event.parsed, event.type))}</p>
        <details><summary>查看原始 JSON</summary><pre>${escapeHtml(JSON.stringify(event.parsed, null, 2))}</pre></details>
      </article>
    </li>`;
  }
  return `<li class="agent-event malformed speaker-error">
    <span class="agent-event-avatar" aria-hidden="true">!</span>
    <article class="agent-event-bubble">
      <div class="agent-event-heading"><strong>解析错误</strong><em>错误</em><span>#${sequence}</span></div>
      <p>这一行不是有效 JSON，已按原始文本完整保留。</p>
      <details><summary>查看原始文本</summary><pre>${escapeHtml(event.raw)}</pre></details>
    </article>
  </li>`;
}

function eventSpeaker(event) {
  if (event.category === "conversation") {
    const role = String(event.parsed?.role || event.parsed?.message?.role || event.parsed?.item?.role || "agent").toLowerCase();
    if (["user", "human"].includes(role)) return { id: "user", mark: "U", label: "用户" };
    return { id: "agent", mark: "A", label: "Agent" };
  }
  if (event.category === "tool") return { id: "tool", mark: "T", label: "工具调用" };
  if (event.category === "tool_result") return { id: "tool-result", mark: "R", label: "工具结果" };
  if (event.category === "error") return { id: "error", mark: "!", label: "错误" };
  return { id: "system", mark: "S", label: "系统" };
}

function categoryLabel(category) {
  return ({ conversation: "对话", tool: "工具调用", tool_result: "工具结果", system: "系统", error: "错误" })[category] || category;
}

function eventType(event) {
  const primary = event?.type || event?.event || event?.name;
  const secondary = event?.item?.type || event?.subtype;
  return [primary, secondary].filter(Boolean).join(" · ") || "unknown-event";
}

function eventSummary(event, type) {
  const itemText = event?.item?.text;
  const messageContent = Array.isArray(event?.message?.content)
    ? event.message.content.filter(item => item?.type === "text" && item.text).map(item => item.text).join(" ")
    : event?.message?.content;
  const direct = itemText || messageContent || event?.result || event?.text || event?.message;
  if (typeof direct === "string" && direct.trim()) return truncateEventText(direct.trim());
  if (typeof event?.item?.message === "string") return truncateEventText(event.item.message);
  if (typeof event?.item?.command === "string") {
    const output = typeof event.item.aggregated_output === "string" ? event.item.aggregated_output.trim() : "";
    return truncateEventText(`${event.type === "item.started" ? "执行命令" : "命令完成"}：${event.item.command}${output ? `；输出：${output}` : ""}`);
  }
  if (Array.isArray(event?.item?.changes)) {
    return truncateEventText(`${event.type === "item.started" ? "准备修改文件" : "文件修改完成"}：${event.item.changes.map(change => change?.path || change?.file || "未知文件").join("、")}`);
  }
  const toolUse = Array.isArray(event?.message?.content) ? event.message.content.find(item => item?.type === "tool_use") : undefined;
  if (toolUse) return truncateEventText(`调用工具：${toolUse.name || "unknown"} ${JSON.stringify(toolUse.input || {})}`);
  const toolResult = Array.isArray(event?.message?.content) ? event.message.content.find(item => item?.type === "tool_result") : undefined;
  if (toolResult) return truncateEventText(`工具结果：${typeof toolResult.content === "string" ? toolResult.content : JSON.stringify(toolResult.content || {})}`);
  if (event?.thread_id) return `Agent 会话已建立：${truncateEventText(String(event.thread_id))}`;
  if (event?.session_id) return `Agent 会话：${truncateEventText(String(event.session_id))}`;
  const labels = {
    "turn.started": "Agent 开始新一轮处理。",
    "turn.completed": "Agent 已完成这一轮处理。",
    "item.started": "Agent 开始处理一个运行项。",
    "item.completed": "Agent 已完成一个运行项。",
  };
  return labels[type] || "已记录一条 Agent Runtime 原始事件。";
}

function truncateEventText(value) {
  const normalized = String(value).replace(/\s+/g, " ");
  return normalized.length > 900 ? `${normalized.slice(0, 897)}…` : normalized;
}

function setAgentEventsStatus(viewer, value) {
  const status = viewer.querySelector("[data-agent-events-status]");
  if (status) status.textContent = value;
}

function updateAgentEventsTrigger(trigger, expanded, loading = false) {
  trigger.disabled = loading;
  trigger.setAttribute("aria-expanded", String(expanded));
  const label = trigger.dataset.agentEventsDefaultLabel || "查看 Agent Events";
  trigger.textContent = loading ? "正在加载…" : expanded ? "对话弹窗已打开" : label;
}

function renderJourneyStage(trace, definition, index) {
  const step = trace.business.steps.find(candidate => candidate.stepId === definition.id);
  const attempts = trace.business.attempts.filter(attempt => attempt.stepId === definition.id);
  const attempt = attempts.at(-1);
  const status = definition.id === "ARCHIVE" ? archiveJourneyStatus(trace.task) : (step?.status || "NOT_STARTED");
  const isOpen = status === "RUNNING" || status === "FAILED" || status === "CANCELLED";
  return `<details class="journey-stage status-${escapeHtml(status.toLowerCase())}"${isOpen ? " open" : ""}>
    <summary>
      <span class="stage-marker" aria-hidden="true">${statusIcon(status)}</span>
      <span class="stage-copy"><small>${String(index + 1).padStart(2, "0")}</small><strong>${escapeHtml(definition.label)}</strong><span>${escapeHtml(definition.description)}</span></span>
      <span class="stage-status tag ${attemptColor(status)}">${escapeHtml(attemptStatusLabel(status))}</span>
    </summary>
    <div class="stage-detail">${renderStageDetail(trace, definition.id, attempt)}</div>
  </details>`;
}

function renderStageDetail(trace, stepId, attempt) {
  const evidence = attempt?.evidenceRecords || [];
  const common = attempt ? `
    <dl class="evidence-grid">
      <div><dt>本次执行</dt><dd>${escapeHtml(attempt.attemptId)}</dd></div>
      <div><dt>耗时</dt><dd>${formatDuration(attempt.startedAt, attempt.finishedAt)}</dd></div>
    </dl>` : `<p class="trace-note">尚未进入这个阶段，因此还没有执行证据。</p>`;
  let facts = "";
  if (stepId === "CONTEXT") facts = `<p><strong>规格：</strong>R${trace.task.specRevision}　<strong>任务：</strong>${escapeHtml(trace.task.taskId)}</p>`;
  if (stepId === "WORKSPACE") facts = `<p><strong>任务分支：</strong><code>${escapeHtml(trace.git.branch || "尚未创建")}</code></p>`;
  if (stepId === "IMPLEMENT") facts = `<p><strong>Agent Session：</strong><code>${escapeHtml(trace.agent?.sessionId || "尚未建立")}</code><br><strong>Runner：</strong>${escapeHtml(runnerLabel(trace.agent?.runnerKind))}　<strong>结果：</strong>${escapeHtml(agentOutcomeLabel(trace.agent?.outcome))}</p>`;
  if (stepId === "SELF_REVIEW") facts = roleFacts(trace, "SELF_REVIEW", "尚无 Self Review 结果。");
  if (stepId === "VERIFY") facts = trace.verification
    ? `<p><strong>验证结论：</strong>${trace.verification.passed ? "✓ 全部通过" : `! ${escapeHtml(trace.verification.code || "未通过")}`}<br>${trace.verification.commands.map(command => `<code>${escapeHtml(command.commandId)}</code> → exit ${command.exitCode ?? "signal"}，${command.durationMs} ms`).join("<br>")}</p>`
    : `<p>尚无验证结果。</p>`;
  if (stepId === "REVIEW") facts = trace.reviews?.length
    ? `<p><strong>Review Attempts：</strong>${trace.reviews.length}<br>${trace.reviews.map(review => `<code>#${review.attempt}</code> ${escapeHtml(runnerLabel(review.runnerKind))} → <strong>${escapeHtml(review.verdict || review.outcome)}</strong>，阻断问题 ${review.blockingFindingCount}<br><span>${escapeHtml(review.summary)}</span>`).join("<br>")}</p>`
    : `<p>尚无独立 Review 结果。</p>`;
  if (stepId === "REPLAN") facts = roleFacts(trace, "REPLAN", "本次任务尚未触发 Replan。");
  if (stepId === "MERGE") facts = `<p><strong>结果提交：</strong><code>${escapeHtml(shortSha(trace.git.resultCommit))}</code><br><strong>合入提交：</strong><code>${escapeHtml(shortSha(trace.git.mergeCommit))}</code></p>`;
  if (stepId === "DOCS") facts = `<p><strong>文档证据：</strong>${evidence.length ? `${evidence.length} 项已绑定` : "尚未绑定"}</p>`;
  if (stepId === "ARCHIVE") facts = `<p><strong>归档状态：</strong>${escapeHtml(archiveStatusLabel(trace.task.archiveStatus))}<br><strong>闭环结论：</strong>${trace.task.archiveStatus === "ARCHIVED" ? (trace.task.outcome === "FAILED_TERMINAL" ? "失败事实与归档回执均已确认" : "任务结果与归档回执均已确认") : "等待归档回执"}</p>`;
  const evidenceList = evidence.length ? `<ul class="evidence-list">${evidence.map(record => `<li><span>${escapeHtml(record.artifactName)}</span><code>${escapeHtml(shortDigest(record.contentDigest))}</code></li>`).join("")}</ul>` : "";
  return `${facts}${common}${attempt?.error ? `<p class="error-box"><strong>这个阶段失败：</strong>${escapeHtml(attempt.error)}<br><span>下一步：${escapeHtml(trace.recovery.summary)}</span></p>` : ""}${evidenceList}`;
}

function roleFacts(trace, kind, emptyText) {
  const roles = (trace.roles || []).filter(role => role.kind === kind);
  return roles.length
    ? `<p><strong>${escapeHtml(kind)} Attempts：</strong>${roles.length}<br>${roles.map(role => `<code>${escapeHtml(role.sessionId || role.runId)}</code> → <strong>${escapeHtml(role.verdict || role.outcome)}</strong><br><span>${escapeHtml(role.summary)}</span>`).join("<br>")}</p>`
    : `<p>${escapeHtml(emptyText)}</p>`;
}

function correlationNode(label, value) {
  return `<span class="correlation-node"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`;
}

function archiveJourneyStatus(task) {
  if (task.archiveStatus === "ARCHIVED") return "SUCCEEDED";
  if (task.archiveStatus === "FAILED") return "FAILED";
  if (task.state === "CLOSED") return "RUNNING";
  return "NOT_STARTED";
}

function taskStateLabel(state) {
  return ({ RECEIVED: "已接收", RUNNING: "执行中", WAITING_RECONCILE: "等待对账", VERIFYING: "验证中", FAILED: "已失败", CLOSED: "已关闭" })[state] || state;
}

function backlogStatusLabel(status) {
  return ({ DRAFT: "草稿", READY: "待调度", SCHEDULED: "已派发", BLOCKED: "已阻塞", CLOSED: "已关闭" })[status] || status;
}

function archiveStatusLabel(status) {
  return ({ NOT_STARTED: "未开始归档", PENDING: "等待归档", ARCHIVING: "归档中", ARCHIVED: "已归档", FAILED: "归档失败" })[status] || status;
}

function stepLabel(step) {
  return PIPELINE_STAGES.find(item => item.id === step)?.label || ({ RECEIVED: "接收任务", EXECUTE: "执行", VERIFY: "验证", CLOSE: "关闭", CLOSED: "业务关闭" })[step] || step || "等待开始";
}

function attemptStatusLabel(status) {
  return ({ NOT_STARTED: "未开始", SCHEDULED: "已排队", RUNNING: "进行中", SUCCEEDED: "已完成", FAILED: "失败", CANCELLED: "已取消" })[status] || status;
}

function runnerLabel(kind) {
  return ({ fake: "Fake Agent（演示）", codex_exec: "Codex CLI", claude_print: "Claude CLI", process: "本地进程 Agent" })[String(kind || "").toLowerCase()] || kind || "等待分配";
}

function roleLabel(kind) {
  return ({
    CONTEXT: "Context",
    IMPLEMENTATION: "Implementation",
    SELF_REVIEW: "Self Review",
    INDEPENDENT_REVIEW: "Independent Review",
    REPLAN: "Replan",
    DOCS_GATE: "Docs Gate",
  })[String(kind || "").toUpperCase()] || kind || "Agent";
}

function agentOutcomeLabel(outcome) {
  return ({ SUCCEEDED: "已完成", FAILED: "失败", TIMED_OUT: "超时", RESULT_UNKNOWN: "结果未知" })[outcome] || outcome || "等待结果";
}

function recoveryLabel(classification) {
  return ({ NONE: "无需恢复", WAIT_OR_RECONCILE: "等待恢复或对账", FAILED_TERMINAL: "当前版本已终止", ARCHIVE_RETRY: "只需重试归档" })[classification] || classification;
}

function statusIcon(status) {
  if (status === "SUCCEEDED") return "✓";
  if (status === "FAILED" || status === "CANCELLED") return "!";
  if (status === "RUNNING") return "●";
  return "○";
}

function stateColor(state) {
  if (state === "CLOSED") return "green";
  if (state === "FAILED") return "red";
  if (state === "VERIFYING" || state === "RUNNING") return "blue";
  return "yellow";
}

function archiveColor(status) {
  if (status === "ARCHIVED") return "green";
  if (status === "FAILED") return "red";
  return "yellow";
}

function attemptColor(status) {
  if (status === "SUCCEEDED") return "green";
  if (status === "FAILED" || status === "CANCELLED") return "red";
  if (status === "RUNNING") return "blue";
  return "yellow";
}

function formatDuration(startedAt, finishedAt) {
  if (!startedAt) return "尚未开始";
  if (!finishedAt) return "执行中";
  const duration = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(1)} s`;
}

function shortSha(value) {
  return value ? String(value).slice(0, 10) : "—";
}

function shortDigest(value) {
  const text = String(value);
  return text.length > 30 ? `${text.slice(0, 18)}…${text.slice(-8)}` : text;
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function escapeAttribute(value) {
  const text = String(value);
  if (!/^https?:\/\//.test(text) && !text.startsWith("/api/")) return "#";
  return escapeHtml(text);
}
