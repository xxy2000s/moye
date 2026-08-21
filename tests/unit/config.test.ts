import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";

describe("Moye observability configuration", () => {
  it("is disabled and privacy-safe by default", () => {
    const config = loadConfig({});
    expect(config.observability).toMatchObject({
      enabled: false,
      claudeNativeTelemetry: false,
      captureUserPrompts: false,
      captureAssistantResponses: false,
      captureToolDetails: false,
      captureToolContent: false,
      captureRawModelIo: false,
    });
    expect(config.artifactRoots).toEqual([]);
  });

  it("parses explicit trace and privacy switches without touching settings files", () => {
    const config = loadConfig({
      MOYE_OBSERVABILITY_ENABLED: "true",
      MOYE_OTLP_TRACES_ENDPOINT: "http://collector.test:4318/v1/traces",
      MOYE_TRACE_UI_URL: "http://phoenix.test:6006",
      MOYE_TRACE_PROJECT_NAME: "nightly",
      MOYE_CLAUDE_NATIVE_TELEMETRY: "1",
      MOYE_CAPTURE_RAW_MODEL_IO: "true",
      MOYE_ARTIFACT_ROOTS: "/tmp/a:/tmp/b",
    });
    expect(config.observability).toMatchObject({
      enabled: true,
      otlpTracesEndpoint: "http://collector.test:4318/v1/traces",
      uiBaseUrl: "http://phoenix.test:6006/",
      projectName: "nightly",
      claudeNativeTelemetry: true,
      captureRawModelIo: true,
    });
    expect(config.artifactRoots).toEqual(["/tmp/a", "/tmp/b"]);
    expect(() => loadConfig({ MOYE_OBSERVABILITY_ENABLED: "sometimes" })).toThrow(/Invalid boolean/);
  });
});
