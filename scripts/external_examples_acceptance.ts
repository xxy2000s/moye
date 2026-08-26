import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { digestCanonical } from "../src/release/manifest.js";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const tarball = path.resolve(process.env["MOYE_EXAMPLES_TARBALL"] ?? path.join(root, ".moye-runtime", "release", "0.1.0-rc.1", "moye-0.1.0.tgz"));
await readFile(tarball);
const temporary = await mkdtemp(path.join(os.tmpdir(), "moye-examples-"));
const toolRoot = path.join(temporary, "tool");
const cli = path.join(toolRoot, "node_modules", ".bin", "moye");
const reports: Array<Record<string, unknown>> = [];

try {
  await mkdir(toolRoot, { recursive: true });
  await writeFile(path.join(toolRoot, "package.json"), `${JSON.stringify({ private: true }, null, 2)}\n`);
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], toolRoot, 180_000);

  const bootstrap = path.join(temporary, "bootstrap");
  await mkdir(bootstrap, { recursive: true });
  await gitInit(bootstrap);
  const initialized = JSON.parse((await run(cli, ["init", "--dir", bootstrap, "--project-id", "bootstrap-example"], bootstrap)).stdout) as { digest: string };

  for (const example of ["node-typescript", "python", "minimal-git"] as const) {
    const project = path.join(temporary, example);
    await cp(path.join(root, "examples", example), project, { recursive: true });
    await assertNoSourceDependency(project);
    await gitInit(project);
    let testCommand: readonly string[];
    if (example === "node-typescript") {
      await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", tarball], project, 180_000);
      testCommand = ["npm", "test"];
    } else if (example === "python") testCommand = ["python3", "-m", "unittest", "discover", "-s", "tests"];
    else testCommand = ["git", "diff", "--check", "HEAD"];
    const test = await run(testCommand[0]!, testCommand.slice(1), project, 120_000);
    const manifest = JSON.parse((await run(cli, ["project", "validate", "--file", path.join(project, ".moye", "project.yaml")], project)).stdout) as { projectId: string; digest: string; schemaVersion: number; documentationPolicy: string };
    reports.push({ example, projectId: manifest.projectId, manifestDigest: manifest.digest, schemaVersion: manifest.schemaVersion, documentationPolicy: manifest.documentationPolicy, testArgv: testCommand, exitCode: 0, stdoutDigest: digestCanonical(test.stdout) });
  }
  const evidence = { schemaVersion: 1, taskId: "TASK-0073", tarball: path.basename(tarball), initializedDigest: initialized.digest, examples: reports, evidenceDigest: digestCanonical({ initialized: initialized.digest, reports }) };
  const output = path.resolve(process.env["MOYE_EXAMPLES_OUTPUT"] ?? path.join(root, ".moye-runtime", "acceptance", "framework-examples.json"));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function gitInit(directory: string): Promise<void> {
  await run("git", ["init", "-b", "main"], directory);
  await run("git", ["config", "user.name", "Moye Example"], directory);
  await run("git", ["config", "user.email", "example@moye.invalid"], directory);
  await run("git", ["add", "."], directory);
  await run("git", ["commit", "--allow-empty", "-m", "example baseline"], directory);
}

async function assertNoSourceDependency(directory: string): Promise<void> {
  const files = await collect(directory);
  for (const file of files) {
    const content = await readFile(file, "utf8");
    if (content.includes("docs/graph.yaml") || content.includes("../../src/") || /file:\.\.\//.test(content)) throw new Error(`example source dependency detected in ${file}`);
  }
}

async function collect(directory: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collect(target));
    else if (entry.isFile()) result.push(target);
  }
  return result;
}

async function run(command: string, args: readonly string[], cwd: string, timeout = 120_000): Promise<{ stdout: string; stderr: string }> {
  try { return await execFileAsync(command, [...args], { cwd, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) { const detail = error as { message?: string; stdout?: string; stderr?: string }; throw new Error(`${command} ${args.join(" ")} failed: ${detail.message ?? "unknown"}\n${detail.stdout ?? ""}\n${detail.stderr ?? ""}`); }
}
