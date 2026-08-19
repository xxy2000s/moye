import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  archiveTaskPackage,
  digestDirectory,
  freezeArchiveManifest,
  resolveArchivePaths,
} from "../../src/archive/file-archive.js";
import type { ArchiveInput } from "../../src/domain/archive.js";

async function fixture(): Promise<{
  readonly root: string;
  readonly input: ArchiveInput;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-archive-test-"));
  const activeTasksRoot = path.join(root, "tasks");
  const archiveRoot = path.join(activeTasksRoot, "archive");
  const taskPath = path.join(activeTasksRoot, "TASK-TEST-1");
  await mkdir(taskPath, { recursive: true });
  await writeFile(path.join(taskPath, "spec.md"), "# test\n");
  return {
    root,
    input: {
      taskId: "TASK-TEST-1",
      projectId: "moye",
      specRevision: 1,
      activeTasksRoot,
      archiveRoot,
      archivedAt: "2026-08-19T00:00:00.000Z",
    },
  };
}

describe("file archive", () => {
  it("freezes a stable manifest and moves exactly once", async () => {
    const { input } = await fixture();
    const frozen = await freezeArchiveManifest(input);
    const first = await archiveTaskPackage(input, frozen.digest);
    const second = await archiveTaskPackage(input, frozen.digest);

    expect(first.outcome).toBe("MOVED");
    expect(second.outcome).toBe("ALREADY_MOVED");
    expect(second.targetPath).toBe(first.targetPath);
    expect(await digestDirectory(first.targetPath)).toBe(frozen.digest);
    expect(
      JSON.parse(
        await readFile(
          path.join(first.targetPath, "archive-manifest.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ taskId: "TASK-TEST-1", specRevision: 1 });
  });

  it("reconciles identical source and target copies", async () => {
    const { input } = await fixture();
    const frozen = await freezeArchiveManifest(input);
    const { sourcePath, targetPath } = resolveArchivePaths(input);
    await mkdir(targetPath, { recursive: true });
    for (const file of ["spec.md", "archive-manifest.json"]) {
      await writeFile(
        path.join(targetPath, file),
        await readFile(path.join(sourcePath, file)),
      );
    }

    const result = await archiveTaskPackage(input, frozen.digest);
    expect(result.outcome).toBe("DUPLICATE_RECONCILED");
  });

  it("recovers a manifest write interrupted before atomic rename", async () => {
    const { input } = await fixture();
    const { sourcePath } = resolveArchivePaths(input);
    const pendingPath = path.join(sourcePath, "archive-manifest.json.pending");
    await writeFile(
      pendingPath,
      `${JSON.stringify({
        schemaVersion: 1,
        taskId: input.taskId,
        projectId: input.projectId,
        specRevision: input.specRevision,
        operationId: `archive/${input.taskId}/revision-${input.specRevision}`,
        closedAt: input.archivedAt,
      }, null, 2)}\n`,
    );

    const frozen = await freezeArchiveManifest(input);
    expect(await readFile(frozen.manifestPath, "utf8")).toContain(input.taskId);
    expect(await digestDirectory(sourcePath)).toBe(frozen.digest);
  });

  it("removes an identical stale pending manifest before hashing", async () => {
    const { input } = await fixture();
    const frozen = await freezeArchiveManifest(input);
    const pendingPath = `${frozen.manifestPath}.pending`;
    await writeFile(pendingPath, await readFile(frozen.manifestPath));

    const reconciled = await freezeArchiveManifest(input);
    await expect(readFile(pendingPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(reconciled.digest).toBe(frozen.digest);
  });

  it("stops when both paths exist with different content", async () => {
    const { input } = await fixture();
    const frozen = await freezeArchiveManifest(input);
    const { targetPath } = resolveArchivePaths(input);
    await mkdir(targetPath, { recursive: true });
    await writeFile(path.join(targetPath, "spec.md"), "different\n");

    await expect(archiveTaskPackage(input, frozen.digest)).rejects.toMatchObject({
      code: "ARCHIVE_DUAL_PATH_CONFLICT",
      category: "UNKNOWN_SIDE_EFFECT",
    });
  });

  it("rejects path traversal through task ids", async () => {
    const { input } = await fixture();
    expect(() => resolveArchivePaths({ ...input, taskId: "../escape" })).toThrow(
      /Invalid task id/,
    );
  });
});
