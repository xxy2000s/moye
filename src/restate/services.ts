import * as restate from "@restatedev/restate-sdk";
import path from "node:path";

import {
  archiveTaskPackage,
  freezeArchiveManifest,
  resolveArchivePaths,
} from "../archive/file-archive.js";
import {
  persistBootstrapFailure,
  verifyAndPersistBootstrapClosure,
  verifyBootstrapEvidence,
  verifyBootstrapPreflight,
} from "../archive/bootstrap-closure.js";
import {
  createSealIntent,
  verifyHistoricalSealedResultCommit,
  verifySealedResultCommit,
} from "../archive/sealed-result-commit.js";
import type {
  SealEvidence,
  SealIntent,
  SealReceipt,
  SealedTaskInput,
} from "../archive/sealed-result-commit.js";
import type {
  ArchiveInput,
  ArchiveMoveResult,
  ArchiveProjection,
} from "../domain/archive.js";
import { archiveOperationId } from "../domain/archive.js";
import type { BacklogProjection } from "../domain/backlog.js";
import type { BacklogSyncInput, BacklogSyncResult } from "../domain/backlog.js";
import { mergeBacklogBatch, upsertRuntimeBacklog } from "../domain/backlog.js";
import { buildBoardSnapshot } from "../domain/board.js";
import type { ProjectBoardSnapshot } from "../domain/board.js";
import { asMoyeError, MoyeError } from "../domain/errors.js";
import {
  closeTask,
  createTaskProjection,
  failTask,
  recoverFailedBootstrapTask,
  recoverFailedSealedTask,
  recordBootstrapEvidence,
  recordSealIntent,
  recordSealReceipt,
  transitionTask,
  updateArchiveStatus,
} from "../domain/task.js";
import type { TaskExecutionEvidence, TaskProjection } from "../domain/task.js";
import { incrementEffectCounter } from "../effects/counter.js";

interface ProjectBoardState {
  tasks: Record<string, TaskProjection>;
  backlog: Record<string, BacklogProjection>;
}

interface TaskWorkflowState {
  projection: TaskProjection;
}

interface ArchiveWorkflowState {
  projection: ArchiveProjection;
  result: ArchiveMoveResult;
}

interface BootstrapFailureRecoveryState {
  projection: TaskProjection;
  sourceProjection: TaskProjection;
}

interface SealedTaskWorkflowState {
  projection: TaskProjection;
  intent: SealIntent;
  evidence: SealEvidence;
  receipt: SealReceipt;
}

interface SealedTaskRecoveryWorkflowState {
  projection: TaskProjection;
  sourceStatus: SealedTaskStatus;
  receipt: SealReceipt;
}

export interface SealedTaskStatus {
  readonly projection: TaskProjection;
  readonly intent: SealIntent;
  readonly evidenceSubmitted: boolean;
  readonly evidence?: SealEvidence;
  readonly receipt?: SealReceipt;
}

export interface TaskAuthorityState {
  owner: "TASK_WORKFLOW" | "CODING_WORKFLOW" | "CORE_WORKFLOW" | "CORE_V2_WORKFLOW" | "SEALED_TASK_WORKFLOW";
  specRevision: number;
  recoveryWorkflowRef?: string;
  sourceWorkflowRef?: string;
}

export interface BootstrapRecoveryHandoffInput {
  readonly specRevision: number;
  readonly recoveryWorkflowRef: string;
  readonly sourceWorkflowRef: string;
}

export interface SealedTaskRecoveryInput {
  readonly taskId: string;
  readonly projectId: string;
  readonly specRevision: number;
  readonly sourceWorkflowRef: string;
  readonly recoveryId?: string;
  readonly rejectedResultCommit: string;
  readonly correctedEvidence: SealEvidence;
}

export interface TaskWorkflowInput {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
  readonly specRevision: number;
  readonly backlogRefs: readonly string[];
  readonly activeTasksRoot: string;
  readonly archiveRoot: string;
  readonly effectCounterPath: string;
  readonly archivedAt: string;
  readonly fault?: ArchiveInput["fault"];
  readonly bootstrapEvidence?: TaskExecutionEvidence;
}

export interface ArchiveWorkflowInput extends ArchiveInput {
  readonly task: TaskProjection;
}

export interface BootstrapFailureRecoveryInput {
  readonly taskId: string;
  readonly projectId: string;
  readonly specRevision: number;
  readonly sourceWorkflowRef: string;
  readonly sourceInvocationRef: string;
  readonly expectedFailureCode: "BOOTSTRAP_BASE_COMMIT_NOT_FROZEN";
  readonly sourceInput: TaskWorkflowInput;
}

export const taskAuthority = restate.object({
  name: "TaskAuthority",
  handlers: {
    claim: async (
      ctx: restate.ObjectContext<TaskAuthorityState>,
      input: TaskAuthorityState,
    ): Promise<TaskAuthorityState> => {
      const current = await ctx.get("owner") as TaskAuthorityState["owner"] | null;
      const currentRevision = await ctx.get("specRevision") as number | null;
      if (current !== null && (current !== input.owner || currentRevision === null || input.specRevision < currentRevision)) {
        throw new restate.TerminalError(
          `Task ${ctx.key} is already owned by ${current} revision ${String(currentRevision)}`,
          { errorCode: 409 },
        );
      }
      const revision = Math.max(currentRevision ?? input.specRevision, input.specRevision);
      ctx.set("owner", input.owner);
      ctx.set("specRevision", revision);
      const recoveryWorkflowRef = await ctx.get("recoveryWorkflowRef") as string | null;
      const sourceWorkflowRef = await ctx.get("sourceWorkflowRef") as string | null;
      return {
        owner: input.owner,
        specRevision: revision,
        ...(recoveryWorkflowRef === null ? {} : { recoveryWorkflowRef }),
        ...(sourceWorkflowRef === null ? {} : { sourceWorkflowRef }),
      };
    },

    beginBootstrapRecovery: restate.handlers.object.exclusive(
      { ingressPrivate: true },
      async (
        ctx: restate.ObjectContext<TaskAuthorityState>,
        input: BootstrapRecoveryHandoffInput,
      ): Promise<TaskAuthorityState> => {
      const [owner, specRevision, existingRecovery, existingSource] = await Promise.all([
        ctx.get("owner") as Promise<TaskAuthorityState["owner"] | null>,
        ctx.get("specRevision") as Promise<number | null>,
        ctx.get("recoveryWorkflowRef") as Promise<string | null>,
        ctx.get("sourceWorkflowRef") as Promise<string | null>,
      ]);
      if (owner !== "TASK_WORKFLOW" || specRevision !== input.specRevision) {
        throw new restate.TerminalError(
          `Task ${ctx.key} is not owned by TaskWorkflow revision ${input.specRevision}`,
          { errorCode: 409 },
        );
      }
      if (existingRecovery !== null && (
        existingRecovery !== input.recoveryWorkflowRef || existingSource !== input.sourceWorkflowRef
      )) {
        throw new restate.TerminalError(`Task ${ctx.key} already has a different recovery successor`, {
          errorCode: 409,
        });
      }
      ctx.set("recoveryWorkflowRef", input.recoveryWorkflowRef);
      ctx.set("sourceWorkflowRef", input.sourceWorkflowRef);
        return {
          owner,
          specRevision,
          recoveryWorkflowRef: input.recoveryWorkflowRef,
          sourceWorkflowRef: input.sourceWorkflowRef,
        };
      },
    ),

    beginCoreV2FailureRecovery: restate.handlers.object.exclusive(
      { ingressPrivate: true },
      async (
        ctx: restate.ObjectContext<TaskAuthorityState>,
        input: BootstrapRecoveryHandoffInput,
      ): Promise<TaskAuthorityState> => {
        const [owner, specRevision, existingRecovery, existingSource] = await Promise.all([
          ctx.get("owner") as Promise<TaskAuthorityState["owner"] | null>,
          ctx.get("specRevision") as Promise<number | null>,
          ctx.get("recoveryWorkflowRef") as Promise<string | null>,
          ctx.get("sourceWorkflowRef") as Promise<string | null>,
        ]);
        const originalSource = `restate://CoreV2Workflow/${ctx.key}`;
        if (owner !== "CORE_V2_WORKFLOW" || specRevision !== input.specRevision || input.sourceWorkflowRef !== originalSource) {
          throw new restate.TerminalError(`Task ${ctx.key} is not an eligible CoreV2Workflow failure`, { errorCode: 409 });
        }
        if (existingRecovery !== null && (existingRecovery !== input.recoveryWorkflowRef || existingSource !== input.sourceWorkflowRef)) {
          throw new restate.TerminalError(`Task ${ctx.key} already has a different Core v2 failure successor`, { errorCode: 409 });
        }
        ctx.set("recoveryWorkflowRef", input.recoveryWorkflowRef);
        ctx.set("sourceWorkflowRef", input.sourceWorkflowRef);
        return { owner, specRevision, recoveryWorkflowRef: input.recoveryWorkflowRef, sourceWorkflowRef: input.sourceWorkflowRef };
      },
    ),

    beginSealedRecovery: restate.handlers.object.exclusive(
      { ingressPrivate: true },
      async (
        ctx: restate.ObjectContext<TaskAuthorityState>,
        input: BootstrapRecoveryHandoffInput,
      ): Promise<TaskAuthorityState> => {
        const [owner, specRevision, existingRecovery, existingSource] = await Promise.all([
          ctx.get("owner") as Promise<TaskAuthorityState["owner"] | null>,
          ctx.get("specRevision") as Promise<number | null>,
          ctx.get("recoveryWorkflowRef") as Promise<string | null>,
          ctx.get("sourceWorkflowRef") as Promise<string | null>,
        ]);
        if (owner !== "SEALED_TASK_WORKFLOW" || specRevision !== input.specRevision) {
          throw new restate.TerminalError(`Task ${ctx.key} is not owned by SealedTaskWorkflow revision ${input.specRevision}`, { errorCode: 409 });
        }
        if (existingRecovery !== null && existingRecovery === input.recoveryWorkflowRef && existingSource === input.sourceWorkflowRef) {
          return { owner, specRevision, recoveryWorkflowRef: existingRecovery, sourceWorkflowRef: existingSource };
        }
        const originalSource = `restate://SealedTaskWorkflow/${ctx.key}`;
        const validSource = existingRecovery === null
          ? input.sourceWorkflowRef === originalSource
          : input.sourceWorkflowRef === existingRecovery;
        if (!validSource || input.recoveryWorkflowRef === existingRecovery) {
          throw new restate.TerminalError(`Task ${ctx.key} recovery successor does not extend the current append-only chain`, { errorCode: 409 });
        }
        ctx.set("recoveryWorkflowRef", input.recoveryWorkflowRef);
        ctx.set("sourceWorkflowRef", input.sourceWorkflowRef);
        return { owner, specRevision, recoveryWorkflowRef: input.recoveryWorkflowRef, sourceWorkflowRef: input.sourceWorkflowRef };
      },
    ),

    advanceSealedRecovery: restate.handlers.object.exclusive(
      { ingressPrivate: true },
      async (
        ctx: restate.ObjectContext<TaskAuthorityState>,
        input: BootstrapRecoveryHandoffInput,
      ): Promise<TaskAuthorityState> => {
        const [owner, specRevision, existingRecovery] = await Promise.all([
          ctx.get("owner") as Promise<TaskAuthorityState["owner"] | null>,
          ctx.get("specRevision") as Promise<number | null>,
          ctx.get("recoveryWorkflowRef") as Promise<string | null>,
        ]);
        if (owner !== "SEALED_TASK_WORKFLOW" || specRevision !== input.specRevision ||
            existingRecovery === null || input.sourceWorkflowRef !== existingRecovery ||
            input.recoveryWorkflowRef === existingRecovery) {
          throw new restate.TerminalError(`Task ${ctx.key} cannot advance its sealed recovery chain`, { errorCode: 409 });
        }
        ctx.set("recoveryWorkflowRef", input.recoveryWorkflowRef);
        ctx.set("sourceWorkflowRef", input.sourceWorkflowRef);
        return { owner, specRevision, recoveryWorkflowRef: input.recoveryWorkflowRef, sourceWorkflowRef: input.sourceWorkflowRef };
      },
    ),

    get: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext<TaskAuthorityState>): Promise<TaskAuthorityState | null> => {
        const [owner, specRevision] = await Promise.all([
          ctx.get("owner") as Promise<TaskAuthorityState["owner"] | null>,
          ctx.get("specRevision") as Promise<number | null>,
        ]);
        const [recoveryWorkflowRef, sourceWorkflowRef] = await Promise.all([
          ctx.get("recoveryWorkflowRef") as Promise<string | null>,
          ctx.get("sourceWorkflowRef") as Promise<string | null>,
        ]);
        return owner === null || specRevision === null ? null : {
          owner,
          specRevision,
          ...(recoveryWorkflowRef === null ? {} : { recoveryWorkflowRef }),
          ...(sourceWorkflowRef === null ? {} : { sourceWorkflowRef }),
        };
      },
    ),
  },
});

export const projectBoard = restate.object({
  name: "ProjectBoard",
  handlers: {
    upsertTask: async (
      ctx: restate.ObjectContext<ProjectBoardState>,
      task: TaskProjection,
    ): Promise<void> => {
      const tasks = (await ctx.get("tasks")) ?? {};
      ctx.set("tasks", { ...tasks, [task.taskId]: task });
    },

    upsertBacklog: async (
      ctx: restate.ObjectContext<ProjectBoardState>,
      item: BacklogProjection,
    ): Promise<void> => {
      const backlog = (await ctx.get("backlog")) ?? {};
      try {
        ctx.set("backlog", upsertRuntimeBacklog(backlog, item));
      } catch (error) {
        throw asTerminalError(error);
      }
    },

    syncBacklog: async (
      ctx: restate.ObjectContext<ProjectBoardState>,
      input: BacklogSyncInput,
    ): Promise<BacklogSyncResult> => {
      try {
        const current = (await ctx.get("backlog")) ?? {};
        const { backlog, result } = mergeBacklogBatch(current, input);
        if (result.changed) ctx.set("backlog", backlog);
        return result;
      } catch (error) {
        throw asTerminalError(error);
      }
    },

    get: restate.handlers.object.shared(
      async (
        ctx: restate.ObjectSharedContext<ProjectBoardState>,
      ): Promise<ProjectBoardSnapshot> => {
        const [tasks, backlog] = await Promise.all([
          ctx.get("tasks"),
          ctx.get("backlog"),
        ]);
        return buildBoardSnapshot(
          ctx.key,
          tasks ?? {},
          backlog ?? {},
          await durableNow(ctx),
        );
      },
    ),
  },
});

export const archiveWorkflow = restate.workflow({
  name: "ArchiveWorkflow",
  options: { workflowRetention: { days: 30 } },
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<ArchiveWorkflowState>,
      input: ArchiveWorkflowInput,
    ): Promise<TaskProjection> => {
      const paths = resolveArchivePaths(input);
      let archiveProjection: ArchiveProjection = {
        taskId: input.taskId,
        operationId: archiveOperationId(input.taskId, input.specRevision),
        status: "VALIDATING",
        currentStep: "validate-closure",
        sourcePath: paths.sourcePath,
        targetPath: paths.targetPath,
      };
      ctx.set("projection", archiveProjection);

      let task = updateArchiveStatus(
        input.task,
        "PENDING",
        await durableNow(ctx),
      );
      await boardClient(ctx, input.projectId).upsertTask(task);

      try {
        archiveProjection = {
          ...archiveProjection,
          status: "FREEZING",
          currentStep: "freeze-manifest",
        };
        ctx.set("projection", archiveProjection);
        const frozen = await ctx.run(
          "freeze-archive-manifest",
          () => runArchiveEffect(() => freezeArchiveManifest(input)),
          { maxRetryAttempts: 5 },
        );

        archiveProjection = {
          ...archiveProjection,
          status: "MOVING",
          currentStep: "move-task-package",
          expectedDigest: frozen.digest,
        };
        ctx.set("projection", archiveProjection);
        const result = await ctx.run(
          "move-task-package",
          () =>
            runArchiveEffect(() =>
              archiveTaskPackage(input, frozen.digest),
            ),
          { maxRetryAttempts: 5 },
        );

        archiveProjection = {
          ...archiveProjection,
          status: "ARCHIVED",
          currentStep: "archive-complete",
          expectedDigest: result.digest,
          archivedAt: await durableNow(ctx),
        };
        ctx.set("projection", archiveProjection);
        ctx.set("result", result);

        task = updateArchiveStatus(
          task,
          "ARCHIVED",
          await durableNow(ctx),
          { archivePath: result.targetPath },
        );
        await boardClient(ctx, input.projectId).upsertTask(task);
        return task;
      } catch (error) {
        if (isRestateControlError(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        archiveProjection = {
          ...archiveProjection,
          status: "FAILED",
          currentStep: "archive-failed",
          error: message,
        };
        ctx.set("projection", archiveProjection);
        task = updateArchiveStatus(task, "FAILED", await durableNow(ctx), {
          error: message,
        });
        await boardClient(ctx, input.projectId).upsertTask(task);
        return task;
      }
    },

    status: restate.handlers.workflow.shared(
      async (
        ctx: restate.WorkflowSharedContext<ArchiveWorkflowState>,
      ): Promise<ArchiveProjection | null> => ctx.get("projection"),
    ),
  },
});

export const taskWorkflow = restate.workflow({
  name: "TaskWorkflow",
  options: { workflowRetention: { days: 30 } },
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<TaskWorkflowState>,
      input: TaskWorkflowInput,
    ): Promise<TaskProjection> => {
      if (input.bootstrapEvidence !== undefined) {
        await ctx.run(
          "verify-bootstrap-preflight",
          () => runArchiveEffect(() => verifyBootstrapPreflight({
            repositoryRoot: runtimeRepositoryRoot(),
            taskId: input.taskId,
          })),
          { maxRetryAttempts: 5 },
        );
      }
      await ctx.objectClient(taskAuthority, input.taskId).claim({
        owner: "TASK_WORKFLOW",
        specRevision: input.specRevision,
      });
      let task = createTaskProjection(input, await durableNow(ctx));
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);

      task = transitionTask(
        task,
        "EXECUTING",
        "implementation",
        await durableNow(ctx),
      );
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);

      if (input.bootstrapEvidence === undefined) {
        try {
          await ctx.run(
            "expensive-task-effect",
            () => incrementEffectCounter(input.effectCounterPath, input.taskId),
            { maxRetryAttempts: 5 },
          );
        } catch (error) {
          if (isRestateControlError(error)) throw error;
          const message = error instanceof Error ? error.message : String(error);
          task = failTask(task, message, await durableNow(ctx));
          ctx.set("projection", task);
          await boardClient(ctx, input.projectId).upsertTask(task);
          task = await runTaskArchive(ctx, input, task);
          ctx.set("projection", task);
          return task;
        }
      } else {
        const bootstrapEvidence = input.bootstrapEvidence;
        try {
          await ctx.run(
            "verify-bootstrap-evidence",
            () => runArchiveEffect(() => verifyBootstrapEvidence({
              repositoryRoot: runtimeRepositoryRoot(),
              taskId: input.taskId,
              evidence: bootstrapEvidence,
            })),
            { maxRetryAttempts: 5 },
          );
          task = recordBootstrapEvidence(task, bootstrapEvidence, await durableNow(ctx));
          ctx.set("projection", task);
          await boardClient(ctx, input.projectId).upsertTask(task);

          task = transitionTask(task, "VERIFYING", "verification", await durableNow(ctx));
          ctx.set("projection", task);
          await boardClient(ctx, input.projectId).upsertTask(task);

          const closedTask = closeTask(task, "SUCCEEDED", await durableNow(ctx));
          await ctx.run(
            "verify-and-persist-bootstrap-closure",
            () => runArchiveEffect(() => verifyAndPersistBootstrapClosure({
              repositoryRoot: runtimeRepositoryRoot(),
              activeTasksRoot: bootstrapActiveTasksRoot(),
              task: closedTask,
              evidence: bootstrapEvidence,
              workflowId: `task/${input.taskId}`,
            })),
            { maxRetryAttempts: 5 },
          );
          task = closedTask;
          ctx.set("projection", task);
          await boardClient(ctx, input.projectId).upsertTask(task);
        } catch (error) {
          if (isRestateControlError(error)) throw error;
          const failure = bootstrapFailure(error);
          task = failTask(task, failure.message, await durableNow(ctx));
          ctx.set("projection", task);
          await boardClient(ctx, input.projectId).upsertTask(task);
          await ctx.run(
            "persist-bootstrap-failure",
            () => runArchiveEffect(() => persistBootstrapFailure({
              activeTasksRoot: bootstrapActiveTasksRoot(),
              task,
              evidence: bootstrapEvidence,
              workflowId: `task/${input.taskId}`,
              errorCode: failure.code,
              errorCategory: failure.category,
              errorMessage: failure.message,
              failedStep: "bootstrap-evidence-or-closure",
            })),
            { maxRetryAttempts: 5 },
          );
        }
        task = await runTaskArchive(ctx, bootstrapArchiveInput(input), task);
        ctx.set("projection", task);
        return task;
      }

      task = transitionTask(
        task,
        "VERIFYING",
        "verification",
        await durableNow(ctx),
      );
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);

      await ctx.run("verify-task", async () => ({ passed: true }));
      task = closeTask(task, "SUCCEEDED", await durableNow(ctx));
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);

      task = await runTaskArchive(
        ctx,
        input,
        task,
      );
      ctx.set("projection", task);
      return task;
    },

    status: restate.handlers.workflow.shared(
      async (
        ctx: restate.WorkflowSharedContext<TaskWorkflowState>,
      ): Promise<TaskProjection | null> => ctx.get("projection"),
    ),
  },
});

export const bootstrapFailureRecoveryWorkflow = restate.workflow({
  name: "BootstrapFailureRecoveryWorkflow",
  options: { workflowRetention: { days: 30 } },
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<BootstrapFailureRecoveryState>,
      input: BootstrapFailureRecoveryInput,
    ): Promise<TaskProjection> => {
      if (ctx.key !== input.taskId || input.sourceInput.taskId !== input.taskId ||
          input.sourceInput.projectId !== input.projectId ||
          input.sourceInput.specRevision !== input.specRevision ||
          input.sourceInput.bootstrapEvidence === undefined ||
          input.sourceWorkflowRef !== `restate://TaskWorkflow/${input.taskId}`) {
        throw new restate.TerminalError("Bootstrap recovery input does not match the source Task", {
          errorCode: 400,
        });
      }
      const sourceProjection = await ctx.workflowClient<typeof taskWorkflow>(
        taskWorkflow, input.taskId,
      ).status();
      if (sourceProjection === null) {
        throw new restate.TerminalError(`Task ${input.taskId} has no source projection`, { errorCode: 404 });
      }
      ctx.set("sourceProjection", sourceProjection);
      // Attaching by Invocation ID proves the original keyed run ended with the
      // same deterministic failure; it never submits a second Task execution.
      let sourceFailure: ReturnType<typeof bootstrapFailure> | undefined;
      try {
        await ctx.invocation(restate.InvocationIdParser.fromString(input.sourceInvocationRef)).attach<TaskProjection>();
      } catch (error) {
        if (isRestateControlError(error)) throw error;
        sourceFailure = bootstrapFailure(error);
      }
      if (sourceFailure === undefined || sourceFailure.code !== input.expectedFailureCode ||
          !sourceFailure.message.includes(`Task ${input.taskId}`)) {
        throw new restate.TerminalError(
          `Source Workflow did not fail with ${input.expectedFailureCode}`,
          { errorCode: 409 },
        );
      }
      let baselineFailure: ReturnType<typeof bootstrapFailure> | undefined;
      try {
        await ctx.run(
          "reconcile-bootstrap-baseline-failure",
          () => runArchiveEffect(() => verifyBootstrapPreflight({
            repositoryRoot: runtimeRepositoryRoot(),
            taskId: input.taskId,
          })),
          { maxRetryAttempts: 5 },
        );
      } catch (error) {
        if (isRestateControlError(error)) throw error;
        baselineFailure = bootstrapFailure(error);
      }
      if (baselineFailure === undefined || baselineFailure.code !== input.expectedFailureCode) {
        throw new restate.TerminalError(
          `Current Git evidence does not reproduce ${input.expectedFailureCode}`,
          { errorCode: 409 },
        );
      }

      const recoveryWorkflowRef = `restate://BootstrapFailureRecoveryWorkflow/${input.taskId}`;
      await ctx.objectClient(taskAuthority, input.taskId).beginBootstrapRecovery({
        specRevision: input.specRevision,
        recoveryWorkflowRef,
        sourceWorkflowRef: input.sourceWorkflowRef,
      });
      let task = recoverFailedBootstrapTask(
        sourceProjection,
        `${input.sourceWorkflowRef}#${input.sourceInvocationRef}`,
        baselineFailure.message,
        await durableNow(ctx),
      );
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);
      const bootstrapEvidence = input.sourceInput.bootstrapEvidence;
      await ctx.run(
        "persist-recovered-bootstrap-failure",
        () => runArchiveEffect(() => persistBootstrapFailure({
          activeTasksRoot: bootstrapActiveTasksRoot(),
          task,
          evidence: bootstrapEvidence,
          workflowId: `bootstrap-recovery/${input.taskId}`,
          errorCode: baselineFailure.code,
          errorCategory: baselineFailure.category,
          errorMessage: baselineFailure.message,
          failedStep: "bootstrap-preflight",
          sourceWorkflowRef: `${input.sourceWorkflowRef}#${input.sourceInvocationRef}`,
        })),
        { maxRetryAttempts: 5 },
      );
      const archiveBase = bootstrapArchiveInput(input.sourceInput);
      task = await ctx.workflowClient<typeof archiveWorkflow>(archiveWorkflow, input.taskId).run({
        task,
        taskId: archiveBase.taskId,
        projectId: archiveBase.projectId,
        specRevision: archiveBase.specRevision,
        activeTasksRoot: archiveBase.activeTasksRoot,
        archiveRoot: archiveBase.archiveRoot,
        archivedAt: archiveBase.archivedAt,
        ...(archiveBase.fault === undefined ? {} : { fault: archiveBase.fault }),
      });
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);
      return task;
    },

    status: restate.handlers.workflow.shared(async (
      ctx: restate.WorkflowSharedContext<BootstrapFailureRecoveryState>,
    ): Promise<TaskProjection | null> => ctx.get("projection")),
  },
});

export const sealedTaskWorkflow = restate.workflow({
  name: "SealedTaskWorkflow",
  options: { workflowRetention: { days: 30 } },
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<SealedTaskWorkflowState>,
      input: SealedTaskInput,
    ): Promise<TaskProjection> => {
      if (ctx.key !== input.taskId) {
        throw new restate.TerminalError("Sealed Task key does not match input", { errorCode: 400 });
      }
      let task = createTaskProjection(input, await durableNow(ctx));
      const intent = await ctx.run(
        "prepare-seal-intent",
        () => runArchiveEffect(() => createSealIntent(runtimeRepositoryRoot(), input)),
        { maxRetryAttempts: 5 },
      );
      await ctx.objectClient(taskAuthority, input.taskId).claim({
        owner: "SEALED_TASK_WORKFLOW",
        specRevision: input.specRevision,
      });
      ctx.set("intent", intent);
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);

      task = transitionTask(task, "EXECUTING", "preparing-seal", await durableNow(ctx));
      task = recordSealIntent(task, {
        intentDigest: intent.intentDigest,
        baseCommit: intent.baseCommit,
        archivePath: intent.archivePath,
      }, await durableNow(ctx));
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);

      const evidence = await ctx.promise<SealEvidence>(sealPromiseName(intent)).get();
      ctx.set("evidence", evidence);
      task = transitionTask(
        task,
        "VERIFYING",
        "verifying-result-commit",
        await durableNow(ctx),
        evidence.resultCommit,
      );
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);

      try {
        const receipt = await ctx.run(
          "verify-sealed-result-commit",
          async () => runArchiveEffect(() => verifySealedResultCommit(
            runtimeRepositoryRoot(), intent, evidence, new Date().toISOString(),
          )),
          { maxRetryAttempts: 5 },
        );
        ctx.set("receipt", receipt);
        task = recordSealReceipt(task, receipt.resultCommit, receipt.packageDigest, await durableNow(ctx));
        task = closeTask(task, "SUCCEEDED", await durableNow(ctx));
        task = updateArchiveStatus(task, "ARCHIVED", await durableNow(ctx), {
          archivePath: path.join(runtimeRepositoryRoot(), receipt.archivePath),
        });
      } catch (error) {
        if (isRestateControlError(error)) throw error;
        task = failTask(task, error instanceof Error ? error.message : String(error), await durableNow(ctx));
        task = updateArchiveStatus(task, "FAILED", await durableNow(ctx), {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);
      return task;
    },

    status: restate.handlers.workflow.shared(async (
      ctx: restate.WorkflowSharedContext<SealedTaskWorkflowState>,
    ): Promise<TaskProjection | null> => ctx.get("projection")),

    sealStatus: restate.handlers.workflow.shared(async (
      ctx: restate.WorkflowSharedContext<SealedTaskWorkflowState>,
    ): Promise<SealedTaskStatus | null> => {
      const [projection, intent, evidence, receipt] = await Promise.all([
        ctx.get("projection"), ctx.get("intent"), ctx.get("evidence"), ctx.get("receipt"),
      ]);
      if (projection === null || intent === null) return null;
      return {
        projection,
        intent,
        evidenceSubmitted: evidence !== null,
        ...(evidence === null ? {} : { evidence }),
        ...(receipt === null ? {} : { receipt }),
      };
    }),

    seal: restate.handlers.workflow.shared(async (
      ctx: restate.WorkflowSharedContext<SealedTaskWorkflowState>,
      evidence: SealEvidence,
    ): Promise<SealedTaskStatus> => {
      const [projection, intent, storedEvidence, receipt] = await Promise.all([
        ctx.get("projection"), ctx.get("intent"), ctx.get("evidence"), ctx.get("receipt"),
      ]);
      if (projection === null || intent === null) {
        throw new restate.TerminalError("Task has no Seal Intent", { errorCode: 409 });
      }
      if (evidence.token !== intent.token || evidence.verificationPath !== intent.verificationPath ||
          evidence.docsImpactPath !== intent.docsImpactPath || !evidence.executorId.trim()) {
        throw new restate.TerminalError("Commit Evidence does not match the Seal Intent", { errorCode: 409 });
      }
      if (storedEvidence !== null) {
        if (JSON.stringify(storedEvidence) !== JSON.stringify(evidence)) {
          throw new restate.TerminalError("A different Result Commit Evidence was already submitted", { errorCode: 409 });
        }
        return {
          projection,
          intent,
          evidenceSubmitted: true,
          ...(receipt === null ? {} : { receipt }),
        };
      }
      if (projection.state !== "EXECUTING" || projection.currentStep !== "waiting-result-commit") {
        throw new restate.TerminalError("Task is not waiting for Result Commit Evidence", { errorCode: 409 });
      }
      const promise = ctx.promise<SealEvidence>(sealPromiseName(intent));
      const existing = await promise.peek();
      if (existing === undefined) {
        await promise.resolve(evidence);
      } else if (JSON.stringify(existing) !== JSON.stringify(evidence)) {
        throw new restate.TerminalError("A different Result Commit Evidence was already submitted", { errorCode: 409 });
      }
      return { projection, intent, evidenceSubmitted: true };
    }),
  },
});

export const sealedTaskRecoveryWorkflow = restate.workflow({
  name: "SealedTaskRecoveryWorkflow",
  options: { workflowRetention: { days: 30 } },
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<SealedTaskRecoveryWorkflowState>,
      input: SealedTaskRecoveryInput,
    ): Promise<TaskProjection> => {
      const sourceWorkflowRef = `restate://SealedTaskWorkflow/${input.taskId}`;
      if (ctx.key !== input.taskId || input.recoveryId !== undefined || input.sourceWorkflowRef !== sourceWorkflowRef) {
        throw new restate.TerminalError("Sealed recovery key or source does not match input", { errorCode: 400 });
      }
      const source = await ctx.workflowClient<typeof sealedTaskWorkflow>(sealedTaskWorkflow, input.taskId).sealStatus();
      if (source === null || source.projection.state !== "CLOSED" || source.projection.archiveStatus !== "FAILED" ||
          source.projection.outcome !== "FAILED_TERMINAL" || source.evidence === undefined ||
          source.evidence.resultCommit !== input.rejectedResultCommit || source.intent.token !== input.correctedEvidence.token ||
          source.intent.verificationPath !== input.correctedEvidence.verificationPath ||
          source.intent.docsImpactPath !== input.correctedEvidence.docsImpactPath ||
          source.projection.projectId !== input.projectId || source.projection.specRevision !== input.specRevision) {
        throw new restate.TerminalError("Source Sealed Task is not the exact rejected Evidence failure", { errorCode: 409 });
      }
      ctx.set("sourceStatus", source);
      const recoveryWorkflowRef = `restate://SealedTaskRecoveryWorkflow/${input.taskId}`;
      await ctx.objectClient(taskAuthority, input.taskId).beginSealedRecovery({
        specRevision: input.specRevision,
        recoveryWorkflowRef,
        sourceWorkflowRef,
      });
      let task = recoverFailedSealedTask(
        source.projection, sourceWorkflowRef, input.correctedEvidence.resultCommit, await durableNow(ctx),
      );
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);
      try {
        const receipt = await ctx.run(
          "verify-historical-sealed-result-commit",
          () => runArchiveEffect(() => verifyHistoricalSealedResultCommit(
            runtimeRepositoryRoot(), source.intent, input.correctedEvidence, new Date().toISOString(),
          )),
          { maxRetryAttempts: 5 },
        );
        ctx.set("receipt", receipt);
        task = recordSealReceipt(task, receipt.resultCommit, receipt.packageDigest, await durableNow(ctx));
        task = closeTask(task, "SUCCEEDED", await durableNow(ctx));
        task = updateArchiveStatus(task, "ARCHIVED", await durableNow(ctx), {
          archivePath: path.join(runtimeRepositoryRoot(), receipt.archivePath),
        });
      } catch (error) {
        if (isRestateControlError(error)) throw error;
        task = failTask(task, error instanceof Error ? error.message : String(error), await durableNow(ctx));
        task = updateArchiveStatus(task, "FAILED", await durableNow(ctx), {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);
      return task;
    },
    status: restate.handlers.workflow.shared(async (
      ctx: restate.WorkflowSharedContext<SealedTaskRecoveryWorkflowState>,
    ): Promise<TaskProjection | null> => ctx.get("projection")),
  },
});

export const sealedTaskRecoveryAttemptWorkflow = restate.workflow({
  name: "SealRecoveryAttemptWorkflow",
  options: { workflowRetention: { days: 30 } },
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<SealedTaskRecoveryWorkflowState>,
      input: SealedTaskRecoveryInput,
    ): Promise<TaskProjection> => {
      if (input.recoveryId === undefined || ctx.key !== input.recoveryId ||
          !/^TASK-[A-Z0-9-]+-RECOVERY-[1-9][0-9]*$/.test(input.recoveryId)) {
        throw new restate.TerminalError("Sealed recovery Attempt key does not match input", { errorCode: 400 });
      }
      const rootSourceRef = `restate://SealedTaskWorkflow/${input.taskId}`;
      const rootSource = await ctx.workflowClient<typeof sealedTaskWorkflow>(sealedTaskWorkflow, input.taskId).sealStatus();
      const sourceRef = parseRecoveryWorkflowRef(input.sourceWorkflowRef);
      const sourceProjection = sourceRef.service === "SealedTaskRecoveryWorkflow"
        ? await ctx.workflowClient<typeof sealedTaskRecoveryWorkflow>(
          sealedTaskRecoveryWorkflow, sourceRef.key,
        ).status()
        : await ctx.workflowClient<typeof sealedTaskRecoveryAttemptWorkflow>(
          sealedTaskRecoveryAttemptWorkflow, sourceRef.key,
        ).status();
      if (rootSource === null || sourceProjection === null || sourceProjection.taskId !== input.taskId ||
          sourceProjection.state !== "CLOSED" || sourceProjection.archiveStatus !== "FAILED" ||
          rootSource.evidence === undefined || rootSource.evidence.resultCommit !== input.rejectedResultCommit ||
          rootSource.intent.token !== input.correctedEvidence.token || rootSource.projection.projectId !== input.projectId ||
          rootSource.projection.specRevision !== input.specRevision || input.sourceWorkflowRef === rootSourceRef) {
        throw new restate.TerminalError("Recovery Attempt does not extend the exact failed predecessor", { errorCode: 409 });
      }
      ctx.set("sourceStatus", rootSource);
      const recoveryWorkflowRef = `restate://SealRecoveryAttemptWorkflow/${input.recoveryId}`;
      await ctx.objectClient(taskAuthority, input.taskId).advanceSealedRecovery({
        specRevision: input.specRevision,
        recoveryWorkflowRef,
        sourceWorkflowRef: input.sourceWorkflowRef,
      });
      let task = recoverFailedSealedTask(
        sourceProjection, input.sourceWorkflowRef, input.correctedEvidence.resultCommit, await durableNow(ctx),
      );
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);
      try {
        const receipt = await ctx.run(
          "verify-historical-sealed-result-commit",
          () => runArchiveEffect(() => verifyHistoricalSealedResultCommit(
            runtimeRepositoryRoot(), rootSource.intent, input.correctedEvidence, new Date().toISOString(),
          )),
          { maxRetryAttempts: 5 },
        );
        ctx.set("receipt", receipt);
        task = recordSealReceipt(task, receipt.resultCommit, receipt.packageDigest, await durableNow(ctx));
        task = closeTask(task, "SUCCEEDED", await durableNow(ctx));
        task = updateArchiveStatus(task, "ARCHIVED", await durableNow(ctx), {
          archivePath: path.join(runtimeRepositoryRoot(), receipt.archivePath),
        });
      } catch (error) {
        if (isRestateControlError(error)) throw error;
        task = failTask(task, error instanceof Error ? error.message : String(error), await durableNow(ctx));
        task = updateArchiveStatus(task, "FAILED", await durableNow(ctx), {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      ctx.set("projection", task);
      await boardClient(ctx, input.projectId).upsertTask(task);
      return task;
    },
    status: restate.handlers.workflow.shared(async (
      ctx: restate.WorkflowSharedContext<SealedTaskRecoveryWorkflowState>,
    ): Promise<TaskProjection | null> => ctx.get("projection")),
  },
});

function parseRecoveryWorkflowRef(value: string): {
  service: "SealedTaskRecoveryWorkflow" | "SealRecoveryAttemptWorkflow";
  key: string;
} {
  const match = /^restate:\/\/(SealedTaskRecoveryWorkflow|SealRecoveryAttemptWorkflow)\/([A-Z0-9-]+)$/.exec(value);
  if (match === null) throw new restate.TerminalError("Recovery source Workflow ref is invalid", { errorCode: 400 });
  return {
    service: match[1] as "SealedTaskRecoveryWorkflow" | "SealRecoveryAttemptWorkflow",
    key: match[2]!,
  };
}

function sealPromiseName(intent: SealIntent): string {
  return `result-commit-${intent.intentDigest.slice("sha256:".length)}`;
}

function boardClient(
  ctx: restate.Context,
  projectId: string,
) {
  return ctx.objectClient<typeof projectBoard>(projectBoard, projectId);
}

function bootstrapFailure(error: unknown): { code: string; category: string; message: string } {
  if (error instanceof restate.TerminalError) {
    return {
      code: error.metadata?.["code"] ?? `RESTATE_${error.code}`,
      category: error.metadata?.["category"] ?? "TERMINAL",
      message: error.message,
    };
  }
  const moyeError = asMoyeError(error);
  return { code: moyeError.code, category: moyeError.category, message: moyeError.message };
}

async function durableNow(ctx: restate.Context): Promise<string> {
  return new Date(await ctx.date.now()).toISOString();
}

async function runTaskArchive(
  ctx: restate.WorkflowContext<TaskWorkflowState>,
  input: TaskWorkflowInput,
  task: TaskProjection,
): Promise<TaskProjection> {
  const archiveClient = ctx.workflowClient<typeof archiveWorkflow>(
    archiveWorkflow,
    input.taskId,
  );
  const {
    fault,
    bootstrapEvidence: _bootstrapEvidence,
    ...archiveBase
  } = input;
  const archiveInput: ArchiveWorkflowInput = fault === undefined
    ? { ...archiveBase, task }
    : { ...archiveBase, task, fault };
  const archived = await archiveClient.run(archiveInput);
  await boardClient(ctx, input.projectId).upsertTask(archived);
  return archived;
}

function isRestateControlError(error: unknown): boolean {
  return error instanceof restate.CancelledError || error instanceof restate.PauseError;
}

function runtimeRepositoryRoot(): string {
  return path.resolve(process.env["MOYE_REPOSITORY_ROOT"] ?? process.cwd());
}

function bootstrapActiveTasksRoot(): string {
  return path.join(runtimeRepositoryRoot(), "docs", "delivery", "tasks");
}

function bootstrapArchiveInput(input: TaskWorkflowInput): TaskWorkflowInput {
  const activeTasksRoot = bootstrapActiveTasksRoot();
  return {
    ...input,
    activeTasksRoot,
    archiveRoot: path.join(activeTasksRoot, "archive"),
  };
}

async function runArchiveEffect<T>(effect: () => Promise<T>): Promise<T> {
  try {
    return await effect();
  } catch (error) {
    const moyeError = asMoyeError(error);
    if (moyeError.retryable) {
      throw moyeError;
    }
    throw new restate.TerminalError(moyeError.message, {
      errorCode: terminalStatus(moyeError),
      metadata: {
        code: moyeError.code,
        category: moyeError.category,
        ...moyeError.details,
      },
    });
  }
}

function terminalStatus(error: MoyeError): number {
  switch (error.category) {
    case "VALIDATION":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "UNKNOWN_SIDE_EFFECT":
      return 409;
    case "TRANSIENT_IO":
      return 503;
    case "TERMINAL":
      return 500;
  }
}

function asTerminalError(error: unknown): restate.TerminalError {
  if (error instanceof restate.TerminalError) return error;
  const moyeError = asMoyeError(error);
  return new restate.TerminalError(moyeError.message, {
    errorCode: terminalStatus(moyeError),
    metadata: { code: moyeError.code, category: moyeError.category, ...moyeError.details },
  });
}
