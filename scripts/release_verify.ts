import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createReleaseManifestV1, digestBytes, digestCanonical } from "../src/release/manifest.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as { name: string; version: string; dependencies: Record<string, string> };
const version = process.env["MOYE_RELEASE_VERSION"] ?? `${packageJson.version}-rc.1`;
const channel = version.includes("-rc.") ? "rc" as const : "ga" as const;
const worktreeStatus = (await run("git", ["status", "--porcelain=v1"], repositoryRoot)).stdout.trim();
if (worktreeStatus !== "") throw new Error("release verification requires a clean committed source tree");
const gitCommit = (await run("git", ["rev-parse", "HEAD"], repositoryRoot)).stdout.trim();
const outputRoot = path.resolve(process.env["MOYE_RELEASE_OUTPUT"] ?? path.join(repositoryRoot, ".moye-runtime", "release", version));
const temporary = await mkdtemp(path.join(os.tmpdir(), "moye-release-verify-"));
const packRoot = path.join(temporary, "pack");
const installRoot = path.join(temporary, "consumer");
const fixtureRoot = path.join(temporary, "project");
const imageReference = process.env["MOYE_RELEASE_IMAGE"] ?? `moye:${version}`;

try {
  await mkdir(packRoot, { recursive: true });
  const packed = await run("npm", ["pack", "--json", "--pack-destination", packRoot], repositoryRoot, 180_000);
  const packResult = (JSON.parse(packed.stdout) as Array<{ filename: string; integrity: string; size: number; files: Array<{ path: string }> }>)[0];
  if (packResult === undefined) throw new Error("npm pack did not return an artifact");
  const tarball = path.join(packRoot, packResult.filename);
  const tarballBytes = await readFile(tarball);
  const packageDigest = digestBytes(tarballBytes);
  auditPackageFiles(packResult.files.map((entry) => entry.path));
  await auditArchiveContent(tarball, temporary);

  await mkdir(installRoot, { recursive: true });
  await writeFile(path.join(installRoot, "package.json"), `${JSON.stringify({ name: "moye-clean-install", private: true, type: "module" }, null, 2)}\n`);
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], installRoot, 180_000);
  const publicProbe = await run("node", ["--input-type=module", "-e", [
    "const core=await import('moye/core')",
    "const client=await import('moye/client')",
    "const plugin=await import('moye/plugin-sdk')",
    "console.log(JSON.stringify({schema:core.PROJECT_SCHEMA_VERSION,client:typeof client.MoyeClient,plugin:plugin.PLUGIN_API_VERSION_V1}))",
  ].join(";")], installRoot);
  const cli = path.join(installRoot, "node_modules", ".bin", "moye");
  const helpProbe = await run(cli, ["--help"], installRoot);

  await mkdir(fixtureRoot, { recursive: true });
  await run("git", ["init", "-b", "main"], fixtureRoot);
  await run("git", ["config", "user.email", "release@moye.invalid"], fixtureRoot);
  await run("git", ["config", "user.name", "Moye Release"], fixtureRoot);
  await writeFile(path.join(fixtureRoot, "README.md"), "# Clean install fixture\n");
  await run("git", ["add", "README.md"], fixtureRoot);
  await run("git", ["commit", "-m", "fixture"], fixtureRoot);
  const initProbe = await run(cli, ["init", "--dir", fixtureRoot, "--project-id", "clean-install"], fixtureRoot);
  const validateProbe = await run(cli, ["project", "validate", "--file", path.join(fixtureRoot, ".moye", "project.yaml")], fixtureRoot);

  await run("docker", ["build", "--pull=false", "--tag", imageReference, "."], repositoryRoot, 600_000);
  const imageInspect = JSON.parse((await run("docker", ["image", "inspect", imageReference], repositoryRoot)).stdout) as Array<{ Id: string; Config: { User: string } }>;
  const image = imageInspect[0];
  if (image === undefined || image.Config.User !== "node" || !/^sha256:[0-9a-f]{64}$/.test(image.Id)) throw new Error("container image identity or non-root user invalid");

  const sbom = await dependencySbom(packageJson.name, packageJson.version);
  const sbomBytes = Buffer.from(`${JSON.stringify(sbom, null, 2)}\n`);
  const sbomDigest = digestBytes(sbomBytes);
  const manifest = createReleaseManifestV1({
    version,
    channel,
    gitCommit,
    npm: { name: "moye", filename: packResult.filename, digest: packageDigest, integrity: packResult.integrity, bytes: tarballBytes.byteLength },
    container: { reference: imageReference, digest: image.Id },
    protocols: { projectSchema: 1, api: 1, pluginApi: 1 },
    sbomDigest,
  });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, packResult.filename), tarballBytes);
  await writeFile(path.join(outputRoot, "sbom.cdx.json"), sbomBytes);
  await writeFile(path.join(outputRoot, "checksums.txt"), `${packageDigest.replace("sha256:", "")}  ${packResult.filename}\n${sbomDigest.replace("sha256:", "")}  sbom.cdx.json\n`);
  await writeFile(path.join(outputRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const evidence = {
    taskId: process.env["MOYE_RELEASE_TASK_ID"] ?? "TASK-0072",
    verifiedAt: new Date().toISOString(),
    release: manifest,
    npmPack: { entries: packResult.files.length, forbiddenEntries: 0 },
    cleanInstall: {
      publicProbe: JSON.parse(publicProbe.stdout),
      cliHelp: helpProbe.stdout.split("\n")[0],
      init: JSON.parse(initProbe.stdout),
      validate: JSON.parse(validateProbe.stdout),
    },
    image: { reference: imageReference, digest: image.Id, user: image.Config.User },
    evidenceDigest: digestCanonical({ manifest, packageEntries: packResult.files.map((entry) => entry.path).sort() }),
  };
  await writeFile(path.join(outputRoot, "evidence-summary.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function auditPackageFiles(files: readonly string[]): void {
  const forbidden = files.filter((file) => /(?:^|\/)(?:docs|tests|scripts|\.moye-runtime|output)(?:\/|$)/.test(file) || /(?:^|\/)(?:core-v2-services|services|coding-services)\./.test(file));
  if (forbidden.length > 0) throw new Error(`forbidden package entries: ${forbidden.join(", ")}`);
  for (const required of ["LICENSE", "README.md", "SECURITY.md", "package.json", "schemas/project.schema.json", "package-dist/public/cli.js", "package-dist/public/core.js", "package-dist/public/client.js", "package-dist/public/plugin-sdk.js"]) {
    if (!files.includes(required)) throw new Error(`required package entry missing: ${required}`);
  }
}

async function auditArchiveContent(tarball: string, root: string): Promise<void> {
  const extractRoot = path.join(root, "audit");
  await mkdir(extractRoot, { recursive: true });
  await run("tar", ["-xzf", tarball, "-C", extractRoot], root);
  const packageRoot = path.join(extractRoot, "package");
  const packedPackage = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { private?: boolean; exports?: Record<string, unknown> };
  if (packedPackage.private === true) throw new Error("packed package remains private");
  if (JSON.stringify(packedPackage).includes(repositoryRoot) || JSON.stringify(packedPackage).includes(os.homedir())) throw new Error("packed metadata contains a local absolute path");
  if (packedPackage.exports?.["./core"] === undefined || packedPackage.exports?.["./client"] === undefined || packedPackage.exports?.["./plugin-sdk"] === undefined) throw new Error("public package exports incomplete");
}

async function dependencySbom(name: string, version: string): Promise<unknown> {
  const lock = JSON.parse(await readFile(path.join(repositoryRoot, "package-lock.json"), "utf8")) as { packages?: Record<string, { name?: string; version?: string; license?: string; integrity?: string }> };
  const components = Object.entries(lock.packages ?? {}).filter(([key, value]) => key.startsWith("node_modules/") && value.version !== undefined).map(([key, value]) => ({
    type: "library",
    name: value.name ?? key.slice("node_modules/".length),
    version: value.version,
    ...(value.license === undefined ? {} : { licenses: [{ license: { id: value.license } }] }),
    ...(value.integrity === undefined ? {} : { hashes: [{ alg: "SHA-512", content: value.integrity.replace(/^sha512-/, "") }] }),
    purl: `pkg:npm/${encodeURIComponent(value.name ?? key.slice("node_modules/".length))}@${value.version}`,
  })).sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
  const serialSeed = digestCanonical({ name, version, components }).slice(7, 39);
  return { bomFormat: "CycloneDX", specVersion: "1.5", serialNumber: `urn:uuid:${serialSeed.slice(0, 8)}-${serialSeed.slice(8, 12)}-4${serialSeed.slice(13, 16)}-8${serialSeed.slice(17, 20)}-${serialSeed.slice(20, 32)}`, version: 1, metadata: { component: { type: "application", name, version } }, components };
}

async function run(command: string, args: readonly string[], cwd: string, timeout = 120_000): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, [...args], { cwd, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, npm_config_update_notifier: "false" } });
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(`${command} ${args.join(" ")} failed: ${detail.message ?? "unknown"}\n${detail.stdout ?? ""}\n${detail.stderr ?? ""}`);
  }
}
