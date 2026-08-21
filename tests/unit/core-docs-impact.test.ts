import { describe, expect, it } from "vitest";

import { createTaskEnvelope, type TaskEnvelope } from "../../src/domain/coding-task.js";
import {
  applyControlDecision,
  applyCoreDocsImpactGate,
  applyCoreVerificationResult,
  applyReviewGateResult,
  completeRoleDispatch,
  createCoreVerificationResult,
  createInitialCoreProjection,
  proposeDeterministicControlDecision,
  type ControlDecision,
  type CoreProjection,
} from "../../src/domain/core-control.js";
import {
  RubyDocsGraphAdapter,
  createCoreDocsImpactReport,
  parseCoreContextRoute,
  parseCoreDocsImpactGateResult,
  parseCoreDocsImpactReport,
  refreshCoreContextRoute,
  runCoreDocsImpactGate,
  type DocsGraphAdapter,
  type DocsGraphCommandEvidence,
} from "../../src/domain/core-docs-impact.js";
import {
  createImplementationSelfReview,
  createReviewInput,
  createReviewResult,
  evaluateReviewGate,
} from "../../src/domain/review-finding.js";

describe("Core Docs Impact", () => {
  it("refreshes changed paths, requires exact dispositions and records new Markdown registration", async () => {
    const envelope = taskEnvelope();
    const adapter = fakeAdapter({
      graphRevision: 42,
      requiredRead: ["agent-contract", "codemap", "task-runtime-kernel"],
      requiredReview: ["architecture-overview", "codemap"],
    });
    const route = await refreshCoreContextRoute({
      envelope,
      changedPaths: ["src/domain/core-docs-impact.ts", "docs/new-design.md"],
      finalEvidencePaths: ["docs/delivery/tasks/TASK-DOCS-GATE/verification.md"],
      adapter,
    });
    expect(route).toMatchObject({
      graphRevision: 42,
      addedRequiredRead: ["codemap"],
      addedRequiredReview: ["codemap"],
    });
    expect(route.changedPaths).toEqual([
      "docs/delivery/tasks/TASK-DOCS-GATE/verification.md",
      "docs/new-design.md",
      "src/domain/core-docs-impact.ts",
    ]);

    expect(() => createCoreDocsImpactReport({
      route,
      reportRef: "task-artifact://TASK-DOCS-GATE/docs-impact.yaml",
      dispositions: [{ documentId: "architecture-overview", outcome: "updated", reason: "boundary changed" }],
      newMarkdownPaths: ["docs/new-design.md"],
      registrations: [],
      knowledgeCandidateRefs: [],
    })).toThrow(/dispose every Final Route Required Review/);

    const report = createCoreDocsImpactReport({
      route,
      reportRef: "task-artifact://TASK-DOCS-GATE/docs-impact.yaml",
      dispositions: [
        { documentId: "codemap", outcome: "updated", reason: "new modules are mapped" },
        { documentId: "architecture-overview", outcome: "unchanged", reason: "system boundary remains local" },
      ],
      newMarkdownPaths: ["docs/new-design.md"],
      registrations: [{
        path: "docs/new-design.md",
        documentId: "new-design",
        indexId: "architecture-index",
        relationType: "refines",
      }],
      knowledgeCandidateRefs: ["knowledge-candidate://candidate-1"],
    });
    expect(report.reportDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.registrations).toHaveLength(1);
    const restoredRoute = parseCoreContextRoute(JSON.parse(JSON.stringify(route)), route.routeDigest);
    expect(restoredRoute).toEqual(route);
    expect(parseCoreDocsImpactReport(
      JSON.parse(JSON.stringify(report)),
      restoredRoute,
      report.reportDigest,
    )).toEqual(report);
  });

  it("keeps validator failure recoverable and only a trusted passed Gate advances Core", async () => {
    const envelope = taskEnvelope();
    const routeAdapter = fakeAdapter({
      graphRevision: 41,
      requiredRead: ["agent-contract", "task-runtime-kernel"],
      requiredReview: ["architecture-overview"],
    });
    const route = await refreshCoreContextRoute({
      envelope,
      changedPaths: ["src/domain/core-docs-impact.ts"],
      finalEvidencePaths: ["docs/delivery/tasks/TASK-DOCS-GATE/docs-impact.yaml"],
      adapter: routeAdapter,
    });
    const report = createCoreDocsImpactReport({
      route,
      reportRef: "task-artifact://TASK-DOCS-GATE/docs-impact.yaml",
      dispositions: [{
        documentId: "architecture-overview",
        outcome: "updated",
        reason: "Docs Impact Gate is now a Core stage",
      }],
      newMarkdownPaths: [],
      registrations: [],
      knowledgeCandidateRefs: [],
    });
    let projection = projectionAtVerification(envelope);
    projection = applyCoreVerificationResult(projection, createCoreVerificationResult({
      taskId: envelope.taskId,
      specRevision: envelope.specRevision,
      candidateCommit: "b".repeat(40),
      evidenceRefs: ["verification://npm-check"],
    }));
    expect(projection.stage).toBe("DOCS_IMPACT_REQUIRED");

    const blocked = await runCoreDocsImpactGate({
      route,
      report,
      reportPath: "docs/delivery/tasks/TASK-DOCS-GATE/docs-impact.yaml",
      adapter: fakeAdapter({}, { validateExit: 1 }),
    });
    expect(blocked).toMatchObject({ verdict: "BLOCKED", failure: { command: "validate" } });
    projection = applyCoreDocsImpactGate(projection, blocked);
    expect(projection).toMatchObject({ stage: "DOCS_IMPACT_REQUIRED", docsImpactGates: [{ verdict: "BLOCKED" }] });
    expect(applyCoreDocsImpactGate(projection, blocked)).toBe(projection);

    const passed = await runCoreDocsImpactGate({
      route,
      report,
      reportPath: "docs/delivery/tasks/TASK-DOCS-GATE/docs-impact.yaml",
      adapter: fakeAdapter(),
    });
    const restoredRoute = parseCoreContextRoute(JSON.parse(JSON.stringify(route)), route.routeDigest);
    const restoredReport = parseCoreDocsImpactReport(
      JSON.parse(JSON.stringify(report)), restoredRoute, report.reportDigest,
    );
    const restoredGate = parseCoreDocsImpactGateResult(
      JSON.parse(JSON.stringify(passed)), restoredRoute, restoredReport, passed.gateDigest,
    );
    projection = applyCoreDocsImpactGate(projection, restoredGate);
    expect(projection).toMatchObject({
      state: "RUNNING",
      stage: "CLOSURE_REQUIRED",
      docsImpactGates: [{ verdict: "BLOCKED" }, { verdict: "PASSED" }],
    });
  });

  it("uses the repository Router through argv-only Ruby adapter", async () => {
    const adapter = new RubyDocsGraphAdapter(process.cwd());
    const result = await adapter.route(["task-runtime-change"], ["src/domain/core-docs-impact.ts"]);
    expect(result.graphRevision).toBeGreaterThanOrEqual(41);
    expect(result.requiredRead).toContain("task-runtime-kernel");
    expect(result.evidence).toMatchObject({ command: "route", exitCode: 0 });
    expect(result.evidence.argv).toContain("--path");
  });
});

function projectionAtVerification(envelope: TaskEnvelope): CoreProjection {
  let projection = createInitialCoreProjection(envelope, {
    operationRetries: 2, roleAttempts: 5, repairs: 2, replans: 1, modelCalls: 5, totalTimeMs: 60_000,
  });
  projection = schedule(envelope, projection);
  projection = complete(projection, digest("1"));
  projection = schedule(envelope, projection);
  projection = complete(projection, digest("2"));
  projection = schedule(envelope, projection);
  projection = complete(projection, digest("3"));
  const selfReview = createImplementationSelfReview({
    taskId: envelope.taskId,
    specRevision: 1,
    implementationAttemptId: `${envelope.taskId}/CORE-IMPLEMENTATION/attempt-001`,
    implementationRunId: digest("4"),
    candidateCommit: "b".repeat(40),
    diffRef: `git-diff://${"b".repeat(40)}`,
    diffDigest: digest("5"),
    checkpointRef: `git-checkpoint://${"b".repeat(40)}`,
    testEvidenceRefs: ["verification://unit"],
    verdict: "READY_FOR_REVIEW",
    summary: "ready",
    checklist: [{ checkId: "TESTS", conclusion: "PASS", evidenceRefs: ["verification://unit"], note: "pass" }],
  });
  const input = createReviewInput({
    selfReview,
    selfReviewRef: "role-artifact://implementation/self-review.md",
    verificationEvidenceRefs: ["verification://unit"],
  });
  const result = createReviewResult({
    reviewInput: input,
    reviewAttemptId: `${envelope.taskId}/CORE-REVIEW/attempt-001`,
    reviewRunId: digest("6"),
    roleRunResultDigest: digest("3"),
    verdict: "PASSED",
    findings: [],
    summary: "passed",
  });
  return applyReviewGateResult(projection, evaluateReviewGate(input, result, []));
}

function schedule(envelope: TaskEnvelope, projection: CoreProjection): CoreProjection {
  return applyControlDecision(projection, requiredDecision(proposeDeterministicControlDecision(envelope, projection)));
}

function complete(projection: CoreProjection, resultDigest: string): CoreProjection {
  const pending = projection.pendingRole!;
  return completeRoleDispatch(projection, {
    dispatchId: pending.dispatchId,
    role: pending.role,
    attemptId: `${projection.taskId}/CORE-${pending.role}/attempt-${String(pending.generation).padStart(3, "0")}`,
    attemptGeneration: pending.generation,
    inputDigest: pending.inputDigest,
    resultDigest,
    outcome: "SUCCEEDED",
  });
}

function taskEnvelope(): TaskEnvelope {
  return createTaskEnvelope({
    taskId: "TASK-DOCS-GATE",
    specRevision: 1,
    baseSha: "a".repeat(40),
    requirements: [{ requirementId: "REQ-CORE-DOCS", title: "Gate docs", acceptanceCriteria: ["validate"] }],
    validationCommands: [{ commandId: "CMD-DOCS", argv: ["npm", "test"] }],
    contextPlan: {
      graphRevision: 41,
      intents: ["task-runtime-change"],
      requiredRead: ["agent-contract", "task-runtime-kernel"],
      requiredReview: ["architecture-overview"],
    },
  });
}

function fakeAdapter(
  route: Partial<Awaited<ReturnType<DocsGraphAdapter["route"]>>> = {},
  options: { validateExit?: number; impactExit?: number } = {},
): DocsGraphAdapter {
  return {
    route: async () => ({
      graphRevision: route.graphRevision ?? 41,
      requiredRead: route.requiredRead ?? ["agent-contract", "task-runtime-kernel"],
      requiredReview: route.requiredReview ?? ["architecture-overview"],
      evidence: evidence("route", 0),
    }),
    validateGraph: async () => evidence("validate", options.validateExit ?? 0),
    validateImpact: async () => evidence("validate-impact", options.impactExit ?? 0),
  };
}

function evidence(command: DocsGraphCommandEvidence["command"], exitCode: number): DocsGraphCommandEvidence {
  return {
    command,
    argv: ["ruby", "scripts/docs_graph.rb", command],
    exitCode,
    stdoutDigest: digest(exitCode === 0 ? "a" : "b"),
    stderrDigest: digest(exitCode === 0 ? "c" : "d"),
    outputSummary: exitCode === 0 ? `${command} passed` : `${command} failed`,
  };
}

function requiredDecision(value: ControlDecision | null): ControlDecision {
  if (value === null) throw new Error("expected decision");
  return value;
}

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
