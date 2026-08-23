import { createServer } from "node:http2";
import { join } from "node:path";

import * as restate from "@restatedev/restate-sdk";

import { startBoardServer } from "./board/server.js";
import { loadConfig } from "./config.js";
import {
  archiveWorkflow,
  bootstrapFailureRecoveryWorkflow,
  projectBoard,
  sealedTaskWorkflow,
  sealedTaskRecoveryWorkflow,
  sealedTaskRecoveryAttemptWorkflow,
  taskAuthority,
  taskWorkflow,
} from "./restate/services.js";
import { codingTaskWorkflow } from "./restate/coding-services.js";
import { coreClosureWorkflow } from "./restate/core-services.js";
import { coreV2FailureRecoveryAttemptWorkflow, coreV2FailureRecoveryWorkflow, coreV2Workflow } from "./restate/core-v2-services.js";

const config = loadConfig();
const endpoint = createServer(
  restate.createEndpointHandler({
    services: [
      projectBoard,
      taskAuthority,
      taskWorkflow,
      sealedTaskWorkflow,
      sealedTaskRecoveryWorkflow,
      sealedTaskRecoveryAttemptWorkflow,
      bootstrapFailureRecoveryWorkflow,
      archiveWorkflow,
      codingTaskWorkflow,
      coreClosureWorkflow,
      coreV2Workflow,
      coreV2FailureRecoveryWorkflow,
      coreV2FailureRecoveryAttemptWorkflow,
    ],
  }),
);
endpoint.listen(config.servicePort, "0.0.0.0", () => {
  process.stdout.write(`Moye Restate endpoint listening on ${config.servicePort}\n`);
});

const board = startBoardServer({
  port: config.boardPort,
  projectId: config.projectId,
  ingressUrl: config.restateIngressUrl,
  restateAdminUrl: config.restateAdminUrl,
  publicRoot: join(process.cwd(), "public"),
  artifactRoots: [...new Set([...config.artifactRoots, config.liveRuntimeRoot])],
  liveRuntimeRoot: config.liveRuntimeRoot,
  repositoryRoots: config.repositoryRoots,
  observability: config.observability,
});
board.on("listening", () => {
  process.stdout.write(`Moye board listening on ${config.boardPort}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    endpoint.close();
    board.close();
  });
}
