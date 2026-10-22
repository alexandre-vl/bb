import type { ThreadQueuedWork } from "@bb/domain";

export interface ThreadListIndicatorState {
  hasPendingInteraction: boolean;
  hasUnsubmittedDraft: boolean;
  hasUnreadError: boolean;
  hasUnreadSuccess: boolean;
  isBackgroundAgentActive: boolean;
  isBackgroundCommandActive: boolean;
  isGoalActive: boolean;
  isPlanModeActive: boolean;
  isRuntimeActive: boolean;
  isWorkflowActive: boolean;
  queuedWork: ThreadQueuedWork;
}

export type ThreadListIndicatorKind =
  | "waiting-for-input"
  | "unread-error"
  | "queued-failed"
  | "unread-success"
  | "plan-mode"
  | "goal"
  | "runtime"
  | "workflow"
  | "background-agent"
  | "background-command"
  | "working-draft"
  | "queued-waiting"
  | "draft"
  | "none";

export type ThreadListRung = 0 | 1 | 2 | 3 | 4 | 5;

export type ThreadAttention = "needs-you" | "failed" | "new";

export const THREAD_LIST_INDICATOR_PRECEDENCE = [
  "waiting-for-input",
  "unread-error",
  "queued-failed",
  "unread-success",
  "plan-mode",
  "goal",
  "runtime",
  "workflow",
  "background-agent",
  "background-command",
  "working-draft",
  "queued-waiting",
  "draft",
  "none",
] as const satisfies readonly ThreadListIndicatorKind[];

const THREAD_LIST_INDICATOR_RUNGS: Record<
  ThreadListIndicatorKind,
  ThreadListRung
> = {
  "waiting-for-input": 5,
  "unread-error": 4,
  "queued-failed": 4,
  "unread-success": 3,
  "plan-mode": 2,
  goal: 2,
  runtime: 2,
  workflow: 2,
  "background-agent": 2,
  "background-command": 2,
  "working-draft": 2,
  "queued-waiting": 1,
  draft: 1,
  none: 0,
};

const THREAD_LIST_INDICATOR_ORDER: ReadonlyMap<
  ThreadListIndicatorKind,
  number
> = new Map(
  THREAD_LIST_INDICATOR_PRECEDENCE.map((kind, index) => [kind, index]),
);

const THREAD_LIST_INDICATOR_LABELS: Record<
  Exclude<ThreadListIndicatorKind, "none">,
  string
> = {
  "waiting-for-input": "Thread needs user input",
  "unread-error": "Unread thread failed",
  "queued-failed": "Queued message failed to send",
  "unread-success": "Unread thread succeeded",
  "plan-mode": "Plan mode active",
  goal: "Goal active",
  runtime: "Thread working",
  workflow: "Workflow running",
  "background-agent": "Background agent running",
  "background-command": "Background command running",
  "working-draft": "Thread working with unsubmitted draft",
  "queued-waiting": "Thread has a message waiting to send",
  draft: "Thread has unsubmitted draft",
};

export function getThreadListIndicatorLabel(
  kind: ThreadListIndicatorKind,
): string | null {
  return kind === "none" ? null : THREAD_LIST_INDICATOR_LABELS[kind];
}

export function resolveThreadListIndicator(
  state: ThreadListIndicatorState,
): ThreadListIndicatorKind {
  if (state.hasPendingInteraction) return "waiting-for-input";
  if (state.hasUnreadError) return "unread-error";
  if (state.queuedWork === "failed") return "queued-failed";
  if (state.hasUnreadSuccess) return "unread-success";
  if (state.isPlanModeActive) return "plan-mode";
  if (state.isGoalActive) return "goal";
  if (state.isRuntimeActive) return "runtime";
  if (state.isWorkflowActive) return "workflow";
  if (state.isBackgroundAgentActive) return "background-agent";
  if (state.isBackgroundCommandActive) return "background-command";
  if (state.queuedWork === "waiting") return "queued-waiting";
  if (state.hasUnsubmittedDraft) return "draft";
  return "none";
}

export function threadListIndicatorRung(
  kind: ThreadListIndicatorKind,
): ThreadListRung {
  return THREAD_LIST_INDICATOR_RUNGS[kind] ?? 0;
}

export function threadListIndicatorAttention(
  kind: ThreadListIndicatorKind,
): ThreadAttention | null {
  switch (threadListIndicatorRung(kind)) {
    case 5:
      return "needs-you";
    case 4:
      return "failed";
    case 3:
      return "new";
    default:
      return null;
  }
}

function outranks(
  kind: ThreadListIndicatorKind,
  current: ThreadListIndicatorKind,
): boolean {
  const order = THREAD_LIST_INDICATOR_ORDER.get(kind);
  const currentOrder = THREAD_LIST_INDICATOR_ORDER.get(current);
  if (order === undefined || currentOrder === undefined) return false;
  const rung = threadListIndicatorRung(kind);
  const currentRung = threadListIndicatorRung(current);
  return rung > currentRung || (rung === currentRung && order < currentOrder);
}

export function rollUpThreadListIndicators(
  kinds: Iterable<ThreadListIndicatorKind>,
): ThreadListIndicatorKind {
  let highest: ThreadListIndicatorKind = "none";
  for (const kind of kinds) {
    if (outranks(kind, highest)) highest = kind;
  }
  return highest;
}
