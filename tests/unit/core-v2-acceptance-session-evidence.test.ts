import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  auditCoreV2AcceptanceSessionEvidence,
  coreV2AcceptanceSessionEvidence,
  coreV2AcceptanceSessionSourceRoots,
} from "../../src/acceptance/core-v2-session-evidence.js";
import type { CoreV2WorkflowProjection } from "../../src/restate/core-v2-services.js";

describe("Core v2 acceptance Session Evidence policy", () => {
  it("uses explicit Provider roots without opening the home directory", () => {
    const environment = {
      CODEX_HOME: "/providers/codex",
      MOYE_CLAUDE_PROJECTS_ROOT: "/providers/claude-projects",
      MOYE_SESSION_SOURCE_ROOTS: ["/providers/imported", "/providers/codex/sessions"].join(path.delimiter),
    } as NodeJS.ProcessEnv;
    expect(coreV2AcceptanceSessionEvidence(environment)).toMatchObject({
      enabled: true,
      capturePolicy: "full",
      codexSessionsRoot: "/providers/codex/sessions",
    });
    expect(coreV2AcceptanceSessionSourceRoots(environment).split(path.delimiter)).toEqual([
      "/providers/imported",
      "/providers/codex/sessions",
      "/providers/claude-projects",
    ]);
  });

  it("requires a usable identity-bound Receipt for every completed Role Run", () => {
    const projection = {
      taskId: "TASK-SESSION-AUDIT",
      roleRuns: [{
        attemptId: "attempt-1",
        runId: "run-1",
        sessionId: "session-1",
        eventsRef: "/managed/events.ndjson",
        stderrRef: "/managed/stderr.log",
      }],
      sessionEvidence: [{
        attemptId: "attempt-1",
        runId: "run-1",
        locator: { stage: "CAPTURE_PENDING" },
        executionEventsRef: "/managed/events.ndjson",
        stderrRef: "/managed/stderr.log",
        receipt: {
          captureState: "COMPLETE",
          receiptDigest: `sha256:${"1".repeat(64)}`,
          manifest: { digest: `sha256:${"2".repeat(64)}` },
        },
        authority: { headReceiptDigest: `sha256:${"1".repeat(64)}` },
      }],
    } as unknown as CoreV2WorkflowProjection;
    expect(auditCoreV2AcceptanceSessionEvidence(projection)).toEqual([expect.objectContaining({
      runId: "run-1",
      sessionId: "session-1",
      captureState: "COMPLETE",
    })]);
    expect(() => auditCoreV2AcceptanceSessionEvidence({ ...projection, sessionEvidence: [] })).toThrow(/only 0 Session Evidence/u);
  });
});
