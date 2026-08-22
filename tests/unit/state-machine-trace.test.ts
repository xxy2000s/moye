import { describe, expect, it } from "vitest";

import type { CodingWorkflowProjection } from "../../src/coding/workflow.js";
import {
  closeTask,
  createTaskProjection,
  recordBootstrapEvidence,
  transitionTask,
  updateArchiveStatus,
} from "../../src/domain/task.js";
import { buildCodingStateMachine, buildTaskStateMachine } from "../../src/trace/state-machine.js";

describe("runtime state-machine trace", () => {
  it("derives a complete TaskWorkflow history from persisted Task events", () => {
    let projection = createTaskProjection({
      taskId: "TASK-MACHINE-001",
      projectId: "moye-test",
      title: "prove the lifecycle",
      specRevision: 1,
      backlogRefs: ["BL-TEST"],
    }, at(0));
    projection = transitionTask(projection, "EXECUTING", "implementation", at(1));
    projection = recordBootstrapEvidence(projection, {
      kind: "GOAL_BOOTSTRAP",
      executorId: "codex-test",
      resultCommit: "a".repeat(40),
      verificationRefs: ["task-artifact://TASK-MACHINE-001/verification"],
      docsImpactRef: "task-artifact://TASK-MACHINE-001/docs-impact",
    }, at(2));
    projection = transitionTask(projection, "VERIFYING", "verification", at(3));
    projection = closeTask(projection, "SUCCEEDED", at(4));
    projection = updateArchiveStatus(projection, "PENDING", at(5));
    projection = updateArchiveStatus(projection, "ARCHIVED", at(6), { archivePath: "/archive/TASK-MACHINE-001" });

    const machine = buildTaskStateMachine(projection);

    expect(machine).toMatchObject({
      authority: "derived-from-runtime-projection",
      workflow: "TaskWorkflow",
      current: { business: "CLOSED", archive: "ARCHIVED", overall: "ARCHIVED", consistency: "VERIFIED" },
    });
    expect(machine.history.map(({ eventType, from, to }) => ({ eventType, from, to }))).toEqual([
      { eventType: "TaskCreated", from: "START", to: "RECEIVED" },
      { eventType: "TaskExecuting", from: "RECEIVED", to: "EXECUTING" },
      { eventType: "TaskVerifying", from: "EXECUTING", to: "VERIFYING" },
      { eventType: "TaskClosed", from: "VERIFYING", to: "CLOSED" },
      { eventType: "ArchivePending", from: "CLOSED", to: "ARCHIVE_PENDING" },
      { eventType: "ArchiveArchived", from: "ARCHIVE_PENDING", to: "ARCHIVED" },
    ]);
    expect(machine.executions).toEqual([expect.objectContaining({
      kind: "BOOTSTRAP_EVIDENCE",
      state: "ACCEPTED",
      producer: "codex-test",
      evidenceDigests: [
        "a".repeat(40),
        "task-artifact://TASK-MACHINE-001/verification",
        "task-artifact://TASK-MACHINE-001/docs-impact",
      ],
    })]);
  });

  it("marks a Coding Workflow failure edge only when a Runtime Event proves it", () => {
    const projection: CodingWorkflowProjection = {
      taskId: "TASK-MACHINE-FAIL",
      specRevision: 1,
      envelopeDigest: "task-envelope:failure",
      state: "FAILED",
      currentStep: "VERIFY",
      outcome: "FAILED_TERMINAL",
      archiveStatus: "NOT_READY",
      events: [
        { sequence: 1, type: "STEP_STARTED", step: "CONTEXT", at: at(0) },
        { sequence: 2, type: "STEP_SUCCEEDED", step: "CONTEXT", at: at(1) },
        { sequence: 3, type: "STEP_STARTED", step: "WORKSPACE", at: at(2) },
        { sequence: 4, type: "STEP_SUCCEEDED", step: "WORKSPACE", at: at(3) },
        { sequence: 5, type: "STEP_STARTED", step: "IMPLEMENT", at: at(4) },
        { sequence: 6, type: "STEP_SUCCEEDED", step: "IMPLEMENT", at: at(5) },
        { sequence: 7, type: "STEP_STARTED", step: "VERIFY", at: at(6) },
        { sequence: 8, type: "WORKFLOW_FAILED", step: "VERIFY", at: at(7), detail: "COMMAND_FAILED" },
      ],
      steps: [],
      attempts: [],
      evidenceBindings: [],
    };

    const machine = buildCodingStateMachine(projection);
    expect(machine.current).toMatchObject({ overall: "FAILED", historyCurrent: "FAILED", consistency: "VERIFIED" });
    expect(machine.definition.edges.find(({ from, to }) => from === "VERIFY" && to === "FAILED"))
      .toMatchObject({ kind: "FAILURE", traversed: true });
    expect(machine.definition.edges.find(({ from, to }) => from === "REVIEW" && to === "IMPLEMENT"))
      .toMatchObject({ kind: "REPAIR", traversed: false });
    expect(machine.definition.edges.find(({ from, to }) => from === "FAILED" && to === "ARCHIVING"))
      .toMatchObject({ kind: "ARCHIVE", traversed: false });
  });

  it("rejects a non-contiguous Runtime Event history instead of inventing transitions", () => {
    const projection: CodingWorkflowProjection = {
      taskId: "TASK-MACHINE-GAP",
      specRevision: 1,
      envelopeDigest: "task-envelope:gap",
      state: "RUNNING",
      currentStep: "CONTEXT",
      archiveStatus: "NOT_READY",
      events: [{ sequence: 2, type: "STEP_STARTED", step: "CONTEXT", at: at(0) }],
      steps: [],
      attempts: [],
      evidenceBindings: [],
    };
    expect(() => buildCodingStateMachine(projection)).toThrow(/not contiguous/);
  });
});

function at(offset: number): string {
  return new Date(Date.parse("2026-08-22T00:00:00.000Z") + offset).toISOString();
}
