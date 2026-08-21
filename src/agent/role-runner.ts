import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TaskEnvelope } from "../domain/coding-task.js";
import { parseTaskEnvelope } from "../domain/coding-task.js";
import type { CoreProjection, CoreRole } from "../domain/core-control.js";
import { CORE_ROLES, parseCoreProjection } from "../domain/core-control.js";
import { MoyeError, type MoyeErrorCategory } from "../domain/errors.js";

export const ROLE_STEP_IDS = Object.freeze({
  DOCS: "CORE-DOCS",
  IMPLEMENTATION: "CORE-IMPLEMENTATION",
  REVIEW: "CORE-REVIEW",
} as const);
export type RoleStepId = (typeof ROLE_STEP_IDS)[CoreRole];
export type RoleAttemptStatus = "SCHEDULED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type RoleRunnerKind = "FAKE" | "CODEX_EXEC" | "CLAUDE_PRINT";
export type RoleRunOutcome = "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT";

export type RoleArtifactKind =
  | "DOC_SPEC"
  | "DOC_PLAN"
  | "DOC_DESIGN"
  | "DOCS_IMPACT"
  | "KNOWLEDGE_SYNC"
  | "CHECKPOINT"
  | "TEST_EVIDENCE"
  | "SELF_REVIEW"
  | "REVIEW_RESULT"
  | "REVIEW_FINDING"
  | "DIAGNOSTIC";

export interface RoleAttempt {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly envelopeDigest: string;
  readonly role: CoreRole;
  readonly stepId: RoleStepId;
  readonly attemptId: string;
  readonly generation: number;
  readonly dispatchId: string;
  readonly inputDigest: string;
  readonly status: RoleAttemptStatus;
  readonly scheduledAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly resultDigest?: string;
  readonly error?: string;
  readonly attemptDigest: string;
}

export interface RoleRunRequestInput {
  readonly attempt: RoleAttempt;
  readonly runnerKind: RoleRunnerKind;
  readonly workspaceOrArtifactScope: string;
  readonly artifactRoot: string;
  readonly prompt: string;
}

export interface RoleRunRequest {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly role: CoreRole;
  readonly stepId: RoleStepId;
  readonly attemptId: string;
  readonly generation: number;
  readonly dispatchId: string;
  readonly inputDigest: string;
  readonly runnerKind: RoleRunnerKind;
  readonly workspaceOrArtifactScope: string;
  readonly artifactRoot: string;
  readonly artifactPath: string;
  readonly prompt: string;
  readonly promptDigest: string;
  readonly runId: string;
}

export interface RoleArtifact {
  readonly name: string;
  readonly kind: RoleArtifactKind;
  readonly artifactRef: string;
  readonly contentDigest: string;
  readonly bytes: number;
  readonly producer: {
    readonly taskId: string;
    readonly specRevision: number;
    readonly role: CoreRole;
    readonly stepId: RoleStepId;
    readonly attemptId: string;
    readonly generation: number;
    readonly runId: string;
    readonly inputDigest: string;
  };
}

export interface DocsRoleOutput {
  readonly type: "DOCS_RESULT";
  readonly phase: "SPEC_DESIGN" | "DOCS_IMPACT";
  readonly specRef?: string;
  readonly planRef?: string;
  readonly designRef?: string;
  readonly docsImpactRef?: string;
  readonly knowledgeSyncRef?: string;
}

export interface ImplementationRoleOutput {
  readonly type: "IMPLEMENTATION_RESULT";
  readonly checkpointRef: string;
  readonly testEvidenceRefs: readonly string[];
  readonly selfReviewRef: string;
  readonly resultCommit: string;
}

export interface ReviewRoleOutput {
  readonly type: "REVIEW_RESULT";
  readonly verdict: "PASSED" | "FINDINGS";
  readonly reviewResultRef: string;
  readonly findingRefs: readonly string[];
}

export type RoleOutput = DocsRoleOutput | ImplementationRoleOutput | ReviewRoleOutput;

export interface RoleRunResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly runnerKind: RoleRunnerKind;
  readonly taskId: string;
  readonly specRevision: number;
  readonly role: CoreRole;
  readonly stepId: RoleStepId;
  readonly attemptId: string;
  readonly generation: number;
  readonly inputDigest: string;
  readonly sessionId?: string;
  readonly outcome: RoleRunOutcome;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly artifacts: readonly RoleArtifact[];
  readonly output: RoleOutput | null;
  readonly error?: {
    readonly code: string;
    readonly category: MoyeErrorCategory;
    readonly message: string;
  };
  readonly resultDigest: string;
}

export interface RoleAgentRunner {
  run(request: RoleRunRequest): Promise<RoleRunResult>;
}

export interface FakeRoleArtifactInput {
  readonly name: string;
  readonly kind: RoleArtifactKind;
  readonly content: string;
}

export interface FakeRoleScript {
  readonly startedAt: string;
  readonly durationMs: number;
  readonly outcome: RoleRunOutcome;
  readonly sessionId?: string;
  readonly docsPhase?: DocsRoleOutput["phase"];
  readonly reviewVerdict?: ReviewRoleOutput["verdict"];
  readonly resultCommit?: string;
  readonly artifacts: readonly FakeRoleArtifactInput[];
  readonly error?: RoleRunResult["error"];
}

const trustedAttempts = new WeakSet<object>();
const trustedRequests = new WeakSet<object>();
const trustedResults = new WeakSet<object>();

export class FakeRoleAgentRunner implements RoleAgentRunner {
  readonly #script: FakeRoleScript;
  #executionCount = 0;

  constructor(script: FakeRoleScript) {
    validateFakeScript(script);
    this.#script = deepFreeze(JSON.parse(JSON.stringify(script)) as FakeRoleScript);
  }

  get executionCount(): number {
    return this.#executionCount;
  }

  async run(request: RoleRunRequest): Promise<RoleRunResult> {
    assertTrustedRequest(request);
    if (request.runnerKind !== "FAKE") {
      throw validation("ROLE_RUNNER_KIND_MISMATCH", "Fake Role Runner requires runnerKind FAKE");
    }
    const existing = await reconcileRoleRun(request);
    if (existing !== undefined) return existing;
    const claimed = await claimRoleExecution(request);
    if (!claimed) {
      throw unknown(
        "ROLE_RUN_RESULT_UNKNOWN",
        `Execution intent exists for ${request.runId} without a confirmed manifest; reconcile before retry`,
      );
    }
    this.#executionCount += 1;
    return persistRoleRun(request, this.#script);
  }
}

export function createInitialRoleAttempt(
  envelope: TaskEnvelope,
  projection: CoreProjection,
  scheduledAt: string,
): RoleAttempt {
  const verifiedEnvelope = revalidateEnvelope(envelope);
  const verifiedProjection = revalidateProjection(projection, verifiedEnvelope);
  if (verifiedProjection.pendingRole === null) {
    throw conflict("ROLE_DISPATCH_REQUIRED", "Core Projection has no Pending Role Dispatch");
  }
  return newRoleAttempt(verifiedEnvelope, verifiedProjection.pendingRole, 1, scheduledAt);
}

export function createRetryRoleAttempt(
  envelope: TaskEnvelope,
  projection: CoreProjection,
  previousAttempts: readonly RoleAttempt[],
  scheduledAt: string,
): RoleAttempt {
  const verifiedEnvelope = revalidateEnvelope(envelope);
  const verifiedProjection = revalidateProjection(projection, verifiedEnvelope);
  if (verifiedProjection.pendingRole === null) {
    throw conflict("ROLE_DISPATCH_REQUIRED", "Core Projection has no Pending Role Dispatch");
  }
  if (previousAttempts.length === 0) {
    throw validation("ROLE_ATTEMPT_HISTORY_REQUIRED", "Role retry requires complete Attempt history");
  }
  for (const [index, attempt] of previousAttempts.entries()) {
    assertTrustedAttempt(attempt);
    assertAttemptMatchesDispatch(attempt, verifiedEnvelope, verifiedProjection.pendingRole.role, verifiedProjection.pendingRole.dispatchId);
    if (attempt.generation !== index + 1) {
      throw conflict("ROLE_ATTEMPT_HISTORY_INCOMPLETE", "Role Attempt generations must be continuous and ordered");
    }
    if (!isTerminalAttempt(attempt.status)) {
      throw conflict("ROLE_ATTEMPT_STILL_ACTIVE", `Role Attempt ${attempt.attemptId} is not terminal`);
    }
  }
  const last = previousAttempts.at(-1)!;
  if (last.status === "SUCCEEDED") {
    throw conflict("ROLE_ATTEMPT_ALREADY_SUCCEEDED", "A successful Role Attempt cannot be retried");
  }
  assertTimeOrder(last.finishedAt ?? last.scheduledAt, scheduledAt, "scheduledAt");
  return newRoleAttempt(verifiedEnvelope, verifiedProjection.pendingRole, previousAttempts.length + 1, scheduledAt);
}

export function startRoleAttempt(attempt: RoleAttempt, startedAt: string): RoleAttempt {
  assertTrustedAttempt(attempt);
  if (attempt.status !== "SCHEDULED") {
    throw conflict("ROLE_ATTEMPT_NOT_SCHEDULED", `Role Attempt ${attempt.attemptId} cannot start from ${attempt.status}`);
  }
  assertIsoInstant(startedAt, "startedAt");
  assertTimeOrder(attempt.scheduledAt, startedAt, "startedAt");
  return finalizeAttempt({ ...attemptWithoutDigest(attempt), status: "RUNNING", startedAt });
}

export function finishRoleAttempt(
  attempt: RoleAttempt,
  result: RoleRunResult,
  finishedAt: string,
): RoleAttempt {
  assertTrustedAttempt(attempt);
  assertTrustedResult(result);
  if (attempt.status !== "RUNNING") {
    throw conflict("ROLE_ATTEMPT_NOT_RUNNING", `Role Attempt ${attempt.attemptId} cannot finish from ${attempt.status}`);
  }
  assertResultMatchesAttempt(result, attempt);
  assertIsoInstant(finishedAt, "finishedAt");
  assertTimeOrder(attempt.startedAt!, result.startedAt, "result.startedAt");
  assertTimeOrder(attempt.startedAt!, finishedAt, "finishedAt");
  if (finishedAt !== result.finishedAt) {
    throw conflict("ROLE_ATTEMPT_RESULT_TIME_MISMATCH", "Attempt finishedAt must match Role Result finishedAt");
  }
  const succeeded = result.outcome === "SUCCEEDED";
  return finalizeAttempt({
    ...attemptWithoutDigest(attempt),
    status: succeeded ? "SUCCEEDED" : "FAILED",
    finishedAt,
    resultDigest: result.resultDigest,
    ...(succeeded ? {} : { error: result.error?.message ?? result.outcome }),
  });
}

export function cancelRoleAttempt(attempt: RoleAttempt, finishedAt: string): RoleAttempt {
  assertTrustedAttempt(attempt);
  if (attempt.status !== "SCHEDULED" && attempt.status !== "RUNNING") {
    throw conflict("ROLE_ATTEMPT_ALREADY_TERMINAL", `Role Attempt ${attempt.attemptId} is already ${attempt.status}`);
  }
  assertIsoInstant(finishedAt, "finishedAt");
  assertTimeOrder(attempt.startedAt ?? attempt.scheduledAt, finishedAt, "finishedAt");
  return finalizeAttempt({ ...attemptWithoutDigest(attempt), status: "CANCELLED", finishedAt });
}

export async function createRoleRunRequest(input: RoleRunRequestInput): Promise<RoleRunRequest> {
  assertTrustedAttempt(input.attempt);
  if (input.attempt.status !== "RUNNING") {
    throw conflict("ROLE_ATTEMPT_NOT_RUNNING", "Role Run Request requires a RUNNING Role Attempt");
  }
  const prompt = exactPrompt(input.prompt);
  const workspaceOrArtifactScope = await requireDirectory(input.workspaceOrArtifactScope, "workspaceOrArtifactScope");
  const artifactRoot = await prepareArtifactRoot(input.artifactRoot);
  if (isSameOrWithin(workspaceOrArtifactScope, artifactRoot)) {
    throw validation("ROLE_ARTIFACT_SCOPE_OVERLAP", "Role Artifact Root cannot be inside the Role input scope");
  }
  const promptDigest = sha256(Buffer.from(prompt));
  const core = requestCore(input.attempt, readRunnerKind(input.runnerKind), workspaceOrArtifactScope, artifactRoot, promptDigest);
  const runId = digest("role-run", core);
  const token = runId.slice("sha256:".length);
  const artifactPath = path.resolve(artifactRoot, `role-run-${token}`);
  assertDirectChild(artifactRoot, artifactPath);
  await rejectSymlinkIfPresent(artifactPath);
  const request: RoleRunRequest = { ...core, artifactPath, prompt, runId };
  trustedRequests.add(request);
  return deepFreeze(request);
}

export async function parseRoleRunRequest(value: unknown, expectedRunId: string): Promise<RoleRunRequest> {
  const input = asRecord(value, "RoleRunRequest");
  const attempt = roleAttemptFromRequest(input);
  const request = await createRoleRunRequest({
    attempt,
    runnerKind: readRunnerKind(input["runnerKind"]),
    workspaceOrArtifactScope: readString(input, "workspaceOrArtifactScope"),
    artifactRoot: readString(input, "artifactRoot"),
    prompt: readString(input, "prompt", false),
  });
  if (input["schemaVersion"] !== 1 || input["runId"] !== expectedRunId || request.runId !== expectedRunId ||
      input["artifactPath"] !== request.artifactPath || input["promptDigest"] !== request.promptDigest) {
    throw conflict("ROLE_RUN_REQUEST_INTEGRITY_FAILED", "serialized RoleRunRequest differs from canonical input");
  }
  return request;
}

export async function claimRoleExecution(request: RoleRunRequest): Promise<boolean> {
  assertTrustedRequest(request);
  await assertRequestPathsSafe(request);
  await mkdir(request.artifactPath, { recursive: true });
  await assertRequestPathsSafe(request);
  const intent = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    runId: request.runId,
    taskId: request.taskId,
    specRevision: request.specRevision,
    role: request.role,
    stepId: request.stepId,
    attemptId: request.attemptId,
    generation: request.generation,
    dispatchId: request.dispatchId,
    inputDigest: request.inputDigest,
    promptDigest: request.promptDigest,
  }, null, 2)}\n`);
  const target = path.join(request.artifactPath, "execution-intent.json");
  try {
    await writeFile(target, intent, { flag: "wx" });
    return true;
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (!(await readFile(target)).equals(intent)) {
      throw conflict("ROLE_EXECUTION_INTENT_CONFLICT", "Role execution intent differs for the stable Run ID");
    }
    return false;
  }
}

export async function reconcileRoleRun(request: RoleRunRequest): Promise<RoleRunResult | undefined> {
  assertTrustedRequest(request);
  await assertRequestPathsSafe(request);
  if (!(await pathExists(request.artifactPath))) return undefined;
  const entries = await readdir(request.artifactPath);
  if (entries.length === 0) return undefined;
  const manifestPath = path.join(request.artifactPath, "manifest.json");
  const pendingPath = `${manifestPath}.pending`;
  if (await pathExists(manifestPath)) {
    return parseRoleRunResult(JSON.parse(await readFile(manifestPath, "utf8")) as unknown, request);
  }
  if (await pathExists(pendingPath)) {
    const parsed = await parseRoleRunResult(JSON.parse(await readFile(pendingPath, "utf8")) as unknown, request);
    await rename(pendingPath, manifestPath);
    return parsed;
  }
  if (entries.includes("execution-intent.json")) {
    throw unknown(
      "ROLE_RUN_RESULT_UNKNOWN",
      `Execution intent exists for ${request.runId} without a confirmed manifest; reconcile before retry`,
    );
  }
  throw conflict("INCOMPLETE_ROLE_ARTIFACT", "Role Artifact directory exists without intent or manifest");
}

export async function parseRoleRunResult(value: unknown, request: RoleRunRequest): Promise<RoleRunResult> {
  assertTrustedRequest(request);
  const input = asRecord(value, "RoleRunResult");
  if (!Array.isArray(input["artifacts"])) throw validation("INVALID_ROLE_ARTIFACTS", "Role Result artifacts must be an array");
  const artifacts = input["artifacts"].map((artifact) => parseArtifact(artifact, request));
  const output = input["output"] === null ? null : parseRoleOutput(input["output"], request.role, artifacts);
  const error = input["error"] === undefined ? undefined : parseRoleError(input["error"]);
  const resultCore = {
    schemaVersion: 1 as const,
    runId: readString(input, "runId"),
    runnerKind: readRunnerKind(input["runnerKind"]),
    taskId: readString(input, "taskId"),
    specRevision: readPositiveInteger(input["specRevision"], "specRevision"),
    role: readRole(input["role"]),
    stepId: readStepId(input["stepId"]),
    attemptId: readString(input, "attemptId"),
    generation: readPositiveInteger(input["generation"], "generation"),
    inputDigest: readDigest(input["inputDigest"], "inputDigest"),
    ...(typeof input["sessionId"] === "string" ? { sessionId: readString(input, "sessionId") } : {}),
    outcome: readOutcome(input["outcome"]),
    startedAt: readString(input, "startedAt"),
    finishedAt: readString(input, "finishedAt"),
    durationMs: readNonNegativeInteger(input["durationMs"], "durationMs"),
    artifacts,
    output,
    ...(error === undefined ? {} : { error }),
  };
  validateResultCore(resultCore, request);
  const expected = digest("role-result", resultCore);
  if (input["schemaVersion"] !== 1 || input["resultDigest"] !== expected) {
    throw conflict("ROLE_RESULT_INTEGRITY_FAILED", "Role Result does not match its digest");
  }
  for (const artifact of artifacts) await verifyArtifact(request, artifact);
  const result: RoleRunResult = { ...resultCore, resultDigest: expected };
  trustedResults.add(result);
  return deepFreeze(result);
}

async function persistRoleRun(request: RoleRunRequest, script: FakeRoleScript): Promise<RoleRunResult> {
  assertTrustedRequest(request);
  await assertRequestPathsSafe(request);
  const artifacts = script.artifacts.map((item) => artifactFromContent(request, item));
  assertUnique(artifacts.map((artifact) => artifact.name), "Role Artifact name");
  const output = script.outcome === "SUCCEEDED"
    ? buildRoleOutput(request.role, artifacts, script)
    : null;
  const startedAt = script.startedAt;
  const finishedAt = new Date(Date.parse(startedAt) + script.durationMs).toISOString();
  const core = {
    schemaVersion: 1 as const,
    runId: request.runId,
    runnerKind: request.runnerKind,
    taskId: request.taskId,
    specRevision: request.specRevision,
    role: request.role,
    stepId: request.stepId,
    attemptId: request.attemptId,
    generation: request.generation,
    inputDigest: request.inputDigest,
    ...(script.sessionId === undefined ? {} : { sessionId: script.sessionId }),
    outcome: script.outcome,
    startedAt,
    finishedAt,
    durationMs: script.durationMs,
    artifacts,
    output,
    ...(script.error === undefined ? {} : { error: script.error }),
  };
  validateResultCore(core, request);
  const result: RoleRunResult = deepFreeze({ ...core, resultDigest: digest("role-result", core) });
  trustedResults.add(result);
  for (const [index, artifact] of artifacts.entries()) {
    await writeStableFile(path.join(request.artifactPath, artifact.name), Buffer.from(script.artifacts[index]!.content));
  }
  await writeStableFile(
    path.join(request.artifactPath, "manifest.json"),
    Buffer.from(`${JSON.stringify(result, null, 2)}\n`),
  );
  return result;
}

function newRoleAttempt(
  envelope: TaskEnvelope,
  dispatch: NonNullable<CoreProjection["pendingRole"]>,
  generation: number,
  scheduledAt: string,
): RoleAttempt {
  assertIsoInstant(scheduledAt, "scheduledAt");
  const stepId = ROLE_STEP_IDS[dispatch.role];
  const core = {
    schemaVersion: 1 as const,
    taskId: envelope.taskId,
    specRevision: envelope.specRevision,
    envelopeDigest: envelope.envelopeDigest,
    role: dispatch.role,
    stepId,
    attemptId: `${envelope.taskId}/${stepId}/attempt-${String(generation).padStart(3, "0")}`,
    generation,
    dispatchId: dispatch.dispatchId,
    inputDigest: dispatch.inputDigest,
    status: "SCHEDULED" as const,
    scheduledAt,
  };
  return finalizeAttempt(core);
}

function roleAttemptFromRequest(input: Record<string, unknown>): RoleAttempt {
  const generation = readPositiveInteger(input["generation"], "generation");
  const role = readRole(input["role"]);
  const stepId = readStepId(input["stepId"]);
  const taskId = readString(input, "taskId");
  const attemptId = readString(input, "attemptId");
  if (ROLE_STEP_IDS[role] !== stepId || attemptId !== `${taskId}/${stepId}/attempt-${String(generation).padStart(3, "0")}`) {
    throw conflict("ROLE_ATTEMPT_IDENTITY_INVALID", "Role Request Attempt identity is not canonical");
  }
  const core = {
    schemaVersion: 1 as const,
    taskId,
    specRevision: readPositiveInteger(input["specRevision"], "specRevision"),
    envelopeDigest: "sha256:" + "0".repeat(64),
    role,
    stepId,
    attemptId,
    generation,
    dispatchId: readString(input, "dispatchId"),
    inputDigest: readDigest(input["inputDigest"], "inputDigest"),
    status: "RUNNING" as const,
    scheduledAt: "1970-01-01T00:00:00.000Z",
    startedAt: "1970-01-01T00:00:00.000Z",
  };
  return finalizeAttempt(core);
}

function requestCore(
  attempt: RoleAttempt,
  runnerKind: RoleRunnerKind,
  workspaceOrArtifactScope: string,
  artifactRoot: string,
  promptDigest: string,
) {
  return {
    schemaVersion: 1 as const,
    taskId: attempt.taskId,
    specRevision: attempt.specRevision,
    role: attempt.role,
    stepId: attempt.stepId,
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    dispatchId: attempt.dispatchId,
    inputDigest: attempt.inputDigest,
    runnerKind,
    workspaceOrArtifactScope,
    artifactRoot,
    promptDigest,
  };
}

function artifactFromContent(request: RoleRunRequest, input: FakeRoleArtifactInput): RoleArtifact {
  const name = artifactName(input.name);
  const content = Buffer.from(input.content);
  const kind = readArtifactKind(input.kind);
  return deepFreeze({
    name,
    kind,
    artifactRef: `role-artifact://${request.runId}/${name}`,
    contentDigest: sha256(content),
    bytes: content.byteLength,
    producer: producer(request),
  });
}

function parseArtifact(value: unknown, request: RoleRunRequest): RoleArtifact {
  const input = asRecord(value, "Role Artifact");
  const artifact: RoleArtifact = {
    name: artifactName(readString(input, "name")),
    kind: readArtifactKind(input["kind"]),
    artifactRef: readString(input, "artifactRef"),
    contentDigest: readDigest(input["contentDigest"], "contentDigest"),
    bytes: readNonNegativeInteger(input["bytes"], "bytes"),
    producer: parseProducer(input["producer"]),
  };
  if (artifact.artifactRef !== `role-artifact://${request.runId}/${artifact.name}` ||
      canonicalJson(artifact.producer) !== canonicalJson(producer(request))) {
    throw conflict("ROLE_ARTIFACT_PRODUCER_MISMATCH", "Role Artifact does not match its Request producer");
  }
  return deepFreeze(artifact);
}

function buildRoleOutput(role: CoreRole, artifacts: readonly RoleArtifact[], script: FakeRoleScript): RoleOutput {
  if (role === "DOCS") {
    const phase = script.docsPhase ?? "SPEC_DESIGN";
    if (phase === "SPEC_DESIGN") {
      return deepFreeze({
        type: "DOCS_RESULT" as const,
        phase,
        specRef: requireArtifact(artifacts, "DOC_SPEC").artifactRef,
        planRef: requireArtifact(artifacts, "DOC_PLAN").artifactRef,
        designRef: requireArtifact(artifacts, "DOC_DESIGN").artifactRef,
      });
    }
    return deepFreeze({
      type: "DOCS_RESULT" as const,
      phase,
      docsImpactRef: requireArtifact(artifacts, "DOCS_IMPACT").artifactRef,
      knowledgeSyncRef: requireArtifact(artifacts, "KNOWLEDGE_SYNC").artifactRef,
    });
  }
  if (role === "IMPLEMENTATION") {
    const resultCommit = script.resultCommit;
    if (resultCommit === undefined || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(resultCommit)) {
      throw validation("INVALID_RESULT_COMMIT", "Implementation resultCommit must be a full Git object ID");
    }
    return deepFreeze({
      type: "IMPLEMENTATION_RESULT" as const,
      checkpointRef: requireArtifact(artifacts, "CHECKPOINT").artifactRef,
      testEvidenceRefs: artifacts.filter((item) => item.kind === "TEST_EVIDENCE").map((item) => item.artifactRef),
      selfReviewRef: requireArtifact(artifacts, "SELF_REVIEW").artifactRef,
      resultCommit,
    });
  }
  const verdict = script.reviewVerdict ?? "PASSED";
  const findingRefs = artifacts.filter((item) => item.kind === "REVIEW_FINDING").map((item) => item.artifactRef);
  if (verdict === "FINDINGS" && findingRefs.length === 0) {
    throw validation("REVIEW_FINDING_REQUIRED", "Review verdict FINDINGS requires at least one Finding Artifact");
  }
  if (verdict === "PASSED" && findingRefs.length > 0) {
    throw validation("REVIEW_FINDING_CONTRADICTION", "Review verdict PASSED cannot include Finding Artifacts");
  }
  return deepFreeze({
    type: "REVIEW_RESULT" as const,
    verdict,
    reviewResultRef: requireArtifact(artifacts, "REVIEW_RESULT").artifactRef,
    findingRefs,
  });
}

function parseRoleOutput(value: unknown, role: CoreRole, artifacts: readonly RoleArtifact[]): RoleOutput {
  const input = asRecord(value, "Role output");
  const refs = new Set(artifacts.map((artifact) => artifact.artifactRef));
  if (role === "DOCS" && input["type"] === "DOCS_RESULT") {
    const phase = input["phase"];
    if (phase === "SPEC_DESIGN") {
      const output: DocsRoleOutput = {
        type: "DOCS_RESULT", phase,
        specRef: readArtifactRef(input, "specRef", refs),
        planRef: readArtifactRef(input, "planRef", refs),
        designRef: readArtifactRef(input, "designRef", refs),
      };
      validateOutputKinds(output, artifacts);
      return deepFreeze(output);
    }
    if (phase === "DOCS_IMPACT") {
      const output: DocsRoleOutput = {
        type: "DOCS_RESULT", phase,
        docsImpactRef: readArtifactRef(input, "docsImpactRef", refs),
        knowledgeSyncRef: readArtifactRef(input, "knowledgeSyncRef", refs),
      };
      validateOutputKinds(output, artifacts);
      return deepFreeze(output);
    }
  }
  if (role === "IMPLEMENTATION" && input["type"] === "IMPLEMENTATION_RESULT") {
    if (!Array.isArray(input["testEvidenceRefs"])) {
      throw validation("INVALID_TEST_EVIDENCE_REFS", "Implementation output testEvidenceRefs must be an array");
    }
    const output: ImplementationRoleOutput = {
      type: "IMPLEMENTATION_RESULT",
      checkpointRef: readArtifactRef(input, "checkpointRef", refs),
      testEvidenceRefs: input["testEvidenceRefs"].map((ref) => checkedArtifactRef(ref, refs)),
      selfReviewRef: readArtifactRef(input, "selfReviewRef", refs),
      resultCommit: readResultCommit(input["resultCommit"]),
    };
    validateOutputKinds(output, artifacts);
    return deepFreeze(output);
  }
  if (role === "REVIEW" && input["type"] === "REVIEW_RESULT") {
    if (!Array.isArray(input["findingRefs"])) throw validation("INVALID_FINDING_REFS", "Review findingRefs must be an array");
    const verdict = input["verdict"];
    if (verdict !== "PASSED" && verdict !== "FINDINGS") throw validation("INVALID_REVIEW_VERDICT", "Invalid Review verdict");
    const output: ReviewRoleOutput = {
      type: "REVIEW_RESULT",
      verdict,
      reviewResultRef: readArtifactRef(input, "reviewResultRef", refs),
      findingRefs: input["findingRefs"].map((ref) => checkedArtifactRef(ref, refs)),
    };
    validateOutputKinds(output, artifacts);
    return deepFreeze(output);
  }
  throw validation("ROLE_OUTPUT_SCHEMA_MISMATCH", `Role output does not match ${role}`);
}

function validateOutputKinds(output: RoleOutput, artifacts: readonly RoleArtifact[]): void {
  const byRef = new Map(artifacts.map((artifact) => [artifact.artifactRef, artifact.kind]));
  if (output.type === "DOCS_RESULT" && output.phase === "SPEC_DESIGN") {
    assertRefKind(byRef, output.specRef, "DOC_SPEC");
    assertRefKind(byRef, output.planRef, "DOC_PLAN");
    assertRefKind(byRef, output.designRef, "DOC_DESIGN");
  } else if (output.type === "DOCS_RESULT") {
    assertRefKind(byRef, output.docsImpactRef, "DOCS_IMPACT");
    assertRefKind(byRef, output.knowledgeSyncRef, "KNOWLEDGE_SYNC");
  } else if (output.type === "IMPLEMENTATION_RESULT") {
    assertRefKind(byRef, output.checkpointRef, "CHECKPOINT");
    assertRefKind(byRef, output.selfReviewRef, "SELF_REVIEW");
    if (output.testEvidenceRefs.length === 0) throw validation("TEST_EVIDENCE_REQUIRED", "Implementation requires Test Evidence");
    for (const ref of output.testEvidenceRefs) assertRefKind(byRef, ref, "TEST_EVIDENCE");
  } else {
    assertRefKind(byRef, output.reviewResultRef, "REVIEW_RESULT");
    if (output.verdict === "FINDINGS" && output.findingRefs.length === 0) {
      throw validation("REVIEW_FINDING_REQUIRED", "Review verdict FINDINGS requires Finding Artifacts");
    }
    if (output.verdict === "PASSED" && output.findingRefs.length > 0) {
      throw validation("REVIEW_FINDING_CONTRADICTION", "Review verdict PASSED cannot include Finding Artifacts");
    }
    for (const ref of output.findingRefs) assertRefKind(byRef, ref, "REVIEW_FINDING");
  }
}

function validateResultCore(core: Omit<RoleRunResult, "resultDigest">, request: RoleRunRequest): void {
  if (core.runId !== request.runId || core.runnerKind !== request.runnerKind || core.taskId !== request.taskId ||
      core.specRevision !== request.specRevision || core.role !== request.role || core.stepId !== request.stepId ||
      core.attemptId !== request.attemptId || core.generation !== request.generation || core.inputDigest !== request.inputDigest) {
    throw conflict("ROLE_RESULT_REQUEST_MISMATCH", "Role Result identity does not match its Request");
  }
  assertIsoInstant(core.startedAt, "startedAt");
  assertIsoInstant(core.finishedAt, "finishedAt");
  if (Date.parse(core.finishedAt) - Date.parse(core.startedAt) !== core.durationMs) {
    throw conflict("ROLE_RESULT_DURATION_MISMATCH", "Role Result timestamps do not match durationMs");
  }
  assertUnique(core.artifacts.map((artifact) => artifact.name), "Role Artifact name");
  if (core.outcome === "SUCCEEDED") {
    if (core.output === null || core.error !== undefined) {
      throw validation("ROLE_SUCCESS_SCHEMA_INVALID", "Succeeded Role Result requires output and no error");
    }
    validateOutputKinds(core.output, core.artifacts);
  } else if (core.output !== null || core.error === undefined) {
    throw validation("ROLE_FAILURE_SCHEMA_INVALID", "Failed/invalid Role Result requires error and no output");
  }
}

async function verifyArtifact(request: RoleRunRequest, artifact: RoleArtifact): Promise<void> {
  const target = path.resolve(request.artifactPath, artifact.name);
  assertDirectChild(request.artifactPath, target);
  const real = await realpath(target);
  const realRunRoot = await realpath(request.artifactPath);
  if (path.dirname(real) !== realRunRoot || !(await stat(real)).isFile()) {
    throw conflict("ROLE_ARTIFACT_PATH_ESCAPE", `Role Artifact escapes its Run directory: ${artifact.name}`);
  }
  const content = await readFile(real);
  if (content.byteLength !== artifact.bytes || sha256(content) !== artifact.contentDigest) {
    throw conflict("ROLE_ARTIFACT_INTEGRITY_FAILED", `Role Artifact content differs from manifest: ${artifact.name}`);
  }
}

async function assertRequestPathsSafe(request: RoleRunRequest): Promise<void> {
  const scope = await requireDirectory(request.workspaceOrArtifactScope, "workspaceOrArtifactScope");
  const root = await requireDirectory(request.artifactRoot, "artifactRoot");
  if (scope !== request.workspaceOrArtifactScope || root !== request.artifactRoot) {
    throw conflict("ROLE_REQUEST_PATH_DRIFT", "Role Request path realpath changed after validation");
  }
  assertDirectChild(root, request.artifactPath);
  await rejectSymlinkIfPresent(request.artifactPath);
}

async function prepareArtifactRoot(value: string): Promise<string> {
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    throw validation("UNSAFE_ROLE_ARTIFACT_ROOT", "Filesystem root cannot be a Role Artifact Root");
  }
  await mkdir(resolved, { recursive: true });
  if ((await lstat(resolved)).isSymbolicLink()) {
    throw validation("ROLE_ARTIFACT_ROOT_SYMLINK", "Role Artifact Root cannot be a symlink");
  }
  const real = await realpath(resolved);
  return real;
}

async function requireDirectory(value: string, field: string): Promise<string> {
  const resolved = path.resolve(value);
  const direct = await lstat(resolved);
  const real = await realpath(resolved);
  if (direct.isSymbolicLink() || !(await stat(real)).isDirectory()) {
    throw validation("INVALID_ROLE_DIRECTORY", `${field} must be an existing non-symlink directory`);
  }
  return real;
}

async function rejectSymlinkIfPresent(target: string): Promise<void> {
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      throw validation("ROLE_RUN_PATH_SYMLINK", "Role Run directory cannot be a symlink");
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function writeStableFile(target: string, content: Buffer): Promise<void> {
  try {
    const current = await readFile(target);
    if (current.equals(content)) return;
    throw conflict("ROLE_ARTIFACT_CONFLICT", `Role Artifact already exists with different content: ${target}`);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const pending = `${target}.pending`;
  try {
    await writeFile(pending, content, { flag: "wx" });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (!(await readFile(pending)).equals(content)) {
      throw conflict("ROLE_ARTIFACT_PENDING_CONFLICT", `Pending Role Artifact conflicts: ${target}`);
    }
  }
  await rename(pending, target);
}

function revalidateEnvelope(envelope: TaskEnvelope): TaskEnvelope {
  return parseTaskEnvelope(JSON.parse(JSON.stringify(envelope)) as unknown, envelope.envelopeDigest);
}

function revalidateProjection(projection: CoreProjection, envelope: TaskEnvelope): CoreProjection {
  return parseCoreProjection(JSON.parse(JSON.stringify(projection)) as unknown, envelope, projection.projectionDigest);
}

function finalizeAttempt(core: Omit<RoleAttempt, "attemptDigest">): RoleAttempt {
  const attempt: RoleAttempt = { ...core, attemptDigest: digest("role-attempt", core) };
  trustedAttempts.add(attempt);
  return deepFreeze(attempt);
}

function attemptWithoutDigest(attempt: RoleAttempt): Omit<RoleAttempt, "attemptDigest"> {
  const { attemptDigest: _digest, ...core } = attempt;
  return core;
}

function assertTrustedAttempt(attempt: RoleAttempt): void {
  if (!trustedAttempts.has(attempt) || !Object.isFrozen(attempt)) {
    throw validation("UNTRUSTED_ROLE_ATTEMPT", "Role Attempt must come from the Role Attempt protocol");
  }
  const { attemptDigest, ...core } = attempt;
  if (attemptDigest !== digest("role-attempt", core)) {
    throw conflict("ROLE_ATTEMPT_INTEGRITY_FAILED", "Role Attempt digest is stale");
  }
}

function assertTrustedRequest(request: RoleRunRequest): void {
  if (!trustedRequests.has(request) || !Object.isFrozen(request)) {
    throw validation("UNTRUSTED_ROLE_REQUEST", "Role Run Request must come from createRoleRunRequest or parseRoleRunRequest");
  }
}

function assertTrustedResult(result: RoleRunResult): void {
  if (!trustedResults.has(result) || !Object.isFrozen(result)) {
    throw validation("UNTRUSTED_ROLE_RESULT", "Role Run Result must be persisted or parsed by Role Runner");
  }
}

function assertAttemptMatchesDispatch(
  attempt: RoleAttempt,
  envelope: TaskEnvelope,
  role: CoreRole,
  dispatchId: string,
): void {
  if (attempt.taskId !== envelope.taskId || attempt.specRevision !== envelope.specRevision ||
      attempt.envelopeDigest !== envelope.envelopeDigest || attempt.role !== role || attempt.stepId !== ROLE_STEP_IDS[role] ||
      attempt.dispatchId !== dispatchId) {
    throw conflict("ROLE_ATTEMPT_DISPATCH_MISMATCH", "Role Attempt does not belong to the current Pending Role Dispatch");
  }
}

function assertResultMatchesAttempt(result: RoleRunResult, attempt: RoleAttempt): void {
  if (result.taskId !== attempt.taskId || result.specRevision !== attempt.specRevision || result.role !== attempt.role ||
      result.stepId !== attempt.stepId || result.attemptId !== attempt.attemptId || result.generation !== attempt.generation ||
      result.inputDigest !== attempt.inputDigest) {
    throw conflict("ROLE_RESULT_ATTEMPT_MISMATCH", "Role Result was not produced for this Attempt");
  }
}

function producer(request: RoleRunRequest): RoleArtifact["producer"] {
  return {
    taskId: request.taskId,
    specRevision: request.specRevision,
    role: request.role,
    stepId: request.stepId,
    attemptId: request.attemptId,
    generation: request.generation,
    runId: request.runId,
    inputDigest: request.inputDigest,
  };
}

function parseProducer(value: unknown): RoleArtifact["producer"] {
  const input = asRecord(value, "Role Artifact producer");
  return {
    taskId: readString(input, "taskId"),
    specRevision: readPositiveInteger(input["specRevision"], "specRevision"),
    role: readRole(input["role"]),
    stepId: readStepId(input["stepId"]),
    attemptId: readString(input, "attemptId"),
    generation: readPositiveInteger(input["generation"], "generation"),
    runId: readDigest(input["runId"], "runId"),
    inputDigest: readDigest(input["inputDigest"], "inputDigest"),
  };
}

function parseRoleError(value: unknown): NonNullable<RoleRunResult["error"]> {
  const input = asRecord(value, "Role error");
  const category = input["category"];
  const categories: readonly MoyeErrorCategory[] = [
    "VALIDATION", "CONFLICT", "NOT_FOUND", "TRANSIENT_IO", "UNKNOWN_SIDE_EFFECT", "TERMINAL",
  ];
  if (!categories.includes(category as MoyeErrorCategory)) throw validation("INVALID_ROLE_ERROR_CATEGORY", "Invalid Role error category");
  return {
    code: readString(input, "code"),
    category: category as MoyeErrorCategory,
    message: readString(input, "message"),
  };
}

function validateFakeScript(script: FakeRoleScript): void {
  assertIsoInstant(script.startedAt, "startedAt");
  readNonNegativeInteger(script.durationMs, "durationMs");
  readOutcome(script.outcome);
  if (script.sessionId !== undefined && (script.sessionId.trim().length === 0 || script.sessionId.includes("\0"))) {
    throw validation("INVALID_ROLE_SESSION", "Fake Role sessionId must be a non-empty NUL-free string");
  }
  if (script.docsPhase !== undefined && script.docsPhase !== "SPEC_DESIGN" && script.docsPhase !== "DOCS_IMPACT") {
    throw validation("INVALID_DOCS_PHASE", "Fake Role docsPhase is invalid");
  }
  if (script.reviewVerdict !== undefined && script.reviewVerdict !== "PASSED" && script.reviewVerdict !== "FINDINGS") {
    throw validation("INVALID_REVIEW_VERDICT", "Fake Role reviewVerdict is invalid");
  }
  if (!Array.isArray(script.artifacts)) throw validation("INVALID_FAKE_ROLE_ARTIFACTS", "Fake Role artifacts must be an array");
  for (const artifact of script.artifacts) {
    artifactName(artifact.name);
    readArtifactKind(artifact.kind);
    if (typeof artifact.content !== "string" || artifact.content.includes("\0")) {
      throw validation("INVALID_FAKE_ROLE_CONTENT", "Fake Role Artifact content must be a NUL-free string");
    }
  }
  if (script.outcome === "SUCCEEDED" && script.error !== undefined) {
    throw validation("FAKE_ROLE_SUCCESS_ERROR", "Succeeded Fake Role script cannot have error");
  }
  if (script.outcome !== "SUCCEEDED" && script.error === undefined) {
    throw validation("FAKE_ROLE_FAILURE_ERROR_REQUIRED", "Failed Fake Role script requires error");
  }
  if (script.error !== undefined) parseRoleError(script.error);
}

function requireArtifact(artifacts: readonly RoleArtifact[], kind: RoleArtifactKind): RoleArtifact {
  const matches = artifacts.filter((artifact) => artifact.kind === kind);
  if (matches.length !== 1) throw validation("ROLE_ARTIFACT_REQUIRED", `Role output requires exactly one ${kind} Artifact`);
  return matches[0]!;
}

function assertRefKind(
  refs: ReadonlyMap<string, RoleArtifactKind>,
  ref: string | undefined,
  expected: RoleArtifactKind,
): void {
  if (ref === undefined || refs.get(ref) !== expected) {
    throw conflict("ROLE_OUTPUT_ARTIFACT_KIND_MISMATCH", `Role output reference must point to ${expected}`);
  }
}

function readArtifactRef(input: Record<string, unknown>, field: string, refs: ReadonlySet<string>): string {
  return checkedArtifactRef(input[field], refs);
}

function checkedArtifactRef(value: unknown, refs: ReadonlySet<string>): string {
  if (typeof value !== "string" || !refs.has(value)) {
    throw conflict("ROLE_OUTPUT_ARTIFACT_MISSING", "Role output references an Artifact outside its manifest");
  }
  return value;
}

function readRole(value: unknown): CoreRole {
  if (!CORE_ROLES.includes(value as CoreRole)) throw validation("INVALID_CORE_ROLE", `Invalid Core Role: ${String(value)}`);
  return value as CoreRole;
}

function readStepId(value: unknown): RoleStepId {
  const values = Object.values(ROLE_STEP_IDS) as RoleStepId[];
  if (!values.includes(value as RoleStepId)) throw validation("INVALID_ROLE_STEP", `Invalid Role Step: ${String(value)}`);
  return value as RoleStepId;
}

function readRunnerKind(value: unknown): RoleRunnerKind {
  if (value !== "FAKE" && value !== "CODEX_EXEC" && value !== "CLAUDE_PRINT") {
    throw validation("INVALID_ROLE_RUNNER_KIND", `Invalid Role Runner kind: ${String(value)}`);
  }
  return value;
}

function readOutcome(value: unknown): RoleRunOutcome {
  if (value !== "SUCCEEDED" && value !== "FAILED" && value !== "INVALID_OUTPUT") {
    throw validation("INVALID_ROLE_OUTCOME", `Invalid Role outcome: ${String(value)}`);
  }
  return value;
}

function readArtifactKind(value: unknown): RoleArtifactKind {
  const kinds: readonly RoleArtifactKind[] = [
    "DOC_SPEC", "DOC_PLAN", "DOC_DESIGN", "DOCS_IMPACT", "KNOWLEDGE_SYNC", "CHECKPOINT",
    "TEST_EVIDENCE", "SELF_REVIEW", "REVIEW_RESULT", "REVIEW_FINDING", "DIAGNOSTIC",
  ];
  if (!kinds.includes(value as RoleArtifactKind)) throw validation("INVALID_ROLE_ARTIFACT_KIND", `Invalid Artifact kind: ${String(value)}`);
  return value as RoleArtifactKind;
}

function artifactName(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value)) {
    throw validation("INVALID_ROLE_ARTIFACT_NAME", "Role Artifact name must be a safe basename");
  }
  return value;
}

function exactPrompt(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw validation("INVALID_ROLE_PROMPT", "Role prompt must be a non-empty NUL-free string");
  }
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validation("INVALID_ROLE_OBJECT", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readString(input: Record<string, unknown>, field: string, trim = true): string {
  const value = input[field];
  if (typeof value !== "string" || value.includes("\0") || (trim && value.trim().length === 0)) {
    throw validation("INVALID_ROLE_STRING", `${field} must be a valid string`);
  }
  return trim ? value.trim() : value;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw validation("INVALID_POSITIVE_INTEGER", `${field} must be positive`);
  return value as number;
}

function readNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw validation("INVALID_NON_NEGATIVE_INTEGER", `${field} must be non-negative`);
  return value as number;
}

function readDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw validation("INVALID_ROLE_DIGEST", `${field} must be a SHA-256 digest`);
  }
  return value;
}

function readResultCommit(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)) {
    throw validation("INVALID_RESULT_COMMIT", "Implementation resultCommit must be a full Git object ID");
  }
  return value;
}

function assertIsoInstant(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw validation("INVALID_ROLE_TIMESTAMP", `${field} must be a canonical UTC instant`);
  }
}

function assertTimeOrder(earlier: string, later: string, field: string): void {
  if (Date.parse(later) < Date.parse(earlier)) throw validation("INVALID_ROLE_TIME_ORDER", `${field} cannot move backwards`);
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw validation("DUPLICATE_ROLE_VALUE", `${label} values must be unique`);
}

function isTerminalAttempt(status: RoleAttemptStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

function assertDirectChild(root: string, candidate: string): void {
  if (path.dirname(candidate) !== root) throw validation("ROLE_PATH_ESCAPE", "Role path must be a direct child of its managed root");
}

function isSameOrWithin(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

async function pathExists(target: string): Promise<boolean> {
  try { await lstat(target); return true; } catch (error) { if (isMissing(error)) return false; throw error; }
}

function sha256(content: Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(namespace).update("\0").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function validation(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "VALIDATION", message });
}

function conflict(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "CONFLICT", message });
}

function unknown(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "UNKNOWN_SIDE_EFFECT", retryable: false, message });
}
