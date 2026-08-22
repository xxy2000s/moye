import { describe, expect, it } from "vitest";
import { createLifecycleArtifact, lifecycleArtifactRef } from "../../src/domain/lifecycle-artifact.js";

describe("Core v2 Documentation handoff", () => {
  it("serializes a real Docs Impact payload bound to Spec and Design", () => {
    const commit = "a".repeat(40); const producer = { role: "ARCHITECT" as const, phase: "ARCHITECT", attemptId: "TASK.DOC.r1.g0", generation: 0, sessionId: "session-architect" };
    const spec = createLifecycleArtifact({ taskId: "TASK-E2E-DOC", specRevision: 1, kind: "SPEC", subjectCommit: commit, producer, dependencies: [],
      payload: { type: "SPEC", requirements: [{ id: "R", statement: "document", acceptanceCriteria: ["routed"] }] } });
    const design = createLifecycleArtifact({ taskId: "TASK-E2E-DOC", specRevision: 1, kind: "DESIGN", subjectCommit: commit, producer, dependencies: [lifecycleArtifactRef(spec)],
      payload: { type: "DESIGN", decisions: ["route"], components: ["docs"], risks: [] } });
    const docs = createLifecycleArtifact({ taskId: "TASK-E2E-DOC", specRevision: 1, kind: "DOCS_IMPACT", subjectCommit: "b".repeat(40),
      producer: { role: "DOCUMENTATION", phase: "DOCUMENTATION", attemptId: "TASK.DOCUMENTATION.r1.g0", generation: 0, sessionId: "session-doc" },
      dependencies: [lifecycleArtifactRef(spec), lifecycleArtifactRef(design)], payload: { type: "DOCS_IMPACT", routeDigest: `sha256:${"1".repeat(64)}`,
        reportRef: "artifact://impact", dispositions: [{ documentId: "codemap", outcome: "updated", reason: "changed" }] } });
    expect(JSON.parse(JSON.stringify(docs))).toMatchObject({ kind: "DOCS_IMPACT", payload: { reportRef: "artifact://impact" } });
  });
});
