import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  persistBootstrapClosure,
  verifyAndPersistBootstrapClosure,
  verifyBootstrapEvidence,
} from "../../src/archive/bootstrap-closure.js";
import { resolveExistingTaskArtifact } from "../../src/archive/task-artifacts.js";
import {
  closeTask,
  createTaskProjection,
  recordBootstrapEvidence,
  transitionTask,
  updateArchiveStatus,
} from "../../src/domain/task.js";
import type { TaskExecutionEvidence, TaskProjection } from "../../src/domain/task.js";

describe("bootstrap closure artifact", () => {
  it("persists truthful closure state idempotently before archive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-bootstrap-"));
    const taskRoot = path.join(root, "TASK-BOOTSTRAP");
    await mkdir(taskRoot);
    await writeFile(path.join(taskRoot, "task.yaml"), "schema_version: 1\nid: TASK-BOOTSTRAP\nstatus: received\nspec_revision: 1\narchive:\n  status: not_ready\nresult: {}\n");
    const created = createTaskProjection({
      taskId: "TASK-BOOTSTRAP",
      projectId: "moye",
      title: "bootstrap",
      specRevision: 1,
      backlogRefs: [],
    }, "2026-08-20T00:00:00.000Z");
    const executing = transitionTask(created, "EXECUTING", "bootstrap", "2026-08-20T00:00:01.000Z");
    const evidence = {
      kind: "GOAL_BOOTSTRAP" as const,
      executorId: "goal/root",
      resultCommit: "d".repeat(40),
      verificationRefs: ["task-artifact://TASK-BOOTSTRAP/verification.md"],
      docsImpactRef: "task-artifact://TASK-BOOTSTRAP/docs-impact.yaml",
    };
    const evidenced = recordBootstrapEvidence(executing, evidence, "2026-08-20T00:00:02.000Z");
    const verifying = transitionTask(evidenced, "VERIFYING", "verification", "2026-08-20T00:00:03.000Z");
    const closed = closeTask(verifying, "SUCCEEDED", "2026-08-20T00:00:04.000Z");
    const input = { activeTasksRoot: root, task: closed, evidence, workflowId: "task/TASK-BOOTSTRAP" };

    await persistBootstrapClosure(input);
    const first = await readFile(path.join(taskRoot, "task.yaml"), "utf8");
    await persistBootstrapClosure(input);
    const second = await readFile(path.join(taskRoot, "task.yaml"), "utf8");
    const manifest = parse(second) as Record<string, unknown>;

    expect(second).toBe(first);
    expect(manifest).toMatchObject({ status: "closed", outcome: "succeeded", archive: { status: "pending" } });
    expect(await readFile(path.join(taskRoot, "bootstrap-runtime-evidence.json"), "utf8")).toContain(evidence.resultCommit);
  });

  it("resolves the same stable artifact ref after the Task package moves to Archive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-artifact-"));
    const activeRoot = path.join(root, "active");
    const archivePath = path.join(activeRoot, "archive", "2026-08-20-TASK-ARTIFACT");
    await mkdir(archivePath, { recursive: true });
    await writeFile(path.join(archivePath, "verification.md"), "accepted\n");
    const closed = closedProjection("TASK-ARTIFACT");
    const archived = updateArchiveStatus(closed, "ARCHIVED", "2026-08-20T00:00:05.000Z", { archivePath });

    await expect(resolveExistingTaskArtifact({
      task: archived,
      activeTasksRoot: activeRoot,
      ref: "task-artifact://TASK-ARTIFACT/verification.md",
    })).resolves.toBe(await realpath(path.join(archivePath, "verification.md")));
  });

  it("rejects an artifact symlink that escapes its Task package", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-artifact-escape-"));
    const activeRoot = path.join(root, "active");
    const taskRoot = path.join(activeRoot, "TASK-ARTIFACT");
    const outside = path.join(root, "outside.md");
    await mkdir(taskRoot, { recursive: true });
    await writeFile(outside, "secret\n");
    await symlink(outside, path.join(taskRoot, "verification.md"));
    const task = createTaskProjection({
      taskId: "TASK-ARTIFACT",
      projectId: "moye",
      title: "artifact",
      specRevision: 1,
      backlogRefs: [],
    }, "2026-08-20T00:00:00.000Z");

    await expect(resolveExistingTaskArtifact({
      task,
      activeTasksRoot: activeRoot,
      ref: "task-artifact://TASK-ARTIFACT/verification.md",
    })).rejects.toThrow(/escapes its package/);
  });

  it("accepts a clean HEAD whose frozen base, blobs and complete impact all match", async () => {
    const fixture = await evidenceRepository();
    await expect(verifyBootstrapEvidence(fixture.verificationInput())).resolves.toBeUndefined();
  });

  it("rejects a result commit that is no longer HEAD", async () => {
    const fixture = await evidenceRepository();
    await writeFile(path.join(fixture.root, "later.txt"), "later\n");
    commit(fixture.root, "later");
    await expect(verifyBootstrapEvidence(fixture.verificationInput())).rejects.toThrow(/not current HEAD/);
  });

  it("rejects dirty evidence and does not persist CLOSED state", async () => {
    const fixture = await evidenceRepository();
    await writeFile(fixture.verificationPath, "> 状态：Accepted\nchanged but uncommitted\n");
    const closed = closedProjection(fixture.taskId);
    await expect(verifyAndPersistBootstrapClosure({
      ...fixture.verificationInput(),
      activeTasksRoot: path.join(fixture.root, "docs", "delivery", "tasks"),
      task: closed,
      workflowId: `task/${fixture.taskId}`,
    })).rejects.toThrow(/clean worktree/);
    expect(await readFile(fixture.manifestPath, "utf8")).toContain("status: received");
  });

  it("reconciles an unknown persist result without rejecting its own dirty replay artifacts", async () => {
    const fixture = await evidenceRepository();
    const input = {
      ...fixture.verificationInput(),
      activeTasksRoot: path.join(fixture.root, "docs", "delivery", "tasks"),
      task: closedProjection(fixture.taskId),
      workflowId: `task/${fixture.taskId}`,
    };
    await verifyAndPersistBootstrapClosure(input);
    const evidencePath = path.join(path.dirname(fixture.manifestPath), "bootstrap-runtime-evidence.json");
    await rm(evidencePath);

    await expect(verifyAndPersistBootstrapClosure(input)).resolves.toBeUndefined();
    expect(await readFile(fixture.manifestPath, "utf8")).toContain("status: closed");
    expect(await readFile(evidencePath, "utf8")).toContain(fixture.resultCommit);
  });

  it("rejects an artifact URI for another Task", async () => {
    const fixture = await evidenceRepository();
    const input = fixture.verificationInput();
    await expect(verifyBootstrapEvidence({
      ...input,
      evidence: { ...input.evidence, verificationRefs: ["task-artifact://TASK-OTHER/verification.md"] },
    })).rejects.toThrow(/must use task-artifact/);
  });

  it("rejects a non-bootstrap kind at the filesystem verification boundary", async () => {
    const fixture = await evidenceRepository();
    const input = fixture.verificationInput();
    await expect(verifyBootstrapEvidence({
      ...input,
      evidence: { ...input.evidence, kind: "AGENT" } as never,
    })).rejects.toThrow(/kind must be GOAL_BOOTSTRAP/);
  });

  it("rejects a base_commit changed after Task introduction", async () => {
    const fixture = await evidenceRepository();
    const current = await readFile(fixture.manifestPath, "utf8");
    await writeFile(fixture.manifestPath, current.replace(fixture.baseCommit, fixture.resultCommit));
    const resultCommit = commit(fixture.root, "tamper base");
    await expect(verifyBootstrapEvidence(fixture.verificationInput(resultCommit))).rejects.toThrow(/was not frozen/);
  });

  it("rejects Docs Impact that omits a real changed path", async () => {
    const fixture = await evidenceRepository();
    await writeFile(fixture.impactPath, "schema_version: 1\nchanged_paths: []\n");
    const resultCommit = commit(fixture.root, "incomplete impact");
    await expect(verifyBootstrapEvidence(fixture.verificationInput(resultCommit)))
      .rejects.toThrow(/does not cover changed paths/);
  });
});

function closedProjection(taskId: string): TaskProjection {
  const created = createTaskProjection({
    taskId,
    projectId: "moye",
    title: "bootstrap",
    specRevision: 1,
    backlogRefs: [],
  }, "2026-08-20T00:00:00.000Z");
  const executing = transitionTask(created, "EXECUTING", "bootstrap", "2026-08-20T00:00:01.000Z");
  const verifying = transitionTask(executing, "VERIFYING", "verification", "2026-08-20T00:00:02.000Z");
  return closeTask(verifying, "SUCCEEDED", "2026-08-20T00:00:03.000Z");
}

async function evidenceRepository(): Promise<{
  root: string;
  taskId: string;
  baseCommit: string;
  resultCommit: string;
  manifestPath: string;
  verificationPath: string;
  impactPath: string;
  verificationInput: (resultCommit?: string) => {
    repositoryRoot: string;
    taskId: string;
    evidence: TaskExecutionEvidence;
  };
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-evidence-"));
  git(root, ["init", "-b", "master"]);
  git(root, ["config", "user.email", "moye@example.invalid"]);
  git(root, ["config", "user.name", "Moye Test"]);
  await writeFile(path.join(root, "README.md"), "fixture\n");
  const baseCommit = commit(root, "base");
  const taskId = "TASK-EVIDENCE";
  const taskRoot = path.join(root, "docs", "delivery", "tasks", taskId);
  const scriptsRoot = path.join(root, "scripts");
  await mkdir(taskRoot, { recursive: true });
  await mkdir(scriptsRoot, { recursive: true });
  const manifestPath = path.join(taskRoot, "task.yaml");
  const verificationPath = path.join(taskRoot, "verification.md");
  const impactPath = path.join(taskRoot, "docs-impact.yaml");
  await writeFile(manifestPath, `schema_version: 1\nid: ${taskId}\nstatus: received\nspec_revision: 1\nexecution_mode: goal-bootstrap\nbase_commit: ${baseCommit}\narchive:\n  status: not_ready\nresult: {}\n`);
  await writeFile(verificationPath, "> 状态：Accepted\n");
  await writeFile(impactPath, `schema_version: 1\nchanged_paths:\n  - docs/delivery/tasks/${taskId}/task.yaml\n  - docs/delivery/tasks/${taskId}/verification.md\n  - docs/delivery/tasks/${taskId}/docs-impact.yaml\n  - scripts/docs_graph.rb\n`);
  await writeFile(path.join(scriptsRoot, "docs_graph.rb"), "exit 0\n");
  const resultCommit = commit(root, "result");
  const verificationInput = (commitOverride = resultCommit) => ({
    repositoryRoot: root,
    taskId,
    evidence: {
      kind: "GOAL_BOOTSTRAP" as const,
      executorId: "goal/root",
      resultCommit: commitOverride,
      verificationRefs: [`task-artifact://${taskId}/verification.md`],
      docsImpactRef: `task-artifact://${taskId}/docs-impact.yaml`,
    },
  });
  return {
    root, taskId, baseCommit, resultCommit, manifestPath, verificationPath, impactPath, verificationInput,
  };
}

function commit(root: string, message: string): string {
  git(root, ["add", "."]);
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}
