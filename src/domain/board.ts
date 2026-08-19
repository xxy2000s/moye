import type { BacklogProjection } from "./backlog.js";
import type { TaskProjection } from "./task.js";

export interface ProjectBoardSnapshot {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly backlog: readonly BacklogProjection[];
  readonly active: readonly TaskProjection[];
  readonly archivePending: readonly TaskProjection[];
  readonly archived: readonly TaskProjection[];
}

export function buildBoardSnapshot(
  projectId: string,
  tasks: Readonly<Record<string, TaskProjection>>,
  backlog: Readonly<Record<string, BacklogProjection>>,
  generatedAt: string,
): ProjectBoardSnapshot {
  const orderedTasks = Object.values(tasks).sort(compareTasks);
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
  };
}

function compareTasks(left: TaskProjection, right: TaskProjection): number {
  return (
    right.lastEventAt.localeCompare(left.lastEventAt) ||
    left.taskId.localeCompare(right.taskId)
  );
}
