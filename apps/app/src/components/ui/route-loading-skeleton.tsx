import {
  AppPageHeader,
  HEADER_SEAM_CLASS,
} from "@/components/layout/AppPageHeader";
import { SecondaryPanelContentSkeleton } from "@/components/secondary-panel/SecondaryPanelContentSkeleton";
import { useOptionalIsSidebarShowing } from "@/components/ui/sidebar.js";
import { CHROME_ROW_CLASS, CHROME_ROW_HEIGHT_CLASS } from "@/lib/bb-desktop";
import { PANE_MIN_WIDTH_PX } from "@/lib/split-layout/sizing";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { ComposerLoadingSkeleton } from "@/components/promptbox/ComposerPlaceholder";
import { cn } from "@bb/shared-ui/lib/utils";
import { useEffect, type ReactNode } from "react";

interface RouteLoadingSkeletonProps {
  children?: ReactNode;
  isBoundedPane: boolean;
  secondaryPanelWidthPercent?: number;
  variant?: "default" | "root-compose";
}

let mountedRouteLoadingSkeletons = 0;

export function isRouteLoadingSkeletonMounted(): boolean {
  return mountedRouteLoadingSkeletons > 0;
}

const SHELL_CLASS = "flex h-full min-h-0 flex-1 flex-col overflow-hidden";
const STANDALONE_SHELL_BLEED_CLASS =
  "-mx-4 -mt-4 -mb-4 md:-mx-5 md:-mt-5 md:-mb-5";
const FULL_PANEL_SIZE_PERCENT = 100;

export function RouteLoadingSkeleton({
  children,
  isBoundedPane,
  secondaryPanelWidthPercent,
  variant = "default",
}: RouteLoadingSkeletonProps) {
  const isRootCompose = variant === "root-compose";
  const isCompactViewport = useIsCompactViewport();
  const pane = useOptionalPaneContext();
  const isInSidebarLayout = useOptionalIsSidebarShowing() !== null;
  useEffect(() => {
    mountedRouteLoadingSkeletons += 1;
    return () => {
      mountedRouteLoadingSkeletons -= 1;
    };
  }, []);
  const page = isRootCompose ? (
    <div
      className={cn(
        "mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col px-4 pb-4",
        isCompactViewport ? "justify-end pt-2" : "pt-14",
      )}
    >
      <ComposerLoadingSkeleton shape="new-thread" />
      <div className="mt-1 flex h-8 shrink-0 items-center justify-between px-3.5 max-md:mt-0 max-md:px-1 max-md:pointer-coarse:h-11">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-24 max-md:w-12" />
      </div>
    </div>
  ) : (
    <>
      {isInSidebarLayout ? (
        <AppPageHeader
          center={<Skeleton className="h-4 w-40" />}
          isWindowDragRegion={pane?.isTopRow ?? true}
          ownsWindowTopLeft={pane?.ownsWindowTopLeft ?? true}
        />
      ) : (
        <div
          className={cn(CHROME_ROW_CLASS, HEADER_SEAM_CLASS, "shrink-0 px-4")}
        >
          <Skeleton className="h-4 w-40" />
        </div>
      )}
      <div className="mx-auto min-h-0 w-full max-w-[760px] flex-1 overflow-hidden px-4 pt-4">
        {children}
      </div>
      <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pb-4">
        {isCompactViewport ? (
          <ComposerLoadingSkeleton shape="thread-compact" />
        ) : (
          <div className="pb-7 max-md:pb-6 max-md:pointer-coarse:pb-11">
            <ComposerLoadingSkeleton shape="thread" />
          </div>
        )}
      </div>
    </>
  );
  const isPageCollapsed =
    secondaryPanelWidthPercent === FULL_PANEL_SIZE_PERCENT;
  return (
    <div
      className={cn(
        SHELL_CLASS,
        (!isBoundedPane || isRootCompose) && STANDALONE_SHELL_BLEED_CLASS,
        isRootCompose && "pt-(--bb-window-frame-top)",
      )}
      role="status"
      aria-busy="true"
      aria-label="Loading"
      data-testid="route-loading-skeleton"
    >
      {secondaryPanelWidthPercent === undefined ? (
        page
      ) : (
        <div className="flex min-h-0 flex-1">
          <div
            data-testid="route-loading-skeleton-page"
            className="flex min-h-0 min-w-0 flex-col overflow-hidden"
            style={{
              flex: `${FULL_PANEL_SIZE_PERCENT - secondaryPanelWidthPercent} 1 0px`,
              minWidth: isPageCollapsed ? 0 : PANE_MIN_WIDTH_PX,
            }}
          >
            {page}
          </div>
          <div
            data-testid="route-loading-skeleton-secondary-panel"
            className="relative min-h-0 min-w-0 overflow-hidden"
            style={{
              flex: `${secondaryPanelWidthPercent} 1 0px`,
              minWidth: PANE_MIN_WIDTH_PX,
            }}
          >
            <div
              className={cn(
                "absolute inset-0 flex flex-col bg-sidebar",
                !isPageCollapsed && "border-l border-border-seam",
              )}
            >
              <div className={cn(CHROME_ROW_HEIGHT_CLASS, "shrink-0")} />
              <SecondaryPanelContentSkeleton />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
