import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { MoyeError } from "../domain/errors.js";
import { assertTaskId } from "../domain/task.js";

const trustedRequests = new WeakSet<object>();
const trustedCheckpoints = new WeakSet<object>();

export interface GitInvocation {
  readonly executable: "git";
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly shell: false;
}

export interface GitCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitCommandRunner {
  run(invocation: GitInvocation): Promise<GitCommandResult>;
}

export interface WorkspaceEffectInput {
  readonly taskId: string;
  readonly specRevision: number;
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly baseRef: string;
  readonly baseSha: string;
}

export interface WorkspaceEffectRequest {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly repositoryRoot: string;
  readonly gitCommonDir: string;
  readonly worktreeRoot: string;
  readonly worktreePath: string;
  readonly baseRef: string;
  readonly baseSha: string;
  readonly branchName: string;
  readonly branchRef: string;
  readonly effectId: string;
}

export type WorkspaceReconcileState = "ABSENT" | "APPLIED" | "CONFLICT";

export interface WorkspaceReconcileResult {
  readonly state: WorkspaceReconcileState;
  readonly code: string;
  readonly message: string;
  readonly headSha?: string;
}

export interface WorkspaceEffectResult {
  readonly effectId: string;
  readonly outcome: "APPLIED" | "ALREADY_APPLIED" | "CONFLICT";
  readonly worktreePath: string;
  readonly branchName: string;
  readonly headSha?: string;
  readonly reconcileCode: string;
  readonly reconciledAfterUnknown: boolean;
}

export interface GitCheckpoint {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly workspaceEffectId: string;
  readonly baseSha: string;
  readonly branchName: string;
  readonly commitSha: string;
  readonly treeDigest: string;
  readonly createdAt: string;
  readonly checkpointDigest: string;
}

interface WorktreeFact {
  readonly worktreePath: string;
  readonly headSha?: string;
  readonly branchRef?: string;
  readonly prunable: boolean;
}

export const nodeGitCommandRunner: GitCommandRunner = Object.freeze({
  run(invocation: GitInvocation): Promise<GitCommandResult> {
    if (invocation.executable !== "git" || invocation.shell !== false) {
      return Promise.reject(validation("UNSAFE_GIT_INVOCATION", "Git must execute as argv with shell=false"));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(invocation.executable, [...invocation.argv], {
        cwd: invocation.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve(Object.freeze({
        exitCode: code ?? 1,
        stdout,
        stderr,
      })));
    });
  },
});

export async function createWorkspaceEffectRequest(input: WorkspaceEffectInput): Promise<WorkspaceEffectRequest> {
  assertTaskId(input.taskId);
  assertPositiveInteger(input.specRevision, "specRevision");
  assertObjectId(input.baseSha, "baseSha");
  assertRefName(input.baseRef, "baseRef");

  const repositoryRoot = await realpath(path.resolve(input.repositoryRoot));
  await assertRepositoryRoot(repositoryRoot);
  const gitCommonDir = await readGitCommonDir(repositoryRoot);
  const worktreeRoot = await resolveManagedRoot(input.worktreeRoot);
  if (worktreeRoot === path.parse(worktreeRoot).root) {
    throw validation("UNSAFE_WORKTREE_ROOT", "Filesystem root cannot be used as the managed Worktree Root");
  }
  const worktreePath = path.resolve(worktreeRoot, input.taskId);
  assertDirectChild(worktreeRoot, worktreePath);
  if (isSameOrWithin(gitCommonDir, worktreeRoot) || isSameOrWithin(gitCommonDir, worktreePath)) {
    throw validation("WORKTREE_IN_GIT_METADATA", "Managed Worktree paths cannot be inside the Git common directory");
  }
  if (worktreePath === repositoryRoot || worktreeRoot === repositoryRoot) {
    throw validation("UNSAFE_WORKTREE_ROOT", "Managed worktrees cannot replace the repository root");
  }
  await rejectSymlinkIfPresent(worktreePath);

  const effectCore = {
    schemaVersion: 1 as const,
    taskId: input.taskId,
    specRevision: input.specRevision,
    repositoryRoot,
    gitCommonDir,
    worktreeRoot,
    worktreePath,
    baseRef: input.baseRef,
    baseSha: input.baseSha,
  };
  const effectId = digest("git-worktree-effect", effectCore);
  const effectToken = effectId.slice(effectId.lastIndexOf(":") + 1);
  const branchName = `task/${input.taskId}/r${input.specRevision}-${effectToken}`;
  const branchRef = `refs/heads/${branchName}`;
  const canonical = {
    ...effectCore,
    branchName,
    branchRef,
  };
  const request = deepFreeze({
    ...canonical,
    effectId,
  });
  trustedRequests.add(request);
  return request;
}

export async function parseWorkspaceEffectRequest(
  value: unknown,
  expectedEffectId: string,
): Promise<WorkspaceEffectRequest> {
  const input = asRecord(value, "WorkspaceEffectRequest");
  if (input["effectId"] !== expectedEffectId) {
    throw validation("WORKSPACE_EFFECT_ID_MISMATCH", "Workspace Effect does not match the externally expected ID");
  }
  const rebuilt = await createWorkspaceEffectRequest({
    taskId: readString(input, "taskId"),
    specRevision: readNumber(input, "specRevision"),
    repositoryRoot: readString(input, "repositoryRoot"),
    worktreeRoot: readString(input, "worktreeRoot"),
    baseRef: readString(input, "baseRef"),
    baseSha: readString(input, "baseSha"),
  });
  if (rebuilt.effectId !== expectedEffectId
      || input["worktreePath"] !== rebuilt.worktreePath
      || input["gitCommonDir"] !== rebuilt.gitCommonDir
      || input["branchName"] !== rebuilt.branchName
      || input["branchRef"] !== rebuilt.branchRef
      || input["schemaVersion"] !== 1) {
    throw validation("WORKSPACE_EFFECT_TAMPERED", "Serialized Workspace Effect differs from its canonical request");
  }
  return rebuilt;
}

export async function reconcileWorkspaceEffect(
  request: WorkspaceEffectRequest,
  runner: GitCommandRunner = nodeGitCommandRunner,
): Promise<WorkspaceReconcileResult> {
  assertTrustedRequest(request);
  await assertPathsStillSafe(request);
  const [worktrees, branchSha] = await Promise.all([
    readWorktrees(request, runner),
    readOptionalRef(request, request.branchRef, runner),
  ]);
  const target = worktrees.find((item) => item.worktreePath === request.worktreePath);
  const branchOwner = worktrees.find((item) => item.branchRef === request.branchRef);

  if (!target && !branchSha && !branchOwner) {
    if (await pathExists(request.worktreePath)) {
      return frozenReconcile("CONFLICT", "UNREGISTERED_WORKTREE_PATH", "Target path exists but is not a registered Git worktree");
    }
    return frozenReconcile("ABSENT", "WORKSPACE_ABSENT", "No task branch or managed worktree exists");
  }
  if (!target) {
    return frozenReconcile("CONFLICT", "TASK_BRANCH_ALREADY_EXISTS", "Task branch exists outside the expected worktree");
  }
  if (target.prunable || !(await isRealDirectory(request.worktreePath))) {
    return frozenReconcile("CONFLICT", "STALE_WORKTREE_REGISTRATION", "Git metadata points to a missing or prunable Worktree", target.headSha);
  }
  if (target.branchRef !== request.branchRef) {
    return frozenReconcile("CONFLICT", "WORKTREE_BRANCH_CONFLICT", "Target path is registered to another branch", target.headSha);
  }
  if (!branchSha || !target.headSha || branchSha !== target.headSha) {
    return frozenReconcile("CONFLICT", "WORKTREE_HEAD_CONFLICT", "Task branch and worktree HEAD do not agree", target.headSha);
  }
  const ancestry = await git(request, ["merge-base", "--is-ancestor", request.baseSha, branchSha], runner);
  if (ancestry.exitCode !== 0) {
    return frozenReconcile("CONFLICT", "BASE_NOT_ANCESTOR", "Task branch no longer descends from the frozen Base", branchSha);
  }
  return frozenReconcile("APPLIED", "WORKSPACE_MATCHED", "Task branch and worktree match the effect", branchSha);
}

export async function applyWorkspaceEffect(
  request: WorkspaceEffectRequest,
  runner: GitCommandRunner = nodeGitCommandRunner,
): Promise<WorkspaceEffectResult> {
  assertTrustedRequest(request);
  const before = await reconcileWorkspaceEffect(request, runner);
  if (before.state === "APPLIED") return effectResult(request, "ALREADY_APPLIED", before, false);
  if (before.state === "CONFLICT") return effectResult(request, "CONFLICT", before, false);

  const baseExists = await git(request, ["cat-file", "-e", `${request.baseSha}^{commit}`], runner);
  if (baseExists.exitCode !== 0) {
    return effectResult(request, "CONFLICT", frozenReconcile(
      "CONFLICT", "BASE_COMMIT_MISSING", "Frozen Base commit does not exist",
    ), false);
  }
  const currentBase = await readOptionalRef(request, request.baseRef, runner);
  if (currentBase !== request.baseSha) {
    return effectResult(request, "CONFLICT", frozenReconcile(
      "CONFLICT", "BASE_REF_DRIFT", "Base Ref no longer points at the frozen Base", currentBase,
    ), false);
  }

  await mkdir(request.worktreeRoot, { recursive: true });
  await assertPathsStillSafe(request);
  let invocationFailed = false;
  let invocationResult: GitCommandResult | undefined;
  try {
    invocationResult = await git(request, [
      "worktree", "add", "-b", request.branchName, request.worktreePath, request.baseSha,
    ], runner);
    invocationFailed = invocationResult.exitCode !== 0;
  } catch {
    invocationFailed = true;
  }

  let after: WorkspaceReconcileResult;
  try {
    after = await reconcileWorkspaceEffect(request, runner);
  } catch (error) {
    throw new MoyeError({
      code: "WORKSPACE_EFFECT_UNKNOWN",
      category: "UNKNOWN_SIDE_EFFECT",
      message: "Git result is unknown and reconciliation could not read authoritative facts",
      retryable: true,
      details: { effectId: request.effectId },
      cause: error,
    });
  }
  if (after.state === "APPLIED") {
    return effectResult(request, invocationFailed ? "ALREADY_APPLIED" : "APPLIED", after, invocationFailed);
  }
  if (after.state === "CONFLICT") return effectResult(request, "CONFLICT", after, invocationFailed);
  if (invocationFailed) {
    throw new MoyeError({
      code: "GIT_WORKTREE_ADD_FAILED",
      category: "TRANSIENT_IO",
      message: "Git worktree creation failed and reconciliation confirmed no side effect",
      retryable: true,
      details: {
        effectId: request.effectId,
        stderr: invocationResult?.stderr.trim() ?? "runner failed before returning a result",
      },
    });
  }
  throw new MoyeError({
    code: "GIT_WORKTREE_POSTCONDITION_FAILED",
    category: "UNKNOWN_SIDE_EFFECT",
    message: "Git reported success but the workspace effect is absent",
    retryable: true,
    details: { effectId: request.effectId },
  });
}

export async function createGitCheckpoint(
  request: WorkspaceEffectRequest,
  createdAt: string,
  runner: GitCommandRunner = nodeGitCommandRunner,
): Promise<GitCheckpoint> {
  assertTrustedRequest(request);
  assertIsoInstant(createdAt);
  const state = await reconcileWorkspaceEffect(request, runner);
  if (state.state !== "APPLIED" || !state.headSha) {
    throw new MoyeError({
      code: "WORKSPACE_NOT_CHECKPOINTABLE",
      category: "CONFLICT",
      message: `Cannot checkpoint workspace in ${state.state} state: ${state.code}`,
      details: { effectId: request.effectId, reconcileCode: state.code },
    });
  }
  const clean = await gitAt(request.worktreePath, ["status", "--porcelain=v2", "--untracked-files=all", "-z"], runner);
  if (clean.exitCode !== 0) throw gitReadError("GIT_STATUS_FAILED", clean);
  if (clean.stdout.length > 0) {
    throw conflict("DIRTY_WORKTREE", "Checkpoint requires a clean Worktree with no tracked or untracked changes");
  }
  const commit = await requireObjectId(request, ["rev-parse", "--verify", `${request.branchRef}^{commit}`], runner, "RESULT_COMMIT_MISSING");
  if (commit !== state.headSha) {
    throw conflict("RESULT_COMMIT_MOVED", "Task branch moved while creating its Checkpoint");
  }
  const ancestry = await git(request, ["merge-base", "--is-ancestor", request.baseSha, commit], runner);
  if (ancestry.exitCode !== 0) throw conflict("RESULT_NOT_DESCENDANT", "Result Commit does not descend from frozen Base");
  const treeDigest = await requireObjectId(request, ["rev-parse", "--verify", `${commit}^{tree}`], runner, "RESULT_TREE_MISSING");
  const canonical = {
    schemaVersion: 1 as const,
    taskId: request.taskId,
    specRevision: request.specRevision,
    workspaceEffectId: request.effectId,
    baseSha: request.baseSha,
    branchName: request.branchName,
    commitSha: commit,
    treeDigest,
    createdAt,
  };
  const checkpoint = deepFreeze({
    ...canonical,
    checkpointDigest: digest("git-checkpoint", canonical),
  });
  trustedCheckpoints.add(checkpoint);
  return checkpoint;
}

export function parseGitCheckpoint(value: unknown, expectedDigest: string): GitCheckpoint {
  const input = asRecord(value, "GitCheckpoint");
  const canonical = {
    schemaVersion: 1 as const,
    taskId: readString(input, "taskId"),
    specRevision: readNumber(input, "specRevision"),
    workspaceEffectId: readString(input, "workspaceEffectId"),
    baseSha: readString(input, "baseSha"),
    branchName: readString(input, "branchName"),
    commitSha: readString(input, "commitSha"),
    treeDigest: readString(input, "treeDigest"),
    createdAt: readString(input, "createdAt"),
  };
  assertTaskId(canonical.taskId);
  assertPositiveInteger(canonical.specRevision, "specRevision");
  assertObjectId(canonical.baseSha, "baseSha");
  assertObjectId(canonical.commitSha, "commitSha");
  assertObjectId(canonical.treeDigest, "treeDigest");
  assertIsoInstant(canonical.createdAt);
  const actualDigest = digest("git-checkpoint", canonical);
  if (input["schemaVersion"] !== 1 || input["checkpointDigest"] !== expectedDigest || actualDigest !== expectedDigest) {
    throw validation("CHECKPOINT_DIGEST_MISMATCH", "Git Checkpoint does not match the externally expected digest");
  }
  const checkpoint = deepFreeze({ ...canonical, checkpointDigest: actualDigest });
  trustedCheckpoints.add(checkpoint);
  return checkpoint;
}

export async function validateGitCheckpoint(
  request: WorkspaceEffectRequest,
  checkpoint: GitCheckpoint,
  runner: GitCommandRunner = nodeGitCommandRunner,
): Promise<void> {
  assertTrustedRequest(request);
  if (!trustedCheckpoints.has(checkpoint)
      || checkpoint.taskId !== request.taskId
      || checkpoint.specRevision !== request.specRevision
      || checkpoint.workspaceEffectId !== request.effectId
      || checkpoint.baseSha !== request.baseSha
      || checkpoint.branchName !== request.branchName) {
    throw validation("CHECKPOINT_BINDING_MISMATCH", "Checkpoint is not bound to this Workspace Effect");
  }
  const currentCommit = await requireObjectId(request, ["rev-parse", "--verify", `${request.branchRef}^{commit}`], runner, "RESULT_COMMIT_MISSING");
  const currentTree = await requireObjectId(request, ["rev-parse", "--verify", `${checkpoint.commitSha}^{tree}`], runner, "RESULT_TREE_MISSING");
  const ancestry = await git(request, ["merge-base", "--is-ancestor", request.baseSha, checkpoint.commitSha], runner);
  if (currentCommit !== checkpoint.commitSha || currentTree !== checkpoint.treeDigest || ancestry.exitCode !== 0) {
    throw conflict("CHECKPOINT_GIT_FACT_MISMATCH", "Checkpoint no longer matches Git branch, ancestry, or tree facts");
  }
}

async function assertPathsStillSafe(request: WorkspaceEffectRequest): Promise<void> {
  const repositoryRoot = await realpath(request.repositoryRoot);
  await assertRepositoryRoot(repositoryRoot);
  const gitCommonDir = await readGitCommonDir(repositoryRoot);
  const worktreeRoot = await resolveManagedRoot(request.worktreeRoot);
  if (repositoryRoot !== request.repositoryRoot || gitCommonDir !== request.gitCommonDir || worktreeRoot !== request.worktreeRoot) {
    throw validation("WORKSPACE_ROOT_CHANGED", "Repository or managed Worktree Root changed after the Effect was created");
  }
  if (isSameOrWithin(gitCommonDir, worktreeRoot) || isSameOrWithin(gitCommonDir, request.worktreePath)) {
    throw validation("WORKTREE_IN_GIT_METADATA", "Managed Worktree paths cannot be inside the Git common directory");
  }
  assertDirectChild(worktreeRoot, request.worktreePath);
  await rejectSymlinkIfPresent(request.worktreePath);
}

async function readGitCommonDir(repositoryRoot: string): Promise<string> {
  const result = await gitAt(repositoryRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"], nodeGitCommandRunner);
  if (result.exitCode !== 0) throw gitReadError("GIT_COMMON_DIR_READ_FAILED", result);
  const commonDir = result.stdout.trim();
  if (!path.isAbsolute(commonDir)) throw validation("INVALID_GIT_COMMON_DIR", "Git common directory must resolve to an absolute path");
  return realpath(commonDir);
}

async function assertRepositoryRoot(repositoryRoot: string): Promise<void> {
  try {
    const gitEntry = await lstat(path.join(repositoryRoot, ".git"));
    if (gitEntry.isSymbolicLink() || (!gitEntry.isDirectory() && !gitEntry.isFile())) {
      throw validation("INVALID_REPOSITORY_ROOT", "Repository Root must contain a Git directory or gitfile");
    }
  } catch (error) {
    if (isNotFound(error)) {
      throw validation("INVALID_REPOSITORY_ROOT", "repositoryRoot must be the Git worktree top-level");
    }
    throw error;
  }
}

async function resolveManagedRoot(input: string): Promise<string> {
  const absolute = path.resolve(input);
  let cursor = absolute;
  const suffix: string[] = [];
  while (true) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw validation("WORKTREE_ROOT_SYMLINK", "Managed Worktree Root cannot traverse a symbolic link");
      const physical = await realpath(cursor);
      return path.join(physical, ...suffix.reverse());
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw validation("WORKTREE_ROOT_UNRESOLVABLE", "Cannot resolve managed Worktree Root");
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function rejectSymlinkIfPresent(target: string): Promise<void> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw validation("WORKTREE_PATH_SYMLINK", "Worktree target cannot be a symbolic link");
    const physical = await realpath(target);
    if (physical !== target) throw validation("WORKTREE_PATH_ESCAPE", "Worktree target resolves outside its canonical path");
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function assertDirectChild(root: string, target: string): void {
  if (path.dirname(target) !== root || path.basename(target) === "" || !target.startsWith(`${root}${path.sep}`)) {
    throw validation("WORKTREE_PATH_ESCAPE", "Worktree target must be a direct child of the managed root");
  }
}

async function readWorktrees(request: WorkspaceEffectRequest, runner: GitCommandRunner): Promise<readonly WorktreeFact[]> {
  const result = await git(request, ["worktree", "list", "--porcelain", "-z"], runner);
  if (result.exitCode !== 0) throw gitReadError("GIT_WORKTREE_LIST_FAILED", result);
  const tokens = result.stdout.split("\0").filter((token) => token.length > 0);
  const facts: WorktreeFact[] = [];
  let current: { worktreePath?: string; headSha?: string; branchRef?: string; prunable?: boolean } = {};
  for (const token of tokens) {
    if (token.startsWith("worktree ")) {
      if (current.worktreePath) facts.push(freezeFact(current));
      current = { worktreePath: path.resolve(token.slice("worktree ".length)) };
    } else if (token.startsWith("HEAD ")) {
      current.headSha = token.slice("HEAD ".length);
    } else if (token.startsWith("branch ")) {
      current.branchRef = token.slice("branch ".length);
    } else if (token === "prunable" || token.startsWith("prunable ")) {
      current.prunable = true;
    }
  }
  if (current.worktreePath) facts.push(freezeFact(current));
  return Object.freeze(facts);
}

function freezeFact(input: { worktreePath?: string; headSha?: string; branchRef?: string; prunable?: boolean }): WorktreeFact {
  if (!input.worktreePath) throw validation("INVALID_WORKTREE_FACT", "Git worktree record has no path");
  return Object.freeze({
    worktreePath: input.worktreePath,
    ...(input.headSha ? { headSha: input.headSha } : {}),
    ...(input.branchRef ? { branchRef: input.branchRef } : {}),
    prunable: input.prunable === true,
  });
}

async function readOptionalRef(
  request: WorkspaceEffectRequest,
  ref: string,
  runner: GitCommandRunner,
): Promise<string | undefined> {
  const result = await git(request, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], runner);
  if (result.exitCode === 1) return undefined;
  if (result.exitCode !== 0) throw gitReadError("GIT_REF_READ_FAILED", result);
  const value = result.stdout.trim();
  assertObjectId(value, "Git ref");
  return value;
}

async function requireObjectId(
  request: WorkspaceEffectRequest,
  argv: readonly string[],
  runner: GitCommandRunner,
  code: string,
): Promise<string> {
  const result = await git(request, argv, runner);
  if (result.exitCode !== 0) throw conflict(code, result.stderr.trim() || `${argv.join(" ")} failed`);
  const value = result.stdout.trim();
  assertObjectId(value, "Git object");
  return value;
}

function git(request: WorkspaceEffectRequest, argv: readonly string[], runner: GitCommandRunner): Promise<GitCommandResult> {
  return gitAt(request.repositoryRoot, argv, runner);
}

function gitAt(cwd: string, argv: readonly string[], runner: GitCommandRunner): Promise<GitCommandResult> {
  return runner.run(Object.freeze({ executable: "git", argv: Object.freeze([...argv]), cwd, shell: false }));
}

function effectResult(
  request: WorkspaceEffectRequest,
  outcome: WorkspaceEffectResult["outcome"],
  reconcile: WorkspaceReconcileResult,
  reconciledAfterUnknown: boolean,
): WorkspaceEffectResult {
  return deepFreeze({
    effectId: request.effectId,
    outcome,
    worktreePath: request.worktreePath,
    branchName: request.branchName,
    ...(reconcile.headSha ? { headSha: reconcile.headSha } : {}),
    reconcileCode: reconcile.code,
    reconciledAfterUnknown,
  });
}

function frozenReconcile(
  state: WorkspaceReconcileState,
  code: string,
  message: string,
  headSha?: string,
): WorkspaceReconcileResult {
  return deepFreeze({ state, code, message, ...(headSha ? { headSha } : {}) });
}

function assertTrustedRequest(request: WorkspaceEffectRequest): void {
  if (!trustedRequests.has(request)) {
    throw validation("UNTRUSTED_WORKSPACE_EFFECT", "Workspace Effect must be created or parsed by this module");
  }
}

function assertObjectId(value: string, field: string): void {
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)) {
    throw validation("INVALID_GIT_OBJECT_ID", `${field} must be a full 40 or 64 character object ID`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw validation("INVALID_POSITIVE_INTEGER", `${field} must be a positive integer`);
}

function assertRefName(value: string, field: string): void {
  if (!value.startsWith("refs/heads/") || value === "refs/heads/"
      || value.startsWith("-") || value.includes("..") || value.includes("@{") || /[\s~^:?*[\\]/.test(value)) {
    throw validation("INVALID_GIT_REF", `${field} must be a canonical refs/heads/* name`);
  }
}

function assertIsoInstant(value: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw validation("INVALID_CHECKPOINT_TIME", "createdAt must be a canonical ISO instant");
  }
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

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw validation("INVALID_SERIALIZED_OBJECT", `${label} must be an object`);
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw validation("INVALID_SERIALIZED_FIELD", `${key} must be a non-empty string`);
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") throw validation("INVALID_SERIALIZED_FIELD", `${key} must be a number`);
  return value;
}

function validation(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "VALIDATION", message });
}

function conflict(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "CONFLICT", message });
}

function gitReadError(code: string, result: GitCommandResult): MoyeError {
  return new MoyeError({
    code,
    category: "TRANSIENT_IO",
    retryable: true,
    message: result.stderr.trim() || "Unable to read Git facts",
  });
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function isRealDirectory(target: string): Promise<boolean> {
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    return await realpath(target) === target;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isSameOrWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
