const elements = {
  dot: document.querySelector("#connection-dot"),
  connection: document.querySelector("#connection-label"),
  project: document.querySelector("#project-id"),
  active: document.querySelector("#active-count"),
  pending: document.querySelector("#pending-count"),
  generated: document.querySelector("#generated-at"),
  empty: document.querySelector("#empty-state"),
  dialog: document.querySelector("#task-detail"),
  detail: document.querySelector("#detail-content"),
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
  { id: "VERIFY", label: "自动验证", description: "运行固定命令并固化验证证据" },
  { id: "MERGE", label: "合入分支", description: "检查 Git 事实并合入目标分支" },
  { id: "DOCS", label: "文档检查", description: "确认关联文档、影响声明与知识沉淀" },
  { id: "ARCHIVE", label: "归档", description: "固化结果与回执，完成闭环" },
];

let lastProjectionSignature = "";
let stopAgentEventsFollower = () => {};
let agentEventsReturnFocus;
let shouldRestoreAgentEventsFocus = true;
elements.dialog.addEventListener("close", () => closeAgentEventsDialog(false));
elements.eventsDialog.addEventListener("close", () => {
  const returnFocus = agentEventsReturnFocus;
  stopAgentEventsFollower();
  stopAgentEventsFollower = () => {};
  if (returnFocus instanceof HTMLButtonElement) updateAgentEventsTrigger(returnFocus, false);
  agentEventsReturnFocus = undefined;
  if (shouldRestoreAgentEventsFocus && elements.dialog.open && returnFocus?.isConnected) {
    window.requestAnimationFrame(() => returnFocus.focus());
  }
  shouldRestoreAgentEventsFocus = true;
});
document.querySelector("#refresh").addEventListener("click", loadBoard);
await loadBoard();
setInterval(loadBoard, 5000);

async function loadBoard() {
  try {
    const response = await fetch("/api/board", { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    renderBoard(await response.json());
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
  card.innerHTML = `
    <div class="card-meta"><span>${escapeHtml(task.taskId)}</span><span>R${task.specRevision}</span></div>
    <h3>${escapeHtml(task.title)}</h3>
    <div class="card-footer">
      <span class="tag ${stateColor(task.state)}">${escapeHtml(taskStateLabel(task.state))}</span>
      <span class="tag ${archiveColor(task.archiveStatus)}">${escapeHtml(archiveStatusLabel(task.archiveStatus))}</span>
    </div>`;
  card.addEventListener("click", () => openTask(task));
  return card;
}

function cardShell(index, tagName) {
  const card = document.createElement(tagName);
  card.className = "card";
  card.style.setProperty("--index", String(index));
  return card;
}

async function openTask(summary) {
  try {
    const taskId = summary.taskId;
    const traceResponse = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/trace`, { cache: "no-store" });
    if (traceResponse.ok) {
      renderCodingTrace(await traceResponse.json(), summary);
      elements.dialog.showModal();
      return;
    }
    if (traceResponse.status !== 409) throw new Error(`轨迹查询失败（${traceResponse.status}）`);
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`任务查询失败（${response.status}）`);
    renderLegacyTask(await response.json());
    elements.dialog.showModal();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements.detail.innerHTML = `
      <span class="detail-id">轨迹暂不可用</span>
      <h2 class="detail-title">暂时无法读取任务详情</h2>
      <p class="error-box">${escapeHtml(message)}</p>
      <p class="trace-note"><strong>下一步：</strong>确认 Moye 服务与 Restate Ingress 正常，然后点击“刷新投影”重试。任务状态不会因此改变。</p>`;
    elements.dialog.showModal();
  }
}

function renderLegacyTask(task) {
  const events = task.events.map(event => `
    <li><span class="sequence">${String(event.sequence).padStart(2, "0")}</span><strong>${escapeHtml(event.type)}</strong><time>${formatTime(event.at)}</time></li>`).join("");
  elements.detail.innerHTML = `
    <span class="detail-id">${escapeHtml(task.taskId)} · 规格版本 R${task.specRevision}</span>
    <h2 class="detail-title">${escapeHtml(task.title)}</h2>
    <p class="legacy-note"><strong>基础任务生命周期</strong>　这个任务不是 Coding Task，因此没有 Agent、Worktree、验证和 Git 合入轨迹。</p>
    <div class="detail-grid">
      <div><span>任务状态</span><strong>${escapeHtml(taskStateLabel(task.state))}</strong></div>
      <div><span>归档状态</span><strong>${escapeHtml(archiveStatusLabel(task.archiveStatus))}</strong></div>
      <div><span>当前步骤</span><strong>${escapeHtml(task.currentStep)}</strong></div>
      <div><span>执行次数</span><strong>${task.attempt}</strong></div>
      <div><span>工作流定位</span><strong>TaskWorkflow/${escapeHtml(task.taskId)}</strong></div>
      <div><span>需求来源</span><strong>${task.backlogRefs.map(escapeHtml).join(", ") || "—"}</strong></div>
    </div>
    ${task.archivePath ? `<p class="result-ref"><span>归档结果</span><code>${escapeHtml(task.archivePath)}</code></p>` : ""}
    ${task.error ? `<p class="error-box">${escapeHtml(task.error)}</p>` : ""}
    <p class="eyebrow">持久化事件轨迹</p>
    <ol class="timeline">${events}</ol>`;
}

function renderCodingTrace(trace, summary) {
  closeAgentEventsDialog(false);
  const task = trace.task;
  const conclusion = task.state === "CLOSED" && task.archiveStatus === "ARCHIVED"
    ? { icon: "✓", title: "任务已闭环", text: "编码、验证、合入、文档与归档证据均已确认。", tone: "success" }
    : task.state === "FAILED"
      ? { icon: "!", title: "任务已停止，需要处理", text: trace.recovery.summary, tone: "danger" }
      : { icon: "●", title: `任务正在${stepLabel(task.currentStep)}`, text: trace.recovery.summary, tone: "progress" };
  const workflowRef = `${trace.durableRuntime.workflowService}/${trace.durableRuntime.workflowKey}`;
  const sessionRef = trace.agent?.sessionId || "等待 Agent Session";
  const mergeRef = trace.git.mergeCommit ? shortSha(trace.git.mergeCommit) : "等待合入";
  const journey = PIPELINE_STAGES.map((definition, index) => renderJourneyStage(trace, definition, index)).join("");
  const events = trace.business.events.map(event => `
    <li><span class="sequence">${String(event.sequence).padStart(2, "0")}</span><strong>${escapeHtml(event.type)}</strong><span>${escapeHtml(stepLabel(event.step))}</span><time>${formatTime(event.at)}</time></li>`).join("");
  const artifacts = trace.technical.artifacts.map(artifact => `
    <li><span>${escapeHtml(artifact.kind)}</span><code>${escapeHtml(artifact.artifactRef)}</code><small>${escapeHtml(shortDigest(artifact.contentDigest))}${artifact.bytes === undefined ? "" : ` · ${artifact.bytes} B`}</small>${artifact.downloadUrl ? `<a href="${escapeAttribute(artifact.downloadUrl)}" target="_blank" rel="noreferrer">${artifact.kind === "agent-events" ? "下载原始 JSONL" : "打开 ↗"}</a>` : ""}</li>`).join("");
  const agentEvents = trace.agentEvents;
  const rawModelIo = trace.technical.artifacts.find(artifact => artifact.kind === "raw-model-io" && artifact.downloadUrl);
  const actions = trace.recovery.actions.map(action => `
    <li><strong>${escapeHtml(action.label)}</strong><span class="tag ${action.automatic ? "blue" : "yellow"}">${action.automatic ? "自动" : "人工"}</span><p>${escapeHtml(action.reason)}</p></li>`).join("");

  elements.detail.innerHTML = `
    <span class="detail-id">${escapeHtml(task.taskId)} · 规格版本 R${task.specRevision}</span>
    <h2 class="detail-title">${escapeHtml(summary.title || task.taskId)}</h2>
    <section class="task-conclusion ${conclusion.tone}" aria-label="任务结论">
      <span class="conclusion-icon" aria-hidden="true">${conclusion.icon}</span>
      <div><strong>${escapeHtml(conclusion.title)}</strong><p>${escapeHtml(conclusion.text)}</p></div>
    </section>
    <div class="correlation-strip" aria-label="任务关联链">
      ${correlationNode("任务", task.taskId)}<span aria-hidden="true">→</span>
      ${correlationNode("工作流", workflowRef)}<span aria-hidden="true">→</span>
      ${correlationNode("Agent 会话", sessionRef)}<span aria-hidden="true">→</span>
      ${correlationNode("合入提交", mergeRef)}
    </div>
    <div class="detail-grid overview-grid">
      <div><span>任务状态</span><strong>${escapeHtml(taskStateLabel(task.state))}</strong></div>
      <div><span>当前阶段</span><strong>${escapeHtml(stepLabel(task.currentStep))}</strong></div>
      <div><span>Agent 类型</span><strong>${escapeHtml(runnerLabel(trace.agent?.runnerKind))}</strong></div>
      <div><span>归档状态</span><strong>${escapeHtml(archiveStatusLabel(task.archiveStatus))}</strong></div>
    </div>
    ${task.error ? `<p class="error-box"><strong>失败原因：</strong>${escapeHtml(task.error)}<br><span>下一步：${escapeHtml(trace.recovery.summary)}</span></p>` : ""}

    <section class="diagnostic-actions" aria-label="诊断入口">
      <div><small>Trace ID</small><code>${escapeHtml(trace.observability.traceId)}</code></div>
      ${trace.observability.enabled && trace.observability.uiBaseUrl
        ? `<a href="${escapeAttribute(trace.observability.uiBaseUrl)}" target="_blank" rel="noreferrer">打开 Trace（Phoenix）↗</a>`
        : `<span class="diagnostic-disabled">Trace 后端未启用</span>`}
      ${agentEvents ? `<button type="button" class="diagnostic-link" data-agent-events-trigger aria-controls="agent-events-dialog" aria-haspopup="dialog" aria-expanded="false">查看 Agent Events</button>` : ""}
      ${rawModelIo ? `<a class="sensitive-link" href="${escapeAttribute(rawModelIo.downloadUrl)}" target="_blank" rel="noreferrer">查看 Raw Model IO（敏感）↗</a>` : ""}
    </section>
    <p class="trace-note">Trace 与 JSONL 只用于诊断；任务状态以 Moye Projection / Domain Event 为准，中断恢复以 Restate Journal 为准。</p>

    <section class="journey-section" aria-labelledby="journey-title">
      <div class="trace-heading"><div><p class="eyebrow">任务执行旅程</p><h3 id="journey-title">七个阶段，一眼看清做到哪里</h3></div><span>点击阶段查看证据</span></div>
      <div class="journey">${journey}</div>
    </section>

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
          <p class="subheading">业务事件</p>
          <ol class="timeline coding-timeline">${events}</ol>
        </section>
      </div>
    </details>`;

  bindAgentEventsDialog(trace);
}

function bindAgentEventsDialog(trace) {
  const trigger = elements.detail.querySelector("[data-agent-events-trigger]");
  if (!(trigger instanceof HTMLButtonElement) || trace.agentEvents === undefined) return;
  trigger.addEventListener("click", () => openAgentEventsDialog(trigger, trace));
}

function openAgentEventsDialog(trigger, trace) {
  closeAgentEventsDialog(false);
  const viewer = elements.eventsViewer;
  const dialog = elements.eventsDialog;
  const agentEvents = trace.agentEvents;
  viewer.dataset.sourceUrl = agentEvents.viewUrl;
  viewer.dataset.downloadUrl = agentEvents.downloadUrl || agentEvents.viewUrl.replace(/\/agent-events$/, "/artifacts/agent-events");
  viewer.dataset.state = "loading";
  viewer.querySelector("[data-agent-events-task]").textContent = trace.task.taskId;
  viewer.querySelector("[data-agent-events-binding]").textContent = `${trace.agent?.attemptId || "等待 Attempt"} · ${runnerLabel(trace.agent?.runnerKind)}`;
  viewer.querySelector("[data-agent-events-toolbar]").replaceChildren();
  viewer.querySelector("[data-agent-events-content]").innerHTML = '<div class="agent-events-loading" role="status">正在加载原始 JSONL 事件…</div>';
  viewer.querySelector("[data-agent-events-footer]").replaceChildren();
  const download = viewer.querySelector("[data-agent-events-download]");
  download.href = agentEvents.downloadUrl || "#";
  download.hidden = !agentEvents.downloadUrl;
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
    target.innerHTML = `<ol class="agent-events-list">${visible.map(renderAgentEvent).join("")}</ol>`;
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
    return `<li class="agent-event category-${escapeHtml(event.category)}">
      <div class="agent-event-heading"><span>${sequence}</span><em>${escapeHtml(categoryLabel(event.category))}</em><strong>${escapeHtml(event.type)}</strong></div>
      <p>${escapeHtml(eventSummary(event.parsed, event.type))}</p>
      <details><summary>查看完整原始 JSON</summary><pre>${escapeHtml(JSON.stringify(event.parsed, null, 2))}</pre></details>
    </li>`;
  }
  return `<li class="agent-event malformed">
    <div class="agent-event-heading"><span>${sequence}</span><em>错误</em><strong>无法解析的 JSON 行</strong></div>
    <p>这一行不是有效 JSON，已按原始文本完整保留。</p>
    <details><summary>查看完整原始文本</summary><pre>${escapeHtml(event.raw)}</pre></details>
  </li>`;
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
  return normalized.length > 280 ? `${normalized.slice(0, 277)}…` : normalized;
}

function setAgentEventsStatus(viewer, value) {
  const status = viewer.querySelector("[data-agent-events-status]");
  if (status) status.textContent = value;
}

function updateAgentEventsTrigger(trigger, expanded, loading = false) {
  trigger.disabled = loading;
  trigger.setAttribute("aria-expanded", String(expanded));
  trigger.textContent = loading ? "正在加载 Agent Events…" : expanded ? "Agent Events 已打开" : "查看 Agent Events";
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
  if (stepId === "VERIFY") facts = trace.verification
    ? `<p><strong>验证结论：</strong>${trace.verification.passed ? "✓ 全部通过" : `! ${escapeHtml(trace.verification.code || "未通过")}`}<br>${trace.verification.commands.map(command => `<code>${escapeHtml(command.commandId)}</code> → exit ${command.exitCode ?? "signal"}，${command.durationMs} ms`).join("<br>")}</p>`
    : `<p>尚无验证结果。</p>`;
  if (stepId === "MERGE") facts = `<p><strong>结果提交：</strong><code>${escapeHtml(shortSha(trace.git.resultCommit))}</code><br><strong>合入提交：</strong><code>${escapeHtml(shortSha(trace.git.mergeCommit))}</code></p>`;
  if (stepId === "DOCS") facts = `<p><strong>文档证据：</strong>${evidence.length ? `${evidence.length} 项已绑定` : "尚未绑定"}</p>`;
  if (stepId === "ARCHIVE") facts = `<p><strong>归档状态：</strong>${escapeHtml(archiveStatusLabel(trace.task.archiveStatus))}<br><strong>闭环结论：</strong>${trace.task.state === "CLOSED" && trace.task.archiveStatus === "ARCHIVED" ? "任务结果与归档回执均已确认" : "等待归档回执"}</p>`;
  const evidenceList = evidence.length ? `<ul class="evidence-list">${evidence.map(record => `<li><span>${escapeHtml(record.artifactName)}</span><code>${escapeHtml(shortDigest(record.contentDigest))}</code></li>`).join("")}</ul>` : "";
  return `${facts}${common}${attempt?.error ? `<p class="error-box"><strong>这个阶段失败：</strong>${escapeHtml(attempt.error)}<br><span>下一步：${escapeHtml(trace.recovery.summary)}</span></p>` : ""}${evidenceList}`;
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
  return ({ RECEIVED: "已接收", RUNNING: "执行中", VERIFYING: "验证中", FAILED: "已失败", CLOSED: "已关闭" })[state] || state;
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
