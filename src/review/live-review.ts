import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { MoyeError } from "../domain/errors.js";
import { SpawnAgentProcessRunner, type AgentProcessInvocation, type AgentProcessRunner } from "../agent/codex-exec.js";

export type ReviewRunnerKind = "CODEX_EXEC" | "CLAUDE_PRINT";

export interface LiveReviewRequest {
  readonly taskId: string;
  readonly specRevision: number;
  readonly attempt: number;
  readonly runnerKind: ReviewRunnerKind;
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly baseRef: string;
  readonly commitSha: string;
  readonly instructions: string;
}

export interface LiveReviewFinding {
  readonly severity: "BLOCKING" | "NON_BLOCKING";
  readonly title: string;
  readonly details: string;
}

export interface LiveReviewResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly attempt: number;
  readonly runnerKind: ReviewRunnerKind;
  readonly sessionId?: string;
  readonly commitSha: string;
  readonly outcome: "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT";
  readonly verdict: "PASSED" | "FINDINGS" | null;
  readonly summary: string;
  readonly findings: readonly LiveReviewFinding[];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly eventsArtifactRef: string;
  readonly manifestArtifactRef: string;
  readonly resultDigest: string;
}

export interface LiveReviewRunner {
  run(request: LiveReviewRequest): Promise<LiveReviewResult>;
}

export class CliLiveReviewRunner implements LiveReviewRunner {
  readonly #processRunner: AgentProcessRunner;
  readonly #codexExecutable: string;
  readonly #claudeExecutable: string;

  constructor(options: {
    readonly processRunner?: AgentProcessRunner;
    readonly codexExecutable?: string;
    readonly claudeExecutable?: string;
  } = {}) {
    this.#processRunner = options.processRunner ?? new SpawnAgentProcessRunner();
    this.#codexExecutable = options.codexExecutable ?? "codex";
    this.#claudeExecutable = options.claudeExecutable ?? "claude";
  }

  async run(input: LiveReviewRequest): Promise<LiveReviewResult> {
    const request = await canonicalRequest(input);
    const runRoot = path.join(request.artifactRoot, `run-${request.runId.slice(-64)}`);
    await mkdir(runRoot, { recursive: true });
    const manifestPath = path.join(runRoot, "manifest.json");
    try {
      return parseResult(JSON.parse(await readFile(manifestPath, "utf8")) as unknown, request);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const intentPath = path.join(runRoot, "execution-intent.json");
    const intent = `${JSON.stringify({ ...request, artifactRoot: undefined, instructions: undefined }, null, 2)}\n`;
    try {
      await writeFile(intentPath, intent, { flag: "wx" });
    } catch (error) {
      if (!isAlreadyExists(error) || await readFile(intentPath, "utf8") !== intent) throw error;
      throw new MoyeError({
        code: "REVIEW_RESULT_UNKNOWN",
        category: "UNKNOWN_SIDE_EFFECT",
        message: `Review ${request.runId} started without a confirmed result; reconcile before retry`,
      });
    }
    const schemaPath = path.join(runRoot, "review-schema.json");
    await writeFile(schemaPath, `${JSON.stringify(reviewSchema(), null, 2)}\n`, { flag: "wx" });
    const startedAt = new Date().toISOString();
    let processResult;
    try {
      processResult = await this.#processRunner.run(invocation(
        request,
        schemaPath,
        this.#codexExecutable,
        this.#claudeExecutable,
      ));
    } catch (error) {
      processResult = { stdout: "", stderr: error instanceof Error ? error.message : String(error), exitCode: null, signal: null };
    }
    const finishedAt = new Date().toISOString();
    await Promise.all([
      writeFile(path.join(runRoot, "events.jsonl"), processResult.stdout, { flag: "wx" }),
      writeFile(path.join(runRoot, "stderr.log"), processResult.stderr, { flag: "wx" }),
    ]);
    let outcome: LiveReviewResult["outcome"] = processResult.exitCode === 0 && processResult.signal === null ? "SUCCEEDED" : "FAILED";
    let verdict: LiveReviewResult["verdict"] = null;
    let summary = processResult.stderr.trim();
    let findings: readonly LiveReviewFinding[] = [];
    let sessionId: string | undefined;
    if (outcome === "SUCCEEDED") {
      try {
        const extracted = extractStructuredOutput(processResult.stdout, request.runnerKind);
        sessionId = extracted.sessionId;
        const structured = parseReviewPayload(extracted.message);
        verdict = structured.verdict;
        summary = structured.summary;
        findings = structured.findings;
      } catch (error) {
        outcome = "INVALID_OUTPUT";
        summary = error instanceof Error ? error.message : String(error);
      }
    }
    const core = {
      schemaVersion: 1 as const,
      runId: request.runId,
      taskId: request.taskId,
      specRevision: request.specRevision,
      attempt: request.attempt,
      runnerKind: request.runnerKind,
      ...(sessionId === undefined ? {} : { sessionId }),
      commitSha: request.commitSha,
      outcome,
      verdict,
      summary,
      findings,
      exitCode: processResult.exitCode,
      signal: processResult.signal,
      startedAt,
      finishedAt,
      eventsArtifactRef: `review-artifact://${request.runId}/events.jsonl`,
      manifestArtifactRef: `review-artifact://${request.runId}/manifest.json`,
    };
    const result: LiveReviewResult = { ...core, resultDigest: digest("live-review-result", core) };
    await writeFile(manifestPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    return result;
  }
}

async function canonicalRequest(input: LiveReviewRequest): Promise<LiveReviewRequest & { readonly runId: string }> {
  if (input.runnerKind !== "CODEX_EXEC" && input.runnerKind !== "CLAUDE_PRINT") throw validation("REAL_REVIEW_RUNNER_REQUIRED", "Review requires a real runner");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) throw validation("INVALID_REVIEW_ATTEMPT", "Review attempt must be positive");
  if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(input.commitSha)) throw validation("INVALID_REVIEW_COMMIT", "Review commit must be a full Git object id");
  const workspaceRoot = await realpath(path.resolve(input.workspaceRoot));
  const artifactRoot = path.resolve(input.artifactRoot);
  await mkdir(artifactRoot, { recursive: true });
  const canonical = { ...input, workspaceRoot, artifactRoot };
  return { ...canonical, runId: digest("live-review-run", canonical) };
}

function invocation(
  request: LiveReviewRequest,
  schemaPath: string,
  codexExecutable: string,
  claudeExecutable: string,
): AgentProcessInvocation {
  const prompt = [
    request.instructions,
    "Review only; do not edit files or create commits.",
    "Return the required structured result. BLOCKING means correctness, security, data-loss, or unmet acceptance criteria.",
  ].join("\n");
  if (request.runnerKind === "CODEX_EXEC") {
    return {
      executable: codexExecutable,
      argv: [
        "exec", "--json", "--sandbox", "read-only", "--cd", request.workspaceRoot,
        "--output-schema", schemaPath,
        `Review commit ${request.commitSha} against ${request.baseRef}.\n${prompt}`,
      ],
      cwd: request.workspaceRoot,
      shell: false,
    };
  }
  return {
    executable: claudeExecutable,
    argv: [
      "-p", "--verbose", "--output-format", "stream-json", "--permission-mode", "plan",
      "--json-schema", JSON.stringify(reviewSchema()), prompt,
    ],
    cwd: request.workspaceRoot,
    shell: false,
  };
}

function extractStructuredOutput(stdout: string, runnerKind: ReviewRunnerKind): { sessionId?: string; message: string } {
  const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  if (runnerKind === "CODEX_EXEC") {
    const start = events.find((event) => event["type"] === "thread.started");
    const messages = events.filter((event) => event["type"] === "item.completed")
      .map((event) => event["item"])
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && (item as Record<string, unknown>)["type"] === "agent_message");
    const message = messages.at(-1)?.["text"];
    if (typeof message !== "string") throw validation("REVIEW_MESSAGE_MISSING", "Codex review produced no final agent message");
    return { ...(typeof start?.["thread_id"] === "string" ? { sessionId: start["thread_id"] } : {}), message };
  }
  const start = events.find((event) => event["type"] === "system" && event["subtype"] === "init");
  const result = events.findLast((event) => event["type"] === "result");
  if (typeof result?.["result"] !== "string") throw validation("REVIEW_MESSAGE_MISSING", "Claude review produced no result message");
  return { ...(typeof start?.["session_id"] === "string" ? { sessionId: start["session_id"] } : {}), message: result["result"] };
}

function parseReviewPayload(value: string): { verdict: "PASSED" | "FINDINGS"; summary: string; findings: readonly LiveReviewFinding[] } {
  const input = JSON.parse(value) as Record<string, unknown>;
  if (input["verdict"] !== "PASSED" && input["verdict"] !== "FINDINGS") throw validation("INVALID_REVIEW_VERDICT", "Review verdict is invalid");
  if (typeof input["summary"] !== "string" || !input["summary"].trim() || !Array.isArray(input["findings"])) {
    throw validation("INVALID_REVIEW_OUTPUT", "Review summary/findings are invalid");
  }
  const findings = input["findings"].map((value) => {
    if (typeof value !== "object" || value === null) throw validation("INVALID_REVIEW_FINDING", "Review finding must be an object");
    const item = value as Record<string, unknown>;
    if ((item["severity"] !== "BLOCKING" && item["severity"] !== "NON_BLOCKING")
        || typeof item["title"] !== "string" || typeof item["details"] !== "string") {
      throw validation("INVALID_REVIEW_FINDING", "Review finding fields are invalid");
    }
    const severity: LiveReviewFinding["severity"] = item["severity"] as LiveReviewFinding["severity"];
    return { severity, title: item["title"], details: item["details"] };
  });
  const blocking = findings.some((finding) => finding.severity === "BLOCKING");
  if ((input["verdict"] === "PASSED") === blocking) throw validation("REVIEW_VERDICT_CONTRADICTION", "Review verdict contradicts blocking findings");
  return { verdict: input["verdict"], summary: input["summary"].trim(), findings };
}

function parseResult(value: unknown, request: LiveReviewRequest & { readonly runId: string }): LiveReviewResult {
  const result = value as LiveReviewResult;
  if (result?.schemaVersion !== 1 || result.runId !== request.runId || result.commitSha !== request.commitSha) {
    throw validation("REVIEW_RESULT_CONFLICT", "Persisted Review result does not match request");
  }
  const { resultDigest, ...core } = result;
  if (resultDigest !== digest("live-review-result", core)) throw validation("REVIEW_RESULT_INTEGRITY_FAILED", "Review result digest mismatch");
  return result;
}

function reviewSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "summary", "findings"],
    properties: {
      verdict: { type: "string", enum: ["PASSED", "FINDINGS"], description: "FINDINGS iff at least one BLOCKING finding exists; otherwise PASSED" },
      summary: { type: "string", minLength: 1, description: "Concise independent review summary" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "title", "details"],
          properties: {
            severity: { type: "string", enum: ["BLOCKING", "NON_BLOCKING"], description: "BLOCKING only for correctness, security, data loss, or unmet requirements" },
            title: { type: "string", minLength: 1 },
            details: { type: "string", minLength: 1 },
          },
        },
      },
    },
  };
}

function digest(namespace: string, value: unknown): string {
  return `${namespace}:sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function isMissing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
function isAlreadyExists(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST"; }
function validation(code: string, message: string): MoyeError { return new MoyeError({ code, category: "VALIDATION", message }); }
