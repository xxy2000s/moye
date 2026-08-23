import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";

import type { BacklogProjection } from "../domain/backlog.js";
import type { ProjectBoardSnapshot } from "../domain/board.js";
import { assertTaskId, type TaskProjection } from "../domain/task.js";
import { invoke, send } from "../restate/ingress.js";
import type { TaskAuthorityState } from "../restate/services.js";
import type { CodingWorkflowProjection } from "../coding/workflow.js";
import { buildCodingTaskTrace } from "../trace/coding-trace.js";
import { buildCoreV2StateMachine, buildTaskStateMachine } from "../trace/state-machine.js";
import type { MoyeConfig } from "../config.js";
import type { AgentArtifactFile } from "../agent/runner.js";
import { buildLiveCodingTask, listLiveCapabilities } from "../product/live-task.js";
import { MoyeError } from "../domain/errors.js";
import type { CoreV2WorkflowProjection } from "../restate/core-v2-services.js";
import { createCoreV2ObserverReport } from "../domain/core-v2-observer.js";

export interface BoardServerOptions {
  readonly port: number;
  readonly projectId: string;
  readonly ingressUrl: string;
  readonly restateAdminUrl: string;
  readonly publicRoot: string;
  readonly artifactRoots?: readonly string[];
  readonly liveRuntimeRoot?: string;
  readonly repositoryRoots?: readonly string[];
  readonly observability?: MoyeConfig["observability"];
}

export function startBoardServer(options: BoardServerOptions) {
  const server = createServer((request, response) => {
    void route(request, response, options).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 500, { error: message });
    });
  });
  server.listen(options.port, "0.0.0.0");
  return server;
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: BoardServerOptions,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && url.pathname === "/api/board") {
    const snapshot = await invoke<ProjectBoardSnapshot>(
      options.ingressUrl,
      "ProjectBoard",
      options.projectId,
      "get",
    );
    writeJson(response, 200, snapshot);
    return;
  }

  if (method === "GET" && url.pathname === "/api/live-capabilities") {
    writeJson(response, 200, await listLiveCapabilities({
      projectId: options.projectId,
      runtimeRoot: options.liveRuntimeRoot ?? ".moye-runtime/live",
      allowedRepositoryRoots: options.repositoryRoots ?? [],
    }));
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/api/tasks/")) {
    const segments = url.pathname.slice("/api/tasks/".length).split("/");
    let taskId: string;
    try { taskId = decodeURIComponent(segments[0] ?? ""); }
    catch {
      writeJson(response, 400, { error: "Malformed Task ID encoding" });
      return;
    }
    try { assertTaskId(taskId); }
    catch {
      writeJson(response, 400, { error: "Invalid Task ID" });
      return;
    }
    const traceRequest = segments.length === 2 && segments[1] === "trace";
    const agentEventsRequest = segments.length === 2 && segments[1] === "agent-events";
    const roleEventsRequest = segments.length === 4 && segments[1] === "roles" && segments[3] === "events";
    const artifactKind = segments.length === 3 && segments[1] === "artifacts"
      ? readArtifactKind(segments[2])
      : undefined;
    if (segments.length > 1 && !traceRequest && !agentEventsRequest && !roleEventsRequest && artifactKind === undefined) {
      writeJson(response, 404, { error: "Not found" });
      return;
    }
    const authority = await invoke<TaskAuthorityState | null>(
      options.ingressUrl, "TaskAuthority", taskId, "get",
    );
    if (authority === null) {
      writeJson(response, 404, { error: "Task not found" });
      return;
    }
    if (traceRequest) {
      if (authority.owner === "CORE_V2_WORKFLOW") {
        const target = coreV2WorkflowTarget(authority, taskId);
        const projection = await invoke<CoreV2WorkflowProjection | null>(options.ingressUrl, target.service, target.key, "status");
        writeJson(response, projection === null ? 404 : 200, projection === null ? { error: "Task trace not found" } : buildCoreV2Trace(projection, options.restateAdminUrl));
        return;
      }
      if (authority.owner === "CORE_WORKFLOW") {
        writeJson(response, 409, { error: "Core state machine is available from CoreClosureWorkflow status only" });
        return;
      }
      if (authority.owner === "CODING_WORKFLOW") {
        const projection = await invoke<CodingWorkflowProjection | null>(
          options.ingressUrl, "CodingTaskWorkflow", taskId, "status",
        );
        writeJson(response, projection === null ? 404 : 200,
          projection === null ? { error: "Task trace not found" } : buildCodingTaskTrace(projection, {
            restateAdminUrl: options.restateAdminUrl,
            ...(options.observability === undefined ? {} : { observability: options.observability }),
          }));
        return;
      }
      const recovered = authority.recoveryWorkflowRef !== undefined;
      const sealed = authority.owner === "SEALED_TASK_WORKFLOW";
      const recoveryTarget = !sealed || authority.recoveryWorkflowRef === undefined
        ? undefined
        : parseRuntimeWorkflowRef(authority.recoveryWorkflowRef);
      const workflowService = sealed
        ? recoveryTarget?.service ?? "SealedTaskWorkflow"
        : recovered ? "BootstrapFailureRecoveryWorkflow" : "TaskWorkflow";
      const workflowKey = recoveryTarget?.key ?? taskId;
      const projection = await invoke<TaskProjection | null>(
        options.ingressUrl,
        workflowService,
        workflowKey,
        "status",
      );
      writeJson(response, projection === null ? 404 : 200, projection === null ? { error: "Task trace not found" } : {
        schemaVersion: 1,
        traceKind: "TASK",
        task: projection,
        stateMachine: buildTaskStateMachine(
          projection,
          workflowService,
        ),
        durableRuntime: {
          authority: "Restate Journal",
          workflowRef: recovered
            ? authority.recoveryWorkflowRef
            : `restate://${workflowService}/${projection.taskId}`,
          workflowService,
          workflowKey,
          ...(authority.sourceWorkflowRef === undefined ? {} : {
            sourceWorkflowRef: authority.sourceWorkflowRef,
          }),
          adminBaseUrl: options.restateAdminUrl,
          invocationsUrl: buildWorkflowInvocationsUrl(
            options.restateAdminUrl,
            workflowService,
            workflowKey,
          ),
        },
      });
      return;
    }
    if (agentEventsRequest) {
      if (authority.owner !== "CODING_WORKFLOW") {
        writeJson(response, 409, { error: "Agent Events are not available for this Task workflow" });
        return;
      }
      const cursor = readBoundedInteger(url.searchParams.get("cursor"), 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = readBoundedInteger(url.searchParams.get("limit"), 100, 1, 200);
      if (cursor === undefined || limit === undefined) {
        writeJson(response, 400, { error: "cursor must be a non-negative integer and limit must be between 1 and 200" });
        return;
      }
      const projection = await invoke<CodingWorkflowProjection | null>(
        options.ingressUrl, "CodingTaskWorkflow", taskId, "status",
      );
      const locator = projection?.agentRun ?? (projection?.agent === undefined ? undefined : {
        runId: projection.agent.runId,
        runnerKind: projection.agent.runnerKind,
        taskId: projection.agent.taskId,
        specRevision: projection.agent.specRevision,
        stepId: projection.agent.stepId,
        attemptId: projection.agent.attemptId,
        eventsArtifactRef: projection.agent.artifacts.events.artifactRef,
      });
      if (projection === null || locator === undefined) {
        writeJson(response, 404, { error: "Agent Event stream not found" });
        return;
      }
      try {
        writeJson(response, 200, await readAgentEventPage({
          artifactRoots: options.artifactRoots ?? [],
          declaredArtifactRoot: projection.artifactRoot,
          locator,
          ...(projection.agent === undefined ? {} : { completedArtifact: projection.agent.artifacts.events }),
          cursor,
          limit,
        }));
      } catch {
        writeJson(response, 404, { error: "Agent Event stream not found" });
      }
      return;
    }
    if (roleEventsRequest) {
      if (authority.owner === "CORE_V2_WORKFLOW") {
        let runId: string;
        try { runId = decodeURIComponent(segments[2] ?? ""); } catch { writeJson(response, 400, { error: "Malformed Role Run ID" }); return; }
        const target = coreV2WorkflowTarget(authority, taskId);
        const projection = await invoke<CoreV2WorkflowProjection | null>(options.ingressUrl, target.service, target.key, "status");
        const run = projection?.roleRuns.find((item) => item.runId === runId);
        if (projection === null || run === undefined) { writeJson(response, 404, { error: "Role Event stream not found" }); return; }
        const cursor = readBoundedInteger(url.searchParams.get("cursor"), 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = readBoundedInteger(url.searchParams.get("limit"), 100, 1, 200);
        if (cursor === undefined || limit === undefined) { writeJson(response, 400, { error: "Invalid cursor" }); return; }
        try {
          const filePath = await resolveCoreV2RoleEventFile(options.artifactRoots ?? [], projection.artifactRoot, run);
          writeJson(response, 200, await readEventPage({ filePath, runId, runnerKind: run.runnerKind, taskId, attemptId: run.attemptId, cursor, limit, completed: true }));
        } catch {
          writeJson(response, 404, { error: "Role Event stream not found" });
        }
        return;
      }
      if (authority.owner !== "CODING_WORKFLOW") {
        writeJson(response, 409, { error: "Role Events are not available for this Task workflow" });
        return;
      }
      let runId: string;
      try { runId = decodeURIComponent(segments[2] ?? ""); }
      catch {
        writeJson(response, 400, { error: "Malformed Role Run ID" });
        return;
      }
      const projection = await invoke<CodingWorkflowProjection | null>(
        options.ingressUrl, "CodingTaskWorkflow", taskId, "status",
      );
      const role = projection?.roleRuns?.find((candidate) => candidate.runId === runId);
      const review = projection?.reviews?.find((candidate) => candidate.runId === runId);
      const activeRole = projection?.roleRun?.runId === runId ? projection.roleRun : undefined;
      const activeReview = projection?.reviewRun?.runId === runId ? projection.reviewRun : undefined;
      const agent = projection?.agentRuns?.find((candidate) => candidate.runId === runId)
        ?? (projection?.agent?.runId === runId ? projection.agent : undefined);
      if (projection === null || (role === undefined && review === undefined && agent === undefined
          && activeRole === undefined && activeReview === undefined)) {
        writeJson(response, 404, { error: "Role Event stream not found" });
        return;
      }
      try {
        const filePath = agent !== undefined
          ? await resolveRoleEventFile(options.artifactRoots ?? [], projection.artifactRoot, {
            runId: agent.runId,
            relativeDirectory: "agent",
            artifactRef: agent.artifacts.events.artifactRef,
            contentDigest: agent.artifacts.events.contentDigest,
            scheme: "agent-artifact",
          })
          : activeRole !== undefined
          ? await resolveLiveRoleEventFile(options.artifactRoots ?? [], projection.artifactRoot, {
            runId: activeRole.runId,
            taskId: activeRole.taskId,
            specRevision: activeRole.specRevision,
            attempt: activeRole.attempt,
            runnerKind: activeRole.runnerKind,
            relativeDirectory: pathForRole(activeRole.kind),
          })
          : activeReview !== undefined
          ? await resolveLiveRoleEventFile(options.artifactRoots ?? [], projection.artifactRoot, {
            runId: activeReview.runId,
            taskId: activeReview.taskId,
            specRevision: activeReview.specRevision,
            attempt: activeReview.attempt,
            runnerKind: activeReview.runnerKind,
            relativeDirectory: "review",
          })
          : role !== undefined
          ? await resolveRoleEventFile(options.artifactRoots ?? [], projection.artifactRoot, {
            runId: role.runId,
            relativeDirectory: pathForRole(role.kind),
            artifactRef: role.eventsArtifactRef,
            contentDigest: role.eventsContentDigest,
            scheme: "role-artifact",
          })
          : await resolveRoleEventFile(options.artifactRoots ?? [], projection.artifactRoot, {
            runId: review!.runId,
            relativeDirectory: "review",
            artifactRef: review!.eventsArtifactRef,
            contentDigest: review!.eventsContentDigest,
            scheme: "review-artifact",
          });
        if (url.searchParams.has("cursor") || url.searchParams.has("limit")) {
          const cursor = readBoundedInteger(url.searchParams.get("cursor"), 0, 0, Number.MAX_SAFE_INTEGER);
          const limit = readBoundedInteger(url.searchParams.get("limit"), 100, 1, 200);
          if (cursor === undefined || limit === undefined) throw new Error("Invalid Role Event cursor");
          writeJson(response, 200, await readEventPage({
            filePath,
            runId,
            runnerKind: role?.runnerKind ?? review?.runnerKind ?? activeRole?.runnerKind ?? activeReview?.runnerKind ?? agent!.runnerKind,
            taskId,
            attemptId: activeRole !== undefined ? `${activeRole.kind}-${activeRole.attempt}`
              : activeReview !== undefined ? `REVIEW-${activeReview.attempt}`
                : agent?.attemptId ?? `REVIEW-${review?.attempt ?? 1}`,
            cursor,
            limit,
            completed: activeRole === undefined && activeReview === undefined,
          }));
        } else {
          await serveEventFile(filePath, `${agent === undefined ? role?.kind.toLowerCase() ?? activeRole?.kind.toLowerCase() ?? "review" : "implementation"}-events.jsonl`, response);
        }
      } catch {
        writeJson(response, 404, { error: "Role Event stream not found" });
      }
      return;
    }
    if (artifactKind !== undefined) {
      if (authority.owner !== "CODING_WORKFLOW") {
        writeJson(response, 409, { error: "Agent Artifact is not available for this Task workflow" });
        return;
      }
      const projection = await invoke<CodingWorkflowProjection | null>(
        options.ingressUrl, "CodingTaskWorkflow", taskId, "status",
      );
      if (projection?.agent === undefined) {
        writeJson(response, 404, { error: "Agent Artifact not found" });
        return;
      }
      const artifact = artifactKind === "agent-events"
        ? projection.agent.artifacts.events
        : projection.agent.artifacts.rawModelIo;
      if (artifact === undefined) {
        writeJson(response, 404, { error: "Agent Artifact not found" });
        return;
      }
      try {
        const filePath = await resolveAgentArtifactFile(
          options.artifactRoots ?? [], projection.artifactRoot, projection.agent.runId, artifactKind, artifact,
        );
        await serveVerifiedArtifact(filePath, artifactKind, response);
      } catch {
        writeJson(response, 404, { error: "Agent Artifact not found" });
      }
      return;
    }
    const recoveryTarget = authority.owner !== "SEALED_TASK_WORKFLOW" || authority.recoveryWorkflowRef === undefined
      ? undefined
      : parseRuntimeWorkflowRef(authority.recoveryWorkflowRef);
    const projection = authority.owner === "CORE_V2_WORKFLOW"
      ? await (() => { const target = coreV2WorkflowTarget(authority, taskId); return invoke<CoreV2WorkflowProjection | null>(options.ingressUrl, target.service, target.key, "status"); })()
      : authority.owner === "CODING_WORKFLOW"
      ? await invoke<CodingWorkflowProjection | null>(options.ingressUrl, "CodingTaskWorkflow", taskId, "status")
      : await invoke<TaskProjection | null>(
        options.ingressUrl,
        authority.owner === "SEALED_TASK_WORKFLOW"
          ? recoveryTarget?.service ?? "SealedTaskWorkflow"
          : authority.recoveryWorkflowRef === undefined ? "TaskWorkflow" : "BootstrapFailureRecoveryWorkflow",
        authority.owner === "SEALED_TASK_WORKFLOW" ? recoveryTarget?.key ?? taskId : taskId,
        "status",
      );
    writeJson(response, projection === null ? 404 : 200, projection ?? { error: "Task not found" });
    return;
  }

  if (method === "POST" && url.pathname === "/api/backlog") {
    const item = await readJson<BacklogProjection>(request);
    await invoke<void>(
      options.ingressUrl,
      "ProjectBoard",
      options.projectId,
      "upsertBacklog",
      item,
    );
    writeJson(response, 201, item);
    return;
  }

  if (method === "POST" && url.pathname === "/api/tasks") {
    try {
      const built = await buildLiveCodingTask(await readJson<unknown>(request), {
        projectId: options.projectId,
        runtimeRoot: options.liveRuntimeRoot ?? ".moye-runtime/live",
        allowedRepositoryRoots: options.repositoryRoots ?? [],
      });
      const receipt = await send(options.ingressUrl, "CodingTaskWorkflow", built.taskId, "run", built.input);
      writeJson(response, 202, { accepted: true, taskId: built.taskId, workflow: "CodingTaskWorkflow", ...receipt });
    } catch (error) {
      if (!(error instanceof MoyeError)) throw error;
      writeJson(response, 400, { error: error.message, code: error.code });
    }
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    writeJson(response, 405, { error: "Method not allowed" });
    return;
  }

  await serveStatic(url.pathname, method === "HEAD", response, options.publicRoot);
}

export function buildCoreV2Trace(projection: CoreV2WorkflowProjection, restateAdminUrl: string) {
  const workflowRef = projection.workflowRef ?? `restate://CoreV2Workflow/${projection.taskId}`;
  const workflowTarget = parseCoreV2WorkflowRef(workflowRef);
  const task: TaskProjection = {
    taskId: projection.taskId,
    projectId: projection.projectId,
    title: projection.title,
    state: projection.outcome === "FAILED_TERMINAL" || projection.state === "CLOSED" ? "CLOSED" : "EXECUTING",
    currentStep: projection.currentStep,
    attempt: projection.attempts.length,
    specRevision: projection.lifecycle.specRevision,
    backlogRefs: [],
    archiveStatus: projection.lifecycle.archive?.status ?? (projection.state === "CLOSED" ? "ARCHIVED" : "NOT_READY"),
    ...(projection.outcome === null ? {} : { outcome: projection.outcome }),
    ...(projection.error === null ? {} : { error: projection.error }),
    lastEventAt: projection.lifecycle.events.at(-1)?.at ?? projection.startedAt,
    events: projection.lifecycle.events.map((event) => ({ ...event })),
  };
  return {
    schemaVersion: 2 as const,
    traceKind: "CORE_V2" as const,
    task,
    lifecycle: projection.lifecycle,
    business: { events: task.events, attempts: projection.attempts },
    observer: createCoreV2ObserverReport(projection.lifecycle, projection.attempts),
    roles: projection.roleRuns.map((run) => ({
      kind: run.phase,
      runId: run.runId,
      runnerKind: run.runnerKind,
      sessionId: run.sessionId,
      specRevision: run.specRevision,
      attempt: run.generation + 1,
      attemptId: run.attemptId,
      generation: run.generation,
      outcome: run.outcome,
      verdict: run.output?.recommendation,
      summary: run.output?.summary ?? "No structured summary",
      findingCount: run.output?.findingRefs.length ?? 0,
      eventsUrl: `/api/tasks/${encodeURIComponent(projection.taskId)}/roles/${encodeURIComponent(run.runId)}/events`,
    })),
    stateMachine: buildCoreV2StateMachine(projection),
    durableRuntime: {
      authority: "Restate Journal" as const,
      workflowRef,
      workflowService: workflowTarget.service,
      workflowKey: workflowTarget.key,
      ...(projection.sourceWorkflowRef === undefined ? {} : { sourceWorkflowRef: projection.sourceWorkflowRef }),
      adminBaseUrl: restateAdminUrl,
      invocationsUrl: buildWorkflowInvocationsUrl(restateAdminUrl, workflowTarget.service, workflowTarget.key),
    },
  };
}

function coreV2WorkflowTarget(authority: TaskAuthorityState, taskId: string): { service: "CoreV2Workflow" | "CoreV2FailureRecoveryWorkflow"; key: string } {
  return authority.recoveryWorkflowRef === undefined
    ? { service: "CoreV2Workflow", key: taskId }
    : parseCoreV2WorkflowRef(authority.recoveryWorkflowRef);
}

function parseCoreV2WorkflowRef(value: string): { service: "CoreV2Workflow" | "CoreV2FailureRecoveryWorkflow"; key: string } {
  const match = /^restate:\/\/(CoreV2Workflow|CoreV2FailureRecoveryWorkflow)\/([A-Z0-9-]+)$/.exec(value);
  if (match === null) throw new Error(`Invalid Core v2 Workflow ref: ${value}`);
  return { service: match[1] as "CoreV2Workflow" | "CoreV2FailureRecoveryWorkflow", key: match[2]! };
}

function parseRuntimeWorkflowRef(value: string): { service: "SealedTaskRecoveryWorkflow" | "SealRecoveryAttemptWorkflow"; key: string } {
  const match = /^restate:\/\/(SealedTaskRecoveryWorkflow|SealRecoveryAttemptWorkflow)\/([A-Z0-9-]+)$/.exec(value);
  if (match === null) throw new Error(`Invalid sealed recovery Workflow ref: ${value}`);
  return { service: match[1] as "SealedTaskRecoveryWorkflow" | "SealRecoveryAttemptWorkflow", key: match[2]! };
}

type DownloadableArtifactKind = "agent-events" | "raw-model-io";

function pathForRole(kind: string): string {
  if (!/^[A-Z_]+$/.test(kind)) throw new Error("Invalid Role kind");
  return `roles/${kind.toLowerCase()}`;
}

async function resolveCoreV2RoleEventFile(
  artifactRoots: readonly string[],
  declaredArtifactRoot: string,
  run: CoreV2WorkflowProjection["roleRuns"][number],
): Promise<string> {
  const token = run.runId.slice("sha256:".length);
  if (!/^[0-9a-f]{64}$/.test(token)
      || run.eventsRef !== `role-v2-artifact://${token}/events.jsonl`
      || !/^sha256:[0-9a-f]{64}$/.test(run.eventsDigest)) throw new Error("Invalid Core v2 Role Artifact identity");
  const taskRoot = await realpath(declaredArtifactRoot);
  let allowed = false;
  for (const configuredRoot of artifactRoots) {
    try { if (isSameOrWithin(await realpath(configuredRoot), taskRoot)) allowed = true; } catch { continue; }
  }
  if (!allowed) throw new Error("Task Artifact Root is outside configured roots");
  const candidate = resolve(taskRoot, "roles", `run-${token}`, "events.jsonl");
  const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Role Events are not a regular file");
  const actual = await realpath(candidate);
  if (actual !== candidate || !isSameOrWithin(taskRoot, actual)) throw new Error("Role Artifact escaped Task Artifact Root");
  const content = await readFile(actual);
  if (`sha256:${createHash("sha256").update(content).digest("hex")}` !== run.eventsDigest) throw new Error("Role Artifact digest mismatch");
  return actual;
}

async function resolveRoleEventFile(
  artifactRoots: readonly string[],
  declaredArtifactRoot: string | undefined,
  input: { readonly runId: string; readonly relativeDirectory: string; readonly artifactRef: string; readonly contentDigest: string | undefined; readonly scheme: string },
): Promise<string> {
  const token = input.runId.slice(input.runId.lastIndexOf(":") + 1);
  if (!/^[0-9a-f]{64}$/.test(token) || input.contentDigest === undefined
      || input.artifactRef !== `${input.scheme}://${input.runId}/events.jsonl`) throw new Error("Invalid Role Artifact identity");
  if (declaredArtifactRoot === undefined) throw new Error("Task did not declare an Artifact Root");
  const taskRoot = await realpath(declaredArtifactRoot);
  let allowed = false;
  for (const configuredRoot of artifactRoots) {
    try { if (isSameOrWithin(await realpath(configuredRoot), taskRoot)) allowed = true; } catch { continue; }
  }
  if (!allowed) throw new Error("Task Artifact Root is outside configured roots");
  const candidate = resolve(taskRoot, input.relativeDirectory, `run-${token}`, "events.jsonl");
  const actual = await realpath(candidate);
  if (!isSameOrWithin(taskRoot, actual) || actual !== candidate) throw new Error("Role Artifact escaped Task Artifact Root");
  const content = await readFile(actual);
  if (`sha256:${createHash("sha256").update(content).digest("hex")}` !== input.contentDigest) throw new Error("Role Artifact digest mismatch");
  return actual;
}

async function resolveLiveRoleEventFile(
  artifactRoots: readonly string[],
  declaredArtifactRoot: string | undefined,
  input: {
    readonly runId: string;
    readonly taskId: string;
    readonly specRevision: number;
    readonly attempt: number;
    readonly runnerKind: string;
    readonly relativeDirectory: string;
  },
): Promise<string> {
  const token = input.runId.slice(input.runId.lastIndexOf(":") + 1);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Invalid live Role Run identity");
  if (declaredArtifactRoot === undefined) throw new Error("Task did not declare an Artifact Root");
  const taskRoot = await realpath(declaredArtifactRoot);
  let allowed = false;
  for (const configuredRoot of artifactRoots) {
    try { if (isSameOrWithin(await realpath(configuredRoot), taskRoot)) allowed = true; } catch { continue; }
  }
  if (!allowed) throw new Error("Task Artifact Root is outside configured roots");
  const runRoot = resolve(taskRoot, input.relativeDirectory, `run-${token}`);
  if (!isSameOrWithin(taskRoot, runRoot)) throw new Error("Role Run path escaped Task Artifact Root");
  const intentCandidate = resolve(runRoot, "execution-intent.json");
  const intentInfo = await lstat(intentCandidate);
  if (!intentInfo.isFile() || intentInfo.isSymbolicLink()) throw new Error("Role intent is not a regular file");
  const intentPath = await realpath(intentCandidate);
  if (intentPath !== intentCandidate || !isSameOrWithin(taskRoot, intentPath)) throw new Error("Role intent escaped Task Artifact Root");
  const intent = JSON.parse(await readFile(intentPath, "utf8")) as Record<string, unknown>;
  if (intent["runId"] !== input.runId || intent["taskId"] !== input.taskId
      || intent["specRevision"] !== input.specRevision || intent["attempt"] !== input.attempt
      || intent["runnerKind"] !== input.runnerKind) throw new Error("Role intent does not match Task projection");
  const eventsCandidate = resolve(runRoot, "events.jsonl");
  const eventsInfo = await lstat(eventsCandidate);
  if (!eventsInfo.isFile() || eventsInfo.isSymbolicLink()) throw new Error("Role Events are not a regular file");
  const eventsPath = await realpath(eventsCandidate);
  if (eventsPath !== eventsCandidate || !isSameOrWithin(taskRoot, eventsPath)) throw new Error("Role Events escaped Task Artifact Root");
  return eventsPath;
}

async function readEventPage(input: {
  readonly filePath: string;
  readonly runId: string;
  readonly runnerKind: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly cursor: number;
  readonly limit: number;
  readonly completed: boolean;
}): Promise<AgentEventPage> {
  const content = await readUtf8Snapshot(input.filePath, 16 * 1024 * 1024);
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const selected = lines.slice(input.cursor, input.cursor + input.limit);
  const events = selected.map((raw, offset) => {
    const sequence = input.cursor + offset + 1;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return { sequence, type: agentEventType(parsed), category: classifyAgentEvent(parsed), raw, parsed };
    } catch {
      return { sequence, type: "malformed-json", category: "error" as const, raw };
    }
  });
  const nextCursor = input.cursor + selected.length;
  return {
    runId: input.runId,
    runnerKind: input.runnerKind,
    taskId: input.taskId,
    attemptId: input.attemptId,
    cursor: input.cursor,
    nextCursor,
    total: lines.length,
    hasMore: nextCursor < lines.length,
    completed: input.completed,
    events,
  };
}

async function serveEventFile(filePath: string, fileName: string, response: ServerResponse): Promise<void> {
  const info = await stat(filePath);
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "content-length": info.size,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="${fileName}"`,
  });
  createReadStream(filePath).pipe(response);
}

function buildWorkflowInvocationsUrl(adminBaseUrl: string, service: string, taskId: string): string {
  const url = new URL("/ui/invocations", adminBaseUrl);
  url.searchParams.set("filter_target_service_name", JSON.stringify({ operation: "IN", value: [service] }));
  url.searchParams.set("filter_target_service_key", JSON.stringify({ operation: "EQUALS", value: taskId }));
  url.searchParams.set("sort_field", "created_at");
  url.searchParams.set("sort_order", "DESC");
  return url.toString();
}

export type AgentEventCategory = "conversation" | "tool" | "tool_result" | "system" | "error";

export interface AgentEventPage {
  readonly runId: string;
  readonly runnerKind: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly cursor: number;
  readonly nextCursor: number;
  readonly total: number;
  readonly hasMore: boolean;
  readonly completed: boolean;
  readonly events: readonly {
    readonly sequence: number;
    readonly type: string;
    readonly category: AgentEventCategory;
    readonly raw: string;
    readonly parsed?: unknown;
  }[];
}

function readArtifactKind(value: string | undefined): DownloadableArtifactKind | undefined {
  return value === "agent-events" || value === "raw-model-io" ? value : undefined;
}

export async function resolveAgentArtifactFile(
  artifactRoots: readonly string[],
  declaredArtifactRoot: string | undefined,
  runId: string,
  kind: DownloadableArtifactKind,
  artifact: AgentArtifactFile,
): Promise<string> {
  const token = runId.slice(runId.lastIndexOf(":") + 1);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Invalid Agent Run ID");
  if (declaredArtifactRoot === undefined) throw new Error("Task did not declare an Artifact Root");
  const fileName = kind === "agent-events" ? "events.jsonl" : "raw-model-io.jsonl";
  if (artifact.artifactRef !== `agent-artifact://${runId}/${fileName}`) throw new Error("Artifact reference mismatch");
  const taskRoot = await realpath(declaredArtifactRoot);
  let allowed = false;
  for (const configuredRoot of artifactRoots) {
    try { if (isSameOrWithin(await realpath(configuredRoot), taskRoot)) allowed = true; } catch { continue; }
  }
  if (!allowed) throw new Error("Task Artifact Root is outside configured roots");
  const candidate = resolve(taskRoot, "agent", `run-${token}`, fileName);
  if (!isSameOrWithin(taskRoot, candidate)) throw new Error("Artifact path escaped Task Artifact Root");
  const actual = await realpath(candidate);
  if (!isSameOrWithin(taskRoot, actual)) throw new Error("Artifact path escaped Task Artifact Root");
  const info = await stat(actual);
  if (!info.isFile() || info.size !== artifact.bytes) throw new Error("Artifact size mismatch");
  const content = await readFile(actual);
  const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (digest !== artifact.contentDigest) throw new Error("Artifact digest mismatch");
  return actual;
}

export async function readAgentEventPage(input: {
  readonly artifactRoots: readonly string[];
  readonly declaredArtifactRoot: string | undefined;
  readonly locator: NonNullable<CodingWorkflowProjection["agentRun"]>;
  readonly completedArtifact?: AgentArtifactFile;
  readonly cursor: number;
  readonly limit: number;
}): Promise<AgentEventPage> {
  if (!Number.isSafeInteger(input.cursor) || input.cursor < 0
      || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200) {
    throw new Error("Invalid Agent Event cursor");
  }
  if (input.locator.taskId === "" || input.locator.eventsArtifactRef !== `agent-artifact://${input.locator.runId}/events.jsonl`) {
    throw new Error("Agent Event locator mismatch");
  }
  const completed = input.completedArtifact !== undefined;
  const filePath = completed
    ? await resolveAgentArtifactFile(
      input.artifactRoots,
      input.declaredArtifactRoot,
      input.locator.runId,
      "agent-events",
      input.completedArtifact,
    )
    : await resolveLiveAgentEventFile(input.artifactRoots, input.declaredArtifactRoot, input.locator);
  const content = filePath === undefined ? "" : await readUtf8Snapshot(filePath, 16 * 1024 * 1024);
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const selected = lines.slice(input.cursor, input.cursor + input.limit);
  const events = selected.map((raw, offset) => {
    const sequence = input.cursor + offset + 1;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return {
        sequence,
        type: agentEventType(parsed),
        category: classifyAgentEvent(parsed),
        raw,
        parsed,
      };
    } catch {
      return { sequence, type: "malformed-json", category: "error" as const, raw };
    }
  });
  const nextCursor = input.cursor + selected.length;
  return {
    runId: input.locator.runId,
    runnerKind: input.locator.runnerKind,
    taskId: input.locator.taskId,
    attemptId: input.locator.attemptId,
    cursor: input.cursor,
    nextCursor,
    total: lines.length,
    hasMore: nextCursor < lines.length,
    completed,
    events,
  };
}

async function readUtf8Snapshot(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error("Agent Event stream exceeds the Board limit");
    const buffer = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function resolveLiveAgentEventFile(
  artifactRoots: readonly string[],
  declaredArtifactRoot: string | undefined,
  locator: NonNullable<CodingWorkflowProjection["agentRun"]>,
): Promise<string | undefined> {
  const token = locator.runId.slice(locator.runId.lastIndexOf(":") + 1);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Invalid Agent Run ID");
  if (declaredArtifactRoot === undefined) throw new Error("Task did not declare an Artifact Root");
  const taskRoot = await realpath(declaredArtifactRoot);
  let allowed = false;
  for (const configuredRoot of artifactRoots) {
    try { if (isSameOrWithin(await realpath(configuredRoot), taskRoot)) allowed = true; } catch { continue; }
  }
  if (!allowed) throw new Error("Task Artifact Root is outside configured roots");
  const runRoot = resolve(taskRoot, "agent", `run-${token}`);
  if (!isSameOrWithin(taskRoot, runRoot)) throw new Error("Agent Run path escaped Task Artifact Root");
  try {
    const intentCandidate = resolve(runRoot, "execution-intent.json");
    const intentInfo = await lstat(intentCandidate);
    if (!intentInfo.isFile() || intentInfo.isSymbolicLink()) throw new Error("Agent intent is not a regular file");
    const intentPath = await realpath(intentCandidate);
    if (!isSameOrWithin(taskRoot, intentPath) || intentPath !== intentCandidate) throw new Error("Agent intent escaped Task Artifact Root");
    const intent = JSON.parse(await readFile(intentPath, "utf8")) as Record<string, unknown>;
    if (intent["runId"] !== locator.runId || intent["taskId"] !== locator.taskId
        || intent["attemptId"] !== locator.attemptId || intent["runnerKind"] !== locator.runnerKind
        || intent["specRevision"] !== locator.specRevision) {
      throw new Error("Agent intent does not match the Task projection");
    }
    const candidate = resolve(runRoot, "events.jsonl");
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) {
      throw new Error("Agent Event stream is unsafe");
    }
    const actual = await realpath(candidate);
    if (!isSameOrWithin(taskRoot, actual) || actual !== candidate) throw new Error("Agent Event stream escaped Task Artifact Root");
    return actual;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function agentEventType(value: unknown): string {
  if (!isRecord(value)) return "non-object-json";
  const item = isRecord(value["item"]) ? value["item"] : undefined;
  const primary = stringValue(value["type"]) ?? stringValue(value["event"]) ?? stringValue(value["name"]);
  const secondary = stringValue(item?.["type"]) ?? stringValue(value["subtype"]);
  return [primary, secondary].filter(Boolean).join(" · ") || "unknown-event";
}

function classifyAgentEvent(value: unknown): AgentEventCategory {
  if (!isRecord(value)) return "error";
  const type = stringValue(value["type"]) ?? "";
  const subtype = stringValue(value["subtype"]) ?? "";
  const item = isRecord(value["item"]) ? value["item"] : undefined;
  const itemType = stringValue(item?.["type"]) ?? "";
  if (type === "error" || type === "turn.failed" || subtype === "error" || itemType === "error" || value["is_error"] === true) return "error";
  if (type === "assistant") {
    const content = isRecord(value["message"]) && Array.isArray(value["message"]["content"])
      ? value["message"]["content"] as unknown[] : [];
    return content.some((entry) => isRecord(entry) && entry["type"] === "tool_use") ? "tool" : "conversation";
  }
  if (type === "user") {
    const content = isRecord(value["message"]) && Array.isArray(value["message"]["content"])
      ? value["message"]["content"] as unknown[] : [];
    return content.some((entry) => isRecord(entry) && entry["type"] === "tool_result") ? "tool_result" : "conversation";
  }
  if (type === "result") return "conversation";
  if (itemType === "agent_message" || itemType === "reasoning") return "conversation";
  if (["command_execution", "mcp_tool_call", "web_search", "file_change"].includes(itemType)) {
    return type === "item.completed" ? "tool_result" : "tool";
  }
  if (type === "tool_use") return "tool";
  if (type === "tool_result") return "tool_result";
  return "system";
}

function readBoundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number | undefined {
  if (value === null) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function serveVerifiedArtifact(
  filePath: string,
  kind: DownloadableArtifactKind,
  response: ServerResponse,
): Promise<void> {
  const info = await stat(filePath);
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "content-length": info.size,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="${kind}.jsonl"`,
  });
  createReadStream(filePath).pipe(response);
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > 1_048_576) throw new Error("Request body exceeds 1 MiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

async function serveStatic(
  pathname: string,
  headOnly: boolean,
  response: ServerResponse,
  publicRoot: string,
): Promise<void> {
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(pathname); }
  catch {
    writeJson(response, 400, { error: "Malformed path encoding" });
    return;
  }
  let requested: string;
  const taskRoute = decodedPath.match(/^\/tasks\/([^/]+)\/?$/);
  if (taskRoute !== null) {
    try { assertTaskId(taskRoute[1] ?? ""); }
    catch {
      writeJson(response, 404, { error: "Not found" });
      return;
    }
    requested = "index.html";
  } else {
    requested = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  }
  const root = await realpath(publicRoot);
  const candidate = resolve(root, requested);
  if (!isSameOrWithin(root, candidate)) {
    writeJson(response, 404, { error: "Not found" });
    return;
  }
  try {
    const filePath = await realpath(candidate);
    if (!isSameOrWithin(root, filePath)) {
      writeJson(response, 404, { error: "Not found" });
      return;
    }
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "content-type": contentType(extname(filePath)),
      "content-length": info.size,
      "cache-control": "no-store",
    });
    if (headOnly) response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    writeJson(response, 404, { error: "Not found" });
  }
}

function isSameOrWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

function contentType(extension: string): string {
  switch (extension) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}
