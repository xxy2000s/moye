import { digestCanonical, type ReleaseManifestV1, verifyReleaseManifestV1 } from "./manifest.js";

export const RELEASE_PUBLISH_TARGETS = ["git_tag", "github_release", "npm", "container"] as const;
export type ReleasePublishTarget = typeof RELEASE_PUBLISH_TARGETS[number];
export type ReleasePublishState = "NOT_APPLIED" | "CONFIRMED" | "BLOCKED_AUTH" | "UNKNOWN" | "CONFLICT";

export interface ReleasePublishIntentV1 {
  readonly schemaVersion: 1;
  readonly releaseDigest: string;
  readonly version: string;
  readonly gitCommit: string;
  readonly git: { readonly remote: string; readonly tag: string };
  readonly github: { readonly repository: string; readonly releaseNotesPath: string };
  readonly npm: { readonly name: string; readonly integrity: string; readonly filename: string };
  readonly container: { readonly reference: string; readonly imageDigest: string };
  readonly intentDigest: string;
}

export interface ReleasePublishObservationV1 {
  readonly target: ReleasePublishTarget;
  readonly state: ReleasePublishState;
  readonly evidence: string | null;
  readonly detail: string;
}

export interface ReleasePublishEventV1 extends ReleasePublishObservationV1 {
  readonly schemaVersion: 1;
  readonly intentDigest: string;
  readonly sequence: number;
  readonly observedAt: string;
  readonly eventDigest: string;
}

export function createReleasePublishIntentV1(
  manifestInput: ReleaseManifestV1,
  input: {
    readonly gitRemote: string;
    readonly githubRepository: string;
    readonly releaseNotesPath: string;
    readonly containerReference: string;
  },
): ReleasePublishIntentV1 {
  const manifest = verifyReleaseManifestV1(manifestInput);
  if (manifest.channel !== "ga") throw new Error("RELEASE_PUBLISH_REQUIRES_GA");
  if (!/^[A-Za-z0-9._-]+$/.test(input.gitRemote)) throw new Error("RELEASE_GIT_REMOTE_INVALID");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.githubRepository)) throw new Error("RELEASE_GITHUB_REPOSITORY_INVALID");
  if (!input.releaseNotesPath.trim() || input.releaseNotesPath.startsWith("/") || input.releaseNotesPath.includes("..")) throw new Error("RELEASE_NOTES_PATH_INVALID");
  if (input.containerReference !== manifest.container.reference || !input.containerReference.endsWith(`:${manifest.version}`)) throw new Error("RELEASE_CONTAINER_VERSION_MISMATCH");
  const core = {
    schemaVersion: 1 as const,
    releaseDigest: manifest.releaseDigest,
    version: manifest.version,
    gitCommit: manifest.gitCommit,
    git: { remote: input.gitRemote, tag: `v${manifest.version}` },
    github: { repository: input.githubRepository, releaseNotesPath: input.releaseNotesPath },
    npm: { name: manifest.npm.name, integrity: manifest.npm.integrity, filename: manifest.npm.filename },
    container: { reference: input.containerReference, imageDigest: manifest.container.digest },
  };
  return Object.freeze({ ...core, intentDigest: digestCanonical(core) });
}

export function verifyReleasePublishIntentV1(input: ReleasePublishIntentV1): ReleasePublishIntentV1 {
  const { intentDigest, ...core } = input;
  if (digestCanonical(core) !== intentDigest) throw new Error("RELEASE_PUBLISH_INTENT_DIGEST_MISMATCH");
  return Object.freeze(input);
}

export function createReleasePublishEventV1(
  intentInput: ReleasePublishIntentV1,
  sequence: number,
  observedAt: string,
  observation: ReleasePublishObservationV1,
): ReleasePublishEventV1 {
  const intent = verifyReleasePublishIntentV1(intentInput);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("RELEASE_PUBLISH_SEQUENCE_INVALID");
  if (!RELEASE_PUBLISH_TARGETS.includes(observation.target)) throw new Error("RELEASE_PUBLISH_TARGET_INVALID");
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("RELEASE_PUBLISH_TIMESTAMP_INVALID");
  if (!observation.detail.trim()) throw new Error("RELEASE_PUBLISH_DETAIL_REQUIRED");
  const core = { schemaVersion: 1 as const, intentDigest: intent.intentDigest, sequence, observedAt, ...observation };
  return Object.freeze({ ...core, eventDigest: digestCanonical(core) });
}

export function shouldAppendReleaseObservation(
  previous: ReleasePublishEventV1 | undefined,
  next: ReleasePublishObservationV1,
): boolean {
  return previous === undefined || previous.target !== next.target || previous.state !== next.state || previous.evidence !== next.evidence || previous.detail !== next.detail;
}

export function summarizeReleasePublish(events: readonly ReleasePublishEventV1[]): {
  readonly targets: Readonly<Record<ReleasePublishTarget, ReleasePublishObservationV1 | null>>;
  readonly overall: "CONFIRMED" | "PARTIAL" | "BLOCKED";
} {
  const latest = Object.fromEntries(RELEASE_PUBLISH_TARGETS.map((target) => [target, null])) as Record<ReleasePublishTarget, ReleasePublishObservationV1 | null>;
  for (const event of events) latest[event.target] = { target: event.target, state: event.state, evidence: event.evidence, detail: event.detail };
  const observations = Object.values(latest);
  const overall = observations.every((value) => value?.state === "CONFIRMED") ? "CONFIRMED"
    : observations.some((value) => value?.state === "CONFIRMED") ? "PARTIAL" : "BLOCKED";
  return Object.freeze({ targets: Object.freeze(latest), overall });
}
