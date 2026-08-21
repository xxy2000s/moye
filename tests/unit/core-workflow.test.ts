import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { executeCoreScenarioArtifact } from "../../src/core/scenario-artifact.js";
import { executeCoreScenario, type CoreScenario } from "../../src/core/workflow.js";
import { createTaskEnvelope } from "../../src/domain/coding-task.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Core Workflow scenario protocol", () => {
  it.each([
    ["SUCCESS", "SUCCEEDED", 3],
    ["REPAIR", "SUCCEEDED", 5],
    ["REPLAN", "SUCCEEDED", 6],
    ["UNKNOWN", "SUCCEEDED", 3],
    ["BUDGET_EXHAUSTED", "FAILED_TERMINAL", 0],
    ["CANCELLED", "CANCELLED", 0],
  ] as const)("converges %s to %s", async (scenario, outcome, executions) => {
    const envelope = taskEnvelope(scenarioId(scenario));
    const result = await executeCoreScenario({
      envelope,
      scenario,
      invocationRef: `restate-workflow://CoreClosureWorkflow/${envelope.taskId}`,
      observerFailure: scenario === "UNKNOWN",
      docsGateFailureOnce: scenario === "SUCCESS",
    });

    expect(result.closed.outcome).toBe(outcome);
    expect(result.roleExecutionCount).toBe(executions);
    expect(result.docsGateAttempts).toBe(scenario === "SUCCESS" ? 2 : outcome === "SUCCEEDED" ? 1 : 0);
    expect(result.observerError).toBe(scenario === "UNKNOWN" ? "injected observer failure" : null);
    if (scenario === "REPLAN") expect(result.finalEnvelope.specRevision).toBe(2);
  });

  it("reconciles a content-addressed result without re-executing the expensive scenario", async () => {
    const artifactRoot = await temporaryRoot();
    const envelope = taskEnvelope("TASK-CORE-REPLAY");
    const input = {
      envelope,
      scenario: "REPAIR" as const,
      artifactRoot,
      invocationRef: `restate-workflow://CoreClosureWorkflow/${envelope.taskId}`,
    };

    const first = await executeCoreScenarioArtifact(input);
    const replay = await executeCoreScenarioArtifact(input);

    expect(replay).toEqual(first);
    expect(replay.executionCount).toBe(1);
    expect(replay.scenarioResult.closed.closureResult.closureDigest)
      .toBe(first.scenarioResult.closed.closureResult.closureDigest);
  });

  it("rejects disabled fault injection before creating an artifact", async () => {
    const artifactRoot = await temporaryRoot();
    const envelope = taskEnvelope("TASK-CORE-FAULT-OFF");
    const previous = process.env["MOYE_TEST_FAULT_INJECTION"];
    delete process.env["MOYE_TEST_FAULT_INJECTION"];
    try {
      await expect(executeCoreScenarioArtifact({
        envelope,
        scenario: "SUCCESS",
        artifactRoot,
        invocationRef: `restate-workflow://CoreClosureWorkflow/${envelope.taskId}`,
        fault: { exitAfterResultOnce: true, markerPath: path.join(artifactRoot, "fault.marker") },
      })).rejects.toThrow(/fault injection is disabled/i);
      await expect(executeCoreScenarioArtifact({
        envelope,
        scenario: "SUCCESS",
        artifactRoot,
        invocationRef: `restate-workflow://CoreClosureWorkflow/${envelope.taskId}`,
      })).resolves.toMatchObject({ executionCount: 1 });
    } finally {
      if (previous === undefined) delete process.env["MOYE_TEST_FAULT_INJECTION"];
      else process.env["MOYE_TEST_FAULT_INJECTION"] = previous;
    }
  });

  it("rejects a symlink Artifact Root", async () => {
    const fixtureRoot = await temporaryRoot();
    const realRoot = path.join(fixtureRoot, "real");
    const linkRoot = path.join(fixtureRoot, "link");
    await mkdir(realRoot);
    await symlink(realRoot, linkRoot);
    const envelope = taskEnvelope("TASK-CORE-SYMLINK");

    await expect(executeCoreScenarioArtifact({
      envelope,
      scenario: "SUCCESS",
      artifactRoot: linkRoot,
      invocationRef: `restate-workflow://CoreClosureWorkflow/${envelope.taskId}`,
    })).rejects.toThrow(/Artifact root.*symlink/i);
  });

  it("rejects an unknown scenario before creating an Artifact", async () => {
    const artifactRoot = await temporaryRoot();
    const envelope = taskEnvelope("TASK-CORE-BAD-SCENARIO");
    await expect(executeCoreScenarioArtifact({
      envelope,
      scenario: "NOT_A_SCENARIO" as CoreScenario,
      artifactRoot,
      invocationRef: `restate-workflow://CoreClosureWorkflow/${envelope.taskId}`,
    })).rejects.toThrow(/Invalid Core scenario/);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-core-unit-"));
  roots.push(root);
  return root;
}

function taskEnvelope(taskId: string) {
  return createTaskEnvelope({
    taskId,
    specRevision: 1,
    baseSha: "a".repeat(40),
    requirements: [{ requirementId: "REQ-CORE-FLOW", title: "execute Core", acceptanceCriteria: ["converges"] }],
    validationCommands: [{ commandId: "CMD-CORE-FLOW", argv: ["npm", "test"] }],
    contextPlan: {
      graphRevision: 43,
      intents: ["task-runtime-change"],
      requiredRead: ["agent-contract", "task-runtime-kernel"],
      requiredReview: ["architecture-overview"],
    },
  });
}

function scenarioId(scenario: CoreScenario): string {
  return `TASK-${({
    SUCCESS: "CORE-SUCCESS",
    REPAIR: "CORE-REPAIR",
    REPLAN: "CORE-REPLAN",
    UNKNOWN: "CORE-UNKNOWN",
    BUDGET_EXHAUSTED: "CORE-BUDGET",
    CANCELLED: "CORE-CANCEL",
  } as const)[scenario]}`;
}
