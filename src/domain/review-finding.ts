import { createHash } from "node:crypto";

import { MoyeError, type MoyeErrorCategory } from "./errors.js";
import { assertTaskId } from "./task.js";

export const REVIEW_FINDING_CATEGORIES = Object.freeze([
  "IMPLEMENTATION", "DESIGN", "REQUIREMENT", "TEST", "DOCUMENTATION", "INFRASTRUCTURE",
] as const);
export type ReviewFindingCategory = (typeof REVIEW_FINDING_CATEGORIES)[number];

export const REVIEW_FINDING_SEVERITIES = Object.freeze(["BLOCKING", "MAJOR", "MINOR", "INFO"] as const);
export type ReviewFindingSeverity = (typeof REVIEW_FINDING_SEVERITIES)[number];

export const REVIEW_RECOMMENDED_ACTIONS = Object.freeze(["REPAIR", "REPLAN", "RETRY", "ACCEPT"] as const);
export type ReviewRecommendedAction = (typeof REVIEW_RECOMMENDED_ACTIONS)[number];

export type ReviewFindingStatus = "OPEN" | "RESOLVED" | "SUPERSEDED" | "ACCEPTED_RISK";
export type SelfReviewVerdict = "READY_FOR_REVIEW" | "CHANGES_REQUIRED";
export type SelfReviewCheckConclusion = "PASS" | "CONCERN" | "FAIL";
export type ReviewVerdict = "PASSED" | "FINDINGS";

export interface SelfReviewCheckInput {
  readonly checkId: string;
  readonly conclusion: SelfReviewCheckConclusion;
  readonly evidenceRefs: readonly string[];
  readonly note: string;
}

export interface SelfReviewCheck extends SelfReviewCheckInput {}

export interface ImplementationSelfReviewInput {
  readonly taskId: string;
  readonly specRevision: number;
  readonly implementationAttemptId: string;
  readonly implementationRunId: string;
  readonly candidateCommit: string;
  readonly diffRef: string;
  readonly diffDigest: string;
  readonly checkpointRef: string;
  readonly testEvidenceRefs: readonly string[];
  readonly verdict: SelfReviewVerdict;
  readonly summary: string;
  readonly checklist: readonly SelfReviewCheckInput[];
}

export interface ImplementationSelfReview extends Omit<ImplementationSelfReviewInput, "checklist"> {
  readonly schemaVersion: 1;
  readonly checklist: readonly SelfReviewCheck[];
  readonly selfReviewDigest: string;
}

export interface ReviewInputRequest {
  readonly selfReview: ImplementationSelfReview;
  readonly selfReviewRef: string;
  readonly verificationEvidenceRefs: readonly string[];
}

export interface ReviewInput {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly candidateCommit: string;
  readonly diffRef: string;
  readonly diffDigest: string;
  readonly checkpointRef: string;
  readonly selfReviewRef: string;
  readonly selfReviewDigest: string;
  readonly verificationEvidenceRefs: readonly string[];
  readonly reviewInputDigest: string;
}

export interface ReviewFindingInput {
  readonly reviewInput: ReviewInput;
  readonly reviewAttemptId: string;
  readonly reviewRunId: string;
  readonly category: ReviewFindingCategory;
  readonly severity: ReviewFindingSeverity;
  readonly requirementRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly summary: string;
  readonly recommendedAction: ReviewRecommendedAction;
}

export interface ReviewFindingDisposition {
  readonly dispositionId: string;
  readonly sourceFindingDigest: string;
  readonly fromStatus: ReviewFindingStatus;
  readonly toStatus: Exclude<ReviewFindingStatus, "OPEN">;
  readonly actorRef: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface ReviewFinding {
  readonly schemaVersion: 1;
  readonly findingId: string;
  readonly taskId: string;
  readonly specRevision: number;
  readonly candidateCommit: string;
  readonly reviewInputDigest: string;
  readonly reviewAttemptId: string;
  readonly reviewRunId: string;
  readonly category: ReviewFindingCategory;
  readonly severity: ReviewFindingSeverity;
  readonly requirementRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly summary: string;
  readonly recommendedAction: ReviewRecommendedAction;
  readonly originDigest: string;
  readonly status: ReviewFindingStatus;
  readonly dispositions: readonly ReviewFindingDisposition[];
  readonly findingDigest: string;
}

export interface ReviewFindingDispositionInput {
  readonly expectedFindingDigest: string;
  readonly toStatus: Exclude<ReviewFindingStatus, "OPEN">;
  readonly actorRef: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface ReviewResultInput {
  readonly reviewInput: ReviewInput;
  readonly reviewAttemptId: string;
  readonly reviewRunId: string;
  readonly roleRunResultDigest: string;
  readonly verdict: ReviewVerdict;
  readonly findings: readonly ReviewFinding[];
  readonly summary: string;
}

export interface ReviewFindingBinding {
  readonly findingRef: string;
  readonly findingId: string;
  readonly originDigest: string;
}

export interface ReviewResult {
  readonly schemaVersion: 1;
  readonly executionOutcome: "SUCCEEDED";
  readonly taskId: string;
  readonly specRevision: number;
  readonly candidateCommit: string;
  readonly reviewInputDigest: string;
  readonly reviewAttemptId: string;
  readonly reviewRunId: string;
  readonly roleRunResultDigest: string;
  readonly verdict: ReviewVerdict;
  readonly findings: readonly ReviewFindingBinding[];
  readonly summary: string;
  readonly reviewResultDigest: string;
}

export interface ReviewExecutionFailureInput {
  readonly reviewInput: ReviewInput;
  readonly reviewAttemptId: string;
  readonly reviewRunId: string;
  readonly roleRunResultDigest: string;
  readonly errorCode: string;
  readonly errorCategory: MoyeErrorCategory;
  readonly message: string;
}

export interface ReviewExecutionFailure {
  readonly schemaVersion: 1;
  readonly executionOutcome: "FAILED";
  readonly taskId: string;
  readonly specRevision: number;
  readonly candidateCommit: string;
  readonly reviewInputDigest: string;
  readonly reviewAttemptId: string;
  readonly reviewRunId: string;
  readonly roleRunResultDigest: string;
  readonly errorCode: string;
  readonly errorCategory: MoyeErrorCategory;
  readonly message: string;
  readonly failureDigest: string;
}

export interface ReviewGateResult {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly specRevision: number;
  readonly candidateCommit: string;
  readonly reviewInputDigest: string;
  readonly roleRunResultDigest: string;
  readonly reviewResultDigest: string;
  readonly verdict: "PASSED" | "BLOCKED";
  readonly findingRecordDigests: readonly string[];
  readonly unresolvedBlockingFindingRefs: readonly string[];
  readonly gateDigest: string;
}

const trustedSelfReviews = new WeakSet<object>();
const trustedReviewInputs = new WeakSet<object>();
const trustedFindings = new WeakSet<object>();
const trustedReviewResults = new WeakSet<object>();
const trustedFailures = new WeakSet<object>();
const trustedGates = new WeakSet<object>();

export function createImplementationSelfReview(input: ImplementationSelfReviewInput): ImplementationSelfReview {
  const taskId = checkedTaskId(input.taskId);
  const specRevision = positiveInteger(input.specRevision, "specRevision");
  const implementationAttemptId = roleAttemptId(input.implementationAttemptId, taskId, "IMPLEMENTATION");
  const implementationRunId = shaDigest(input.implementationRunId, "implementationRunId");
  const candidateCommit = gitObjectId(input.candidateCommit, "candidateCommit");
  const diffRef = artifactRef(input.diffRef, "diffRef");
  const diffDigest = shaDigest(input.diffDigest, "diffDigest");
  const checkpointRef = artifactRef(input.checkpointRef, "checkpointRef");
  const testEvidenceRefs = normalizedRefs(input.testEvidenceRefs, "testEvidenceRefs", true);
  const verdict = selfReviewVerdict(input.verdict);
  const summary = requiredString(input.summary, "summary");
  if (!Array.isArray(input.checklist) || input.checklist.length === 0) {
    throw validation("SELF_REVIEW_CHECKLIST_REQUIRED", "Self Review requires at least one checklist item");
  }
  const checklist = input.checklist.map(normalizeSelfReviewCheck);
  unique(checklist.map((item) => item.checkId), "Self Review check ID");
  const nonPass = checklist.filter((item) => item.conclusion !== "PASS");
  if (verdict === "READY_FOR_REVIEW" && nonPass.length > 0) {
    throw conflict("SELF_REVIEW_VERDICT_CONTRADICTION", "READY_FOR_REVIEW requires every checklist item to PASS");
  }
  if (verdict === "CHANGES_REQUIRED" && nonPass.length === 0) {
    throw conflict("SELF_REVIEW_VERDICT_CONTRADICTION", "CHANGES_REQUIRED requires a concern or failure");
  }
  const core = {
    schemaVersion: 1 as const,
    taskId,
    specRevision,
    implementationAttemptId,
    implementationRunId,
    candidateCommit,
    diffRef,
    diffDigest,
    checkpointRef,
    testEvidenceRefs,
    verdict,
    summary,
    checklist,
  };
  const result: ImplementationSelfReview = { ...core, selfReviewDigest: digest("implementation-self-review", core) };
  trustedSelfReviews.add(result);
  return deepFreeze(result);
}

export function parseImplementationSelfReview(value: unknown, expectedDigest: string): ImplementationSelfReview {
  const input = record(value, "ImplementationSelfReview");
  const parsed = createImplementationSelfReview({
    taskId: input["taskId"] as string,
    specRevision: input["specRevision"] as number,
    implementationAttemptId: input["implementationAttemptId"] as string,
    implementationRunId: input["implementationRunId"] as string,
    candidateCommit: input["candidateCommit"] as string,
    diffRef: input["diffRef"] as string,
    diffDigest: input["diffDigest"] as string,
    checkpointRef: input["checkpointRef"] as string,
    testEvidenceRefs: input["testEvidenceRefs"] as readonly string[],
    verdict: input["verdict"] as SelfReviewVerdict,
    summary: input["summary"] as string,
    checklist: input["checklist"] as readonly SelfReviewCheckInput[],
  });
  if (input["schemaVersion"] !== 1 || input["selfReviewDigest"] !== parsed.selfReviewDigest ||
      expectedDigest !== parsed.selfReviewDigest) {
    throw conflict("SELF_REVIEW_INTEGRITY_FAILED", "serialized Self Review does not match its digest");
  }
  return parsed;
}

export function createReviewInput(input: ReviewInputRequest): ReviewInput {
  assertTrustedSelfReview(input.selfReview);
  if (input.selfReview.verdict !== "READY_FOR_REVIEW") {
    throw conflict("SELF_REVIEW_NOT_READY", "CHANGES_REQUIRED Self Review cannot authorize Review");
  }
  const core = {
    schemaVersion: 1 as const,
    taskId: input.selfReview.taskId,
    specRevision: input.selfReview.specRevision,
    candidateCommit: input.selfReview.candidateCommit,
    diffRef: input.selfReview.diffRef,
    diffDigest: input.selfReview.diffDigest,
    checkpointRef: input.selfReview.checkpointRef,
    selfReviewRef: artifactRef(input.selfReviewRef, "selfReviewRef"),
    selfReviewDigest: input.selfReview.selfReviewDigest,
    verificationEvidenceRefs: normalizedRefs(input.verificationEvidenceRefs, "verificationEvidenceRefs", true),
  };
  const result: ReviewInput = { ...core, reviewInputDigest: digest("review-input", core) };
  trustedReviewInputs.add(result);
  return deepFreeze(result);
}

export function parseReviewInput(
  value: unknown,
  selfReview: ImplementationSelfReview,
  expectedDigest: string,
): ReviewInput {
  const input = record(value, "ReviewInput");
  const parsed = createReviewInput({
    selfReview,
    selfReviewRef: input["selfReviewRef"] as string,
    verificationEvidenceRefs: input["verificationEvidenceRefs"] as readonly string[],
  });
  if (input["schemaVersion"] !== 1 || canonicalJson(value) !== canonicalJson(parsed) ||
      parsed.reviewInputDigest !== expectedDigest) {
    throw conflict("REVIEW_INPUT_INTEGRITY_FAILED", "serialized Review Input differs from its bound Self Review");
  }
  return parsed;
}

export function createReviewFinding(input: ReviewFindingInput): ReviewFinding {
  assertTrustedReviewInput(input.reviewInput);
  const reviewAttemptId = roleAttemptId(input.reviewAttemptId, input.reviewInput.taskId, "REVIEW");
  const reviewRunId = shaDigest(input.reviewRunId, "reviewRunId");
  const category = findingCategory(input.category);
  const severity = findingSeverity(input.severity);
  const requirementRefs = normalizedRefs(input.requirementRefs, "requirementRefs", false);
  const evidenceRefs = normalizedRefs(input.evidenceRefs, "evidenceRefs", true);
  const summary = requiredString(input.summary, "summary");
  const recommendedAction = readRecommendedAction(input.recommendedAction);
  const identity = {
    taskId: input.reviewInput.taskId,
    specRevision: input.reviewInput.specRevision,
    candidateCommit: input.reviewInput.candidateCommit,
    reviewInputDigest: input.reviewInput.reviewInputDigest,
    reviewAttemptId,
    reviewRunId,
    category,
    severity,
    requirementRefs,
    evidenceRefs,
    summary,
    recommendedAction,
  };
  const findingId = `finding:${digestHex("review-finding-id", identity)}`;
  const originDigest = digest("review-finding-origin", { findingId, ...identity });
  return finalizeFinding({
    schemaVersion: 1,
    findingId,
    ...identity,
    originDigest,
    status: "OPEN",
    dispositions: [],
  });
}

export function transitionReviewFinding(
  finding: ReviewFinding,
  input: ReviewFindingDispositionInput,
): ReviewFinding {
  assertTrustedFinding(finding);
  const normalized = normalizeDispositionInput(input);
  const replay = finding.dispositions.find((item) =>
    item.sourceFindingDigest === normalized.expectedFindingDigest &&
    item.toStatus === normalized.toStatus && item.actorRef === normalized.actorRef &&
    item.reason === normalized.reason && canonicalJson(item.evidenceRefs) === canonicalJson(normalized.evidenceRefs));
  if (replay !== undefined) return finding;
  if (input.expectedFindingDigest !== finding.findingDigest) {
    throw conflict("STALE_FINDING_DIGEST", "Finding disposition expected digest is stale");
  }
  if (finding.status !== "OPEN") {
    throw conflict("FINDING_ALREADY_DISPOSED", `Finding ${finding.findingId} is already ${finding.status}`);
  }
  const dispositionCore = {
    sourceFindingDigest: finding.findingDigest,
    fromStatus: finding.status,
    toStatus: normalized.toStatus,
    actorRef: normalized.actorRef,
    reason: normalized.reason,
    evidenceRefs: normalized.evidenceRefs,
  };
  const disposition: ReviewFindingDisposition = deepFreeze({
    dispositionId: `finding-disposition:${digestHex("finding-disposition-id", { findingId: finding.findingId, ...dispositionCore })}`,
    ...dispositionCore,
  });
  return finalizeFinding({
    ...findingWithoutDigest(finding),
    status: normalized.toStatus,
    dispositions: [...finding.dispositions, disposition],
  });
}

export function parseReviewFinding(
  value: unknown,
  reviewInput: ReviewInput,
  expectedDigest: string,
): ReviewFinding {
  const input = record(value, "ReviewFinding");
  let parsed = createReviewFinding({
    reviewInput,
    reviewAttemptId: input["reviewAttemptId"] as string,
    reviewRunId: input["reviewRunId"] as string,
    category: input["category"] as ReviewFindingCategory,
    severity: input["severity"] as ReviewFindingSeverity,
    requirementRefs: input["requirementRefs"] as readonly string[],
    evidenceRefs: input["evidenceRefs"] as readonly string[],
    summary: input["summary"] as string,
    recommendedAction: input["recommendedAction"] as ReviewRecommendedAction,
  });
  if (!Array.isArray(input["dispositions"])) {
    throw validation("INVALID_FINDING_DISPOSITIONS", "Finding dispositions must be an array");
  }
  for (const raw of input["dispositions"]) {
    const disposition = record(raw, "ReviewFindingDisposition");
    const next = transitionReviewFinding(parsed, {
      expectedFindingDigest: disposition["sourceFindingDigest"] as string,
      toStatus: disposition["toStatus"] as Exclude<ReviewFindingStatus, "OPEN">,
      actorRef: disposition["actorRef"] as string,
      reason: disposition["reason"] as string,
      evidenceRefs: disposition["evidenceRefs"] as readonly string[],
    });
    const actual = next.dispositions.at(-1)!;
    if (disposition["dispositionId"] !== actual.dispositionId || disposition["fromStatus"] !== actual.fromStatus) {
      throw conflict("FINDING_DISPOSITION_INTEGRITY_FAILED", "serialized Finding disposition is not canonical");
    }
    parsed = next;
  }
  if (input["schemaVersion"] !== 1 || canonicalJson(input) !== canonicalJson(parsed) ||
      parsed.findingDigest !== expectedDigest) {
    throw conflict("FINDING_INTEGRITY_FAILED", "serialized Finding does not match its digest or bound Review Input");
  }
  return parsed;
}

export function reviewFindingRef(finding: ReviewFinding): string {
  assertTrustedFinding(finding);
  return `review-finding://${finding.findingId}`;
}

export function createReviewResult(input: ReviewResultInput): ReviewResult {
  assertTrustedReviewInput(input.reviewInput);
  const reviewAttemptId = roleAttemptId(input.reviewAttemptId, input.reviewInput.taskId, "REVIEW");
  const reviewRunId = shaDigest(input.reviewRunId, "reviewRunId");
  const roleRunResultDigest = shaDigest(input.roleRunResultDigest, "roleRunResultDigest");
  const verdict = reviewVerdict(input.verdict);
  if (!Array.isArray(input.findings)) throw validation("INVALID_REVIEW_FINDINGS", "Review findings must be an array");
  for (const finding of input.findings) {
    assertTrustedFinding(finding);
    assertFindingMatchesReview(finding, input.reviewInput, reviewAttemptId, reviewRunId);
    if (finding.status !== "OPEN" || finding.dispositions.length > 0) {
      throw conflict("REVIEW_RESULT_FINDING_NOT_ORIGINAL", "Review Result must bind each Finding at its original OPEN state");
    }
  }
  unique(input.findings.map((finding) => finding.findingId), "Finding ID");
  if (verdict === "PASSED" && input.findings.length > 0) {
    throw conflict("REVIEW_VERDICT_CONTRADICTION", "PASSED Review cannot contain Findings");
  }
  if (verdict === "FINDINGS" && input.findings.length === 0) {
    throw conflict("REVIEW_VERDICT_CONTRADICTION", "FINDINGS Review requires at least one Finding");
  }
  const findings = input.findings.map((finding) => ({
    findingRef: reviewFindingRef(finding),
    findingId: finding.findingId,
    originDigest: finding.originDigest,
  })).sort((a, b) => a.findingId.localeCompare(b.findingId));
  const core = {
    schemaVersion: 1 as const,
    executionOutcome: "SUCCEEDED" as const,
    taskId: input.reviewInput.taskId,
    specRevision: input.reviewInput.specRevision,
    candidateCommit: input.reviewInput.candidateCommit,
    reviewInputDigest: input.reviewInput.reviewInputDigest,
    reviewAttemptId,
    reviewRunId,
    roleRunResultDigest,
    verdict,
    findings,
    summary: requiredString(input.summary, "summary"),
  };
  const result: ReviewResult = { ...core, reviewResultDigest: digest("review-result", core) };
  trustedReviewResults.add(result);
  return deepFreeze(result);
}

export function parseReviewResult(
  value: unknown,
  reviewInput: ReviewInput,
  findings: readonly ReviewFinding[],
  expectedDigest: string,
): ReviewResult {
  const input = record(value, "ReviewResult");
  const parsed = createReviewResult({
    reviewInput,
    reviewAttemptId: input["reviewAttemptId"] as string,
    reviewRunId: input["reviewRunId"] as string,
    roleRunResultDigest: input["roleRunResultDigest"] as string,
    verdict: input["verdict"] as ReviewVerdict,
    findings,
    summary: input["summary"] as string,
  });
  if (input["schemaVersion"] !== 1 || canonicalJson(input) !== canonicalJson(parsed) ||
      parsed.reviewResultDigest !== expectedDigest) {
    throw conflict("REVIEW_RESULT_INTEGRITY_FAILED", "serialized Review Result does not match its digest or Findings");
  }
  return parsed;
}

export function createReviewExecutionFailure(input: ReviewExecutionFailureInput): ReviewExecutionFailure {
  assertTrustedReviewInput(input.reviewInput);
  const core = {
    schemaVersion: 1 as const,
    executionOutcome: "FAILED" as const,
    taskId: input.reviewInput.taskId,
    specRevision: input.reviewInput.specRevision,
    candidateCommit: input.reviewInput.candidateCommit,
    reviewInputDigest: input.reviewInput.reviewInputDigest,
    reviewAttemptId: roleAttemptId(input.reviewAttemptId, input.reviewInput.taskId, "REVIEW"),
    reviewRunId: shaDigest(input.reviewRunId, "reviewRunId"),
    roleRunResultDigest: shaDigest(input.roleRunResultDigest, "roleRunResultDigest"),
    errorCode: requiredString(input.errorCode, "errorCode"),
    errorCategory: errorCategory(input.errorCategory),
    message: requiredString(input.message, "message"),
  };
  const result: ReviewExecutionFailure = { ...core, failureDigest: digest("review-execution-failure", core) };
  trustedFailures.add(result);
  return deepFreeze(result);
}

export function parseReviewExecutionFailure(
  value: unknown,
  reviewInput: ReviewInput,
  expectedDigest: string,
): ReviewExecutionFailure {
  const input = record(value, "ReviewExecutionFailure");
  const parsed = createReviewExecutionFailure({
    reviewInput,
    reviewAttemptId: input["reviewAttemptId"] as string,
    reviewRunId: input["reviewRunId"] as string,
    roleRunResultDigest: input["roleRunResultDigest"] as string,
    errorCode: input["errorCode"] as string,
    errorCategory: input["errorCategory"] as MoyeErrorCategory,
    message: input["message"] as string,
  });
  if (input["schemaVersion"] !== 1 || canonicalJson(input) !== canonicalJson(parsed) ||
      parsed.failureDigest !== expectedDigest) {
    throw conflict("REVIEW_FAILURE_INTEGRITY_FAILED", "serialized Review failure does not match its digest or Review Input");
  }
  return parsed;
}

export function evaluateReviewGate(
  reviewInput: ReviewInput,
  reviewResult: ReviewResult,
  findings: readonly ReviewFinding[],
): ReviewGateResult {
  assertTrustedReviewInput(reviewInput);
  assertTrustedReviewResult(reviewResult);
  if (reviewResult.taskId !== reviewInput.taskId || reviewResult.specRevision !== reviewInput.specRevision ||
      reviewResult.candidateCommit !== reviewInput.candidateCommit ||
      reviewResult.reviewInputDigest !== reviewInput.reviewInputDigest) {
    throw conflict("REVIEW_RESULT_INPUT_MISMATCH", "Review Result does not belong to Review Input");
  }
  if (!Array.isArray(findings)) throw validation("INVALID_REVIEW_FINDINGS", "Review findings must be an array");
  const byId = new Map<string, ReviewFinding>();
  for (const finding of findings) {
    assertTrustedFinding(finding);
    assertFindingMatchesReview(finding, reviewInput, reviewResult.reviewAttemptId, reviewResult.reviewRunId);
    if (byId.has(finding.findingId)) throw conflict("DUPLICATE_FINDING", `Duplicate Finding ${finding.findingId}`);
    byId.set(finding.findingId, finding);
  }
  if (byId.size !== reviewResult.findings.length) {
    throw conflict("REVIEW_FINDING_SET_MISMATCH", "Review Gate requires the exact Finding set from Review Result");
  }
  for (const binding of reviewResult.findings) {
    const finding = byId.get(binding.findingId);
    if (finding === undefined || binding.findingRef !== reviewFindingRef(finding) ||
        binding.originDigest !== finding.originDigest) {
      throw conflict("REVIEW_FINDING_BINDING_MISMATCH", "Review Finding does not match its Result binding");
    }
  }
  const ordered = [...findings].sort((a, b) => a.findingId.localeCompare(b.findingId));
  const unresolvedBlockingFindingRefs = ordered
    .filter((finding) => finding.severity === "BLOCKING" && finding.status === "OPEN")
    .map(reviewFindingRef);
  const core = {
    schemaVersion: 1 as const,
    taskId: reviewInput.taskId,
    specRevision: reviewInput.specRevision,
    candidateCommit: reviewInput.candidateCommit,
    reviewInputDigest: reviewInput.reviewInputDigest,
    roleRunResultDigest: reviewResult.roleRunResultDigest,
    reviewResultDigest: reviewResult.reviewResultDigest,
    verdict: unresolvedBlockingFindingRefs.length === 0 ? "PASSED" as const : "BLOCKED" as const,
    findingRecordDigests: ordered.map((finding) => finding.findingDigest),
    unresolvedBlockingFindingRefs,
  };
  const result: ReviewGateResult = { ...core, gateDigest: digest("review-gate-result", core) };
  trustedGates.add(result);
  return deepFreeze(result);
}

export function parseReviewGateResult(
  value: unknown,
  reviewInput: ReviewInput,
  reviewResult: ReviewResult,
  findings: readonly ReviewFinding[],
  expectedDigest: string,
): ReviewGateResult {
  const input = record(value, "ReviewGateResult");
  const parsed = evaluateReviewGate(reviewInput, reviewResult, findings);
  if (input["schemaVersion"] !== 1 || canonicalJson(input) !== canonicalJson(parsed) ||
      parsed.gateDigest !== expectedDigest) {
    throw conflict("REVIEW_GATE_INTEGRITY_FAILED", "serialized Review Gate does not match its digest or Finding state");
  }
  return parsed;
}

export function assertTrustedReviewGateResult(value: ReviewGateResult): void {
  if (!trustedGates.has(value) || !Object.isFrozen(value)) {
    throw validation("UNTRUSTED_REVIEW_GATE", "Review Gate Result must come from evaluateReviewGate");
  }
  const { gateDigest, ...core } = value;
  if (gateDigest !== digest("review-gate-result", core)) {
    throw conflict("REVIEW_GATE_INTEGRITY_FAILED", "Review Gate Result digest is stale");
  }
}

function finalizeFinding(core: Omit<ReviewFinding, "findingDigest">): ReviewFinding {
  const result: ReviewFinding = { ...core, findingDigest: digest("review-finding-record", core) };
  trustedFindings.add(result);
  return deepFreeze(result);
}

function findingWithoutDigest(finding: ReviewFinding): Omit<ReviewFinding, "findingDigest"> {
  const { findingDigest: _digest, ...core } = finding;
  return core;
}

function normalizeSelfReviewCheck(value: SelfReviewCheckInput): SelfReviewCheck {
  const conclusion = value.conclusion;
  if (conclusion !== "PASS" && conclusion !== "CONCERN" && conclusion !== "FAIL") {
    throw validation("INVALID_SELF_REVIEW_CONCLUSION", `Invalid Self Review conclusion: ${String(conclusion)}`);
  }
  return deepFreeze({
    checkId: identifier(value.checkId, "checkId"),
    conclusion,
    evidenceRefs: normalizedRefs(value.evidenceRefs, "check.evidenceRefs", true),
    note: requiredString(value.note, "check.note"),
  });
}

function normalizeDispositionInput(input: ReviewFindingDispositionInput) {
  shaDigest(input.expectedFindingDigest, "expectedFindingDigest");
  if (input.toStatus !== "RESOLVED" && input.toStatus !== "SUPERSEDED" && input.toStatus !== "ACCEPTED_RISK") {
    throw validation("INVALID_FINDING_STATUS", `Invalid Finding disposition: ${String(input.toStatus)}`);
  }
  return {
    expectedFindingDigest: input.expectedFindingDigest,
    toStatus: input.toStatus,
    actorRef: artifactRef(input.actorRef, "actorRef"),
    reason: requiredString(input.reason, "reason"),
    evidenceRefs: normalizedRefs(input.evidenceRefs, "disposition.evidenceRefs", true),
  };
}

function assertFindingMatchesReview(
  finding: ReviewFinding,
  input: ReviewInput,
  attemptId: string,
  runId: string,
): void {
  if (finding.taskId !== input.taskId || finding.specRevision !== input.specRevision ||
      finding.candidateCommit !== input.candidateCommit || finding.reviewInputDigest !== input.reviewInputDigest ||
      finding.reviewAttemptId !== attemptId || finding.reviewRunId !== runId) {
    throw conflict("FINDING_REVIEW_MISMATCH", "Finding does not belong to the Review execution");
  }
}

function assertTrustedSelfReview(value: ImplementationSelfReview): void {
  if (!trustedSelfReviews.has(value) || !Object.isFrozen(value)) {
    throw validation("UNTRUSTED_SELF_REVIEW", "Self Review must come from its domain protocol");
  }
}

function assertTrustedReviewInput(value: ReviewInput): void {
  if (!trustedReviewInputs.has(value) || !Object.isFrozen(value)) {
    throw validation("UNTRUSTED_REVIEW_INPUT", "Review Input must come from its domain protocol");
  }
}

function assertTrustedFinding(value: ReviewFinding): void {
  if (!trustedFindings.has(value) || !Object.isFrozen(value)) {
    throw validation("UNTRUSTED_REVIEW_FINDING", "Review Finding must come from its domain protocol");
  }
  const { findingDigest, ...core } = value;
  if (findingDigest !== digest("review-finding-record", core)) {
    throw conflict("FINDING_INTEGRITY_FAILED", "Review Finding digest is stale");
  }
}

function assertTrustedReviewResult(value: ReviewResult): void {
  if (!trustedReviewResults.has(value) || !Object.isFrozen(value)) {
    throw validation("UNTRUSTED_REVIEW_RESULT", "Review Result must come from its domain protocol");
  }
  const { reviewResultDigest, ...core } = value;
  if (reviewResultDigest !== digest("review-result", core)) {
    throw conflict("REVIEW_RESULT_INTEGRITY_FAILED", "Review Result digest is stale");
  }
}

function checkedTaskId(value: string): string {
  assertTaskId(value);
  return value;
}

function roleAttemptId(value: unknown, taskId: string, role: "IMPLEMENTATION" | "REVIEW"): string {
  const text = requiredString(value, `${role}AttemptId`);
  const pattern = new RegExp(`^${escapeRegex(taskId)}/CORE-${role}/attempt-[0-9]{3,}$`);
  if (!pattern.test(text)) throw validation("INVALID_REVIEW_ATTEMPT", `${role} Attempt ID is not canonical`);
  return text;
}

function selfReviewVerdict(value: unknown): SelfReviewVerdict {
  if (value !== "READY_FOR_REVIEW" && value !== "CHANGES_REQUIRED") {
    throw validation("INVALID_SELF_REVIEW_VERDICT", `Invalid Self Review verdict: ${String(value)}`);
  }
  return value;
}

function reviewVerdict(value: unknown): ReviewVerdict {
  if (value !== "PASSED" && value !== "FINDINGS") {
    throw validation("INVALID_REVIEW_VERDICT", `Invalid Review verdict: ${String(value)}`);
  }
  return value;
}

function findingCategory(value: unknown): ReviewFindingCategory {
  if (!REVIEW_FINDING_CATEGORIES.includes(value as ReviewFindingCategory)) {
    throw validation("INVALID_FINDING_CATEGORY", `Invalid Finding category: ${String(value)}`);
  }
  return value as ReviewFindingCategory;
}

function findingSeverity(value: unknown): ReviewFindingSeverity {
  if (!REVIEW_FINDING_SEVERITIES.includes(value as ReviewFindingSeverity)) {
    throw validation("INVALID_FINDING_SEVERITY", `Invalid Finding severity: ${String(value)}`);
  }
  return value as ReviewFindingSeverity;
}

function readRecommendedAction(value: unknown): ReviewRecommendedAction {
  if (!REVIEW_RECOMMENDED_ACTIONS.includes(value as ReviewRecommendedAction)) {
    throw validation("INVALID_RECOMMENDED_ACTION", `Invalid recommended action: ${String(value)}`);
  }
  return value as ReviewRecommendedAction;
}

function errorCategory(value: unknown): MoyeErrorCategory {
  const values: readonly MoyeErrorCategory[] = [
    "VALIDATION", "CONFLICT", "NOT_FOUND", "TRANSIENT_IO", "UNKNOWN_SIDE_EFFECT", "TERMINAL",
  ];
  if (!values.includes(value as MoyeErrorCategory)) {
    throw validation("INVALID_REVIEW_ERROR_CATEGORY", `Invalid Review error category: ${String(value)}`);
  }
  return value as MoyeErrorCategory;
}

function normalizedRefs(value: readonly string[], field: string, required: boolean): readonly string[] {
  if (!Array.isArray(value)) throw validation("INVALID_REVIEW_REFS", `${field} must be an array`);
  const refs = value.map((item) => artifactRef(item, field));
  unique(refs, field);
  if (required && refs.length === 0) throw validation("REVIEW_REFS_REQUIRED", `${field} must not be empty`);
  return deepFreeze([...refs].sort());
}

function artifactRef(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/.test(text)) {
    throw validation("INVALID_REVIEW_REF", `${field} must be a stable URI reference`);
  }
  return text;
}

function gitObjectId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value)) {
    throw validation("INVALID_REVIEW_COMMIT", `${field} must be a full Git object ID`);
  }
  return value;
}

function shaDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw validation("INVALID_REVIEW_DIGEST", `${field} must be a SHA-256 digest`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw validation("INVALID_REVIEW_INTEGER", `${field} must be a positive integer`);
  }
  return value as number;
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(value)) {
    throw validation("INVALID_REVIEW_IDENTIFIER", `${field} must be an uppercase stable identifier`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw validation("INVALID_REVIEW_STRING", `${field} must be a non-empty NUL-free string`);
  }
  return value.trim();
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validation("INVALID_REVIEW_OBJECT", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw conflict("DUPLICATE_REVIEW_VALUE", `${label} values must be unique`);
}

function digest(namespace: string, value: unknown): string {
  return `sha256:${digestHex(namespace, value)}`;
}

function digestHex(namespace: string, value: unknown): string {
  return createHash("sha256").update(namespace).update("\0").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalize(object[key])]));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validation(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "VALIDATION", message });
}

function conflict(code: string, message: string): MoyeError {
  return new MoyeError({ code, category: "CONFLICT", message });
}
