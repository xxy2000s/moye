import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createSealIntent,
  stageSealedTaskPackage,
  verifyHistoricalSealedResultCommit,
  verifySealedResultCommit,
} from "../../src/archive/sealed-result-commit.js";

describe("sealed result commit", () => {
  it("binds one clean Result Commit to the prepared Archive package", async () => {
    const fixture = await sealFixture("TASK-SEAL-SUCCESS");
    const intent = await createSealIntent(fixture.root, fixture.input);
    await stageSealedTaskPackage(fixture.root, intent);
    await stageSealedTaskPackage(fixture.root, intent);
    const resultCommit = commit(fixture.root, "sealed result");

    const receipt = await verifySealedResultCommit(fixture.root, intent, {
      token: intent.token,
      resultCommit,
      executorId: "test/root",
      verificationPath: intent.verificationPath,
      docsImpactPath: intent.docsImpactPath,
    }, "2026-08-23T01:00:00.000Z");

    expect(receipt).toMatchObject({
      taskId: fixture.input.taskId,
      baseCommit: fixture.input.baseCommit,
      resultCommit,
      archivePath: intent.archivePath,
    });
    expect(git(fixture.root, ["rev-list", "--count", `${fixture.input.baseCommit}..${resultCommit}`]).trim()).toBe("1");
    expect(git(fixture.root, ["status", "--porcelain"])).toBe("");
    expect(await readFile(path.join(fixture.root, intent.archivePath, "task.yaml"), "utf8"))
      .toContain(`intent_digest: ${intent.intentDigest}`);
  });

  it("rejects evidence that is not scoped to the frozen Intent", async () => {
    const fixture = await sealFixture("TASK-SEAL-TOKEN");
    const intent = await createSealIntent(fixture.root, fixture.input);
    await stageSealedTaskPackage(fixture.root, intent);
    const resultCommit = commit(fixture.root, "sealed result");
    await expect(verifySealedResultCommit(fixture.root, intent, {
      token: "sha256:wrong",
      resultCommit,
      executorId: "test/root",
      verificationPath: intent.verificationPath,
      docsImpactPath: intent.docsImpactPath,
    }, "2026-08-23T01:00:00.000Z")).rejects.toThrow(/does not match the frozen Seal Intent/);
  });

  it("rejects an incomplete Docs Impact instead of accepting an opaque commit", async () => {
    const fixture = await sealFixture("TASK-SEAL-IMPACT", false);
    const intent = await createSealIntent(fixture.root, fixture.input);
    await stageSealedTaskPackage(fixture.root, intent);
    const resultCommit = commit(fixture.root, "sealed result");
    await expect(verifySealedResultCommit(fixture.root, intent, {
      token: intent.token,
      resultCommit,
      executorId: "test/root",
      verificationPath: intent.verificationPath,
      docsImpactPath: intent.docsImpactPath,
    }, "2026-08-23T01:00:00.000Z")).rejects.toThrow(/does not cover changed paths/);
  });

  it("recovers a valid historical Result Commit only when it is an ancestor of current HEAD", async () => {
    const fixture = await sealFixture("TASK-SEAL-HISTORICAL");
    const intent = await createSealIntent(fixture.root, fixture.input);
    await stageSealedTaskPackage(fixture.root, intent);
    const resultCommit = commit(fixture.root, "sealed result");
    await writeFile(path.join(fixture.root, "later.txt"), "recovery implementation\n");
    commit(fixture.root, "later recovery implementation");
    const receipt = await verifyHistoricalSealedResultCommit(fixture.root, intent, {
      token: intent.token,
      resultCommit,
      executorId: "test/recovery",
      verificationPath: intent.verificationPath,
      docsImpactPath: intent.docsImpactPath,
    }, "2026-08-23T01:00:00.000Z");
    expect(receipt.resultCommit).toBe(resultCommit);
    expect(git(fixture.root, ["rev-parse", "HEAD"]).trim()).not.toBe(resultCommit);
  });
});

async function sealFixture(taskId: string, completeImpact = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-seal-"));
  git(root, ["init", "-b", "master"]);
  git(root, ["config", "user.email", "moye@example.invalid"]);
  git(root, ["config", "user.name", "Moye Test"]);
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "fixture\n");
  await writeFile(path.join(root, "scripts", "docs_graph.rb"), "exit 0\n");
  const baseCommit = commit(root, "base");
  const active = path.join(root, "docs", "delivery", "tasks", taskId);
  const archivePath = `docs/delivery/tasks/archive/2026-08-23-${taskId}`;
  await mkdir(active, { recursive: true });
  await writeFile(path.join(active, "task.yaml"), [
    "schema_version: 1",
    `id: ${taskId}`,
    "status: received",
    "spec_revision: 1",
    "execution_mode: sealed-result-commit",
    `base_commit: ${baseCommit}`,
    "archive: { status: not_ready }",
    "result: {}",
    "",
  ].join("\n"));
  await writeFile(path.join(active, "verification.md"), "> 状态：Accepted\n");
  const changedPaths = completeImpact ? [
    `${archivePath}/task.yaml`,
    `${archivePath}/verification.md`,
    `${archivePath}/docs-impact.yaml`,
  ] : [`${archivePath}/task.yaml`];
  await writeFile(path.join(active, "docs-impact.yaml"), [
    "schema_version: 1",
    `task_id: ${taskId}`,
    "changed_paths:",
    ...changedPaths.map((changedPath) => `  - ${changedPath}`),
    "",
  ].join("\n"));
  return {
    root,
    input: {
      taskId,
      projectId: "moye-test",
      title: "Seal one result commit",
      specRevision: 1,
      backlogRefs: [],
      baseCommit,
      archivedAt: "2026-08-23T00:00:00.000Z",
      executorId: "test/root",
    },
  };
}

function commit(root: string, message: string): string {
  git(root, ["add", "."]);
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}
