export const ARCHIVE_OPERATION_STATUSES = [
  "REQUESTED",
  "VALIDATING",
  "FREEZING",
  "MOVING",
  "VERIFYING",
  "ARCHIVED",
  "FAILED",
] as const;

export type ArchiveOperationStatus =
  (typeof ARCHIVE_OPERATION_STATUSES)[number];

export interface ArchiveInput {
  readonly taskId: string;
  readonly projectId: string;
  readonly specRevision: number;
  readonly activeTasksRoot: string;
  readonly archiveRoot: string;
  readonly archivedAt: string;
  readonly fault?: {
    readonly exitAfterMoveOnce?: boolean;
    readonly markerPath?: string;
  };
}

export interface ArchiveProjection {
  readonly taskId: string;
  readonly operationId: string;
  readonly status: ArchiveOperationStatus;
  readonly currentStep: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly expectedDigest?: string;
  readonly archivedAt?: string;
  readonly error?: string;
}

export interface ArchiveMoveResult {
  readonly outcome: "MOVED" | "ALREADY_MOVED" | "DUPLICATE_RECONCILED";
  readonly targetPath: string;
  readonly digest: string;
}

export function archiveOperationId(
  taskId: string,
  specRevision: number,
): string {
  return `archive/${taskId}/revision-${specRevision}`;
}
