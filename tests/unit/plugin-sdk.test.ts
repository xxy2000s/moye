import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BUILTIN_ADAPTER_BRIDGES_V1, verifyBuiltinAdapterBridgesV1 } from "../../src/framework/builtin-adapters.js";
import {
  completeAdapterResultV1,
  createAdapterReconcileInputV1,
  negotiateAdapterV1,
  PluginContractError,
  runAdapterContractSuiteV1,
  type AdapterOperationContextV1,
  type PluginAdapterV1,
  unknownAdapterResultV1,
  validateAdapterDescriptorV1,
  validateAdapterEffectResultV1,
} from "../../src/framework/plugin-sdk.js";

const context: AdapterOperationContextV1 = Object.freeze({
  pluginApiVersion: 1,
  taskId: "TASK-PLUGIN-1",
  attemptId: "TASK-PLUGIN-1.IMPLEMENTATION.r1.g0",
  operationId: "plugin-operation-1",
  idempotencyKey: "TASK-PLUGIN-1/plugin-operation-1",
  intentDigest: `sha256:${createHash("sha256").update("intent").digest("hex")}`,
  repositoryRoot: "/tmp/plugin-contract-repo",
  artifactRoot: "/tmp/plugin-contract-artifacts",
});

describe("Plugin SDK v1", () => {
  it("negotiates required and optional capabilities without silent fallback", () => {
    const descriptor = BUILTIN_ADAPTER_BRIDGES_V1[2]!.descriptor;
    const accepted = negotiateAdapterV1(descriptor, {
      pluginApiVersion: 1,
      kind: "TRUSTED_TEST",
      required: ["test.argv", "effect.reconcile"],
      optional: ["test.stdout-stderr", "vendor.missing"],
    });
    expect(accepted).toMatchObject({ accepted: true, code: "NEGOTIATED", missing: [] });
    expect(accepted.enabled).toEqual(["effect.reconcile", "test.argv", "test.stdout-stderr"]);

    expect(negotiateAdapterV1(descriptor, {
      pluginApiVersion: 1,
      kind: "TRUSTED_TEST",
      required: ["test.remote-sandbox"],
    })).toMatchObject({ accepted: false, code: "CAPABILITY_MISSING", missing: ["test.remote-sandbox"] });
  });

  it("rejects state authority and projection capabilities", () => {
    expect(() => validateAdapterDescriptorV1({
      pluginApiVersion: 1,
      id: "vendor.bad-plugin",
      version: "1.0.0",
      kind: "SCM",
      effectModel: "IDEMPOTENT",
      capabilities: ["task.state.write"],
    })).toThrowError(expect.objectContaining<Partial<PluginContractError>>({ code: "CAPABILITY_FORBIDDEN" }));
  });

  it("requires reconcile capability for a reconcilable effect", () => {
    expect(() => validateAdapterDescriptorV1({
      pluginApiVersion: 1,
      id: "vendor.incomplete-scm",
      version: "1.0.0",
      kind: "SCM",
      effectModel: "RECONCILABLE",
      capabilities: ["scm.push"],
    })).toThrowError(expect.objectContaining<Partial<PluginContractError>>({ code: "RECONCILE_CAPABILITY_REQUIRED" }));
  });

  it("binds COMPLETE and UNKNOWN results to the operation intent", () => {
    const complete = completeAdapterResultV1(context, { commit: "abc" }, { receipt: "git" });
    expect(validateAdapterEffectResultV1(complete)).toEqual(complete);
    const unknown = unknownAdapterResultV1(context, "receipt lost");
    expect(validateAdapterEffectResultV1(unknown)).toEqual(unknown);
    expect(() => validateAdapterEffectResultV1({ ...unknown, intentDigest: `sha256:${"0".repeat(64)}` })).toThrowError(
      expect.objectContaining<Partial<PluginContractError>>({ code: "UNKNOWN_BINDING_MISMATCH" }),
    );
  });

  it("passes one behavioral suite for idempotent COMPLETE adapters", async () => {
    const adapter: PluginAdapterV1<{ value: string }, { value: string }, { source: string }> = {
      descriptor: { pluginApiVersion: 1, id: "vendor.artifact", version: "1.0.0", kind: "ARTIFACT_STORE", effectModel: "IDEMPOTENT", capabilities: ["artifact.write"] },
      async execute(operation, request) { return completeAdapterResultV1(operation, request, { source: "contract" }); },
    };
    const report = await runAdapterContractSuiteV1({ adapter, context, request: { value: "saved" } });
    expect(report.passed).toBe(true);
    expect(report.checks).toContain("execute-idempotency");
  });

  it("passes UNKNOWN reconciliation only with token-bound evidence", async () => {
    const unknown = unknownAdapterResultV1(context, "runner receipt unavailable");
    const reconcile = createAdapterReconcileInputV1(unknown, { action: "CONFIRMED", evidence: { ledger: "run-1" } });
    const adapter: PluginAdapterV1<{ command: string }, { exitCode: number }, { ledger: string }> = {
      descriptor: { pluginApiVersion: 1, id: "vendor.runner", version: "1.0.0", kind: "TRUSTED_TEST", effectModel: "RECONCILABLE", capabilities: ["effect.reconcile", "test.argv"] },
      async execute() { return unknown; },
      async reconcile(operation, pending, evidence) {
        if (pending.reconcileToken !== evidence.token) throw new Error("wrong token");
        return completeAdapterResultV1(operation, { exitCode: 0 }, evidence.evidence as { ledger: string });
      },
    };
    const report = await runAdapterContractSuiteV1({ adapter, context, request: { command: "test" }, reconcile });
    expect(report.passed).toBe(true);
    expect(report.checks).toContain("reconcile-idempotency");

    const conflicting = await runAdapterContractSuiteV1({ adapter, context, request: { command: "test" }, reconcile: { ...reconcile, token: `sha256:${"f".repeat(64)}` } });
    expect(conflicting).toMatchObject({ passed: false, findings: [expect.objectContaining({ code: "RECONCILE_TOKEN_MISMATCH" })] });
  });

  it("verifies every built-in bridge against the same descriptor/export contract", async () => {
    const reports = await verifyBuiltinAdapterBridgesV1();
    expect(reports).toHaveLength(7);
    expect(reports.map((item) => item.adapterKind).sort()).toEqual([
      "AGENT_RUNNER", "ARTIFACT_STORE", "DOCUMENTATION", "KNOWLEDGE_SINK", "SCM", "TRUSTED_TEST", "WORKSPACE_GIT",
    ]);
    expect(reports.every((item) => item.passed)).toBe(true);
  });

  it("fails closed when a built-in implementation export is absent", async () => {
    const reports = await verifyBuiltinAdapterBridgesV1(async () => ({}));
    expect(reports.every((item) => !item.passed)).toBe(true);
    expect(reports[0]!.findings[0]!.code).toBe("BUILTIN_EXECUTE_EXPORT_MISSING");
  });
});
