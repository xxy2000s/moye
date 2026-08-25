import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { parse, stringify } from "yaml";

const execFileAsync = promisify(execFile);

export const PROJECT_SCHEMA_VERSION = 1 as const;
export const PROJECT_API_VERSION = 1 as const;
export const PROJECT_PLUGIN_API_VERSION = 1 as const;

export type DocumentationPolicyKind = "none" | "conventional" | "moye-doc-graph" | "custom";
export type AgentRunnerKind = "codex" | "claude";
export type TranscriptCapturePolicy = "none" | "digest_only" | "redacted" | "full";

export interface ProjectCommandV1 {
  readonly id: string;
  readonly argv: readonly string[];
  readonly cwd: string;
}

export interface ProjectManifestV1 {
  readonly schemaVersion: 1;
  readonly project: { readonly id: string };
  readonly repository: {
    readonly root: string;
    readonly baseRef: string;
    readonly targetRef: string;
  };
  readonly workflow: {
    readonly profile: "core-v2";
    readonly repairBudget: number;
    readonly replanBudget: number;
  };
  readonly agent: {
    readonly runner: AgentRunnerKind;
    readonly captureTranscripts: TranscriptCapturePolicy;
  };
  readonly tests: readonly ProjectCommandV1[];
  readonly documentation: {
    readonly policy: DocumentationPolicyKind;
    readonly command?: ProjectCommandV1;
  };
  readonly artifacts: { readonly root: string };
  readonly privacy: { readonly capturePrompts: boolean };
}

export interface LoadedProjectManifest {
  readonly manifest: ProjectManifestV1;
  readonly manifestPath: string;
  readonly projectRoot: string;
  readonly repositoryRoot: string;
  readonly digest: string;
  readonly migratedFrom?: number;
}

export class ProjectManifestError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "ProjectManifestError";
  }
}

export function defaultProjectManifest(projectId: string): ProjectManifestV1 {
  return Object.freeze({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    project: Object.freeze({ id: assertProjectId(projectId) }),
    repository: Object.freeze({ root: ".", baseRef: "HEAD", targetRef: "refs/heads/main" }),
    workflow: Object.freeze({ profile: "core-v2", repairBudget: 1, replanBudget: 1 }),
    agent: Object.freeze({ runner: "codex", captureTranscripts: "none" }),
    tests: Object.freeze([]),
    documentation: Object.freeze({ policy: "conventional" }),
    artifacts: Object.freeze({ root: ".moye/artifacts" }),
    privacy: Object.freeze({ capturePrompts: false }),
  });
}

export async function initializeProjectManifest(
  directoryInput: string,
  options: { readonly force?: boolean; readonly projectId?: string } = {},
): Promise<LoadedProjectManifest> {
  const projectRoot = await realpath(directoryInput);
  const projectId = options.projectId ?? path.basename(projectRoot).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const defaults = defaultProjectManifest(projectId);
  const detectedTargetRef = await detectTargetRef(projectRoot);
  const manifest: ProjectManifestV1 = detectedTargetRef === undefined ? defaults : {
    ...defaults,
    repository: { ...defaults.repository, targetRef: detectedTargetRef },
  };
  const directory = path.join(projectRoot, ".moye");
  const manifestPath = path.join(directory, "project.yaml");
  await mkdir(directory, { recursive: true });
  if (!options.force && await exists(manifestPath)) {
    throw new ProjectManifestError("PROJECT_MANIFEST_EXISTS", `${manifestPath} already exists; pass --force to replace it`);
  }
  await writeFile(manifestPath, stringify(manifest, { lineWidth: 0 }), { encoding: "utf8", mode: 0o600 });
  return loadProjectManifest(manifestPath);
}

export async function loadProjectManifest(manifestPathInput: string): Promise<LoadedProjectManifest> {
  const manifestPath = path.resolve(manifestPathInput);
  const raw = parse(await readFile(manifestPath, "utf8"), { maxAliasCount: 0 }) as unknown;
  const migrated = migrateProjectManifest(raw);
  const manifest = parseProjectManifestV1(migrated.value);
  const projectRoot = await inferProjectRoot(manifestPath);
  const repositoryRoot = await resolveContainedPath(projectRoot, manifest.repository.root, "repository.root", true);
  await validateManifestPaths(manifest, repositoryRoot);
  return Object.freeze({
    manifest,
    manifestPath,
    projectRoot,
    repositoryRoot,
    digest: `sha256:${createHash("sha256").update(canonicalJson(manifest)).digest("hex")}`,
    ...(migrated.from === undefined ? {} : { migratedFrom: migrated.from }),
  });
}

export function migrateProjectManifest(value: unknown): { readonly value: unknown; readonly from?: number } {
  const input = record(value, "manifest");
  if (input["schemaVersion"] === PROJECT_SCHEMA_VERSION) return { value };
  if (input["schemaVersion"] !== undefined) {
    throw new ProjectManifestError("PROJECT_SCHEMA_UNSUPPORTED", `schemaVersion ${String(input["schemaVersion"])} is not supported`);
  }
  if (input["version"] !== 0) {
    throw new ProjectManifestError("PROJECT_SCHEMA_VERSION_REQUIRED", "schemaVersion is required");
  }
  exactKeys(input, ["version", "projectId", "repository", "test", "documentation"], "legacy manifest");
  const projectId = string(input["projectId"], "projectId");
  const repository = input["repository"] === undefined ? "." : string(input["repository"], "repository");
  const test = input["test"] === undefined ? undefined : argv(input["test"], "test");
  const policy = input["documentation"] === undefined ? "conventional" : documentationPolicy(input["documentation"]);
  const next: ProjectManifestV1 = {
    ...defaultProjectManifest(projectId),
    repository: { root: repository, baseRef: "HEAD", targetRef: "refs/heads/main" },
    tests: test === undefined ? [] : [{ id: "default", argv: test, cwd: "." }],
    documentation: { policy },
  };
  return { value: next, from: 0 };
}

export function parseProjectManifestV1(value: unknown): ProjectManifestV1 {
  const input = record(value, "manifest");
  exactKeys(input, ["schemaVersion", "project", "repository", "workflow", "agent", "tests", "documentation", "artifacts", "privacy"], "manifest");
  if (input["schemaVersion"] !== 1) throw new ProjectManifestError("PROJECT_SCHEMA_UNSUPPORTED", "schemaVersion must be 1");

  const project = record(input["project"], "project");
  exactKeys(project, ["id"], "project");
  const repository = record(input["repository"], "repository");
  exactKeys(repository, ["root", "baseRef", "targetRef"], "repository");
  const workflow = record(input["workflow"], "workflow");
  exactKeys(workflow, ["profile", "repairBudget", "replanBudget"], "workflow");
  const agent = record(input["agent"], "agent");
  exactKeys(agent, ["runner", "captureTranscripts"], "agent");
  const documentation = record(input["documentation"], "documentation");
  exactKeys(documentation, ["policy", "command"], "documentation");
  const artifacts = record(input["artifacts"], "artifacts");
  exactKeys(artifacts, ["root"], "artifacts");
  const privacy = record(input["privacy"], "privacy");
  exactKeys(privacy, ["capturePrompts"], "privacy");

  const policy = documentationPolicy(documentation["policy"]);
  const command = documentation["command"] === undefined ? undefined : projectCommand(documentation["command"], "documentation.command");
  if (policy === "custom" && command === undefined) throw new ProjectManifestError("PROJECT_CUSTOM_DOCS_COMMAND_REQUIRED", "custom documentation policy requires command");
  if (policy !== "custom" && command !== undefined) throw new ProjectManifestError("PROJECT_DOCS_COMMAND_FORBIDDEN", "documentation.command is only valid for custom policy");
  const tests = array(input["tests"], "tests").map((item, index) => projectCommand(item, `tests[${index}]`));
  const ids = new Set<string>();
  for (const test of tests) {
    if (ids.has(test.id)) throw new ProjectManifestError("PROJECT_TEST_ID_DUPLICATE", `duplicate test id ${test.id}`);
    ids.add(test.id);
  }

  return Object.freeze({
    schemaVersion: 1,
    project: Object.freeze({ id: assertProjectId(string(project["id"], "project.id")) }),
    repository: Object.freeze({
      root: relativePath(string(repository["root"], "repository.root"), "repository.root", true),
      baseRef: gitRef(string(repository["baseRef"], "repository.baseRef"), "repository.baseRef"),
      targetRef: gitRef(string(repository["targetRef"], "repository.targetRef"), "repository.targetRef"),
    }),
    workflow: Object.freeze({
      profile: literal(workflow["profile"], ["core-v2"] as const, "workflow.profile"),
      repairBudget: budget(workflow["repairBudget"], "workflow.repairBudget"),
      replanBudget: budget(workflow["replanBudget"], "workflow.replanBudget"),
    }),
    agent: Object.freeze({
      runner: literal(agent["runner"], ["codex", "claude"] as const, "agent.runner"),
      captureTranscripts: literal(agent["captureTranscripts"], ["none", "digest_only", "redacted", "full"] as const, "agent.captureTranscripts"),
    }),
    tests: Object.freeze(tests),
    documentation: Object.freeze({ policy, ...(command === undefined ? {} : { command }) }),
    artifacts: Object.freeze({ root: relativePath(string(artifacts["root"], "artifacts.root"), "artifacts.root", false) }),
    privacy: Object.freeze({ capturePrompts: boolean(privacy["capturePrompts"], "privacy.capturePrompts") }),
  });
}

async function validateManifestPaths(manifest: ProjectManifestV1, repositoryRoot: string): Promise<void> {
  await resolveContainedPath(repositoryRoot, manifest.artifacts.root, "artifacts.root", false);
  for (const test of manifest.tests) await resolveContainedPath(repositoryRoot, test.cwd, `${test.id}.cwd`, true, false);
  if (manifest.documentation.command !== undefined) {
    await resolveContainedPath(repositoryRoot, manifest.documentation.command.cwd, "documentation.command.cwd", true, false);
  }
}

async function inferProjectRoot(manifestPath: string): Promise<string> {
  const parent = path.dirname(manifestPath);
  return realpath(path.basename(parent) === ".moye" ? path.dirname(parent) : parent);
}

async function resolveContainedPath(root: string, relative: string, label: string, mustExist: boolean, leafMayNotExist = true): Promise<string> {
  const candidate = path.resolve(root, relative);
  if (!contained(root, candidate)) throw new ProjectManifestError("PROJECT_PATH_OUTSIDE_REPOSITORY", `${label} escapes repository root`);
  const segments = path.relative(root, candidate).split(path.sep).filter(Boolean);
  let cursor = root;
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) {
        const target = await realpath(cursor);
        if (!contained(root, target)) throw new ProjectManifestError("PROJECT_PATH_SYMLINK_ESCAPE", `${label} escapes through symlink ${cursor}`);
        cursor = target;
      }
    } catch (error) {
      if (isMissing(error) && leafMayNotExist && index === segments.length - 1) return candidate;
      if (isMissing(error) && !mustExist) return candidate;
      throw error;
    }
  }
  if (mustExist) await access(cursor);
  return realpath(cursor);
}

function projectCommand(value: unknown, label: string): ProjectCommandV1 {
  const input = record(value, label);
  exactKeys(input, ["id", "argv", "cwd"], label);
  return Object.freeze({
    id: identifier(string(input["id"], `${label}.id`), `${label}.id`),
    argv: Object.freeze(argv(input["argv"], `${label}.argv`)),
    cwd: relativePath(string(input["cwd"], `${label}.cwd`), `${label}.cwd`, true),
  });
}

function argv(value: unknown, label: string): string[] {
  const values = array(value, label).map((item, index) => string(item, `${label}[${index}]`));
  if (values.length === 0) throw new ProjectManifestError("PROJECT_ARGV_EMPTY", `${label} must not be empty`);
  for (const item of values) {
    if (item.includes("\0") || item.includes("\n") || item.includes("\r")) throw new ProjectManifestError("PROJECT_ARGV_UNSAFE", `${label} contains control characters`);
  }
  const executable = path.posix.basename(values[0]!.replaceAll("\\", "/")).toLowerCase();
  if (["sh", "bash", "zsh", "fish", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "rm", "rmdir", "del", "sudo"].includes(executable)) {
    throw new ProjectManifestError("PROJECT_COMMAND_FORBIDDEN", `${label} may not invoke a shell or destructive executable`);
  }
  if (["node", "python", "python3"].includes(executable) && values.slice(1).some((item) => ["-e", "--eval", "-c"].includes(item))) {
    throw new ProjectManifestError("PROJECT_COMMAND_FORBIDDEN", `${label} may not execute inline code`);
  }
  return values;
}

function relativePath(value: string, label: string, allowDot: boolean): string {
  if (value.includes("\0") || path.isAbsolute(value) || value.includes("\\")) throw new ProjectManifestError("PROJECT_PATH_INVALID", `${label} must be a portable relative path`);
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) throw new ProjectManifestError("PROJECT_PATH_OUTSIDE_REPOSITORY", `${label} escapes repository root`);
  if ((!allowDot && normalized === ".") || normalized === "") throw new ProjectManifestError("PROJECT_PATH_INVALID", `${label} is not allowed to be repository root`);
  return normalized;
}

function assertProjectId(value: string): string {
  return identifier(value, "project.id");
}

function identifier(value: string, label: string): string {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(value)) throw new ProjectManifestError("PROJECT_IDENTIFIER_INVALID", `${label} must match ^[a-z][a-z0-9-]{1,62}$`);
  return value;
}

function gitRef(value: string, label: string): string {
  if (!value.trim() || value.startsWith("-") || /[\s~^:?*[\\]/.test(value) || value.includes("..") || value.includes("@{")) {
    throw new ProjectManifestError("PROJECT_GIT_REF_INVALID", `${label} is not a safe Git ref`);
  }
  return value;
}

function budget(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 20) throw new ProjectManifestError("PROJECT_BUDGET_INVALID", `${label} must be an integer from 0 to 20`);
  return value as number;
}

function documentationPolicy(value: unknown): DocumentationPolicyKind {
  return literal(value, ["none", "conventional", "moye-doc-graph", "custom"] as const, "documentation.policy");
}

function literal<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new ProjectManifestError("PROJECT_VALUE_INVALID", `${label} must be one of ${allowed.join(", ")}`);
  return value as T;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ProjectManifestError("PROJECT_OBJECT_REQUIRED", `${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new ProjectManifestError("PROJECT_ARRAY_REQUIRED", `${label} must be an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ProjectManifestError("PROJECT_STRING_REQUIRED", `${label} must be a non-empty string`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new ProjectManifestError("PROJECT_BOOLEAN_REQUIRED", `${label} must be a boolean`);
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new ProjectManifestError("PROJECT_UNKNOWN_FIELD", `${label} contains unknown field(s): ${extra.join(", ")}`);
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const input = value as Record<string, unknown>;
  return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(",")}}`;
}

async function exists(target: string): Promise<boolean> {
  try { await access(target); return true; } catch (error) { if (isMissing(error)) return false; throw error; }
}

async function detectTargetRef(projectRoot: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["-C", projectRoot, "symbolic-ref", "--quiet", "HEAD"], { timeout: 10_000 });
    const value = result.stdout.trim();
    return value.startsWith("refs/heads/") ? value : undefined;
  } catch { return undefined; }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
