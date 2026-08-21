import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { MoyeError } from "../domain/errors.js";
import { traceparentForAgent } from "../trace/telemetry.js";
import type { AgentProcessInvocation, AgentProcessRunner, AgentProcessResult } from "./codex-exec.js";
import { SpawnAgentProcessRunner } from "./codex-exec.js";
import {
  assertTrustedAgentResult,
  claimAgentExecution,
  openAgentEventStream,
  persistAgentRun,
  recordAgentExecutionUnknown,
  reconcileAgentRun,
  type AgentRunner,
  type AgentRunRequest,
  type AgentRunResult,
} from "./runner.js";

export interface ClaudeNativeTelemetryOptions {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly serviceName?: string;
  readonly projectName?: string;
  readonly captureUserPrompts?: boolean;
  readonly captureAssistantResponses?: boolean;
  readonly captureToolDetails?: boolean;
  readonly captureToolContent?: boolean;
  readonly captureRawApiBodies?: boolean;
}

export interface ClaudePrintRunnerOptions {
  readonly executable?: string;
  readonly processRunner?: AgentProcessRunner;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly telemetry?: ClaudeNativeTelemetryOptions;
}

export class ClaudePrintAgentRunner implements AgentRunner {
  readonly #executable: string;
  readonly #processRunner: AgentProcessRunner;
  readonly #now: () => Date;
  readonly #telemetry: ClaudeNativeTelemetryOptions | undefined;

  constructor(options: ClaudePrintRunnerOptions = {}) {
    this.#executable = options.executable ?? "claude";
    if (!this.#executable || this.#executable.includes("\0")) {
      throw validation("INVALID_CLAUDE_EXECUTABLE", "Claude executable must be a non-empty path or command name");
    }
    this.#processRunner = options.processRunner ?? new SpawnAgentProcessRunner({
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
    });
    this.#now = options.now ?? (() => new Date());
    this.#telemetry = options.telemetry;
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (request.runnerKind !== "CLAUDE_PRINT") {
      throw validation("AGENT_RUNNER_KIND_MISMATCH", "Claude Print Runner requires a CLAUDE_PRINT request");
    }
    const existing = await reconcileAgentRun(request);
    if (existing !== undefined) {
      assertTrustedAgentResult(existing);
      return existing;
    }
    if (!(await claimAgentExecution(request))) {
      await recordAgentExecutionUnknown(request);
      throw new MoyeError({
        code: "AGENT_RESULT_UNKNOWN",
        category: "UNKNOWN_SIDE_EFFECT",
        retryable: false,
        message: "A previous Claude execution was started without a durable result; automatic replay is forbidden",
        details: { runId: request.runId, attemptId: request.attemptId },
      });
    }
    if (this.#telemetry?.captureRawApiBodies === true) {
      await prepareClaudeRawApiDirectory(request);
    }
    const eventStream = await openAgentEventStream(request);
    const startedAt = canonicalNow(this.#now);
    let processResult: AgentProcessResult;
    try {
      processResult = await this.#processRunner.run(createClaudePrintInvocation(
        this.#executable,
        request,
        this.#telemetry,
      ), { onStdoutChunk: (chunk) => eventStream.writeStdoutChunk(chunk) });
    } catch (error) {
      processResult = {
        stdout: "",
        stderr: `Claude process failed before returning a result: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: null,
        signal: null,
      };
    }
    const finishedAt = canonicalNow(this.#now);
    await eventStream.finalize(processResult.stdout);
    const rawModelIo = this.#telemetry?.captureRawApiBodies === true
      ? await collectRawApiBodies(request)
      : undefined;
    return persistAgentRun(request, {
      runnerKind: "CLAUDE_PRINT",
      stdoutJsonl: processResult.stdout,
      stderr: processResult.stderr,
      exitCode: processResult.exitCode,
      signal: processResult.signal,
      startedAt,
      finishedAt,
      ...(rawModelIo === undefined ? {} : { rawModelIo }),
    });
  }
}

export function createClaudePrintInvocation(
  executable: string,
  request: AgentRunRequest,
  telemetry?: ClaudeNativeTelemetryOptions,
): AgentProcessInvocation {
  if (!executable || executable.includes("\0")) {
    throw validation("INVALID_CLAUDE_EXECUTABLE", "Claude executable must be a non-empty path or command name");
  }
  return Object.freeze({
    executable,
    argv: Object.freeze([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "acceptEdits",
      request.prompt,
    ]),
    cwd: request.workspaceRoot,
    shell: false,
    ...(telemetry?.enabled === true ? { env: buildClaudeTelemetryEnvironment(request, telemetry) } : {}),
  });
}

export function buildClaudeTelemetryEnvironment(
  request: AgentRunRequest,
  options: ClaudeNativeTelemetryOptions,
): Readonly<Record<string, string>> {
  if (!options.enabled) return Object.freeze({});
  const endpoint = normalizeEndpoint(options.endpoint);
  const attributes = [
    `service.name=${sanitizeResourceValue(options.serviceName ?? "claude-code")}`,
    `openinference.project.name=${sanitizeResourceValue(options.projectName ?? "moye")}`,
    `task.id=${sanitizeResourceValue(request.taskId)}`,
    `attempt.id=${sanitizeResourceValue(request.attemptId)}`,
    `agent.run.id=${sanitizeResourceValue(request.runId)}`,
  ].join(",");
  return Object.freeze({
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
    OTEL_RESOURCE_ATTRIBUTES: attributes,
    TRACEPARENT: traceparentForAgent(request.taskId, request.runId),
    OTEL_LOG_USER_PROMPTS: flag(options.captureUserPrompts),
    OTEL_LOG_ASSISTANT_RESPONSES: flag(options.captureAssistantResponses),
    OTEL_LOG_TOOL_DETAILS: flag(options.captureToolDetails),
    OTEL_LOG_TOOL_CONTENT: flag(options.captureToolContent),
    ...(options.captureRawApiBodies === true ? {
      OTEL_LOG_RAW_API_BODIES: `file:${rawApiDirectory(request)}`,
    } : {}),
  });
}

async function collectRawApiBodies(request: AgentRunRequest): Promise<string | undefined> {
  const directory = rawApiDirectory(request);
  const artifactPath = await realpath(request.artifactPath);
  const actual = await realpath(directory);
  if (actual !== directory || path.dirname(actual) !== artifactPath) {
    throw validation("UNSAFE_RAW_API_DIRECTORY", "Raw API Body directory escaped the current Agent Run Artifact");
  }
  const entries = (await readdir(actual)).sort();
  const rows: string[] = [];
  for (const name of entries) {
    const candidate = path.join(actual, name);
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(candidate) !== candidate) {
      throw validation("UNSAFE_RAW_API_ARTIFACT", "Raw API Body entries must be regular files");
    }
    rows.push(JSON.stringify({ file: name, body: await readFile(candidate, "utf8") }));
  }
  return rows.length === 0 ? undefined : `${rows.join("\n")}\n`;
}

export async function prepareClaudeRawApiDirectory(request: AgentRunRequest): Promise<void> {
  const artifactPath = await realpath(request.artifactPath);
  if (artifactPath !== request.artifactPath) {
    throw validation("UNSAFE_RAW_API_DIRECTORY", "Agent Run Artifact must resolve to its canonical path");
  }
  const directory = rawApiDirectory(request);
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw validation("UNSAFE_RAW_API_DIRECTORY", "Raw API Body destination must be a real directory");
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
    await mkdir(directory);
  }
  const actual = await realpath(directory);
  if (actual !== directory || path.dirname(actual) !== artifactPath) {
    throw validation("UNSAFE_RAW_API_DIRECTORY", "Raw API Body directory escaped the current Agent Run Artifact");
  }
}

function rawApiDirectory(request: AgentRunRequest): string {
  return path.join(request.artifactPath, "raw-api");
}

function normalizeEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw validation("INVALID_CLAUDE_OTLP_ENDPOINT", "Claude OTLP endpoint must use http or https");
  }
  if (url.username || url.password || url.hash) {
    throw validation("UNSAFE_CLAUDE_OTLP_ENDPOINT", "Claude OTLP endpoint cannot contain credentials or a fragment");
  }
  return url.toString();
}

function sanitizeResourceValue(value: string): string {
  if (!value || /[,=\r\n]/.test(value)) {
    throw validation("INVALID_CLAUDE_RESOURCE_ATTRIBUTE", "Claude resource attribute values cannot contain comma, equals or newline");
  }
  return value;
}

function flag(value: boolean | undefined): string {
  return value === true ? "1" : "0";
}

function canonicalNow(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw validation("INVALID_AGENT_CLOCK", "Agent clock must return a valid Date");
  }
  return value.toISOString();
}

function validation(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "VALIDATION", message });
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
