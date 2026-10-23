import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  SidebarEdgeRowController,
  type EdgeRowDirection,
  type SidebarEdgeRowView,
} from "./sidebar-edge-rows.js";

const EDGE_ANCHOR_CLASS = "pointer-events-none sticky z-[70] h-0 w-full";

const EDGE_ROW_CLASS =
  "pointer-events-auto absolute inset-x-0 flex h-7.5 cursor-pointer items-center justify-center gap-1 border-border-seam bg-sidebar px-2 text-xs font-medium whitespace-nowrap text-sidebar-foreground-quiet outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-md:pointer-coarse:h-10.5";

interface SidebarEdgeRowProps {
  direction: EdgeRowDirection;
  view: SidebarEdgeRowView | null;
  onActivate: () => void;
}

const SidebarEdgeRow = forwardRef<HTMLButtonElement, SidebarEdgeRowProps>(
  function SidebarEdgeRow({ direction, view, onActivate }, ref) {
    const shown = view?.direction === direction;
    const style: CSSProperties | undefined =
      direction === "above" ? { top: shown ? view.offset : 0 } : undefined;
    return (
      <button
        ref={ref}
        type="button"
        data-sidebar-edge-row={direction === "above" ? "top" : "bottom"}
        aria-hidden={shown ? undefined : true}
        tabIndex={shown ? undefined : -1}
        className={cn(
          EDGE_ROW_CLASS,
          direction === "above" ? "border-b" : "bottom-0 border-t",
          !shown && "invisible",
        )}
        style={style}
        onClick={onActivate}
      >
        <Icon
          name={direction === "above" ? "ArrowUp" : "ArrowDown"}
          aria-hidden="true"
          className="size-3.5 shrink-0"
        />
        <span>{shown ? view.label : null}</span>
        {shown ? (
          <span className="sr-only">{`, ${direction}. Jump to it`}</span>
        ) : null}
      </button>
    );
  },
);

export function SidebarEdgeRows({
  tree,
  children,
}: {
  tree: HTMLElement | null;
  children: ReactNode;
}) {
  const topAnchorRef = useRef<HTMLDivElement>(null);
  const bottomRowRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<SidebarEdgeRowView | null>(null);
  const [controller] = useState(() => new SidebarEdgeRowController(setView));
  useEffect(() => {
    const topAnchor = topAnchorRef.current;
    const bottomRow = bottomRowRef.current;
    if (!tree || !topAnchor || !bottomRow) return;
    return controller.attach({ root: tree, topAnchor, bottomRow });
  }, [controller, tree]);
  const activate = () => controller.activate();
  return (
    <>
      <div
        ref={topAnchorRef}
        data-sidebar-edge-anchor="top"
        className={cn(EDGE_ANCHOR_CLASS, "top-0")}
      >
        <SidebarEdgeRow direction="above" view={view} onActivate={activate} />
      </div>
      {children}
      <div
        data-sidebar-edge-anchor="bottom"
        className={cn(EDGE_ANCHOR_CLASS, "bottom-0")}
      >
        <SidebarEdgeRow
          ref={bottomRowRef}
          direction="below"
          view={view}
          onActivate={activate}
        />
      </div>
    </>
  );
}
