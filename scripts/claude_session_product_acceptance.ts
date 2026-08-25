import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  CLAUDE_SESSION_PARSER_V1,
  ClaudeNativeSessionAdapterV1,
  claudeSessionSourceLocatorDigestV1,
  readManagedClaudeSessionV1,
} from "../src/agent/claude-session-adapter.js";
import { prepareRealRoleRunV2, RealRoleRuntimeV2 } from "../src/agent/role-runtime-v2.js";
import { createRoleAttemptV2, renderRoleAgentPromptV2, startRoleAttemptV2 } from "../src/domain/role-runtime-v2.js";
import {
  assertPromptEnvelopePreparedRoleRunV2,
  createArtifactDescriptorV1,
  createPromptEnvelopeV1,
  createSessionEvidenceBindingFromRoleManifestV2,
  createSessionTranscriptCaptureIntentV1,
  parsePromptEnvelopeV1,
  sessionTranscriptCaptureIdV1,
} from "../src/domain/session-transcript.js";
import type { PromptEnvelopeV1 } from "../src/domain/session-transcript.js";
import type { RoleRunManifestV2 } from "../src/agent/role-runtime-v2.js";

export interface ClaudeSessionProductAcceptanceResult {
  readonly taskId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly sessionId: string;
  readonly roleManifestDigest: string;
  readonly promptEnvelopeDigest: string;
  readonly transcriptManifestDigest: string;
  readonly normalizedDigest: string;
  readonly sourceDigest: string;
  readonly captureId: string;
  readonly evidenceRoot: string;
  readonly counts: Readonly<Record<string, number>>;
}

const execFileAsync = promisify(execFile);

export async function runClaudeSessionProductAcceptance(): Promise<ClaudeSessionProductAcceptanceResult> {
  const repositoryRoot = path.resolve(process.env["MOYE_REPOSITORY_ROOT"] ?? process.cwd());
  const providerSessionsRoot = path.resolve(process.env["MOYE_CLAUDE_PROJECTS_ROOT"] ?? path.join(os.homedir(), ".claude", "projects"));
  const reuseRoot = process.env["MOYE_CLAUDE_REUSE_ROLE_EVIDENCE_ROOT"];
  if (reuseRoot !== undefined) return recaptureVerifiedRole(path.resolve(reuseRoot), providerSessionsRoot);
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "moye-task-0060-claude-product-"));
  const roleArtifactRoot = path.join(evidenceRoot, "role-artifacts");
  const transcriptArtifactRoot = path.join(evidenceRoot, "transcript-artifacts");
  await mkdir(roleArtifactRoot);

  const scheduledAt = new Date().toISOString();
  const attempt = startRoleAttemptV2(createRoleAttemptV2({
    taskId: "TASK-0060",
    specRevision: 1,
    role: "ARCHITECT",
    phase: "ARCHITECT",
    generation: 0,
    runnerKind: "CLAUDE_PRINT",
    inputDigest: sha("1"),
    subjectCommit: await gitHead(repositoryRoot),
    inputArtifactRefs: ["artifact://TASK-0060/spec-r1"],
    scheduledAt,
  }), new Date(Date.parse(scheduledAt) + 1).toISOString());
  const instructions = [
    "This is a product acceptance Role Run for the Claude native Session Adapter.",
    "Use the shell tool to execute `git rev-parse --show-toplevel` and `node --version` in the current repository.",
    "Then return PASS with no findings and no invented artifact references. The required deliverable field is a string whose content must itself be valid JSON, for example `{\"root\":\"/path\",\"nodeVersion\":\"v22\"}`.",
  ].join(" ");
  const input = { attempt, scopeRoot: repositoryRoot, artifactRoot: roleArtifactRoot, instructions };
  const prepared = await prepareRealRoleRunV2(input);
  const renderedPrompt = renderRoleAgentPromptV2({ role: attempt.role, phase: attempt.phase, instructions, permission: attempt.permission });
  const promptEnvelope = createPromptEnvelopeV1({
    taskId: attempt.taskId,
    sourceWorkflowRef: `restate://SealedTaskWorkflow/${attempt.taskId}`,
    specRevision: attempt.specRevision,
    generation: attempt.generation,
    role: attempt.role,
    phase: attempt.phase,
    attemptId: attempt.attemptId,
    attemptDigest: attempt.attemptDigest,
    runId: prepared.runId,
    operationId: prepared.operationId,
    requestDigest: prepared.requestDigest,
    runnerKind: attempt.runnerKind,
    permission: attempt.permission,
    subjectCommit: attempt.subjectCommit,
    capturePolicy: "full",
    renderer: { name: "real-role-prompt-v2", version: "1", optionsDigest: sha("0") },
    renderPlan: { separator: "\n" },
    segments: [
      { ordinal: 0, kind: "MOYE_CONTROL", content: { originalValue: `You are the ${attempt.role}/${attempt.phase} Agent for a real Moye Task.`, policy: "full" } },
      { ordinal: 1, kind: "ROLE_INSTRUCTIONS", content: { originalValue: instructions, policy: "full" } },
      { ordinal: 2, kind: "PERMISSION_BOUNDARY", content: { originalValue: `Permission boundary: ${attempt.permission}.`, policy: "full" } },
      { ordinal: 3, kind: "OUTPUT_CONTRACT", content: { originalValue: "Return only the required structured output. Do not claim artifacts or findings that do not exist.", policy: "full" } },
    ],
    renderedPrompt: { originalValue: renderedPrompt, policy: "full" },
    createdAt: new Date(Date.parse(scheduledAt) + 2).toISOString(),
  });
  assertPromptEnvelopePreparedRoleRunV2(promptEnvelope, prepared);
  const promptBytes = Buffer.from(`${JSON.stringify(promptEnvelope, null, 2)}\n`, "utf8");
  const promptPath = path.join(evidenceRoot, "prompt-envelope.json");
  await writeFile(promptPath, promptBytes, { flag: "wx" });

  const roleResult = await new RealRoleRuntimeV2().run(input);
  if (roleResult.manifest.outcome !== "SUCCEEDED" || roleResult.manifest.sessionId === undefined) {
    throw new Error(`Real Claude Role Run failed: ${roleResult.manifest.outcome}`);
  }
  const binding = createSessionEvidenceBindingFromRoleManifestV2({
    sourceWorkflowRef: `restate://SealedTaskWorkflow/${attempt.taskId}`,
    manifest: roleResult.manifest,
  });
  const promptDescriptor = createArtifactDescriptorV1({
    ref: `artifact://TASK-0060/${prepared.runId}/prompt-envelope`,
    digest: promptEnvelope.envelopeDigest,
    byteLength: promptBytes.byteLength,
    mediaType: "application/json",
  });
  const captureId = sessionTranscriptCaptureIdV1({
    binding,
    parserName: CLAUDE_SESSION_PARSER_V1.name,
    parserVersion: CLAUDE_SESSION_PARSER_V1.version,
    optionsDigest: CLAUDE_SESSION_PARSER_V1.optionsDigest,
    capturePolicy: "full",
  });
  const intent = createSessionTranscriptCaptureIntentV1({
    importMode: "LIVE",
    enrichmentId: `enrichment:${captureId.slice("session-capture:".length)}`,
    workflowRef: `restate://TranscriptEnrichmentWorkflow/enrichment:${captureId.slice("session-capture:".length)}`,
    captureAttempt: 1,
    binding,
    capturePolicy: "full",
    parser: CLAUDE_SESSION_PARSER_V1,
    sourceLocatorDigest: claudeSessionSourceLocatorDigestV1(binding.providerSessionId),
    maxSourceBytes: 32 * 1024 * 1024,
    promptBinding: "PROMPT_ENVELOPE_V1",
    promptEnvelope: promptDescriptor,
    expectedRawRef: `artifact://TASK-0060/${captureId}/raw`,
    expectedNormalizedRef: `artifact://TASK-0060/${captureId}/normalized`,
    expectedManifestRef: `artifact://TASK-0060/${captureId}/manifest`,
    expectedReceiptRef: `artifact://TASK-0060/${captureId}/receipt`,
    requestedAt: new Date().toISOString(),
  });
  const captured = await new ClaudeNativeSessionAdapterV1({ providerSessionsRoot, managedArtifactRoot: transcriptArtifactRoot }).capture({
    intent,
    promptEnvelope,
    capturedAt: new Date().toISOString(),
  });
  const managed = await readManagedClaudeSessionV1({
    managedArtifactRoot: transcriptArtifactRoot,
    captureId,
    manifestDigest: captured.manifest.manifestDigest,
  });
  if (managed.timeline.filter((event) => event.category === "PROMPT").length !== 1 ||
      !managed.timeline.some((event) => event.category === "ASSISTANT") ||
      !managed.timeline.some((event) => event.category === "TOOL_CALL") ||
      !managed.timeline.some((event) => event.category === "TOOL_RESULT")) {
    throw new Error("Real Claude Timeline lacks required Prompt/Assistant/Tool evidence");
  }
  const counts = Object.freeze(Object.fromEntries(["PROMPT", "USER", "ASSISTANT", "TOOL_CALL", "TOOL_RESULT", "SYSTEM"]
    .map((category) => [category, managed.timeline.filter((event) => event.category === category).length])));
  const result = Object.freeze({
    taskId: attempt.taskId,
    runId: prepared.runId,
    attemptId: attempt.attemptId,
    sessionId: binding.providerSessionId,
    roleManifestDigest: binding.roleManifestDigest,
    promptEnvelopeDigest: promptEnvelope.envelopeDigest,
    transcriptManifestDigest: captured.manifest.manifestDigest,
    normalizedDigest: captured.manifest.artifacts.normalized.digest,
    sourceDigest: captured.manifest.source.sourceDigest,
    captureId,
    evidenceRoot,
    counts,
  });
  await writeFile(path.join(evidenceRoot, "acceptance-summary.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  return result;
}

async function recaptureVerifiedRole(roleEvidenceRoot: string, providerSessionsRoot: string): Promise<ClaudeSessionProductAcceptanceResult> {
  const prior = JSON.parse(await readFile(path.join(roleEvidenceRoot, "acceptance-summary.json"), "utf8")) as ClaudeSessionProductAcceptanceResult;
  if (prior.taskId !== "TASK-0060" || !prior.runId.startsWith("sha256:")) throw new Error("Reusable Claude evidence does not identify TASK-0060");
  const manifestPath = path.join(roleEvidenceRoot, "role-artifacts", `run-${prior.runId.slice("sha256:".length)}`, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RoleRunManifestV2;
  if (manifest.outcome !== "SUCCEEDED" || manifest.sessionId !== prior.sessionId || manifest.manifestDigest !== prior.roleManifestDigest) {
    throw new Error("Reusable Claude Role Manifest is not the exact prior successful evidence");
  }
  const promptBytes = await readFile(path.join(roleEvidenceRoot, "prompt-envelope.json"));
  const promptValue = JSON.parse(promptBytes.toString("utf8")) as PromptEnvelopeV1;
  const promptEnvelope = parsePromptEnvelopeV1(promptValue, promptValue.envelopeDigest);
  if (promptEnvelope.runId !== manifest.runId || promptEnvelope.attemptDigest !== manifest.attemptDigest) {
    throw new Error("Reusable Prompt Envelope does not bind the successful Claude Role Manifest");
  }
  const binding = createSessionEvidenceBindingFromRoleManifestV2({ sourceWorkflowRef: `restate://SealedTaskWorkflow/${manifest.taskId}`, manifest });
  const promptDescriptor = createArtifactDescriptorV1({
    ref: `artifact://TASK-0060/${manifest.runId}/prompt-envelope`, digest: promptEnvelope.envelopeDigest,
    byteLength: promptBytes.byteLength, mediaType: "application/json",
  });
  const captureId = sessionTranscriptCaptureIdV1({ binding, parserName: CLAUDE_SESSION_PARSER_V1.name, parserVersion: CLAUDE_SESSION_PARSER_V1.version, optionsDigest: CLAUDE_SESSION_PARSER_V1.optionsDigest, capturePolicy: "full" });
  const intent = createSessionTranscriptCaptureIntentV1({
    importMode: "LIVE", enrichmentId: `enrichment:${captureId.slice("session-capture:".length)}`,
    workflowRef: `restate://TranscriptEnrichmentWorkflow/enrichment:${captureId.slice("session-capture:".length)}`,
    captureAttempt: 1, binding, capturePolicy: "full", parser: CLAUDE_SESSION_PARSER_V1,
    sourceLocatorDigest: claudeSessionSourceLocatorDigestV1(binding.providerSessionId), maxSourceBytes: 32 * 1024 * 1024,
    promptBinding: "PROMPT_ENVELOPE_V1", promptEnvelope: promptDescriptor,
    expectedRawRef: `artifact://TASK-0060/${captureId}/raw`, expectedNormalizedRef: `artifact://TASK-0060/${captureId}/normalized`,
    expectedManifestRef: `artifact://TASK-0060/${captureId}/manifest`, expectedReceiptRef: `artifact://TASK-0060/${captureId}/receipt`,
    requestedAt: new Date().toISOString(),
  });
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "moye-task-0060-claude-recapture-"));
  const captured = await new ClaudeNativeSessionAdapterV1({ providerSessionsRoot, managedArtifactRoot: path.join(evidenceRoot, "transcript-artifacts") })
    .capture({ intent, promptEnvelope, capturedAt: new Date().toISOString() });
  const managed = await readManagedClaudeSessionV1({ managedArtifactRoot: path.join(evidenceRoot, "transcript-artifacts"), captureId, manifestDigest: captured.manifest.manifestDigest });
  if (managed.timeline.filter((event) => event.category === "PROMPT").length !== 1 || !managed.timeline.some((event) => event.category === "TOOL_RESULT")) {
    throw new Error("Recaptured real Claude Timeline lacks Prompt or Tool Result evidence");
  }
  const counts = Object.freeze(Object.fromEntries(["PROMPT", "USER", "ASSISTANT", "TOOL_CALL", "TOOL_RESULT", "SYSTEM"]
    .map((category) => [category, managed.timeline.filter((event) => event.category === category).length])));
  const result = Object.freeze({ taskId: manifest.taskId, runId: manifest.runId, attemptId: manifest.attemptId, sessionId: binding.providerSessionId,
    roleManifestDigest: binding.roleManifestDigest, promptEnvelopeDigest: promptEnvelope.envelopeDigest,
    transcriptManifestDigest: captured.manifest.manifestDigest, normalizedDigest: captured.manifest.artifacts.normalized.digest,
    sourceDigest: captured.manifest.source.sourceDigest, captureId, evidenceRoot, counts });
  await writeFile(path.join(evidenceRoot, "acceptance-summary.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  return result;
}

async function gitHead(repositoryRoot: string): Promise<string> {
  const result = await execFileAsync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

function sha(letter: string): string {
  return `sha256:${letter.repeat(64)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runClaudeSessionProductAcceptance();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
