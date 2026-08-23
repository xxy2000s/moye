import { createHash } from "node:crypto";
import { parseCoreV2LifecycleV2 } from "./core-v2-lifecycle.js";
import type { CoreV2LifecycleProjection } from "./core-v2-lifecycle.js";
import { parseRoleAttemptV2 } from "./role-runtime-v2.js";
import type { RoleAttemptV2 } from "./role-runtime-v2.js";

export interface CoreV2ObserverReport {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly state: CoreV2LifecycleProjection["state"];
  readonly facts: { readonly events: number; readonly attempts: number; readonly failures: number; readonly unknown: number; readonly repairs: number; readonly replans: number; readonly artifacts: readonly string[]; readonly sessions: readonly string[] };
  readonly alerts: readonly { readonly kind: "UNKNOWN" | "REPEATED_FAILURE"; readonly detail: string }[];
  readonly projectionDigest: string;
  readonly reportDigest: string;
}

export function createCoreV2ObserverReport(projectionInput: CoreV2LifecycleProjection, attemptInputs: readonly RoleAttemptV2[]): CoreV2ObserverReport {
  const projection = parseCoreV2LifecycleV2(JSON.parse(JSON.stringify(projectionInput)) as CoreV2LifecycleProjection);
  const attempts = attemptInputs.map((item) => parseRoleAttemptV2(JSON.parse(JSON.stringify(item)), item.attemptDigest));
  const allowedRevisions = [projection.specRevision, ...projection.invalidatedRevisions.map((item) => item.specRevision)];
  if (attempts.some((item) => !coreV2ObserverAttemptInScope(projection.taskId, allowedRevisions, item.taskId, item.specRevision))) throw new Error("Observer Attempt scope mismatch");
  const failures = attempts.filter((item) => item.state === "FAILED");
  const unknown = attempts.filter((item) => item.state === "WAITING_RECONCILE");
  const alerts = [
    ...unknown.map((item) => ({ kind: "UNKNOWN" as const, detail: item.unknown?.reconcileToken ?? item.attemptId })),
    ...(failures.length > 1 ? [{ kind: "REPEATED_FAILURE" as const, detail: `${failures.length} failed attempts` }] : []),
  ];
  const core = { schemaVersion: 1 as const, taskId: projection.taskId, specRevision: projection.specRevision, state: projection.state,
    facts: { events: projection.events.length, attempts: attempts.length, failures: failures.length, unknown: unknown.length,
      repairs: projection.events.filter((item) => item.type === "ImplementationRepairAuthorized").length, replans: projection.invalidatedRevisions.length,
      artifacts: projection.artifacts.map((item) => item.kind).sort(), sessions: attempts.flatMap((item) => item.run?.sessionId === undefined ? [] : [item.run.sessionId]).sort() },
    alerts, projectionDigest: projection.projectionDigest };
  return Object.freeze({ ...core, reportDigest: `sha256:${createHash("sha256").update(JSON.stringify(core)).digest("hex")}` });
}

export function coreV2ObserverAttemptInScope(taskId: string, allowedRevisions: readonly number[], attemptTaskId: string, attemptRevision: number): boolean {
  return attemptTaskId === taskId && allowedRevisions.includes(attemptRevision);
}
