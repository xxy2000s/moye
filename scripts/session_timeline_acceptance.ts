import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const boardUrl = process.env["MOYE_SESSION_API_ACCEPTANCE_BOARD"] ?? "http://127.0.0.1:3000";
const taskId = process.env["MOYE_SESSION_API_ACCEPTANCE_TASK"];
const outputPath = process.env["MOYE_SESSION_API_ACCEPTANCE_OUTPUT"];

if (taskId === undefined || !/^TASK-[A-Z0-9-]+$/.test(taskId)) {
  throw new Error("MOYE_SESSION_API_ACCEPTANCE_TASK must name an existing real Core v2 Task");
}

interface TraceRole {
  readonly runId: string;
  readonly attemptId: string;
  readonly sessionUrl?: string;
  readonly timelineUrl?: string;
  readonly stderrUrl?: string;
  readonly eventsUrl: string;
}

const trace = await json<{ readonly traceKind: string; readonly task: { readonly state: string }; readonly roles: readonly TraceRole[] }>(
  `/api/tasks/${encodeURIComponent(taskId)}/trace`,
);
assert(trace.traceKind === "CORE_V2", "Task is not a Core v2 Runtime Task");
assert(trace.roles.length > 0, "Task has no real Role Runs");

const roles = [];
for (const role of trace.roles) {
  assert(role.sessionUrl !== undefined && role.timelineUrl !== undefined && role.stderrUrl !== undefined, `Role ${role.runId} has no Session API links`);
  const metadata = await json<{
    readonly state: string;
    readonly provider: string;
    readonly providerSessionId: string;
    readonly manifestDigest: string;
    readonly artifacts: Record<string, unknown>;
  }>(role.sessionUrl);
  assert(metadata.state === "COMPLETE" || metadata.state === "PARTIAL", `Role ${role.runId} Session is ${metadata.state}`);
  assert(metadata.provider === "CODEX" || metadata.provider === "CLAUDE", `Role ${role.runId} Provider is invalid`);
  assert(metadata.artifacts["normalized"] !== undefined && metadata.artifacts["stderr"] !== undefined, `Role ${role.runId} managed Artifact metadata is incomplete`);

  let cursor = 0;
  let total = -1;
  const eventIds = new Set<string>();
  const categories = new Set<string>();
  do {
    const separator = role.timelineUrl.includes("?") ? "&" : "?";
    const page = await json<{
      readonly state: string;
      readonly cursor: number;
      readonly nextCursor: number;
      readonly total: number;
      readonly hasMore: boolean;
      readonly completed: boolean;
      readonly events: readonly { readonly schemaVersion: number; readonly eventId: string; readonly category: string; readonly eventDigest: string }[];
    }>(`${role.timelineUrl}${separator}cursor=${cursor}&limit=7`);
    assert(page.cursor === cursor && page.nextCursor === cursor + page.events.length, `Role ${role.runId} cursor is not deterministic`);
    assert(page.completed === true, `Role ${role.runId} immutable Transcript is not marked complete`);
    total = page.total;
    for (const event of page.events) {
      assert(event.schemaVersion === 1 && event.eventDigest.startsWith("sha256:"), `Role ${role.runId} returned a non-canonical event`);
      assert(!eventIds.has(event.eventId), `Role ${role.runId} returned duplicate event ${event.eventId}`);
      eventIds.add(event.eventId);
      categories.add(event.category);
    }
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  } while (true);
  assert(eventIds.size === total, `Role ${role.runId} pagination lost or duplicated events`);
  assert(categories.has("PROMPT"), `Role ${role.runId} canonical Timeline has no Prompt evidence`);

  const execution = await json<{ readonly events: readonly { readonly raw?: string }[] }>(`${role.eventsUrl}?cursor=0&limit=1`);
  assert(execution.events.length > 0 && typeof execution.events[0]?.raw === "string", `Role ${role.runId} execution stream is not independently readable`);
  const stderr = await json<{ readonly digest: string; readonly byteLength: number; readonly content: string }>(role.stderrUrl);
  assert(stderr.digest.startsWith("sha256:") && Buffer.byteLength(stderr.content) === stderr.byteLength, `Role ${role.runId} stderr verification failed`);
  roles.push({
    runId: role.runId,
    attemptId: role.attemptId,
    provider: metadata.provider,
    providerSessionId: metadata.providerSessionId,
    state: metadata.state,
    manifestDigest: metadata.manifestDigest,
    normalizedEvents: eventIds.size,
    categories: [...categories].sort(),
    stderrDigest: stderr.digest,
  });
}

const report = {
  schemaVersion: 1,
  acceptanceKind: "REAL_CORE_V2_SESSION_TIMELINE_BOARD_API",
  executedAt: new Date().toISOString(),
  taskId,
  taskState: trace.task.state,
  boardUrl,
  roleCount: roles.length,
  roles,
};
const reportContent = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath !== undefined) {
  const absolute = path.resolve(outputPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, reportContent, { flag: "wx" });
}
process.stdout.write(reportContent);

async function json<T>(relativeUrl: string): Promise<T> {
  const url = new URL(relativeUrl, boardUrl);
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) throw new Error(`${url.pathname} returned ${response.status}: ${body}`);
  return JSON.parse(body) as T;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
