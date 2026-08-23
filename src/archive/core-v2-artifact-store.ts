import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertTaskId } from "../domain/task.js";

export interface CoreV2StoredArtifact {
  readonly artifactRef: string;
  readonly contentDigest: string;
}

export async function persistCoreV2Artifact(
  artifactRoot: string,
  taskId: string,
  directoryName: string,
  fileName: string,
  body: unknown,
): Promise<CoreV2StoredArtifact> {
  assertTaskId(taskId);
  const directory = path.resolve(artifactRoot, taskId, directoryName);
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
    if (!existing.equals(content)) throw new Error(`Core v2 Artifact conflicts: ${target}`);
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
