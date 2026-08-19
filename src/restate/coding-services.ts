import * as restate from "@restatedev/restate-sdk";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { CodexExecAgentRunner } from "../agent/codex-exec.js";
import { FixtureCodingAgentRunner } from "../agent/fixture-coding.js";
import type { FixtureMutation } from "../agent/fixture-coding.js";
import type { FakeAgentScript } from "../agent/runner.js";
import type { CodingWorkflowInput, CodingWorkflowProjection } from "../coding/workflow.js";
import { runCodingWorkflow } from "../coding/workflow.js";
import type { TaskProjection } from "../domain/task.js";
import type { GitCommandRunner } from "../git/workspace-effect.js";
import { nodeGitCommandRunner } from "../git/workspace-effect.js";
import { archiveWorkflow, projectBoard, taskAuthority } from "./services.js";

interface CodingWorkflowState {
  projection: CodingWorkflowProjection;
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
      const agentRunner = input.runnerKind === "FAKE"
        ? createFixtureRunner(input)
        : new CodexExecAgentRunner();
      return runCodingWorkflow(input, {
        agentRunner,
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
            specRevision: input.envelope.specRevision,
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
      });
    },

    status: restate.handlers.workflow.shared(
      async (ctx: restate.WorkflowSharedContext<CodingWorkflowState>): Promise<CodingWorkflowProjection | null> =>
        ctx.get("projection"),
    ),
  },
});

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
    state: projection.state === "RUNNING" ? (projection.currentStep === "CONTEXT" ? "RECEIVED" : "EXECUTING") : "CLOSED",
    currentStep: projection.currentStep,
    attempt: projection.attempts.filter((attempt) => attempt.stepId === "IMPLEMENT").length,
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
