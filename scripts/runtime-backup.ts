#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { archiveFileName, parseBackupManifest, sha256File, type RuntimeBackupManifestV1 } from "../src/runtime/backup.js";
import { composeProjectName, runtimeVolumeNames } from "../src/runtime/operations.js";

const action = process.argv[2];
const directoryArgument = process.argv[3];
if ((action !== "backup" && action !== "restore") || directoryArgument === undefined) {
  process.stderr.write("Usage: tsx scripts/runtime-backup.ts <backup|restore> <absolute-or-relative-directory>\n");
  process.exit(2);
}

const directory = path.resolve(directoryArgument);
if (directory === path.parse(directory).root) throw new Error("Backup directory cannot be the filesystem root");
const compose = detectCompose();
const volumes = runtimeVolumeNames();

if (action === "backup") await backup();
else await restore();

async function backup(): Promise<void> {
  await mkdir(directory, { recursive: true });
  composeRun(["stop", "register", "moye", "restate"]);
  try {
    const archives: RuntimeBackupManifestV1["archives"][number][] = [];
    for (const volume of volumes) {
      const file = archiveFileName(volume);
      docker(["run", "--rm", "--mount", `type=volume,source=${volume},target=/source,readonly`,
        "--mount", `type=bind,source=${directory},target=/backup`, "alpine:3.20",
        "tar", "-C", "/source", "-czf", `/backup/${file}`, "."]);
      archives.push({ volume, file, sha256: await sha256File(path.join(directory, file)) });
    }
    const manifest: RuntimeBackupManifestV1 = {
      schemaVersion: 1,
      composeProject: composeProjectName(),
      createdAt: new Date().toISOString(),
      image: process.env["MOYE_IMAGE"] ?? "moye:0.1.0-local",
      restateNodeName: process.env["RESTATE_NODE_NAME"] ?? "moye-runtime",
      archives,
    };
    await writeFile(path.join(directory, "runtime-backup.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    composeRun(["up", "-d", "restate", "moye", "register"]);
  }
}

async function restore(): Promise<void> {
  if (process.env["MOYE_CONFIRM_RESTORE"] !== "RESTORE_RUNTIME_DATA") {
    throw new Error("restore requires MOYE_CONFIRM_RESTORE=RESTORE_RUNTIME_DATA");
  }
  const manifest = parseBackupManifest(JSON.parse(await readFile(path.join(directory, "runtime-backup.json"), "utf8")));
  const targetNodeName = process.env["RESTATE_NODE_NAME"] ?? "moye-runtime";
  if (targetNodeName !== manifest.restateNodeName) {
    throw new Error(`Restore requires RESTATE_NODE_NAME=${manifest.restateNodeName}`);
  }
  composeRun(["down", "--remove-orphans"]);
  const restorePlan: { readonly archive: RuntimeBackupManifestV1["archives"][number]; readonly targetVolume: string }[] = [];
  for (const [index, archive] of manifest.archives.entries()) {
    const targetVolume = volumes[index];
    if (targetVolume === undefined) throw new Error("Backup volume mapping is incomplete");
    if (await sha256File(path.join(directory, archive.file)) !== archive.sha256) throw new Error(`Digest mismatch for ${archive.file}`);
    docker(["volume", "create", targetVolume]);
    const listing = docker(["run", "--rm", "--mount", `type=volume,source=${targetVolume},target=/target`,
      "alpine:3.20", "ls", "-A", "/target"], true).trim();
    if (listing) throw new Error(`Restore target ${targetVolume} is not empty`);
    restorePlan.push({ archive, targetVolume });
  }
  for (const { archive, targetVolume } of restorePlan) {
    docker(["run", "--rm", "--mount", `type=volume,source=${targetVolume},target=/target`,
      "--mount", `type=bind,source=${directory},target=/backup,readonly`, "alpine:3.20",
      "tar", "-C", "/target", "-xzf", `/backup/${archive.file}`]);
  }
  composeRun(["up", "-d", "restate", "moye", "register"]);
}

function composeRun(args: readonly string[]): void {
  run(compose.executable, [...compose.prefix, ...args]);
}

function docker(args: readonly string[], capture = false): string {
  return run("docker", args, capture);
}

function run(executable: string, args: readonly string[], capture = false): string {
  const result = spawnSync(executable, [...args], { cwd: process.cwd(), encoding: "utf8", stdio: capture ? "pipe" : "inherit", shell: false });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} ${args[0] ?? ""} failed with ${String(result.status)}`);
  return capture ? result.stdout : "";
}

function detectCompose(): { readonly executable: string; readonly prefix: readonly string[] } {
  const plugin = spawnSync("docker", ["compose", "version"], { stdio: "ignore", shell: false });
  if (plugin.status === 0) return { executable: "docker", prefix: ["compose"] };
  const standalone = spawnSync("docker-compose", ["version"], { stdio: "ignore", shell: false });
  if (standalone.status === 0) return { executable: "docker-compose", prefix: [] };
  throw new Error("Docker Compose is required");
}
