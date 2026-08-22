import * as restate from "@restatedev/restate-sdk";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { CodexExecAgentRunner } from "../agent/codex-exec.js";
import { CliLiveRoleRunner } from "../agent/live-role.js";
import { ClaudePrintAgentRunner } from "../agent/claude-print.js";
import { FixtureCodingAgentRunner, StreamingFixtureCodingAgentRunner } from "../agent/fixture-coding.js";
import type { FixtureMutation } from "../agent/fixture-coding.js";
import type { FakeAgentScript } from "../agent/runner.js";
import type { CodingReconcileFact, CodingWorkflowInput, CodingWorkflowProjection } from "../coding/workflow.js";
import { runCodingWorkflow } from "../coding/workflow.js";
import { loadConfig } from "../config.js";
import type { TaskProjection } from "../domain/task.js";
import type { GitCommandRunner } from "../git/workspace-effect.js";
import { nodeGitCommandRunner } from "../git/workspace-effect.js";
import { buildCodingTraceBatch, createTraceSink } from "../trace/telemetry.js";
import { CliLiveReviewRunner } from "../review/live-review.js";
import { archiveWorkflow, projectBoard, taskAuthority } from "./services.js";

interface CodingWorkflowState {
  projection: CodingWorkflowProjection;
}

export interface CodingReconcileInput {
  readonly token: string;
  readonly action: "RESUME_AFTER_RECONCILE";
  readonly evidence: string;
}

export interface CodingTaskWorkflowInput extends CodingWorkflowInput {
  readonly projectId: string;
  readonly title: string;
  readonly backlogRefs: readonly string[];
  readonly activeTasksRoot: string;
  readonly archiveRoot: string;
  readonly archivedAt: string;
  readonly fake?: {
    readonly script: FakeAgentScript;
    readonly mutation: FixtureMutation;
  };
  readonly controlledStream?: {
    readonly events: readonly Readonly<Record<string, unknown>>[];
    readonly mutation: FixtureMutation;
    readonly delayMs: number;
  };
  readonly fault?: {
    readonly loseMergeAcknowledgementOnceAt?: string;
    readonly exitAfterMergeRefUpdateOnceAt?: string;
  };
}

export const codingTaskWorkflow = restate.workflow({
  name: "CodingTaskWorkflow",
  options: { workflowRetention: { days: 30 } },
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<CodingWorkflowState>,
      input: CodingTaskWorkflowInput,
    ): Promise<CodingWorkflowProjection> => {
      await ctx.objectClient(taskAuthority, input.envelope.taskId).claim({
        owner: "CODING_WORKFLOW",
        specRevision: input.envelope.specRevision,
      });
      const workflowEpoch = await ctx.date.now();
      let workflowTick = 0;
      const config = loadConfig();
      const agentRunner = createAgentRunner(input, config);
      const projection = await runCodingWorkflow(input, {
        agentRunner,
        ...(input.reviewMode === "REAL" ? { reviewRunner: new CliLiveReviewRunner() } : {}),
        ...(input.roleMode === "REAL" ? { roleRunner: new CliLiveRoleRunner() } : {}),
        now: () => new Date(workflowEpoch + workflowTick++),
        gitRunner: createGitRunner(input),
        activity: <T>(name: string, operation: () => Promise<T>): Promise<T> => ctx.run(
          name,
          operation,
          { maxRetryAttempts: 3 },
        ),
        observe: async (projection) => {
          ctx.set("projection", projection);
          await ctx.objectClient(projectBoard, input.projectId).upsertTask(toTaskProjection(input, projection));
        },
        archive: async (projection) => {
          const archived = await ctx.workflowClient(archiveWorkflow, input.envelope.taskId).run({
            taskId: input.envelope.taskId,
            projectId: input.projectId,
            specRevision: projection.specRevision,
            activeTasksRoot: input.activeTasksRoot,
            archiveRoot: input.archiveRoot,
            archivedAt: input.archivedAt,
            task: toTaskProjection(input, projection),
          });
          if (archived.archiveStatus !== "ARCHIVED" || archived.archivePath === undefined) {
            throw new restate.TerminalError(
              `ArchiveWorkflow did not archive ${input.envelope.taskId}: ${archived.error ?? archived.archiveStatus}`,
              { errorCode: 409 },
            );
          }
          const contentDigest = `sha256:${createHash("sha256").update(JSON.stringify(archived)).digest("hex")}`;
          return {
            artifactRef: `coding-archive://${input.envelope.taskId}/${contentDigest.slice("sha256:".length)}`,
            contentDigest,
            ...(archived.archivePath === undefined ? {} : { archivePath: archived.archivePath }),
          };
        },
        awaitReconcile: async (fact: CodingReconcileFact) => {
          await ctx.promise<string>(reconcilePromiseName(fact.token)).get();
        },
        onSpecRevision: async (specRevision) => {
          await ctx.objectClient(taskAuthority, input.envelope.taskId).claim({ owner: "CODING_WORKFLOW", specRevision });
        },
      });
      if (config.observability.enabled) {
        try {
          await ctx.run("export-coding-trace", () => createTraceSink({
            enabled: true,
            endpoint: config.observability.otlpTracesEndpoint,
          }).export(buildCodingTraceBatch(projection, {
            serviceName: config.observability.serviceName,
            projectName: config.observability.projectName,
          })), { maxRetryAttempts: 1 });
        } catch (error) {
          process.stderr.write(`Moye trace export failed for ${projection.taskId}: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
      return projection;
    },

    status: restate.handlers.workflow.shared(
      async (ctx: restate.WorkflowSharedContext<CodingWorkflowState>): Promise<CodingWorkflowProjection | null> =>
        ctx.get("projection"),
    ),

    reconcile: restate.handlers.workflow.shared(async (
      ctx: restate.WorkflowSharedContext<CodingWorkflowState>,
      input: CodingReconcileInput,
    ): Promise<CodingWorkflowProjection> => {
      const projection = await ctx.get("projection");
      if (projection === null || projection.state !== "WAITING_RECONCILE" || projection.reconcile === undefined) {
        throw new restate.TerminalError("Task is not waiting for reconcile", { errorCode: 409 });
      }
      if (input.action !== "RESUME_AFTER_RECONCILE" || input.token !== projection.reconcile.token || !input.evidence.trim()) {
        throw new restate.TerminalError("Reconcile token/action/evidence does not match the pending effect", { errorCode: 409 });
      }
      const promise = ctx.promise<string>(reconcilePromiseName(input.token));
      if (await promise.peek() === undefined) await promise.resolve(input.evidence.trim());
      return projection;
    }),
  },
});

function reconcilePromiseName(token: string): string {
  return `reconcile-${token.slice(token.lastIndexOf(":") + 1)}`;
}

function createAgentRunner(input: CodingTaskWorkflowInput, config: ReturnType<typeof loadConfig>) {
  if (input.runnerKind === "FAKE") return createFixtureRunner(input);
  if (input.controlledStream !== undefined) {
    if (process.env["MOYE_TEST_FAULT_INJECTION"] !== "enabled" || input.runnerKind !== "CODEX_EXEC") {
      throw new restate.TerminalError("Controlled Agent stream is disabled outside explicit CODEX_EXEC test processes", { errorCode: 403 });
    }
    return new StreamingFixtureCodingAgentRunner(input.controlledStream);
  }
  if (input.runnerKind === "CODEX_EXEC") return new CodexExecAgentRunner();
  return new ClaudePrintAgentRunner({
    telemetry: {
      enabled: config.observability.claudeNativeTelemetry,
      endpoint: config.observability.otlpTracesEndpoint,
      serviceName: "claude-code",
      projectName: config.observability.projectName,
      captureUserPrompts: config.observability.captureUserPrompts,
      captureAssistantResponses: config.observability.captureAssistantResponses,
      captureToolDetails: config.observability.captureToolDetails,
      captureToolContent: config.observability.captureToolContent,
      captureRawApiBodies: config.observability.captureRawModelIo,
    },
  });
}

function createFixtureRunner(input: CodingTaskWorkflowInput): FixtureCodingAgentRunner {
  if (input.fake === undefined) {
    throw new restate.TerminalError("FAKE Coding Workflow requires fake script and mutation", { errorCode: 400 });
  }
  return new FixtureCodingAgentRunner(input.fake.script, input.fake.mutation);
}

function createGitRunner(input: CodingTaskWorkflowInput): GitCommandRunner {
  const lostAcknowledgementMarker = input.fault?.loseMergeAcknowledgementOnceAt;
  const exitMarker = input.fault?.exitAfterMergeRefUpdateOnceAt;
  if (lostAcknowledgementMarker === undefined && exitMarker === undefined) return nodeGitCommandRunner;
  if (process.env["MOYE_TEST_FAULT_INJECTION"] !== "enabled") {
    throw new restate.TerminalError("Coding fault injection is disabled outside explicit test processes", { errorCode: 403 });
  }
  return {
    async run(invocation) {
      const result = await nodeGitCommandRunner.run(invocation);
      if (invocation.argv[0] === "update-ref" && result.exitCode === 0) {
        if (exitMarker !== undefined) {
          try {
            await writeFile(exitMarker, `${invocation.argv.join(" ")}\n`, { flag: "wx" });
            process.exit(76);
          } catch (error) {
            if (!isAlreadyExists(error)) throw error;
          }
        }
        if (lostAcknowledgementMarker !== undefined) {
          try {
            await writeFile(lostAcknowledgementMarker, `${invocation.argv.join(" ")}\n`, { flag: "wx" });
            throw new Error("simulated lost Merge acknowledgement");
          } catch (error) {
            if (!isAlreadyExists(error)) throw error;
          }
        }
      }
      return result;
    },
  };
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function toTaskProjection(input: CodingTaskWorkflowInput, projection: CodingWorkflowProjection): TaskProjection {
  const lastEventAt = projection.events.at(-1)?.at ?? input.archivedAt;
  return {
    taskId: projection.taskId,
    projectId: input.projectId,
    title: input.title,
    state: projection.state === "RUNNING" || projection.state === "WAITING_RECONCILE"
      ? (projection.currentStep === "CONTEXT" ? "RECEIVED" : "EXECUTING")
      : "CLOSED",
    currentStep: projection.currentStep,
    attempt: projection.agentRuns?.length ?? projection.attempts.filter((attempt) => attempt.stepId === "IMPLEMENT").length,
    specRevision: projection.specRevision,
    backlogRefs: [...input.backlogRefs],
    archiveStatus: projection.archiveStatus,
    ...(projection.archive?.archivePath === undefined ? {} : { archivePath: projection.archive.archivePath }),
    ...(projection.outcome === undefined ? {} : { outcome: projection.outcome }),
    ...(projection.error === undefined ? {} : { error: projection.error }),
    lastEventAt,
    events: projection.events.map(({ sequence, type, at, detail }) => ({
      sequence, type, at, ...(detail === undefined ? {} : { detail }),
    })),
  };
}
