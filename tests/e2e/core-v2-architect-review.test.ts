import { describe, expect, it } from "vitest";
import { createCoreV2Lifecycle, workflowAcceptArchitectV2, workflowAcceptDesignReviewV2, workflowReplanV2 } from "../../src/domain/core-v2-lifecycle.js";
import { parseLifecycleArtifact } from "../../src/domain/lifecycle-artifact.js";
import { completeRoleAttemptV2, createRoleAttemptV2, createRoleRunEvidenceV2, startRoleAttemptV2 } from "../../src/domain/role-runtime-v2.js";

describe("Core v2 Architect → Design Review serialized handoff", () => {
  it("rebuilds every Artifact across handoffs and restarts Architect at R+1", () => {
    const commit = "c".repeat(40); const sha = (c: string) => `sha256:${c.repeat(64)}`; const at = (n: number) => `2026-08-23T00:00:0${n}.000Z`;
    const attempt = (role: "ARCHITECT" | "REVIEW", phase: "ARCHITECT" | "DESIGN_REVIEW") => {
      const running = startRoleAttemptV2(createRoleAttemptV2({ taskId: "TASK-E2E-ARCH", specRevision: 1, role, phase, generation: 0,
        runnerKind: "CODEX_EXEC", inputDigest: sha("1"), subjectCommit: commit, inputArtifactRefs: [], scheduledAt: at(0) }), at(1));
      return completeRoleAttemptV2(running, createRoleRunEvidenceV2({ runId: sha(role === "ARCHITECT" ? "2" : "3"), taskId: running.taskId,
        specRevision: 1, role, phase, attemptId: running.attemptId, generation: 0, runnerKind: "CODEX_EXEC", sessionId: `real-${phase}`,
        outcome: "SUCCEEDED", startedAt: at(1), finishedAt: at(2), eventsRef: "a://e", eventsDigest: sha("4"), stderrRef: "a://s",
        stderrDigest: sha("5"), outputRef: "a://o", outputDigest: sha("6"), manifestRef: "a://m", manifestDigest: sha("7"), artifactRefs: [], findingRefs: [] }), at(2));
    };
    let projection = createCoreV2Lifecycle({ taskId: "TASK-E2E-ARCH", specRevision: 1, subjectCommit: commit, at: at(0) });
    projection = workflowAcceptArchitectV2(projection, attempt("ARCHITECT", "ARCHITECT"), {
      spec: { type: "SPEC", requirements: [{ id: "R", statement: "real handoff", acceptanceCriteria: ["reviewed"] }] },
      design: { type: "DESIGN", decisions: ["digest"], components: ["workflow"], risks: [] },
      plan: { type: "PLAN", items: [{ id: "P", description: "build", dependsOn: [], status: "PENDING" }] },
    }, at(3));
    projection = JSON.parse(JSON.stringify(projection));
    for (const artifact of projection.artifacts) expect(parseLifecycleArtifact(artifact, artifact.artifactDigest)).toEqual(artifact);
    projection = workflowAcceptDesignReviewV2(projection, attempt("REVIEW", "DESIGN_REVIEW"), { verdict: "FINDINGS", findingRefs: ["finding://r"] }, at(4));
    projection = workflowReplanV2(JSON.parse(JSON.stringify(projection)), { nextSubjectCommit: "d".repeat(40), reason: "design finding", at: at(5) });
    expect(projection).toMatchObject({ specRevision: 2, state: "ARCHITECT_REQUIRED" });
    expect(projection.invalidatedRevisions[0]?.artifactRefs.map((ref) => ref.specRevision)).toEqual([1, 1, 1, 1]);
  });
});
