import { isCancelledError, type QueryClient } from "@tanstack/react-query";

export type PerfTraceDetail = Record<string, number | string | boolean | null>;

export type StreamTraceMarkName =
  | "bb:timeline-applied"
  | "bb:stream-row-commit";

export const THREAD_OPEN_MILESTONES = [
  "route",
  "thread",
  "bootstrap",
  "environment",
  "interactions",
  "work-status",
  "execution-defaults",
  "queued-messages",
  "timeline-skeleton",
  "timeline",
  "timeline-rows",
] as const;

export type ThreadOpenMilestone = (typeof THREAD_OPEN_MILESTONES)[number];

export const QUERY_TRACE_MEASURE_NAME = "bb:query";
export const THREAD_OPEN_INTENT_MARK_NAME = "bb:thread-open:intent";
export const THREAD_OPEN_PREFETCH_MARK_NAME = "bb:thread-open:prefetch";
const QUERY_KEY_DETAIL_MAX_LENGTH = 200;

let perfTraceEnabled = false;

export function setPerfTraceEnabled(enabled: boolean): void {
  perfTraceEnabled = enabled;
}

export function isPerfTraceEnabled(): boolean {
  return perfTraceEnabled;
}

export function markStreamTrace(
  name: StreamTraceMarkName,
  detail: PerfTraceDetail,
): void {
  if (perfTraceEnabled) {
    performance.mark(name, { detail });
  }
}

export function threadOpenMilestoneMarkName(
  milestone: ThreadOpenMilestone,
): `bb:thread-open:${ThreadOpenMilestone}` {
  return `bb:thread-open:${milestone}`;
}

export function markThreadOpenMilestone(
  milestone: ThreadOpenMilestone,
  detail: PerfTraceDetail,
): void {
  if (perfTraceEnabled) {
    performance.mark(threadOpenMilestoneMarkName(milestone), { detail });
  }
}

export function markThreadOpenIntent(detail: PerfTraceDetail): void {
  if (perfTraceEnabled) {
    performance.mark(THREAD_OPEN_INTENT_MARK_NAME, { detail });
  }
}

export function markThreadOpenPrefetch(detail: PerfTraceDetail): void {
  if (perfTraceEnabled) {
    performance.mark(THREAD_OPEN_PREFETCH_MARK_NAME, { detail });
  }
}

function describeQueryKey(queryKey: readonly unknown[]): string {
  const description = JSON.stringify(queryKey);
  return description.length > QUERY_KEY_DETAIL_MAX_LENGTH
    ? `${description.slice(0, QUERY_KEY_DETAIL_MAX_LENGTH)}…`
    : description;
}

interface QueryFetchStart {
  initial: boolean;
  startedAt: number;
}

type QueryTraceOutcome = "success" | "error" | "cancelled";

export function installQueryPerfTrace(queryClient: QueryClient): () => void {
  const fetchStarts = new Map<string, QueryFetchStart>();
  return queryClient.getQueryCache().subscribe((event) => {
    if (!perfTraceEnabled) {
      fetchStarts.clear();
      return;
    }
    const queryHash = event.query.queryHash;
    if (event.type === "removed") {
      fetchStarts.delete(queryHash);
      return;
    }
    if (event.type !== "updated") {
      return;
    }
    const { action, query } = event;
    if (action.type === "fetch") {
      fetchStarts.set(queryHash, {
        initial: query.state.data === undefined,
        startedAt: performance.now(),
      });
      return;
    }
    let outcome: QueryTraceOutcome;
    if (action.type === "success" && !action.manual) {
      outcome = "success";
    } else if (action.type === "error") {
      outcome = isCancelledError(action.error) ? "cancelled" : "error";
    } else if (
      action.type === "setState" &&
      query.state.fetchStatus === "idle"
    ) {
      outcome = "cancelled";
    } else {
      return;
    }
    const fetchStart = fetchStarts.get(queryHash);
    if (fetchStart === undefined) {
      return;
    }
    fetchStarts.delete(queryHash);
    performance.measure(QUERY_TRACE_MEASURE_NAME, {
      start: fetchStart.startedAt,
      end: performance.now(),
      detail: {
        initial: fetchStart.initial,
        key: describeQueryKey(query.queryKey),
        observers: query.getObserversCount(),
        outcome,
      } satisfies PerfTraceDetail,
    });
  });
}
