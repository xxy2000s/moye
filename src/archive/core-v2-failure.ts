import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FailureArtifactV2, FailureClosureV2 } from "../domain/core-v2-lifecycle.js";
import { assertTaskId } from "../domain/task.js";

export interface CoreV2StoredArtifact {
  readonly artifactRef: string;
  readonly contentDigest: string;
}

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
  return writeArtifact(input.artifactRoot, input.taskId, "failure", "failure.json", body);
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
  return writeArtifact(input.artifactRoot, input.taskId, "closure", "failure-closure.json", body);
}

export async function persistCoreV2FailureArchiveReceipt(input: {
  readonly artifactRoot: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly failureClosure: FailureClosureV2;
  readonly effectId: string;
  readonly archivedAt: string;
}): Promise<CoreV2FailureArchiveReceipt> {
  const stored = await writeArtifact(input.artifactRoot, input.taskId, "archive", "failure-archive.json", {
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

async function writeArtifact(
  artifactRoot: string,
  taskId: string,
  directoryName: string,
  fileName: string,
  body: unknown,
): Promise<CoreV2StoredArtifact> {
  assertTaskId(taskId);
  const directory = path.resolve(artifactRoot, directoryName);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, fileName);
  const content = Buffer.from(`${JSON.stringify(body, null, 2)}\n`, "utf8");
  await writeStableFile(target, content);
  return {
    artifactRef: `core-v2-artifact://${taskId}/${directoryName}/${fileName}`,
    contentDigest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
  };
}

async function writeStableFile(target: string, content: Buffer): Promise<void> {
  try {
    const existing = await readFile(target);
    if (!existing.equals(content)) throw new Error(`Core v2 failure Artifact conflicts: ${target}`);
    return;
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  const pending = `${target}.pending`;
  try {
    await writeFile(pending, content, { flag: "wx" });
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error;
    if (!(await readFile(pending)).equals(content)) throw new Error(`Core v2 pending Artifact conflicts: ${pending}`);
  }
  try {
    await rename(pending, target);
  } catch (error) {
    if (!isNodeError(error, "ENOENT") || !(await readFile(target)).equals(content)) throw error;
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
