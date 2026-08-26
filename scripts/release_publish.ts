import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { digestBytes, type ReleaseManifestV1, verifyReleaseManifestV1 } from "../src/release/manifest.js";
import {
  createReleasePublishEventV1,
  createReleasePublishIntentV1,
  shouldAppendReleaseObservation,
  summarizeReleasePublish,
  verifyReleasePublishIntentV1,
  type ReleasePublishEventV1,
  type ReleasePublishIntentV1,
  type ReleasePublishObservationV1,
} from "../src/release/publish.js";

const execFileAsync = promisify(execFile);
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const requireAll = args.has("--require-all");
const repositoryRoot = process.cwd();
const releaseRoot = path.resolve(process.env["MOYE_RELEASE_OUTPUT"] ?? path.join(repositoryRoot, ".moye-runtime", "release", "0.1.0"));
const manifestPath = path.join(releaseRoot, "release-manifest.json");
const intentPath = path.join(releaseRoot, "publish-intent.json");
const eventsPath = path.join(releaseRoot, "publish-events.jsonl");
const summaryPath = path.join(releaseRoot, "publish-summary.json");
const releaseNotesPath = process.env["MOYE_RELEASE_NOTES"] ?? "docs/knowledge/guidance/releases/v0.1.0.md";
const githubRepository = process.env["MOYE_GITHUB_REPOSITORY"] ?? "xxy2000s/moye";
const gitRemote = process.env["MOYE_RELEASE_GIT_REMOTE"] ?? "origin";
const containerReference = process.env["MOYE_RELEASE_IMAGE"] ?? "ghcr.io/xxy2000s/moye:0.1.0";

const manifest = verifyReleaseManifestV1(JSON.parse(await readFile(manifestPath, "utf8")) as ReleaseManifestV1);
const head = (await command("git", ["rev-parse", "HEAD"])).stdout.trim();
if (head !== manifest.gitCommit) throw new Error(`release manifest commit ${manifest.gitCommit} does not match HEAD ${head}`);
if ((await command("git", ["status", "--porcelain=v1"])).stdout.trim() !== "") throw new Error("release publish requires a clean committed source tree");
await verifyLocalArtifacts(manifest);

const intent = createReleasePublishIntentV1(manifest, { gitRemote, githubRepository, releaseNotesPath, containerReference });
await mkdir(releaseRoot, { recursive: true });
await persistIntent(intent);
const events = await readEvents(intent);

await reconcileTarget("git_tag", probeGit, applyGit);
await reconcileTarget("github_release", probeGithub, applyGithub);
await reconcileTarget("npm", probeNpm, applyNpm);
await reconcileTarget("container", probeContainer, applyContainer);

const summary = {
  schemaVersion: 1,
  taskId: process.env["MOYE_RELEASE_TASK_ID"] ?? "TASK-0075",
  releaseDigest: manifest.releaseDigest,
  intentDigest: intent.intentDigest,
  gitCommit: manifest.gitCommit,
  version: manifest.version,
  ...summarizeReleasePublish(events),
  eventsDigest: digestBytes(Buffer.from(events.map((event) => JSON.stringify(event)).join("\n") + "\n")),
};
await atomicJson(summaryPath, summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (requireAll && summary.overall !== "CONFIRMED") process.exitCode = 2;

async function reconcileTarget(
  target: ReleasePublishObservationV1["target"],
  probe: () => Promise<ReleasePublishObservationV1>,
  perform: (current: ReleasePublishObservationV1) => Promise<ReleasePublishObservationV1>,
): Promise<void> {
  let observation = await probe();
  if (apply && observation.state === "NOT_APPLIED") {
    observation = await perform(observation);
  }
  // In apply mode the pre-effect NOT_APPLIED probe is transient. Persist the
  // reconciled outcome only, otherwise every credential-blocked rerun would
  // oscillate NOT_APPLIED → BLOCKED_AUTH and grow a duplicate ledger.
  await record(observation);
  if (observation.target !== target) throw new Error(`release target mismatch: ${target}`);
  if (observation.state === "CONFLICT") throw new Error(`${target} conflicts with GA identity: ${observation.detail}`);
}

async function persistIntent(next: ReleasePublishIntentV1): Promise<void> {
  try {
    await writeFile(intentPath, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = verifyReleasePublishIntentV1(JSON.parse(await readFile(intentPath, "utf8")) as ReleasePublishIntentV1);
    if (existing.intentDigest !== next.intentDigest) throw new Error("release publish intent already exists with different identity");
  }
}

async function readEvents(activeIntent: ReleasePublishIntentV1): Promise<ReleasePublishEventV1[]> {
  let text = "";
  try { text = await readFile(eventsPath, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const parsed = text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as ReleasePublishEventV1);
  for (const [index, event] of parsed.entries()) {
    if (event.intentDigest !== activeIntent.intentDigest || event.sequence !== index + 1) throw new Error("release publish event ledger is not contiguous or belongs to another intent");
    const rebuilt = createReleasePublishEventV1(activeIntent, event.sequence, event.observedAt, {
      target: event.target, state: event.state, evidence: event.evidence, detail: event.detail,
    });
    if (rebuilt.eventDigest !== event.eventDigest) throw new Error("release publish event digest mismatch");
  }
  return parsed;
}

async function record(observation: ReleasePublishObservationV1): Promise<void> {
  const previous = [...events].reverse().find((event) => event.target === observation.target);
  if (!shouldAppendReleaseObservation(previous, observation)) return;
  const event = createReleasePublishEventV1(intent, events.length + 1, new Date().toISOString(), observation);
  await writeFile(eventsPath, `${JSON.stringify(event)}\n`, { flag: "a" });
  events.push(event);
}

async function probeGit(): Promise<ReleasePublishObservationV1> {
  const result = await command("git", ["ls-remote", "--tags", intent.git.remote, `refs/tags/${intent.git.tag}`, `refs/tags/${intent.git.tag}^{}`], true);
  if (result.code !== 0) return observation("git_tag", "UNKNOWN", null, compact(result.stderr || result.stdout));
  const refs = new Map(result.stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => { const [oid, ref] = line.split(/\s+/u); return [ref, oid] as const; }));
  const observed = refs.get(`refs/tags/${intent.git.tag}^{}`) ?? refs.get(`refs/tags/${intent.git.tag}`);
  if (observed === undefined) return observation("git_tag", "NOT_APPLIED", null, "remote tag is absent");
  return observed === intent.gitCommit
    ? observation("git_tag", "CONFIRMED", observed, "remote tag resolves to the sealed Result Commit")
    : observation("git_tag", "CONFLICT", observed, "remote tag resolves to a different commit");
}

async function applyGit(): Promise<ReleasePublishObservationV1> {
  const local = await command("git", ["rev-list", "-n", "1", intent.git.tag], true);
  if (local.code === 0 && local.stdout.trim() !== intent.gitCommit) return observation("git_tag", "CONFLICT", local.stdout.trim(), "local tag resolves to a different commit");
  if (local.code !== 0) await command("git", ["tag", "-a", intent.git.tag, intent.gitCommit, "-m", `Moye ${intent.version}`]);
  const pushed = await command("git", ["push", intent.git.remote, `refs/tags/${intent.git.tag}:refs/tags/${intent.git.tag}`], true);
  const checked = await probeGit();
  return checked.state === "CONFIRMED" ? checked : observation("git_tag", checked.state === "NOT_APPLIED" ? "UNKNOWN" : checked.state, checked.evidence, compact(pushed.stderr || checked.detail));
}

async function probeGithub(): Promise<ReleasePublishObservationV1> {
  const response = await fetch(`https://api.github.com/repos/${intent.github.repository}/releases/tags/${intent.git.tag}`, { headers: { accept: "application/vnd.github+json", "user-agent": "moye-release/0.1.0" } });
  if (response.status === 404) return observation("github_release", "NOT_APPLIED", null, "GitHub Release is absent");
  if (!response.ok) return observation("github_release", response.status === 401 || response.status === 403 ? "BLOCKED_AUTH" : "UNKNOWN", null, `GitHub API returned HTTP ${response.status}`);
  const payload = await response.json() as { tag_name?: string; html_url?: string; assets?: Array<{ name?: string }> };
  const names = new Set((payload.assets ?? []).map((asset) => asset.name));
  const expected = [manifest.npm.filename, "sbom.cdx.json", "checksums.txt", "release-manifest.json"];
  if (payload.tag_name !== intent.git.tag || expected.some((name) => !names.has(name))) return observation("github_release", "CONFLICT", payload.html_url ?? null, "GitHub Release tag or asset set differs from the intent");
  return observation("github_release", "CONFIRMED", payload.html_url ?? null, "GitHub Release and required assets are present");
}

async function applyGithub(): Promise<ReleasePublishObservationV1> {
  if ((await command("gh", ["auth", "status"], true)).code !== 0) return observation("github_release", "BLOCKED_AUTH", null, "GitHub CLI credentials are unavailable");
  const created = await command("gh", ["release", "create", intent.git.tag, "--repo", intent.github.repository, "--verify-tag", "--title", `Moye ${intent.version}`, "--notes-file", path.join(repositoryRoot, intent.github.releaseNotesPath), path.join(releaseRoot, manifest.npm.filename), path.join(releaseRoot, "sbom.cdx.json"), path.join(releaseRoot, "checksums.txt"), manifestPath], true);
  const checked = await probeGithub();
  return checked.state === "CONFIRMED" ? checked : observation("github_release", checked.state === "NOT_APPLIED" ? "UNKNOWN" : checked.state, checked.evidence, compact(created.stderr || checked.detail));
}

async function probeNpm(): Promise<ReleasePublishObservationV1> {
  const result = await command("npm", ["view", `${intent.npm.name}@${intent.version}`, "dist.integrity", "--registry=https://registry.npmjs.org", "--json"], true);
  if (result.code !== 0) {
    if (/E404|No match found/u.test(result.stderr + result.stdout)) return observation("npm", "NOT_APPLIED", null, "npm version is absent");
    return observation("npm", /ENEEDAUTH|E401|E403/u.test(result.stderr) ? "BLOCKED_AUTH" : "UNKNOWN", null, compact(result.stderr || result.stdout));
  }
  const observed = JSON.parse(result.stdout) as string;
  return observed === intent.npm.integrity ? observation("npm", "CONFIRMED", observed, "npm integrity matches") : observation("npm", "CONFLICT", observed, "npm version exists with different integrity");
}

async function applyNpm(): Promise<ReleasePublishObservationV1> {
  if ((await command("npm", ["whoami", "--registry=https://registry.npmjs.org"], true)).code !== 0) return observation("npm", "BLOCKED_AUTH", null, "npm credentials are unavailable");
  const published = await command("npm", ["publish", path.join(releaseRoot, manifest.npm.filename), "--access", "public", "--registry=https://registry.npmjs.org"], true);
  const checked = await probeNpm();
  return checked.state === "CONFIRMED" ? checked : observation("npm", checked.state === "NOT_APPLIED" ? "UNKNOWN" : checked.state, checked.evidence, compact(published.stderr || checked.detail));
}

async function probeContainer(): Promise<ReleasePublishObservationV1> {
  const result = await command("docker", ["manifest", "inspect", intent.container.reference], true);
  if (result.code !== 0) {
    if (/manifest unknown|no such manifest/u.test(result.stderr)) return observation("container", "NOT_APPLIED", null, "container tag is absent");
    if (/denied|unauthorized|authentication required/u.test(result.stderr)) return observation("container", "BLOCKED_AUTH", null, "container Registry credentials are unavailable");
    return observation("container", "UNKNOWN", null, compact(result.stderr || result.stdout));
  }
  const payload = JSON.parse(result.stdout) as { config?: { digest?: string }; manifests?: unknown[] };
  const observed = payload.config?.digest;
  if (observed === undefined) return observation("container", "UNKNOWN", null, "remote image is a manifest list and cannot be bound to the expected config digest");
  return observed === intent.container.imageDigest ? observation("container", "CONFIRMED", observed, "remote image config digest matches") : observation("container", "CONFLICT", observed, "remote image config digest differs");
}

async function applyContainer(): Promise<ReleasePublishObservationV1> {
  if (!await hasDockerCredentials(new URL(`https://${intent.container.reference.split("/")[0]}`).hostname)) return observation("container", "BLOCKED_AUTH", null, "container Registry credentials are unavailable");
  const pushed = await command("docker", ["push", intent.container.reference], true);
  const checked = await probeContainer();
  return checked.state === "CONFIRMED" ? checked : observation("container", checked.state === "NOT_APPLIED" ? "UNKNOWN" : checked.state, checked.evidence, compact(pushed.stderr || checked.detail));
}

async function verifyLocalArtifacts(activeManifest: ReleaseManifestV1): Promise<void> {
  const tarball = await readFile(path.join(releaseRoot, activeManifest.npm.filename));
  if (digestBytes(tarball) !== activeManifest.npm.digest) throw new Error("local npm tarball digest differs from Release Manifest");
  const sbom = await readFile(path.join(releaseRoot, "sbom.cdx.json"));
  if (digestBytes(sbom) !== activeManifest.sbomDigest) throw new Error("local SBOM digest differs from Release Manifest");
  await readFile(path.join(repositoryRoot, releaseNotesPath));
  const image = await command("docker", ["image", "inspect", intentReference(activeManifest), "--format", "{{.Id}}"], true);
  if (image.code !== 0 || image.stdout.trim() !== activeManifest.container.digest) throw new Error("local container image differs from Release Manifest");
}

function intentReference(activeManifest: ReleaseManifestV1): string { return activeManifest.container.reference; }
function observation(target: ReleasePublishObservationV1["target"], state: ReleasePublishObservationV1["state"], evidence: string | null, detail: string): ReleasePublishObservationV1 { return { target, state, evidence, detail: detail || "no additional detail" }; }
function compact(value: string): string { return value.replace(/\s+/gu, " ").trim().slice(0, 1_000) || "command failed without output"; }

async function command(file: string, argv: readonly string[], tolerate = false): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(file, [...argv], { cwd: repositoryRoot, encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, npm_config_update_notifier: "false" } });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    const result = { code: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message ?? "unknown command failure" };
    if (!tolerate) throw new Error(`${file} ${argv.join(" ")} failed: ${compact(result.stderr || result.stdout)}`);
    return result;
  }
}

async function hasDockerCredentials(host: string): Promise<boolean> {
  const configRoot = process.env["DOCKER_CONFIG"] ?? path.join(os.homedir(), ".docker");
  try {
    const config = JSON.parse(await readFile(path.join(configRoot, "config.json"), "utf8")) as { auths?: Record<string, unknown>; credHelpers?: Record<string, string>; credsStore?: string };
    return config.auths?.[host] !== undefined || config.auths?.[`https://${host}`] !== undefined || config.credHelpers?.[host] !== undefined || Boolean(config.credsStore);
  } catch { return false; }
}

async function atomicJson(target: string, value: unknown): Promise<void> {
  const suffix = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
  const temporary = `${target}.${process.pid}.${suffix}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, target);
}
