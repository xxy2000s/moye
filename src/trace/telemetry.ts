import { createHash } from "node:crypto";

import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type SpanContext,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type IdGenerator,
} from "@opentelemetry/sdk-trace-base";

import type { CodingWorkflowProjection } from "../coding/workflow.js";

export type TraceAttribute = string | number | boolean;

export interface MoyeTraceSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: "UNSET" | "OK" | "ERROR";
  readonly attributes: Readonly<Record<string, TraceAttribute>>;
}

export interface MoyeTraceBatch {
  readonly taskId: string;
  readonly traceId: string;
  readonly serviceName: string;
  readonly projectName: string;
  readonly spans: readonly MoyeTraceSpan[];
}

export interface TraceExportReceipt {
  readonly provider: "noop" | "otlp";
  readonly traceId: string;
  readonly spanCount: number;
  readonly exported: boolean;
}

export interface TraceSink {
  export(batch: MoyeTraceBatch): Promise<TraceExportReceipt>;
}

export interface OtlpHttpTraceSinkOptions {
  readonly endpoint: string;
  readonly timeoutMs?: number;
}

export class NoopTraceSink implements TraceSink {
  async export(batch: MoyeTraceBatch): Promise<TraceExportReceipt> {
    return Object.freeze({
      provider: "noop",
      traceId: batch.traceId,
      spanCount: batch.spans.length,
      exported: false,
    });
  }
}

export class OtlpHttpTraceSink implements TraceSink {
  readonly #endpoint: string;
  readonly #timeoutMs: number;

  constructor(options: OtlpHttpTraceSinkOptions) {
    this.#endpoint = normalizeOtlpTracesEndpoint(options.endpoint);
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new Error("OTLP timeoutMs must be a positive integer");
    }
  }

  async export(batch: MoyeTraceBatch): Promise<TraceExportReceipt> {
    validateBatch(batch);
    const idGenerator = new PlannedIdGenerator(batch.spans);
    const exporter = new OTLPTraceExporter({
      url: this.#endpoint,
      timeoutMillis: this.#timeoutMs,
      headers: { "x-project-name": batch.projectName },
    });
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        "service.name": batch.serviceName,
        "service.namespace": "moye",
        "openinference.project.name": batch.projectName,
      }),
      idGenerator,
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const tracer = provider.getTracer("moye.trace-sink", "1.0.0");
    try {
      for (const planned of batch.spans) {
        const parent = planned.parentSpanId === undefined
          ? ROOT_CONTEXT
          : trace.setSpanContext(ROOT_CONTEXT, spanContext(planned.traceId, planned.parentSpanId));
        const span = tracer.startSpan(planned.name, {
          kind: SpanKind.INTERNAL,
          startTime: new Date(planned.startedAt),
          attributes: planned.attributes as Attributes,
        }, parent);
        span.setStatus({ code: statusCode(planned.status) });
        span.end(new Date(planned.finishedAt));
      }
      await provider.forceFlush();
      return Object.freeze({
        provider: "otlp",
        traceId: batch.traceId,
        spanCount: batch.spans.length,
        exported: true,
      });
    } finally {
      await provider.shutdown();
    }
  }
}

export function createTraceSink(options: { readonly enabled: boolean; readonly endpoint: string }): TraceSink {
  return options.enabled ? new OtlpHttpTraceSink({ endpoint: options.endpoint }) : new NoopTraceSink();
}

export function buildCodingTraceBatch(
  projection: CodingWorkflowProjection,
  options: { readonly serviceName: string; readonly projectName: string },
): MoyeTraceBatch {
  const traceId = traceIdForTask(projection.taskId);
  const workflowId = `CodingTaskWorkflow/${projection.taskId}`;
  const spans: MoyeTraceSpan[] = [];

  for (const attempt of projection.attempts) {
    if (attempt.startedAt === undefined) continue;
    const finishedAt = attempt.finishedAt ?? projection.events.at(-1)?.at ?? attempt.startedAt;
    const spanId = spanIdForAttempt(attempt.attemptId);
    spans.push(Object.freeze({
      name: "moye.attempt",
      traceId,
      spanId,
      startedAt: attempt.startedAt,
      finishedAt,
      status: attempt.status === "SUCCEEDED" ? "OK" : attempt.status === "RUNNING" ? "UNSET" : "ERROR",
      attributes: Object.freeze({
        "task.id": projection.taskId,
        "workflow.id": workflowId,
        "step.id": attempt.stepId,
        "attempt.id": attempt.attemptId,
        "attempt.generation": attempt.generation,
        "task.spec_revision": projection.specRevision,
        "moye.attempt.status": attempt.status,
        "openinference.span.kind": "CHAIN",
        ...(attempt.error === undefined ? {} : { "error.message": attempt.error }),
      }),
    }));
  }

  if (projection.agent !== undefined) {
    spans.push(Object.freeze({
      name: "moye.agent.run",
      traceId,
      spanId: spanIdForAgentRun(projection.agent.runId),
      parentSpanId: spanIdForAttempt(projection.agent.attemptId),
      startedAt: projection.agent.startedAt,
      finishedAt: projection.agent.finishedAt,
      status: projection.agent.outcome === "SUCCEEDED" ? "OK" : "ERROR",
      attributes: Object.freeze({
        "task.id": projection.taskId,
        "workflow.id": workflowId,
        "step.id": projection.agent.stepId,
        "attempt.id": projection.agent.attemptId,
        "agent.run.id": projection.agent.runId,
        "agent.runtime": runtimeName(projection.agent.runnerKind),
        "agent.outcome": projection.agent.outcome,
        "agent.exit_code": projection.agent.exitCode ?? -1,
        "openinference.span.kind": "AGENT",
        ...(projection.agent.sessionId === undefined ? {} : { "agent.session.id": projection.agent.sessionId }),
      }),
    }));
  }

  const observedAt = projection.events.at(-1)?.at
    ?? projection.agent?.finishedAt
    ?? new Date(0).toISOString();
  spans.push(Object.freeze({
    name: "moye.task.snapshot",
    traceId,
    spanId: stableHexId("task-snapshot", projection.taskId, 16),
    startedAt: observedAt,
    finishedAt: observedAt,
    status: projection.state === "FAILED" ? "ERROR" : projection.state === "CLOSED" ? "OK" : "UNSET",
    attributes: Object.freeze({
      "task.id": projection.taskId,
      "workflow.id": workflowId,
      "task.state": projection.state,
      "task.current_step": projection.currentStep,
      "task.archive_status": projection.archiveStatus,
      "task.spec_revision": projection.specRevision,
      "openinference.span.kind": "CHAIN",
      ...(projection.outcome === undefined ? {} : { "task.outcome": projection.outcome }),
      ...(projection.errorCode === undefined ? {} : { "error.type": projection.errorCode }),
      ...(projection.error === undefined ? {} : { "error.message": projection.error }),
    }),
  }));

  return deepFreeze({
    taskId: projection.taskId,
    traceId,
    serviceName: options.serviceName,
    projectName: options.projectName,
    spans,
  });
}

export function traceIdForTask(taskId: string): string {
  return stableHexId("task-trace", taskId, 32);
}

export function spanIdForAttempt(attemptId: string): string {
  return stableHexId("attempt-span", attemptId, 16);
}

export function spanIdForAgentRun(runId: string): string {
  return stableHexId("agent-span", runId, 16);
}

export function traceparentForAgent(taskId: string, runId: string): string {
  return `00-${traceIdForTask(taskId)}-${spanIdForAgentRun(runId)}-01`;
}

export function normalizeOtlpTracesEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OTLP traces endpoint must use http or https");
  }
  if (url.username || url.password || url.hash) throw new Error("OTLP traces endpoint cannot contain credentials or a fragment");
  url.pathname = url.pathname.replace(/\/$/, "");
  if (!url.pathname.endsWith("/v1/traces")) url.pathname = `${url.pathname}/v1/traces`.replace(/\/+/g, "/");
  return url.toString();
}

function runtimeName(kind: string): string {
  if (kind === "CODEX_EXEC") return "codex-cli";
  if (kind === "CLAUDE_PRINT") return "claude-cli";
  return "fake-agent";
}

function spanContext(traceId: string, spanId: string): SpanContext {
  return { traceId, spanId, traceFlags: 1, isRemote: false };
}

function statusCode(status: MoyeTraceSpan["status"]): SpanStatusCode {
  if (status === "OK") return SpanStatusCode.OK;
  if (status === "ERROR") return SpanStatusCode.ERROR;
  return SpanStatusCode.UNSET;
}

class PlannedIdGenerator implements IdGenerator {
  readonly #traceIds: string[];
  readonly #spanIds: string[];

  constructor(spans: readonly MoyeTraceSpan[]) {
    this.#traceIds = spans.filter((span) => span.parentSpanId === undefined).map((span) => span.traceId);
    this.#spanIds = spans.map((span) => span.spanId);
  }

  generateTraceId(): string {
    const value = this.#traceIds.shift();
    if (value === undefined) throw new Error("Trace exporter requested an unexpected Trace ID");
    return value;
  }

  generateSpanId(): string {
    const value = this.#spanIds.shift();
    if (value === undefined) throw new Error("Trace exporter requested an unexpected Span ID");
    return value;
  }
}

function validateBatch(batch: MoyeTraceBatch): void {
  if (!batch.taskId || !batch.serviceName || !batch.projectName || batch.spans.length === 0) {
    throw new Error("Trace batch must include task, service, project and at least one Span");
  }
  if (!/^[0-9a-f]{32}$/.test(batch.traceId) || /^0+$/.test(batch.traceId)) throw new Error("Invalid Trace ID");
  for (const span of batch.spans) {
    if (span.traceId !== batch.traceId || !/^[0-9a-f]{16}$/.test(span.spanId) || /^0+$/.test(span.spanId)) {
      throw new Error("Trace Span contains an invalid or mismatched ID");
    }
    if (span.parentSpanId !== undefined && !/^[0-9a-f]{16}$/.test(span.parentSpanId)) {
      throw new Error("Trace Span contains an invalid parent ID");
    }
    if (Date.parse(span.finishedAt) < Date.parse(span.startedAt)) throw new Error("Trace Span finishes before it starts");
  }
}

function stableHexId(namespace: string, value: string, length: 16 | 32): string {
  const id = createHash("sha256").update(`${namespace}\0${value}`).digest("hex").slice(0, length);
  return /^0+$/.test(id) ? `${"0".repeat(length - 1)}1` : id;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
