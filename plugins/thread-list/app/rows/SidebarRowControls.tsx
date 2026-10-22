import { type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  SIDEBAR_CONTROL_PAIR_GAP_CLASS,
  SIDEBAR_CONTROL_PRIMARY_BUTTON_CLASS,
} from "@/components/ui/sidebar-row-classes";
import { SIDEBAR_TREE_ICON_SIZE_CLASS } from "../ui/tree-row.js";

export function SidebarRowControls({
  primaryAction,
  children,
}: {
  primaryAction: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      data-sidebar-row-controls=""
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center pointer-coarse:gap-0",
        SIDEBAR_CONTROL_PAIR_GAP_CLASS,
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (
          event.target instanceof Node &&
          event.currentTarget.contains(event.target)
        ) {
          event.stopPropagation();
        }
      }}
    >
      {primaryAction}
      {children}
    </span>
  );
}

export function SidebarControlButton({
  label,
  icon,
  onClick,
  disabled = false,
  className,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip delayDuration={350} disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          tabIndex={-1}
          disabled={disabled}
          className={cn(
            SIDEBAR_CONTROL_PRIMARY_BUTTON_CLASS,
            "pointer-coarse:h-9 pointer-coarse:w-8",
            className,
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (event.detail > 0) event.currentTarget.blur();
            onClick();
          }}
        >
          <Icon name={icon} className={SIDEBAR_TREE_ICON_SIZE_CLASS} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
