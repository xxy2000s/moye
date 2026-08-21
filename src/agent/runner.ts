import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { MoyeError } from "../domain/errors.js";
import { assertTaskId } from "../domain/task.js";
import type { CodingPipelineStepId } from "../domain/coding-task.js";

const trustedRequests = new WeakSet<object>();
const trustedResults = new WeakSet<object>();
const execFileAsync = promisify(execFile);

export interface AgentRunRequestInput {
  readonly taskId: string;
  readonly specRevision: number;
  readonly stepId: CodingPipelineStepId;
  readonly attemptId: string;
  readonly runnerKind: AgentRunResult["runnerKind"];
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly prompt: string;
}

export interface AgentRunRequest {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly stepId: "IMPLEMENT";
  readonly attemptId: string;
  readonly runnerKind: AgentRunResult["runnerKind"];
  readonly workspaceRoot: string;
  readonly workspaceGitCommonDir: string;
  readonly artifactRoot: string;
  readonly artifactPath: string;
  readonly prompt: string;
  readonly promptDigest: string;
  readonly runId: string;
}

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

export type AgentRunOutcome = "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT";

export interface AgentArtifactFile {
  readonly artifactRef: string;
  readonly contentDigest: string;
  readonly bytes: number;
}

export interface AgentRunResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly runnerKind: "FAKE" | "CODEX_EXEC" | "CLAUDE_PRINT";
  readonly taskId: string;
  readonly specRevision: number;
  readonly stepId: "IMPLEMENT";
  readonly attemptId: string;
  readonly sessionId?: string;
  readonly outcome: AgentRunOutcome;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly finalMessage: string;
  readonly parserError?: string;
  readonly artifacts: {
    readonly events: AgentArtifactFile;
    readonly stderr: AgentArtifactFile;
    readonly finalMessage: AgentArtifactFile;
    readonly rawModelIo?: AgentArtifactFile;
  };
  readonly runDigest: string;
}

export interface AgentExecutionCapture {
  readonly runnerKind: AgentRunResult["runnerKind"];
  readonly stdoutJsonl: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly rawModelIo?: string;
}

export interface AgentEventStream {
  readonly filePath: string;
  writeStdoutChunk(chunk: string): Promise<void>;
  finalize(expectedStdout: string): Promise<void>;
}

export interface FakeAgentScript {
  readonly events: readonly Readonly<Record<string, unknown>>[];
  readonly stderr?: string;
  readonly exitCode: number;
  readonly signal?: NodeJS.Signals | null;
  readonly startedAt: string;
  readonly durationMs: number;
}

export class FakeAgentRunner implements AgentRunner {
  readonly #script: {
    readonly events: readonly Readonly<Record<string, unknown>>[];
    readonly stderr: string;
    readonly exitCode: number;
    readonly signal: NodeJS.Signals | null;
    readonly startedAt: string;
    readonly durationMs: number;
  };

  constructor(script: FakeAgentScript) {
    if (!Array.isArray(script.events)) throw validation("INVALID_FAKE_EVENTS", "Fake events must be an array");
    assertExitCode(script.exitCode);
    assertIsoInstant(script.startedAt, "startedAt");
    if (!Number.isSafeInteger(script.durationMs) || script.durationMs < 0) {
      throw validation("INVALID_FAKE_DURATION", "Fake durationMs must be a non-negative integer");
    }
    this.#script = deepFreeze({
      events: script.events.map((event) => {
        if (!isRecord(event)) throw validation("INVALID_FAKE_EVENT", "Each Fake event must be an object");
        return JSON.parse(JSON.stringify(event)) as Readonly<Record<string, unknown>>;
      }),
      stderr: script.stderr ?? "",
      exitCode: script.exitCode,
      signal: script.signal ?? null,
      startedAt: script.startedAt,
      durationMs: script.durationMs,
    });
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    assertTrustedRequest(request);
    if (request.runnerKind !== "FAKE") throw validation("AGENT_RUNNER_KIND_MISMATCH", "Fake Runner requires a FAKE request");
    const existing = await reconcileAgentRun(request);
    if (existing !== undefined) return existing;
    const started = Date.parse(this.#script.startedAt);
    return persistAgentRun(request, {
      runnerKind: "FAKE",
      stdoutJsonl: this.#script.events.map((event) => JSON.stringify(event)).join("\n") + (this.#script.events.length ? "\n" : ""),
      stderr: this.#script.stderr,
      exitCode: this.#script.exitCode,
      signal: this.#script.signal,
      startedAt: this.#script.startedAt,
      finishedAt: new Date(started + this.#script.durationMs).toISOString(),
    });
  }
}

export async function createAgentRunRequest(input: AgentRunRequestInput): Promise<AgentRunRequest> {
  assertTaskId(input.taskId);
  assertPositiveInteger(input.specRevision, "specRevision");
  if (input.stepId !== "IMPLEMENT") throw validation("INVALID_AGENT_STEP", "AgentRunner only accepts the IMPLEMENT Step");
  const expectedAttemptPrefix = `${input.taskId}/${input.stepId}/attempt-`;
  if (!input.attemptId.startsWith(expectedAttemptPrefix) || !/^\d{3,}$/.test(input.attemptId.slice(expectedAttemptPrefix.length))) {
    throw validation("INVALID_AGENT_ATTEMPT", "attemptId must be the canonical IMPLEMENT Attempt ID");
  }
  if (!input.prompt.trim()) throw validation("EMPTY_AGENT_PROMPT", "Agent prompt must be non-empty");
  if (input.prompt.includes("\0")) throw validation("INVALID_AGENT_PROMPT", "Agent prompt cannot contain NUL");

  const workspaceRoot = await realpath(path.resolve(input.workspaceRoot));
  const workspaceGitCommonDir = await assertGitTopLevel(workspaceRoot);
  const artifactRoot = await resolveManagedRoot(input.artifactRoot);
  if (artifactRoot === path.parse(artifactRoot).root) {
    throw validation("UNSAFE_AGENT_ARTIFACT_ROOT", "Filesystem root cannot be an Agent Artifact Root");
  }
  const promptDigest = sha256(input.prompt);
  const core = {
    schemaVersion: 1 as const,
    taskId: input.taskId,
    specRevision: input.specRevision,
    stepId: input.stepId,
    attemptId: input.attemptId,
    runnerKind: readRunnerKind(input.runnerKind),
    workspaceRoot,
    workspaceGitCommonDir,
    artifactRoot,
    promptDigest,
  };
  const runId = digest("agent-run", core);
  const runToken = runId.slice(runId.lastIndexOf(":") + 1);
  const artifactPath = path.resolve(artifactRoot, `run-${runToken}`);
  assertDirectChild(artifactRoot, artifactPath);
  if (isSameOrWithin(workspaceGitCommonDir, artifactRoot) || isSameOrWithin(workspaceGitCommonDir, artifactPath)) {
    throw validation("AGENT_ARTIFACT_IN_GIT_METADATA", "Agent Artifacts cannot be stored in Git metadata");
  }
  await rejectSymlinkIfPresent(artifactPath);

  const request = deepFreeze({
    ...core,
    artifactPath,
    prompt: input.prompt,
    runId,
  });
  trustedRequests.add(request);
  return request;
}

export async function parseAgentRunRequest(value: unknown, expectedRunId: string): Promise<AgentRunRequest> {
  const input = asRecord(value, "AgentRunRequest");
  if (input["runId"] !== expectedRunId) throw validation("AGENT_RUN_ID_MISMATCH", "Request does not match Expected Run ID");
  const rebuilt = await createAgentRunRequest({
    taskId: readString(input, "taskId"),
    specRevision: readNumber(input, "specRevision"),
    stepId: readString(input, "stepId") as CodingPipelineStepId,
    attemptId: readString(input, "attemptId"),
    runnerKind: readRunnerKind(input["runnerKind"]),
    workspaceRoot: readString(input, "workspaceRoot"),
    artifactRoot: readString(input, "artifactRoot"),
    prompt: readString(input, "prompt", false),
  });
  if (rebuilt.runId !== expectedRunId || input["schemaVersion"] !== 1
      || input["artifactPath"] !== rebuilt.artifactPath || input["promptDigest"] !== rebuilt.promptDigest
      || input["workspaceGitCommonDir"] !== rebuilt.workspaceGitCommonDir) {
    throw validation("AGENT_RUN_REQUEST_TAMPERED", "Serialized Agent Run Request differs from canonical input");
  }
  return rebuilt;
}

export async function persistAgentRun(
  request: AgentRunRequest,
  capture: AgentExecutionCapture,
): Promise<AgentRunResult> {
  assertTrustedRequest(request);
  await assertRequestPathsSafe(request);
  validateCapture(capture);
  if (capture.runnerKind !== request.runnerKind) {
    throw validation("AGENT_RUNNER_KIND_MISMATCH", "Execution capture does not match the planned Runner kind");
  }
  const parsed = parseJsonl(capture.stdoutJsonl, capture.runnerKind);
  const durationMs = Date.parse(capture.finishedAt) - Date.parse(capture.startedAt);
  const outcome: AgentRunOutcome = parsed.error !== undefined
    ? "INVALID_OUTPUT"
    : capture.exitCode === 0 && capture.signal === null && parsed.turnCompleted && parsed.turnFailed !== true
      ? "SUCCEEDED"
      : "FAILED";
  const finalMessage = parsed.finalMessage ?? "";
  const contents = {
    events: Buffer.from(capture.stdoutJsonl, "utf8"),
    stderr: Buffer.from(capture.stderr, "utf8"),
    finalMessage: Buffer.from(finalMessage, "utf8"),
    ...(capture.rawModelIo === undefined ? {} : { rawModelIo: Buffer.from(capture.rawModelIo, "utf8") }),
  };
  const artifacts = {
    events: artifactFile(request, "events.jsonl", contents.events),
    stderr: artifactFile(request, "stderr.log", contents.stderr),
    finalMessage: artifactFile(request, "final-message.txt", contents.finalMessage),
    ...(contents.rawModelIo === undefined ? {} : {
      rawModelIo: artifactFile(request, "raw-model-io.jsonl", contents.rawModelIo),
    }),
  };
  const core = {
    schemaVersion: 1 as const,
    runId: request.runId,
    runnerKind: capture.runnerKind,
    taskId: request.taskId,
    specRevision: request.specRevision,
    stepId: request.stepId,
    attemptId: request.attemptId,
    ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
    outcome,
    exitCode: capture.exitCode,
    signal: capture.signal,
    startedAt: capture.startedAt,
    finishedAt: capture.finishedAt,
    durationMs,
    finalMessage,
    ...(parsed.error ? { parserError: parsed.error } : {}),
    artifacts,
  };
  const result = deepFreeze({ ...core, runDigest: digest("agent-result", core) });
  trustedResults.add(result);

  await mkdir(request.artifactRoot, { recursive: true });
  await assertRequestPathsSafe(request);
  await mkdir(request.artifactPath, { recursive: true });
  await writeStableFile(path.join(request.artifactPath, "events.jsonl"), contents.events);
  await writeStableFile(path.join(request.artifactPath, "stderr.log"), contents.stderr);
  await writeStableFile(path.join(request.artifactPath, "final-message.txt"), contents.finalMessage);
  if (contents.rawModelIo !== undefined) {
    await writeStableFile(path.join(request.artifactPath, "raw-model-io.jsonl"), contents.rawModelIo);
  }
  const manifest = Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeStableFile(path.join(request.artifactPath, "manifest.json"), manifest);
  return result;
}

export async function reconcileAgentRun(request: AgentRunRequest): Promise<AgentRunResult | undefined> {
  assertTrustedRequest(request);
  await assertRequestPathsSafe(request);
  if (!(await pathExists(request.artifactPath))) return undefined;
  const entries = await readdir(request.artifactPath);
  if (entries.length === 0) return undefined;
  const manifestPath = path.join(request.artifactPath, "manifest.json");
  const pendingManifestPath = `${manifestPath}.pending`;
  if (!(await pathExists(manifestPath)) && (await pathExists(pendingManifestPath))) {
    const pending = await readFile(pendingManifestPath);
    const parsed = await parseStoredAgentRunResult(JSON.parse(pending.toString("utf8")) as unknown, request);
    await rename(pendingManifestPath, manifestPath);
    return parsed;
  }
  if (!(await pathExists(manifestPath))) {
    if (entries.includes("execution-intent.json")) return undefined;
    throw conflict("INCOMPLETE_AGENT_ARTIFACT", "Agent Artifact directory exists without a complete manifest");
  }
  return parseStoredAgentRunResult(JSON.parse(await readFile(manifestPath, "utf8")) as unknown, request);
}

export async function claimAgentExecution(request: AgentRunRequest): Promise<boolean> {
  assertTrustedRequest(request);
  await assertRequestPathsSafe(request);
  await mkdir(request.artifactRoot, { recursive: true });
  await mkdir(request.artifactPath, { recursive: true });
  const content = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    runId: request.runId,
    taskId: request.taskId,
    specRevision: request.specRevision,
    attemptId: request.attemptId,
    runnerKind: request.runnerKind,
    promptDigest: request.promptDigest,
  }, null, 2)}\n`, "utf8");
  const target = path.join(request.artifactPath, "execution-intent.json");
  try { await writeFile(target, content, { flag: "wx" }); return true; }
  catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (!(await readFile(target)).equals(content)) {
      throw conflict("AGENT_EXECUTION_INTENT_CONFLICT", "Agent execution intent differs from the stable Run ID");
    }
    return false;
  }
}

export async function openAgentEventStream(
  request: AgentRunRequest,
  maxBytes = 16 * 1024 * 1024,
): Promise<AgentEventStream> {
  assertTrustedRequest(request);
  await assertRequestPathsSafe(request);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) {
    throw validation("INVALID_AGENT_OUTPUT_LIMIT", "Agent event stream maxBytes must be at least 1024");
  }
  const intentPath = path.join(request.artifactPath, "execution-intent.json");
  if (!(await pathExists(intentPath))) {
    throw conflict("AGENT_EXECUTION_NOT_CLAIMED", "Agent event stream requires a durable execution intent");
  }
  const filePath = path.join(request.artifactPath, "events.jsonl");
  await writeFile(filePath, "", { flag: "wx" });
  let tail = "";
  let writtenBytes = 0;
  let finalized = false;

  const write = async (content: string): Promise<void> => {
    if (!content) return;
    const bytes = Buffer.byteLength(content);
    if (writtenBytes + bytes > maxBytes) {
      throw new MoyeError({
        code: "AGENT_OUTPUT_LIMIT_EXCEEDED",
        category: "TERMINAL",
        message: `Agent output exceeded ${maxBytes} bytes`,
      });
    }
    await appendFile(filePath, content, "utf8");
    writtenBytes += bytes;
  };

  return Object.freeze({
    filePath,
    async writeStdoutChunk(chunk: string): Promise<void> {
      if (finalized) throw conflict("AGENT_EVENT_STREAM_FINALIZED", "Agent event stream is already finalized");
      if (typeof chunk !== "string" || chunk.includes("\0")) {
        throw validation("INVALID_AGENT_EVENT_CHUNK", "Agent event chunks must be NUL-free strings");
      }
      tail += chunk;
      const boundary = tail.lastIndexOf("\n");
      if (boundary < 0) return;
      const completeLines = tail.slice(0, boundary + 1);
      tail = tail.slice(boundary + 1);
      await write(completeLines);
    },
    async finalize(expectedStdout: string): Promise<void> {
      if (finalized) return;
      finalized = true;
      await write(tail);
      tail = "";
      if (Buffer.byteLength(expectedStdout) > maxBytes) {
        throw new MoyeError({
          code: "AGENT_OUTPUT_LIMIT_EXCEEDED",
          category: "TERMINAL",
          message: `Agent output exceeded ${maxBytes} bytes`,
        });
      }
      const captured = await readFile(filePath, "utf8");
      if (captured !== expectedStdout) {
        await writeFile(filePath, expectedStdout, "utf8");
        writtenBytes = Buffer.byteLength(expectedStdout);
      }
    },
  });
}

export async function recordAgentExecutionUnknown(request: AgentRunRequest): Promise<void> {
  assertTrustedRequest(request);
  await writeStableFile(path.join(request.artifactPath, "result-unknown.json"), Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    runId: request.runId,
    taskId: request.taskId,
    specRevision: request.specRevision,
    attemptId: request.attemptId,
    outcome: "RESULT_UNKNOWN",
    recovery: "Do not restart this Run ID; reconcile the Worktree and create a new Spec revision or Attempt ID.",
  }, null, 2)}\n`, "utf8"));
}

export async function parseAgentRunResult(
  value: unknown,
  request: AgentRunRequest,
  expectedDigest: string,
): Promise<AgentRunResult> {
  assertTrustedRequest(request);
  const input = asRecord(value, "AgentRunResult");
  const artifactsInput = asRecord(input["artifacts"], "Agent artifacts");
  const result = deepFreeze({
    schemaVersion: 1 as const,
    runId: readString(input, "runId"),
    runnerKind: readRunnerKind(input["runnerKind"]),
    taskId: readString(input, "taskId"),
    specRevision: readNumber(input, "specRevision"),
    stepId: readString(input, "stepId") as "IMPLEMENT",
    attemptId: readString(input, "attemptId"),
    ...(typeof input["sessionId"] === "string" ? { sessionId: input["sessionId"] } : {}),
    outcome: readOutcome(input["outcome"]),
    exitCode: readNullableExitCode(input["exitCode"]),
    signal: readSignal(input["signal"]),
    startedAt: readString(input, "startedAt"),
    finishedAt: readString(input, "finishedAt"),
    durationMs: readNumber(input, "durationMs"),
    finalMessage: readString(input, "finalMessage", false),
    ...(typeof input["parserError"] === "string" ? { parserError: input["parserError"] } : {}),
    artifacts: {
      events: readArtifactFile(artifactsInput["events"]),
      stderr: readArtifactFile(artifactsInput["stderr"]),
      finalMessage: readArtifactFile(artifactsInput["finalMessage"]),
      ...(artifactsInput["rawModelIo"] === undefined ? {} : {
        rawModelIo: readArtifactFile(artifactsInput["rawModelIo"]),
      }),
    },
    runDigest: readString(input, "runDigest"),
  });
  const { runDigest: _runDigest, ...core } = result;
  const actualDigest = digest("agent-result", core);
  if (input["schemaVersion"] !== 1 || result.runDigest !== actualDigest
      || result.runDigest !== expectedDigest
      || result.runId !== request.runId || result.taskId !== request.taskId
      || result.specRevision !== request.specRevision || result.stepId !== request.stepId
      || result.attemptId !== request.attemptId || result.runnerKind !== request.runnerKind) {
    throw conflict("AGENT_RESULT_INTEGRITY_FAILED", "Agent Result does not match its request or Expected Digest");
  }
  assertIsoInstant(result.startedAt, "startedAt");
  assertIsoInstant(result.finishedAt, "finishedAt");
  if (Date.parse(result.finishedAt) - Date.parse(result.startedAt) !== result.durationMs || result.durationMs < 0) {
    throw conflict("AGENT_RESULT_DURATION_MISMATCH", "Agent Result timestamps do not match durationMs");
  }
  await verifyArtifactFile(request, "events.jsonl", result.artifacts.events);
  await verifyArtifactFile(request, "stderr.log", result.artifacts.stderr);
  await verifyArtifactFile(request, "final-message.txt", result.artifacts.finalMessage);
  if (result.artifacts.rawModelIo !== undefined) {
    await verifyArtifactFile(request, "raw-model-io.jsonl", result.artifacts.rawModelIo);
  }
  const finalContent = await readFile(path.join(request.artifactPath, "final-message.txt"), "utf8");
  if (finalContent !== result.finalMessage) throw conflict("FINAL_MESSAGE_MISMATCH", "Final message Artifact differs from manifest");
  const eventsContent = await readFile(path.join(request.artifactPath, "events.jsonl"), "utf8");
  const parsedEvents = parseJsonl(eventsContent, result.runnerKind);
  const expectedOutcome: AgentRunOutcome = parsedEvents.error !== undefined
    ? "INVALID_OUTPUT"
    : result.exitCode === 0 && result.signal === null && parsedEvents.turnCompleted && parsedEvents.turnFailed !== true
      ? "SUCCEEDED"
      : "FAILED";
  if (result.outcome !== expectedOutcome || result.finalMessage !== (parsedEvents.finalMessage ?? "")
      || result.sessionId !== parsedEvents.sessionId || result.parserError !== parsedEvents.error) {
    throw conflict("AGENT_RESULT_SEMANTIC_MISMATCH", "Agent Result does not match its JSONL events and process outcome");
  }
  trustedResults.add(result);
  return result;
}

export function assertTrustedAgentResult(result: AgentRunResult): void {
  if (!trustedResults.has(result)) throw validation("UNTRUSTED_AGENT_RESULT", "Agent Result must be persisted or parsed by AgentRunner");
}

function assertTrustedRequest(request: AgentRunRequest): void {
  if (!trustedRequests.has(request)) {
    throw validation("UNTRUSTED_AGENT_REQUEST", "Agent Run Request must be created or parsed by this module");
  }
}

function parseJsonl(stdout: string, runnerKind: AgentRunResult["runnerKind"]): {
  readonly sessionId?: string;
  readonly finalMessage?: string;
  readonly turnCompleted: boolean;
  readonly turnFailed?: boolean;
  readonly error?: string;
} {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const events: Record<string, unknown>[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    try {
      const value = JSON.parse(lines[index]!) as unknown;
      if (!isRecord(value)) return { turnCompleted: false, error: `JSONL line ${index + 1} is not an object` };
      events.push(value);
    } catch {
      return { turnCompleted: false, error: `JSONL line ${index + 1} is invalid JSON` };
    }
  }
  if (runnerKind === "CLAUDE_PRINT") return parseClaudeJsonl(events);
  const starts = events.filter((event) => event["type"] === "thread.started");
  if (events[0]?.["type"] !== "thread.started" || starts.length !== 1
      || typeof starts[0]?.["thread_id"] !== "string" || !starts[0]["thread_id"]) {
    return { turnCompleted: false, error: "JSONL must start with exactly one thread.started carrying thread_id" };
  }
  const messages = events.filter((event) => {
    if (event["type"] !== "item.completed" || !isRecord(event["item"])) return false;
    return event["item"]["type"] === "agent_message" && typeof event["item"]["text"] === "string";
  });
  const final = messages.at(-1);
  const item = final && isRecord(final["item"]) ? final["item"] : undefined;
  const finalMessage = typeof item?.["text"] === "string" ? item["text"] : undefined;
  if (finalMessage === undefined) {
    return { sessionId: starts[0]["thread_id"] as string, turnCompleted: false, error: "JSONL has no completed agent_message" };
  }
  return {
    sessionId: starts[0]["thread_id"] as string,
    ...(finalMessage !== undefined ? { finalMessage } : {}),
    turnCompleted: events.some((event) => event["type"] === "turn.completed"),
    turnFailed: events.some((event) => event["type"] === "turn.failed" || event["type"] === "error"),
  };
}

function parseClaudeJsonl(events: readonly Record<string, unknown>[]): {
  readonly sessionId?: string;
  readonly finalMessage?: string;
  readonly turnCompleted: boolean;
  readonly turnFailed?: boolean;
  readonly error?: string;
} {
  const starts = events.filter((event) => event["type"] === "system" && event["subtype"] === "init");
  const sessionId = starts[0]?.["session_id"];
  if (events[0]?.["type"] !== "system" || events[0]?.["subtype"] !== "init"
      || starts.length !== 1 || typeof sessionId !== "string" || !sessionId) {
    return { turnCompleted: false, error: "Claude stream-json must start with exactly one system/init carrying session_id" };
  }
  const results = events.filter((event) => event["type"] === "result");
  const result = results.at(-1);
  if (results.length !== 1 || result === undefined || typeof result["result"] !== "string") {
    return { sessionId, turnCompleted: false, error: "Claude stream-json must end with exactly one result carrying result text" };
  }
  const isError = result["is_error"] === true || result["subtype"] === "error";
  return {
    sessionId,
    finalMessage: result["result"] as string,
    turnCompleted: true,
    turnFailed: isError,
  };
}

function validateCapture(capture: AgentExecutionCapture): void {
  if (capture.runnerKind !== "FAKE" && capture.runnerKind !== "CODEX_EXEC" && capture.runnerKind !== "CLAUDE_PRINT") {
    throw validation("INVALID_RUNNER_KIND", "Unknown Agent Runner kind");
  }
  if (typeof capture.stdoutJsonl !== "string" || typeof capture.stderr !== "string") {
    throw validation("INVALID_AGENT_CAPTURE", "Agent stdout and stderr must be strings");
  }
  if (capture.exitCode !== null) assertExitCode(capture.exitCode);
  assertIsoInstant(capture.startedAt, "startedAt");
  assertIsoInstant(capture.finishedAt, "finishedAt");
  if (Date.parse(capture.finishedAt) < Date.parse(capture.startedAt)) {
    throw validation("INVALID_AGENT_DURATION", "finishedAt cannot precede startedAt");
  }
}

async function assertRequestPathsSafe(request: AgentRunRequest): Promise<void> {
  const workspaceRoot = await realpath(request.workspaceRoot);
  const workspaceGitCommonDir = await assertGitTopLevel(workspaceRoot);
  const artifactRoot = await resolveManagedRoot(request.artifactRoot);
  if (workspaceRoot !== request.workspaceRoot || workspaceGitCommonDir !== request.workspaceGitCommonDir
      || artifactRoot !== request.artifactRoot) {
    throw validation("AGENT_PATH_CHANGED", "Workspace or Artifact Root changed after request creation");
  }
  assertDirectChild(artifactRoot, request.artifactPath);
  if (isSameOrWithin(workspaceGitCommonDir, artifactRoot) || isSameOrWithin(workspaceGitCommonDir, request.artifactPath)) {
    throw validation("AGENT_ARTIFACT_IN_GIT_METADATA", "Agent Artifacts cannot be stored in Git metadata");
  }
  await rejectSymlinkIfPresent(request.artifactPath);
}

async function assertGitTopLevel(workspaceRoot: string): Promise<string> {
  try {
    const [{ stdout: topOutput }, { stdout: commonOutput }] = await Promise.all([
      execFileAsync("git", ["-C", workspaceRoot, "rev-parse", "--path-format=absolute", "--show-toplevel"], {
        encoding: "utf8", shell: false,
      }),
      execFileAsync("git", ["-C", workspaceRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
        encoding: "utf8", shell: false,
      }),
    ]);
    const topLevel = await realpath(topOutput.trim());
    if (topLevel !== workspaceRoot) throw validation("INVALID_AGENT_WORKSPACE", "workspaceRoot must be the Git top-level");
    return realpath(commonOutput.trim());
  } catch (error) {
    if (error instanceof MoyeError) throw error;
    throw validation("INVALID_AGENT_WORKSPACE", "workspaceRoot must be a valid Git top-level");
  }
}

async function resolveManagedRoot(input: string): Promise<string> {
  const absolute = path.resolve(input);
  let cursor = absolute;
  const suffix: string[] = [];
  while (true) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw validation("AGENT_ARTIFACT_ROOT_SYMLINK", "Artifact Root cannot traverse a symbolic link");
      if (suffix.length === 0 && !info.isDirectory()) {
        throw validation("INVALID_AGENT_ARTIFACT_ROOT", "Existing Artifact Root must be a directory");
      }
      return path.join(await realpath(cursor), ...suffix.reverse());
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw validation("AGENT_ARTIFACT_ROOT_UNRESOLVABLE", "Cannot resolve Artifact Root");
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function writeStableFile(target: string, content: Buffer): Promise<void> {
  if (await pathExists(target)) {
    if (!(await readFile(target)).equals(content)) throw conflict("AGENT_ARTIFACT_CONFLICT", `Artifact conflicts with ${target}`);
    return;
  }
  const pending = `${target}.pending`;
  try {
    await writeFile(pending, content, { flag: "wx" });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (!(await readFile(pending)).equals(content)) throw conflict("AGENT_ARTIFACT_PENDING_CONFLICT", `Pending Artifact conflicts with ${pending}`);
  }
  try {
    await rename(pending, target);
  } catch (error) {
    if (!(isNotFound(error) && (await pathExists(target)))) throw error;
    if (!(await readFile(target)).equals(content)) throw conflict("AGENT_ARTIFACT_CONFLICT", `Artifact conflicts with ${target}`);
  }
}

function artifactFile(request: AgentRunRequest, name: string, content: Buffer): AgentArtifactFile {
  return deepFreeze({
    artifactRef: `agent-artifact://${request.runId}/${name}`,
    contentDigest: sha256(content),
    bytes: content.byteLength,
  });
}

async function verifyArtifactFile(request: AgentRunRequest, name: string, file: AgentArtifactFile): Promise<void> {
  const expectedRef = `agent-artifact://${request.runId}/${name}`;
  const content = await readFile(path.join(request.artifactPath, name));
  if (file.artifactRef !== expectedRef || file.contentDigest !== sha256(content) || file.bytes !== content.byteLength) {
    throw conflict("AGENT_ARTIFACT_DIGEST_MISMATCH", `${name} does not match the Agent manifest`);
  }
}

function readArtifactFile(value: unknown): AgentArtifactFile {
  const input = asRecord(value, "AgentArtifactFile");
  const bytes = readNumber(input, "bytes");
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw validation("INVALID_ARTIFACT_BYTES", "Artifact bytes must be non-negative");
  const contentDigest = readString(input, "contentDigest");
  if (!/^sha256:[0-9a-f]{64}$/.test(contentDigest)) throw validation("INVALID_ARTIFACT_DIGEST", "Artifact digest must be SHA-256");
  return deepFreeze({ artifactRef: readString(input, "artifactRef"), contentDigest, bytes });
}

function readRunnerKind(value: unknown): AgentRunResult["runnerKind"] {
  if (value !== "FAKE" && value !== "CODEX_EXEC" && value !== "CLAUDE_PRINT") {
    throw validation("INVALID_RUNNER_KIND", "Invalid runnerKind");
  }
  return value;
}

function readOutcome(value: unknown): AgentRunOutcome {
  if (value !== "SUCCEEDED" && value !== "FAILED" && value !== "INVALID_OUTPUT") throw validation("INVALID_AGENT_OUTCOME", "Invalid Agent outcome");
  return value;
}

function readNullableExitCode(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number") throw validation("INVALID_EXIT_CODE", "exitCode must be a number or null");
  assertExitCode(value);
  return value;
}

function readSignal(value: unknown): NodeJS.Signals | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.startsWith("SIG")) throw validation("INVALID_PROCESS_SIGNAL", "signal must be null or a POSIX signal");
  return value as NodeJS.Signals;
}

function assertExitCode(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) throw validation("INVALID_EXIT_CODE", "exitCode must be between 0 and 255");
}

function assertIsoInstant(value: string, field: string): void {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw validation("INVALID_AGENT_TIME", `${field} must be a canonical ISO instant`);
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw validation("INVALID_POSITIVE_INTEGER", `${field} must be a positive integer`);
}

function assertDirectChild(root: string, target: string): void {
  if (path.dirname(target) !== root || !target.startsWith(`${root}${path.sep}`)) {
    throw validation("AGENT_ARTIFACT_PATH_ESCAPE", "Agent Artifact path must be a direct child of its managed root");
  }
}

async function rejectSymlinkIfPresent(target: string): Promise<void> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(target) !== target) {
      throw validation("AGENT_ARTIFACT_PATH_SYMLINK", "Agent Artifact target cannot be a symbolic link");
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try { await lstat(target); return true; } catch (error) { if (isNotFound(error)) return false; throw error; }
}

function digest(namespace: string, value: unknown): string {
  return `${namespace}:sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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
  if (!isRecord(value)) throw validation("INVALID_SERIALIZED_AGENT_OBJECT", `${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string, nonEmpty = true): string {
  const value = record[key];
  if (typeof value !== "string" || (nonEmpty && !value)) throw validation("INVALID_SERIALIZED_AGENT_FIELD", `${key} must be a string`);
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw validation("INVALID_SERIALIZED_AGENT_FIELD", `${key} must be a finite number`);
  return value;
}

function validation(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "VALIDATION", message });
}

function conflict(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "CONFLICT", message });
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isSameOrWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function parseStoredAgentRunResult(value: unknown, request: AgentRunRequest): Promise<AgentRunResult> {
  const input = asRecord(value, "AgentRunResult");
  return parseAgentRunResult(value, request, readString(input, "runDigest"));
}
