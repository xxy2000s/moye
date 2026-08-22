import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse, stringify } from "yaml";

import { assertTaskId } from "../domain/task.js";
import type { TaskExecutionEvidence, TaskProjection } from "../domain/task.js";
import { MoyeError } from "../domain/errors.js";
import { resolveTaskArtifactPath, taskArtifactRef } from "./task-artifacts.js";

const execFileAsync = promisify(execFile);

export interface BootstrapEvidenceVerificationInput {
  readonly repositoryRoot: string;
  readonly taskId: string;
  readonly evidence: TaskExecutionEvidence;
}

export interface BootstrapPreflightInput {
  readonly repositoryRoot: string;
  readonly taskId: string;
}

export interface BootstrapPreflightReceipt {
  readonly taskId: string;
  readonly manifestRef: string;
  readonly manifestCommit: string;
  readonly introductionCommit: string;
  readonly introductionParent: string;
  readonly baseCommit: string;
  readonly receiptDigest: string;
}

export interface BootstrapFailureInput extends BootstrapClosureInput {
  readonly errorCode: string;
  readonly errorCategory: string;
  readonly errorMessage: string;
  readonly failedStep: string;
  readonly sourceWorkflowRef?: string;
}

export interface BootstrapClosureInput {
  readonly activeTasksRoot: string;
  readonly task: TaskProjection;
  readonly evidence: TaskExecutionEvidence;
  readonly workflowId: string;
}

export interface VerifiedBootstrapClosureInput extends BootstrapClosureInput {
  readonly repositoryRoot: string;
}

export async function verifyAndPersistBootstrapClosure(
  input: VerifiedBootstrapClosureInput,
): Promise<void> {
  await verifyBootstrapEvidence({
    repositoryRoot: input.repositoryRoot,
    taskId: input.task.taskId,
    evidence: input.evidence,
  }, input);
  await persistBootstrapClosure(input);
}

export async function verifyBootstrapPreflight(
  input: BootstrapPreflightInput,
): Promise<BootstrapPreflightReceipt> {
  const repositoryRoot = await realpath(input.repositoryRoot);
  const manifestCommit = (await output(
    "git", ["-C", repositoryRoot, "rev-parse", "HEAD"], repositoryRoot,
  )).trim();
  const receipt = await inspectBootstrapBaseline(repositoryRoot, input.taskId, manifestCommit);
  const manifestPath = await containedFile(repositoryRoot, receipt.manifestRef);
  await assertCommittedContent(
    repositoryRoot,
    manifestCommit,
    receipt.manifestRef,
    await readFile(manifestPath, "utf8"),
  );
  return receipt;
}

export async function persistBootstrapClosure(input: BootstrapClosureInput): Promise<void> {
  assertTaskId(input.task.taskId);
  if (input.task.state !== "CLOSED" || input.task.outcome !== "SUCCEEDED") {
    throw new MoyeError({
      code: "BOOTSTRAP_TASK_NOT_CLOSED",
      category: "CONFLICT",
      message: `Task ${input.task.taskId} must be successfully CLOSED before closure evidence is persisted`,
    });
  }
  const root = path.resolve(input.activeTasksRoot);
  const taskRoot = path.resolve(root, input.task.taskId);
  if (path.dirname(taskRoot) !== root) {
    throw new MoyeError({
      code: "BOOTSTRAP_TASK_PATH_INVALID",
      category: "VALIDATION",
      message: "Bootstrap task path must be a direct child of activeTasksRoot",
    });
  }

  const taskPath = path.join(taskRoot, "task.yaml");
  const current = parse(await readFile(taskPath, "utf8"), { maxAliasCount: 0 }) as Record<string, unknown>;
  if (current["id"] !== input.task.taskId || current["spec_revision"] !== input.task.specRevision) {
    throw new MoyeError({
      code: "BOOTSTRAP_MANIFEST_MISMATCH",
      category: "CONFLICT",
      message: `Task manifest does not match ${input.task.taskId} revision ${input.task.specRevision}`,
    });
  }

  const artifacts = bootstrapClosureArtifacts(input, current);
  await writeStableFile(taskPath, artifacts.manifest);
  await writeStableFile(path.join(taskRoot, "bootstrap-runtime-evidence.json"), artifacts.runtimeEvidence);
}

export async function persistBootstrapFailure(input: BootstrapFailureInput): Promise<void> {
  assertTaskId(input.task.taskId);
  if (input.task.state !== "CLOSED" || input.task.outcome !== "FAILED_TERMINAL") {
    throw new MoyeError({
      code: "BOOTSTRAP_TASK_NOT_FAILED",
      category: "CONFLICT",
      message: `Task ${input.task.taskId} must be FAILED_TERMINAL before failure evidence is persisted`,
    });
  }
  const root = path.resolve(input.activeTasksRoot);
  const taskRoot = path.resolve(root, input.task.taskId);
  if (path.dirname(taskRoot) !== root) {
    throw new MoyeError({
      code: "BOOTSTRAP_TASK_PATH_INVALID",
      category: "VALIDATION",
      message: "Bootstrap task path must be a direct child of activeTasksRoot",
    });
  }
  const taskPath = path.join(taskRoot, "task.yaml");
  const current = parse(await readFile(taskPath, "utf8"), { maxAliasCount: 0 }) as Record<string, unknown>;
  if (current["id"] !== input.task.taskId || current["spec_revision"] !== input.task.specRevision) {
    throw new MoyeError({
      code: "BOOTSTRAP_MANIFEST_MISMATCH",
      category: "CONFLICT",
      message: `Task manifest does not match ${input.task.taskId} revision ${input.task.specRevision}`,
    });
  }
  const result = asRecord(current["result"]);
  const archive = asRecord(current["archive"]);
  const failure = {
    code: input.errorCode,
    category: input.errorCategory,
    message: input.errorMessage,
    failed_step: input.failedStep,
    ...(input.sourceWorkflowRef === undefined ? {} : { source_workflow_ref: input.sourceWorkflowRef }),
  };
  const manifest = stringify({
    ...current,
    status: "closed",
    outcome: "failed_terminal",
    workflow_id: input.workflowId,
    execution_mode: "goal-bootstrap",
    failure,
    archive: { ...archive, status: "pending" },
    result: { ...result, closure_report: "bootstrap-runtime-failure.json" },
  }, { lineWidth: 0 });
  const runtimeEvidence = `${JSON.stringify({
    taskId: input.task.taskId,
    workflowId: input.workflowId,
    state: input.task.state,
    outcome: input.task.outcome,
    failure,
    ...(input.task.execution === undefined ? {} : { execution: input.task.execution }),
  }, null, 2)}\n`;
  await writeStableFile(taskPath, manifest);
  await writeStableFile(path.join(taskRoot, "bootstrap-runtime-failure.json"), runtimeEvidence);
}

export async function verifyBootstrapEvidence(
  input: BootstrapEvidenceVerificationInput,
  closureReplay?: BootstrapClosureInput,
): Promise<void> {
  if (input.evidence.kind !== "GOAL_BOOTSTRAP") {
    throw new MoyeError({
      code: "BOOTSTRAP_EVIDENCE_KIND_INVALID",
      category: "VALIDATION",
      message: "bootstrap evidence kind must be GOAL_BOOTSTRAP",
    });
  }
  const repositoryRoot = await realpath(input.repositoryRoot);
  await run("git", ["-C", repositoryRoot, "cat-file", "-e", `${input.evidence.resultCommit}^{commit}`], repositoryRoot);
  const head = (await output("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], repositoryRoot)).trim();
  if (head !== input.evidence.resultCommit) {
    throw new MoyeError({
      code: "BOOTSTRAP_RESULT_NOT_HEAD",
      category: "CONFLICT",
      message: `Bootstrap result commit ${input.evidence.resultCommit} is not current HEAD ${head}`,
    });
  }
  const expectedVerification = taskArtifactRef(input.taskId, "verification.md");
  const expectedImpact = taskArtifactRef(input.taskId, "docs-impact.yaml");
  const expectedManifest = `docs/delivery/tasks/${input.taskId}/task.yaml`;
  if (input.evidence.verificationRefs.length !== 1 || input.evidence.verificationRefs[0] !== expectedVerification ||
      input.evidence.docsImpactRef !== expectedImpact) {
    throw new MoyeError({
      code: "BOOTSTRAP_EVIDENCE_SCOPE_INVALID",
      category: "VALIDATION",
      message: `Bootstrap evidence must use ${expectedVerification} and ${expectedImpact}`,
    });
  }
  const activeTaskPath = path.join(repositoryRoot, "docs", "delivery", "tasks", input.taskId);
  const manifestPath = await containedFile(repositoryRoot, expectedManifest);
  const committedManifestContent = await output(
    "git",
    ["-C", repositoryRoot, "show", `${input.evidence.resultCommit}:${expectedManifest}`],
    repositoryRoot,
  );
  if (closureReplay !== undefined && (
    closureReplay.task.taskId !== input.taskId ||
    JSON.stringify(closureReplay.evidence) !== JSON.stringify(input.evidence)
  )) {
    throw new MoyeError({
      code: "BOOTSTRAP_REPLAY_SCOPE_INVALID",
      category: "VALIDATION",
      message: "Bootstrap closure replay input does not match the verified Task and evidence",
    });
  }
  const allowedRuntimeArtifacts = closureReplay === undefined
    ? {}
    : closureReplayArtifacts(expectedManifest, committedManifestContent, closureReplay);
  await assertCleanOrReplayingClosure(repositoryRoot, allowedRuntimeArtifacts);
  if (closureReplay === undefined) {
    await assertCommittedContent(
      repositoryRoot,
      input.evidence.resultCommit,
      expectedManifest,
      await readFile(manifestPath, "utf8"),
    );
  }
  const baseline = await inspectBootstrapBaseline(repositoryRoot, input.taskId, input.evidence.resultCommit);
  const baseCommit = baseline.baseCommit;
  await run("git", ["-C", repositoryRoot, "merge-base", "--is-ancestor", baseCommit, input.evidence.resultCommit], repositoryRoot);
  for (const ref of input.evidence.verificationRefs) {
    const filePath = await containedFile(repositoryRoot, path.relative(
      repositoryRoot,
      resolveTaskArtifactPath(input.taskId, ref, activeTaskPath),
    ));
    const relativePath = normalizeRelative(path.relative(repositoryRoot, filePath));
    const content = await readFile(filePath, "utf8");
    await assertCommittedContent(repositoryRoot, input.evidence.resultCommit, relativePath, content);
    if (!/^> 状态：Accepted\s*$/mu.test(content)) {
      throw new MoyeError({
        code: "BOOTSTRAP_VERIFICATION_NOT_ACCEPTED",
        category: "CONFLICT",
        message: `Verification is not Accepted: ${ref}`,
      });
    }
  }
  const impactPath = await containedFile(repositoryRoot, path.relative(
    repositoryRoot,
    resolveTaskArtifactPath(input.taskId, input.evidence.docsImpactRef, activeTaskPath),
  ));
  const impactRelativePath = normalizeRelative(path.relative(repositoryRoot, impactPath));
  const impactContent = await readFile(impactPath, "utf8");
  await assertCommittedContent(
    repositoryRoot,
    input.evidence.resultCommit,
    impactRelativePath,
    impactContent,
  );
  const impact = parse(impactContent, { maxAliasCount: 0 }) as Record<string, unknown>;
  const changedPaths = new Set(
    Array.isArray(impact["changed_paths"])
      ? impact["changed_paths"].filter((value): value is string => typeof value === "string")
      : [],
  );
  const actualPaths = (await output(
    "git",
    ["-C", repositoryRoot, "diff", "--name-only", `${baseCommit}..${input.evidence.resultCommit}`],
    repositoryRoot,
  )).split("\n").filter(Boolean);
  const missingPaths = actualPaths.filter((changedPath) => !changedPaths.has(changedPath));
  if (missingPaths.length > 0) {
    throw new MoyeError({
      code: "BOOTSTRAP_IMPACT_INCOMPLETE",
      category: "CONFLICT",
      message: `Docs Impact does not cover changed paths: ${missingPaths.join(", ")}`,
    });
  }
  await run("ruby", ["scripts/docs_graph.rb", "validate-impact", "--report", impactPath], repositoryRoot);
}

async function inspectBootstrapBaseline(
  repositoryRoot: string,
  taskId: string,
  manifestCommit: string,
): Promise<BootstrapPreflightReceipt> {
  assertTaskId(taskId);
  const manifestRef = `docs/delivery/tasks/${taskId}/task.yaml`;
  const committedManifestContent = await output(
    "git", ["-C", repositoryRoot, "show", `${manifestCommit}:${manifestRef}`], repositoryRoot,
  );
  const manifest = parse(committedManifestContent, { maxAliasCount: 0 }) as Record<string, unknown>;
  if (manifest["id"] !== taskId || manifest["execution_mode"] !== "goal-bootstrap") {
    throw new MoyeError({
      code: "BOOTSTRAP_MODE_NOT_DECLARED",
      category: "CONFLICT",
      message: `Task ${taskId} did not predeclare goal-bootstrap execution`,
    });
  }
  const baseCommit = manifest["base_commit"];
  if (typeof baseCommit !== "string" || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(baseCommit)) {
    throw new MoyeError({
      code: "BOOTSTRAP_BASE_COMMIT_INVALID",
      category: "VALIDATION",
      message: `Task ${taskId} has no valid base_commit`,
    });
  }
  try {
    await execFileAsync("git", ["-C", repositoryRoot, "cat-file", "-e", `${baseCommit}^{commit}`], {
      cwd: repositoryRoot, timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw new MoyeError({
      code: "BOOTSTRAP_BASE_COMMIT_MISSING",
      category: "CONFLICT",
      message: `Task ${taskId} base_commit does not identify an existing commit`,
      cause: error,
    });
  }
  const introductionCommit = (await output(
    "git", ["-C", repositoryRoot, "log", "--diff-filter=A", "--format=%H", "--", manifestRef], repositoryRoot,
  )).trim().split("\n").filter(Boolean).at(-1);
  if (introductionCommit === undefined) {
    throw new MoyeError({
      code: "BOOTSTRAP_TASK_INTRODUCTION_MISSING",
      category: "CONFLICT",
      message: `Cannot find the committed introduction of ${manifestRef}`,
    });
  }
  const introducedManifest = parse(
    await output("git", ["-C", repositoryRoot, "show", `${introductionCommit}:${manifestRef}`], repositoryRoot),
    { maxAliasCount: 0 },
  ) as Record<string, unknown>;
  const introductionParent = (await output(
    "git", ["-C", repositoryRoot, "rev-parse", `${introductionCommit}^`], repositoryRoot,
  )).trim();
  if (introducedManifest["base_commit"] !== baseCommit || introductionParent !== baseCommit) {
    throw new MoyeError({
      code: "BOOTSTRAP_BASE_COMMIT_NOT_FROZEN",
      category: "CONFLICT",
      message: `Task ${taskId} base_commit was not frozen when its manifest was introduced`,
      details: { introductionCommit, introductionParent, baseCommit },
    });
  }
  const stable = { taskId, manifestRef, manifestCommit, introductionCommit, introductionParent, baseCommit };
  return {
    ...stable,
    receiptDigest: `sha256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`,
  };
}

function bootstrapClosureArtifacts(
  input: BootstrapClosureInput,
  current: Record<string, unknown>,
): { readonly manifest: string; readonly runtimeEvidence: string } {
  const result = asRecord(current["result"]);
  const archive = asRecord(current["archive"]);
  const next = {
    ...current,
    status: "closed",
    outcome: "succeeded",
    workflow_id: input.workflowId,
    execution_mode: "goal-bootstrap",
    execution_evidence: {
      executor_id: input.evidence.executorId,
      result_commit: input.evidence.resultCommit,
      verification_refs: [...input.evidence.verificationRefs],
      docs_impact_ref: input.evidence.docsImpactRef,
    },
    archive: { ...archive, status: "pending" },
    result: {
      ...result,
      implementation_commit: input.evidence.resultCommit,
      closure_report: input.evidence.verificationRefs[0],
    },
  };
  return {
    manifest: stringify(next, { lineWidth: 0 }),
    runtimeEvidence: `${JSON.stringify({
      taskId: input.task.taskId,
      workflowId: input.workflowId,
      state: input.task.state,
      outcome: input.task.outcome,
      execution: input.evidence,
    }, null, 2)}\n`,
  };
}

function closureReplayArtifacts(
  manifestPath: string,
  committedManifestContent: string,
  closure: BootstrapClosureInput,
): Record<string, string> {
  const artifacts = bootstrapClosureArtifacts(
    closure,
    parse(committedManifestContent, { maxAliasCount: 0 }) as Record<string, unknown>,
  );
  const evidencePath = `docs/delivery/tasks/${closure.task.taskId}/bootstrap-runtime-evidence.json`;
  return {
    [manifestPath]: artifacts.manifest,
    [`${manifestPath}.pending`]: artifacts.manifest,
    [evidencePath]: artifacts.runtimeEvidence,
    [`${evidencePath}.pending`]: artifacts.runtimeEvidence,
  };
}

async function assertCleanOrReplayingClosure(
  repositoryRoot: string,
  allowedArtifacts: Readonly<Record<string, string>>,
): Promise<void> {
  const dirty = await output(
    "git",
    ["-C", repositoryRoot, "status", "--porcelain=v1", "--untracked-files=all"],
    repositoryRoot,
  );
  if (dirty.trim().length === 0) return;
  for (const line of dirty.split("\n").filter(Boolean)) {
    const relativePath = line.slice(3);
    const expected = allowedArtifacts[relativePath];
    if (expected === undefined) throw dirtyError(line);
    try {
      if (await readFile(path.join(repositoryRoot, relativePath), "utf8") !== expected) {
        throw dirtyError(line);
      }
    } catch (error) {
      if (error instanceof MoyeError) throw error;
      throw dirtyError(line);
    }
  }
}

function dirtyError(detail: string): MoyeError {
  return new MoyeError({
    code: "BOOTSTRAP_WORKTREE_DIRTY",
    category: "CONFLICT",
    message: `Bootstrap closure requires a clean worktree except exact replay artifacts: ${detail}`,
  });
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join("/");
}

async function writeStableFile(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const pending = `${target}.pending`;
  try {
    if (await readFile(target, "utf8") === content) {
      try {
        const stale = await readFile(pending, "utf8");
        if (stale !== content) {
          throw new MoyeError({
            code: "BOOTSTRAP_PENDING_CONFLICT",
            category: "CONFLICT",
            message: `Pending bootstrap artifact conflicts with ${target}`,
          });
        }
        await rm(pending);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      return;
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  try {
    const existing = await readFile(pending, "utf8");
    if (existing !== content) {
      throw new MoyeError({
        code: "BOOTSTRAP_PENDING_CONFLICT",
        category: "CONFLICT",
        message: `Pending bootstrap artifact conflicts with ${target}`,
      });
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
    await writeFile(pending, content, { flag: "wx" });
  }
  await rename(pending, target);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function containedFile(root: string, relativeRef: string): Promise<string> {
  if (path.isAbsolute(relativeRef) || relativeRef.split(/[\\/]/).includes("..")) {
    throw new MoyeError({
      code: "BOOTSTRAP_EVIDENCE_PATH_INVALID",
      category: "VALIDATION",
      message: `Evidence ref must stay inside repository: ${relativeRef}`,
    });
  }
  const resolved = await realpath(path.resolve(root, relativeRef));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new MoyeError({
      code: "BOOTSTRAP_EVIDENCE_PATH_ESCAPE",
      category: "VALIDATION",
      message: `Evidence ref escapes repository: ${relativeRef}`,
    });
  }
  if (!(await stat(resolved)).isFile()) {
    throw new MoyeError({
      code: "BOOTSTRAP_EVIDENCE_NOT_FILE",
      category: "VALIDATION",
      message: `Evidence ref is not a file: ${relativeRef}`,
    });
  }
  return resolved;
}

async function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  try {
    await execFileAsync(command, [...args], { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    throw new MoyeError({
      code: "BOOTSTRAP_EVIDENCE_CHECK_FAILED",
      category: "CONFLICT",
      message: `${command} ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function output(command: string, args: readonly string[], cwd: string): Promise<string> {
  try {
    const result = await execFileAsync(command, [...args], {
      cwd,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    return result.stdout;
  } catch (error) {
    throw new MoyeError({
      code: "BOOTSTRAP_EVIDENCE_CHECK_FAILED",
      category: "CONFLICT",
      message: `${command} ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function assertCommittedContent(
  repositoryRoot: string,
  commit: string,
  relativePath: string,
  workingContent: string,
): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repositoryRoot, "show", `${commit}:${relativePath}`],
      { cwd: repositoryRoot, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
    );
    if (stdout !== workingContent) {
      throw new Error("working tree content differs from committed evidence");
    }
  } catch (error) {
    throw new MoyeError({
      code: "BOOTSTRAP_EVIDENCE_NOT_COMMITTED",
      category: "CONFLICT",
      message: `Evidence ${relativePath} is not bound to ${commit}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
