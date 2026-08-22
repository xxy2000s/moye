import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentProcessRunner } from "../agent/codex-exec.js";
import type { AgentRunner, AgentRunResult } from "../agent/runner.js";
import { createAgentRunRequest, parseAgentRunResult } from "../agent/runner.js";
import { prepareLiveRoleRequest, type LiveRoleResult, type LiveRoleRunner } from "../agent/live-role.js";
import type { CodingPipelineStepId, CodingStep, EvidenceBinding, StepAttempt, TaskEnvelope } from "../domain/coding-task.js";
import {
  bindEvidence,
  createInitialAttempt,
  createReplannedAttempt,
  createRetryAttempt,
  createTaskEnvelope,
  finishAttempt,
  parseTaskEnvelope,
  recordAttemptEvidence,
  startAttempt,
} from "../domain/coding-task.js";
import { MoyeError, type MoyeErrorCategory } from "../domain/errors.js";
import type { GitCommandRunner, GitCheckpoint, WorkspaceEffectRequest } from "../git/workspace-effect.js";
import {
  applyWorkspaceEffect,
  createGitCheckpoint,
  createWorkspaceEffectRequest,
  parseGitCheckpoint,
  parseWorkspaceEffectRequest,
} from "../git/workspace-effect.js";
import type { LocalMergeResult } from "../git/merge-effect.js";
import { applyLocalMerge, createLocalMergeRequest } from "../git/merge-effect.js";
import type { VerificationBinding, VerificationFailure } from "../verification/gate.js";
import { parseVerificationBinding, runVerificationGate } from "../verification/gate.js";
import { prepareLiveReviewRequest, type LiveReviewResult, type LiveReviewRunner } from "../review/live-review.js";

export const CODING_WORKFLOW_STEPS = Object.freeze([
  "CONTEXT", "WORKSPACE", "IMPLEMENT", "VERIFY", "MERGE", "DOCS", "CLOSED", "ARCHIVE",
] as const);
export type CodingWorkflowStep = (typeof CODING_WORKFLOW_STEPS)[number] | "SELF_REVIEW" | "REVIEW" | "REPLAN";

export interface CodingWorkflowInput {
  readonly envelope: TaskEnvelope;
  readonly expectedEnvelopeDigest: string;
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly artifactRoot: string;
  readonly baseRef: string;
  readonly targetRef: string;
  readonly runnerKind: AgentRunResult["runnerKind"];
  readonly prompt: string;
  readonly docsDisposition: "updated" | "unchanged" | "not_applicable";
  readonly reviewMode?: "DISABLED" | "REAL";
  readonly maxRepairAttempts?: number;
  readonly maxReplanAttempts?: number;
  readonly roleMode?: "DISABLED" | "REAL";
}

export interface CodingWorkflowEvent {
  readonly sequence: number;
  readonly type: "STEP_STARTED" | "STEP_SUCCEEDED" | "REVIEW_FINDINGS" | "REPAIR_STARTED" | "REPAIR_SUCCEEDED" | "SPEC_REVISED" | "RECONCILE_REQUIRED" | "RECONCILE_RESUMED" | "WORKFLOW_FAILED" | "WORKFLOW_CLOSED" | "WORKFLOW_ARCHIVED" | "ARCHIVE_FAILED";
  readonly step: CodingWorkflowStep;
  readonly at: string;
  readonly detail?: string;
}

export interface CodingWorkflowProjection {
  readonly taskId: string;
  readonly specRevision: number;
  readonly envelopeDigest: string;
  readonly state: "RUNNING" | "WAITING_RECONCILE" | "FAILED" | "CLOSED";
  readonly currentStep: CodingWorkflowStep;
  readonly outcome?: "SUCCEEDED" | "FAILED_TERMINAL";
  readonly archiveStatus: "NOT_READY" | "PENDING" | "ARCHIVED" | "FAILED";
  readonly error?: string;
  readonly errorCode?: string;
  readonly errorCategory?: MoyeErrorCategory;
  readonly events: readonly CodingWorkflowEvent[];
  readonly steps: readonly CodingStep[];
  readonly attempts: readonly StepAttempt[];
  readonly evidenceBindings: readonly EvidenceBinding[];
  readonly artifactRoot?: string;
  readonly workspace?: { readonly effectId: string; readonly path: string; readonly branch: string };
  readonly agentRun?: {
    readonly runId: string;
    readonly runnerKind: AgentRunResult["runnerKind"];
    readonly taskId: string;
    readonly specRevision: number;
    readonly stepId: "IMPLEMENT";
    readonly attemptId: string;
    readonly eventsArtifactRef: string;
  };
  readonly agent?: AgentRunResult;
  readonly agentRuns?: readonly AgentRunResult[];
  readonly roleRun?: {
    readonly runId: string;
    readonly kind: LiveRoleResult["kind"];
    readonly runnerKind: LiveRoleResult["runnerKind"];
    readonly taskId: string;
    readonly specRevision: number;
    readonly attempt: number;
    readonly eventsArtifactRef: string;
  };
  readonly reviewRun?: {
    readonly runId: string;
    readonly runnerKind: LiveReviewResult["runnerKind"];
    readonly taskId: string;
    readonly specRevision: number;
    readonly attempt: number;
    readonly eventsArtifactRef: string;
  };
  readonly review?: LiveReviewResult;
  readonly reviews?: readonly LiveReviewResult[];
  readonly roleRuns?: readonly LiveRoleResult[];
  readonly specRevisions?: readonly { readonly specRevision: number; readonly envelopeDigest: string; readonly reason: string; readonly artifactRef?: string }[];
  readonly repairCount?: number;
  readonly checkpoint?: GitCheckpoint;
  readonly checkpoints?: readonly GitCheckpoint[];
  readonly verification?: VerificationBinding | VerificationFailure;
  readonly verifications?: readonly (VerificationBinding | VerificationFailure)[];
  readonly merge?: LocalMergeResult;
  readonly docs?: { readonly artifactRef: string; readonly contentDigest: string; readonly disposition: string };
  readonly archive?: CodingArchiveReceipt;
  readonly reconcile?: CodingReconcileFact;
}

export interface CodingReconcileFact {
  readonly token: string;
  readonly step: CodingWorkflowStep;
  readonly code: string;
  readonly message: string;
  readonly requestedAt: string;
  readonly round: number;
}

export interface CodingArchiveReceipt {
  readonly artifactRef: string;
  readonly contentDigest: string;
  readonly archivePath?: string;
}

export interface CodingWorkflowDependencies {
  readonly agentRunner: AgentRunner;
  readonly reviewRunner?: LiveReviewRunner;
  readonly roleRunner?: LiveRoleRunner;
  readonly verificationProcessRunner?: AgentProcessRunner;
  readonly gitRunner?: GitCommandRunner;
  readonly activity?: <T>(name: string, operation: () => Promise<T>) => Promise<T>;
  readonly archive?: (projection: CodingWorkflowProjection) => Promise<CodingArchiveReceipt>;
  readonly awaitReconcile?: (fact: CodingReconcileFact) => Promise<void>;
  readonly onSpecRevision?: (specRevision: number) => Promise<void>;
  readonly observe?: (projection: CodingWorkflowProjection) => Promise<void> | void;
  readonly now?: () => Date;
}

export async function runCodingWorkflow(
  input: CodingWorkflowInput,
  dependencies: CodingWorkflowDependencies,
): Promise<CodingWorkflowProjection> {
  let envelope = parseTaskEnvelope(
    JSON.parse(JSON.stringify(input.envelope)) as unknown,
    input.expectedEnvelopeDigest,
  );
  const now = dependencies.now ?? (() => new Date());
  const activity = dependencies.activity ?? (async <T>(_name: string, operation: () => Promise<T>) => operation());
  const maxReplans = input.maxReplanAttempts ?? 1;
  if (!Number.isSafeInteger(maxReplans) || maxReplans < 0 || maxReplans > 2) {
    throw new MoyeError({ code: "INVALID_REPLAN_BUDGET", category: "VALIDATION", message: "maxReplanAttempts must be between 0 and 2" });
  }
  let replanCount = 0;
  let projection: CodingWorkflowProjection = deepFreeze({
    taskId: envelope.taskId,
    specRevision: envelope.specRevision,
    envelopeDigest: envelope.envelopeDigest,
    state: "RUNNING",
    currentStep: "CONTEXT",
    archiveStatus: "NOT_READY",
    events: [],
    steps: envelope.pipeline,
    attempts: [],
    evidenceBindings: [],
    specRevisions: [{ specRevision: envelope.specRevision, envelopeDigest: envelope.envelopeDigest, reason: "INITIAL" }],
    artifactRoot: path.resolve(input.artifactRoot),
  });
  const publish = async (next: CodingWorkflowProjection): Promise<void> => {
    projection = deepFreeze(next);
    await dependencies.observe?.(projection);
  };
  const start = async (step: CodingWorkflowStep): Promise<void> => {
    await publish(withEvent({ ...projection, currentStep: step }, "STEP_STARTED", step, canonicalNow(now)));
    const codingStep = findCodingStep(envelope, step);
    if (codingStep !== undefined) {
      const previousAttempts = projection.attempts.filter((attempt) => attempt.stepId === step);
      const scheduled = previousAttempts.length === 0
        ? createInitialAttempt(codingStep, canonicalNow(now))
        : previousAttempts.at(-1)!.specRevision === codingStep.specRevision
          ? createRetryAttempt(codingStep, previousAttempts, canonicalNow(now))
          : createReplannedAttempt(codingStep, previousAttempts, canonicalNow(now));
      const running = startAttempt(scheduled, canonicalNow(now));
      await publish({ ...projection, attempts: [...projection.attempts, running] });
    }
  };
  const succeed = async (
    step: CodingWorkflowStep,
    detail: string,
    evidence?: { readonly artifactName: string; readonly contentDigest: string },
  ): Promise<void> => {
    const codingStep = findCodingStep(envelope, step);
    if (codingStep !== undefined) {
      if (evidence === undefined) throw new Error(`Coding Step ${step} requires Attempt Evidence`);
      const running = requireRunningAttempt(projection, step);
      const record = recordAttemptEvidence(running, evidence.artifactName, evidence.contentDigest);
      const completed = finishAttempt(running, "SUCCEEDED", canonicalNow(now), { evidenceRecords: [record] });
      const binding = bindEvidence(envelope, completed);
      await publish({
        ...projection,
        attempts: projection.attempts.map((attempt) => attempt.attemptId === completed.attemptId ? completed : attempt),
        evidenceBindings: [...projection.evidenceBindings, binding],
      });
    }
    await publish(withEvent(projection, "STEP_SUCCEEDED", step, canonicalNow(now), detail));
  };
  const fail = async (
    step: CodingWorkflowStep,
    message: string,
    errorFact?: { readonly code: string; readonly category: MoyeErrorCategory },
  ): Promise<CodingWorkflowProjection> => {
    const runningAttempts = projection.attempts.filter((attempt) => attempt.status === "RUNNING");
    if (runningAttempts.length > 0) {
      const completedById = new Map(runningAttempts.map((attempt) => {
        const completed = finishAttempt(attempt, "FAILED", canonicalNow(now), { error: message });
        return [completed.attemptId, completed] as const;
      }));
      await publish({
        ...projection,
        attempts: projection.attempts.map((attempt) => completedById.get(attempt.attemptId) ?? attempt),
      });
    }
    await publish(withEvent({
      ...projection,
      state: "FAILED",
      outcome: "FAILED_TERMINAL",
      archiveStatus: dependencies.archive === undefined ? projection.archiveStatus : "PENDING",
      error: message,
      ...(errorFact === undefined ? {} : { errorCode: errorFact.code, errorCategory: errorFact.category }),
    }, "WORKFLOW_FAILED", step, canonicalNow(now), message));
    if (dependencies.archive !== undefined) {
      try {
        await publish(withEvent(projection,
          "STEP_STARTED", "ARCHIVE", canonicalNow(now), "FAILED_TERMINAL"));
        const archive = await dependencies.archive(projection);
        await publish(withEvent({ ...projection, archiveStatus: "ARCHIVED", archive },
          "WORKFLOW_ARCHIVED", "ARCHIVE", canonicalNow(now), archive.artifactRef));
      } catch (archiveError) {
        const archiveMessage = archiveError instanceof Error ? archiveError.message : String(archiveError);
        await publish(withEvent({ ...projection, archiveStatus: "FAILED" },
          "ARCHIVE_FAILED", "ARCHIVE", canonicalNow(now), archiveMessage));
      }
    }
    return projection;
  };
  const external = async <T>(
    name: string,
    step: CodingWorkflowStep,
    operation: () => Promise<T>,
  ): Promise<CapturedActivity<T>> => {
    let round = 1;
    while (true) {
      const result = await activity(`${name}-reconcile-${round}`, () => captureUnknownSideEffect(operation));
      if (result.ok || dependencies.awaitReconcile === undefined) return result;
      const requestedAt = canonicalNow(now);
      const token = digest("coding-reconcile", {
        taskId: projection.taskId,
        specRevision: projection.specRevision,
        step,
        code: result.error.code,
        round,
      });
      const fact: CodingReconcileFact = {
        token,
        step,
        code: result.error.code,
        message: result.error.message,
        requestedAt,
        round,
      };
      await publish(withEvent({ ...projection, state: "WAITING_RECONCILE", reconcile: fact },
        "RECONCILE_REQUIRED", step, requestedAt, token));
      await dependencies.awaitReconcile(fact);
      const { reconcile: _resolvedReconcile, ...resumed } = projection;
      await publish(withEvent({ ...resumed, state: "RUNNING" },
        "RECONCILE_RESUMED", step, canonicalNow(now), token));
      round += 1;
    }
  };
  const runRole = async (
    kind: LiveRoleResult["kind"],
    step: CodingWorkflowStep,
    scopeRoot: string,
    instructions: string,
    commitSha?: string,
    allowBlockingFindings = false,
  ): Promise<LiveRoleResult | CodingWorkflowProjection> => {
    if (input.runnerKind === "FAKE" || dependencies.roleRunner === undefined) {
      return fail(step, "Real role execution requires a real runner", {
        code: "REAL_ROLE_RUNNER_REQUIRED",
        category: "VALIDATION",
      });
    }
    const attempt = (projection.roleRuns ?? []).filter((run) => run.kind === kind).length + 1;
    const request = await prepareLiveRoleRequest({
      taskId: projection.taskId,
      specRevision: projection.specRevision,
      kind,
      attempt,
      runnerKind: input.runnerKind as "CODEX_EXEC" | "CLAUDE_PRINT",
      scopeRoot,
      artifactRoot: path.join(input.artifactRoot, "roles", kind.toLowerCase()),
      instructions,
      ...(commitSha === undefined ? {} : { commitSha }),
    });
    await publish({
      ...projection,
      roleRun: {
        runId: request.runId,
        kind: request.kind,
        runnerKind: request.runnerKind,
        taskId: request.taskId,
        specRevision: request.specRevision,
        attempt: request.attempt,
        eventsArtifactRef: `role-artifact://${request.runId}/events.jsonl`,
      },
    });
    const captured = await external(`role-${kind.toLowerCase()}-${attempt}`, step, () => dependencies.roleRunner!.run(request));
    if (!captured.ok) return fail(step, captured.error.message, captured.error);
    const result = captured.value;
    const { roleRun: _completedRole, ...withoutActiveRole } = projection;
    await publish({ ...withoutActiveRole, roleRuns: [...(projection.roleRuns ?? []), result] });
    if (result.outcome !== "SUCCEEDED" || result.verdict === null) {
      return fail(step, result.summary || `${kind} role outcome ${result.outcome}`, {
        code: `ROLE_OUTCOME_${result.outcome}`,
        category: result.outcome === "FAILED" ? "TERMINAL" : "VALIDATION",
      });
    }
    if (!allowBlockingFindings && result.verdict === "FINDINGS" && result.findings.some((finding) => finding.severity === "BLOCKING")) {
      return fail(step, result.summary, { code: `${kind}_BLOCKING_FINDINGS`, category: "TERMINAL" });
    }
    return result;
  };
  const finishForReplan = async (step: CodingWorkflowStep, message: string): Promise<void> => {
    const running = projection.attempts.find((attempt) => attempt.stepId === step && attempt.status === "RUNNING");
    if (running === undefined) return;
    const completed = finishAttempt(running, "FAILED", canonicalNow(now), { error: message });
    await publish({
      ...projection,
      attempts: projection.attempts.map((attempt) => attempt.attemptId === completed.attemptId ? completed : attempt),
    });
  };
  const reviseEnvelope = async (criteria: readonly string[], reason: string, artifactRef: string): Promise<void> => {
    envelope = createTaskEnvelope({
      taskId: envelope.taskId,
      specRevision: envelope.specRevision + 1,
      baseSha: envelope.baseSha,
      requirements: envelope.requirements.map((requirement, index) => ({
        requirementId: requirement.requirementId,
        title: requirement.title,
        acceptanceCriteria: index === 0 ? criteria : requirement.acceptanceCriteria,
      })),
      validationCommands: envelope.validationCommands.map((command) => ({ commandId: command.commandId, argv: command.argv })),
      contextPlan: envelope.contextPlan,
    });
    await dependencies.onSpecRevision?.(envelope.specRevision);
    await publish(withEvent({
      ...projection,
      specRevision: envelope.specRevision,
      envelopeDigest: envelope.envelopeDigest,
      steps: envelope.pipeline,
      specRevisions: [...(projection.specRevisions ?? []), {
        specRevision: envelope.specRevision,
        envelopeDigest: envelope.envelopeDigest,
        reason,
        artifactRef,
      }],
    }, "SPEC_REVISED", "REPLAN", canonicalNow(now), envelope.envelopeDigest));
  };

  try {
    await start("CONTEXT");
    let contextEvidence = sha256(Buffer.from(JSON.stringify(envelope)));
    if (input.roleMode === "REAL") {
      while (true) {
        const context = await runRole("CONTEXT", "CONTEXT", input.repositoryRoot, [
          "Inspect the repository instructions, architecture, relevant code, and tests.",
          "Validate that the frozen task envelope is actionable and that its acceptance criteria and validation commands are coherent.",
          "If the specification itself is incomplete, return REPLAN findings and the complete revised acceptance criteria.",
          `Task envelope: ${JSON.stringify(envelope)}`,
        ].join("\n"), undefined, true);
        if (!("kind" in context)) return context;
        const blocking = context.findings.filter((finding) => finding.severity === "BLOCKING");
        if (context.verdict !== "FINDINGS" || blocking.length === 0) {
          contextEvidence = context.eventsContentDigest;
          break;
        }
        if (blocking.some((finding) => finding.recommendedAction !== "REPLAN")
            || context.revisedAcceptanceCriteria.length === 0 || replanCount >= maxReplans) {
          return fail("CONTEXT", context.summary, { code: "CONTEXT_BLOCKING_FINDINGS", category: "TERMINAL" });
        }
        replanCount += 1;
        await finishForReplan("CONTEXT", context.summary);
        await reviseEnvelope(context.revisedAcceptanceCriteria, context.resultDigest, context.manifestArtifactRef);
        await start("CONTEXT");
      }
    }
    await succeed("CONTEXT", envelope.envelopeDigest, {
      artifactName: input.roleMode === "REAL" ? "context-role.json" : "task-envelope.json",
      contentDigest: contextEvidence,
    });

    await start("WORKSPACE");
    const workspaceActivityResult = await external("workspace-effect", "WORKSPACE", async () => {
      const request = await createWorkspaceEffectRequest({
        taskId: envelope.taskId,
        specRevision: envelope.specRevision,
        repositoryRoot: input.repositoryRoot,
        worktreeRoot: input.worktreeRoot,
        baseRef: input.baseRef,
        baseSha: envelope.baseSha,
      });
      const effect = await applyWorkspaceEffect(request, dependencies.gitRunner);
      return { request, effect };
    });
    if (!workspaceActivityResult.ok) {
      return fail("WORKSPACE", workspaceActivityResult.error.message, workspaceActivityResult.error);
    }
    const workspaceActivity = workspaceActivityResult.value;
    const workspace = await parseWorkspaceEffectRequest(
      JSON.parse(JSON.stringify(workspaceActivity.request)) as unknown,
      workspaceActivity.request.effectId,
    );
    if (workspaceActivity.effect.outcome === "CONFLICT") {
      return fail("WORKSPACE", workspaceActivity.effect.reconcileCode,
        { code: workspaceActivity.effect.reconcileCode, category: "CONFLICT" });
    }
    await publish({
      ...projection,
      workspace: { effectId: workspace.effectId, path: workspace.worktreePath, branch: workspace.branchName },
    });
    await succeed("WORKSPACE", workspace.effectId, {
      artifactName: "workspace-effect.json", contentDigest: sha256(Buffer.from(JSON.stringify(workspaceActivity))),
    });

    await start("IMPLEMENT");
    const agentRequest = await createAgentRunRequest({
      taskId: envelope.taskId,
      specRevision: envelope.specRevision,
      stepId: "IMPLEMENT",
      attemptId: `${envelope.taskId}/IMPLEMENT/attempt-001`,
      runnerKind: input.runnerKind,
      workspaceRoot: workspace.worktreePath,
      artifactRoot: path.join(input.artifactRoot, "agent"),
      prompt: input.prompt,
    });
    await publish({
      ...projection,
      agentRun: {
        runId: agentRequest.runId,
        runnerKind: agentRequest.runnerKind,
        taskId: agentRequest.taskId,
        specRevision: agentRequest.specRevision,
        stepId: agentRequest.stepId,
        attemptId: agentRequest.attemptId,
        eventsArtifactRef: `agent-artifact://${agentRequest.runId}/events.jsonl`,
      },
    });
    const agentActivity = await external("agent-run", "IMPLEMENT", () => dependencies.agentRunner.run(agentRequest));
    if (!agentActivity.ok) return fail("IMPLEMENT", agentActivity.error.message, agentActivity.error);
    const agentRaw = agentActivity.value;
    let agent = await parseAgentRunResult(
      JSON.parse(JSON.stringify(agentRaw)) as unknown,
      agentRequest,
      agentRaw.runDigest,
    );
    await publish({ ...projection, agent, agentRuns: [...(projection.agentRuns ?? []), agent] });
    if (agent.outcome !== "SUCCEEDED") return fail("IMPLEMENT", `Agent outcome ${agent.outcome}`,
      { code: `AGENT_OUTCOME_${agent.outcome}`, category: "TERMINAL" });
    const checkpointCreatedAt = canonicalNow(now);
    const checkpointRaw = await activity("result-checkpoint", () => createGitCheckpoint(
      workspace,
      checkpointCreatedAt,
      dependencies.gitRunner,
      envelope.specRevision,
    ));
    let checkpoint = parseGitCheckpoint(
      JSON.parse(JSON.stringify(checkpointRaw)) as unknown,
      checkpointRaw.checkpointDigest,
    );
    await publish({ ...projection, checkpoint, checkpoints: [...(projection.checkpoints ?? []), checkpoint] });
    await succeed("IMPLEMENT", checkpoint.commitSha, {
      artifactName: "agent-events.jsonl", contentDigest: agent.artifacts.events.contentDigest,
    });
    if (input.roleMode === "REAL") {
      await start("SELF_REVIEW");
      const selfReview = await runRole("SELF_REVIEW", "SELF_REVIEW", workspace.worktreePath, [
        "Review the implementation you own against every frozen requirement before independent review.",
        "Inspect the committed diff and validation commands. Report implementation defects as REPAIR and specification defects as REPLAN.",
        ...envelope.requirements.flatMap((requirement) => [requirement.title, ...requirement.acceptanceCriteria]),
      ].join("\n"), checkpoint.commitSha);
      if (!("kind" in selfReview)) return selfReview;
      await succeed("SELF_REVIEW", selfReview.resultDigest);
    }
    await start("VERIFY");
    let verificationEpoch = Date.parse(canonicalNow(now));
    let verificationRaw = await activity("verification-gate-1", () => {
      let verificationTick = 0;
      return runVerificationGate(
        envelope,
        workspace,
        checkpoint,
        {
          artifactRoot: path.join(input.artifactRoot, "verification"),
          ...(dependencies.verificationProcessRunner ? { processRunner: dependencies.verificationProcessRunner } : {}),
          now: () => new Date(verificationEpoch + verificationTick++),
        },
      );
    });
    let verification: VerificationBinding | VerificationFailure;
    if (verificationRaw.passed) {
      verification = parseVerificationBinding(
        JSON.parse(JSON.stringify(verificationRaw)) as unknown,
        verificationRaw.verificationDigest,
      );
    } else {
      verification = deepFreeze(JSON.parse(JSON.stringify(verificationRaw)) as VerificationFailure);
    }
    await publish({ ...projection, verification, verifications: [...(projection.verifications ?? []), verification] });
    if (!verification.passed) return fail("VERIFY", verification.code, {
      code: verification.code,
      category: verification.code === "RESULT_UNKNOWN" ? "UNKNOWN_SIDE_EFFECT" : "TERMINAL",
    });
    await succeed("VERIFY", verification.verificationDigest, {
      artifactName: "verification.json", contentDigest: verification.evidenceContentDigest,
    });
    if (input.reviewMode === "REAL") {
      if (input.runnerKind === "FAKE" || dependencies.reviewRunner === undefined) {
        return fail("REVIEW", "Real Review requires a real runner", { code: "REAL_REVIEW_RUNNER_REQUIRED", category: "VALIDATION" });
      }
      const maxRepairs = input.maxRepairAttempts ?? 1;
      if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > 3) {
        return fail("REVIEW", "maxRepairAttempts must be between 0 and 3", { code: "INVALID_REPAIR_BUDGET", category: "VALIDATION" });
      }
      let reviewAttempt = 1;
      let repairCount = 0;
      while (true) {
        await start("REVIEW");
        const reviewRequest = await prepareLiveReviewRequest({
          taskId: envelope.taskId,
          specRevision: envelope.specRevision,
          attempt: reviewAttempt,
          runnerKind: input.runnerKind as "CODEX_EXEC" | "CLAUDE_PRINT",
          workspaceRoot: workspace.worktreePath,
          artifactRoot: path.join(input.artifactRoot, "review"),
          baseRef: input.baseRef,
          commitSha: checkpoint.commitSha,
          instructions: [
            "Independently review the committed implementation against the task requirements and validation evidence.",
            ...envelope.requirements.flatMap((requirement) => [requirement.title, ...requirement.acceptanceCriteria]),
          ].join("\n"),
        });
        await publish({
          ...projection,
          reviewRun: {
            runId: reviewRequest.runId,
            runnerKind: reviewRequest.runnerKind,
            taskId: reviewRequest.taskId,
            specRevision: reviewRequest.specRevision,
            attempt: reviewRequest.attempt,
            eventsArtifactRef: `review-artifact://${reviewRequest.runId}/events.jsonl`,
          },
        });
        const review = await activity(`review-agent-${reviewAttempt}`, () => dependencies.reviewRunner!.run(reviewRequest));
        const { reviewRun: _completedReview, ...withoutActiveReview } = projection;
        await publish({ ...withoutActiveReview, review, reviews: [...(projection.reviews ?? []), review], repairCount });
        if (review.outcome !== "SUCCEEDED" || review.verdict === null) {
          return fail("REVIEW", review.summary || `Review outcome ${review.outcome}`, {
            code: `REVIEW_OUTCOME_${review.outcome}`,
            category: review.outcome === "FAILED" ? "TERMINAL" : "VALIDATION",
          });
        }
        if (review.verdict === "PASSED") {
          await succeed("REVIEW", review.resultDigest);
          break;
        }
        await publish(withEvent(projection, "REVIEW_FINDINGS", "REVIEW", canonicalNow(now), review.resultDigest));
        const blocking = review.findings.filter((finding) => finding.severity === "BLOCKING");
        const requiresReplan = blocking.some((finding) => finding.recommendedAction === "REPLAN");
        if (requiresReplan && replanCount >= maxReplans) {
          return fail("REVIEW", `Review requires another Spec Revision after ${replanCount} replan(s)`, {
            code: "REPLAN_BUDGET_EXHAUSTED", category: "TERMINAL",
          });
        }
        if (!requiresReplan && repairCount >= maxRepairs) {
          return fail("REVIEW", `Review has ${review.findings.filter((finding) => finding.severity === "BLOCKING").length} blocking finding(s) after ${repairCount} repair(s)`, {
            code: "REVIEW_FINDINGS_UNRESOLVED", category: "TERMINAL",
          });
        }
        let recoveryInstructions: string;
        if (requiresReplan) {
          replanCount += 1;
          await start("REPLAN");
          const replanned = await runRole("REPLAN", "REPLAN", workspace.worktreePath, [
            "Produce Spec Revision N+1 that resolves the independent review's specification findings.",
            "Return the complete revised acceptance criteria in revisedAcceptanceCriteria.",
            review.summary,
            ...blocking.map((finding) => `- ${finding.title}: ${finding.details}`),
          ].join("\n"), checkpoint.commitSha);
          if (!("kind" in replanned)) return replanned;
          const revisedCriteria = replanned.revisedAcceptanceCriteria.length > 0
            ? replanned.revisedAcceptanceCriteria
            : envelope.requirements.flatMap((requirement) => requirement.acceptanceCriteria);
          await reviseEnvelope(revisedCriteria, review.resultDigest, replanned.manifestArtifactRef);
          await succeed("REPLAN", replanned.resultDigest);
          await start("CONTEXT");
          const revisedContext = await runRole("CONTEXT", "CONTEXT", workspace.worktreePath, [
            "Validate the revised task envelope against the repository and the blocking review findings.",
            `Revised envelope: ${JSON.stringify(envelope)}`,
          ].join("\n"), checkpoint.commitSha);
          if (!("kind" in revisedContext)) return revisedContext;
          await succeed("CONTEXT", envelope.envelopeDigest, {
            artifactName: "context-role.json",
            contentDigest: revisedContext.eventsContentDigest,
          });
          recoveryInstructions = "Implement the revised Spec Revision completely, rerun checks, and create a new commit.";
        } else {
          repairCount += 1;
          recoveryInstructions = "Repair the blocking implementation findings, rerun relevant checks, and create a new commit.";
        }
        const generation = (projection.agentRuns?.length ?? 1) + 1;
        await start("IMPLEMENT");
        await publish(withEvent({ ...projection, repairCount }, "REPAIR_STARTED", "IMPLEMENT", canonicalNow(now), review.resultDigest));
        const repairAttempt = requireRunningAttempt(projection, "IMPLEMENT");
        const repairRequest = await createAgentRunRequest({
          taskId: envelope.taskId,
          specRevision: envelope.specRevision,
          stepId: "IMPLEMENT",
          attemptId: repairAttempt.attemptId,
          runnerKind: input.runnerKind,
          workspaceRoot: workspace.worktreePath,
          artifactRoot: path.join(input.artifactRoot, "agent"),
          prompt: [
            input.prompt,
            recoveryInstructions,
            review.summary,
            ...blocking.map((finding) => `- ${finding.title}: ${finding.details}`),
          ].join("\n"),
        });
        await publish({
          ...projection,
          agentRun: {
            runId: repairRequest.runId,
            runnerKind: repairRequest.runnerKind,
            taskId: repairRequest.taskId,
            specRevision: repairRequest.specRevision,
            stepId: repairRequest.stepId,
            attemptId: repairRequest.attemptId,
            eventsArtifactRef: `agent-artifact://${repairRequest.runId}/events.jsonl`,
          },
        });
        const repairActivity = await external(`agent-repair-${generation}`, "IMPLEMENT", () => dependencies.agentRunner.run(repairRequest));
        if (!repairActivity.ok) return fail("IMPLEMENT", repairActivity.error.message, repairActivity.error);
        const repaired = await parseAgentRunResult(
          JSON.parse(JSON.stringify(repairActivity.value)) as unknown,
          repairRequest,
          repairActivity.value.runDigest,
        );
        agent = repaired;
        await publish({
          ...projection,
          agent,
          agentRuns: [...(projection.agentRuns ?? []), agent],
          repairCount,
        });
        if (repaired.outcome !== "SUCCEEDED") return fail("IMPLEMENT", `Repair Agent outcome ${repaired.outcome}`, {
          code: `AGENT_OUTCOME_${repaired.outcome}`, category: "TERMINAL",
        });
        const repairedCheckpointRaw = await activity(`result-checkpoint-${generation}`, () => createGitCheckpoint(
          workspace, canonicalNow(now), dependencies.gitRunner, envelope.specRevision,
        ));
        checkpoint = parseGitCheckpoint(
          JSON.parse(JSON.stringify(repairedCheckpointRaw)) as unknown,
          repairedCheckpointRaw.checkpointDigest,
        );
        await publish({
          ...projection,
          checkpoint,
          checkpoints: [...(projection.checkpoints ?? []), checkpoint],
          repairCount,
        });
        await succeed("IMPLEMENT", checkpoint.commitSha, {
          artifactName: "agent-events.jsonl", contentDigest: agent.artifacts.events.contentDigest,
        });
        await publish(withEvent(projection, "REPAIR_SUCCEEDED", "IMPLEMENT", canonicalNow(now), checkpoint.commitSha));
        if (input.roleMode === "REAL") {
          await start("SELF_REVIEW");
          const repairedSelfReview = await runRole("SELF_REVIEW", "SELF_REVIEW", workspace.worktreePath, [
            "Review the latest repaired or replanned implementation against the active Spec Revision.",
            "Inspect the committed diff and report any remaining defect before independent review.",
            ...envelope.requirements.flatMap((requirement) => [requirement.title, ...requirement.acceptanceCriteria]),
          ].join("\n"), checkpoint.commitSha);
          if (!("kind" in repairedSelfReview)) return repairedSelfReview;
          await succeed("SELF_REVIEW", repairedSelfReview.resultDigest);
        }
        await start("VERIFY");
        verificationEpoch = Date.parse(canonicalNow(now));
        verificationRaw = await activity(`verification-gate-${generation}`, () => {
          let verificationTick = 0;
          return runVerificationGate(envelope, workspace, checkpoint, {
            artifactRoot: path.join(input.artifactRoot, "verification"),
            ...(dependencies.verificationProcessRunner ? { processRunner: dependencies.verificationProcessRunner } : {}),
            now: () => new Date(verificationEpoch + verificationTick++),
          });
        });
        verification = verificationRaw.passed
          ? parseVerificationBinding(JSON.parse(JSON.stringify(verificationRaw)) as unknown, verificationRaw.verificationDigest)
          : deepFreeze(JSON.parse(JSON.stringify(verificationRaw)) as VerificationFailure);
        await publish({
          ...projection,
          verification,
          verifications: [...(projection.verifications ?? []), verification],
          repairCount,
        });
        if (!verification.passed) return fail("VERIFY", verification.code, {
          code: verification.code,
          category: verification.code === "RESULT_UNKNOWN" ? "UNKNOWN_SIDE_EFFECT" : "TERMINAL",
        });
        await succeed("VERIFY", verification.verificationDigest, {
          artifactName: "verification.json", contentDigest: verification.evidenceContentDigest,
        });
        reviewAttempt += 1;
      }
    }

    await start("MERGE");
    const mergeActivity = await external("local-merge-effect", "MERGE", async () => {
      const request = await createLocalMergeRequest({
        repositoryRoot: workspace.worktreePath,
        targetRef: input.targetRef,
        expectedBase: envelope.baseSha,
        verification,
      });
      return applyLocalMerge(request, dependencies.gitRunner);
    });
    if (!mergeActivity.ok) return fail("MERGE", mergeActivity.error.message, mergeActivity.error);
    const merge = mergeActivity.value;
    await publish({ ...projection, merge });
    if (merge.outcome === "CONFLICT" || !merge.mergeCommit) {
      return fail("MERGE", merge.code, { code: merge.code, category: "CONFLICT" });
    }
    await succeed("MERGE", merge.mergeCommit, {
      artifactName: "merge-result.json", contentDigest: sha256(Buffer.from(JSON.stringify(merge))),
    });

    await start("DOCS");
    let docsRoleDigest: string | undefined;
    if (input.roleMode === "REAL") {
      const docsRole = await runRole("DOCS_GATE", "DOCS", workspace.worktreePath, [
        "Inspect the merged result and repository documentation rules.",
        `The declared documentation disposition is ${input.docsDisposition}.`,
        "Confirm that required documentation, code map, task evidence, and operator guidance are consistent with the implementation.",
      ].join("\n"), merge.mergeCommit);
      if (!("kind" in docsRole)) return docsRole;
      docsRoleDigest = docsRole.eventsContentDigest;
    }
    const docs = await activity("docs-artifact", () => writeDocsArtifact(
      input.artifactRoot,
      envelope.taskId,
      merge.mergeCommit!,
      input.docsDisposition,
    ));
    await publish({ ...projection, docs });
    await succeed("DOCS", docs.contentDigest, {
      artifactName: input.roleMode === "REAL" ? "docs-role.json" : "docs-result.json",
      contentDigest: docsRoleDigest ?? docs.contentDigest,
    });

    await start("CLOSED");
    await publish(withEvent({ ...projection, state: "CLOSED", outcome: "SUCCEEDED", archiveStatus: "PENDING" },
      "WORKFLOW_CLOSED", "CLOSED", canonicalNow(now), merge.mergeCommit));

    await start("ARCHIVE");
    try {
      const archive = dependencies.archive === undefined
        ? await activity("archive-receipt", () => writeArchiveReceipt(input.artifactRoot, envelope.taskId, docs))
        : await dependencies.archive(projection);
      await publish(withEvent({ ...projection, archiveStatus: "ARCHIVED", archive },
        "WORKFLOW_ARCHIVED", "ARCHIVE", canonicalNow(now), archive.artifactRef));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await publish(withEvent({ ...projection, archiveStatus: "FAILED", error: message },
        "ARCHIVE_FAILED", "ARCHIVE", canonicalNow(now), message));
    }
    return projection;
  } catch (error) {
    return fail(
      projection.currentStep,
      error instanceof Error ? error.message : String(error),
      error instanceof MoyeError ? { code: error.code, category: error.category } : undefined,
    );
  }
}

type CapturedActivity<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly category: "UNKNOWN_SIDE_EFFECT"; readonly message: string } };

async function captureUnknownSideEffect<T>(operation: () => Promise<T>): Promise<CapturedActivity<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof MoyeError && error.category === "UNKNOWN_SIDE_EFFECT") {
      return { ok: false, error: { code: error.code, category: error.category, message: error.message } };
    }
    throw error;
  }
}

async function writeArchiveReceipt(
  artifactRoot: string,
  taskId: string,
  docs: NonNullable<CodingWorkflowProjection["docs"]>,
): Promise<CodingArchiveReceipt> {
  const directory = path.resolve(artifactRoot, "archive");
  await mkdir(directory, { recursive: true });
  const core = { schemaVersion: 1, taskId, docsArtifactRef: docs.artifactRef, docsContentDigest: docs.contentDigest };
  const content = Buffer.from(`${JSON.stringify({ ...core, archiveDigest: digest("coding-archive", core) }, null, 2)}\n`, "utf8");
  const target = path.join(directory, `${taskId}.json`);
  await writeStableFile(target, content);
  return deepFreeze({
    artifactRef: `coding-artifact://${taskId}/archive/${taskId}.json`,
    contentDigest: sha256(content),
  });
}

async function writeDocsArtifact(
  artifactRoot: string,
  taskId: string,
  mergeCommit: string,
  disposition: CodingWorkflowInput["docsDisposition"],
): Promise<{ readonly artifactRef: string; readonly contentDigest: string; readonly disposition: string }> {
  const directory = path.resolve(artifactRoot, "docs");
  await mkdir(directory, { recursive: true });
  const core = { schemaVersion: 1, taskId, mergeCommit, disposition };
  const content = Buffer.from(`${JSON.stringify({ ...core, docsDigest: digest("docs-step", core) }, null, 2)}\n`, "utf8");
  const target = path.join(directory, `${taskId}.json`);
  await writeStableFile(target, content);
  return deepFreeze({
    artifactRef: `coding-artifact://${taskId}/docs/${taskId}.json`,
    contentDigest: sha256(content),
    disposition,
  });
}

async function writeStableFile(target: string, content: Buffer): Promise<void> {
  try {
    const current = await readFile(target);
    if (!current.equals(content)) throw new Error(`Docs Artifact conflicts: ${target}`);
    return;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  try { await writeFile(`${target}.pending`, content, { flag: "wx" }); }
  catch (error) {
    if (!isAlreadyExists(error)) throw error;
    if (!(await readFile(`${target}.pending`)).equals(content)) throw new Error(`Docs pending Artifact conflicts: ${target}`);
  }
  try { await rename(`${target}.pending`, target); }
  catch (error) {
    if (!isNotFound(error)) throw error;
    if (!(await readFile(target)).equals(content)) throw new Error(`Docs Artifact conflicts: ${target}`);
  }
}

function withEvent(
  projection: CodingWorkflowProjection,
  type: CodingWorkflowEvent["type"],
  step: CodingWorkflowStep,
  at: string,
  detail?: string,
): CodingWorkflowProjection {
  const event: CodingWorkflowEvent = {
    sequence: projection.events.length + 1,
    type,
    step,
    at,
    ...(detail ? { detail } : {}),
  };
  return deepFreeze({ ...projection, events: [...projection.events, event] });
}

function findCodingStep(envelope: TaskEnvelope, step: CodingWorkflowStep): CodingStep | undefined {
  return envelope.pipeline.find((candidate) => candidate.stepId === step as CodingPipelineStepId);
}

function requireRunningAttempt(projection: CodingWorkflowProjection, step: CodingWorkflowStep): StepAttempt {
  const attempt = projection.attempts.find((candidate) => candidate.stepId === step && candidate.status === "RUNNING");
  if (attempt === undefined) throw new Error(`Coding Step ${step} has no RUNNING Attempt`);
  return attempt;
}

function canonicalNow(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Coding Workflow clock returned invalid Date");
  return value.toISOString();
}

function digest(namespace: string, value: unknown): string {
  return `${namespace}:sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
function sha256(value: Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function isNotFound(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
function isAlreadyExists(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST"; }
