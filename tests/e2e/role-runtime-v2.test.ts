import { chmod, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  RealRoleRuntimeV2,
  inspectRealRoleRunV2,
  prepareRealRoleRunV2,
  writeRealRoleRunIntentV2,
} from "../../src/agent/role-runtime-v2.js";
import {
  createRoleRunEvidenceV2,
  createNextRoleAttemptV2,
  createRoleAttemptV2,
  markRoleAttemptUnknownV2,
  reconcileRoleAttemptV2,
  renderRoleAgentPromptV2,
  startRoleAttemptV2,
} from "../../src/domain/role-runtime-v2.js";
import type { AgentRoleV2, RolePhaseV2 } from "../../src/domain/role-runtime-v2.js";
import { assertPromptEnvelopePreparedRoleRunV2, createPromptEnvelopeV1, createSessionEvidenceBindingFromRoleManifestV2 } from "../../src/domain/session-transcript.js";

const commit = "7".repeat(40);
const sha = (letter: string) => `sha256:${letter.repeat(64)}`;

describe("Real Core v2 Role Runtime", () => {
  it("runs every main Agent class in a real OS process and durably reuses the completed Run", async () => {
    const fixture = await realCliFixture();
    const runtime = new RealRoleRuntimeV2({ codexExecutable: fixture.executable });
    const roles: Array<[AgentRoleV2, RolePhaseV2]> = [
      ["ARCHITECT", "ARCHITECT"],
      ["IMPLEMENTATION", "IMPLEMENTATION"],
      ["DOCUMENTATION", "DOCUMENTATION"],
      ["TEST_VERIFICATION", "TEST_PLAN"],
      ["TEST_VERIFICATION", "TEST_ASSESSMENT"],
      ["REVIEW", "DESIGN_REVIEW"],
      ["REVIEW", "FINAL_REVIEW"],
      ["OBSERVER_KNOWLEDGE", "OBSERVER_KNOWLEDGE"],
    ];

    for (const [role, phase] of roles) {
      const attempt = running(role, phase);
      const input = {
        attempt,
        scopeRoot: fixture.scope,
        artifactRoot: fixture.artifacts,
        instructions: `Execute the real ${role}/${phase} responsibility.`,
      };
      const request = await prepareRealRoleRunV2(input);
      const renderedPrompt = renderRoleAgentPromptV2({ role, phase, instructions: input.instructions, permission: attempt.permission });
      const promptEnvelope = createPromptEnvelopeV1({
        taskId: attempt.taskId, sourceWorkflowRef: `restate://CoreV2Workflow/${attempt.taskId}`, specRevision: attempt.specRevision, generation: attempt.generation,
        role, phase, attemptId: attempt.attemptId, attemptDigest: attempt.attemptDigest, runId: request.runId, operationId: request.operationId, requestDigest: request.requestDigest,
        runnerKind: attempt.runnerKind, permission: attempt.permission, subjectCommit: attempt.subjectCommit, capturePolicy: "full",
        renderer: { name: "real-role-prompt-v2", version: "1", optionsDigest: sha("0") }, renderPlan: { separator: "\n" },
        segments: [
          { ordinal: 0, kind: "MOYE_CONTROL", content: { originalValue: `You are the ${role}/${phase} Agent for a real Moye Task.`, policy: "full" } },
          { ordinal: 1, kind: "ROLE_INSTRUCTIONS", content: { originalValue: input.instructions, policy: "full" } },
          { ordinal: 2, kind: "PERMISSION_BOUNDARY", content: { originalValue: `Permission boundary: ${attempt.permission}.`, policy: "full" } },
          { ordinal: 3, kind: "OUTPUT_CONTRACT", content: { originalValue: "Return only the required structured output. Do not claim artifacts or findings that do not exist.", policy: "full" } },
        ],
        renderedPrompt: { originalValue: renderedPrompt, policy: "full" }, createdAt: "2026-08-25T00:00:00.000Z",
      });
      expect(() => assertPromptEnvelopePreparedRoleRunV2(promptEnvelope, request)).not.toThrow();
      const forgedInstructions = `${input.instructions} forged`;
      const forgedPrompt = renderedPrompt.replace(input.instructions, forgedInstructions);
      const wrongPrompt = createPromptEnvelopeV1({
        taskId: attempt.taskId, sourceWorkflowRef: `restate://CoreV2Workflow/${attempt.taskId}`, specRevision: attempt.specRevision, generation: attempt.generation,
        role, phase, attemptId: attempt.attemptId, attemptDigest: attempt.attemptDigest, runId: request.runId, operationId: request.operationId, requestDigest: request.requestDigest,
        runnerKind: attempt.runnerKind, permission: attempt.permission, subjectCommit: attempt.subjectCommit, capturePolicy: "full",
        renderer: { name: "real-role-prompt-v2", version: "1", optionsDigest: sha("0") }, renderPlan: { separator: "\n" },
        segments: [
          { ordinal: 0, kind: "MOYE_CONTROL", content: { originalValue: `You are the ${role}/${phase} Agent for a real Moye Task.`, policy: "full" } },
          { ordinal: 1, kind: "ROLE_INSTRUCTIONS", content: { originalValue: forgedInstructions, policy: "full" } },
          { ordinal: 2, kind: "PERMISSION_BOUNDARY", content: { originalValue: `Permission boundary: ${attempt.permission}.`, policy: "full" } },
          { ordinal: 3, kind: "OUTPUT_CONTRACT", content: { originalValue: "Return only the required structured output. Do not claim artifacts or findings that do not exist.", policy: "full" } },
        ],
        renderedPrompt: { originalValue: forgedPrompt, policy: "full" }, createdAt: "2026-08-25T00:00:00.000Z",
      });
      expect(() => assertPromptEnvelopePreparedRoleRunV2(wrongPrompt, request)).toThrow(/exact prepared Role request/);
      const first = await runtime.run(input);
      const second = await runtime.run(input);
      expect(first.recovery).toBe("EXECUTED");
      expect(second.recovery).toBe("REUSED");
      expect(first.manifest).toMatchObject({
        role, phase, outcome: "SUCCEEDED", sessionId: `real-${role.toLowerCase()}-${phase.toLowerCase()}`,
      });
      expect(first.manifest.events.some((event) => event.category === "TOOL_CALL")).toBe(true);
      expect(second.evidence.evidenceDigest).toBe(first.evidence.evidenceDigest);
      const manifestPath = path.join(request.runRoot, "manifest.json");
      const bytesBeforeBinding = await readFile(manifestPath, "utf8");
      expect(JSON.parse(bytesBeforeBinding)).toMatchObject({
        runId: first.manifest.runId,
        manifestDigest: first.manifest.manifestDigest,
      });
      const transcriptBinding = createSessionEvidenceBindingFromRoleManifestV2({
        sourceWorkflowRef: `restate://CoreV2Workflow/${attempt.taskId}`,
        manifest: first.manifest,
      });
      expect(transcriptBinding).toMatchObject({ runId: first.manifest.runId, operationId: first.manifest.operationId, roleManifestDigest: first.manifest.manifestDigest });
      expect(() => createSessionEvidenceBindingFromRoleManifestV2({
        sourceWorkflowRef: "restate://CoreV2Workflow/TASK-CROSS-BOUNDARY",
        manifest: first.manifest,
      })).toThrow(/owning .* keyed by/);
      const { schemaVersion: _schemaVersion, evidenceDigest: _evidenceDigest, ...evidenceCore } = first.evidence;
      const substitutedEvidence = createRoleRunEvidenceV2({ ...evidenceCore, outcome: "FAILED" });
      expect(() => createSessionEvidenceBindingFromRoleManifestV2({
        sourceWorkflowRef: `restate://CoreV2Workflow/${attempt.taskId}`,
        manifest: { ...first.manifest, evidence: substitutedEvidence },
      })).toThrow(/evidence.outcome/);
      expect(await readFile(manifestPath, "utf8")).toBe(bytesBeforeBinding);
    }
  });

  it("rejects tampering with a completed Run instead of silently reusing it", async () => {
    const fixture = await realCliFixture();
    const attempt = running("TEST_VERIFICATION", "TEST_ASSESSMENT", "TASK-E2E-ROLE-TAMPER");
    const input = {
      attempt,
      scopeRoot: fixture.scope,
      artifactRoot: fixture.artifacts,
      instructions: "Assess trusted test evidence.",
    };
    const request = await prepareRealRoleRunV2(input);
    const runtime = new RealRoleRuntimeV2({ codexExecutable: fixture.executable });
    await runtime.run(input);
    await writeFile(path.join(request.runRoot, "events.jsonl"), "tampered\n", "utf8");
    await expect(runtime.run(input)).rejects.toMatchObject({ code: "REAL_ROLE_ARTIFACT_INTEGRITY_FAILED" });
  });

  it("canonicalizes symlinked scope and Artifact roots before creating durable Role identity", async () => {
    const fixture = await realCliFixture();
    const logicalRoot = path.join(fixture.root, "logical");
    await symlink(fixture.scope, logicalRoot);
    const request = await prepareRealRoleRunV2({
      attempt: running("ARCHITECT", "ARCHITECT", "TASK-E2E-ROLE-SYMLINK"),
      scopeRoot: logicalRoot,
      artifactRoot: fixture.artifacts,
      instructions: "Inspect the canonical repository scope.",
    });

    expect(request.scopeRoot).toBe(await realpath(fixture.scope));
    expect(request.artifactRoot).toBe(await realpath(fixture.artifacts));
  });

  it("turns Intent-only recovery into UNKNOWN and forbids a second process until NOT_APPLIED reconcile", async () => {
    const fixture = await realCliFixture();
    const attempt = running("IMPLEMENTATION", "IMPLEMENTATION", "TASK-E2E-ROLE-UNKNOWN");
    const request = await prepareRealRoleRunV2({
      attempt,
      scopeRoot: fixture.scope,
      artifactRoot: fixture.artifacts,
      instructions: "Execute once only.",
    });
    expect(await writeRealRoleRunIntentV2(request)).toBe(true);
    const inspection = await inspectRealRoleRunV2(request);
    expect(inspection.state).toBe("INTENT_ONLY");

    const runtime = new RealRoleRuntimeV2({ codexExecutable: fixture.executable });
    await expect(runtime.run({
      attempt,
      scopeRoot: fixture.scope,
      artifactRoot: fixture.artifacts,
      instructions: "Execute once only.",
    })).rejects.toMatchObject({ code: "REAL_ROLE_RESULT_UNKNOWN", category: "UNKNOWN_SIDE_EFFECT" });

    if (inspection.state !== "INTENT_ONLY") throw new Error("expected INTENT_ONLY");
    const waiting = markRoleAttemptUnknownV2(attempt, {
      runId: inspection.runId,
      operationId: inspection.operationId,
      reason: "durable Intent exists without Manifest",
    }, "2026-08-23T00:00:02.000Z");
    expect(waiting.unknown?.reconcileToken).toBe(inspection.reconcileToken);
    const failed = reconcileRoleAttemptV2(waiting, {
      token: inspection.reconcileToken,
      action: "NOT_APPLIED",
      externalEvidence: "trusted process ledger proves the command never started",
    }, "2026-08-23T00:00:03.000Z");
    const next = createNextRoleAttemptV2({
      previous: failed,
      inputDigest: sha("2"),
      subjectCommit: commit,
      inputArtifactRefs: ["artifact://spec-r1"],
      scheduledAt: "2026-08-23T00:00:04.000Z",
    });
    expect(next.generation).toBe(1);
  });
});

function running(role: AgentRoleV2, phase: RolePhaseV2, taskId = "TASK-E2E-ROLE") {
  return startRoleAttemptV2(createRoleAttemptV2({
    taskId,
    specRevision: 1,
    role,
    phase,
    generation: 0,
    runnerKind: "CODEX_EXEC",
    inputDigest: sha("1"),
    subjectCommit: commit,
    inputArtifactRefs: ["artifact://spec-r1"],
    scheduledAt: "2026-08-23T00:00:00.000Z",
  }), "2026-08-23T00:00:01.000Z");
}

async function realCliFixture(): Promise<{ root: string; scope: string; artifacts: string; executable: string }> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "moye-real-role-v2-")));
  const scope = path.join(root, "scope");
  const artifacts = path.join(root, "artifacts");
  await mkdir(scope);
  const executable = path.join(root, "real-agent-cli.mjs");
  await writeFile(executable, `#!/usr/bin/env node
const args = process.argv.slice(2);
const prompt = args.at(-1) ?? "";
const match = prompt.match(/You are the ([A-Z_]+)\\/([A-Z_]+) Agent/);
if (!match) process.exit(7);
const role = match[1].toLowerCase();
const phase = match[2].toLowerCase();
const output = { summary: "real child completed " + role + "/" + phase, recommendation: "PASS", artifactRefs: [], findingRefs: [] };
console.log(JSON.stringify({ type: "thread.started", thread_id: "real-" + role + "-" + phase }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: ["trusted-check"] } }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(output) } }));
console.log(JSON.stringify({ type: "turn.completed" }));
`, "utf8");
  await chmod(executable, 0o755);
  return { root, scope, artifacts, executable };
}
