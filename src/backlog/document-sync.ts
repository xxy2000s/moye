import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import {
  BACKLOG_KINDS,
  BACKLOG_PRIORITIES,
  BACKLOG_STATUSES,
  backlogBatchId,
} from "../domain/backlog.js";
import type { BacklogProjection, BacklogSyncInput } from "../domain/backlog.js";
import { MoyeError } from "../domain/errors.js";

interface DocumentBacklog {
  readonly schema_version: number;
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly status: string;
  readonly priority: string;
  readonly problem?: {
    readonly observed: string;
    readonly expected: string;
    readonly impact: string;
    readonly evidence_refs: readonly string[];
  };
  readonly source_refs: readonly string[];
  readonly affected_areas: readonly string[];
  readonly acceptance_outline: readonly string[];
  readonly resolution: {
    readonly task_refs: readonly string[];
    readonly duplicate_of: string | null;
    readonly reason: string | null;
  };
}

const TOP_LEVEL_V1_KEYS = [
  "schema_version", "id", "title", "kind", "status", "priority", "source_refs",
  "affected_areas", "acceptance_outline", "resolution",
] as const;
const TOP_LEVEL_V2_KEYS = [...TOP_LEVEL_V1_KEYS, "problem"] as const;
const PROBLEM_KEYS = ["observed", "expected", "impact", "evidence_refs"] as const;
const RESOLUTION_KEYS = ["task_refs", "duplicate_of", "reason"] as const;

export async function loadBacklogSyncBatch(
  directory: string,
  cwd = process.cwd(),
  selectedIds?: readonly string[],
): Promise<BacklogSyncInput> {
  const absoluteDirectory = path.resolve(cwd, directory);
  const requested = selectedIds === undefined ? undefined : validateSelectedIds(selectedIds);
  const entries = (await readdir(absoluteDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^BL-[A-Z0-9-]+\.yaml$/.test(entry.name))
    .filter((entry) => requested === undefined || requested.has(entry.name.slice(0, -".yaml".length)))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (requested !== undefined) {
    const found = new Set(entries.map((entry) => entry.name.slice(0, -".yaml".length)));
    const missing = [...requested].filter((id) => !found.has(id));
    if (missing.length > 0) throw validationError(`Selected backlog ids not found: ${missing.join(", ")}`);
  }
  const items = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(absoluteDirectory, entry.name);
    const [raw, metadata] = await Promise.all([
      readFile(absolutePath, "utf8"),
      stat(absolutePath),
    ]);
    const item = convertBacklogDocument(
      parse(raw, { maxAliasCount: 0 }) as unknown,
      normalizeRelativePath(path.relative(cwd, absolutePath)),
      createHash("sha256").update(raw).digest("hex"),
      metadata.mtime.toISOString(),
    );
    const fileId = entry.name.slice(0, -".yaml".length);
    if (item.backlogId !== fileId) {
      throw validationError(`${entry.name}: id must match filename (${fileId})`);
    }
    return item;
  }));

  const duplicates = duplicateIds(items.map((item) => item.backlogId));
  if (duplicates.length > 0) {
    throw validationError(`Duplicate backlog ids: ${duplicates.join(", ")}`);
  }
  const missingPolicy = "PRESERVE" as const;
  const batchId = backlogBatchId(items, missingPolicy);
  return { batchId, missingPolicy, items };
}

function validateSelectedIds(ids: readonly string[]): Set<string> {
  if (ids.length === 0) throw validationError("Selected backlog ids must not be empty");
  const invalid = ids.filter((id) => !/^BL-[A-Z0-9][A-Z0-9-]{0,63}$/.test(id));
  if (invalid.length > 0) throw validationError(`Invalid selected backlog ids: ${invalid.join(", ")}`);
  const duplicates = duplicateIds(ids);
  if (duplicates.length > 0) throw validationError(`Duplicate selected backlog ids: ${duplicates.join(", ")}`);
  return new Set(ids);
}

export function convertBacklogDocument(
  input: unknown,
  sourcePath: string,
  sourceDigest: string,
  updatedAt: string,
): BacklogProjection {
  if (!isRecord(input)) throw validationError(`${sourcePath}: document must be an object`);
  const document = input as Partial<DocumentBacklog>;
  if (document.schema_version !== 1 && document.schema_version !== 2) {
    throw validationError(`${sourcePath}: schema_version must be 1 or 2`);
  }
  rejectUnknownKeys(input, document.schema_version === 1 ? TOP_LEVEL_V1_KEYS : TOP_LEVEL_V2_KEYS, sourcePath);
  const backlogId = requiredString(document.id, sourcePath, "id");
  if (!/^BL-[A-Z0-9][A-Z0-9-]{0,63}$/.test(backlogId)) {
    throw validationError(`${sourcePath}: invalid backlog id ${backlogId}`);
  }
  const title = requiredString(document.title, sourcePath, "title");
  const kind = enumValue(document.kind, BACKLOG_KINDS, sourcePath, "kind");
  const status = enumValue(document.status, BACKLOG_STATUSES, sourcePath, "status");
  const priority = enumValue(document.priority, BACKLOG_PRIORITIES, sourcePath, "priority");
  const sourceRefs = refArray(document.source_refs, sourcePath, "source_refs", /^[a-z0-9][a-z0-9-]*$/);
  const affectedAreas = stringArray(document.affected_areas, sourcePath, "affected_areas");
  const acceptanceOutline = stringArray(document.acceptance_outline, sourcePath, "acceptance_outline");
  const problem = document.schema_version === 2
    ? parseProblem(document.problem, sourcePath)
    : undefined;
  if (!isRecord(document.resolution)) throw validationError(`${sourcePath}: resolution must be an object`);
  rejectUnknownKeys(document.resolution, RESOLUTION_KEYS, `${sourcePath}:resolution`);
  const taskRefs = refArray(document.resolution.task_refs, sourcePath, "resolution.task_refs", /^TASK-[A-Z0-9][A-Z0-9-]{0,63}$/);
  optionalRef(document.resolution.duplicate_of, sourcePath, "resolution.duplicate_of", /^BL-[A-Z0-9][A-Z0-9-]{0,63}$/);
  optionalString(document.resolution.reason, sourcePath, "resolution.reason");
  if (!/^[0-9a-f]{64}$/.test(sourceDigest)) throw validationError(`${sourcePath}: invalid source digest`);
  if (Number.isNaN(Date.parse(updatedAt))) throw validationError(`${sourcePath}: invalid updatedAt`);

  return {
    schemaVersion: document.schema_version,
    backlogId,
    title,
    kind,
    status,
    priority,
    sourceRefs,
    affectedAreas,
    acceptanceOutline,
    ...(problem === undefined ? {} : { problem }),
    taskRefs,
    updatedAt,
    source: { kind: "DOCUMENT", path: sourcePath, digest: sourceDigest },
  };
}

function parseProblem(value: unknown, sourcePath: string): NonNullable<BacklogProjection["problem"]> {
  if (!isRecord(value)) throw validationError(`${sourcePath}: problem must be an object`);
  rejectUnknownKeys(value, PROBLEM_KEYS, `${sourcePath}:problem`);
  return {
    observed: requiredString(value["observed"], sourcePath, "problem.observed"),
    expected: requiredString(value["expected"], sourcePath, "problem.expected"),
    impact: requiredString(value["impact"], sourcePath, "problem.impact"),
    evidenceRefs: stringArray(value["evidence_refs"], sourcePath, "problem.evidence_refs"),
  };
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  sourcePath: string,
  field: string,
): T {
  const raw = requiredString(value, sourcePath, field);
  if (raw !== raw.toLowerCase()) {
    throw validationError(`${sourcePath}: ${field} must use lowercase document enum values`);
  }
  const normalized = raw.toUpperCase();
  if (!allowed.includes(normalized as T)) {
    throw validationError(`${sourcePath}: ${field} must be one of ${allowed.join(", ")}`);
  }
  return normalized as T;
}

function requiredString(value: unknown, sourcePath: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(`${sourcePath}: ${field} must be a non-empty string`);
  }
  return value.trim();
}

function stringArray(value: unknown, sourcePath: string, field: string, allowEmpty = true): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw validationError(`${sourcePath}: ${field} must be an array of non-empty strings`);
  }
  if (!allowEmpty && value.length === 0) throw validationError(`${sourcePath}: ${field} must not be empty`);
  return value.map((item) => (item as string).trim());
}

function refArray(
  value: unknown,
  sourcePath: string,
  field: string,
  pattern: RegExp,
): string[] {
  const refs = stringArray(value, sourcePath, field);
  if (refs.some((ref) => !pattern.test(ref))) throw validationError(`${sourcePath}: ${field} contains an invalid ref`);
  return refs;
}

function optionalRef(value: unknown, sourcePath: string, field: string, pattern: RegExp): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "string" || !pattern.test(value)) throw validationError(`${sourcePath}: ${field} is invalid`);
}

function optionalString(value: unknown, sourcePath: string, field: string): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0) throw validationError(`${sourcePath}: ${field} must be null or non-empty string`);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  sourcePath: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw validationError(`${sourcePath}: unknown fields ${unknown.join(", ")}`);
}

function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return [...new Set(ids.filter((id) => seen.has(id) || !seen.add(id)))].sort();
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationError(message: string): MoyeError {
  return new MoyeError({ code: "INVALID_BACKLOG_DOCUMENT", category: "VALIDATION", message });
}
