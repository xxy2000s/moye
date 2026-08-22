import { describe, expect, it } from "vitest";

import {
  createLifecycleArtifact,
  createLifecycleArtifactGate,
  lifecycleArtifactRef,
  lifecycleReviewSubjectDigest,
  parseLifecycleArtifact,
} from "../../src/domain/lifecycle-artifact.js";
import type { LifecycleArtifact, LifecycleArtifactKind, LifecycleArtifactRef, LifecycleProducerRole } from "../../src/domain/lifecycle-artifact.js";

describe("Lifecycle Artifact handoff chain", () => {
  it("carries the full Core v2 document chain through serialized Worker handoffs", () => {
    const base = "1".repeat(40);
    const candidate = "2".repeat(40);
    const artifacts: LifecycleArtifact[] = [];
    const add = (kind: LifecycleArtifactKind, deps: LifecycleArtifactRef[], subjectCommit: string, payload: unknown) => {
      const role: LifecycleProducerRole = kind === "DOCS_IMPACT" ? "DOCUMENTATION"
        : kind.startsWith("TEST_") ? "TEST_VERIFICATION"
          : kind.endsWith("REVIEW") ? "REVIEW"
            : kind === "KNOWLEDGE_DISPOSITION" ? "WORKFLOW" : "ARCHITECT";
      const phase = kind === "TEST_REPORT" ? "TEST_ASSESSMENT" : kind;
      const produced = createLifecycleArtifact({
        taskId: "TASK-E2E-ARTIFACTS",
        specRevision: 1,
        kind,
        subjectCommit,
        producer: { role, phase, attemptId: `attempt-${kind}`, generation: 0, sessionId: `session-${kind}` },
        dependencies: deps,
        payload,
      });
      const handedOff = parseLifecycleArtifact(JSON.parse(JSON.stringify(produced)), produced.artifactDigest);
      artifacts.push(handedOff);
      return lifecycleArtifactRef(handedOff);
    };
    const spec = add("SPEC", [], base, {
      type: "SPEC", requirements: [{ id: "REQ-E2E", statement: "close", acceptanceCriteria: ["all evidence bound"] }],
    });
    const design = add("DESIGN", [spec], base, { type: "DESIGN", decisions: ["digest everything"], components: ["Core"], risks: ["stale evidence"] });
    const plan = add("PLAN", [spec, design], base, { type: "PLAN", items: [{ id: "P1", description: "implement", dependsOn: [], status: "COMPLETED" }] });
    const designReviewDependencies = [spec, design, plan];
    add("DESIGN_REVIEW", designReviewDependencies, base, {
      type: "DESIGN_REVIEW", verdict: "PASSED",
      subjectDigest: lifecycleReviewSubjectDigest(designReviewDependencies), findingRefs: [],
    });
    const docs = add("DOCS_IMPACT", [spec, design], candidate, {
      type: "DOCS_IMPACT", routeDigest: "sha256:" + "4".repeat(64), reportRef: "artifact://docs-impact",
      dispositions: [{ documentId: "codemap", outcome: "updated", reason: "new module" }],
    });
    const testPlan = add("TEST_PLAN", [spec, design], candidate, {
      type: "TEST_PLAN", cases: [
        { id: "TC-NORMAL", requirementIds: ["REQ-E2E"], category: "NORMAL", argv: ["npm", "run", "check"] },
        { id: "TC-RECOVERY", requirementIds: ["REQ-E2E"], category: "RECOVERY", argv: ["npm", "run", "test:e2e"] },
      ],
    });
    const testReport = add("TEST_REPORT", [testPlan], candidate, {
      type: "TEST_REPORT", candidateCommit: candidate,
      outcomes: [
        { caseId: "TC-NORMAL", status: "PASSED", evidenceRefs: ["evidence://check"] },
        { caseId: "TC-RECOVERY", status: "PASSED", evidenceRefs: ["evidence://e2e"] },
      ], recommendation: "PASS", findingRefs: [],
    });
    const finalReviewDependencies = [docs, testReport];
    add("FINAL_REVIEW", finalReviewDependencies, candidate, {
      type: "FINAL_REVIEW", verdict: "PASSED",
      subjectDigest: lifecycleReviewSubjectDigest(finalReviewDependencies), findingRefs: [],
    });
    add("KNOWLEDGE_DISPOSITION", [], candidate, {
      type: "KNOWLEDGE_DISPOSITION", disposition: "none", candidateRefs: [], rationale: "no reusable new finding",
    });

    const gate = createLifecycleArtifactGate({
      taskId: "TASK-E2E-ARTIFACTS",
      specRevision: 1,
      requirements: artifacts.map((artifact) => ({
        kind: artifact.kind, artifactDigest: artifact.artifactDigest, subjectCommit: artifact.subjectCommit,
      })),
      artifacts: [...artifacts].reverse(),
    });
    expect(gate.verdict).toBe("PASSED");
    expect(gate.artifacts).toHaveLength(9);
    expect(gate.artifacts.map((item) => item.kind)).toEqual([
      "DESIGN", "DESIGN_REVIEW", "DOCS_IMPACT", "FINAL_REVIEW", "KNOWLEDGE_DISPOSITION",
      "PLAN", "SPEC", "TEST_PLAN", "TEST_REPORT",
    ]);
  });
});
