import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkspaceEffect,
  createGitCheckpoint,
  createWorkspaceEffectRequest,
  nodeGitCommandRunner,
  parseGitCheckpoint,
  parseWorkspaceEffectRequest,
  reconcileWorkspaceEffect,
  validateGitCheckpoint,
} from "../../src/git/workspace-effect.js";
import type {
  GitCommandRunner,
  GitInvocation,
  WorkspaceEffectRequest,
} from "../../src/git/workspace-effect.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("local Git workspace effect", () => {
  it("creates one isolated worktree with a stable Effect ID and argv-only Git calls", async () => {
    const fixture = await createFixture();
    const request = await requestFor(fixture);
    const restored = await parseWorkspaceEffectRequest(JSON.parse(JSON.stringify(request)), request.effectId);
    const invocations: GitInvocation[] = [];
    const recordingRunner: GitCommandRunner = {
      async run(invocation) {
        invocations.push(invocation);
        return nodeGitCommandRunner.run(invocation);
      },
    };

    const first = await applyWorkspaceEffect(restored, recordingRunner);
    const second = await applyWorkspaceEffect(restored, recordingRunner);

    expect(first.outcome).toBe("APPLIED");
    expect(second.outcome).toBe("ALREADY_APPLIED");
    expect(first.effectId).toBe(second.effectId);
    expect(first.headSha).toBe(fixture.baseSha);
    expect(git(fixture.repositoryRoot, "worktree", "list", "--porcelain")).toContain(request.worktreePath);
    expect(invocations.every((item) => item.executable === "git" && item.shell === false && Array.isArray(item.argv))).toBe(true);
    expect(invocations.filter((item) => item.argv[0] === "worktree" && item.argv[1] === "add")).toHaveLength(1);

    const serialized = JSON.parse(JSON.stringify(request)) as Record<string, unknown>;
    serialized["branchName"] = "task/TASK-9999";
    await expect(parseWorkspaceEffectRequest(serialized, request.effectId)).rejects.toThrow(/differs from its canonical/);
    await expect(parseWorkspaceEffectRequest(JSON.parse(JSON.stringify(request)), "wrong-id")).rejects.toThrow(/expected ID/);
  });

  it("rejects unsafe roots and symbolic-link escapes before invoking Git", async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.repositoryRoot, "nested"));
    await expect(createWorkspaceEffectRequest({
      taskId: "TASK-0004",
      specRevision: 1,
      repositoryRoot: path.join(fixture.repositoryRoot, "nested"),
      worktreeRoot: fixture.worktreeRoot,
      baseRef: "refs/heads/master",
      baseSha: fixture.baseSha,
    })).rejects.toThrow(/Git worktree top-level/);

    await expect(createWorkspaceEffectRequest({
      taskId: "TASK-0004",
      specRevision: 1,
      repositoryRoot: fixture.repositoryRoot,
      worktreeRoot: fixture.repositoryRoot,
      baseRef: "refs/heads/master",
      baseSha: fixture.baseSha,
    })).rejects.toThrow(/cannot replace the repository root/);

    const outside = path.join(fixture.root, "outside");
    const linkedRoot = path.join(fixture.root, "linked-worktrees");
    await mkdir(outside);
    await symlink(outside, linkedRoot, "dir");
    await expect(createWorkspaceEffectRequest({
      taskId: "TASK-0004",
      specRevision: 1,
      repositoryRoot: fixture.repositoryRoot,
      worktreeRoot: linkedRoot,
      baseRef: "refs/heads/master",
      baseSha: fixture.baseSha,
    })).rejects.toThrow(/symbolic link/);

    const targetLinkRoot = path.join(fixture.root, "safe-worktrees");
    await mkdir(targetLinkRoot);
    await symlink(outside, path.join(targetLinkRoot, "TASK-0004"), "dir");
    await expect(createWorkspaceEffectRequest({
      taskId: "TASK-0004",
      specRevision: 1,
      repositoryRoot: fixture.repositoryRoot,
      worktreeRoot: targetLinkRoot,
      baseRef: "refs/heads/master",
      baseSha: fixture.baseSha,
    })).rejects.toThrow(/cannot be a symbolic link/);

    await expect(createWorkspaceEffectRequest({
      taskId: "TASK-0004",
      specRevision: 1,
      repositoryRoot: fixture.repositoryRoot,
      worktreeRoot: path.parse(fixture.repositoryRoot).root,
      baseRef: "refs/heads/master",
      baseSha: fixture.baseSha,
    })).rejects.toThrow(/Filesystem root/);

    await expect(createWorkspaceEffectRequest({
      taskId: "TASK-0004",
      specRevision: 1,
      repositoryRoot: fixture.repositoryRoot,
      worktreeRoot: path.join(fixture.repositoryRoot, ".git"),
      baseRef: "refs/heads/master",
      baseSha: fixture.baseSha,
    })).rejects.toThrow(/Git common directory/);
    await expect(createWorkspaceEffectRequest({
      taskId: "TASK-0004",
      specRevision: 1,
      repositoryRoot: fixture.repositoryRoot,
      worktreeRoot: path.join(fixture.repositoryRoot, ".git", "objects"),
      baseRef: "refs/heads/master",
      baseSha: fixture.baseSha,
    })).rejects.toThrow(/Git common directory/);
    await expect(createWorkspaceEffectRequest({
      taskId: "TASK-0004",
      specRevision: 1,
      repositoryRoot: fixture.repositoryRoot,
      worktreeRoot: fixture.worktreeRoot,
      baseRef: "HEAD",
      baseSha: fixture.baseSha,
    })).rejects.toThrow(/canonical refs\/heads/);
  });

  it("stops on Base drift and branch conflicts without mutating a worktree", async () => {
    const driftFixture = await createFixture();
    const driftRequest = await requestFor(driftFixture);
    await writeFile(path.join(driftFixture.repositoryRoot, "drift.txt"), "drift\n");
    git(driftFixture.repositoryRoot, "add", "drift.txt");
    git(driftFixture.repositoryRoot, "commit", "-m", "advance base");

    const drifted = await applyWorkspaceEffect(driftRequest);
    expect(drifted.outcome).toBe("CONFLICT");
    expect(drifted.reconcileCode).toBe("BASE_REF_DRIFT");
    expect(await reconcileWorkspaceEffect(driftRequest)).toMatchObject({ state: "ABSENT" });

    const conflictFixture = await createFixture();
    const conflictRequest = await requestFor(conflictFixture);
    git(conflictFixture.repositoryRoot, "branch", conflictRequest.branchName, conflictFixture.baseSha);
    const conflicted = await applyWorkspaceEffect(conflictRequest);
    expect(conflicted.outcome).toBe("CONFLICT");
    expect(conflicted.reconcileCode).toBe("TASK_BRANCH_ALREADY_EXISTS");

    const occupiedFixture = await createFixture();
    const occupiedRequest = await requestFor(occupiedFixture);
    await mkdir(occupiedRequest.worktreePath, { recursive: true });
    const occupied = await applyWorkspaceEffect(occupiedRequest);
    expect(occupied).toMatchObject({ outcome: "CONFLICT", reconcileCode: "UNREGISTERED_WORKTREE_PATH" });
  });

  it("reconciles an unknown command result from Git facts instead of repeating the write", async () => {
    const fixture = await createFixture();
    const request = await requestFor(fixture);
    let addCalls = 0;
    const loseAcknowledgement: GitCommandRunner = {
      async run(invocation) {
        const result = await nodeGitCommandRunner.run(invocation);
        if (invocation.argv[0] === "worktree" && invocation.argv[1] === "add") {
          addCalls += 1;
          throw new Error("connection lost after Git completed");
        }
        return result;
      },
    };

    const recovered = await applyWorkspaceEffect(request, loseAcknowledgement);
    const repeated = await applyWorkspaceEffect(request, loseAcknowledgement);

    expect(recovered).toMatchObject({
      outcome: "ALREADY_APPLIED",
      reconciledAfterUnknown: true,
      reconcileCode: "WORKSPACE_MATCHED",
    });
    expect(repeated.outcome).toBe("ALREADY_APPLIED");
    expect(addCalls).toBe(1);
    expect(await reconcileWorkspaceEffect(request)).toMatchObject({ state: "APPLIED", headSha: fixture.baseSha });
  });

  it("encodes Effect ownership in the branch and rejects a different Spec at the same path", async () => {
    const fixture = await createFixture();
    const first = await requestFor(fixture);
    const second = await createWorkspaceEffectRequest({
      taskId: "TASK-0004",
      specRevision: 2,
      repositoryRoot: fixture.repositoryRoot,
      worktreeRoot: fixture.worktreeRoot,
      baseRef: "refs/heads/master",
      baseSha: fixture.baseSha,
    });
    expect(first.effectId).not.toBe(second.effectId);
    expect(first.branchName).toContain(first.effectId.split(":").at(-1));
    expect(second.branchName).toContain(second.effectId.split(":").at(-1));

    expect((await applyWorkspaceEffect(first)).outcome).toBe("APPLIED");
    const otherOwner = await applyWorkspaceEffect(second);
    expect(otherOwner).toMatchObject({ outcome: "CONFLICT", reconcileCode: "WORKTREE_BRANCH_CONFLICT" });
  });

  it("rejects stale prunable registrations and never reports a missing Worktree as applied", async () => {
    const fixture = await createFixture();
    const request = await requestFor(fixture);
    await applyWorkspaceEffect(request);
    await rm(request.worktreePath, { recursive: true, force: true });

    const stale = await reconcileWorkspaceEffect(request);
    expect(stale).toMatchObject({ state: "CONFLICT", code: "STALE_WORKTREE_REGISTRATION" });
  });

  it("refuses Checkpoints that would omit tracked or untracked work", async () => {
    const fixture = await createFixture();
    const request = await requestFor(fixture);
    await applyWorkspaceEffect(request);

    await writeFile(path.join(request.worktreePath, "untracked.txt"), "uncommitted\n");
    await expect(createGitCheckpoint(request, "2026-08-20T12:00:00.000Z")).rejects.toThrow(/clean Worktree/);
    await rm(path.join(request.worktreePath, "untracked.txt"));

    await writeFile(path.join(request.worktreePath, "README.md"), "dirty tracked\n");
    await expect(createGitCheckpoint(request, "2026-08-20T12:00:00.000Z")).rejects.toThrow(/clean Worktree/);
    git(request.worktreePath, "checkout", "--", "README.md");
    await expect(createGitCheckpoint(request, "2026-08-20T12:00:00.000Z")).resolves.toMatchObject({ commitSha: fixture.baseSha });
  });

  it("records a committed Result Commit and Git tree digest as a tamper-evident Checkpoint", async () => {
    const fixture = await createFixture();
    const request = await requestFor(fixture);
    await applyWorkspaceEffect(request);
    await writeFile(path.join(request.worktreePath, "result.txt"), "implemented\n");
    git(request.worktreePath, "add", "result.txt");
    git(request.worktreePath, "commit", "-m", "fixture result");
    const resultCommit = git(request.worktreePath, "rev-parse", "HEAD").trim();
    const treeDigest = git(request.worktreePath, "rev-parse", "HEAD^{tree}").trim();

    const checkpoint = await createGitCheckpoint(request, "2026-08-20T12:00:00.000Z");
    expect(checkpoint).toMatchObject({
      taskId: "TASK-0004",
      workspaceEffectId: request.effectId,
      baseSha: fixture.baseSha,
      commitSha: resultCommit,
      treeDigest,
    });
    expect(checkpoint.checkpointDigest).toMatch(/^git-checkpoint:sha256:[0-9a-f]{64}$/);
    const restored = parseGitCheckpoint(JSON.parse(JSON.stringify(checkpoint)), checkpoint.checkpointDigest);
    await expect(validateGitCheckpoint(request, restored)).resolves.toBeUndefined();

    const tampered = JSON.parse(JSON.stringify(checkpoint)) as Record<string, unknown>;
    tampered["treeDigest"] = "f".repeat(40);
    expect(() => parseGitCheckpoint(tampered, checkpoint.checkpointDigest)).toThrow(/expected digest/);
    expect(() => parseGitCheckpoint(JSON.parse(JSON.stringify(checkpoint)), "wrong-digest")).toThrow(/expected digest/);

    await writeFile(path.join(request.worktreePath, "later.txt"), "later\n");
    git(request.worktreePath, "add", "later.txt");
    git(request.worktreePath, "commit", "-m", "move branch");
    await expect(validateGitCheckpoint(request, restored)).rejects.toThrow(/no longer matches Git/);
  });

  it("does not trust spread-cloned Requests or Checkpoints", async () => {
    const fixture = await createFixture();
    const request = await requestFor(fixture);
    await expect(applyWorkspaceEffect({ ...request })).rejects.toThrow(/must be created or parsed/);
    await applyWorkspaceEffect(request);
    const checkpoint = await createGitCheckpoint(request, "2026-08-20T12:00:00.000Z");
    await expect(validateGitCheckpoint(request, { ...checkpoint })).rejects.toThrow(/not bound/);
  });
});

interface Fixture {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly baseSha: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-git-effect-"));
  temporaryRoots.push(root);
  const repositoryRoot = path.join(root, "repository");
  const worktreeRoot = path.join(root, "worktrees");
  await mkdir(repositoryRoot);
  git(repositoryRoot, "init", "-b", "master");
  git(repositoryRoot, "config", "user.name", "Moye Test");
  git(repositoryRoot, "config", "user.email", "moye@example.test");
  await writeFile(path.join(repositoryRoot, "README.md"), "fixture\n");
  git(repositoryRoot, "add", "README.md");
  git(repositoryRoot, "commit", "-m", "base");
  return {
    root,
    repositoryRoot,
    worktreeRoot,
    baseSha: git(repositoryRoot, "rev-parse", "HEAD").trim(),
  };
}

function requestFor(fixture: Fixture): Promise<WorkspaceEffectRequest> {
  return createWorkspaceEffectRequest({
    taskId: "TASK-0004",
    specRevision: 1,
    repositoryRoot: fixture.repositoryRoot,
    worktreeRoot: fixture.worktreeRoot,
    baseRef: "refs/heads/master",
    baseSha: fixture.baseSha,
  });
}

function git(cwd: string, ...argv: string[]): string {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
