import * as restate from "@restatedev/restate-sdk";

import type { TaskEnvelope } from "../domain/coding-task.js";
import type { CoreOutcome } from "../domain/core-closure.js";
import { asMoyeError, MoyeError } from "../domain/errors.js";
import {
  executeCoreScenarioArtifact,
  type CoreScenarioArtifactInput,
} from "../core/scenario-artifact.js";
import { parseCoreScenario, parseCoreScenarioResult, type CoreScenario } from "../core/workflow.js";
import { taskAuthority } from "./services.js";

export interface CoreClosureWorkflowInput {
  readonly envelope: TaskEnvelope;
  readonly scenario: CoreScenario;
  readonly artifactRoot: string;
  readonly observerFailure?: boolean;
  readonly docsGateFailureOnce?: boolean;
  readonly fault?: CoreScenarioArtifactInput["fault"];
}

export interface CoreClosureWorkflowProjection {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly scenario: CoreScenario;
  readonly state: "EXECUTING" | "CLOSED";
  readonly currentStep: "EXECUTE_SCENARIO" | "CLOSED";
  readonly workflowRef: string;
  readonly outcome: CoreOutcome | null;
  readonly closureDigest: string | null;
  readonly sourceProjectionDigest: string | null;
  readonly artifactPath: string | null;
  readonly artifactDigest: string | null;
  readonly effectExecutionCount: number;
  readonly observerError: string | null;
  readonly roleExecutionCount: number;
  readonly docsGateAttempts: number;
}

interface CoreWorkflowState {
  projection: CoreClosureWorkflowProjection;
}

export const coreClosureWorkflow = restate.workflow({
  name: "CoreClosureWorkflow",
  options: { workflowRetention: { days: 30 } },
  handlers: {
    run: async (
      ctx: restate.WorkflowContext<CoreWorkflowState>,
      input: CoreClosureWorkflowInput,
    ): Promise<CoreClosureWorkflowProjection> => {
      if (input.envelope.taskId !== ctx.key) {
        throw new restate.TerminalError("Core Workflow key must equal TaskEnvelope taskId", { errorCode: 409 });
      }
      const scenario = parseCoreScenario(input.scenario);
      await ctx.objectClient(taskAuthority, ctx.key).claim({
        owner: "CORE_WORKFLOW",
        specRevision: input.envelope.specRevision,
      });
      const workflowRef = `restate-workflow://CoreClosureWorkflow/${ctx.key}`;
      let projection: CoreClosureWorkflowProjection = {
        schemaVersion: 1,
        taskId: ctx.key,
        specRevision: input.envelope.specRevision,
        scenario,
        state: "EXECUTING",
        currentStep: "EXECUTE_SCENARIO",
        workflowRef,
        outcome: null,
        closureDigest: null,
        sourceProjectionDigest: null,
        artifactPath: null,
        artifactDigest: null,
        effectExecutionCount: 0,
        observerError: null,
        roleExecutionCount: 0,
        docsGateAttempts: 0,
      };
      ctx.set("projection", projection);
      const artifact = await ctx.run(
        "execute-core-scenario",
        () => runCoreEffect(() => executeCoreScenarioArtifact({
          envelope: input.envelope,
          scenario,
          artifactRoot: input.artifactRoot,
          invocationRef: workflowRef,
          ...(input.observerFailure === undefined ? {} : { observerFailure: input.observerFailure }),
          ...(input.docsGateFailureOnce === undefined ? {} : { docsGateFailureOnce: input.docsGateFailureOnce }),
          ...(input.fault === undefined ? {} : { fault: input.fault }),
        })),
        { maxRetryAttempts: 5 },
      );
      const result = parseCoreScenarioResult(artifact.scenarioResult, input.envelope, scenario);
      projection = {
        ...projection,
        specRevision: result.finalEnvelope.specRevision,
        state: "CLOSED",
        currentStep: "CLOSED",
        outcome: result.closed.outcome,
        closureDigest: result.closed.closureResult.closureDigest,
        sourceProjectionDigest: result.sourceProjection.projectionDigest,
        artifactPath: artifact.artifactPath,
        artifactDigest: artifact.artifactDigest,
        effectExecutionCount: artifact.executionCount,
        observerError: result.observerError,
        roleExecutionCount: result.roleExecutionCount,
        docsGateAttempts: result.docsGateAttempts,
      };
      ctx.set("projection", projection);
      return projection;
    },

    status: restate.handlers.workflow.shared(
      async (ctx: restate.WorkflowSharedContext<CoreWorkflowState>): Promise<CoreClosureWorkflowProjection | null> =>
        ctx.get("projection"),
    ),
  },
});

async function runCoreEffect<T>(effect: () => Promise<T>): Promise<T> {
  try {
    return await effect();
  } catch (error) {
    if (error instanceof restate.CancelledError || error instanceof restate.PauseError) throw error;
    const moye = asMoyeError(error);
    if (moye.retryable) throw moye;
    throw new restate.TerminalError(moye.message, {
      errorCode: terminalStatus(moye),
      metadata: { code: moye.code, category: moye.category, ...moye.details },
    });
  }
}

function terminalStatus(error: MoyeError): number {
  if (error.category === "VALIDATION") return 400;
  if (error.category === "NOT_FOUND") return 404;
  if (error.category === "CONFLICT" || error.category === "UNKNOWN_SIDE_EFFECT") return 409;
  return 500;
}
