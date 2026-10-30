import { SIDEBAR_CONTENT_SELECTOR } from "../../ui/sidebar.js";

export const ROW_TOOLTIP_DELAY_MS = 600;
const ROW_TOOLTIP_GAP_PX = 4;
const ROW_SELECTOR = "[data-sidebar-tree-row]";
const TOOLTIP_ATTRIBUTE = "data-sidebar-row-tooltip";
const TITLE_ONLY_ATTRIBUTE = "data-sidebar-row-tooltip-title-only";
const TITLE_SELECTOR = "[data-sidebar-row-title]";
const TREE_ITEM_SELECTOR = "[data-sidebar-tree-item]";
const CONTROL_SELECTOR =
  "button, input, textarea, select, [role='button'], [data-sidebar-tree-chevron]";
const OPEN_MENU_SELECTOR = "[data-state='open']";
const BOTTOM_EDGE_ROW_SELECTOR = "[data-sidebar-edge-row='bottom']";
const TOOLTIP_META_CLASS = "text-muted-foreground";
const TITLE_SEPARATOR = " · ";

type RowTooltipSource = "hover" | "focus";

interface RowTooltipTarget {
  row: HTMLElement;
  source: RowTooltipSource;
}

export interface RowTooltipContent {
  title: string;
  meta: string;
}

function isTruncated(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return [element, ...element.querySelectorAll<HTMLElement>("*")].some(
    (candidate) =>
      candidate.clientWidth > 0 &&
      candidate.scrollWidth - candidate.clientWidth > 1,
  );
}

export function resolveRowTooltip(row: HTMLElement): RowTooltipContent | null {
  const text = row.getAttribute(TOOLTIP_ATTRIBUTE)?.trim();
  if (!text) return null;
  const titleElement = row.querySelector(TITLE_SELECTOR);
  if (row.hasAttribute(TITLE_ONLY_ATTRIBUTE) && !isTruncated(titleElement)) {
    return null;
  }
  const title = titleElement?.textContent?.trim();
  if (title && text.startsWith(`${title}${TITLE_SEPARATOR}`)) {
    return { title, meta: text.slice(title.length) };
  }
  return { title: text, meta: "" };
}

function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

export class SidebarRowTooltipController {
  private root: HTMLElement | null = null;
  private tip: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private enabled = true;
  private hovered: HTMLElement | null = null;
  private focused: HTMLElement | null = null;
  private suppressed: HTMLElement | null = null;
  private pending: RowTooltipTarget | null = null;
  private shown: RowTooltipTarget | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.hide();
  }

  attach(root: HTMLElement, tip: HTMLElement): () => void {
    this.root = root;
    this.tip = tip;
    this.scroller = root.closest<HTMLElement>(SIDEBAR_CONTENT_SELECTOR);
    const onPointerOver = (event: PointerEvent) => this.onPointerOver(event);
    const onPointerLeave = () => this.onPointerLeave();
    const onPress = (event: Event) => this.onPress(event);
    const onKeyDown = () => this.hide();
    const onFocusIn = (event: FocusEvent) => this.onFocusIn(event);
    const onFocusOut = (event: FocusEvent) => this.onFocusOut(event);
    const onScroll = () => this.onScroll();
    root.addEventListener("pointerover", onPointerOver);
    root.addEventListener("pointerleave", onPointerLeave);
    root.addEventListener("pointerdown", onPress, true);
    root.addEventListener("click", onPress, true);
    root.addEventListener("keydown", onKeyDown, true);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    this.scroller?.addEventListener("scroll", onScroll, { passive: true });
    const mutations =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => this.refresh());
    mutations?.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [TOOLTIP_ATTRIBUTE, TITLE_ONLY_ATTRIBUTE],
    });
    return () => {
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerleave", onPointerLeave);
      root.removeEventListener("pointerdown", onPress, true);
      root.removeEventListener("click", onPress, true);
      root.removeEventListener("keydown", onKeyDown, true);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      this.scroller?.removeEventListener("scroll", onScroll);
      mutations?.disconnect();
      this.hide();
      this.hovered = null;
      this.focused = null;
      this.suppressed = null;
      if (this.root === root) {
        this.root = null;
        this.tip = null;
        this.scroller = null;
      }
    };
  }

  private isEnabled(): boolean {
    const view = this.root?.ownerDocument.defaultView;
    const coarse =
      typeof view?.matchMedia === "function" &&
      view.matchMedia("(pointer: coarse)").matches;
    return this.enabled && !coarse;
  }

  private rowOf(target: EventTarget | null): HTMLElement | null {
    const root = this.root;
    if (!root || !(target instanceof Element) || !root.contains(target)) {
      return null;
    }
    const control = target.closest(CONTROL_SELECTOR);
    if (control !== null && root.contains(control)) return null;
    const row = target.closest<HTMLElement>(ROW_SELECTOR);
    return row !== null &&
      root.contains(row) &&
      row.hasAttribute(TOOLTIP_ATTRIBUTE)
      ? row
      : null;
  }

  private onPointerOver(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    const row = this.rowOf(event.target);
    if (row === this.hovered) return;
    this.hovered = row;
    if (row !== this.suppressed) this.suppressed = null;
    if (row === null || row === this.suppressed) {
      if (this.owns("hover")) this.hide();
      return;
    }
    this.schedule({ row, source: "hover" });
  }

  private onPointerLeave(): void {
    this.hovered = null;
    this.suppressed = null;
    if (this.owns("hover")) this.hide();
  }

  private onPress(event: Event): void {
    this.hide();
    this.suppressed =
      event instanceof PointerEvent && event.pointerType === "touch"
        ? null
        : (this.hovered ?? this.focused);
  }

  private onFocusIn(event: FocusEvent): void {
    const target = event.target;
    const row =
      target instanceof Element &&
      target.matches(TREE_ITEM_SELECTOR) &&
      isFocusVisible(target)
        ? this.rowOf(target)
        : null;
    if (row === null) {
      this.focused = null;
      if (this.owns("focus")) this.hide();
      return;
    }
    if (row === this.focused) return;
    this.focused = row;
    this.schedule({ row, source: "focus" });
  }

  private onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.root?.contains(next)) return;
    this.focused = null;
    if (this.owns("focus")) this.hide();
  }

  private onScroll(): void {
    this.hovered = null;
    if (this.pending?.source === "hover") this.cancel();
    this.dismiss();
  }

  private owns(source: RowTooltipSource): boolean {
    return this.pending?.source === source || this.shown?.source === source;
  }

  private schedule(target: RowTooltipTarget): void {
    if (this.shown?.row === target.row) {
      this.shown = target;
      return;
    }
    this.hide();
    if (!this.isEnabled()) return;
    this.pending = target;
    this.timer = setTimeout(() => {
      this.timer = null;
      const pending = this.pending;
      this.pending = null;
      if (pending !== null && this.isCurrent(pending)) this.show(pending);
    }, ROW_TOOLTIP_DELAY_MS);
  }

  private isCurrent({ row, source }: RowTooltipTarget): boolean {
    return (
      row.isConnected &&
      (source === "hover" ? this.hovered === row : this.focused === row)
    );
  }

  private show(target: RowTooltipTarget): void {
    const tip = this.tip;
    const row = target.row;
    if (
      !tip ||
      !this.isEnabled() ||
      row.ownerDocument.body.dataset.sidebarDragging === "true" ||
      row.matches(OPEN_MENU_SELECTOR) ||
      row.querySelector(OPEN_MENU_SELECTOR) !== null
    ) {
      return;
    }
    const content = resolveRowTooltip(row);
    if (content === null) return;
    this.render(tip, content);
    this.place(tip, row);
    this.shown = target;
  }

  private render(tip: HTMLElement, content: RowTooltipContent): void {
    const document = tip.ownerDocument;
    const title = document.createElement("span");
    title.textContent = content.title;
    if (content.meta === "") {
      tip.replaceChildren(title);
      return;
    }
    const meta = document.createElement("span");
    meta.className = TOOLTIP_META_CLASS;
    meta.textContent = content.meta;
    tip.replaceChildren(title, meta);
  }

  private place(tip: HTMLElement, row: HTMLElement): void {
    tip.style.top = "0px";
    tip.hidden = false;
    const parent = tip.offsetParent ?? tip.parentElement;
    const origin = parent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const pill = row.getBoundingClientRect();
    tip.style.left = `${Math.round(pill.left - origin.left)}px`;
    tip.style.maxWidth = `${Math.round(pill.width)}px`;
    const height = tip.offsetHeight;
    const below = pill.bottom + ROW_TOOLTIP_GAP_PX;
    const top =
      below + height > this.bottomLimit()
        ? pill.top - ROW_TOOLTIP_GAP_PX - height
        : below;
    tip.style.top = `${Math.round(top - origin.top)}px`;
  }

  private bottomLimit(): number {
    const scroller = this.scroller;
    if (!scroller) return Number.POSITIVE_INFINITY;
    const rect = scroller.getBoundingClientRect();
    let limit = rect.top + scroller.clientTop + scroller.clientHeight;
    const edgeRow = scroller.querySelector<HTMLElement>(
      BOTTOM_EDGE_ROW_SELECTOR,
    );
    const view = scroller.ownerDocument.defaultView;
    if (edgeRow && view?.getComputedStyle(edgeRow).visibility === "visible") {
      limit = Math.min(limit, edgeRow.getBoundingClientRect().top);
    }
    return limit;
  }

  private refresh(): void {
    const shown = this.shown;
    if (shown === null || !this.tip) return;
    const content = shown.row.isConnected ? resolveRowTooltip(shown.row) : null;
    if (content === null) {
      this.hide();
      return;
    }
    this.render(this.tip, content);
    this.place(this.tip, shown.row);
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private dismiss(): void {
    const tip = this.tip;
    this.shown = null;
    if (!tip || tip.hidden) return;
    tip.hidden = true;
    tip.replaceChildren();
  }

  private hide(): void {
    this.cancel();
    this.dismiss();
  }
}
