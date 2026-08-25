import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  documentationPolicyPayloadV1,
  runDocumentationPolicyV1,
  validateDocumentationPolicyInputV1,
} from "../../src/framework/documentation-policy.js";

const execFileAsync = promisify(execFile);
const fixtures: string[] = [];

afterEach(async () => Promise.all(fixtures.splice(0).map((item) => rm(item, { recursive: true, force: true }))));

describe("documentation policy v1", () => {
  it("records none as deterministic NOT_REQUIRED evidence", async () => {
    const fixture = await repositoryFixture({ source: true, docs: false });
    const evidence = await run(fixture, { policyVersion: 1, kind: "none" });
    expect(evidence).toMatchObject({ policy: "none", verdict: "PASSED", disposition: "NOT_REQUIRED", changedFiles: ["src/value.ts"] });
    expect(documentationPolicyPayloadV1(evidence).dispositions).toEqual([
      expect.objectContaining({ documentId: "documentation-policy:none", outcome: "not_applicable" }),
    ]);
    expect(JSON.parse(await readFile(path.join(fixture.artifactRoot, "documentation-policy/r1-g0/evidence.json"), "utf8"))).toEqual(evidence);
    await expect(run(fixture, { policyVersion: 1, kind: "none" })).resolves.toEqual(evidence);
  });

  it("blocks conventional product changes without documentation", async () => {
    const fixture = await repositoryFixture({ source: true, docs: false });
    const evidence = await run(fixture, { policyVersion: 1, kind: "conventional" });
    expect(evidence).toMatchObject({ verdict: "BLOCKED", disposition: "FAILED", findingRefs: ["finding://documentation-policy/conventional/missing-doc-change"] });
    expect(() => documentationPolicyPayloadV1(evidence)).toThrowError(expect.objectContaining({ code: "DOCS_POLICY_BLOCKED" }));
  });

  it("passes conventional when Candidate updates project facts", async () => {
    const fixture = await repositoryFixture({ source: true, docs: true });
    await expect(run(fixture, { policyVersion: 1, kind: "conventional" })).resolves.toMatchObject({ verdict: "PASSED", disposition: "SATISFIED" });
  });

  it("runs custom argv without a shell and binds stdout/stderr digests", async () => {
    const fixture = await repositoryFixture({ source: false, docs: true });
    await mkdir(path.join(fixture.root, "scripts"));
    await writeFile(path.join(fixture.root, "scripts/docs.mjs"), "console.log('docs-ok')\n");
    await commitFixture(fixture, "docs command");
    const evidence = await run(fixture, { policyVersion: 1, kind: "custom", command: { id: "docs-check", argv: [process.execPath, "scripts/docs.mjs"], cwd: fixture.root } });
    expect(evidence).toMatchObject({ verdict: "PASSED", command: { id: "docs-check", argv: [process.execPath, "scripts/docs.mjs"], exitCode: 0, outputSummary: "docs-ok" } });
  });

  it("turns a custom nonzero exit into a blocking finding", async () => {
    const fixture = await repositoryFixture({ source: false, docs: true });
    await mkdir(path.join(fixture.root, "scripts"));
    await writeFile(path.join(fixture.root, "scripts/docs.mjs"), "process.stderr.write('missing docs\\n'); process.exit(3)\n");
    await commitFixture(fixture, "failing docs command");
    const evidence = await run(fixture, { policyVersion: 1, kind: "custom", command: { id: "docs-check", argv: [process.execPath, "scripts/docs.mjs"], cwd: fixture.root } });
    expect(evidence).toMatchObject({ verdict: "BLOCKED", command: { exitCode: 3, outputSummary: "missing docs" }, findingRefs: ["finding://documentation-policy/custom/command-failed"] });
  });

  it("runs a repository-owned moye document graph validator", async () => {
    const fixture = await repositoryFixture({ source: false, docs: true });
    await mkdir(path.join(fixture.root, "scripts"));
    await writeFile(path.join(fixture.root, "scripts/docs_graph.rb"), "abort 'missing validate' unless ARGV == ['validate']\nputs 'graph valid'\n");
    await commitFixture(fixture, "docs graph command");
    await expect(run(fixture, { policyVersion: 1, kind: "moye-doc-graph" })).resolves.toMatchObject({ verdict: "PASSED", command: { id: "moye-doc-graph-validate", exitCode: 0 } });
  });

  it("rejects shell commands and cwd outside the repository", async () => {
    const fixture = await repositoryFixture({ source: false, docs: true });
    expect(() => validateDocumentationPolicyInputV1({ policyVersion: 1, kind: "custom", command: { id: "docs-check", argv: ["bash", "-c", "true"], cwd: fixture.root } }, fixture.root)).toThrowError(expect.objectContaining({ code: "DOCS_POLICY_COMMAND_FORBIDDEN" }));
    expect(() => validateDocumentationPolicyInputV1({ policyVersion: 1, kind: "custom", command: { id: "docs-check", argv: ["git", "status"], cwd: path.dirname(fixture.root) } }, fixture.root)).toThrowError(expect.objectContaining({ code: "DOCS_POLICY_CWD_OUTSIDE_REPOSITORY" }));
  });
});

interface Fixture { root: string; artifactRoot: string; baseCommit: string; candidateCommit: string }

async function repositoryFixture(changes: { source: boolean; docs: boolean }): Promise<Fixture> {
  const parent = await mkdtemp(path.join(os.tmpdir(), "moye-documentation-policy-"));
  fixtures.push(parent);
  const root = path.join(parent, "project");
  const artifactRoot = path.join(parent, "artifacts");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(artifactRoot);
  await writeFile(path.join(root, "src/value.ts"), "export const value = 1;\n");
  await writeFile(path.join(root, "README.md"), "# Fixture\n");
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["add", "."]);
  await git(root, ["-c", "user.name=Moye Test", "-c", "user.email=test@moye.local", "commit", "-qm", "base"]);
  const baseCommit = await git(root, ["rev-parse", "HEAD"]);
  if (changes.source) await writeFile(path.join(root, "src/value.ts"), "export const value = 2;\n");
  if (changes.docs) await writeFile(path.join(root, "README.md"), "# Fixture\n\nUpdated behavior.\n");
  await git(root, ["add", "."]);
  await git(root, ["-c", "user.name=Moye Test", "-c", "user.email=test@moye.local", "commit", "--allow-empty", "-qm", "candidate"]);
  return { root, artifactRoot, baseCommit, candidateCommit: await git(root, ["rev-parse", "HEAD"]) };
}

async function run(fixture: Fixture, policy: Parameters<typeof runDocumentationPolicyV1>[0]["policy"]) {
  return runDocumentationPolicyV1({ taskId: "TASK-DOCS-1", specRevision: 1, generation: 0, repositoryRoot: fixture.root, artifactRoot: fixture.artifactRoot, baseCommit: fixture.baseCommit, candidateCommit: fixture.candidateCommit, policy });
}

async function commitFixture(fixture: Fixture, message: string): Promise<void> {
  await git(fixture.root, ["add", "."]);
  await git(fixture.root, ["-c", "user.name=Moye Test", "-c", "user.email=test@moye.local", "commit", "-qm", message]);
  fixture.candidateCommit = await git(fixture.root, ["rev-parse", "HEAD"]);
}

async function git(root: string, argv: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", root, ...argv]);
  return result.stdout.trim();
}
