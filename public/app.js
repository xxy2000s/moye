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
  card.addEventListener("click", () => openTask(task.taskId));
  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") openTask(task.taskId);
  });
  return card;
}

function cardShell(index) {
  const card = document.createElement("div");
  card.className = "card";
  card.style.setProperty("--index", String(index));
  return card;
}

async function openTask(taskId) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
  if (!response.ok) return;
  const task = await response.json();
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
  elements.dialog.showModal();
}

function stateColor(state) {
  return state === "CLOSED" ? "green" : state === "VERIFYING" ? "blue" : "yellow";
}

function archiveColor(status) {
  if (status === "ARCHIVED") return "green";
  if (status === "FAILED") return "red";
  return "yellow";
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
