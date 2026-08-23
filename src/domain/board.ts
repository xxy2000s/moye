import type { BacklogProjection } from "./backlog.js";
import type { BoardWorkflowKind, TaskHistoryKind, TaskHistoryKindSource, TaskProjection } from "./task.js";

export interface BoardTaskProjection extends TaskProjection {
  readonly runtimeState: string;
  readonly workflowKind: BoardWorkflowKind;
  readonly historyKind: TaskHistoryKind;
  readonly historyKindSource: TaskHistoryKindSource;
}

export interface ProjectBoardSnapshot {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly backlog: readonly BacklogProjection[];
  readonly active: readonly BoardTaskProjection[];
  readonly archivePending: readonly BoardTaskProjection[];
  readonly archived: readonly BoardTaskProjection[];
  readonly latestSucceeded: BoardTaskProjection | null;
}

export function buildBoardSnapshot(
  projectId: string,
  tasks: Readonly<Record<string, TaskProjection>>,
  backlog: Readonly<Record<string, BacklogProjection>>,
  generatedAt: string,
): ProjectBoardSnapshot {
  const orderedTasks = Object.values(tasks).map((task) => normalizeBoardTask(task)).sort(compareTasks);
  return {
    projectId,
    generatedAt,
    backlog: Object.values(backlog)
      .filter((item) => item.status !== "CONVERTED_TO_TASK")
      .sort((left, right) => left.backlogId.localeCompare(right.backlogId)),
    active: orderedTasks.filter((task) => task.state !== "CLOSED"),
    archivePending: orderedTasks.filter(
      (task) => task.state === "CLOSED" && task.archiveStatus !== "ARCHIVED",
    ),
    archived: orderedTasks.filter(
      (task) => task.archiveStatus === "ARCHIVED",
    ),
    latestSucceeded: orderedTasks.find(
      (task) => task.outcome === "SUCCEEDED" && task.archiveStatus === "ARCHIVED",
    ) ?? null,
  };
}

export function normalizeBoardTask(
  task: TaskProjection,
  authorityWorkflowKind?: BoardWorkflowKind,
): BoardTaskProjection {
  const explicitHistory = task.historyKindSource === "WORKFLOW_INPUT" ? task.historyKind : undefined;
  const legacyAcceptance = /^(?:LIVE-|TASK-(?:ACCEPT|RCV|GRD|LIVE-|CORE-V2-(?:LIVE-|MERGE-UNKNOWN-)))/i.test(task.taskId)
    || /(?:\b(?:real|product)[^\n]{0,40}acceptance\b|(?:真实|产品)[^\n]{0,30}验收|验收矩阵)/i.test(task.title);
  return {
    ...task,
    runtimeState: task.runtimeState ?? task.state,
    workflowKind: authorityWorkflowKind ?? task.workflowKind ?? "UNKNOWN",
    historyKind: explicitHistory ?? (legacyAcceptance ? "PRODUCT_ACCEPTANCE" : "PROJECT_TASK"),
    historyKindSource: explicitHistory === undefined
      ? (legacyAcceptance ? "LEGACY_CONVENTION" : "DEFAULT")
      : "WORKFLOW_INPUT",
  };
}

function compareTasks(left: BoardTaskProjection, right: BoardTaskProjection): number {
  return (
    right.lastEventAt.localeCompare(left.lastEventAt) ||
    left.taskId.localeCompare(right.taskId)
  );
}
