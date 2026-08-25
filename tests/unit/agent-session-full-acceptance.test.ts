import { describe, expect, it } from "vitest";

import { validateSessionCaptureRecoverySummary } from "../../scripts/agent_session_full_acceptance.js";

const phases = ["ARCHITECT", "DESIGN_REVIEW", "IMPLEMENTATION", "DOCUMENTATION", "TEST_PLAN", "TEST_ASSESSMENT", "FINAL_REVIEW"];

function fixture() {
  const roleRuns = phases.map((phase, index) => ({ phase, attemptId: `task.${phase}.r1.g0`, sessionId: `session-${index}`, runId: digest(index + 1), manifestDigest: digest(index + 11) }));
  return {
    schemaVersion: 1,
    scenario: "SESSION_CAPTURE_RECOVERY",
    taskId: "TASK-RECOVERY",
    workflowRef: "restate://CoreV2Workflow/TASK-RECOVERY",
    state: "CLOSED",
    outcome: "SUCCEEDED",
    archiveStatus: "ARCHIVED",
    roleRuns,
    sessionEvidence: roleRuns.map((role, index) => ({ attemptId: role.attemptId, runId: role.runId, promptEnvelopeDigest: digest(index + 21), receiptDigest: digest(index + 31), manifestDigest: digest(index + 41), captureState: "COMPLETE" })),
    projectionDigest: digest(51),
    closureDigest: digest(52),
    archiveReceiptDigest: digest(53),
  };
}

function digest(index: number): string {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}

describe("Agent Session full acceptance manifest", () => {
  it("accepts an explicitly bound complete recovery summary", () => {
    expect(validateSessionCaptureRecoverySummary(fixture()).taskId).toBe("TASK-RECOVERY");
  });

  it("rejects incomplete or downgraded evidence", () => {
    const value = fixture();
    value.sessionEvidence[0]!.captureState = "PARTIAL";
    expect(() => validateSessionCaptureRecoverySummary(value)).toThrow(/COMPLETE ARCHITECT Session evidence/u);
  });
});
