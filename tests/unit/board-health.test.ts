import { describe, expect, it, vi } from "vitest";

import { probeRuntimeReadiness, runtimeReleaseIdentity } from "../../src/board/server.js";

describe("board health", () => {
  it("reports a validated release identity without using it as Runtime state", () => {
    expect(runtimeReleaseIdentity({ MOYE_RELEASE_VERSION: "0.1.0-rc.2", MOYE_SOURCE_REVISION: "a".repeat(40) })).toEqual({ version: "0.1.0-rc.2", sourceRevision: "a".repeat(40) });
    expect(() => runtimeReleaseIdentity({ MOYE_RELEASE_VERSION: "bad value" })).toThrow(/invalid/);
  });
  it("requires both Restate ingress reachability and admin health", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await expect(probeRuntimeReadiness({ ingressUrl: "http://restate:8080", restateAdminUrl: "http://restate:9070" }, fetchImpl))
      .resolves.toMatchObject({ ready: true, status: "ready" });
  });

  it("fails closed when a dependency cannot be reached", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await expect(probeRuntimeReadiness({ ingressUrl: "http://restate:8080", restateAdminUrl: "http://restate:9070" }, fetchImpl))
      .resolves.toMatchObject({ ready: false, status: "not_ready" });
  });
});
