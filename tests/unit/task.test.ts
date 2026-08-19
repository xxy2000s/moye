import { describe, expect, it } from "vitest";

import {
  closeTask,
  createTaskProjection,
  failTask,
  transitionTask,
  updateArchiveStatus,
} from "../../src/domain/task.js";

const input = {
  taskId: "TASK-0001",
  projectId: "moye",
  title: "Build the runtime",
  specRevision: 1,
  backlogRefs: ["BL-0001"],
} as const;

describe("task lifecycle", () => {
  it("keeps CLOSED separate from archive completion", () => {
    const created = createTaskProjection(input, "2026-08-19T00:00:00.000Z");
    const executing = transitionTask(
      created,
      "EXECUTING",
      "implementation",
      "2026-08-19T00:00:01.000Z",
    );
    const verifying = transitionTask(
      executing,
      "VERIFYING",
      "verification",
      "2026-08-19T00:00:02.000Z",
    );
    const closed = closeTask(
      verifying,
      "SUCCEEDED",
      "2026-08-19T00:00:03.000Z",
    );

    expect(closed.state).toBe("CLOSED");
    expect(closed.archiveStatus).toBe("PENDING");

    const archived = updateArchiveStatus(
      closed,
      "ARCHIVED",
      "2026-08-19T00:00:04.000Z",
      { archivePath: "archive/2026-08-19-TASK-0001" },
    );
    expect(archived.state).toBe("CLOSED");
    expect(archived.archiveStatus).toBe("ARCHIVED");
    expect(archived.archivePath).toContain("TASK-0001");
  });

  it("rejects invalid transitions", () => {
    const created = createTaskProjection(input, "2026-08-19T00:00:00.000Z");
    expect(() =>
      transitionTask(
        created,
        "CLOSED",
        "invalid",
        "2026-08-19T00:00:01.000Z",
      ),
    ).toThrow(/Cannot transition/);
  });

  it("increments attempts only when entering execution", () => {
    const created = createTaskProjection(input, "2026-08-19T00:00:00.000Z");
    const first = transitionTask(
      created,
      "EXECUTING",
      "implementation",
      "2026-08-19T00:00:01.000Z",
    );
    const verifying = transitionTask(
      first,
      "VERIFYING",
      "verification",
      "2026-08-19T00:00:02.000Z",
    );
    const repair = transitionTask(
      verifying,
      "EXECUTING",
      "repair",
      "2026-08-19T00:00:03.000Z",
    );

    expect(first.attempt).toBe(1);
    expect(verifying.attempt).toBe(1);
    expect(repair.attempt).toBe(2);
  });

  it("closes an exhausted pipeline failure without pretending it succeeded", () => {
    const created = createTaskProjection(input, "2026-08-19T00:00:00.000Z");
    const executing = transitionTask(
      created,
      "EXECUTING",
      "implementation",
      "2026-08-19T00:00:01.000Z",
    );
    const failed = failTask(
      executing,
      "retry budget exhausted",
      "2026-08-19T00:00:02.000Z",
    );

    expect(failed.state).toBe("CLOSED");
    expect(failed.outcome).toBe("FAILED_TERMINAL");
    expect(failed.archiveStatus).toBe("PENDING");
    expect(failed.error).toBe("retry budget exhausted");
  });
});
