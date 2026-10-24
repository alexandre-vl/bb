import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { ThreadWithRuntime } from "@bb/domain";
import { getThreadEntity } from "@/hooks/cache-owners/thread-entity-store";
import {
  threadDefaultExecutionOptionsQueryKey,
  threadDetailBootstrapQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadTimelineQueryKey,
} from "@/hooks/queries/query-keys";
import {
  liveSystemExecutionOptionsQueryOptions,
  resolveThreadComposerCatalogRouting,
  resolveThreadComposerEnvironmentHostId,
  systemProvidersQueryOptions,
} from "@/hooks/queries/system-queries";
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
  | "execution-defaults"
  | "provider-catalog"
  | "providers";

type ThreadComposerFacts = Pick<
  ThreadWithRuntime,
  "archivedAt" | "environmentId" | "providerId"
>;

function needsFirstFetch(
  queryClient: QueryClient,
  queryKey: QueryKey,
): boolean {
  const state = queryClient.getQueryState(queryKey);
  return state?.data === undefined && state?.fetchStatus !== "fetching";
}

function readThreadComposerFacts(
  queryClient: QueryClient,
  threadId: string,
): ThreadComposerFacts | null {
  const thread =
    queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(threadId)) ??
    queryClient.getQueryData<ThreadWithRuntime>(
      threadDetailBootstrapQueryKey(threadId),
    ) ??
    getThreadEntity(queryClient, threadId)?.thread;
  if (
    thread?.archivedAt === undefined ||
    thread.environmentId === undefined ||
    thread.providerId === undefined
  ) {
    return null;
  }
  return {
    archivedAt: thread.archivedAt,
    environmentId: thread.environmentId,
    providerId: thread.providerId,
  };
}

function prefetchThreadComposerCatalog(
  queryClient: QueryClient,
  threadId: string,
  thread: ThreadComposerFacts,
): ThreadOpenPrefetchTarget[] {
  const requested: ThreadOpenPrefetchTarget[] = [];
  const environmentId = thread.environmentId ?? undefined;
  if (thread.archivedAt === null) {
    const catalog = liveSystemExecutionOptionsQueryOptions({
      ...resolveThreadComposerCatalogRouting(queryClient, {
        environmentId,
        environmentHostId:
          environmentId === undefined
            ? undefined
            : resolveThreadComposerEnvironmentHostId(queryClient, {
                environmentId,
                threadId,
              }),
        providerId: thread.providerId,
      }),
      providerId: thread.providerId,
    });
    if (needsFirstFetch(queryClient, catalog.queryKey)) {
      requested.push("provider-catalog");
      void queryClient.prefetchQuery(catalog);
    }
  }
  const providers = systemProvidersQueryOptions(
    environmentId === undefined ? {} : { environmentId },
  );
  if (needsFirstFetch(queryClient, providers.queryKey)) {
    requested.push("providers");
    void queryClient.prefetchQuery(providers);
  }
  return requested;
}

export function prefetchThreadOpen(
  queryClient: QueryClient,
  threadId: string,
): ThreadOpenPrefetchTarget[] {
  const requested: ThreadOpenPrefetchTarget[] = [];
  const bootstrap = {
    ...threadDetailBootstrapQueryOptions(queryClient, threadId),
    gcTime: THREAD_PREFETCH_GC_MS,
  };
  if (needsFirstFetch(queryClient, threadDetailBootstrapQueryKey(threadId))) {
    requested.push("bootstrap");
    void queryClient.prefetchQuery(bootstrap);
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
  const thread = readThreadComposerFacts(queryClient, threadId);
  if (thread === null) {
    void queryClient.fetchQuery(bootstrap).then(
      () => {
        const fetched = readThreadComposerFacts(queryClient, threadId);
        if (fetched !== null) {
          prefetchThreadComposerCatalog(queryClient, threadId, fetched);
        }
      },
      () => undefined,
    );
  } else {
    requested.push(
      ...prefetchThreadComposerCatalog(queryClient, threadId, thread),
    );
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
