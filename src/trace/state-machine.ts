import type { AgentRunResult } from "../agent/runner.js";
import type { CodingWorkflowEvent, CodingWorkflowProjection, CodingWorkflowStep } from "../coding/workflow.js";
import type { StepAttempt } from "../domain/coding-task.js";
import type { TaskEventSummary, TaskProjection } from "../domain/task.js";

export type StateMachineDomain = "BUSINESS" | "ARCHIVE";
export type StateMachineEdgeKind = "NORMAL" | "REPAIR" | "FAILURE" | "ARCHIVE";

export interface StateMachineNode {
  readonly id: string;
  readonly label: string;
  readonly domain: StateMachineDomain;
  readonly terminal: boolean;
  readonly status: "NOT_VISITED" | "VISITED" | "CURRENT";
}

export interface StateMachineEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: StateMachineEdgeKind;
  readonly label: string;
  readonly traversed: boolean;
}

export interface StateTransitionFact {
  readonly sequence: number;
  readonly eventType: string;
  readonly from: string;
  readonly to: string;
  readonly domain: StateMachineDomain;
  readonly at: string;
  readonly detail?: string;
}

export interface StateMachineExecution {
  readonly kind: "STEP_ATTEMPT" | "AGENT_RUN" | "ROLE_RUN" | "REVIEW_RUN" | "VERIFICATION" | "BOOTSTRAP_EVIDENCE" | "SEAL_COMMIT";
  readonly id: string;
  readonly state: string;
  readonly step: string;
  readonly generation?: number;
  readonly attemptId?: string;
  readonly sessionId?: string;
  readonly producer?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly evidenceDigests: readonly string[];
}

export interface TaskStateMachineTrace {
  readonly schemaVersion: 1;
  readonly authority: "derived-from-runtime-projection";
  readonly workflow: "CodingTaskWorkflow" | "TaskWorkflow" | "BootstrapFailureRecoveryWorkflow" | "SealedTaskWorkflow";
  readonly definition: {
    readonly nodes: readonly StateMachineNode[];
    readonly edges: readonly StateMachineEdge[];
  };
  readonly current: {
    readonly business: string;
    readonly archive: string;
    readonly overall: string;
    readonly historyCurrent: string;
    readonly consistency: "VERIFIED" | "MISMATCH";
  };
  readonly history: readonly StateTransitionFact[];
  readonly executions: readonly StateMachineExecution[];
}

const CODING_NODES = [
  ["START", "开始", "BUSINESS", false],
  ["CONTEXT", "需求与上下文", "BUSINESS", false],
  ["WORKSPACE", "隔离工作区", "BUSINESS", false],
  ["IMPLEMENT", "实现 / Repair", "BUSINESS", false],
  ["SELF_REVIEW", "实现者自审", "BUSINESS", false],
  ["VERIFY", "验证", "BUSINESS", false],
  ["REVIEW", "独立 Review", "BUSINESS", false],
  ["REPLAN", "规格修订", "BUSINESS", false],
  ["WAITING_RECONCILE", "等待副作用对账", "BUSINESS", false],
  ["MERGE", "合入", "BUSINESS", false],
  ["DOCS", "文档处置", "BUSINESS", false],
  ["CLOSED", "业务关闭", "BUSINESS", true],
  ["FAILED", "失败终态", "BUSINESS", true],
  ["ARCHIVING", "归档中", "ARCHIVE", false],
  ["ARCHIVED", "已归档", "ARCHIVE", true],
  ["ARCHIVE_FAILED", "归档失败", "ARCHIVE", true],
] as const;

const CODING_EDGES: readonly Omit<StateMachineEdge, "traversed">[] = [
  edge("START", "CONTEXT", "NORMAL", "接收冻结 Envelope"),
  edge("CONTEXT", "WORKSPACE", "NORMAL", "Context Evidence 通过"),
  edge("WORKSPACE", "IMPLEMENT", "NORMAL", "Worktree Effect 确认"),
  edge("IMPLEMENT", "SELF_REVIEW", "NORMAL", "Result Commit / Checkpoint"),
  edge("SELF_REVIEW", "VERIFY", "NORMAL", "Self Review PASSED"),
  edge("IMPLEMENT", "VERIFY", "NORMAL", "兼容路径未启用 Self Review"),
  edge("VERIFY", "REVIEW", "NORMAL", "Verification 通过"),
  edge("VERIFY", "MERGE", "NORMAL", "Review 未启用的兼容路径"),
  edge("REVIEW", "IMPLEMENT", "REPAIR", "Blocking Finding → 新 Attempt"),
  edge("REVIEW", "REPLAN", "REPAIR", "Spec Finding → Revision N+1"),
  edge("REPLAN", "CONTEXT", "REPAIR", "重新验证修订规格"),
  edge("REVIEW", "MERGE", "NORMAL", "Review PASSED"),
  edge("MERGE", "DOCS", "NORMAL", "Merge Effect 确认"),
  edge("DOCS", "CLOSED", "NORMAL", "关闭 Gate 通过"),
  ...["CONTEXT", "WORKSPACE", "IMPLEMENT", "SELF_REVIEW", "VERIFY", "REVIEW", "REPLAN", "MERGE", "DOCS"]
    .map((from) => edge(from, "FAILED", "FAILURE", "不可恢复失败")),
  ...["CONTEXT", "WORKSPACE", "IMPLEMENT", "SELF_REVIEW", "VERIFY", "REVIEW", "REPLAN", "MERGE", "DOCS"]
    .map((from) => edge(from, "WAITING_RECONCILE", "FAILURE", "外部结果未知，等待对账")),
  ...["CONTEXT", "WORKSPACE", "IMPLEMENT", "SELF_REVIEW", "VERIFY", "REVIEW", "REPLAN", "MERGE", "DOCS"]
    .map((to) => edge("WAITING_RECONCILE", to, "REPAIR", "对账确认后恢复原步骤")),
  edge("FAILED", "ARCHIVING", "ARCHIVE", "失败事实固化后归档"),
  edge("CLOSED", "ARCHIVING", "ARCHIVE", "启动独立 Archive"),
  edge("ARCHIVING", "ARCHIVED", "ARCHIVE", "Archive Receipt 确认"),
  edge("ARCHIVING", "ARCHIVE_FAILED", "ARCHIVE", "Archive Effect 失败"),
];

const TASK_NODES = [
  ["START", "开始", "BUSINESS", false],
  ["RECEIVED", "已接收", "BUSINESS", false],
  ["EXECUTING", "执行中", "BUSINESS", false],
  ["VERIFYING", "验证中", "BUSINESS", false],
  ["CLOSED", "业务关闭", "BUSINESS", true],
  ["ARCHIVE_PENDING", "等待归档", "ARCHIVE", false],
  ["ARCHIVED", "已归档", "ARCHIVE", true],
  ["ARCHIVE_FAILED", "归档失败", "ARCHIVE", true],
] as const;

const TASK_EDGES: readonly Omit<StateMachineEdge, "traversed">[] = [
  edge("START", "RECEIVED", "NORMAL", "TaskCreated"),
  edge("RECEIVED", "EXECUTING", "NORMAL", "Workflow 开始执行"),
  edge("EXECUTING", "VERIFYING", "NORMAL", "进入验证"),
  edge("VERIFYING", "EXECUTING", "REPAIR", "验证要求重新执行"),
  edge("VERIFYING", "CLOSED", "NORMAL", "业务 Outcome 固定"),
  edge("EXECUTING", "CLOSED", "FAILURE", "失败终止"),
  edge("CLOSED", "ARCHIVE_PENDING", "ARCHIVE", "ArchivePending"),
  edge("ARCHIVE_PENDING", "ARCHIVED", "ARCHIVE", "ArchiveArchived"),
  edge("ARCHIVE_PENDING", "ARCHIVE_FAILED", "ARCHIVE", "ArchiveFailed"),
];

export function buildCodingStateMachine(projection: CodingWorkflowProjection): TaskStateMachineTrace {
  const history = codingHistory(projection.events);
  const overall = codingOverall(projection);
  return finalizeMachine({
    workflow: "CodingTaskWorkflow",
    nodes: CODING_NODES,
    edges: CODING_EDGES,
    business: projection.state === "FAILED" ? "FAILED" : projection.state === "CLOSED" ? "CLOSED" : projection.currentStep,
    archive: projection.archiveStatus,
    overall,
    history,
    executions: codingExecutions(projection),
  });
}

export function buildTaskStateMachine(
  projection: TaskProjection,
  workflow: "TaskWorkflow" | "BootstrapFailureRecoveryWorkflow" | "SealedTaskWorkflow" = "TaskWorkflow",
): TaskStateMachineTrace {
  const history = taskHistory(projection.events);
  const overall = projection.archiveStatus === "ARCHIVED"
    ? "ARCHIVED"
    : projection.archiveStatus === "FAILED"
      ? "ARCHIVE_FAILED"
      : projection.archiveStatus === "PENDING"
        ? "ARCHIVE_PENDING"
        : projection.state;
  const executions: StateMachineExecution[] = projection.execution === undefined ? [] : [{
    kind: "BOOTSTRAP_EVIDENCE",
    id: projection.execution.resultCommit,
    state: "ACCEPTED",
    step: "EXECUTING",
    producer: projection.execution.executorId,
    evidenceDigests: [projection.execution.resultCommit, ...projection.execution.verificationRefs, projection.execution.docsImpactRef],
  }];
  if (projection.seal !== undefined) {
    executions.push({
      kind: "SEAL_COMMIT",
      id: projection.seal.resultCommit ?? projection.seal.intentDigest,
      state: projection.seal.resultCommit === undefined ? "WAITING_COMMIT" : "VERIFIED",
      step: projection.seal.resultCommit === undefined ? "EXECUTING" : "VERIFYING",
      evidenceDigests: [
        projection.seal.intentDigest,
        projection.seal.baseCommit,
        ...(projection.seal.resultCommit === undefined ? [] : [projection.seal.resultCommit]),
        ...(projection.seal.packageDigest === undefined ? [] : [projection.seal.packageDigest]),
      ],
    });
  }
  return finalizeMachine({
    workflow,
    nodes: TASK_NODES,
    edges: TASK_EDGES,
    business: projection.state,
    archive: projection.archiveStatus,
    overall,
    history,
    executions,
  });
}

function codingHistory(events: readonly CodingWorkflowEvent[]): StateTransitionFact[] {
  assertEventOrder(events);
  let current = "START";
  const history: StateTransitionFact[] = [];
  for (const event of events) {
    const target = codingEventTarget(event);
    if (target === undefined || target === current) continue;
    history.push(transition(event, current, target, target.startsWith("ARCHIV") ? "ARCHIVE" : "BUSINESS"));
    current = target;
  }
  return history;
}

function taskHistory(events: readonly TaskEventSummary[]): StateTransitionFact[] {
  assertEventOrder(events);
  let current = "START";
  const history: StateTransitionFact[] = [];
  const targets: Readonly<Record<string, string>> = {
    TaskCreated: "RECEIVED",
    TaskExecuting: "EXECUTING",
    TaskVerifying: "VERIFYING",
    TaskClosed: "CLOSED",
    ArchivePending: "ARCHIVE_PENDING",
    ArchiveArchiving: "ARCHIVE_PENDING",
    ArchiveArchived: "ARCHIVED",
    ArchiveFailed: "ARCHIVE_FAILED",
  };
  for (const event of events) {
    const target = targets[event.type];
    if (target === undefined || target === current) continue;
    history.push(transition(event, current, target, target.startsWith("ARCHIVE") ? "ARCHIVE" : "BUSINESS"));
    current = target;
  }
  return history;
}

function codingEventTarget(event: CodingWorkflowEvent): string | undefined {
  if (event.type === "WORKFLOW_FAILED") return "FAILED";
  if (event.type === "WORKFLOW_CLOSED") return "CLOSED";
  if (event.type === "WORKFLOW_ARCHIVED") return "ARCHIVED";
  if (event.type === "ARCHIVE_FAILED") return "ARCHIVE_FAILED";
  if (event.type === "RECONCILE_REQUIRED") return "WAITING_RECONCILE";
  if (event.type === "RECONCILE_RESUMED") return event.step;
  if (event.type !== "STEP_STARTED") return undefined;
  if (event.step === "CLOSED") return undefined;
  if (event.step === "ARCHIVE") return "ARCHIVING";
  return event.step;
}

function codingOverall(projection: CodingWorkflowProjection): string {
  if (projection.archiveStatus === "ARCHIVED") return "ARCHIVED";
  if (projection.archiveStatus === "FAILED") return "ARCHIVE_FAILED";
  if (projection.state === "FAILED") return "FAILED";
  if (projection.state === "WAITING_RECONCILE") return "WAITING_RECONCILE";
  if (projection.currentStep === "ARCHIVE") return "ARCHIVING";
  if (projection.state === "CLOSED") return "CLOSED";
  return projection.currentStep;
}

function codingExecutions(projection: CodingWorkflowProjection): StateMachineExecution[] {
  const executions: StateMachineExecution[] = projection.attempts.map(stepAttemptExecution);
  const agentRuns = projection.agentRuns ?? (projection.agent === undefined ? [] : [projection.agent]);
  executions.push(...agentRuns.map(agentRunExecution));
  executions.push(...(projection.roleRuns ?? []).map((run) => ({
    kind: "ROLE_RUN" as const,
    id: run.runId,
    state: run.outcome,
    step: run.kind,
    generation: run.attempt,
    ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
    producer: run.runnerKind,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    evidenceDigests: [run.resultDigest, run.eventsContentDigest],
  })));
  executions.push(...(projection.reviews ?? []).map((review) => ({
    kind: "REVIEW_RUN" as const,
    id: review.runId,
    state: review.outcome,
    step: "REVIEW",
    generation: review.attempt,
    ...(review.sessionId === undefined ? {} : { sessionId: review.sessionId }),
    producer: review.runnerKind,
    evidenceDigests: [review.resultDigest],
  })));
  const verifications = projection.verifications ?? (projection.verification === undefined ? [] : [projection.verification]);
  executions.push(...verifications.map((verification, index) => ({
    kind: "VERIFICATION" as const,
    id: verification.passed ? verification.verificationDigest : verification.evidenceContentDigest,
    state: verification.passed ? "PASSED" : verification.code,
    step: "VERIFY",
    generation: index + 1,
    evidenceDigests: [verification.evidenceContentDigest, ...(verification.passed ? [verification.verificationDigest] : [])],
  })));
  return executions;
}

function stepAttemptExecution(attempt: StepAttempt): StateMachineExecution {
  return {
    kind: "STEP_ATTEMPT",
    id: attempt.attemptId,
    state: attempt.status,
    step: attempt.stepId,
    generation: attempt.generation,
    ...(attempt.startedAt === undefined ? {} : { startedAt: attempt.startedAt }),
    ...(attempt.finishedAt === undefined ? {} : { finishedAt: attempt.finishedAt }),
    evidenceDigests: attempt.evidenceRecords.map((record) => record.evidenceDigest),
  };
}

function agentRunExecution(run: AgentRunResult): StateMachineExecution {
  return {
    kind: "AGENT_RUN",
    id: run.runId,
    state: run.outcome,
    step: "IMPLEMENT",
    attemptId: run.attemptId,
    ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
    producer: run.runnerKind,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    evidenceDigests: [run.runDigest],
  };
}

function finalizeMachine(input: {
  readonly workflow: TaskStateMachineTrace["workflow"];
  readonly nodes: readonly (readonly [string, string, StateMachineDomain, boolean])[];
  readonly edges: readonly Omit<StateMachineEdge, "traversed">[];
  readonly business: string;
  readonly archive: string;
  readonly overall: string;
  readonly history: readonly StateTransitionFact[];
  readonly executions: readonly StateMachineExecution[];
}): TaskStateMachineTrace {
  const historyCurrent = input.history.at(-1)?.to ?? "START";
  const traversed = new Set(input.history.map((item) => `${item.from}->${item.to}`));
  const visited = new Set(["START", ...input.history.flatMap((item) => [item.from, item.to])]);
  return deepFreeze({
    schemaVersion: 1 as const,
    authority: "derived-from-runtime-projection" as const,
    workflow: input.workflow,
    definition: {
      nodes: input.nodes.map(([id, label, domain, terminal]) => ({
        id, label, domain, terminal,
        status: id === input.overall ? "CURRENT" as const : visited.has(id) ? "VISITED" as const : "NOT_VISITED" as const,
      })),
      edges: input.edges.map((item) => ({ ...item, traversed: traversed.has(`${item.from}->${item.to}`) })),
    },
    current: {
      business: input.business,
      archive: input.archive,
      overall: input.overall,
      historyCurrent,
      consistency: historyCurrent === input.overall ? "VERIFIED" as const : "MISMATCH" as const,
    },
    history: input.history.map((item) => ({ ...item })),
    executions: input.executions.map((item) => ({ ...item, evidenceDigests: [...item.evidenceDigests] })),
  });
}

function edge(from: string, to: string, kind: StateMachineEdgeKind, label: string): Omit<StateMachineEdge, "traversed"> {
  return { from, to, kind, label };
}

function transition(
  event: { readonly sequence: number; readonly type: string; readonly at: string; readonly detail?: string },
  from: string,
  to: string,
  domain: StateMachineDomain,
): StateTransitionFact {
  return { sequence: event.sequence, eventType: event.type, from, to, domain, at: event.at, ...(event.detail ? { detail: event.detail } : {}) };
}

function assertEventOrder(events: readonly { readonly sequence: number }[]): void {
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1) throw new Error(`Runtime Event sequence is not contiguous at ${event.sequence}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
