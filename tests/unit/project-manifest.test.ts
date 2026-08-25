import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  defaultProjectManifest,
  initializeProjectManifest,
  loadProjectManifest,
  ProjectManifestError,
} from "../../src/framework/project-manifest.js";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => rm(fixture, { recursive: true, force: true })));
});

describe("project manifest", () => {
  it("initializes safe deterministic defaults without overwriting", async () => {
    const root = await fixture("demo-project");
    const first = await initializeProjectManifest(root);
    const second = await loadProjectManifest(path.join(root, ".moye/project.yaml"));

    expect(first.manifest.project.id).toBe("demo-project");
    expect(first.manifest.agent.captureTranscripts).toBe("none");
    expect(first.manifest.privacy.capturePrompts).toBe(false);
    expect(first.digest).toBe(second.digest);
    await expect(initializeProjectManifest(root)).rejects.toMatchObject({ code: "PROJECT_MANIFEST_EXISTS" });
    await expect(initializeProjectManifest(root, { force: true })).resolves.toMatchObject({ digest: first.digest });
  });

  it("migrates the explicit legacy schema and reports its origin", async () => {
    const root = await fixture("legacy-project");
    await writeManifest(root, {
      version: 0,
      projectId: "legacy-project",
      repository: ".",
      test: ["npm", "test"],
      documentation: "none",
    });
    const loaded = await loadProjectManifest(path.join(root, ".moye/project.yaml"));
    expect(loaded.migratedFrom).toBe(0);
    expect(loaded.manifest.schemaVersion).toBe(1);
    expect(loaded.manifest.tests[0]?.argv).toEqual(["npm", "test"]);
    expect(loaded.manifest.documentation.policy).toBe("none");
  });

  it("rejects future schemas, unknown fields, shell strings and unsafe refs", async () => {
    const root = await fixture("invalid-project");
    await writeManifest(root, { schemaVersion: 2 });
    await expect(loadProjectManifest(path.join(root, ".moye/project.yaml"))).rejects.toMatchObject({ code: "PROJECT_SCHEMA_UNSUPPORTED" });

    const manifest = structuredClone(defaultProjectManifest("invalid-project")) as unknown as Record<string, unknown>;
    manifest["unexpected"] = true;
    await writeManifest(root, manifest);
    await expect(loadProjectManifest(path.join(root, ".moye/project.yaml"))).rejects.toMatchObject({ code: "PROJECT_UNKNOWN_FIELD" });

    const unsafe = structuredClone(defaultProjectManifest("invalid-project"));
    (unsafe as { tests: unknown }).tests = [{ id: "unsafe", argv: "npm test", cwd: "." }];
    await writeManifest(root, unsafe);
    await expect(loadProjectManifest(path.join(root, ".moye/project.yaml"))).rejects.toBeInstanceOf(ProjectManifestError);

    const shell = structuredClone(defaultProjectManifest("invalid-project"));
    (shell as { tests: unknown }).tests = [{ id: "unsafe", argv: ["bash", "-c", "npm test"], cwd: "." }];
    await writeManifest(root, shell);
    await expect(loadProjectManifest(path.join(root, ".moye/project.yaml"))).rejects.toMatchObject({ code: "PROJECT_COMMAND_FORBIDDEN" });
  });

  it("rejects lexical path traversal and symlink escape", async () => {
    const root = await fixture("bounded-project");
    const traversal = structuredClone(defaultProjectManifest("bounded-project"));
    (traversal as { artifacts: { root: string } }).artifacts.root = "../outside";
    await writeManifest(root, traversal);
    await expect(loadProjectManifest(path.join(root, ".moye/project.yaml"))).rejects.toMatchObject({ code: "PROJECT_PATH_OUTSIDE_REPOSITORY" });

    const outside = await fixture("outside-project");
    await symlink(outside, path.join(root, "external"));
    const escaped = structuredClone(defaultProjectManifest("bounded-project"));
    (escaped as { repository: { root: string } }).repository.root = "external";
    await writeManifest(root, escaped);
    await expect(loadProjectManifest(path.join(root, ".moye/project.yaml"))).rejects.toMatchObject({ code: "PROJECT_PATH_SYMLINK_ESCAPE" });
  });

  it("requires an argv command only for custom documentation policy", async () => {
    const root = await fixture("docs-project");
    const missing = structuredClone(defaultProjectManifest("docs-project"));
    (missing as { documentation: { policy: string } }).documentation.policy = "custom";
    await writeManifest(root, missing);
    await expect(loadProjectManifest(path.join(root, ".moye/project.yaml"))).rejects.toMatchObject({ code: "PROJECT_CUSTOM_DOCS_COMMAND_REQUIRED" });

    const valid = structuredClone(defaultProjectManifest("docs-project"));
    (valid as { documentation: Record<string, unknown> }).documentation = {
      policy: "custom",
      command: { id: "docs", argv: ["node", "scripts/docs.mjs"], cwd: "." },
    };
    await writeManifest(root, valid);
    await expect(loadProjectManifest(path.join(root, ".moye/project.yaml"))).resolves.toMatchObject({
      manifest: { documentation: { policy: "custom" } },
    });
  });
});

async function fixture(name: string): Promise<string> {
  const parent = await mkdtemp(path.join(os.tmpdir(), "moye-project-manifest-"));
  fixtures.push(parent);
  const root = path.join(parent, name);
  await mkdir(root, { recursive: true });
  return root;
}

async function writeManifest(root: string, value: unknown): Promise<void> {
  await mkdir(path.join(root, ".moye"), { recursive: true });
  await writeFile(path.join(root, ".moye/project.yaml"), stringify(value, { lineWidth: 0 }));
  expect((await readFile(path.join(root, ".moye/project.yaml"), "utf8")).length).toBeGreaterThan(0);
}
