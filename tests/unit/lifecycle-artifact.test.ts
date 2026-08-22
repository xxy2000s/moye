import { describe, expect, it } from "vitest";

import {
  createLifecycleArtifact,
  createLifecycleArtifactGate,
  lifecycleArtifactRef,
  parseLifecycleArtifact,
} from "../../src/domain/lifecycle-artifact.js";
import type {
  CreateLifecycleArtifactInput,
  LifecycleArtifact,
  LifecycleArtifactKind,
  LifecycleArtifactProducerInput,
  LifecycleArtifactRef,
} from "../../src/domain/lifecycle-artifact.js";

const baseCommit = "a".repeat(40);
const candidateCommit = "b".repeat(40);
const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

describe("Core v2 lifecycle artifacts", () => {
  it("round-trips a canonical Artifact and rejects content tampering", () => {
    const spec = artifact("SPEC", [], specPayload());
    expect(parseLifecycleArtifact(JSON.parse(JSON.stringify(spec)), spec.artifactDigest)).toEqual(spec);
    const tampered = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
    const payload = tampered["payload"] as { requirements: Array<{ statement: string }> };
    payload.requirements[0]!.statement = "tampered";
    expect(() => parseLifecycleArtifact(tampered, spec.artifactDigest)).toThrow(/differs from its digest/);
  });

  it("requires the exact role and isolated phase for each kind", () => {
    expect(() => createLifecycleArtifact({
      ...input("TEST_REPORT", [], testReportPayload()),
      producer: producer("ARCHITECT", "TEST_ASSESSMENT"),
    })).toThrow(/cannot produce TEST_REPORT/);
    expect(() => createLifecycleArtifact({
      ...input("FINAL_REVIEW", [] as LifecycleArtifactRef[], reviewPayload("FINAL_REVIEW")),
      producer: producer("REVIEW", "DESIGN_REVIEW"),
    })).toThrow(/requires producer phase FINAL_REVIEW/);
  });

  it("rejects missing, extra and cross-revision dependencies", () => {
    const spec = artifact("SPEC", [], specPayload());
    expect(() => artifact("DESIGN", [], designPayload())).toThrow(/requires dependencies: SPEC/);
    expect(() => artifact("SPEC", [lifecycleArtifactRef(spec)], specPayload())).toThrow(/requires dependencies: none/);
    expect(() => artifact("DESIGN", [{ ...lifecycleArtifactRef(spec), specRevision: 2 }], designPayload()))
      .toThrow(/same Task and Spec Revision/);
  });

  it("binds Test Report candidate Commit to its Artifact subject", () => {
    const spec = artifact("SPEC", [], specPayload());
    const design = artifact("DESIGN", [ref(spec)], designPayload());
    const testPlan = artifact("TEST_PLAN", [ref(spec), ref(design)], testPlanPayload(), candidateCommit);
    expect(() => artifact(
      "TEST_REPORT",
      [ref(testPlan)],
      { ...testReportPayload(), candidateCommit: baseCommit },
      candidateCommit,
    )).toThrow(/candidateCommit must equal Artifact subjectCommit/);
  });

  it("rejects old Revision and wrong Commit Artifacts at the deterministic Gate", () => {
    const spec = artifact("SPEC", [], specPayload());
    const requirement = { kind: spec.kind, artifactDigest: spec.artifactDigest, subjectCommit: spec.subjectCommit };
    expect(() => createLifecycleArtifactGate({
      taskId: "TASK-ARTIFACTS",
      specRevision: 2,
      requirements: [requirement],
      artifacts: [spec],
    })).toThrow(/does not match Task, Revision, Commit and Digest/);
    expect(() => createLifecycleArtifactGate({
      taskId: "TASK-ARTIFACTS",
      specRevision: 1,
      requirements: [{ ...requirement, subjectCommit: candidateCommit }],
      artifacts: [spec],
    })).toThrow(/does not match Task, Revision, Commit and Digest/);
  });

  it("creates an exact digest-bound Gate for the requested Artifact set", () => {
    const spec = artifact("SPEC", [], specPayload());
    const design = artifact("DESIGN", [ref(spec)], designPayload());
    const gate = createLifecycleArtifactGate({
      taskId: "TASK-ARTIFACTS",
      specRevision: 1,
      requirements: [spec, design].map((item) => ({
        kind: item.kind, artifactDigest: item.artifactDigest, subjectCommit: item.subjectCommit,
      })),
      artifacts: [design, spec],
    });
    expect(gate).toMatchObject({ verdict: "PASSED", taskId: "TASK-ARTIFACTS", specRevision: 1 });
    expect(gate.artifacts.map((item) => item.kind)).toEqual(["DESIGN", "SPEC"]);
    expect(Object.isFrozen(gate)).toBe(true);
  });

  it("does not trust an unresolved dependency ref even when its shape and digest look valid", () => {
    const spec = artifact("SPEC", [], specPayload());
    const design = artifact("DESIGN", [{ ...ref(spec), artifactDigest: digest("f") }], designPayload());
    expect(() => createLifecycleArtifactGate({
      taskId: "TASK-ARTIFACTS",
      specRevision: 1,
      requirements: [spec, design].map((item) => ({
        kind: item.kind, artifactDigest: item.artifactDigest, subjectCommit: item.subjectCommit,
      })),
      artifacts: [spec, design],
    })).toThrow(/dependency SPEC is not in the verified Gate set/);
  });
});

function artifact(
  kind: LifecycleArtifactKind,
  dependencies: readonly LifecycleArtifactRef[],
  payload: unknown,
  subjectCommit = baseCommit,
): LifecycleArtifact {
  return createLifecycleArtifact(input(kind, dependencies, payload, subjectCommit));
}

function input(
  kind: LifecycleArtifactKind,
  dependencies: readonly LifecycleArtifactRef[],
  payload: unknown,
  subjectCommit = baseCommit,
): CreateLifecycleArtifactInput {
  const role = kind === "DOCS_IMPACT" ? "DOCUMENTATION"
    : kind === "TEST_PLAN" || kind === "TEST_REPORT" ? "TEST_VERIFICATION"
      : kind === "DESIGN_REVIEW" || kind === "FINAL_REVIEW" ? "REVIEW"
        : kind === "KNOWLEDGE_DISPOSITION" ? "WORKFLOW"
          : "ARCHITECT";
  const phase = kind === "TEST_REPORT" ? "TEST_ASSESSMENT" : kind;
  return {
    taskId: "TASK-ARTIFACTS",
    specRevision: 1,
    kind,
    subjectCommit,
    producer: producer(role, phase),
    dependencies,
    payload,
  };
}

function producer(role: LifecycleArtifactProducerInput["role"], phase: string): LifecycleArtifactProducerInput {
  return { role, phase, attemptId: `attempt-${phase.toLowerCase()}`, generation: 0, sessionId: `session-${phase.toLowerCase()}` };
}

function ref(value: LifecycleArtifact): LifecycleArtifactRef { return lifecycleArtifactRef(value); }
function specPayload() {
  return { type: "SPEC", requirements: [{ id: "REQ-1", statement: "works", acceptanceCriteria: ["evidence exists"] }] };
}
function designPayload() { return { type: "DESIGN", decisions: ["use artifact"], components: ["domain"], risks: [] }; }
function testPlanPayload() {
  return { type: "TEST_PLAN", cases: [{ id: "TC-1", requirementIds: ["REQ-1"], category: "NORMAL", argv: ["npm", "test"] }] };
}
function testReportPayload() {
  return {
    type: "TEST_REPORT",
    candidateCommit,
    outcomes: [{ caseId: "TC-1", status: "PASSED", evidenceRefs: ["evidence://tc-1"] }],
    recommendation: "PASS",
    findingRefs: [],
  };
}
function reviewPayload(type: "DESIGN_REVIEW" | "FINAL_REVIEW") {
  return { type, verdict: "PASSED", subjectDigest: digest("c"), findingRefs: [] };
}
