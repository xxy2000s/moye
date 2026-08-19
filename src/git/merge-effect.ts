import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { MoyeError } from "../domain/errors.js";
import type { VerificationBinding } from "../verification/gate.js";
import { assertTrustedVerification } from "../verification/gate.js";
import type { GitCommandResult, GitCommandRunner } from "./workspace-effect.js";
import { nodeGitCommandRunner } from "./workspace-effect.js";

const trustedMergeRequests = new WeakSet<object>();

export interface LocalMergeInput {
  readonly repositoryRoot: string;
  readonly targetRef: string;
  readonly expectedBase: string;
  readonly verification: VerificationBinding;
}

export interface LocalMergeRequest {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly repositoryRoot: string;
  readonly targetRef: string;
  readonly expectedBase: string;
  readonly sourceCommit: string;
  readonly verificationDigest: string;
  readonly effectId: string;
}

export interface LocalMergeResult {
  readonly effectId: string;
  readonly outcome: "APPLIED" | "ALREADY_APPLIED" | "CONFLICT";
  readonly code: string;
  readonly targetRef: string;
  readonly mergeCommit?: string;
  readonly reconciledAfterUnknown: boolean;
}

interface MergeReconcile {
  readonly state: "ABSENT" | "APPLIED" | "CONFLICT";
  readonly code: string;
  readonly mergeCommit?: string;
}

export async function createLocalMergeRequest(input: LocalMergeInput): Promise<LocalMergeRequest> {
  assertTrustedVerification(input.verification);
  if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(input.targetRef)
      || input.targetRef.includes("..") || input.targetRef.endsWith(".lock")) {
    throw validation("INVALID_MERGE_TARGET_REF", "targetRef must be a canonical refs/heads/* name");
  }
  assertObjectId(input.expectedBase, "expectedBase");
  if (input.expectedBase === input.verification.verifiedCommit) {
    throw validation("EMPTY_MERGE_RESULT", "Verified Result Commit must differ from Expected Base");
  }
  const repositoryRoot = await realpath(path.resolve(input.repositoryRoot));
  await assertGitTopLevel(repositoryRoot);
  const core = {
    schemaVersion: 1 as const,
    taskId: input.verification.taskId,
    specRevision: input.verification.specRevision,
    repositoryRoot,
    targetRef: input.targetRef,
    expectedBase: input.expectedBase,
    sourceCommit: input.verification.verifiedCommit,
    verificationDigest: input.verification.verificationDigest,
  };
  const request = deepFreeze({ ...core, effectId: digest("local-merge-effect", core) });
  trustedMergeRequests.add(request);
  return request;
}

export async function reconcileLocalMerge(
  request: LocalMergeRequest,
  runner: GitCommandRunner = nodeGitCommandRunner,
): Promise<MergeReconcile> {
  assertTrustedRequest(request);
  const targetHead = await readRequiredRef(request, request.targetRef, runner);
  const marker = `Moye-Effect: ${request.effectId}`;
  const markers = await git(request, [
    "log", request.targetRef, "--fixed-strings", "--grep", marker, "--format=%H",
  ], runner);
  if (markers.exitCode !== 0) throw gitReadError("MERGE_MARKER_READ_FAILED", markers);
  const commits = markers.stdout.trim().split("\n").filter(Boolean);
  if (commits.length > 1) return frozenReconcile("CONFLICT", "DUPLICATE_MERGE_MARKERS");
  if (commits.length === 1) {
    const mergeCommit = commits[0]!;
    const parentsResult = await git(request, ["rev-list", "--parents", "-n", "1", mergeCommit], runner);
    if (parentsResult.exitCode !== 0) throw gitReadError("MERGE_COMMIT_READ_FAILED", parentsResult);
    const [commit, ...parents] = parentsResult.stdout.trim().split(/\s+/);
    const contained = await git(request, ["merge-base", "--is-ancestor", mergeCommit, targetHead], runner);
    if (commit !== mergeCommit || parents.length !== 2 || parents[0] !== request.expectedBase
        || parents[1] !== request.sourceCommit || contained.exitCode !== 0) {
      return frozenReconcile("CONFLICT", "MERGE_MARKER_FACT_MISMATCH", mergeCommit);
    }
    return frozenReconcile("APPLIED", "MERGE_MATCHED", mergeCommit);
  }
  if (targetHead === request.expectedBase) return frozenReconcile("ABSENT", "MERGE_ABSENT");
  return frozenReconcile("CONFLICT", "MERGE_TARGET_DRIFT", targetHead);
}

export async function applyLocalMerge(
  request: LocalMergeRequest,
  runner: GitCommandRunner = nodeGitCommandRunner,
): Promise<LocalMergeResult> {
  assertTrustedRequest(request);
  const before = await reconcileLocalMerge(request, runner);
  if (before.state === "APPLIED") return result(request, "ALREADY_APPLIED", before, false);
  if (before.state === "CONFLICT") return result(request, "CONFLICT", before, false);

  const worktrees = await git(request, ["worktree", "list", "--porcelain", "-z"], runner);
  if (worktrees.exitCode !== 0) throw gitReadError("MERGE_WORKTREE_LIST_FAILED", worktrees);
  if (worktrees.stdout.split("\0").some((field) => field === `branch ${request.targetRef}`)) {
    return result(request, "CONFLICT", frozenReconcile("CONFLICT", "MERGE_TARGET_CHECKED_OUT"), false);
  }
  const sourceExists = await git(request, ["cat-file", "-e", `${request.sourceCommit}^{commit}`], runner);
  if (sourceExists.exitCode !== 0) return result(request, "CONFLICT", frozenReconcile("CONFLICT", "MERGE_SOURCE_MISSING"), false);
  const ancestry = await git(request, ["merge-base", "--is-ancestor", request.expectedBase, request.sourceCommit], runner);
  if (ancestry.exitCode !== 0) return result(request, "CONFLICT", frozenReconcile("CONFLICT", "MERGE_SOURCE_NOT_DESCENDANT"), false);

  const tree = await git(request, ["rev-parse", "--verify", `${request.sourceCommit}^{tree}`], runner);
  if (tree.exitCode !== 0) throw gitReadError("MERGE_SOURCE_TREE_READ_FAILED", tree);
  const message = `Moye local merge ${request.taskId}\n\nMoye-Effect: ${request.effectId}`;
  const candidate = await git(request, [
    "commit-tree", tree.stdout.trim(),
    "-p", request.expectedBase,
    "-p", request.sourceCommit,
    "-m", message,
  ], runner, deterministicCommitEnvironment(request));
  if (candidate.exitCode !== 0) throw gitReadError("MERGE_COMMIT_CREATE_FAILED", candidate);
  const candidateCommit = candidate.stdout.trim();
  assertObjectId(candidateCommit, "candidate merge commit");

  let invocationFailed = false;
  let invocationResult: GitCommandResult | undefined;
  try {
    invocationResult = await git(request, ["update-ref", request.targetRef, candidateCommit, request.expectedBase], runner);
    invocationFailed = invocationResult.exitCode !== 0;
  } catch {
    invocationFailed = true;
  }
  let after: MergeReconcile;
  try { after = await reconcileLocalMerge(request, runner); }
  catch (error) {
    throw new MoyeError({
      code: "LOCAL_MERGE_UNKNOWN",
      category: "UNKNOWN_SIDE_EFFECT",
      retryable: true,
      message: "Merge result is unknown and Git facts cannot be reconciled",
      details: { effectId: request.effectId },
      cause: error,
    });
  }
  if (after.state === "APPLIED") {
    return result(request, invocationFailed ? "ALREADY_APPLIED" : "APPLIED", after, invocationFailed);
  }
  if (after.state === "CONFLICT") return result(request, "CONFLICT", after, invocationFailed);
  if (invocationFailed) {
    throw new MoyeError({
      code: "LOCAL_MERGE_FAILED",
      category: "TRANSIENT_IO",
      retryable: true,
      message: "Merge command failed and reconciliation confirmed it is absent",
      details: { effectId: request.effectId, stderr: invocationResult?.stderr.trim() ?? "runner did not return" },
    });
  }
  throw new MoyeError({
    code: "LOCAL_MERGE_POSTCONDITION_FAILED",
    category: "UNKNOWN_SIDE_EFFECT",
    retryable: true,
    message: "Merge reported success but no matching Merge Commit exists",
    details: { effectId: request.effectId },
  });
}

function git(
  request: LocalMergeRequest,
  argv: readonly string[],
  runner: GitCommandRunner,
  env?: Readonly<Record<string, string>>,
): Promise<GitCommandResult> {
  return runner.run(Object.freeze({
    executable: "git",
    argv: Object.freeze([...argv]),
    cwd: request.repositoryRoot,
    shell: false,
    ...(env === undefined ? {} : { env: Object.freeze({ ...env }) }),
  }));
}

function deterministicCommitEnvironment(request: LocalMergeRequest): Readonly<Record<string, string>> {
  const identity = `moye+${request.effectId.slice(-16)}@invalid`;
  return Object.freeze({
    GIT_AUTHOR_NAME: "Moye Merge Effect",
    GIT_AUTHOR_EMAIL: identity,
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_NAME: "Moye Merge Effect",
    GIT_COMMITTER_EMAIL: identity,
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  });
}

async function readRequiredRef(request: LocalMergeRequest, ref: string, runner: GitCommandRunner): Promise<string> {
  const response = await git(request, ["rev-parse", "--verify", `${ref}^{commit}`], runner);
  if (response.exitCode !== 0) throw gitReadError("MERGE_TARGET_MISSING", response);
  const value = response.stdout.trim();
  assertObjectId(value, "target ref");
  return value;
}

async function assertGitTopLevel(root: string): Promise<void> {
  const gitEntry = await lstat(path.join(root, ".git"));
  if (gitEntry.isSymbolicLink() || (!gitEntry.isDirectory() && !gitEntry.isFile())) {
    throw validation("INVALID_MERGE_REPOSITORY", "repositoryRoot must be a Git top-level");
  }
}

function result(
  request: LocalMergeRequest,
  outcome: LocalMergeResult["outcome"],
  reconcile: MergeReconcile,
  reconciledAfterUnknown: boolean,
): LocalMergeResult {
  return deepFreeze({
    effectId: request.effectId,
    outcome,
    code: reconcile.code,
    targetRef: request.targetRef,
    ...(reconcile.mergeCommit ? { mergeCommit: reconcile.mergeCommit } : {}),
    reconciledAfterUnknown,
  });
}

function frozenReconcile(state: MergeReconcile["state"], code: string, mergeCommit?: string): MergeReconcile {
  return deepFreeze({ state, code, ...(mergeCommit ? { mergeCommit } : {}) });
}

function assertTrustedRequest(request: LocalMergeRequest): void {
  if (!trustedMergeRequests.has(request)) throw validation("UNTRUSTED_MERGE_REQUEST", "Merge Request must come from a trusted Verification Binding");
}

function assertObjectId(value: string, field: string): void {
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)) throw validation("INVALID_MERGE_OBJECT", `${field} must be a full Git object ID`);
}

function digest(namespace: string, value: unknown): string {
  return `${namespace}:sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validation(code: string, message: string): MoyeError { return new MoyeError({ code, category: "VALIDATION", message }); }
function gitReadError(code: string, result: GitCommandResult): MoyeError {
  return new MoyeError({ code, category: "TRANSIENT_IO", retryable: true, message: result.stderr.trim() || code });
}
