import { describe, expect, it } from "vitest";

import { executeCoreScenario } from "../../src/core/workflow.js";
import { createTaskEnvelope } from "../../src/domain/coding-task.js";
import { createCoreClosureResult, parseCoreClosureResult } from "../../src/domain/core-closure.js";
import {
  applyControlDecision,
  createControlDecision,
  createInitialCoreProjection,
  proposeDeterministicControlDecision,
  reconcileUnknownEffect,
  requestCoreCancellation,
  type CoreProjection,
} from "../../src/domain/core-control.js";

describe("Core Closure", () => {
  it.each([
    ["SUCCESS", "SUCCEEDED"],
    ["BUDGET_EXHAUSTED", "FAILED_TERMINAL"],
    ["CANCELLED", "CANCELLED"],
  ] as const)("creates one immutable %s closure", async (scenario, outcome) => {
    const envelope = taskEnvelope(`TASK-${scenario === "BUDGET_EXHAUSTED" ? "BUDGET" : scenario}`);
    const result = await executeCoreScenario({
      envelope,
      scenario,
      invocationRef: `restate-workflow://CoreClosureWorkflow/${envelope.taskId}`,
    });

    expect(result.closed).toMatchObject({ state: "CLOSED", stage: "CLOSED", outcome });
    expect(result.closed.closureResult.closureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(result.closed)).toBe(true);
    expect(Object.isFrozen(result.closed.closureResult.trace)).toBe(true);
    expect(parseCoreClosureResult(
      JSON.parse(JSON.stringify(result.closed.closureResult)),
      result.finalEnvelope,
      result.sourceProjection,
      result.closed.closureResult.closureDigest,
    )).toEqual(result.closed.closureResult);
  });

  it("rejects a Closure whose Trace omits a required Decision", async () => {
    const envelope = taskEnvelope("TASK-TRACE-MISSING");
    const result = await executeCoreScenario({
      envelope,
      scenario: "SUCCESS",
      invocationRef: `restate-workflow://CoreClosureWorkflow/${envelope.taskId}`,
    });
    const { traceDigest: _traceDigest, ...trace } = result.closed.closureResult.trace;

    expect(() => createCoreClosureResult({
      envelope: result.finalEnvelope,
      projection: result.sourceProjection,
      trace: { ...trace, decisionRefs: trace.decisionRefs.slice(1) },
    })).toThrow(/Decision trace refs missing/);
  });

  it("requires Session and retained Artifact coverage in the Trace", async () => {
    const envelope = taskEnvelope("TASK-TRACE-COVERAGE");
    const result = await executeCoreScenario({
      envelope,
      scenario: "SUCCESS",
      invocationRef: `restate-workflow://CoreClosureWorkflow/${envelope.taskId}`,
    });
    const { traceDigest: _traceDigest, ...trace } = result.closed.closureResult.trace;

    expect(() => createCoreClosureResult({
      envelope: result.finalEnvelope,
      projection: result.sourceProjection,
      trace: { ...trace, sessionRefs: [] },
    })).toThrow(/Session trace refs/);
    expect(() => createCoreClosureResult({
      envelope: result.finalEnvelope,
      projection: result.sourceProjection,
      trace: { ...trace, artifactRefs: [] },
    })).toThrow(/retained Artifact evidence/);
  });

  it("rejects conflicting serialized closure facts and cannot reschedule CLOSED", async () => {
    const envelope = taskEnvelope("TASK-CLOSE-CONFLICT");
    const result = await executeCoreScenario({
      envelope,
      scenario: "SUCCESS",
      invocationRef: `restate-workflow://CoreClosureWorkflow/${envelope.taskId}`,
    });
    const tampered = JSON.parse(JSON.stringify(result.closed.closureResult)) as Record<string, unknown>;
    tampered["outcome"] = "CANCELLED";

    expect(() => parseCoreClosureResult(
      tampered,
      result.finalEnvelope,
      result.sourceProjection,
      result.closed.closureResult.closureDigest,
    )).toThrow(/differs from its source|integrity/i);
    expect(() => proposeDeterministicControlDecision(
      result.finalEnvelope,
      result.closed as unknown as CoreProjection,
    )).toThrow(/CoreProjection must come from the Core Control protocol/i);
  });

  it("cannot cancel unresolved UNKNOWN work and detects conflicting cancellation evidence", () => {
    const envelope = taskEnvelope("TASK-CANCEL-GATE");
    let projection = createInitialCoreProjection(envelope, budget());
    const schedule = proposeDeterministicControlDecision(envelope, projection);
    if (schedule === null) throw new Error("expected schedule decision");
    projection = applyControlDecision(projection, schedule);
    projection = applyControlDecision(projection, createControlDecision({
      taskId: projection.taskId,
      specRevision: projection.specRevision,
      expectedProjectionVersion: projection.projectionVersion,
      expectedState: projection.state,
      action: "WAIT",
      operationId: "role-run:docs",
      evidenceRefs: ["execution-intent://docs"],
      reason: "result unknown",
      budgetRequest: {},
    }));
    expect(() => requestCoreCancellation(projection, {
      reason: "operator request",
      cancelledAttemptId: `${envelope.taskId}/CORE-DOCS/attempt-001`,
      artifactRefs: ["core-artifact://partial"],
      evidenceRefs: ["cancellation-command://one"],
    })).toThrow(/Pending Reconcile|Unknown Effect|WAITING_RECONCILE/i);

    projection = reconcileUnknownEffect(projection, {
      expectedWaitDigest: projection.pendingReconcile!.waitDigest,
      outcome: "CONFIRMED",
      evidenceRefs: ["role-manifest://docs-confirmed"],
    });
    const cancelled = requestCoreCancellation(projection, {
      reason: "operator request",
      cancelledAttemptId: `${envelope.taskId}/CORE-DOCS/attempt-001`,
      artifactRefs: ["core-artifact://partial"],
      evidenceRefs: ["cancellation-command://one"],
    });
    expect(requestCoreCancellation(cancelled, {
      reason: "operator request",
      cancelledAttemptId: `${envelope.taskId}/CORE-DOCS/attempt-001`,
      artifactRefs: ["core-artifact://partial"],
      evidenceRefs: ["cancellation-command://one"],
    })).toBe(cancelled);
    expect(() => requestCoreCancellation(cancelled, {
      reason: "different request",
      cancelledAttemptId: `${envelope.taskId}/CORE-DOCS/attempt-001`,
      artifactRefs: ["core-artifact://partial"],
      evidenceRefs: ["cancellation-command://two"],
    })).toThrow(/already requested|conflict|different Cancellation Candidate/i);
  });
});

function taskEnvelope(taskId: string) {
  return createTaskEnvelope({
    taskId,
    specRevision: 1,
    baseSha: "a".repeat(40),
    requirements: [{ requirementId: "REQ-CORE-CLOSE", title: "close Core", acceptanceCriteria: ["unique closure"] }],
    validationCommands: [{ commandId: "CMD-CORE-CLOSE", argv: ["npm", "test"] }],
    contextPlan: {
      graphRevision: 43,
      intents: ["task-runtime-change"],
      requiredRead: ["agent-contract", "task-runtime-kernel"],
      requiredReview: ["architecture-overview"],
    },
  });
}

function budget() {
  return { operationRetries: 2, roleAttempts: 3, repairs: 1, replans: 1, modelCalls: 3, totalTimeMs: 60_000 };
}
