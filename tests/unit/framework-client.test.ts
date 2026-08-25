import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MoyeClient, prepareProjectTask } from "../../src/framework/client.js";
import { defaultProjectManifest } from "../../src/framework/project-manifest.js";

const execFileAsync = promisify(execFile);
const fixtures: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(fixtures.splice(0).map((fixture) => rm(fixture, { recursive: true, force: true })));
});

describe("framework client", () => {
  it("turns a public request into a frozen private Core v2 input", async () => {
    const fixture = await projectFixture();
    const prepared = await prepareProjectTask({
      manifestPath: fixture.manifestPath,
      taskId: "TASK-CLIENT-001",
      title: "Public request",
      objective: "Create a deterministic result",
      acceptanceCriteria: ["npm test passes"],
    }, { runtimeRoot: fixture.runtimeRoot });

    expect(prepared.input).toMatchObject({
      taskId: "TASK-CLIENT-001",
      projectId: "client-project",
      repositoryRoot: fixture.repositoryRoot,
      runnerKind: "CODEX_EXEC",
      targetRef: "refs/heads/main",
      testCommands: [["npm", "test"]],
    });
    expect(prepared.input.artifactRoot.startsWith(fixture.runtimeRoot)).toBe(true);
    expect(prepared.input.sessionEvidence).toBeUndefined();
    expect(prepared.input.observerKnowledge).toBeUndefined();
    expect(prepared.input).not.toHaveProperty("manifestPath");
  });

  it("rejects dirty repositories and runtime overlap before dispatch", async () => {
    const fixture = await projectFixture();
    await writeFile(path.join(fixture.repositoryRoot, "dirty.txt"), "dirty\n");
    await expect(prepareProjectTask({
      manifestPath: fixture.manifestPath,
      objective: "Do work",
      acceptanceCriteria: ["passes"],
    }, { runtimeRoot: fixture.runtimeRoot })).rejects.toMatchObject({ code: "PROJECT_GIT_DIRTY" });
  });

  it("rejects a missing target ref before Workflow dispatch", async () => {
    const fixture = await projectFixture();
    const manifest = parse(await readFile(fixture.manifestPath, "utf8")) as { repository: { targetRef: string } };
    manifest.repository.targetRef = "refs/heads/missing";
    await writeFile(fixture.manifestPath, stringify(manifest, { lineWidth: 0 }));
    await git(fixture.repositoryRoot, ["add", ".moye/project.yaml"]);
    await git(fixture.repositoryRoot, ["-c", "user.name=Moye Test", "-c", "user.email=test@moye.local", "commit", "-qm", "manifest target"]);
    await expect(prepareProjectTask({
      manifestPath: fixture.manifestPath,
      objective: "Do work",
      acceptanceCriteria: ["passes"],
    }, { runtimeRoot: fixture.runtimeRoot })).rejects.toMatchObject({ code: "PROJECT_TARGET_REF_MISSING" });
  });

  it("submits once and exposes only the public receipt", async () => {
    const fixture = await projectFixture();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ invocationId: "inv-client-1", status: "Accepted" }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new MoyeClient({ ingressUrl: "http://127.0.0.1:8080", boardUrl: "http://127.0.0.1:3000", runtimeRoot: fixture.runtimeRoot });
    const receipt = await client.startTask({
      manifestPath: fixture.manifestPath,
      taskId: "TASK-CLIENT-002",
      objective: "Do work",
      acceptanceCriteria: ["npm test passes"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({ taskId: "TASK-CLIENT-002", invocationId: "inv-client-1", apiVersion: 1 });
    expect(receipt).not.toHaveProperty("artifactRoot");
  });
});

async function projectFixture(): Promise<{ repositoryRoot: string; manifestPath: string; runtimeRoot: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "moye-framework-client-"));
  fixtures.push(root);
  const repositoryRoot = path.join(root, "client-project");
  const runtimeRoot = path.join(root, "runtime");
  await mkdir(path.join(repositoryRoot, ".moye"), { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(path.join(repositoryRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  const manifest = structuredClone(defaultProjectManifest("client-project"));
  (manifest as { tests: unknown }).tests = [{ id: "unit", argv: ["npm", "test"], cwd: "." }];
  (manifest as { repository: { targetRef: string } }).repository.targetRef = "refs/heads/main";
  const manifestPath = path.join(repositoryRoot, ".moye/project.yaml");
  await writeFile(manifestPath, stringify(manifest, { lineWidth: 0 }));
  await git(repositoryRoot, ["init", "-q", "-b", "main"]);
  await git(repositoryRoot, ["add", "."]);
  await git(repositoryRoot, ["-c", "user.name=Moye Test", "-c", "user.email=test@moye.local", "commit", "-qm", "base"]);
  return { repositoryRoot: await realpath(repositoryRoot), manifestPath, runtimeRoot };
}

async function git(root: string, args: readonly string[]): Promise<void> {
  await execFileAsync("git", ["-C", root, ...args]);
}
