import { describe, expect, it } from "vitest";

import { selectLatestRestateServiceEndpoint } from "../../src/acceptance/restate-deployment-handoff.js";

describe("Restate acceptance deployment handoff", () => {
  it("remembers the endpoint owning the highest service revision", () => {
    expect(selectLatestRestateServiceEndpoint([
      { id: "old", uri: "http://old/", services: [{ name: "CoreV2Workflow", revision: 12 }] },
      { id: "unrelated", uri: "http://other/", services: [{ name: "TaskWorkflow", revision: 99 }] },
      { id: "current", uri: "http://current/", services: [{ name: "CoreV2Workflow", revision: 14 }] },
    ], "CoreV2Workflow")).toBe("http://current/");
  });

  it("returns undefined when no predecessor deployment exists", () => {
    expect(selectLatestRestateServiceEndpoint([], "CoreV2Workflow")).toBeUndefined();
  });
});
