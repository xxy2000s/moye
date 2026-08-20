import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createTaskEnvelope } from "../domain/coding-task.js";
import type { CodingTaskWorkflowInput } from "../restate/coding-services.js";

const execFileAsync = promisify(execFile);
const fixtureContent = "由 Fake Agent 生成并通过验证。\n";

export interface CodingDemoFixtureOptions {
  readonly demoRoot: string;
  readonly taskId: string;
  readonly backlogId: string;
  readonly projectId: string;
  readonly graphRevision: number;
  readonly createdAt?: string;
}

export interface CodingDemoFixture {
  readonly fixtureRoot: string;
  readonly repositoryRoot: string;
  readonly worktreePath: string;
  readonly baseSha: string;
  readonly input: CodingTaskWorkflowInput;
}

export async function createCodingDemoFixture(options: CodingDemoFixtureOptions): Promise<CodingDemoFixture> {
  const createdAt = options.createdAt ?? new Date().toISOString();
  assertIsoTime(createdAt);
  const demoRoot = path.resolve(options.demoRoot);
  if (demoRoot === path.parse(demoRoot).root) throw new Error("Demo root cannot be the filesystem root");

  const fixturesRoot = path.join(demoRoot, "coding-fixtures");
  const fixtureRoot = path.join(fixturesRoot, options.taskId);
  const repositoryRoot = path.join(fixtureRoot, "repository");
  const worktreeRoot = path.join(fixtureRoot, "worktrees");
  const worktreePath = path.join(worktreeRoot, options.taskId);
  const artifactRoot = path.join(fixtureRoot, "artifacts");
  const activeTasksRoot = path.join(demoRoot, "tasks");
  const archiveRoot = path.join(activeTasksRoot, "archive");
  const taskRoot = path.join(activeTasksRoot, options.taskId);

  await mkdir(fixturesRoot, { recursive: true });
  await mkdir(fixtureRoot);
  await mkdir(repositoryRoot);
  await mkdir(artifactRoot);
  await mkdir(taskRoot, { recursive: true });
  await writeFile(path.join(taskRoot, "spec.md"), demoSpec(options.taskId));

  await git(repositoryRoot, ["init", "-b", "master"]);
  await git(repositoryRoot, ["config", "user.name", "Moye Demo"]);
  await git(repositoryRoot, ["config", "user.email", "moye-demo@example.test"]);
  await writeFile(path.join(repositoryRoot, "README.md"), "# Moye Coding Demo Fixture\n");
  await git(repositoryRoot, ["add", "README.md"]);
  await git(repositoryRoot, ["commit", "-m", "chore: create demo fixture"]);
  const baseSha = (await git(repositoryRoot, ["rev-parse", "HEAD"])).trim();
  await git(repositoryRoot, ["switch", "--detach", baseSha]);

  const envelope = createTaskEnvelope({
    taskId: options.taskId,
    specRevision: 1,
    baseSha,
    requirements: [{
      requirementId: "REQ-DEMO-01",
      title: "由 Agent 生成并验证演示结果",
      acceptanceCriteria: ["agent-result.txt 存在且内容与需求一致", "结果 Commit 被唯一合入 master"],
    }],
    validationCommands: [{
      commandId: "CMD-DEMO-VERIFY",
      argv: [
        process.execPath,
        "-e",
        `const fs=require("node:fs");const expected=${JSON.stringify(fixtureContent)};if(fs.readFileSync("agent-result.txt","utf8")!==expected)process.exit(2);console.log("演示结果验证通过");`,
      ],
    }],
    contextPlan: {
      graphRevision: options.graphRevision,
      intents: ["coding-task-poc", "demo"],
      requiredRead: ["agent-contract", "task-runtime-kernel"],
      requiredReview: ["codemap", "local-restate-poc-runbook"],
    },
  });

  const input: CodingTaskWorkflowInput = {
    projectId: options.projectId,
    title: "体验一个 Agent 如何完成编码、验证与合并",
    backlogRefs: [options.backlogId],
    activeTasksRoot,
    archiveRoot,
    archivedAt: createdAt,
    envelope,
    expectedEnvelopeDigest: envelope.envelopeDigest,
    repositoryRoot,
    worktreeRoot,
    artifactRoot,
    baseRef: "refs/heads/master",
    targetRef: "refs/heads/master",
    runnerKind: "FAKE",
    prompt: "在隔离演示仓库中生成 agent-result.txt，提交结果，并交给验证和合并阶段。",
    docsDisposition: "not_applicable",
    fake: {
      script: {
        events: [
          { type: "thread.started", thread_id: `agent-session-${options.taskId}` },
          { type: "turn.started" },
          { type: "item.completed", item: { type: "agent_message", text: "演示文件已生成并提交，等待自动验证。" } },
          { type: "turn.completed" },
        ],
        stderr: "Fake Agent：已在隔离 Worktree 完成演示变更。\n",
        exitCode: 0,
        startedAt: createdAt,
        durationMs: 420,
      },
      mutation: { fileName: "agent-result.txt", content: fixtureContent },
    },
  };

  return { fixtureRoot, repositoryRoot, worktreePath, baseSha, input };
}

export async function cleanupCodingDemoWorktree(fixture: CodingDemoFixture): Promise<boolean> {
  try {
    const info = await stat(fixture.worktreePath);
    if (!info.isDirectory()) throw new Error(`Demo Worktree is not a directory: ${fixture.worktreePath}`);
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
  await git(fixture.repositoryRoot, ["worktree", "remove", fixture.worktreePath]);
  await git(fixture.repositoryRoot, ["worktree", "prune"]);
  return true;
}

async function git(cwd: string, argv: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", [...argv], {
      cwd,
      encoding: "utf8",
      shell: false,
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    const candidate = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(`git ${argv[0] ?? "command"} failed: ${candidate.stderr?.trim() || candidate.message || "unknown error"}`);
  }
}

function demoSpec(taskId: string): string {
  return `# ${taskId}\n\n这是 npm run demo 创建的隔离 Coding Task，用于展示 Task、Agent、验证、Git 与归档的关联。\n`;
}

function assertIsoTime(value: string): void {
  if (Number.isNaN(Date.parse(value))) throw new Error(`Invalid demo timestamp: ${value}`);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
