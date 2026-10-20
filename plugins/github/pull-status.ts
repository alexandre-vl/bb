export type PullState = "open" | "draft" | "merged" | "closed";
export type PullChecksState =
  | "passing"
  | "failing"
  | "pending"
  | "no_checks"
  | "unknown";
export type PullReviewState =
  | "approved"
  | "changes_requested"
  | "review_requested"
  | "review_required"
  | "none";
export type PullMergeabilityState =
  | "conflicts"
  | "draft"
  | "mergeable"
  | "unknown";
export type PullAttention =
  | "merged"
  | "closed"
  | "conflicts"
  | "checks_failed"
  | "changes_requested"
  | "draft"
  | "queued"
  | "review_requested"
  | "checks_pending"
  | "ready_to_merge"
  | "none";

export interface PullStatus {
  state: PullState;
  baseRefName: string;
  headRefName: string;
  checks: {
    state: PullChecksState;
    passed: number;
    failed: number;
    pending: number;
  };
  review: { state: PullReviewState; requested: string[] };
  mergeability: PullMergeabilityState;
  attention: PullAttention;
}

export interface PullStateCount {
  state: string;
  count: number;
}

export interface RawPullStatus {
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  mergeable: string;
  reviewDecision: string | null;
  isInMergeQueue: boolean;
  requestedReviewers: string[];
  checkRunCounts: PullStateCount[];
  statusContextCounts: PullStateCount[];
}

const CHECK_RUN_PASSED = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const CHECK_RUN_FAILED = new Set([
  "FAILURE",
  "CANCELLED",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "STALE",
]);
const CHECK_RUN_PENDING = new Set([
  "QUEUED",
  "IN_PROGRESS",
  "PENDING",
  "WAITING",
  "REQUESTED",
]);
const STATUS_CONTEXT_FAILED = new Set(["FAILURE", "ERROR"]);
const STATUS_CONTEXT_PENDING = new Set(["PENDING", "EXPECTED"]);

function assembleChecks(raw: RawPullStatus): PullStatus["checks"] {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let unknown = 0;
  for (const { state, count } of raw.checkRunCounts) {
    if (CHECK_RUN_PASSED.has(state)) passed += count;
    else if (CHECK_RUN_FAILED.has(state)) failed += count;
    else if (CHECK_RUN_PENDING.has(state)) pending += count;
    else unknown += count;
  }
  for (const { state, count } of raw.statusContextCounts) {
    if (state === "SUCCESS") passed += count;
    else if (STATUS_CONTEXT_FAILED.has(state)) failed += count;
    else if (STATUS_CONTEXT_PENDING.has(state)) pending += count;
    else unknown += count;
  }
  let state: PullChecksState;
  if (passed + failed + pending + unknown === 0) state = "no_checks";
  else if (failed > 0) state = "failing";
  else if (pending > 0) state = "pending";
  else if (unknown > 0) state = "unknown";
  else state = "passing";
  return { state, passed, failed, pending };
}

function assembleReview(raw: RawPullStatus): PullStatus["review"] {
  const requested = raw.requestedReviewers.length > 0;
  let state: PullReviewState;
  switch (raw.reviewDecision) {
    case "APPROVED":
      state = "approved";
      break;
    case "CHANGES_REQUESTED":
      state = "changes_requested";
      break;
    case "REVIEW_REQUIRED":
      state = requested ? "review_requested" : "review_required";
      break;
    default:
      state = requested ? "review_requested" : "none";
  }
  return { state, requested: raw.requestedReviewers };
}

function assembleMergeability(raw: RawPullStatus): PullMergeabilityState {
  if (raw.mergeable === "CONFLICTING") return "conflicts";
  if (raw.state === "OPEN" && raw.isDraft) return "draft";
  if (raw.mergeable === "MERGEABLE") return "mergeable";
  return "unknown";
}

function assembleAttention(
  state: PullState,
  checks: PullStatus["checks"],
  review: PullStatus["review"],
  mergeability: PullStatus["mergeability"],
  inMergeQueue: boolean,
): PullAttention {
  if (state === "merged") return "merged";
  if (state === "closed") return "closed";
  if (mergeability === "conflicts") return "conflicts";
  if (checks.state === "failing") return "checks_failed";
  if (review.state === "changes_requested") return "changes_requested";
  if (state === "draft") return "draft";
  if (inMergeQueue) return "queued";
  if (
    review.state === "review_requested" ||
    review.state === "review_required"
  ) {
    return "review_requested";
  }
  if (checks.state === "pending") return "checks_pending";
  if (mergeability === "mergeable" && checks.state === "passing") {
    return "ready_to_merge";
  }
  return "none";
}

export function assemblePullStatus(raw: RawPullStatus): PullStatus {
  const state: PullState =
    raw.state === "MERGED"
      ? "merged"
      : raw.state === "CLOSED"
        ? "closed"
        : raw.isDraft
          ? "draft"
          : "open";
  const checks = assembleChecks(raw);
  const review = assembleReview(raw);
  const mergeability = assembleMergeability(raw);
  return {
    state,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    checks,
    review,
    mergeability,
    attention: assembleAttention(
      state,
      checks,
      review,
      mergeability,
      raw.isInMergeQueue,
    ),
  };
}

export type PullGroup =
  | "you"
  | "ready"
  | "fixing"
  | "progress"
  | "review"
  | "open"
  | "draft"
  | "merged"
  | "closed";

export const PULL_GROUPS: ReadonlyArray<{ id: PullGroup; label: string }> = [
  { id: "you", label: "Your move" },
  { id: "ready", label: "Ready to merge" },
  { id: "fixing", label: "Needs fixing" },
  { id: "progress", label: "In progress" },
  { id: "review", label: "Waiting for review" },
  { id: "open", label: "Open" },
  { id: "draft", label: "Drafts" },
  { id: "merged", label: "Merged" },
  { id: "closed", label: "Closed" },
];

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function isViewerReviewRequested(
  status: PullStatus,
  viewer: string | null,
): boolean {
  return (
    viewer !== null &&
    status.state === "open" &&
    status.review.requested.some((login) => sameLogin(login, viewer))
  );
}

export function pullGroup(
  status: PullStatus,
  author: string,
  viewer: string | null,
): PullGroup {
  if (status.attention === "merged") return "merged";
  if (status.attention === "closed") return "closed";
  if (isViewerReviewRequested(status, viewer)) return "you";
  if (
    status.attention === "changes_requested" &&
    viewer !== null &&
    sameLogin(author, viewer)
  ) {
    return "you";
  }
  switch (status.attention) {
    case "ready_to_merge":
      return "ready";
    case "conflicts":
    case "checks_failed":
    case "changes_requested":
      return "fixing";
    case "checks_pending":
    case "queued":
      return "progress";
    case "review_requested":
      return "review";
    case "draft":
      return "draft";
    case "none":
      return "open";
  }
}

export type PullTone = "action" | "ready" | "merged" | "you" | "waiting";

export interface PullGlyph {
  icon: string;
  tone: PullTone;
  label: string;
}

export function pullGlyph(status: PullStatus, group: PullGroup): PullGlyph {
  if (group === "you") {
    return status.attention === "changes_requested"
      ? { icon: "AlertCircle", tone: "action", label: "Changes requested" }
      : { icon: "Eye", tone: "you", label: "Your review is requested" };
  }
  switch (status.attention) {
    case "ready_to_merge":
      return { icon: "CircleCheck", tone: "ready", label: "Ready to merge" };
    case "checks_failed":
      return { icon: "CircleX", tone: "action", label: "Checks failing" };
    case "conflicts":
      return { icon: "AlertCircle", tone: "action", label: "Conflicts" };
    case "changes_requested":
      return {
        icon: "AlertCircle",
        tone: "action",
        label: "Changes requested",
      };
    case "checks_pending":
      return { icon: "Clock", tone: "waiting", label: "Checks running" };
    case "queued":
      return { icon: "Clock", tone: "waiting", label: "Queued to merge" };
    case "review_requested":
      return { icon: "Eye", tone: "waiting", label: "Waiting for review" };
    case "draft":
      return { icon: "GitPullRequestDraft", tone: "waiting", label: "Draft" };
    case "merged":
      return { icon: "GitMerge", tone: "merged", label: "Merged" };
    case "closed":
      return {
        icon: "GitPullRequestClosed",
        tone: "waiting",
        label: "Closed",
      };
    case "none":
      return { icon: "GitPullRequest", tone: "waiting", label: "Open" };
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function checksSummary(checks: PullStatus["checks"]): string {
  switch (checks.state) {
    case "passing":
      return `${plural(checks.passed, "check")} passed`;
    case "failing":
      return `${plural(checks.failed, "check")} failing`;
    case "pending":
      return `Checks running · ${checks.passed} of ${checks.passed + checks.pending} done`;
    case "no_checks":
      return "No checks";
    case "unknown":
      return "Checks unknown";
  }
}

export function pullNextStep(status: PullStatus, group: PullGroup): string {
  if (group === "you" && status.attention !== "changes_requested") {
    return "Your review is requested";
  }
  switch (status.attention) {
    case "merged":
      return `Merged into ${status.baseRefName}`;
    case "closed":
      return "Closed without merging";
    case "conflicts":
      return `Conflicts with ${status.baseRefName}`;
    case "checks_failed":
      return checksSummary(status.checks);
    case "changes_requested":
      return "Changes requested";
    case "checks_pending":
      return checksSummary(status.checks);
    case "queued":
      return "Queued to merge";
    case "review_requested":
      return status.review.state === "review_required"
        ? "Review required"
        : "Review requested";
    case "ready_to_merge":
    case "draft":
    case "none":
      return checksSummary(status.checks);
  }
}

export interface StackPull {
  repo: string;
  number: number;
  pr: PullStatus;
}

export function stackNotes(pulls: readonly StackPull[]): Map<string, string> {
  const open = pulls.filter(
    (pull) => pull.pr.state === "open" || pull.pr.state === "draft",
  );
  const byHead = new Map<string, StackPull>();
  for (const pull of open) {
    byHead.set(`${pull.repo}:${pull.pr.headRefName}`, pull);
  }
  const notes = new Map<string, string>();
  for (const pull of open) {
    const below = byHead.get(`${pull.repo}:${pull.pr.baseRefName}`);
    const key = `${pull.repo}#${pull.number}`;
    if (below !== undefined && below.number !== pull.number) {
      notes.set(key, `stacked on #${below.number}`);
      continue;
    }
    const above = open.find(
      (other) =>
        other.repo === pull.repo &&
        other.number !== pull.number &&
        other.pr.baseRefName === pull.pr.headRefName,
    );
    if (above !== undefined) notes.set(key, `has #${above.number} on top`);
  }
  return notes;
}

export type PullStateTarget = "open" | "draft" | "closed";

export interface PullStateView {
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
}

export function pullStateCommands(
  current: PullStateView,
  target: PullStateTarget,
): Array<[verb: string, ...flags: string[]]> {
  if (current.state === "MERGED") {
    throw new Error("A merged pull request keeps its state.");
  }
  if (target === "closed") {
    return current.state === "CLOSED" ? [] : [["close"]];
  }
  const commands: Array<[verb: string, ...flags: string[]]> =
    current.state === "CLOSED" ? [["reopen"]] : [];
  if (target === "open" && current.isDraft) commands.push(["ready"]);
  if (target === "draft" && !current.isDraft) {
    commands.push(["ready", "--undo"]);
  }
  return commands;
}
