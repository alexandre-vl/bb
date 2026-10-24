import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { CONVERSATION_COLLAPSED_PANEL_SIZE_PERCENT } from "@/components/secondary-panel/secondaryPanelSizing";
import {
  getThreadConversationCollapsedAtom,
  secondaryPanelWidthPercentAtom,
} from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { ThreadTimelineLoadingSkeleton } from "@/components/thread/timeline/ThreadTimelineLoadingSkeleton";
import { RouteLoadingSkeleton } from "@/components/ui/route-loading-skeleton";
import { withLocalStorage } from "@/lib/browser-storage";
import {
  EMPTY_FIXED_PANEL_TABS_STATE,
  getFixedPanelTabsStateStorageKey,
  parseFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import { hasThreadId } from "@/lib/thread-id";

interface ThreadRouteLoadingSkeletonProps {
  isBoundedPane: boolean;
  threadId: string | undefined;
}

function readIsSecondaryPanelOpen(threadId: string): boolean {
  const storedValue = withLocalStorage(
    (storage) =>
      storage.getItem(getFixedPanelTabsStateStorageKey({ threadId })),
    null,
  );
  return parseFixedPanelTabsState({
    initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
    now: Date.now(),
    storedValue,
  }).secondary.isOpen;
}

export function ThreadRouteLoadingSkeleton({
  isBoundedPane,
  threadId,
}: ThreadRouteLoadingSkeletonProps) {
  const isCompactViewport = useIsCompactViewport();
  const isConversationCollapsed = useAtomValue(
    getThreadConversationCollapsedAtom(threadId),
  );
  const persistedWidthPercent = useAtomValue(secondaryPanelWidthPercentAtom);
  const isSecondaryPanelOpen = useMemo(
    () => hasThreadId(threadId) && readIsSecondaryPanelOpen(threadId),
    [threadId],
  );
  const showsInlineSecondaryPanel =
    isSecondaryPanelOpen && !isBoundedPane && !isCompactViewport;
  return (
    <RouteLoadingSkeleton
      isBoundedPane={isBoundedPane}
      secondaryPanelWidthPercent={
        !showsInlineSecondaryPanel
          ? undefined
          : isConversationCollapsed
            ? CONVERSATION_COLLAPSED_PANEL_SIZE_PERCENT
            : persistedWidthPercent
      }
    >
      <ThreadTimelineLoadingSkeleton />
    </RouteLoadingSkeleton>
  );
}
