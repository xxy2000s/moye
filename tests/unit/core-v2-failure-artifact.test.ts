import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { persistCoreV2FailureArtifact } from "../../src/archive/core-v2-failure.js";
import { persistCoreV2SuccessArchiveReceipt, persistCoreV2SuccessClosure } from "../../src/archive/core-v2-success.js";
import { createCoreV2Lifecycle } from "../../src/domain/core-v2-lifecycle.js";
import type { FailureArtifactV2, SuccessClosureV2 } from "../../src/domain/core-v2-lifecycle.js";

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

  it("persists content-bound success Closure and Archive Receipt under the Task namespace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-core-v2-success-"));
    roots.push(root);
    const lifecycle = createCoreV2Lifecycle({ taskId: "TASK-SUCCESS-A", specRevision: 1, subjectCommit: "a".repeat(40), at: "2026-08-23T00:00:00.000Z" });
    const closure = await persistCoreV2SuccessClosure({
      artifactRoot: root,
      taskId: "TASK-SUCCESS-A",
      specRevision: 1,
      lifecycle: { ...lifecycle, candidateCommit: "b".repeat(40), verificationGateDigest: digest("1"), knowledgeDispositionDigest: digest("2") },
      merge: { effectId: `local-merge-effect:${digest("3")}`, outcome: "APPLIED", targetRef: "refs/heads/master", mergeCommit: "c".repeat(40), reconciledAfterUnknown: false },
      sourceWorkflowRef: "restate://CoreV2Workflow/TASK-SUCCESS-A",
      attemptIds: ["attempt-1"],
      sessionIds: ["session-1"],
      closedAt: "2026-08-23T00:01:00.000Z",
    });
    const receipt = await persistCoreV2SuccessArchiveReceipt({
      artifactRoot: root,
      taskId: "TASK-SUCCESS-A",
      specRevision: 1,
      successClosure: {
        outcome: "SUCCEEDED", candidateCommit: "b".repeat(40), mergeCommit: "c".repeat(40), mergeReceiptDigest: digest("4"),
        verificationGateDigest: digest("1"), knowledgeDispositionDigest: digest("2"), implementationGeneration: 0,
        sourceWorkflowRef: "restate://CoreV2Workflow/TASK-SUCCESS-A", closureArtifactRef: closure.artifactRef,
        closureContentDigest: closure.contentDigest, closedAt: "2026-08-23T00:01:00.000Z", closureDigest: digest("5"),
      } satisfies SuccessClosureV2,
      effectId: digest("6"),
      archivedAt: "2026-08-23T00:02:00.000Z",
    });
    expect(closure.artifactRef).toBe("core-v2-artifact://TASK-SUCCESS-A/closure/success-closure.json");
    expect(receipt.receiptRef).toBe("core-v2-artifact://TASK-SUCCESS-A/archive/success-archive.json");
    expect(JSON.parse(await readFile(path.join(root, "TASK-SUCCESS-A", "closure", "success-closure.json"), "utf8"))).toMatchObject({
      outcome: "SUCCEEDED", attemptIds: ["attempt-1"], sessionIds: ["session-1"], merge: { mergeCommit: "c".repeat(40) },
    });
  });
});

const digest = (value: string) => `sha256:${value.repeat(64)}`;

function failure(reason: string): FailureArtifactV2 {
  return {
    originalStage: "FINAL_REVIEW_REQUIRED", reason, failedAt: "2026-08-23T00:00:00.000Z",
    sourceWorkflowRef: "restate://CoreV2Workflow/TASK", sourceProjectionDigest: `sha256:${"1".repeat(64)}`,
    attemptIds: [], sessionIds: [], artifactRef: null, artifactContentDigest: null, failureDigest: `sha256:${(reason === "A" ? "a" : "b").repeat(64)}`,
  };
}
