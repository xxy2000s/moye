import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TaskEnvelope } from "../domain/coding-task.js";
import { parseTaskEnvelope } from "../domain/coding-task.js";
import { MoyeError } from "../domain/errors.js";
import {
  executeCoreScenario,
  parseCoreScenario,
  parseCoreScenarioResult,
  type CoreScenario,
  type CoreScenarioResult,
} from "./workflow.js";

export interface CoreScenarioArtifactInput {
  readonly envelope: TaskEnvelope;
  readonly scenario: CoreScenario;
  readonly artifactRoot: string;
  readonly invocationRef: string;
  readonly observerFailure?: boolean;
  readonly docsGateFailureOnce?: boolean;
  readonly fault?: { readonly exitAfterResultOnce: true; readonly markerPath: string };
}

export interface CoreScenarioArtifactResult {
  readonly operationId: string;
  readonly artifactPath: string;
  readonly executionCount: number;
  readonly scenarioResult: CoreScenarioResult;
  readonly artifactDigest: string;
}

export async function executeCoreScenarioArtifact(input: CoreScenarioArtifactInput): Promise<CoreScenarioArtifactResult> {
  if (input.fault !== undefined && process.env["MOYE_TEST_FAULT_INJECTION"] !== "enabled") {
    throw validation("CORE_FAULT_INJECTION_DISABLED", "Core fault injection is disabled");
  }
  if (input.fault !== undefined && (input.fault.exitAfterResultOnce !== true ||
      typeof input.fault.markerPath !== "string" || input.fault.markerPath.trim().length === 0 ||
      input.fault.markerPath.includes("\0"))) {
    throw validation("CORE_FAULT_INJECTION_INVALID", "Core fault injection requires exitAfterResultOnce and a marker path");
  }
  const envelope = parseTaskEnvelope(
    JSON.parse(JSON.stringify(input.envelope)) as unknown,
    input.envelope.envelopeDigest,
  );
  const scenario = parseCoreScenario(input.scenario);
  const artifactRoot = await prepareArtifactRoot(input.artifactRoot);
  const identity = {
    taskId: envelope.taskId,
    specRevision: envelope.specRevision,
    envelopeDigest: envelope.envelopeDigest,
    scenario,
    invocationRef: input.invocationRef,
    observerFailure: input.observerFailure ?? false,
    docsGateFailureOnce: input.docsGateFailureOnce ?? false,
  };
  const operationId = `core-scenario:${digestHex("core-scenario-operation", identity)}`;
  const artifactPath = path.join(artifactRoot, operationId.replace(":", "-"));
  if (path.dirname(artifactPath) !== artifactRoot) throw validation("CORE_ARTIFACT_PATH_ESCAPE", "Artifact path escaped root");
  await mkdir(artifactPath, { recursive: true });
  await assertManagedDirectory(artifactPath, artifactRoot);
  const resultPath = path.join(artifactPath, "result.json");
  const pendingPath = `${resultPath}.pending`;
  const intentPath = path.join(artifactPath, "intent.json");
  const countPath = path.join(artifactPath, "execution-count.txt");

  const existing = await readResult(resultPath, envelope, scenario);
  if (existing !== undefined) return artifactResult(operationId, artifactPath, existing, await readCount(countPath));
  const pending = await readResult(pendingPath, envelope, scenario);
  if (pending !== undefined) {
    await rename(pendingPath, resultPath);
    return artifactResult(operationId, artifactPath, pending, await readCount(countPath));
  }

  const intent = `${JSON.stringify({ schemaVersion: 1, operationId, identity }, null, 2)}\n`;
  try {
    await writeFile(intentPath, intent, { flag: "wx" });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    await assertRegularFile(intentPath, "Core Scenario intent");
    if (await readFile(intentPath, "utf8") !== intent) {
      throw conflict("CORE_SCENARIO_INTENT_CONFLICT", "Core Scenario intent differs for stable operation");
    }
    throw new MoyeError({
      code: "CORE_SCENARIO_RESULT_UNKNOWN",
      category: "UNKNOWN_SIDE_EFFECT",
      message: "Core Scenario intent exists without a confirmed result; reconcile before retry",
    });
  }

  await writeFile(countPath, "1\n", { flag: "wx" });
  const scenarioResult = await executeCoreScenario({ ...input, envelope, scenario });
  const artifactDigest = digest("core-scenario-artifact", scenarioResult);
  await writeFile(pendingPath, `${JSON.stringify({ schemaVersion: 1, artifactDigest, scenarioResult }, null, 2)}\n`, { flag: "wx" });
  await rename(pendingPath, resultPath);
  if (input.fault !== undefined) {
    const markerPath = path.resolve(input.fault.markerPath);
    await mkdir(path.dirname(markerPath), { recursive: true });
    try {
      await writeFile(markerPath, `${operationId}\n`, { flag: "wx" });
      process.kill(process.pid, "SIGKILL");
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
  return artifactResult(operationId, artifactPath, scenarioResult, 1);
}

async function readResult(
  filePath: string,
  envelope: TaskEnvelope,
  scenario: CoreScenario,
): Promise<CoreScenarioResult | undefined> {
  try {
    await assertRegularFile(filePath, "Core Scenario result");
    const document = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    const result = parseCoreScenarioResult(document["scenarioResult"], envelope, scenario);
    if (document["schemaVersion"] !== 1 || document["artifactDigest"] !== digest("core-scenario-artifact", result)) {
      throw conflict("CORE_SCENARIO_ARTIFACT_INTEGRITY_FAILED", "Core Scenario artifact digest is invalid");
    }
    return result;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function artifactResult(
  operationId: string,
  artifactPath: string,
  scenarioResult: CoreScenarioResult,
  executionCount: number,
): CoreScenarioArtifactResult {
  return {
    operationId,
    artifactPath,
    executionCount,
    scenarioResult,
    artifactDigest: digest("core-scenario-artifact", scenarioResult),
  };
}

async function readCount(filePath: string): Promise<number> {
  await assertRegularFile(filePath, "Core Scenario execution count");
  const value = Number((await readFile(filePath, "utf8")).trim());
  if (!Number.isSafeInteger(value) || value < 1) throw conflict("CORE_SCENARIO_COUNT_INVALID", "Execution count is invalid");
  return value;
}

async function prepareArtifactRoot(value: string): Promise<string> {
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    throw validation("CORE_ARTIFACT_ROOT_UNSAFE", "Artifact root cannot be filesystem root");
  }
  await mkdir(resolved, { recursive: true });
  const direct = await lstat(resolved);
  if (direct.isSymbolicLink() || !direct.isDirectory()) {
    throw validation("CORE_ARTIFACT_ROOT_UNSAFE", "Artifact root must be a direct directory, not a symlink");
  }
  return realpath(resolved);
}

async function assertManagedDirectory(target: string, root: string): Promise<void> {
  const direct = await lstat(target);
  if (direct.isSymbolicLink() || !direct.isDirectory() || await realpath(target) !== target || path.dirname(target) !== root) {
    throw validation("CORE_ARTIFACT_PATH_UNSAFE", "Core Scenario artifact directory must remain a direct child of its real root");
  }
}

async function assertRegularFile(target: string, field: string): Promise<void> {
  const direct = await lstat(target);
  if (direct.isSymbolicLink() || !direct.isFile()) {
    throw conflict("CORE_SCENARIO_ARTIFACT_UNSAFE", `${field} must be a regular file, not a symlink`);
  }
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${digestHex(namespace, value)}`;
}

function digestHex(namespace: string, value: unknown): string {
  return createHash("sha256").update(namespace).update("\0").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]));
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function validation(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "VALIDATION", message });
}

function conflict(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "CONFLICT", message });
}
