import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("seal-start CLI preflight", () => {
  it("rejects a missing Active Task package before contacting Restate", async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), "moye-seal-cli-preflight-"));
    git(fixture, ["init", "-b", "master"]);
    git(fixture, ["config", "user.email", "moye@example.invalid"]);
    git(fixture, ["config", "user.name", "Moye Test"]);
    await writeFile(path.join(fixture, "README.md"), "fixture\n");
    const baseCommit = commit(fixture, "base");
    const inputPath = path.join(fixture, "sealed-task.json");
    await writeFile(inputPath, JSON.stringify({
      taskId: "TASK-SEAL-CLI-PREFLIGHT",
      projectId: "moye-test",
      title: "Reject missing package before dispatch",
      specRevision: 1,
      backlogRefs: [],
      baseCommit,
      archivedAt: "2026-08-24T00:00:00.000Z",
      executorId: "test/root",
    }));

    const result = spawnSync(process.execPath, [
      "--import", "tsx", path.join(repositoryRoot, "src/cli/index.ts"),
      "seal-start", "--file", inputPath,
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MOYE_REPOSITORY_ROOT: fixture,
        RESTATE_INGRESS_URL: "http://127.0.0.1:1",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/delivery/tasks/TASK-SEAL-CLI-PREFLIGHT");
    expect(result.stderr).not.toMatch(/fetch failed|ECONNREFUSED/);
  });
});

function commit(root: string, message: string): string {
  git(root, ["add", "."]);
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}
