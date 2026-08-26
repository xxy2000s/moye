import { describe, expect, it } from "vitest";

import { archiveFileName, parseBackupManifest } from "../../src/runtime/backup.js";

describe("runtime backup manifest", () => {
  it("accepts the two content-addressed Runtime volumes", () => {
    expect(parseBackupManifest({
      schemaVersion: 1,
      composeProject: "moye_fixture",
      createdAt: "2026-08-25T00:00:00.000Z",
      image: "moye:0.1.0",
      restateNodeName: "moye-runtime",
      archives: [
        { volume: "moye_fixture_restate_data", file: "restate.tar.gz", sha256: `sha256:${"a".repeat(64)}` },
        { volume: "moye_fixture_moye_artifacts", file: "artifacts.tar.gz", sha256: `sha256:${"b".repeat(64)}` },
      ],
    }, "moye_fixture").archives).toHaveLength(2);
  });

  it("rejects traversal and invalid manifests", () => {
    expect(() => archiveFileName("../runtime")).toThrow(/Unsafe/);
    expect(() => parseBackupManifest({ schemaVersion: 1, composeProject: "a", createdAt: "bad", image: "moye:x", restateNodeName: "moye-runtime", archives: [] }, "b"))
      .toThrow(/Invalid/);
  });
});
