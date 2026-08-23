import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildCoreV2MatrixAuditInput } from "../../src/acceptance/core-v2-matrix-manifest.js";

describe("Core v2 matrix audit manifest", () => {
  it("binds fifteen required scenarios plus the Role UNKNOWN regression to explicit suite roots", () => {
    const input = buildCoreV2MatrixAuditInput({ projectId: "moye", ingressUrl: "http://localhost:8080", boardUrl: "http://localhost:3000", runRoot: "/evidence/matrix-1", documentGraphPath: "/repo/docs/graph.yaml" });
    expect(input.suites.map((suite) => suite.suite)).toEqual(["core-v2-happy", "core-v2-faults", "core-v2-recovery", "core-v2-guards"]);
    const scenarios = input.suites.flatMap((suite) => suite.scenarios);
    expect(scenarios).toHaveLength(16);
    expect(new Set(scenarios.map((scenario) => scenario.scenario)).size).toBe(16);
    expect(scenarios.flatMap((scenario) => scenario.requirementRefs)).toEqual(expect.arrayContaining(["MATRIX-01", "MATRIX-15"]));
    expect(input.suites[2]?.summaryPath).toBe(path.join("/evidence/matrix-1", "recovery", "matrix-summary.json"));
    expect(scenarios.every((scenario) => scenario.scenarioRoot.startsWith("/evidence/matrix-1/"))).toBe(true);
  });

  it("can audit a resumed suite without relocating earlier evidence", () => {
    const input = buildCoreV2MatrixAuditInput({
      projectId: "moye", ingressUrl: "http://localhost:8080", boardUrl: "http://localhost:3000",
      runRoot: "/evidence/matrix-original", documentGraphPath: "/repo/docs/graph.yaml",
      suiteRoots: { guards: "/evidence/matrix-resumed/guards" },
      suiteSummaryPaths: { guards: "/evidence/matrix-composed/guards-summary.json" },
      scenarioRoots: { OBSERVER_TIMEOUT: "/evidence/matrix-observer/observer_timeout" },
    });
    const guards = input.suites.find((suite) => suite.suite === "core-v2-guards");
    expect(guards?.summaryPath).toBe("/evidence/matrix-composed/guards-summary.json");
    expect(guards?.scenarios.find((scenario) => scenario.scenario === "OBSERVER_TIMEOUT")?.scenarioRoot).toBe("/evidence/matrix-observer/observer_timeout");
    expect(guards?.scenarios.filter((scenario) => scenario.scenario !== "OBSERVER_TIMEOUT").every((scenario) => scenario.scenarioRoot.startsWith("/evidence/matrix-resumed/guards/"))).toBe(true);
    expect(input.suites.find((suite) => suite.suite === "core-v2-happy")?.summaryPath).toBe("/evidence/matrix-original/happy/matrix-summary.json");
  });
});
