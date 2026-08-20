import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCodingDemoFixture } from "../../src/demo/coding-fixture.js";
import { parseTaskEnvelope } from "../../src/domain/coding-task.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("coding demo fixture", () => {
  it("builds an isolated, serializable Fake Coding Workflow input", async () => {
    const demoRoot = await mkdtemp(path.join(os.tmpdir(), "moye-coding-demo-"));
    roots.push(demoRoot);
    const fixture = await createCodingDemoFixture({
      demoRoot,
      taskId: "TASK-DEMO-UNIT",
      backlogId: "BL-DEMO-UNIT",
      projectId: "moye-demo-unit",
      graphRevision: 21,
      createdAt: "2026-08-20T10:00:00.000Z",
    });

    expect(fixture.input).toMatchObject({
      projectId: "moye-demo-unit",
      runnerKind: "FAKE",
      backlogRefs: ["BL-DEMO-UNIT"],
      docsDisposition: "not_applicable",
      fake: { mutation: { fileName: "agent-result.txt" } },
    });
    expect(fixture.input.envelope.pipeline.map((step) => step.stepId)).toEqual([
      "CONTEXT", "WORKSPACE", "IMPLEMENT", "VERIFY", "MERGE", "DOCS",
    ]);
    expect(parseTaskEnvelope(
      JSON.parse(JSON.stringify(fixture.input.envelope)) as unknown,
      fixture.input.expectedEnvelopeDigest,
    ).envelopeDigest).toBe(fixture.input.expectedEnvelopeDigest);
    expect(git(fixture.repositoryRoot, "rev-parse", "refs/heads/master")).toBe(fixture.baseSha);
    expect(git(fixture.repositoryRoot, "rev-parse", "HEAD")).toBe(fixture.baseSha);
    expect(await readFile(path.join(fixture.input.activeTasksRoot, "TASK-DEMO-UNIT", "spec.md"), "utf8"))
      .toContain("Task、Agent、验证、Git 与归档");
  });

  it("refuses to overwrite an existing demo fixture", async () => {
    const demoRoot = await mkdtemp(path.join(os.tmpdir(), "moye-coding-demo-collision-"));
    roots.push(demoRoot);
    const input = {
      demoRoot,
      taskId: "TASK-DEMO-COLLISION",
      backlogId: "BL-DEMO-COLLISION",
      projectId: "moye-demo-unit",
      graphRevision: 21,
      createdAt: "2026-08-20T10:00:00.000Z",
    } as const;
    await createCodingDemoFixture(input);
    await expect(createCodingDemoFixture(input)).rejects.toMatchObject({ code: "EEXIST" });
  });
});

function git(cwd: string, ...argv: string[]): string {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
