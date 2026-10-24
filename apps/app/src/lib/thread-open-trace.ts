import { useLayoutEffect, useRef } from "react";
import {
  isPerfTraceEnabled,
  markThreadOpenIntent,
  markThreadOpenMilestone,
  THREAD_OPEN_MILESTONES,
  type ThreadOpenMilestone,
} from "./perf-trace";
import type { ThreadLinkIntent } from "./thread-link-intent";

export type ThreadOpenMilestoneReadiness = Partial<
  Record<ThreadOpenMilestone, boolean>
>;

interface EmittedThreadOpenMilestones {
  milestones: Set<ThreadOpenMilestone>;
  threadId: string;
}

export function useThreadOpenTraceMilestones(
  threadId: string,
  readiness: ThreadOpenMilestoneReadiness,
): void {
  const emittedRef = useRef<EmittedThreadOpenMilestones | null>(null);
  useLayoutEffect(() => {
    if (!isPerfTraceEnabled()) {
      return;
    }
    let emitted = emittedRef.current;
    if (emitted === null || emitted.threadId !== threadId) {
      emitted = { milestones: new Set(), threadId };
      emittedRef.current = emitted;
    }
    for (const milestone of THREAD_OPEN_MILESTONES) {
      if (readiness[milestone] === true && !emitted.milestones.has(milestone)) {
        emitted.milestones.add(milestone);
        markThreadOpenMilestone(milestone, { threadId });
      }
    }
  });
}

export function traceThreadOpenIntent(intent: ThreadLinkIntent): void {
  if (intent.input === "press" || intent.input === "click") {
    markThreadOpenIntent({ input: intent.input, threadId: intent.threadId });
  }
}
