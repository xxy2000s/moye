export interface MoyeConfig {
  readonly projectId: string;
  readonly restateIngressUrl: string;
  readonly restateAdminUrl: string;
  readonly servicePort: number;
  readonly boardPort: number;
  readonly artifactRoots: readonly string[];
  readonly sessionSourceRoots: readonly string[];
  readonly liveRuntimeRoot: string;
  readonly repositoryRoots: readonly string[];
  readonly observability: {
    readonly enabled: boolean;
    readonly otlpTracesEndpoint: string;
    readonly uiBaseUrl: string;
    readonly serviceName: string;
    readonly projectName: string;
    readonly claudeNativeTelemetry: boolean;
    readonly captureUserPrompts: boolean;
    readonly captureAssistantResponses: boolean;
    readonly captureToolDetails: boolean;
    readonly captureToolContent: boolean;
    readonly captureRawModelIo: boolean;
  };
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MoyeConfig {
  const liveRuntimeRoot = environment["MOYE_LIVE_RUNTIME_ROOT"] ?? ".moye-runtime/live";
  return {
    projectId: environment["MOYE_PROJECT_ID"] ?? "moye",
    restateIngressUrl:
      environment["RESTATE_INGRESS_URL"] ?? "http://127.0.0.1:8080",
    restateAdminUrl:
      environment["RESTATE_ADMIN_URL"] ?? "http://127.0.0.1:9070",
    servicePort: parsePort(environment["RESTATE_SERVICE_PORT"], 9080),
    boardPort: parsePort(environment["MOYE_BOARD_PORT"], 3000),
    artifactRoots: parsePaths(environment["MOYE_ARTIFACT_ROOTS"]),
    sessionSourceRoots: parsePaths(environment["MOYE_SESSION_SOURCE_ROOTS"]),
    liveRuntimeRoot,
    repositoryRoots: parsePaths(environment["MOYE_REPOSITORY_ROOTS"] ?? process.cwd()),
    observability: {
      enabled: parseBoolean(environment["MOYE_OBSERVABILITY_ENABLED"], false),
      otlpTracesEndpoint: environment["MOYE_OTLP_TRACES_ENDPOINT"] ?? "http://127.0.0.1:6006/v1/traces",
      uiBaseUrl: normalizeHttpUrl(environment["MOYE_TRACE_UI_URL"] ?? "http://127.0.0.1:6006"),
      serviceName: environment["MOYE_TRACE_SERVICE_NAME"] ?? "moye",
      projectName: environment["MOYE_TRACE_PROJECT_NAME"] ?? "moye",
      claudeNativeTelemetry: parseBoolean(environment["MOYE_CLAUDE_NATIVE_TELEMETRY"], false),
      captureUserPrompts: parseBoolean(environment["MOYE_CAPTURE_USER_PROMPTS"], false),
      captureAssistantResponses: parseBoolean(environment["MOYE_CAPTURE_ASSISTANT_RESPONSES"], false),
      captureToolDetails: parseBoolean(environment["MOYE_CAPTURE_TOOL_DETAILS"], false),
      captureToolContent: parseBoolean(environment["MOYE_CAPTURE_TOOL_CONTENT"], false),
      captureRawModelIo: parseBoolean(environment["MOYE_CAPTURE_RAW_MODEL_IO"], false),
    },
  };
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return port;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`Invalid boolean: ${raw}`);
}

function parsePaths(raw: string | undefined): readonly string[] {
  if (raw === undefined || !raw.trim()) return [];
  return Object.freeze(raw.split(process.platform === "win32" ? ";" : ":").filter(Boolean));
}

function normalizeHttpUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Invalid HTTP URL: ${raw}`);
  if (url.username || url.password || url.hash) throw new Error(`Unsafe HTTP URL: ${raw}`);
  return url.toString();
}
