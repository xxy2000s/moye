import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { MoyeError } from "../domain/errors.js";
import { CodexExecAgentRunner } from "./codex-exec.js";
import type { AgentRunner, AgentRunRequest, AgentRunResult, FakeAgentScript } from "./runner.js";
import { FakeAgentRunner } from "./runner.js";

const execFileAsync = promisify(execFile);

export interface FixtureMutation {
  readonly fileName: string;
  readonly content: string;
}

export class FixtureCodingAgentRunner implements AgentRunner {
  readonly #runner: FakeAgentRunner;
  readonly #mutation: FixtureMutation;

  constructor(script: FakeAgentScript, mutation: FixtureMutation) {
    assertMutation(mutation);
    this.#runner = new FakeAgentRunner(script);
    this.#mutation = Object.freeze({ ...mutation });
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (request.runnerKind !== "FAKE") throw validation("FIXTURE_RUNNER_KIND_MISMATCH", "Fixture Coding Runner requires FAKE request");
    await applyFixtureMutation(request, this.#mutation);
    return this.#runner.run(request);
  }
}

export class StreamingFixtureCodingAgentRunner implements AgentRunner {
  readonly #events: readonly Readonly<Record<string, unknown>>[];
  readonly #mutation: FixtureMutation;
  readonly #delayMs: number;

  constructor(input: {
    readonly events: readonly Readonly<Record<string, unknown>>[];
    readonly mutation: FixtureMutation;
    readonly delayMs: number;
  }) {
    assertMutation(input.mutation);
    if (!Array.isArray(input.events) || input.events.some((event) => typeof event !== "object" || event === null || Array.isArray(event))) {
      throw validation("INVALID_STREAMING_FIXTURE_EVENTS", "Streaming fixture events must be objects");
    }
    if (!Number.isSafeInteger(input.delayMs) || input.delayMs < 0 || input.delayMs > 10_000) {
      throw validation("INVALID_STREAMING_FIXTURE_DELAY", "Streaming fixture delayMs must be between 0 and 10000");
    }
    this.#events = input.events.map((event) => Object.freeze(JSON.parse(JSON.stringify(event)) as Record<string, unknown>));
    this.#mutation = Object.freeze({ ...input.mutation });
    this.#delayMs = input.delayMs;
  }

  run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (request.runnerKind !== "CODEX_EXEC") {
      return Promise.reject(validation("FIXTURE_RUNNER_KIND_MISMATCH", "Streaming Fixture Runner requires CODEX_EXEC request"));
    }
    return new CodexExecAgentRunner({
      processRunner: {
        run: async (_invocation, observer) => {
          await applyFixtureMutation(request, this.#mutation);
          let stdout = "";
          for (const event of this.#events) {
            const line = `${JSON.stringify(event)}\n`;
            stdout += line;
            await observer?.onStdoutChunk?.(line);
            if (this.#delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.#delayMs));
          }
          return { stdout, stderr: "controlled streaming fixture\n", exitCode: 0, signal: null };
        },
      },
    }).run(request);
  }
}

async function applyFixtureMutation(request: AgentRunRequest, mutation: FixtureMutation): Promise<void> {
    const marker = `Moye-Agent-Run: ${request.runId}`;
    const existing = await git(request.workspaceRoot, [
      "log", "HEAD", "--fixed-strings", "--grep", marker, "--format=%H",
    ]);
    const commits = existing.stdout.trim().split("\n").filter(Boolean);
    const target = path.join(request.workspaceRoot, mutation.fileName);
    if (commits.length > 1) throw conflict("DUPLICATE_FIXTURE_COMMITS", "Fixture Agent Run has multiple commits");
    if (commits.length === 1) {
      const content = await readFile(target, "utf8");
      if (content !== mutation.content) throw conflict("FIXTURE_COMMIT_CONTENT_DRIFT", "Fixture commit exists but file content differs");
    } else {
      const status = await git(request.workspaceRoot, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]);
      if (status.stdout.length > 0) throw conflict("FIXTURE_WORKSPACE_DIRTY", "Fixture Coding Runner requires a clean Worktree");
      await writeFile(target, mutation.content, { flag: "wx" });
      await git(request.workspaceRoot, ["add", "--", mutation.fileName]);
      const committed = await git(request.workspaceRoot, [
        "commit", "-m", `Moye fixture implementation\n\n${marker}`,
      ]);
      if (committed.exitCode !== 0) throw conflict("FIXTURE_COMMIT_FAILED", committed.stderr.trim() || "Fixture commit failed");
    }
}

function assertMutation(mutation: FixtureMutation): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(mutation.fileName)) {
    throw validation("INVALID_FIXTURE_FILE", "Fixture mutation must target one direct workspace file");
  }
  if (typeof mutation.content !== "string") throw validation("INVALID_FIXTURE_CONTENT", "Fixture content must be a string");
}

async function git(cwd: string, argv: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("git", [...argv], {
      cwd,
      encoding: "utf8",
      shell: false,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const candidate = error as { stdout?: string; stderr?: string; code?: number };
    if (typeof candidate.code === "number") {
      return { stdout: candidate.stdout ?? "", stderr: candidate.stderr ?? "", exitCode: candidate.code };
    }
    throw error;
  }
}

function validation(code: string, message: string): MoyeError { return new MoyeError({ code, category: "VALIDATION", message }); }
function conflict(code: string, message: string): MoyeError { return new MoyeError({ code, category: "CONFLICT", message }); }
