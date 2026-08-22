import { createHash } from "node:crypto";

import { MoyeError } from "./errors.js";
import { assertTaskId } from "./task.js";

export const LIFECYCLE_ARTIFACT_KINDS = [
  "SPEC",
  "DESIGN",
  "PLAN",
  "DOCS_IMPACT",
  "TEST_PLAN",
  "TEST_REPORT",
  "DESIGN_REVIEW",
  "FINAL_REVIEW",
  "KNOWLEDGE_DISPOSITION",
] as const;

export type LifecycleArtifactKind = (typeof LIFECYCLE_ARTIFACT_KINDS)[number];
export type LifecycleProducerRole =
  | "ARCHITECT"
  | "DOCUMENTATION"
  | "TEST_VERIFICATION"
  | "REVIEW"
  | "OBSERVER_KNOWLEDGE"
  | "WORKFLOW";

export interface LifecycleArtifactProducerInput {
  readonly role: LifecycleProducerRole;
  readonly phase: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly sessionId: string;
}

export interface LifecycleArtifactProducer extends LifecycleArtifactProducerInput {
  readonly producerDigest: string;
}

export interface LifecycleArtifactRef {
  readonly artifactId: string;
  readonly kind: LifecycleArtifactKind;
  readonly taskId: string;
  readonly specRevision: number;
  readonly subjectCommit: string;
  readonly artifactDigest: string;
}

export type LifecyclePayload =
  | SpecPayload
  | DesignPayload
  | PlanPayload
  | DocsImpactPayload
  | TestPlanPayload
  | TestReportPayload
  | ReviewPayload
  | KnowledgeDispositionPayload;

export interface SpecPayload {
  readonly type: "SPEC";
  readonly requirements: readonly {
    readonly id: string;
    readonly statement: string;
    readonly acceptanceCriteria: readonly string[];
  }[];
}

export interface DesignPayload {
  readonly type: "DESIGN";
  readonly decisions: readonly string[];
  readonly components: readonly string[];
  readonly risks: readonly string[];
}

export interface PlanPayload {
  readonly type: "PLAN";
  readonly items: readonly {
    readonly id: string;
    readonly description: string;
    readonly dependsOn: readonly string[];
    readonly status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  }[];
}

export interface DocsImpactPayload {
  readonly type: "DOCS_IMPACT";
  readonly routeDigest: string;
  readonly reportRef: string;
  readonly dispositions: readonly {
    readonly documentId: string;
    readonly outcome: "updated" | "unchanged" | "not_applicable";
    readonly reason: string;
  }[];
}

export interface TestPlanPayload {
  readonly type: "TEST_PLAN";
  readonly cases: readonly {
    readonly id: string;
    readonly requirementIds: readonly string[];
    readonly category: "NORMAL" | "BOUNDARY" | "REGRESSION" | "FAILURE" | "RECOVERY";
    readonly argv: readonly string[];
  }[];
}

export interface TestReportPayload {
  readonly type: "TEST_REPORT";
  readonly candidateCommit: string;
  readonly outcomes: readonly {
    readonly caseId: string;
    readonly status: "PASSED" | "FAILED" | "NOT_RUN" | "UNKNOWN";
    readonly evidenceRefs: readonly string[];
  }[];
  readonly recommendation: "PASS" | "FINDINGS" | "INCONCLUSIVE";
  readonly findingRefs: readonly string[];
}

export interface ReviewPayload {
  readonly type: "DESIGN_REVIEW" | "FINAL_REVIEW";
  readonly verdict: "PASSED" | "FINDINGS";
  readonly subjectDigest: string;
  readonly findingRefs: readonly string[];
}

export interface KnowledgeDispositionPayload {
  readonly type: "KNOWLEDGE_DISPOSITION";
  readonly disposition: "none" | "proposed" | "deferred" | "applied";
  readonly candidateRefs: readonly string[];
  readonly rationale: string;
}

export interface CreateLifecycleArtifactInput {
  readonly taskId: string;
  readonly specRevision: number;
  readonly kind: LifecycleArtifactKind;
  readonly subjectCommit: string;
  readonly producer: LifecycleArtifactProducerInput;
  readonly dependencies: readonly LifecycleArtifactRef[];
  readonly payload: unknown;
}

export interface LifecycleArtifact {
  readonly schemaVersion: 1;
  readonly artifactId: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly kind: LifecycleArtifactKind;
  readonly subjectCommit: string;
  readonly producer: LifecycleArtifactProducer;
  readonly dependencies: readonly LifecycleArtifactRef[];
  readonly payload: LifecyclePayload;
  readonly contentDigest: string;
  readonly artifactDigest: string;
}

export interface LifecycleArtifactGateRequirement {
  readonly kind: LifecycleArtifactKind;
  readonly artifactDigest: string;
  readonly subjectCommit: string;
}

export interface LifecycleArtifactGate {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly requirements: readonly LifecycleArtifactGateRequirement[];
  readonly artifacts: readonly LifecycleArtifactRef[];
  readonly verdict: "PASSED";
  readonly gateDigest: string;
}

const requiredDependencies: Readonly<Record<LifecycleArtifactKind, readonly LifecycleArtifactKind[]>> = {
  SPEC: [],
  DESIGN: ["SPEC"],
  PLAN: ["SPEC", "DESIGN"],
  DOCS_IMPACT: ["SPEC", "DESIGN"],
  TEST_PLAN: ["SPEC", "DESIGN"],
  TEST_REPORT: ["TEST_PLAN"],
  DESIGN_REVIEW: ["SPEC", "DESIGN", "PLAN"],
  FINAL_REVIEW: ["DOCS_IMPACT", "TEST_REPORT"],
  KNOWLEDGE_DISPOSITION: [],
};

const producerPolicy: Readonly<Record<LifecycleArtifactKind, readonly LifecycleProducerRole[]>> = {
  SPEC: ["ARCHITECT"],
  DESIGN: ["ARCHITECT"],
  PLAN: ["ARCHITECT"],
  DOCS_IMPACT: ["DOCUMENTATION"],
  TEST_PLAN: ["TEST_VERIFICATION"],
  TEST_REPORT: ["TEST_VERIFICATION"],
  DESIGN_REVIEW: ["REVIEW"],
  FINAL_REVIEW: ["REVIEW"],
  KNOWLEDGE_DISPOSITION: ["OBSERVER_KNOWLEDGE", "WORKFLOW"],
};

export function createLifecycleArtifact(input: CreateLifecycleArtifactInput): LifecycleArtifact {
  assertTaskId(input.taskId);
  const specRevision = positiveInteger(input.specRevision, "specRevision");
  const kind = artifactKind(input.kind);
  const subjectCommit = commitId(input.subjectCommit, "subjectCommit");
  const producerCore: LifecycleArtifactProducerInput = {
    role: producerRole(input.producer.role),
    phase: requiredString(input.producer.phase, "producer.phase"),
    attemptId: stableId(input.producer.attemptId, "producer.attemptId"),
    generation: nonNegativeInteger(input.producer.generation, "producer.generation"),
    sessionId: requiredString(input.producer.sessionId, "producer.sessionId"),
  };
  if (!producerPolicy[kind].includes(producerCore.role)) {
    throw validation("LIFECYCLE_PRODUCER_FORBIDDEN", `${producerCore.role} cannot produce ${kind}`);
  }
  assertPhase(kind, producerCore.phase);
  const producer: LifecycleArtifactProducer = {
    ...producerCore,
    producerDigest: digest("lifecycle-producer", producerCore),
  };
  const dependencies = normalizeDependencies(input.dependencies, input.taskId, specRevision);
  assertDependencyPolicy(kind, dependencies);
  const payload = normalizePayload(kind, input.payload);
  if (payload.type === "TEST_REPORT" && payload.candidateCommit !== subjectCommit) {
    throw conflict("TEST_REPORT_COMMIT_MISMATCH", "Test Report candidateCommit must equal Artifact subjectCommit");
  }
  if ((payload.type === "DESIGN_REVIEW" || payload.type === "FINAL_REVIEW") &&
      payload.subjectDigest !== lifecycleReviewSubjectDigest(dependencies)) {
    throw conflict("REVIEW_SUBJECT_DIGEST_MISMATCH", "Review subjectDigest must bind the exact dependency set");
  }
  const artifactId = [
    "lifecycle-artifact",
    input.taskId,
    `r${specRevision}`,
    kind.toLowerCase().replaceAll("_", "-"),
    producer.attemptId,
    `g${producer.generation}`,
  ].join(":");
  const contentDigest = digest(`lifecycle-payload:${kind}`, payload);
  const core = {
    schemaVersion: 1 as const,
    artifactId,
    taskId: input.taskId,
    specRevision,
    kind,
    subjectCommit,
    producer,
    dependencies,
    payload,
    contentDigest,
  };
  return deepFreeze({ ...core, artifactDigest: digest("lifecycle-artifact", core) });
}

export function parseLifecycleArtifact(value: unknown, expectedDigest: string): LifecycleArtifact {
  const input = record(value, "LifecycleArtifact");
  const producer = record(input["producer"], "producer");
  const artifact = createLifecycleArtifact({
    taskId: requiredString(input["taskId"], "taskId"),
    specRevision: positiveInteger(input["specRevision"], "specRevision"),
    kind: artifactKind(input["kind"]),
    subjectCommit: commitId(input["subjectCommit"], "subjectCommit"),
    producer: {
      role: producerRole(producer["role"]),
      phase: requiredString(producer["phase"], "producer.phase"),
      attemptId: requiredString(producer["attemptId"], "producer.attemptId"),
      generation: nonNegativeInteger(producer["generation"], "producer.generation"),
      sessionId: requiredString(producer["sessionId"], "producer.sessionId"),
    },
    dependencies: dependencyInputs(input["dependencies"]),
    payload: input["payload"],
  });
  if (input["schemaVersion"] !== 1 || expectedDigest !== artifact.artifactDigest ||
      canonicalJson(input) !== canonicalJson(artifact)) {
    throw conflict("LIFECYCLE_ARTIFACT_INTEGRITY_FAILED", "Lifecycle Artifact differs from its digest or canonical source");
  }
  return artifact;
}

export function lifecycleArtifactRef(artifact: LifecycleArtifact): LifecycleArtifactRef {
  const parsed = parseLifecycleArtifact(
    JSON.parse(JSON.stringify(artifact)) as unknown,
    artifact.artifactDigest,
  );
  return deepFreeze({
    artifactId: parsed.artifactId,
    kind: parsed.kind,
    taskId: parsed.taskId,
    specRevision: parsed.specRevision,
    subjectCommit: parsed.subjectCommit,
    artifactDigest: parsed.artifactDigest,
  });
}

export function lifecycleReviewSubjectDigest(dependencies: readonly LifecycleArtifactRef[]): string {
  const normalized = [...dependencies].map((item) => ({
    artifactId: requiredString(item.artifactId, "dependency.artifactId"),
    kind: artifactKind(item.kind),
    taskId: requiredString(item.taskId, "dependency.taskId"),
    specRevision: positiveInteger(item.specRevision, "dependency.specRevision"),
    subjectCommit: commitId(item.subjectCommit, "dependency.subjectCommit"),
    artifactDigest: shaDigest(item.artifactDigest, "dependency.artifactDigest"),
  })).sort((left, right) => left.kind.localeCompare(right.kind));
  return digest("lifecycle-review-subject", normalized);
}

export function createLifecycleArtifactGate(input: {
  readonly taskId: string;
  readonly specRevision: number;
  readonly requirements: readonly LifecycleArtifactGateRequirement[];
  readonly artifacts: readonly LifecycleArtifact[];
}): LifecycleArtifactGate {
  assertTaskId(input.taskId);
  const specRevision = positiveInteger(input.specRevision, "specRevision");
  const requirements = input.requirements.map((item) => ({
    kind: artifactKind(item.kind),
    artifactDigest: shaDigest(item.artifactDigest, "requirement.artifactDigest"),
    subjectCommit: commitId(item.subjectCommit, "requirement.subjectCommit"),
  })).sort((left, right) => left.kind.localeCompare(right.kind));
  unique(requirements.map((item) => item.kind), "Gate requirement kind");
  const artifacts = input.artifacts.map((artifact) => parseLifecycleArtifact(
    JSON.parse(JSON.stringify(artifact)) as unknown,
    artifact.artifactDigest,
  ));
  unique(artifacts.map((artifact) => artifact.kind), "Gate Artifact kind");
  if (artifacts.length !== requirements.length) {
    throw conflict("LIFECYCLE_GATE_SET_MISMATCH", "Gate requires exactly one Artifact for every declared kind");
  }
  const byId = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact]));
  for (const artifact of artifacts) {
    for (const dependency of artifact.dependencies) {
      const resolved = byId.get(dependency.artifactId);
      if (resolved === undefined || resolved.artifactDigest !== dependency.artifactDigest ||
          resolved.kind !== dependency.kind) {
        throw conflict("LIFECYCLE_GATE_DEPENDENCY_UNRESOLVED", `${artifact.kind} dependency ${dependency.kind} is not in the verified Gate set`);
      }
    }
    if (artifact.payload.type === "TEST_REPORT") {
      const planRef = artifact.dependencies.find((item) => item.kind === "TEST_PLAN");
      const plan = planRef === undefined ? undefined : byId.get(planRef.artifactId);
      if (plan?.payload.type !== "TEST_PLAN") {
        throw conflict("LIFECYCLE_GATE_DEPENDENCY_UNRESOLVED", "Test Report has no verified Test Plan");
      }
      const planned = plan.payload.cases.map((item) => item.id).sort();
      const reported = artifact.payload.outcomes.map((item) => item.caseId).sort();
      if (canonicalJson(planned) !== canonicalJson(reported) ||
          (artifact.payload.recommendation === "PASS" && artifact.payload.outcomes.some((item) => item.status !== "PASSED"))) {
        throw conflict("TEST_REPORT_COVERAGE_MISMATCH", "Test Report must cover every Test Case and PASS requires all outcomes PASSED");
      }
    }
    if (artifact.payload.type === "TEST_PLAN") {
      const specRef = artifact.dependencies.find((item) => item.kind === "SPEC");
      const spec = specRef === undefined ? undefined : byId.get(specRef.artifactId);
      if (spec?.payload.type !== "SPEC") {
        throw conflict("LIFECYCLE_GATE_DEPENDENCY_UNRESOLVED", "Test Plan has no verified Spec");
      }
      const requirementIds = new Set(spec.payload.requirements.map((item) => item.id));
      const unknown = artifact.payload.cases.flatMap((item) => item.requirementIds)
        .filter((requirementId) => !requirementIds.has(requirementId));
      if (unknown.length > 0) {
        throw conflict("TEST_PLAN_REQUIREMENT_MISMATCH", `Test Plan references unknown requirements: ${[...new Set(unknown)].join(", ")}`);
      }
    }
  }
  const refs = requirements.map((requirement) => {
    const artifact = artifacts.find((candidate) => candidate.kind === requirement.kind);
    if (artifact === undefined || artifact.taskId !== input.taskId || artifact.specRevision !== specRevision ||
        artifact.subjectCommit !== requirement.subjectCommit || artifact.artifactDigest !== requirement.artifactDigest) {
      throw conflict(
        "LIFECYCLE_GATE_BINDING_MISMATCH",
        `Artifact ${requirement.kind} does not match Task, Revision, Commit and Digest Gate binding`,
      );
    }
    return lifecycleArtifactRef(artifact);
  }).sort((left, right) => left.kind.localeCompare(right.kind));
  const core = {
    schemaVersion: 1 as const,
    taskId: input.taskId,
    specRevision,
    requirements,
    artifacts: refs,
    verdict: "PASSED" as const,
  };
  return deepFreeze({ ...core, gateDigest: digest("lifecycle-artifact-gate", core) });
}

function normalizeDependencies(
  values: readonly LifecycleArtifactRef[],
  taskId: string,
  specRevision: number,
): LifecycleArtifactRef[] {
  if (!Array.isArray(values)) throw validation("LIFECYCLE_DEPENDENCIES_INVALID", "dependencies must be an array");
  const dependencies = values.map((value) => ({
    artifactId: requiredString(value.artifactId, "dependency.artifactId"),
    kind: artifactKind(value.kind),
    taskId: requiredString(value.taskId, "dependency.taskId"),
    specRevision: positiveInteger(value.specRevision, "dependency.specRevision"),
    subjectCommit: commitId(value.subjectCommit, "dependency.subjectCommit"),
    artifactDigest: shaDigest(value.artifactDigest, "dependency.artifactDigest"),
  })).sort((left, right) => left.kind.localeCompare(right.kind));
  unique(dependencies.map((item) => item.kind), "Dependency kind");
  for (const dependency of dependencies) {
    if (dependency.taskId !== taskId || dependency.specRevision !== specRevision) {
      throw conflict("LIFECYCLE_DEPENDENCY_SCOPE_MISMATCH", "Dependencies must use the same Task and Spec Revision");
    }
  }
  return dependencies;
}

function assertDependencyPolicy(kind: LifecycleArtifactKind, dependencies: readonly LifecycleArtifactRef[]): void {
  const actual = dependencies.map((item) => item.kind).sort();
  const expected = [...requiredDependencies[kind]].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw conflict("LIFECYCLE_DEPENDENCY_POLICY_FAILED", `${kind} requires dependencies: ${expected.join(", ") || "none"}`);
  }
}

function normalizePayload(kind: LifecycleArtifactKind, value: unknown): LifecyclePayload {
  const input = record(value, `${kind} payload`);
  if (input["type"] !== kind) throw validation("LIFECYCLE_PAYLOAD_TYPE_MISMATCH", `Payload type must be ${kind}`);
  switch (kind) {
    case "SPEC": {
      const requirements = records(input["requirements"], "requirements").map((item) => ({
        id: requiredString(item["id"], "requirement.id"),
        statement: requiredString(item["statement"], "requirement.statement"),
        acceptanceCriteria: strings(item["acceptanceCriteria"], "requirement.acceptanceCriteria", true),
      })).sort((left, right) => left.id.localeCompare(right.id));
      unique(requirements.map((item) => item.id), "Requirement id");
      if (requirements.length === 0) throw validation("SPEC_REQUIREMENTS_REQUIRED", "Spec requires at least one requirement");
      return { type: "SPEC", requirements };
    }
    case "DESIGN":
      return {
        type: "DESIGN",
        decisions: strings(input["decisions"], "decisions", true),
        components: strings(input["components"], "components", true),
        risks: strings(input["risks"], "risks", false),
      };
    case "PLAN": {
      const items = records(input["items"], "items").map((item) => ({
        id: requiredString(item["id"], "plan.id"),
        description: requiredString(item["description"], "plan.description"),
        dependsOn: strings(item["dependsOn"], "plan.dependsOn", false),
        status: enumeration(item["status"], ["PENDING", "IN_PROGRESS", "COMPLETED"] as const, "plan.status"),
      })).sort((left, right) => left.id.localeCompare(right.id));
      unique(items.map((item) => item.id), "Plan item id");
      const ids = new Set(items.map((item) => item.id));
      for (const item of items) {
        if (item.dependsOn.includes(item.id) || item.dependsOn.some((id) => !ids.has(id))) {
          throw validation("PLAN_DEPENDENCY_INVALID", `Plan dependencies are invalid for ${item.id}`);
        }
      }
      assertAcyclicPlan(items);
      if (items.length === 0) throw validation("PLAN_ITEMS_REQUIRED", "Plan requires at least one item");
      return { type: "PLAN", items };
    }
    case "DOCS_IMPACT": {
      const dispositions = records(input["dispositions"], "dispositions").map((item) => ({
        documentId: requiredString(item["documentId"], "disposition.documentId"),
        outcome: enumeration(item["outcome"], ["updated", "unchanged", "not_applicable"] as const, "disposition.outcome"),
        reason: requiredString(item["reason"], "disposition.reason"),
      })).sort((left, right) => left.documentId.localeCompare(right.documentId));
      unique(dispositions.map((item) => item.documentId), "Disposition document");
      return {
        type: "DOCS_IMPACT",
        routeDigest: shaDigest(input["routeDigest"], "routeDigest"),
        reportRef: requiredString(input["reportRef"], "reportRef"),
        dispositions,
      };
    }
    case "TEST_PLAN": {
      const cases = records(input["cases"], "cases").map((item) => ({
        id: requiredString(item["id"], "testCase.id"),
        requirementIds: strings(item["requirementIds"], "testCase.requirementIds", true),
        category: enumeration(item["category"], ["NORMAL", "BOUNDARY", "REGRESSION", "FAILURE", "RECOVERY"] as const, "testCase.category"),
        argv: argv(item["argv"]),
      })).sort((left, right) => left.id.localeCompare(right.id));
      unique(cases.map((item) => item.id), "Test Case id");
      if (cases.length === 0) throw validation("TEST_CASES_REQUIRED", "Test Plan requires at least one case");
      return { type: "TEST_PLAN", cases };
    }
    case "TEST_REPORT": {
      const outcomes = records(input["outcomes"], "outcomes").map((item) => ({
        caseId: requiredString(item["caseId"], "outcome.caseId"),
        status: enumeration(item["status"], ["PASSED", "FAILED", "NOT_RUN", "UNKNOWN"] as const, "outcome.status"),
        evidenceRefs: strings(item["evidenceRefs"], "outcome.evidenceRefs", false),
      })).sort((left, right) => left.caseId.localeCompare(right.caseId));
      unique(outcomes.map((item) => item.caseId), "Test Outcome case");
      if (outcomes.length === 0) throw validation("TEST_OUTCOMES_REQUIRED", "Test Report requires at least one outcome");
      const recommendation = enumeration(input["recommendation"], ["PASS", "FINDINGS", "INCONCLUSIVE"] as const, "recommendation");
      const findingRefs = strings(input["findingRefs"], "findingRefs", false);
      if (recommendation === "PASS" && (findingRefs.length > 0 || outcomes.some((item) => item.status !== "PASSED"))) {
        throw validation("TEST_REPORT_RECOMMENDATION_INVALID", "PASS requires every outcome PASSED and zero findings");
      }
      if (recommendation === "FINDINGS" && findingRefs.length === 0) {
        throw validation("TEST_REPORT_RECOMMENDATION_INVALID", "FINDINGS requires at least one Finding ref");
      }
      if (recommendation === "INCONCLUSIVE" && !outcomes.some((item) => item.status === "UNKNOWN" || item.status === "NOT_RUN")) {
        throw validation("TEST_REPORT_RECOMMENDATION_INVALID", "INCONCLUSIVE requires an UNKNOWN or NOT_RUN outcome");
      }
      return {
        type: "TEST_REPORT",
        candidateCommit: commitId(input["candidateCommit"], "candidateCommit"),
        outcomes,
        recommendation,
        findingRefs,
      };
    }
    case "DESIGN_REVIEW":
    case "FINAL_REVIEW":
      const verdict = enumeration(input["verdict"], ["PASSED", "FINDINGS"] as const, "verdict");
      const findingRefs = strings(input["findingRefs"], "findingRefs", false);
      if ((verdict === "PASSED") !== (findingRefs.length === 0)) {
        throw validation("REVIEW_VERDICT_INVALID", "PASSED requires zero findings and FINDINGS requires at least one ref");
      }
      return {
        type: kind,
        verdict,
        subjectDigest: shaDigest(input["subjectDigest"], "subjectDigest"),
        findingRefs,
      };
    case "KNOWLEDGE_DISPOSITION": {
      const disposition = enumeration(input["disposition"], ["none", "proposed", "deferred", "applied"] as const, "disposition");
      const candidateRefs = strings(input["candidateRefs"], "candidateRefs", false);
      if ((disposition === "none") !== (candidateRefs.length === 0)) {
        throw validation("KNOWLEDGE_DISPOSITION_INVALID", "none requires zero candidates; every other disposition requires candidate refs");
      }
      return {
        type: "KNOWLEDGE_DISPOSITION",
        disposition,
        candidateRefs,
        rationale: requiredString(input["rationale"], "rationale"),
      };
    }
  }
}

function assertPhase(kind: LifecycleArtifactKind, phase: string): void {
  if ((kind === "SPEC" || kind === "DESIGN" || kind === "PLAN") && phase === "ARCHITECT") return;
  if (kind === "DOCS_IMPACT" && phase === "DOCUMENTATION") return;
  const expected = kind === "DESIGN_REVIEW" ? "DESIGN_REVIEW"
    : kind === "FINAL_REVIEW" ? "FINAL_REVIEW"
      : kind === "TEST_PLAN" ? "TEST_PLAN"
        : kind === "TEST_REPORT" ? "TEST_ASSESSMENT"
          : kind;
  if (phase !== expected) throw validation("LIFECYCLE_PHASE_MISMATCH", `${kind} requires producer phase ${expected}`);
}

function dependencyInputs(value: unknown): LifecycleArtifactRef[] {
  return records(value, "dependencies").map((item) => ({
    artifactId: requiredString(item["artifactId"], "dependency.artifactId"),
    kind: artifactKind(item["kind"]),
    taskId: requiredString(item["taskId"], "dependency.taskId"),
    specRevision: positiveInteger(item["specRevision"], "dependency.specRevision"),
    subjectCommit: commitId(item["subjectCommit"], "dependency.subjectCommit"),
    artifactDigest: shaDigest(item["artifactDigest"], "dependency.artifactDigest"),
  }));
}

function argv(value: unknown): string[] {
  const values = strings(value, "argv", true, false);
  if (values[0] === undefined || values[0].startsWith("-") || values.some((item) => item.includes("\0"))) {
    throw validation("TEST_ARGV_INVALID", "Test argv must contain an executable followed by literal arguments");
  }
  return values;
}

function strings(value: unknown, field: string, required: boolean, sort = true): string[] {
  if (!Array.isArray(value)) throw validation("LIFECYCLE_ARRAY_INVALID", `${field} must be an array`);
  const result = value.map((item) => requiredString(item, field));
  unique(result, field);
  if (required && result.length === 0) throw validation("LIFECYCLE_ARRAY_EMPTY", `${field} must not be empty`);
  return sort ? result.sort() : result;
}

function records(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw validation("LIFECYCLE_ARRAY_INVALID", `${field} must be an array`);
  return value.map((item) => record(item, field));
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validation("LIFECYCLE_OBJECT_INVALID", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function artifactKind(value: unknown): LifecycleArtifactKind {
  return enumeration(value, LIFECYCLE_ARTIFACT_KINDS, "kind");
}

function producerRole(value: unknown): LifecycleProducerRole {
  return enumeration(value, ["ARCHITECT", "DOCUMENTATION", "TEST_VERIFICATION", "REVIEW", "OBSERVER_KNOWLEDGE", "WORKFLOW"] as const, "producer.role");
}

function enumeration<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw validation("LIFECYCLE_ENUM_INVALID", `${field} must be one of ${values.join(", ")}`);
  }
  return value as T[number];
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw validation("LIFECYCLE_STRING_INVALID", `${field} must be a non-empty string without NUL bytes`);
  }
  return value;
}

function stableId(value: unknown, field: string): string {
  const normalized = requiredString(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) {
    throw validation("LIFECYCLE_ID_INVALID", `${field} must be a stable identifier segment`);
  }
  return normalized;
}

function assertAcyclicPlan(items: readonly { readonly id: string; readonly dependsOn: readonly string[] }[]): void {
  const dependencies = new Map(items.map((item) => [item.id, item.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw validation("PLAN_DEPENDENCY_CYCLE", `Plan contains a dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const item of items) visit(item.id);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw validation("LIFECYCLE_INTEGER_INVALID", `${field} must be positive`);
  return value as number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw validation("LIFECYCLE_INTEGER_INVALID", `${field} must be non-negative`);
  return value as number;
}

function commitId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)) {
    throw validation("LIFECYCLE_COMMIT_INVALID", `${field} must be a full Git commit id`);
  }
  return value;
}

function shaDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw validation("LIFECYCLE_DIGEST_INVALID", `${field} must be a SHA-256 digest`);
  }
  return value;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw validation("LIFECYCLE_DUPLICATE", `${label} must be unique`);
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(`${namespace}\0${canonicalJson(value)}`).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function validation(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "VALIDATION", message });
}

function conflict(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "CONFLICT", message });
}
