import {
  experimental_resolveThreadListIndicator,
  experimental_rollUpThreadIndicators,
  experimental_threadIndicatorRung,
  type ExperimentalThreadIndicatorRung,
  type ExperimentalThreadListIndicatorState,
  type PluginSidebarThread,
  type PluginSidebarThreadIndicator,
  type PluginSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";

type ThreadStatusShape = Pick<PluginSidebarThread, "status" | "isUnread">;
type ThreadRuntimeShape = Pick<PluginSidebarThread, "runtimeStatus">;
type ThreadActivityStateShape = Pick<PluginSidebarThread, "activity">;

const RUNNING_RUNTIME_STATUSES: Record<
  PluginSidebarThread["runtimeStatus"],
  boolean
> = {
  active: true,
  provisioning: true,
  starting: true,
  stopping: true,
  error: false,
  idle: false,
  pending: false,
  "waiting-for-host": false,
};

const DONE_THREAD_STATUSES: Record<PluginSidebarThread["status"], boolean> = {
  error: true,
  idle: true,
  active: false,
  starting: false,
  stopping: false,
  pending: false,
};

export function isRuntimeBusyThread(thread: ThreadRuntimeShape): boolean {
  return RUNNING_RUNTIME_STATUSES[thread.runtimeStatus] ?? false;
}

function hasActiveWorkflowActivity(thread: ThreadActivityStateShape): boolean {
  return thread.activity.workflows > 0;
}

function hasActiveBackgroundAgentActivity(
  thread: ThreadActivityStateShape,
): boolean {
  return thread.activity.backgroundAgents > 0;
}

function hasActiveBackgroundCommandActivity(
  thread: ThreadActivityStateShape,
): boolean {
  return thread.activity.backgroundCommands > 0;
}

function hasActivePlanModeActivity(thread: ThreadActivityStateShape): boolean {
  return thread.activity.planMode > 0;
}

function hasActiveGoalActivity(thread: ThreadActivityStateShape): boolean {
  return thread.activity.goals > 0;
}

export type ThreadListIndicatorState = ExperimentalThreadListIndicatorState;

export type ThreadListIndicatorKind = PluginSidebarThreadIndicator;

export type ThreadListRung = ExperimentalThreadIndicatorRung;

export const NEEDS_YOU_RUNG: ThreadListRung = 5;
export const FAILED_RUNG: ThreadListRung = 4;
export const NEW_RUNG: ThreadListRung = 3;
export const WORKING_RUNG: ThreadListRung = 2;
export const ATTENTION_RUNG: ThreadListRung = NEW_RUNG;

export function threadListIndicatorRung(
  kind: ThreadListIndicatorKind,
): ThreadListRung {
  return experimental_threadIndicatorRung(kind);
}

export function rollUpThreadListIndicators(
  kinds: Iterable<ThreadListIndicatorKind>,
): ThreadListIndicatorKind {
  return experimental_rollUpThreadIndicators(kinds);
}

const THREAD_LIST_INDICATOR_LABELS: Record<
  Exclude<ThreadListIndicatorKind, "none">,
  string
> = {
  "unread-error": "Unread thread failed",
  "waiting-for-input": "Thread needs user input",
  "working-draft": "Thread working with unsubmitted draft",
  workflow: "Workflow running",
  "background-agent": "Background agent running",
  "background-command": "Background command running",
  "plan-mode": "Plan mode active",
  goal: "Goal active",
  runtime: "Thread working",
  "queued-failed": "Queued message failed to send",
  "queued-waiting": "Thread has a message waiting to send",
  draft: "Thread has unsubmitted draft",
  "unread-success": "Unread thread succeeded",
};

export function getThreadListIndicatorLabel(
  kind: ThreadListIndicatorKind,
): string | null {
  return kind === "none" ? null : THREAD_LIST_INDICATOR_LABELS[kind];
}

const THREAD_LIST_STATE_TEXT: Record<ThreadListIndicatorKind, string | null> =
  {
    "waiting-for-input": "needs your input",
    "unread-error": "failed",
    "queued-failed": "message failed to send",
    "unread-success": "new result",
    "plan-mode": "planning",
    goal: "working toward a goal",
    runtime: "working",
    workflow: "running a workflow",
    "background-agent": "running a background agent",
    "background-command": "running a background command",
    "working-draft": "working",
    "queued-waiting": "queued message",
    draft: "unsent draft",
    none: null,
  };

export function getThreadListStateText(
  kind: ThreadListIndicatorKind,
): string | null {
  return THREAD_LIST_STATE_TEXT[kind] ?? null;
}

interface ThreadStatusResolution {
  accessibleLabel: string | null;
  indicatorKind: ThreadListIndicatorKind;
  rowStatusIsVisible: boolean;
}

export function isRowStatusVisibleOver(kind: ThreadListIndicatorKind): boolean {
  return threadListIndicatorRung(kind) <= 1;
}

export function resolveThreadStatus(
  state: ThreadListIndicatorState,
  rowStatus: PluginSidebarThreadRowStatus | null,
): ThreadStatusResolution {
  const indicatorKind = resolveThreadListIndicator(state);
  return resolveThreadKindStatus(indicatorKind, rowStatus);
}

export function resolveThreadKindStatus(
  indicatorKind: ThreadListIndicatorKind,
  rowStatus: PluginSidebarThreadRowStatus | null,
): ThreadStatusResolution {
  const rowStatusIsVisible =
    rowStatus !== null && isRowStatusVisibleOver(indicatorKind);
  return {
    accessibleLabel: rowStatusIsVisible
      ? rowStatus.label
      : getThreadListIndicatorLabel(indicatorKind),
    indicatorKind,
    rowStatusIsVisible,
  };
}

export function hasThreadListWorkingActivity(
  state: ThreadListIndicatorState,
  hasRunningPluginStatus = false,
): boolean {
  return (
    state.isRuntimeActive ||
    state.isWorkflowActive ||
    state.isBackgroundAgentActive ||
    state.isBackgroundCommandActive ||
    state.isPlanModeActive ||
    state.isGoalActive ||
    hasRunningPluginStatus
  );
}

type ThreadIndicatorShape = ThreadStatusShape &
  ThreadRuntimeShape &
  ThreadActivityStateShape &
  Pick<PluginSidebarThread, "hasPendingInteraction" | "queuedWork">;

export function threadListIndicatorStateForThread(
  thread: ThreadIndicatorShape,
  hasUnsubmittedDraft: boolean,
): ThreadListIndicatorState {
  const unreadDone = isUnreadDoneThread(thread);
  return {
    hasPendingInteraction: thread.hasPendingInteraction,
    hasUnsubmittedDraft,
    hasUnreadError: unreadDone && thread.status === "error",
    hasUnreadSuccess: unreadDone && thread.status !== "error",
    isBackgroundAgentActive: hasActiveBackgroundAgentActivity(thread),
    isBackgroundCommandActive: hasActiveBackgroundCommandActivity(thread),
    isGoalActive: hasActiveGoalActivity(thread),
    queuedWork: thread.queuedWork,
    isPlanModeActive: hasActivePlanModeActivity(thread),
    isRuntimeActive: isRuntimeBusyThread(thread),
    isWorkflowActive: hasActiveWorkflowActivity(thread),
  };
}

export function resolveThreadListIndicator(
  state: ThreadListIndicatorState,
): ThreadListIndicatorKind {
  return experimental_resolveThreadListIndicator(state);
}

export function threadIndicatorKind(
  thread: ThreadIndicatorShape,
  hasUnsubmittedDraft = false,
): ThreadListIndicatorKind {
  return resolveThreadListIndicator(
    threadListIndicatorStateForThread(thread, hasUnsubmittedDraft),
  );
}

export function threadAttentionRung(
  thread: ThreadIndicatorShape,
): ThreadListRung {
  const rung = threadListIndicatorRung(threadIndicatorKind(thread));
  return rung >= ATTENTION_RUNG ? rung : 0;
}

export interface ThreadStateCounts {
  needsYou: number;
  failed: number;
  fresh: number;
  working: number;
  queued: number;
}

export interface ThreadRollup {
  threadIds: readonly string[];
  kind: ThreadListIndicatorKind;
  counts: ThreadStateCounts;
}

const NO_THREAD_STATE_COUNTS: ThreadStateCounts = {
  needsYou: 0,
  failed: 0,
  fresh: 0,
  working: 0,
  queued: 0,
};

export const EMPTY_THREAD_ROLLUP: ThreadRollup = {
  threadIds: [],
  kind: "none",
  counts: NO_THREAD_STATE_COUNTS,
};

function countThreadKind(
  counts: ThreadStateCounts,
  kind: ThreadListIndicatorKind,
): void {
  switch (threadListIndicatorRung(kind)) {
    case 5:
      counts.needsYou += 1;
      return;
    case 4:
      counts.failed += 1;
      return;
    case 3:
      counts.fresh += 1;
      return;
    case 2:
      counts.working += 1;
      return;
    case 1:
      counts.queued += 1;
      return;
    case 0:
      return;
  }
}

export function rollUpThreads(
  threads: readonly (ThreadIndicatorShape & Pick<PluginSidebarThread, "id">)[],
): ThreadRollup {
  if (threads.length === 0) return EMPTY_THREAD_ROLLUP;
  const counts = { ...NO_THREAD_STATE_COUNTS };
  const threadIds: string[] = [];
  const kinds: ThreadListIndicatorKind[] = [];
  for (const thread of threads) {
    threadIds.push(thread.id);
    const threadKind = threadIndicatorKind(thread);
    countThreadKind(counts, threadKind);
    kinds.push(threadKind);
  }
  return { threadIds, kind: rollUpThreadListIndicators(kinds), counts };
}

export function rollUpWithDraft(
  rollup: ThreadRollup,
  hasUnsubmittedDraft: boolean,
): ThreadListIndicatorKind {
  return hasUnsubmittedDraft && threadListIndicatorRung(rollup.kind) < 1
    ? "draft"
    : rollup.kind;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function describeThreadStateCounts(counts: ThreadStateCounts): string {
  const parts: string[] = [];
  if (counts.needsYou > 0) {
    parts.push(
      pluralize(counts.needsYou, "needs your input", "need your input"),
    );
  }
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (counts.fresh > 0) {
    parts.push(pluralize(counts.fresh, "new result", "new results"));
  }
  if (counts.working > 0) parts.push(`${counts.working} working`);
  if (counts.queued > 0) {
    parts.push(pluralize(counts.queued, "queued", "queued"));
  }
  return parts.join(", ");
}

export function describeThreadRollup(
  rollup: ThreadRollup,
  singular: string,
  plural: string,
): string {
  const total = pluralize(rollup.threadIds.length, singular, plural);
  const detail = describeThreadStateCounts(rollup.counts);
  return detail ? `${total}: ${detail}` : total;
}

export function isUnreadDoneThread(thread: ThreadStatusShape): boolean {
  return (DONE_THREAD_STATUSES[thread.status] ?? false) && thread.isUnread;
}
