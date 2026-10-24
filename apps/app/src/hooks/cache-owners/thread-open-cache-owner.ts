import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { ThreadResponse } from "@bb/server-contract";
import { getMediaQuerySnapshot } from "@bb/shared-ui/hooks/use-media-query";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  environmentQueryKey,
  environmentWorkStatusQueryKeyPrefix,
  threadConversationOutlineQueryKeyPrefix,
  threadDefaultExecutionOptionsQueryKey,
  threadDetailBootstrapQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadStorageLocationQueryKey,
  threadTabsQueryKey,
  threadTimelineQueryKey,
  threadTimelineQueryKeyPrefix,
} from "../queries/query-keys";

export const THREAD_OPEN_CACHE_GC_MS = 60 * 60_000;
export const THREAD_OPEN_CACHE_MAX_THREADS = 20;
export const COARSE_POINTER_THREAD_OPEN_CACHE_MAX_THREADS = 8;

interface RetainedQueryFilter {
  exact: boolean;
  queryKey: QueryKey;
}

const threadOpenCacheTouchesByClient = new WeakMap<QueryClient, Set<string>>();

function resolveThreadOpenCacheMaxThreads(): number {
  return getMediaQuerySnapshot(POINTER_COARSE_QUERY)
    ? COARSE_POINTER_THREAD_OPEN_CACHE_MAX_THREADS
    : THREAD_OPEN_CACHE_MAX_THREADS;
}

function threadOpenCacheQueryFilters(threadId: string): RetainedQueryFilter[] {
  return [
    { exact: true, queryKey: threadDetailBootstrapQueryKey(threadId) },
    { exact: false, queryKey: threadTimelineQueryKeyPrefix(threadId) },
    { exact: true, queryKey: threadQueryKey(threadId) },
    { exact: true, queryKey: threadPendingInteractionsQueryKey(threadId) },
    { exact: true, queryKey: threadDefaultExecutionOptionsQueryKey(threadId) },
    { exact: true, queryKey: threadQueuedMessagesQueryKey(threadId) },
    { exact: true, queryKey: threadPromptHistoryQueryKey(threadId) },
    { exact: true, queryKey: threadTabsQueryKey(threadId) },
    { exact: true, queryKey: threadStorageLocationQueryKey(threadId) },
    {
      exact: false,
      queryKey: threadConversationOutlineQueryKeyPrefix(threadId),
    },
  ];
}

function environmentOpenCacheQueryFilters(
  environmentId: string,
): RetainedQueryFilter[] {
  return [
    { exact: true, queryKey: environmentQueryKey(environmentId) },
    {
      exact: false,
      queryKey: environmentWorkStatusQueryKeyPrefix(environmentId),
    },
  ];
}

function cachedThreadEnvironmentId(
  queryClient: QueryClient,
  threadId: string,
): string | null {
  return (
    queryClient.getQueryData<ThreadResponse>(threadQueryKey(threadId))
      ?.environmentId ??
    queryClient.getQueryData<ThreadResponse>(
      threadDetailBootstrapQueryKey(threadId),
    )?.environmentId ??
    null
  );
}

function isThreadOpenCacheActive(
  queryClient: QueryClient,
  threadId: string,
): boolean {
  const queryCache = queryClient.getQueryCache();
  return (
    queryCache
      .find({ queryKey: threadTimelineQueryKey(threadId), exact: true })
      ?.isActive() === true ||
    queryCache
      .find({ queryKey: threadDetailBootstrapQueryKey(threadId), exact: true })
      ?.isActive() === true
  );
}

function removeInactiveQueries(
  queryClient: QueryClient,
  filters: readonly RetainedQueryFilter[],
): void {
  for (const filter of filters) {
    queryClient.removeQueries({ ...filter, type: "inactive" });
  }
}

function evictThreadOpenCache(
  queryClient: QueryClient,
  touched: Set<string>,
): void {
  const maxThreads = resolveThreadOpenCacheMaxThreads();
  for (const threadId of touched) {
    if (touched.size <= maxThreads) {
      return;
    }
    if (isThreadOpenCacheActive(queryClient, threadId)) {
      continue;
    }
    const environmentId = cachedThreadEnvironmentId(queryClient, threadId);
    removeInactiveQueries(queryClient, threadOpenCacheQueryFilters(threadId));
    touched.delete(threadId);
    if (
      environmentId !== null &&
      ![...touched].some(
        (retainedThreadId) =>
          cachedThreadEnvironmentId(queryClient, retainedThreadId) ===
          environmentId,
      )
    ) {
      removeInactiveQueries(
        queryClient,
        environmentOpenCacheQueryFilters(environmentId),
      );
    }
  }
}

export function touchThreadOpenCache(
  queryClient: QueryClient,
  threadId: string,
): void {
  let touched = threadOpenCacheTouchesByClient.get(queryClient);
  if (touched === undefined) {
    touched = new Set();
    threadOpenCacheTouchesByClient.set(queryClient, touched);
  }
  touched.delete(threadId);
  touched.add(threadId);
  evictThreadOpenCache(queryClient, touched);
}

export function forgetThreadOpenCache(
  queryClient: QueryClient,
  threadId: string,
): void {
  threadOpenCacheTouchesByClient.get(queryClient)?.delete(threadId);
  for (const filter of threadOpenCacheQueryFilters(threadId)) {
    queryClient.removeQueries(filter);
  }
}
