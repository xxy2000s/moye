import { describe, expect, it } from "vitest";
import { createLifecycleArtifactGate } from "../../src/domain/lifecycle-artifact.js";

describe("Core v2 Verification Gate", () => {
  it("rejects a missing lifecycle Artifact rather than trusting a PASS string", () => {
    expect(() => createLifecycleArtifactGate({ taskId: "TASK-E2E-GATE", specRevision: 1,
      requirements: [{ kind: "FINAL_REVIEW", artifactDigest: `sha256:${"1".repeat(64)}`, subjectCommit: "a".repeat(40) }], artifacts: [] }))
      .toThrow(/exactly one Artifact/);
  });
});
