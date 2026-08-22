import type { AgentArtifactFile } from "../agent/runner.js";
import type { CodingPipelineStepId, StepAttempt } from "../domain/coding-task.js";
import type { CodingWorkflowProjection } from "../coding/workflow.js";
import { traceIdForTask } from "./telemetry.js";
import { buildCodingStateMachine, type TaskStateMachineTrace } from "./state-machine.js";

export type RecoveryClassification = "NONE" | "WAIT_OR_RECONCILE" | "FAILED_TERMINAL" | "ARCHIVE_RETRY";

export interface RecoveryAction {
  readonly code: string;
  readonly label: string;
  readonly reason: string;
  readonly automatic: boolean;
}

export interface CodingTaskTrace {
  readonly schemaVersion: 1;
  readonly traceKind: "CODING";
  readonly task: {
    readonly taskId: string;
    readonly specRevision: number;
    readonly state: CodingWorkflowProjection["state"];
    readonly currentStep: CodingWorkflowProjection["currentStep"];
    readonly outcome?: CodingWorkflowProjection["outcome"];
    readonly archiveStatus: CodingWorkflowProjection["archiveStatus"];
    readonly error?: string;
    readonly errorCode?: string;
    readonly errorCategory?: CodingWorkflowProjection["errorCategory"];
  };
  readonly business: {
    readonly authority: "CodingTaskWorkflow projection";
    readonly events: CodingWorkflowProjection["events"];
    readonly steps: readonly {
      readonly stepId: CodingPipelineStepId | "REVIEW";
      readonly sequence: number;
      readonly status: StepAttempt["status"] | "NOT_STARTED";
      readonly attemptIds: readonly string[];
    }[];
    readonly attempts: CodingWorkflowProjection["attempts"];
    readonly evidenceBindings: CodingWorkflowProjection["evidenceBindings"];
  };
  readonly agent?: {
    readonly runId: string;
    readonly sessionId?: string;
    readonly runnerKind: string;
    readonly outcome: string;
    readonly attemptId: string;
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly runDigest?: string;
  };
  readonly agentEvents?: {
    readonly viewUrl: string;
    readonly downloadUrl?: string;
    readonly completed: boolean;
  };
  readonly reviews: readonly {
    readonly runId: string;
    readonly attempt: number;
    readonly runnerKind: string;
    readonly sessionId?: string;
    readonly outcome: string;
    readonly verdict: string | null;
    readonly summary: string;
    readonly findingCount: number;
    readonly blockingFindingCount: number;
    readonly resultDigest: string;
  }[];
  readonly git: {
    readonly workspaceEffectId?: string;
    readonly branch?: string;
    readonly baseCommit?: string;
    readonly resultCommit?: string;
    readonly resultTree?: string;
    readonly mergeEffectId?: string;
    readonly mergeCommit?: string;
    readonly targetRef?: string;
    readonly reconciledAfterUnknown?: boolean;
  };
  readonly verification?: {
    readonly passed: boolean;
    readonly code?: string;
    readonly verifiedCommit?: string;
    readonly evidenceRef: string;
    readonly evidenceContentDigest: string;
    readonly verificationDigest?: string;
    readonly commands: readonly {
      readonly commandId: string;
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly durationMs: number;
      readonly stdoutDigest: string;
      readonly stderrDigest: string;
    }[];
  };
  readonly durableRuntime: {
    readonly authority: "Restate Journal";
    readonly workflowRef: string;
    readonly workflowService: "CodingTaskWorkflow";
    readonly workflowKey: string;
    readonly adminBaseUrl?: string;
    readonly invocationsUrl?: string;
    readonly role: string;
  };
  readonly technical: {
    readonly authority: "diagnostic-only";
    readonly artifacts: readonly {
      readonly kind: string;
      readonly artifactRef: string;
      readonly contentDigest: string;
      readonly bytes?: number;
      readonly downloadUrl?: string;
    }[];
  };
  readonly observability: {
    readonly authority: "diagnostic-only";
    readonly enabled: boolean;
    readonly provider: "disabled" | "otlp";
    readonly traceId: string;
    readonly uiBaseUrl?: string;
  };
  readonly recovery: {
    readonly classification: RecoveryClassification;
    readonly summary: string;
    readonly actions: readonly RecoveryAction[];
  };
  readonly stateMachine: TaskStateMachineTrace;
}

export function buildCodingTaskTrace(
  projection: CodingWorkflowProjection,
  options: {
    readonly restateAdminUrl?: string;
    readonly observability?: { readonly enabled: boolean; readonly uiBaseUrl: string };
  } = {},
): CodingTaskTrace {
  const agent = projection.agent;
  const agentRun = projection.agentRun;
  const verification = projection.verification;
  const recovery = deriveRecovery(projection);
  return deepFreeze({
    schemaVersion: 1 as const,
    traceKind: "CODING" as const,
    task: {
      taskId: projection.taskId,
      specRevision: projection.specRevision,
      state: projection.state,
      currentStep: projection.currentStep,
      ...(projection.outcome === undefined ? {} : { outcome: projection.outcome }),
      archiveStatus: projection.archiveStatus,
      ...(projection.error === undefined ? {} : { error: projection.error }),
      ...(projection.errorCode === undefined ? {} : { errorCode: projection.errorCode }),
      ...(projection.errorCategory === undefined ? {} : { errorCategory: projection.errorCategory }),
    },
    business: {
      authority: "CodingTaskWorkflow projection" as const,
      events: projection.events.map((event) => ({ ...event })),
      steps: [...projection.steps.map((step) => {
        const attempts = projection.attempts.filter((attempt) => attempt.stepId === step.stepId);
        return {
          stepId: step.stepId,
          sequence: step.sequence,
          status: (attempts.at(-1)?.status ?? "NOT_STARTED") as StepAttempt["status"] | "NOT_STARTED",
          attemptIds: attempts.map((attempt) => attempt.attemptId),
        };
      }), ...((projection.reviews?.length ?? 0) > 0 || projection.currentStep === "REVIEW" ? [{
        stepId: "REVIEW" as const,
        sequence: projection.steps.length + 1,
        status: projection.review === undefined
          ? "RUNNING" as const
          : projection.review.outcome === "SUCCEEDED" && projection.review.verdict === "PASSED"
            ? "SUCCEEDED" as const
            : projection.state === "FAILED" ? "FAILED" as const : "RUNNING" as const,
        attemptIds: (projection.reviews ?? []).map((review) => review.runId),
      }] : [])],
      attempts: projection.attempts.map(cloneAttempt),
      evidenceBindings: projection.evidenceBindings.map((binding) => ({
        ...binding,
        evidenceRecords: binding.evidenceRecords.map(cloneEvidenceRecord),
      })),
    },
    ...(agent === undefined && agentRun === undefined ? {} : {
      agent: {
        runId: agent?.runId ?? agentRun!.runId,
        ...(agent?.sessionId === undefined ? {} : { sessionId: agent.sessionId }),
        runnerKind: agent?.runnerKind ?? agentRun!.runnerKind,
        outcome: agent?.outcome ?? "RUNNING",
        attemptId: agent?.attemptId ?? agentRun!.attemptId,
        exitCode: agent?.exitCode ?? null,
        signal: agent?.signal ?? null,
        ...(agent === undefined ? {} : { runDigest: agent.runDigest }),
      },
    }),
    reviews: (projection.reviews ?? []).map((review) => ({
      runId: review.runId,
      attempt: review.attempt,
      runnerKind: review.runnerKind,
      ...(review.sessionId === undefined ? {} : { sessionId: review.sessionId }),
      outcome: review.outcome,
      verdict: review.verdict,
      summary: review.summary,
      findingCount: review.findings.length,
      blockingFindingCount: review.findings.filter((finding) => finding.severity === "BLOCKING").length,
      resultDigest: review.resultDigest,
    })),
    ...(agent === undefined && agentRun === undefined ? {} : {
      agentEvents: {
        viewUrl: `/api/tasks/${encodeURIComponent(projection.taskId)}/agent-events`,
        ...(agent === undefined ? {} : {
          downloadUrl: `/api/tasks/${encodeURIComponent(projection.taskId)}/artifacts/agent-events`,
        }),
        completed: agent !== undefined,
      },
    }),
    git: {
      ...(projection.workspace === undefined ? {} : {
        workspaceEffectId: projection.workspace.effectId,
        branch: projection.workspace.branch,
      }),
      ...(projection.checkpoint === undefined ? {} : {
        baseCommit: projection.checkpoint.baseSha,
        resultCommit: projection.checkpoint.commitSha,
        resultTree: projection.checkpoint.treeDigest,
      }),
      ...(projection.merge === undefined ? {} : {
        mergeEffectId: projection.merge.effectId,
        ...(projection.merge.mergeCommit === undefined ? {} : { mergeCommit: projection.merge.mergeCommit }),
        targetRef: projection.merge.targetRef,
        reconciledAfterUnknown: projection.merge.reconciledAfterUnknown,
      }),
    },
    ...(verification === undefined ? {} : {
      verification: {
        passed: verification.passed,
        ...(!verification.passed ? { code: verification.code } : {
          verifiedCommit: verification.verifiedCommit,
          verificationDigest: verification.verificationDigest,
        }),
        evidenceRef: verification.evidenceRef,
        evidenceContentDigest: verification.evidenceContentDigest,
        commands: verification.commandResults.map((command) => ({
          commandId: command.commandId,
          exitCode: command.exitCode,
          signal: command.signal,
          durationMs: command.durationMs,
          stdoutDigest: command.stdoutDigest,
          stderrDigest: command.stderrDigest,
        })),
      },
    }),
    durableRuntime: {
      authority: "Restate Journal" as const,
      workflowRef: `restate://CodingTaskWorkflow/${projection.taskId}`,
      workflowService: "CodingTaskWorkflow" as const,
      workflowKey: projection.taskId,
      ...(options.restateAdminUrl === undefined ? {} : {
        adminBaseUrl: options.restateAdminUrl,
        invocationsUrl: buildRestateInvocationsUrl(options.restateAdminUrl, projection.taskId),
      }),
      role: "Journal records durable execution and replay; the business projection remains the task-state authority.",
    },
    technical: {
      authority: "diagnostic-only" as const,
      artifacts: collectArtifacts(projection),
    },
    observability: {
      authority: "diagnostic-only" as const,
      enabled: options.observability?.enabled ?? false,
      provider: options.observability?.enabled === true ? "otlp" as const : "disabled" as const,
      traceId: traceIdForTask(projection.taskId),
      ...(options.observability?.enabled === true ? { uiBaseUrl: options.observability.uiBaseUrl } : {}),
    },
    recovery,
    stateMachine: buildCodingStateMachine(projection),
  });
}

export function buildRestateInvocationsUrl(adminBaseUrl: string, taskId: string): string {
  const url = new URL("/ui/invocations", normalizeHttpBaseUrl(adminBaseUrl));
  url.searchParams.set("filter_target_service_name", JSON.stringify({
    operation: "IN",
    value: ["CodingTaskWorkflow"],
  }));
  url.searchParams.set("filter_target_service_key", JSON.stringify({
    operation: "EQUALS",
    value: taskId,
  }));
  url.searchParams.set("sort_field", "created_at");
  url.searchParams.set("sort_order", "DESC");
  return url.toString();
}

function normalizeHttpBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Restate Admin URL must use http or https");
  }
  return url;
}

function deriveRecovery(projection: CodingWorkflowProjection): CodingTaskTrace["recovery"] {
  if (projection.state === "CLOSED" && projection.archiveStatus === "ARCHIVED") {
    return { classification: "NONE", summary: "业务与归档均已闭环，无需恢复动作。", actions: [] };
  }
  if (projection.state === "CLOSED") {
    return {
      classification: "ARCHIVE_RETRY",
      summary: "业务已经关闭，只需重试或对账 Archive，不得重新执行编码。",
      actions: [{ code: "REATTACH_ARCHIVE", label: "重新附着归档", reason: "复用同一 ArchiveWorkflow key 对账归档结果。", automatic: true }],
    };
  }
  if (projection.state === "FAILED") {
    if (projection.errorCategory === "UNKNOWN_SIDE_EFFECT"
        || (projection.verification?.passed === false && projection.verification.code === "RESULT_UNKNOWN")) {
      const reconcileAction = projection.currentStep === "IMPLEMENT"
        ? { code: "RECONCILE_AGENT", label: "对账 Agent Artifact", reason: "根据稳定 Run Intent、manifest 和 Artifact 判断是否已完成。", automatic: false }
        : projection.currentStep === "WORKSPACE"
          ? { code: "RECONCILE_WORKSPACE", label: "对账 Worktree 与 Branch", reason: "检查受管路径、Branch HEAD 和 Workspace Effect。", automatic: false }
          : projection.currentStep === "MERGE"
            ? { code: "RECONCILE_GIT", label: "对账 Git Effect", reason: "检查 target ref、Effect marker、双亲与 ancestry。", automatic: false }
            : { code: "RECONCILE_VERIFICATION", label: "对账验证证据", reason: "根据稳定 Intent/Outcome 判断是否可复用。", automatic: false };
      return {
        classification: "WAIT_OR_RECONCILE",
        summary: "外部副作用结果未知，禁止盲目重跑或创建并行任务。",
        actions: [
          { code: "INSPECT_JOURNAL", label: "检查 Restate Journal", reason: "确认 durable activity 是否仍会恢复。", automatic: false },
          reconcileAction,
        ],
      };
    }
    return {
      classification: "FAILED_TERMINAL",
      summary: "当前 Task revision 已确定失败；修复后应创建新 Task 或新 Spec Revision。",
      actions: [{ code: "CREATE_FOLLOW_UP", label: "创建后续任务", reason: "保留本次失败事实，不在页面复活旧 Attempt。", automatic: false }],
    };
  }
  const actions: RecoveryAction[] = [
    { code: "WAIT_FOR_REPLAY", label: "等待 Runtime 恢复", reason: "Restate 会从已确认的 Journal entry 继续。", automatic: true },
    { code: "INSPECT_JOURNAL", label: "检查 Restate Journal", reason: "长时间无进展时定位当前 invocation/activity。", automatic: false },
  ];
  if (projection.currentStep === "MERGE") {
    actions.push({ code: "RECONCILE_GIT", label: "对账 Git Effect", reason: "先检查 target ref 与 Effect marker，再决定是否执行。", automatic: true });
  }
  return { classification: "WAIT_OR_RECONCILE", summary: "任务仍在执行或等待恢复，不应手工重复提交命令。", actions };
}

function collectArtifacts(projection: CodingWorkflowProjection): CodingTaskTrace["technical"]["artifacts"] {
  const artifacts: Array<{ kind: string; artifactRef: string; contentDigest: string; bytes?: number; downloadUrl?: string }> = [];
  const addAgentArtifact = (kind: string, artifact: AgentArtifactFile, downloadName?: string): void => {
    artifacts.push({
      kind,
      artifactRef: artifact.artifactRef,
      contentDigest: artifact.contentDigest,
      bytes: artifact.bytes,
      ...(downloadName === undefined ? {} : {
        downloadUrl: `/api/tasks/${encodeURIComponent(projection.taskId)}/artifacts/${downloadName}`,
      }),
    });
  };
  if (projection.agent !== undefined) {
    addAgentArtifact("agent-events", projection.agent.artifacts.events, "agent-events");
    addAgentArtifact("agent-stderr", projection.agent.artifacts.stderr);
    addAgentArtifact("agent-final-message", projection.agent.artifacts.finalMessage);
    if (projection.agent.artifacts.rawModelIo !== undefined) {
      addAgentArtifact("raw-model-io", projection.agent.artifacts.rawModelIo, "raw-model-io");
    }
  }
  if (projection.verification !== undefined) {
    artifacts.push({
      kind: "verification-evidence",
      artifactRef: projection.verification.evidenceRef,
      contentDigest: projection.verification.evidenceContentDigest,
    });
  }
  for (const review of projection.reviews ?? []) {
    artifacts.push({
      kind: `review-${review.attempt}`,
      artifactRef: review.manifestArtifactRef,
      contentDigest: review.resultDigest,
    });
  }
  if (projection.docs !== undefined) {
    artifacts.push({ kind: "docs-result", artifactRef: projection.docs.artifactRef, contentDigest: projection.docs.contentDigest });
  }
  if (projection.archive !== undefined) {
    artifacts.push({ kind: "archive-receipt", artifactRef: projection.archive.artifactRef, contentDigest: projection.archive.contentDigest });
  }
  return artifacts;
}

function cloneAttempt(attempt: StepAttempt): StepAttempt {
  return {
    ...attempt,
    evidenceRecords: attempt.evidenceRecords.map(cloneEvidenceRecord),
  };
}

function cloneEvidenceRecord(record: StepAttempt["evidenceRecords"][number]): StepAttempt["evidenceRecords"][number] {
  return { ...record, producer: { ...record.producer } };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
