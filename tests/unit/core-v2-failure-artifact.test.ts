import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { persistCoreV2FailureArtifact } from "../../src/archive/core-v2-failure.js";
import type { FailureArtifactV2 } from "../../src/domain/core-v2-lifecycle.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Core v2 failure Artifact storage", () => {
  it("isolates append-only failure evidence by Task under a shared Artifact Root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-core-v2-failure-"));
    roots.push(root);
    const first = await persistCoreV2FailureArtifact({ artifactRoot: root, taskId: "TASK-FAILURE-A", specRevision: 1, failure: failure("A") });
    const second = await persistCoreV2FailureArtifact({ artifactRoot: root, taskId: "TASK-FAILURE-B", specRevision: 1, failure: failure("B") });

    expect(first.artifactRef).toBe("core-v2-artifact://TASK-FAILURE-A/failure/failure.json");
    expect(second.artifactRef).toBe("core-v2-artifact://TASK-FAILURE-B/failure/failure.json");
    expect(JSON.parse(await readFile(path.join(root, "TASK-FAILURE-A", "failure", "failure.json"), "utf8")).reason).toBe("A");
    expect(JSON.parse(await readFile(path.join(root, "TASK-FAILURE-B", "failure", "failure.json"), "utf8")).reason).toBe("B");
  });
});

function failure(reason: string): FailureArtifactV2 {
  return {
    originalStage: "FINAL_REVIEW_REQUIRED", reason, failedAt: "2026-08-23T00:00:00.000Z",
    sourceWorkflowRef: "restate://CoreV2Workflow/TASK", sourceProjectionDigest: `sha256:${"1".repeat(64)}`,
    attemptIds: [], sessionIds: [], artifactRef: null, artifactContentDigest: null, failureDigest: `sha256:${(reason === "A" ? "a" : "b").repeat(64)}`,
  };
}
