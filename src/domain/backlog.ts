import { createHash } from "node:crypto";

import { MoyeError } from "./errors.js";

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

export const BACKLOG_KINDS = [
  "FEATURE",
  "BUG",
  "DEBT",
  "DOCS",
  "INVESTIGATION",
] as const;

export const BACKLOG_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export interface BacklogDocumentSource {
  readonly kind: "DOCUMENT";
  readonly path: string;
  readonly digest: string;
}

export interface BacklogProblem {
  readonly observed: string;
  readonly expected: string;
  readonly impact: string;
  readonly evidenceRefs: readonly string[];
}

export interface BacklogProjection {
  readonly schemaVersion: 1 | 2;
  readonly backlogId: string;
  readonly title: string;
  readonly kind: (typeof BACKLOG_KINDS)[number];
  readonly status: BacklogStatus;
  readonly priority: (typeof BACKLOG_PRIORITIES)[number];
  readonly sourceRefs: readonly string[];
  readonly affectedAreas: readonly string[];
  readonly acceptanceOutline: readonly string[];
  readonly problem?: BacklogProblem;
  readonly taskRefs: readonly string[];
  readonly updatedAt: string;
  readonly source?: BacklogDocumentSource;
}

export interface BacklogSyncInput {
  readonly batchId: string;
  readonly missingPolicy: "PRESERVE";
  readonly items: readonly BacklogProjection[];
}

export interface BacklogSyncResult {
  readonly batchId: string;
  readonly received: number;
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly preservedIds: readonly string[];
  readonly changed: boolean;
}

export function mergeBacklogBatch(
  current: Readonly<Record<string, BacklogProjection>>,
  input: BacklogSyncInput,
): { readonly backlog: Record<string, BacklogProjection>; readonly result: BacklogSyncResult } {
  const expectedBatchId = backlogBatchId(input.items, input.missingPolicy);
  if (input.batchId !== expectedBatchId) {
    throw validationError("Backlog sync batchId does not match its canonical items");
  }
  if (input.missingPolicy !== "PRESERVE") {
    throw validationError(`Unsupported missing policy: ${String(input.missingPolicy)}`);
  }

  const seen = new Set<string>();
  const next: Record<string, BacklogProjection> = { ...current };
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const incoming of input.items) {
    assertBacklogProjection(incoming, true);
    if (seen.has(incoming.backlogId)) {
      throw validationError(`Duplicate backlog id in sync batch: ${incoming.backlogId}`);
    }
    seen.add(incoming.backlogId);
    const existing = current[incoming.backlogId];
    if (existing === undefined) {
      next[incoming.backlogId] = incoming;
      inserted += 1;
      continue;
    }
    if (existing.source === undefined && incoming.source?.kind === "DOCUMENT") {
      throw new MoyeError({
        code: "RUNTIME_BACKLOG_OWNERSHIP_CONFLICT",
        category: "CONFLICT",
        message: `Backlog ${incoming.backlogId} is already owned by runtime input`,
      });
    }

    const normalized = existing.source?.kind === "DOCUMENT" &&
        incoming.source?.kind === "DOCUMENT" &&
        existing.source.digest === incoming.source.digest
      ? { ...incoming, updatedAt: existing.updatedAt }
      : incoming;
    if (sameBacklog(existing, normalized)) {
      unchanged += 1;
    } else {
      next[incoming.backlogId] = normalized;
      updated += 1;
    }
  }

  const preservedIds = Object.keys(current)
    .filter((id) => !seen.has(id))
    .sort();
  const changed = inserted > 0 || updated > 0;
  return {
    backlog: changed ? next : { ...current },
    result: {
      batchId: input.batchId,
      received: input.items.length,
      inserted,
      updated,
      unchanged,
      preservedIds,
      changed,
    },
  };
}

export function backlogBatchId(
  items: readonly BacklogProjection[],
  missingPolicy: BacklogSyncInput["missingPolicy"],
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      missingPolicy,
      items: items.map((item) => ({
        backlogId: item.backlogId,
        sourcePath: item.source?.path,
        sourceDigest: item.source?.digest,
      })),
    }))
    .digest("hex");
}

export function upsertRuntimeBacklog(
  current: Readonly<Record<string, BacklogProjection>>,
  incoming: BacklogProjection,
): Record<string, BacklogProjection> {
  assertBacklogProjection(incoming, false);
  const existing = current[incoming.backlogId];
  if (existing?.source?.kind === "DOCUMENT") {
    throw new MoyeError({
      code: "DOCUMENT_BACKLOG_OWNERSHIP_CONFLICT",
      category: "CONFLICT",
      message: `Backlog ${incoming.backlogId} is owned by document sync`,
    });
  }
  return { ...current, [incoming.backlogId]: incoming };
}

export function assertBacklogProjection(item: BacklogProjection, requireDocumentSource: boolean): void {
  if (item.schemaVersion !== 1 && item.schemaVersion !== 2) {
    throw validationError(`Invalid backlog schema version: ${String(item.schemaVersion)}`);
  }
  if (!/^BL-[A-Z0-9][A-Z0-9-]{0,63}$/.test(item.backlogId)) {
    throw validationError(`Invalid backlog id: ${item.backlogId}`);
  }
  if (!item.title.trim()) throw validationError(`Backlog ${item.backlogId} title is required`);
  if (!BACKLOG_KINDS.includes(item.kind)) throw validationError(`Invalid backlog kind: ${String(item.kind)}`);
  if (!BACKLOG_STATUSES.includes(item.status)) throw validationError(`Invalid backlog status: ${String(item.status)}`);
  if (!BACKLOG_PRIORITIES.includes(item.priority)) throw validationError(`Invalid backlog priority: ${String(item.priority)}`);
  if (!stringList(item.sourceRefs) || !stringList(item.affectedAreas) ||
      !stringList(item.acceptanceOutline) || !stringList(item.taskRefs)) {
    throw validationError(`Backlog ${item.backlogId} refs must be non-empty strings when present`);
  }
  if (item.schemaVersion === 2) {
    assertBacklogProblem(item.backlogId, item.problem);
  } else if (item.problem !== undefined) {
    throw validationError(`Backlog ${item.backlogId} schema v1 cannot contain problem`);
  }
  if (Number.isNaN(Date.parse(item.updatedAt))) throw validationError(`Invalid backlog updatedAt: ${item.updatedAt}`);
  if (requireDocumentSource) {
    if (item.source?.kind !== "DOCUMENT" ||
        !item.source.path || item.source.path.startsWith("/") || item.source.path.split(/[\\/]/).includes("..") ||
        !/^[0-9a-f]{64}$/.test(item.source.digest)) {
      throw validationError(`Backlog ${item.backlogId} requires a valid document source`);
    }
    if (pathBacklogId(item.source.path) !== item.backlogId) {
      throw validationError(`Backlog ${item.backlogId} must match document source filename`);
    }
  } else if (item.source !== undefined) {
    throw validationError("Document-owned backlog must be written through syncBacklog");
  } else if (item.schemaVersion !== 2) {
    throw validationError("Runtime-created backlog must use schema version 2");
  }
}

function assertBacklogProblem(backlogId: string, problem: BacklogProblem | undefined): void {
  if (problem === undefined || typeof problem !== "object" ||
      !nonEmptyString(problem.observed) || !nonEmptyString(problem.expected) ||
      !nonEmptyString(problem.impact) || !stringList(problem.evidenceRefs)) {
    throw validationError(`Backlog ${backlogId} requires a complete v2 problem`);
  }
}

function pathBacklogId(sourcePath: string): string {
  const filename = sourcePath.split(/[\\/]/).at(-1) ?? "";
  return filename.endsWith(".yaml") ? filename.slice(0, -5) : "";
}

function sameBacklog(left: BacklogProjection, right: BacklogProjection): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stringList(value: readonly string[]): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validationError(message: string): MoyeError {
  return new MoyeError({ code: "INVALID_BACKLOG_PROJECTION", category: "VALIDATION", message });
}
