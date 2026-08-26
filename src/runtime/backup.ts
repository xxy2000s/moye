import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface RuntimeBackupManifestV1 {
  readonly schemaVersion: 1;
  readonly composeProject: string;
  readonly createdAt: string;
  readonly image: string;
  readonly restateNodeName: string;
  readonly archives: readonly {
    readonly volume: string;
    readonly file: string;
    readonly sha256: string;
  }[];
}

export function archiveFileName(volume: string): string {
  if (!/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(volume)) throw new Error(`Unsafe Docker volume name: ${volume}`);
  return `${volume}.tar.gz`;
}

export async function sha256File(filePath: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("hex")}`;
}

export function parseBackupManifest(value: unknown, expectedProject?: string): RuntimeBackupManifestV1 {
  if (!isRecord(value) || value["schemaVersion"] !== 1 || typeof value["composeProject"] !== "string"
      || typeof value["createdAt"] !== "string" || Number.isNaN(Date.parse(value["createdAt"]))
      || typeof value["image"] !== "string" || typeof value["restateNodeName"] !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value["restateNodeName"])
      || !Array.isArray(value["archives"])) {
    throw new Error("Invalid Runtime backup manifest");
  }
  if (expectedProject !== undefined && value["composeProject"] !== expectedProject) {
    throw new Error(`Backup belongs to ${value["composeProject"]}, not ${expectedProject}`);
  }
  const archives = value["archives"].map((entry) => {
    if (!isRecord(entry) || typeof entry["volume"] !== "string" || typeof entry["file"] !== "string"
        || path.basename(entry["file"]) !== entry["file"] || !/^sha256:[0-9a-f]{64}$/.test(String(entry["sha256"]))) {
      throw new Error("Invalid Runtime backup archive entry");
    }
    return { volume: entry["volume"], file: entry["file"], sha256: String(entry["sha256"]) };
  });
  if (archives.length !== 2 || new Set(archives.map((entry) => entry.volume)).size !== 2) {
    throw new Error("Runtime backup must contain exactly two distinct volumes");
  }
  if (!archives[0]?.volume.endsWith("_restate_data") || !archives[1]?.volume.endsWith("_moye_artifacts")) {
    throw new Error("Runtime backup volume order is invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    composeProject: value["composeProject"],
    createdAt: value["createdAt"],
    image: value["image"],
    restateNodeName: value["restateNodeName"],
    archives: Object.freeze(archives),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
