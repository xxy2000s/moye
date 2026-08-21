import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";

import type { BacklogProjection } from "../domain/backlog.js";
import type { ProjectBoardSnapshot } from "../domain/board.js";
import { assertTaskId, type TaskProjection } from "../domain/task.js";
import { invoke, send } from "../restate/ingress.js";
import type { TaskWorkflowInput } from "../restate/services.js";
import type { TaskAuthorityState } from "../restate/services.js";
import type { CodingWorkflowProjection } from "../coding/workflow.js";
import { buildCodingTaskTrace } from "../trace/coding-trace.js";
import type { MoyeConfig } from "../config.js";
import type { AgentArtifactFile } from "../agent/runner.js";

export interface BoardServerOptions {
  readonly port: number;
  readonly projectId: string;
  readonly ingressUrl: string;
  readonly restateAdminUrl: string;
  readonly publicRoot: string;
  readonly artifactRoots?: readonly string[];
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
    const artifactKind = segments.length === 3 && segments[1] === "artifacts"
      ? readArtifactKind(segments[2])
      : undefined;
    if (segments.length > 1 && !traceRequest && artifactKind === undefined) {
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
      if (authority.owner !== "CODING_WORKFLOW") {
        writeJson(response, 409, { error: "Detailed coding trace is not available for this Task workflow" });
        return;
      }
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
    const projection = authority.owner === "CODING_WORKFLOW"
      ? await invoke<CodingWorkflowProjection | null>(options.ingressUrl, "CodingTaskWorkflow", taskId, "status")
      : await invoke<TaskProjection | null>(options.ingressUrl, "TaskWorkflow", taskId, "status");
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
    const input = await readJson<TaskWorkflowInput>(request);
    if (input.projectId !== options.projectId) {
      writeJson(response, 400, { error: `projectId must be ${options.projectId}` });
      return;
    }
    const receipt = await send(
      options.ingressUrl,
      "TaskWorkflow",
      input.taskId,
      "run",
      input,
    );
    writeJson(response, 202, receipt);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    writeJson(response, 405, { error: "Method not allowed" });
    return;
  }

  await serveStatic(url.pathname, method === "HEAD", response, options.publicRoot);
}

type DownloadableArtifactKind = "agent-events" | "raw-model-io";

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
  const requested = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
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
