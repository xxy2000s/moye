import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { invoke } from "../restate/ingress.js";
import type { TaskAuthorityState } from "../restate/services.js";
import { loadProjectManifest } from "./project-manifest.js";

const execFileAsync = promisify(execFile);

export interface DoctorCheckV1 {
  readonly id: string;
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly detail: string;
}

export interface DoctorReportV1 {
  readonly apiVersion: 1;
  readonly ok: boolean;
  readonly projectId: string | null;
  readonly checks: readonly DoctorCheckV1[];
}

export async function runProjectDoctor(input: {
  readonly manifestPath: string;
  readonly ingressUrl: string;
  readonly boardUrl: string;
  readonly runtimeRoot?: string;
}): Promise<DoctorReportV1> {
  const checks: DoctorCheckV1[] = [];
  let loaded;
  try {
    loaded = await loadProjectManifest(input.manifestPath);
    checks.push(check("manifest", "PASS", `schema ${loaded.manifest.schemaVersion}, ${loaded.digest}`));
  } catch (error) {
    checks.push(check("manifest", "FAIL", message(error)));
    return report(null, checks);
  }

  await capture(checks, "git", "FAIL", async () => {
    const top = await command("git", ["-C", loaded.repositoryRoot, "rev-parse", "--show-toplevel"]);
    return `repository ${top}`;
  });
  await capture(checks, "git-clean", "FAIL", async () => {
    const dirty = await command("git", ["-C", loaded.repositoryRoot, "status", "--porcelain=v1"]);
    if (dirty.trim()) throw new Error("worktree is dirty; commit project and .moye/project.yaml before task start");
    return "worktree clean";
  });
  await capture(checks, "git-target", "FAIL", async () => {
    const target = await command("git", ["-C", loaded.repositoryRoot, "rev-parse", `${loaded.manifest.repository.targetRef}^{commit}`]);
    const head = await command("git", ["-C", loaded.repositoryRoot, "rev-parse", "HEAD"]);
    if (target !== head) throw new Error(`${loaded.manifest.repository.targetRef} does not equal current HEAD`);
    return `${loaded.manifest.repository.targetRef} -> ${target}`;
  });
  const runner = loaded.manifest.agent.runner === "codex" ? "codex" : "claude";
  await capture(checks, "agent", "FAIL", async () => `${runner} ${await command(runner, ["--version"])}`);
  for (const test of loaded.manifest.tests) {
    await capture(checks, `test:${test.id}`, "FAIL", async () => {
      const executable = await findExecutable(test.argv[0]!);
      return `${executable}; argv=${JSON.stringify(test.argv)}`;
    });
  }
  if (loaded.manifest.tests.length === 0) checks.push(check("tests", "FAIL", "no trusted test command configured"));

  await capture(checks, "artifacts", "FAIL", async () => {
    const runtimeRoot = path.resolve(input.runtimeRoot ?? path.join(os.homedir(), ".moye", "runtime"));
    const root = path.join(runtimeRoot, loaded.manifest.project.id);
    await mkdir(root, { recursive: true });
    const probe = path.join(root, `.doctor-${randomBytes(6).toString("hex")}`);
    await writeFile(probe, "moye-doctor\n", { flag: "wx", mode: 0o600 });
    await unlink(probe);
    return `writable ${root}`;
  });
  await capture(checks, "docker", "WARN", async () => `available: ${await command("docker", ["info", "--format", "{{.ServerVersion}}"], 15_000)}`);
  await capture(checks, "restate", "FAIL", async () => {
    await invoke<TaskAuthorityState | null>(input.ingressUrl, "TaskAuthority", "TASK-DOCTOR-PROBE", "get");
    return `reachable ${input.ingressUrl}`;
  });
  await capture(checks, "board", "FAIL", async () => {
    const response = await fetch(`${input.boardUrl.replace(/\/$/u, "")}/api/board`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return `reachable ${input.boardUrl}`;
  });
  return report(loaded.manifest.project.id, checks);
}

async function capture(checks: DoctorCheckV1[], id: string, severity: "WARN" | "FAIL", operation: () => Promise<string>): Promise<void> {
  try { checks.push(check(id, "PASS", await operation())); }
  catch (error) { checks.push(check(id, severity, message(error))); }
}

function report(projectId: string | null, checks: DoctorCheckV1[]): DoctorReportV1 {
  return Object.freeze({ apiVersion: 1, ok: !checks.some((item) => item.status === "FAIL"), projectId, checks: Object.freeze(checks) });
}

function check(id: string, status: DoctorCheckV1["status"], detail: string): DoctorCheckV1 {
  return Object.freeze({ id, status, detail });
}

async function command(executable: string, args: readonly string[], timeout = 30_000): Promise<string> {
  const result = await execFileAsync(executable, [...args], { timeout, maxBuffer: 2 * 1024 * 1024 });
  return `${result.stdout}${result.stderr}`.trim();
}

async function findExecutable(executable: string): Promise<string> {
  if (executable.includes(path.sep)) {
    const candidate = path.resolve(executable);
    await access(candidate);
    return candidate;
  }
  for (const directory of (process.env["PATH"] ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, executable);
    try { await access(candidate); return candidate; } catch { /* continue */ }
  }
  throw new Error(`${executable} is not available on PATH`);
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
