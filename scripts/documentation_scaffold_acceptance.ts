import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "moye-standard-docs-acceptance-"));
const packRoot = path.join(temporaryRoot, "pack");
const toolRoot = path.join(temporaryRoot, "tool");
const blankRoot = path.join(temporaryRoot, "blank-external-project");
const conflictRoot = path.join(temporaryRoot, "occupied-external-project");
const symlinkRoot = path.join(temporaryRoot, "symlink-external-project");
const outsideRoot = path.join(temporaryRoot, "outside");

try {
  await Promise.all([packRoot, toolRoot, blankRoot, conflictRoot, symlinkRoot, outsideRoot].map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(path.join(toolRoot, "package.json"), `${JSON.stringify({ private: true }, null, 2)}\n`);
  const pack = JSON.parse((await run("npm", ["pack", "--json", "--pack-destination", packRoot], repositoryRoot, 180_000)).stdout) as Array<{ filename: string; integrity: string; shasum: string }>;
  const tarball = path.join(packRoot, pack[0]!.filename);
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], toolRoot, 180_000);
  const cli = path.join(toolRoot, "node_modules", ".bin", "moye");

  await gitInit(blankRoot);
  const plan = json(await run(cli, ["init", "--docs", "standard", "--dir", blankRoot, "--project-id", "blank-external-project"], blankRoot));
  if (plan.mode !== "plan" || plan.initialized !== false || plan.conflicts.length !== 0 || plan.files.some((file: { status: string }) => file.status !== "create")) throw new Error("blank plan did not remain read-only");
  await expectMissing(path.join(blankRoot, ".moye"));

  const applied = json(await run(cli, ["init", "--docs", "standard", "--apply", "--dir", blankRoot, "--project-id", "blank-external-project"], blankRoot));
  if (applied.initialized !== true || applied.created.length !== applied.files.length || applied.conflicts.length !== 0) throw new Error("blank apply did not create the complete plan");
  const projectValidation = json(await run(cli, ["project", "validate", "--file", path.join(blankRoot, ".moye", "project.yaml")], blankRoot));
  const docsValidation = json(await run(process.execPath, ["scripts/docs_validate.mjs"], blankRoot));
  const repeated = json(await run(cli, ["init", "--docs", "standard", "--apply", "--dir", blankRoot, "--project-id", "blank-external-project"], blankRoot));
  if (repeated.created.length !== 0 || repeated.unchanged.length !== repeated.files.length || repeated.scaffoldDigest !== applied.scaffoldDigest) throw new Error("second apply was not idempotent");
  await git(blankRoot, ["add", "."]);
  await git(blankRoot, ["diff", "--cached", "--check"]);
  await git(blankRoot, ["-c", "user.name=Moye Acceptance", "-c", "user.email=acceptance@moye.invalid", "commit", "-qm", "standard documentation scaffold"]);
  if ((await git(blankRoot, ["status", "--porcelain=v1"])).trim()) throw new Error("blank external project is not clean after scaffold commit");

  await gitInit(conflictRoot);
  await mkdir(path.join(conflictRoot, "docs"));
  await writeFile(path.join(conflictRoot, "README.md"), "# Existing README\n");
  await writeFile(path.join(conflictRoot, "docs", "README.md"), "# Existing docs\n");
  const conflictBefore = await fileDigest(path.join(conflictRoot, "README.md"));
  const conflict = await runFailure(cli, ["init", "--docs", "standard", "--apply", "--dir", conflictRoot, "--project-id", "occupied-external-project"], conflictRoot, 2);
  const conflictPlan = json(conflict);
  if (conflictPlan.initialized !== false || conflictPlan.conflicts.length !== 2 || conflictBefore !== await fileDigest(path.join(conflictRoot, "README.md"))) throw new Error("occupied project conflict was not fail-closed");
  const forced = await runFailure(cli, ["init", "--docs", "standard", "--apply", "--force", "--dir", conflictRoot, "--project-id", "occupied-external-project"], conflictRoot, 1);
  if (!forced.stderr.includes("--force cannot be used with --docs standard")) throw new Error("--force did not fail closed for the standard scaffold");
  await expectMissing(path.join(conflictRoot, "AGENTS.md"));
  await expectMissing(path.join(conflictRoot, ".moye"));

  await gitInit(symlinkRoot);
  await symlink(outsideRoot, path.join(symlinkRoot, "docs"));
  const symlinkResult = json(await runFailure(cli, ["init", "--docs", "standard", "--apply", "--dir", symlinkRoot, "--project-id", "symlink-external-project"], symlinkRoot, 2));
  if (!symlinkResult.conflicts.some((item: { conflictCode?: string }) => item.conflictCode === "SYMLINK")) throw new Error("symlink conflict was not reported");
  if ((await collect(outsideRoot)).length !== 0) throw new Error("scaffold wrote through a symlink");

  const evidenceCore = {
    schemaVersion: 1,
    validationKind: "REAL_PACKED_STANDARD_DOCUMENTATION_SCAFFOLD",
    templateVersion: applied.templateVersion,
    package: { filename: path.basename(tarball), integrity: pack[0]!.integrity, shasum: pack[0]!.shasum, digest: await fileDigest(tarball) },
    blank: {
      scaffoldDigest: applied.scaffoldDigest,
      planDigest: plan.planDigest,
      fileCount: applied.files.length,
      manifestDigest: projectValidation.digest,
      documentationPolicy: projectValidation.documentationPolicy,
      docsValidation,
      repeatedPlanDigest: repeated.planDigest,
      cleanGit: true,
    },
    occupied: { exitCode: 2, forceExitCode: 1, conflictPaths: conflictPlan.conflicts.map((item: { path: string }) => item.path), readmeDigestPreserved: conflictBefore },
    symlink: { exitCode: 2, outsideWriteCount: 0 },
    fixtureRootKind: "os-temporary-directory-outside-moye",
  };
  const evidence = { ...evidenceCore, evidenceDigest: digestCanonical(evidenceCore) };
  const output = path.resolve(process.env["MOYE_DOCUMENTATION_SCAFFOLD_OUTPUT"] ?? path.join(repositoryRoot, ".moye-runtime", "acceptance", "documentation-scaffold.json"));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function gitInit(root: string): Promise<void> { await run("git", ["init", "-q", "-b", "main"], root); }
async function git(root: string, argv: readonly string[]): Promise<string> { return (await run("git", ["-C", root, ...argv], root)).stdout; }
async function expectMissing(target: string): Promise<void> { try { await access(target); throw new Error(`${target} unexpectedly exists`); } catch (error) { if (!isCode(error, "ENOENT")) throw error; } }
async function fileDigest(target: string): Promise<string> { return `sha256:${createHash("sha256").update(await readFile(target)).digest("hex")}`; }
async function collect(root: string): Promise<string[]> { const { readdir } = await import("node:fs/promises"); return (await readdir(root)).sort(); }
function json(result: { stdout: string }): any { return JSON.parse(result.stdout); }
function isCode(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code; }
function digestCanonical(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`; }

async function run(command: string, argv: readonly string[], cwd: string, timeout = 120_000): Promise<{ stdout: string; stderr: string }> {
  try { return await execFileAsync(command, [...argv], { cwd, timeout, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) { const detail = error as { message?: string; stdout?: string; stderr?: string }; throw new Error(`${command} ${argv.join(" ")} failed: ${detail.message ?? "unknown"}\n${detail.stdout ?? ""}\n${detail.stderr ?? ""}`); }
}

async function runFailure(command: string, argv: readonly string[], cwd: string, expectedExitCode: number): Promise<{ stdout: string; stderr: string }> {
  try { await execFileAsync(command, [...argv], { cwd, timeout: 120_000, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) {
    const detail = error as { code?: number; stdout?: string; stderr?: string };
    if (detail.code !== expectedExitCode) throw error;
    return { stdout: detail.stdout ?? "", stderr: detail.stderr ?? "" };
  }
  throw new Error(`${command} unexpectedly exited zero`);
}
