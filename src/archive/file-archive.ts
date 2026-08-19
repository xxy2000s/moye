import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { ArchiveInput, ArchiveMoveResult } from "../domain/archive.js";
import { archiveOperationId } from "../domain/archive.js";
import { MoyeError } from "../domain/errors.js";
import { assertTaskId } from "../domain/task.js";

export interface ArchivePaths {
  readonly sourcePath: string;
  readonly targetPath: string;
}

export interface ArchiveManifest {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly projectId: string;
  readonly specRevision: number;
  readonly operationId: string;
  readonly closedAt: string;
}

export function resolveArchivePaths(input: ArchiveInput): ArchivePaths {
  assertTaskId(input.taskId);
  const activeRoot = path.resolve(input.activeTasksRoot);
  const archiveRoot = path.resolve(input.archiveRoot);
  const date = input.archivedAt.slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new MoyeError({
      code: "INVALID_ARCHIVE_DATE",
      category: "VALIDATION",
      message: `archivedAt must start with an ISO date: ${input.archivedAt}`,
    });
  }

  const sourcePath = path.resolve(activeRoot, input.taskId);
  const targetPath = path.resolve(archiveRoot, `${date}-${input.taskId}`);
  assertDirectChild(activeRoot, sourcePath, "source");
  assertDirectChild(archiveRoot, targetPath, "target");
  return { sourcePath, targetPath };
}

export async function freezeArchiveManifest(
  input: ArchiveInput,
): Promise<{ readonly manifestPath: string; readonly digest: string }> {
  const { sourcePath, targetPath } = resolveArchivePaths(input);
  const basePath = (await exists(sourcePath)) ? sourcePath : targetPath;
  if (!(await exists(basePath))) {
    throw archiveMissingError(sourcePath, targetPath);
  }

  const manifest: ArchiveManifest = {
    schemaVersion: 1,
    taskId: input.taskId,
    projectId: input.projectId,
    specRevision: input.specRevision,
    operationId: archiveOperationId(input.taskId, input.specRevision),
    closedAt: input.archivedAt,
  };
  const manifestPath = path.join(basePath, "archive-manifest.json");
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

  if (await exists(manifestPath)) {
    const current = await readFile(manifestPath, "utf8");
    if (current !== serialized) {
      throw new MoyeError({
        code: "ARCHIVE_MANIFEST_CONFLICT",
        category: "CONFLICT",
        message: `Archive manifest conflicts with ${manifestPath}`,
        details: { manifestPath },
      });
    }
    const stalePendingPath = `${manifestPath}.pending`;
    if (await exists(stalePendingPath)) {
      const pending = await readFile(stalePendingPath, "utf8");
      if (pending !== serialized) {
        throw new MoyeError({
          code: "ARCHIVE_PENDING_MANIFEST_CONFLICT",
          category: "CONFLICT",
          message: `Pending archive manifest conflicts with ${stalePendingPath}`,
          details: { stalePendingPath },
        });
      }
      await rm(stalePendingPath);
    }
  } else {
    const temporaryPath = `${manifestPath}.pending`;
    try {
      await writeFile(temporaryPath, serialized, { flag: "wx" });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const pending = await readFile(temporaryPath, "utf8");
      if (pending !== serialized) {
        throw new MoyeError({
          code: "ARCHIVE_PENDING_MANIFEST_CONFLICT",
          category: "CONFLICT",
          message: `Pending archive manifest conflicts with ${temporaryPath}`,
          details: { temporaryPath },
        });
      }
    }
    try {
      await rename(temporaryPath, manifestPath);
    } catch (error) {
      if (!(isNotFound(error) && (await exists(manifestPath)))) throw error;
    }
  }

  return { manifestPath, digest: await digestDirectory(basePath) };
}

export async function archiveTaskPackage(
  input: ArchiveInput,
  expectedDigest: string,
): Promise<ArchiveMoveResult> {
  const { sourcePath, targetPath } = resolveArchivePaths(input);
  await mkdir(path.dirname(targetPath), { recursive: true });

  const sourceExists = await exists(sourcePath);
  const targetExists = await exists(targetPath);

  if (!sourceExists && !targetExists) {
    throw archiveMissingError(sourcePath, targetPath);
  }

  if (sourceExists && targetExists) {
    const [sourceDigest, targetDigest] = await Promise.all([
      digestDirectory(sourcePath),
      digestDirectory(targetPath),
    ]);
    if (sourceDigest !== targetDigest || targetDigest !== expectedDigest) {
      throw new MoyeError({
        code: "ARCHIVE_DUAL_PATH_CONFLICT",
        category: "UNKNOWN_SIDE_EFFECT",
        message: "Source and target both exist with different content",
        details: { sourcePath, targetPath, sourceDigest, targetDigest },
      });
    }

    await rm(sourcePath, { recursive: true });
    return {
      outcome: "DUPLICATE_RECONCILED",
      targetPath,
      digest: targetDigest,
    };
  }

  if (!sourceExists && targetExists) {
    const targetDigest = await digestDirectory(targetPath);
    if (targetDigest !== expectedDigest) {
      throw new MoyeError({
        code: "ARCHIVE_TARGET_DIGEST_MISMATCH",
        category: "UNKNOWN_SIDE_EFFECT",
        message: "Archive target exists but does not match the frozen digest",
        details: { targetPath, expectedDigest, targetDigest },
      });
    }
    return {
      outcome: "ALREADY_MOVED",
      targetPath,
      digest: targetDigest,
    };
  }

  const sourceDigest = await digestDirectory(sourcePath);
  if (sourceDigest !== expectedDigest) {
    throw new MoyeError({
      code: "ARCHIVE_SOURCE_CHANGED",
      category: "CONFLICT",
      message: "Task package changed after the archive manifest was frozen",
      details: { sourcePath, expectedDigest, sourceDigest },
    });
  }

  try {
    await rename(sourcePath, targetPath);
  } catch (error) {
    throw new MoyeError({
      code: "ARCHIVE_RENAME_FAILED",
      category: "TRANSIENT_IO",
      message: `Failed to move ${sourcePath} to ${targetPath}`,
      retryable: true,
      details: { sourcePath, targetPath },
      cause: error,
    });
  }

  await triggerExitAfterMoveOnce(input);
  const targetDigest = await digestDirectory(targetPath);
  if (targetDigest !== expectedDigest) {
    throw new MoyeError({
      code: "ARCHIVE_POST_MOVE_DIGEST_MISMATCH",
      category: "TERMINAL",
      message: "Archive target changed during move verification",
      details: { targetPath, expectedDigest, targetDigest },
    });
  }

  return {
    outcome: "MOVED",
    targetPath,
    digest: targetDigest,
  };
}

export async function digestDirectory(directory: string): Promise<string> {
  const root = path.resolve(directory);
  const entries = await listFiles(root);
  const digest = createHash("sha256");

  for (const relativePath of entries) {
    const absolutePath = path.join(root, relativePath);
    const content = await readFile(absolutePath);
    digest.update(relativePath);
    digest.update("\0");
    digest.update(content);
    digest.update("\0");
  }

  return `sha256:${digest.digest("hex")}`;
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const current = path.join(root, relative);
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, child)));
    } else if (entry.isFile()) {
      files.push(child.split(path.sep).join("/"));
    } else {
      throw new MoyeError({
        code: "ARCHIVE_UNSUPPORTED_ENTRY",
        category: "VALIDATION",
        message: `Archive package contains an unsupported entry: ${child}`,
      });
    }
  }

  return files;
}

async function triggerExitAfterMoveOnce(input: ArchiveInput): Promise<void> {
  if (!input.fault?.exitAfterMoveOnce) {
    return;
  }
  const markerPath = input.fault.markerPath;
  if (!markerPath) {
    throw new MoyeError({
      code: "FAULT_MARKER_REQUIRED",
      category: "VALIDATION",
      message: "fault.markerPath is required for exitAfterMoveOnce",
    });
  }

  await mkdir(path.dirname(markerPath), { recursive: true });
  try {
    const marker = await open(markerPath, "wx");
    await marker.writeFile(`${input.taskId}\n`);
    await marker.close();
  } catch (error) {
    if (isAlreadyExists(error)) {
      return;
    }
    throw error;
  }

  process.kill(process.pid, "SIGKILL");
}

function assertDirectChild(root: string, candidate: string, label: string): void {
  if (path.dirname(candidate) !== root) {
    throw new MoyeError({
      code: "ARCHIVE_PATH_ESCAPE",
      category: "VALIDATION",
      message: `Archive ${label} path escapes its configured root`,
      details: { root, candidate },
    });
  }
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function archiveMissingError(sourcePath: string, targetPath: string): MoyeError {
  return new MoyeError({
    code: "ARCHIVE_PACKAGE_MISSING",
    category: "NOT_FOUND",
    message: "Neither the active task package nor the archive target exists",
    details: { sourcePath, targetPath },
  });
}

function isNotFound(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
