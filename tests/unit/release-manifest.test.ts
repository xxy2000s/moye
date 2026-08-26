import { describe, expect, it } from "vitest";

import { createReleaseManifestV1, verifyReleaseManifestV1 } from "../../src/release/manifest.js";

const sha = `sha256:${"a".repeat(64)}`;

describe("release manifest", () => {
  it("binds all release artifacts with a deterministic digest", () => {
    const manifest = createReleaseManifestV1({
      version: "0.1.0-rc.1",
      channel: "rc",
      gitCommit: "b".repeat(40),
      npm: { name: "moye", filename: "moye-0.1.0.tgz", digest: sha, integrity: "sha512-test", bytes: 42 },
      container: { reference: "moye:0.1.0-rc.1", digest: sha },
      protocols: { projectSchema: 1, api: 1, pluginApi: 1 },
      sbomDigest: sha,
    });
    expect(verifyReleaseManifestV1(manifest)).toEqual(manifest);
    expect(() => verifyReleaseManifestV1({ ...manifest, gitCommit: "c".repeat(40) })).toThrow("RELEASE_DIGEST_MISMATCH");
  });

  it("rejects channel/version mismatches", () => {
    const base = {
      gitCommit: "b".repeat(40),
      npm: { name: "moye" as const, filename: "moye.tgz", digest: sha, integrity: "sha512-test", bytes: 42 },
      container: { reference: "moye:test", digest: sha },
      protocols: { projectSchema: 1 as const, api: 1 as const, pluginApi: 1 as const },
      sbomDigest: sha,
    };
    expect(() => createReleaseManifestV1({ ...base, version: "0.1.0-rc.1", channel: "ga" })).toThrow("RELEASE_GA_VERSION_INVALID");
    expect(() => createReleaseManifestV1({ ...base, version: "0.1.0", channel: "rc" })).toThrow("RELEASE_RC_VERSION_INVALID");
  });
});
