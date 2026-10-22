import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_TREE_ROW_BASE_CLASS,
  SIDEBAR_TREE_ROW_HEIGHT_CLASS,
  SIDEBAR_TREE_ROW_HOVER_CLASS,
} from "../ui/tree-row.js";
import { getTreeLeafPaddingLeft } from "../ui/tree-geometry.js";
import type { SidebarFold } from "./useFoldedItems.js";

export function SidebarFoldRow({
  fold,
  depth,
}: {
  fold: SidebarFold;
  depth: number;
}) {
  const itemRef = useRef<HTMLSpanElement>(null);
  const focusSelfOnClose = useRef(false);
  useLayoutEffect(() => {
    if (fold.open || !focusSelfOnClose.current) return;
    focusSelfOnClose.current = false;
    itemRef.current?.focus();
  }, [fold.open]);
  const activate = () => {
    focusSelfOnClose.current = fold.open;
    fold.toggle();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };
  return (
    <div
      data-sidebar-tree-row=""
      data-sidebar-fold-row=""
      data-sidebar-row-key={fold.rowKey}
      className={cn(
        "relative cursor-pointer",
        SIDEBAR_TREE_ROW_BASE_CLASS,
        SIDEBAR_TREE_ROW_HOVER_CLASS,
        SIDEBAR_TREE_ROW_HEIGHT_CLASS,
      )}
      style={{ paddingLeft: getTreeLeafPaddingLeft(depth) }}
      onClick={activate}
    >
      <span
        ref={itemRef}
        role="treeitem"
        tabIndex={-1}
        data-sidebar-tree-item=""
        aria-level={depth + 2}
        className="relative z-10 min-w-0 flex-1 truncate text-left text-xs text-sidebar-foreground-quiet outline-none"
        onKeyDown={handleKeyDown}
      >
        {fold.label}
      </span>
    </div>
  );
}
