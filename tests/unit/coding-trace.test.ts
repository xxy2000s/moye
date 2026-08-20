import { describe, expect, it } from "vitest";

import type { CodingWorkflowProjection } from "../../src/coding/workflow.js";
import { buildCodingTaskTrace } from "../../src/trace/coding-trace.js";

describe("coding task trace", () => {
  it("links business attempts, Agent session, Git commits and technical artifacts", () => {
    const projection = closedProjection();
    const trace = buildCodingTaskTrace(projection, { restateAdminUrl: "http://127.0.0.1:9070" });

    expect(trace.task).toMatchObject({ taskId: "TASK-TRACE-UNIT", state: "CLOSED", archiveStatus: "ARCHIVED" });
    expect(trace.business.steps[0]).toMatchObject({ stepId: "IMPLEMENT", status: "SUCCEEDED" });
    expect(trace.business.attempts[0]?.attemptId).toBe("TASK-TRACE-UNIT/IMPLEMENT/attempt-001");
    expect(trace.agent).toMatchObject({ sessionId: "session-trace", attemptId: "TASK-TRACE-UNIT/IMPLEMENT/attempt-001" });
    expect(trace.git).toMatchObject({ branch: "task/TASK-TRACE-UNIT", resultCommit: sha("b"), mergeCommit: sha("c") });
    expect(trace.verification).toMatchObject({ passed: true, verifiedCommit: sha("b"), evidenceRef: "verification-artifact://trace/result.json" });
    expect(trace.technical.artifacts.map((artifact) => artifact.kind)).toEqual([
      "agent-events", "agent-stderr", "agent-final-message", "verification-evidence", "docs-result", "archive-receipt",
    ]);
    expect(trace.durableRuntime).toMatchObject({
      workflowRef: "restate://CodingTaskWorkflow/TASK-TRACE-UNIT",
      workflowService: "CodingTaskWorkflow",
      workflowKey: "TASK-TRACE-UNIT",
      adminBaseUrl: "http://127.0.0.1:9070",
    });
    const invocationsUrl = new URL(trace.durableRuntime.invocationsUrl!);
    expect(invocationsUrl.pathname).toBe("/ui/invocations");
    expect(JSON.parse(invocationsUrl.searchParams.get("filter_target_service_name")!)).toEqual({
      operation: "IN", value: ["CodingTaskWorkflow"],
    });
    expect(JSON.parse(invocationsUrl.searchParams.get("filter_target_service_key")!)).toEqual({
      operation: "EQUALS", value: "TASK-TRACE-UNIT",
    });
    expect(trace.recovery).toEqual({ classification: "NONE", summary: "业务与归档均已闭环，无需恢复动作。", actions: [] });
    expect(Object.isFrozen(projection.events)).toBe(false);
    expect(Object.isFrozen(projection.attempts[0])).toBe(false);
  });

  it("tells operators to reconcile an unknown Verification result", () => {
    const { merge: _merge, docs: _docs, archive: _archive, ...base } = closedProjection();
    const projection: CodingWorkflowProjection = {
      ...base,
      state: "FAILED",
      currentStep: "VERIFY",
      outcome: "FAILED_TERMINAL",
      archiveStatus: "NOT_READY",
      error: "RESULT_UNKNOWN",
      verification: {
        passed: false,
        code: "RESULT_UNKNOWN",
        commandResults: [],
        evidenceRef: "verification-artifact://trace/unknown.json",
        evidenceContentDigest: digest("7"),
      },
    };

    const trace = buildCodingTaskTrace(projection);
    expect(trace.recovery.classification).toBe("WAIT_OR_RECONCILE");
    expect(trace.recovery.actions.map((action) => action.code)).toEqual(["INSPECT_JOURNAL", "RECONCILE_VERIFICATION"]);
  });

  it("separates archive retry from business execution", () => {
    const { archive: _archive, ...base } = closedProjection();
    const projection: CodingWorkflowProjection = {
      ...base, archiveStatus: "FAILED", error: "archive unavailable",
    };
    expect(buildCodingTaskTrace(projection).recovery).toMatchObject({
      classification: "ARCHIVE_RETRY",
      actions: [{ code: "REATTACH_ARCHIVE" }],
    });
  });

  it("keeps a deterministic Agent failure terminal instead of reviving its Attempt", () => {
    const {
      verification: _verification, merge: _merge, docs: _docs, archive: _archive, ...base
    } = closedProjection();
    const projection: CodingWorkflowProjection = {
      ...base,
      state: "FAILED",
      currentStep: "IMPLEMENT",
      outcome: "FAILED_TERMINAL",
      archiveStatus: "NOT_READY",
      error: "Agent outcome FAILED",
    };
    expect(buildCodingTaskTrace(projection).recovery).toMatchObject({
      classification: "FAILED_TERMINAL",
      actions: [{ code: "CREATE_FOLLOW_UP", automatic: false }],
    });
  });

  it.each([
    ["WORKSPACE", "WORKSPACE_EFFECT_UNKNOWN", "RECONCILE_WORKSPACE"],
    ["IMPLEMENT", "AGENT_RESULT_UNKNOWN", "RECONCILE_AGENT"],
    ["MERGE", "LOCAL_MERGE_UNKNOWN", "RECONCILE_GIT"],
  ] as const)("requires reconciliation for an unknown %s side effect", (currentStep, errorCode, actionCode) => {
    const { verification: _verification, merge: _merge, docs: _docs, archive: _archive, ...base } = closedProjection();
    const projection: CodingWorkflowProjection = {
      ...base,
      state: "FAILED",
      currentStep,
      outcome: "FAILED_TERMINAL",
      archiveStatus: "NOT_READY",
      error: `${errorCode}: result unknown`,
      errorCode,
      errorCategory: "UNKNOWN_SIDE_EFFECT",
    };
    const recovery = buildCodingTaskTrace(projection).recovery;
    expect(recovery.classification).toBe("WAIT_OR_RECONCILE");
    expect(recovery.actions.map((action) => action.code)).toEqual(["INSPECT_JOURNAL", actionCode]);
    expect(recovery.actions.map((action) => action.code)).not.toContain("CREATE_FOLLOW_UP");
  });
});

function closedProjection(): CodingWorkflowProjection {
  const artifact = (name: string) => ({
    artifactRef: `agent-artifact://trace/${name}`,
    contentDigest: digest(name === "events" ? "1" : name === "stderr" ? "2" : "3"),
    bytes: 12,
  });
  return {
    taskId: "TASK-TRACE-UNIT",
    specRevision: 1,
    envelopeDigest: digest("e"),
    state: "CLOSED",
    currentStep: "ARCHIVE",
    outcome: "SUCCEEDED",
    archiveStatus: "ARCHIVED",
    events: [{ sequence: 1, type: "WORKFLOW_CLOSED", step: "CLOSED", at: "2026-08-20T00:00:00.000Z" }],
    steps: [{
      taskId: "TASK-TRACE-UNIT", stepId: "IMPLEMENT", sequence: 3, dependencies: ["WORKSPACE"], specRevision: 1,
      envelopeDigest: digest("e"),
    }],
    attempts: [{
      attemptId: "TASK-TRACE-UNIT/IMPLEMENT/attempt-001",
      taskId: "TASK-TRACE-UNIT",
      stepId: "IMPLEMENT",
      generation: 1,
      specRevision: 1,
      envelopeDigest: digest("e"),
      status: "SUCCEEDED",
      scheduledAt: "2026-08-20T00:00:00.000Z",
      startedAt: "2026-08-20T00:00:00.001Z",
      finishedAt: "2026-08-20T00:00:00.002Z",
      evidenceRecords: [],
      attemptDigest: "attempt:trace",
    }],
    evidenceBindings: [],
    workspace: { effectId: "workspace:trace", path: "/tmp/trace", branch: "task/TASK-TRACE-UNIT" },
    agent: {
      schemaVersion: 1,
      runId: "agent-run:trace",
      runnerKind: "FAKE",
      taskId: "TASK-TRACE-UNIT",
      specRevision: 1,
      stepId: "IMPLEMENT",
      attemptId: "TASK-TRACE-UNIT/IMPLEMENT/attempt-001",
      sessionId: "session-trace",
      outcome: "SUCCEEDED",
      exitCode: 0,
      signal: null,
      startedAt: "2026-08-20T00:00:00.000Z",
      finishedAt: "2026-08-20T00:00:00.001Z",
      durationMs: 1,
      finalMessage: "done",
      artifacts: { events: artifact("events"), stderr: artifact("stderr"), finalMessage: artifact("final") },
      runDigest: "agent-result:trace",
    },
    checkpoint: {
      schemaVersion: 1,
      taskId: "TASK-TRACE-UNIT",
      specRevision: 1,
      workspaceEffectId: "workspace:trace",
      baseSha: sha("a"),
      branchName: "task/TASK-TRACE-UNIT",
      commitSha: sha("b"),
      treeDigest: sha("d"),
      createdAt: "2026-08-20T00:00:00.001Z",
      checkpointDigest: "checkpoint:trace",
    },
    verification: {
      schemaVersion: 1,
      taskId: "TASK-TRACE-UNIT",
      specRevision: 1,
      envelopeDigest: digest("e"),
      workspaceEffectId: "workspace:trace",
      checkpointDigest: "checkpoint:trace",
      verifiedCommit: sha("b"),
      treeDigest: sha("d"),
      passed: true,
      commandResults: [],
      evidenceRef: "verification-artifact://trace/result.json",
      evidenceContentDigest: digest("4"),
      verificationDigest: "verification-binding:trace",
    },
    merge: {
      effectId: "merge:trace", outcome: "APPLIED", code: "MERGE_MATCHED", targetRef: "refs/heads/master",
      mergeCommit: sha("c"), reconciledAfterUnknown: false,
    },
    docs: { artifactRef: "coding-artifact://trace/docs", contentDigest: digest("5"), disposition: "updated" },
    archive: { artifactRef: "coding-artifact://trace/archive", contentDigest: digest("6"), archivePath: "/archive/trace" },
  };
}

function sha(character: string): string { return character.repeat(40); }
function digest(character: string): string { return `sha256:${character.repeat(64)}`; }
