import { describe, expect, it } from "vitest";

import { createCoreV2Lifecycle, workflowAcceptArchitectV2, workflowAcceptDesignReviewV2, workflowReplanV2 } from "../../src/domain/core-v2-lifecycle.js";
import { completeRoleAttemptV2, createRoleAttemptV2, createRoleRunEvidenceV2, startRoleAttemptV2 } from "../../src/domain/role-runtime-v2.js";
import type { AgentRoleV2, RolePhaseV2 } from "../../src/domain/role-runtime-v2.js";

const base = "a".repeat(40);
const sha = (c: string) => `sha256:${c.repeat(64)}`;

describe("Core v2 Architect and Design Review lifecycle", () => {
  it("accepts revision-bound Architect artifacts and isolated Design Review", () => {
    const initial = createCoreV2Lifecycle({ taskId: "TASK-LIFECYCLE", specRevision: 1, subjectCommit: base, at: time(0) });
    const architect = workflowAcceptArchitectV2(initial, success("ARCHITECT", "ARCHITECT"), deliverable(), time(3));
    expect(architect.state).toBe("DESIGN_REVIEW_REQUIRED");
    expect(architect.artifacts.map((item) => item.kind)).toEqual(["SPEC", "DESIGN", "PLAN"]);
    const reviewed = workflowAcceptDesignReviewV2(architect, success("REVIEW", "DESIGN_REVIEW"), { verdict: "PASSED", findingRefs: [] }, time(4));
    expect(reviewed.state).toBe("IMPLEMENTATION_REQUIRED");
    expect(reviewed.artifacts.at(-1)?.kind).toBe("DESIGN_REVIEW");
    expect(() => workflowAcceptDesignReviewV2(reviewed, success("REVIEW", "DESIGN_REVIEW"), { verdict: "PASSED", findingRefs: [] }, time(5)))
      .toThrow(/not currently required/);
  });

  it("invalidates the complete old Revision after blocking Design findings", () => {
    const initial = createCoreV2Lifecycle({ taskId: "TASK-LIFECYCLE", specRevision: 1, subjectCommit: base, at: time(0) });
    const architect = workflowAcceptArchitectV2(initial, success("ARCHITECT", "ARCHITECT"), deliverable(), time(3));
    const blocked = workflowAcceptDesignReviewV2(architect, success("REVIEW", "DESIGN_REVIEW"), {
      verdict: "FINDINGS", findingRefs: ["finding://design-1"],
    }, time(4));
    const replanned = workflowReplanV2(blocked, { nextSubjectCommit: "b".repeat(40), reason: "requirement ambiguity", at: time(5) });
    expect(replanned).toMatchObject({ state: "ARCHITECT_REQUIRED", specRevision: 2, artifacts: [] });
    expect(replanned.invalidatedRevisions[0]?.artifactRefs).toHaveLength(4);
    expect(() => workflowAcceptArchitectV2(replanned, success("ARCHITECT", "ARCHITECT"), deliverable(), time(6)))
      .toThrow(/does not bind the current Task Revision/);
  });

  it("rejects cross-role and tampered projections", () => {
    const initial = createCoreV2Lifecycle({ taskId: "TASK-LIFECYCLE", specRevision: 1, subjectCommit: base, at: time(0) });
    expect(() => workflowAcceptArchitectV2(initial, success("REVIEW", "DESIGN_REVIEW"), deliverable(), time(3))).toThrow(/does not bind/);
    const tampered = { ...initial, state: "IMPLEMENTATION_REQUIRED" as const };
    expect(() => workflowAcceptArchitectV2(tampered, success("ARCHITECT", "ARCHITECT"), deliverable(), time(3))).toThrow(/differs from its digest/);
  });
});

function success(role: AgentRoleV2, phase: RolePhaseV2) {
  const scheduled = createRoleAttemptV2({
    taskId: "TASK-LIFECYCLE", specRevision: 1, role, phase, generation: 0, runnerKind: "CODEX_EXEC",
    inputDigest: sha("1"), subjectCommit: base, inputArtifactRefs: [], scheduledAt: time(0),
  });
  const running = startRoleAttemptV2(scheduled, time(1));
  return completeRoleAttemptV2(running, createRoleRunEvidenceV2({
    runId: sha(role === "ARCHITECT" ? "2" : "3"), taskId: running.taskId, specRevision: 1, role, phase,
    attemptId: running.attemptId, generation: 0, runnerKind: "CODEX_EXEC", sessionId: `session-${phase}`,
    outcome: "SUCCEEDED", startedAt: time(1), finishedAt: time(2), eventsRef: "a://events", eventsDigest: sha("4"),
    stderrRef: "a://stderr", stderrDigest: sha("5"), outputRef: "a://output", outputDigest: sha("6"),
    manifestRef: "a://manifest", manifestDigest: sha("7"), artifactRefs: [], findingRefs: [],
  }), time(2));
}

function deliverable() { return {
  spec: { type: "SPEC" as const, requirements: [{ id: "REQ-1", statement: "close lifecycle", acceptanceCriteria: ["evidence"] }] },
  design: { type: "DESIGN" as const, decisions: ["workflow owns state"], components: ["core-v2"], risks: ["stale revision"] },
  plan: { type: "PLAN" as const, items: [{ id: "P1", description: "implement", dependsOn: [], status: "PENDING" as const }] },
}; }
function time(n: number) { return `2026-08-23T00:00:0${n}.000Z`; }
