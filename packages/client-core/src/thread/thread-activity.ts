import { assertNever } from "@bb/core-ui";
import type { Thread, ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import { isRunningThreadRuntimeDisplayStatus } from "../timeline/thread-runtime-status.js";
import type { ThreadListIndicatorState } from "./thread-list-indicator.js";
import { isThreadRead } from "./thread-read-state.js";

type ThreadStatusShape = Pick<
  Thread,
  "status" | "lastReadAt" | "latestAttentionAt"
>;

type ThreadRuntimeShape = Pick<ThreadWithRuntime, "runtime">;
type ThreadActivityStateShape = Pick<ThreadListEntry, "activity">;
type ThreadHostWorkShape = ThreadRuntimeShape & ThreadActivityStateShape;

function isRuntimeBusyThread(thread: ThreadRuntimeShape): boolean {
  return isRunningThreadRuntimeDisplayStatus(thread.runtime.displayStatus);
}

function hasActiveWorkflowActivity(thread: ThreadHostWorkShape): boolean {
  return (
    !thread.runtime.hostUnavailable && thread.activity.activeWorkflowCount > 0
  );
}

function hasActiveBackgroundAgentActivity(
  thread: ThreadHostWorkShape,
): boolean {
  return (
    !thread.runtime.hostUnavailable &&
    thread.activity.activeBackgroundAgentCount > 0
  );
}

function hasActiveBackgroundCommandActivity(
  thread: ThreadHostWorkShape,
): boolean {
  return (
    !thread.runtime.hostUnavailable &&
    thread.activity.activeBackgroundCommandCount > 0
  );
}

function hasBackgroundTaskActivity(thread: ThreadActivityStateShape): boolean {
  return (
    thread.activity.activeWorkflowCount > 0 ||
    thread.activity.activeBackgroundAgentCount > 0 ||
    thread.activity.activeBackgroundCommandCount > 0
  );
}

function isWaitingForHostThread(thread: ThreadHostWorkShape): boolean {
  return (
    thread.runtime.displayStatus === "waiting-for-host" ||
    (thread.runtime.hostUnavailable && hasBackgroundTaskActivity(thread))
  );
}

function hasActivePlanModeActivity(thread: ThreadActivityStateShape): boolean {
  return thread.activity.activePlanModeCount > 0;
}

function hasActiveGoalActivity(thread: ThreadActivityStateShape): boolean {
  return thread.activity.activeGoalCount > 0;
}

export function threadListIndicatorStateForThread(
  thread: ThreadListEntry,
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
    isWaitingForHost: isWaitingForHostThread(thread),
    isWorkflowActive: hasActiveWorkflowActivity(thread),
  };
}

export function isUnreadDoneThread(thread: ThreadStatusShape): boolean {
  switch (thread.status) {
    case "error":
    case "idle":
      return !isThreadRead(thread);
    case "active":
    case "starting":
    case "stopping":
    case "pending":
      return false;
    default:
      return assertNever(thread.status);
  }
}
