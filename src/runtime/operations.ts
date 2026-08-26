import path from "node:path";

export type RuntimeAction = "up" | "down" | "status" | "config" | "logs" | "upgrade" | "rollback" | "uninstall" | "purge-data";

export interface ComposeInvocation {
  readonly argv: readonly string[];
  readonly requiresDirectories: boolean;
  readonly destructive: boolean;
}

export function planRuntimeAction(action: RuntimeAction, environment: NodeJS.ProcessEnv = process.env): ComposeInvocation {
  switch (action) {
    case "up":
      return { argv: ["up", "-d", "--build", "restate", "moye", "register"], requiresDirectories: true, destructive: false };
    case "down":
      return { argv: ["stop", "register", "moye", "restate"], requiresDirectories: false, destructive: false };
    case "status":
      return { argv: ["ps", "-a", "restate", "moye", "register"], requiresDirectories: false, destructive: false };
    case "config":
      return { argv: ["config"], requiresDirectories: false, destructive: false };
    case "logs":
      return { argv: ["logs", "--tail", "200", "restate", "moye", "register"], requiresDirectories: false, destructive: false };
    case "upgrade":
    case "rollback":
      requirePinnedImage(environment["MOYE_IMAGE"], action);
      return { argv: ["up", "-d", "--no-deps", "--pull", "always", "moye", "register"], requiresDirectories: true, destructive: false };
    case "uninstall":
      return { argv: ["down", "--remove-orphans"], requiresDirectories: false, destructive: false };
    case "purge-data":
      if (environment["MOYE_CONFIRM_PURGE"] !== "DELETE_RUNTIME_DATA") {
        throw new Error("purge-data requires MOYE_CONFIRM_PURGE=DELETE_RUNTIME_DATA");
      }
      return { argv: ["down", "--volumes", "--remove-orphans"], requiresDirectories: false, destructive: true };
  }
}

export function runtimeBindDirectories(environment: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): readonly string[] {
  return [
    resolveContainedOrAbsolute(environment["MOYE_WORKSPACE_ROOT"] ?? ".moye-runtime/workspaces", cwd),
    resolveContainedOrAbsolute(environment["MOYE_SESSION_SOURCE_ROOT"] ?? ".moye-runtime/sessions", cwd),
  ];
}

export function composeProjectName(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment["COMPOSE_PROJECT_NAME"] ?? "moye";
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)) throw new Error("Invalid COMPOSE_PROJECT_NAME");
  return value;
}

export function runtimeVolumeNames(environment: NodeJS.ProcessEnv = process.env): readonly string[] {
  const project = composeProjectName(environment);
  return [`${project}_restate_data`, `${project}_moye_artifacts`];
}

function requirePinnedImage(image: string | undefined, action: string): void {
  if (image === undefined || !image.trim() || image.endsWith(":latest") || !image.includes(":")) {
    throw new Error(`${action} requires an explicit non-latest MOYE_IMAGE tag`);
  }
}

function resolveContainedOrAbsolute(value: string, cwd: string): string {
  if (value.includes("\0")) throw new Error("Runtime path cannot contain NUL");
  const resolved = path.resolve(cwd, value);
  if (resolved === path.parse(resolved).root) throw new Error("Filesystem root cannot be used as a Runtime bind directory");
  return resolved;
}
