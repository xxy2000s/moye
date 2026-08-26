export {
  PROJECT_API_VERSION,
  PROJECT_PLUGIN_API_VERSION,
  PROJECT_SCHEMA_VERSION,
  ProjectManifestError,
  defaultProjectManifest,
  initializeProjectManifest,
  loadProjectManifest,
  migrateProjectManifest,
  parseProjectManifestV1,
} from "../framework/project-manifest.js";

export type {
  AgentRunnerKind,
  DocumentationPolicyKind,
  LoadedProjectManifest,
  ProjectCommandV1,
  ProjectManifestV1,
  TranscriptCapturePolicy,
} from "../framework/project-manifest.js";

export { MoyeError, asMoyeError } from "../domain/errors.js";
export type { MoyeErrorCategory } from "../domain/errors.js";
