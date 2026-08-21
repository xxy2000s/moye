import type { TaskEnvelope } from "../domain/coding-task.js";
import { createTaskEnvelope, parseTaskEnvelope } from "../domain/coding-task.js";
import {
  closeCoreProjection,
  createCoreClosureResult,
  parseCoreClosureResult,
  type ClosedCoreProjection,
} from "../domain/core-closure.js";
import {
  applyControlDecision,
  applyCoreDocsImpactGate,
  applyCoreVerificationResult,
  applyReviewGateResult,
  completeRoleDispatch,
  createControlDecision,
  createCoreVerificationResult,
  createInitialCoreProjection,
  proposeDeterministicControlDecision,
  reconcileUnknownEffect,
  requestCoreCancellation,
  type ControlDecision,
  type CoreBudgetInput,
  type CoreProjection,
} from "../domain/core-control.js";
import { parseCoreProjection } from "../domain/core-control.js";
import {
  createCoreDocsImpactReport,
  refreshCoreContextRoute,
  runCoreDocsImpactGate,
  type DocsGraphAdapter,
  type DocsGraphCommandEvidence,
} from "../domain/core-docs-impact.js";
import { createCoreObserverReport } from "../domain/core-observer.js";
import {
  createImplementationSelfReview,
  createReviewFinding,
  createReviewInput,
  createReviewResult,
  evaluateReviewGate,
  type ReviewFindingCategory,
  type ReviewRecommendedAction,
} from "../domain/review-finding.js";

export type CoreScenario = "SUCCESS" | "REPAIR" | "REPLAN" | "UNKNOWN" | "BUDGET_EXHAUSTED" | "CANCELLED";

export interface CoreScenarioInput {
  readonly envelope: TaskEnvelope;
  readonly scenario: CoreScenario;
  readonly invocationRef: string;
  readonly observerFailure?: boolean;
  readonly docsGateFailureOnce?: boolean;
}

export interface CoreScenarioResult {
  readonly scenario: CoreScenario;
  readonly finalEnvelope: TaskEnvelope;
  readonly sourceProjection: CoreProjection;
  readonly closed: ClosedCoreProjection;
  readonly observerReportDigest: string | null;
  readonly observerError: string | null;
  readonly roleExecutionCount: number;
  readonly docsGateAttempts: number;
}

export async function executeCoreScenario(input: CoreScenarioInput): Promise<CoreScenarioResult> {
  const scenario = parseCoreScenario(input.scenario);
  let envelope = parseTaskEnvelope(
    JSON.parse(JSON.stringify(input.envelope)) as unknown,
    input.envelope.envelopeDigest,
  );
  const budget = scenarioBudget(scenario);
  let projection = createInitialCoreProjection(envelope, budget);
  let roleExecutionCount = 0;
  let docsGateAttempts = 0;

  if (scenario === "BUDGET_EXHAUSTED") {
    projection = applyControlDecision(projection, requiredDecision(proposeDeterministicControlDecision(envelope, projection)));
  } else if (scenario === "CANCELLED") {
    projection = schedule(envelope, projection);
    const pending = projection.pendingRole!;
    projection = requestCoreCancellation(projection, {
      reason: "operator cancelled the bounded Core scenario",
      cancelledAttemptId: attemptId(projection, pending.role, pending.generation),
      artifactRefs: ["core-artifact://cancelled/partial-patch"],
      evidenceRefs: ["cancellation-command://operator-request"],
    });
  } else {
    projection = schedule(envelope, projection);
    if (scenario === "UNKNOWN") {
      projection = applyControlDecision(projection, createControlDecision({
        ...decisionBase(projection),
        action: "WAIT",
        operationId: "role-run:docs",
        evidenceRefs: ["execution-intent://docs"],
        reason: "Docs result is unknown",
        budgetRequest: {},
      }));
      const waitDigest = projection.pendingReconcile!.waitDigest;
      projection = reconcileUnknownEffect(projection, {
        expectedWaitDigest: waitDigest,
        outcome: "CONFIRMED",
        evidenceRefs: ["role-manifest://docs-confirmed"],
      });
    }
    projection = complete(projection, digest("1"));
    roleExecutionCount += 1;
    projection = schedule(envelope, projection);
    projection = complete(projection, digest("2"));
    roleExecutionCount += 1;
    projection = schedule(envelope, projection);
    const blocked = scenario === "REPAIR" || scenario === "REPLAN";
    const firstReview = reviewBundle(
      envelope,
      1,
      1,
      digest("3"),
      scenario === "REPLAN" ? "DESIGN" : "IMPLEMENTATION",
      scenario === "REPLAN" ? "REPLAN" : "REPAIR",
      blocked,
    );
    projection = complete(projection, firstReview.roleRunResultDigest);
    roleExecutionCount += 1;
    projection = applyReviewGateResult(
      projection,
      evaluateReviewGate(firstReview.input, firstReview.result, firstReview.findings),
    );

    if (scenario === "REPAIR") {
      projection = applyControlDecision(projection, requiredDecision(proposeDeterministicControlDecision(envelope, projection)));
      projection = complete(projection, digest("4"));
      roleExecutionCount += 1;
      projection = schedule(envelope, projection);
      const review = reviewBundle(envelope, 2, 2, digest("5"), "IMPLEMENTATION", "ACCEPT", false);
      projection = complete(projection, review.roleRunResultDigest);
      roleExecutionCount += 1;
      projection = applyReviewGateResult(projection, evaluateReviewGate(review.input, review.result, []));
    } else if (scenario === "REPLAN") {
      const nextEnvelope = replanEnvelope(envelope);
      const gate = projection.reviewGate!;
      projection = applyControlDecision(projection, createControlDecision({
        ...decisionBase(projection),
        action: "REPLAN",
        targetRole: "DOCS",
        sourceFindingRefs: gate.unresolvedBlockingFindingRefs,
        evidenceRefs: [`task-envelope://${nextEnvelope.envelopeDigest}`],
        reason: "Design Finding requires Spec Revision N+1",
        budgetRequest: { replans: 1, roleAttempts: 1, modelCalls: 1 },
      }), nextEnvelope);
      envelope = nextEnvelope;
      projection = complete(projection, digest("6"));
      roleExecutionCount += 1;
      projection = schedule(envelope, projection);
      projection = complete(projection, digest("7"));
      roleExecutionCount += 1;
      projection = schedule(envelope, projection);
      const review = reviewBundle(envelope, 2, 2, digest("8"), "IMPLEMENTATION", "ACCEPT", false);
      projection = complete(projection, review.roleRunResultDigest);
      roleExecutionCount += 1;
      projection = applyReviewGateResult(projection, evaluateReviewGate(review.input, review.result, []));
    }

    projection = applyCoreVerificationResult(projection, createCoreVerificationResult({
      taskId: projection.taskId,
      specRevision: projection.specRevision,
      candidateCommit: projection.reviewGate!.candidateCommit,
      evidenceRefs: ["verification://core-scenario"],
    }));
    const route = await refreshCoreContextRoute({
      envelope,
      changedPaths: ["src/core/workflow.ts"],
      finalEvidencePaths: ["core-artifact://scenario-result"],
      adapter: scenarioDocsAdapter(),
    });
    const report = createCoreDocsImpactReport({
      route,
      reportRef: `core-artifact://${projection.taskId}/docs-impact`,
      dispositions: route.requiredReview.map((documentId) => ({
        documentId,
        outcome: "unchanged" as const,
        reason: "deterministic Core scenario does not change repository documents",
      })),
      newMarkdownPaths: [],
      registrations: [],
      knowledgeCandidateRefs: [],
    });
    if (input.docsGateFailureOnce === true) {
      const blockedGate = await runCoreDocsImpactGate({
        route,
        report,
        reportPath: "core-artifact://docs-impact",
        adapter: scenarioDocsAdapter(true),
      });
      projection = applyCoreDocsImpactGate(projection, blockedGate);
      docsGateAttempts += 1;
    }
    const passedGate = await runCoreDocsImpactGate({
      route,
      report,
      reportPath: "core-artifact://docs-impact",
      adapter: scenarioDocsAdapter(),
    });
    projection = applyCoreDocsImpactGate(projection, passedGate);
    docsGateAttempts += 1;
  }

  let observerReportDigest: string | null = null;
  let observerError: string | null = null;
  try {
    if (input.observerFailure === true) throw new Error("injected observer failure");
    const observer = createCoreObserverReport({
      envelope,
      projection,
      attempts: observerAttempts(projection),
      findingRefs: allFindingRefs(projection),
      verificationRefs: projection.verification === null
        ? []
        : [`core-verification://${projection.verification.verificationDigest}`],
      invocationRefs: [input.invocationRef],
      initialBudget: budget,
      observedAt: "2026-08-22T01:00:00.000Z",
      lastProgressAt: "2026-08-22T01:00:00.000Z",
      staleAfterMs: 60_000,
      budgetWarningRatio: 0.1,
    });
    observerReportDigest = observer.reportDigest;
  } catch (error) {
    observerError = error instanceof Error ? error.message : String(error);
  }

  const closure = createCoreClosureResult({
    envelope,
    projection,
    trace: traceIndex(projection, input.invocationRef, observerReportDigest),
  });
  return {
    scenario,
    finalEnvelope: envelope,
    sourceProjection: projection,
    closed: closeCoreProjection(closure),
    observerReportDigest,
    observerError,
    roleExecutionCount,
    docsGateAttempts,
  };
}

export function parseCoreScenarioResult(
  value: unknown,
  initialEnvelope: TaskEnvelope,
  expectedScenario: CoreScenario,
): CoreScenarioResult {
  expectedScenario = parseCoreScenario(expectedScenario);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Core Scenario Result must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input["scenario"] !== expectedScenario) throw new Error("Core Scenario Result scenario mismatch");
  const envelopeValue = input["finalEnvelope"] as TaskEnvelope;
  const finalEnvelope = parseTaskEnvelope(envelopeValue, envelopeValue.envelopeDigest);
  if (finalEnvelope.taskId !== initialEnvelope.taskId ||
      finalEnvelope.specRevision !== initialEnvelope.specRevision + (expectedScenario === "REPLAN" ? 1 : 0)) {
    throw new Error("Core Scenario Result final Envelope mismatch");
  }
  const projectionValue = input["sourceProjection"] as CoreProjection;
  const sourceProjection = parseCoreProjection(projectionValue, finalEnvelope, projectionValue.projectionDigest);
  const closedValue = input["closed"] as ClosedCoreProjection;
  const closure = parseCoreClosureResult(
    closedValue.closureResult,
    finalEnvelope,
    sourceProjection,
    closedValue.closureResult.closureDigest,
  );
  const closed = closeCoreProjection(closure);
  if (JSON.stringify(closed) !== JSON.stringify(closedValue)) throw new Error("Closed Core Projection integrity failed");
  const observerReportDigest = input["observerReportDigest"];
  if (observerReportDigest !== null &&
      (typeof observerReportDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(observerReportDigest))) {
    throw new Error("Core Scenario Observer digest is invalid");
  }
  const observerError = input["observerError"];
  if (observerError !== null && typeof observerError !== "string") throw new Error("Core Scenario Observer error is invalid");
  const roleExecutionCount = input["roleExecutionCount"];
  const docsGateAttempts = input["docsGateAttempts"];
  if (!Number.isSafeInteger(roleExecutionCount) || (roleExecutionCount as number) < 0 ||
      !Number.isSafeInteger(docsGateAttempts) || (docsGateAttempts as number) < 0) {
    throw new Error("Core Scenario counters are invalid");
  }
  return {
    scenario: expectedScenario,
    finalEnvelope,
    sourceProjection,
    closed,
    observerReportDigest: observerReportDigest as string | null,
    observerError: observerError as string | null,
    roleExecutionCount: roleExecutionCount as number,
    docsGateAttempts: docsGateAttempts as number,
  };
}

export function parseCoreScenario(value: unknown): CoreScenario {
  const scenarios: readonly CoreScenario[] = [
    "SUCCESS", "REPAIR", "REPLAN", "UNKNOWN", "BUDGET_EXHAUSTED", "CANCELLED",
  ];
  if (!scenarios.includes(value as CoreScenario)) throw new Error(`Invalid Core scenario: ${String(value)}`);
  return value as CoreScenario;
}

function schedule(envelope: TaskEnvelope, projection: CoreProjection): CoreProjection {
  return applyControlDecision(projection, requiredDecision(proposeDeterministicControlDecision(envelope, projection)));
}

function complete(projection: CoreProjection, resultDigest: string): CoreProjection {
  const pending = projection.pendingRole!;
  return completeRoleDispatch(projection, {
    dispatchId: pending.dispatchId,
    role: pending.role,
    attemptId: attemptId(projection, pending.role, pending.generation),
    attemptGeneration: pending.generation,
    inputDigest: pending.inputDigest,
    resultDigest,
    outcome: "SUCCEEDED",
  });
}

function reviewBundle(
  envelope: TaskEnvelope,
  implementationGeneration: number,
  reviewGeneration: number,
  roleRunResultDigest: string,
  category: ReviewFindingCategory,
  recommendedAction: ReviewRecommendedAction,
  blocked: boolean,
) {
  const candidateCommit = (implementationGeneration === 1 ? "b" : "c").repeat(40);
  const selfReview = createImplementationSelfReview({
    taskId: envelope.taskId,
    specRevision: envelope.specRevision,
    implementationAttemptId: attemptIdFor(envelope.taskId, "IMPLEMENTATION", implementationGeneration),
    implementationRunId: digest(implementationGeneration === 1 ? "a" : "b"),
    candidateCommit,
    diffRef: `git-diff://${candidateCommit}`,
    diffDigest: digest(implementationGeneration === 1 ? "d" : "e"),
    checkpointRef: `git-checkpoint://${candidateCommit}`,
    testEvidenceRefs: ["verification://scenario"],
    verdict: "READY_FOR_REVIEW",
    summary: "scenario candidate ready",
    checklist: [{ checkId: "TESTS", conclusion: "PASS", evidenceRefs: ["verification://scenario"], note: "pass" }],
  });
  const reviewInput = createReviewInput({
    selfReview,
    selfReviewRef: "role-artifact://implementation/self-review.md",
    verificationEvidenceRefs: ["verification://scenario"],
  });
  const findings = blocked ? [createReviewFinding({
    reviewInput,
    reviewAttemptId: attemptIdFor(envelope.taskId, "REVIEW", reviewGeneration),
    reviewRunId: digest(reviewGeneration === 1 ? "6" : "7"),
    category,
    severity: "BLOCKING",
    requirementRefs: ["requirement://CORE-SCENARIO"],
    evidenceRefs: ["evidence://review"],
    summary: `${category} blocks scenario candidate`,
    recommendedAction,
  })] : [];
  const result = createReviewResult({
    reviewInput,
    reviewAttemptId: attemptIdFor(envelope.taskId, "REVIEW", reviewGeneration),
    reviewRunId: digest(reviewGeneration === 1 ? "6" : "7"),
    roleRunResultDigest,
    verdict: blocked ? "FINDINGS" : "PASSED",
    findings,
    summary: blocked ? "blocked" : "passed",
  });
  return { input: reviewInput, findings, result, roleRunResultDigest };
}

function scenarioDocsAdapter(failImpact = false): DocsGraphAdapter {
  return {
    route: async (intents) => ({
      graphRevision: 43,
      requiredRead: ["agent-contract", "task-runtime-kernel"],
      requiredReview: ["architecture-overview"],
      evidence: commandEvidence("route", 0, intents),
    }),
    validateGraph: async () => commandEvidence("validate", 0),
    validateImpact: async () => commandEvidence("validate-impact", failImpact ? 1 : 0),
  };
}

function commandEvidence(
  command: DocsGraphCommandEvidence["command"],
  exitCode: number,
  suffix: readonly string[] = [],
): DocsGraphCommandEvidence {
  return {
    command,
    argv: ["ruby", "scripts/docs_graph.rb", command, ...suffix],
    exitCode,
    stdoutDigest: digest(exitCode === 0 ? "a" : "b"),
    stderrDigest: digest(exitCode === 0 ? "c" : "d"),
    outputSummary: exitCode === 0 ? `${command} passed` : `${command} failed`,
  };
}

function observerAttempts(projection: CoreProjection) {
  const facts = new Map<string, { role: "DOCS" | "IMPLEMENTATION" | "REVIEW"; generation: number }>();
  for (const item of projection.completedRoleDispatches) {
    facts.set(item.attemptId, { role: item.role, generation: item.attemptGeneration });
  }
  for (const item of projection.roleAttemptFailures) {
    facts.set(item.attemptId, { role: item.role, generation: item.attemptGeneration });
  }
  return [...facts.entries()].map(([id, fact], index) => ({
    role: fact.role,
    attemptId: id,
    generation: fact.generation,
    sessionId: `session-${index + 1}`,
    ...(fact.role === "IMPLEMENTATION" ? { commit: (fact.generation === 1 ? "b" : "c").repeat(40) } : {}),
    artifactRefs: [`core-artifact://attempt-${index + 1}`],
    startedAt: `2026-08-22T00:${String(index).padStart(2, "0")}:00.000Z`,
    finishedAt: `2026-08-22T00:${String(index).padStart(2, "0")}:01.000Z`,
    modelCalls: 1,
    inputTokens: 100,
    outputTokens: 50,
    costMicros: 1_000,
  }));
}

function traceIndex(projection: CoreProjection, invocationRef: string, observerDigest: string | null) {
  const attemptRefs = [
    ...projection.completedRoleDispatches.map((item) => `role-attempt://${item.attemptId}`),
    ...projection.roleAttemptFailures.map((item) => `role-attempt://${item.attemptId}`),
    ...(projection.cancellationCandidate?.lastAttemptId === null || projection.cancellationCandidate === null
      ? []
      : [`role-attempt://${projection.cancellationCandidate.lastAttemptId}`]),
  ];
  return {
    decisionRefs: projection.appliedDecisions.map((item) => `control-decision://${item.decisionDigest}`),
    attemptRefs,
    sessionRefs: attemptRefs.map((_, index) => `agent-session://session-${index + 1}`),
    artifactRefs: [
      ...observerAttempts(projection).flatMap((item) => item.artifactRefs),
      ...(projection.cancellationCandidate?.artifactRefs ?? []),
      ...(projection.terminalCandidate === null
        ? []
        : [`core-artifact://${projection.taskId}/budget-snapshot/${projection.terminalCandidate.candidateDigest}`]),
    ],
    findingRefs: allFindingRefs(projection),
    verificationRefs: projection.verification === null
      ? []
      : [`core-verification://${projection.verification.verificationDigest}`],
    docsImpactRefs: projection.docsImpactGates
      .filter((item) => item.verdict === "PASSED")
      .map((item) => `docs-impact-gate://${item.gateDigest}`),
    observerRefs: observerDigest === null ? [] : [`core-observer://${observerDigest}`],
    invocationRefs: [invocationRef],
  };
}

function allFindingRefs(projection: CoreProjection): string[] {
  return [...new Set([
    ...projection.reviewGateHistory.flatMap((item) => item.unresolvedBlockingFindingRefs),
    ...(projection.reviewGate?.unresolvedBlockingFindingRefs ?? []),
  ])].sort();
}

function replanEnvelope(envelope: TaskEnvelope): TaskEnvelope {
  return createTaskEnvelope({
    taskId: envelope.taskId,
    specRevision: envelope.specRevision + 1,
    baseSha: envelope.baseSha,
    requirements: envelope.requirements,
    validationCommands: envelope.validationCommands.map((item) => ({ commandId: item.commandId, argv: item.argv })),
    contextPlan: envelope.contextPlan,
  });
}

function scenarioBudget(scenario: CoreScenario): CoreBudgetInput {
  if (scenario === "BUDGET_EXHAUSTED") {
    return { operationRetries: 0, roleAttempts: 0, repairs: 0, replans: 0, modelCalls: 0, totalTimeMs: 0 };
  }
  return { operationRetries: 3, roleAttempts: 10, repairs: 2, replans: 1, modelCalls: 10, totalTimeMs: 60_000 };
}

function decisionBase(projection: CoreProjection) {
  return {
    taskId: projection.taskId,
    specRevision: projection.specRevision,
    expectedProjectionVersion: projection.projectionVersion,
    expectedState: projection.state,
  } as const;
}

function attemptId(projection: CoreProjection, role: "DOCS" | "IMPLEMENTATION" | "REVIEW", generation: number): string {
  return attemptIdFor(projection.taskId, role, generation);
}

function attemptIdFor(taskId: string, role: "DOCS" | "IMPLEMENTATION" | "REVIEW", generation: number): string {
  return `${taskId}/CORE-${role}/attempt-${String(generation).padStart(3, "0")}`;
}

function requiredDecision(value: ControlDecision | null): ControlDecision {
  if (value === null) throw new Error("expected Control Decision");
  return value;
}

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
