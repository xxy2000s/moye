import { describe, expect, it } from "vitest";

import {
  auditCoreV2ScenarioBundle,
  auditDocumentGraph,
  createCoreV2MatrixAuditReport,
  validateCoreV2MatrixAuditInput,
  type CoreV2AuditScenarioSpec,
  type CoreV2AuditSuiteSpec,
} from "../../src/acceptance/core-v2-matrix-audit.js";

const digest = `sha256:${"a".repeat(64)}`;
const candidate = "1".repeat(40);
const merge = "2".repeat(40);
const taskId = "TASK-AUDIT-HAPPY-001";
const scenario: CoreV2AuditScenarioSpec = {
  scenario: "HAPPY",
  scenarioRoot: "/evidence/happy",
  expectedOutcome: "SUCCEEDED",
  requirementRefs: ["REQ-1"],
  testCase: "TC-HAPPY",
};
const suite: CoreV2AuditSuiteSpec = { suite: "happy", summaryPath: "/evidence/matrix-summary.json", scenarios: [scenario] };
const documentGraph = { path: "docs/graph.yaml", expectations: [{ documentId: "task-0046-manifest", expectedPath: "archive/task.yaml", expectedStatus: "archived", indexedBy: "archived-tasks-index" }] };

describe("Core v2 product matrix audit", () => {
  it("requires explicit suites and rejects discovery-shaped or duplicate input", () => {
    expect(() => validateCoreV2MatrixAuditInput({ schemaVersion: 1, validationKind: "PRODUCT_ACCEPTANCE_AUDIT", projectId: "moye", ingressUrl: "http://localhost:8080", boardUrl: "http://localhost:3000", documentGraph, suites: [] }))
      .toThrow(/explicitly list/);
    expect(() => validateCoreV2MatrixAuditInput({ schemaVersion: 1, validationKind: "PRODUCT_ACCEPTANCE_AUDIT", projectId: "moye", ingressUrl: "http://localhost:8080", boardUrl: "http://localhost:3000", documentGraph, suites: [{ suite: "one", summaryPath: "/one", scenarios: [scenario] }, { suite: "two", summaryPath: "/two", scenarios: [scenario] }] }))
      .toThrow(/duplicate scenario/);
  });

  it("accepts a live-bound successful scenario with unique real evidence", () => {
    const result = auditCoreV2ScenarioBundle(suite, scenario, successBundle(), digest);
    expect(result.findings).toEqual([]);
    const input = validateCoreV2MatrixAuditInput({ schemaVersion: 1, validationKind: "PRODUCT_ACCEPTANCE_AUDIT", projectId: "moye", ingressUrl: "http://localhost:8080", boardUrl: "http://localhost:3000", documentGraph, suites: [suite] });
    const report = createCoreV2MatrixAuditReport(input, { happy: digest }, [result], "2026-08-24T00:00:00.000Z");
    expect(report).toMatchObject({ passed: true, findingCount: 0 });
    expect(report.reportDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("checks archived document graph state and index ownership", () => {
    const input = validateCoreV2MatrixAuditInput({ schemaVersion: 1, validationKind: "PRODUCT_ACCEPTANCE_AUDIT", projectId: "moye", ingressUrl: "http://localhost:8080", boardUrl: "http://localhost:3000", documentGraph, suites: [suite] });
    expect(auditDocumentGraph(input, { documents: [{ id: "task-0046-manifest", path: "archive/task.yaml", status: "archived" }], relations: [{ from: "archived-tasks-index", to: "task-0046-manifest", type: "indexes" }] })).toEqual([]);
    expect(auditDocumentGraph(input, { documents: [{ id: "task-0046-manifest", path: "active/task.yaml", status: "active" }], relations: [] }).map((finding) => finding.code)).toEqual(["GRAPH_DOCUMENT_STATE", "GRAPH_INDEX_RELATION"]);
  });

  it("blocks legacy summaries, duplicate sessions, stale live state and missing artifacts", () => {
    const bundle = successBundle();
    const projection = structuredClone(bundle.projection) as Record<string, any>;
    projection["roleRuns"].push({ ...projection["roleRuns"][0], attemptId: "attempt-2", runId: `sha256:${"b".repeat(64)}` });
    const result = auditCoreV2ScenarioBundle(suite, scenario, {
      ...bundle,
      suiteSummary: { schemaVersion: 1, scenarios: [{ scenario: "HAPPY" }] },
      projection,
      liveProjection: { ...bundle.liveProjection as object, state: "EXECUTING" },
      artifactChecks: [{ ref: "/missing/manifest.json", exists: false }],
    }, digest);
    expect(result.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "NON_PRODUCT_SUITE",
      "DUPLICATE_SESSION",
      "NOT_CLOSED",
      "ARTIFACT_MISSING",
    ]));
  });
});

function successBundle() {
  const phases = ["ARCHITECT", "DESIGN_REVIEW", "IMPLEMENTATION", "DOCUMENTATION", "TEST_PLAN", "TEST_ASSESSMENT", "FINAL_REVIEW"];
  const roles = phases.map((phase, index) => {
    const hex = "abcdef0"[index]!.repeat(64);
    return {
      phase,
      runnerKind: "CODEX_EXEC",
      attemptId: `attempt-${index + 1}`,
      runId: `sha256:${hex}`,
      sessionId: `session-${index + 1}`,
      eventsDigest: `sha256:${hex}`,
      manifestDigest: `sha256:${hex}`,
    };
  });
  const lifecycle = {
    state: "ARCHIVED",
    outcome: "SUCCEEDED",
    projectionDigest: digest,
    specRevision: 1,
    implementationGeneration: 0,
    invalidatedRevisions: [],
    invalidatedGenerations: [],
    candidateCommit: candidate,
    mergeCommit: merge,
    implementationCheckpoints: [{ candidateCommit: candidate }],
    trustedTestRuns: [{ runId: digest, manifestDigest: digest }],
    verificationGateDigest: digest,
    knowledgeDispositionDigest: digest,
    successClosure: { closureDigest: digest },
    failure: null,
    failureClosure: null,
    archive: { status: "ARCHIVED", receiptDigest: digest },
  };
  const projection = { taskId, state: "CLOSED", outcome: "SUCCEEDED", roleRuns: roles, lifecycle };
  const trace = { task: { taskId, state: "CLOSED", outcome: "SUCCEEDED", archiveStatus: "ARCHIVED" }, lifecycle: { projectionDigest: digest } };
  return {
    suiteSummary: { schemaVersion: 1, validationKind: "PRODUCT_ACCEPTANCE", scenarios: [{ scenario: "HAPPY" }] },
    evidenceSummary: { taskId, workflowRef: `restate://CoreV2Workflow/${taskId}`, invocationId: "inv-1", projectionDigest: digest, pageUrl: `http://localhost:3000/tasks/${taskId}` },
    taskInput: { taskId, acceptanceMetadata: { kind: "PRODUCT_ACCEPTANCE", scenario: "HAPPY" } },
    submissionReceipt: { invocationId: "inv-1" },
    projection,
    trace,
    liveProjection: structuredClone(projection),
    authority: { owner: "CORE_V2_WORKFLOW" },
    liveTrace: structuredClone(trace),
    artifactChecks: [{ ref: "/evidence/manifest.json", exists: true, declaredDigest: digest, embeddedDigest: digest }],
    gitChecks: { candidateExists: true, mergeExists: true, targetMatchesMerge: true, mergeParents: [merge, "base", candidate], candidateCommitsForTask: [candidate] },
  };
}
