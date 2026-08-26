import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DocsImpactPayload } from "../domain/lifecycle-artifact.js";
import type { DocumentationPolicyKind } from "./project-manifest.js";

export interface DocumentationPolicyCommandV1 {
  readonly id: string;
  readonly argv: readonly string[];
  readonly cwd: string;
}

export interface DocumentationPolicyInputV1 {
  readonly policyVersion: 1;
  readonly kind: DocumentationPolicyKind;
  readonly command?: DocumentationPolicyCommandV1;
}

export interface DocumentationPolicyCommandEvidenceV1 {
  readonly id: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  readonly outputSummary: string;
}

export interface DocumentationPolicyEvidenceV1 {
  readonly schemaVersion: 1;
  readonly artifactKind: "DOCUMENTATION_POLICY_EVIDENCE";
  readonly taskId: string;
  readonly specRevision: number;
  readonly generation: number;
  readonly policy: DocumentationPolicyKind;
  readonly baseCommit: string;
  readonly candidateCommit: string;
  readonly changedFiles: readonly string[];
  readonly changedFilesDigest: string;
  readonly verdict: "PASSED" | "BLOCKED";
  readonly disposition: "NOT_REQUIRED" | "SATISFIED" | "FAILED";
  readonly findingRefs: readonly string[];
  readonly command?: DocumentationPolicyCommandEvidenceV1;
  readonly artifactRef: string;
  readonly evidenceDigest: string;
}

export class DocumentationPolicyError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "DocumentationPolicyError";
  }
}

export function validateDocumentationPolicyInputV1(
  input: DocumentationPolicyInputV1,
  repositoryRootInput: string,
): DocumentationPolicyInputV1 {
  if (input === null || typeof input !== "object" || Array.isArray(input) || input.policyVersion !== 1) {
    throw new DocumentationPolicyError("DOCS_POLICY_VERSION_UNSUPPORTED", "Documentation policy must use policyVersion 1");
  }
  if (!["none", "conventional", "moye-doc-graph", "custom"].includes(input.kind)) {
    throw new DocumentationPolicyError("DOCS_POLICY_KIND_INVALID", `Unknown Documentation policy ${String(input.kind)}`);
  }
  if (input.kind === "custom" && input.command === undefined) {
    throw new DocumentationPolicyError("DOCS_POLICY_COMMAND_REQUIRED", "custom policy requires a command");
  }
  if (input.kind !== "custom" && input.command !== undefined) {
    throw new DocumentationPolicyError("DOCS_POLICY_COMMAND_FORBIDDEN", "Only custom policy accepts a command");
  }
  const repositoryRoot = path.resolve(repositoryRootInput);
  const command = input.command === undefined ? undefined : validateCommand(input.command, repositoryRoot);
  return deepFreeze({ policyVersion: 1, kind: input.kind, ...(command === undefined ? {} : { command }) });
}

export async function runDocumentationPolicyV1(input: {
  readonly taskId: string;
  readonly specRevision: number;
  readonly generation: number;
  readonly repositoryRoot: string;
  readonly artifactRoot: string;
  readonly baseCommit: string;
  readonly candidateCommit: string;
  readonly policy: DocumentationPolicyInputV1;
}): Promise<DocumentationPolicyEvidenceV1> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const policy = validateDocumentationPolicyInputV1(input.policy, repositoryRoot);
  const baseCommit = sha(input.baseCommit, "baseCommit");
  const candidateCommit = sha(input.candidateCommit, "candidateCommit");
  if (await git(repositoryRoot, ["rev-parse", "HEAD"]) !== candidateCommit) {
    throw new DocumentationPolicyError("DOCS_POLICY_CANDIDATE_DRIFT", "repository HEAD does not equal the authorized Candidate Commit");
  }
  if ((await git(repositoryRoot, ["status", "--porcelain=v1"])).trim().length > 0) {
    throw new DocumentationPolicyError("DOCS_POLICY_WORKTREE_DIRTY", "Documentation policy requires a clean Candidate worktree");
  }
  const changedFiles = Object.freeze((await git(repositoryRoot, ["diff", "--name-only", "--no-renames", baseCommit, candidateCommit]))
    .split("\n").map((item) => item.trim()).filter(Boolean).sort());
  const changedFilesDigest = digest("documentation-changed-files-v1", changedFiles);

  let verdict: DocumentationPolicyEvidenceV1["verdict"] = "PASSED";
  let disposition: DocumentationPolicyEvidenceV1["disposition"] = policy.kind === "none" ? "NOT_REQUIRED" : "SATISFIED";
  let findingRefs: readonly string[] = [];
  let command: DocumentationPolicyCommandEvidenceV1 | undefined;
  const policyEnvironment = {
    MOYE_DOCUMENTATION_BASE_COMMIT: baseCommit,
    MOYE_DOCUMENTATION_CANDIDATE_COMMIT: candidateCommit,
  };

  if (policy.kind === "conventional") {
    const codeChanged = changedFiles.some(isProductFile);
    const docsChanged = changedFiles.some(isDocumentationFile);
    if (codeChanged && !docsChanged) {
      verdict = "BLOCKED";
      disposition = "FAILED";
      findingRefs = Object.freeze(["finding://documentation-policy/conventional/missing-doc-change"]);
    }
  } else if (policy.kind === "moye-doc-graph") {
    command = await executeCommand({ id: "moye-doc-graph-validate", argv: ["ruby", "scripts/docs_graph.rb", "validate"], cwd: repositoryRoot }, policyEnvironment);
  } else if (policy.kind === "custom") {
    command = await executeCommand(policy.command!, policyEnvironment);
  }
  if (command !== undefined && command.exitCode !== 0) {
    verdict = "BLOCKED";
    disposition = "FAILED";
    findingRefs = Object.freeze([`finding://documentation-policy/${policy.kind}/command-failed`]);
  }

  const artifactDirectory = path.join(path.resolve(input.artifactRoot), "documentation-policy", `r${input.specRevision}-g${input.generation}`);
  const artifactPath = path.join(artifactDirectory, "evidence.json");
  const artifactRef = `artifact://documentation-policy/r${input.specRevision}-g${input.generation}/evidence.json`;
  const core = {
    schemaVersion: 1 as const,
    artifactKind: "DOCUMENTATION_POLICY_EVIDENCE" as const,
    taskId: required(input.taskId, "taskId"),
    specRevision: positive(input.specRevision, "specRevision"),
    generation: nonNegative(input.generation, "generation"),
    policy: policy.kind,
    baseCommit,
    candidateCommit,
    changedFiles,
    changedFilesDigest,
    verdict,
    disposition,
    findingRefs,
    ...(command === undefined ? {} : { command }),
    artifactRef,
  };
  const evidence = deepFreeze({ ...core, evidenceDigest: digest("documentation-policy-evidence-v1", core) });
  await persistIdentical(artifactDirectory, artifactPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

export function documentationPolicyPayloadV1(evidence: DocumentationPolicyEvidenceV1): DocsImpactPayload {
  if (evidence.verdict !== "PASSED") throw new DocumentationPolicyError("DOCS_POLICY_BLOCKED", "Blocked policy evidence cannot satisfy Docs Impact");
  return deepFreeze({
    type: "DOCS_IMPACT",
    routeDigest: evidence.evidenceDigest,
    reportRef: evidence.artifactRef,
    dispositions: [{
      documentId: `documentation-policy:${evidence.policy}`,
      outcome: evidence.disposition === "NOT_REQUIRED" ? "not_applicable" : "updated",
      reason: evidence.disposition === "NOT_REQUIRED"
        ? `Policy none deterministically recorded ${evidence.changedFiles.length} changed file(s); project documentation is not required.`
        : `Policy ${evidence.policy} passed with evidence ${evidence.evidenceDigest}.`,
    }],
  });
}

async function executeCommand(commandInput: DocumentationPolicyCommandV1, environment: Readonly<Record<string, string>>): Promise<DocumentationPolicyCommandEvidenceV1> {
  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(commandInput.argv[0]!, commandInput.argv.slice(1), {
      cwd: commandInput.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...environment, MOYE_DOCUMENTATION_POLICY: commandInput.id },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 120_000);
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 8 * 1024 * 1024) child.kill("SIGKILL");
      else target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode: signal === null ? code ?? 1 : timedOut ? 124 : 137,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
  return deepFreeze({
    id: commandInput.id,
    argv: Object.freeze([...commandInput.argv]),
    cwd: commandInput.cwd,
    exitCode: result.exitCode,
    stdoutDigest: digest("documentation-policy-stdout-v1", result.stdout),
    stderrDigest: digest("documentation-policy-stderr-v1", result.stderr),
    outputSummary: `${result.stdout}\n${result.stderr}`.trim().slice(0, 2_000) || `exit ${result.exitCode}`,
  });
}

function validateCommand(input: DocumentationPolicyCommandV1, repositoryRoot: string): DocumentationPolicyCommandV1 {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(input.id)) throw new DocumentationPolicyError("DOCS_POLICY_COMMAND_ID_INVALID", "command id is invalid");
  if (!Array.isArray(input.argv) || input.argv.length === 0 || input.argv.some((item) => typeof item !== "string" || !item || /[\0\r\n]/.test(item))) {
    throw new DocumentationPolicyError("DOCS_POLICY_ARGV_INVALID", "command argv must contain safe non-empty strings");
  }
  const executable = path.basename(input.argv[0]!).toLowerCase();
  if (["sh", "bash", "zsh", "fish", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "rm", "rmdir", "del", "sudo"].includes(executable)) {
    throw new DocumentationPolicyError("DOCS_POLICY_COMMAND_FORBIDDEN", "shell and destructive executables are forbidden");
  }
  if (["node", "python", "python3"].includes(executable) && input.argv.slice(1).some((item) => ["-e", "--eval", "-c"].includes(item))) {
    throw new DocumentationPolicyError("DOCS_POLICY_COMMAND_FORBIDDEN", "inline evaluation is forbidden");
  }
  const cwd = path.resolve(input.cwd);
  const relative = path.relative(repositoryRoot, cwd);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new DocumentationPolicyError("DOCS_POLICY_CWD_OUTSIDE_REPOSITORY", "command cwd escapes repository root");
  }
  return deepFreeze({ id: input.id, argv: Object.freeze([...input.argv]), cwd });
}

function isDocumentationFile(file: string): boolean {
  return /^(?:docs\/|README(?:\.[^/]*)?$|CHANGELOG(?:\.[^/]*)?$|SECURITY(?:\.[^/]*)?$|CONTRIBUTING(?:\.[^/]*)?$|[^/]+\.md$)/i.test(file);
}

function isProductFile(file: string): boolean {
  return !isDocumentationFile(file) && !/^(?:\.moye\/|\.github\/|tests?\/|__tests__\/|fixtures?\/|examples?\/)/i.test(file);
}

async function git(root: string, argv: readonly string[]): Promise<string> {
  return (await commandStdout("git", ["-C", root, ...argv], root)).trim();
}

async function commandStdout(executable: string, argv: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...argv], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(Buffer.concat(stdout).toString("utf8")) : reject(new DocumentationPolicyError("DOCS_POLICY_GIT_FAILED", Buffer.concat(stderr).toString("utf8"))));
  });
}

async function persistIdentical(directory: string, target: string, bytes: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  try { await writeFile(target, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (!isExists(error)) throw error;
    if (await readFile(target, "utf8") !== bytes) throw new DocumentationPolicyError("DOCS_POLICY_ARTIFACT_CONFLICT", `${target} already contains different evidence`);
  }
}

function sha(value: string, field: string): string {
  if (!/^[0-9a-f]{40,64}$/.test(value)) throw new DocumentationPolicyError("DOCS_POLICY_COMMIT_INVALID", `${field} is not a Git object id`);
  return value;
}
function required(value: string, field: string): string { if (typeof value !== "string" || !value.trim()) throw new DocumentationPolicyError("DOCS_POLICY_VALUE_REQUIRED", `${field} is required`); return value.trim(); }
function positive(value: number, field: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new DocumentationPolicyError("DOCS_POLICY_INTEGER_INVALID", `${field} must be positive`); return value; }
function nonNegative(value: number, field: string): number { if (!Number.isSafeInteger(value) || value < 0) throw new DocumentationPolicyError("DOCS_POLICY_INTEGER_INVALID", `${field} must be non-negative`); return value; }
function digest(namespace: string, value: unknown): string { return `sha256:${createHash("sha256").update(namespace).update("\0").update(canonical(value)).digest("hex")}`; }
function canonical(value: unknown): string { if (value === undefined) return "null"; if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`; }
function isExists(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "EEXIST"; }
function deepFreeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested); } return value; }
