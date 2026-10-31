import {
  didThreadDetailBootstrapRefreshAfterMount,
  useThread,
  useThreadDescendantReadStates,
  useThreadDetailBootstrap,
} from "@/hooks/queries/thread-queries";
import type { ThreadTimelineUnreadDividerAnchor } from "@/components/thread/timeline";
import { useMarkThreadRead } from "@/hooks/mutations/thread-state-mutations";
import { useThreadReadTracking } from "@/hooks/useThreadReadTracking";
import { useThreadUnreadDividerState } from "./useThreadUnreadDividerState";

export function useThreadDetailThread(
  threadId: string,
  trackRead: boolean,
  unreadDividerAnchor: ThreadTimelineUnreadDividerAnchor,
) {
  const threadDetailBootstrapQuery = useThreadDetailBootstrap(threadId);
  const hasThreadDetailBootstrapSettled =
    threadDetailBootstrapQuery.isSuccess || threadDetailBootstrapQuery.isError;
  const threadQuery = useThread(threadId, {
    enabled: hasThreadDetailBootstrapSettled,
    refetchOnMount: didThreadDetailBootstrapRefreshAfterMount(
      threadDetailBootstrapQuery,
    )
      ? false
      : "always",
  });
  const thread = threadQuery.data;
  const unreadDividerState = useThreadUnreadDividerState({
    anchor: unreadDividerAnchor,
    hasFreshThread:
      thread !== undefined &&
      !threadQuery.isPlaceholderData &&
      !threadQuery.isFetching &&
      !threadDetailBootstrapQuery.isFetching,
    routeThreadId: threadId,
    thread,
  });
  const readTrackedThread =
    trackRead && unreadDividerState.ready ? thread : undefined;
  const readTrackedDescendants = useThreadDescendantReadStates(
    readTrackedThread?.id,
  );
  useThreadReadTracking({
    markThreadRead: useMarkThreadRead(),
    thread: readTrackedThread,
    descendants: readTrackedDescendants,
  });
  return {
    hasThreadDetailBootstrapSettled,
    threadDetailBootstrapQuery,
    threadQuery,
    unreadDividerState,
  };
}
