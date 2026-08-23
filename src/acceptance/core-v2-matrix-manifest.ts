import path from "node:path";

import { validateCoreV2MatrixAuditInput, type CoreV2ExpectedOutcome, type CoreV2MatrixAuditInput } from "./core-v2-matrix-audit.js";

interface MatrixManifestOptions {
  readonly projectId: string;
  readonly ingressUrl: string;
  readonly boardUrl: string;
  readonly runRoot: string;
  readonly documentGraphPath: string;
  readonly suiteRoots?: Readonly<Partial<Record<"happy" | "faults" | "recovery" | "guards", string>>>;
  readonly suiteSummaryPaths?: Readonly<Partial<Record<"happy" | "faults" | "recovery" | "guards", string>>>;
  readonly scenarioRoots?: Readonly<Partial<Record<string, string>>>;
}

interface ScenarioDefinition {
  readonly scenario: string;
  readonly directory: string;
  readonly expectedOutcome: CoreV2ExpectedOutcome;
  readonly requirementRefs: readonly string[];
}

const suites: readonly { readonly suite: string; readonly directory: string; readonly scenarios: readonly ScenarioDefinition[] }[] = [
  { suite: "happy", directory: "happy", scenarios: [
    { scenario: "HAPPY", directory: "happy", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-01"] },
  ] },
  { suite: "faults", directory: "faults", scenarios: [
    { scenario: "IMPLEMENTATION_SELF_REVIEW", directory: "implementation_self_review", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-02"] },
    { scenario: "FINAL_REVIEW", directory: "final_review", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-03"] },
    { scenario: "DOCUMENTATION", directory: "documentation", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-04"] },
    { scenario: "TEST_FAILURE", directory: "test_failure", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-05"] },
    { scenario: "DESIGN_REPLAN", directory: "design_replan", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-06"] },
  ] },
  { suite: "recovery", directory: "recovery", scenarios: [
    { scenario: "TEST_CONFIRMED", directory: "test_confirmed", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-07"] },
    { scenario: "TEST_NOT_APPLIED", directory: "test_not_applied", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-08"] },
    { scenario: "ROLE_WORKER_RECOVERY", directory: "role_worker_recovery", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-09"] },
    { scenario: "CHECKPOINT_UNKNOWN", directory: "checkpoint_unknown", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-10"] },
    { scenario: "MERGE_UNKNOWN", directory: "merge_unknown", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-11"] },
    { scenario: "ROLE_NOT_APPLIED", directory: "role_not_applied", expectedOutcome: "FAILED_TERMINAL", requirementRefs: ["MATRIX-09", "MATRIX-15"] },
  ] },
  { suite: "guards", directory: "guards", scenarios: [
    { scenario: "REPAIR_BUDGET", directory: "repair_budget", expectedOutcome: "FAILED_TERMINAL", requirementRefs: ["MATRIX-12"] },
    { scenario: "REPLAN_BUDGET", directory: "replan_budget", expectedOutcome: "FAILED_TERMINAL", requirementRefs: ["MATRIX-13"] },
    { scenario: "OBSERVER_TIMEOUT", directory: "observer_timeout", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-14"] },
    { scenario: "STALE_FENCING", directory: "stale_fencing", expectedOutcome: "SUCCEEDED", requirementRefs: ["MATRIX-15"] },
  ] },
];

export function buildCoreV2MatrixAuditInput(options: MatrixManifestOptions): CoreV2MatrixAuditInput {
  const runRoot = path.resolve(options.runRoot);
  return validateCoreV2MatrixAuditInput({
    schemaVersion: 1,
    validationKind: "PRODUCT_ACCEPTANCE_AUDIT",
    projectId: options.projectId,
    ingressUrl: options.ingressUrl,
    boardUrl: options.boardUrl,
    documentGraph: {
      path: options.documentGraphPath,
      expectations: ["0046", "0047"].map((task) => ({
        documentId: `task-${task}-manifest`,
        expectedPath: `docs/delivery/tasks/archive/2026-08-${task === "0046" ? "23" : "24"}-TASK-${task}/task.yaml`,
        expectedStatus: "archived",
        indexedBy: "archived-tasks-index",
      })),
    },
    suites: suites.map((suite) => {
      const rootOverride = options.suiteRoots?.[suite.directory as keyof NonNullable<MatrixManifestOptions["suiteRoots"]>];
      const suiteRoot = path.resolve(rootOverride ?? path.join(runRoot, suite.directory));
      return {
        suite: `core-v2-${suite.suite}`,
        summaryPath: path.resolve(options.suiteSummaryPaths?.[suite.directory as keyof NonNullable<MatrixManifestOptions["suiteSummaryPaths"]>] ?? path.join(suiteRoot, "matrix-summary.json")),
        scenarios: suite.scenarios.map((scenario) => ({
          scenario: scenario.scenario,
          scenarioRoot: path.resolve(options.scenarioRoots?.[scenario.scenario] ?? path.join(suiteRoot, scenario.directory)),
          expectedOutcome: scenario.expectedOutcome,
          requirementRefs: scenario.requirementRefs,
          testCase: `TC-CORE-V2-${scenario.scenario}`,
        })),
      };
    }),
  });
}
