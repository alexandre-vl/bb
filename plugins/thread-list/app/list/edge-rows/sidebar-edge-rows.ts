import { setToastBottomClearance } from "@/components/ui/toast-clearance";
import { SIDEBAR_CONTENT_SELECTOR } from "../../ui/sidebar.js";
import { REORDER_ANIMATION_MS } from "../stability/sidebar-stability.js";
import {
  parseSidebarWindowedAttention,
  SIDEBAR_WINDOWED_ATTENTION_ATTRIBUTE,
} from "../windowedAttention.js";

export const EDGE_ROW_TOAST_GAP_PX = 8;
const EDGE_ROW_REVEAL_GAP_PX = 4;
const EDGE_ROW_REVEAL_FRAME_LIMIT = 30;
const ROW_RUNG_ATTRIBUTE = "data-sidebar-row-rung";
const ATTENTION_ROW_SELECTOR = [4, 5]
  .map((rung) => `[data-sidebar-tree-row][${ROW_RUNG_ATTRIBUTE}="${rung}"]`)
  .join(", ");
const STICKY_TIER_SELECTOR = "[data-sidebar-sticky-tier]";
const TREE_ITEM_SELECTOR = "[data-sidebar-tree-item]";

export type EdgeRowDirection = "above" | "below";

export interface EdgeSpan {
  top: number;
  bottom: number;
}

export interface EdgeRowTarget extends EdgeSpan {
  needsYou: number;
  failed: number;
}

export interface EdgeRowLayout {
  scrollport: EdgeSpan;
  stuckBottom: number;
  stickyRows: readonly EdgeSpan[];
  targets: readonly EdgeRowTarget[];
  edgeHeight: number;
}

export interface EdgeRow {
  direction: EdgeRowDirection;
  needsYou: number;
  failed: number;
  nearest: number;
  top: number;
}

export function resolveTopEdgeRowTop({
  stuckBottom,
  stickyRows,
  edgeHeight,
}: Pick<EdgeRowLayout, "stuckBottom" | "stickyRows" | "edgeHeight">): number {
  let top = stuckBottom;
  let moved = true;
  while (moved) {
    moved = false;
    for (const row of stickyRows) {
      if (row.bottom > top + 0.5 && row.top < top + edgeHeight - 0.5) {
        top = row.bottom;
        moved = true;
      }
    }
  }
  return top;
}

export function resolveEdgeRow(layout: EdgeRowLayout): EdgeRow | null {
  const below: number[] = [];
  const above: number[] = [];
  layout.targets.forEach((target, index) => {
    if (target.top >= layout.scrollport.bottom - 1) below.push(index);
    else if (target.bottom <= layout.stuckBottom + 1) above.push(index);
  });
  const direction: EdgeRowDirection | null =
    below.length > 0 ? "below" : above.length > 0 ? "above" : null;
  if (direction === null) return null;
  const indexes = direction === "below" ? below : above;
  let needsYou = 0;
  let failed = 0;
  let nearest = indexes[0] ?? 0;
  for (const index of indexes) {
    const target = layout.targets[index];
    const best = layout.targets[nearest];
    if (target === undefined || best === undefined) continue;
    needsYou += target.needsYou;
    failed += target.failed;
    if (
      direction === "below"
        ? target.top < best.top
        : target.bottom > best.bottom
    ) {
      nearest = index;
    }
  }
  if (needsYou + failed === 0) return null;
  const top =
    direction === "below"
      ? layout.scrollport.bottom - layout.edgeHeight
      : resolveTopEdgeRowTop(layout);
  if (top + layout.edgeHeight > layout.scrollport.bottom + 0.5) return null;
  return { direction, needsYou, failed, nearest, top };
}

export function describeEdgeRowCounts({
  needsYou,
  failed,
}: Pick<EdgeRow, "needsYou" | "failed">): string {
  const parts: string[] = [];
  if (needsYou > 0) {
    parts.push(`${needsYou} ${needsYou === 1 ? "needs" : "need"} you`);
  }
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

interface MeasuredTarget extends EdgeRowTarget {
  element: HTMLElement;
  placeholder: boolean;
}

interface MeasuredLayout extends EdgeRowLayout {
  targets: readonly MeasuredTarget[];
}

interface StickyMeasurement {
  rows: EdgeSpan[];
  stuck: Set<Element>;
  stuckBottom: number;
}

export interface SidebarEdgeRowView {
  direction: EdgeRowDirection;
  label: string;
  offset: number;
}

export interface SidebarEdgeRowElements {
  root: HTMLElement;
  topAnchor: HTMLElement;
  bottomRow: HTMLElement;
}

function measureScrollport(scroller: HTMLElement): EdgeSpan | null {
  const rect = scroller.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || scroller.clientHeight <= 0) {
    return null;
  }
  const view = scroller.ownerDocument.defaultView;
  if (view && (rect.right <= 0 || rect.left >= view.innerWidth)) return null;
  if (
    typeof scroller.checkVisibility === "function" &&
    !scroller.checkVisibility({ visibilityProperty: true })
  ) {
    return null;
  }
  const top = rect.top + scroller.clientTop;
  return { top, bottom: top + scroller.clientHeight };
}

function measureStickyRows(
  root: HTMLElement,
  scrollport: EdgeSpan,
): StickyMeasurement {
  const view = root.ownerDocument.defaultView;
  const measurement: StickyMeasurement = {
    rows: [],
    stuck: new Set(),
    stuckBottom: scrollport.top,
  };
  for (const tier of root.querySelectorAll<HTMLElement>(STICKY_TIER_SELECTOR)) {
    const rect = tier.getBoundingClientRect();
    if (
      rect.height <= 0 ||
      rect.bottom <= scrollport.top ||
      rect.top >= scrollport.bottom
    ) {
      continue;
    }
    const group = tier.parentElement?.getBoundingClientRect();
    if (!group || view?.getComputedStyle(tier).position !== "sticky") continue;
    if (group.bottom > rect.bottom + 0.5) {
      measurement.rows.push({ top: rect.top, bottom: rect.bottom });
    }
    if (rect.top - group.top > 0.5) {
      measurement.stuck.add(tier);
      measurement.stuckBottom = Math.max(measurement.stuckBottom, rect.bottom);
    }
  }
  return measurement;
}

function measureTargets(
  root: HTMLElement,
  stuck: ReadonlySet<Element>,
): MeasuredTarget[] {
  const targets: MeasuredTarget[] = [];
  for (const row of root.querySelectorAll<HTMLElement>(
    ATTENTION_ROW_SELECTOR,
  )) {
    if (stuck.has(row)) continue;
    const rect = row.getBoundingClientRect();
    if (rect.height <= 0) continue;
    const rung = row.getAttribute(ROW_RUNG_ATTRIBUTE);
    targets.push({
      top: rect.top,
      bottom: rect.bottom,
      needsYou: rung === "5" ? 1 : 0,
      failed: rung === "4" ? 1 : 0,
      element: row,
      placeholder: false,
    });
  }
  for (const placeholder of root.querySelectorAll<HTMLElement>(
    `[${SIDEBAR_WINDOWED_ATTENTION_ATTRIBUTE}]`,
  )) {
    const attention = parseSidebarWindowedAttention(
      placeholder.getAttribute(SIDEBAR_WINDOWED_ATTENTION_ATTRIBUTE),
    );
    const rect = placeholder.getBoundingClientRect();
    if (attention === null || rect.height <= 0) continue;
    targets.push({
      ...attention,
      top: rect.top,
      bottom: rect.bottom,
      element: placeholder,
      placeholder: true,
    });
  }
  return targets;
}

function isKeyboardFocusWithin(root: HTMLElement): boolean {
  const active = root.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) return false;
  try {
    return active.matches(":focus-visible");
  } catch {
    return false;
  }
}

function sameView(
  left: SidebarEdgeRowView | null,
  right: SidebarEdgeRowView | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.direction === right.direction &&
      left.label === right.label &&
      left.offset === right.offset)
  );
}

export class SidebarEdgeRowController {
  private elements: SidebarEdgeRowElements | null = null;
  private scroller: HTMLElement | null = null;
  private frame: number | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private revealFrame: number | null = null;
  private view: SidebarEdgeRowView | null = null;
  private clearance: number | null = null;

  constructor(
    private readonly onChange: (view: SidebarEdgeRowView | null) => void,
  ) {}

  attach(elements: SidebarEdgeRowElements): () => void {
    const { root } = elements;
    const view = root.ownerDocument.defaultView;
    this.elements = elements;
    this.scroller = root.closest<HTMLElement>(SIDEBAR_CONTENT_SELECTOR);
    const schedule = () => this.schedule();
    const scheduleAfterMotion = () => {
      this.schedule();
      if (this.settleTimer !== null) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        this.schedule();
      }, REORDER_ANIMATION_MS + 40);
    };
    this.scroller?.addEventListener("scroll", schedule, { passive: true });
    root.addEventListener("focusin", schedule);
    root.addEventListener("focusout", schedule);
    view?.addEventListener("resize", schedule);
    const mutations =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(scheduleAfterMotion);
    mutations?.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        ROW_RUNG_ATTRIBUTE,
        SIDEBAR_WINDOWED_ATTENTION_ATTRIBUTE,
      ],
    });
    const resizes =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    resizes?.observe(root);
    if (this.scroller) resizes?.observe(this.scroller);
    this.update();
    return () => {
      this.scroller?.removeEventListener("scroll", schedule);
      root.removeEventListener("focusin", schedule);
      root.removeEventListener("focusout", schedule);
      view?.removeEventListener("resize", schedule);
      mutations?.disconnect();
      resizes?.disconnect();
      this.cancelFrames();
      this.setClearance(null);
      if (this.elements === elements) {
        this.elements = null;
        this.scroller = null;
      }
    };
  }

  activate(): void {
    const layout = this.measure();
    if (layout === null) return;
    const edge = resolveEdgeRow(layout);
    const target = edge === null ? undefined : layout.targets[edge.nearest];
    if (edge === null || target === undefined) return;
    if (!target.placeholder) {
      this.reveal(target.element, edge, layout.edgeHeight);
      return;
    }
    target.element.scrollIntoView({ block: "nearest" });
    this.revealWithin(target.element, edge, layout.edgeHeight, 0);
  }

  private schedule(): void {
    if (this.frame !== null) return;
    const view = this.elements?.root.ownerDocument.defaultView;
    if (!view || typeof view.requestAnimationFrame !== "function") {
      this.update();
      return;
    }
    this.frame = view.requestAnimationFrame(() => {
      this.frame = null;
      this.update();
    });
  }

  private cancelFrames(): void {
    const view = this.elements?.root.ownerDocument.defaultView;
    if (this.frame !== null) view?.cancelAnimationFrame(this.frame);
    if (this.revealFrame !== null) view?.cancelAnimationFrame(this.revealFrame);
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.frame = null;
    this.revealFrame = null;
    this.settleTimer = null;
  }

  private edgeHeight(): number {
    return this.elements?.bottomRow.offsetHeight ?? 0;
  }

  private measure(): MeasuredLayout | null {
    const elements = this.elements;
    const scroller = this.scroller;
    if (elements === null || scroller === null) return null;
    const scrollport = measureScrollport(scroller);
    if (scrollport === null) return null;
    const sticky = measureStickyRows(elements.root, scrollport);
    return {
      scrollport,
      stuckBottom: sticky.stuckBottom,
      stickyRows: sticky.rows,
      targets: measureTargets(elements.root, sticky.stuck),
      edgeHeight: this.edgeHeight(),
    };
  }

  private update(): void {
    const elements = this.elements;
    if (elements === null) return;
    const layout = isKeyboardFocusWithin(elements.root) ? null : this.measure();
    const edge = layout === null ? null : resolveEdgeRow(layout);
    const next: SidebarEdgeRowView | null =
      edge === null
        ? null
        : {
            direction: edge.direction,
            label: describeEdgeRowCounts(edge),
            offset:
              edge.direction === "above"
                ? Math.round(
                    edge.top - elements.topAnchor.getBoundingClientRect().top,
                  )
                : 0,
          };
    const document = elements.root.ownerDocument;
    this.setClearance(
      edge?.direction === "below"
        ? document.documentElement.clientHeight -
            edge.top +
            EDGE_ROW_TOAST_GAP_PX
        : null,
    );
    if (sameView(this.view, next)) return;
    this.view = next;
    this.onChange(next);
  }

  private setClearance(clearance: number | null): void {
    const rounded = clearance === null ? null : Math.round(clearance);
    if (rounded === this.clearance) return;
    this.clearance = rounded;
    const document = this.elements?.root.ownerDocument;
    if (document) setToastBottomClearance(document, rounded);
  }

  private revealWithin(
    placeholder: HTMLElement,
    edge: EdgeRow,
    edgeHeight: number,
    frames: number,
  ): void {
    const view = placeholder.ownerDocument.defaultView;
    const rows = placeholder.querySelectorAll<HTMLElement>(
      ATTENTION_ROW_SELECTOR,
    );
    const row = edge.direction === "below" ? rows[0] : rows[rows.length - 1];
    if (row !== undefined) {
      this.reveal(row, edge, edgeHeight);
      return;
    }
    if (
      !placeholder.isConnected ||
      frames >= EDGE_ROW_REVEAL_FRAME_LIMIT ||
      !view ||
      typeof view.requestAnimationFrame !== "function"
    ) {
      return;
    }
    this.revealFrame = view.requestAnimationFrame(() => {
      this.revealFrame = null;
      this.revealWithin(placeholder, edge, edgeHeight, frames + 1);
    });
  }

  private reveal(row: HTMLElement, edge: EdgeRow, edgeHeight: number): void {
    const root = this.elements?.root;
    const scroller = this.scroller;
    if (!root || !scroller) return;
    const topReserve =
      edge.direction === "above" && edge.needsYou + edge.failed > 1
        ? edgeHeight
        : 0;
    for (let pass = 0; pass < 2; pass += 1) {
      const scrollport = measureScrollport(scroller);
      if (scrollport === null) break;
      const sticky = measureStickyRows(root, scrollport);
      if (sticky.stuck.has(row)) break;
      const rect = row.getBoundingClientRect();
      const minTop = sticky.stuckBottom + topReserve + EDGE_ROW_REVEAL_GAP_PX;
      const maxBottom = scrollport.bottom - edgeHeight - EDGE_ROW_REVEAL_GAP_PX;
      const delta =
        rect.top < minTop
          ? rect.top - minTop
          : rect.bottom > maxBottom
            ? rect.bottom - maxBottom
            : 0;
      if (Math.abs(delta) < 0.5) break;
      scroller.scrollTop += delta;
    }
    row
      .querySelector<HTMLElement>(TREE_ITEM_SELECTOR)
      ?.focus({ preventScroll: true });
    this.schedule();
  }
}
