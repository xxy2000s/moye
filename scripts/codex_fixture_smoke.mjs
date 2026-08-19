import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CodexExecAgentRunner } from "../src/agent/codex-exec.ts";
import { runCodingWorkflow } from "../src/coding/workflow.ts";
import { createTaskEnvelope } from "../src/domain/coding-task.ts";

const repositoryRoot = process.cwd();
const evidenceRoot = path.join(repositoryRoot, "docs", "delivery", "tasks", "TASK-0006", "evidence", "codex-smoke-v2");
const summaryPath = path.join(evidenceRoot, "summary.json");
try {
  await access(summaryPath);
  throw new Error(`Refusing to overwrite frozen Codex Smoke evidence: ${summaryPath}`);
} catch (error) {
  if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
}
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "moye-real-codex-smoke-"));
const fixtureRepository = path.join(fixtureRoot, "repository");

try {
  await mkdir(fixtureRepository);
  await mkdir(evidenceRoot, { recursive: true });
  git(fixtureRepository, "init", "-b", "master");
  git(fixtureRepository, "config", "user.name", "Moye Codex Fixture");
  git(fixtureRepository, "config", "user.email", "moye-codex@example.test");
  await writeFile(path.join(fixtureRepository, "README.md"), "Disposable Moye Codex fixture.\n");
  git(fixtureRepository, "add", "README.md");
  git(fixtureRepository, "commit", "-m", "fixture base");
  const baseSha = git(fixtureRepository, "rev-parse", "HEAD").trim();
  git(fixtureRepository, "switch", "--detach", baseSha);
  const envelope = createTaskEnvelope({
    taskId: "TASK-CODEX-SMOKE-V2",
    specRevision: 1,
    baseSha,
    requirements: [{
      requirementId: "REQ-CODEX-SMOKE-V2-01",
      title: "Create one fixture result",
      acceptanceCriteria: ["result.txt contains exactly codex fixture ok followed by newline"],
    }],
    validationCommands: [{
      commandId: "CMD-CODEX-SMOKE-V2",
      argv: [process.execPath, "-e", "const fs=require('fs');const files=fs.readdirSync('.').filter(x=>x!=='README.md'&&x!=='.git');if(files.length!==1||files[0]!=='result.txt'||fs.readFileSync('result.txt','utf8')!=='codex fixture ok\\n')process.exit(2);console.log('real codex fixture verified')"],
    }],
    contextPlan: {
      graphRevision: 17,
      intents: ["coding-task-poc"],
      requiredRead: ["agent-contract"],
      requiredReview: [],
    },
  });
  const result = await runCodingWorkflow({
    envelope,
    expectedEnvelopeDigest: envelope.envelopeDigest,
    repositoryRoot: fixtureRepository,
    worktreeRoot: path.join(fixtureRoot, "worktrees"),
    artifactRoot: evidenceRoot,
    baseRef: "refs/heads/master",
    targetRef: "refs/heads/master",
    runnerKind: "CODEX_EXEC",
    prompt: [
      "Work only in this disposable fixture Git repository.",
      "Create result.txt with exactly this content including one trailing newline: codex fixture ok",
      "Do not modify README.md and do not create any other files.",
      "Run a local check if useful, then git add result.txt and commit it with message: codex fixture result",
      "Do not use network access. Finish with a concise final message.",
    ].join("\n"),
    docsDisposition: "not_applicable",
  }, {
    agentRunner: new CodexExecAgentRunner(),
  });
  if (result.state !== "CLOSED" || result.outcome !== "SUCCEEDED" || !result.merge?.mergeCommit) {
    throw new Error(`Real Codex fixture did not close successfully: ${JSON.stringify(result, null, 2)}`);
  }
  const masterHead = git(fixtureRepository, "rev-parse", "master").trim();
  const mergeMarkers = git(fixtureRepository, "log", "master", "--fixed-strings", "--grep", result.merge.effectId, "--format=%H")
    .trim().split("\n").filter(Boolean);
  const agentRunToken = result.agent.runId.slice(result.agent.runId.lastIndexOf(":") + 1);
  const agentIntentPath = path.join(evidenceRoot, "agent", `run-${agentRunToken}`, "execution-intent.json");
  const verificationFiles = await readdir(path.join(evidenceRoot, "verification"));
  const verificationIntent = verificationFiles.find((name) => name.endsWith(".intent.json"));
  const verificationOutcome = verificationFiles.find((name) => name.endsWith(".outcome.json"));
  const archiveReceiptPath = path.join(evidenceRoot, "archive", "TASK-CODEX-SMOKE-V2.json");
  await Promise.all([access(agentIntentPath), access(archiveReceiptPath)]);
  if (verificationIntent === undefined || verificationOutcome === undefined
      || result.attempts.length !== 6 || result.evidenceBindings.length !== 6
      || result.attempts.some((attempt) => attempt.status !== "SUCCEEDED")) {
    throw new Error("Current Codex Smoke did not persist the complete intent/attempt/evidence chain");
  }
  const summary = {
    schemaVersion: 1,
    executedAt: new Date().toISOString(),
    codexVersion: execFileSync("codex", ["--version"], { encoding: "utf8" }).trim(),
    fixtureBase: baseSha,
    taskId: result.taskId,
    sessionId: result.agent?.sessionId,
    agentRunId: result.agent?.runId,
    agentRunDigest: result.agent?.runDigest,
    resultCommit: result.checkpoint?.commitSha,
    treeDigest: result.checkpoint?.treeDigest,
    verificationDigest: result.verification?.passed ? result.verification.verificationDigest : null,
    mergeEffectId: result.merge.effectId,
    mergeCommit: result.merge.mergeCommit,
    masterHead,
    mergeMarkerCount: mergeMarkers.length,
    docsArtifact: result.docs,
    agentExecutionIntent: path.relative(evidenceRoot, agentIntentPath),
    verificationIntent: path.join("verification", verificationIntent),
    verificationOutcome: path.join("verification", verificationOutcome),
    attemptCount: result.attempts.length,
    evidenceBindingCount: result.evidenceBindings.length,
    archiveReceipt: path.relative(evidenceRoot, archiveReceiptPath),
    outcome: result.outcome,
    archiveStatus: result.archiveStatus,
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

function git(cwd, ...argv) {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
