import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import { MoyeError } from "../domain/errors.js";
import {
  assertTrustedAgentResult,
  claimAgentExecution,
  openAgentEventStream,
  persistAgentRun,
  recordAgentExecutionUnknown,
  reconcileAgentRun,
} from "./runner.js";
import type {
  AgentRunner,
  AgentRunRequest,
  AgentRunResult,
} from "./runner.js";

export interface AgentProcessInvocation {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly shell: false;
  readonly env?: Readonly<Record<string, string>>;
}

export interface AgentProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface AgentProcessObserver {
  readonly onStdoutChunk?: (chunk: string) => Promise<void> | void;
}

export interface AgentProcessRunner {
  run(invocation: AgentProcessInvocation, observer?: AgentProcessObserver): Promise<AgentProcessResult>;
}

export interface CodexExecRunnerOptions {
  readonly executable?: string;
  readonly processRunner?: AgentProcessRunner;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export class CodexExecAgentRunner implements AgentRunner {
  readonly #executable: string;
  readonly #processRunner: AgentProcessRunner;
  readonly #now: () => Date;

  constructor(options: CodexExecRunnerOptions = {}) {
    this.#executable = options.executable ?? "codex";
    if (!this.#executable || this.#executable.includes("\0")) {
      throw validation("INVALID_CODEX_EXECUTABLE", "Codex executable must be a non-empty path or command name");
    }
    this.#processRunner = options.processRunner ?? new SpawnAgentProcessRunner({
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
    });
    this.#now = options.now ?? (() => new Date());
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (request.runnerKind !== "CODEX_EXEC") {
      throw validation("AGENT_RUNNER_KIND_MISMATCH", "Codex Exec Runner requires a CODEX_EXEC request");
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
        message: "A previous Codex execution was started without a durable result; automatic replay is forbidden",
        details: { runId: request.runId, attemptId: request.attemptId },
      });
    }
    const eventStream = await openAgentEventStream(request);
    const startedAt = canonicalNow(this.#now);
    let processResult: AgentProcessResult;
    try {
      processResult = await this.#processRunner.run(createCodexExecInvocation(this.#executable, request), {
        onStdoutChunk: (chunk) => eventStream.writeStdoutChunk(chunk),
      });
    } catch (error) {
      processResult = {
        stdout: "",
        stderr: `Codex process failed before returning a result: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: null,
        signal: null,
      };
    }
    const finishedAt = canonicalNow(this.#now);
    await eventStream.finalize(processResult.stdout);
    return persistAgentRun(request, {
      runnerKind: "CODEX_EXEC",
      stdoutJsonl: processResult.stdout,
      stderr: processResult.stderr,
      exitCode: processResult.exitCode,
      signal: processResult.signal,
      startedAt,
      finishedAt,
    });
  }
}

export function createCodexExecInvocation(
  executable: string,
  request: AgentRunRequest,
): AgentProcessInvocation {
  if (!executable || executable.includes("\0")) {
    throw validation("INVALID_CODEX_EXECUTABLE", "Codex executable must be a non-empty path or command name");
  }
  return Object.freeze({
    executable,
    argv: Object.freeze([
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--cd",
      request.workspaceRoot,
      request.prompt,
    ]),
    cwd: request.workspaceRoot,
    shell: false,
  });
}

export class SpawnAgentProcessRunner implements AgentProcessRunner {
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;

  constructor(options: { readonly timeoutMs?: number; readonly maxOutputBytes?: number } = {}) {
    this.#timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
    this.#maxOutputBytes = options.maxOutputBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw validation("INVALID_AGENT_TIMEOUT", "Agent timeoutMs must be a positive integer");
    }
    if (!Number.isSafeInteger(this.#maxOutputBytes) || this.#maxOutputBytes < 1024) {
      throw validation("INVALID_AGENT_OUTPUT_LIMIT", "Agent maxOutputBytes must be at least 1024");
    }
  }

  run(invocation: AgentProcessInvocation, observer?: AgentProcessObserver): Promise<AgentProcessResult> {
    if (invocation.shell !== false || invocation.argv.some((value) => typeof value !== "string" || value.includes("\0"))
        || Object.entries(invocation.env ?? {}).some(([key, value]) => !key || key.includes("\0") || value.includes("\0"))) {
      return Promise.reject(validation("UNSAFE_AGENT_INVOCATION", "Agent process must use NUL-free argv with shell=false"));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(invocation.executable, [...invocation.argv], {
        cwd: invocation.cwd,
        shell: false,
        env: invocation.env === undefined ? process.env : { ...process.env, ...invocation.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let bytes = 0;
      let settled = false;
      let observerError: unknown;
      let observerWrites = Promise.resolve();
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      const timeout = setTimeout(() => child.kill("SIGTERM"), this.#timeoutMs);
      const collect = (channel: "stdout" | "stderr", chunk: Buffer): void => {
        bytes += chunk.byteLength;
        if (bytes > this.#maxOutputBytes) {
          child.kill("SIGTERM");
          return;
        }
        if (channel === "stdout") {
          const text = stdoutDecoder.write(chunk);
          stdout += text;
          if (text && observer?.onStdoutChunk !== undefined) {
            observerWrites = observerWrites.then(() => observer.onStdoutChunk!(text)).catch((error) => {
              observerError = error;
              child.kill("SIGTERM");
            });
          }
        } else stderr += stderrDecoder.write(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const stdoutTail = stdoutDecoder.end();
        const stderrTail = stderrDecoder.end();
        stdout += stdoutTail;
        stderr += stderrTail;
        if (stdoutTail && observer?.onStdoutChunk !== undefined) {
          observerWrites = observerWrites.then(() => observer.onStdoutChunk!(stdoutTail)).catch((error) => {
            observerError = error;
          });
        }
        void observerWrites.then(() => {
          if (observerError !== undefined) {
            reject(observerError);
            return;
          }
          if (bytes > this.#maxOutputBytes) {
            reject(new MoyeError({
              code: "AGENT_OUTPUT_LIMIT_EXCEEDED",
              category: "TERMINAL",
              message: `Agent output exceeded ${this.#maxOutputBytes} bytes`,
            }));
            return;
          }
          resolve(Object.freeze({ stdout, stderr, exitCode, signal }));
        });
      });
    });
  }
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
