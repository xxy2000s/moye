import { createHash } from "node:crypto";

export interface ReleaseManifestV1 {
  readonly schemaVersion: 1;
  readonly product: "moye";
  readonly version: string;
  readonly channel: "rc" | "ga";
  readonly gitCommit: string;
  readonly npm: {
    readonly name: "moye";
    readonly filename: string;
    readonly digest: string;
    readonly integrity: string;
    readonly bytes: number;
  };
  readonly container: {
    readonly reference: string;
    readonly digest: string;
  };
  readonly protocols: {
    readonly projectSchema: 1;
    readonly api: 1;
    readonly pluginApi: 1;
  };
  readonly sbomDigest: string;
  readonly releaseDigest: string;
}

export function createReleaseManifestV1(input: Omit<ReleaseManifestV1, "schemaVersion" | "product" | "releaseDigest">): ReleaseManifestV1 {
  if (!/^0\.1\.0(?:-rc\.\d+)?$/.test(input.version)) throw new Error("RELEASE_VERSION_INVALID");
  if (input.channel === "ga" && input.version.includes("-")) throw new Error("RELEASE_GA_VERSION_INVALID");
  if (input.channel === "rc" && !input.version.includes("-rc.")) throw new Error("RELEASE_RC_VERSION_INVALID");
  if (!/^[0-9a-f]{40}$/.test(input.gitCommit)) throw new Error("RELEASE_COMMIT_INVALID");
  for (const value of [input.npm.digest, input.container.digest, input.sbomDigest]) assertDigest(value);
  const core = Object.freeze({ schemaVersion: 1 as const, product: "moye" as const, ...input });
  return Object.freeze({ ...core, releaseDigest: digestCanonical(core) });
}

export function verifyReleaseManifestV1(input: ReleaseManifestV1): ReleaseManifestV1 {
  const { releaseDigest, schemaVersion, product, ...rest } = input;
  if (schemaVersion !== 1 || product !== "moye") throw new Error("RELEASE_MANIFEST_VERSION_INVALID");
  const rebuilt = createReleaseManifestV1(rest);
  if (rebuilt.releaseDigest !== releaseDigest) throw new Error("RELEASE_DIGEST_MISMATCH");
  return Object.freeze(input);
}

export function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function digestCanonical(value: unknown): string {
  return digestBytes(Buffer.from(canonical(value)));
}

function assertDigest(value: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error("RELEASE_ARTIFACT_DIGEST_INVALID");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
