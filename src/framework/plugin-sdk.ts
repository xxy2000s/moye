import { createHash } from "node:crypto";

export const PLUGIN_API_VERSION_V1 = 1 as const;

export const ADAPTER_KINDS_V1 = [
  "AGENT_RUNNER",
  "WORKSPACE_GIT",
  "TRUSTED_TEST",
  "DOCUMENTATION",
  "SCM",
  "ARTIFACT_STORE",
  "KNOWLEDGE_SINK",
] as const;

export type AdapterKindV1 = typeof ADAPTER_KINDS_V1[number];
export type AdapterEffectModelV1 = "NONE" | "IDEMPOTENT" | "RECONCILABLE";

export interface AdapterDescriptorV1 {
  readonly pluginApiVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly kind: AdapterKindV1;
  readonly effectModel: AdapterEffectModelV1;
  readonly capabilities: readonly string[];
}

export interface AdapterOperationContextV1 {
  readonly pluginApiVersion: 1;
  readonly taskId: string;
  readonly attemptId: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly intentDigest: string;
  readonly repositoryRoot: string;
  readonly artifactRoot: string;
}

interface AdapterResultBaseV1 {
  readonly pluginApiVersion: 1;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly intentDigest: string;
}

export interface AdapterCompleteResultV1<Result = unknown, Evidence = unknown> extends AdapterResultBaseV1 {
  readonly state: "COMPLETE";
  readonly result: Result;
  readonly evidence: Evidence;
  readonly resultDigest: string;
}

export interface AdapterUnknownResultV1 extends AdapterResultBaseV1 {
  readonly state: "UNKNOWN";
  readonly reconcileToken: string;
  readonly reason: string;
  readonly unknownDigest: string;
}

export interface AdapterFailedResultV1 extends AdapterResultBaseV1 {
  readonly state: "FAILED";
  readonly code: string;
  readonly category: "VALIDATION" | "CONFLICT" | "NOT_FOUND" | "TRANSIENT_IO" | "TERMINAL";
  readonly retryable: boolean;
  readonly message: string;
  readonly failureDigest: string;
}

export type AdapterEffectResultV1<Result = unknown, Evidence = unknown> =
  | AdapterCompleteResultV1<Result, Evidence>
  | AdapterUnknownResultV1
  | AdapterFailedResultV1;

export interface AdapterReconcileInputV1<Evidence = unknown> {
  readonly token: string;
  readonly action: "CONFIRMED" | "NOT_APPLIED";
  readonly evidence: Evidence;
  readonly evidenceDigest: string;
}

export interface PluginAdapterV1<Request = unknown, Result = unknown, Evidence = unknown> {
  readonly descriptor: AdapterDescriptorV1;
  execute(context: AdapterOperationContextV1, request: Request): Promise<AdapterEffectResultV1<Result, Evidence>>;
  reconcile?(
    context: AdapterOperationContextV1,
    unknown: AdapterUnknownResultV1,
    input: AdapterReconcileInputV1,
  ): Promise<AdapterEffectResultV1<Result, Evidence>>;
}

export interface AdapterCapabilityRequestV1 {
  readonly pluginApiVersion: 1;
  readonly kind: AdapterKindV1;
  readonly required: readonly string[];
  readonly optional?: readonly string[];
}

export interface AdapterNegotiationV1 {
  readonly accepted: boolean;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly enabled: readonly string[];
  readonly missing: readonly string[];
  readonly code: "NEGOTIATED" | "PLUGIN_API_UNSUPPORTED" | "ADAPTER_KIND_MISMATCH" | "CAPABILITY_MISSING";
}

export interface AdapterContractFindingV1 {
  readonly code: string;
  readonly message: string;
}

export interface AdapterContractReportV1 {
  readonly pluginApiVersion: 1;
  readonly adapterId: string;
  readonly adapterKind: AdapterKindV1;
  readonly passed: boolean;
  readonly checks: readonly string[];
  readonly findings: readonly AdapterContractFindingV1[];
  readonly reportDigest: string;
}

export class PluginContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PluginContractError";
  }
}

const ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_CAPABILITY_PREFIXES = ["task.", "projection.", "authority.", "workflow.", "runtime.journal", "restate."];

export function validateAdapterDescriptorV1(input: AdapterDescriptorV1): AdapterDescriptorV1 {
  if (input.pluginApiVersion !== PLUGIN_API_VERSION_V1) fail("PLUGIN_API_UNSUPPORTED", `pluginApiVersion ${String(input.pluginApiVersion)} is not supported`);
  if (!ID.test(input.id)) fail("ADAPTER_ID_INVALID", "Adapter id must be a stable lower-case identifier");
  if (!VERSION.test(input.version)) fail("ADAPTER_VERSION_INVALID", "Adapter version must be SemVer");
  if (!ADAPTER_KINDS_V1.includes(input.kind)) fail("ADAPTER_KIND_INVALID", `Unknown Adapter kind ${String(input.kind)}`);
  if (!["NONE", "IDEMPOTENT", "RECONCILABLE"].includes(input.effectModel)) fail("ADAPTER_EFFECT_MODEL_INVALID", `Unknown effect model ${String(input.effectModel)}`);
  const capabilities = uniqueSorted(input.capabilities, "capability");
  for (const capability of capabilities) {
    if (!ID.test(capability)) fail("CAPABILITY_INVALID", `Capability ${capability} is not a stable identifier`);
    if (FORBIDDEN_CAPABILITY_PREFIXES.some((prefix) => capability === prefix || capability.startsWith(prefix))) {
      fail("CAPABILITY_FORBIDDEN", `Plugin capability ${capability} would cross the Task state authority boundary`);
    }
  }
  if (input.effectModel === "RECONCILABLE" && !capabilities.includes("effect.reconcile")) {
    fail("RECONCILE_CAPABILITY_REQUIRED", "RECONCILABLE Adapter must declare effect.reconcile");
  }
  if (input.effectModel !== "RECONCILABLE" && capabilities.includes("effect.reconcile")) {
    fail("RECONCILE_CAPABILITY_INVALID", "effect.reconcile requires the RECONCILABLE effect model");
  }
  return freeze({ ...input, capabilities });
}

export function negotiateAdapterV1(descriptorInput: AdapterDescriptorV1, request: AdapterCapabilityRequestV1): AdapterNegotiationV1 {
  const descriptor = validateAdapterDescriptorV1(descriptorInput);
  const required = uniqueSorted(request.required, "required capability");
  const optional = uniqueSorted(request.optional ?? [], "optional capability");
  const base = { adapterId: descriptor.id, adapterVersion: descriptor.version, required, optional };
  if (request.pluginApiVersion !== PLUGIN_API_VERSION_V1) return freeze({ ...base, accepted: false, enabled: [], missing: required, code: "PLUGIN_API_UNSUPPORTED" });
  if (request.kind !== descriptor.kind) return freeze({ ...base, accepted: false, enabled: [], missing: required, code: "ADAPTER_KIND_MISMATCH" });
  const available = new Set(descriptor.capabilities);
  const missing = required.filter((item) => !available.has(item));
  const enabled = [...required, ...optional].filter((item, index, all) => available.has(item) && all.indexOf(item) === index).sort();
  return freeze({ ...base, accepted: missing.length === 0, enabled, missing, code: missing.length === 0 ? "NEGOTIATED" : "CAPABILITY_MISSING" });
}

export function completeAdapterResultV1<Result, Evidence>(
  contextInput: AdapterOperationContextV1,
  result: Result,
  evidence: Evidence,
): AdapterCompleteResultV1<Result, Evidence> {
  const context = validateOperationContextV1(contextInput);
  const core = effectIdentity(context);
  return freeze({ ...core, state: "COMPLETE", result, evidence, resultDigest: digest("plugin-result-v1", { ...core, result, evidence }) });
}

export function unknownAdapterResultV1(contextInput: AdapterOperationContextV1, reason: string): AdapterUnknownResultV1 {
  const context = validateOperationContextV1(contextInput);
  if (reason.trim().length === 0) fail("UNKNOWN_REASON_REQUIRED", "UNKNOWN result requires a reason");
  const core = effectIdentity(context);
  const reconcileToken = digest("plugin-reconcile-token-v1", core);
  return freeze({ ...core, state: "UNKNOWN", reconcileToken, reason: reason.trim(), unknownDigest: digest("plugin-unknown-v1", { ...core, reconcileToken, reason: reason.trim() }) });
}

export function failedAdapterResultV1(
  contextInput: AdapterOperationContextV1,
  input: Omit<AdapterFailedResultV1, keyof AdapterResultBaseV1 | "state" | "failureDigest">,
): AdapterFailedResultV1 {
  const context = validateOperationContextV1(contextInput);
  if (!ID.test(input.code.toLowerCase().replaceAll("_", "-"))) fail("FAILURE_CODE_INVALID", "Failure code must be stable");
  if (input.message.trim().length === 0) fail("FAILURE_MESSAGE_REQUIRED", "Failure message is required");
  const core = { ...effectIdentity(context), state: "FAILED" as const, ...input, message: input.message.trim() };
  return freeze({ ...core, failureDigest: digest("plugin-failure-v1", core) });
}

export function createAdapterReconcileInputV1<Evidence>(unknownInput: AdapterUnknownResultV1, input: {
  readonly action: "CONFIRMED" | "NOT_APPLIED";
  readonly evidence: Evidence;
}): AdapterReconcileInputV1<Evidence> {
  const unknown = validateAdapterEffectResultV1(unknownInput);
  if (unknown.state !== "UNKNOWN") fail("RECONCILE_UNKNOWN_REQUIRED", "Reconcile input must bind an UNKNOWN result");
  return freeze({ token: unknown.reconcileToken, action: input.action, evidence: input.evidence, evidenceDigest: digest("plugin-reconcile-evidence-v1", input.evidence) });
}

export function validateAdapterEffectResultV1<Result, Evidence>(input: AdapterEffectResultV1<Result, Evidence>): AdapterEffectResultV1<Result, Evidence> {
  const identity = validateEffectIdentity(input);
  if (input.state === "COMPLETE") {
    const expected = digest("plugin-result-v1", { ...identity, result: input.result, evidence: input.evidence });
    if (input.resultDigest !== expected) fail("RESULT_DIGEST_MISMATCH", "Adapter COMPLETE result digest does not match its content");
  } else if (input.state === "UNKNOWN") {
    const token = digest("plugin-reconcile-token-v1", identity);
    const unknownDigest = digest("plugin-unknown-v1", { ...identity, reconcileToken: token, reason: input.reason });
    if (input.reconcileToken !== token || input.unknownDigest !== unknownDigest) fail("UNKNOWN_BINDING_MISMATCH", "UNKNOWN result is not bound to its operation intent");
  } else {
    const { failureDigest: _digest, ...core } = input;
    if (input.failureDigest !== digest("plugin-failure-v1", core)) fail("FAILURE_DIGEST_MISMATCH", "Adapter FAILED result digest does not match its content");
  }
  return freeze(input);
}

export async function runAdapterContractSuiteV1<Request, Result, Evidence>(input: {
  readonly adapter: PluginAdapterV1<Request, Result, Evidence>;
  readonly context: AdapterOperationContextV1;
  readonly request: Request;
  readonly reconcile?: AdapterReconcileInputV1;
}): Promise<AdapterContractReportV1> {
  const findings: AdapterContractFindingV1[] = [];
  const checks: string[] = [];
  let descriptor: AdapterDescriptorV1;
  try {
    descriptor = validateAdapterDescriptorV1(input.adapter.descriptor);
    checks.push("descriptor");
    if (descriptor.effectModel === "RECONCILABLE" && input.adapter.reconcile === undefined) fail("RECONCILE_HANDLER_REQUIRED", "RECONCILABLE Adapter must implement reconcile");
    if (descriptor.effectModel !== "RECONCILABLE" && input.adapter.reconcile !== undefined) fail("RECONCILE_HANDLER_INVALID", "Only RECONCILABLE Adapter may expose reconcile");
    checks.push("authority-boundary", "reconcile-shape");
  } catch (error) {
    descriptor = input.adapter.descriptor;
    findings.push(finding(error));
    return contractReport(descriptor, checks, findings);
  }

  const context = validateOperationContextV1(input.context);
  try {
    const first = validateAdapterEffectResultV1(await input.adapter.execute(context, input.request));
    const second = validateAdapterEffectResultV1(await input.adapter.execute(context, input.request));
    if (canonical(first) !== canonical(second)) fail("EXECUTE_NOT_IDEMPOTENT", "Repeated execute returned conflicting result bytes");
    checks.push("execute-binding", "execute-idempotency");
    if (first.state === "UNKNOWN") {
      if (descriptor.effectModel !== "RECONCILABLE" || input.adapter.reconcile === undefined) fail("UNKNOWN_WITHOUT_RECONCILE", "UNKNOWN result requires a RECONCILABLE Adapter");
      if (input.reconcile === undefined) fail("RECONCILE_CASE_REQUIRED", "Contract case must provide evidence for an UNKNOWN result");
      if (input.reconcile.token !== first.reconcileToken) fail("RECONCILE_TOKEN_MISMATCH", "Reconcile evidence token does not bind the UNKNOWN result");
      if (input.reconcile.evidenceDigest !== digest("plugin-reconcile-evidence-v1", input.reconcile.evidence)) fail("RECONCILE_EVIDENCE_DIGEST_MISMATCH", "Reconcile evidence digest does not match its bytes");
      const resolved = validateAdapterEffectResultV1(await input.adapter.reconcile(context, first, input.reconcile));
      const replayed = validateAdapterEffectResultV1(await input.adapter.reconcile(context, first, input.reconcile));
      if (resolved.state === "UNKNOWN") fail("RECONCILE_STILL_UNKNOWN", "Reconcile must resolve to COMPLETE or FAILED");
      if (canonical(resolved) !== canonical(replayed)) fail("RECONCILE_NOT_IDEMPOTENT", "Repeated reconcile returned conflicting result bytes");
      checks.push("unknown-binding", "reconcile-evidence", "reconcile-idempotency");
    }
  } catch (error) {
    findings.push(finding(error));
  }
  return contractReport(descriptor, checks, findings);
}

export function validateOperationContextV1(input: AdapterOperationContextV1): AdapterOperationContextV1 {
  if (input.pluginApiVersion !== 1) fail("PLUGIN_API_UNSUPPORTED", "Operation context must use pluginApiVersion 1");
  for (const [field, value] of Object.entries({ taskId: input.taskId, attemptId: input.attemptId, operationId: input.operationId, idempotencyKey: input.idempotencyKey })) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) fail("OPERATION_IDENTITY_INVALID", `${field} must be a non-empty bounded string`);
  }
  if (!DIGEST.test(input.intentDigest)) fail("INTENT_DIGEST_INVALID", "intentDigest must be sha256");
  if (!input.repositoryRoot.startsWith("/") || !input.artifactRoot.startsWith("/")) fail("OPERATION_PATH_INVALID", "repositoryRoot and artifactRoot must be absolute");
  return freeze({ ...input });
}

function validateEffectIdentity(input: AdapterResultBaseV1): AdapterResultBaseV1 {
  return effectIdentity(validateOperationContextV1({
    pluginApiVersion: input.pluginApiVersion,
    taskId: "effect-result-validation",
    attemptId: "effect-result-validation",
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    intentDigest: input.intentDigest,
    repositoryRoot: "/effect-result-validation",
    artifactRoot: "/effect-result-validation-artifacts",
  }));
}

function effectIdentity(context: AdapterOperationContextV1): AdapterResultBaseV1 {
  return { pluginApiVersion: 1, operationId: context.operationId, idempotencyKey: context.idempotencyKey, intentDigest: context.intentDigest };
}

function contractReport(descriptor: AdapterDescriptorV1, checks: readonly string[], findings: readonly AdapterContractFindingV1[]): AdapterContractReportV1 {
  const core = { pluginApiVersion: 1 as const, adapterId: descriptor.id, adapterKind: descriptor.kind, passed: findings.length === 0, checks: [...checks], findings: [...findings] };
  return freeze({ ...core, reportDigest: digest("plugin-contract-report-v1", core) });
}

function finding(error: unknown): AdapterContractFindingV1 {
  return error instanceof PluginContractError ? { code: error.code, message: error.message } : { code: "CONTRACT_EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) };
}

function uniqueSorted(input: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(input)) fail("CAPABILITY_LIST_INVALID", `${label} list is required`);
  const result = [...new Set(input.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) fail("CAPABILITY_INVALID", `${label} must be a non-empty string`);
    return item.trim();
  }))].sort();
  return freeze(result);
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(`${namespace}\0${canonical(value)}`).digest("hex")}`;
}

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
  }
  return value;
}

function fail(code: string, message: string): never {
  throw new PluginContractError(code, message);
}
