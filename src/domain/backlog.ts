export const BACKLOG_STATUSES = [
  "CAPTURED",
  "TRIAGED",
  "READY",
  "SCHEDULED",
  "CONVERTED_TO_TASK",
  "DEFERRED",
  "DUPLICATE",
  "REJECTED",
] as const;

export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

export interface BacklogProjection {
  readonly backlogId: string;
  readonly title: string;
  readonly kind: "FEATURE" | "BUG" | "DEBT" | "DOCS" | "INVESTIGATION";
  readonly status: BacklogStatus;
  readonly priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly sourceRefs: readonly string[];
  readonly taskRefs: readonly string[];
  readonly updatedAt: string;
}
