import { createHash } from "node:crypto";

export type CoreV2ExpectedOutcome = "SUCCEEDED" | "FAILED_TERMINAL";

export interface CoreV2AuditScenarioSpec {
  readonly scenario: string;
  readonly scenarioRoot: string;
  readonly expectedOutcome: CoreV2ExpectedOutcome;
  readonly requirementRefs: readonly string[];
  readonly testCase: string;
}

export interface CoreV2AuditSuiteSpec {
  readonly suite: string;
  readonly summaryPath: string;
  readonly scenarios: readonly CoreV2AuditScenarioSpec[];
}

export interface CoreV2MatrixAuditInput {
  readonly schemaVersion: 1;
  readonly validationKind: "PRODUCT_ACCEPTANCE_AUDIT";
  readonly projectId: string;
  readonly ingressUrl: string;
  readonly boardUrl: string;
  readonly documentGraph: {
    readonly path: string;
    readonly expectations: readonly {
      readonly documentId: string;
      readonly expectedPath: string;
      readonly expectedStatus: string;
      readonly indexedBy: string;
    }[];
  };
  readonly suites: readonly CoreV2AuditSuiteSpec[];
}

export interface CoreV2AuditFinding {
  readonly code: string;
  readonly location: string;
  readonly message: string;
}

export interface CoreV2ScenarioAuditResult {
  readonly suite: string;
  readonly scenario: string;
  readonly requirementRefs: readonly string[];
  readonly testCase: string;
  readonly taskId: string | null;
  readonly workflowRef: string | null;
  readonly invocationId: string | null;
  readonly expectedOutcome: CoreV2ExpectedOutcome;
  readonly actualOutcome: string | null;
  readonly archiveStatus: string | null;
  readonly candidateCommit: string | null;
  readonly sessionIds: readonly string[];
  readonly eventsDigests: readonly string[];
  readonly evidenceDigest: string | null;
  readonly pageUrl: string | null;
  readonly findings: readonly CoreV2AuditFinding[];
}

export interface CoreV2MatrixAuditReport {
  readonly schemaVersion: 1;
  readonly validationKind: "PRODUCT_ACCEPTANCE_AUDIT";
  readonly generatedAt: string;
  readonly projectId: string;
  readonly inputDigest: string;
  readonly suiteDigests: Readonly<Record<string, string>>;
  readonly scenarios: readonly CoreV2ScenarioAuditResult[];
  readonly controlPlaneFindings: readonly CoreV2AuditFinding[];
  readonly passed: boolean;
  readonly findingCount: number;
  readonly reportDigest: string;
}

export interface CoreV2ScenarioBundle {
  readonly suiteSummary: unknown;
  readonly evidenceSummary: unknown;
  readonly taskInput: unknown;
  readonly submissionReceipt: unknown;
  readonly projection: unknown;
  readonly trace: unknown;
  readonly liveProjection: unknown;
  readonly authority: unknown;
  readonly liveTrace: unknown;
  readonly artifactChecks: readonly { readonly ref: string; readonly exists: boolean; readonly declaredDigest?: string; readonly embeddedDigest?: string }[];
  readonly gitChecks: {
    readonly candidateExists: boolean;
    readonly mergeExists: boolean;
    readonly targetMatchesMerge: boolean;
    readonly mergeParents: readonly string[];
    readonly candidateCommitsForTask: readonly string[];
  };
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

export function validateCoreV2MatrixAuditInput(value: unknown): CoreV2MatrixAuditInput {
  const input = record(value, "matrix audit input");
  if (input["schemaVersion"] !== 1 || input["validationKind"] !== "PRODUCT_ACCEPTANCE_AUDIT") {
    throw new Error("matrix audit input must declare schemaVersion=1 and validationKind=PRODUCT_ACCEPTANCE_AUDIT");
  }
  const suites = array(input["suites"], "suites").map((rawSuite, suiteIndex) => {
    const suite = record(rawSuite, `suites[${suiteIndex}]`);
    const scenarios = array(suite["scenarios"], `suites[${suiteIndex}].scenarios`).map((rawScenario, scenarioIndex) => {
      const scenario = record(rawScenario, `suites[${suiteIndex}].scenarios[${scenarioIndex}]`);
      const expectedOutcome = text(scenario["expectedOutcome"], "expectedOutcome");
      if (expectedOutcome !== "SUCCEEDED" && expectedOutcome !== "FAILED_TERMINAL") throw new Error(`invalid expectedOutcome ${expectedOutcome}`);
      return {
        scenario: text(scenario["scenario"], "scenario"),
        scenarioRoot: text(scenario["scenarioRoot"], "scenarioRoot"),
        expectedOutcome,
        requirementRefs: array(scenario["requirementRefs"], "requirementRefs").map((item) => text(item, "requirementRef")),
        testCase: text(scenario["testCase"], "testCase"),
      } satisfies CoreV2AuditScenarioSpec;
    });
    return { suite: text(suite["suite"], "suite"), summaryPath: text(suite["summaryPath"], "summaryPath"), scenarios };
  });
  const scenarioNames = suites.flatMap((suite) => suite.scenarios.map((scenario) => scenario.scenario));
  if (new Set(scenarioNames).size !== scenarioNames.length) throw new Error("matrix audit input contains duplicate scenario names");
  if (suites.length === 0 || scenarioNames.length === 0) throw new Error("matrix audit input must explicitly list suites and scenarios");
  const graph = record(input["documentGraph"], "documentGraph");
  const expectations = array(graph["expectations"], "documentGraph.expectations").map((rawExpectation, index) => {
    const expectation = record(rawExpectation, `documentGraph.expectations[${index}]`);
    return {
      documentId: text(expectation["documentId"], "documentId"),
      expectedPath: text(expectation["expectedPath"], "expectedPath"),
      expectedStatus: text(expectation["expectedStatus"], "expectedStatus"),
      indexedBy: text(expectation["indexedBy"], "indexedBy"),
    };
  });
  if (expectations.length === 0) throw new Error("documentGraph.expectations must explicitly list archived documents");
  return {
    schemaVersion: 1,
    validationKind: "PRODUCT_ACCEPTANCE_AUDIT",
    projectId: text(input["projectId"], "projectId"),
    ingressUrl: httpUrl(input["ingressUrl"], "ingressUrl"),
    boardUrl: httpUrl(input["boardUrl"], "boardUrl"),
    documentGraph: { path: text(graph["path"], "documentGraph.path"), expectations },
    suites,
  };
}

export function auditDocumentGraph(input: CoreV2MatrixAuditInput, graphValue: unknown): CoreV2AuditFinding[] {
  const findings: CoreV2AuditFinding[] = [];
  const graph = asRecord(graphValue);
  const documents = Array.isArray(graph?.["documents"]) ? graph["documents"].map(asRecord).filter(Boolean) as Record<string, unknown>[] : [];
  const relations = Array.isArray(graph?.["relations"]) ? graph["relations"].map(asRecord).filter(Boolean) as Record<string, unknown>[] : [];
  for (const expectation of input.documentGraph.expectations) {
    const matches = documents.filter((document) => document["id"] === expectation.documentId);
    if (matches.length !== 1) {
      findings.push({ code: "GRAPH_DOCUMENT_CARDINALITY", location: expectation.documentId, message: `expected one document graph node, found ${matches.length}` });
      continue;
    }
    const document = matches[0]!;
    if (document["path"] !== expectation.expectedPath || document["status"] !== expectation.expectedStatus) {
      findings.push({ code: "GRAPH_DOCUMENT_STATE", location: expectation.documentId, message: `expected ${expectation.expectedStatus} at ${expectation.expectedPath}` });
    }
    const indexed = relations.some((relation) => relation["from"] === expectation.indexedBy && relation["to"] === expectation.documentId && relation["type"] === "indexes");
    if (!indexed) findings.push({ code: "GRAPH_INDEX_RELATION", location: expectation.documentId, message: `missing indexes relation from ${expectation.indexedBy}` });
  }
  return findings;
}

export function auditCoreV2ScenarioBundle(
  suite: CoreV2AuditSuiteSpec,
  spec: CoreV2AuditScenarioSpec,
  bundle: CoreV2ScenarioBundle,
  evidenceDigest: string,
): CoreV2ScenarioAuditResult {
  const findings: CoreV2AuditFinding[] = [];
  const add = (code: string, location: string, message: string) => findings.push({ code, location, message });
  const suiteSummary = asRecord(bundle.suiteSummary);
  if (suiteSummary?.["validationKind"] !== "PRODUCT_ACCEPTANCE") add("NON_PRODUCT_SUITE", suite.summaryPath, "suite summary must declare validationKind=PRODUCT_ACCEPTANCE");
  const summaryScenarios = Array.isArray(suiteSummary?.["scenarios"]) ? suiteSummary["scenarios"] : [];
  const embeddedMatches = summaryScenarios.filter((item) => asRecord(item)?.["scenario"] === spec.scenario);
  if (embeddedMatches.length !== 1) add("SCENARIO_CARDINALITY", suite.summaryPath, `expected exactly one ${spec.scenario} summary, found ${embeddedMatches.length}`);

  const evidence = asRecord(bundle.evidenceSummary);
  const taskInput = asRecord(bundle.taskInput);
  const receipt = asRecord(bundle.submissionReceipt);
  const projection = asRecord(bundle.projection);
  const lifecycle = asRecord(projection?.["lifecycle"]);
  const trace = asRecord(bundle.trace);
  const traceTask = asRecord(trace?.["task"]);
  const traceLifecycle = asRecord(trace?.["lifecycle"]);
  const liveProjection = asRecord(bundle.liveProjection);
  const liveLifecycle = asRecord(liveProjection?.["lifecycle"]);
  const authority = asRecord(bundle.authority);
  const liveTrace = asRecord(bundle.liveTrace);
  const liveTraceTask = asRecord(liveTrace?.["task"]);
  const liveTraceLifecycle = asRecord(liveTrace?.["lifecycle"]);
  const taskId = stringOrNull(evidence?.["taskId"]);
  const workflowRef = stringOrNull(evidence?.["workflowRef"]);
  const invocationId = stringOrNull(evidence?.["invocationId"]);

  same(add, "TASK_BINDING", "taskId", taskId, taskInput?.["taskId"], projection?.["taskId"], liveProjection?.["taskId"], traceTask?.["taskId"], liveTraceTask?.["taskId"]);
  if (taskId === null || !/^TASK-[A-Z0-9][A-Z0-9-]{0,63}$/.test(taskId)) add("INVALID_TASK_ID", "evidence.taskId", "missing or invalid Task ID");
  if (workflowRef !== `restate://CoreV2Workflow/${taskId ?? ""}`) add("WORKFLOW_BINDING", "evidence.workflowRef", "Workflow ref is not the Task-owned CoreV2Workflow");
  if (authority?.["owner"] !== "CORE_V2_WORKFLOW") add("AUTHORITY_OWNER", "TaskAuthority", "TaskAuthority does not identify CORE_V2_WORKFLOW");
  if (invocationId === null || receipt?.["invocationId"] !== invocationId) add("INVOCATION_BINDING", "submission-receipt.json", "Invocation ID is missing or differs from evidence summary");
  const metadata = asRecord(taskInput?.["acceptanceMetadata"]);
  if (metadata?.["kind"] !== "PRODUCT_ACCEPTANCE" || metadata["scenario"] !== spec.scenario) add("ACCEPTANCE_METADATA", "task-input.json", "explicit PRODUCT_ACCEPTANCE metadata is missing or bound to another scenario");

  const expectedTerminal = [projection?.["state"], liveProjection?.["state"], traceTask?.["state"], liveTraceTask?.["state"]];
  if (expectedTerminal.some((value) => value !== "CLOSED")) add("NOT_CLOSED", "Runtime/Trace", "all terminal projections must be CLOSED");
  const actualOutcome = stringOrNull(lifecycle?.["outcome"] ?? projection?.["outcome"]);
  if ([actualOutcome, liveLifecycle?.["outcome"] ?? liveProjection?.["outcome"], traceTask?.["outcome"], liveTraceTask?.["outcome"]].some((value) => value !== spec.expectedOutcome)) {
    add("OUTCOME_MISMATCH", "Runtime/Trace", `expected ${spec.expectedOutcome} in evidence, live Workflow and Board Trace`);
  }
  const archiveStatus = stringOrNull(asRecord(lifecycle?.["archive"])?.["status"]);
  if ([archiveStatus, asRecord(liveLifecycle?.["archive"])?.["status"], traceTask?.["archiveStatus"], liveTraceTask?.["archiveStatus"]].some((value) => value !== "ARCHIVED")) {
    add("NOT_ARCHIVED", "Runtime/Trace", "success and deterministic failure scenarios must all be ARCHIVED");
  }
  same(add, "PROJECTION_DIGEST", "Lifecycle Projection", lifecycle?.["projectionDigest"], evidence?.["projectionDigest"], traceLifecycle?.["projectionDigest"], liveLifecycle?.["projectionDigest"], liveTraceLifecycle?.["projectionDigest"]);

  const roleRuns = Array.isArray(projection?.["roleRuns"]) ? projection["roleRuns"].map(asRecord).filter(Boolean) as Record<string, unknown>[] : [];
  if (roleRuns.length === 0) add("ROLE_RUNS_MISSING", "final-projection.json", "no real Role Runs were recorded");
  uniqueRequired(add, roleRuns, "attemptId", "DUPLICATE_ATTEMPT");
  uniqueRequired(add, roleRuns, "runId", "DUPLICATE_ROLE_RUN");
  uniqueRequired(add, roleRuns, "sessionId", "DUPLICATE_SESSION");
  for (const [index, run] of roleRuns.entries()) {
    if (run["runnerKind"] !== "CODEX_EXEC" && run["runnerKind"] !== "CLAUDE_PRINT") add("NON_REAL_RUNNER", `roleRuns[${index}]`, "Role Runner is not Codex or Claude");
    for (const field of ["eventsDigest", "manifestDigest"]) if (!DIGEST.test(String(run[field] ?? ""))) add("ROLE_DIGEST_MISSING", `roleRuns[${index}].${field}`, "Role evidence digest is missing");
  }
  for (const check of bundle.artifactChecks) {
    if (!check.exists) add("ARTIFACT_MISSING", check.ref, "declared Role/Test Artifact does not exist");
    if (check.declaredDigest !== undefined && check.embeddedDigest !== undefined && check.declaredDigest !== check.embeddedDigest) add("ARTIFACT_DIGEST_MISMATCH", check.ref, "artifact embedded digest differs from Projection");
  }

  const candidateCommit = stringOrNull(lifecycle?.["candidateCommit"]);
  const mergeCommit = stringOrNull(lifecycle?.["mergeCommit"]);
  const trustedTests = Array.isArray(lifecycle?.["trustedTestRuns"]) ? lifecycle["trustedTestRuns"] : [];
  if (spec.expectedOutcome === "SUCCEEDED") {
    if (!COMMIT.test(candidateCommit ?? "") || !bundle.gitChecks.candidateExists) add("CANDIDATE_MISSING", "Git", "successful scenario has no real Candidate Commit");
    if (!COMMIT.test(mergeCommit ?? "") || !bundle.gitChecks.mergeExists || !bundle.gitChecks.targetMatchesMerge || bundle.gitChecks.mergeParents.length !== 3) add("MERGE_MISSING", "Git", "successful scenario has no unique two-parent Merge on target ref");
    const expectedTests = ["FINAL_REVIEW", "TEST_FAILURE"].includes(spec.scenario) ? 2 : 1;
    if (trustedTests.length !== expectedTests) add("TEST_CARDINALITY", "trustedTestRuns", `${spec.scenario} must preserve ${expectedTests} Trusted Test run(s), found ${trustedTests.length}`);
    for (const field of ["verificationGateDigest", "knowledgeDispositionDigest"]) if (!DIGEST.test(String(lifecycle?.[field] ?? ""))) add("GATE_EVIDENCE_MISSING", `lifecycle.${field}`, "successful scenario is missing Gate/Knowledge evidence");
    if (!DIGEST.test(String(asRecord(lifecycle?.["successClosure"])?.["closureDigest"] ?? ""))) add("SUCCESS_CLOSURE_MISSING", "lifecycle.successClosure", "successful scenario is missing Success Closure");
  } else {
    const failure = asRecord(lifecycle?.["failure"]);
    const failureClosure = asRecord(lifecycle?.["failureClosure"]);
    if (failure === null || typeof failure["originalStage"] !== "string" || typeof failure["reason"] !== "string") add("FAILURE_FACT_MISSING", "lifecycle.failure", "failure scenario must preserve original stage and reason");
    if (!Array.isArray(failure?.["attemptIds"]) || !Array.isArray(failure?.["sessionIds"])) add("FAILURE_BINDING_MISSING", "lifecycle.failure", "failure must preserve Attempt and Session IDs");
    if (!DIGEST.test(String(failureClosure?.["closureDigest"] ?? ""))) add("FAILURE_CLOSURE_MISSING", "lifecycle.failureClosure", "failure scenario is missing Failure Closure");
    if (mergeCommit !== null) add("FAILURE_MERGED", "lifecycle.mergeCommit", "deterministic failure scenario must not merge");
  }
  if (!DIGEST.test(String(asRecord(lifecycle?.["archive"])?.["receiptDigest"] ?? ""))) add("ARCHIVE_RECEIPT_MISSING", "lifecycle.archive", "Archive Receipt digest is missing");
  if (new Set(bundle.gitChecks.candidateCommitsForTask).size !== bundle.gitChecks.candidateCommitsForTask.length) add("DUPLICATE_COMMIT", "Git", "duplicate Candidate Commit was found");
  const checkpoints = Array.isArray(lifecycle?.["implementationCheckpoints"]) ? lifecycle["implementationCheckpoints"] : [];
  if (bundle.gitChecks.candidateCommitsForTask.length !== checkpoints.length) add("CHECKPOINT_COMMIT_CARDINALITY", "Git/Lifecycle", "Task Candidate commits must have a one-to-one Checkpoint binding");
  auditScenarioSemantics(add, spec.scenario, evidence, lifecycle, roleRuns, trustedTests);

  return {
    suite: suite.suite,
    scenario: spec.scenario,
    requirementRefs: spec.requirementRefs,
    testCase: spec.testCase,
    taskId,
    workflowRef,
    invocationId,
    expectedOutcome: spec.expectedOutcome,
    actualOutcome,
    archiveStatus,
    candidateCommit,
    sessionIds: roleRuns.map((run) => String(run["sessionId"] ?? "")).filter(Boolean),
    eventsDigests: roleRuns.map((run) => String(run["eventsDigest"] ?? "")).filter((value) => DIGEST.test(value)),
    evidenceDigest: DIGEST.test(evidenceDigest) ? evidenceDigest : null,
    pageUrl: stringOrNull(evidence?.["pageUrl"]),
    findings,
  };
}

function auditScenarioSemantics(
  add: (code: string, location: string, message: string) => void,
  scenario: string,
  evidence: Record<string, unknown> | null,
  lifecycle: Record<string, unknown> | null,
  roleRuns: readonly Record<string, unknown>[],
  trustedTests: readonly unknown[],
): void {
  const phaseCount = (phase: string) => roleRuns.filter((run) => run["phase"] === phase).length;
  const invalidatedGenerations = Array.isArray(lifecycle?.["invalidatedGenerations"]) ? lifecycle["invalidatedGenerations"] : [];
  const invalidatedRevisions = Array.isArray(lifecycle?.["invalidatedRevisions"]) ? lifecycle["invalidatedRevisions"] : [];
  const generation = lifecycle?.["implementationGeneration"];
  const revision = lifecycle?.["specRevision"];
  const requireRepair = (expected: Readonly<Record<string, number>>) => {
    if (generation !== 1 || invalidatedGenerations.length !== 1) add("REPAIR_LEDGER", "lifecycle.invalidatedGenerations", `${scenario} must advance to Generation 1 and invalidate Generation 0`);
    for (const [phase, count] of Object.entries(expected)) if (phaseCount(phase) !== count) add("REPAIR_PHASE_CARDINALITY", `roleRuns.${phase}`, `${scenario} expected ${count} ${phase} run(s), found ${phaseCount(phase)}`);
  };
  if (scenario === "HAPPY") {
    for (const phase of ["ARCHITECT", "DESIGN_REVIEW", "IMPLEMENTATION", "DOCUMENTATION", "TEST_PLAN", "TEST_ASSESSMENT", "FINAL_REVIEW"]) if (phaseCount(phase) !== 1) add("HAPPY_PHASE_CARDINALITY", `roleRuns.${phase}`, "Happy Path requires exactly one run per blocking phase");
    if (generation !== 0 || revision !== 1 || invalidatedGenerations.length !== 0 || invalidatedRevisions.length !== 0) add("HAPPY_REVISION_DRIFT", "lifecycle", "Happy Path must remain R1/G0 without invalidation");
  } else if (scenario === "IMPLEMENTATION_SELF_REVIEW") {
    requireRepair({ IMPLEMENTATION: 2, DOCUMENTATION: 1, TEST_PLAN: 1, TEST_ASSESSMENT: 1, FINAL_REVIEW: 1 });
  } else if (scenario === "FINAL_REVIEW") {
    requireRepair({ IMPLEMENTATION: 2, DOCUMENTATION: 2, TEST_PLAN: 2, TEST_ASSESSMENT: 2, FINAL_REVIEW: 2 });
  } else if (scenario === "DOCUMENTATION") {
    requireRepair({ IMPLEMENTATION: 2, DOCUMENTATION: 2, TEST_PLAN: 1, TEST_ASSESSMENT: 1, FINAL_REVIEW: 1 });
  } else if (scenario === "TEST_FAILURE") {
    requireRepair({ IMPLEMENTATION: 2, DOCUMENTATION: 2, TEST_PLAN: 2, TEST_ASSESSMENT: 2, FINAL_REVIEW: 1 });
  } else if (scenario === "DESIGN_REPLAN") {
    if (revision !== 2 || invalidatedRevisions.length !== 1 || phaseCount("ARCHITECT") !== 2 || phaseCount("DESIGN_REVIEW") !== 2 || generation !== 0) add("REPLAN_LEDGER", "lifecycle.invalidatedRevisions", "Design Replan must preserve invalidated R1 and complete R2/G0");
  } else if (["TEST_CONFIRMED", "TEST_NOT_APPLIED"].includes(scenario)) {
    const waiting = asRecord(evidence?.["waitingReconcile"]);
    if (waiting === null || typeof waiting["token"] !== "string") add("RECONCILE_EVIDENCE", "evidence.waitingReconcile", `${scenario} must preserve WAITING_RECONCILE token evidence`);
    if (!Array.isArray(evidence?.["faultMarkers"]) || (evidence?.["faultMarkers"] as unknown[]).length !== 1 || trustedTests.length !== 1) add("TEST_RECONCILE_CARDINALITY", "evidence", `${scenario} must have one fault marker and one Trusted Test execution`);
  } else if (scenario === "ROLE_WORKER_RECOVERY") {
    if (!Array.isArray(evidence?.["faultMarkers"]) || (evidence?.["faultMarkers"] as unknown[]).length !== 3 || roleRuns.length !== 7) add("ROLE_RECOVERY_CARDINALITY", "evidence", "Role Worker recovery must preserve three kill markers without duplicate Role Runs");
  } else if (scenario === "CHECKPOINT_UNKNOWN") {
    if (!Array.isArray(evidence?.["faultMarkers"]) || (evidence?.["faultMarkers"] as unknown[]).length !== 1 || (Array.isArray(lifecycle?.["implementationCheckpoints"]) ? lifecycle["implementationCheckpoints"].length : 0) !== 1) add("CHECKPOINT_RECONCILE_CARDINALITY", "evidence", "Checkpoint UNKNOWN must have one kill marker and one Candidate Checkpoint");
  } else if (scenario === "MERGE_UNKNOWN") {
    const mergeReceipt = asRecord(lifecycle?.["mergeReceipt"]);
    if (mergeReceipt?.["outcome"] !== "ALREADY_APPLIED" || mergeReceipt["reconciledAfterUnknown"] !== true) add("MERGE_RECONCILE_EVIDENCE", "lifecycle.mergeReceipt", "Merge UNKNOWN must reconcile one already-applied ref update");
  } else if (["REPAIR_BUDGET", "REPLAN_BUDGET"].includes(scenario)) {
    const fence = asRecord(evidence?.["fenceAudit"]);
    const first = asRecord(fence?.["first"]);
    const replay = asRecord(fence?.["replay"]);
    if (fence?.["wrongDigestRejected"] !== true || first?.["accepted"] !== false || JSON.stringify(first) !== JSON.stringify(replay)) add("FENCE_AUDIT", "evidence.fenceAudit", `${scenario} must reject wrong/stale Evidence and replay idempotently`);
    if (trustedTests.length !== 0 || lifecycle?.["mergeCommit"] !== null) add("BUDGET_SIDE_EFFECT", "lifecycle", `${scenario} must not execute Trusted Test or Merge after budget exhaustion`);
    if (scenario === "REPAIR_BUDGET" && (generation !== 1 || phaseCount("IMPLEMENTATION") !== 2)) add("REPAIR_BUDGET_CARDINALITY", "lifecycle", "Repair budget requires exactly G0/G1 Implementation runs");
    if (scenario === "REPLAN_BUDGET" && (revision !== 2 || phaseCount("ARCHITECT") !== 2 || phaseCount("DESIGN_REVIEW") !== 2 || phaseCount("IMPLEMENTATION") !== 0)) add("REPLAN_BUDGET_CARDINALITY", "lifecycle", "Replan budget requires two Architect/Design Review revisions and no Implementation");
  } else if (scenario === "OBSERVER_TIMEOUT") {
    const disposition = asRecord(evidence?.["knowledgeDisposition"]);
    if (phaseCount("OBSERVER_KNOWLEDGE") !== 1 || disposition?.["disposition"] !== "deferred") add("OBSERVER_NON_BLOCKING", "evidence.knowledgeDisposition", "Observer timeout must preserve one failed sidecar and deferred disposition");
  } else {
    add("UNKNOWN_SCENARIO_PROFILE", "scenario", `no deterministic audit profile exists for ${scenario}`);
  }
}

export function createCoreV2MatrixAuditReport(input: CoreV2MatrixAuditInput, suiteDigests: Readonly<Record<string, string>>, scenarios: readonly CoreV2ScenarioAuditResult[], now: string, controlPlaneFindings: readonly CoreV2AuditFinding[] = []): CoreV2MatrixAuditReport {
  const findingCount = controlPlaneFindings.length + scenarios.reduce((count, scenario) => count + scenario.findings.length, 0);
  const core = { schemaVersion: 1 as const, validationKind: "PRODUCT_ACCEPTANCE_AUDIT" as const, generatedAt: now, projectId: input.projectId, inputDigest: digest(input), suiteDigests, scenarios, controlPlaneFindings, passed: findingCount === 0, findingCount };
  return { ...core, reportDigest: digest(core) };
}

export function contentDigest(value: string | Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

function digest(value: unknown): string { return contentDigest(canonicalJson(value)); }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const input = value as Record<string, unknown>;
  return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(",")}}`;
}
function same(add: (code: string, location: string, message: string) => void, code: string, location: string, ...values: unknown[]) {
  if (values.some((value) => value === undefined || value === null) || new Set(values.map((value) => JSON.stringify(value))).size !== 1) add(code, location, "bound values are missing or differ");
}
function uniqueRequired(add: (code: string, location: string, message: string) => void, items: readonly Record<string, unknown>[], field: string, code: string) {
  const values = items.map((item) => item[field]);
  if (values.some((value) => typeof value !== "string" || value.length === 0) || new Set(values).size !== values.length) add(code, `roleRuns.${field}`, `${field} values must be present and unique`);
}
function record(value: unknown, field: string): Record<string, unknown> { const result = asRecord(value); if (result === null) throw new Error(`${field} must be an object`); return result; }
function asRecord(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function array(value: unknown, field: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${field} must be an array`); return value; }
function text(value: unknown, field: string): string { if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string`); return value; }
function httpUrl(value: unknown, field: string): string { const result = text(value, field); const parsed = new URL(result); if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`${field} must be HTTP(S)`); return result.replace(/\/$/, ""); }
function stringOrNull(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
