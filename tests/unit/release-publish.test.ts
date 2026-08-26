import { describe, expect, it } from "vitest";

import { createReleaseManifestV1 } from "../../src/release/manifest.js";
import {
  createReleasePublishEventV1,
  createReleasePublishIntentV1,
  shouldAppendReleaseObservation,
  summarizeReleasePublish,
  verifyReleasePublishIntentV1,
} from "../../src/release/publish.js";

const sha = `sha256:${"a".repeat(64)}`;
const manifest = createReleaseManifestV1({
  version: "0.1.0", channel: "ga", gitCommit: "b".repeat(40),
  npm: { name: "moye", filename: "moye-0.1.0.tgz", digest: sha, integrity: "sha512-test", bytes: 42 },
  container: { reference: "ghcr.io/xxy2000s/moye:0.1.0", digest: sha },
  protocols: { projectSchema: 1, api: 1, pluginApi: 1 }, sbomDigest: sha,
});

describe("release publish protocol", () => {
  it("binds the GA identity and every external target in one immutable intent", () => {
    const intent = createReleasePublishIntentV1(manifest, {
      gitRemote: "origin", githubRepository: "xxy2000s/moye",
      releaseNotesPath: "docs/knowledge/guidance/releases/v0.1.0.md", containerReference: "ghcr.io/xxy2000s/moye:0.1.0",
    });
    expect(verifyReleasePublishIntentV1(intent)).toEqual(intent);
    expect(intent.git.tag).toBe("v0.1.0");
    expect(() => verifyReleasePublishIntentV1({ ...intent, gitCommit: "c".repeat(40) })).toThrow("RELEASE_PUBLISH_INTENT_DIGEST_MISMATCH");
  });

  it("rejects RC publication and container version drift", () => {
    const rc = createReleaseManifestV1({
      version: "0.1.0-rc.3", channel: "rc", gitCommit: manifest.gitCommit, npm: manifest.npm,
      container: { reference: "moye:0.1.0-rc.3", digest: sha }, protocols: manifest.protocols, sbomDigest: manifest.sbomDigest,
    });
    expect(() => createReleasePublishIntentV1(rc, { gitRemote: "origin", githubRepository: "x/y", releaseNotesPath: "notes.md", containerReference: "moye:0.1.0-rc.3" })).toThrow("RELEASE_PUBLISH_REQUIRES_GA");
    expect(() => createReleasePublishIntentV1(manifest, { gitRemote: "origin", githubRepository: "x/y", releaseNotesPath: "notes.md", containerReference: "moye:latest" })).toThrow("RELEASE_CONTAINER_VERSION_MISMATCH");
  });

  it("records append-only observations and summarizes partial publication", () => {
    const intent = createReleasePublishIntentV1(manifest, { gitRemote: "origin", githubRepository: "xxy2000s/moye", releaseNotesPath: "docs/knowledge/guidance/releases/v0.1.0.md", containerReference: "ghcr.io/xxy2000s/moye:0.1.0" });
    const git = createReleasePublishEventV1(intent, 1, "2026-08-26T00:00:00.000Z", { target: "git_tag", state: "CONFIRMED", evidence: manifest.gitCommit, detail: "remote tag matches" });
    const npm = createReleasePublishEventV1(intent, 2, "2026-08-26T00:00:01.000Z", { target: "npm", state: "BLOCKED_AUTH", evidence: null, detail: "npm credentials unavailable" });
    expect(shouldAppendReleaseObservation(git, { target: "git_tag", state: "CONFIRMED", evidence: manifest.gitCommit, detail: "remote tag matches" })).toBe(false);
    expect(summarizeReleasePublish([git, npm])).toMatchObject({ overall: "PARTIAL", targets: { git_tag: { state: "CONFIRMED" }, npm: { state: "BLOCKED_AUTH" } } });
  });
});
