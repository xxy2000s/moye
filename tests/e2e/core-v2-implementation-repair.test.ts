import { describe, expect, it } from "vitest";

import { createCoreV2Lifecycle, workflowAcceptArchitectV2, workflowAcceptDesignReviewV2, workflowAcceptImplementationV2, workflowAuthorizeRepairV2 } from "../../src/domain/core-v2-lifecycle.js";
import { completeRoleAttemptV2, createRoleAttemptV2, createRoleRunEvidenceV2, startRoleAttemptV2 } from "../../src/domain/role-runtime-v2.js";
import type { AgentRoleV2, RolePhaseV2 } from "../../src/domain/role-runtime-v2.js";

const base = "a".repeat(40);
const sha = (c: string) => `sha256:${c.repeat(64)}`;
const at = (n: number) => `2026-08-23T00:00:${String(n).padStart(2, "0")}.000Z`;

describe("Core v2 Implementation → Repair serialized handoff", () => {
  it("keeps both checkpoints and lets only Generation N+1 advance", () => {
    let projection = createCoreV2Lifecycle({ taskId: "TASK-E2E-IMPL", specRevision: 1, subjectCommit: base, at: at(0) });
    projection = workflowAcceptArchitectV2(projection, success("ARCHITECT", "ARCHITECT", 0), {
      spec: { type: "SPEC", requirements: [{ id: "R", statement: "repair safely", acceptanceCriteria: ["checkpointed"] }] },
      design: { type: "DESIGN", decisions: ["append only"], components: ["workflow"], risks: ["stale result"] },
      plan: { type: "PLAN", items: [{ id: "P", description: "implement", dependsOn: [], status: "PENDING" }] },
    }, at(3));
    projection = workflowAcceptDesignReviewV2(projection, success("REVIEW", "DESIGN_REVIEW", 0), { verdict: "PASSED", findingRefs: [] }, at(4));
    projection = workflowAcceptImplementationV2(projection, success("IMPLEMENTATION", "IMPLEMENTATION", 0, base), {
      candidateCommit: "b".repeat(40), treeDigest: "c".repeat(40), checkpointRef: "artifact://g0",
      testEvidenceRefs: ["artifact://g0-test"], selfReview: { verdict: "FINDINGS", findingRefs: ["finding://g0"] },
    }, at(5));
    projection = workflowAuthorizeRepairV2(JSON.parse(JSON.stringify(projection)), { reason: "repair finding", at: at(6) });
    projection = workflowAcceptImplementationV2(projection, success("IMPLEMENTATION", "IMPLEMENTATION", 1, "b".repeat(40)), {
      candidateCommit: "d".repeat(40), treeDigest: "e".repeat(40), checkpointRef: "artifact://g1",
      testEvidenceRefs: ["artifact://g1-test"], selfReview: { verdict: "PASSED", findingRefs: [] },
    }, at(9));
    expect(projection.state).toBe("DOCUMENTATION_REQUIRED");
    expect(projection.implementationCheckpoints.map((item) => item.generation)).toEqual([0, 1]);
    expect(projection.candidateCommit).toBe("d".repeat(40));
  });
});

function success(role: AgentRoleV2, phase: RolePhaseV2, generation: number, subjectCommit = base) {
  const running = startRoleAttemptV2(createRoleAttemptV2({ taskId: "TASK-E2E-IMPL", specRevision: 1, role, phase, generation,
    runnerKind: "CODEX_EXEC", inputDigest: sha("1"), subjectCommit, inputArtifactRefs: [], scheduledAt: at(generation * 3) }), at(generation * 3 + 1));
  return completeRoleAttemptV2(running, createRoleRunEvidenceV2({ runId: sha(String(generation + 2)), taskId: running.taskId,
    specRevision: 1, role, phase, attemptId: running.attemptId, generation, runnerKind: "CODEX_EXEC", sessionId: `real-${phase}-g${generation}`,
    outcome: "SUCCEEDED", startedAt: at(generation * 3 + 1), finishedAt: at(generation * 3 + 2), eventsRef: "a://e", eventsDigest: sha("4"),
    stderrRef: "a://s", stderrDigest: sha("5"), outputRef: "a://o", outputDigest: sha("6"), manifestRef: "a://m", manifestDigest: sha("7"),
    artifactRefs: [], findingRefs: [] }), at(generation * 3 + 2));
}
