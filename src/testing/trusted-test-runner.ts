import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { MoyeError } from "../domain/errors.js";
import { parseLifecycleArtifact } from "../domain/lifecycle-artifact.js";
import type { LifecycleArtifact, TestPlanPayload } from "../domain/lifecycle-artifact.js";

export interface TrustedTestCaseEvidence {
  readonly caseId: string;
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly stdoutRef: string;
  readonly stdoutDigest: string;
  readonly stderrRef: string;
  readonly stderrDigest: string;
  readonly status: "PASSED" | "FAILED";
}

export interface TrustedTestRunManifest {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly candidateCommit: string;
  readonly planDigest: string;
  readonly repositoryRoot: string;
  readonly cases: readonly TrustedTestCaseEvidence[];
  readonly outcome: "PASSED" | "FAILED";
  readonly manifestDigest: string;
}

export type TrustedTestRunResult =
  | { readonly state: "COMPLETE"; readonly manifest: TrustedTestRunManifest }
  | { readonly state: "UNKNOWN"; readonly runId: string; readonly reconcileToken: string; readonly reason: string };

export async function runTrustedTestPlan(input: {
  readonly plan: LifecycleArtifact;
  readonly candidateCommit: string;
  readonly repositoryRoot: string;
  readonly allowedRepositoryRoots: readonly string[];
  readonly artifactRoot: string;
}): Promise<TrustedTestRunResult> {
  const plan = parseLifecycleArtifact(JSON.parse(JSON.stringify(input.plan)), input.plan.artifactDigest);
  if (plan.payload.type !== "TEST_PLAN") throw validation("TRUSTED_TEST_PLAN_REQUIRED", "Trusted Runner requires a TEST_PLAN Artifact");
  const repositoryRoot = trustedRoot(input.repositoryRoot, input.allowedRepositoryRoots);
  if (plan.subjectCommit !== input.candidateCommit) throw conflict("TRUSTED_TEST_COMMIT_MISMATCH", "Test Plan does not bind Candidate Commit");
  const runId = digest("trusted-test-run", { taskId: plan.taskId, revision: plan.specRevision, candidateCommit: input.candidateCommit, planDigest: plan.artifactDigest });
  const runRoot = resolve(input.artifactRoot, runId.replace(":", "-"));
  const intentPath = resolve(runRoot, "execution-intent.json");
  const manifestPath = resolve(runRoot, "manifest.json");
  await mkdir(runRoot, { recursive: true });
  const existingManifest = await optionalJson<TrustedTestRunManifest>(manifestPath);
  if (existingManifest !== undefined) return { state: "COMPLETE", manifest: verifyManifest(existingManifest, runId) };
  const intent = { schemaVersion: 1, runId, taskId: plan.taskId, specRevision: plan.specRevision, candidateCommit: input.candidateCommit, planDigest: plan.artifactDigest, repositoryRoot };
  try {
    await writeFile(intentPath, `${JSON.stringify(intent, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { state: "UNKNOWN", runId, reconcileToken: digest("trusted-test-reconcile", intent), reason: "execution intent exists without a complete manifest" };
    }
    throw error;
  }
  const cases: TrustedTestCaseEvidence[] = [];
  for (const testCase of (plan.payload as TestPlanPayload).cases) {
    const result = await execute(testCase.argv, repositoryRoot);
    const stdoutRef = resolve(runRoot, `${testCase.id}.stdout.txt`);
    const stderrRef = resolve(runRoot, `${testCase.id}.stderr.txt`);
    await writeFile(stdoutRef, result.stdout, "utf8");
    await writeFile(stderrRef, result.stderr, "utf8");
    cases.push({ caseId: testCase.id, argv: testCase.argv, exitCode: result.exitCode, stdoutRef, stdoutDigest: digest("stdout", result.stdout),
      stderrRef, stderrDigest: digest("stderr", result.stderr), status: result.exitCode === 0 ? "PASSED" : "FAILED" });
  }
  const core = { schemaVersion: 1 as const, runId, taskId: plan.taskId, specRevision: plan.specRevision, candidateCommit: input.candidateCommit,
    planDigest: plan.artifactDigest, repositoryRoot, cases, outcome: cases.every((item) => item.status === "PASSED") ? "PASSED" as const : "FAILED" as const };
  const manifest = Object.freeze({ ...core, manifestDigest: digest("trusted-test-manifest", core) });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { state: "COMPLETE", manifest };
}

async function execute(argv: readonly string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const [executable, ...args] = argv;
  if (executable === undefined || executable.startsWith("-") || argv.some((item) => item.includes("\0"))) throw validation("TRUSTED_TEST_ARGV_INVALID", "argv is invalid");
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolveResult({ exitCode: code ?? 1, stdout, stderr }));
  });
}

function trustedRoot(value: string, allowed: readonly string[]): string {
  const root = resolve(value);
  if (!isAbsolute(root) || !allowed.map((candidate) => resolve(candidate)).some((candidate) => relative(candidate, root) === "")) throw validation("TRUSTED_TEST_ROOT_FORBIDDEN", "repositoryRoot is not allowlisted");
  return root;
}
async function optionalJson<T>(path: string): Promise<T | undefined> { try { return JSON.parse(await readFile(path, "utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
function verifyManifest(value: TrustedTestRunManifest, runId: string): TrustedTestRunManifest { const { manifestDigest, ...core } = value; if (value.runId !== runId || digest("trusted-test-manifest", core) !== manifestDigest) throw conflict("TRUSTED_TEST_MANIFEST_INVALID", "manifest integrity failed"); return value; }
function digest(namespace: string, value: unknown): string { return `sha256:${createHash("sha256").update(`${namespace}\0${JSON.stringify(value)}`).digest("hex")}`; }
function validation(code: string, message: string): MoyeError { return new MoyeError({ code, category: "VALIDATION", message }); }
function conflict(code: string, message: string): MoyeError { return new MoyeError({ code, category: "CONFLICT", message }); }
