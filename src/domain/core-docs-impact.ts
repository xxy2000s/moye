import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import type { TaskEnvelope } from "./coding-task.js";
import { parseTaskEnvelope } from "./coding-task.js";
import { MoyeError } from "./errors.js";

export type DocsImpactDispositionOutcome = "updated" | "unchanged" | "not_applicable";

export interface CoreContextRoute {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly envelopeDigest: string;
  readonly graphRevision: number;
  readonly intents: readonly string[];
  readonly changedPaths: readonly string[];
  readonly requiredRead: readonly string[];
  readonly requiredReview: readonly string[];
  readonly addedRequiredRead: readonly string[];
  readonly addedRequiredReview: readonly string[];
  readonly routeDigest: string;
}

export interface DocsImpactDispositionInput {
  readonly documentId: string;
  readonly outcome: DocsImpactDispositionOutcome;
  readonly reason: string;
}

export interface NewMarkdownRegistrationInput {
  readonly path: string;
  readonly documentId: string;
  readonly indexId: string;
  readonly relationType: string;
}

export interface CoreDocsImpactReportInput {
  readonly route: CoreContextRoute;
  readonly reportRef: string;
  readonly dispositions: readonly DocsImpactDispositionInput[];
  readonly newMarkdownPaths: readonly string[];
  readonly registrations: readonly NewMarkdownRegistrationInput[];
  readonly knowledgeCandidateRefs: readonly string[];
}

export interface CoreDocsImpactReport {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly routeDigest: string;
  readonly reportRef: string;
  readonly dispositions: readonly DocsImpactDispositionInput[];
  readonly newMarkdownPaths: readonly string[];
  readonly registrations: readonly NewMarkdownRegistrationInput[];
  readonly knowledgeCandidateRefs: readonly string[];
  readonly reportDigest: string;
}

export interface DocsGraphCommandEvidence {
  readonly command: "route" | "validate" | "validate-impact";
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  readonly outputSummary: string;
}

export interface DocsGraphRouteResult {
  readonly graphRevision: number;
  readonly requiredRead: readonly string[];
  readonly requiredReview: readonly string[];
  readonly evidence: DocsGraphCommandEvidence;
}

export interface DocsGraphAdapter {
  route(intents: readonly string[], changedPaths: readonly string[]): Promise<DocsGraphRouteResult>;
  validateGraph(): Promise<DocsGraphCommandEvidence>;
  validateImpact(reportPath: string): Promise<DocsGraphCommandEvidence>;
}

export interface CoreDocsImpactGateResult {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly routeDigest: string;
  readonly reportDigest: string;
  readonly verdict: "PASSED" | "BLOCKED";
  readonly evidence: readonly DocsGraphCommandEvidence[];
  readonly failure: { readonly command: "validate" | "validate-impact"; readonly summary: string } | null;
  readonly gateDigest: string;
}

const trustedRoutes = new WeakSet<object>();
const trustedReports = new WeakSet<object>();
const trustedGates = new WeakSet<object>();

export class RubyDocsGraphAdapter implements DocsGraphAdapter {
  readonly #repositoryRoot: string;
  readonly #rubyExecutable: string;
  readonly #scriptPath: string;

  constructor(repositoryRoot: string, rubyExecutable = "ruby") {
    this.#repositoryRoot = path.resolve(requiredString(repositoryRoot, "repositoryRoot"));
    this.#rubyExecutable = requiredString(rubyExecutable, "rubyExecutable");
    this.#scriptPath = path.join(this.#repositoryRoot, "scripts", "docs_graph.rb");
  }

  async route(intents: readonly string[], changedPaths: readonly string[]): Promise<DocsGraphRouteResult> {
    const normalizedIntents = refs(intents, "intents", true);
    const normalizedPaths = refs(changedPaths, "changedPaths", true);
    const argv = [
      this.#scriptPath,
      "route",
      ...normalizedIntents.flatMap((intent) => ["--intent", intent]),
      ...normalizedPaths.flatMap((changedPath) => ["--path", changedPath]),
    ];
    const run = await runProcess(this.#rubyExecutable, argv, this.#repositoryRoot, "route");
    if (run.evidence.exitCode !== 0) {
      throw validation("DOCS_ROUTE_FAILED", `Context Route failed: ${run.evidence.outputSummary}`);
    }
    const document = parseYaml(run.stdout) as unknown;
    const contextPlan = record(record(document, "route output")["context_plan"], "context_plan");
    const requiredRead = routeIds(contextPlan["required_read"], "required_read");
    const requiredReview = routeIds(contextPlan["required_review"], "required_review");
    return {
      graphRevision: positiveInteger(contextPlan["graph_revision"], "graph_revision"),
      requiredRead,
      requiredReview,
      evidence: run.evidence,
    };
  }

  async validateGraph(): Promise<DocsGraphCommandEvidence> {
    return (await runProcess(
      this.#rubyExecutable,
      [this.#scriptPath, "validate"],
      this.#repositoryRoot,
      "validate",
    )).evidence;
  }

  async validateImpact(reportPath: string): Promise<DocsGraphCommandEvidence> {
    const resolved = path.resolve(this.#repositoryRoot, requiredString(reportPath, "reportPath"));
    if (resolved !== this.#repositoryRoot && !resolved.startsWith(`${this.#repositoryRoot}${path.sep}`)) {
      throw validation("DOCS_REPORT_PATH_ESCAPE", "Docs Impact report must remain inside repositoryRoot");
    }
    return (await runProcess(
      this.#rubyExecutable,
      [this.#scriptPath, "validate-impact", "--report", resolved],
      this.#repositoryRoot,
      "validate-impact",
    )).evidence;
  }
}

export async function refreshCoreContextRoute(input: {
  readonly envelope: TaskEnvelope;
  readonly changedPaths: readonly string[];
  readonly finalEvidencePaths: readonly string[];
  readonly adapter: DocsGraphAdapter;
}): Promise<CoreContextRoute> {
  const envelope = parseTaskEnvelope(
    JSON.parse(JSON.stringify(input.envelope)) as unknown,
    input.envelope.envelopeDigest,
  );
  const changedPaths = refs([...input.changedPaths, ...input.finalEvidencePaths], "changedPaths", true);
  const result = await input.adapter.route(envelope.contextPlan.intents, changedPaths);
  const requiredRead = refs(result.requiredRead, "requiredRead", true);
  const requiredReview = refs(result.requiredReview, "requiredReview", false);
  assertSubset(envelope.contextPlan.requiredRead, requiredRead, "Required Read");
  assertSubset(envelope.contextPlan.requiredReview, requiredReview, "Required Review");
  if (result.graphRevision < envelope.contextPlan.graphRevision) {
    throw conflict("DOCS_ROUTE_GRAPH_REGRESSION", "Final Context Route cannot use an older graph revision");
  }
  const core = {
    schemaVersion: 1 as const,
    taskId: envelope.taskId,
    specRevision: envelope.specRevision,
    envelopeDigest: envelope.envelopeDigest,
    graphRevision: result.graphRevision,
    intents: refs(envelope.contextPlan.intents, "intents", true),
    changedPaths,
    requiredRead,
    requiredReview,
    addedRequiredRead: requiredRead.filter((item) => !envelope.contextPlan.requiredRead.includes(item)),
    addedRequiredReview: requiredReview.filter((item) => !envelope.contextPlan.requiredReview.includes(item)),
  };
  const route: CoreContextRoute = { ...core, routeDigest: digest("core-context-route", core) };
  trustedRoutes.add(route);
  return deepFreeze(route);
}

export function parseCoreContextRoute(value: unknown, expectedDigest: string): CoreContextRoute {
  const input = record(value, "CoreContextRoute");
  const core = {
    schemaVersion: 1 as const,
    taskId: requiredString(input["taskId"], "taskId"),
    specRevision: positiveInteger(input["specRevision"], "specRevision"),
    envelopeDigest: shaDigest(input["envelopeDigest"], "envelopeDigest"),
    graphRevision: positiveInteger(input["graphRevision"], "graphRevision"),
    intents: refs(input["intents"] as readonly string[], "intents", true),
    changedPaths: refs(input["changedPaths"] as readonly string[], "changedPaths", true),
    requiredRead: refs(input["requiredRead"] as readonly string[], "requiredRead", true),
    requiredReview: refs(input["requiredReview"] as readonly string[], "requiredReview", false),
    addedRequiredRead: refs(input["addedRequiredRead"] as readonly string[], "addedRequiredRead", false),
    addedRequiredReview: refs(input["addedRequiredReview"] as readonly string[], "addedRequiredReview", false),
  };
  const routeDigest = digest("core-context-route", core);
  if (input["schemaVersion"] !== 1 || input["routeDigest"] !== routeDigest || expectedDigest !== routeDigest) {
    throw conflict("CONTEXT_ROUTE_INTEGRITY_FAILED", "Final Context Route does not match its digest");
  }
  const route: CoreContextRoute = { ...core, routeDigest };
  trustedRoutes.add(route);
  return deepFreeze(route);
}

export function createCoreDocsImpactReport(input: CoreDocsImpactReportInput): CoreDocsImpactReport {
  assertTrustedRoute(input.route);
  const dispositions = input.dispositions.map((item) => ({
    documentId: requiredString(item.documentId, "documentId"),
    outcome: dispositionOutcome(item.outcome),
    reason: requiredString(item.reason, "disposition.reason"),
  })).sort((left, right) => left.documentId.localeCompare(right.documentId));
  unique(dispositions.map((item) => item.documentId), "Docs Impact disposition");
  if (canonicalJson(dispositions.map((item) => item.documentId)) !== canonicalJson(input.route.requiredReview)) {
    throw conflict("DOCS_IMPACT_DISPOSITION_MISMATCH", "Docs Impact must dispose every Final Route Required Review exactly once");
  }
  const newMarkdownPaths = refs(input.newMarkdownPaths, "newMarkdownPaths", false);
  for (const item of newMarkdownPaths) {
    if (!item.endsWith(".md") || !input.route.changedPaths.includes(item)) {
      throw conflict("NEW_MARKDOWN_PATH_INVALID", `New Markdown ${item} must be a changed .md path`);
    }
  }
  const registrations = input.registrations.map((item) => ({
    path: requiredString(item.path, "registration.path"),
    documentId: requiredString(item.documentId, "registration.documentId"),
    indexId: requiredString(item.indexId, "registration.indexId"),
    relationType: requiredString(item.relationType, "registration.relationType"),
  })).sort((left, right) => left.path.localeCompare(right.path));
  unique(registrations.map((item) => item.path), "Markdown registration");
  if (canonicalJson(registrations.map((item) => item.path)) !== canonicalJson(newMarkdownPaths)) {
    throw conflict("NEW_MARKDOWN_REGISTRATION_MISSING", "Every new Markdown path requires graph, relation and index registration");
  }
  const core = {
    schemaVersion: 1 as const,
    taskId: input.route.taskId,
    specRevision: input.route.specRevision,
    routeDigest: input.route.routeDigest,
    reportRef: requiredString(input.reportRef, "reportRef"),
    dispositions,
    newMarkdownPaths,
    registrations,
    knowledgeCandidateRefs: refs(input.knowledgeCandidateRefs, "knowledgeCandidateRefs", false),
  };
  const report: CoreDocsImpactReport = { ...core, reportDigest: digest("core-docs-impact-report", core) };
  trustedReports.add(report);
  return deepFreeze(report);
}

export function parseCoreDocsImpactReport(
  value: unknown,
  route: CoreContextRoute,
  expectedDigest: string,
): CoreDocsImpactReport {
  const input = record(value, "CoreDocsImpactReport");
  const report = createCoreDocsImpactReport({
    route,
    reportRef: input["reportRef"] as string,
    dispositions: input["dispositions"] as readonly DocsImpactDispositionInput[],
    newMarkdownPaths: input["newMarkdownPaths"] as readonly string[],
    registrations: input["registrations"] as readonly NewMarkdownRegistrationInput[],
    knowledgeCandidateRefs: input["knowledgeCandidateRefs"] as readonly string[],
  });
  if (input["schemaVersion"] !== 1 || input["taskId"] !== report.taskId ||
      input["specRevision"] !== report.specRevision || input["routeDigest"] !== report.routeDigest ||
      input["reportDigest"] !== report.reportDigest || expectedDigest !== report.reportDigest) {
    throw conflict("DOCS_IMPACT_REPORT_INTEGRITY_FAILED", "Docs Impact Report does not match its Final Route or digest");
  }
  return report;
}

export async function runCoreDocsImpactGate(input: {
  readonly route: CoreContextRoute;
  readonly report: CoreDocsImpactReport;
  readonly reportPath: string;
  readonly adapter: DocsGraphAdapter;
}): Promise<CoreDocsImpactGateResult> {
  assertTrustedRoute(input.route);
  assertTrustedReport(input.report);
  if (input.report.routeDigest !== input.route.routeDigest || input.report.taskId !== input.route.taskId ||
      input.report.specRevision !== input.route.specRevision) {
    throw conflict("DOCS_GATE_REPORT_MISMATCH", "Docs Impact Report does not belong to the Final Context Route");
  }
  const graph = await input.adapter.validateGraph();
  const evidence: DocsGraphCommandEvidence[] = [graph];
  let failure: CoreDocsImpactGateResult["failure"] = graph.exitCode === 0
    ? null
    : { command: "validate", summary: graph.outputSummary };
  if (failure === null) {
    const impact = await input.adapter.validateImpact(input.reportPath);
    evidence.push(impact);
    if (impact.exitCode !== 0) failure = { command: "validate-impact", summary: impact.outputSummary };
  }
  const core = {
    schemaVersion: 1 as const,
    taskId: input.route.taskId,
    specRevision: input.route.specRevision,
    routeDigest: input.route.routeDigest,
    reportDigest: input.report.reportDigest,
    verdict: failure === null ? "PASSED" as const : "BLOCKED" as const,
    evidence,
    failure,
  };
  const gate: CoreDocsImpactGateResult = { ...core, gateDigest: digest("core-docs-impact-gate", core) };
  trustedGates.add(gate);
  return deepFreeze(gate);
}

export function parseCoreDocsImpactGateResult(
  value: unknown,
  route: CoreContextRoute,
  report: CoreDocsImpactReport,
  expectedDigest: string,
): CoreDocsImpactGateResult {
  assertTrustedRoute(route);
  assertTrustedReport(report);
  const input = record(value, "CoreDocsImpactGateResult");
  if (!Array.isArray(input["evidence"])) {
    throw validation("INVALID_DOCS_GATE_EVIDENCE", "Docs Impact Gate evidence must be an array");
  }
  const evidence = input["evidence"].map(parseCommandEvidence);
  const verdictValue = input["verdict"];
  if (verdictValue !== "PASSED" && verdictValue !== "BLOCKED") {
    throw validation("INVALID_DOCS_GATE_VERDICT", "Docs Impact Gate verdict is invalid");
  }
  const verdict = verdictValue as CoreDocsImpactGateResult["verdict"];
  const failureValue = input["failure"];
  const failure = failureValue === null ? null : parseGateFailure(failureValue);
  if ((verdict === "PASSED") !== (failure === null)) {
    throw conflict("DOCS_GATE_VERDICT_CONTRADICTION", "Docs Impact Gate verdict and failure contradict");
  }
  const core = {
    schemaVersion: 1 as const,
    taskId: requiredString(input["taskId"], "taskId"),
    specRevision: positiveInteger(input["specRevision"], "specRevision"),
    routeDigest: shaDigest(input["routeDigest"], "routeDigest"),
    reportDigest: shaDigest(input["reportDigest"], "reportDigest"),
    verdict,
    evidence,
    failure,
  };
  const gateDigest = digest("core-docs-impact-gate", core);
  if (input["schemaVersion"] !== 1 || core.taskId !== route.taskId || core.specRevision !== route.specRevision ||
      core.routeDigest !== route.routeDigest || core.reportDigest !== report.reportDigest ||
      input["gateDigest"] !== gateDigest || expectedDigest !== gateDigest) {
    throw conflict("DOCS_IMPACT_GATE_INTEGRITY_FAILED", "Docs Impact Gate does not match its Route, Report or digest");
  }
  const gate: CoreDocsImpactGateResult = { ...core, gateDigest };
  trustedGates.add(gate);
  return deepFreeze(gate);
}

export function assertTrustedCoreDocsImpactGateResult(gate: CoreDocsImpactGateResult): void {
  if (!trustedGates.has(gate) || !Object.isFrozen(gate)) {
    throw validation("UNTRUSTED_DOCS_IMPACT_GATE", "Docs Impact Gate must come from runCoreDocsImpactGate");
  }
  const { gateDigest, ...core } = gate;
  if (gateDigest !== digest("core-docs-impact-gate", core)) {
    throw conflict("DOCS_IMPACT_GATE_INTEGRITY_FAILED", "Docs Impact Gate digest is stale");
  }
}

function assertTrustedRoute(route: CoreContextRoute): void {
  if (!trustedRoutes.has(route) || !Object.isFrozen(route)) {
    throw validation("UNTRUSTED_CONTEXT_ROUTE", "Final Context Route must come from refreshCoreContextRoute");
  }
}

function assertTrustedReport(report: CoreDocsImpactReport): void {
  if (!trustedReports.has(report) || !Object.isFrozen(report)) {
    throw validation("UNTRUSTED_DOCS_IMPACT_REPORT", "Docs Impact Report must come from its domain protocol");
  }
}

async function runProcess(
  executable: string,
  argv: readonly string[],
  cwd: string,
  command: DocsGraphCommandEvidence["command"],
): Promise<{ readonly stdout: string; readonly evidence: DocsGraphCommandEvidence }> {
  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, [...argv], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({
      exitCode: code ?? 1,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
  const summary = `${result.stdout}\n${result.stderr}`.trim().slice(0, 2_000);
  return {
    stdout: result.stdout,
    evidence: deepFreeze({
      command,
      argv: [executable, ...argv],
      exitCode: result.exitCode,
      stdoutDigest: digest("docs-command-stdout", result.stdout),
      stderrDigest: digest("docs-command-stderr", result.stderr),
      outputSummary: summary,
    }),
  };
}

function routeIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw validation("INVALID_DOCS_ROUTE_OUTPUT", `${field} must be an array`);
  return refs(value.map((item) => requiredString(record(item, field)["id"], `${field}.id`)), field, false);
}

function parseCommandEvidence(value: unknown): DocsGraphCommandEvidence {
  const input = record(value, "DocsGraphCommandEvidence");
  const command = input["command"];
  if (command !== "route" && command !== "validate" && command !== "validate-impact") {
    throw validation("INVALID_DOCS_COMMAND", "Docs Graph command is invalid");
  }
  if (!Array.isArray(input["argv"])) throw validation("INVALID_DOCS_ARGV", "Docs Graph argv must be an array");
  return {
    command,
    argv: input["argv"].map((item) => requiredString(item, "argv")),
    exitCode: nonNegativeInteger(input["exitCode"], "exitCode"),
    stdoutDigest: shaDigest(input["stdoutDigest"], "stdoutDigest"),
    stderrDigest: shaDigest(input["stderrDigest"], "stderrDigest"),
    outputSummary: requiredString(input["outputSummary"], "outputSummary"),
  };
}

function parseGateFailure(value: unknown): NonNullable<CoreDocsImpactGateResult["failure"]> {
  const input = record(value, "Docs Impact failure");
  if (input["command"] !== "validate" && input["command"] !== "validate-impact") {
    throw validation("INVALID_DOCS_GATE_FAILURE", "Docs Impact failure command is invalid");
  }
  return { command: input["command"], summary: requiredString(input["summary"], "failure.summary") };
}

function assertSubset(initial: readonly string[], finalValues: readonly string[], label: string): void {
  const missing = initial.filter((item) => !finalValues.includes(item));
  if (missing.length > 0) throw conflict("DOCS_ROUTE_COVERAGE_REGRESSION", `${label} dropped: ${missing.join(", ")}`);
}

function dispositionOutcome(value: DocsImpactDispositionOutcome): DocsImpactDispositionOutcome {
  const values: readonly DocsImpactDispositionOutcome[] = ["updated", "unchanged", "not_applicable"];
  if (!values.includes(value)) throw validation("INVALID_DOCS_DISPOSITION", `Invalid Docs Impact outcome: ${String(value)}`);
  return value;
}

function refs(values: readonly string[], field: string, required: boolean): string[] {
  if (!Array.isArray(values)) throw validation("INVALID_DOCS_REFS", `${field} must be an array`);
  const normalized = values.map((item) => requiredString(item, field)).sort();
  unique(normalized, field);
  if (required && normalized.length === 0) throw validation("DOCS_REFS_REQUIRED", `${field} cannot be empty`);
  return normalized;
}

function unique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) throw validation("DUPLICATE_DOCS_VALUE", `${field} must be unique`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw validation("INVALID_DOCS_STRING", `${field} must be a non-empty string without NUL bytes`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw validation("INVALID_DOCS_INTEGER", `${field} must be a positive integer`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw validation("INVALID_DOCS_INTEGER", `${field} must be a non-negative integer`);
  }
  return value as number;
}

function shaDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw validation("INVALID_DOCS_DIGEST", `${field} must be a SHA-256 digest`);
  }
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validation("INVALID_DOCS_OBJECT", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${digestHex(namespace, value)}`;
}

function digestHex(namespace: string, value: unknown): string {
  return createHash("sha256").update(namespace).update("\0").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function validation(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "VALIDATION", message });
}

function conflict(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "CONFLICT", message });
}
