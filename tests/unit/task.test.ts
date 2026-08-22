import { describe, expect, it } from "vitest";

import {
  closeTask,
  createTaskProjection,
  failTask,
  recordBootstrapEvidence,
  recoverFailedBootstrapTask,
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
  it("only recovers an unevidenced executing bootstrap projection by appending history", () => {
    const created = createTaskProjection(input, "2026-08-19T00:00:00.000Z");
    const executing = transitionTask(created, "EXECUTING", "implementation", "2026-08-19T00:00:01.000Z");
    const recovered = recoverFailedBootstrapTask(
      executing,
      "restate://TaskWorkflow/TASK-0001#inv_source",
      "base not frozen",
      "2026-08-19T00:00:02.000Z",
    );
    expect(recovered).toMatchObject({ state: "CLOSED", outcome: "FAILED_TERMINAL", archiveStatus: "PENDING" });
    expect(recovered.events.map((event) => event.type)).toEqual([
      "TaskCreated", "TaskExecuting", "TaskRecoveryStarted", "TaskClosed",
    ]);
    expect(() => recoverFailedBootstrapTask(
      recovered,
      "restate://TaskWorkflow/TASK-0001#inv_source",
      "again",
      "2026-08-19T00:00:03.000Z",
    )).toThrow(/not an unevidenced EXECUTING/);
  });

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

  it("records truthful bootstrap evidence without claiming an agent ran", () => {
    const created = createTaskProjection(input, "2026-08-19T00:00:00.000Z");
    const executing = transitionTask(created, "EXECUTING", "bootstrap-execution", "2026-08-19T00:00:01.000Z");
    const evidenced = recordBootstrapEvidence(executing, {
      kind: "GOAL_BOOTSTRAP",
      executorId: "goal/root",
      resultCommit: "a".repeat(40),
      verificationRefs: ["task-artifact://TASK-0002/verification.md"],
      docsImpactRef: "task-artifact://TASK-0002/docs-impact.yaml",
    }, "2026-08-19T00:00:02.000Z");

    expect(evidenced.execution?.kind).toBe("GOAL_BOOTSTRAP");
    expect(evidenced.events.at(-1)?.type).toBe("BootstrapEvidenceAccepted");
    expect(evidenced.currentStep).toBe("bootstrap-evidence-accepted");
  });

  it("rejects incomplete bootstrap evidence", () => {
    const created = createTaskProjection(input, "2026-08-19T00:00:00.000Z");
    const executing = transitionTask(created, "EXECUTING", "bootstrap-execution", "2026-08-19T00:00:01.000Z");
    expect(() => recordBootstrapEvidence(executing, {
      kind: "GOAL_BOOTSTRAP",
      executorId: "goal/root",
      resultCommit: "short",
      verificationRefs: [],
      docsImpactRef: "../escape.yaml",
    }, "2026-08-19T00:00:02.000Z")).toThrow(/resultCommit/);
  });

  it("rejects a runtime JSON evidence kind that only bypassed TypeScript", () => {
    const created = createTaskProjection(input, "2026-08-19T00:00:00.000Z");
    const executing = transitionTask(created, "EXECUTING", "bootstrap-execution", "2026-08-19T00:00:01.000Z");
    expect(() => recordBootstrapEvidence(executing, {
      kind: "AGENT",
      executorId: "untrusted",
      resultCommit: "a".repeat(40),
      verificationRefs: ["task-artifact://TASK-0001/verification.md"],
      docsImpactRef: "task-artifact://TASK-0001/docs-impact.yaml",
    } as never, "2026-08-19T00:00:02.000Z")).toThrow(/kind must be GOAL_BOOTSTRAP/);
  });
});
