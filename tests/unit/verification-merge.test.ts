import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SpawnAgentProcessRunner } from "../../src/agent/codex-exec.js";
import type { AgentProcessRunner } from "../../src/agent/codex-exec.js";
import { createTaskEnvelope } from "../../src/domain/coding-task.js";
import type { TaskEnvelope } from "../../src/domain/coding-task.js";
import { applyLocalMerge, createLocalMergeRequest, reconcileLocalMerge } from "../../src/git/merge-effect.js";
import { applyWorkspaceEffect, createGitCheckpoint, createWorkspaceEffectRequest, nodeGitCommandRunner } from "../../src/git/workspace-effect.js";
import type { GitCommandRunner, GitCheckpoint, WorkspaceEffectRequest } from "../../src/git/workspace-effect.js";
import { parseVerificationBinding, runVerificationGate } from "../../src/verification/gate.js";
import type { VerificationBinding } from "../../src/verification/gate.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("verification and local merge", () => {
  it("binds argv-only command evidence to one Commit and merges it exactly once", async () => {
    const fixture = await preparedFixture();
    const binding = await verify(fixture);
    expect(binding.passed).toBe(true);
    expect(binding.verifiedCommit).toBe(fixture.checkpoint.commitSha);
    expect(binding.commandResults[0]).toMatchObject({ exitCode: 0, shell: false, stdout: "verified\n" });
    expect(binding.commandResults[0]?.argv).toEqual([
      process.execPath, "-e", "const fs=require('fs');if(fs.readFileSync('result.txt','utf8')!=='done\\n')process.exit(2);console.log('verified')",
    ]);
    const restored = parseVerificationBinding(JSON.parse(JSON.stringify(binding)), binding.verificationDigest);
    expect(restored.verificationDigest).toBe(binding.verificationDigest);
    const tampered = JSON.parse(JSON.stringify(binding)) as Record<string, unknown>;
    tampered["verifiedCommit"] = fixture.baseSha;
    expect(() => parseVerificationBinding(tampered, binding.verificationDigest)).toThrow(/Expected Digest/);

    const request = await createLocalMergeRequest({
      repositoryRoot: fixture.workspace.worktreePath,
      targetRef: "refs/heads/master",
      expectedBase: fixture.baseSha,
      verification: restored,
    });
    const first = await applyLocalMerge(request);
    const second = await applyLocalMerge(request);
    expect(first.outcome).toBe("APPLIED");
    expect(second).toMatchObject({ outcome: "ALREADY_APPLIED", mergeCommit: first.mergeCommit });
    expect(git(fixture.repositoryRoot, "rev-parse", "master").trim()).toBe(first.mergeCommit);
    expect(git(fixture.repositoryRoot, "rev-list", "--parents", "-n", "1", first.mergeCommit!).trim().split(/\s+/).slice(1))
      .toEqual([fixture.baseSha, fixture.checkpoint.commitSha]);
    expect(git(fixture.repositoryRoot, "log", "master", "--fixed-strings", "--grep", request.effectId, "--format=%H").trim().split("\n"))
      .toEqual([first.mergeCommit]);
  });

  it("reconciles a lost Merge acknowledgement from the unique marker and parents", async () => {
    const fixture = await preparedFixture();
    const binding = await verify(fixture);
    const request = await createLocalMergeRequest({
      repositoryRoot: fixture.workspace.worktreePath,
      targetRef: "refs/heads/master",
      expectedBase: fixture.baseSha,
      verification: binding,
    });
    let mergeCalls = 0;
    const lostAck: GitCommandRunner = {
      async run(invocation) {
        const result = await nodeGitCommandRunner.run(invocation);
        if (invocation.argv[0] === "update-ref") {
          mergeCalls += 1;
          throw new Error("lost after merge");
        }
        return result;
      },
    };
    const recovered = await applyLocalMerge(request, lostAck);
    const repeated = await applyLocalMerge(request, lostAck);
    expect(recovered).toMatchObject({ outcome: "ALREADY_APPLIED", reconciledAfterUnknown: true, code: "MERGE_MATCHED" });
    expect(repeated.outcome).toBe("ALREADY_APPLIED");
    expect(mergeCalls).toBe(1);
    expect((await reconcileLocalMerge(request)).state).toBe("APPLIED");
  });

  it("uses an atomic ref CAS so concurrent target drift cannot receive the verified source", async () => {
    const fixture = await preparedFixture();
    const binding = await verify(fixture);
    const request = await createLocalMergeRequest({
      repositoryRoot: fixture.workspace.worktreePath,
      targetRef: "refs/heads/master",
      expectedBase: fixture.baseSha,
      verification: binding,
    });
    let driftCommit = "";
    const concurrentDrift: GitCommandRunner = {
      async run(invocation) {
        if (invocation.argv[0] === "update-ref" && !driftCommit) {
          await writeFile(path.join(fixture.repositoryRoot, "concurrent.txt"), "drift\n");
          git(fixture.repositoryRoot, "add", "concurrent.txt");
          git(fixture.repositoryRoot, "commit", "-m", "concurrent drift");
          driftCommit = git(fixture.repositoryRoot, "rev-parse", "HEAD").trim();
          git(fixture.repositoryRoot, "update-ref", "refs/heads/master", driftCommit, fixture.baseSha);
        }
        return nodeGitCommandRunner.run(invocation);
      },
    };
    const outcome = await applyLocalMerge(request, concurrentDrift);
    expect(outcome).toMatchObject({ outcome: "CONFLICT", code: "MERGE_TARGET_DRIFT" });
    expect(git(fixture.repositoryRoot, "rev-parse", "master").trim()).toBe(driftCommit);
    expect(gitStatus(fixture.repositoryRoot, "merge-base", "--is-ancestor", fixture.checkpoint.commitSha, "master")).not.toBe(0);
    expect(git(fixture.repositoryRoot, "log", "master", "--fixed-strings", "--grep", request.effectId, "--format=%H").trim()).toBe("");
  });

  it("refuses to move a target branch that is checked out in any Worktree", async () => {
    const fixture = await preparedFixture();
    const binding = await verify(fixture);
    git(fixture.repositoryRoot, "switch", "master");
    const request = await createLocalMergeRequest({
      repositoryRoot: fixture.workspace.worktreePath,
      targetRef: "refs/heads/master",
      expectedBase: fixture.baseSha,
      verification: binding,
    });
    expect(await applyLocalMerge(request)).toMatchObject({ outcome: "CONFLICT", code: "MERGE_TARGET_CHECKED_OUT" });
    expect(git(fixture.repositoryRoot, "rev-parse", "master").trim()).toBe(fixture.baseSha);
  });

  it("blocks Merge when verification fails or target Base drifts", async () => {
    const failing = await preparedFixture(true);
    const failed = await runVerificationGate(failing.envelope, failing.workspace, failing.checkpoint, {
      artifactRoot: path.join(failing.root, "verify-fail"),
      now: clock(),
    });
    expect(failed).toMatchObject({ passed: false, code: "COMMAND_FAILED" });
    await expect(createLocalMergeRequest({
      repositoryRoot: failing.workspace.worktreePath,
      targetRef: "refs/heads/master",
      expectedBase: failing.baseSha,
      verification: failed as never,
    })).rejects.toThrow(/Verification Binding produced by the Gate/);
    expect(git(failing.repositoryRoot, "rev-parse", "master").trim()).toBe(failing.baseSha);

    const drifted = await preparedFixture();
    const binding = await verify(drifted);
    await writeFile(path.join(drifted.repositoryRoot, "drift.txt"), "drift\n");
    git(drifted.repositoryRoot, "add", "drift.txt");
    git(drifted.repositoryRoot, "commit", "-m", "advance target");
    git(drifted.repositoryRoot, "update-ref", "refs/heads/master", "HEAD", drifted.baseSha);
    const request = await createLocalMergeRequest({
      repositoryRoot: drifted.workspace.worktreePath,
      targetRef: "refs/heads/master",
      expectedBase: drifted.baseSha,
      verification: binding,
    });
    expect(await applyLocalMerge(request)).toMatchObject({ outcome: "CONFLICT", code: "MERGE_TARGET_DRIFT" });
  });

  it("detects Branch movement during verification and refuses a stale binding", async () => {
    const fixture = await preparedFixture();
    const real = new SpawnAgentProcessRunner();
    let moved = false;
    const movingRunner: AgentProcessRunner = {
      async run(invocation) {
        const result = await real.run(invocation);
        if (!moved) {
          moved = true;
          await writeFile(path.join(fixture.workspace.worktreePath, "after.txt"), "moved\n");
          git(fixture.workspace.worktreePath, "add", "after.txt");
          git(fixture.workspace.worktreePath, "commit", "-m", "move during verify");
        }
        return result;
      },
    };
    const outcome = await runVerificationGate(fixture.envelope, fixture.workspace, fixture.checkpoint, {
      artifactRoot: path.join(fixture.root, "verify-drift"),
      processRunner: movingRunner,
      now: clock(),
    });
    expect(outcome).toMatchObject({ passed: false, code: "COMMIT_DRIFT" });
    expect(git(fixture.repositoryRoot, "rev-parse", "master").trim()).toBe(fixture.baseSha);
  });

  it("reuses a completed Verification operation and stops on an unconfirmed command result", async () => {
    const fixture = await preparedFixture();
    const real = new SpawnAgentProcessRunner();
    let calls = 0;
    const counting: AgentProcessRunner = {
      async run(invocation) { calls += 1; return real.run(invocation); },
    };
    const artifactRoot = path.join(fixture.root, "verify-replay");
    const first = await runVerificationGate(fixture.envelope, fixture.workspace, fixture.checkpoint, {
      artifactRoot, processRunner: counting, now: clock(),
    });
    const second = await runVerificationGate(fixture.envelope, fixture.workspace, fixture.checkpoint, {
      artifactRoot, processRunner: counting, now: clock(),
    });
    expect(first).toEqual(second);
    expect(calls).toBe(1);

    const unknownRoot = path.join(fixture.root, "verify-unknown");
    let clockCalls = 0;
    const crashingClock = () => {
      clockCalls += 1;
      if (clockCalls === 2) throw new Error("simulated worker loss after command");
      return new Date("2026-08-20T00:00:01.000Z");
    };
    await expect(runVerificationGate(fixture.envelope, fixture.workspace, fixture.checkpoint, {
      artifactRoot: unknownRoot, processRunner: counting, now: crashingClock,
    })).rejects.toThrow(/simulated worker loss/);
    const recovered = await runVerificationGate(fixture.envelope, fixture.workspace, fixture.checkpoint, {
      artifactRoot: unknownRoot, processRunner: counting, now: clock(),
    });
    expect(recovered).toMatchObject({ passed: false, code: "RESULT_UNKNOWN" });
    expect(calls).toBe(2);
  });
});

interface Fixture {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly baseSha: string;
  readonly envelope: TaskEnvelope;
  readonly workspace: WorkspaceEffectRequest;
  readonly checkpoint: GitCheckpoint;
}

async function preparedFixture(failingCommand = false): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-verify-merge-"));
  roots.push(root);
  const repositoryRoot = path.join(root, "repo");
  await mkdir(repositoryRoot);
  git(repositoryRoot, "init", "-b", "master");
  git(repositoryRoot, "config", "user.name", "Moye Test");
  git(repositoryRoot, "config", "user.email", "moye@example.test");
  await writeFile(path.join(repositoryRoot, "README.md"), "fixture\n");
  git(repositoryRoot, "add", "README.md");
  git(repositoryRoot, "commit", "-m", "base");
  const baseSha = git(repositoryRoot, "rev-parse", "HEAD").trim();
  git(repositoryRoot, "switch", "--detach", baseSha);
  const script = failingCommand
    ? "console.error('failed');process.exit(9)"
    : "const fs=require('fs');if(fs.readFileSync('result.txt','utf8')!=='done\\n')process.exit(2);console.log('verified')";
  const envelope = createTaskEnvelope({
    taskId: "TASK-VERIFY-MERGE",
    specRevision: 1,
    baseSha,
    requirements: [{ requirementId: "REQ-VERIFY-01", title: "fixture", acceptanceCriteria: ["result exists"] }],
    validationCommands: [{ commandId: "CMD-FIXTURE", argv: [process.execPath, "-e", script] }],
    contextPlan: { graphRevision: 17, intents: ["coding-task-poc"], requiredRead: ["agent-contract"], requiredReview: [] },
  });
  const workspace = await createWorkspaceEffectRequest({
    taskId: envelope.taskId,
    specRevision: 1,
    repositoryRoot,
    worktreeRoot: path.join(root, "worktrees"),
    baseRef: "refs/heads/master",
    baseSha,
  });
  expect((await applyWorkspaceEffect(workspace)).outcome).toBe("APPLIED");
  await writeFile(path.join(workspace.worktreePath, "result.txt"), "done\n");
  git(workspace.worktreePath, "add", "result.txt");
  git(workspace.worktreePath, "commit", "-m", "result");
  const checkpoint = await createGitCheckpoint(workspace, "2026-08-20T00:00:00.000Z");
  return { root, repositoryRoot, baseSha, envelope, workspace, checkpoint };
}

async function verify(fixture: Fixture): Promise<VerificationBinding> {
  const outcome = await runVerificationGate(fixture.envelope, fixture.workspace, fixture.checkpoint, {
    artifactRoot: path.join(fixture.root, "verification"),
    now: clock(),
  });
  if (!outcome.passed) throw new Error(`unexpected verification failure ${outcome.code}`);
  return outcome;
}

function clock(): () => Date {
  let value = Date.parse("2026-08-20T00:00:01.000Z");
  return () => { const current = new Date(value); value += 10; return current; };
}

function git(cwd: string, ...argv: string[]): string {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitStatus(cwd: string, ...argv: string[]): number | null {
  try { execFileSync("git", argv, { cwd, stdio: "ignore" }); return 0; }
  catch (error) { return typeof error === "object" && error !== null && "status" in error ? error.status as number | null : null; }
}
