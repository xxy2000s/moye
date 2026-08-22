import { describe, expect, it } from "vitest";

import {
  createNextRoleAttemptV2,
  createRoleAttemptV2,
  createRoleRunEvidenceV2,
  completeRoleAttemptV2,
  failRoleAttemptV2,
  markRoleAttemptUnknownV2,
  parseRoleAttemptV2,
  reconcileRoleAttemptV2,
  rolePermission,
  roleReconcileTokenV2,
  startRoleAttemptV2,
} from "../../src/domain/role-runtime-v2.js";
import type { AgentRoleV2, RolePhaseV2, RoleRunEvidenceV2 } from "../../src/domain/role-runtime-v2.js";

const commit = "a".repeat(40);
const sha = (letter: string) => `sha256:${letter.repeat(64)}`;

describe("Core v2 Role Attempt protocol", () => {
  it("enforces the six role boundaries and the two isolated Review/Test phases", () => {
    const cases: Array<[AgentRoleV2, RolePhaseV2, "READ_ONLY" | "WORKSPACE_WRITE"]> = [
      ["ARCHITECT", "ARCHITECT", "READ_ONLY"],
      ["IMPLEMENTATION", "IMPLEMENTATION", "WORKSPACE_WRITE"],
      ["DOCUMENTATION", "DOCUMENTATION", "WORKSPACE_WRITE"],
      ["TEST_VERIFICATION", "TEST_PLAN", "READ_ONLY"],
      ["TEST_VERIFICATION", "TEST_ASSESSMENT", "READ_ONLY"],
      ["REVIEW", "DESIGN_REVIEW", "READ_ONLY"],
      ["REVIEW", "FINAL_REVIEW", "READ_ONLY"],
      ["OBSERVER_KNOWLEDGE", "OBSERVER_KNOWLEDGE", "READ_ONLY"],
    ];
    for (const [role, phase, permission] of cases) {
      expect(scheduled(role, phase).permission).toBe(permission);
      expect(rolePermission(role)).toBe(permission);
    }
    expect(() => scheduled("ARCHITECT", "FINAL_REVIEW")).toThrow(/cannot execute/);
    expect(() => createRoleAttemptV2({
      ...base("ARCHITECT", "ARCHITECT"), runnerKind: "FAKE" as "CODEX_EXEC",
    })).toThrow(/runnerKind must be one of CODEX_EXEC, CLAUDE_PRINT/);
  });

  it("binds a real Run Evidence to one Attempt and seals terminal success", () => {
    const running = startRoleAttemptV2(scheduled("ARCHITECT", "ARCHITECT"), "2026-08-23T00:00:01.000Z");
    const evidence = evidenceFor(running);
    const completed = completeRoleAttemptV2(running, evidence, "2026-08-23T00:00:03.000Z");
    expect(completed.state).toBe("SUCCEEDED");
    expect(completed.run?.sessionId).toBe("session-real-1");
    expect(completed.events.map((event) => event.type)).toEqual([
      "RoleAttemptScheduled", "RoleAttemptStarted", "RoleAttemptSucceeded",
    ]);
    expect(() => failRoleAttemptV2(completed, "late overwrite", "2026-08-23T00:00:04.000Z"))
      .toThrow(/Only RUNNING Attempt/);
    const wrong = createRoleRunEvidenceV2({ ...withoutEvidenceDigest(evidence), attemptId: "another-attempt" });
    expect(() => completeRoleAttemptV2(running, wrong, "2026-08-23T00:00:03.000Z"))
      .toThrow(/does not bind/);
  });

  it("forbids blind retry of UNKNOWN and authorizes the next Generation only after NOT_APPLIED", () => {
    const running = startRoleAttemptV2(scheduled("IMPLEMENTATION", "IMPLEMENTATION"), "2026-08-23T00:00:01.000Z");
    const runId = sha("1");
    const operationId = `role-operation:${"2".repeat(64)}`;
    const waiting = markRoleAttemptUnknownV2(running, { runId, operationId, reason: "Intent exists without Manifest" }, "2026-08-23T00:00:02.000Z");
    expect(waiting.state).toBe("WAITING_RECONCILE");
    expect(waiting.unknown?.reconcileToken).toBe(roleReconcileTokenV2(running, runId, operationId));
    expect(() => createNextRoleAttemptV2(nextInput(waiting))).toThrow(/requires a FAILED previous Attempt/);
    expect(() => reconcileRoleAttemptV2(waiting, {
      token: sha("f"), action: "NOT_APPLIED", externalEvidence: "process absent",
    }, "2026-08-23T00:00:03.000Z")).toThrow(/token does not match/);

    const failed = reconcileRoleAttemptV2(waiting, {
      token: waiting.unknown!.reconcileToken,
      action: "NOT_APPLIED",
      externalEvidence: "trusted process inventory proves no execution",
    }, "2026-08-23T00:00:03.000Z");
    const next = createNextRoleAttemptV2(nextInput(failed));
    expect(failed).toMatchObject({ state: "FAILED", retryAuthorized: true });
    expect(next).toMatchObject({ state: "SCHEDULED", generation: 1 });
  });

  it("can reconcile UNKNOWN as CONFIRMED only with evidence for the exact Run", () => {
    const running = startRoleAttemptV2(scheduled("REVIEW", "FINAL_REVIEW"), "2026-08-23T00:00:01.000Z");
    const runId = sha("3");
    const waiting = markRoleAttemptUnknownV2(running, {
      runId, operationId: `role-operation:${"4".repeat(64)}`, reason: "worker died after execution",
    }, "2026-08-23T00:00:02.000Z");
    expect(() => reconcileRoleAttemptV2(waiting, {
      token: waiting.unknown!.reconcileToken,
      action: "CONFIRMED",
      externalEvidence: "manifest found",
      runEvidence: evidenceFor(running),
    }, "2026-08-23T00:00:04.000Z")).toThrow(/does not bind/);

    const confirmed = reconcileRoleAttemptV2(waiting, {
      token: waiting.unknown!.reconcileToken,
      action: "CONFIRMED",
      externalEvidence: "manifest digest verified",
      runEvidence: evidenceFor(running, runId),
    }, "2026-08-23T00:00:04.000Z");
    expect(confirmed.state).toBe("SUCCEEDED");
    expect(confirmed.events.map((event) => event.type)).toContain("RoleRunReconciledConfirmed");
  });

  it("detects serialized Attempt tampering before any transition", () => {
    const value = scheduled("DOCUMENTATION", "DOCUMENTATION");
    const tampered = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    tampered["permission"] = "READ_ONLY";
    expect(() => parseRoleAttemptV2(tampered, value.attemptDigest)).toThrow(/differs from its digest/);
  });
});

function base(role: AgentRoleV2, phase: RolePhaseV2) {
  return {
    taskId: "TASK-0032",
    specRevision: 1,
    role,
    phase,
    generation: 0,
    runnerKind: "CODEX_EXEC" as const,
    inputDigest: sha("0"),
    subjectCommit: commit,
    inputArtifactRefs: ["artifact://spec"],
    scheduledAt: "2026-08-23T00:00:00.000Z",
  };
}

function scheduled(role: AgentRoleV2, phase: RolePhaseV2) {
  return createRoleAttemptV2(base(role, phase));
}

function evidenceFor(attempt: ReturnType<typeof startRoleAttemptV2>, runId = sha("9")): RoleRunEvidenceV2 {
  return createRoleRunEvidenceV2({
    runId,
    taskId: attempt.taskId,
    specRevision: attempt.specRevision,
    role: attempt.role,
    phase: attempt.phase,
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    runnerKind: attempt.runnerKind,
    sessionId: "session-real-1",
    outcome: "SUCCEEDED",
    startedAt: "2026-08-23T00:00:01.000Z",
    finishedAt: "2026-08-23T00:00:02.000Z",
    eventsRef: "artifact://events",
    eventsDigest: sha("a"),
    stderrRef: "artifact://stderr",
    stderrDigest: sha("b"),
    outputRef: "artifact://output",
    outputDigest: sha("c"),
    manifestRef: "artifact://manifest",
    manifestDigest: sha("d"),
    artifactRefs: [],
    findingRefs: [],
  });
}

function withoutEvidenceDigest(evidence: RoleRunEvidenceV2): Omit<RoleRunEvidenceV2, "schemaVersion" | "evidenceDigest"> {
  const { schemaVersion: _schema, evidenceDigest: _digest, ...core } = evidence;
  return core;
}

function nextInput(previous: ReturnType<typeof markRoleAttemptUnknownV2>) {
  return {
    previous,
    inputDigest: sha("e"),
    subjectCommit: commit,
    inputArtifactRefs: ["artifact://spec"],
    scheduledAt: "2026-08-23T00:00:04.000Z",
  };
}
