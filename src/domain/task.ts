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
export type BoardWorkflowKind = "TASK" | "SEALED_TASK" | "CODING" | "CORE" | "CORE_V2" | "UNKNOWN";
export type TaskHistoryKind = "PROJECT_TASK" | "PRODUCT_ACCEPTANCE";
export type TaskHistoryKindSource = "WORKFLOW_INPUT" | "LEGACY_CONVENTION" | "DEFAULT";

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
  /** Exact owning Workflow state for read-only Board presentation. */
  readonly runtimeState?: string;
  /** Presentation metadata; TaskAuthority remains the owner source of truth. */
  readonly workflowKind?: BoardWorkflowKind;
  readonly historyKind?: TaskHistoryKind;
  readonly historyKindSource?: TaskHistoryKindSource;
  readonly archivePath?: string;
  readonly outcome?: TaskOutcome;
  readonly error?: string;
  readonly lastEventAt: string;
  readonly events: readonly TaskEventSummary[];
  readonly execution?: TaskExecutionEvidence;
  readonly seal?: TaskSealSummary;
}

export interface TaskSealSummary {
  readonly intentDigest: string;
  readonly baseCommit: string;
  readonly archivePath: string;
  readonly resultCommit?: string;
  readonly packageDigest?: string;
}

export interface TaskExecutionEvidence {
  readonly kind: "GOAL_BOOTSTRAP";
  readonly executorId: string;
  readonly resultCommit: string;
  readonly verificationRefs: readonly string[];
  readonly docsImpactRef: string;
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

export function recoverFailedBootstrapTask(
  projection: TaskProjection,
  sourceWorkflowRef: string,
  error: string,
  now: string,
): TaskProjection {
  if (projection.state !== "EXECUTING" || projection.archiveStatus !== "NOT_READY" ||
      projection.outcome !== undefined || projection.execution !== undefined) {
    throw new MoyeError({
      code: "BOOTSTRAP_RECOVERY_STATE_INVALID",
      category: "CONFLICT",
      message: `Task ${projection.taskId} is not an unevidenced EXECUTING bootstrap failure`,
    });
  }
  if (!sourceWorkflowRef.trim()) {
    throw new MoyeError({
      code: "BOOTSTRAP_RECOVERY_SOURCE_REQUIRED",
      category: "VALIDATION",
      message: "Bootstrap recovery requires the failed source Workflow reference",
    });
  }
  const recovering: TaskProjection = {
    ...projection,
    currentStep: "bootstrap-failure-recovery",
    lastEventAt: now,
    events: [...projection.events, {
      sequence: projection.events.length + 1,
      type: "TaskRecoveryStarted",
      at: now,
      detail: sourceWorkflowRef,
    }],
  };
  return failTask(recovering, error, now);
}

export function recoverFailedSealedTask(
  projection: TaskProjection,
  sourceWorkflowRef: string,
  resultCommit: string,
  now: string,
): TaskProjection {
  if (projection.state !== "CLOSED" || projection.archiveStatus !== "FAILED" ||
      projection.outcome !== "FAILED_TERMINAL" || projection.seal === undefined) {
    throw new MoyeError({
      code: "SEAL_RECOVERY_STATE_INVALID",
      category: "CONFLICT",
      message: `Task ${projection.taskId} is not a failed Sealed Task`,
    });
  }
  if (!/^restate:\/\/(?:SealedTaskWorkflow|SealedTaskRecoveryWorkflow|SealRecoveryAttemptWorkflow)\/[A-Z0-9-]+$/.test(sourceWorkflowRef)) {
    throw new MoyeError({
      code: "SEAL_RECOVERY_SOURCE_INVALID",
      category: "VALIDATION",
      message: "Seal recovery requires the exact source Workflow reference",
    });
  }
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(resultCommit)) {
    throw new MoyeError({ code: "SEAL_RECOVERY_COMMIT_INVALID", category: "VALIDATION", message: "Recovery Result Commit is invalid" });
  }
  const { outcome: _outcome, error: _error, archivePath: _archivePath, ...base } = projection;
  return {
    ...base,
    state: "VERIFYING",
    currentStep: "recovering-result-commit",
    archiveStatus: "NOT_READY",
    lastEventAt: now,
    events: [...projection.events, {
      sequence: projection.events.length + 1,
      type: "SealRecoveryStarted",
      at: now,
      detail: `${sourceWorkflowRef}#${resultCommit}`,
    }],
  };
}

export function recordBootstrapEvidence(
  projection: TaskProjection,
  evidence: TaskExecutionEvidence,
  now: string,
): TaskProjection {
  if (projection.state !== "EXECUTING") {
    throw new MoyeError({
      code: "BOOTSTRAP_EVIDENCE_INVALID_STATE",
      category: "CONFLICT",
      message: `Task ${projection.taskId} must be EXECUTING before bootstrap evidence is accepted`,
    });
  }
  if (evidence.kind !== "GOAL_BOOTSTRAP") {
    throw new MoyeError({
      code: "BOOTSTRAP_EVIDENCE_KIND_INVALID",
      category: "VALIDATION",
      message: "bootstrap evidence kind must be GOAL_BOOTSTRAP",
    });
  }
  if (!evidence.executorId.trim()) {
    throw new MoyeError({
      code: "BOOTSTRAP_EXECUTOR_REQUIRED",
      category: "VALIDATION",
      message: "bootstrap executorId is required",
    });
  }
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(evidence.resultCommit)) {
    throw new MoyeError({
      code: "BOOTSTRAP_COMMIT_INVALID",
      category: "VALIDATION",
      message: "bootstrap resultCommit must be a full Git object id",
    });
  }
  if (evidence.verificationRefs.length === 0) {
    throw new MoyeError({
      code: "BOOTSTRAP_VERIFICATION_REQUIRED",
      category: "VALIDATION",
      message: "bootstrap verificationRefs must not be empty",
    });
  }
  for (const ref of [...evidence.verificationRefs, evidence.docsImpactRef]) {
    if (!isSafeArtifactRef(ref)) {
      throw new MoyeError({
        code: "BOOTSTRAP_EVIDENCE_REF_INVALID",
        category: "VALIDATION",
        message: `Invalid bootstrap evidence ref: ${ref}`,
      });
    }
  }

  return {
    ...projection,
    currentStep: "bootstrap-evidence-accepted",
    execution: { ...evidence, verificationRefs: [...evidence.verificationRefs] },
    lastEventAt: now,
    events: [
      ...projection.events,
      {
        sequence: projection.events.length + 1,
        type: "BootstrapEvidenceAccepted",
        at: now,
        detail: `${evidence.executorId}:${evidence.resultCommit}`,
      },
    ],
  };
}

export function recordSealIntent(
  projection: TaskProjection,
  seal: TaskSealSummary,
  now: string,
): TaskProjection {
  if (projection.state !== "EXECUTING" || projection.seal !== undefined) {
    throw new MoyeError({
      code: "SEAL_INTENT_INVALID_STATE",
      category: "CONFLICT",
      message: `Task ${projection.taskId} must be EXECUTING without an existing Seal Intent`,
    });
  }
  return {
    ...projection,
    currentStep: "waiting-result-commit",
    seal,
    lastEventAt: now,
    events: [...projection.events, {
      sequence: projection.events.length + 1,
      type: "SealIntentPrepared",
      at: now,
      detail: seal.intentDigest,
    }],
  };
}

export function recordSealReceipt(
  projection: TaskProjection,
  resultCommit: string,
  packageDigest: string,
  now: string,
): TaskProjection {
  if (projection.state !== "VERIFYING" || projection.seal === undefined) {
    throw new MoyeError({
      code: "SEAL_RECEIPT_INVALID_STATE",
      category: "CONFLICT",
      message: `Task ${projection.taskId} must be VERIFYING with a Seal Intent`,
    });
  }
  return {
    ...projection,
    seal: { ...projection.seal, resultCommit, packageDigest },
    lastEventAt: now,
    events: [...projection.events, {
      sequence: projection.events.length + 1,
      type: "SealCommitVerified",
      at: now,
      detail: resultCommit,
    }],
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

function isSafeArtifactRef(value: string): boolean {
  return /^task-artifact:\/\/TASK-[A-Z0-9][A-Z0-9-]{0,63}\/[a-z0-9][a-z0-9.-]*$/.test(value);
}
