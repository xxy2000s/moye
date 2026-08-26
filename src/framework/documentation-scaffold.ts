import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { defaultProjectManifest } from "./project-manifest.js";

const execFileAsync = promisify(execFile);

export const STANDARD_DOCUMENTATION_TEMPLATE_VERSION = "standard-docs-v1" as const;

export type DocumentationScaffoldFileStatus = "create" | "unchanged" | "conflict";

export interface DocumentationScaffoldFilePlanV1 {
  readonly path: string;
  readonly byteLength: number;
  readonly digest: string;
  readonly status: DocumentationScaffoldFileStatus;
  readonly conflictCode?: "CONTENT_DIFFERS" | "NOT_A_FILE" | "SYMLINK" | "PARENT_NOT_DIRECTORY";
}

export interface DocumentationScaffoldPlanV1 {
  readonly schemaVersion: 1;
  readonly templateVersion: typeof STANDARD_DOCUMENTATION_TEMPLATE_VERSION;
  readonly projectRoot: string;
  readonly projectId: string;
  readonly targetRef: string;
  readonly scaffoldDigest: string;
  readonly planDigest: string;
  readonly files: readonly DocumentationScaffoldFilePlanV1[];
  readonly conflicts: readonly DocumentationScaffoldFilePlanV1[];
}

export interface DocumentationScaffoldResultV1 extends DocumentationScaffoldPlanV1 {
  readonly applied: boolean;
  readonly created: readonly string[];
  readonly unchanged: readonly string[];
}

interface PlannedTemplate {
  readonly path: string;
  readonly bytes: string;
  readonly byteLength: number;
  readonly digest: string;
}

export class DocumentationScaffoldError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "DocumentationScaffoldError";
  }
}

export async function planStandardDocumentationScaffold(
  directoryInput: string,
  options: { readonly projectId?: string; readonly templateVersion?: string } = {},
): Promise<DocumentationScaffoldPlanV1> {
  assertTemplateVersion(options.templateVersion);
  const projectRoot = await physicalGitRoot(directoryInput);
  const projectId = options.projectId ?? inferredProjectId(projectRoot);
  const targetRef = await detectTargetRef(projectRoot);
  const templates = templatesFor(projectId, targetRef);
  const files: DocumentationScaffoldFilePlanV1[] = [];
  for (const template of templates) files.push(await inspectTarget(projectRoot, template));
  const conflicts = Object.freeze(files.filter((file) => file.status === "conflict"));
  const manifest = scaffoldManifest(projectId, targetRef, templates.filter((item) => item.path !== ".moye/documentation-scaffold.json"));
  return Object.freeze({
    schemaVersion: 1,
    templateVersion: STANDARD_DOCUMENTATION_TEMPLATE_VERSION,
    projectRoot,
    projectId,
    targetRef,
    scaffoldDigest: manifest.scaffoldDigest,
    planDigest: digest("standard-documentation-scaffold-plan-v1", files.map(({ path: filePath, digest: fileDigest, status, conflictCode }) => ({ path: filePath, digest: fileDigest, status, ...(conflictCode === undefined ? {} : { conflictCode }) }))),
    files: Object.freeze(files),
    conflicts,
  });
}

export async function applyStandardDocumentationScaffold(
  directoryInput: string,
  options: { readonly projectId?: string; readonly templateVersion?: string } = {},
): Promise<DocumentationScaffoldResultV1> {
  const plan = await planStandardDocumentationScaffold(directoryInput, options);
  if (plan.conflicts.length > 0) return Object.freeze({ ...plan, applied: false, created: Object.freeze([]), unchanged: Object.freeze(plan.files.filter((file) => file.status === "unchanged").map((file) => file.path)) });

  const templates = templatesFor(plan.projectId, plan.targetRef);
  const created: string[] = [];
  const unchanged: string[] = [];
  for (const template of templates) {
    if (plan.files.find((file) => file.path === template.path)?.status === "unchanged") {
      unchanged.push(template.path);
      continue;
    }
    await ensurePhysicalParents(plan.projectRoot, template.path);
    const target = path.join(plan.projectRoot, ...template.path.split("/"));
    try {
      await writeFile(target, template.bytes, { encoding: "utf8", flag: "wx", mode: template.path.startsWith(".moye/") ? 0o600 : 0o644 });
      created.push(template.path);
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
      const actual = await safeReadPhysicalFile(plan.projectRoot, template.path);
      if (actual !== template.bytes) throw new DocumentationScaffoldError("SCAFFOLD_CONCURRENT_CONFLICT", `${template.path} changed after the plan was computed; no file was overwritten`);
      unchanged.push(template.path);
    }
  }
  const verified = await planStandardDocumentationScaffold(plan.projectRoot, options);
  if (verified.conflicts.length > 0 || verified.files.some((file) => file.status !== "unchanged") || verified.scaffoldDigest !== plan.scaffoldDigest) {
    throw new DocumentationScaffoldError("SCAFFOLD_POST_WRITE_VERIFICATION_FAILED", "generated files do not match the frozen scaffold plan");
  }
  return Object.freeze({ ...verified, applied: true, created: Object.freeze(created), unchanged: Object.freeze(unchanged) });
}

function templatesFor(projectId: string, targetRef: string): readonly PlannedTemplate[] {
  const projectManifest = structuredClone(defaultProjectManifest(projectId));
  (projectManifest as { repository: { targetRef: string } }).repository.targetRef = targetRef;
  (projectManifest as { documentation: unknown }).documentation = {
    policy: "custom",
    command: { id: "standard-docs-validate", argv: ["node", "scripts/docs_validate.mjs"], cwd: "." },
  };
  const contents = new Map<string, string>([
    [".moye/project.yaml", `${JSON.stringify(projectManifest, null, 2)}\n`],
    ["AGENTS.md", agentsTemplate(projectId)],
    ["README.md", readmeTemplate(projectId)],
    ["docs/README.md", docsIndexTemplate(projectId)],
    ["docs/sources/README.md", sourcesTemplate()],
    ["docs/delivery/README.md", deliveryTemplate()],
    ["docs/delivery/backlog/README.md", backlogIndexTemplate()],
    ["docs/delivery/tasks/README.md", tasksIndexTemplate()],
    ["docs/knowledge/README.md", knowledgeTemplate()],
    ["docs/meta/README.md", metaTemplate()],
    ["docs/meta/templates/backlog-item.yaml", backlogTemplate()],
    ["docs/meta/templates/task.yaml", taskTemplate()],
    ["scripts/docs_validate.mjs", validatorTemplate()],
  ]);
  const managed = [...contents.entries()].sort(([left], [right]) => comparePortablePath(left, right)).map(([targetPath, bytes]) => plannedTemplate(targetPath, bytes));
  const manifest = scaffoldManifest(projectId, targetRef, managed);
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  return Object.freeze([...managed, plannedTemplate(".moye/documentation-scaffold.json", manifestBytes)]);
}

function scaffoldManifest(projectId: string, targetRef: string, templates: readonly PlannedTemplate[]): {
  readonly schemaVersion: 1;
  readonly templateVersion: typeof STANDARD_DOCUMENTATION_TEMPLATE_VERSION;
  readonly projectId: string;
  readonly targetRef: string;
  readonly files: readonly { readonly path: string; readonly byteLength: number; readonly digest: string }[];
  readonly projectManifest: {
    readonly path: ".moye/project.yaml";
    readonly initialDigest: string;
    readonly requiredDocumentationPolicy: "custom";
    readonly requiredCommandId: "standard-docs-validate";
  };
  readonly scaffoldDigest: string;
} {
  const projectManifest = templates.find((template) => template.path === ".moye/project.yaml");
  if (projectManifest === undefined) throw new DocumentationScaffoldError("SCAFFOLD_PROJECT_MANIFEST_MISSING", "template set has no project manifest");
  const core = {
    schemaVersion: 1 as const,
    templateVersion: STANDARD_DOCUMENTATION_TEMPLATE_VERSION,
    projectId,
    targetRef,
    files: Object.freeze(templates.filter((template) => template.path !== ".moye/project.yaml").map(({ path: filePath, byteLength, digest: fileDigest }) => Object.freeze({ path: filePath, byteLength, digest: fileDigest }))),
    projectManifest: Object.freeze({ path: ".moye/project.yaml" as const, initialDigest: projectManifest.digest, requiredDocumentationPolicy: "custom" as const, requiredCommandId: "standard-docs-validate" as const }),
  };
  return Object.freeze({ ...core, scaffoldDigest: digest("standard-documentation-scaffold-manifest-v1", core) });
}

function plannedTemplate(targetPath: string, bytes: string): PlannedTemplate {
  return Object.freeze({ path: targetPath, bytes, byteLength: Buffer.byteLength(bytes), digest: bytesDigest(bytes) });
}

async function inspectTarget(projectRoot: string, template: PlannedTemplate): Promise<DocumentationScaffoldFilePlanV1> {
  const problem = await physicalPathProblem(projectRoot, template.path);
  if (problem !== undefined) return Object.freeze({ path: template.path, byteLength: template.byteLength, digest: template.digest, status: "conflict", conflictCode: problem });
  try {
    const actual = await safeReadPhysicalFile(projectRoot, template.path);
    return Object.freeze({ path: template.path, byteLength: template.byteLength, digest: template.digest, status: actual === template.bytes ? "unchanged" : "conflict", ...(actual === template.bytes ? {} : { conflictCode: "CONTENT_DIFFERS" as const }) });
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
    return Object.freeze({ path: template.path, byteLength: template.byteLength, digest: template.digest, status: "create" });
  }
}

async function physicalPathProblem(projectRoot: string, relativePath: string): Promise<DocumentationScaffoldFilePlanV1["conflictCode"] | undefined> {
  const segments = relativePath.split("/");
  let cursor = projectRoot;
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) return "SYMLINK";
      if (index < segments.length - 1 && !info.isDirectory()) return "PARENT_NOT_DIRECTORY";
      if (index === segments.length - 1 && !info.isFile()) return "NOT_A_FILE";
    } catch (error) {
      if (isCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }
  return undefined;
}

async function ensurePhysicalParents(projectRoot: string, relativePath: string): Promise<void> {
  const parents = relativePath.split("/").slice(0, -1);
  let cursor = projectRoot;
  for (const segment of parents) {
    cursor = path.join(cursor, segment);
    try { await mkdir(cursor); }
    catch (error) { if (!isCode(error, "EEXIST")) throw error; }
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new DocumentationScaffoldError("SCAFFOLD_UNSAFE_PARENT", `${path.relative(projectRoot, cursor)} is not a physical directory`);
    const resolved = await realpath(cursor);
    if (!contained(projectRoot, resolved)) throw new DocumentationScaffoldError("SCAFFOLD_PATH_OUTSIDE_PROJECT", `${relativePath} escapes the physical project root`);
  }
}

async function safeReadPhysicalFile(projectRoot: string, relativePath: string): Promise<string> {
  const problem = await physicalPathProblem(projectRoot, relativePath);
  if (problem !== undefined) throw new DocumentationScaffoldError(`SCAFFOLD_${problem}`, `${relativePath} is not a safe physical file`);
  const target = path.join(projectRoot, ...relativePath.split("/"));
  const resolved = await realpath(target);
  if (!contained(projectRoot, resolved)) throw new DocumentationScaffoldError("SCAFFOLD_PATH_OUTSIDE_PROJECT", `${relativePath} escapes the physical project root`);
  return readFile(resolved, "utf8");
}

async function physicalGitRoot(directoryInput: string): Promise<string> {
  const requested = await realpath(path.resolve(directoryInput));
  let reported: string;
  try { reported = (await execFileAsync("git", ["-C", requested, "rev-parse", "--show-toplevel"], { timeout: 10_000 })).stdout.trim(); }
  catch { throw new DocumentationScaffoldError("SCAFFOLD_GIT_REPOSITORY_REQUIRED", `${requested} is not a Git repository`); }
  const gitRoot = await realpath(reported);
  if (gitRoot !== requested) throw new DocumentationScaffoldError("SCAFFOLD_PROJECT_ROOT_REQUIRED", `--dir must be the Git repository root ${gitRoot}`);
  return gitRoot;
}

async function detectTargetRef(projectRoot: string): Promise<string> {
  try {
    const value = (await execFileAsync("git", ["-C", projectRoot, "symbolic-ref", "--quiet", "HEAD"], { timeout: 10_000 })).stdout.trim();
    if (value.startsWith("refs/heads/")) return value;
  } catch { /* handled by stable fallback */ }
  return "refs/heads/main";
}

function assertTemplateVersion(value: string | undefined): void {
  if (value !== undefined && value !== STANDARD_DOCUMENTATION_TEMPLATE_VERSION) {
    throw new DocumentationScaffoldError("SCAFFOLD_TEMPLATE_VERSION_UNSUPPORTED", `only ${STANDARD_DOCUMENTATION_TEMPLATE_VERSION} is supported; upgrade and migration must be explicit`);
  }
}

function inferredProjectId(projectRoot: string): string {
  return path.basename(projectRoot).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

function agentsTemplate(projectId: string): string {
  return `# AGENTS.md\n\nThis is the repository operating contract for ${projectId}.\n\n1. Read README.md, docs/README.md, and the relevant Sources, Delivery, and Knowledge indexes before changing product behavior.\n2. Code and executable tests prove behavior; current Knowledge documents explain design; Delivery tasks bind intent, implementation, and evidence.\n3. Update project facts in the same change. Do not let an agent-reported PASS replace the deterministic documentation command.\n4. Never overwrite or rewrite completed task evidence. Put proposed work in docs/delivery/backlog and active work in docs/delivery/tasks.\n5. Before handoff run the configured tests and \`node scripts/docs_validate.mjs\`.\n`;
}

function readmeTemplate(projectId: string): string {
  return `# ${projectId}\n\nProject documentation starts at [docs/README.md](./docs/README.md). Agent operating rules are in [AGENTS.md](./AGENTS.md).\n\nValidate the standard documentation scaffold with:\n\n\`\`\`bash\nnode scripts/docs_validate.mjs\n\`\`\`\n`;
}

function docsIndexTemplate(projectId: string): string {
  return `# ${projectId} Documentation\n\n- [Sources](./sources/README.md): observed inputs and product intent.\n- [Delivery](./delivery/README.md): backlog and active/completed task evidence.\n- [Knowledge](./knowledge/README.md): current architecture, decisions, pitfalls, and runbooks.\n- [Meta](./meta/README.md): templates and documentation governance.\n`;
}

function sourcesTemplate(): string { return "# Sources\n\nRecord real user input, findings, incidents, references, research, and brainstorms here. Sources are inputs, not automatically accepted design.\n"; }
function deliveryTemplate(): string { return "# Delivery\n\n- [Backlog](./backlog/README.md)\n- [Tasks](./tasks/README.md)\n\nA Task binds approved intent to implementation, deterministic verification, documentation impact, and closure evidence.\n"; }
function backlogIndexTemplate(): string { return "# Backlog\n\nBacklog items describe recognized work that has not entered an active Task. Start from [the template](../../meta/templates/backlog-item.yaml) and keep evidence references factual.\n"; }
function tasksIndexTemplate(): string { return "# Tasks\n\nCreate one directory per active Task. Preserve completed Task evidence instead of rewriting it. Start from [the template](../../meta/templates/task.yaml).\n"; }
function knowledgeTemplate(): string { return "# Knowledge\n\nKeep current architecture, accepted decisions, stable pitfalls, and operational runbooks here. Separate current facts from proposals and historical evidence.\n"; }
function metaTemplate(): string { return "# Documentation Meta\n\nThis directory contains project-local templates and governance material. The deterministic validator reads `.moye/documentation-scaffold.json`; it never infers success from an agent message.\n\n- [Backlog item template](./templates/backlog-item.yaml)\n- [Task template](./templates/task.yaml)\n"; }
function backlogTemplate(): string { return "schema_version: 1\nid: BL-0001\ntitle: Replace with a concise problem title\nstatus: captured\nproblem:\n  observed: Replace with an observed fact\n  expected: Replace with the expected behavior\n  impact: Replace with the affected user or workflow\n  evidence_refs: []\n"; }
function taskTemplate(): string { return "schema_version: 1\nid: TASK-0001\ntitle: Replace with an outcome-oriented title\nstatus: active\nspec_revision: 1\nrequirements: []\nverification_refs: []\ndocs_impact: pending\n"; }

function validatorTemplate(): string {
  return `#!/usr/bin/env node\nimport { createHash } from "node:crypto";\nimport { execFile } from "node:child_process";\nimport { lstat, readFile, realpath } from "node:fs/promises";\nimport path from "node:path";\nimport { promisify } from "node:util";\n\nconst execFileAsync = promisify(execFile);\nconst root = await realpath(process.cwd());\nconst manifestPath = path.join(root, ".moye", "documentation-scaffold.json");\nconst moyeDirectoryInfo = await lstat(path.join(root, ".moye"));\nconst scaffoldManifestInfo = await lstat(manifestPath);\nif (moyeDirectoryInfo.isSymbolicLink() || !moyeDirectoryInfo.isDirectory() || scaffoldManifestInfo.isSymbolicLink() || !scaffoldManifestInfo.isFile()) fail("SCAFFOLD_CONTROL_PATH_INVALID");\nconst manifest = JSON.parse(await readFile(manifestPath, "utf8"));\nif (manifest.schemaVersion !== 1 || manifest.templateVersion !== "standard-docs-v1" || !Array.isArray(manifest.files) || !manifest.projectManifest) fail("SCAFFOLD_MANIFEST_INVALID");\nconst canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? \`[\${value.map(canonical).join(",")}]\` : \`{\${Object.keys(value).sort().map((key) => \`\${JSON.stringify(key)}:\${canonical(value[key])}\`).join(",")}}\`;\nconst digest = (domain, value) => \`sha256:\${createHash("sha256").update(domain).update("\\0").update(canonical(value)).digest("hex")}\`;\nconst { scaffoldDigest, ...core } = manifest;\nif (scaffoldDigest !== digest("standard-documentation-scaffold-manifest-v1", core)) fail("SCAFFOLD_MANIFEST_DIGEST_MISMATCH");\nif (manifest.projectManifest.path !== ".moye/project.yaml" || manifest.projectManifest.requiredDocumentationPolicy !== "custom" || manifest.projectManifest.requiredCommandId !== "standard-docs-validate") fail("SCAFFOLD_PROJECT_MANIFEST_DESCRIPTOR_INVALID");\nconst projectManifestPath = path.join(root, ".moye", "project.yaml");\nconst projectManifestInfo = await lstat(projectManifestPath);\nif (projectManifestInfo.isSymbolicLink() || !projectManifestInfo.isFile()) fail("SCAFFOLD_PROJECT_MANIFEST_PATH_INVALID");\nconst project = JSON.parse(await readFile(projectManifestPath, "utf8"));\nconst requiredDocumentation = { policy: "custom", command: { id: manifest.projectManifest.requiredCommandId, argv: ["node", "scripts/docs_validate.mjs"], cwd: "." } };\nif (canonical(project.documentation) !== canonical(requiredDocumentation)) fail("SCAFFOLD_DOCUMENTATION_POLICY_DRIFT");\nconst baseCommit = process.env.MOYE_DOCUMENTATION_BASE_COMMIT;\nconst candidateCommit = process.env.MOYE_DOCUMENTATION_CANDIDATE_COMMIT;\nif ((baseCommit === undefined) !== (candidateCommit === undefined)) fail("SCAFFOLD_POLICY_COMMIT_PAIR_REQUIRED");\nif (baseCommit !== undefined && candidateCommit !== undefined) {\n  const changed = (await execFileAsync("git", ["-C", root, "diff", "--name-only", "--no-renames", baseCommit, candidateCommit], { encoding: "utf8", timeout: 10000 })).stdout.split("\\n").map((item) => item.trim()).filter(Boolean);\n  const documentationChanged = changed.some((file) => /^(?:docs\\/|README(?:\\.[^/]*)?$|CHANGELOG(?:\\.[^/]*)?$|SECURITY(?:\\.[^/]*)?$|CONTRIBUTING(?:\\.[^/]*)?$|[^/]+\\.md$)/i.test(file));\n  const productChanged = changed.some((file) => !/^(?:docs\\/|README(?:\\.[^/]*)?$|CHANGELOG(?:\\.[^/]*)?$|SECURITY(?:\\.[^/]*)?$|CONTRIBUTING(?:\\.[^/]*)?$|[^/]+\\.md$|\\.moye\\/|\\.github\\/|tests?\\/|__tests__\\/|fixtures?\\/|examples?\\/)/i.test(file));\n  if (productChanged && !documentationChanged) fail("SCAFFOLD_DOC_CHANGE_REQUIRED");\n}\nfor (const entry of manifest.files) {\n  if (!entry || typeof entry.path !== "string" || path.isAbsolute(entry.path) || entry.path.includes("\\\\") || path.posix.normalize(entry.path) !== entry.path || entry.path === ".." || entry.path.startsWith("../")) fail("SCAFFOLD_PATH_INVALID", entry?.path);\n  let cursor = root;\n  for (const segment of entry.path.split("/")) { cursor = path.join(cursor, segment); const info = await lstat(cursor); if (info.isSymbolicLink()) fail("SCAFFOLD_SYMLINK_FORBIDDEN", entry.path); }\n  const resolved = await realpath(cursor);\n  const relative = path.relative(root, resolved);\n  if (relative === ".." || relative.startsWith(\`..\${path.sep}\`) || path.isAbsolute(relative)) fail("SCAFFOLD_PATH_OUTSIDE_PROJECT", entry.path);\n  const bytes = await readFile(resolved);\n  const actual = \`sha256:\${createHash("sha256").update(bytes).digest("hex")}\`;\n  if (bytes.byteLength !== entry.byteLength || actual !== entry.digest) fail("SCAFFOLD_FILE_DIGEST_MISMATCH", entry.path);\n}\nprocess.stdout.write(JSON.stringify({ valid: true, templateVersion: manifest.templateVersion, projectId: manifest.projectId, fileCount: manifest.files.length, scaffoldDigest }) + "\\n");\nfunction fail(code, detail = "") { throw new Error(\`\${code}\${detail ? \`: \${detail}\` : ""}\`); }\n`;
}

function bytesDigest(bytes: string): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function comparePortablePath(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function digest(domain: string, value: unknown): string { return `sha256:${createHash("sha256").update(domain).update("\0").update(canonicalJson(value)).digest("hex")}`; }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const input = value as Record<string, unknown>;
  return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(",")}}`;
}
function contained(root: string, candidate: string): boolean { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
function isCode(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code; }
