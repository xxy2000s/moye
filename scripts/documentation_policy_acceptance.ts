import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { stringify } from "yaml";

import { MoyeClient } from "../src/framework/client.js";
import { defaultProjectManifest } from "../src/framework/project-manifest.js";

const execFileAsync = promisify(execFile);
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const runRoot = path.resolve(process.env["MOYE_DOCUMENTATION_POLICY_ACCEPTANCE_ROOT"] ?? `.moye-runtime/documentation-policy-acceptance/${stamp}`);
const repositoryRoot = path.join(runRoot, "repository");
const runtimeRoot = path.join(runRoot, "runtime");
const manifestPath = path.join(repositoryRoot, ".moye", "project.yaml");
const ingressUrl = process.env["RESTATE_INGRESS_URL"] ?? "http://127.0.0.1:8080";
const boardUrl = process.env["MOYE_BOARD_URL"] ?? "http://127.0.0.1:3000";
const projectId = "documentation-policy-acceptance";
const taskId = `TASK-DOCS-POLICY-${stamp}`;

await mkdir(path.join(repositoryRoot, ".moye"), { recursive: true });
await mkdir(path.join(repositoryRoot, "test"), { recursive: true });
await writeFile(path.join(repositoryRoot, "package.json"), `${JSON.stringify({ name: projectId, private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
await writeFile(path.join(repositoryRoot, "README.md"), "# Documentation Policy Acceptance\n\nThis fixture intentionally has no Moye docs graph.\n");
await writeFile(path.join(repositoryRoot, "test/value.test.mjs"), [
  'import assert from "node:assert/strict";',
  'import { readFile } from "node:fs/promises";',
  'import test from "node:test";',
  'test("value", async () => assert.equal(await readFile(new URL("../src/value.txt", import.meta.url), "utf8"), "policy-ok\\n"));',
  "",
].join("\n"));
const manifest = structuredClone(defaultProjectManifest(projectId));
(manifest as { tests: unknown }).tests = [{ id: "node-test", argv: ["npm", "test"], cwd: "." }];
(manifest as { documentation: { policy: string } }).documentation.policy = "none";
(manifest as { repository: { targetRef: string } }).repository.targetRef = "refs/heads/release";
await writeFile(manifestPath, stringify(manifest, { lineWidth: 0 }));
await git(["init", "-q", "-b", "main"]);
await git(["add", "."]);
await git(["-c", "user.name=Moye Acceptance", "-c", "user.email=acceptance@moye.local", "commit", "-qm", "base"]);
await git(["update-ref", "refs/heads/release", "HEAD"]);

const client = new MoyeClient({ ingressUrl, boardUrl, runtimeRoot });
const receipt = await client.startTask({
  manifestPath,
  taskId,
  title: "Documentation policy none real task",
  objective: "Create src/value.txt whose complete content is exactly policy-ok followed by one newline. Do not add a docs graph or documentation process.",
  acceptanceCriteria: [
    "src/value.txt contains exactly policy-ok followed by one newline",
    "the configured npm test command passes",
    "the deterministic documentation policy records NOT_REQUIRED evidence",
  ],
});
const status = await client.wait(taskId, { timeoutMs: 25 * 60_000 });
if (status.archiveStatus !== "ARCHIVED" || status.outcome !== "SUCCEEDED") throw new Error(`Documentation policy task ended ${status.state}/${status.archiveStatus}/${status.outcome}`);
const evidencePath = path.join(runtimeRoot, projectId, taskId, ".moye", "artifacts", "documentation-policy", "r1-g0", "evidence.json");
const policyEvidence = JSON.parse(await readFile(evidencePath, "utf8")) as Record<string, unknown>;
if (policyEvidence["policy"] !== "none" || policyEvidence["verdict"] !== "PASSED" || policyEvidence["disposition"] !== "NOT_REQUIRED") {
  throw new Error(`Unexpected policy evidence: ${JSON.stringify(policyEvidence)}`);
}
const summary = {
  schemaVersion: 1,
  validationKind: "REAL_DOCUMENTATION_POLICY_ACCEPTANCE",
  taskId,
  receipt,
  status,
  policyEvidence,
  trace: await client.trace(taskId),
  hasMoyeDocumentGraph: false,
  finalHead: await git(["rev-parse", "HEAD"]),
  targetHead: await git(["rev-parse", "refs/heads/release"]),
  boardUrl: `${boardUrl}/tasks/${taskId}`,
  runRoot,
};
await writeFile(path.join(runRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

async function git(argv: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", repositoryRoot, ...argv], { maxBuffer: 8 * 1024 * 1024 });
  return result.stdout.trim();
}
