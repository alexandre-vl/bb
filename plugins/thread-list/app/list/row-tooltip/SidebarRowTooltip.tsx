import { useEffect, useRef, useState } from "react";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { SidebarRowTooltipController } from "./sidebar-row-tooltip.js";

export function SidebarRowTooltip({ tree }: { tree: HTMLElement | null }) {
  const isCompactViewport = useIsCompactViewport();
  const tipRef = useRef<HTMLDivElement>(null);
  const [controller] = useState(() => new SidebarRowTooltipController());
  useEffect(() => {
    controller.setEnabled(!isCompactViewport);
  }, [controller, isCompactViewport]);
  useEffect(() => {
    const tip = tipRef.current;
    if (!tree || !tip) return;
    return controller.attach(tree, tip);
  }, [controller, tree]);
  return (
    <div
      ref={tipRef}
      hidden
      aria-hidden="true"
      data-sidebar-row-tooltip-popup=""
      className="pointer-events-none absolute top-0 left-0 z-[80] w-max rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md wrap-anywhere"
    />
  );
}
