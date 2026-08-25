import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { inspectCoreV2SourceInvocation, inspectFailedRecoveryInvocation } from "../../src/restate/invocation-inspector.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Core v2 source Invocation inspector", () => {
  it("binds a paused owning Workflow to its last durable Run command", async () => {
    const adminUrl = await fakeAdmin("paused");
    const fact = await inspectCoreV2SourceInvocation(adminUrl, "TASK-STALLED-1", "inv_source1");
    expect(fact).toMatchObject({
      invocationId: "inv_source1",
      target: "CoreV2Workflow/TASK-STALLED-1/run",
      status: "paused",
      recoveryKind: "DURABLE_RUN",
      commandType: "Run",
      commandName: "git-checkpoint-g1",
      commandIndex: 64,
    });
    expect(fact.factDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fact.lastFailureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("accepts only the observed index-one HandlerReturn journal mismatch as a recovery fact", async () => {
    const adminUrl = await mismatchAdmin("paused", journalMismatch());
    const fact = await inspectCoreV2SourceInvocation(adminUrl, "TASK-STALLED-1", "inv_source1");
    expect(fact).toMatchObject({
      status: "paused",
      recoveryKind: "PRE_DISPATCH_HANDLER_RETURN_MISMATCH",
      commandType: "HandlerReturn",
      commandName: "pre-dispatch-journal-mismatch",
      commandIndex: 1,
    });
    expect(fact.lastFailureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects a generic index-one failure that is not the exact Restate journal mismatch", async () => {
    const adminUrl = await mismatchAdmin("paused", "handler returned at index 1");
    await expect(inspectCoreV2SourceInvocation(adminUrl, "TASK-STALLED-1", "inv_source1"))
      .rejects.toThrow(/not paused on a durable Run command/);
  });

  it("rejects an invocation that can still execute", async () => {
    const adminUrl = await fakeAdmin("backing-off");
    await expect(inspectCoreV2SourceInvocation(adminUrl, "TASK-STALLED-1", "inv_source1"))
      .rejects.toThrow(/not the paused owning Workflow/);
  });

  it("binds a completed failed recovery before authorizing a numbered successor", async () => {
    const adminUrl = await failedRecoveryAdmin('CoreV2FailureRecoveryWorkflow/TASK-STALLED-1/run', 'completed', '{"result":"Failure"}');
    const fact = await inspectFailedRecoveryInvocation(
      adminUrl,
      "restate://CoreV2FailureRecoveryWorkflow/TASK-STALLED-1",
      "inv_recovery1",
    );
    expect(fact).toMatchObject({
      invocationId: "inv_recovery1",
      target: "CoreV2FailureRecoveryWorkflow/TASK-STALLED-1/run",
      status: "completed",
      output: "Failure",
    });
    expect(fact.factDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects a predecessor without a durable Failure output", async () => {
    const adminUrl = await failedRecoveryAdmin('CoreV2FailureRecoveryWorkflow/TASK-STALLED-1/run', 'completed', '{"result":"Success"}');
    await expect(inspectFailedRecoveryInvocation(
      adminUrl,
      "restate://CoreV2FailureRecoveryWorkflow/TASK-STALLED-1",
      "inv_recovery1",
    )).rejects.toThrow(/not a completed failed recovery/);
  });
});

async function failedRecoveryAdmin(target: string, status: string, output: string): Promise<string> {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const sql = (JSON.parse(body) as { query: string }).query;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ rows: sql.includes("FROM sys_invocation")
      ? [{ id: "inv_recovery1", target, status }]
      : [{ entry_lite_json: output }] }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake admin did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
}

async function fakeAdmin(status: string): Promise<string> {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const sql = (JSON.parse(body) as { query: string }).query;
    response.setHeader("content-type", "application/json");
    if (sql.includes("FROM sys_invocation")) {
      response.end(JSON.stringify({ rows: [{
        id: "inv_source1", target: "CoreV2Workflow/TASK-STALLED-1/run", status, retry_count: 5,
        last_failure: "Implementation produced no repository changes", last_failure_related_command_type: "Run",
        last_failure_related_command_name: "git-checkpoint-g1", last_failure_related_command_index: 64,
      }] }));
    } else {
      response.end(JSON.stringify({ rows: [{ index: 64, entry_type: "Command: Run", name: "git-checkpoint-g1" }] }));
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake admin did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
}

async function mismatchAdmin(status: string, lastFailure: string): Promise<string> {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const sql = (JSON.parse(body) as { query: string }).query;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ rows: sql.includes("FROM sys_invocation") ? [{
      id: "inv_source1", target: "CoreV2Workflow/TASK-STALLED-1/run", status, retry_count: 12,
      last_failure: lastFailure, last_failure_related_command_index: 1,
    }] : [{ index: 289, entry_type: "Command: Call", name: "ProjectBoard/moye/upsertTask" }] }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake admin did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
}

function journalMismatch(): string {
  return "[570 Journal mismatch] Found a mismatch between the code paths taken during the previous execution and the paths taken during this execution.\n - The previous execution ran and recorded the following: 'handler return' (index '1')\n - The current execution attempts to perform the following: 'call'";
}
