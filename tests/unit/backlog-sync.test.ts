import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { convertBacklogDocument, loadBacklogSyncBatch } from "../../src/backlog/document-sync.js";
import { backlogBatchId, mergeBacklogBatch, upsertRuntimeBacklog } from "../../src/domain/backlog.js";
import type { BacklogProjection } from "../../src/domain/backlog.js";

describe("backlog document sync", () => {
  it("strictly converts document fields and enum casing", () => {
    const item = convertBacklogDocument({
      schema_version: 1,
      id: "BL-0042",
      title: "Document backlog",
      kind: "feature",
      status: "ready",
      priority: "high",
      source_refs: ["finding-42"],
      affected_areas: ["backlog"],
      acceptance_outline: ["sync succeeds"],
      resolution: { task_refs: ["TASK-0042"], duplicate_of: null, reason: null },
    }, "docs/delivery/backlog/BL-0042.yaml", "a".repeat(64), "2026-08-20T00:00:00.000Z");

    expect(item).toMatchObject({
      backlogId: "BL-0042",
      kind: "FEATURE",
      status: "READY",
      priority: "HIGH",
      sourceRefs: ["finding-42"],
      taskRefs: ["TASK-0042"],
      source: { kind: "DOCUMENT", digest: "a".repeat(64) },
    });
  });

  it("rejects an unknown enum before a batch can be submitted", () => {
    expect(() => convertBacklogDocument({
      schema_version: 1,
      id: "BL-0042",
      title: "Invalid",
      kind: "feature",
      status: "almost-ready",
      priority: "high",
      source_refs: [],
      affected_areas: ["backlog"],
      acceptance_outline: ["rejected"],
      resolution: { task_refs: [], duplicate_of: null, reason: null },
    }, "BL-0042.yaml", "b".repeat(64), "2026-08-20T00:00:00.000Z")).toThrow(/status must be one of/);
  });

  it("loads a deterministic batch only after every file validates", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "moye-backlog-"));
    await writeFile(path.join(directory, "BL-0002.yaml"), backlogYaml("BL-0002", "ready"));
    await writeFile(path.join(directory, "BL-0003.yaml"), backlogYaml("BL-0003", "triaged"));

    const first = await loadBacklogSyncBatch(directory);
    const second = await loadBacklogSyncBatch(directory);

    expect(first.items.map((item) => item.backlogId)).toEqual(["BL-0002", "BL-0003"]);
    expect(second.batchId).toBe(first.batchId);
  });

  it("rejects a filename/id mismatch, unknown fields, and an invalid member of a multi-file batch", async () => {
    const mismatch = await mkdtemp(path.join(os.tmpdir(), "moye-backlog-mismatch-"));
    await writeFile(path.join(mismatch, "BL-0002.yaml"), backlogYaml("BL-0099", "ready"));
    await expect(loadBacklogSyncBatch(mismatch)).rejects.toThrow(/id must match filename/);

    expect(() => convertBacklogDocument({
      schema_version: 1,
      id: "BL-0042",
      title: "Unknown field",
      kind: "feature",
      status: "captured",
      priority: "medium",
      source_refs: [],
      affected_areas: [],
      acceptance_outline: [],
      resolution: { task_refs: [], duplicate_of: null, reason: null },
      surprise: true,
    }, "BL-0042.yaml", "b".repeat(64), "2026-08-20T00:00:00.000Z"))
      .toThrow(/unknown fields surprise/);

    const mixed = await mkdtemp(path.join(os.tmpdir(), "moye-backlog-mixed-"));
    await writeFile(path.join(mixed, "BL-0002.yaml"), backlogYaml("BL-0002", "ready"));
    await writeFile(path.join(mixed, "BL-0003.yaml"), backlogYaml("BL-0003", "not-a-status"));
    await expect(loadBacklogSyncBatch(mixed)).rejects.toThrow(/status must be one of/);
  });

  it("merges idempotently and preserves runtime-only records", () => {
    const existing = projection("BL-RUNTIME", "CAPTURED", "runtime");
    const imported = projection("BL-0002", "READY", "doc");
    const first = mergeBacklogBatch({ [existing.backlogId]: existing }, {
      batchId: batchId([imported]),
      missingPolicy: "PRESERVE",
      items: [imported],
    });
    const second = mergeBacklogBatch(first.backlog, {
      batchId: batchId([imported]),
      missingPolicy: "PRESERVE",
      items: [{ ...imported, updatedAt: "2026-08-20T01:00:00.000Z" }],
    });

    expect(first.result).toMatchObject({ inserted: 1, preservedIds: ["BL-RUNTIME"], changed: true });
    expect(second.result).toMatchObject({ unchanged: 1, preservedIds: ["BL-RUNTIME"], changed: false });
    expect(second.backlog["BL-0002"]?.updatedAt).toBe(imported.updatedAt);
  });

  it("rejects duplicate ids in a batch", () => {
    const item = projection("BL-0002", "READY", "doc");
    expect(() => mergeBacklogBatch({}, {
      batchId: batchId([item, item]),
      missingPolicy: "PRESERVE",
      items: [item, item],
    })).toThrow(/Duplicate backlog id/);
  });

  it("rejects a forged batch digest at the runtime boundary", () => {
    const item = projection("BL-0002", "READY", "doc");
    expect(() => mergeBacklogBatch({}, {
      batchId: "0".repeat(64),
      missingPolicy: "PRESERVE",
      items: [item],
    })).toThrow(/batchId does not match/);
  });

  it("preserves a previously imported document when it disappears from the next batch", () => {
    const imported = projection("BL-0002", "READY", "doc");
    const result = mergeBacklogBatch({ [imported.backlogId]: imported }, {
      batchId: batchId([]),
      missingPolicy: "PRESERVE",
      items: [],
    });

    expect(result.backlog[imported.backlogId]).toEqual(imported);
    expect(result.result).toMatchObject({ changed: false, preservedIds: ["BL-0002"] });
  });

  it("updates a document-owned projection when its source digest changes", () => {
    const imported = projection("BL-0002", "READY", "doc");
    const changed = {
      ...imported,
      title: "Updated title",
      updatedAt: "2026-08-20T01:00:00.000Z",
      source: { ...imported.source!, digest: "e".repeat(64) },
    };
    const result = mergeBacklogBatch({ [imported.backlogId]: imported }, {
      batchId: batchId([changed]),
      missingPolicy: "PRESERVE",
      items: [changed],
    });

    expect(result.result).toMatchObject({ inserted: 0, updated: 1, unchanged: 0, changed: true });
    expect(result.backlog[imported.backlogId]?.title).toBe("Updated title");
  });

  it("rejects ownership collisions in both write directions", () => {
    const runtime = projection("BL-COLLISION", "CAPTURED", "runtime");
    const document = projection("BL-COLLISION", "READY", "doc");

    expect(() => mergeBacklogBatch({ [runtime.backlogId]: runtime }, {
      batchId: batchId([document]),
      missingPolicy: "PRESERVE",
      items: [document],
    })).toThrow(/owned by runtime input/);
    expect(() => upsertRuntimeBacklog({ [document.backlogId]: document }, runtime))
      .toThrow(/owned by document sync/);
  });
});

function projection(
  backlogId: string,
  status: BacklogProjection["status"],
  source: "doc" | "runtime",
): BacklogProjection {
  return {
    backlogId,
    title: backlogId,
    kind: "FEATURE",
    status,
    priority: "HIGH",
    sourceRefs: [],
    taskRefs: [],
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...(source === "doc" ? {
      source: { kind: "DOCUMENT" as const, path: `${backlogId}.yaml`, digest: "c".repeat(64) },
    } : {}),
  };
}

function backlogYaml(id: string, status: string): string {
  return `schema_version: 1\nid: "${id}"\ntitle: "${id}"\nkind: "feature"\nstatus: "${status}"\npriority: "high"\nsource_refs: []\naffected_areas:\n  - backlog\nacceptance_outline:\n  - sync succeeds\nresolution:\n  task_refs: []\n  duplicate_of:\n  reason:\n`;
}

function batchId(items: readonly BacklogProjection[]): string {
  return backlogBatchId(items, "PRESERVE");
}
