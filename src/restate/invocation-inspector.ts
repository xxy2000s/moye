import { createHash } from "node:crypto";

export interface CoreV2SourceInvocationFact {
  readonly invocationId: string;
  readonly target: string;
  readonly status: "paused";
  readonly retryCount: number | null;
  readonly lastFailure: string | null;
  readonly lastFailureDigest: string | null;
  readonly recoveryKind: "DURABLE_RUN" | "PRE_DISPATCH_HANDLER_RETURN_MISMATCH";
  readonly commandType: "Run" | "HandlerReturn";
  readonly commandName: string;
  readonly commandIndex: number;
  readonly factDigest: string;
}

export interface FailedRecoveryInvocationFact {
  readonly invocationId: string;
  readonly target: string;
  readonly status: "completed";
  readonly output: "Failure";
  readonly factDigest: string;
}

interface QueryResponse { readonly rows?: readonly Record<string, unknown>[] }

export async function inspectCoreV2SourceInvocation(
  adminUrlInput: string,
  taskId: string,
  invocationId: string,
): Promise<CoreV2SourceInvocationFact> {
  if (!/^TASK-[A-Z0-9-]+$/.test(taskId) || !/^inv_[A-Za-z0-9]+$/.test(invocationId)) {
    throw new Error("Core v2 source Task or Invocation ID is invalid");
  }
  const target = `CoreV2Workflow/${taskId}/run`;
  const invocationRows = await query(adminUrlInput,
    `SELECT id, target, status, retry_count, last_failure, last_failure_related_command_type, last_failure_related_command_name, last_failure_related_command_index FROM sys_invocation WHERE id = '${invocationId}'`);
  const invocation = invocationRows[0];
  if (invocation === undefined || invocation["id"] !== invocationId || invocation["target"] !== target || invocation["status"] !== "paused") {
    throw new Error(`Core v2 source Invocation ${invocationId} is not the paused owning Workflow command for ${taskId}`);
  }
  const journalRows = await query(adminUrlInput,
    `SELECT index, entry_type, name FROM sys_journal WHERE id = '${invocationId}' AND entry_type LIKE 'Command:%' ORDER BY index DESC LIMIT 1`);
  const journal = journalRows[0];
  const lastFailure = stringOrNull(invocation["last_failure"]);
  const relatedIndex = numberOrNull(invocation["last_failure_related_command_index"]);
  const preDispatchMismatch = relatedIndex === 1 && lastFailure !== null
    && lastFailure.includes("[570 Journal mismatch]")
    && lastFailure.includes("'handler return' (index '1')")
    && lastFailure.includes("'call'");
  const recoveryKind = preDispatchMismatch ? "PRE_DISPATCH_HANDLER_RETURN_MISMATCH" as const : "DURABLE_RUN" as const;
  const commandName = preDispatchMismatch ? "pre-dispatch-journal-mismatch"
    : stringOrNull(invocation["last_failure_related_command_name"]) ?? stringOrNull(journal?.["name"]);
  const commandType = preDispatchMismatch ? "HandlerReturn" as const
    : stringOrNull(invocation["last_failure_related_command_type"])
      ?? stringOrNull(journal?.["entry_type"])?.replace(/^Command:\s*/, "")
      ?? "";
  const commandIndex = relatedIndex ?? numberOrNull(journal?.["index"]);
  if ((commandType !== "Run" && !preDispatchMismatch) || commandName === null || commandIndex === null) {
    throw new Error(`Core v2 source Invocation ${invocationId} is not paused on a durable Run command`);
  }
  const core = {
    invocationId,
    target,
    status: "paused" as const,
    retryCount: numberOrNull(invocation["retry_count"]),
    lastFailure,
    lastFailureDigest: lastFailure === null ? null : sha(lastFailure),
    recoveryKind,
    commandType: commandType as "Run" | "HandlerReturn",
    commandName,
    commandIndex,
  };
  return Object.freeze({ ...core, factDigest: sha(JSON.stringify(core)) });
}

export async function inspectFailedRecoveryInvocation(
  adminUrlInput: string,
  workflowRef: string,
  invocationId: string,
): Promise<FailedRecoveryInvocationFact> {
  const match = /^restate:\/\/(CoreV2FailureRecoveryWorkflow|CoreV2FailureRecoveryAttemptWorkflow)\/([A-Z0-9-]+)$/.exec(workflowRef);
  if (match === null || !/^inv_[A-Za-z0-9]+$/.test(invocationId)) throw new Error("Core v2 predecessor recovery reference is invalid");
  const target = `${match[1]}/${match[2]}/run`;
  const invocationRows = await query(adminUrlInput,
    `SELECT id, target, status FROM sys_invocation WHERE id = '${invocationId}'`);
  const invocation = invocationRows[0];
  const journalRows = await query(adminUrlInput,
    `SELECT entry_lite_json FROM sys_journal WHERE id = '${invocationId}' AND entry_type = 'Command: Output' ORDER BY index DESC LIMIT 1`);
  const output = stringOrNull(journalRows[0]?.["entry_lite_json"]);
  if (invocation?.["id"] !== invocationId || invocation["target"] !== target || invocation["status"] !== "completed" ||
      output === null || !output.includes('"result":"Failure"')) {
    throw new Error(`Core v2 predecessor ${workflowRef} is not a completed failed recovery Invocation`);
  }
  const core = { invocationId, target, status: "completed" as const, output: "Failure" as const };
  return Object.freeze({ ...core, factDigest: sha(JSON.stringify(core)) });
}

async function query(adminUrlInput: string, sql: string): Promise<readonly Record<string, unknown>[]> {
  const adminUrl = new URL("query", ensureTrailingSlash(adminUrlInput));
  const response = await fetch(adminUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`Restate invocation query failed: ${response.status} ${await response.text()}`);
  const payload = await response.json() as QueryResponse;
  if (!Array.isArray(payload.rows)) throw new Error("Restate invocation query did not return JSON rows");
  return payload.rows;
}

function ensureTrailingSlash(value: string): string { return value.endsWith("/") ? value : `${value}/`; }
function stringOrNull(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function numberOrNull(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) ? value : null; }
function sha(value: string): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
