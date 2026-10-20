import { useId, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { LIST_HOVER_TRANSITION } from "@/components/ui/motion";
import { SIDEBAR_CONTROL_STATE_CLASS } from "@/components/ui/sidebar-row-classes";
import { cn } from "@/lib/utils";

interface SubThreadToggleProps {
  count: number;
  working: number;
  isCollapsed: boolean;
  expandLabel: string;
  collapseLabel: string;
  icon: ReactNode;
  iconLabel: string | null;
  onToggle: () => void;
}

function formatSubThreadCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function describeSubThreads(
  count: number,
  working: number,
  iconLabel: string | null,
): string {
  return [
    `${count} ${count === 1 ? "thread" : "threads"}`,
    working > 0 ? `${working} working` : null,
    iconLabel,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

export function SubThreadToggle({
  count,
  working,
  isCollapsed,
  expandLabel,
  collapseLabel,
  icon,
  iconLabel,
  onToggle,
}: SubThreadToggleProps) {
  const descriptionId = useId();
  const hasIcon = icon !== null;
  return (
    <button
      type="button"
      data-sidebar-sub-thread-toggle=""
      data-sidebar-rename-anchor=""
      aria-expanded={!isCollapsed}
      aria-label={isCollapsed ? expandLabel : collapseLabel}
      aria-describedby={descriptionId}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "pointer-events-auto relative z-[31] -my-0.5 flex h-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] outline-none ring-sidebar-ring focus-visible:ring-2 focus-visible:ring-inset",
        "after:absolute after:-inset-1 after:content-[''] max-md:pointer-coarse:after:-inset-2",
        hasIcon ? "-ml-0.5 mr-1 w-5" : "-ml-4 mr-0.5 w-3.5",
        SIDEBAR_CONTROL_STATE_CLASS,
        LIST_HOVER_TRANSITION,
      )}
    >
      {hasIcon ? (
        <span className="flex items-center justify-center text-muted-foreground group-hover/thread-row:hidden group-has-[:focus-visible]/thread-row:hidden [@media(hover:none)]:hidden">
          {icon}
        </span>
      ) : null}
      <Icon
        name="ChevronRight"
        className={cn(
          "size-3.5 transition-transform duration-150",
          !isCollapsed && "rotate-90",
          hasIcon &&
            "hidden group-hover/thread-row:block group-has-[:focus-visible]/thread-row:block [@media(hover:none)]:block",
        )}
        aria-hidden="true"
      />
      <span id={descriptionId} className="sr-only">
        {describeSubThreads(count, working, iconLabel)}
      </span>
    </button>
  );
}

export function SubThreadCount({
  count,
  working,
  glyph,
}: {
  count: number;
  working: number;
  glyph: ReactNode;
}) {
  return (
    <span
      data-sidebar-sub-thread-count=""
      aria-hidden="true"
      className="ml-1.5 inline-flex shrink-0 items-center gap-0.5 text-2xs tabular-nums text-muted-foreground"
    >
      {working > 0 ? (
        <>
          <span className="flex items-center [&_svg]:size-3">{glyph}</span>
          {`${formatSubThreadCount(working)}/${formatSubThreadCount(count)}`}
        </>
      ) : (
        formatSubThreadCount(count)
      )}
    </span>
  );
}
