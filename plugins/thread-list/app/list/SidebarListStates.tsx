import { useEffect, useState } from "react";
import { experimental_useSidebarNavigation } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import {
  getTreeContainerPaddingLeft,
  getTreeLeafPaddingLeft,
} from "../ui/tree-geometry.js";
import { SIDEBAR_TREE_ROW_HEIGHT_CLASS } from "../ui/tree-row.js";

export const SIDEBAR_SKELETON_DELAY_MS = 300;

interface SkeletonRow {
  kind: "leaf" | "parent";
  depth: number;
  width: number;
}

interface SkeletonSection {
  header: number;
  rows: readonly SkeletonRow[];
}

const LIST_SKELETON: readonly SkeletonSection[] = [
  {
    header: 34,
    rows: [
      { kind: "leaf", depth: 0, width: 72 },
      { kind: "parent", depth: 0, width: 58 },
      { kind: "leaf", depth: 1, width: 66 },
      { kind: "leaf", depth: 1, width: 45 },
      { kind: "leaf", depth: 0, width: 80 },
      { kind: "leaf", depth: 0, width: 52 },
    ],
  },
  {
    header: 26,
    rows: [
      { kind: "leaf", depth: 0, width: 76 },
      { kind: "leaf", depth: 0, width: 61 },
    ],
  },
];

const TREE_SKELETON: readonly SkeletonRow[] = [
  { kind: "leaf", depth: 0, width: 70 },
  { kind: "leaf", depth: 0, width: 54 },
  { kind: "leaf", depth: 0, width: 63 },
];

const SKELETON_BAR_CLASS = "block rounded-sm bg-sidebar-border/60";
const SKELETON_ROW_CLASS = cn(
  "flex items-center",
  SIDEBAR_TREE_ROW_HEIGHT_CLASS,
);

function useDelayedVisibility(delayMs: number): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);
  return visible;
}

function getSkeletonRowPaddingLeft(row: SkeletonRow): string {
  return row.kind === "parent"
    ? `calc(${getTreeContainerPaddingLeft(row.depth)} + var(--bb-sidebar-chevron-zone))`
    : getTreeLeafPaddingLeft(row.depth);
}

function SkeletonRows({ rows }: { rows: readonly SkeletonRow[] }) {
  return rows.map((row, index) => (
    <div
      key={index}
      data-sidebar-skeleton-row=""
      className={SKELETON_ROW_CLASS}
      style={{
        paddingLeft: getSkeletonRowPaddingLeft(row),
        paddingRight: "var(--bb-sidebar-status-box)",
      }}
    >
      <span
        className={cn(SKELETON_BAR_CLASS, "h-[13px] pointer-coarse:h-[15px]")}
        style={{ width: `${row.width}%` }}
      />
    </div>
  ));
}

export function SidebarListSkeleton() {
  const visible = useDelayedVisibility(SIDEBAR_SKELETON_DELAY_MS);
  return (
    <div
      aria-label="Loading sidebar navigation"
      aria-busy="true"
      data-sidebar-skeleton=""
      className="flex flex-col gap-3"
    >
      {visible
        ? LIST_SKELETON.map((section, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="flex flex-col gap-0.5"
            >
              <div
                data-sidebar-skeleton-header=""
                className={SKELETON_ROW_CLASS}
                style={{ paddingLeft: "var(--bb-sidebar-text-inset)" }}
              >
                <span
                  className={cn(SKELETON_BAR_CLASS, "h-3 pointer-coarse:h-3.5")}
                  style={{ width: `${section.header}%` }}
                />
              </div>
              <SkeletonRows rows={section.rows} />
            </div>
          ))
        : null}
    </div>
  );
}

export function SidebarTreeSkeleton() {
  const visible = useDelayedVisibility(SIDEBAR_SKELETON_DELAY_MS);
  return (
    <div
      aria-busy="true"
      data-sidebar-skeleton=""
      className="flex flex-col gap-0.5"
    >
      {visible ? <SkeletonRows rows={TREE_SKELETON} /> : null}
    </div>
  );
}

export function SidebarLoadErrorRow({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      data-sidebar-load-error=""
      className={cn(
        "flex items-center gap-1 text-xs text-sidebar-foreground-quiet",
        SIDEBAR_TREE_ROW_HEIGHT_CLASS,
      )}
      style={{ paddingLeft: "var(--bb-sidebar-text-inset)" }}
    >
      <span className="min-w-0 truncate">Couldn't load threads</span>
      <button
        type="button"
        className="h-full shrink-0 rounded-md px-2 font-medium text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

function useNewThreadShortcutLabel(): string | null {
  const { items } = experimental_useSidebarNavigation();
  const newThread = items.find((item) => item.action.kind === "new-thread");
  return newThread?.shortcut?.label ?? null;
}

export function SidebarNoThreadsLine() {
  const shortcut = useNewThreadShortcutLabel();
  return (
    <p
      data-sidebar-no-threads=""
      className={cn(
        "mb-2.5 flex items-center text-xs text-sidebar-foreground-quiet",
        SIDEBAR_TREE_ROW_HEIGHT_CLASS,
      )}
      style={{ paddingLeft: "var(--bb-sidebar-text-inset)" }}
    >
      No threads yet
      {shortcut !== null ? (
        <span className="pointer-coarse:hidden">&nbsp;·&nbsp;{shortcut}</span>
      ) : null}
    </p>
  );
}
