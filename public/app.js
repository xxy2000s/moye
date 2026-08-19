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
};

const lanes = {
  backlog: [document.querySelector("#backlog-list"), document.querySelector("#backlog-count")],
  active: [document.querySelector("#active-list"), document.querySelector("#active-lane-count")],
  archivePending: [document.querySelector("#pending-list"), document.querySelector("#pending-lane-count")],
  archived: [document.querySelector("#archived-list"), document.querySelector("#archived-count")],
};
let lastProjectionSignature = "";

document.querySelector("#refresh").addEventListener("click", loadBoard);
await loadBoard();
setInterval(loadBoard, 5000);

async function loadBoard() {
  try {
    const response = await fetch("/api/board", { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    const board = await response.json();
    renderBoard(board);
    elements.dot.className = "connection-dot online";
    elements.connection.textContent = "Runtime online";
  } catch (error) {
    elements.dot.className = "connection-dot offline";
    elements.connection.textContent = "Runtime unavailable";
    console.error(error);
  }
}

function renderBoard(board) {
  elements.project.textContent = board.projectId;
  elements.active.textContent = String(board.active.length);
  elements.pending.textContent = String(board.archivePending.length);
  elements.generated.textContent = formatTime(board.generatedAt);
  const projectionSignature = JSON.stringify([
    board.backlog,
    board.active,
    board.archivePending,
    board.archived,
  ]);
  if (projectionSignature !== lastProjectionSignature) {
    renderLane("backlog", board.backlog, backlogCard);
    renderLane("active", board.active, taskCard);
    renderLane("archivePending", board.archivePending, taskCard);
    renderLane("archived", board.archived, taskCard);
    lastProjectionSignature = projectionSignature;
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
  const card = cardShell(index);
  card.classList.add("static");
  card.innerHTML = `
    <div class="card-meta"><span>${escapeHtml(item.backlogId)}</span><span>${escapeHtml(item.priority)}</span></div>
    <h3>${escapeHtml(item.title)}</h3>
    <div class="card-footer"><span class="tag yellow">${escapeHtml(item.status)}</span><span class="tag blue">${escapeHtml(item.kind)}</span></div>`;
  return card;
}

function taskCard(task, index) {
  const card = cardShell(index);
  card.setAttribute("role", "button");
  card.tabIndex = 0;
  card.innerHTML = `
    <div class="card-meta"><span>${escapeHtml(task.taskId)}</span><span>R${task.specRevision}</span></div>
    <h3>${escapeHtml(task.title)}</h3>
    <div class="card-footer">
      <span class="tag ${stateColor(task.state)}">${escapeHtml(task.state)}</span>
      <span class="tag ${archiveColor(task.archiveStatus)}">${escapeHtml(task.archiveStatus)}</span>
    </div>`;
  card.addEventListener("click", () => openTask(task));
  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") openTask(task);
  });
  return card;
}

function cardShell(index) {
  const card = document.createElement("div");
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
    if (traceResponse.status !== 409) throw new Error(`Trace query failed (${traceResponse.status})`);
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Task query failed (${response.status})`);
    renderLegacyTask(await response.json());
    elements.dialog.showModal();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements.detail.innerHTML = `
      <span class="detail-id">TRACE UNAVAILABLE</span>
      <h2 class="detail-title">暂时无法读取任务详情</h2>
      <p class="error-box">${escapeHtml(message)}</p>
      <p class="trace-note">任务状态不会因此改变。请检查 Board API、Restate Ingress 与 Workflow retention 后重试。</p>`;
    elements.dialog.showModal();
  }
}

function renderLegacyTask(task) {
  const events = task.events.map(event => `
    <li><span class="sequence">${String(event.sequence).padStart(2, "0")}</span><strong>${escapeHtml(event.type)}</strong><time>${formatTime(event.at)}</time></li>`).join("");
  elements.detail.innerHTML = `
    <span class="detail-id">${escapeHtml(task.taskId)} · SPEC R${task.specRevision}</span>
    <h2 class="detail-title">${escapeHtml(task.title)}</h2>
    <div class="detail-grid">
      <div><span>TASK STATE</span><strong>${escapeHtml(task.state)}</strong></div>
      <div><span>ARCHIVE STATE</span><strong>${escapeHtml(task.archiveStatus)}</strong></div>
      <div><span>CURRENT STEP</span><strong>${escapeHtml(task.currentStep)}</strong></div>
      <div><span>ATTEMPT</span><strong>${task.attempt}</strong></div>
      <div><span>WORKFLOW REF</span><strong>TaskWorkflow/${escapeHtml(task.taskId)}</strong></div>
      <div><span>BACKLOG</span><strong>${task.backlogRefs.map(escapeHtml).join(", ") || "—"}</strong></div>
    </div>
    ${task.archivePath ? `<p class="result-ref"><span>RESULT REF</span><code>${escapeHtml(task.archivePath)}</code></p>` : ""}
    ${task.error ? `<p class="error-box">${escapeHtml(task.error)}</p>` : ""}
    <p class="eyebrow">DURABLE EVENT TRACE</p>
    <ol class="timeline">${events}</ol>`;
}

function renderCodingTrace(trace, summary) {
  const task = trace.task;
  const events = trace.business.events.map(event => `
    <li><span class="sequence">${String(event.sequence).padStart(2, "0")}</span><strong>${escapeHtml(event.type)}</strong><span>${escapeHtml(event.step)}</span><time>${formatTime(event.at)}</time></li>`).join("");
  const steps = trace.business.steps.map(step => `
    <li><span>${String(step.sequence).padStart(2, "0")} · ${escapeHtml(step.stepId)}</span><strong class="tag ${attemptColor(step.status)}">${escapeHtml(step.status)}</strong><small>${step.attemptIds.map(escapeHtml).join(", ") || "尚未创建 Attempt"}</small></li>`).join("");
  const attempts = trace.business.attempts.map(attempt => `
    <li><div><strong>${escapeHtml(attempt.attemptId)}</strong><span class="tag ${attemptColor(attempt.status)}">${escapeHtml(attempt.status)}</span></div><small>${attempt.evidenceRecords.map(record => `${escapeHtml(record.artifactName)} · ${escapeHtml(shortDigest(record.contentDigest))}`).join("<br>") || escapeHtml(attempt.error || "无证据")}</small></li>`).join("");
  const artifacts = trace.technical.artifacts.map(artifact => `
    <li><span>${escapeHtml(artifact.kind)}</span><code>${escapeHtml(artifact.artifactRef)}</code><small>${escapeHtml(shortDigest(artifact.contentDigest))}${artifact.bytes === undefined ? "" : ` · ${artifact.bytes} B`}</small></li>`).join("");
  const actions = trace.recovery.actions.map(action => `
    <li><strong>${escapeHtml(action.label)}</strong><span class="tag ${action.automatic ? "blue" : "yellow"}">${action.automatic ? "RUNTIME" : "HUMAN"}</span><p>${escapeHtml(action.reason)}</p></li>`).join("");
  const verification = trace.verification === undefined ? "" : `
    <div class="trace-card">
      <span class="trace-label">VERIFICATION</span>
      <strong>${trace.verification.passed ? "PASSED" : escapeHtml(trace.verification.code)}</strong>
      <code>${escapeHtml(trace.verification.evidenceRef)}</code>
      <small>${trace.verification.commands.map(command => `${escapeHtml(command.commandId)} → exit ${command.exitCode ?? "signal"} · ${command.durationMs}ms`).join("<br>") || "没有已确认的命令结果"}</small>
    </div>`;
  const agent = trace.agent === undefined ? "" : `
    <div class="trace-card">
      <span class="trace-label">AGENT SESSION</span>
      <strong>${escapeHtml(trace.agent.sessionId || "未建立 Session")}</strong>
      <code>${escapeHtml(trace.agent.runId)}</code>
      <small>${escapeHtml(trace.agent.runnerKind)} · ${escapeHtml(trace.agent.outcome)} · exit ${trace.agent.exitCode ?? trace.agent.signal ?? "—"}</small>
    </div>`;

  elements.detail.innerHTML = `
    <span class="detail-id">${escapeHtml(task.taskId)} · SPEC R${task.specRevision}</span>
    <h2 class="detail-title">${escapeHtml(summary.title || task.taskId)}</h2>
    <div class="detail-grid">
      <div><span>TASK STATE</span><strong>${escapeHtml(task.state)}</strong></div>
      <div><span>ARCHIVE STATE</span><strong>${escapeHtml(task.archiveStatus)}</strong></div>
      <div><span>CURRENT STEP</span><strong>${escapeHtml(task.currentStep)}</strong></div>
      <div><span>RECOVERY</span><strong>${escapeHtml(trace.recovery.classification)}</strong></div>
      <div><span>BRANCH</span><strong>${escapeHtml(trace.git.branch || "—")}</strong></div>
      <div><span>RESULT / MERGE</span><strong>${escapeHtml(shortSha(trace.git.resultCommit))} / ${escapeHtml(shortSha(trace.git.mergeCommit))}</strong></div>
    </div>
    ${task.error ? `<p class="error-box">${escapeHtml(task.error)}</p>` : ""}

    <section class="trace-section recovery ${trace.recovery.classification === "NONE" ? "settled" : "attention"}">
      <div class="trace-heading"><div><p class="eyebrow">RECOVERY VIEW</p><h3>${escapeHtml(trace.recovery.classification)}</h3></div><span>只读建议</span></div>
      <p>${escapeHtml(trace.recovery.summary)}</p>
      ${actions ? `<ul class="action-list">${actions}</ul>` : ""}
    </section>

    <section class="trace-section">
      <div class="trace-heading"><div><p class="eyebrow">01 · BUSINESS FACTS</p><h3>业务状态与证据绑定</h3></div><span>权威：Workflow Projection</span></div>
      <p class="trace-note">只有这里的 Event、Step、Attempt 和终态决定任务是否完成。</p>
      <ul class="step-list">${steps}</ul>
      <p class="subheading">ATTEMPTS</p>
      <ul class="attempt-list">${attempts}</ul>
      <p class="subheading">BUSINESS EVENTS</p>
      <ol class="timeline coding-timeline">${events}</ol>
    </section>

    <section class="trace-section">
      <div class="trace-heading"><div><p class="eyebrow">02 · DURABLE RUNTIME</p><h3>Restate Journal 定位</h3></div><span>权威：执行与重放</span></div>
      <p class="trace-note">Journal 解释 Worker 中断后如何继续，但不替代业务 Projection。</p>
      <code class="wide-code">${escapeHtml(trace.durableRuntime.workflowRef)}</code>
      ${trace.durableRuntime.adminBaseUrl ? `<a class="runtime-link" href="${escapeAttribute(trace.durableRuntime.adminBaseUrl)}" target="_blank" rel="noreferrer">打开 Restate Admin ↗</a>` : ""}
    </section>

    <section class="trace-section">
      <div class="trace-heading"><div><p class="eyebrow">03 · TECHNICAL EVIDENCE</p><h3>Agent、Git、验证与日志</h3></div><span>诊断证据，不是状态机</span></div>
      <div class="trace-card-grid">${agent}${verification}</div>
      <div class="trace-card git-card">
        <span class="trace-label">GIT CHAIN</span>
        <strong>${escapeHtml(trace.git.branch || "尚未创建 Branch")}</strong>
        <code>base ${escapeHtml(trace.git.baseCommit || "—")}<br>result ${escapeHtml(trace.git.resultCommit || "—")}<br>merge ${escapeHtml(trace.git.mergeCommit || "—")}</code>
        <small>${trace.git.reconciledAfterUnknown ? "已在未知回执后通过 Git facts 对账" : "使用 Effect ID 关联可重复调用"}</small>
      </div>
      <p class="subheading">ARTIFACT REFERENCES</p>
      <ul class="artifact-list">${artifacts || "<li>尚无技术 Artifact</li>"}</ul>
    </section>`;
}

function stateColor(state) {
  return state === "CLOSED" ? "green" : state === "VERIFYING" ? "blue" : "yellow";
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
  if (!/^https?:\/\//.test(text)) return "#";
  return escapeHtml(text);
}
