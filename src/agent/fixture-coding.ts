import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { MoyeError } from "../domain/errors.js";
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
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(mutation.fileName)) {
      throw validation("INVALID_FIXTURE_FILE", "Fixture mutation must target one direct workspace file");
    }
    if (typeof mutation.content !== "string") throw validation("INVALID_FIXTURE_CONTENT", "Fixture content must be a string");
    this.#runner = new FakeAgentRunner(script);
    this.#mutation = Object.freeze({ ...mutation });
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (request.runnerKind !== "FAKE") throw validation("FIXTURE_RUNNER_KIND_MISMATCH", "Fixture Coding Runner requires FAKE request");
    const marker = `Moye-Agent-Run: ${request.runId}`;
    const existing = await git(request.workspaceRoot, [
      "log", "HEAD", "--fixed-strings", "--grep", marker, "--format=%H",
    ]);
    const commits = existing.stdout.trim().split("\n").filter(Boolean);
    const target = path.join(request.workspaceRoot, this.#mutation.fileName);
    if (commits.length > 1) throw conflict("DUPLICATE_FIXTURE_COMMITS", "Fixture Agent Run has multiple commits");
    if (commits.length === 1) {
      const content = await readFile(target, "utf8");
      if (content !== this.#mutation.content) throw conflict("FIXTURE_COMMIT_CONTENT_DRIFT", "Fixture commit exists but file content differs");
    } else {
      const status = await git(request.workspaceRoot, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]);
      if (status.stdout.length > 0) throw conflict("FIXTURE_WORKSPACE_DIRTY", "Fixture Coding Runner requires a clean Worktree");
      await writeFile(target, this.#mutation.content, { flag: "wx" });
      await git(request.workspaceRoot, ["add", "--", this.#mutation.fileName]);
      const committed = await git(request.workspaceRoot, [
        "commit", "-m", `Moye fixture implementation\n\n${marker}`,
      ]);
      if (committed.exitCode !== 0) throw conflict("FIXTURE_COMMIT_FAILED", committed.stderr.trim() || "Fixture commit failed");
    }
    return this.#runner.run(request);
  }
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
