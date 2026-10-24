import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  threadDefaultExecutionOptionsQueryKey,
  threadDetailBootstrapQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueuedMessagesQueryKey,
  threadTimelineQueryKey,
} from "@/hooks/queries/query-keys";
import { threadDefaultExecutionOptionsQueryOptions } from "@/hooks/queries/thread-default-execution-options-query";
import {
  threadQueuedMessagesQueryOptions,
  threadTimelineQueryOptions,
} from "@/hooks/queries/thread-panel-queries";
import {
  threadDetailBootstrapQueryOptions,
  threadPendingInteractionsQueryOptions,
} from "@/hooks/queries/thread-queries";
import { LazyThreadDetailView } from "@/views/thread-detail/LazyThreadDetailView";
import { markThreadOpenPrefetch } from "./perf-trace";
import type { ThreadLinkIntent } from "./thread-link-intent";

const THREAD_PREFETCH_GC_MS = 5 * 60_000;

type ThreadOpenPrefetchTarget =
  | "bootstrap"
  | "timeline"
  | "interactions"
  | "queued-messages"
  | "execution-defaults";

function needsFirstFetch(
  queryClient: QueryClient,
  queryKey: QueryKey,
): boolean {
  const state = queryClient.getQueryState(queryKey);
  return state?.data === undefined && state?.fetchStatus !== "fetching";
}

export function prefetchThreadOpen(
  queryClient: QueryClient,
  threadId: string,
): ThreadOpenPrefetchTarget[] {
  const requested: ThreadOpenPrefetchTarget[] = [];
  if (needsFirstFetch(queryClient, threadDetailBootstrapQueryKey(threadId))) {
    requested.push("bootstrap");
    void queryClient.prefetchQuery({
      ...threadDetailBootstrapQueryOptions(queryClient, threadId),
      gcTime: THREAD_PREFETCH_GC_MS,
    });
  }
  const timeline = queryClient.getQueryState(threadTimelineQueryKey(threadId));
  if (
    timeline?.fetchStatus !== "fetching" &&
    (timeline?.data === undefined || timeline.isInvalidated)
  ) {
    requested.push("timeline");
    void queryClient.prefetchQuery({
      ...threadTimelineQueryOptions(queryClient, threadId),
      gcTime: THREAD_PREFETCH_GC_MS,
    });
  }
  if (
    needsFirstFetch(queryClient, threadPendingInteractionsQueryKey(threadId))
  ) {
    requested.push("interactions");
    void queryClient.prefetchQuery({
      ...threadPendingInteractionsQueryOptions(threadId),
      gcTime: THREAD_PREFETCH_GC_MS,
      staleTime: Infinity,
    });
  }
  if (needsFirstFetch(queryClient, threadQueuedMessagesQueryKey(threadId))) {
    requested.push("queued-messages");
    void queryClient.prefetchQuery({
      ...threadQueuedMessagesQueryOptions(threadId),
      gcTime: THREAD_PREFETCH_GC_MS,
      staleTime: Infinity,
    });
  }
  if (
    needsFirstFetch(
      queryClient,
      threadDefaultExecutionOptionsQueryKey(threadId),
    )
  ) {
    requested.push("execution-defaults");
    void queryClient.prefetchQuery({
      ...threadDefaultExecutionOptionsQueryOptions(threadId),
      gcTime: THREAD_PREFETCH_GC_MS,
      staleTime: Infinity,
    });
  }
  void LazyThreadDetailView.preload();
  return requested;
}

export function prefetchThreadOpenOnIntent(
  queryClient: QueryClient,
  intent: ThreadLinkIntent,
): void {
  const requested = prefetchThreadOpen(queryClient, intent.threadId);
  if (requested.length > 0) {
    markThreadOpenPrefetch({
      input: intent.input,
      requested: requested.join(","),
      threadId: intent.threadId,
    });
  }
}
