import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import * as restate from "@restatedev/restate-sdk";

import {
  captureHistoricalRoleSessionV1,
  prepareHistoricalRoleSessionCaptureV1,
  type HistoricalSessionCaptureResultV1,
} from "../agent/session-capture-effect.js";
import type { RoleRunManifestV2 } from "../agent/role-runtime-v2.js";
import { loadConfig } from "../config.js";
import { MoyeError } from "../domain/errors.js";
import {
  claimSessionTranscriptCaptureV1,
  createHistoricalEnrichmentBaselineV1,
  createSessionEvidenceAuthorityV1,
  parseSessionEvidenceAuthorityV1,
  parseSessionTranscriptCaptureIntentV1,
  parseSessionTranscriptImportReceiptV1,
  recordSessionTranscriptReceiptV1,
  sessionEvidenceBoardSummaryV1,
  type HistoricalEnrichmentBaselineV1,
  type LegacyPromptBindingEvidenceV1,
  type SessionCapturePolicyV1,
  type SessionEvidenceAuthorityV1,
  type SessionTranscriptCaptureIntentV1,
  type SessionTranscriptImportReceiptV1,
  type SessionTranscriptManifestV1,
} from "../domain/session-transcript.js";
import { createSessionEvidenceBindingFromRoleManifestV2 } from "../domain/session-transcript.js";
import { coreV2FailureRecoveryAttemptWorkflow, coreV2FailureRecoveryWorkflow, coreV2Workflow } from "./core-v2-services.js";
import type { CoreV2WorkflowProjection } from "./core-v2-services.js";
import { taskAuthority } from "./services.js";

export interface TranscriptEnrichmentInputV1 {
  readonly enrichmentId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly managedArtifactRoot: string;
  readonly capturePolicy: SessionCapturePolicyV1;
  readonly codexSessionsRoot?: string;
  readonly claudeProjectsRoot?: string;
  readonly maxSourceBytes?: number;
  readonly promptBinding?: "PROVIDER_NATIVE_OBSERVED" | "UNVERIFIED";
  readonly legacyPromptEvidence?: LegacyPromptBindingEvidenceV1;
  readonly executorId: string;
}

export interface TranscriptEnrichmentProjectionV1 {
  readonly schemaVersion: 1;
  readonly enrichmentId: string;
  readonly workflowRef: string;
  readonly taskId: string;
  readonly runId: string;
  readonly state: "EXECUTING" | "CLOSED";
  readonly currentStep: "VERIFYING_SOURCE" | "CAPTURING" | "VERIFYING_IMMUTABILITY" | "RECORDED";
  readonly sourceWorkflowRef: string;
  readonly observedProjectionRef: string;
  readonly taskArtifactRoot: string;
  readonly managedArtifactRoot: string;
  readonly baseline?: HistoricalEnrichmentBaselineV1;
  readonly intent?: SessionTranscriptCaptureIntentV1;
  readonly receipt?: SessionTranscriptImportReceiptV1;
  readonly authorityDigest?: string;
  readonly recovery?: HistoricalSessionCaptureResultV1["recovery"];
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly outcome: "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "FAILED" | null;
  readonly error: string | null;
}

export interface HistoricalSessionEvidenceRecordV1 {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly attemptId: string;
  readonly runId: string;
  readonly taskArtifactRoot: string;
  readonly managedArtifactRoot: string;
  readonly authority: SessionEvidenceAuthorityV1;
  readonly intent: SessionTranscriptCaptureIntentV1;
  readonly receipt?: SessionTranscriptImportReceiptV1;
  readonly manifest?: SessionTranscriptManifestV1;
  readonly summary: ReturnType<typeof sessionEvidenceBoardSummaryV1>;
  readonly recordDigest: string;
}

interface RegistryCaptureV1 {
  readonly intent: SessionTranscriptCaptureIntentV1;
  readonly taskArtifactRoot: string;
  readonly managedArtifactRoot: string;
  readonly receipt?: SessionTranscriptImportReceiptV1;
  readonly manifest?: SessionTranscriptManifestV1;
}

interface SessionEvidenceRegistryRecordV1 {
  readonly authority: SessionEvidenceAuthorityV1;
  readonly captures: readonly RegistryCaptureV1[];
}

interface RegistryClaimInputV1 {
  readonly intent: SessionTranscriptCaptureIntentV1;
  readonly expectedAuthorityVersion: number;
  readonly taskArtifactRoot: string;
  readonly managedArtifactRoot: string;
}

interface RegistryRecordInputV1 {
  readonly intent: SessionTranscriptCaptureIntentV1;
  readonly receipt: SessionTranscriptImportReceiptV1;
  readonly manifest?: SessionTranscriptManifestV1;
  readonly expectedAuthorityVersion: number;
}

interface TranscriptEnrichmentWorkflowState {
  readonly projection: TranscriptEnrichmentProjectionV1;
}

interface SessionEvidenceRegistryState {
  readonly record: SessionEvidenceRegistryRecordV1;
}

export const sessionEvidenceRegistry = restate.object({
  name: "SessionEvidenceRegistry",
  handlers: {
    claim: restate.handlers.object.exclusive(
      { ingressPrivate: true },
      async (ctx: restate.ObjectContext<SessionEvidenceRegistryState>, input: RegistryClaimInputV1): Promise<HistoricalSessionEvidenceRecordV1> => {
        const intent = domainCall(() => parseSessionTranscriptCaptureIntentV1(input.intent, input.intent.intentDigest));
        if (ctx.key !== intent.binding.runId) terminal("Registry key must equal the Capture Intent runId", 409);
        const current = await ctx.get("record") as SessionEvidenceRegistryRecordV1 | null;
        const authority = current === null
          ? domainCall(() => createSessionEvidenceAuthorityV1(intent.binding))
          : domainCall(() => parseSessionEvidenceAuthorityV1(current.authority, current.authority.stateDigest));
        const claimed = domainCall(() => claimSessionTranscriptCaptureV1(authority, intent, input.expectedAuthorityVersion));
        const existing = current?.captures.find((item) => item.intent.intentDigest === intent.intentDigest);
        if (existing !== undefined && (existing.taskArtifactRoot !== input.taskArtifactRoot || existing.managedArtifactRoot !== input.managedArtifactRoot)) {
          terminal("An idempotent Capture Intent cannot change its Artifact roots", 409);
        }
        const captures = existing === undefined
          ? [...(current?.captures ?? []), { intent, taskArtifactRoot: required(input.taskArtifactRoot, "taskArtifactRoot"), managedArtifactRoot: required(input.managedArtifactRoot, "managedArtifactRoot") }]
          : current!.captures;
        const record = Object.freeze({ authority: claimed, captures: Object.freeze(captures) });
        ctx.set("record", record);
        return registryView(record);
      },
    ),
    record: restate.handlers.object.exclusive(
      { ingressPrivate: true },
      async (ctx: restate.ObjectContext<SessionEvidenceRegistryState>, input: RegistryRecordInputV1): Promise<HistoricalSessionEvidenceRecordV1> => {
        const current = await ctx.get("record") as SessionEvidenceRegistryRecordV1 | null;
        if (current === null) terminal("Session Evidence Authority has not claimed a Capture Intent", 409);
        const intent = domainCall(() => parseSessionTranscriptCaptureIntentV1(input.intent, input.intent.intentDigest));
        const receipt = domainCall(() => parseSessionTranscriptImportReceiptV1(input.receipt, input.receipt.receiptDigest));
        if (ctx.key !== intent.binding.runId) terminal("Registry key must equal the Capture Intent runId", 409);
        const capture = current!.captures.find((item) => item.intent.intentDigest === intent.intentDigest);
        if (capture === undefined) terminal("Receipt does not belong to a claimed Capture Intent", 409);
        if (capture.receipt !== undefined && capture.receipt.receiptDigest !== receipt.receiptDigest) terminal("A Capture Intent cannot record conflicting Receipts", 409);
        const authority = domainCall(() => recordSessionTranscriptReceiptV1(
          current!.authority,
          intent,
          receipt,
          input.expectedAuthorityVersion,
          input.manifest,
        ));
        const captures = current!.captures.map((item) => item.intent.intentDigest === intent.intentDigest
          ? Object.freeze({ ...item, receipt, ...(input.manifest === undefined ? {} : { manifest: input.manifest }) })
          : item);
        const record = Object.freeze({ authority, captures: Object.freeze(captures) });
        ctx.set("record", record);
        return registryView(record);
      },
    ),
    get: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext<SessionEvidenceRegistryState>): Promise<HistoricalSessionEvidenceRecordV1 | null> => {
        const record = await ctx.get("record") as SessionEvidenceRegistryRecordV1 | null;
        return record === null ? null : registryView(record);
      },
    ),
  },
});

export const transcriptEnrichmentWorkflow = restate.workflow({
  name: "TranscriptEnrichmentWorkflow",
  options: { workflowRetention: { days: 30 } },
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<TranscriptEnrichmentWorkflowState>,
      input: TranscriptEnrichmentInputV1,
    ): Promise<TranscriptEnrichmentProjectionV1> => {
      const enrichmentId = required(ctx.key, "enrichmentId");
      validateInput(input);
      if (input.enrichmentId !== enrichmentId) terminal("Workflow key must equal enrichmentId", 409);
      const workflowRef = `restate://TranscriptEnrichmentWorkflow/${enrichmentId}`;
      const sourceWorkflowRef = `restate://CoreV2Workflow/${input.taskId}`;
      const startedAt = await ctx.run("enrichment-started-at", () => Promise.resolve(new Date().toISOString()));
      const authority = await ctx.objectClient(taskAuthority, input.taskId).get();
      if (authority === null || authority.owner !== "CORE_V2_WORKFLOW") terminal("Task is not owned by CoreV2Workflow", 409);
      const observedProjectionRef = authority!.recoveryWorkflowRef ?? sourceWorkflowRef;
      const source = await readSourceProjection(ctx, input.taskId, observedProjectionRef);
      assertArchivedSource(source, input.taskId);
      const role = uniqueRoleRun(source, input.runId);
      await ctx.run("validate-enrichment-roots", async () => {
        await validateEnrichmentRoots(input, role);
        return true;
      });
      const baseline = historicalBaseline(source, observedProjectionRef, sourceWorkflowRef, role, startedAt);
      let projection: TranscriptEnrichmentProjectionV1 = {
        schemaVersion: 1,
        enrichmentId,
        workflowRef,
        taskId: input.taskId,
        runId: input.runId,
        state: "EXECUTING",
        currentStep: "CAPTURING",
        sourceWorkflowRef,
        observedProjectionRef,
        taskArtifactRoot: source.artifactRoot,
        managedArtifactRoot: input.managedArtifactRoot,
        baseline,
        startedAt,
        completedAt: null,
        outcome: null,
        error: null,
      };
      ctx.set("projection", projection);

      const existing = await ctx.objectClient(sessionEvidenceRegistry, input.runId).get();
      const captureAttempt = existing?.authority.history.length === undefined ? 1 : existing.authority.history.length + 1;
      const predecessorReceiptDigest = existing?.authority.headReceiptDigest;
      const operationTime = await ctx.run("capture-operation-time", () => Promise.resolve(new Date().toISOString()));
      const captureInput = {
        enrichmentId,
        sourceWorkflowRef,
        roleManifest: role,
        historicalBaseline: baseline,
        captureAttempt,
        ...(predecessorReceiptDigest === undefined ? {} : { predecessorReceiptDigest }),
        promptBinding: input.promptBinding ?? "UNVERIFIED" as const,
        ...(input.legacyPromptEvidence === undefined ? {} : { legacyPromptEvidence: input.legacyPromptEvidence }),
        managedArtifactRoot: input.managedArtifactRoot,
        config: {
          capturePolicy: input.capturePolicy,
          ...(input.codexSessionsRoot === undefined ? {} : { codexSessionsRoot: input.codexSessionsRoot }),
          ...(input.claudeProjectsRoot === undefined ? {} : { claudeProjectsRoot: input.claudeProjectsRoot }),
          ...(input.maxSourceBytes === undefined ? {} : { maxSourceBytes: input.maxSourceBytes }),
        },
        requestedAt: operationTime,
        capturedAt: operationTime,
        startedAt: operationTime,
        finishedAt: operationTime,
        executorId: input.executorId,
      };
      const intent = domainCall(() => prepareHistoricalRoleSessionCaptureV1(captureInput));
      const claimed = await ctx.objectClient(sessionEvidenceRegistry, input.runId).claim({
        intent,
        expectedAuthorityVersion: existing?.authority.authorityVersion ?? 0,
        taskArtifactRoot: source.artifactRoot,
        managedArtifactRoot: input.managedArtifactRoot,
      });
      projection = { ...projection, intent, authorityDigest: claimed.authority.stateDigest };
      ctx.set("projection", projection);

      const captured = await ctx.run("capture-provider-session", () => captureHistoricalRoleSessionV1({ ...captureInput, preparedIntent: intent }));
      projection = { ...projection, currentStep: "VERIFYING_IMMUTABILITY", receipt: captured.receipt, recovery: captured.recovery };
      ctx.set("projection", projection);
      const after = await readSourceProjection(ctx, input.taskId, observedProjectionRef);
      assertSameHistoricalSource(after, role, baseline);
      const recorded = await ctx.objectClient(sessionEvidenceRegistry, input.runId).record({
        intent,
        receipt: captured.receipt,
        ...(captured.manifest === undefined ? {} : { manifest: captured.manifest }),
        expectedAuthorityVersion: claimed.authority.authorityVersion,
      });
      const completedAt = await ctx.run("enrichment-completed-at", () => Promise.resolve(new Date().toISOString()));
      projection = {
        ...projection,
        state: "CLOSED",
        currentStep: "RECORDED",
        receipt: captured.receipt,
        authorityDigest: recorded.authority.stateDigest,
        completedAt,
        outcome: captured.receipt.captureState,
        error: captured.receipt.captureState === "COMPLETE" ? null : captured.receipt.errors.map((item) => item.code).join(", "),
      };
      ctx.set("projection", projection);
      return projection;
    },
    status: restate.handlers.workflow.shared(
      async (ctx: restate.WorkflowSharedContext<TranscriptEnrichmentWorkflowState>): Promise<TranscriptEnrichmentProjectionV1 | null> =>
        ctx.get("projection") as Promise<TranscriptEnrichmentProjectionV1 | null>,
    ),
  },
});

function registryView(recordInput: SessionEvidenceRegistryRecordV1): HistoricalSessionEvidenceRecordV1 {
  const authority = domainCall(() => parseSessionEvidenceAuthorityV1(recordInput.authority, recordInput.authority.stateDigest));
  const target = authority.activeIntentDigest === undefined
    ? recordInput.captures.find((item) => item.receipt?.receiptDigest === authority.headReceiptDigest)
    : recordInput.captures.find((item) => item.intent.intentDigest === authority.activeIntentDigest);
  if (target === undefined) terminal("Registry capture journal does not match Session Evidence Authority", 409);
  const core = {
    schemaVersion: 1 as const,
    taskId: authority.binding.taskId,
    attemptId: authority.binding.attemptId,
    runId: authority.binding.runId,
    taskArtifactRoot: target!.taskArtifactRoot,
    managedArtifactRoot: target!.managedArtifactRoot,
    authority,
    intent: target!.intent,
    ...(target!.receipt === undefined ? {} : { receipt: target!.receipt }),
    ...(target!.manifest === undefined ? {} : { manifest: target!.manifest }),
    summary: sessionEvidenceBoardSummaryV1(authority),
  };
  return Object.freeze({ ...core, recordDigest: digest("historical-session-evidence-record-v1", core) });
}

async function readSourceProjection(
  ctx: restate.WorkflowContext<TranscriptEnrichmentWorkflowState>,
  taskId: string,
  workflowRef: string,
): Promise<CoreV2WorkflowProjection> {
  const original = `restate://CoreV2Workflow/${taskId}`;
  let projection: CoreV2WorkflowProjection | null;
  if (workflowRef === original) projection = await ctx.workflowClient(coreV2Workflow, taskId).status();
  else {
    const root = /^restate:\/\/CoreV2FailureRecoveryWorkflow\/(.+)$/.exec(workflowRef);
    const attempt = /^restate:\/\/CoreV2FailureRecoveryAttemptWorkflow\/(.+)$/.exec(workflowRef);
    if (root !== null) projection = await ctx.workflowClient(coreV2FailureRecoveryWorkflow, root[1]!).status();
    else if (attempt !== null) projection = await ctx.workflowClient(coreV2FailureRecoveryAttemptWorkflow, attempt[1]!).status();
    else terminal("Task Authority points to an unsupported Core v2 Workflow", 409);
  }
  if (projection === null) terminal("Owning Core v2 Projection is unavailable", 404);
  return projection!;
}

function assertArchivedSource(projection: CoreV2WorkflowProjection, taskId: string): void {
  if (projection.taskId !== taskId || projection.state !== "CLOSED" || !hasOwningWorkflowArchiveProof(projection)
      || projection.outcome === null || projection.lifecycle.outcome !== projection.outcome) {
    terminal("Historical enrichment requires one archived terminal Core v2 Projection", 409);
  }
}

function hasOwningWorkflowArchiveProof(projection: CoreV2WorkflowProjection): boolean {
  if (projection.lifecycle.archive?.status === "ARCHIVED") return true;
  return projection.currentStep === "ARCHIVED" && projection.lifecycle.events.some((event) =>
    event.type === "ArchiveArchived" && event.detail === projection.taskId);
}

function uniqueRoleRun(projection: CoreV2WorkflowProjection, runId: string): RoleRunManifestV2 {
  const matches = projection.roleRuns.filter((item) => item.runId === runId);
  if (matches.length !== 1 || matches[0]!.sessionId === undefined) terminal("Historical enrichment requires one exact Role Run with a Provider Session ID", 409);
  return matches[0]!;
}

function historicalBaseline(
  projection: CoreV2WorkflowProjection,
  observedProjectionRef: string,
  sourceWorkflowRef: string,
  role: RoleRunManifestV2,
  observedAt: string,
): HistoricalEnrichmentBaselineV1 {
  if (projection.outcome === null) terminal("Historical source has no terminal outcome", 409);
  return createHistoricalEnrichmentBaselineV1({
    taskId: projection.taskId,
    sourceWorkflowRef,
    runId: role.runId,
    roleManifestDigest: role.manifestDigest,
    workflowProjectionDigest: digest(`core-v2-projection:${observedProjectionRef}`, projection),
    domainEventHistoryDigest: digest("core-v2-domain-event-history-v1", projection.lifecycle.events),
    roleManifestSnapshotDigest: digest("core-v2-role-manifest-snapshot-v1", role),
    outcome: projection.outcome,
    archiveStatus: "ARCHIVED",
    observedAt,
  });
}

function assertSameHistoricalSource(
  projection: CoreV2WorkflowProjection,
  role: RoleRunManifestV2,
  baseline: HistoricalEnrichmentBaselineV1,
): void {
  assertArchivedSource(projection, baseline.taskId);
  const currentRole = uniqueRoleRun(projection, baseline.runId);
  const expected = historicalBaseline(projection, projection.workflowRef ?? baseline.sourceWorkflowRef, baseline.sourceWorkflowRef, currentRole, baseline.observedAt);
  if (currentRole.manifestDigest !== role.manifestDigest
      || expected.workflowProjectionDigest !== baseline.workflowProjectionDigest
      || expected.domainEventHistoryDigest !== baseline.domainEventHistoryDigest
      || expected.roleManifestSnapshotDigest !== baseline.roleManifestSnapshotDigest
      || expected.outcome !== baseline.outcome) {
    terminal("Archived Core v2 source changed during historical enrichment", 409);
  }
}

function validateInput(input: TranscriptEnrichmentInputV1): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/.test(input.enrichmentId)
      || !/^TASK-[A-Z0-9-]+$/.test(input.taskId) || !/^sha256:[0-9a-f]{64}$/.test(input.runId)) {
    terminal("Historical enrichment Task, Run, or Workflow identity is invalid", 400);
  }
  required(input.managedArtifactRoot, "managedArtifactRoot");
  required(input.executorId, "executorId");
  if (!(["full", "redacted", "digest_only"] as const).includes(input.capturePolicy)) terminal("capturePolicy is invalid", 400);
  const binding = input.promptBinding ?? "UNVERIFIED";
  if ((binding === "PROVIDER_NATIVE_OBSERVED") !== (input.legacyPromptEvidence !== undefined)) terminal("Provider-observed Prompt binding requires exact legacy evidence", 400);
  if (binding === "PROVIDER_NATIVE_OBSERVED") {
    terminal("Provider-observed historical Prompt binding is disabled until the Workflow can derive all legacy evidence from managed source facts", 403);
  }
}

async function validateEnrichmentRoots(input: TranscriptEnrichmentInputV1, role: RoleRunManifestV2): Promise<void> {
  const config = loadConfig();
  const managedRoots = [...config.artifactRoots, config.liveRuntimeRoot];
  if (!(await physicalRootAllowed(input.managedArtifactRoot, managedRoots))) {
    terminal("managedArtifactRoot is outside MOYE_ARTIFACT_ROOTS/MOYE_LIVE_RUNTIME_ROOT", 403);
  }
  const source = role.runnerKind === "CODEX_EXEC" ? input.codexSessionsRoot : input.claudeProjectsRoot;
  if (source === undefined || !(await physicalRootAllowed(source, config.sessionSourceRoots))) {
    terminal("Provider Session root is outside MOYE_SESSION_SOURCE_ROOTS", 403);
  }
}

async function physicalRootAllowed(candidateInput: string, configuredRoots: readonly string[]): Promise<boolean> {
  try {
    const logicalCandidate = path.resolve(candidateInput);
    const candidateInfo = await lstat(logicalCandidate);
    if (!candidateInfo.isDirectory() || candidateInfo.isSymbolicLink()) return false;
    const candidate = await realpath(logicalCandidate);
    for (const configuredInput of configuredRoots) {
      const logicalRoot = path.resolve(configuredInput);
      if (!isSameOrWithin(logicalRoot, logicalCandidate)) continue;
      const root = await realpath(logicalRoot);
      if (isSameOrWithin(root, candidate)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isSameOrWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function required(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) terminal(`${name} is required`, 400);
  return value;
}

function terminal(message: string, errorCode: number): never {
  throw new restate.TerminalError(message, { errorCode });
}

function domainCall<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof MoyeError) terminal(error.message, error.category === "CONFLICT" ? 409 : 400);
    throw error;
  }
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(`${namespace}:${stableJson(value)}`).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
