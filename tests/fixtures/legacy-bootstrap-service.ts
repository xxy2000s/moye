import { createServer } from "node:http2";

import * as restate from "@restatedev/restate-sdk";

import { createTaskProjection, transitionTask } from "../../src/domain/task.js";
import type { TaskProjection } from "../../src/domain/task.js";
import { createCoreV2Lifecycle } from "../../src/domain/core-v2-lifecycle.js";
import type { CoreV2WorkflowInput, CoreV2WorkflowProjection } from "../../src/restate/core-v2-services.js";
import { projectBoard, taskAuthority } from "../../src/restate/services.js";
import type { TaskWorkflowInput } from "../../src/restate/services.js";

interface LegacyState { projection: TaskProjection }

const legacyTaskWorkflow = restate.workflow({
  name: "TaskWorkflow",
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<LegacyState>,
      input: TaskWorkflowInput,
    ): Promise<TaskProjection> => {
      await ctx.objectClient(taskAuthority, input.taskId).claim({
        owner: "TASK_WORKFLOW",
        specRevision: input.specRevision,
      });
      let task = createTaskProjection(input, new Date(await ctx.date.now()).toISOString());
      ctx.set("projection", task);
      await ctx.objectClient(projectBoard, input.projectId).upsertTask(task);
      task = transitionTask(task, "EXECUTING", "implementation", new Date(await ctx.date.now()).toISOString());
      ctx.set("projection", task);
      await ctx.objectClient(projectBoard, input.projectId).upsertTask(task);
      throw new restate.TerminalError(
        `Task ${input.taskId} base_commit was not frozen when its manifest was introduced`,
        {
          errorCode: 409,
          metadata: {
            code: "BOOTSTRAP_BASE_COMMIT_NOT_FROZEN",
            category: "CONFLICT",
          },
        },
      );
    },
    status: restate.handlers.workflow.shared(async (
      ctx: restate.WorkflowSharedContext<LegacyState>,
    ): Promise<TaskProjection | null> => ctx.get("projection")),
  },
});

interface LegacyCoreV2State { projection: CoreV2WorkflowProjection }

const legacyCoreV2Workflow = restate.workflow({
  name: "CoreV2Workflow",
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<LegacyCoreV2State>,
      input: CoreV2WorkflowInput,
    ): Promise<CoreV2WorkflowProjection> => {
      await ctx.objectClient(taskAuthority, input.taskId).claim({ owner: "CORE_V2_WORKFLOW", specRevision: 1 });
      const startedAt = new Date(await ctx.date.now()).toISOString();
      const projection: CoreV2WorkflowProjection = {
        schemaVersion: 1,
        taskId: input.taskId,
        projectId: input.projectId,
        title: input.title,
        state: "FAILED_TERMINAL",
        currentStep: "FAILED_TERMINAL",
        lifecycle: createCoreV2Lifecycle({ taskId: input.taskId, specRevision: 1, subjectCommit: input.baseCommit, at: startedAt }),
        attempts: [],
        roleRuns: [],
        artifactRoot: input.artifactRoot,
        startedAt,
        completedAt: startedAt,
        outcome: "FAILED_TERMINAL",
        error: "legacy Core v2 failure before Closure",
      };
      ctx.set("projection", projection);
      await ctx.objectClient(projectBoard, input.projectId).upsertTask({
        taskId: input.taskId, projectId: input.projectId, title: input.title, state: "CLOSED", currentStep: "FAILED_TERMINAL",
        attempt: 0, specRevision: 1, backlogRefs: [], archiveStatus: "NOT_READY", outcome: "FAILED_TERMINAL", error: projection.error!,
        lastEventAt: startedAt, events: [{ sequence: 1, type: "ArchitectRequired", at: startedAt, detail: "r1" }],
      });
      throw new restate.TerminalError(projection.error!, { errorCode: 422 });
    },
    status: restate.handlers.workflow.shared(async (
      ctx: restate.WorkflowSharedContext<LegacyCoreV2State>,
    ): Promise<CoreV2WorkflowProjection | null> => ctx.get("projection")),
  },
});

const port = Number(process.env["RESTATE_SERVICE_PORT"]);
const server = createServer(restate.createEndpointHandler({
  services: [projectBoard, taskAuthority, legacyTaskWorkflow, legacyCoreV2Workflow],
}));
server.listen(port, "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close());
}
