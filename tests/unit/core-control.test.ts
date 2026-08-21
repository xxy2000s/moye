import { describe, expect, it } from "vitest";

import { createTaskEnvelope, type TaskEnvelope } from "../../src/domain/coding-task.js";
import {
  applyControlDecision,
  createControlDecision,
  createInitialCoreProjection,
  parseControlDecision,
  parseCoreProjection,
  proposeDeterministicControlDecision,
  type ControlDecision,
  type CoreBudgetInput,
} from "../../src/domain/core-control.js";

describe("Core Control kernel", () => {
  it("creates one deterministic initial Docs dispatch from persisted facts", () => {
    const envelope = taskEnvelope();
    const initial = createInitialCoreProjection(envelope, budget());
    const first = requireDecision(proposeDeterministicControlDecision(envelope, initial));
    const restarted = requireDecision(proposeDeterministicControlDecision(
      JSON.parse(JSON.stringify(envelope)) as TaskEnvelope,
      parseCoreProjection(JSON.parse(JSON.stringify(initial)), envelope, initial.projectionDigest),
    ));

    expect(first).toEqual(restarted);
    expect(first).toMatchObject({
      taskId: envelope.taskId,
      expectedProjectionVersion: 1,
      expectedState: "RUNNING",
      action: "SCHEDULE_ROLE",
      targetRole: "DOCS",
      budgetRequest: { roleAttempts: 1, modelCalls: 1 },
    });
    expect(first.decisionId).toMatch(/^decision:[0-9a-f]{64}$/);
    expect(first.decisionDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const scheduled = applyControlDecision(initial, first);
    expect(scheduled).toMatchObject({
      projectionVersion: 2,
      state: "RUNNING",
      stage: "DOCS_RUNNING",
      budget: { roleAttemptsRemaining: 3, modelCallsRemaining: 3 },
      pendingRole: { role: "DOCS", generation: 1, decisionId: first.decisionId },
    });
    expect(scheduled.pendingRole?.dispatchId).toMatch(/^dispatch:[0-9a-f]{64}$/);
    expect(scheduled.pendingRole?.inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parseCoreProjection(JSON.parse(JSON.stringify(scheduled)), envelope, scheduled.projectionDigest))
      .toEqual(scheduled);
    expect(scheduled.appliedDecisions).toEqual([{
      decisionId: first.decisionId,
      decisionDigest: first.decisionDigest,
      appliedAtProjectionVersion: 2,
      action: "SCHEDULE_ROLE",
    }]);
    expect(proposeDeterministicControlDecision(envelope, scheduled)).toBeNull();
    expect(Object.isFrozen(scheduled.pendingRole)).toBe(true);
  });

  it("replays an already confirmed Decision without another Role dispatch or budget charge", () => {
    const envelope = taskEnvelope();
    const initial = createInitialCoreProjection(envelope, budget());
    const decision = requireDecision(proposeDeterministicControlDecision(envelope, initial));
    const scheduled = applyControlDecision(initial, decision);
    const replayed = applyControlDecision(scheduled, parseControlDecision(
      JSON.parse(JSON.stringify(decision)),
      decision.decisionDigest,
    ));

    expect(replayed).toBe(scheduled);
    expect(replayed.projectionVersion).toBe(2);
    expect(replayed.appliedDecisions).toHaveLength(1);
    expect(replayed.budget).toEqual(scheduled.budget);
    expect(replayed.pendingRole?.dispatchId).toBe(scheduled.pendingRole?.dispatchId);
  });

  it("rejects stale Projection version and stale state before advancing", () => {
    const envelope = taskEnvelope();
    const initial = createInitialCoreProjection(envelope, budget());
    expect(() => applyControlDecision(initial, decisionFor(initial, { expectedProjectionVersion: 2 })))
      .toThrow(/Expected Projection version 2, current version is 1/);
    expect(() => applyControlDecision(initial, decisionFor(initial, { expectedState: "WAITING_HUMAN" })))
      .toThrow(/Expected WAITING_HUMAN, current state is RUNNING/);
    expect(initial).toMatchObject({ projectionVersion: 1, stage: "DOCS_REQUIRED", pendingRole: null });
  });

  it("rejects Task and Spec mismatches", () => {
    const envelope = taskEnvelope();
    const initial = createInitialCoreProjection(envelope, budget());
    expect(() => applyControlDecision(initial, decisionFor(initial, { taskId: "TASK-OTHER" })))
      .toThrow(/Task or Spec Revision does not match/);
    expect(() => applyControlDecision(initial, decisionFor(initial, { specRevision: 2 })))
      .toThrow(/Task or Spec Revision does not match/);
  });

  it("does not allow an Orchestrator to skip the initial Docs Gate", () => {
    const envelope = taskEnvelope();
    const initial = createInitialCoreProjection(envelope, budget());
    const skipDocs = createControlDecision({
      ...baseDecision(initial),
      action: "SCHEDULE_ROLE",
      targetRole: "IMPLEMENTATION",
    });
    expect(() => applyControlDecision(initial, skipDocs)).toThrow(/Required Gates cannot be skipped/);

    const prematureClose = createControlDecision({
      ...baseDecision(initial),
      action: "CLOSE",
      budgetRequest: {},
    });
    expect(() => applyControlDecision(initial, prematureClose)).toThrow(/requires a Required Gate with exhausted budget/);
  });

  it("enforces the single pending Role invariant", () => {
    const envelope = taskEnvelope();
    const initial = createInitialCoreProjection(envelope, budget());
    const scheduled = applyControlDecision(initial, requireDecision(proposeDeterministicControlDecision(envelope, initial)));
    const second = createControlDecision({
      ...baseDecision(scheduled),
      action: "SCHEDULE_ROLE",
      targetRole: "DOCS",
    });
    expect(() => applyControlDecision(scheduled, second)).toThrow(/already pending/);
  });

  it("checks central budget before dispatch and rejects disguised nested retry requests", () => {
    const envelope = taskEnvelope();
    const exhausted = createInitialCoreProjection(envelope, { ...budget(), roleAttempts: 0 });
    const terminal = requireDecision(proposeDeterministicControlDecision(envelope, exhausted));
    expect(terminal.action).toBe("CLOSE");
    expect(applyControlDecision(exhausted, terminal)).toMatchObject({
      state: "CLOSING",
      stage: "CLOSURE_REQUIRED",
      terminalCandidate: { outcome: "FAILED_TERMINAL", reason: "BUDGET_EXHAUSTED" },
    });

    const initial = createInitialCoreProjection(envelope, budget());
    const multiplied = createControlDecision({
      ...baseDecision(initial),
      action: "SCHEDULE_ROLE",
      targetRole: "DOCS",
      budgetRequest: { roleAttempts: 1, modelCalls: 1, operationRetries: 1 },
    });
    expect(() => applyControlDecision(initial, multiplied)).toThrow(/budget shape/);
  });

  it("normalizes unordered references and rejects conflicting serialized content", () => {
    const envelope = taskEnvelope();
    const initial = createInitialCoreProjection(envelope, budget());
    const a = createControlDecision({
      ...baseDecision(initial),
      action: "SCHEDULE_ROLE",
      targetRole: "DOCS",
      evidenceRefs: ["artifact://z", "artifact://a"],
    });
    const b = createControlDecision({
      ...baseDecision(initial),
      action: "SCHEDULE_ROLE",
      targetRole: "DOCS",
      evidenceRefs: ["artifact://a", "artifact://z"],
    });
    expect(a).toEqual(b);
    expect(a.evidenceRefs).toEqual(["artifact://a", "artifact://z"]);

    const tamperedDecision = { ...JSON.parse(JSON.stringify(a)), reason: "tampered" };
    expect(() => parseControlDecision(tamperedDecision, a.decisionDigest)).toThrow(/does not match its digest/);
    const scheduled = applyControlDecision(initial, a);
    const tamperedProjection = { ...JSON.parse(JSON.stringify(scheduled)), stage: "CLOSED" };
    expect(() => parseCoreProjection(tamperedProjection, envelope, scheduled.projectionDigest))
      .toThrow(/does not match its digest/);
  });

  it("rejects untrusted objects even when copied from a valid Decision or Projection", () => {
    const envelope = taskEnvelope();
    const initial = createInitialCoreProjection(envelope, budget());
    const decision = requireDecision(proposeDeterministicControlDecision(envelope, initial));
    expect(() => applyControlDecision({ ...initial }, decision)).toThrow(/must come from the Core Control protocol/);
    expect(() => applyControlDecision(initial, { ...decision })).toThrow(/must come from createControlDecision/);
  });
});

function taskEnvelope(): TaskEnvelope {
  return createTaskEnvelope({
    taskId: "TASK-CORE-CONTROL",
    specRevision: 1,
    baseSha: "a".repeat(40),
    requirements: [{
      requirementId: "REQ-CORE-01",
      title: "Workflow validates Orchestrator decisions",
      acceptanceCriteria: ["stale decisions do not advance state"],
    }],
    validationCommands: [{ commandId: "CMD-CORE", argv: ["npm", "test"] }],
    contextPlan: {
      graphRevision: 33,
      intents: ["task-runtime-change"],
      requiredRead: ["agent-contract", "task-runtime-kernel"],
      requiredReview: ["architecture-overview"],
    },
  });
}

function budget(): CoreBudgetInput {
  return {
    operationRetries: 3,
    roleAttempts: 4,
    repairs: 2,
    replans: 1,
    modelCalls: 4,
    totalTimeMs: 60_000,
  };
}

function baseDecision(projection: ReturnType<typeof createInitialCoreProjection>) {
  return {
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    expectedProjectionVersion: projection.projectionVersion,
    expectedState: projection.state,
    reason: "test decision",
    budgetRequest: { roleAttempts: 1, modelCalls: 1 },
  } as const;
}

function decisionFor(
  projection: ReturnType<typeof createInitialCoreProjection>,
  overrides: Partial<Parameters<typeof createControlDecision>[0]>,
): ControlDecision {
  return createControlDecision({
    ...baseDecision(projection),
    action: "SCHEDULE_ROLE",
    targetRole: "DOCS",
    ...overrides,
  });
}

function requireDecision(decision: ControlDecision | null): ControlDecision {
  if (decision === null) throw new Error("expected deterministic ControlDecision");
  return decision;
}
