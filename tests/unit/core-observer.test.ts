import { describe, expect, it } from "vitest";

import { createTaskEnvelope } from "../../src/domain/coding-task.js";
import {
  applyControlDecision,
  createControlDecision,
  createInitialCoreProjection,
  proposeDeterministicControlDecision,
  recordRoleAttemptFailure,
  type ControlDecision,
  type CoreProjection,
} from "../../src/domain/core-control.js";
import { createCoreObserverReport, createKnowledgeCandidate } from "../../src/domain/core-observer.js";

describe("Core Observer", () => {
  it("rebuilds the same read-only trace, usage, recovery, alerts and knowledge candidates", () => {
    const envelope = taskEnvelope();
    const initialBudget = budget();
    let projection = applyControlDecision(
      createInitialCoreProjection(envelope, initialBudget),
      requireDecision(proposeDeterministicControlDecision(envelope, createInitialCoreProjection(envelope, initialBudget))),
    );
    projection = failPending(projection, "1");
    const firstFailure = projection.roleAttemptFailures.at(-1)!;
    projection = applyControlDecision(projection, createControlDecision({
      ...decisionBase(projection),
      action: "RETRY",
      targetRole: "DOCS",
      evidenceRefs: [`role-failure://${firstFailure.failureDigest}`],
      reason: "retry failed docs",
      budgetRequest: { roleAttempts: 1, modelCalls: 1 },
    }));
    projection = failPending(projection, "2");

    const input = {
      envelope,
      projection,
      attempts: [
        attemptFact(1, "session-1", "2026-08-22T00:00:00.000Z", "2026-08-22T00:00:02.000Z"),
        attemptFact(2, "session-2", "2026-08-22T00:00:03.000Z", "2026-08-22T00:00:06.000Z"),
      ],
      findingRefs: ["review-finding://finding-1"],
      verificationRefs: ["verification://gate-1"],
      invocationRefs: ["restate-invocation://inv-1"],
      initialBudget,
      observedAt: "2026-08-22T00:10:00.000Z",
      lastProgressAt: "2026-08-22T00:00:06.000Z",
      staleAfterMs: 60_000,
      budgetWarningRatio: 0.34,
      knowledgeSeeds: [{
        targetKind: "PITFALL" as const,
        sourceRefs: [`core-observer-source://${projection.projectionDigest}`],
        evidenceRefs: projection.roleAttemptFailures.map((item) => `role-failure://${item.failureDigest}`),
        summary: "Docs role repeatedly fails with the same classified error",
      }],
    };
    const report = createCoreObserverReport(input);
    const replayed = createCoreObserverReport(JSON.parse(JSON.stringify(input)) as typeof input);

    expect(replayed).toEqual(report);
    expect(report.trace).toMatchObject({
      workflowRef: `restate-workflow://CoreClosureWorkflow/${envelope.taskId}`,
      attemptIds: [
        `${envelope.taskId}/CORE-DOCS/attempt-001`,
        `${envelope.taskId}/CORE-DOCS/attempt-002`,
      ],
      sessionIds: ["session-1", "session-2"],
      invocationRefs: ["restate-invocation://inv-1"],
    });
    expect(report.usage).toEqual({
      durationMs: 5_000,
      modelCalls: 2,
      inputTokens: 300,
      outputTokens: 120,
      costMicros: 3_000,
    });
    expect(report.recovery).toMatchObject({ roleAttemptRetries: 1, roleFailures: 2 });
    expect(report.alerts.map((item) => item.kind).sort()).toEqual([
      "REPEATED_FAILURE", "STALLED", "BUDGET_NEAR_LIMIT",
    ].sort());
    expect(report.knowledgeCandidates[0]).toMatchObject({ targetKind: "PITFALL", promotionStatus: "PROPOSED" });
    expect(report.reportDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(projection.projectionVersion).toBe(5);
  });

  it("reports UNKNOWN without owning state, and invalid observer input cannot mutate Core", () => {
    const envelope = taskEnvelope();
    const budgetInput = budget();
    let projection = createInitialCoreProjection(envelope, budgetInput);
    projection = applyControlDecision(projection, requireDecision(proposeDeterministicControlDecision(envelope, projection)));
    projection = applyControlDecision(projection, createControlDecision({
      ...decisionBase(projection),
      action: "WAIT",
      operationId: "agent-run:docs",
      evidenceRefs: ["execution-intent://docs"],
      reason: "agent result is unknown",
      budgetRequest: {},
    }));
    const beforeDigest = projection.projectionDigest;
    const report = createCoreObserverReport({
      envelope,
      projection,
      attempts: [],
      findingRefs: [],
      verificationRefs: [],
      invocationRefs: ["restate-invocation://inv-unknown"],
      initialBudget: budgetInput,
      observedAt: "2026-08-22T00:01:00.000Z",
      lastProgressAt: "2026-08-22T00:00:00.000Z",
      staleAfterMs: 1_000,
      budgetWarningRatio: 0.1,
    });
    expect(report.alerts).toEqual([expect.objectContaining({ kind: "UNKNOWN_EFFECT", severity: "CRITICAL" })]);
    expect(projection.projectionDigest).toBe(beforeDigest);

    expect(() => createCoreObserverReport({
      envelope,
      projection,
      attempts: [attemptFact(1, "bad", "not-a-date", undefined)],
      findingRefs: [],
      verificationRefs: [],
      invocationRefs: ["restate-invocation://inv-unknown"],
      initialBudget: budgetInput,
      observedAt: "2026-08-22T00:01:00.000Z",
      lastProgressAt: "2026-08-22T00:00:00.000Z",
      staleAfterMs: 1_000,
      budgetWarningRatio: 0.1,
    })).toThrow(/ISO timestamp/);
    expect(projection.projectionDigest).toBe(beforeDigest);
  });

  it("keeps Knowledge Candidate identity stable and never claims promotion", () => {
    const seed = {
      targetKind: "BACKLOG" as const,
      sourceRefs: ["observer-report://report-1"],
      evidenceRefs: ["role-failure://failure-1"],
      summary: "Repeated review failure needs separately scheduled work",
    };
    const first = createKnowledgeCandidate("TASK-OBSERVER", 1, seed);
    const replay = createKnowledgeCandidate("TASK-OBSERVER", 1, seed);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ promotionStatus: "PROPOSED" });
    expect(Object.keys(first)).not.toContain("promotedDocumentRef");
  });
});

function failPending(projection: CoreProjection, resultCharacter: string): CoreProjection {
  const pending = projection.pendingRole!;
  return recordRoleAttemptFailure(projection, {
    dispatchId: pending.dispatchId,
    role: pending.role,
    attemptId: `${projection.taskId}/CORE-${pending.role}/attempt-${String(pending.generation).padStart(3, "0")}`,
    attemptGeneration: pending.generation,
    inputDigest: pending.inputDigest,
    resultDigest: digest(resultCharacter),
    outcome: "FAILED",
    errorCode: "DOCS_MODEL_UNAVAILABLE",
    errorCategory: "TRANSIENT_IO",
  });
}

function attemptFact(generation: number, sessionId: string, startedAt: string, finishedAt: string | undefined) {
  return {
    role: "DOCS" as const,
    attemptId: `TASK-OBSERVER/CORE-DOCS/attempt-${String(generation).padStart(3, "0")}`,
    generation,
    sessionId,
    artifactRefs: [`role-artifact://docs-${generation}`],
    startedAt,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    modelCalls: 1,
    inputTokens: generation === 1 ? 100 : 200,
    outputTokens: generation === 1 ? 40 : 80,
    costMicros: generation === 1 ? 1_000 : 2_000,
  };
}

function taskEnvelope() {
  return createTaskEnvelope({
    taskId: "TASK-OBSERVER",
    specRevision: 1,
    baseSha: "a".repeat(40),
    requirements: [{ requirementId: "REQ-CORE-OBS", title: "Observe Core", acceptanceCriteria: ["read only"] }],
    validationCommands: [{ commandId: "CMD-OBS", argv: ["npm", "test"] }],
    contextPlan: {
      graphRevision: 41,
      intents: ["task-runtime-change"],
      requiredRead: ["task-runtime-kernel"],
      requiredReview: ["architecture-overview"],
    },
  });
}

function budget() {
  return { operationRetries: 2, roleAttempts: 3, repairs: 2, replans: 1, modelCalls: 3, totalTimeMs: 60_000 };
}

function decisionBase(projection: CoreProjection) {
  return {
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    expectedProjectionVersion: projection.projectionVersion,
    expectedState: projection.state,
  } as const;
}

function requireDecision(value: ControlDecision | null): ControlDecision {
  if (value === null) throw new Error("expected decision");
  return value;
}

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
