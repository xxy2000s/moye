import { createHash } from "node:crypto";
import { access, appendFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  SpawnAgentProcessRunner,
  type AgentProcessInvocation,
  type AgentProcessRunner,
} from "./codex-exec.js";
import { MoyeError } from "../domain/errors.js";
import {
  createRoleRunEvidenceV2,
  parseRoleAttemptV2,
  parseRoleRunEvidenceV2,
  roleReconcileTokenV2,
} from "../domain/role-runtime-v2.js";
import type {
  AgentRoleV2,
  RealRoleRunnerKind,
  RoleAttemptV2,
  RolePhaseV2,
  RoleRunEvidenceV2,
} from "../domain/role-runtime-v2.js";

export interface RealRoleRunV2Input {
  readonly attempt: RoleAttemptV2;
  readonly scopeRoot: string;
  readonly artifactRoot: string;
  readonly instructions: string;
}

export interface PreparedRealRoleRunV2 {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly operationId: string;
  readonly attempt: RoleAttemptV2;
  readonly scopeRoot: string;
  readonly artifactRoot: string;
  readonly runRoot: string;
  readonly instructions: string;
  readonly instructionsDigest: string;
  readonly requestDigest: string;
}

export interface RoleStructuredOutputV2 {
  readonly summary: string;
  readonly recommendation: "PASS" | "FINDINGS" | "INCONCLUSIVE";
  readonly artifactRefs: readonly string[];
  readonly findingRefs: readonly string[];
}

export interface RoleAgentEventV2 {
  readonly sequence: number;
  readonly type: string;
  readonly category: "ASSISTANT" | "TOOL_CALL" | "TOOL_RESULT" | "SYSTEM" | "ERROR" | "OTHER";
}

export interface RoleRunManifestV2 {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly operationId: string;
  readonly requestDigest: string;
  readonly attemptDigest: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly role: AgentRoleV2;
  readonly phase: RolePhaseV2;
  readonly attemptId: string;
  readonly generation: number;
  readonly runnerKind: RealRoleRunnerKind;
  readonly sessionId?: string;
  readonly outcome: "SUCCEEDED" | "FAILED" | "INVALID_OUTPUT";
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly output: RoleStructuredOutputV2 | null;
  readonly events: readonly RoleAgentEventV2[];
  readonly eventsRef: string;
  readonly eventsDigest: string;
  readonly stderrRef: string;
  readonly stderrDigest: string;
  readonly outputRef: string;
  readonly outputDigest: string;
  readonly manifestRef: string;
  readonly manifestDigest: string;
  readonly evidence: RoleRunEvidenceV2;
}

export interface RealRoleRunV2Result {
  readonly recovery: "EXECUTED" | "REUSED";
  readonly manifest: RoleRunManifestV2;
  readonly evidence: RoleRunEvidenceV2;
}

export type RealRoleRunInspectionV2 =
  | { readonly state: "ABSENT"; readonly runId: string; readonly operationId: string }
  | { readonly state: "INTENT_ONLY"; readonly runId: string; readonly operationId: string; readonly reconcileToken: string }
  | { readonly state: "CONFIRMED"; readonly runId: string; readonly operationId: string; readonly result: RealRoleRunV2Result };

export class RealRoleRuntimeV2 {
  readonly #processRunner: AgentProcessRunner;
  readonly #codexExecutable: string;
  readonly #claudeExecutable: string;
  readonly #now: () => Date;

  constructor(options: {
    readonly processRunner?: AgentProcessRunner;
    readonly codexExecutable?: string;
    readonly claudeExecutable?: string;
    readonly now?: () => Date;
  } = {}) {
    this.#processRunner = options.processRunner ?? new SpawnAgentProcessRunner();
    this.#codexExecutable = executable(options.codexExecutable ?? "codex", "codexExecutable");
    this.#claudeExecutable = executable(options.claudeExecutable ?? "claude", "claudeExecutable");
    this.#now = options.now ?? (() => new Date());
  }

  async run(input: RealRoleRunV2Input): Promise<RealRoleRunV2Result> {
    const request = await prepareRealRoleRunV2(input);
    const inspection = await inspectRealRoleRunV2(request);
    if (inspection.state === "CONFIRMED") return inspection.result;
    if (inspection.state === "INTENT_ONLY") throw unknownResult(request);
    if (!(await writeRealRoleRunIntentV2(request))) throw unknownResult(request);

    const schemaPath = path.join(request.runRoot, "output-schema.json");
    const eventsPath = path.join(request.runRoot, "events.jsonl");
    await writeFile(schemaPath, `${JSON.stringify(roleOutputSchema(), null, 2)}\n`, { flag: "wx" });
    await writeFile(eventsPath, "", { flag: "wx" });
    const startedAt = canonicalNow(this.#now());
    let processResult;
    try {
      processResult = await this.#processRunner.run(
        createRealRoleInvocationV2(request, schemaPath, this.#codexExecutable, this.#claudeExecutable),
        { onStdoutChunk: (chunk) => appendFile(eventsPath, chunk) },
      );
    } catch (error) {
      processResult = {
        stdout: "",
        stderr: `Role process failed before returning: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: null,
        signal: null,
      };
    }
    const finishedAt = canonicalNow(this.#now());
    await writeFile(eventsPath, processResult.stdout);
    const stderrPath = path.join(request.runRoot, "stderr.log");
    const outputPath = path.join(request.runRoot, "structured-output.json");
    await writeFile(stderrPath, processResult.stderr, { flag: "wx" });

    let parsed: ReturnType<typeof parseAgentStream>;
    try {
      parsed = parseAgentStream(processResult.stdout, request.attempt.runnerKind);
    } catch (error) {
      parsed = {
        events: [],
        output: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    let outcome: RoleRunManifestV2["outcome"] = processResult.exitCode === 0 && processResult.signal === null
      ? "SUCCEEDED" : "FAILED";
    if (parsed.error !== undefined || parsed.output === null || parsed.sessionId === undefined) outcome = "INVALID_OUTPUT";
    const outputContent = parsed.output === null
      ? `${JSON.stringify({ error: parsed.error ?? "structured output missing" }, null, 2)}\n`
      : `${JSON.stringify(parsed.output, null, 2)}\n`;
    await writeFile(outputPath, outputContent, { flag: "wx" });

    const refs = artifactRefs(request);
    const manifestCore = {
      schemaVersion: 1 as const,
      runId: request.runId,
      operationId: request.operationId,
      requestDigest: request.requestDigest,
      attemptDigest: request.attempt.attemptDigest,
      taskId: request.attempt.taskId,
      specRevision: request.attempt.specRevision,
      role: request.attempt.role,
      phase: request.attempt.phase,
      attemptId: request.attempt.attemptId,
      generation: request.attempt.generation,
      runnerKind: request.attempt.runnerKind,
      ...(parsed.sessionId === undefined ? {} : { sessionId: parsed.sessionId }),
      outcome,
      exitCode: processResult.exitCode,
      signal: processResult.signal,
      startedAt,
      finishedAt,
      output: parsed.output,
      events: parsed.events,
      ...refs,
      eventsDigest: sha256(processResult.stdout),
      stderrDigest: sha256(processResult.stderr),
      outputDigest: sha256(outputContent),
    };
    const manifestDigest = digest("real-role-manifest-v2", manifestCore);
    const evidence = createRoleRunEvidenceV2({
      runId: request.runId,
      taskId: request.attempt.taskId,
      specRevision: request.attempt.specRevision,
      role: request.attempt.role,
      phase: request.attempt.phase,
      attemptId: request.attempt.attemptId,
      generation: request.attempt.generation,
      runnerKind: request.attempt.runnerKind,
      ...(parsed.sessionId === undefined ? {} : { sessionId: parsed.sessionId }),
      outcome,
      startedAt,
      finishedAt,
      eventsRef: refs.eventsRef,
      eventsDigest: manifestCore.eventsDigest,
      stderrRef: refs.stderrRef,
      stderrDigest: manifestCore.stderrDigest,
      outputRef: refs.outputRef,
      outputDigest: manifestCore.outputDigest,
      manifestRef: refs.manifestRef,
      manifestDigest,
      artifactRefs: parsed.output?.artifactRefs ?? [],
      findingRefs: parsed.output?.findingRefs ?? [],
    });
    const manifest: RoleRunManifestV2 = deepFreeze({ ...manifestCore, manifestDigest, evidence });
    await writeFile(path.join(request.runRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    return { recovery: "EXECUTED", manifest, evidence };
  }
}

export async function prepareRealRoleRunV2(input: RealRoleRunV2Input): Promise<PreparedRealRoleRunV2> {
  const attempt = parseRoleAttemptV2(JSON.parse(JSON.stringify(input.attempt)), input.attempt.attemptDigest);
  if (attempt.state !== "RUNNING") throw conflict("REAL_ROLE_ATTEMPT_NOT_RUNNING", "Real Role Runtime requires a RUNNING Attempt");
  const scopeRoot = await physicalDirectory(input.scopeRoot, "scopeRoot");
  const artifactRootLogical = path.resolve(input.artifactRoot);
  if (artifactRootLogical === path.parse(artifactRootLogical).root) throw validation("REAL_ROLE_ARTIFACT_ROOT_UNSAFE", "Filesystem root cannot be Artifact Root");
  await mkdir(artifactRootLogical, { recursive: true });
  const artifactRoot = await physicalDirectory(artifactRootLogical, "artifactRoot");
  if (isSameOrWithin(scopeRoot, artifactRoot)) {
    throw validation("REAL_ROLE_ARTIFACT_SCOPE_OVERLAP", "Role Artifact Root must be outside the Agent scope");
  }
  const instructions = requiredString(input.instructions, "instructions");
  const instructionsDigest = sha256(instructions);
  const requestCore = {
    attemptDigest: attempt.attemptDigest,
    scopeRoot,
    artifactRoot,
    instructionsDigest,
  };
  const requestDigest = digest("real-role-request-v2", requestCore);
  const runId = digest("real-role-run-v2", { ...requestCore, taskId: attempt.taskId, attemptId: attempt.attemptId });
  const operationId = `role-operation:${runId.slice("sha256:".length)}`;
  const runRoot = path.join(artifactRoot, `run-${runId.slice("sha256:".length)}`);
  if (path.dirname(runRoot) !== artifactRoot) throw validation("REAL_ROLE_RUN_PATH_INVALID", "Run path must be a direct Artifact Root child");
  return deepFreeze({
    schemaVersion: 1,
    runId,
    operationId,
    attempt,
    scopeRoot,
    artifactRoot,
    runRoot,
    instructions,
    instructionsDigest,
    requestDigest,
  });
}

export async function writeRealRoleRunIntentV2(request: PreparedRealRoleRunV2): Promise<boolean> {
  await mkdir(request.runRoot, { recursive: true });
  const intentPath = path.join(request.runRoot, "execution-intent.json");
  const content = `${JSON.stringify(intentDocument(request), null, 2)}\n`;
  try {
    await writeFile(intentPath, content, { flag: "wx" });
    return true;
  } catch (error) {
    if (!isAlreadyExists(error) || await readFile(intentPath, "utf8") !== content) throw error;
    return false;
  }
}

export async function inspectRealRoleRunV2(request: PreparedRealRoleRunV2): Promise<RealRoleRunInspectionV2> {
  const intentPath = path.join(request.runRoot, "execution-intent.json");
  const manifestPath = path.join(request.runRoot, "manifest.json");
  if (await exists(manifestPath)) {
    const intent = await readFile(intentPath, "utf8");
    if (intent !== `${JSON.stringify(intentDocument(request), null, 2)}\n`) {
      throw conflict("REAL_ROLE_INTENT_CONFLICT", "Persisted Role Intent differs from the prepared request");
    }
    const manifest = await parseManifest(request, JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
    return { state: "CONFIRMED", runId: request.runId, operationId: request.operationId, result: {
      recovery: "REUSED", manifest, evidence: manifest.evidence,
    } };
  }
  if (await exists(intentPath)) {
    const intent = await readFile(intentPath, "utf8");
    if (intent !== `${JSON.stringify(intentDocument(request), null, 2)}\n`) {
      throw conflict("REAL_ROLE_INTENT_CONFLICT", "Persisted Role Intent differs from the prepared request");
    }
    return {
      state: "INTENT_ONLY",
      runId: request.runId,
      operationId: request.operationId,
      reconcileToken: reconcileToken(request),
    };
  }
  return { state: "ABSENT", runId: request.runId, operationId: request.operationId };
}

export function createRealRoleInvocationV2(
  request: PreparedRealRoleRunV2,
  schemaPath: string,
  codexExecutable = "codex",
  claudeExecutable = "claude",
): AgentProcessInvocation {
  const prompt = [
    `You are the ${request.attempt.role}/${request.attempt.phase} Agent for a real Moye Task.`,
    request.instructions,
    `Permission boundary: ${request.attempt.permission}.`,
    "Return only the required structured output. Do not claim artifacts or findings that do not exist.",
  ].join("\n");
  if (request.attempt.runnerKind === "CODEX_EXEC") {
    return {
      executable: executable(codexExecutable, "codexExecutable"),
      argv: [
        "exec", "--json", "--sandbox",
        request.attempt.permission === "READ_ONLY" ? "read-only" : "workspace-write",
        "--cd", request.scopeRoot, "--output-schema", schemaPath, prompt,
      ],
      cwd: request.scopeRoot,
      shell: false,
    };
  }
  return {
    executable: executable(claudeExecutable, "claudeExecutable"),
    argv: [
      "-p", "--verbose", "--output-format", "stream-json",
      "--permission-mode", request.attempt.permission === "READ_ONLY" ? "plan" : "acceptEdits",
      "--json-schema", JSON.stringify(roleOutputSchema()), prompt,
    ],
    cwd: request.scopeRoot,
    shell: false,
  };
}

async function parseManifest(request: PreparedRealRoleRunV2, value: unknown): Promise<RoleRunManifestV2> {
  const input = record(value, "RoleRunManifestV2");
  const evidenceInput = input["evidence"];
  const evidenceRecord = record(evidenceInput, "evidence");
  const evidence = parseRoleRunEvidenceV2(evidenceInput, requiredString(evidenceRecord["evidenceDigest"], "evidenceDigest"));
  const output = input["output"] === null ? null : structuredOutput(input["output"]);
  const events = eventSummaries(input["events"]);
  const core = {
    schemaVersion: 1 as const,
    runId: requiredString(input["runId"], "runId"),
    operationId: requiredString(input["operationId"], "operationId"),
    requestDigest: requiredString(input["requestDigest"], "requestDigest"),
    attemptDigest: requiredString(input["attemptDigest"], "attemptDigest"),
    taskId: requiredString(input["taskId"], "taskId"),
    specRevision: number(input["specRevision"], "specRevision"),
    role: input["role"] as AgentRoleV2,
    phase: input["phase"] as RolePhaseV2,
    attemptId: requiredString(input["attemptId"], "attemptId"),
    generation: number(input["generation"], "generation", true),
    runnerKind: input["runnerKind"] as RealRoleRunnerKind,
    ...(input["sessionId"] === undefined ? {} : { sessionId: requiredString(input["sessionId"], "sessionId") }),
    outcome: input["outcome"] as RoleRunManifestV2["outcome"],
    exitCode: input["exitCode"] as number | null,
    signal: input["signal"] as NodeJS.Signals | null,
    startedAt: requiredString(input["startedAt"], "startedAt"),
    finishedAt: requiredString(input["finishedAt"], "finishedAt"),
    output,
    events,
    eventsRef: requiredString(input["eventsRef"], "eventsRef"),
    eventsDigest: requiredString(input["eventsDigest"], "eventsDigest"),
    stderrRef: requiredString(input["stderrRef"], "stderrRef"),
    stderrDigest: requiredString(input["stderrDigest"], "stderrDigest"),
    outputRef: requiredString(input["outputRef"], "outputRef"),
    outputDigest: requiredString(input["outputDigest"], "outputDigest"),
    manifestRef: requiredString(input["manifestRef"], "manifestRef"),
  };
  const manifestDigest = digest("real-role-manifest-v2", core);
  if (input["manifestDigest"] !== manifestDigest || request.runId !== core.runId ||
      request.operationId !== core.operationId || request.requestDigest !== core.requestDigest ||
      request.attempt.attemptDigest !== core.attemptDigest || evidence.manifestDigest !== manifestDigest) {
    throw conflict("REAL_ROLE_MANIFEST_INTEGRITY_FAILED", "Role Manifest does not bind the prepared request or digest");
  }
  assertManifestEvidenceBinding(core, evidence);
  const paths = artifactPaths(request);
  const [eventsContent, stderrContent, outputContent] = await Promise.all([
    readFile(paths.events, "utf8"), readFile(paths.stderr, "utf8"), readFile(paths.output, "utf8"),
  ]);
  if (sha256(eventsContent) !== core.eventsDigest || sha256(stderrContent) !== core.stderrDigest ||
      sha256(outputContent) !== core.outputDigest) {
    throw conflict("REAL_ROLE_ARTIFACT_INTEGRITY_FAILED", "Role Artifact content digest mismatch");
  }
  const manifest: RoleRunManifestV2 = deepFreeze({ ...core, manifestDigest, evidence });
  if (canonicalJson(value) !== canonicalJson(manifest)) {
    throw conflict("REAL_ROLE_MANIFEST_INTEGRITY_FAILED", "Role Manifest has unknown or changed fields");
  }
  return manifest;
}

function assertManifestEvidenceBinding(
  manifest: Omit<RoleRunManifestV2, "manifestDigest" | "evidence">,
  evidence: RoleRunEvidenceV2,
): void {
  const outputArtifactRefs = manifest.output?.artifactRefs ?? [];
  const outputFindingRefs = manifest.output?.findingRefs ?? [];
  if (evidence.runId !== manifest.runId || evidence.taskId !== manifest.taskId ||
      evidence.specRevision !== manifest.specRevision || evidence.role !== manifest.role ||
      evidence.phase !== manifest.phase || evidence.attemptId !== manifest.attemptId ||
      evidence.generation !== manifest.generation || evidence.runnerKind !== manifest.runnerKind ||
      evidence.sessionId !== manifest.sessionId || evidence.outcome !== manifest.outcome ||
      evidence.startedAt !== manifest.startedAt || evidence.finishedAt !== manifest.finishedAt ||
      evidence.eventsRef !== manifest.eventsRef || evidence.eventsDigest !== manifest.eventsDigest ||
      evidence.stderrRef !== manifest.stderrRef || evidence.stderrDigest !== manifest.stderrDigest ||
      evidence.outputRef !== manifest.outputRef || evidence.outputDigest !== manifest.outputDigest ||
      evidence.manifestRef !== manifest.manifestRef ||
      canonicalJson(evidence.artifactRefs) !== canonicalJson(outputArtifactRefs) ||
      canonicalJson(evidence.findingRefs) !== canonicalJson(outputFindingRefs)) {
    throw conflict("REAL_ROLE_EVIDENCE_BINDING_FAILED", "Role Evidence does not exactly bind the persisted Manifest");
  }
}

function parseAgentStream(stdout: string, runnerKind: RealRoleRunnerKind): {
  events: RoleAgentEventV2[];
  sessionId?: string;
  output: RoleStructuredOutputV2 | null;
  error?: string;
} {
  const records = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const events = records.map((event, index) => ({
    sequence: index + 1,
    type: typeof event["type"] === "string" ? event["type"] : "unknown",
    category: classifyEvent(event),
  }));
  let sessionId: string | undefined;
  let message: string | undefined;
  if (runnerKind === "CODEX_EXEC") {
    const start = records.find((event) => event["type"] === "thread.started");
    if (typeof start?.["thread_id"] === "string") sessionId = start["thread_id"];
    const messages = records.filter((event) => event["type"] === "item.completed")
      .map((event) => event["item"]).filter((item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && (item as Record<string, unknown>)["type"] === "agent_message");
    if (typeof messages.at(-1)?.["text"] === "string") message = messages.at(-1)?.["text"] as string;
  } else {
    const start = records.find((event) => event["type"] === "system" && event["subtype"] === "init");
    if (typeof start?.["session_id"] === "string") sessionId = start["session_id"];
    const result = records.findLast((event) => event["type"] === "result");
    if (typeof result?.["result"] === "string") message = result["result"];
  }
  if (message === undefined) return { events, ...(sessionId === undefined ? {} : { sessionId }), output: null, error: "Role produced no final structured message" };
  try {
    return { events, ...(sessionId === undefined ? {} : { sessionId }), output: structuredOutput(JSON.parse(message) as unknown) };
  } catch (error) {
    return { events, ...(sessionId === undefined ? {} : { sessionId }), output: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function structuredOutput(value: unknown): RoleStructuredOutputV2 {
  const input = record(value, "RoleStructuredOutputV2");
  const recommendation = input["recommendation"];
  if (recommendation !== "PASS" && recommendation !== "FINDINGS" && recommendation !== "INCONCLUSIVE") {
    throw validation("REAL_ROLE_RECOMMENDATION_INVALID", "Role recommendation is invalid");
  }
  const artifactRefs = refs(input["artifactRefs"], "artifactRefs");
  const findingRefs = refs(input["findingRefs"], "findingRefs");
  if ((recommendation === "PASS" && findingRefs.length > 0) || (recommendation === "FINDINGS" && findingRefs.length === 0)) {
    throw validation("REAL_ROLE_RECOMMENDATION_CONTRADICTION", "Role recommendation contradicts Finding refs");
  }
  const output: RoleStructuredOutputV2 = {
    summary: requiredString(input["summary"], "summary"),
    recommendation,
    artifactRefs,
    findingRefs,
  };
  if (canonicalJson(value) !== canonicalJson(output)) throw validation("REAL_ROLE_OUTPUT_FIELDS_INVALID", "Role output has unknown fields");
  return output;
}

function eventSummaries(value: unknown): RoleAgentEventV2[] {
  if (!Array.isArray(value)) throw validation("REAL_ROLE_EVENTS_INVALID", "events must be an array");
  return value.map((event, index) => {
    const input = record(event, "event");
    if (input["sequence"] !== index + 1 || typeof input["type"] !== "string" ||
        !( ["ASSISTANT", "TOOL_CALL", "TOOL_RESULT", "SYSTEM", "ERROR", "OTHER"] as const).includes(input["category"] as RoleAgentEventV2["category"])) {
      throw validation("REAL_ROLE_EVENTS_INVALID", "Event summaries must be continuous and classified");
    }
    return { sequence: index + 1, type: input["type"], category: input["category"] as RoleAgentEventV2["category"] };
  });
}

function classifyEvent(event: Record<string, unknown>): RoleAgentEventV2["category"] {
  const type = typeof event["type"] === "string" ? event["type"] : "";
  if (type.includes("error") || event["is_error"] === true) return "ERROR";
  if (type === "thread.started" || type === "system" || type === "turn.started" || type === "turn.completed") return "SYSTEM";
  const item = typeof event["item"] === "object" && event["item"] !== null ? event["item"] as Record<string, unknown> : undefined;
  const itemType = item?.["type"];
  if (itemType === "agent_message" || type === "assistant") return "ASSISTANT";
  if (typeof itemType === "string" && (itemType.includes("command") || itemType.includes("tool_call"))) return "TOOL_CALL";
  if (typeof itemType === "string" && itemType.includes("tool")) return "TOOL_RESULT";
  if (type === "result") return "ASSISTANT";
  return "OTHER";
}

function intentDocument(request: PreparedRealRoleRunV2) {
  return {
    schemaVersion: 1,
    runId: request.runId,
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    attemptDigest: request.attempt.attemptDigest,
    taskId: request.attempt.taskId,
    specRevision: request.attempt.specRevision,
    role: request.attempt.role,
    phase: request.attempt.phase,
    attemptId: request.attempt.attemptId,
    generation: request.attempt.generation,
    runnerKind: request.attempt.runnerKind,
    permission: request.attempt.permission,
    scopeRoot: request.scopeRoot,
    instructionsDigest: request.instructionsDigest,
    inputArtifactRefs: request.attempt.inputArtifactRefs,
    subjectCommit: request.attempt.subjectCommit,
  };
}

function artifactPaths(request: PreparedRealRoleRunV2) {
  return {
    events: path.join(request.runRoot, "events.jsonl"),
    stderr: path.join(request.runRoot, "stderr.log"),
    output: path.join(request.runRoot, "structured-output.json"),
    manifest: path.join(request.runRoot, "manifest.json"),
  };
}

function artifactRefs(request: PreparedRealRoleRunV2) {
  const prefix = `role-v2-artifact://${request.runId.slice("sha256:".length)}`;
  return {
    eventsRef: `${prefix}/events.jsonl`,
    stderrRef: `${prefix}/stderr.log`,
    outputRef: `${prefix}/structured-output.json`,
    manifestRef: `${prefix}/manifest.json`,
  };
}

function roleOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "recommendation", "artifactRefs", "findingRefs"],
    properties: {
      summary: { type: "string", minLength: 1 },
      recommendation: { type: "string", enum: ["PASS", "FINDINGS", "INCONCLUSIVE"] },
      artifactRefs: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
      findingRefs: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
    },
  };
}

function unknownResult(request: PreparedRealRoleRunV2): MoyeError {
  return new MoyeError({
    code: "REAL_ROLE_RESULT_UNKNOWN",
    category: "UNKNOWN_SIDE_EFFECT",
    message: `Role Run ${request.runId} has Intent without a confirmed Manifest; automatic replay is forbidden`,
    details: { runId: request.runId, operationId: request.operationId, reconcileToken: reconcileToken(request) },
  });
}

function reconcileToken(request: PreparedRealRoleRunV2): string {
  return roleReconcileTokenV2(request.attempt, request.runId, request.operationId);
}

async function physicalDirectory(value: string, field: string): Promise<string> {
  const logical = path.resolve(requiredString(value, field));
  const physical = await realpath(logical);
  if (logical !== physical || !(await stat(physical)).isDirectory()) throw validation("REAL_ROLE_PATH_INVALID", `${field} must be a physical directory`);
  return physical;
}

function isSameOrWithin(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function executable(value: string, field: string): string {
  const result = requiredString(value, field);
  if (result.includes("\0")) throw validation("REAL_ROLE_EXECUTABLE_INVALID", `${field} is invalid`);
  return result;
}

function refs(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw validation("REAL_ROLE_REFS_INVALID", `${field} must be an array`);
  const result = value.map((item) => requiredString(item, field)).sort();
  if (new Set(result).size !== result.length) throw validation("REAL_ROLE_REFS_DUPLICATE", `${field} must be unique`);
  return result;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw validation("REAL_ROLE_STRING_INVALID", `${field} is required`);
  return value;
}

function number(value: unknown, field: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < (allowZero ? 0 : 1)) throw validation("REAL_ROLE_NUMBER_INVALID", `${field} is invalid`);
  return value as number;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw validation("REAL_ROLE_OBJECT_INVALID", `${field} must be an object`);
  return value as Record<string, unknown>;
}

function canonicalNow(value: Date): string {
  if (Number.isNaN(value.getTime())) throw validation("REAL_ROLE_TIME_INVALID", "Role clock returned invalid time");
  return value.toISOString();
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(`${namespace}\0${canonicalJson(value)}`).digest("hex")}`;
}

function sha256(value: string): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

async function exists(target: string): Promise<boolean> {
  try { await access(target); return true; }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function validation(code: string, message: string): MoyeError { return new MoyeError({ code, category: "VALIDATION", message }); }
function conflict(code: string, message: string): MoyeError { return new MoyeError({ code, category: "CONFLICT", message }); }
