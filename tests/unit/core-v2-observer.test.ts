import { describe, expect, it } from "vitest";
import { createCoreV2Lifecycle, workflowRecordKnowledgeDispositionV2 } from "../../src/domain/core-v2-lifecycle.js";
import { coreV2ObserverAttemptInScope, createCoreV2ObserverReport } from "../../src/domain/core-v2-observer.js";

describe("Core v2 deterministic Observer and Knowledge sidecar", () => {
  it("replays identical facts without changing Task state", () => {
    const projection = createCoreV2Lifecycle({ taskId: "TASK-OBSERVER-V2", specRevision: 1, subjectCommit: "a".repeat(40), at: "2026-08-23T00:00:00Z" });
    const first = createCoreV2ObserverReport(projection, []); const replay = createCoreV2ObserverReport(JSON.parse(JSON.stringify(projection)), []);
    expect(replay).toEqual(first); expect(first.state).toBe("ARCHITECT_REQUIRED");
  });

  it("records none or deferred without requiring a Knowledge Agent", () => {
    const projection = createCoreV2Lifecycle({ taskId: "TASK-OBSERVER-V2", specRevision: 1, subjectCommit: "a".repeat(40), at: "2026-08-23T00:00:00Z" });
    const disposed = workflowRecordKnowledgeDispositionV2(projection, { type: "KNOWLEDGE_DISPOSITION", disposition: "deferred", candidateRefs: ["knowledge-candidate://observer-unavailable"], rationale: "observer agent unavailable" }, "2026-08-23T00:00:01Z");
    expect(disposed.state).toBe(projection.state); expect(disposed.knowledgeDispositionDigest).toMatch(/^sha256:/);
    expect(() => workflowRecordKnowledgeDispositionV2(disposed, { type: "KNOWLEDGE_DISPOSITION", disposition: "none", candidateRefs: [], rationale: "duplicate" }, "2026-08-23T00:00:02Z")).toThrow(/append-only/);
  });

  it("observes Attempts from the active and explicitly invalidated Revisions", () => {
    expect(coreV2ObserverAttemptInScope("TASK-OBSERVER-V2", [2, 1], "TASK-OBSERVER-V2", 1)).toBe(true);
    expect(coreV2ObserverAttemptInScope("TASK-OBSERVER-V2", [2, 1], "TASK-OBSERVER-V2", 2)).toBe(true);
    expect(coreV2ObserverAttemptInScope("TASK-OBSERVER-V2", [2, 1], "TASK-OBSERVER-V2", 3)).toBe(false);
    expect(coreV2ObserverAttemptInScope("TASK-OBSERVER-V2", [2, 1], "TASK-OTHER", 1)).toBe(false);
  });
});
