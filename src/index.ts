import { createServer } from "node:http2";
import { join } from "node:path";

import * as restate from "@restatedev/restate-sdk";

import { startBoardServer } from "./board/server.js";
import { loadConfig } from "./config.js";
import { archiveWorkflow, projectBoard, taskAuthority, taskWorkflow } from "./restate/services.js";
import { codingTaskWorkflow } from "./restate/coding-services.js";

const config = loadConfig();
const endpoint = createServer(
  restate.createEndpointHandler({
    services: [projectBoard, taskAuthority, taskWorkflow, archiveWorkflow, codingTaskWorkflow],
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
  artifactRoots: config.artifactRoots,
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
