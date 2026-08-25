import { createServer } from "node:http2";
import * as restate from "@restatedev/restate-sdk";

import type { CoreV2WorkflowProjection } from "../../src/restate/core-v2-services.js";
import { taskAuthority } from "../../src/restate/services.js";

interface FixtureState { readonly projection: CoreV2WorkflowProjection }

const fixtureCoreV2Workflow = restate.workflow({
  name: "CoreV2Workflow",
  handlers: {
    run: async (ctx: restate.WorkflowContext<FixtureState>, projection: CoreV2WorkflowProjection): Promise<CoreV2WorkflowProjection> => {
      if (ctx.key !== projection.taskId) throw new restate.TerminalError("Fixture key mismatch", { errorCode: 409 });
      await ctx.objectClient(taskAuthority, projection.taskId).claim({
        owner: "CORE_V2_WORKFLOW",
        specRevision: projection.lifecycle.specRevision,
      });
      ctx.set("projection", projection);
      return projection;
    },
    status: restate.handlers.workflow.shared(
      async (ctx: restate.WorkflowSharedContext<FixtureState>): Promise<CoreV2WorkflowProjection | null> =>
        ctx.get("projection") as Promise<CoreV2WorkflowProjection | null>,
    ),
  },
});

const port = Number(process.env["RESTATE_SERVICE_PORT"] ?? "9080");
createServer(restate.createEndpointHandler({ services: [taskAuthority, fixtureCoreV2Workflow] }))
  .listen(port, "0.0.0.0", () => process.stdout.write(`Historical Core v2 fixture listening on ${port}\n`));
