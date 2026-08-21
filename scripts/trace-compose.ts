#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const action = process.argv[2] ?? "help";
const compose = detectCompose();
const actionArgs = action === "up"
  ? ["--profile", "trace", "up", "-d", "phoenix"]
  : action === "down"
    ? ["--profile", "trace", "down"]
    : action === "status"
      ? ["--profile", "trace", "ps", "phoenix"]
      : undefined;

if (actionArgs === undefined) {
  process.stderr.write("Usage: tsx scripts/trace-compose.ts <up|down|status>\n");
  process.exit(2);
}

const result = spawnSync(compose.executable, [...compose.prefix, ...actionArgs], {
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
