import { MoyeError } from "./errors.js";

export const TASK_STATES = [
  "RECEIVED",
  "EXECUTING",
  "VERIFYING",
  "CLOSED",
] as const;

export const ARCHIVE_STATUSES = [
  "NOT_READY",
  "PENDING",
  "ARCHIVED",
  "FAILED",
] as const;

export type TaskState = (typeof TASK_STATES)[number];
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];
export type TaskOutcome = "SUCCEEDED" | "CANCELLED" | "FAILED_TERMINAL";

export interface TaskEventSummary {
  readonly sequence: number;
  readonly type: string;
  readonly at: string;
  readonly detail?: string;
}

export interface TaskProjection {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
  readonly state: TaskState;
  readonly currentStep: string;
  readonly attempt: number;
  readonly specRevision: number;
  readonly backlogRefs: readonly string[];
  readonly archiveStatus: ArchiveStatus;
  readonly archivePath?: string;
  readonly outcome?: TaskOutcome;
  readonly error?: string;
  readonly lastEventAt: string;
  readonly events: readonly TaskEventSummary[];
}

export interface CreateTaskInput {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
  readonly specRevision: number;
  readonly backlogRefs: readonly string[];
}

const allowedTransitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
  RECEIVED: ["EXECUTING"],
  EXECUTING: ["VERIFYING"],
  VERIFYING: ["EXECUTING", "CLOSED"],
  CLOSED: [],
};

export function assertTaskId(taskId: string): void {
  if (!/^TASK-[A-Z0-9][A-Z0-9-]{0,63}$/.test(taskId)) {
    throw new MoyeError({
      code: "INVALID_TASK_ID",
      category: "VALIDATION",
      message: `Invalid task id: ${taskId}`,
      details: { taskId },
    });
  }
}

export function createTaskProjection(
  input: CreateTaskInput,
  now: string,
): TaskProjection {
  assertTaskId(input.taskId);
  if (!input.projectId.trim()) {
    throw new MoyeError({
      code: "INVALID_PROJECT_ID",
      category: "VALIDATION",
      message: "projectId is required",
    });
  }
  if (!input.title.trim()) {
    throw new MoyeError({
      code: "INVALID_TASK_TITLE",
      category: "VALIDATION",
      message: "title is required",
    });
  }
  if (!Number.isInteger(input.specRevision) || input.specRevision < 1) {
    throw new MoyeError({
      code: "INVALID_SPEC_REVISION",
      category: "VALIDATION",
      message: "specRevision must be a positive integer",
    });
  }

  return {
    taskId: input.taskId,
    projectId: input.projectId,
    title: input.title,
    state: "RECEIVED",
    currentStep: "task-created",
    attempt: 0,
    specRevision: input.specRevision,
    backlogRefs: [...input.backlogRefs],
    archiveStatus: "NOT_READY",
    lastEventAt: now,
    events: [
      {
        sequence: 1,
        type: "TaskCreated",
        at: now,
      },
    ],
  };
}

export function transitionTask(
  projection: TaskProjection,
  nextState: TaskState,
  currentStep: string,
  now: string,
  detail?: string,
): TaskProjection {
  if (!allowedTransitions[projection.state].includes(nextState)) {
    throw new MoyeError({
      code: "INVALID_TASK_TRANSITION",
      category: "CONFLICT",
      message: `Cannot transition ${projection.taskId} from ${projection.state} to ${nextState}`,
      details: {
        taskId: projection.taskId,
        from: projection.state,
        to: nextState,
      },
    });
  }

  const nextSequence = projection.events.length + 1;
  const event: TaskEventSummary = {
    sequence: nextSequence,
    type: `Task${toPascalCase(nextState)}`,
    at: now,
    ...(detail === undefined ? {} : { detail }),
  };

  return {
    ...projection,
    state: nextState,
    currentStep,
    attempt:
      nextState === "EXECUTING"
        ? projection.attempt + 1
        : projection.attempt,
    lastEventAt: now,
    events: [...projection.events, event],
  };
}

export function closeTask(
  projection: TaskProjection,
  outcome: TaskOutcome,
  now: string,
): TaskProjection {
  const closed = transitionTask(
    projection,
    "CLOSED",
    "task-closed",
    now,
    outcome,
  );
  return {
    ...closed,
    outcome,
    archiveStatus: "PENDING",
  };
}

export function failTask(
  projection: TaskProjection,
  error: string,
  now: string,
): TaskProjection {
  if (projection.state === "CLOSED") return projection;
  return {
    ...projection,
    state: "CLOSED",
    currentStep: "task-failed-terminal",
    outcome: "FAILED_TERMINAL",
    archiveStatus: "PENDING",
    error,
    lastEventAt: now,
    events: [
      ...projection.events,
      {
        sequence: projection.events.length + 1,
        type: "TaskClosed",
        at: now,
        detail: `FAILED_TERMINAL: ${error}`,
      },
    ],
  };
}

export function updateArchiveStatus(
  projection: TaskProjection,
  archiveStatus: ArchiveStatus,
  now: string,
  options: { readonly archivePath?: string; readonly error?: string } = {},
): TaskProjection {
  if (projection.state !== "CLOSED") {
    throw new MoyeError({
      code: "TASK_NOT_CLOSED",
      category: "CONFLICT",
      message: `Task ${projection.taskId} must be CLOSED before archive updates`,
    });
  }

  const event: TaskEventSummary = {
    sequence: projection.events.length + 1,
    type: `Archive${toPascalCase(archiveStatus)}`,
    at: now,
    ...(options.error === undefined ? {} : { detail: options.error }),
  };

  const { error: _previousError, ...projectionWithoutError } = projection;
  const baseProjection = projection.outcome === "FAILED_TERMINAL"
    ? projection
    : projectionWithoutError;

  return {
    ...baseProjection,
    archiveStatus,
    currentStep:
      archiveStatus === "ARCHIVED" ? "task-archived" : "task-archive",
    lastEventAt: now,
    events: [...projection.events, event],
    ...(options.archivePath === undefined
      ? {}
      : { archivePath: options.archivePath }),
    ...(options.error === undefined ? {} : { error: options.error }),
  };
}

function toPascalCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
