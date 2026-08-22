import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { parse, stringify } from "yaml";

import { MoyeError } from "../domain/errors.js";
import { assertTaskId } from "../domain/task.js";

const execFileAsync = promisify(execFile);

export interface SealedTaskInput {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
  readonly specRevision: number;
  readonly backlogRefs: readonly string[];
  readonly baseCommit: string;
  readonly archivedAt: string;
  readonly executorId: string;
}

export interface SealIntent {
  readonly taskId: string;
  readonly specRevision: number;
  readonly baseCommit: string;
  readonly activePath: string;
  readonly archivePath: string;
  readonly verificationPath: string;
  readonly docsImpactPath: string;
  readonly intentDigest: string;
  readonly token: string;
}

export interface SealEvidence {
  readonly token: string;
  readonly resultCommit: string;
  readonly executorId: string;
  readonly verificationPath: string;
  readonly docsImpactPath: string;
}

export interface SealReceipt {
  readonly taskId: string;
  readonly specRevision: number;
  readonly baseCommit: string;
  readonly resultCommit: string;
  readonly resultTree: string;
  readonly archivePath: string;
  readonly packageDigest: string;
  readonly verifiedAt: string;
}

export async function createSealIntent(
  repositoryRootInput: string,
  input: SealedTaskInput,
): Promise<SealIntent> {
  assertTaskId(input.taskId);
  assertCommit(input.baseCommit, "baseCommit");
  if (!Number.isInteger(input.specRevision) || input.specRevision < 1) {
    throw sealError("SEAL_SPEC_REVISION_INVALID", "specRevision must be a positive integer");
  }
  const archivedDate = input.archivedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(archivedDate) || Number.isNaN(Date.parse(input.archivedAt))) {
    throw sealError("SEAL_ARCHIVE_DATE_INVALID", "archivedAt must be an ISO date-time");
  }
  const repositoryRoot = await realpath(repositoryRootInput);
  const head = (await gitOutput(repositoryRoot, ["rev-parse", "HEAD"])).trim();
  if (head !== input.baseCommit) {
    throw sealError(
      "SEAL_BASE_NOT_HEAD",
      `Task ${input.taskId} base ${input.baseCommit} is not current HEAD ${head}`,
    );
  }
  const activePath = `docs/delivery/tasks/${input.taskId}`;
  const archivePath = `docs/delivery/tasks/archive/${archivedDate}-${input.taskId}`;
  await assertPhysicalDirectory(repositoryRoot, activePath);
  const manifestPath = await containedFile(repositoryRoot, `${activePath}/task.yaml`);
  const manifest = parse(await readFile(manifestPath, "utf8"), { maxAliasCount: 0 }) as Record<string, unknown>;
  if (manifest["id"] !== input.taskId || manifest["spec_revision"] !== input.specRevision ||
      manifest["execution_mode"] !== "sealed-result-commit" || manifest["base_commit"] !== input.baseCommit) {
    throw sealError(
      "SEAL_MANIFEST_MISMATCH",
      `Task manifest does not freeze ${input.taskId} revision ${input.specRevision} on ${input.baseCommit}`,
    );
  }
  await assertMissing(repositoryRoot, archivePath);
  const stable = {
    taskId: input.taskId,
    specRevision: input.specRevision,
    baseCommit: input.baseCommit,
    activePath,
    archivePath,
    verificationPath: `${archivePath}/verification.md`,
    docsImpactPath: `${archivePath}/docs-impact.yaml`,
  };
  const intentDigest = digest(stable);
  return { ...stable, intentDigest, token: digest({ intentDigest, purpose: "submit-result-commit" }) };
}

export async function stageSealedTaskPackage(
  repositoryRootInput: string,
  intent: SealIntent,
): Promise<void> {
  const repositoryRoot = await realpath(repositoryRootInput);
  verifyIntentShape(intent);
  const source = path.resolve(repositoryRoot, intent.activePath);
  const target = path.resolve(repositoryRoot, intent.archivePath);
  assertDirectTaskPaths(repositoryRoot, source, target, intent.taskId);

  if (await exists(target)) {
    if (await exists(source)) {
      throw sealError("SEAL_PACKAGE_CONFLICT", "Both active and archive Task packages exist");
    }
    await assertPhysicalDirectory(repositoryRoot, intent.archivePath);
    await assertPreparedManifest(target, intent);
    return;
  }
  await assertPhysicalDirectory(repositoryRoot, intent.activePath);
  const manifestPath = await containedFile(repositoryRoot, `${intent.activePath}/task.yaml`);
  const manifest = parse(await readFile(manifestPath, "utf8"), { maxAliasCount: 0 }) as Record<string, unknown>;
  assertManifestIdentity(manifest, intent);
  const archive = asRecord(manifest["archive"]);
  const prepared = stringify({
    ...manifest,
    status: "seal_prepared",
    seal: {
      status: "prepared",
      intent_digest: intent.intentDigest,
      base_commit: intent.baseCommit,
      archive_path: intent.archivePath,
    },
    archive: {
      ...archive,
      status: "prepared",
      archived_at: null,
      archived_path: intent.archivePath,
    },
  }, { lineWidth: 0 });
  await writeFile(manifestPath, prepared);
  await mkdir(path.dirname(target), { recursive: true });
  await rename(source, target);
}

export async function verifySealedResultCommit(
  repositoryRootInput: string,
  intent: SealIntent,
  evidence: SealEvidence,
  verifiedAt: string,
): Promise<SealReceipt> {
  const repositoryRoot = await realpath(repositoryRootInput);
  verifyIntentShape(intent);
  assertCommit(evidence.resultCommit, "resultCommit");
  if (evidence.token !== intent.token || evidence.verificationPath !== intent.verificationPath ||
      evidence.docsImpactPath !== intent.docsImpactPath || !evidence.executorId.trim()) {
    throw sealError("SEAL_EVIDENCE_SCOPE_INVALID", "Commit Evidence does not match the frozen Seal Intent");
  }
  await git(repositoryRoot, ["cat-file", "-e", `${evidence.resultCommit}^{commit}`]);
  const head = (await gitOutput(repositoryRoot, ["rev-parse", "HEAD"])).trim();
  if (head !== evidence.resultCommit) {
    throw sealError("SEAL_RESULT_NOT_HEAD", `Result Commit ${evidence.resultCommit} is not current HEAD ${head}`);
  }
  const parents = (await gitOutput(repositoryRoot, ["show", "-s", "--format=%P", evidence.resultCommit]))
    .trim().split(/\s+/).filter(Boolean);
  if (parents.length !== 1 || parents[0] !== intent.baseCommit) {
    throw sealError(
      "SEAL_RESULT_PARENT_INVALID",
      `Result Commit must have exactly one parent ${intent.baseCommit}; got ${parents.join(",") || "none"}`,
    );
  }
  const dirty = await gitOutput(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty.trim()) throw sealError("SEAL_WORKTREE_DIRTY", `Result Commit requires a clean worktree: ${dirty.trim()}`);
  await assertMissing(repositoryRoot, intent.activePath);
  await assertPhysicalDirectory(repositoryRoot, intent.archivePath);
  const archiveRoot = await containedDirectory(repositoryRoot, intent.archivePath);
  const manifestPath = await containedFile(repositoryRoot, `${intent.archivePath}/task.yaml`);
  const manifestContent = await readFile(manifestPath, "utf8");
  await assertCommittedContent(repositoryRoot, evidence.resultCommit, `${intent.archivePath}/task.yaml`, manifestContent);
  const manifest = parse(manifestContent, { maxAliasCount: 0 }) as Record<string, unknown>;
  assertManifestIdentity(manifest, intent);
  const seal = asRecord(manifest["seal"]);
  if (manifest["status"] !== "seal_prepared" || seal["status"] !== "prepared" ||
      seal["intent_digest"] !== intent.intentDigest || seal["archive_path"] !== intent.archivePath) {
    throw sealError("SEAL_MANIFEST_NOT_PREPARED", "Committed Task manifest is not bound to the Seal Intent");
  }
  const verificationPath = await containedFile(repositoryRoot, intent.verificationPath);
  const verification = await readFile(verificationPath, "utf8");
  await assertCommittedContent(repositoryRoot, evidence.resultCommit, intent.verificationPath, verification);
  if (!/^> 状态：Accepted\s*$/mu.test(verification)) {
    throw sealError("SEAL_VERIFICATION_NOT_ACCEPTED", "Verification Artifact is not Accepted");
  }
  const impactPath = await containedFile(repositoryRoot, intent.docsImpactPath);
  const impactContent = await readFile(impactPath, "utf8");
  await assertCommittedContent(repositoryRoot, evidence.resultCommit, intent.docsImpactPath, impactContent);
  const impact = parse(impactContent, { maxAliasCount: 0 }) as Record<string, unknown>;
  if (impact["task_id"] !== intent.taskId) {
    throw sealError("SEAL_IMPACT_TASK_MISMATCH", "Docs Impact is not bound to the sealed Task");
  }
  const declared = new Set(Array.isArray(impact["changed_paths"])
    ? impact["changed_paths"].filter((value): value is string => typeof value === "string")
    : []);
  const changed = (await gitOutput(repositoryRoot, [
    "diff", "--name-only", `${intent.baseCommit}..${evidence.resultCommit}`,
  ])).split("\n").filter(Boolean);
  const missing = changed.filter((changedPath) => !declared.has(changedPath));
  if (missing.length > 0) {
    throw sealError("SEAL_IMPACT_INCOMPLETE", `Docs Impact does not cover changed paths: ${missing.join(", ")}`);
  }
  await command(repositoryRoot, "ruby", ["scripts/docs_graph.rb", "validate-impact", "--report", impactPath]);
  const resultTree = (await gitOutput(repositoryRoot, ["show", "-s", "--format=%T", evidence.resultCommit])).trim();
  const files = (await gitOutput(repositoryRoot, ["ls-tree", "-r", "--full-tree", evidence.resultCommit, intent.archivePath]))
    .split("\n").filter(Boolean);
  return {
    taskId: intent.taskId,
    specRevision: intent.specRevision,
    baseCommit: intent.baseCommit,
    resultCommit: evidence.resultCommit,
    resultTree,
    archivePath: path.relative(repositoryRoot, archiveRoot).split(path.sep).join("/"),
    packageDigest: digest(files),
    verifiedAt,
  };
}

function verifyIntentShape(intent: SealIntent): void {
  assertTaskId(intent.taskId);
  assertCommit(intent.baseCommit, "baseCommit");
  const stable = {
    taskId: intent.taskId,
    specRevision: intent.specRevision,
    baseCommit: intent.baseCommit,
    activePath: intent.activePath,
    archivePath: intent.archivePath,
    verificationPath: intent.verificationPath,
    docsImpactPath: intent.docsImpactPath,
  };
  if (digest(stable) !== intent.intentDigest || digest({ intentDigest: intent.intentDigest, purpose: "submit-result-commit" }) !== intent.token) {
    throw sealError("SEAL_INTENT_INVALID", "Seal Intent digest or token is invalid");
  }
}

function assertManifestIdentity(manifest: Record<string, unknown>, intent: SealIntent): void {
  if (manifest["id"] !== intent.taskId || manifest["spec_revision"] !== intent.specRevision ||
      manifest["execution_mode"] !== "sealed-result-commit" || manifest["base_commit"] !== intent.baseCommit) {
    throw sealError("SEAL_MANIFEST_MISMATCH", "Task manifest identity does not match the Seal Intent");
  }
}

async function assertPreparedManifest(target: string, intent: SealIntent): Promise<void> {
  const manifest = parse(await readFile(path.join(target, "task.yaml"), "utf8"), { maxAliasCount: 0 }) as Record<string, unknown>;
  assertManifestIdentity(manifest, intent);
  if (asRecord(manifest["seal"])["intent_digest"] !== intent.intentDigest) {
    throw sealError("SEAL_PACKAGE_CONFLICT", "Existing archive package has a different Seal Intent");
  }
}

function assertDirectTaskPaths(repositoryRoot: string, source: string, target: string, taskId: string): void {
  const activeRoot = path.join(repositoryRoot, "docs", "delivery", "tasks");
  const archiveRoot = path.join(activeRoot, "archive");
  if (path.dirname(source) !== activeRoot || path.basename(source) !== taskId ||
      path.dirname(target) !== archiveRoot || !path.basename(target).endsWith(`-${taskId}`)) {
    throw sealError("SEAL_PATH_INVALID", "Seal paths must be direct children of the managed Task roots");
  }
}

async function assertMissing(root: string, relativePath: string): Promise<void> {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw sealError("SEAL_PATH_ESCAPE", `Path escapes repository: ${relativePath}`);
  }
  if (await exists(resolved)) throw sealError("SEAL_PATH_CONFLICT", `Path already exists: ${relativePath}`);
}

async function containedFile(root: string, relativePath: string): Promise<string> {
  const resolved = await containedExisting(root, relativePath);
  if (!(await stat(resolved)).isFile()) throw sealError("SEAL_NOT_FILE", `Expected file: ${relativePath}`);
  return resolved;
}

async function containedDirectory(root: string, relativePath: string): Promise<string> {
  const resolved = await containedExisting(root, relativePath);
  if (!(await stat(resolved)).isDirectory()) throw sealError("SEAL_NOT_DIRECTORY", `Expected directory: ${relativePath}`);
  return resolved;
}

async function assertPhysicalDirectory(root: string, relativePath: string): Promise<void> {
  const logical = path.resolve(root, relativePath);
  const physical = await realpath(logical);
  if (physical !== logical || !(await stat(physical)).isDirectory()) {
    throw sealError("SEAL_PACKAGE_PATH_INVALID", `Task package must be a physical directory: ${relativePath}`);
  }
}

async function containedExisting(root: string, relativePath: string): Promise<string> {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw sealError("SEAL_PATH_INVALID", `Path must stay inside repository: ${relativePath}`);
  }
  const resolved = await realpath(path.resolve(root, relativePath));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw sealError("SEAL_PATH_ESCAPE", `Path escapes repository: ${relativePath}`);
  }
  return resolved;
}

async function assertCommittedContent(root: string, commitId: string, relativePath: string, content: string): Promise<void> {
  const committed = await gitOutput(root, ["show", `${commitId}:${relativePath}`]);
  if (committed !== content) throw sealError("SEAL_EVIDENCE_NOT_COMMITTED", `Evidence differs from ${commitId}:${relativePath}`);
}

async function git(root: string, args: readonly string[]): Promise<void> {
  await command(root, "git", ["-C", root, ...args]);
}

async function gitOutput(root: string, args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", root, ...args], {
      cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    throw sealError("SEAL_GIT_CHECK_FAILED", `git ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function command(root: string, executable: string, args: readonly string[]): Promise<void> {
  try {
    await execFileAsync(executable, [...args], { cwd: root, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    throw sealError("SEAL_GATE_FAILED", `${executable} ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertCommit(value: string, name: string): void {
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)) throw sealError("SEAL_COMMIT_INVALID", `${name} is not a Git commit id`);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function sealError(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "CONFLICT", message });
}
