import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { SpawnAgentProcessRunner, type AgentProcessInvocation, type AgentProcessRunner } from "./codex-exec.js";
import { MoyeError } from "../domain/errors.js";

export type LiveRoleKind = "CONTEXT" | "SELF_REVIEW" | "REPLAN" | "DOCS_GATE";
export type LiveRoleRunnerKind = "CODEX_EXEC" | "CLAUDE_PRINT";

export interface LiveRoleRequest {
  readonly taskId: string;
  readonly specRevision: number;
  readonly kind: LiveRoleKind;
  readonly attempt: number;
  readonly runnerKind: LiveRoleRunnerKind;
  readonly scopeRoot: string;
  readonly artifactRoot: string;
  readonly instructions: string;
  readonly commitSha?: string;
}

export interface PreparedLiveRoleRequest extends LiveRoleRequest {
  readonly runId: string;
}

export interface LiveRoleFinding {
  readonly severity: "BLOCKING" | "NON_BLOCKING";
  readonly recommendedAction: "REPAIR" | "REPLAN";
  readonly title: string;
  readonly details: string;
}

export interface LiveRoleResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly kind: LiveRoleKind;
  readonly attempt: number;
  readonly runnerKind: LiveRoleRunnerKind;
  readonly sessionId?: string;
  readonly commitSha?: string;
  readonly outcome: "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT";
  readonly verdict: "PASSED" | "FINDINGS" | null;
  readonly summary: string;
  readonly findings: readonly LiveRoleFinding[];
  readonly revisedAcceptanceCriteria: readonly string[];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly eventsArtifactRef: string;
  readonly stderrArtifactRef: string;
  readonly manifestArtifactRef: string;
  readonly eventsContentDigest: string;
  readonly stderrContentDigest: string;
  readonly resultDigest: string;
}

export interface LiveRoleRunner {
  run(request: LiveRoleRequest): Promise<LiveRoleResult>;
}

export class CliLiveRoleRunner implements LiveRoleRunner {
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

  async run(input: LiveRoleRequest): Promise<LiveRoleResult> {
    const request = await prepareLiveRoleRequest(input);
    const runRoot = path.join(request.artifactRoot, `run-${token(request.runId)}`);
    await mkdir(runRoot, { recursive: true });
    const manifestPath = path.join(runRoot, "manifest.json");
    try {
      return parseResult(JSON.parse(await readFile(manifestPath, "utf8")) as unknown, request);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const intentPath = path.join(runRoot, "execution-intent.json");
    const intent = `${JSON.stringify({
      schemaVersion: 1,
      runId: request.runId,
      taskId: request.taskId,
      specRevision: request.specRevision,
      kind: request.kind,
      attempt: request.attempt,
      runnerKind: request.runnerKind,
      commitSha: request.commitSha,
    }, null, 2)}\n`;
    try {
      await writeFile(intentPath, intent, { flag: "wx" });
    } catch (error) {
      if (!isAlreadyExists(error) || await readFile(intentPath, "utf8") !== intent) throw error;
      throw new MoyeError({
        code: "ROLE_RESULT_UNKNOWN",
        category: "UNKNOWN_SIDE_EFFECT",
        message: `${request.kind} role ${request.runId} has an intent without a confirmed manifest`,
      });
    }
    const schemaPath = path.join(runRoot, "output-schema.json");
    await writeFile(schemaPath, `${JSON.stringify(outputSchema(), null, 2)}\n`, { flag: "wx" });
    const eventsPath = path.join(runRoot, "events.jsonl");
    await writeFile(eventsPath, "", { flag: "wx" });
    const startedAt = new Date().toISOString();
    let processResult;
    try {
      processResult = await this.#processRunner.run(
        invocation(request, schemaPath, this.#codexExecutable, this.#claudeExecutable),
        { onStdoutChunk: (chunk) => appendFile(eventsPath, chunk) },
      );
    } catch (error) {
      processResult = { stdout: "", stderr: error instanceof Error ? error.message : String(error), exitCode: null, signal: null };
    }
    const finishedAt = new Date().toISOString();
    const events = Buffer.from(processResult.stdout, "utf8");
    const stderr = Buffer.from(processResult.stderr, "utf8");
    await Promise.all([
      writeFile(eventsPath, events),
      writeFile(path.join(runRoot, "stderr.log"), stderr, { flag: "wx" }),
    ]);
    let outcome: LiveRoleResult["outcome"] = processResult.exitCode === 0 && processResult.signal === null ? "SUCCEEDED" : "FAILED";
    let verdict: LiveRoleResult["verdict"] = null;
    let summary = processResult.stderr.trim();
    let findings: readonly LiveRoleFinding[] = [];
    let revisedAcceptanceCriteria: readonly string[] = [];
    let sessionId: string | undefined;
    if (outcome === "SUCCEEDED") {
      try {
        const extracted = extractStructuredOutput(processResult.stdout, request.runnerKind);
        sessionId = extracted.sessionId;
        const output = parsePayload(extracted.message);
        verdict = output.verdict;
        summary = output.summary;
        findings = output.findings;
        revisedAcceptanceCriteria = output.revisedAcceptanceCriteria;
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
      kind: request.kind,
      attempt: request.attempt,
      runnerKind: request.runnerKind,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(request.commitSha === undefined ? {} : { commitSha: request.commitSha }),
      outcome,
      verdict,
      summary,
      findings,
      revisedAcceptanceCriteria,
      exitCode: processResult.exitCode,
      signal: processResult.signal,
      startedAt,
      finishedAt,
      eventsArtifactRef: `role-artifact://${request.runId}/events.jsonl`,
      stderrArtifactRef: `role-artifact://${request.runId}/stderr.log`,
      manifestArtifactRef: `role-artifact://${request.runId}/manifest.json`,
      eventsContentDigest: sha256(events),
      stderrContentDigest: sha256(stderr),
    };
    const result: LiveRoleResult = { ...core, resultDigest: digest("live-role-result", core) };
    await writeFile(manifestPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    return result;
  }
}

export async function prepareLiveRoleRequest(input: LiveRoleRequest): Promise<PreparedLiveRoleRequest> {
  const { runId: _preparedRunId, ...request } = input as LiveRoleRequest & { readonly runId?: string };
  if (!(["CONTEXT", "SELF_REVIEW", "REPLAN", "DOCS_GATE"] as const).includes(request.kind)) throw validation("INVALID_ROLE_KIND", "Unsupported live role kind");
  if (request.runnerKind !== "CODEX_EXEC" && request.runnerKind !== "CLAUDE_PRINT") throw validation("REAL_ROLE_RUNNER_REQUIRED", "Live roles require a real runner");
  if (!Number.isSafeInteger(request.specRevision) || request.specRevision < 1 || !Number.isSafeInteger(request.attempt) || request.attempt < 1) {
    throw validation("INVALID_ROLE_ATTEMPT", "Role revision and attempt must be positive integers");
  }
  if (!request.instructions.trim()) throw validation("EMPTY_ROLE_INSTRUCTIONS", "Role instructions must be non-empty");
  const scopeRoot = await realpath(path.resolve(request.scopeRoot));
  const artifactRoot = path.resolve(request.artifactRoot);
  await mkdir(artifactRoot, { recursive: true });
  const canonical = { ...request, scopeRoot, artifactRoot };
  return { ...canonical, runId: digest("live-role-run", canonical) };
}

function invocation(
  request: LiveRoleRequest,
  schemaPath: string,
  codexExecutable: string,
  claudeExecutable: string,
): AgentProcessInvocation {
  const prompt = [
    `You are the ${request.kind} role for a real Moye task.`,
    request.instructions,
    "Read-only role: do not edit files, create commits, or change external state.",
    "Return only the required structured result. Use REPLAN only when the accepted specification itself is incomplete or contradictory; use REPAIR for implementation defects.",
  ].join("\n");
  if (request.runnerKind === "CODEX_EXEC") {
    return {
      executable: codexExecutable,
      argv: ["exec", "--json", "--sandbox", "read-only", "--cd", request.scopeRoot, "--output-schema", schemaPath, prompt],
      cwd: request.scopeRoot,
      shell: false,
    };
  }
  return {
    executable: claudeExecutable,
    argv: ["-p", "--verbose", "--output-format", "stream-json", "--permission-mode", "plan", "--json-schema", JSON.stringify(outputSchema()), prompt],
    cwd: request.scopeRoot,
    shell: false,
  };
}

function extractStructuredOutput(stdout: string, runnerKind: LiveRoleRunnerKind): { sessionId?: string; message: string } {
  const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  if (runnerKind === "CODEX_EXEC") {
    const start = events.find((event) => event["type"] === "thread.started");
    const messages = events.filter((event) => event["type"] === "item.completed")
      .map((event) => event["item"])
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && (item as Record<string, unknown>)["type"] === "agent_message");
    const message = messages.at(-1)?.["text"];
    if (typeof message !== "string") throw validation("ROLE_MESSAGE_MISSING", "Codex role produced no final agent message");
    return { ...(typeof start?.["thread_id"] === "string" ? { sessionId: start["thread_id"] } : {}), message };
  }
  const start = events.find((event) => event["type"] === "system" && event["subtype"] === "init");
  const result = events.findLast((event) => event["type"] === "result");
  if (typeof result?.["result"] !== "string") throw validation("ROLE_MESSAGE_MISSING", "Claude role produced no result message");
  return { ...(typeof start?.["session_id"] === "string" ? { sessionId: start["session_id"] } : {}), message: result["result"] };
}

function parsePayload(value: string): {
  verdict: "PASSED" | "FINDINGS";
  summary: string;
  findings: readonly LiveRoleFinding[];
  revisedAcceptanceCriteria: readonly string[];
} {
  const input = JSON.parse(value) as Record<string, unknown>;
  if (input["verdict"] !== "PASSED" && input["verdict"] !== "FINDINGS") throw validation("INVALID_ROLE_VERDICT", "Role verdict is invalid");
  if (typeof input["summary"] !== "string" || !input["summary"].trim() || !Array.isArray(input["findings"]) || !Array.isArray(input["revisedAcceptanceCriteria"])) {
    throw validation("INVALID_ROLE_OUTPUT", "Role output fields are invalid");
  }
  const findings = input["findings"].map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) throw validation("INVALID_ROLE_FINDING", "Role finding must be an object");
    const item = candidate as Record<string, unknown>;
    if ((item["severity"] !== "BLOCKING" && item["severity"] !== "NON_BLOCKING")
        || (item["recommendedAction"] !== "REPAIR" && item["recommendedAction"] !== "REPLAN")
        || typeof item["title"] !== "string" || !item["title"].trim()
        || typeof item["details"] !== "string" || !item["details"].trim()) {
      throw validation("INVALID_ROLE_FINDING", "Role finding fields are invalid");
    }
    return {
      severity: item["severity"] as LiveRoleFinding["severity"],
      recommendedAction: item["recommendedAction"] as LiveRoleFinding["recommendedAction"],
      title: item["title"].trim(),
      details: item["details"].trim(),
    };
  });
  const blocking = findings.some((finding) => finding.severity === "BLOCKING");
  if ((input["verdict"] === "PASSED") === blocking) throw validation("ROLE_VERDICT_CONTRADICTION", "Role verdict contradicts blocking findings");
  const revisedAcceptanceCriteria = input["revisedAcceptanceCriteria"].map((item) => {
    if (typeof item !== "string" || !item.trim()) throw validation("INVALID_REVISED_CRITERION", "Revised acceptance criterion must be non-empty");
    return item.trim();
  });
  return { verdict: input["verdict"], summary: input["summary"].trim(), findings, revisedAcceptanceCriteria };
}

function outputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "summary", "findings", "revisedAcceptanceCriteria"],
    properties: {
      verdict: { type: "string", enum: ["PASSED", "FINDINGS"] },
      summary: { type: "string", minLength: 1 },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "recommendedAction", "title", "details"],
          properties: {
            severity: { type: "string", enum: ["BLOCKING", "NON_BLOCKING"] },
            recommendedAction: { type: "string", enum: ["REPAIR", "REPLAN"] },
            title: { type: "string", minLength: 1 },
            details: { type: "string", minLength: 1 },
          },
        },
      },
      revisedAcceptanceCriteria: { type: "array", items: { type: "string", minLength: 1 } },
    },
  };
}

function parseResult(value: unknown, request: LiveRoleRequest & { readonly runId: string }): LiveRoleResult {
  const result = value as LiveRoleResult;
  if (result?.schemaVersion !== 1 || result.runId !== request.runId || result.kind !== request.kind || result.specRevision !== request.specRevision) {
    throw validation("ROLE_RESULT_CONFLICT", "Persisted role result does not match request");
  }
  const { resultDigest, ...core } = result;
  if (resultDigest !== digest("live-role-result", core)) throw validation("ROLE_RESULT_INTEGRITY_FAILED", "Role result digest mismatch");
  return result;
}

function token(value: string): string { return value.slice(value.lastIndexOf(":") + 1); }
function digest(namespace: string, value: unknown): string { return `${namespace}:sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
function sha256(value: Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function isMissing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
function isAlreadyExists(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST"; }
function validation(code: string, message: string): MoyeError { return new MoyeError({ code, category: "VALIDATION", message }); }
