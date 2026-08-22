import { spawn } from "node:child_process";
import * as restate from "@restatedev/restate-sdk";

import { RealRoleRuntimeV2 } from "../agent/role-runtime-v2.js";
import type { RoleRunManifestV2 } from "../agent/role-runtime-v2.js";
import { createCoreV2Lifecycle, workflowAcceptArchitectV2, workflowAcceptDesignReviewV2, workflowAcceptDocumentationV2, workflowAcceptFinalReviewV2, workflowAcceptImplementationV2, workflowAcceptTestAssessmentV2, workflowAcceptTestPlanV2, workflowAuthorizeRepairV2, workflowCloseCoreV2, workflowPassVerificationGateV2, workflowRecordKnowledgeDispositionV2, workflowRecordTrustedTestRunV2, workflowReplanV2, workflowRequestRepairV2, workflowResumeTestReconcileV2, workflowWaitForTestReconcileV2 } from "../domain/core-v2-lifecycle.js";
import type { ArchitectDeliverableV2, CoreV2LifecycleProjection } from "../domain/core-v2-lifecycle.js";
import { completeRoleAttemptV2, createRoleAttemptV2, startRoleAttemptV2 } from "../domain/role-runtime-v2.js";
import type { AgentRoleV2, RealRoleRunnerKind, RoleAttemptV2, RolePhaseV2 } from "../domain/role-runtime-v2.js";
import type { DocsImpactPayload, TestPlanPayload } from "../domain/lifecycle-artifact.js";
import { reconcileTrustedTestPlan, runTrustedTestPlan } from "../testing/trusted-test-runner.js";
import type { TrustedTestReconcileInput, TrustedTestRunManifest } from "../testing/trusted-test-runner.js";
import { projectBoard, taskAuthority } from "./services.js";
import type { TaskProjection } from "../domain/task.js";

export interface CoreV2WorkflowInput {
  readonly taskId: string; readonly projectId: string; readonly title: string; readonly objective: string;
  readonly acceptanceCriteria: readonly string[]; readonly repositoryRoot: string; readonly artifactRoot: string;
  readonly runnerKind: RealRoleRunnerKind; readonly baseCommit: string; readonly testCommands: readonly (readonly string[])[];
}
export interface CoreV2WorkflowProjection {
  readonly schemaVersion: 1; readonly taskId: string; readonly projectId: string; readonly title: string;
  readonly state: "EXECUTING" | "WAITING_RECONCILE" | "CLOSED" | "FAILED_TERMINAL"; readonly currentStep: string;
  readonly lifecycle: CoreV2LifecycleProjection; readonly attempts: readonly RoleAttemptV2[]; readonly roleRuns: readonly RoleRunManifestV2[];
  readonly artifactRoot: string;
  readonly startedAt: string; readonly completedAt: string | null; readonly outcome: "SUCCEEDED" | "FAILED_TERMINAL" | null; readonly error: string | null;
}
export interface CoreV2ReconcileInput extends TrustedTestReconcileInput {}
interface CoreV2WorkflowState { projection: CoreV2WorkflowProjection }

export const coreV2Workflow = restate.workflow({
  name: "CoreV2Workflow", options: { workflowRetention: { days: 30 } }, handlers: {
    run: async (ctx: restate.WorkflowContext<CoreV2WorkflowState>, input: CoreV2WorkflowInput): Promise<CoreV2WorkflowProjection> => {
      if (ctx.key !== input.taskId) throw new restate.TerminalError("Workflow key must equal Task ID", { errorCode: 409 });
      await ctx.objectClient(taskAuthority, input.taskId).claim({ owner: "CORE_V2_WORKFLOW", specRevision: 1 });
      const startedAt = await durableNow(ctx, "intake-time");
      let projection: CoreV2WorkflowProjection = { schemaVersion: 1, taskId: input.taskId, projectId: input.projectId, title: input.title,
        state: "EXECUTING", currentStep: "ARCHITECT_REQUIRED", lifecycle: createCoreV2Lifecycle({ taskId: input.taskId, specRevision: 1, subjectCommit: input.baseCommit, at: startedAt }),
        attempts: [], roleRuns: [], artifactRoot: input.artifactRoot, startedAt, completedAt: null, outcome: null, error: null };
      projection = await publish(ctx, input, projection);
      try {
        for (;;) {
          const revision = projection.lifecycle.specRevision;
          const architect = await runRole(ctx, input, projection, "ARCHITECT", "ARCHITECT", projection.lifecycle.subjectCommit, 0, architectPrompt(input)); projection = addRun(projection, architect); projection = withLifecycle(projection,
            workflowAcceptArchitectV2(projection.lifecycle, architect.attempt, architectDeliverable(architect.manifest), await durableNow(ctx, `architect-r${revision}-accepted`))); projection = await publish(ctx, input, projection);
          const designReview = await runRole(ctx, input, projection, "REVIEW", "DESIGN_REVIEW", projection.lifecycle.subjectCommit, 0, reviewPrompt("DESIGN_REVIEW", projection)); projection = addRun(projection, designReview); projection = withLifecycle(projection,
            workflowAcceptDesignReviewV2(projection.lifecycle, designReview.attempt, verdict(designReview.manifest), await durableNow(ctx, `design-review-r${revision}-accepted`))); projection = await publish(ctx, input, projection);
          if (projection.lifecycle.state === "IMPLEMENTATION_REQUIRED") break;
          if (revision >= 2) throw new Error("Design Review Findings exceeded Replan budget");
          projection = withLifecycle(projection, workflowReplanV2(projection.lifecycle, { nextSubjectCommit: projection.lifecycle.subjectCommit,
            reason: designReview.manifest.output?.findingRefs.join(", ") || "blocking design finding", at: await durableNow(ctx, `replan-r${revision + 1}`) }));
          await ctx.objectClient(taskAuthority, input.taskId).claim({ owner: "CORE_V2_WORKFLOW", specRevision: projection.lifecycle.specRevision });
          projection = await publish(ctx, input, projection);
        }
        for (;;) {
          const generation = projection.lifecycle.implementationGeneration;
          const implementationBase = projection.lifecycle.candidateCommit ?? input.baseCommit;
          const implementation = await runRole(ctx, input, projection, "IMPLEMENTATION", "IMPLEMENTATION", implementationBase, generation, implementationPrompt(input, generation)); projection = addRun(projection, implementation);
          const git = await ctx.run(`git-checkpoint-g${generation}`, () => ensureGitCheckpoint(input.repositoryRoot, implementationBase, input.taskId, generation));
          projection = withLifecycle(projection, workflowAcceptImplementationV2(projection.lifecycle, implementation.attempt, { candidateCommit: git.commit, treeDigest: git.tree,
            checkpointRef: `git-commit://${git.commit}`, testEvidenceRefs: implementation.manifest.output?.artifactRefs ?? [], selfReview: verdict(implementation.manifest) }, await durableNow(ctx, `implementation-g${generation}-accepted`)));
          projection = await publish(ctx, input, projection);
          if (projection.lifecycle.state === "REPAIR_REQUIRED") {
            projection = await authorizeRepair(ctx, input, projection, generation, "blocking implementation self-review");
            continue;
          }
          const candidate = projection.lifecycle.candidateCommit!;
          const docs = await runRole(ctx, input, projection, "DOCUMENTATION", "DOCUMENTATION", candidate, generation, documentationPrompt(input)); projection = addRun(projection, docs);
          if (docs.manifest.output?.recommendation !== "PASS") {
            projection = withLifecycle(projection, workflowRequestRepairV2(projection.lifecycle, { reason: docs.manifest.output?.findingRefs.join(", ") || "Documentation Finding", at: await durableNow(ctx, `docs-repair-g${generation}`) }));
            projection = await publish(ctx, input, projection); projection = await authorizeRepair(ctx, input, projection, generation, "blocking Documentation Finding"); continue;
          }
          projection = withLifecycle(projection, workflowAcceptDocumentationV2(projection.lifecycle, docs.attempt, deliverable<DocsImpactPayload>(docs.manifest), await durableNow(ctx, `documentation-g${generation}-accepted`))); projection = await publish(ctx, input, projection);
          const testPlanRun = await runRole(ctx, input, projection, "TEST_VERIFICATION", "TEST_PLAN", candidate, generation, testPlanPrompt(input)); projection = addRun(projection, testPlanRun);
          projection = withLifecycle(projection, workflowAcceptTestPlanV2(projection.lifecycle, testPlanRun.attempt, testPlanDeliverable(testPlanRun.manifest, input), await durableNow(ctx, `test-plan-g${generation}-accepted`))); projection = await publish(ctx, input, projection);
          const plan = projection.lifecycle.artifacts.findLast((item) => item.kind === "TEST_PLAN")!;
          const testInput = { plan, candidateCommit: candidate, repositoryRoot: input.repositoryRoot, allowedRepositoryRoots: [input.repositoryRoot], artifactRoot: `${input.artifactRoot}/trusted-tests` };
          const initialTest = await ctx.run(`trusted-test-run-g${generation}`, () => runTrustedTestPlan(testInput));
          let testManifest: TrustedTestRunManifest;
          if (initialTest.state === "UNKNOWN") {
            projection = withLifecycle(projection, workflowWaitForTestReconcileV2(projection.lifecycle, { token: initialTest.reconcileToken, reason: initialTest.reason, at: await durableNow(ctx, `tests-g${generation}-unknown`) }));
            projection = await publish(ctx, input, { ...projection, state: "WAITING_RECONCILE", currentStep: "WAITING_RECONCILE", error: initialTest.reconcileToken });
            const reconciliation = await ctx.promise<CoreV2ReconcileInput>(reconcilePromiseName(initialTest.reconcileToken)).get();
            testManifest = await ctx.run(`trusted-test-reconcile-g${generation}`, () => reconcileTrustedTestPlan(testInput, reconciliation));
            projection = withLifecycle({ ...projection, state: "EXECUTING", error: null }, workflowResumeTestReconcileV2(projection.lifecycle, { token: reconciliation.token, evidence: reconciliation.evidence, at: await durableNow(ctx, `tests-g${generation}-resumed`) }));
          } else testManifest = initialTest.manifest;
          const manifestRef = `${input.artifactRoot}/trusted-tests/${testManifest.runId.replace(":", "-")}/manifest.json`;
          projection = withLifecycle(projection, workflowRecordTrustedTestRunV2(projection.lifecycle, { runId: testManifest.runId, manifestRef, manifestDigest: testManifest.manifestDigest, at: await durableNow(ctx, `tests-g${generation}-recorded`) }));
          const assessment = await runRole(ctx, input, projection, "TEST_VERIFICATION", "TEST_ASSESSMENT", candidate, generation, assessmentPrompt(testManifest, manifestRef)); projection = addRun(projection, assessment);
          const passed = testManifest.outcome === "PASSED" && assessment.manifest.output?.recommendation === "PASS";
          const report = { type: "TEST_REPORT" as const, candidateCommit: candidate, outcomes: testManifest.cases.map((item) => ({ caseId: item.caseId, status: item.status, evidenceRefs: [manifestRef] })), recommendation: passed ? "PASS" as const : "FINDINGS" as const, findingRefs: passed ? [] : ["finding://test-verification"] };
          projection = withLifecycle(projection, workflowAcceptTestAssessmentV2(projection.lifecycle, assessment.attempt, report, await durableNow(ctx, `assessment-g${generation}-accepted`))); projection = await publish(ctx, input, projection);
          if (projection.lifecycle.state === "REPAIR_REQUIRED") { projection = await authorizeRepair(ctx, input, projection, generation, "blocking Test Verification Finding"); continue; }
          const finalReview = await runRole(ctx, input, projection, "REVIEW", "FINAL_REVIEW", candidate, generation, reviewPrompt("FINAL_REVIEW", projection)); projection = addRun(projection, finalReview);
          projection = withLifecycle(projection, workflowAcceptFinalReviewV2(projection.lifecycle, finalReview.attempt, verdict(finalReview.manifest), await durableNow(ctx, `final-review-g${generation}-accepted`))); projection = await publish(ctx, input, projection);
          if (projection.lifecycle.state === "REPAIR_REQUIRED") { projection = await authorizeRepair(ctx, input, projection, generation, "blocking Final Review Finding"); continue; }
          projection = withLifecycle(projection, workflowPassVerificationGateV2(projection.lifecycle, await durableNow(ctx, "verification-gate")));
          projection = withLifecycle(projection, workflowRecordKnowledgeDispositionV2(projection.lifecycle, { type: "KNOWLEDGE_DISPOSITION", disposition: "none", candidateRefs: [], rationale: "No reusable knowledge candidate proposed" }, await durableNow(ctx, "knowledge-disposition")));
          projection = withLifecycle(projection, workflowCloseCoreV2(projection.lifecycle, { mergeCommit: candidate, at: await durableNow(ctx, "closure") }));
          projection = { ...projection, state: "CLOSED", currentStep: "ARCHIVED", completedAt: await durableNow(ctx, "completed"), outcome: "SUCCEEDED" };
          return publish(ctx, input, projection);
        }
      } catch (error) {
        projection = { ...projection, state: "FAILED_TERMINAL", currentStep: "FAILED_TERMINAL", completedAt: await durableNow(ctx, "failed"), outcome: "FAILED_TERMINAL", error: error instanceof Error ? error.message : String(error) };
        await publish(ctx, input, projection); throw new restate.TerminalError(projection.error ?? "Core v2 failed", { errorCode: 422 });
      }
    },
    status: restate.handlers.workflow.shared(async (ctx: restate.WorkflowSharedContext<CoreV2WorkflowState>) => ctx.get("projection") as Promise<CoreV2WorkflowProjection | null>),
    reconcile: restate.handlers.workflow.shared(async (ctx: restate.WorkflowSharedContext<CoreV2WorkflowState>, input: CoreV2ReconcileInput): Promise<CoreV2WorkflowProjection> => {
      const projection = await ctx.get("projection");
      if (projection === null || projection.state !== "WAITING_RECONCILE" || projection.error === null) throw new restate.TerminalError("Core v2 Task is not waiting for reconcile", { errorCode: 409 });
      if (input.token !== projection.error || !["CONFIRMED", "NOT_APPLIED"].includes(input.action) || !input.evidence.trim()) throw new restate.TerminalError("Reconcile token/action/evidence does not match pending Trusted Test", { errorCode: 409 });
      const promise = ctx.promise<CoreV2ReconcileInput>(reconcilePromiseName(input.token));
      if (await promise.peek() === undefined) await promise.resolve({ ...input, evidence: input.evidence.trim() });
      return projection;
    }),
  },
});

async function runRole(ctx: restate.WorkflowContext<CoreV2WorkflowState>, input: CoreV2WorkflowInput, projection: CoreV2WorkflowProjection,
  role: AgentRoleV2, phase: RolePhaseV2, subjectCommit: string, generation: number, instructions: string) {
  const scheduled = createRoleAttemptV2({ taskId: input.taskId, specRevision: projection.lifecycle.specRevision, role, phase, generation, runnerKind: input.runnerKind,
    inputDigest: projection.lifecycle.projectionDigest, subjectCommit, inputArtifactRefs: projection.lifecycle.artifacts.map((item) => item.artifactDigest), scheduledAt: await durableNow(ctx, `${phase}-r${projection.lifecycle.specRevision}-scheduled-g${generation}`) });
  const running = startRoleAttemptV2(scheduled, await durableNow(ctx, `${phase}-r${projection.lifecycle.specRevision}-started-g${generation}`));
  const result = await ctx.run(`role-${phase.toLowerCase()}-r${projection.lifecycle.specRevision}-g${generation}`, () => new RealRoleRuntimeV2().run({ attempt: running, scopeRoot: input.repositoryRoot, artifactRoot: `${input.artifactRoot}/roles`, instructions }));
  return { attempt: completeRoleAttemptV2(running, result.evidence, await durableNow(ctx, `${phase}-r${projection.lifecycle.specRevision}-completed-g${generation}`)), manifest: result.manifest };
}
function addRun(p: CoreV2WorkflowProjection, result: { attempt: RoleAttemptV2; manifest: RoleRunManifestV2 }): CoreV2WorkflowProjection { return { ...p, attempts: [...p.attempts, result.attempt], roleRuns: [...p.roleRuns, result.manifest] }; }
function withLifecycle(p: CoreV2WorkflowProjection, lifecycle: CoreV2LifecycleProjection): CoreV2WorkflowProjection { return { ...p, lifecycle, currentStep: lifecycle.state }; }
async function publish(ctx: restate.WorkflowContext<CoreV2WorkflowState>, input: CoreV2WorkflowInput, p: CoreV2WorkflowProjection): Promise<CoreV2WorkflowProjection> { ctx.set("projection", p); await ctx.objectClient(projectBoard, input.projectId).upsertTask(boardTask(p)); return p; }
function boardTask(p: CoreV2WorkflowProjection): TaskProjection { return { taskId: p.taskId, projectId: p.projectId, title: p.title, state: p.state === "CLOSED" || p.state === "FAILED_TERMINAL" ? "CLOSED" : "EXECUTING", currentStep: p.currentStep,
  attempt: p.attempts.length, specRevision: p.lifecycle.specRevision, backlogRefs: [], archiveStatus: p.state === "CLOSED" ? "ARCHIVED" : "NOT_READY", ...(p.outcome === "SUCCEEDED" ? { outcome: "SUCCEEDED" as const } : p.outcome === "FAILED_TERMINAL" ? { outcome: "FAILED_TERMINAL" as const } : {}),
  ...(p.error === null ? {} : { error: p.error }), lastEventAt: p.lifecycle.events.at(-1)?.at ?? p.startedAt, events: p.lifecycle.events.map((event) => ({ sequence: event.sequence, type: event.type, at: event.at, detail: event.detail })) }; }
async function durableNow(ctx: restate.WorkflowContext<CoreV2WorkflowState>, name: string): Promise<string> { return ctx.run(name, () => Promise.resolve(new Date().toISOString())); }
function deliverable<T>(manifest: RoleRunManifestV2): T { if (manifest.output?.deliverable === undefined) throw new Error(`${manifest.phase} did not return deliverable`); return manifest.output.deliverable as T; }
function architectDeliverable(manifest: RoleRunManifestV2): ArchitectDeliverableV2 { const value = deliverable<ArchitectDeliverableV2>(manifest); const strings = (items: readonly unknown[]) => items.map((item) => typeof item === "string" ? item : JSON.stringify(item)); return { spec: value.spec, design: { ...value.design, decisions: strings(value.design.decisions), components: strings(value.design.components), risks: strings(value.design.risks) }, plan: value.plan }; }
function testPlanDeliverable(manifest: RoleRunManifestV2, input: CoreV2WorkflowInput): TestPlanPayload {
  const proposed = deliverable<{ readonly type?: unknown; readonly cases?: readonly Record<string, unknown>[] }>(manifest);
  if (proposed.type !== "TEST_PLAN" || !Array.isArray(proposed.cases) || proposed.cases.length !== input.testCommands.length) throw new Error("TEST_PLAN must contain exactly one case per authorized command");
  const allRequirements = input.acceptanceCriteria.map((_, index) => `REQ-${index + 1}`);
  const allowed = new Set(allRequirements);
  return { type: "TEST_PLAN", cases: proposed.cases.map((item, index) => {
    const refs = Array.isArray(item["requirementIds"]) ? item["requirementIds"].filter((value): value is string => typeof value === "string" && allowed.has(value)) : [];
    const category = typeof item["category"] === "string" && ["NORMAL", "BOUNDARY", "REGRESSION", "FAILURE", "RECOVERY"].includes(item["category"].toUpperCase())
      ? item["category"].toUpperCase() as TestPlanPayload["cases"][number]["category"] : "NORMAL";
    return { id: typeof item["id"] === "string" && item["id"].trim() ? item["id"] : `TC-${index + 1}`, requirementIds: refs.length ? refs : allRequirements, category, argv: [...input.testCommands[index]!] };
  }) };
}
function verdict(manifest: RoleRunManifestV2) { const passed = manifest.output?.recommendation === "PASS"; const refs = manifest.output?.findingRefs ?? []; return { verdict: passed ? "PASSED" as const : "FINDINGS" as const, findingRefs: passed ? [] : refs.length ? refs : ["finding://missing-output"] }; }
const encoded = "The deliverable field must be a JSON-encoded string (not a nested object).";
function architectPrompt(i: CoreV2WorkflowInput) { return `Act as ARCHITECT. Read the repository. Objective: ${i.objective}. Acceptance: ${i.acceptanceCriteria.join("; ")}. Return PASS and encode {spec:{type:"SPEC",requirements:[{id,statement,acceptanceCriteria}]},design:{type:"DESIGN",decisions,components,risks},plan:{type:"PLAN",items:[{id,description,dependsOn,status:"PENDING"}]}} in deliverable. Use requirement ids REQ-1 through REQ-${i.acceptanceCriteria.length}. ${encoded}`; }
function reviewPrompt(phase: string, p: CoreV2WorkflowProjection) { return `Act as isolated ${phase} reviewer. Inspect repository and these immutable artifacts: ${JSON.stringify(p.lifecycle.artifacts)}. Return PASS only if sound. Encode {} in deliverable. ${encoded}`; }
function implementationPrompt(i: CoreV2WorkflowInput, generation: number) { return `Act as IMPLEMENTATION generation ${generation}. Implement this objective in the current Git repository: ${i.objective}. Acceptance: ${i.acceptanceCriteria.join("; ")}. Run relevant checks and update required project documentation. Do not run git add or git commit: the Workflow owns the durable Candidate Commit checkpoint. Return PASS only when the workspace implementation and checks are complete; include artifact refs for test evidence. Encode {} in deliverable. ${encoded}`; }
function documentationPrompt(i: CoreV2WorkflowInput) { return `Act as DOCUMENTATION. Audit the already committed Candidate for ${i.objective}. Do not modify files or create commits; if project facts are missing, return FINDINGS so Implementation Repair can own a new Candidate. Encode {type:"DOCS_IMPACT",routeDigest:"sha256:<actual 64 hex>",reportRef:"artifact://docs-impact",dispositions:[{documentId,outcome:"updated|unchanged|not_applicable",reason}]} in deliverable. Do not claim PASS without real evidence. ${encoded}`; }
function testPlanPrompt(i: CoreV2WorkflowInput) { return `Act as TEST_VERIFICATION Test Planner. Return PASS and encode {type:"TEST_PLAN",cases:[{id:"TC-1",requirementIds:["REQ-1"],category:"NORMAL",argv:["command","arg"]}]} in deliverable. Use exactly these argv arrays, one case per command: ${JSON.stringify(i.testCommands)}. Cover requirement ids REQ-1 through REQ-${i.acceptanceCriteria.length}. category must be exactly NORMAL, BOUNDARY, REGRESSION, FAILURE, or RECOVERY. ${encoded}`; }
function assessmentPrompt(manifest: unknown, ref: string) { return `Act as TEST_VERIFICATION assessor. Read this real Trusted Runner Manifest (${ref}): ${JSON.stringify(manifest)}. Return PASS only when every exit code is zero; do not invent execution. Encode {} in deliverable. ${encoded}`; }
export async function ensureGitCheckpoint(root: string, expectedParent: string, taskId: string, generation: number): Promise<{ commit: string; tree: string }> {
  const marker = `Moye-Task: ${taskId}\nMoye-Generation: ${generation}`;
  let head = await git(root, ["rev-parse", "HEAD"]);
  if (head !== expectedParent) {
    const parent = await git(root, ["rev-parse", `${head}^`]);
    const message = await git(root, ["log", "-1", "--format=%B", head]);
    const clean = (await git(root, ["status", "--porcelain=v1"])).length === 0;
    if (parent !== expectedParent || !message.includes(marker) || !clean) throw new Error("Repository HEAD does not match the authorized or reconciled Candidate Commit");
    return { commit: head, tree: await git(root, ["rev-parse", `${head}^{tree}`]) };
  }
  if ((await git(root, ["status", "--porcelain=v1"])).length === 0) throw new Error("Implementation produced no repository changes");
  await git(root, ["add", "--all"]);
  await git(root, ["-c", "user.name=Moye Workflow", "-c", "user.email=moye@localhost", "commit", "-m", `feat: complete ${taskId} generation ${generation}\n\n${marker}`]);
  head = await git(root, ["rev-parse", "HEAD"]);
  return { commit: head, tree: await git(root, ["rev-parse", `${head}^{tree}`]) };
}
async function git(cwd: string, argv: readonly string[]): Promise<string> { return new Promise((resolve, reject) => { const child = spawn("git", argv, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] }); let out = "", err = ""; child.stdout.setEncoding("utf8").on("data", (v: string) => out += v); child.stderr.setEncoding("utf8").on("data", (v: string) => err += v); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `git ${argv[0]} exited ${code}`))); }); }
async function authorizeRepair(ctx: restate.WorkflowContext<CoreV2WorkflowState>, input: CoreV2WorkflowInput, projection: CoreV2WorkflowProjection, generation: number, reason: string): Promise<CoreV2WorkflowProjection> {
  if (generation >= 1) throw new Error(`${reason} exceeded Repair budget`);
  const repaired = withLifecycle(projection, workflowAuthorizeRepairV2(projection.lifecycle, { reason, at: await durableNow(ctx, `repair-g${generation + 1}-authorized`) }));
  return publish(ctx, input, repaired);
}
function reconcilePromiseName(token: string): string { return `core-v2-reconcile-${token.slice(token.lastIndexOf(":") + 1)}`; }
