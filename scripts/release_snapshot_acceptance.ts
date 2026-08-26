import { cp, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sourceRoot = process.cwd();
const temporary = await mkdtemp(path.join(os.tmpdir(), "moye-release-snapshot-"));
const snapshotRoot = path.join(temporary, "moye");
const excluded = new Set([".git", "node_modules", "dist", "package-dist", ".moye-runtime", ".playwright-cli", "coverage", "output"]);

try {
  await cp(sourceRoot, snapshotRoot, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(sourceRoot, source);
      if (relative === "") return true;
      return !excluded.has(relative.split(path.sep)[0]!);
    },
  });
  await run("git", ["init", "-b", "release-snapshot"], snapshotRoot);
  await run("git", ["config", "user.name", "Moye Release Snapshot"], snapshotRoot);
  await run("git", ["config", "user.email", "release-snapshot@moye.invalid"], snapshotRoot);
  await run("git", ["add", "."], snapshotRoot);
  await run("git", ["commit", "-m", "chore: freeze release verification snapshot"], snapshotRoot);
  await run("npm", ["ci"], snapshotRoot, 300_000);
  const result = await run("npm", ["run", "release:verify"], snapshotRoot, 900_000, {
    ...process.env,
    MOYE_RELEASE_OUTPUT: process.env["MOYE_RELEASE_OUTPUT"] ?? path.join(sourceRoot, ".moye-runtime", "release", "0.1.0-rc.1"),
    MOYE_RELEASE_IMAGE: process.env["MOYE_RELEASE_IMAGE"] ?? "moye:0.1.0-rc.1",
    MOYE_RELEASE_VERSION: process.env["MOYE_RELEASE_VERSION"] ?? "0.1.0-rc.1",
  });
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function run(command: string, args: readonly string[], cwd: string, timeout = 120_000, env = process.env): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, [...args], { cwd, timeout, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...env, npm_config_update_notifier: "false" } });
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(`${command} ${args.join(" ")} failed: ${detail.message ?? "unknown"}\n${detail.stdout ?? ""}\n${detail.stderr ?? ""}`);
  }
}
