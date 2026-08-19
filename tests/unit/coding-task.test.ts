import { describe, expect, it } from "vitest";

import {
  assertEvidenceCurrent,
  bindEvidence,
  cancelAttempt,
  CODING_PIPELINE_STEP_IDS,
  createInitialAttempt,
  createRetryAttempt,
  createTaskEnvelope,
  finishAttempt,
  isEvidenceCurrent,
  parseEvidenceBinding,
  parseStepAttempt,
  parseTaskEnvelope,
  recordAttemptEvidence,
  startAttempt,
} from "../../src/domain/coding-task.js";
import type { TaskEnvelopeInput } from "../../src/domain/coding-task.js";

describe("coding task protocol", () => {
  it("creates a deterministic deeply immutable Envelope and fixed Pipeline", () => {
    const input = validInput();
    const first = createTaskEnvelope(input);
    const second = createTaskEnvelope(validInput());
    (input.requirements[0]!.acceptanceCriteria as string[])[0] = "mutated";

    expect(first.envelopeDigest).toBe(second.envelopeDigest);
    expect(first.envelopeDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.requirements[0]?.acceptanceCriteria[0]).toBe("Envelope is immutable");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.contextPlan.requiredRead)).toBe(true);
    expect(Object.isFrozen(CODING_PIPELINE_STEP_IDS)).toBe(true);
    expect(first.pipeline.map((step) => step.stepId)).toEqual(CODING_PIPELINE_STEP_IDS);
    expect(first.pipeline[0]?.dependencies).toEqual([]);
    expect(first.pipeline[5]?.dependencies).toEqual(["MERGE"]);
    expect(first.pipeline.every((step) => step.specRevision === 1 && step.envelopeDigest === first.envelopeDigest)).toBe(true);
    expect(parseTaskEnvelope(JSON.parse(JSON.stringify(first)), first.envelopeDigest).envelopeDigest)
      .toBe(first.envelopeDigest);
    const reorderedPipeline = JSON.parse(JSON.stringify(first)) as Record<string, unknown>;
    reorderedPipeline["pipeline"] = first.pipeline.map((step) => ({
      dependencies: [...step.dependencies],
      envelopeDigest: step.envelopeDigest,
      specRevision: step.specRevision,
      sequence: step.sequence,
      stepId: step.stepId,
      taskId: step.taskId,
    }));
    expect(parseTaskEnvelope(reorderedPipeline, first.envelopeDigest).envelopeDigest).toBe(first.envelopeDigest);
    expect(() => parseTaskEnvelope(JSON.parse(JSON.stringify(first)), `sha256:${"0".repeat(64)}`))
      .toThrow(/does not match its digest/);
    expect(() => parseTaskEnvelope({
      ...JSON.parse(JSON.stringify(first)),
      requirements: [{ ...first.requirements[0], title: "tampered" }],
    }, first.envelopeDigest)).toThrow(/does not match its digest/);
  });

  it("preserves exact argv boundaries, fixes shell=false, and rejects empty argv and duplicate command ids", () => {
    const envelope = createTaskEnvelope({
      ...validInput(),
      validationCommands: [{ commandId: "CMD-UNIT", argv: ["npm", "run", " x ", ""] }],
    });
    expect(envelope.validationCommands[0]?.argv).toEqual(["npm", "run", " x ", ""]);
    expect(envelope.validationCommands[0]?.execution).toEqual({ shell: false });

    const explicitShell = createTaskEnvelope({
      ...validInput(),
      validationCommands: [{ commandId: "CMD-SHELL", argv: ["env", "bash", "-c", "npm test"] }],
    });
    expect(explicitShell.validationCommands[0]?.execution.shell).toBe(false);
    expect(() => createTaskEnvelope({
      ...validInput(),
      validationCommands: [{ commandId: "CMD-EMPTY", argv: [] }],
    })).toThrow(/non-empty string array/);
    expect(() => createTaskEnvelope({
      ...validInput(),
      validationCommands: [
        { commandId: "CMD-SAME", argv: ["npm", "test"] },
        { commandId: "CMD-SAME", argv: ["npm", "run", "typecheck"] },
      ],
    })).toThrow(/must be unique/);
  });

  it("rejects malformed identity, Requirements and Context Plans", () => {
    expect(() => createTaskEnvelope({ ...validInput(), baseSha: "short" })).toThrow(/baseSha/);
    expect(() => createTaskEnvelope({
      ...validInput(),
      requirements: [
        validInput().requirements[0]!,
        validInput().requirements[0]!,
      ],
    })).toThrow(/must be unique/);
    expect(() => createTaskEnvelope({
      ...validInput(),
      requirements: [{ requirementId: "free text", title: "bad", acceptanceCriteria: ["bad"] }],
    })).toThrow(/Invalid Requirement ID/);
    expect(() => createTaskEnvelope({
      ...validInput(),
      contextPlan: { ...validInput().contextPlan, graphRevision: 0 },
    })).toThrow(/positive integer/);
    expect(() => createTaskEnvelope({
      ...validInput(),
      contextPlan: { ...validInput().contextPlan, intents: [] },
    })).toThrow(/non-empty string array/);
    expect(() => createTaskEnvelope({
      ...validInput(),
      contextPlan: { ...validInput().contextPlan, requiredRead: ["docs-index", "docs-index"] },
    })).toThrow(/must be unique/);
    expect(() => createTaskEnvelope({
      ...validInput(),
      requirements: [null] as never,
    })).toThrow(/Requirement must be an object/);
    expect(() => createTaskEnvelope({
      ...validInput(),
      contextPlan: null as never,
    })).toThrow(/contextPlan must be an object/);
  });

  it("keeps Attempts independent and requires a new generation after a terminal failure", () => {
    const step = createTaskEnvelope(validInput()).pipeline[2]!;
    const first = createInitialAttempt(step, "2026-08-20T00:00:00.000Z");
    const running = startAttempt(first, "2026-08-20T00:00:01.000Z");
    const failed = finishAttempt(running, "FAILED", "2026-08-20T00:00:02.000Z", { error: "agent exited" });
    expect(() => createRetryAttempt(step, [failed], "2026-08-20T00:00:01.500Z"))
      .toThrow(/cannot be earlier/);
    const retry = createRetryAttempt(step, [failed], "2026-08-20T00:00:03.000Z");

    expect(first.status).toBe("SCHEDULED");
    expect(failed.status).toBe("FAILED");
    expect(retry.generation).toBe(2);
    expect(retry.attemptId).not.toBe(first.attemptId);
    expect(() => startAttempt(failed, "2026-08-20T00:00:04.000Z")).toThrow(/cannot start/);
    expect(() => createRetryAttempt(step, [running], "2026-08-20T00:00:04.000Z")).toThrow(/not terminal/);
    expect(() => createRetryAttempt(step, [], "2026-08-20T00:00:04.000Z")).toThrow(/complete non-empty/);
    const retryRunning = startAttempt(retry, "2026-08-20T00:00:04.000Z");
    const retryFailed = finishAttempt(retryRunning, "FAILED", "2026-08-20T00:00:05.000Z", { error: "again" });
    expect(() => createRetryAttempt(step, [retryFailed], "2026-08-20T00:00:06.000Z"))
      .toThrow(/continuous and ordered/);
    expect(() => createInitialAttempt({ ...step } as never, "2026-08-20T00:00:04.000Z"))
      .toThrow(/validated TaskEnvelope/);
    expect(() => startAttempt(first, "2026-08-19T23:59:59.000Z")).toThrow(/cannot be earlier/);
  });

  it("requires success evidence and refuses terminal Attempt revival", () => {
    const step = createTaskEnvelope(validInput()).pipeline[3]!;
    const running = startAttempt(createInitialAttempt(step, "2026-08-20T00:00:00.000Z"), "2026-08-20T00:00:01.000Z");
    expect(() => finishAttempt(running, "SUCCEEDED", "2026-08-20T00:00:02.000Z"))
      .toThrow(/requires evidenceRecords/);
    const record = recordAttemptEvidence(running, "unit.json", `sha256:${"b".repeat(64)}`);
    const succeeded = finishAttempt(running, "SUCCEEDED", "2026-08-20T00:00:02.000Z", {
      evidenceRecords: [record],
    });
    expect(succeeded.evidenceRecords[0]?.artifactRef).toContain(`${running.attemptId}/unit.json`);
    expect(parseStepAttempt(
      JSON.parse(JSON.stringify(succeeded)),
      createTaskEnvelope(validInput()),
      succeeded.attemptDigest,
    ).attemptDigest)
      .toBe(succeeded.attemptDigest);
    expect(() => cancelAttempt(succeeded, "2026-08-20T00:00:03.000Z")).toThrow(/already SUCCEEDED/);
    expect(() => finishAttempt(running, "SUCCEEDED", "2026-08-20T00:00:02.000Z", {
      evidenceRecords: [record],
      error: "contradiction",
    })).toThrow(/cannot carry an error/);
  });

  it("invalidates prior evidence when Spec Revision or Envelope content changes", () => {
    const first = createTaskEnvelope(validInput());
    const running = startAttempt(
      createInitialAttempt(first.pipeline[3]!, "2026-08-20T00:00:00.000Z"),
      "2026-08-20T00:00:01.000Z",
    );
    const record = recordAttemptEvidence(
      running,
      "task-0003.json",
      `sha256:${"c".repeat(64)}`,
    );
    const succeeded = finishAttempt(running, "SUCCEEDED", "2026-08-20T00:00:02.000Z", {
      evidenceRecords: [record],
    });
    const binding = bindEvidence(first, succeeded);
    const revisionTwo = createTaskEnvelope({ ...validInput(), specRevision: 2 });
    const changedContext = createTaskEnvelope({
      ...validInput(),
      contextPlan: { ...validInput().contextPlan, graphRevision: 12 },
    });

    expect(isEvidenceCurrent(first, binding)).toBe(true);
    assertEvidenceCurrent(first, binding);
    expect(isEvidenceCurrent(revisionTwo, binding)).toBe(false);
    expect(isEvidenceCurrent(changedContext, binding)).toBe(false);
    expect(() => assertEvidenceCurrent(revisionTwo, binding)).toThrow(/does not match/);
    const forgedEnvelope = {
      ...first,
      requirements: [{ ...first.requirements[0]!, title: "forged while retaining digest" }],
    };
    expect(isEvidenceCurrent(forgedEnvelope as never, binding)).toBe(false);
    const forgedBinding = Object.freeze({
      ...binding,
      specRevision: revisionTwo.specRevision,
      envelopeDigest: revisionTwo.envelopeDigest,
    });
    expect(isEvidenceCurrent(revisionTwo, forgedBinding)).toBe(false);

    const revisionTwoRunning = startAttempt(
      createInitialAttempt(revisionTwo.pipeline[3]!, "2026-08-20T00:00:03.000Z"),
      "2026-08-20T00:00:04.000Z",
    );
    expect(() => finishAttempt(revisionTwoRunning, "SUCCEEDED", "2026-08-20T00:00:05.000Z", {
      evidenceRecords: [record],
    })).toThrow(/not produced by this Attempt/);

    const parsedAttempt = parseStepAttempt(JSON.parse(JSON.stringify(succeeded)), first, succeeded.attemptDigest);
    const parsedBinding = parseEvidenceBinding(
      JSON.parse(JSON.stringify(binding)), first, parsedAttempt, binding.bindingDigest,
    );
    expect(isEvidenceCurrent(first, parsedBinding)).toBe(true);
  });
});

function validInput(): TaskEnvelopeInput {
  return {
    taskId: "TASK-0003",
    specRevision: 1,
    baseSha: "a".repeat(40),
    requirements: [{
      requirementId: "REQ-0003-01",
      title: "Immutable Envelope",
      acceptanceCriteria: ["Envelope is immutable"],
    }],
    validationCommands: [{ commandId: "CMD-UNIT", argv: ["npm", "test"] }],
    contextPlan: {
      graphRevision: 11,
      intents: ["coding-task-poc"],
      requiredRead: ["agent-contract", "task-runtime-kernel"],
      requiredReview: ["architecture-overview"],
    },
  };
}
