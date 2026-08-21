import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import type { CodingWorkflowProjection } from "../../src/coding/workflow.js";
import {
  buildCodingTraceBatch,
  NoopTraceSink,
  normalizeOtlpTracesEndpoint,
  OtlpHttpTraceSink,
  spanIdForAgentRun,
  spanIdForAttempt,
  traceIdForTask,
  traceparentForAgent,
} from "../../src/trace/telemetry.js";

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("lightweight OTLP trace sink", () => {
  it("builds stable Attempt/Agent spans without making Trace a state authority", () => {
    const batch = buildCodingTraceBatch(projection(), { serviceName: "moye-test", projectName: "task-demo" });
    expect(batch.traceId).toBe(traceIdForTask("TASK-OTLP-UNIT"));
    expect(batch.spans.map((span) => span.name)).toEqual(["moye.attempt", "moye.agent.run", "moye.task.snapshot"]);
    expect(batch.spans[0]).toMatchObject({
      spanId: spanIdForAttempt("TASK-OTLP-UNIT/IMPLEMENT/attempt-001"),
      status: "OK",
      attributes: {
        "task.id": "TASK-OTLP-UNIT",
        "step.id": "IMPLEMENT",
        "attempt.id": "TASK-OTLP-UNIT/IMPLEMENT/attempt-001",
      },
    });
    expect(batch.spans[1]).toMatchObject({
      spanId: spanIdForAgentRun("agent-run:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      parentSpanId: batch.spans[0]?.spanId,
      attributes: { "agent.runtime": "codex-cli", "agent.session.id": "codex-session" },
    });
    expect(traceparentForAgent("TASK-OTLP-UNIT", "agent-run:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(Object.isFrozen(batch.spans)).toBe(true);
  });

  it("exports standard OTLP/protobuf with Phoenix project routing", async () => {
    const requests: Array<{ headers: IncomingHttpHeaders; path?: string; body: Buffer }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      requests.push({ headers: request.headers, ...(request.url === undefined ? {} : { path: request.url }), body: Buffer.concat(chunks) });
      response.writeHead(200, { "content-type": "application/x-protobuf" });
      response.end();
    });
    server.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("OTLP receiver failed to bind");
    const batch = buildCodingTraceBatch(projection(), { serviceName: "moye-test", projectName: "task-demo" });
    const receipt = await new OtlpHttpTraceSink({ endpoint: `http://127.0.0.1:${address.port}` }).export(batch);

    expect(receipt).toEqual({ provider: "otlp", traceId: batch.traceId, spanCount: 3, exported: true });
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.path === "/v1/traces")).toBe(true);
    expect(requests.every((request) => request.headers["content-type"] === "application/x-protobuf")).toBe(true);
    expect(requests.every((request) => request.headers["x-project-name"] === "task-demo")).toBe(true);
    const payload = Buffer.concat(requests.map((request) => request.body));
    expect(payload.includes(Buffer.from(batch.traceId, "hex"))).toBe(true);
    expect(payload.includes(Buffer.from("moye.agent.run"))).toBe(true);
    expect(payload.includes(Buffer.from("TASK-OTLP-UNIT"))).toBe(true);
  });

  it("uses a true Noop by default and validates endpoint schemes", async () => {
    const batch = buildCodingTraceBatch(projection(), { serviceName: "moye-test", projectName: "task-demo" });
    await expect(new NoopTraceSink().export(batch)).resolves.toEqual({
      provider: "noop", traceId: batch.traceId, spanCount: 3, exported: false,
    });
    expect(normalizeOtlpTracesEndpoint("http://localhost:6006")).toBe("http://localhost:6006/v1/traces");
    expect(() => normalizeOtlpTracesEndpoint("file:///tmp/traces")).toThrow(/http or https/);
  });
});

function projection(): CodingWorkflowProjection {
  const runId = "agent-run:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const artifact = (name: string) => ({
    artifactRef: `agent-artifact://${runId}/${name}`,
    contentDigest: `sha256:${"b".repeat(64)}`,
    bytes: 1,
  });
  return {
    taskId: "TASK-OTLP-UNIT",
    specRevision: 1,
    envelopeDigest: `sha256:${"c".repeat(64)}`,
    state: "CLOSED",
    currentStep: "ARCHIVE",
    outcome: "SUCCEEDED",
    archiveStatus: "ARCHIVED",
    events: [{ sequence: 1, type: "WORKFLOW_ARCHIVED", step: "ARCHIVE", at: "2026-08-21T00:00:03.000Z" }],
    steps: [],
    attempts: [{
      attemptId: "TASK-OTLP-UNIT/IMPLEMENT/attempt-001",
      taskId: "TASK-OTLP-UNIT",
      stepId: "IMPLEMENT",
      generation: 1,
      specRevision: 1,
      envelopeDigest: `sha256:${"c".repeat(64)}`,
      status: "SUCCEEDED",
      scheduledAt: "2026-08-21T00:00:00.000Z",
      startedAt: "2026-08-21T00:00:00.100Z",
      finishedAt: "2026-08-21T00:00:02.000Z",
      evidenceRecords: [],
      attemptDigest: "attempt:unit",
    }],
    evidenceBindings: [],
    agent: {
      schemaVersion: 1,
      runId,
      runnerKind: "CODEX_EXEC",
      taskId: "TASK-OTLP-UNIT",
      specRevision: 1,
      stepId: "IMPLEMENT",
      attemptId: "TASK-OTLP-UNIT/IMPLEMENT/attempt-001",
      sessionId: "codex-session",
      outcome: "SUCCEEDED",
      exitCode: 0,
      signal: null,
      startedAt: "2026-08-21T00:00:00.200Z",
      finishedAt: "2026-08-21T00:00:01.900Z",
      durationMs: 1700,
      finalMessage: "done",
      artifacts: { events: artifact("events.jsonl"), stderr: artifact("stderr.log"), finalMessage: artifact("final-message.txt") },
      runDigest: "agent-result:unit",
    },
  };
}
