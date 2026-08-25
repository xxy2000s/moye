import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCoreV2Lifecycle } from "../../src/domain/core-v2-lifecycle.js";
import { coreV2AcceptanceInstruction, coreV2AssessmentPrompt, coreV2ReviewBoundary, ensureGitCheckpoint, normalizeArchitectDeliverableV2, validateCoreV2AcceptanceControl, validateCoreV2AcceptanceMetadata, validateCoreV2ObserverKnowledge, validateCoreV2RecoveryControl, validateCoreV2SessionEvidence } from "../../src/restate/core-v2-services.js";
import type { CoreV2WorkflowProjection } from "../../src/restate/core-v2-services.js";
import { buildCoreV2StateMachine } from "../../src/trace/state-machine.js";

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Core v2 Workflow control-plane", () => {
  it("keeps acceptance fault control disabled unless the Service explicitly opts in", () => {
    expect(() => validateCoreV2AcceptanceControl(undefined, false)).not.toThrow();
    expect(() => validateCoreV2AcceptanceControl({ profile: "TEST_FAILURE" }, false)).toThrow("acceptance fault injection is disabled");
    expect(() => validateCoreV2AcceptanceControl({ profile: "TEST_FAILURE" }, true)).not.toThrow();
    expect(() => validateCoreV2AcceptanceControl({ profile: "NOT_REAL" } as never, true)).toThrow("acceptance profile is invalid");
  });

  it("accepts explicit product acceptance metadata only on an enabled acceptance Service", () => {
    const metadata = { kind: "PRODUCT_ACCEPTANCE" as const, suite: "core-v2", scenario: "HAPPY_PATH" };
    expect(() => validateCoreV2AcceptanceMetadata(undefined, false)).not.toThrow();
    expect(() => validateCoreV2AcceptanceMetadata(metadata, false)).toThrow("product acceptance metadata is disabled");
    expect(() => validateCoreV2AcceptanceMetadata(metadata, true)).not.toThrow();
    expect(() => validateCoreV2AcceptanceMetadata({ ...metadata, scenario: "" }, true)).toThrow("metadata is invalid");
  });

  it("rejects recovery process exits before TaskAuthority claim unless explicitly enabled and scoped", () => {
    const root = "/tmp/moye-core-v2-recovery";
    const control = { testExitAfterIntentOnceAt: `${root}/intent.marker` };
    expect(() => validateCoreV2RecoveryControl(undefined, undefined, root, false)).not.toThrow();
    expect(() => validateCoreV2RecoveryControl(control, undefined, root, false)).toThrow("recovery fault injection is disabled");
    expect(() => validateCoreV2RecoveryControl(control, undefined, root, true)).not.toThrow();
    expect(() => validateCoreV2RecoveryControl({ roleExitAfterIntentOnceAt: { FINAL_REVIEW: `${root}/role-intent.marker` } }, undefined, root, true)).not.toThrow();
    expect(() => validateCoreV2RecoveryControl({ testExitAfterIntentOnceAt: "/tmp/outside.marker" }, undefined, root, true)).toThrow("inside artifactRoot");
  });

  it("bounds the optional intelligent Observer timeout independently of the deterministic Observer", () => {
    expect(() => validateCoreV2ObserverKnowledge(undefined)).not.toThrow();
    expect(() => validateCoreV2ObserverKnowledge({ enabled: true, timeoutMs: 250 })).not.toThrow();
    expect(() => validateCoreV2ObserverKnowledge({ enabled: false })).toThrow("explicitly enabled");
    expect(() => validateCoreV2ObserverKnowledge({ enabled: true, timeoutMs: 0 })).toThrow("between 1 and 3600000");
  });

  it("requires an explicit Provider source root for live Session Evidence capture", () => {
    expect(() => validateCoreV2SessionEvidence(undefined, "CODEX_EXEC")).not.toThrow();
    expect(() => validateCoreV2SessionEvidence({ enabled: true, capturePolicy: "full", codexSessionsRoot: "/managed/codex/sessions" }, "CODEX_EXEC")).not.toThrow();
    expect(() => validateCoreV2SessionEvidence({ enabled: true, capturePolicy: "digest_only", claudeProjectsRoot: "/managed/claude/projects" }, "CLAUDE_PRINT")).not.toThrow();
    expect(() => validateCoreV2SessionEvidence({ enabled: true, capturePolicy: "full" }, "CODEX_EXEC")).toThrow("Provider session root");
    expect(() => validateCoreV2SessionEvidence({ enabled: true, capturePolicy: "redacted", codexSessionsRoot: "/managed" }, "CODEX_EXEC")).toThrow("capturePolicy");
  });

  it("targets acceptance conditions to one real Role phase, Revision and Generation", () => {
    expect(coreV2AcceptanceInstruction({ profile: "IMPLEMENTATION_SELF_REVIEW" }, "IMPLEMENTATION", 1, 0)).toContain("generation-zero-defect");
    expect(coreV2AcceptanceInstruction({ profile: "IMPLEMENTATION_SELF_REVIEW" }, "IMPLEMENTATION", 1, 1)).toBe("");
    expect(coreV2AcceptanceInstruction({ profile: "FINAL_REVIEW" }, "FINAL_REVIEW", 1, 0)).toContain("missing-security-doc");
    expect(coreV2AcceptanceInstruction({ profile: "DOCUMENTATION" }, "DOCUMENTATION", 1, 0)).toContain("missing-heading");
    expect(coreV2AcceptanceInstruction({ profile: "TEST_FAILURE" }, "DOCUMENTATION", 1, 0)).toContain("Trusted Runner");
    expect(coreV2AcceptanceInstruction({ profile: "DESIGN_REPLAN" }, "DESIGN_REVIEW", 1, 0)).toContain("missing-trusted-runner");
    expect(coreV2AcceptanceInstruction({ profile: "DESIGN_REPLAN" }, "DESIGN_REVIEW", 2, 0)).toBe("");
    expect(coreV2AcceptanceInstruction({ profile: "REPAIR_BUDGET" }, "IMPLEMENTATION", 1, 1)).toContain("repair-budget-defect-1");
    expect(coreV2AcceptanceInstruction({ profile: "REPLAN_BUDGET" }, "DESIGN_REVIEW", 2, 0)).toContain("missing-trusted-runner/r2");
  });

  it("keeps Design Review inside its pre-Implementation phase boundary", () => {
    expect(coreV2ReviewBoundary("DESIGN_REVIEW")).toContain("Implementation has intentionally not started");
    expect(coreV2ReviewBoundary("DESIGN_REVIEW")).toContain("absent Candidate files");
    expect(coreV2ReviewBoundary("FINAL_REVIEW")).toContain("Review the Candidate");
  });

  it("requires a stable Finding ref when real Trusted Test evidence fails", () => {
    const prompt = coreV2AssessmentPrompt({ outcome: "FAILED", cases: [{ exitCode: 17 }] }, "artifact://trusted-test");
    expect(prompt).toContain("return FINDINGS");
    expect(prompt).toContain("finding://trusted-test/nonzero-exit");
  });

  it("normalizes a real Architect scalar acceptance criterion without weakening Artifact validation", () => {
    const value = normalizeArchitectDeliverableV2({
      spec: { type: "SPEC", requirements: [{ id: "REQ-1", statement: "ship", acceptanceCriteria: "real evidence" as unknown as readonly string[] }] },
      design: { type: "DESIGN", decisions: ["one"], components: ["core"], risks: ["drift"] },
      plan: { type: "PLAN", items: [{ id: "P1", description: "implement", dependsOn: [], status: "PENDING" }] },
    });
    expect(value.spec.requirements[0]?.acceptanceCriteria).toEqual(["real evidence"]);
  });

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

  it("identifies an append-only failure recovery Workflow without changing the Core v2 graph", () => {
    const lifecycle = createCoreV2Lifecycle({ taskId: "TASK-GRAPH-RECOVERY", specRevision: 1, subjectCommit: "a".repeat(40), at: "2026-08-23T00:00:00Z" });
    const projection: CoreV2WorkflowProjection = {
      schemaVersion: 1, taskId: "TASK-GRAPH-RECOVERY", projectId: "moye", title: "recovery", state: "EXECUTING",
      currentStep: lifecycle.state, lifecycle, attempts: [], roleRuns: [], artifactRoot: "/tmp/artifacts",
      workflowRef: "restate://CoreV2FailureRecoveryAttemptWorkflow/TASK-GRAPH-RECOVERY-RECOVERY-1",
      startedAt: "2026-08-23T00:00:00Z", completedAt: null, outcome: null, error: null,
    };
    const machine = buildCoreV2StateMachine(projection);
    expect(machine.workflow).toBe("CoreV2FailureRecoveryAttemptWorkflow");
    expect(machine.definition.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "MERGE_REQUIRED", to: "ARCHIVE_PENDING", kind: "ARCHIVE" }),
      expect.objectContaining({ from: "ARCHIVE_PENDING", to: "ARCHIVE_FAILED", kind: "FAILURE" }),
    ]));
  });

  it("keeps Trace queryable for an immutable pre-Closure projection with absent nullable fields", () => {
    const legacyLifecycle = createCoreV2Lifecycle({ taskId: "TASK-GRAPH-LEGACY", specRevision: 1, subjectCommit: "a".repeat(40), at: "2026-08-23T00:00:00Z" });
    const legacy = { ...legacyLifecycle } as unknown as Record<string, unknown>;
    delete legacy["trustedTestRun"];
    delete legacy["verificationGateDigest"];
    delete legacy["mergeReceipt"];
    delete legacy["successClosure"];
    const projection: CoreV2WorkflowProjection = {
      schemaVersion: 1, taskId: "TASK-GRAPH-LEGACY", projectId: "moye", title: "legacy", state: "CLOSED",
      currentStep: "ARCHIVED", lifecycle: legacy as unknown as CoreV2WorkflowProjection["lifecycle"], attempts: [], roleRuns: [], artifactRoot: "/tmp/artifacts",
      workflowRef: "restate://CoreV2FailureRecoveryWorkflow/TASK-GRAPH-LEGACY",
      startedAt: "2026-08-23T00:00:00Z", completedAt: "2026-08-23T00:01:00Z", outcome: "FAILED_TERMINAL", error: "historical failure",
    };
    expect(() => buildCoreV2StateMachine(projection)).not.toThrow();
    expect(buildCoreV2StateMachine(projection).executions).toEqual([]);
  });
});

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execute("git", args, { cwd });
  return result.stdout.trim();
}
