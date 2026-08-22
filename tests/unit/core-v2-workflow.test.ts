import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCoreV2Lifecycle } from "../../src/domain/core-v2-lifecycle.js";
import { ensureGitCheckpoint } from "../../src/restate/core-v2-services.js";
import type { CoreV2WorkflowProjection } from "../../src/restate/core-v2-services.js";
import { buildCoreV2StateMachine } from "../../src/trace/state-machine.js";

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Core v2 Workflow control-plane", () => {
  it("creates and reconciles the Workflow-owned Candidate Commit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moye-core-v2-git-"));
    roots.push(root);
    await git(root, ["init"]);
    await writeFile(path.join(root, "README.md"), "base\n");
    await git(root, ["add", "README.md"]);
    await git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
    const base = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(path.join(root, "README.md"), "implemented\n");

    const checkpoint = await ensureGitCheckpoint(root, base, "TASK-CHECKPOINT", 0);
    expect(checkpoint.commit).not.toBe(base);
    expect(await git(root, ["status", "--porcelain=v1"])).toBe("");
    expect(await git(root, ["log", "-1", "--format=%B"])).toContain("Moye-Task: TASK-CHECKPOINT");
    await expect(ensureGitCheckpoint(root, base, "TASK-CHECKPOINT", 0)).resolves.toEqual(checkpoint);
  });

  it("exposes happy, repair, replan, reconcile, failure and archive paths from Runtime facts", () => {
    const lifecycle = createCoreV2Lifecycle({ taskId: "TASK-GRAPH-V2", specRevision: 1, subjectCommit: "a".repeat(40), at: "2026-08-23T00:00:00Z" });
    const projection: CoreV2WorkflowProjection = {
      schemaVersion: 1, taskId: "TASK-GRAPH-V2", projectId: "moye", title: "graph", state: "EXECUTING",
      currentStep: lifecycle.state, lifecycle, attempts: [], roleRuns: [], artifactRoot: "/tmp/artifacts",
      startedAt: "2026-08-23T00:00:00Z", completedAt: null, outcome: null, error: null,
    };
    const machine = buildCoreV2StateMachine(projection);
    expect(machine).toMatchObject({ workflow: "CoreV2Workflow", current: { overall: "ARCHITECT_REQUIRED", consistency: "VERIFIED" } });
    expect(machine.definition.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "DESIGN_REVIEW_REQUIRED", to: "REPLAN_REQUIRED", kind: "REPAIR" }),
      expect.objectContaining({ from: "REPAIR_REQUIRED", to: "IMPLEMENTATION_REQUIRED", kind: "REPAIR" }),
      expect.objectContaining({ from: "TEST_EXECUTION_REQUIRED", to: "WAITING_RECONCILE", kind: "FAILURE" }),
      expect.objectContaining({ from: "CLOSED", to: "ARCHIVED", kind: "ARCHIVE" }),
      expect.objectContaining({ to: "FAILED_TERMINAL", kind: "FAILURE" }),
    ]));
  });
});

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execute("git", args, { cwd });
  return result.stdout.trim();
}
