import type { FailureArtifactV2, FailureClosureV2 } from "../domain/core-v2-lifecycle.js";
import { persistCoreV2Artifact } from "./core-v2-artifact-store.js";
import type { CoreV2StoredArtifact } from "./core-v2-artifact-store.js";

export type { CoreV2StoredArtifact } from "./core-v2-artifact-store.js";

export interface CoreV2FailureArchiveReceipt {
  readonly receiptRef: string;
  readonly receiptDigest: string;
  readonly effectId: string;
}

export async function persistCoreV2FailureArtifact(input: {
  readonly artifactRoot: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly failure: FailureArtifactV2;
}): Promise<CoreV2StoredArtifact> {
  const body = {
    schemaVersion: 1,
    kind: "CORE_V2_FAILURE",
    taskId: input.taskId,
    specRevision: input.specRevision,
    originalStage: input.failure.originalStage,
    reason: input.failure.reason,
    failedAt: input.failure.failedAt,
    sourceWorkflowRef: input.failure.sourceWorkflowRef,
    sourceProjectionDigest: input.failure.sourceProjectionDigest,
    attemptIds: input.failure.attemptIds,
    sessionIds: input.failure.sessionIds,
    failureDigest: input.failure.failureDigest,
  };
  return persistCoreV2Artifact(input.artifactRoot, input.taskId, "failure", "failure.json", body);
}

export async function persistCoreV2FailureClosure(input: {
  readonly artifactRoot: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly failure: FailureArtifactV2;
  readonly knowledgeDispositionDigest: string;
  readonly closedAt: string;
}): Promise<CoreV2StoredArtifact> {
  const body = {
    schemaVersion: 1,
    kind: "CORE_V2_FAILURE_CLOSURE",
    taskId: input.taskId,
    specRevision: input.specRevision,
    outcome: "FAILED_TERMINAL",
    failureDigest: input.failure.failureDigest,
    failureArtifactRef: input.failure.artifactRef,
    failureArtifactDigest: input.failure.artifactContentDigest,
    knowledgeDispositionDigest: input.knowledgeDispositionDigest,
    closedAt: input.closedAt,
  };
  return persistCoreV2Artifact(input.artifactRoot, input.taskId, "closure", "failure-closure.json", body);
}

export async function persistCoreV2FailureArchiveReceipt(input: {
  readonly artifactRoot: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly failureClosure: FailureClosureV2;
  readonly effectId: string;
  readonly archivedAt: string;
}): Promise<CoreV2FailureArchiveReceipt> {
  const stored = await persistCoreV2Artifact(input.artifactRoot, input.taskId, "archive", "failure-archive.json", {
    schemaVersion: 1,
    kind: "CORE_V2_FAILURE_ARCHIVE_RECEIPT",
    taskId: input.taskId,
    specRevision: input.specRevision,
    outcome: "FAILED_TERMINAL",
    closureDigest: input.failureClosure.closureDigest,
    closureArtifactRef: input.failureClosure.closureArtifactRef,
    closureArtifactDigest: input.failureClosure.closureContentDigest,
    effectId: input.effectId,
    archivedAt: input.archivedAt,
  });
  return { receiptRef: stored.artifactRef, receiptDigest: stored.contentDigest, effectId: input.effectId };
}
