import { mkdtemp, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createLifecycleArtifact, lifecycleArtifactRef } from "../../src/domain/lifecycle-artifact.js";
import { runTrustedTestPlan } from "../../src/testing/trusted-test-runner.js";

describe("Core v2 real Trusted Test Runner", () => {
  it("executes argv without a shell, persists evidence, and will not repeat an intent-only run", async () => {
    const root = await mkdtemp(join(tmpdir(), "moye-trusted-test-")); const artifactRoot = join(root, "artifacts"); const marker = join(root, "marker.txt");
    const commit = "a".repeat(40); const producer = { role: "ARCHITECT" as const, phase: "ARCHITECT", attemptId: "TASK.TEST.r1.g0", generation: 0, sessionId: "architect" };
    const spec = createLifecycleArtifact({ taskId: "TASK-E2E-TEST", specRevision: 1, kind: "SPEC", subjectCommit: commit, producer, dependencies: [],
      payload: { type: "SPEC", requirements: [{ id: "REQ-1", statement: "run once", acceptanceCriteria: ["real exit code"] }] } });
    const design = createLifecycleArtifact({ taskId: "TASK-E2E-TEST", specRevision: 1, kind: "DESIGN", subjectCommit: commit, producer, dependencies: [lifecycleArtifactRef(spec)],
      payload: { type: "DESIGN", decisions: ["argv"], components: ["runner"], risks: ["unknown"] } });
    const candidate = "b".repeat(40);
    const plan = createLifecycleArtifact({ taskId: "TASK-E2E-TEST", specRevision: 1, kind: "TEST_PLAN", subjectCommit: candidate,
      producer: { role: "TEST_VERIFICATION", phase: "TEST_PLAN", attemptId: "TASK.TEST_PLAN.r1.g0", generation: 0, sessionId: "tester" },
      dependencies: [lifecycleArtifactRef(spec), lifecycleArtifactRef(design)], payload: { type: "TEST_PLAN", cases: [{ id: "TC-1", requirementIds: ["REQ-1"], category: "RECOVERY",
        argv: [process.execPath, "-e", `require('fs').appendFileSync(${JSON.stringify(marker)}, 'x')`] }] } });
    const first = await runTrustedTestPlan({ plan, candidateCommit: candidate, repositoryRoot: root, allowedRepositoryRoots: [root], artifactRoot });
    expect(first.state).toBe("COMPLETE"); if (first.state !== "COMPLETE") return;
    expect(first.manifest.cases[0]).toMatchObject({ exitCode: 0, status: "PASSED" });
    await unlink(join(artifactRoot, first.manifest.runId.replace(":", "-"), "manifest.json"));
    const recovered = await runTrustedTestPlan({ plan, candidateCommit: candidate, repositoryRoot: root, allowedRepositoryRoots: [root], artifactRoot });
    expect(recovered.state).toBe("UNKNOWN");
    expect(await readFile(marker, "utf8")).toBe("x");
  });
});
