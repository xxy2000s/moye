import { describe, expect, it } from "vitest";

import { buildBoardSnapshot } from "../../src/domain/board.js";
import { createTaskProjection, closeTask, updateArchiveStatus } from "../../src/domain/task.js";

describe("project board projection", () => {
  it("keeps business closure separate from archive completion", () => {
    const created = createTaskProjection({
      taskId: "TASK-BOARD-1",
      projectId: "moye",
      title: "Projection fixture",
      specRevision: 1,
      backlogRefs: [],
    }, "2026-08-19T00:00:00.000Z");
    const executing = { ...created, state: "VERIFYING" as const };
    const closed = closeTask(executing, "SUCCEEDED", "2026-08-19T00:01:00.000Z");
    const archived = updateArchiveStatus(closed, "ARCHIVED", "2026-08-19T00:02:00.000Z");

    const pendingBoard = buildBoardSnapshot("moye", { [closed.taskId]: closed }, {}, "2026-08-19T00:03:00.000Z");
    const archivedBoard = buildBoardSnapshot("moye", { [archived.taskId]: archived }, {}, "2026-08-19T00:03:00.000Z");

    expect(pendingBoard.archivePending).toHaveLength(1);
    expect(pendingBoard.archived).toHaveLength(0);
    expect(archivedBoard.archivePending).toHaveLength(0);
    expect(archivedBoard.archived).toHaveLength(1);
  });
});
