import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentProcessRunner } from "../agent/codex-exec.js";
import { SpawnAgentProcessRunner } from "../agent/codex-exec.js";
import type { TaskEnvelope, ValidationCommandSpec } from "../domain/coding-task.js";
import { parseTaskEnvelope } from "../domain/coding-task.js";
import { MoyeError } from "../domain/errors.js";
import type { GitCheckpoint, WorkspaceEffectRequest } from "../git/workspace-effect.js";
import { validateGitCheckpoint } from "../git/workspace-effect.js";

const trustedBindings = new WeakSet<object>();

export interface VerificationCommandResult {
  readonly commandId: string;
  readonly argv: readonly [string, ...string[]];
  readonly shell: false;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
}

export interface VerificationBinding {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly envelopeDigest: string;
  readonly workspaceEffectId: string;
  readonly checkpointDigest: string;
  readonly verifiedCommit: string;
  readonly treeDigest: string;
  readonly passed: true;
  readonly commandResults: readonly VerificationCommandResult[];
  readonly evidenceRef: string;
  readonly evidenceContentDigest: string;
  readonly verificationDigest: string;
}

export interface VerificationFailure {
  readonly passed: false;
  readonly code: "COMMAND_FAILED" | "COMMIT_DRIFT" | "RESULT_UNKNOWN";
  readonly failedCommandId?: string;
  readonly commandResults: readonly VerificationCommandResult[];
  readonly evidenceRef: string;
  readonly evidenceContentDigest: string;
}

export type VerificationOutcome = VerificationBinding | VerificationFailure;

export interface VerificationGateOptions {
  readonly processRunner?: AgentProcessRunner;
  readonly now?: () => Date;
  readonly artifactRoot: string;
}

export async function runVerificationGate(
  envelope: TaskEnvelope,
  workspace: WorkspaceEffectRequest,
  checkpoint: GitCheckpoint,
  options: VerificationGateOptions,
): Promise<VerificationOutcome> {
  const trustedEnvelope = parseTaskEnvelope(JSON.parse(JSON.stringify(envelope)) as unknown, envelope.envelopeDigest);
  if (trustedEnvelope.taskId !== workspace.taskId || trustedEnvelope.specRevision !== checkpoint.specRevision
      || trustedEnvelope.baseSha !== workspace.baseSha || checkpoint.workspaceEffectId !== workspace.effectId) {
    throw conflict("VERIFICATION_INPUT_MISMATCH", "Envelope, Workspace and Checkpoint do not describe one Task revision");
  }
  await validateGitCheckpoint(workspace, checkpoint);
  const artifactRoot = await resolveArtifactRoot(options.artifactRoot);
  if (artifactRoot === path.parse(artifactRoot).root
      || isSameOrWithin(workspace.gitCommonDir, artifactRoot)) {
    throw validation("UNSAFE_VERIFICATION_ROOT", "Verification Artifacts cannot use filesystem root or Git metadata");
  }
  const processRunner = options.processRunner ?? new SpawnAgentProcessRunner();
  const now = options.now ?? (() => new Date());
  await mkdir(artifactRoot, { recursive: true });
  const operationCore = {
    schemaVersion: 1 as const,
    taskId: trustedEnvelope.taskId,
    specRevision: trustedEnvelope.specRevision,
    envelopeDigest: trustedEnvelope.envelopeDigest,
    workspaceEffectId: workspace.effectId,
    checkpointDigest: checkpoint.checkpointDigest,
    commands: trustedEnvelope.validationCommands.map(({ commandId, argv }) => ({ commandId, argv })),
  };
  const operationId = digest("verification-operation", operationCore);
  const operationToken = operationId.slice(operationId.lastIndexOf(":") + 1);
  const operationBase = path.resolve(artifactRoot, `${safeToken(trustedEnvelope.taskId)}-${operationToken}`);
  assertDirectChild(artifactRoot, operationBase);
  const outcomePath = `${operationBase}.outcome.json`;
  const recovered = await restoreVerificationOutcome(outcomePath, artifactRoot, trustedEnvelope, workspace, checkpoint);
  if (recovered !== undefined) return recovered;
  const claimed = await claimOperation(`${operationBase}.intent.json`, Buffer.from(
    `${JSON.stringify({ ...operationCore, operationId }, null, 2)}\n`, "utf8",
  ));
  if (!claimed) {
    const unknown = await persistVerificationFailure(
      artifactRoot, trustedEnvelope, workspace, checkpoint, [], "RESULT_UNKNOWN",
    );
    await writeStableFile(outcomePath, Buffer.from(`${JSON.stringify(unknown, null, 2)}\n`, "utf8"));
    return unknown;
  }
  const commandResults: VerificationCommandResult[] = [];
  for (const command of trustedEnvelope.validationCommands) {
    const result = await runCommand(workspace.worktreePath, command, processRunner, now);
    commandResults.push(result);
    if (result.exitCode !== 0 || result.signal !== null) {
      const failure = await persistVerificationFailure(artifactRoot, trustedEnvelope, workspace, checkpoint, commandResults,
        "COMMAND_FAILED", command.commandId);
      await writeStableFile(outcomePath, Buffer.from(`${JSON.stringify(failure, null, 2)}\n`, "utf8"));
      return failure;
    }
  }
  try {
    await validateGitCheckpoint(workspace, checkpoint);
  } catch {
    const failure = await persistVerificationFailure(
      artifactRoot, trustedEnvelope, workspace, checkpoint, commandResults, "COMMIT_DRIFT",
    );
    await writeStableFile(outcomePath, Buffer.from(`${JSON.stringify(failure, null, 2)}\n`, "utf8"));
    return failure;
  }

  const evidenceCore = {
    schemaVersion: 1 as const,
    taskId: trustedEnvelope.taskId,
    specRevision: trustedEnvelope.specRevision,
    envelopeDigest: trustedEnvelope.envelopeDigest,
    workspaceEffectId: workspace.effectId,
    checkpointDigest: checkpoint.checkpointDigest,
    verifiedCommit: checkpoint.commitSha,
    treeDigest: checkpoint.treeDigest,
    passed: true as const,
    commandResults,
  };
  const evidenceDigest = digest("verification-evidence", evidenceCore);
  const serialized = Buffer.from(`${JSON.stringify({ ...evidenceCore, evidenceDigest }, null, 2)}\n`, "utf8");
  const artifactName = `${safeToken(trustedEnvelope.taskId)}-${safeToken(evidenceDigest)}.json`;
  const artifactPath = path.resolve(artifactRoot, artifactName);
  assertDirectChild(artifactRoot, artifactPath);
  await writeStableFile(artifactPath, serialized);
  const evidenceRef = `verification-artifact://${trustedEnvelope.taskId}/${artifactName}`;
  const evidenceContentDigest = sha256(serialized);
  const core = {
    ...evidenceCore,
    evidenceRef,
    evidenceContentDigest,
  };
  const binding = deepFreeze({ ...core, verificationDigest: digest("verification-binding", core) });
  trustedBindings.add(binding);
  await writeStableFile(outcomePath, Buffer.from(`${JSON.stringify(binding, null, 2)}\n`, "utf8"));
  return binding;
}

async function persistVerificationFailure(
  artifactRoot: string,
  envelope: TaskEnvelope,
  workspace: WorkspaceEffectRequest,
  checkpoint: GitCheckpoint,
  commandResults: readonly VerificationCommandResult[],
  code: VerificationFailure["code"],
  failedCommandId?: string,
): Promise<VerificationFailure> {
  const core = {
    schemaVersion: 1 as const,
    taskId: envelope.taskId,
    specRevision: envelope.specRevision,
    envelopeDigest: envelope.envelopeDigest,
    workspaceEffectId: workspace.effectId,
    checkpointDigest: checkpoint.checkpointDigest,
    verifiedCommit: checkpoint.commitSha,
    passed: false as const,
    code,
    ...(failedCommandId ? { failedCommandId } : {}),
    commandResults,
  };
  const serialized = Buffer.from(`${JSON.stringify({ ...core, evidenceDigest: digest("verification-failure", core) }, null, 2)}\n`, "utf8");
  const artifactName = `${safeToken(envelope.taskId)}-failure-${safeToken(digest("verification-failure", core))}.json`;
  const artifactPath = path.resolve(artifactRoot, artifactName);
  assertDirectChild(artifactRoot, artifactPath);
  await mkdir(artifactRoot, { recursive: true });
  await writeStableFile(artifactPath, serialized);
  return deepFreeze({
    passed: false,
    code,
    ...(failedCommandId ? { failedCommandId } : {}),
    commandResults,
    evidenceRef: `verification-artifact://${envelope.taskId}/${artifactName}`,
    evidenceContentDigest: sha256(serialized),
  });
}

export function assertTrustedVerification(binding: VerificationBinding): void {
  if (!trustedBindings.has(binding) || binding.passed !== true) {
    throw validation("UNTRUSTED_VERIFICATION", "Merge requires a Verification Binding produced by the Gate");
  }
}

export function parseVerificationBinding(value: unknown, expectedDigest: string): VerificationBinding {
  const input = asRecord(value, "VerificationBinding");
  const commandResultsRaw = input["commandResults"];
  if (!Array.isArray(commandResultsRaw)) throw validation("INVALID_COMMAND_RESULTS", "commandResults must be an array");
  const commandResults = commandResultsRaw.map(parseCommandResult);
  const core = {
    schemaVersion: 1 as const,
    taskId: readString(input, "taskId"),
    specRevision: readNumber(input, "specRevision"),
    envelopeDigest: readString(input, "envelopeDigest"),
    workspaceEffectId: readString(input, "workspaceEffectId"),
    checkpointDigest: readString(input, "checkpointDigest"),
    verifiedCommit: readString(input, "verifiedCommit"),
    treeDigest: readString(input, "treeDigest"),
    commandResults,
    passed: true as const,
    evidenceRef: readString(input, "evidenceRef"),
    evidenceContentDigest: readString(input, "evidenceContentDigest"),
  };
  const actual = digest("verification-binding", core);
  if (input["schemaVersion"] !== 1 || input["passed"] !== true
      || input["verificationDigest"] !== expectedDigest || actual !== expectedDigest) {
    throw conflict("VERIFICATION_BINDING_INTEGRITY_FAILED", "Verification Binding differs from Expected Digest");
  }
  const binding = deepFreeze({ ...core, verificationDigest: actual });
  trustedBindings.add(binding);
  return binding;
}

async function runCommand(
  cwd: string,
  command: ValidationCommandSpec,
  runner: AgentProcessRunner,
  now: () => Date,
): Promise<VerificationCommandResult> {
  const startedAt = canonicalNow(now);
  const [executable, ...args] = command.argv;
  let processResult;
  try {
    processResult = await runner.run({ executable, argv: args, cwd, shell: false });
  } catch (error) {
    processResult = {
      stdout: "",
      stderr: `Verification process failed: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: null,
      signal: null,
    };
  }
  const finishedAt = canonicalNow(now);
  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  return deepFreeze({
    commandId: command.commandId,
    argv: [...command.argv] as [string, ...string[]],
    shell: false,
    exitCode: processResult.exitCode,
    signal: processResult.signal,
    startedAt,
    finishedAt,
    durationMs,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    stdoutDigest: sha256(processResult.stdout),
    stderrDigest: sha256(processResult.stderr),
  });
}

function parseCommandResult(value: unknown): VerificationCommandResult {
  const input = asRecord(value, "VerificationCommandResult");
  if (!Array.isArray(input["argv"]) || input["argv"].length === 0 || input["argv"].some((part) => typeof part !== "string")) {
    throw validation("INVALID_VERIFICATION_ARGV", "Verification argv must be a non-empty string array");
  }
  const exitCode = input["exitCode"];
  if (exitCode !== null && (typeof exitCode !== "number" || !Number.isSafeInteger(exitCode))) {
    throw validation("INVALID_VERIFICATION_EXIT", "Verification exitCode must be integer or null");
  }
  const signal = input["signal"];
  if (signal !== null && typeof signal !== "string") throw validation("INVALID_VERIFICATION_SIGNAL", "signal must be string or null");
  if (input["shell"] !== false) throw validation("INVALID_VERIFICATION_SHELL", "Verification command must record shell=false");
  const startedAt = readString(input, "startedAt");
  const finishedAt = readString(input, "finishedAt");
  const durationMs = readNumber(input, "durationMs");
  const stdout = readString(input, "stdout", false);
  const stderr = readString(input, "stderr", false);
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(finishedAt))
      || Date.parse(finishedAt) - Date.parse(startedAt) !== durationMs || durationMs < 0) {
    throw validation("INVALID_VERIFICATION_TIME", "Verification timestamps and duration do not agree");
  }
  if (input["stdoutDigest"] !== sha256(stdout) || input["stderrDigest"] !== sha256(stderr)) {
    throw validation("INVALID_VERIFICATION_OUTPUT_DIGEST", "Verification output digest does not match content");
  }
  return deepFreeze({
    commandId: readString(input, "commandId"),
    argv: [...input["argv"]] as [string, ...string[]],
    shell: false,
    exitCode,
    signal: signal as NodeJS.Signals | null,
    startedAt,
    finishedAt,
    durationMs,
    stdout,
    stderr,
    stdoutDigest: readString(input, "stdoutDigest"),
    stderrDigest: readString(input, "stderrDigest"),
  });
}

async function claimOperation(target: string, content: Buffer): Promise<boolean> {
  try { await writeFile(target, content, { flag: "wx" }); return true; }
  catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (!(await readFile(target)).equals(content)) {
      throw conflict("VERIFICATION_INTENT_CONFLICT", `Verification intent conflicts with ${target}`);
    }
    return false;
  }
}

async function restoreVerificationOutcome(
  target: string,
  artifactRoot: string,
  envelope: TaskEnvelope,
  workspace: WorkspaceEffectRequest,
  checkpoint: GitCheckpoint,
): Promise<VerificationOutcome | undefined> {
  if (!(await exists(target))) return undefined;
  const raw = JSON.parse(await readFile(target, "utf8")) as unknown;
  const record = asRecord(raw, "VerificationOutcome");
  let outcome: VerificationOutcome;
  if (record["passed"] === true) {
    outcome = parseVerificationBinding(raw, readString(record, "verificationDigest"));
  } else if (record["passed"] === false) {
    const code = readString(record, "code");
    if (!["COMMAND_FAILED", "COMMIT_DRIFT", "RESULT_UNKNOWN"].includes(code)) {
      throw validation("INVALID_VERIFICATION_FAILURE", `Unknown Verification failure code ${code}`);
    }
    if (!Array.isArray(record["commandResults"])) {
      throw validation("INVALID_COMMAND_RESULTS", "commandResults must be an array");
    }
    outcome = deepFreeze({
      passed: false,
      code: code as VerificationFailure["code"],
      ...(record["failedCommandId"] === undefined ? {} : { failedCommandId: readString(record, "failedCommandId") }),
      commandResults: record["commandResults"].map(parseCommandResult),
      evidenceRef: readString(record, "evidenceRef"),
      evidenceContentDigest: readString(record, "evidenceContentDigest"),
    });
  } else {
    throw validation("INVALID_VERIFICATION_OUTCOME", "Verification outcome must carry passed=true or passed=false");
  }
  const common = outcome as VerificationOutcome & {
    taskId?: string; specRevision?: number; envelopeDigest?: string; workspaceEffectId?: string; checkpointDigest?: string;
  };
  if (outcome.passed && (common.taskId !== envelope.taskId || common.specRevision !== envelope.specRevision
      || common.envelopeDigest !== envelope.envelopeDigest || common.workspaceEffectId !== workspace.effectId
      || common.checkpointDigest !== checkpoint.checkpointDigest)) {
    throw conflict("VERIFICATION_OUTCOME_MISMATCH", "Stored Verification outcome belongs to another Task revision");
  }
  const evidence = await verifyEvidenceArtifact(artifactRoot, outcome.evidenceRef, outcome.evidenceContentDigest);
  if (evidence["taskId"] !== envelope.taskId || evidence["specRevision"] !== envelope.specRevision
      || evidence["envelopeDigest"] !== envelope.envelopeDigest || evidence["workspaceEffectId"] !== workspace.effectId
      || evidence["checkpointDigest"] !== checkpoint.checkpointDigest || evidence["passed"] !== outcome.passed) {
    throw conflict("VERIFICATION_EVIDENCE_MISMATCH", "Stored Verification evidence belongs to another Task revision or outcome");
  }
  return outcome;
}

async function verifyEvidenceArtifact(root: string, ref: string, expectedDigest: string): Promise<Record<string, unknown>> {
  const prefix = "verification-artifact://";
  if (!ref.startsWith(prefix)) throw validation("INVALID_VERIFICATION_REF", "Verification evidence ref is invalid");
  const fileName = ref.slice(ref.lastIndexOf("/") + 1);
  const target = path.resolve(root, fileName);
  assertDirectChild(root, target);
  const content = await readFile(target);
  if (sha256(content) !== expectedDigest) {
    throw conflict("VERIFICATION_EVIDENCE_TAMPERED", "Verification evidence content digest does not match");
  }
  return asRecord(JSON.parse(content.toString("utf8")) as unknown, "VerificationEvidence");
}

async function resolveArtifactRoot(input: string): Promise<string> {
  const absolute = path.resolve(input);
  let cursor = absolute;
  const suffix: string[] = [];
  while (true) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || (suffix.length === 0 && !info.isDirectory())) {
        throw validation("INVALID_VERIFICATION_ROOT", "Verification Artifact Root must be a real directory");
      }
      return path.join(await realpath(cursor), ...suffix.reverse());
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw validation("INVALID_VERIFICATION_ROOT", "Cannot resolve Verification Artifact Root");
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function writeStableFile(target: string, content: Buffer): Promise<void> {
  if (await exists(target)) {
    if (!(await readFile(target)).equals(content)) throw conflict("VERIFICATION_ARTIFACT_CONFLICT", `Verification Artifact conflicts with ${target}`);
    return;
  }
  const pending = `${target}.pending`;
  try { await writeFile(pending, content, { flag: "wx" }); }
  catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (!(await readFile(pending)).equals(content)) throw conflict("VERIFICATION_PENDING_CONFLICT", `Pending Artifact conflicts with ${pending}`);
  }
  try { await rename(pending, target); }
  catch (error) { if (!(isNotFound(error) && await exists(target))) throw error; }
}

function canonicalNow(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw validation("INVALID_VERIFICATION_CLOCK", "Verification clock returned invalid Date");
  return value.toISOString();
}

function safeToken(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/g, "-").slice(-80);
}

function assertDirectChild(root: string, target: string): void {
  if (path.dirname(target) !== root || !target.startsWith(`${root}${path.sep}`)) throw validation("VERIFICATION_PATH_ESCAPE", "Verification Artifact must be a direct child");
}

function digest(namespace: string, value: unknown): string {
  return `${namespace}:sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function sha256(value: string | Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

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
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw validation("INVALID_VERIFICATION_OBJECT", `${label} must be an object`);
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, nonEmpty = true): string {
  const value = record[key];
  if (typeof value !== "string" || (nonEmpty && !value)) throw validation("INVALID_VERIFICATION_FIELD", `${key} must be a string`);
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw validation("INVALID_VERIFICATION_FIELD", `${key} must be a number`);
  return value;
}

async function exists(target: string): Promise<boolean> { try { await lstat(target); return true; } catch (error) { if (isNotFound(error)) return false; throw error; } }
function isNotFound(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
function isAlreadyExists(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST"; }
function isSameOrWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function validation(code: string, message: string): MoyeError { return new MoyeError({ code, category: "VALIDATION", message }); }
function conflict(code: string, message: string): MoyeError { return new MoyeError({ code, category: "CONFLICT", message }); }
