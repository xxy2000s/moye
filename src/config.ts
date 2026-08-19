export interface MoyeConfig {
  readonly projectId: string;
  readonly restateIngressUrl: string;
  readonly servicePort: number;
  readonly boardPort: number;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MoyeConfig {
  return {
    projectId: environment["MOYE_PROJECT_ID"] ?? "moye",
    restateIngressUrl:
      environment["RESTATE_INGRESS_URL"] ?? "http://127.0.0.1:8080",
    servicePort: parsePort(environment["RESTATE_SERVICE_PORT"], 9080),
    boardPort: parsePort(environment["MOYE_BOARD_PORT"], 3000),
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
