import * as restate from "@restatedev/restate-sdk";

import {
  archiveTaskPackage,
  freezeArchiveManifest,
  resolveArchivePaths,
} from "../archive/file-archive.js";
import type {
  ArchiveInput,
  ArchiveMoveResult,
  ArchiveProjection,
} from "../domain/archive.js";
import { archiveOperationId } from "../domain/archive.js";
import type { BacklogProjection } from "../domain/backlog.js";
import { buildBoardSnapshot } from "../domain/board.js";
import type { ProjectBoardSnapshot } from "../domain/board.js";
import { asMoyeError, MoyeError } from "../domain/errors.js";
import {
  closeTask,
  createTaskProjection,
  failTask,
  transitionTask,
  updateArchiveStatus,
} from "../domain/task.js";
import type { TaskProjection } from "../domain/task.js";
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
}

interface ArchiveWorkflowInput extends ArchiveInput {
  readonly task: TaskProjection;
}

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
      ctx.set("backlog", { ...backlog, [item.backlogId]: item });
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

      task = await runTaskArchive(ctx, input, task);
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

function boardClient(
  ctx: restate.Context,
  projectId: string,
) {
  return ctx.objectClient<typeof projectBoard>(projectBoard, projectId);
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
  const { fault, ...archiveBase } = input;
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
