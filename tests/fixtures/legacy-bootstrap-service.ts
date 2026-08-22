import { createServer } from "node:http2";

import * as restate from "@restatedev/restate-sdk";

import { createTaskProjection, transitionTask } from "../../src/domain/task.js";
import type { TaskProjection } from "../../src/domain/task.js";
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

const port = Number(process.env["RESTATE_SERVICE_PORT"]);
const server = createServer(restate.createEndpointHandler({
  services: [projectBoard, taskAuthority, legacyTaskWorkflow],
}));
server.listen(port, "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close());
}
