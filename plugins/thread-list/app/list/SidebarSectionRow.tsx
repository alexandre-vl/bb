import {
  SidebarHeaderControls,
  SidebarSectionMenuItems,
} from "./SidebarHeaderControls.js";
import {
  memo,
  useCallback,
  useState,
  type CSSProperties,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { SidebarStickyTier } from "../ui/sidebar.js";
import { COARSE_POINTER_ROW_HEIGHT_CLASS } from "@/components/ui/coarse-pointer-sizing";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import { cn } from "@/lib/utils";
import type { SidebarSectionId } from "../model/sidebar-section-id.js";
import {
  EMPTY_THREAD_ROLLUP,
  describeThreadRollup,
  threadListIndicatorRung,
  type ThreadRollup,
} from "../model/thread-activity.js";
import { SidebarTreeChevron } from "../rows/SidebarTreeChevron.js";
import {
  CollapsedThreadStatusGlyph,
  useRollupIndicatorKind,
} from "../rows/ThreadRow.js";
import type { SidebarSortableDragBindings } from "@/components/ui/sortable-motion";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import {
  useThreadGroupSplitIndicator,
  type ThreadSplitIndicatorTarget,
} from "./groupRollups.js";
import { SplitPaneMiniMap } from "@/components/ui/split-pane-mini-map";
import { usePluginThreadRowStatusForThreads } from "./groupRollups.js";
import {
  SIDEBAR_TREE_ROW_BASE_CLASS,
  SIDEBAR_TREE_ROW_HOVER_CLASS,
  SIDEBAR_TREE_STATUS_BOX_CLASS,
} from "../ui/tree-row.js";
import { getTreeContainerPaddingLeft } from "../ui/tree-geometry.js";

const EMPTY_SPLIT_INDICATOR_THREADS: readonly ThreadSplitIndicatorTarget[] = [];

function stopActionsClick(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

function isRowControlTarget(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest(
      "button, input, a, [data-sidebar-trailing-controls], [data-sidebar-rename-editor]",
    ) !== null
  );
}

interface SidebarSectionRowProps {
  name: string;
  labelEditor?: ReactNode;
  label: string;
  sectionId?: SidebarSectionId;
  depth: number;
  rollup: ThreadRollup;
  collapsedThreads?: readonly ThreadSplitIndicatorTarget[];
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  stickyLevel?: number;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  isDropTargetActive?: boolean;
  onCreateThread?: () => void;
  onRename?: () => void;
  onRenameFromMenu?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  onRemove?: () => void;
}

function SidebarSectionRowComponent({
  name,
  labelEditor,
  label,
  sectionId,
  depth,
  rollup,
  collapsedThreads = EMPTY_SPLIT_INDICATOR_THREADS,
  consumeClickSuppression,
  dragBindings,
  isDropTargetActive = false,
  isCollapsed,
  onToggleCollapsed,
  onCreateThread,
  onRename,
  onRenameFromMenu,
  onCloseAutoFocus,
  onRemove,
  stickyLevel,
}: SidebarSectionRowProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
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
  const hasMenuActions = Boolean(onRename || onRemove);
  const hasActions = Boolean(onCreateThread || hasMenuActions);
  const showRollupIndicator =
    isCollapsed &&
    (collapsedSplitIndicator.miniMap !== null ||
      rollupKind !== "none" ||
      pluginStatus !== null);
  const summary = describeThreadRollup(rollup, "thread", "threads");
  const className = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    "group/section-row",
    stickyLevel === undefined && "relative",
    SIDEBAR_TREE_ROW_BASE_CLASS,
    SIDEBAR_TREE_ROW_HOVER_CLASS,
    COARSE_POINTER_ROW_HEIGHT_CLASS,
    !labelEditor && "cursor-pointer",
    dragBindings && !dragBindings.disabled && "select-none",
    isDropTargetActive && "bg-sidebar-accent text-sidebar-accent-foreground",
  );
  const style: CSSProperties = {
    paddingLeft: getTreeContainerPaddingLeft(depth),
  };
  const handleClickCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (labelEditor || !consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeClickSuppression, labelEditor],
  );
  const handleRowClick = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (labelEditor || event.defaultPrevented) return;
      if (isRowControlTarget(event.target)) return;
      onToggleCollapsed();
    },
    [labelEditor, onToggleCollapsed],
  );
  const content = (
    <>
      <SidebarTreeChevron
        disabled={Boolean(labelEditor)}
        className={labelEditor ? "invisible" : undefined}
        isCollapsed={isCollapsed}
        expandLabel={`Expand ${label} section`}
        collapseLabel={`Collapse ${label} section`}
        onToggle={onToggleCollapsed}
      />
      <span
        role="treeitem"
        tabIndex={-1}
        data-sidebar-tree-item=""
        data-sidebar-rename-anchor=""
        aria-level={depth + 2}
        aria-expanded={!isCollapsed}
        className={cn(
          "relative z-10 mr-2 flex min-w-0 flex-1 items-center text-left text-xs font-medium text-sidebar-foreground-quiet outline-none",
          showRollupIndicator && "[@media(hover:hover)]:mr-8",
        )}
      >
        {labelEditor ?? (
          <span
            data-sidebar-row-title=""
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
            {name}
          </span>
        )}
        {labelEditor ? null : (
          <span className="sr-only">{`, section, ${summary}`}</span>
        )}
      </span>
      {hasActions || showRollupIndicator ? (
        <span
          data-sidebar-trailing-controls=""
          className={cn(
            "relative z-20 flex shrink-0 items-center self-stretch [@media(hover:hover)]:absolute [@media(hover:hover)]:inset-y-0 [@media(hover:hover)]:right-0",
            labelEditor && "hidden",
          )}
          onClick={hasActions ? stopActionsClick : undefined}
        >
          {showRollupIndicator ? (
            <span
              data-sidebar-collapsed-activity-edge=""
              data-sidebar-hover-actions-open={
                isActionsOpen ? "true" : undefined
              }
              className={cn(
                SIDEBAR_TREE_STATUS_BOX_CLASS,
                "pointer-events-none",
                hasActions && SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
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
          {hasActions ? (
            <span
              data-sidebar-hover-actions-open={
                isActionsOpen ? "true" : undefined
              }
              data-sidebar-hover-actions-mobile={
                SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
              }
              className={cn(
                SIDEBAR_HOVER_ACTIONS_CLASS,
                "inline-flex shrink-0 items-center",
                showRollupIndicator &&
                  "[@media(hover:hover)]:absolute [@media(hover:hover)]:inset-y-0 [@media(hover:hover)]:right-0",
                SIDEBAR_HOVER_ACTIONS_GAP_CLASS,
                isCollapsed && "[@media(hover:none)]:hidden",
              )}
            >
              <SidebarHeaderControls
                label={`${label} section`}
                sectionId={sectionId}
                onNewThread={onCreateThread}
                onOpenChange={setIsActionsOpen}
                onCloseAutoFocus={onCloseAutoFocus}
              >
                <SidebarSectionMenuItems
                  onRename={onRenameFromMenu ?? onRename}
                  onRemove={onRemove}
                />
              </SidebarHeaderControls>
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );
  const tooltip = labelEditor ? undefined : `${name} · ${summary}`;
  const rung = threadListIndicatorRung(rollupKind);

  if (stickyLevel !== undefined) {
    return (
      <SidebarStickyTier
        ref={dragBindings?.setActivatorNodeRef}
        data-sidebar-rename-row=""
        data-sidebar-tree-row=""
        data-sidebar-row-key={sectionId}
        data-sidebar-row-tooltip={tooltip}
        data-sidebar-row-rung={rung}
        tier="parent"
        level={stickyLevel}
        className={className}
        style={style}
        {...(dragBindings?.listeners ?? {})}
        onClickCapture={
          consumeClickSuppression ? handleClickCapture : undefined
        }
        onClick={handleRowClick}
      >
        {content}
      </SidebarStickyTier>
    );
  }

  return (
    <div
      ref={dragBindings?.setActivatorNodeRef}
      data-sidebar-rename-row=""
      data-sidebar-tree-row=""
      data-sidebar-row-key={sectionId}
      data-sidebar-row-tooltip={tooltip}
      data-sidebar-row-rung={rung}
      className={className}
      style={style}
      {...(dragBindings?.listeners ?? {})}
      onClickCapture={consumeClickSuppression ? handleClickCapture : undefined}
      onClick={handleRowClick}
    >
      {content}
    </div>
  );
}

export const SidebarSectionRow = memo(SidebarSectionRowComponent);
