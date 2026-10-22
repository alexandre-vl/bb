import { cn } from "@/lib/utils";

export const SIDEBAR_TREE_ROW_BASE_CLASS =
  "flex w-full min-w-0 items-center rounded-md pr-0 text-sm";

const SIDEBAR_TREE_ROW_FOCUS_CLASS =
  "has-[[data-sidebar-tree-item]:focus-visible]:ring-2 has-[[data-sidebar-tree-item]:focus-visible]:ring-inset has-[[data-sidebar-tree-item]:focus-visible]:ring-ring";

export const SIDEBAR_TREE_ROW_HOVER_CLASS = cn(
  "bb-sidebar-accent-row hover:bg-sidebar-accent has-[[data-state=open]]:bg-sidebar-accent",
  SIDEBAR_TREE_ROW_FOCUS_CLASS,
);

export const SIDEBAR_TREE_ROW_SELECTED_CLASS = cn(
  "bb-sidebar-selected-row bg-sidebar-row-selected",
  SIDEBAR_TREE_ROW_FOCUS_CLASS,
);

export const SIDEBAR_TREE_ROW_ANCHOR_CLASS =
  "absolute inset-x-0 -inset-y-px z-0 rounded-md outline-none";

export const SIDEBAR_TREE_STATUS_BOX_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center max-md:pointer-coarse:h-10 max-md:pointer-coarse:w-12";

export function getSidebarTitleToneClass({
  isActive,
  isAttention,
  isLive,
}: {
  isActive: boolean;
  isAttention: boolean;
  isLive: boolean;
}): string {
  if (isAttention) return "font-semibold text-sidebar-foreground";
  if (isActive || isLive) return "text-sidebar-foreground";
  return "text-sidebar-foreground-quiet";
}

export function SidebarSelectionMark() {
  return (
    <span
      aria-hidden="true"
      data-sidebar-selection-mark=""
      className="pointer-events-none absolute left-0.5 top-1/2 z-[1] h-3.5 w-0.5 -translate-y-1/2 rounded-[1px] bg-sidebar-foreground-quiet"
    />
  );
}
