import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildLiveCodingTask } from "../../src/product/live-task.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("live task product input", () => {
  it("rejects FAKE before creating product task state", async () => {
    const fixture = await repositoryFixture();
    await expect(buildLiveCodingTask({ ...submission(fixture.repositoryRoot), runnerKind: "FAKE" }, {
      projectId: "live-test",
      runtimeRoot: fixture.runtimeRoot,
      allowedRepositoryRoots: [fixture.repositoryRoot],
    })).rejects.toMatchObject({ code: "REAL_RUNNER_REQUIRED" });
  });

  it("builds a real CodingTaskWorkflow input and a dedicated non-checked-out result branch", async () => {
    const fixture = await repositoryFixture();
    const result = await buildLiveCodingTask(submission(fixture.repositoryRoot), {
      projectId: "live-test",
      runtimeRoot: fixture.runtimeRoot,
      allowedRepositoryRoots: [fixture.repositoryRoot],
      now: () => new Date("2026-08-22T03:00:00.000Z"),
    });

    expect(result.taskId).toMatch(/^TASK-LIVE-20260822030000-/);
    expect(result.input).toMatchObject({
      projectId: "live-test",
      runnerKind: "CODEX_EXEC",
      repositoryRoot: fixture.repositoryRoot,
      baseRef: "refs/heads/master",
      targetRef: "refs/heads/moye/results",
    });
    expect(git(fixture.repositoryRoot, "rev-parse", "moye/results")).toBe(fixture.baseSha);
    expect(await readFile(path.join(fixture.runtimeRoot, "tasks", result.taskId, "spec.md"), "utf8"))
      .toContain("real change");
    expect("fake" in result.input).toBe(false);
  });
});

function submission(repositoryRoot: string) {
  return {
    title: "Real task",
    objective: "Implement a real change",
    acceptanceCriteria: ["result.txt is committed"],
    repositoryRoot,
    baseBranch: "master",
    targetBranch: "moye/results",
    runnerKind: "CODEX_EXEC",
    validationCommands: [{ commandId: "CMD-01", argv: [process.execPath, "-e", "process.exit(0)"] }],
    docsDisposition: "not_applicable",
  };
}

async function repositoryFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-live-task-"));
  roots.push(root);
  const repositoryRoot = path.join(root, "repo");
  const runtimeRoot = path.join(root, "runtime");
  await mkdir(repositoryRoot);
  git(repositoryRoot, "init", "-b", "master");
  git(repositoryRoot, "config", "user.name", "Moye Test");
  git(repositoryRoot, "config", "user.email", "moye@example.test");
  await writeFile(path.join(repositoryRoot, "README.md"), "fixture\n");
  git(repositoryRoot, "add", "README.md");
  git(repositoryRoot, "commit", "-m", "base");
  const baseSha = git(repositoryRoot, "rev-parse", "HEAD");
  git(repositoryRoot, "switch", "--detach", baseSha);
  return { repositoryRoot: await realpath(repositoryRoot), runtimeRoot, baseSha };
}

function git(cwd: string, ...argv: string[]): string {
  return execFileSync("git", argv, { cwd, encoding: "utf8" }).trim();
}
