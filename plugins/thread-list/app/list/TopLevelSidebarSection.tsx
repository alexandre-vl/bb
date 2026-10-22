import {
  useCallback,
  type CSSProperties,
  type MouseEvent,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { SidebarStickyGroup, SidebarStickyTier } from "../ui/sidebar.js";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import {
  SectionDropTargetOverlay,
  useSectionDropTargetState,
} from "../dnd/useSectionDropTargetState.js";
import type { SidebarSortableDragBindings } from "@/components/ui/sortable-motion";
import {
  EMPTY_THREAD_ROLLUP,
  describeThreadRollup,
  type ThreadRollup,
} from "../model/thread-activity.js";
import {
  CollapsedThreadStatusGlyph,
  useRollupIndicatorKind,
} from "../rows/ThreadRow.js";
import {
  useThreadGroupSplitIndicator,
  type ThreadSplitIndicatorTarget,
} from "./groupRollups.js";
import { SplitPaneMiniMap } from "@/components/ui/split-pane-mini-map";
import { usePluginThreadRowStatusForThreads } from "./groupRollups.js";
import {
  SIDEBAR_TREE_ROW_HEIGHT_CLASS,
  SIDEBAR_TREE_ROW_HOVER_CLASS,
  SIDEBAR_TREE_STATUS_BOX_CLASS,
} from "../ui/tree-row.js";

const EMPTY_SPLIT_INDICATOR_THREADS: readonly ThreadSplitIndicatorTarget[] = [];

function stopActionsClick(event: MouseEvent<HTMLSpanElement>) {
  event.stopPropagation();
}

function isHeaderControlTarget(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest(
      "button, input, a, [data-sidebar-trailing-controls], [data-sidebar-rename-editor]",
    ) !== null
  );
}

interface TopLevelSidebarSectionCollapseControl {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}

export interface TopLevelSidebarSectionProps {
  label: string;
  labelEditor?: ReactNode;
  onRename?: () => void;
  children: ReactNode;
  dropParentKey?: string;
  sectionId?: string;
  stickyHeader?: boolean;
  status?: ReactNode;
  actions?: ReactNode;
  actionsAlwaysVisible?: boolean;
  actionsMobileAlways?: boolean;
  actionsOpen?: boolean;
  collapseControl?: TopLevelSidebarSectionCollapseControl;
  rollup?: ThreadRollup;
  isEmpty?: boolean;
  collapsedThreads?: readonly ThreadSplitIndicatorTarget[];
  dragBindings?: SidebarSortableDragBindings;
  sectionRef?: (element: HTMLDivElement | null) => void;
  sectionStyle?: CSSProperties;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  isDropTargetActive?: boolean;
  wrapHeader?: (header: ReactElement) => ReactNode;
}

export function TopLevelSidebarSection({
  label,
  labelEditor,
  onRename,
  children,
  dropParentKey,
  sectionId,
  stickyHeader = true,
  status,
  actions,
  actionsAlwaysVisible = false,
  actionsMobileAlways = false,
  actionsOpen = false,
  collapseControl,
  rollup = EMPTY_THREAD_ROLLUP,
  isEmpty = false,
  collapsedThreads = EMPTY_SPLIT_INDICATOR_THREADS,
  dragBindings,
  sectionRef,
  sectionStyle,
  consumeClickSuppression,
  isDropTargetActive = false,
  wrapHeader,
}: TopLevelSidebarSectionProps) {
  const threadDropState = useSectionDropTargetState(dropParentKey);
  const isCollapsible = collapseControl !== undefined && !isEmpty;
  const isCollapsed = isCollapsible && collapseControl.isCollapsed;
  const collapsedSplitIndicator = useThreadGroupSplitIndicator(
    collapsedThreads,
    isCollapsed,
  );
  const pluginStatus = usePluginThreadRowStatusForThreads(
    isCollapsed ? collapsedThreads : EMPTY_SPLIT_INDICATOR_THREADS,
  );
  const rollupKind = useRollupIndicatorKind(
    isCollapsed ? rollup : EMPTY_THREAD_ROLLUP,
  );
  const showRollupIndicator =
    !status &&
    isCollapsed &&
    (collapsedSplitIndicator.miniMap !== null ||
      rollupKind !== "none" ||
      pluginStatus !== null);
  const summary =
    rollup.threadIds.length > 0
      ? describeThreadRollup(rollup, "thread", "threads")
      : null;
  const tooltip = summary ? `${label} · ${summary}` : label;
  const handleClickCapture = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (labelEditor || !consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeClickSuppression, labelEditor],
  );
  const handleHeaderClick = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (!isCollapsible || labelEditor || event.defaultPrevented) return;
      if (isHeaderControlTarget(event.target)) return;
      collapseControl.onToggleCollapsed();
    },
    [collapseControl, isCollapsible, labelEditor],
  );
  const hasTrailingControls = Boolean(status || actions || showRollupIndicator);
  const header = (
    <SidebarStickyTier
      ref={dragBindings?.setActivatorNodeRef}
      tier="label"
      data-sidebar-tree-row=""
      data-sidebar-row-key={dropParentKey ?? sectionId}
      data-sidebar-section-header=""
      data-sidebar-row-tooltip={labelEditor ? undefined : tooltip}
      className={cn(
        SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
        "group/section-header flex w-full min-w-0 items-center rounded-md pr-0 text-xs font-medium text-sidebar-foreground-quiet",
        SIDEBAR_TREE_ROW_HEIGHT_CLASS,
        SIDEBAR_TREE_ROW_HOVER_CLASS,
        isCollapsible && !labelEditor && "cursor-pointer",
        !stickyHeader && "relative top-auto",
        dragBindings && !dragBindings.disabled && "select-none",
      )}
      style={{ paddingLeft: "var(--bb-sidebar-text-inset)" }}
      onClick={handleHeaderClick}
      {...(dragBindings?.listeners ?? {})}
    >
      <span
        role="treeitem"
        tabIndex={-1}
        data-sidebar-tree-item=""
        data-sidebar-rename-anchor=""
        aria-level={1}
        aria-expanded={isCollapsible ? !isCollapsed : undefined}
        className={cn(
          "relative z-10 mr-2 flex min-w-0 flex-1 items-center gap-1 text-left outline-none",
          showRollupIndicator && "[@media(hover:hover)]:mr-8",
        )}
      >
        {labelEditor ?? (
          <span
            data-sidebar-section-label=""
            className="min-w-0 truncate"
            onDoubleClick={
              onRename
                ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRename();
                  }
                : undefined
            }
          >
            {label}
          </span>
        )}
        {isCollapsible && !labelEditor ? (
          <Icon
            name="ChevronRight"
            data-sidebar-section-caret=""
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0 transition-transform duration-[120ms] ease-out motion-reduce:transition-none",
              !isCollapsed &&
                "rotate-90 opacity-0 group-hover/section-header:opacity-100 group-has-[[data-sidebar-tree-item]:focus-visible]/section-header:opacity-100 pointer-coarse:opacity-100",
            )}
          />
        ) : null}
        {summary && !labelEditor ? (
          <span className="sr-only">{`, ${summary}`}</span>
        ) : null}
      </span>
      {hasTrailingControls ? (
        <span
          data-sidebar-trailing-controls=""
          className={cn(
            "relative z-20 flex shrink-0 items-center self-stretch [@media(hover:hover)]:absolute [@media(hover:hover)]:inset-y-0 [@media(hover:hover)]:right-0",
            labelEditor && "hidden",
          )}
          onClick={status || actions ? stopActionsClick : undefined}
        >
          {status}
          {showRollupIndicator ? (
            <span
              data-sidebar-collapsed-activity-edge=""
              data-sidebar-hover-actions-open={actionsOpen ? "true" : undefined}
              className={cn(
                SIDEBAR_TREE_STATUS_BOX_CLASS,
                "pointer-events-none",
                actions && SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
              )}
            >
              {collapsedSplitIndicator.miniMap ? (
                <SplitPaneMiniMap
                  slots={collapsedSplitIndicator.miniMap}
                  label={`${label} — contains a thread open in split`}
                  isWorking={
                    rollup.counts.working > 0 ||
                    pluginStatus?.tone === "running"
                  }
                />
              ) : (
                <CollapsedThreadStatusGlyph
                  rollup={rollup}
                  pluginStatus={pluginStatus}
                />
              )}
            </span>
          ) : null}
          {actions ? (
            <span
              data-sidebar-hover-actions-open={actionsOpen ? "true" : undefined}
              data-sidebar-hover-actions-mobile={
                actionsMobileAlways
                  ? SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
                  : undefined
              }
              className={cn(
                "inline-flex shrink-0 items-center",
                showRollupIndicator &&
                  "[@media(hover:hover)]:absolute [@media(hover:hover)]:inset-y-0 [@media(hover:hover)]:right-0",
                SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
                !actionsAlwaysVisible && SIDEBAR_HOVER_ACTIONS_CLASS,
              )}
            >
              {actions}
            </span>
          ) : null}
        </span>
      ) : null}
    </SidebarStickyTier>
  );

  return (
    <SidebarStickyGroup
      ref={sectionRef}
      style={sectionStyle}
      data-sidebar-section-id={sectionId}
      data-sidebar-drop-target={threadDropState ?? undefined}
      data-sidebar-rename-row=""
      data-sidebar-sticky-header={stickyHeader ? undefined : "false"}
      className={cn(
        "group/sidebar-section relative min-w-0 rounded-md transition-colors",
        isDropTargetActive && "bg-sidebar-accent/60",
      )}
      onClickCapture={handleClickCapture}
    >
      {threadDropState ? (
        <SectionDropTargetOverlay state={threadDropState} />
      ) : null}
      {wrapHeader ? wrapHeader(header) : header}
      {isCollapsed || isEmpty || children == null ? null : (
        <div>{children}</div>
      )}
    </SidebarStickyGroup>
  );
}
