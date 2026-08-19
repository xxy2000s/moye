import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { MoyeError } from "../domain/errors.js";
import { assertTaskId } from "../domain/task.js";
import type { TaskProjection } from "../domain/task.js";

export interface ResolveExistingTaskArtifactInput {
  readonly task: TaskProjection;
  readonly activeTasksRoot: string;
  readonly ref: string;
}

export function taskArtifactRef(taskId: string, artifact: string): string {
  assertTaskId(taskId);
  assertArtifactName(artifact);
  return `task-artifact://${taskId}/${artifact}`;
}

export function resolveTaskArtifactPath(
  taskId: string,
  ref: string,
  taskPackagePath: string,
): string {
  const artifact = parseTaskArtifactRef(taskId, ref);
  const root = path.resolve(taskPackagePath);
  const resolved = path.resolve(root, artifact);
  if (path.dirname(resolved) !== root) {
    throw invalidRef(ref);
  }
  return resolved;
}

export async function resolveExistingTaskArtifact(
  input: ResolveExistingTaskArtifactInput,
): Promise<string> {
  const activePackage = path.resolve(input.activeTasksRoot, input.task.taskId);
  const candidates = [
    {
      packagePath: activePackage,
      allowedRoot: path.resolve(input.activeTasksRoot),
      artifactPath: resolveTaskArtifactPath(input.task.taskId, input.ref, activePackage),
    },
    ...(input.task.archivePath === undefined
      ? []
      : [{
        packagePath: path.resolve(input.task.archivePath),
        allowedRoot: path.resolve(input.activeTasksRoot, "archive"),
        artifactPath: resolveTaskArtifactPath(input.task.taskId, input.ref, input.task.archivePath),
      }]),
  ];
  for (const candidate of candidates) {
    try {
      const [realAllowedRoot, realPackageRoot, realCandidate] = await Promise.all([
        realpath(candidate.allowedRoot),
        realpath(candidate.packagePath),
        realpath(candidate.artifactPath),
      ]);
      if (path.dirname(realPackageRoot) !== realAllowedRoot ||
          path.dirname(realCandidate) !== realPackageRoot ||
          !(await stat(realCandidate)).isFile()) {
        throw new MoyeError({
          code: "TASK_ARTIFACT_PATH_ESCAPE",
          category: "VALIDATION",
          message: `Task artifact escapes its package: ${input.ref}`,
        });
      }
      return realCandidate;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  throw new MoyeError({
    code: "TASK_ARTIFACT_NOT_FOUND",
    category: "NOT_FOUND",
    message: `Task artifact does not exist in Active or Archive package: ${input.ref}`,
  });
}

function parseTaskArtifactRef(taskId: string, ref: string): string {
  assertTaskId(taskId);
  const prefix = `task-artifact://${taskId}/`;
  if (!ref.startsWith(prefix)) throw invalidRef(ref);
  const artifact = ref.slice(prefix.length);
  assertArtifactName(artifact);
  return artifact;
}

function assertArtifactName(artifact: string): void {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(artifact)) {
    throw invalidRef(artifact);
  }
}

function invalidRef(ref: string): MoyeError {
  return new MoyeError({
    code: "TASK_ARTIFACT_REF_INVALID",
    category: "VALIDATION",
    message: `Invalid task artifact ref: ${ref}`,
  });
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
