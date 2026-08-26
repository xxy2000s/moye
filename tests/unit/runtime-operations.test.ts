import { describe, expect, it } from "vitest";

import { composeProjectName, planRuntimeAction, runtimeVolumeNames } from "../../src/runtime/operations.js";

describe("runtime operations", () => {
  it("keeps ordinary stop and uninstall data preserving", () => {
    expect(planRuntimeAction("down").argv).toEqual(["stop", "register", "moye", "restate"]);
    expect(planRuntimeAction("uninstall")).toMatchObject({ argv: ["down", "--remove-orphans"], destructive: false });
  });

  it("requires an explicit confirmation before deleting volumes", () => {
    expect(() => planRuntimeAction("purge-data", {})).toThrow(/MOYE_CONFIRM_PURGE/);
    expect(planRuntimeAction("purge-data", { MOYE_CONFIRM_PURGE: "DELETE_RUNTIME_DATA" })).toMatchObject({ destructive: true });
  });

  it("requires an immutable-looking image tag for upgrade and rollback", () => {
    expect(() => planRuntimeAction("upgrade", {})).toThrow(/MOYE_IMAGE/);
    expect(() => planRuntimeAction("rollback", { MOYE_IMAGE: "moye:latest" })).toThrow(/non-latest/);
    expect(planRuntimeAction("upgrade", { MOYE_IMAGE: "ghcr.io/acme/moye:0.1.0" }).argv).toContain("always");
  });

  it("derives validated compose volume identities", () => {
    expect(composeProjectName({ COMPOSE_PROJECT_NAME: "moye_acceptance" })).toBe("moye_acceptance");
    expect(runtimeVolumeNames({ COMPOSE_PROJECT_NAME: "moye_acceptance" })).toEqual([
      "moye_acceptance_restate_data", "moye_acceptance_moye_artifacts",
    ]);
    expect(() => composeProjectName({ COMPOSE_PROJECT_NAME: "../bad" })).toThrow(/Invalid/);
  });
});
