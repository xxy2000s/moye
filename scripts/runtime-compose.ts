#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

import { planRuntimeAction, runtimeBindDirectories, type RuntimeAction } from "../src/runtime/operations.js";

const action = process.argv[2] ?? "help";
const compose = detectCompose();
if (!isRuntimeAction(action)) {
  process.stderr.write("Usage: tsx scripts/runtime-compose.ts <up|down|status|config|logs|upgrade|rollback|uninstall|purge-data>\n");
  process.exit(2);
}
const plan = planRuntimeAction(action);
if (plan.requiresDirectories) {
  for (const directory of runtimeBindDirectories()) mkdirSync(directory, { recursive: true });
}

const result = spawnSync(compose.executable, [...compose.prefix, ...plan.argv], {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: false,
});
if (result.error !== undefined) throw result.error;
process.exit(result.status ?? 1);

function detectCompose(): { readonly executable: string; readonly prefix: readonly string[] } {
  const plugin = spawnSync("docker", ["compose", "version"], { stdio: "ignore", shell: false });
  if (plugin.status === 0) return { executable: "docker", prefix: ["compose"] };
  const standalone = spawnSync("docker-compose", ["version"], { stdio: "ignore", shell: false });
  if (standalone.status === 0) return { executable: "docker-compose", prefix: [] };
  throw new Error("需要 Docker Compose：请安装 docker compose 插件或 docker-compose 命令");
}

function isRuntimeAction(value: string): value is RuntimeAction {
  return ["up", "down", "status", "config", "logs", "upgrade", "rollback", "uninstall", "purge-data"].includes(value);
}
