import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { stringify } from "yaml";

import { MoyeClient } from "../src/framework/client.js";
import { runProjectDoctor } from "../src/framework/doctor.js";
import { defaultProjectManifest } from "../src/framework/project-manifest.js";

const execFileAsync = promisify(execFile);
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const runRoot = path.resolve(process.env["MOYE_FRAMEWORK_CLIENT_ACCEPTANCE_ROOT"] ?? `.moye-runtime/framework-client-acceptance/${stamp}`);
const repositoryRoot = path.join(runRoot, "repository");
const runtimeRoot = path.join(runRoot, "runtime");
const manifestPath = path.join(repositoryRoot, ".moye", "project.yaml");
const ingressUrl = process.env["RESTATE_INGRESS_URL"] ?? "http://127.0.0.1:8080";
const boardUrl = process.env["MOYE_BOARD_URL"] ?? "http://127.0.0.1:3000";
const taskId = `TASK-FRAMEWORK-${stamp}`;

await mkdir(path.join(repositoryRoot, ".moye"), { recursive: true });
await mkdir(path.join(repositoryRoot, "test"), { recursive: true });
await writeFile(path.join(repositoryRoot, "package.json"), `${JSON.stringify({ name: "framework-client-acceptance", private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
await writeFile(path.join(repositoryRoot, "README.md"), "# Framework Client Acceptance\n");
await writeFile(path.join(repositoryRoot, "test", "value.test.mjs"), [
  'import assert from "node:assert/strict";',
  'import { readFile } from "node:fs/promises";',
  'import test from "node:test";',
  'test("accepted value", async () => {',
  '  assert.equal(await readFile(new URL("../src/value.txt", import.meta.url), "utf8"), "accepted-value\\n");',
  '});',
  "",
].join("\n"));
const manifest = structuredClone(defaultProjectManifest("framework-client-acceptance"));
(manifest as { tests: unknown }).tests = [{ id: "node-test", argv: ["npm", "test"], cwd: "." }];
(manifest as { repository: { targetRef: string } }).repository.targetRef = "refs/heads/release";
await writeFile(manifestPath, stringify(manifest, { lineWidth: 0 }));
await git(["init", "-q"]);
await git(["add", "."]);
await git(["-c", "user.name=Moye Acceptance", "-c", "user.email=acceptance@moye.local", "commit", "-qm", "base"]);
await git(["update-ref", "refs/heads/release", "HEAD"]);

const doctor = await runProjectDoctor({ manifestPath, ingressUrl, boardUrl, runtimeRoot });
await writeJson("doctor.json", doctor);
if (!doctor.ok) throw new Error(`Framework doctor failed: ${JSON.stringify(doctor.checks)}`);

const client = new MoyeClient({ ingressUrl, boardUrl, runtimeRoot });
const receipt = await client.startTask({
  manifestPath,
  taskId,
  title: "Framework Client real task",
  objective: "Create src/value.txt whose complete content is exactly accepted-value followed by one newline; add the exact README heading ## Accepted behavior; create SECURITY.md with a # Security heading.",
  acceptanceCriteria: [
    "src/value.txt contains exactly accepted-value followed by one newline",
    "README.md contains the exact heading ## Accepted behavior",
    "SECURITY.md contains a # Security heading",
    "the configured npm test command passes",
  ],
});
await writeJson("receipt.json", receipt);
const status = await client.wait(taskId, { timeoutMs: 25 * 60_000 });
await writeJson("status.json", status);
if (status.archiveStatus !== "ARCHIVED" || status.outcome !== "SUCCEEDED") throw new Error(`Framework task ended ${status.state}/${status.archiveStatus}/${status.outcome}`);
const trace = await client.trace(taskId);
await writeJson("trace.json", trace);
const summary = {
  schemaVersion: 1,
  validationKind: "REAL_FRAMEWORK_CLIENT_ACCEPTANCE",
  taskId,
  receipt,
  status,
  doctor,
  baseCommit: await git(["rev-list", "--max-parents=0", "HEAD"]),
  finalHead: await git(["rev-parse", "HEAD"]),
  targetHead: await git(["rev-parse", "refs/heads/release"]),
  value: await readFile(path.join(repositoryRoot, "src", "value.txt"), "utf8"),
  runRoot,
};
await writeJson("summary.json", summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

async function git(args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", repositoryRoot, ...args], { maxBuffer: 8 * 1024 * 1024 });
  return result.stdout.trim();
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await writeFile(path.join(runRoot, name), `${JSON.stringify(value, null, 2)}\n`);
}
