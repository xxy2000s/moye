import { createHash } from "node:crypto";
import {
  type AdapterContractFindingV1,
  type AdapterContractReportV1,
  type AdapterDescriptorV1,
  validateAdapterDescriptorV1,
} from "./plugin-sdk.js";

export interface BuiltinAdapterBridgeV1 {
  readonly descriptor: AdapterDescriptorV1;
  readonly implementationModule: string;
  readonly executeExport: string;
  readonly reconcileExport?: string;
}

export const BUILTIN_ADAPTER_BRIDGES_V1: readonly BuiltinAdapterBridgeV1[] = Object.freeze([
  bridge("moye.agent-runner.core-v2", "AGENT_RUNNER", "RECONCILABLE",
    ["agent.codex", "agent.claude", "agent.session-evidence", "effect.reconcile"],
    "../agent/role-runtime-v2.js", "RealRoleRuntimeV2", "inspectRealRoleRunV2"),
  bridge("moye.workspace-git.local", "WORKSPACE_GIT", "RECONCILABLE",
    ["workspace.git", "workspace.checkpoint", "workspace.clean-guard", "effect.reconcile"],
    "../git/workspace-effect.js", "applyWorkspaceEffect", "reconcileWorkspaceEffect"),
  bridge("moye.trusted-test.argv", "TRUSTED_TEST", "RECONCILABLE",
    ["test.argv", "test.manifest", "test.stdout-stderr", "effect.reconcile"],
    "../testing/trusted-test-runner.js", "runTrustedTestPlan", "reconcileTrustedTestPlan"),
  bridge("moye.documentation.graph", "DOCUMENTATION", "IDEMPOTENT",
    ["documentation.route", "documentation.impact", "documentation.digest"],
    "../domain/core-docs-impact.js", "RubyDocsGraphAdapter"),
  bridge("moye.scm.local-git", "SCM", "RECONCILABLE",
    ["scm.local-merge", "scm.ref-update", "effect.reconcile"],
    "../git/merge-effect.js", "applyLocalMerge", "reconcileLocalMerge"),
  bridge("moye.artifact-store.filesystem", "ARTIFACT_STORE", "IDEMPOTENT",
    ["artifact.filesystem", "artifact.content-addressed", "artifact.conflict-check"],
    "../archive/core-v2-artifact-store.js", "persistCoreV2Artifact"),
  bridge("moye.knowledge.observer", "KNOWLEDGE_SINK", "NONE",
    ["knowledge.propose", "knowledge.none", "knowledge.non-blocking"],
    "../domain/core-v2-observer.js", "createCoreV2ObserverReport"),
]);

export async function verifyBuiltinAdapterBridgesV1(
  importer: (moduleUrl: URL) => Promise<Record<string, unknown>> = async (moduleUrl) => import(moduleUrl.href) as Promise<Record<string, unknown>>,
): Promise<readonly AdapterContractReportV1[]> {
  const reports: AdapterContractReportV1[] = [];
  for (const bridge of BUILTIN_ADAPTER_BRIDGES_V1) {
    const checks: string[] = [];
    const findings: AdapterContractFindingV1[] = [];
    try {
      const descriptor = validateAdapterDescriptorV1(bridge.descriptor);
      checks.push("descriptor", "authority-boundary", "capabilities");
      const implementation = await importer(new URL(bridge.implementationModule, import.meta.url));
      if (typeof implementation[bridge.executeExport] !== "function") {
        findings.push({ code: "BUILTIN_EXECUTE_EXPORT_MISSING", message: `${bridge.implementationModule} does not export ${bridge.executeExport}` });
      } else checks.push("execute-export");
      if (descriptor.effectModel === "RECONCILABLE") {
        if (bridge.reconcileExport === undefined || typeof implementation[bridge.reconcileExport] !== "function") {
          findings.push({ code: "BUILTIN_RECONCILE_EXPORT_MISSING", message: `${bridge.implementationModule} does not export ${bridge.reconcileExport ?? "a reconcile handler"}` });
        } else checks.push("reconcile-export");
      } else if (bridge.reconcileExport !== undefined) {
        findings.push({ code: "BUILTIN_RECONCILE_EXPORT_INVALID", message: `${descriptor.id} exposes reconcile without RECONCILABLE effect model` });
      }
      reports.push(report(descriptor, checks, findings));
    } catch (error) {
      findings.push({ code: "BUILTIN_CONTRACT_INVALID", message: error instanceof Error ? error.message : String(error) });
      reports.push(report(bridge.descriptor, checks, findings));
    }
  }
  return Object.freeze(reports);
}

function bridge(
  id: string,
  kind: AdapterDescriptorV1["kind"],
  effectModel: AdapterDescriptorV1["effectModel"],
  capabilities: readonly string[],
  implementationModule: string,
  executeExport: string,
  reconcileExport?: string,
): BuiltinAdapterBridgeV1 {
  return Object.freeze({
    descriptor: Object.freeze({ pluginApiVersion: 1, id, version: "0.1.0", kind, effectModel, capabilities: Object.freeze([...capabilities]) }),
    implementationModule,
    executeExport,
    ...(reconcileExport === undefined ? {} : { reconcileExport }),
  });
}

function report(
  descriptor: AdapterDescriptorV1,
  checks: readonly string[],
  findings: readonly AdapterContractFindingV1[],
): AdapterContractReportV1 {
  const core = {
    pluginApiVersion: 1 as const,
    adapterId: descriptor.id,
    adapterKind: descriptor.kind,
    passed: findings.length === 0,
    checks: Object.freeze([...checks]),
    findings: Object.freeze([...findings]),
  };
  return Object.freeze({ ...core, reportDigest: sha256(JSON.stringify(core)) });
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
