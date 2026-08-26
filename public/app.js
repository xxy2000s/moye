const elements = {
  dot: document.querySelector("#connection-dot"),
  connection: document.querySelector("#connection-label"),
  project: document.querySelector("#project-id"),
  active: document.querySelector("#active-count"),
  pending: document.querySelector("#pending-count"),
  generated: document.querySelector("#generated-at"),
  latestSuccess: document.querySelector("#latest-success"),
  latestSuccessId: document.querySelector("[data-latest-success-id]"),
  latestSuccessTitle: document.querySelector("[data-latest-success-title]"),
  filterOutcome: document.querySelector("#filter-outcome"),
  filterWorkflow: document.querySelector("#filter-workflow"),
  filterHistory: document.querySelector("#filter-history"),
  empty: document.querySelector("#empty-state"),
  projectMasthead: document.querySelector("#project-masthead"),
  projectView: document.querySelector("#project-view"),
  detailPage: document.querySelector("#task-detail-page"),
  detailBack: document.querySelector("#task-detail-back"),
  detail: document.querySelector("#detail-content"),
  detailKicker: document.querySelector("#task-detail-kicker"),
  detailTitle: document.querySelector("#task-detail-title"),
  detailMeta: document.querySelector("#task-detail-meta"),
  backlogDialog: document.querySelector("#backlog-detail-dialog"),
  backlogDetailKicker: document.querySelector("#backlog-detail-kicker"),
  backlogDetailTitle: document.querySelector("#backlog-detail-title"),
  backlogDetailMeta: document.querySelector("#backlog-detail-meta"),
  backlogDetailContent: document.querySelector("#backlog-detail-content"),
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
let machineGraphUiState = { filter: "ACTUAL", zoom: undefined, selectedId: undefined, inspectorOpen: false, scrollLeft: 0, scrollTop: 0 };
let taskDetailTabUiState = { taskId: undefined, activeId: "canvas" };
let executionLedgerUiState = { taskId: undefined, actorId: undefined };
let closeMachineGraphInspector = () => false;
let latestBoardSnapshot;
let backlogDetailReturnFocus;
const boardFilters = { outcome: "ALL", workflow: "ALL", history: "ALL" };
elements.backlogDialog.addEventListener("close", () => {
  const returnFocus = backlogDetailReturnFocus;
  backlogDetailReturnFocus = undefined;
  if (returnFocus?.isConnected) window.requestAnimationFrame(() => returnFocus.focus());
});
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
[elements.filterOutcome, elements.filterWorkflow, elements.filterHistory].forEach(select => select.addEventListener("change", () => {
  boardFilters.outcome = elements.filterOutcome.value;
  boardFilters.workflow = elements.filterWorkflow.value;
  boardFilters.history = elements.filterHistory.value;
  lastProjectionSignature = "";
  if (latestBoardSnapshot) renderBoard(latestBoardSnapshot);
}));
elements.latestSuccess.addEventListener("click", () => {
  if (latestBoardSnapshot?.latestSucceeded) navigateToTask(latestBoardSnapshot.latestSucceeded);
});
initializeHistoryState();
renderBacklogLaneState("loading");
const initialRoute = readRoute();
if (initialRoute.kind === "task") void applyRoute().finally(loadBoard);
else void loadBoard();
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
    if (!latestBoardSnapshot) renderBacklogLaneState("error");
    console.error(error);
  }
}

function renderBoard(board) {
  latestBoardSnapshot = board;
  const filtered = filterBoard(board);
  elements.project.textContent = board.projectId;
  elements.active.textContent = String(filtered.active.length);
  elements.pending.textContent = String(filtered.archivePending.length);
  elements.generated.textContent = formatTime(board.generatedAt);
  renderLatestSucceeded(board.latestSucceeded);
  const signature = JSON.stringify([boardFilters, filtered.backlog, filtered.active, filtered.archivePending, filtered.archived]);
  if (signature !== lastProjectionSignature) {
    renderLane("backlog", filtered.backlog, backlogCard);
    renderLane("active", filtered.active, taskCard);
    renderLane("archivePending", filtered.archivePending, taskCard);
    renderLane("archived", filtered.archived, taskCard);
    lastProjectionSignature = signature;
  }
  elements.empty.hidden = filtered.backlog.length + filtered.active.length + filtered.archivePending.length + filtered.archived.length !== 0;
}

function filterBoard(board) {
  const filterTasks = items => items.filter(task => {
    const status = visibleTaskState(task);
    const outcomeMatch = boardFilters.outcome === "ALL"
      || (boardFilters.outcome === "IN_PROGRESS" ? !["SUCCEEDED", "FAILED_TERMINAL", "ARCHIVE_FAILED", "WAITING_RECONCILE"].includes(status) : status === boardFilters.outcome);
    return outcomeMatch
      && (boardFilters.workflow === "ALL" || task.workflowKind === boardFilters.workflow)
      && (boardFilters.history === "ALL" || task.historyKind === boardFilters.history);
  });
  const taskFiltersActive = boardFilters.outcome !== "ALL" || boardFilters.workflow !== "ALL" || boardFilters.history !== "ALL";
  return {
    backlog: taskFiltersActive ? [] : board.backlog,
    active: filterTasks(board.active),
    archivePending: filterTasks(board.archivePending),
    archived: filterTasks(board.archived),
  };
}

function renderLatestSucceeded(task) {
  elements.latestSuccess.hidden = !task;
  if (!task) return;
  elements.latestSuccessId.textContent = task.taskId;
  elements.latestSuccessTitle.textContent = task.title;
}

function renderLane(name, items, renderer) {
  const [container, count] = lanes[name];
  container.removeAttribute("aria-busy");
  count.textContent = String(items.length);
  if (items.length === 0) {
    container.innerHTML = `<div class="placeholder">${name === "backlog" ? "暂无 Backlog" : "暂无条目"}</div>`;
    return;
  }
  container.replaceChildren(...items.map((item, index) => renderer(item, index, latestBoardSnapshot?.generatedAt)));
}

function backlogCard(item, index) {
  const card = cardShell(index, "button");
  card.type = "button";
  card.classList.add("backlog-card");
  card.setAttribute("aria-label", `查看 Backlog ${item.backlogId}：${item.title}`);
  card.innerHTML = `
    <div class="card-meta"><span>${escapeHtml(item.backlogId)}</span><span>${escapeHtml(item.priority)}</span></div>
    <h3>${escapeHtml(item.title)}</h3>
    <div class="card-footer"><span class="tag ${item.status === "SCHEDULED" ? "green" : "yellow"}">${escapeHtml(backlogStatusLabel(item.status))}</span><span class="tag blue">${escapeHtml(item.kind)}</span></div>
    <span class="card-detail-hint" aria-hidden="true">查看问题与证据 <span>↗</span></span>`;
  card.addEventListener("click", () => openBacklogDetail(item, card));
  return card;
}

function renderBacklogLaneState(state) {
  const [container, count] = lanes.backlog;
  count.textContent = "0";
  if (state === "loading") {
    container.setAttribute("aria-busy", "true");
    container.innerHTML = '<div class="placeholder backlog-lane-state"><span class="backlog-loading-mark" aria-hidden="true"></span>正在读取 Backlog Projection</div>';
    return;
  }
  container.removeAttribute("aria-busy");
  container.innerHTML = '<div class="placeholder backlog-lane-state error" role="alert"><strong>Backlog 暂时不可读</strong><span>Runtime 请求失败，尚未把错误误报为“暂无条目”。</span><button type="button">重新读取</button></div>';
  container.querySelector("button").addEventListener("click", loadBoard);
}

function openBacklogDetail(item, trigger) {
  backlogDetailReturnFocus = trigger;
  elements.backlogDetailKicker.textContent = `${item.backlogId} · Backlog Detail`;
  elements.backlogDetailTitle.textContent = item.title || "未命名 Backlog";
  elements.backlogDetailMeta.innerHTML = `
    <span class="tag ${item.status === "SCHEDULED" ? "green" : "yellow"}">${escapeHtml(backlogStatusLabel(item.status))}</span>
    <span class="tag blue">${escapeHtml(item.kind || "UNKNOWN")}</span>
    <span class="backlog-priority">优先级 ${escapeHtml(item.priority || "未提供")}</span>`;
  elements.backlogDetailContent.innerHTML = renderBacklogDetail(item);
  elements.backlogDialog.showModal();
}

function renderBacklogDetail(item) {
  const problem = item.problem && typeof item.problem === "object" ? item.problem : {};
  const source = item.source && typeof item.source === "object" ? item.source : {};
  return `
    <section class="backlog-problem-section" aria-labelledby="backlog-problem-heading">
      <header><p>Problem Contract · v${escapeHtml(String(item.schemaVersion || 1))}</p><h3 id="backlog-problem-heading">问题事实</h3></header>
      <dl class="backlog-problem-grid">
        ${backlogFact("已观察", problem.observed)}
        ${backlogFact("期望行为", problem.expected)}
        ${backlogFact("实际影响", problem.impact)}
      </dl>
    </section>
    <section class="backlog-detail-section" aria-labelledby="backlog-evidence-heading">
      <header><p>Evidence & Scope</p><h3 id="backlog-evidence-heading">证据、范围与验收</h3></header>
      <div class="backlog-detail-columns">
        ${backlogList("Evidence 引用", problem.evidenceRefs)}
        ${backlogList("影响范围", item.affectedAreas)}
      </div>
      ${backlogList("验收方向", item.acceptanceOutline, true)}
    </section>
    <section class="backlog-detail-section backlog-source-section" aria-labelledby="backlog-source-heading">
      <header><p>Canonical References</p><h3 id="backlog-source-heading">来源与关联</h3></header>
      <dl class="backlog-source-grid">
        ${backlogReference("Source", source.path, source.kind)}
        ${backlogReference("Digest", source.digest)}
        ${backlogReference("关联 Task", Array.isArray(item.taskRefs) && item.taskRefs.length ? item.taskRefs.join(", ") : undefined)}
      </dl>
    </section>`;
}

function backlogFact(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd class="${value ? "" : "empty-value"}">${escapeHtml(value || "未提供")}</dd></div>`;
}

function backlogList(label, values, ordered = false) {
  const list = Array.isArray(values) ? values.filter(value => typeof value === "string" && value.trim()) : [];
  if (list.length === 0) return `<section class="backlog-list-block"><h4>${escapeHtml(label)}</h4><p class="empty-value">未提供</p></section>`;
  const tag = ordered ? "ol" : "ul";
  return `<section class="backlog-list-block"><h4>${escapeHtml(label)}</h4><${tag}>${list.map(value => `<li>${escapeHtml(value)}</li>`).join("")}</${tag}></section>`;
}

function backlogReference(label, value, hint) {
  return `<div><dt>${escapeHtml(label)}</dt><dd class="${value ? "" : "empty-value"}">${value ? `<code>${escapeHtml(value)}</code>${hint ? `<small>${escapeHtml(hint)}</small>` : ""}` : "未提供"}</dd></div>`;
}

function taskCard(task, index, observedAt) {
  const card = cardShell(index, "button");
  card.type = "button";
  card.setAttribute("aria-label", `查看任务 ${task.taskId}：${task.title}`);
  const visibleState = visibleTaskState(task);
  const timing = taskLifecycleTiming(task, observedAt);
  card.innerHTML = `
    <div class="card-meta"><span>${escapeHtml(task.taskId)}</span><span>${escapeHtml(workflowKindLabel(task.workflowKind))} · R${task.specRevision}</span></div>
    <h3>${escapeHtml(task.title)}</h3>
    <dl class="card-timing" aria-label="任务运行时间">
      <div><dt>开始</dt><dd><time datetime="${escapeHtml(timing.startedAt || "")}">${escapeHtml(formatTime(timing.startedAt))}</time></dd></div>
      <div><dt>结束</dt><dd>${timing.finishedAt ? `<time datetime="${escapeHtml(timing.finishedAt)}">${escapeHtml(formatTime(timing.finishedAt))}</time>` : "—"}</dd></div>
      <div><dt>Duration</dt><dd>${escapeHtml(timing.durationLabel)}${timing.running ? '<span class="card-timing-live">运行中</span>' : ""}</dd></div>
    </dl>
    <div class="card-footer">
      <span class="tag ${stateColor(visibleState)}">${escapeHtml(taskStateLabel(visibleState))}</span>
      <span class="tag ${archiveColor(task.archiveStatus)}">${escapeHtml(archiveStatusLabel(task.archiveStatus))}</span>
      ${task.historyKind === "PRODUCT_ACCEPTANCE" ? '<span class="tag acceptance-history">验收历史</span>' : ""}
    </div>`;
  card.addEventListener("click", () => navigateToTask(task));
  return card;
}

function taskLifecycleTiming(task, observedAt) {
  const events = Array.isArray(task.events) ? task.events : [];
  const startedAt = events[0]?.at;
  const finishedAt = task.archiveStatus === "ARCHIVED" ? events.at(-1)?.at : undefined;
  const running = Boolean(startedAt && !finishedAt);
  const end = finishedAt || (running ? observedAt : undefined);
  return {
    startedAt,
    finishedAt,
    running,
    durationLabel: startedAt && end ? formatCompactDuration(startedAt, end) : "—",
  };
}

function visibleTaskState(task) {
  if (task.archiveStatus === "FAILED" || task.runtimeState === "ARCHIVE_FAILED") return "ARCHIVE_FAILED";
  if (task.runtimeState === "WAITING_RECONCILE") return "WAITING_RECONCILE";
  if (task.outcome === "FAILED_TERMINAL") return "FAILED_TERMINAL";
  if (task.outcome === "SUCCEEDED" && task.archiveStatus === "ARCHIVED") return "SUCCEEDED";
  if (task.runtimeState === "ARCHIVE_PENDING") return "ARCHIVE_PENDING";
  return task.runtimeState || task.state;
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
  const snapshot = board || latestBoardSnapshot;
  const summaries = snapshot ? [...snapshot.active, ...snapshot.archivePending, ...snapshot.archived] : [];
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
    if (snapshot) await refreshOpenTask(snapshot);
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
  machineGraphUiState = { filter: "ACTUAL", zoom: undefined, selectedId: undefined, inspectorOpen: false, scrollLeft: 0, scrollTop: 0 };
  taskDetailTabUiState = { taskId: summary.taskId, activeId: "canvas" };
  executionLedgerUiState = { taskId: summary.taskId, actorId: undefined };
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
      else if (trace.traceKind === "CORE_V2") renderCoreV2Trace(trace);
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
  if (trace.traceKind === "CORE_V2") {
    return JSON.stringify([
      trace.task.state,
      trace.task.currentStep,
      trace.task.archiveStatus,
      trace.task.outcome,
      trace.lifecycle.projectionDigest,
      trace.stateMachine.current.overall,
      trace.roles.map(item => [item.runId, item.outcome, item.verdict]),
    ]);
  }
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

const TASK_DETAIL_TABS = [
  { id: "canvas", label: "画布" },
  { id: "deliverables", label: "角色与交付物" },
  { id: "workflow", label: "Workflow 状态事实" },
  { id: "diagnostics", label: "高级诊断" },
];

function renderTaskDetailTabs(taskId, panels) {
  if (taskDetailTabUiState.taskId !== taskId) taskDetailTabUiState = { taskId, activeId: "canvas" };
  const activeId = TASK_DETAIL_TABS.some(tab => tab.id === taskDetailTabUiState.activeId) ? taskDetailTabUiState.activeId : "canvas";
  const tabs = TASK_DETAIL_TABS.map(tab => `<button type="button" role="tab" id="task-tab-${tab.id}" aria-controls="task-panel-${tab.id}" aria-selected="${tab.id === activeId}" tabindex="${tab.id === activeId ? "0" : "-1"}" data-task-detail-tab="${tab.id}">${tab.label}</button>`).join("");
  const content = TASK_DETAIL_TABS.map(tab => `<section role="tabpanel" id="task-panel-${tab.id}" aria-labelledby="task-tab-${tab.id}" data-task-detail-panel="${tab.id}"${tab.id === activeId ? "" : " hidden"}>${panels[tab.id] || renderEmptyTaskTab(tab.label)}</section>`).join("");
  return `<div class="task-detail-tabs-shell">
    <nav class="task-detail-tabs" aria-label="Task 详情视图"><div role="tablist" aria-orientation="horizontal">${tabs}</div></nav>
    <div class="task-detail-tab-panels">${content}</div>
  </div>`;
}

function renderEmptyTaskTab(label) {
  return `<div class="task-tab-empty"><strong>${escapeHtml(label)}</strong><span>这个 Workflow 当前没有可展示的对应事实。</span></div>`;
}

function bindTaskDetailTabs(taskId) {
  const tablist = elements.detail.querySelector('[role="tablist"]');
  if (!(tablist instanceof HTMLElement)) return;
  const tabs = [...tablist.querySelectorAll("[data-task-detail-tab]")];
  const activate = (id, moveFocus = false) => {
    if (!TASK_DETAIL_TABS.some(tab => tab.id === id)) return;
    taskDetailTabUiState = { taskId, activeId: id };
    tabs.forEach(tab => {
      const selected = tab.dataset.taskDetailTab === id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && moveFocus) tab.focus();
    });
    elements.detail.querySelectorAll("[data-task-detail-panel]").forEach(panel => {
      panel.hidden = panel.dataset.taskDetailPanel !== id;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab.dataset.taskDetailTab));
    tab.addEventListener("keydown", event => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(tabs[next].dataset.taskDetailTab, true);
    });
  });
}

function renderTaskTrace(trace) {
  const task = trace.task;
  renderTaskDetailHeader(task, task.title, [
    ["状态", taskStateLabel(task.state), task.state === "CLOSED" ? "success" : "progress"],
    ["归档", archiveStatusLabel(task.archiveStatus), task.archiveStatus === "ARCHIVED" ? "success" : "neutral"],
    ["Workflow", trace.stateMachine.workflow],
    ["角色", "无 Agent Session"],
    ["来源", task.backlogRefs.join(", ") || "—"],
  ]);
  elements.detail.innerHTML = renderTaskDetailTabs(task.taskId, {
    canvas: `${task.error ? `<p class="error-box">${escapeHtml(task.error)}</p>` : ""}
      ${renderStateMachine(trace.stateMachine, trace)}`,
    deliverables: renderSystemExecutionLedger(task, trace.stateMachine.workflow),
    workflow: renderWorkflowStatePanel(task.events, trace.stateMachine),
    diagnostics: `<section class="advanced-panel task-tab-surface"><div class="advanced-content"><section><p class="subheading">Restate Journal</p><code class="wide-code">${escapeHtml(trace.durableRuntime.workflowRef || `TaskWorkflow/${task.taskId}`)}</code>${trace.durableRuntime.invocationsUrl ? `<a class="runtime-link" href="${escapeAttribute(trace.durableRuntime.invocationsUrl)}" target="_blank" rel="noreferrer">在 Restate 中核对 Journal ↗</a>` : ""}</section></div></section>`,
  });
  bindTaskDetailTabs(task.taskId);
  bindExecutionLedger(task.taskId);
  bindStateMachineGraph(trace.stateMachine, trace);
}

function renderCoreV2Trace(trace) {
  closeAgentEventsDialog(false);
  const task = trace.task;
  const lifecycle = trace.lifecycle;
  const succeeded = task.outcome === "SUCCEEDED" && task.archiveStatus === "ARCHIVED";
  const failed = task.outcome === "FAILED_TERMINAL";
  const closure = renderCoreV2Closure(trace);
  renderTaskDetailHeader(task, task.title, [
    ["状态", failed ? "失败终态" : succeeded ? "完整闭环" : stepLabel(task.currentStep), failed ? "danger" : succeeded ? "success" : "progress"],
    ["规格", `R${task.specRevision}`],
    ["Agent", `${trace.roles.length} 个真实 Session`],
    ["Candidate", lifecycle.candidateCommit ? shortSha(lifecycle.candidateCommit) : "等待生成"],
    ["Merge", lifecycle.mergeReceipt ? `${shortSha(lifecycle.mergeReceipt.mergeCommit)}${lifecycle.mergeReceipt.reconciledAfterUnknown ? " · 已对账" : ""}` : "等待合入"],
    ["Archive", archiveStatusLabel(task.archiveStatus), task.archiveStatus === "ARCHIVED" ? "success" : "neutral"],
  ]);
  elements.detail.innerHTML = renderTaskDetailTabs(task.taskId, {
    canvas: `${task.error ? `<p class="error-box"><strong>失败原因：</strong>${escapeHtml(task.error)}</p>` : ""}
      ${failed ? closure : ""}
      ${renderStateMachine(trace.stateMachine, trace)}
      ${failed ? "" : closure}`,
    deliverables: renderCoreV2ExecutionLedger(trace),
    workflow: renderWorkflowStatePanel(trace.business.events, trace.stateMachine),
    diagnostics: `<section class="advanced-panel task-tab-surface"><div class="tab-panel-heading"><span>高级诊断</span><small>确定性 Observer、Restate Journal 与完整 Lifecycle Projection</small></div><div class="advanced-content"><section><p class="subheading">任务关联链</p><div class="correlation-strip" aria-label="任务关联链">${correlationNode("Task", task.taskId)}<span aria-hidden="true">→</span>${correlationNode("Workflow", trace.durableRuntime.workflowRef)}<span aria-hidden="true">→</span>${correlationNode("Candidate", lifecycle.candidateCommit || "等待生成")}<span aria-hidden="true">→</span>${correlationNode("Gate", lifecycle.verificationGateDigest || "等待验证")}<span aria-hidden="true">→</span>${correlationNode("Merge", lifecycle.mergeReceipt?.mergeCommit || "等待合入")}</div></section><section><p class="subheading">确定性 Observer</p><dl class="machine-node-facts"><div><dt>Event</dt><dd>${trace.observer.facts.events}</dd></div><div><dt>Attempt</dt><dd>${trace.observer.facts.attempts}</dd></div><div><dt>Failure / UNKNOWN</dt><dd>${trace.observer.facts.failures} / ${trace.observer.facts.unknown}</dd></div><div><dt>Repair / Replan</dt><dd>${trace.observer.facts.repairs} / ${trace.observer.facts.replans}</dd></div></dl><code class="wide-code">${escapeHtml(trace.observer.reportDigest)}</code></section><section><p class="subheading">Restate Journal</p><code class="wide-code">${escapeHtml(trace.durableRuntime.workflowRef)}</code><a class="runtime-link" href="${escapeAttribute(trace.durableRuntime.invocationsUrl)}" target="_blank" rel="noreferrer">在 Restate 中核对 Journal ↗</a></section><section><p class="subheading">Projection Digest</p><code class="wide-code">${escapeHtml(lifecycle.projectionDigest)}</code></section></div></section>`,
  });
  bindTaskDetailTabs(task.taskId);
  bindExecutionLedger(task.taskId);
  bindStateMachineGraph(trace.stateMachine, trace);
  bindAgentEventsDialog(trace);
}

function renderSystemExecutionLedger(task, workflow) {
  const outputs = [
    ["Result Commit", task.seal?.resultCommit ? shortSha(task.seal.resultCommit) : "等待 Result Commit", task.seal?.resultCommit || ""],
    ["Task Package", task.seal?.archivePath || task.archivePath || "等待封存", task.seal?.archivePath || task.archivePath || ""],
    ["Archive", archiveStatusLabel(task.archiveStatus), task.archiveStatus],
  ];
  return `<section class="execution-ledger system-execution-ledger task-tab-surface" aria-label="系统执行与交付物">
    <header class="execution-ledger-overview">
      <div><span class="execution-ledger-kicker">System execution</span><strong>系统执行任务</strong><p>展示 ${escapeHtml(workflow)} 的封存结果与归档事实。</p></div>
      <span class="execution-ledger-count">系统路径 · ${outputs.length} 项事实</span>
    </header>
    <div class="system-execution-card">
      <div class="system-execution-owner"><span class="system-owner-mark" aria-hidden="true">S</span><div><small>执行主体</small><strong>${escapeHtml(workflow)}</strong><span>无 Agent Session</span></div></div>
      <dl class="system-output-list">${outputs.map(([label, value, fullValue]) => `<div><dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(fullValue || value)}">${escapeHtml(value)}</dd></div>`).join("")}</dl>
    </div>
  </section>`;
}

function renderCoreV2ExecutionLedger(trace) {
  const artifacts = trace.lifecycle.artifacts.map(artifact => ({
    kind: artifact.kind,
    id: artifact.artifactId,
    digest: artifact.artifactDigest,
    subject: artifact.subjectCommit,
    revision: artifact.specRevision,
    producer: artifact.producer.role,
    phase: artifact.producer.phase,
    attemptId: artifact.producer.attemptId,
    generation: artifact.producer.generation,
  }));
  const actors = trace.roles.map(role => ({
    id: role.runId || role.attemptId,
    kind: role.kind,
    label: roleLabel(role.kind),
    runnerKind: role.runnerKind,
    sessionId: role.sessionId,
    specRevision: role.specRevision,
    generation: role.generation,
    attempt: role.attempt,
    attemptId: role.attemptId,
    outcome: role.outcome,
    verdict: role.verdict,
    summary: role.summary,
    findingCount: role.findingCount,
    eventsUrl: role.eventsUrl,
    sessionUrl: role.sessionUrl,
    timelineUrl: role.timelineUrl,
    stderrUrl: role.stderrUrl,
    deliverables: artifacts.filter(artifact => artifact.attemptId === role.attemptId),
  }));
  return renderExecutionLedger({
    taskId: trace.task.taskId,
    actors,
    artifacts,
    artifactLabel: "不可变 Artifact",
  });
}

function renderCodingExecutionLedger(trace) {
  const artifacts = trace.technical.artifacts.map(artifact => ({
    kind: artifact.kind,
    id: artifact.artifactRef,
    digest: artifact.contentDigest,
    bytes: artifact.bytes,
    downloadUrl: artifact.downloadUrl && artifact.kind !== "agent-events" ? artifact.downloadUrl : undefined,
    producer: "Technical Evidence",
  }));
  const implementations = (trace.agents?.length ? trace.agents : trace.agent ? [trace.agent] : []).map((agent, index) => ({
    id: agent.runId || agent.attemptId || agent.sessionId || `implementation-${index}`,
    kind: "IMPLEMENTATION",
    label: roleLabel("IMPLEMENTATION"),
    runnerKind: agent.runnerKind,
    sessionId: agent.sessionId,
    specRevision: agent.specRevision || trace.task.specRevision,
    attemptId: agent.attemptId,
    outcome: agent.outcome,
    verdict: agent.verdict,
    summary: agent.summary || "Implementation Agent 执行与结果由当前 Attempt 绑定。",
    eventsUrl: agent.eventsUrl,
    deliverables: [],
  }));
  const roles = (trace.roles || []).map((role, index) => ({
    id: role.runId || role.attemptId || role.sessionId || `role-${index}`,
    kind: role.kind,
    label: roleLabel(role.kind),
    runnerKind: role.runnerKind,
    sessionId: role.sessionId,
    specRevision: role.specRevision,
    attempt: role.attempt,
    attemptId: role.attemptId,
    outcome: role.outcome,
    verdict: role.verdict,
    summary: role.summary,
    findingCount: role.findingCount,
    eventsUrl: role.eventsUrl,
    deliverables: [],
  }));
  const reviews = (trace.reviews || []).map((review, index) => ({
    id: review.runId || review.attemptId || review.sessionId || `review-${index}`,
    kind: "INDEPENDENT_REVIEW",
    label: roleLabel("INDEPENDENT_REVIEW"),
    runnerKind: review.runnerKind,
    sessionId: review.sessionId,
    specRevision: review.specRevision || trace.task.specRevision,
    attempt: review.attempt,
    attemptId: review.attemptId,
    outcome: review.outcome,
    verdict: review.verdict,
    summary: review.summary,
    findingCount: review.findingCount,
    eventsUrl: review.eventsUrl,
    deliverables: [],
  }));
  const journey = PIPELINE_STAGES.map((definition, index) => renderJourneyStage(trace, definition, index)).join("");
  return renderExecutionLedger({
    taskId: trace.task.taskId,
    actors: [...implementations, ...roles, ...reviews],
    artifacts,
    artifactLabel: "技术 Artifact",
    supplemental: `<details class="ledger-register ledger-attempt-register"><summary><span>Workflow Attempt 台账 <strong>${PIPELINE_STAGES.length}</strong></span><small>按需核对每个阶段的 Attempt 与 Evidence</small></summary><div class="journey">${journey}</div></details>`,
  });
}

function renderExecutionLedger({ taskId, actors, artifacts, artifactLabel, supplemental = "" }) {
  if (actors.length === 0) {
    return `<section class="execution-ledger task-tab-surface"><div class="ledger-no-actors"><strong>尚无角色会话</strong><span>Workflow 还没有发布可查询的 Agent Session。</span></div>${renderLedgerArtifactRegister(artifacts, artifactLabel)}</section>`;
  }
  if (executionLedgerUiState.taskId !== taskId) executionLedgerUiState = { taskId, actorId: undefined };
  const selectedIndex = Math.max(0, actors.findIndex(actor => actor.id === executionLedgerUiState.actorId));
  const selected = actors[selectedIndex] || actors[0];
  executionLedgerUiState = { taskId, actorId: selected.id };
  const tabs = actors.map((actor, index) => {
    const selectedActor = index === selectedIndex;
    const result = actor.verdict || actor.outcome || "等待结果";
    return `<button type="button" class="ledger-role-tab" role="tab" id="ledger-role-${index}" aria-controls="ledger-role-panel-${index}" aria-selected="${selectedActor}" tabindex="${selectedActor ? "0" : "-1"}" data-ledger-actor="${escapeHtml(actor.id)}" data-ledger-index="${index}">
      <span class="ledger-role-state tone-${ledgerTone(result)}" aria-hidden="true"></span>
      <span class="ledger-role-copy"><strong>${escapeHtml(actor.label)}</strong><small>R${actor.specRevision || "—"}${actor.generation === undefined ? "" : ` · G${actor.generation}`} · ${escapeHtml(result)}</small></span>
      <span class="ledger-role-artifact-count">${actor.deliverables.length}</span>
    </button>`;
  }).join("");
  const panels = actors.map((actor, index) => `<section class="ledger-actor-panel" role="tabpanel" id="ledger-role-panel-${index}" aria-labelledby="ledger-role-${index}" data-ledger-panel="${index}"${index === selectedIndex ? "" : " hidden"}>${renderLedgerActor(actor)}</section>`).join("");
  return `<section class="execution-ledger task-tab-surface" data-execution-ledger data-task-id="${escapeHtml(taskId)}">
    <header class="execution-ledger-overview"><div><span class="execution-ledger-kicker">Execution ledger</span><strong>实际角色与交付结果</strong><p>选择一个角色查看本次结论、Session 与直接交付物。</p></div><span class="execution-ledger-count">${actors.length} Session · ${artifacts.length} ${escapeHtml(artifactLabel)}</span></header>
    <div class="execution-ledger-workspace">
      <nav class="ledger-role-list" role="tablist" aria-label="实际角色会话" aria-orientation="vertical">${tabs}</nav>
      <div class="ledger-role-panels">${panels}</div>
    </div>
    ${renderLedgerArtifactRegister(artifacts, artifactLabel)}
    ${supplemental}
  </section>`;
}

function renderLedgerActor(actor) {
  const result = actor.verdict || actor.outcome || "等待结果";
  const binding = [actor.attemptId, actor.sessionId || "等待 Session"].filter(Boolean).join(" · ");
  const deliverables = actor.deliverables.length
    ? `<ul class="ledger-deliverable-chips">${actor.deliverables.map(item => `<li><strong>${escapeHtml(item.kind)}</strong><span>${escapeHtml(shortDigest(item.digest))}</span></li>`).join("")}</ul>`
    : `<p class="ledger-no-deliverable">当前 Trace 没有把一等 Artifact 直接绑定到这个 Session；完整技术产物仍保留在下方台账。</p>`;
  return `<header class="ledger-actor-heading"><div><span>${escapeHtml(actor.kind)}</span><h3>${escapeHtml(actor.label)}</h3></div><strong class="tag ${ledgerTone(result)}">${escapeHtml(result)}</strong></header>
    <dl class="ledger-actor-facts"><div><dt>Revision</dt><dd>R${actor.specRevision || "—"}</dd></div>${actor.generation === undefined ? "" : `<div><dt>Generation</dt><dd>G${actor.generation}</dd></div>`}<div><dt>Attempt</dt><dd>${actor.attempt ?? "—"}</dd></div><div><dt>Runner</dt><dd>${escapeHtml(runnerLabel(actor.runnerKind))}</dd></div>${actor.findingCount === undefined ? "" : `<div><dt>Finding</dt><dd>${actor.findingCount}</dd></div>`}</dl>
    <p class="ledger-actor-summary">${escapeHtml(actor.summary || "这个执行实例没有提供摘要。")}</p>
    <section class="ledger-direct-deliverables" aria-label="直接交付物"><div><strong>直接交付物</strong><span>${actor.deliverables.length} 项</span></div>${deliverables}</section>
    <div class="ledger-actor-actions">${sessionEventsButton({ eventsUrl: actor.eventsUrl, sessionUrl: actor.sessionUrl, timelineUrl: actor.timelineUrl, stderrUrl: actor.stderrUrl, kind: actor.kind, binding, runnerKind: actor.runnerKind, label: "查看 Agent 对话与工具输出" })}</div>
    <details class="ledger-technical-identity"><summary>Session 与 Attempt 技术标识</summary><dl><div><dt>Session</dt><dd><code>${escapeHtml(actor.sessionId || "无 Session ID")}</code></dd></div><div><dt>Attempt</dt><dd><code>${escapeHtml(actor.attemptId || "无 Attempt ID")}</code></dd></div><div><dt>Run</dt><dd><code>${escapeHtml(actor.id)}</code></dd></div></dl></details>`;
}

function renderLedgerArtifactRegister(artifacts, label) {
  if (artifacts.length === 0) return "";
  const rows = artifacts.map(artifact => `<li>
    <div class="ledger-artifact-copy"><strong>${escapeHtml(artifact.kind)}</strong><span>${escapeHtml([artifact.producer, artifact.phase, artifact.revision ? `R${artifact.revision}` : undefined, artifact.subject ? shortSha(artifact.subject) : undefined].filter(Boolean).join(" · "))}</span></div>
    <code title="${escapeAttribute(artifact.digest || artifact.id)}">${escapeHtml(shortDigest(artifact.digest || artifact.id))}</code>
    ${artifact.downloadUrl ? `<a href="${escapeAttribute(artifact.downloadUrl)}" target="_blank" rel="noreferrer">打开 ↗</a>` : ""}
    <details><summary>技术标识</summary><dl><div><dt>Artifact</dt><dd><code>${escapeHtml(artifact.id)}</code></dd></div>${artifact.digest ? `<div><dt>Digest</dt><dd><code>${escapeHtml(artifact.digest)}</code></dd></div>` : ""}${artifact.attemptId ? `<div><dt>Attempt</dt><dd><code>${escapeHtml(artifact.attemptId)}</code></dd></div>` : ""}${artifact.bytes === undefined ? "" : `<div><dt>Bytes</dt><dd>${artifact.bytes}</dd></div>`}</dl></details>
  </li>`).join("");
  return `<details class="ledger-register"><summary><span>全部${escapeHtml(label)} <strong>${artifacts.length}</strong></span><small>完整 ID、Digest 与 producer 绑定按需展开</small></summary><ul class="ledger-artifact-register">${rows}</ul></details>`;
}

function bindExecutionLedger(taskId) {
  const root = elements.detail.querySelector("[data-execution-ledger]");
  if (!(root instanceof HTMLElement)) return;
  const tabs = [...root.querySelectorAll("[data-ledger-actor]")];
  const panels = [...root.querySelectorAll("[data-ledger-panel]")];
  const activate = (index, moveFocus = false) => {
    const target = tabs[index];
    if (!(target instanceof HTMLButtonElement)) return;
    tabs.forEach((tab, tabIndex) => {
      const selected = tabIndex === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel, panelIndex) => { panel.hidden = panelIndex !== index; });
    executionLedgerUiState = { taskId, actorId: target.dataset.ledgerActor };
    if (moveFocus) target.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(index));
    tab.addEventListener("keydown", event => {
      let next = index;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (index + 1) % tabs.length;
      else if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(next, true);
    });
  });
}

function ledgerTone(value) {
  const normalized = String(value || "").toUpperCase();
  if (["PASS", "PASSED", "SUCCEEDED", "ACCEPTED"].includes(normalized)) return "green";
  if (["FAIL", "FAILED", "FAILED_TERMINAL", "BLOCKING", "FINDINGS"].includes(normalized)) return "red";
  if (["RUNNING", "EXECUTING", "PENDING"].includes(normalized)) return "blue";
  return "yellow";
}

function renderCoreV2Closure(trace) {
  const lifecycle = trace.lifecycle;
  const failure = lifecycle.failure;
  const failureClosure = lifecycle.failureClosure;
  const successClosure = lifecycle.successClosure;
  const archive = lifecycle.archive;
  const recovery = trace.workflowRecovery;
  if (!failure && !failureClosure && !successClosure && !archive && !recovery) return "";
  const outcome = failure ? "失败 Closure" : successClosure ? "成功 Closure" : "Closure / Archive";
  const attempts = failure?.attemptIds || [];
  const sessions = failure?.sessionIds || [];
  return `<details class="task-evidence-panel core-v2-closure" ${failure || recovery || archive?.status === "FAILED" ? "open" : ""}>
    <summary><span>${escapeHtml(outcome)}</span><small>失败事实、Closure Artifact、恢复来源与 Archive Receipt</small></summary>
    <div class="task-evidence-content closure-evidence-grid">
      ${failure ? `<section class="journey-section"><div class="trace-heading"><div><p class="eyebrow">Original Failure</p><h3>原始失败事实</h3></div><span>append-only</span></div><dl class="machine-node-facts"><div><dt>失败阶段</dt><dd>${escapeHtml(failure.originalStage)}</dd></div><div><dt>发生时间</dt><dd>${escapeHtml(formatTime(failure.failedAt))}</dd></div><div><dt>原 Workflow</dt><dd><code>${escapeHtml(failure.sourceWorkflowRef)}</code></dd></div><div><dt>Failure Digest</dt><dd><code>${escapeHtml(failure.failureDigest)}</code></dd></div></dl><p class="error-box">${escapeHtml(failure.reason)}</p><details class="closure-bindings"><summary>原始 Attempt 与 Session · ${attempts.length} / ${sessions.length}</summary><ul>${attempts.map((id, index) => `<li><code>${escapeHtml(id)}</code>${sessions[index] ? `<span>${escapeHtml(sessions[index])}</span>` : ""}</li>`).join("") || "<li>原任务尚未建立 Role Attempt</li>"}</ul></details></section>` : ""}
      ${successClosure ? `<section class="journey-section"><div class="trace-heading"><div><p class="eyebrow">Success Closure</p><h3>成功闭环事实</h3></div><span>不可变 Artifact</span></div><dl class="machine-node-facts"><div><dt>Merge Commit</dt><dd><code>${escapeHtml(successClosure.mergeCommit)}</code></dd></div><div><dt>Closure Artifact</dt><dd><code>${escapeHtml(successClosure.closureArtifactRef)}</code></dd></div><div><dt>Closure Digest</dt><dd><code>${escapeHtml(successClosure.closureDigest)}</code></dd></div><div><dt>关闭时间</dt><dd>${escapeHtml(formatTime(successClosure.closedAt))}</dd></div></dl></section>` : ""}
      ${failureClosure ? `<section class="journey-section"><div class="trace-heading"><div><p class="eyebrow">Failure Closure</p><h3>失败闭环 Artifact</h3></div><span>${escapeHtml(failureClosure.outcome)}</span></div><dl class="machine-node-facts"><div><dt>Closure Artifact</dt><dd><code>${escapeHtml(failureClosure.closureArtifactRef)}</code></dd></div><div><dt>Closure Digest</dt><dd><code>${escapeHtml(failureClosure.closureDigest)}</code></dd></div><div><dt>Knowledge</dt><dd><code>${escapeHtml(failureClosure.knowledgeDispositionDigest)}</code></dd></div><div><dt>关闭时间</dt><dd>${escapeHtml(formatTime(failureClosure.closedAt))}</dd></div></dl></section>` : ""}
      ${recovery ? `<section class="journey-section"><div class="trace-heading"><div><p class="eyebrow">Recovery Successor</p><h3>合法接管记录</h3></div><span>原 Projection 未改写</span></div><dl class="machine-node-facts"><div><dt>Source Invocation</dt><dd><code>${escapeHtml(recovery.sourceInvocationId)}</code></dd></div><div><dt>停滞命令</dt><dd>${escapeHtml(recovery.stalledCommand)} · #${recovery.stalledCommandIndex}</dd></div><div><dt>Invocation Fact</dt><dd><code>${escapeHtml(recovery.invocationFactDigest)}</code></dd></div><div><dt>Source Projection</dt><dd><code>${escapeHtml(recovery.sourceProjectionDigest)}</code></dd></div><div><dt>恢复动作</dt><dd>${escapeHtml(recovery.action)}</dd></div></dl>${recovery.predecessorWorkflowRef ? `<p class="result-ref"><span>前序恢复</span><code>${escapeHtml(recovery.predecessorWorkflowRef)}</code></p>` : ""}</section>` : ""}
      ${archive ? `<section class="journey-section"><div class="trace-heading"><div><p class="eyebrow">Archive Effect</p><h3>${escapeHtml(archiveStatusLabel(archive.status))}</h3></div><span>Attempt ${archive.attempts}</span></div><dl class="machine-node-facts"><div><dt>Effect ID</dt><dd><code>${escapeHtml(archive.effectId)}</code></dd></div>${archive.receiptRef ? `<div><dt>Receipt</dt><dd><code>${escapeHtml(archive.receiptRef)}</code></dd></div>` : ""}${archive.receiptDigest ? `<div><dt>Receipt Digest</dt><dd><code>${escapeHtml(archive.receiptDigest)}</code></dd></div>` : ""}${archive.error ? `<div><dt>错误</dt><dd>${escapeHtml(archive.error)}</dd></div>` : ""}</dl></section>` : ""}
    </div>
  </details>`;
}

function renderCodingTrace(trace, summary) {
  closeAgentEventsDialog(false);
  const task = trace.task;
  const workflowRef = `${trace.durableRuntime.workflowService}/${trace.durableRuntime.workflowKey}`;
  const sessionRef = trace.agent?.sessionId || "等待 Agent Session";
  const mergeRef = trace.git.mergeCommit ? shortSha(trace.git.mergeCommit) : "等待合入";
  const artifacts = trace.technical.artifacts.map(artifact => `
    <li><span>${escapeHtml(artifact.kind)}</span><code>${escapeHtml(artifact.artifactRef)}</code><small>${escapeHtml(shortDigest(artifact.contentDigest))}${artifact.bytes === undefined ? "" : ` · ${artifact.bytes} B`}</small>${artifact.downloadUrl && artifact.kind !== "agent-events" ? `<a href="${escapeAttribute(artifact.downloadUrl)}" target="_blank" rel="noreferrer">打开 ↗</a>` : ""}</li>`).join("");
  const rawModelIo = trace.technical.artifacts.find(artifact => artifact.kind === "raw-model-io" && artifact.downloadUrl);
  const actions = trace.recovery.actions.map(action => `
    <li><strong>${escapeHtml(action.label)}</strong><span class="tag ${action.automatic ? "blue" : "yellow"}">${action.automatic ? "自动" : "人工"}</span><p>${escapeHtml(action.reason)}</p></li>`).join("");

  renderTaskDetailHeader(task, summary.title || task.taskId, [
    ["状态", taskStateLabel(task.state), task.state === "CLOSED" ? "success" : task.state === "FAILED" ? "danger" : "progress"],
    ["归档", archiveStatusLabel(task.archiveStatus), task.archiveStatus === "ARCHIVED" ? "success" : "neutral"],
    ["Workflow", workflowRef],
    ["Session", sessionRef],
    ["Commit", mergeRef],
  ]);
  elements.detail.innerHTML = renderTaskDetailTabs(task.taskId, {
    canvas: `${task.error ? `<p class="error-box"><strong>失败原因：</strong>${escapeHtml(task.error)}<br><span>下一步：${escapeHtml(trace.recovery.summary)}</span></p>` : ""}
      ${renderStateMachine(trace.stateMachine, trace)}`,
    deliverables: renderCodingExecutionLedger(trace),
    workflow: renderWorkflowStatePanel(trace.business.events, trace.stateMachine),
    diagnostics: `<section class="advanced-panel task-tab-surface"><div class="tab-panel-heading"><span>高级诊断</span><small>Restate Journal、恢复建议、Trace 与原始定位信息</small></div><div class="advanced-content">
        <section><p class="subheading">任务关联链</p><div class="correlation-strip" aria-label="任务关联链">${correlationNode("任务", task.taskId)}<span aria-hidden="true">→</span>${correlationNode("工作流", workflowRef)}<span aria-hidden="true">→</span>${correlationNode("Agent 会话", sessionRef)}<span aria-hidden="true">→</span>${correlationNode("合入提交", mergeRef)}</div></section>
        <section class="diagnostic-actions" aria-label="诊断入口"><div><small>Trace ID</small><code>${escapeHtml(trace.observability.traceId)}</code></div>${trace.observability.enabled && trace.observability.uiBaseUrl ? `<a href="${escapeAttribute(trace.observability.uiBaseUrl)}" target="_blank" rel="noreferrer">打开 Trace（Phoenix）↗</a>` : `<span class="diagnostic-disabled">Trace 后端未启用</span>`}${rawModelIo ? `<a class="sensitive-link" href="${escapeAttribute(rawModelIo.downloadUrl)}" target="_blank" rel="noreferrer">查看 Raw Model IO（敏感）↗</a>` : ""}</section>
        <section><div class="trace-heading"><div><p class="eyebrow">Restate 定位</p><h3>耐久执行与中断恢复</h3></div><span>执行证据</span></div><p class="trace-note">Restate Journal 负责记录执行与重放；任务是否完成，以 Moye 的业务投影为准。</p><code class="wide-code">${escapeHtml(trace.durableRuntime.workflowRef)}</code>${trace.durableRuntime.invocationsUrl ? `<a class="runtime-link" href="${escapeAttribute(trace.durableRuntime.invocationsUrl)}" target="_blank" rel="noreferrer">在 Restate 中打开这个任务 ↗</a>` : ""}</section>
        <section class="recovery ${trace.recovery.classification === "NONE" ? "settled" : "attention"}"><div class="trace-heading"><div><p class="eyebrow">恢复判断</p><h3>${escapeHtml(recoveryLabel(trace.recovery.classification))}</h3></div><span>只读建议</span></div><p>${escapeHtml(trace.recovery.summary)}</p>${actions ? `<ul class="action-list">${actions}</ul>` : ""}</section>
        <section><p class="subheading">技术 Artifact</p><ul class="artifact-list">${artifacts || "<li>尚无技术 Artifact</li>"}</ul></section>
      </div></section>`,
  });

  bindTaskDetailTabs(task.taskId);
  bindExecutionLedger(task.taskId);
  bindStateMachineGraph(trace.stateMachine, trace);
  bindAgentEventsDialog(trace);
}

function renderDomainEventPanel(events, machine, expanded = false) {
  const historyBySequence = new Map(machine.history.map(item => [item.sequence, item]));
  const rows = events.map(event => {
    const transition = historyBySequence.get(event.sequence);
    const edge = transition ? machine.definition.edges.find(item => item.from === transition.from && item.to === transition.to) : undefined;
    const transitionLabel = transition ? `${transition.from} → ${transition.to}` : "没有状态迁移";
    const summary = domainEventSummary(event, transition, edge);
    const detail = event.detail || transition?.detail;
    return `<li class="domain-event-row">
      <span class="domain-event-sequence">#${String(event.sequence).padStart(2, "0")}</span>
      <div class="domain-event-body">
        <div class="domain-event-heading"><strong>${escapeHtml(summary)}</strong><time datetime="${escapeAttribute(event.at)}">${formatTime(event.at)}</time></div>
        <div class="domain-event-route"><code>${escapeHtml(transitionLabel)}</code></div>
        <div class="domain-event-meta"><span>${escapeHtml(event.type)}</span>${transition?.kind ? `<em>${escapeHtml(machineEdgeLabel(transition.kind))}</em>` : ""}</div>
        ${detail ? `<details class="domain-event-raw"><summary>查看原始 detail</summary><pre>${escapeHtml(detail)}</pre></details>` : ""}
      </div>
    </li>`;
  }).join("");
  return `<details class="domain-events-panel"${expanded ? " open" : ""}>
    <summary><span><strong>Workflow 状态事实</strong><small>${events.length} 条 Domain Event，按 sequence 保留</small></span><em>展开时间线</em></summary>
    <div class="domain-events-intro"><strong>Domain Event 证明状态如何变化。</strong><p>默认展示业务摘要、转换和时间；原始 detail 按单条事件展开。Agent 的对话与工具输出继续在 Agent Events 弹窗中查看。</p></div>
    <ol class="domain-event-timeline">${rows || "<li class=\"domain-event-empty\">尚无 Domain Event。</li>"}</ol>
  </details>`;
}

function renderWorkflowStatePanel(events, machine) {
  return `<div class="workflow-state-stack">
    <section class="workflow-state-facts task-tab-surface" aria-labelledby="workflow-state-title">
      <div class="tab-panel-heading"><span id="workflow-state-title">Workflow 当前状态事实</span><small>${machine.current.consistency === "VERIFIED" ? "Event / Projection 一致" : "Event / Projection 不一致"}</small></div>
      ${renderMachineCurrentFacts(machine)}
    </section>
    ${renderDomainEventPanel(events, machine, true)}
  </div>`;
}

function renderMachineCurrentFacts(machine) {
  return `<dl class="machine-current">
    <div><dt>业务状态</dt><dd>${escapeHtml(machine.current.business)}</dd></div>
    <div><dt>Archive 状态</dt><dd>${escapeHtml(machine.current.archive)}</dd></div>
    <div><dt>整体落点</dt><dd>${escapeHtml(machine.current.overall)}</dd></div>
    <div><dt>Event 重建</dt><dd>${escapeHtml(machine.current.historyCurrent)}</dd></div>
  </dl>`;
}

function domainEventSummary(event, transition, edge) {
  if (edge?.label) return edge.label;
  const summaries = {
    ArchitectRequired: "任务已进入架构与规格阶段",
    ArchitectArtifactsAccepted: "Spec、Design 与 Plan 已接受",
    DesignReviewPassed: "Design Review 已通过",
    ImplementationAccepted: "实现、自审与 Candidate 已接受",
    DocumentationGateAccepted: "文档与 Docs Impact 已绑定",
    TestPlanAccepted: "测试计划已覆盖需求",
    TrustedTestRunRecorded: "Trusted Runner 已记录真实结果",
    TestVerificationPassed: "综合测试结论已通过",
    FinalReviewPassed: "最终隔离审查已通过",
    VerificationGatePassed: "确定性证据 Gate 已通过",
    KnowledgeDispositionRecorded: "Knowledge Disposition 已记录",
    MergeConfirmed: "目标分支更新已确认",
    SuccessClosureCompleted: "成功 Closure Artifact 已冻结",
    FailureClosureCompleted: "失败 Closure Artifact 已冻结",
    ArchivePending: "任务已进入独立归档",
    ArchiveArchived: "Archive Receipt 已确认",
    TaskClosed: "任务业务终态已冻结",
  };
  return summaries[event.type] || (event.step ? `${stepLabel(event.step)} 已记录业务事实` : transition ? `${transition.from} 已转移到 ${transition.to}` : "Workflow 已记录业务事实");
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
  const mismatch = machine.current.consistency !== "VERIFIED" ? `<section class="machine-consistency-alert" role="alert" aria-labelledby="machine-consistency-title">
      <div><strong id="machine-consistency-title">Event / Projection 状态不一致</strong><span>画布继续显示真实 Definition 与 History；请在 Workflow 状态事实中核对差异。</span></div>
      ${renderMachineCurrentFacts(machine)}
    </section>` : "";
  return `<section class="state-machine-section" data-machine-graph aria-labelledby="state-machine-title">
    <h3 class="visually-hidden" id="state-machine-title">合法转换与本次实际路径</h3>
    ${mismatch}
    ${renderMachineGraphCanvas(machine, transitions, trace)}
    <details class="machine-evidence-panel"><summary><span>执行实例 · ${machine.executions.length} 个</span><small>Attempt、Agent Run、Verification、Session 与 Evidence</small></summary><div class="machine-executions"><ul>${executions || "<li>这个 Workflow 没有 Agent/Attempt 执行实例。</li>"}</ul></div></details>
    <details class="machine-definition"><summary><span>查看完整合法边</span><small>实线标记本次已走过；Repair/Failure/Archive 分支不会隐藏</small></summary><ul>${edges}</ul></details>
  </section>`;
}

const TASK_MACHINE_GRAPH_SIZE = { width: 1640, height: 380 };
const CODING_MACHINE_GRAPH_SIZE = { width: 1640, height: 485 };
const CORE_V2_MACHINE_GRAPH_SIZE = { width: 1640, height: 485 };
const CODING_GRAPH_POSITIONS = {
  START: [20, 110], CONTEXT: [165, 110], WORKSPACE: [310, 110], IMPLEMENT: [455, 110],
  SELF_REVIEW: [600, 110], VERIFY: [745, 110], REVIEW: [890, 110], MERGE: [1035, 110],
  DOCS: [1180, 110], CLOSED: [1325, 110], REPLAN: [745, 0], WAITING_RECONCILE: [600, 270],
  FAILED: [790, 270], ARCHIVING: [1050, 270], ARCHIVED: [1240, 270], ARCHIVE_FAILED: [1050, 385],
};
const TASK_GRAPH_POSITIONS = {
  START: [20, 110], RECEIVED: [220, 110], EXECUTING: [420, 110], VERIFYING: [620, 110], CLOSED: [820, 110],
  ARCHIVE_PENDING: [1050, 110], ARCHIVED: [1290, 110], ARCHIVE_FAILED: [1050, 270],
};
const CORE_V2_GRAPH_POSITIONS = {
  START: [20, 110], ARCHITECT_REQUIRED: [165, 110], DESIGN_REVIEW_REQUIRED: [310, 110], IMPLEMENTATION_REQUIRED: [455, 110],
  DOCUMENTATION_REQUIRED: [600, 110], TEST_PLAN_REQUIRED: [745, 110], TEST_EXECUTION_REQUIRED: [890, 110],
  TEST_ASSESSMENT_REQUIRED: [1035, 110], FINAL_REVIEW_REQUIRED: [1180, 110], VERIFICATION_GATE_REQUIRED: [1325, 110],
  MERGE_REQUIRED: [1470, 110], REPLAN_REQUIRED: [310, 0], REPAIR_REQUIRED: [500, 270],
  WAITING_RECONCILE: [690, 270], FAILED_TERMINAL: [880, 270], ARCHIVE_PENDING: [1080, 270],
  CLOSED: [1250, 270], ARCHIVED: [1420, 270], ARCHIVE_FAILED: [1080, 385],
};

function renderMachineGraphCanvas(machine, transitions) {
  const geometry = machineGraphGeometry(machine);
  const positions = machineGraphPositions(machine);
  const traversedCount = machine.definition.edges.filter(edge => edge.traversed).length;
  const filter = (id, label, count) => `<button type="button" data-machine-filter="${id}" aria-pressed="${machineGraphUiState.filter === id}">${label}<span>${count}</span></button>`;
  const edges = machine.definition.edges.map((edge, index) => renderMachineGraphEdge(edge, index, positions, machine)).join("");
  const nodes = machine.definition.nodes.map(node => renderMachineGraphNode(node, positions.get(node.id))).join("");
  return `<div class="machine-graph-shell">
    <div class="machine-graph-toolbar">
      <div class="machine-graph-filters" role="group" aria-label="状态机路径筛选">
        ${filter("ACTUAL", "本次路径", traversedCount)}
        ${filter("NORMAL", "主流程", machine.definition.edges.filter(edge => edge.kind === "NORMAL").length)}
        ${filter("REPAIR", "恢复 / 回滚", machine.definition.edges.filter(edge => edge.kind === "REPAIR").length)}
        ${filter("FAILURE", "异常 / 失败", machine.definition.edges.filter(edge => edge.kind === "FAILURE").length)}
        ${filter("ARCHIVE", "归档", machine.definition.edges.filter(edge => edge.kind === "ARCHIVE").length)}
        ${filter("ALL", "完整状态机", machine.definition.edges.length)}
      </div>
      <div class="machine-graph-tools">
        <span class="machine-integrity ${machine.current.consistency.toLowerCase()}">${machine.current.consistency === "VERIFIED" ? "Event / Projection 一致" : "状态不一致"}</span>
        <div class="machine-graph-zoom" role="group" aria-label="画布缩放">
          <button type="button" data-machine-zoom="out" aria-label="缩小状态机画布">−</button>
          <output data-machine-zoom-label>${Math.round((machineGraphUiState.zoom ?? 1) * 100)}%</output>
          <button type="button" data-machine-zoom="in" aria-label="放大状态机画布">＋</button>
          <button type="button" data-machine-zoom="fit">适配</button>
        </div>
      </div>
    </div>
    <div class="machine-graph-legend" aria-label="状态机图例">
      <span class="legend-actual">实际经过</span><span class="legend-normal">合法主路径</span><span class="legend-repair">Repair / Replan / 恢复</span><span class="legend-failure">异常 / Reconcile / 失败</span><span class="legend-archive">Archive</span>
    </div>
    <div class="machine-graph-stage ${geometry.stageClass}" data-machine-graph-stage data-inspector-open="${machineGraphUiState.inspectorOpen}">
      <div class="machine-graph-scroll" data-machine-graph-scroll tabindex="0" aria-label="完整状态机 Graph 画布，可横向滚动">
        <svg class="machine-graph-svg" data-machine-svg viewBox="0 0 ${geometry.size.width} ${geometry.size.height}" width="${geometry.size.width}" height="${geometry.size.height}" role="img" aria-labelledby="machine-graph-svg-title machine-graph-svg-desc">
        <title id="machine-graph-svg-title">${escapeHtml(machine.workflow)} 完整状态机</title>
        <desc id="machine-graph-svg-desc">包含 ${machine.definition.nodes.length} 个状态和 ${machine.definition.edges.length} 条合法转换；本次实际经过 ${traversedCount} 条。</desc>
        <defs>
          <marker id="machine-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker>
          <filter id="machine-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <g class="machine-graph-lanes" aria-hidden="true">
          ${geometry.lanes}
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

function machineGraphGeometry(machine) {
  if (machine.workflow.startsWith("CoreV2")) {
    return {
      size: CORE_V2_MACHINE_GRAPH_SIZE,
      stageClass: "is-core-v2",
      lanes: `<rect x="18" y="78" width="1604" height="126" rx="16" class="lane-business"/><text x="40" y="101">BUSINESS / HAPPY PATH</text>
        <rect x="470" y="235" width="575" height="145" rx="16" class="lane-recovery"/><text x="490" y="258">RECOVERY / EXCEPTION</text>
        <rect x="1045" y="235" width="577" height="235" rx="16" class="lane-archive"/><text x="1065" y="258">ARCHIVE</text>`,
    };
  }
  if (machine.workflow === "CodingTaskWorkflow") {
    return {
      size: CODING_MACHINE_GRAPH_SIZE,
      stageClass: "is-coding",
      lanes: `<rect x="18" y="78" width="1450" height="126" rx="16" class="lane-business"/><text x="40" y="101">BUSINESS / HAPPY PATH</text>
        <rect x="570" y="235" width="365" height="145" rx="16" class="lane-recovery"/><text x="590" y="258">RECOVERY / EXCEPTION</text>
        <rect x="1015" y="235" width="607" height="235" rx="16" class="lane-archive"/><text x="1035" y="258">ARCHIVE</text>`,
    };
  }
  return {
    size: TASK_MACHINE_GRAPH_SIZE,
    stageClass: "is-task",
    lanes: `<rect x="18" y="78" width="980" height="126" rx="16" class="lane-business"/><text x="40" y="101">BUSINESS / HAPPY PATH</text>
      <rect x="1015" y="78" width="607" height="276" rx="16" class="lane-archive"/><text x="1035" y="101">ARCHIVE</text>`,
  };
}

function machineGraphPositions(machine) {
  const source = machine.workflow.startsWith("CoreV2") ? CORE_V2_GRAPH_POSITIONS : machine.workflow === "CodingTaskWorkflow" ? CODING_GRAPH_POSITIONS : TASK_GRAPH_POSITIONS;
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
  const state = node.status === "CURRENT" ? "当前状态" : node.status === "VISITED" ? "本次经过" : "合法但本次未发生";
  return `<foreignObject x="${x}" y="${y}" width="136" height="84">
    <button xmlns="http://www.w3.org/1999/xhtml" type="button" class="machine-graph-node status-${node.status.toLowerCase()} domain-${node.domain.toLowerCase()} ${node.terminal ? "terminal" : ""}" data-machine-node="${escapeHtml(node.id)}" data-machine-node-status="${escapeHtml(node.status)}" aria-label="${escapeHtml(`${node.label}，${state}`)}" aria-pressed="false">
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
  if (["FAILED", "FAILED_TERMINAL"].includes(edge.to)) {
    const bend = edge.to === "FAILED_TERMINAL" ? 405 + (index % 3) * 10 : 510 + (index % 5) * 12;
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
  if (["FAILED", "FAILED_TERMINAL"].includes(edge.to)) return [(fx + tx) / 2, Math.max(fy, ty) - 24];
  if (edge.to === "WAITING_RECONCILE" || edge.from === "WAITING_RECONCILE") return [(fx + tx) / 2, (fy + ty) / 2];
  return [(fx + tx) / 2, (fy + ty) / 2 - 15];
}

function renderMachineNodeInspector(machine, nodeId, trace) {
  const node = machine.definition.nodes.find(item => item.id === nodeId) || machine.definition.nodes[0];
  if (!node) return "";
  const prioritizeTraversed = items => [...items].sort((left, right) => Number(right.traversed) - Number(left.traversed));
  const incoming = prioritizeTraversed(machine.definition.edges.filter(edge => edge.to === node.id));
  const outgoing = prioritizeTraversed(machine.definition.edges.filter(edge => edge.from === node.id));
  const actualIncoming = incoming.filter(edge => edge.traversed);
  const actualOutgoing = outgoing.filter(edge => edge.traversed);
  const history = machine.history.filter(item => item.from === node.id || item.to === node.id);
  const executions = machine.executions.filter(item => machineExecutionBelongsToNode(item, node.id));
  const agentExecutions = executions.filter(item => machineSessionForExecution(item, trace));
  const technicalExecutions = executions.filter(item => !machineSessionForExecution(item, trace));
  const edgeItems = (items, direction) => items.map(edge => renderMachineTransitionRow(edge, direction, machine)).join("");
  return `<header><div><span>${escapeHtml(node.domain)} · ${node.terminal ? "终态" : "可转换状态"}</span><h4>${escapeHtml(node.label)}</h4><code>${escapeHtml(node.id)}</code></div><div class="machine-inspector-actions"><strong class="status-${node.status.toLowerCase()}">${node.status === "CURRENT" ? "当前" : node.status === "VISITED" ? "已进入" : "未进入"}</strong><button type="button" data-machine-inspector-close aria-label="关闭节点详情">关闭详情</button></div></header>
    <div class="machine-inspector-counts" aria-label="节点事实计数"><span><strong>${agentExecutions.length}</strong> Agent</span><span><strong>${history.length}</strong> 状态记录</span><span><strong>${executions.length}</strong> 执行实例</span></div>
    ${agentExecutions.length ? `<section class="machine-node-section machine-node-agent-section"><div class="machine-node-section-heading"><p class="machine-node-section-kicker">Agent activity</p><h5>Agent 活动</h5><p>来自这个节点实际 Run / Session 的对话、工具调用、工具结果、系统和错误事件。</p></div><div class="machine-agent-activities">${agentExecutions.map(item => renderMachineAgentActivity(item, trace)).join("")}</div></section>` : ""}
    ${agentExecutions.length ? "" : renderMachineSystemOwner(node.id)}
    ${renderMachineControlFacts(trace, node.id)}
    ${history.length ? `<section class="machine-node-section"><div class="machine-node-section-heading"><p class="machine-node-section-kicker">Workflow facts</p><h5>状态流转记录</h5><p><strong>Domain Event</strong> 是 Workflow 写入的业务事实，只证明这个状态如何进入和离开；它不是 Agent 的聊天或工具日志。</p></div><ol class="machine-node-events">${history.map(item => `<li><span class="sequence">#${String(item.sequence).padStart(2, "0")}</span><div><strong>${escapeHtml(item.from)} → ${escapeHtml(item.to)}</strong><small>${escapeHtml(item.eventType)} · ${formatTime(item.at)}</small>${item.detail ? `<details class="machine-node-event-detail"><summary>原始 detail</summary><code>${escapeHtml(item.detail)}</code></details>` : ""}</div></li>`).join("")}</ol></section>` : `<p class="machine-node-empty"><strong>本次运行没有进入这个状态。</strong><span>只展示代码允许的合法转换，不会虚构 Agent、Session、Attempt 或 Evidence。</span></p>`}
    ${technicalExecutions.length ? `<details class="machine-node-technical"><summary>执行 ID 与 Evidence <span>${technicalExecutions.length}</span></summary><div class="machine-node-executions">${technicalExecutions.map(item => renderMachineExecutionDetail(item, trace)).join("")}</div></details>` : ""}
    ${(actualIncoming.length || actualOutgoing.length) ? `<section class="machine-node-route-proof"><header><span>本次节点路径</span><strong>${actualIncoming.length + actualOutgoing.length} 条 Event 证据</strong></header><ol>${edgeItems([...actualIncoming, ...actualOutgoing], "actual")}</ol></section>` : ""}
    <details class="machine-node-transitions"><summary><span>合法转换</span><small>进入 ${incoming.length} · 离开 ${outgoing.length}</small></summary><p class="machine-transition-help">这里列出代码允许的路径；“本次经过”必须有 Workflow Event 证明。</p><div class="machine-transition-groups">
      <section><header><span>进入</span><strong>${incoming.length}</strong></header><ol>${edgeItems(incoming, "in") || '<li class="machine-transition-empty">这是起始状态，没有合法进入路径。</li>'}</ol></section>
      <section><header><span>离开</span><strong>${outgoing.length}</strong></header><ol>${edgeItems(outgoing, "out") || '<li class="machine-transition-empty">这是终止状态，没有合法离开路径。</li>'}</ol></section>
    </div></details>`;
}

function renderMachineSystemOwner(nodeId) {
  const descriptions = {
    START: "Task Intake 由 owning Workflow 建立，不运行角色 Agent。",
    TEST_EXECUTION_REQUIRED: "Trusted Runner 执行冻结 argv 并写入 Manifest，不依赖 Agent 自述测试结果。",
    VERIFICATION_GATE_REQUIRED: "Verification Gate 只校验最终 Revision、Candidate、Artifact 与 Evidence 绑定。",
    MERGE_REQUIRED: "Git Merge Effect 以稳定 effect ID 更新目标 ref，并在回执未知时先对账。",
    REPAIR_REQUIRED: "Workflow 根据 Blocking Finding 授权新的 Implementation Generation。",
    REPLAN_REQUIRED: "Workflow 使旧 Revision Evidence 失效，并授权新的 Spec Revision。",
    WAITING_RECONCILE: "Workflow 冻结当前副作用并等待正确 token 的外部事实对账。",
    FAILED_TERMINAL: "Workflow 冻结原始失败后，只允许 Failure Closure 与 Archive 继续。",
    ARCHIVE_PENDING: "Archive Effect 独立持久化 Closure package，不重新执行研发步骤。",
    ARCHIVE_FAILED: "只允许使用同一 Effect token 重试 Archive。",
    CLOSED: "业务 Closure 已冻结，任务主流程不再接受新的执行结果。",
    ARCHIVED: "Archive Receipt 已确认，这是唯一可查询的归档终态。",
  };
  const description = descriptions[nodeId];
  if (!description) return "";
  return `<section class="machine-node-owner"><strong>系统执行节点</strong><p>${escapeHtml(description)}</p></section>`;
}

function renderMachineTransitionRow(edge, direction, machine) {
  const transition = machine.history.find(item => item.from === edge.from && item.to === edge.to);
  const state = edge.traversed ? `本次经过 · #${transition?.sequence ?? "?"}` : "合法但未发生";
  return `<li class="machine-transition-row kind-${edge.kind.toLowerCase()} ${edge.traversed ? "traversed" : ""}">
    <span class="machine-transition-direction">${direction === "in" ? "进入" : direction === "out" ? "离开" : "实际"}</span>
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
    sessionUrl: session.sessionUrl,
    timelineUrl: session.timelineUrl,
    stderrUrl: session.stderrUrl,
    kind,
    binding: `${execution.attemptId || execution.id} · ${execution.sessionId || "等待 Session"}`,
    runnerKind: execution.producer || session.runnerKind,
    label: "查看全部 Agent Events",
  });
  return `<article class="machine-agent-activity">
    <header><div><span class="machine-agent-mark" aria-hidden="true">A</span><div><small>${escapeHtml(roleLabel(kind))}</small><h6>${escapeHtml(runnerLabel(execution.producer || session.runnerKind))}</h6></div></div><strong class="state-${executionColor(execution.state)}">${escapeHtml(execution.state)}</strong></header>
    <div class="machine-agent-glance"><span>Session <code>${escapeHtml(execution.sessionId || "等待建立")}</code></span>${execution.startedAt ? `<span>${formatDuration(execution.startedAt, execution.finishedAt)}</span>` : ""}${execution.generation === undefined ? "" : `<span>Generation ${execution.generation}</span>`}${verdict ? `<span>${escapeHtml(verdict)}</span>` : ""}</div>
    <div class="machine-agent-primary-action">${eventButton}</div>
    ${summary ? `<p class="machine-agent-summary">${escapeHtml(summary)}</p>` : ""}
    ${findings ? `<p class="machine-agent-findings">${escapeHtml(findings)}</p>` : ""}
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
  const lifecycle = trace.lifecycle;
  const artifact = kind => lifecycle?.artifacts?.find(item => item.kind === kind);
  const addArtifact = (kind, label) => {
    const record = artifact(kind);
    if (record?.artifactDigest) rows.push([label, record.artifactDigest, true]);
  };
  if (nodeId === "START" && lifecycle) {
    rows.push(["Task", lifecycle.taskId]);
    rows.push(["规格版本", `R${lifecycle.specRevision}`]);
    if (lifecycle.subjectCommit) rows.push(["基线提交", lifecycle.subjectCommit, true]);
  }
  if (nodeId === "ARCHITECT_REQUIRED") {
    addArtifact("SPEC", "Spec Artifact");
    addArtifact("DESIGN", "Design Artifact");
    addArtifact("PLAN", "Plan Artifact");
  }
  if (nodeId === "DESIGN_REVIEW_REQUIRED") addArtifact("DESIGN_REVIEW", "Design Review");
  if (nodeId === "IMPLEMENTATION_REQUIRED" && lifecycle) {
    if (lifecycle.candidateCommit) rows.push(["Candidate Commit", lifecycle.candidateCommit, true]);
    const checkpoint = lifecycle.implementationCheckpoints?.at(-1);
    if (checkpoint?.checkpointRef) rows.push(["Checkpoint", checkpoint.checkpointRef, true]);
    if (checkpoint?.treeDigest) rows.push(["Tree Digest", checkpoint.treeDigest, true]);
    if (checkpoint?.selfReview?.verdict) rows.push(["Self Review", checkpoint.selfReview.verdict]);
  }
  if (nodeId === "DOCUMENTATION_REQUIRED") addArtifact("DOCS_IMPACT", "Docs Impact");
  if (nodeId === "TEST_PLAN_REQUIRED") addArtifact("TEST_PLAN", "Test Plan");
  if (nodeId === "TEST_EXECUTION_REQUIRED" && lifecycle) {
    const runs = lifecycle.trustedTestRuns || (lifecycle.trustedTestRun ? [lifecycle.trustedTestRun] : []);
    rows.push(["测试执行次数", String(runs.length)]);
    runs.forEach((run, index) => {
      if (run.manifestDigest) rows.push([`Manifest ${index + 1}`, run.manifestDigest, true]);
      if (run.manifestRef) details.push(`<li><strong>Trusted Runner ${index + 1}</strong><code>${escapeHtml(run.manifestRef)}</code></li>`);
    });
  }
  if (nodeId === "TEST_ASSESSMENT_REQUIRED") addArtifact("TEST_REPORT", "Test Report");
  if (nodeId === "FINAL_REVIEW_REQUIRED") addArtifact("FINAL_REVIEW", "Final Review");
  if (nodeId === "VERIFICATION_GATE_REQUIRED" && lifecycle) {
    rows.push(["规格版本", `R${lifecycle.specRevision}`]);
    if (lifecycle.candidateCommit) rows.push(["Candidate Commit", lifecycle.candidateCommit, true]);
    if (lifecycle.verificationGateDigest) rows.push(["Gate Digest", lifecycle.verificationGateDigest, true]);
  }
  if (nodeId === "MERGE_REQUIRED" && lifecycle?.mergeReceipt) {
    rows.push(["Merge Effect", lifecycle.mergeReceipt.effectId, true]);
    rows.push(["Target Ref", lifecycle.mergeReceipt.targetRef, true]);
    rows.push(["Merge Commit", lifecycle.mergeReceipt.mergeCommit, true]);
    rows.push(["结果", lifecycle.mergeReceipt.reconciledAfterUnknown ? "对账确认" : lifecycle.mergeReceipt.outcome]);
  }
  if (nodeId === "REPAIR_REQUIRED" && lifecycle) rows.push(["已失效 Generation", String(lifecycle.invalidatedGenerations?.length || 0)]);
  if (nodeId === "REPLAN_REQUIRED" && lifecycle) rows.push(["已失效 Revision", String(lifecycle.invalidatedRevisions?.length || 0)]);
  if (nodeId === "FAILED_TERMINAL" && lifecycle?.failure) {
    rows.push(["失败阶段", lifecycle.failure.originalStage]);
    rows.push(["Failure Digest", lifecycle.failure.failureDigest, true]);
    if (lifecycle.failure.reason) details.push(`<li><strong>原始失败原因</strong><span>${escapeHtml(lifecycle.failure.reason)}</span></li>`);
  }
  if (nodeId === "CLOSED" && lifecycle) {
    const closure = lifecycle.successClosure || lifecycle.failureClosure;
    if (lifecycle.outcome) rows.push(["业务 Outcome", lifecycle.outcome]);
    if (closure?.closureDigest) rows.push(["Closure Digest", closure.closureDigest, true]);
    if (closure?.closureArtifactRef) rows.push(["Closure Artifact", closure.closureArtifactRef, true]);
  }
  if (["ARCHIVE_PENDING", "ARCHIVE_FAILED", "ARCHIVED"].includes(nodeId) && lifecycle?.archive) {
    rows.push(["Archive 状态", lifecycle.archive.status]);
    rows.push(["Archive Attempt", String(lifecycle.archive.attempts)]);
    if (lifecycle.archive.effectId) rows.push(["Archive Effect", lifecycle.archive.effectId, true]);
    if (lifecycle.archive.receiptDigest) rows.push(["Receipt Digest", lifecycle.archive.receiptDigest, true]);
    if (lifecycle.archive.error) details.push(`<li><strong>Archive 错误</strong><span>${escapeHtml(lifecycle.archive.error)}</span></li>`);
  }
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
  return `<section class="machine-node-section machine-node-control"><div class="machine-node-section-heading"><p class="machine-node-section-kicker">Control plane</p><h5>系统管控与结果</h5><p>Workflow、Gate、Trusted Runner、Git 与 Archive 对这个节点的真实约束。</p></div><dl class="machine-node-facts">${rows.map(([label, value, code]) => `<div><dt>${escapeHtml(label)}</dt><dd>${code ? `<code>${escapeHtml(value)}</code>` : escapeHtml(value)}</dd></div>`).join("")}</dl>${details.length ? `<ul class="machine-node-control-list">${details.join("")}</ul>` : ""}</section>`;
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
      if (trace?.traceKind === "CODING" || trace?.traceKind === "CORE_V2") {
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
    const visibleNodes = new Set();
    machine.definition.edges.forEach(edge => {
      const visible = filter === "ALL" || (filter === "ACTUAL" ? edge.traversed : edge.kind === filter);
      if (visible) {
        visibleNodes.add(edge.from);
        visibleNodes.add(edge.to);
      }
    });
    section.querySelectorAll("[data-machine-node]").forEach(button => {
      const keep = filter === "ALL" || visibleNodes.has(button.dataset.machineNode) || button.dataset.machineNodeStatus === "CURRENT";
      button.classList.toggle("is-filter-muted", !keep);
    });
  };
  section.querySelectorAll("[data-machine-filter]").forEach(button => button.addEventListener("click", () => applyFilter(button.dataset.machineFilter)));

  const applyZoom = value => {
    const graphSize = machineGraphGeometry(machine).size;
    machineGraphUiState.zoom = Math.min(1.6, Math.max(.5, value));
    svg.style.width = `${graphSize.width * machineGraphUiState.zoom}px`;
    svg.style.height = `${graphSize.height * machineGraphUiState.zoom}px`;
    section.querySelector("[data-machine-zoom-label]").textContent = `${Math.round(machineGraphUiState.zoom * 100)}%`;
  };
  const fitZoom = () => {
    const graphSize = machineGraphGeometry(machine).size;
    const available = Math.min(1, scroll.clientWidth / graphSize.width, scroll.clientHeight / graphSize.height);
    return Math.max(.66, available);
  };
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

function sessionEventsButton({ eventsUrl, sessionUrl, timelineUrl, stderrUrl, kind, binding, runnerKind, label = "在弹窗查看对话" }) {
  if (!eventsUrl && !(sessionUrl && timelineUrl)) return '<span class="session-events-unavailable">Session Evidence 尚未就绪</span>';
  return `<button type="button" class="session-events-trigger" data-agent-events-trigger${eventsUrl ? ` data-agent-events-url="${escapeAttribute(eventsUrl)}"` : ""}${sessionUrl ? ` data-agent-session-url="${escapeAttribute(sessionUrl)}"` : ""}${timelineUrl ? ` data-agent-timeline-url="${escapeAttribute(timelineUrl)}"` : ""}${stderrUrl ? ` data-agent-stderr-url="${escapeAttribute(stderrUrl)}"` : ""} data-agent-events-kind="${escapeHtml(kind)}" data-agent-events-binding="${escapeHtml(`${binding} · ${runnerLabel(runnerKind)}`)}" data-agent-events-runner="${escapeHtml(runnerKind)}" aria-controls="agent-events-dialog" aria-haspopup="dialog" aria-expanded="false">${escapeHtml(label)}</button>`;
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
      sessionUrl: trigger.dataset.agentSessionUrl,
      timelineUrl: trigger.dataset.agentTimelineUrl,
      stderrUrl: trigger.dataset.agentStderrUrl,
      kind: trigger.dataset.agentEventsKind || "AGENT",
      binding: trigger.dataset.agentEventsBinding || "等待 Session",
      runnerKind: trigger.dataset.agentEventsRunner || "",
    }));
  });
}

function openAgentEventsDialog(trigger, source) {
  if (source.sessionUrl && source.timelineUrl) {
    openManagedSessionDialog(trigger, source);
    return;
  }
  openExecutionEventsDialog(trigger, source);
}

function openExecutionEventsDialog(trigger, source) {
  if (!source.sourceUrl) return;
  closeAgentEventsDialog(false);
  const viewer = elements.eventsViewer;
  const dialog = elements.eventsDialog;
  viewer.dataset.mode = "execution";
  viewer.dataset.sourceUrl = source.sourceUrl;
  viewer.dataset.state = "loading";
  viewer.querySelector("[data-agent-events-title]").textContent = `${roleLabel(source.kind)} · Execution Stream`;
  viewer.querySelector("[data-agent-events-task]").textContent = source.taskId;
  viewer.querySelector("[data-agent-events-binding]").textContent = source.binding;
  const context = viewer.querySelector("[data-agent-session-context]");
  context.hidden = true;
  context.replaceChildren();
  viewer.querySelector("[data-agent-events-toolbar]").replaceChildren();
  viewer.querySelector("[data-agent-events-content]").innerHTML = '<div class="agent-events-loading" role="status">正在加载会话消息与工具事件…</div>';
  viewer.querySelector("[data-agent-events-footer]").replaceChildren();
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

function openManagedSessionDialog(trigger, source) {
  closeAgentEventsDialog(false);
  const viewer = elements.eventsViewer;
  const dialog = elements.eventsDialog;
  viewer.dataset.mode = "session";
  viewer.dataset.state = "loading";
  viewer.querySelector("[data-agent-events-title]").textContent = `${roleLabel(source.kind)} · Session Timeline`;
  viewer.querySelector("[data-agent-events-task]").textContent = source.taskId;
  viewer.querySelector("[data-agent-events-binding]").textContent = source.binding;
  viewer.querySelector("[data-agent-events-toolbar]").replaceChildren();
  viewer.querySelector("[data-agent-events-content]").innerHTML = '<div class="agent-events-loading" role="status">正在校验 Session Receipt 与 Transcript Manifest…</div>';
  viewer.querySelector("[data-agent-events-footer]").replaceChildren();
  const context = viewer.querySelector("[data-agent-session-context]");
  context.hidden = false;
  context.innerHTML = '<div class="agent-session-context-loading">正在读取受管 Session Metadata…</div>';
  setAgentEventsStatus(viewer, "正在校验");
  agentEventsReturnFocus = trigger;
  updateAgentEventsTrigger(trigger, true, true);
  const state = {
    metadata: undefined,
    cursor: 0,
    transcriptTotal: 0,
    events: [],
    stderr: undefined,
    stderrLoaded: false,
    hasMore: false,
    filter: "all",
    loading: false,
    stopped: false,
    timer: 0,
  };
  stopAgentEventsFollower = () => {
    state.stopped = true;
    if (state.timer) window.clearTimeout(state.timer);
  };
  const scheduleMetadata = () => {
    if (state.stopped || !dialog.open) return;
    state.timer = window.setTimeout(() => void loadMetadata(), 1200);
  };
  const loadMetadata = async () => {
    if (state.loading || state.stopped) return;
    state.loading = true;
    viewer.dataset.state = "loading";
    try {
      state.metadata = await fetchSessionJson(source.sessionUrl);
      if (state.stopped) return;
      const semantics = requireSessionSemantics(state.metadata);
      renderManagedSessionContext(context, state.metadata);
      if (["PENDING", "WAITING_RECONCILE"].includes(semantics.availability.state)) {
        viewer.dataset.state = "waiting";
        setAgentEventsStatus(viewer, sessionAvailabilityLabel(semantics.availability.state));
        viewer.querySelector("[data-agent-events-content]").innerHTML = `<div class="agent-events-empty agent-session-waiting"><strong>${escapeHtml(sessionAvailabilityLabel(semantics.availability.state))}</strong><span>${escapeHtml(sessionAvailabilityMessage(semantics.availability))}</span></div>`;
        scheduleMetadata();
        return;
      }
      if (semantics.availability.state !== "AVAILABLE") {
        renderManagedSessionUnavailable(viewer, trigger, source, state.metadata);
        return;
      }
      if (!state.stderrLoaded) {
        state.stderrLoaded = true;
        try { state.stderr = await fetchSessionJson(source.stderrUrl); }
        catch (error) { state.stderr = { error: sessionErrorMessage(error) }; }
      }
      await loadTimeline(true);
    } catch (error) {
      renderManagedSessionError(viewer, error, () => void loadMetadata(), trigger, source);
    } finally {
      state.loading = false;
      if (!state.stopped) updateAgentEventsTrigger(trigger, true);
    }
  };
  const loadTimeline = async drain => {
    if (state.stopped) return;
    try {
      do {
        const url = new URL(source.timelineUrl, window.location.origin);
        url.searchParams.set("cursor", String(state.cursor));
        url.searchParams.set("limit", "200");
        const page = await fetchSessionJson(url.toString());
        if (state.stopped) return;
        const known = new Set(state.events.map(event => event.eventId));
        state.events.push(...page.events.filter(event => !known.has(event.eventId)));
        state.cursor = page.nextCursor;
        state.transcriptTotal = page.total;
        state.hasMore = page.hasMore;
        if (!drain) break;
      } while (state.hasMore);
      const semantics = requireSessionSemantics(state.metadata);
      viewer.dataset.state = `${semantics.availability.state.toLowerCase()}-${(semantics.content.state || "not-evaluated").toLowerCase()}`;
      renderManagedSessionState(viewer, state, loadTimeline);
    } catch (error) {
      renderManagedSessionError(viewer, error, () => void loadTimeline(false), trigger, source);
    }
  };
  dialog.showModal();
  void loadMetadata();
}

async function fetchSessionJson(input) {
  const response = await fetch(new URL(input, window.location.origin), { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error;
    const error = new Error(detail?.message || `读取失败（HTTP ${response.status}）`);
    error.code = detail?.code || `HTTP_${response.status}`;
    error.status = response.status;
    error.semantics = detail?.semantics;
    error.action = detail?.action;
    throw error;
  }
  return body;
}

function renderManagedSessionContext(target, metadata) {
  target.hidden = false;
  const semantics = requireSessionSemantics(metadata);
  const completeness = metadata.completeness || {};
  const relationships = metadata.relationships || { parentSessionIds: [], childSessionIds: [] };
  const raw = metadata.artifacts?.raw;
  const diagnostics = {
    receiptState: metadata.state,
    promptBinding: metadata.promptBinding,
    completeness: metadata.completeness,
    metrics: metadata.metrics,
    errors: metadata.errors,
    authorityScope: metadata.authorityScope,
    receiptDigest: metadata.receiptDigest,
    manifestDigest: metadata.manifestDigest,
    artifacts: metadata.artifacts,
  };
  target.innerHTML = `<section class="agent-session-semantic-summary" aria-label="Session Evidence 四维状态">
    <div class="agent-session-semantic-badges">
      ${sessionSemanticBadge("可用性", semantics.availability.state)}
      ${sessionSemanticBadge("内容", semantics.content.evaluated ? semantics.content.state : "NOT_EVALUATED")}
      ${sessionSemanticBadge("绑定", semantics.binding.state)}
      ${sessionSemanticBadge("限制", semantics.limitation.state)}
    </div>
    <p>${escapeHtml(sessionSemanticSummary(metadata, semantics))}</p>
    ${renderSessionContentReasons(semantics.content.reasons)}
    ${renderSessionLimitation(semantics.limitation)}
  </section>
  <div class="agent-session-statusline">
    <span>${escapeHtml(metadata.provider || "Provider 未确认")}</span>
    <code title="${escapeHtml(metadata.providerSessionId || "")}">${escapeHtml(shortSessionId(metadata.providerSessionId))}</code>
    <span>${escapeHtml(capturePolicyLabel(metadata.capturePolicy))}</span>
    <span>${escapeHtml(sessionImportModeLabel(metadata.importMode))}</span>
  </div>
  <details class="agent-session-metadata">
    <summary>来源与 Artifact Metadata</summary>
    <div class="agent-session-metadata-grid">
      <dl><div><dt>Provider Session</dt><dd><code>${escapeHtml(metadata.providerSessionId || "未确认")}</code></dd></div><div><dt>Source</dt><dd>${escapeHtml(metadata.source?.kind || "未发布")} · ${metadata.source?.recordCount ?? 0} records</dd></div><div><dt>Parser</dt><dd>${escapeHtml(metadata.parser ? `${metadata.parser.name}@${metadata.parser.version}` : "未发布")}</dd></div><div><dt>Captured</dt><dd>${metadata.capturedAt ? formatTime(metadata.capturedAt) : "—"}</dd></div></dl>
      <dl><div><dt>Messages</dt><dd>${escapeHtml(completeness.messages || "NOT_EVALUATED")}</dd></div><div><dt>Tools</dt><dd>${escapeHtml(completeness.tools || "NOT_EVALUATED")}</dd></div><div><dt>Timestamps</dt><dd>${escapeHtml(completeness.timestamps || "NOT_EVALUATED")}</dd></div><div><dt>Hierarchy</dt><dd>${escapeHtml(completeness.hierarchy || "NOT_EVALUATED")}</dd></div></dl>
      <dl><div><dt>Parent Session</dt><dd>${renderSessionIdList(relationships.parentSessionIds)}</dd></div><div><dt>Child Session</dt><dd>${renderSessionIdList(relationships.childSessionIds)}</dd></div>${raw ? `<div><dt>Raw Metadata</dt><dd><code>${escapeHtml(shortDigest(raw.digest))}</code> · ${raw.byteLength} B</dd></div>` : ""}<div><dt>Manifest</dt><dd><code>${escapeHtml(shortDigest(metadata.manifestDigest || metadata.receiptDigest || "—"))}</code></dd></div></dl>
    </div>
  </details>
  <details class="agent-session-diagnostics">
    <summary>高级诊断 · 原始 Receipt / Manifest 事实</summary>
    <p>以下字段保持封存 Evidence 的原始语义；它们不会覆盖上方四维判定。</p>
    <pre>${escapeHtml(JSON.stringify(diagnostics, null, 2))}</pre>
  </details>`;
}

function requireSessionSemantics(metadata) {
  const semantics = metadata?.semantics;
  if (semantics?.schemaVersion !== 1 || !semantics.availability?.state || !semantics.content || !semantics.binding?.state || !semantics.limitation?.state) {
    const error = new Error("Session API 未返回版本化四维语义；页面拒绝从 legacy 字段猜测。");
    error.code = "SESSION_SEMANTICS_MISSING";
    throw error;
  }
  return semantics;
}

function sessionSemanticBadge(label, value) {
  const tone = semanticTone(value);
  return `<span class="agent-session-semantic-badge tone-${tone}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || "NOT_EVALUATED")}</strong></span>`;
}

function semanticTone(value) {
  if (["AVAILABLE", "COMPLETE", "VERIFIED", "NONE"].includes(value)) return "green";
  if (["PENDING", "WAITING_RECONCILE", "UNVERIFIED", "PARTIAL", "NOT_EXPOSED", "OMITTED_BY_POLICY", "REDACTED"].includes(value)) return "yellow";
  if (["UNAVAILABLE", "FAILED"].includes(value)) return "red";
  return "neutral";
}

function sessionSemanticSummary(metadata, semantics) {
  const availability = semantics.availability.state;
  if (availability !== "AVAILABLE") return sessionAvailabilityMessage(semantics.availability);
  if (semantics.content.state === "PARTIAL") {
    const count = semantics.content.reasons?.length || 0;
    return `会话内容可读，但检测到 ${count} 项内容缺口；页面不会补造缺失内容。${semantics.binding.state === "UNVERIFIED" ? " Prompt 与 Attempt 的强绑定同时无法追溯验证。" : ""}`;
  }
  if (semantics.binding.state === "UNVERIFIED") {
    return metadata.importMode === "HISTORICAL_ENRICHMENT"
      ? "会话内容可读；由于该历史任务创建时尚未冻结 Prompt Envelope，Prompt 与 Attempt 的强绑定无法追溯验证。"
      : "会话内容可读；Prompt 与 Attempt 的强绑定尚未验证。";
  }
  return "会话内容完整可读，Prompt 与 Attempt 已由 pre-execution Prompt Envelope 验证。";
}

function renderSessionContentReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) return "";
  return `<div class="agent-session-content-gaps"><strong>内容缺口</strong><ul>${reasons.map(reason => `<li>${escapeHtml(sessionContentReasonLabel(reason))}</li>`).join("")}</ul></div>`;
}

function sessionContentReasonLabel(reason) {
  const dimension = ({ messages: "消息", tools: "工具", timestamps: "时间戳", hierarchy: "会话层级", raw: "Raw source" })[reason?.dimension] || reason?.dimension;
  if (reason?.kind === "DIMENSION_PARTIAL") return `${dimension}仅部分可用`;
  if (reason?.kind === "DIMENSION_UNAVAILABLE") return `${dimension}不可用`;
  if (reason?.kind === "PARSE_ERRORS") return `Parser 错误 ${reason.count} 项`;
  if (reason?.kind === "UNKNOWN_EVENTS") return `未知 canonical Event ${reason.count} 项`;
  if (reason?.kind === "DROPPED_EVENTS") return `丢弃 source record ${reason.count} 项`;
  if (reason?.kind === "TERMINAL_MARKER_ABSENT") return "Provider 终止标记缺失";
  if (reason?.kind === "CAPTURE_ERROR") return `Capture Error ${reason.errorCode || "UNKNOWN"} · ${reason.errorScope || "UNKNOWN"}`;
  return reason?.kind || "未识别内容缺口";
}

function renderSessionLimitation(limitation) {
  const reasons = Array.isArray(limitation?.reasons) ? limitation.reasons : [];
  if (limitation?.state === "NONE" || reasons.length === 0) return "";
  return `<div class="agent-session-limitation"><strong>策略 / Provider 边界</strong><ul>${reasons.map(reason => `<li>${escapeHtml(sessionLimitationMessage(reason))}</li>`).join("")}</ul></div>`;
}

function sessionLimitationMessage(value) {
  return ({
    OMITTED_BY_POLICY: "原始正文按 Capture Policy 省略；这是策略处置，不是采集丢失。",
    REDACTED: "正文按确定性规则脱敏；这是策略处置，不是采集丢失。",
    NOT_EXPOSED: "Provider 未暴露对应维度；这属于能力边界，不是采集丢失。",
  })[value] || value;
}

function renderSessionIdList(values) {
  return Array.isArray(values) && values.length ? values.map(value => `<code>${escapeHtml(value)}</code>`).join(" ") : "无";
}

function renderManagedSessionUnavailable(viewer, trigger, source, metadata) {
  const semantics = requireSessionSemantics(metadata);
  viewer.dataset.state = "unavailable";
  setAgentEventsStatus(viewer, sessionAvailabilityLabel(semantics.availability.state));
  viewer.querySelector("[data-agent-events-toolbar]").replaceChildren();
  viewer.querySelector("[data-agent-events-content]").innerHTML = `<div class="agent-events-error agent-session-unavailable" role="status"><strong>${escapeHtml(sessionAvailabilityLabel(semantics.availability.state))}</strong><p>${escapeHtml(sessionAvailabilityMessage(semantics.availability))}</p><button type="button" data-agent-execution-fallback>查看 Execution Stream</button></div>`;
  viewer.querySelector("[data-agent-events-footer]").replaceChildren();
  viewer.querySelector("[data-agent-execution-fallback]")?.addEventListener("click", () => openExecutionEventsDialog(trigger, { ...source, sessionUrl: undefined, timelineUrl: undefined, stderrUrl: undefined }));
}

function renderManagedSessionError(viewer, error, retry, trigger, source) {
  viewer.dataset.state = "error";
  const message = sessionErrorMessage(error);
  const context = viewer.querySelector("[data-agent-session-context]");
  if (context?.querySelector(".agent-session-context-loading")) {
    context.hidden = true;
    context.replaceChildren();
  }
  setAgentEventsStatus(viewer, "读取失败");
  const integrity = error?.semantics?.availability?.reason === "ARTIFACT_INTEGRITY_FAILED";
  const action = error?.action || (integrity ? "核对受管 Artifact allowlist 与 Digest；不要为 Transcript 故障重跑 Agent。" : "重试读取同一 Evidence，或查看独立 Execution Stream。");
  viewer.querySelector("[data-agent-events-content]").innerHTML = `<div class="agent-events-error" role="alert"><strong>${integrity ? "Session Artifact 完整性校验失败" : "Session Evidence 暂时无法读取"}</strong><p>${escapeHtml(message)}</p><p class="agent-session-error-action">${escapeHtml(action)}</p><div class="agent-session-error-actions"><button type="button" data-agent-events-retry>重新加载</button><button type="button" data-agent-execution-fallback>查看 Execution Stream</button></div></div>`;
  viewer.querySelector("[data-agent-events-retry]")?.addEventListener("click", retry, { once: true });
  viewer.querySelector("[data-agent-execution-fallback]")?.addEventListener("click", () => openExecutionEventsDialog(trigger, { ...source, sessionUrl: undefined, timelineUrl: undefined, stderrUrl: undefined }));
}

function sessionErrorMessage(error) {
  return `${error?.code ? `${error.code} · ` : ""}${error instanceof Error ? error.message : String(error)}`;
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

function renderManagedSessionState(viewer, state, loadTimeline) {
  const target = viewer.querySelector("[data-agent-events-content]");
  const events = managedSessionEvents(state);
  const visible = state.filter === "all" ? events : events.filter(event => managedEventFilter(event) === state.filter);
  const semantics = requireSessionSemantics(state.metadata);
  const status = semantics.content.state === "PARTIAL" ? `内容存在 ${semantics.content.reasons.length} 项缺口` : "内容完整";
  setAgentEventsStatus(viewer, `已加载 ${state.events.length} / ${state.transcriptTotal} 条 · ${status}`);
  const categories = [
    ["all", "全部"],
    ["human", "Prompt / 用户"],
    ["assistant", "Assistant"],
    ["tool_call", "工具调用"],
    ["tool_result", "工具结果"],
    ["system", "系统"],
    ["error", "错误 / stderr"],
  ];
  const toolbar = viewer.querySelector("[data-agent-events-toolbar]");
  toolbar.innerHTML = categories.map(([id, label]) => {
    const count = id === "all" ? events.length : events.filter(event => managedEventFilter(event) === id).length;
    return `<button type="button" data-agent-session-filter="${id}" class="${state.filter === id ? "active" : ""}" aria-pressed="${state.filter === id}">${label}<span>${count}</span></button>`;
  }).join("");
  toolbar.querySelectorAll("[data-agent-session-filter]").forEach(button => button.addEventListener("click", () => {
    state.filter = button.dataset.agentSessionFilter;
    renderManagedSessionState(viewer, state, loadTimeline);
  }));
  if (events.length === 0) {
    target.innerHTML = '<div class="agent-events-empty">Manifest 已确认，但 canonical Timeline 与 stderr 都没有可展示内容。</div>';
  } else if (visible.length === 0) {
    target.innerHTML = '<div class="agent-events-empty">这个筛选条件没有事件；切换“全部”可查看完整受管 Timeline。</div>';
  } else {
    target.innerHTML = `<ol class="agent-events-list agent-session-list" aria-label="Agent Session canonical 时间线">${visible.map(renderManagedSessionEvent).join("")}</ol>`;
  }
  const footer = viewer.querySelector("[data-agent-events-footer]");
  footer.innerHTML = state.hasMore
    ? '<button type="button" data-agent-session-more>加载后续 200 条</button><button type="button" data-agent-session-all>加载完整 Timeline</button>'
    : `<span>${semantics.content.state === "PARTIAL" ? "受管 Timeline 已加载；内容缺口以上方 Domain reasons 为准" : "内容完整的受管 Timeline 已加载"}${state.stderr?.error ? ` · stderr：${escapeHtml(state.stderr.error)}` : ""}</span>`;
  footer.querySelector("[data-agent-session-more]")?.addEventListener("click", () => void loadTimeline(false));
  footer.querySelector("[data-agent-session-all]")?.addEventListener("click", () => void loadTimeline(true));
}

function managedSessionEvents(state) {
  const events = [...state.events];
  if (state.stderr?.content) {
    events.push({
      schemaVersion: 1,
      sequence: state.transcriptTotal + 1,
      eventId: `stderr:${state.stderr.digest}`,
      eventDigest: state.stderr.digest,
      occurredAt: state.metadata?.capturedAt,
      timestampState: state.metadata?.capturedAt ? "PROVIDED" : "MISSING",
      category: "STDERR",
      actor: "RUNTIME",
      origin: "MOYE_RUNTIME",
      source: { providerType: "role-stderr", recordSequence: 0, partIndex: 0, recordDigest: state.stderr.digest },
      parts: [{ kind: "TEXT", content: { disposition: "FULL", storedValue: state.stderr.content, originalDigest: state.stderr.digest, contentDigest: state.stderr.digest, originalByteLength: state.stderr.byteLength, storedByteLength: state.stderr.byteLength } }],
    });
  }
  return events;
}

function managedEventFilter(event) {
  if (["PROMPT", "USER"].includes(event.category)) return "human";
  if (event.category === "ASSISTANT") return "assistant";
  if (event.category === "TOOL_CALL") return "tool_call";
  if (event.category === "TOOL_RESULT") return "tool_result";
  if (["ERROR", "STDERR"].includes(event.category)) return "error";
  return "system";
}

function renderManagedSessionEvent(event) {
  const speaker = managedEventSpeaker(event);
  const sequence = String(event.sequence).padStart(2, "0");
  const values = (event.parts || []).map(part => part?.content?.storedValue).filter(value => typeof value === "string" && value.length);
  const joined = values.join("\n\n");
  const unavailable = (event.parts || []).filter(part => !part?.content?.storedValue);
  const preview = joined ? truncateManagedContent(joined, 1100) : unavailable.length
    ? unavailable.map(part => `${contentDispositionLabel(part.content?.disposition)} · ${shortDigest(part.content?.originalDigest || part.content?.contentDigest || "—")}`).join("\n")
    : "该 canonical Event 没有可展示正文。";
  const tool = (event.parts || []).find(part => part.toolName || part.toolCallId);
  const technical = {
    eventId: event.eventId,
    eventDigest: event.eventDigest,
    source: event.source,
    correlation: event.correlation,
    parts: (event.parts || []).map(part => ({ kind: part.kind, toolName: part.toolName, toolCallId: part.toolCallId, disposition: part.content?.disposition, originalDigest: part.content?.originalDigest, storedDigest: part.content?.storedDigest })),
  };
  const categoryClass = event.category.toLowerCase();
  return `<li class="agent-event category-${escapeHtml(categoryClass)} speaker-${escapeHtml(speaker.id)}">
    <span class="agent-event-avatar" aria-hidden="true">${escapeHtml(speaker.mark)}</span>
    <article class="agent-event-bubble">
      <div class="agent-event-heading"><strong>${escapeHtml(speaker.label)}</strong><em>${escapeHtml(managedCategoryLabel(event.category))}</em><span>#${sequence}${event.occurredAt ? ` · ${formatTime(event.occurredAt)}` : " · 无时间"}</span></div>
      <div class="agent-event-origin"><span>${escapeHtml(originLabel(event.origin))}</span>${tool?.toolName ? `<strong>${escapeHtml(tool.toolName)}</strong>` : ""}${tool?.toolCallId ? `<code>${escapeHtml(shortDigest(tool.toolCallId))}</code>` : ""}</div>
      <p>${escapeHtml(preview)}</p>
      ${joined.length > 1100 ? `<details class="agent-event-full-content"><summary>展开完整内容 · ${joined.length} 字符</summary><pre>${escapeHtml(joined)}</pre></details>` : ""}
      <details><summary>Evidence 与内容处置</summary><pre>${escapeHtml(JSON.stringify(technical, null, 2))}</pre></details>
    </article>
  </li>`;
}

function managedEventSpeaker(event) {
  if (["PROMPT", "USER"].includes(event.category) || event.actor === "USER") return { id: "user", mark: "U", label: event.category === "PROMPT" ? "Moye Prompt" : "用户" };
  if (event.category === "ASSISTANT" || event.actor === "ASSISTANT") return { id: "agent", mark: "A", label: "Assistant" };
  if (event.category === "TOOL_CALL") return { id: "tool", mark: "T", label: "工具调用" };
  if (event.category === "TOOL_RESULT") return { id: "tool-result", mark: "R", label: "工具结果" };
  if (["ERROR", "STDERR"].includes(event.category)) return { id: "error", mark: "!", label: event.category === "STDERR" ? "Runtime stderr" : "错误" };
  return { id: "system", mark: "S", label: "系统" };
}

function managedCategoryLabel(category) {
  return ({ PROMPT: "Prompt", USER: "用户输入", ASSISTANT: "Assistant", TOOL_CALL: "工具调用", TOOL_RESULT: "工具结果", SYSTEM: "系统", ERROR: "错误", STDERR: "stderr", OTHER: "其他" })[category] || category;
}

function originLabel(origin) {
  return ({ MOYE_RENDERED_PROMPT: "Moye 渲染输入", PROVIDER_USER: "Provider 用户记录", PROVIDER_ASSISTANT: "Provider Assistant", PROVIDER_TOOL: "Provider 工具记录", PROVIDER_SYSTEM: "Provider 系统记录", MOYE_RUNTIME: "Moye Runtime", UNKNOWN: "来源未确认" })[origin] || origin || "来源未确认";
}

function contentDispositionLabel(value) {
  return ({ FULL: "正文已保存", REDACTED: "正文已脱敏", DIGEST_ONLY: "仅保存摘要" })[value] || "正文不可用";
}

function truncateManagedContent(value, limit) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function capturePolicyLabel(value) {
  return ({ full: "Full capture", redacted: "Redacted capture", digest_only: "Digest-only capture" })[value] || "Capture policy 未发布";
}

function sessionImportModeLabel(value) {
  return ({ LIVE: "实时证据", HISTORICAL_ENRICHMENT: "历史补全 Sidecar" })[value] || "证据来源未发布";
}

function sessionAvailabilityLabel(value) {
  return ({ AVAILABLE: "Session Evidence 可读", PENDING: "等待 Transcript Capture", WAITING_RECONCILE: "等待 Capture 对账", UNAVAILABLE: "Transcript 不可用", FAILED: "Transcript Evidence 失败" })[value] || value;
}

function sessionAvailabilityMessage(availability) {
  return ({
    CAPTURE_PENDING: "Capture 尚未产生 Receipt；页面只刷新同一 Evidence，不会启动第二个 Agent Run。",
    CAPTURE_WAITING_RECONCILE: "Capture 结果未知，必须先对账同一 Attempt；不能盲目重试或重跑 Agent。",
    TRANSCRIPT_UNAVAILABLE: "Provider Transcript 不可用；可以查看独立 Execution Stream，但页面不会把它冒充完整对话。",
    CAPTURE_FAILED: "Transcript Capture 已失败；请检查 Capture 诊断，不要因此重跑已经完成的 Agent。",
    ARTIFACT_INTEGRITY_FAILED: "受管 Artifact 完整性校验失败；请核对 allowlist 与 Digest，不要重跑 Agent。",
    EVIDENCE_READABLE: "Session Evidence 已通过受管 Artifact 校验。",
  })[availability?.reason] || "Session Evidence 状态未确认。";
}

function shortSessionId(value) {
  if (!value) return "Session 未确认";
  return value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function renderAgentEventsState(viewer, state, loadPage) {
  const target = viewer.querySelector("[data-agent-events-content]");
  const visible = state.filter === "all" ? state.events : state.events.filter(event => event.category === state.filter);
  setAgentEventsStatus(viewer, `已加载 ${state.events.length} / ${state.total} 条 · ${state.completed ? "已完成" : "实时跟随中"}`);
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
  return ({ RECEIVED: "已接收", EXECUTING: "执行中", RUNNING: "执行中", WAITING_RECONCILE: "等待对账", VERIFYING: "验证中", ARCHIVE_PENDING: "归档中", ARCHIVE_FAILED: "归档失败", FAILED_TERMINAL: "失败终态", FAILED: "已失败", SUCCEEDED: "成功归档", CLOSED: "已关闭" })[state] || state;
}

function workflowKindLabel(kind) {
  return ({ CORE_V2: "Core v2", CODING: "Coding", SEALED_TASK: "Sealed", TASK: "Task", CORE: "Core", UNKNOWN: "Legacy" })[kind] || kind || "Legacy";
}

function backlogStatusLabel(status) {
  return ({ DRAFT: "草稿", READY: "待调度", SCHEDULED: "已派发", BLOCKED: "已阻塞", CLOSED: "已关闭" })[status] || status;
}

function archiveStatusLabel(status) {
  return ({ NOT_STARTED: "未开始归档", NOT_READY: "归档未就绪", PENDING: "等待归档", ARCHIVING: "归档中", ARCHIVED: "已归档", FAILED: "归档失败" })[status] || status;
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
    ARCHITECT: "Architect",
    DESIGN_REVIEW: "Design Review",
    IMPLEMENTATION: "Implementation",
    SELF_REVIEW: "Self Review",
    INDEPENDENT_REVIEW: "Independent Review",
    REPLAN: "Replan",
    DOCUMENTATION: "Documentation",
    DOCS_GATE: "Docs Gate",
    TEST_PLAN: "Test Plan",
    TEST_ASSESSMENT: "Test Assessment",
    FINAL_REVIEW: "Final Review",
    OBSERVER_KNOWLEDGE: "Observer / Knowledge",
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
  if (state === "CLOSED" || state === "SUCCEEDED") return "green";
  if (state === "FAILED" || state === "FAILED_TERMINAL" || state === "ARCHIVE_FAILED") return "red";
  if (state === "VERIFYING" || state === "RUNNING" || state === "EXECUTING") return "blue";
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

function formatCompactDuration(startedAt, finishedAt) {
  const started = new Date(startedAt).getTime();
  const finished = new Date(finishedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return "—";
  const duration = Math.max(0, finished - started);
  if (duration < 1000) return `${duration} ms`;
  let seconds = Math.floor(duration / 1000);
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  const parts = [];
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 时`);
  if (minutes) parts.push(`${minutes} 分`);
  if (seconds || parts.length === 0) parts.push(`${seconds} 秒`);
  return parts.slice(0, 2).join(" ");
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
