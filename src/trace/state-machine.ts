import type { AgentRunResult } from "../agent/runner.js";
import type { CodingWorkflowEvent, CodingWorkflowProjection, CodingWorkflowStep } from "../coding/workflow.js";
import type { StepAttempt } from "../domain/coding-task.js";
import type { TaskEventSummary, TaskProjection } from "../domain/task.js";
import type { CoreV2WorkflowProjection } from "../restate/core-v2-services.js";

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
  readonly kind: "STEP_ATTEMPT" | "AGENT_RUN" | "ROLE_RUN" | "REVIEW_RUN" | "VERIFICATION" | "MERGE_EFFECT" | "BOOTSTRAP_EVIDENCE" | "SEAL_COMMIT";
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
  readonly workflow: "CoreV2Workflow" | "CoreV2FailureRecoveryWorkflow" | "CoreV2FailureRecoveryAttemptWorkflow" | "CodingTaskWorkflow" | "TaskWorkflow" | "BootstrapFailureRecoveryWorkflow" | "SealedTaskWorkflow" | "SealedTaskRecoveryWorkflow" | "SealRecoveryAttemptWorkflow";
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

const CORE_V2_NODES = [
  ["START", "Task Intake", "BUSINESS", false],
  ["ARCHITECT_REQUIRED", "Spec / Design / Plan", "BUSINESS", false],
  ["DESIGN_REVIEW_REQUIRED", "Design Review", "BUSINESS", false],
  ["IMPLEMENTATION_REQUIRED", "Implementation", "BUSINESS", false],
  ["DOCUMENTATION_REQUIRED", "Documentation", "BUSINESS", false],
  ["TEST_PLAN_REQUIRED", "Test Plan", "BUSINESS", false],
  ["TEST_EXECUTION_REQUIRED", "Trusted Runner", "BUSINESS", false],
  ["TEST_ASSESSMENT_REQUIRED", "Test Assessment", "BUSINESS", false],
  ["FINAL_REVIEW_REQUIRED", "Final Review", "BUSINESS", false],
  ["VERIFICATION_GATE_REQUIRED", "Verification Gate", "BUSINESS", false],
  ["MERGE_REQUIRED", "Merge", "BUSINESS", false],
  ["CLOSED", "Closure", "BUSINESS", true],
  ["REPAIR_REQUIRED", "Repair", "BUSINESS", false],
  ["REPLAN_REQUIRED", "Replan", "BUSINESS", false],
  ["WAITING_RECONCILE", "Reconcile", "BUSINESS", false],
  ["FAILED_TERMINAL", "Failed", "BUSINESS", true],
  ["ARCHIVE_PENDING", "Archive Pending", "ARCHIVE", false],
  ["ARCHIVE_FAILED", "Archive Failed", "ARCHIVE", false],
  ["ARCHIVED", "Archived", "ARCHIVE", true],
] as const;

const CORE_V2_EDGES: readonly Omit<StateMachineEdge, "traversed">[] = [
  edge("START", "ARCHITECT_REQUIRED", "NORMAL", "Task Intake 与 Context Plan"),
  edge("ARCHITECT_REQUIRED", "DESIGN_REVIEW_REQUIRED", "NORMAL", "Spec、Design、Plan Artifact 完整"),
  edge("DESIGN_REVIEW_REQUIRED", "IMPLEMENTATION_REQUIRED", "NORMAL", "Design Review PASSED"),
  edge("DESIGN_REVIEW_REQUIRED", "REPLAN_REQUIRED", "REPAIR", "需求或设计 Finding"),
  edge("REPLAN_REQUIRED", "ARCHITECT_REQUIRED", "REPAIR", "Spec Revision N+1"),
  edge("IMPLEMENTATION_REQUIRED", "DOCUMENTATION_REQUIRED", "NORMAL", "Candidate Commit 与 Self Review 通过"),
  edge("IMPLEMENTATION_REQUIRED", "REPAIR_REQUIRED", "REPAIR", "Implementation Finding"),
  edge("DOCUMENTATION_REQUIRED", "TEST_PLAN_REQUIRED", "NORMAL", "Docs Impact 已绑定 Candidate"),
  edge("DOCUMENTATION_REQUIRED", "REPAIR_REQUIRED", "REPAIR", "Documentation Finding"),
  edge("TEST_PLAN_REQUIRED", "TEST_EXECUTION_REQUIRED", "NORMAL", "Requirement → Test Case 计划通过"),
  edge("TEST_EXECUTION_REQUIRED", "TEST_ASSESSMENT_REQUIRED", "NORMAL", "Trusted Runner Evidence 已记录"),
  edge("TEST_EXECUTION_REQUIRED", "WAITING_RECONCILE", "FAILURE", "测试外部结果未知"),
  edge("TEST_ASSESSMENT_REQUIRED", "FINAL_REVIEW_REQUIRED", "NORMAL", "综合测试建议 PASS"),
  edge("TEST_ASSESSMENT_REQUIRED", "REPAIR_REQUIRED", "REPAIR", "测试发现实现缺陷"),
  edge("TEST_ASSESSMENT_REQUIRED", "WAITING_RECONCILE", "FAILURE", "测试结论 INCONCLUSIVE"),
  edge("FINAL_REVIEW_REQUIRED", "VERIFICATION_GATE_REQUIRED", "NORMAL", "最终隔离 Review PASSED"),
  edge("FINAL_REVIEW_REQUIRED", "REPAIR_REQUIRED", "REPAIR", "最终 Review Finding"),
  edge("REPAIR_REQUIRED", "IMPLEMENTATION_REQUIRED", "REPAIR", "授权新 Implementation Generation"),
  edge("WAITING_RECONCILE", "TEST_EXECUTION_REQUIRED", "REPAIR", "对账后恢复原测试"),
  edge("VERIFICATION_GATE_REQUIRED", "MERGE_REQUIRED", "NORMAL", "确定性 Artifact Gate 通过"),
  edge("MERGE_REQUIRED", "ARCHIVE_PENDING", "ARCHIVE", "Merge 与 Success Closure 已冻结，等待 Archive Receipt"),
  edge("CLOSED", "ARCHIVED", "ARCHIVE", "Archive Receipt 确认"),
  edge("FAILED_TERMINAL", "ARCHIVE_PENDING", "ARCHIVE", "Failure Artifact、Knowledge Disposition 与 Closure 已冻结"),
  edge("ARCHIVE_PENDING", "CLOSED", "ARCHIVE", "业务 Closure 已冻结并收到 Archive Receipt"),
  edge("ARCHIVE_PENDING", "ARCHIVE_FAILED", "FAILURE", "Archive Effect 失败；业务执行不得重跑"),
  edge("ARCHIVE_FAILED", "ARCHIVE_PENDING", "REPAIR", "仅重试同一 Archive Effect"),
  ...["ARCHITECT_REQUIRED", "DESIGN_REVIEW_REQUIRED", "IMPLEMENTATION_REQUIRED", "DOCUMENTATION_REQUIRED", "TEST_PLAN_REQUIRED", "TEST_EXECUTION_REQUIRED", "TEST_ASSESSMENT_REQUIRED", "FINAL_REVIEW_REQUIRED", "VERIFICATION_GATE_REQUIRED", "MERGE_REQUIRED", "REPAIR_REQUIRED", "REPLAN_REQUIRED"]
    .map((from) => edge(from, "FAILED_TERMINAL", "FAILURE", "不可恢复或预算耗尽")),
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
  workflow: "TaskWorkflow" | "BootstrapFailureRecoveryWorkflow" | "SealedTaskWorkflow" | "SealedTaskRecoveryWorkflow" | "SealRecoveryAttemptWorkflow" = "TaskWorkflow",
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

export function buildCoreV2StateMachine(projection: CoreV2WorkflowProjection): TaskStateMachineTrace {
  assertEventOrder(projection.lifecycle.events);
  let current = "START";
  const history: StateTransitionFact[] = [];
  const targets: Readonly<Record<string, string>> = {
    ArchitectRequired: "ARCHITECT_REQUIRED",
    ArchitectArtifactsAccepted: "DESIGN_REVIEW_REQUIRED",
    DesignReviewPassed: "IMPLEMENTATION_REQUIRED",
    DesignReviewRequestedReplan: "REPLAN_REQUIRED",
    SpecRevisionReplanned: "ARCHITECT_REQUIRED",
    ImplementationAccepted: "DOCUMENTATION_REQUIRED",
    ImplementationRepairRequired: "REPAIR_REQUIRED",
    ImplementationRepairAuthorized: "IMPLEMENTATION_REQUIRED",
    DocumentationRequestedRepair: "REPAIR_REQUIRED",
    DocumentationGateAccepted: "TEST_PLAN_REQUIRED",
    TestPlanAccepted: "TEST_EXECUTION_REQUIRED",
    TrustedTestReconcileRequired: "WAITING_RECONCILE",
    TrustedTestReconcileResumed: "TEST_EXECUTION_REQUIRED",
    TrustedTestRunRecorded: "TEST_ASSESSMENT_REQUIRED",
    TestVerificationPassed: "FINAL_REVIEW_REQUIRED",
    TestVerificationRequestedRepair: "REPAIR_REQUIRED",
    TestVerificationUnknown: "WAITING_RECONCILE",
    FinalReviewPassed: "VERIFICATION_GATE_REQUIRED",
    FinalReviewRequestedRepair: "REPAIR_REQUIRED",
    VerificationGatePassed: "MERGE_REQUIRED",
    WorkflowFailedTerminal: "FAILED_TERMINAL",
    FailureClosureStarted: "FAILED_TERMINAL",
    FailureArtifactRecorded: "FAILED_TERMINAL",
    FailureClosureCompleted: "FAILED_TERMINAL",
    ArchivePending: "ARCHIVE_PENDING",
    ArchiveFailed: "ARCHIVE_FAILED",
    ArchiveRetryStarted: "ARCHIVE_PENDING",
    TaskClosed: "CLOSED",
    ArchiveArchived: "ARCHIVED",
  };
  for (const event of projection.lifecycle.events) {
    const target = targets[event.type];
    if (target === undefined || target === current) continue;
    if (event.type === "TaskClosed" && current === "ARCHIVED") continue;
    history.push(transition(event, current, target, target.startsWith("ARCHIVE") ? "ARCHIVE" : "BUSINESS"));
    current = target;
  }
  if (projection.state === "FAILED_TERMINAL" && current !== "FAILED_TERMINAL") {
    history.push({ sequence: projection.lifecycle.events.length + 1, eventType: "WorkflowFailedTerminal", from: current, to: "FAILED_TERMINAL", domain: "BUSINESS", at: projection.completedAt ?? projection.startedAt, ...(projection.error === null ? {} : { detail: projection.error }) });
  }
  const executions: StateMachineExecution[] = projection.attempts.map((attempt) => ({
    kind: attempt.role === "REVIEW" ? "REVIEW_RUN" as const : "ROLE_RUN" as const,
    id: attempt.run?.runId ?? attempt.attemptId,
    state: attempt.state,
    step: attempt.phase === "IMPLEMENTATION" ? "IMPLEMENTATION_REQUIRED"
      : attempt.phase === "ARCHITECT" ? "ARCHITECT_REQUIRED"
      : attempt.phase === "DESIGN_REVIEW" ? "DESIGN_REVIEW_REQUIRED"
      : attempt.phase === "DOCUMENTATION" ? "DOCUMENTATION_REQUIRED"
      : attempt.phase === "TEST_PLAN" ? "TEST_PLAN_REQUIRED"
      : attempt.phase === "TEST_ASSESSMENT" ? "TEST_ASSESSMENT_REQUIRED"
      : "FINAL_REVIEW_REQUIRED",
    generation: attempt.generation,
    attemptId: attempt.attemptId,
    ...(attempt.run?.sessionId === undefined ? {} : { sessionId: attempt.run.sessionId }),
    producer: attempt.runnerKind,
    ...(attempt.startedAt === undefined ? {} : { startedAt: attempt.startedAt }),
    ...(attempt.finishedAt === undefined ? {} : { finishedAt: attempt.finishedAt }),
    evidenceDigests: attempt.run === undefined ? [attempt.attemptDigest] : [attempt.attemptDigest, attempt.run.evidenceDigest, attempt.run.eventsDigest],
  }));
  // Recovery successors can expose projections written before nullable Core v2
  // fields were introduced. Treat an absent field like an explicit null so the
  // read-only Trace remains available for immutable historical tasks.
  if (projection.lifecycle.trustedTestRun != null) executions.push({ kind: "VERIFICATION", id: projection.lifecycle.trustedTestRun.runId, state: "RECORDED", step: "TEST_EXECUTION_REQUIRED", evidenceDigests: [projection.lifecycle.trustedTestRun.manifestDigest] });
  if (projection.lifecycle.verificationGateDigest != null) executions.push({ kind: "VERIFICATION", id: projection.lifecycle.verificationGateDigest, state: "PASSED", step: "VERIFICATION_GATE_REQUIRED", evidenceDigests: [projection.lifecycle.verificationGateDigest] });
  if (projection.lifecycle.mergeReceipt != null) executions.push({
    kind: "MERGE_EFFECT",
    id: projection.lifecycle.mergeReceipt.effectId,
    state: projection.lifecycle.mergeReceipt.reconciledAfterUnknown ? "RECONCILED" : projection.lifecycle.mergeReceipt.outcome,
    step: "MERGE_REQUIRED",
    producer: projection.lifecycle.mergeReceipt.targetRef,
    evidenceDigests: [projection.lifecycle.mergeReceipt.receiptDigest, projection.lifecycle.mergeReceipt.mergeCommit],
  });
  const archive = projection.lifecycle.archive?.status ?? "NOT_READY";
  const overall = projection.state === "FAILED_TERMINAL" ? "FAILED_TERMINAL"
    : projection.state === "CLOSED" && archive === "ARCHIVED" ? "ARCHIVED"
    : projection.state === "CLOSED" ? "CLOSED"
    : projection.state === "ARCHIVE_PENDING" ? "ARCHIVE_PENDING"
    : projection.state === "ARCHIVE_FAILED" ? "ARCHIVE_FAILED"
    : projection.lifecycle.state;
  const workflow = projection.workflowRef?.includes("CoreV2FailureRecoveryAttemptWorkflow/")
    ? "CoreV2FailureRecoveryAttemptWorkflow"
    : projection.workflowRef?.includes("CoreV2FailureRecoveryWorkflow/")
      ? "CoreV2FailureRecoveryWorkflow"
      : "CoreV2Workflow";
  return finalizeMachine({ workflow, nodes: CORE_V2_NODES, edges: CORE_V2_EDGES,
    business: projection.lifecycle.state,
    archive,
    overall, history, executions });
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
