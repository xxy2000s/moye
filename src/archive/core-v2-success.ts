import { persistCoreV2Artifact } from "./core-v2-artifact-store.js";
import type { CoreV2StoredArtifact } from "./core-v2-artifact-store.js";
import type { CoreV2LifecycleProjection, SuccessClosureV2 } from "../domain/core-v2-lifecycle.js";

export interface CoreV2SuccessArchiveReceipt {
  readonly receiptRef: string;
  readonly receiptDigest: string;
  readonly effectId: string;
}

export async function persistCoreV2SuccessClosure(input: {
  readonly artifactRoot: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly lifecycle: CoreV2LifecycleProjection;
  readonly merge: {
    readonly effectId: string;
    readonly outcome: "APPLIED" | "ALREADY_APPLIED";
    readonly targetRef: string;
    readonly mergeCommit: string;
    readonly reconciledAfterUnknown: boolean;
  };
  readonly sourceWorkflowRef: string;
  readonly attemptIds: readonly string[];
  readonly sessionIds: readonly string[];
  readonly closedAt: string;
}): Promise<CoreV2StoredArtifact> {
  return persistCoreV2Artifact(input.artifactRoot, input.taskId, "closure", "success-closure.json", {
    schemaVersion: 1,
    kind: "CORE_V2_SUCCESS_CLOSURE",
    taskId: input.taskId,
    specRevision: input.specRevision,
    implementationGeneration: input.lifecycle.implementationGeneration,
    outcome: "SUCCEEDED",
    candidateCommit: input.lifecycle.candidateCommit,
    merge: input.merge,
    verificationGateDigest: input.lifecycle.verificationGateDigest,
    knowledgeDispositionDigest: input.lifecycle.knowledgeDispositionDigest,
    sourceWorkflowRef: input.sourceWorkflowRef,
    attemptIds: input.attemptIds,
    sessionIds: input.sessionIds,
    closedAt: input.closedAt,
  });
}

export async function persistCoreV2SuccessArchiveReceipt(input: {
  readonly artifactRoot: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly successClosure: SuccessClosureV2;
  readonly effectId: string;
  readonly archivedAt: string;
}): Promise<CoreV2SuccessArchiveReceipt> {
  const stored = await persistCoreV2Artifact(input.artifactRoot, input.taskId, "archive", "success-archive.json", {
    schemaVersion: 1,
    kind: "CORE_V2_SUCCESS_ARCHIVE_RECEIPT",
    taskId: input.taskId,
    specRevision: input.specRevision,
    outcome: "SUCCEEDED",
    closureDigest: input.successClosure.closureDigest,
    closureArtifactRef: input.successClosure.closureArtifactRef,
    closureArtifactDigest: input.successClosure.closureContentDigest,
    effectId: input.effectId,
    archivedAt: input.archivedAt,
  });
  return { receiptRef: stored.artifactRef, receiptDigest: stored.contentDigest, effectId: input.effectId };
}
