import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { SIDEBAR_TREE_CHEVRON_ZONE_CLASS } from "../ui/tree-geometry.js";

interface SidebarTreeChevronProps {
  disabled?: boolean;
  isCollapsed: boolean;
  expandLabel: string;
  collapseLabel: string;
  onToggle: () => void;
  className?: string;
}

export function SidebarTreeChevron({
  disabled = false,
  isCollapsed,
  expandLabel,
  collapseLabel,
  onToggle,
  className,
}: SidebarTreeChevronProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      tabIndex={-1}
      aria-hidden="true"
      data-sidebar-tree-chevron=""
      aria-expanded={!isCollapsed}
      aria-label={isCollapsed ? expandLabel : collapseLabel}
      title={isCollapsed ? "Expand" : "Collapse"}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        SIDEBAR_TREE_CHEVRON_ZONE_CLASS,
        "relative z-10 inline-flex self-stretch cursor-pointer items-center justify-center rounded-md text-sidebar-foreground-quiet outline-none hover:text-sidebar-foreground",
        className,
      )}
    >
      <Icon
        name="ChevronRight"
        className={cn(
          "size-3 transition-transform duration-[120ms] ease-out motion-reduce:transition-none",
          !isCollapsed && "rotate-90",
        )}
        aria-hidden="true"
      />
    </button>
  );
}
