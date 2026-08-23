import { describe, expect, it } from "vitest";

import { buildBoardSnapshot, normalizeBoardTask } from "../../src/domain/board.js";
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

  it("preserves exact Core runtime state without changing the four Board lanes", () => {
    const created = createTaskProjection({
      taskId: "TASK-RCV-BOARD-1",
      projectId: "moye",
      title: "Core v2 real recovery acceptance",
      specRevision: 1,
      backlogRefs: [],
    }, "2026-08-23T00:00:00.000Z");
    const waiting = {
      ...created,
      state: "EXECUTING" as const,
      runtimeState: "WAITING_RECONCILE",
      workflowKind: "CORE_V2" as const,
    };
    const board = buildBoardSnapshot("moye", { [waiting.taskId]: waiting }, {}, "2026-08-23T00:01:00.000Z");

    expect(board.active).toHaveLength(1);
    expect(board.active[0]).toMatchObject({
      runtimeState: "WAITING_RECONCILE",
      workflowKind: "CORE_V2",
      historyKind: "PRODUCT_ACCEPTANCE",
      historyKindSource: "LEGACY_CONVENTION",
    });
    expect(board.archivePending).toHaveLength(0);
  });

  it("selects the newest successful archived Task as a read-only shortcut", () => {
    const older = archivedSuccess("TASK-BOARD-OLD", "2026-08-23T00:01:00.000Z");
    const newer = archivedSuccess("TASK-BOARD-NEW", "2026-08-23T00:02:00.000Z");
    const failed = { ...archivedSuccess("TASK-BOARD-FAILED", "2026-08-23T00:03:00.000Z"), outcome: "FAILED_TERMINAL" as const };
    const board = buildBoardSnapshot("moye", { [older.taskId]: older, [newer.taskId]: newer, [failed.taskId]: failed }, {}, "2026-08-23T00:04:00.000Z");

    expect(board.latestSucceeded?.taskId).toBe("TASK-BOARD-NEW");
  });

  it("prefers explicit Workflow input history metadata over legacy naming", () => {
    const task = normalizeBoardTask({
      ...createTaskProjection({ taskId: "TASK-ACCEPT-NORMAL", projectId: "moye", title: "ordinary task", specRevision: 1, backlogRefs: [] }, "2026-08-23T00:00:00.000Z"),
      historyKind: "PROJECT_TASK",
      historyKindSource: "WORKFLOW_INPUT",
    }, "CORE_V2");
    expect(task).toMatchObject({ historyKind: "PROJECT_TASK", historyKindSource: "WORKFLOW_INPUT", workflowKind: "CORE_V2" });
  });

  it("recognizes pre-metadata Core v2 LIVE tasks as legacy product acceptance history", () => {
    const task = normalizeBoardTask(createTaskProjection({
      taskId: "TASK-CORE-V2-LIVE-006",
      projectId: "moye",
      title: "Core v2 live run",
      specRevision: 1,
      backlogRefs: [],
    }, "2026-08-23T00:00:00.000Z"), "CORE_V2");
    expect(task).toMatchObject({
      historyKind: "PRODUCT_ACCEPTANCE",
      historyKindSource: "LEGACY_CONVENTION",
    });
  });
});

function archivedSuccess(taskId: string, at: string) {
  const created = createTaskProjection({ taskId, projectId: "moye", title: taskId, specRevision: 1, backlogRefs: [] }, at);
  return {
    ...created,
    state: "CLOSED" as const,
    outcome: "SUCCEEDED" as const,
    archiveStatus: "ARCHIVED" as const,
    lastEventAt: at,
  };
}
