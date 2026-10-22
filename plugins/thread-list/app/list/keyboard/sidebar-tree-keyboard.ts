import { realizeWindowedItem } from "../SidebarWindowedItems.js";
import { ATTENTION_RUNG } from "../../model/thread-activity.js";

const TREE_ITEM_SELECTOR = "[data-sidebar-tree-item]";
const PLACEHOLDER_SELECTOR = "[data-sidebar-windowed-placeholder]";
const NAVIGABLE_SELECTOR = `${TREE_ITEM_SELECTOR}, ${PLACEHOLDER_SELECTOR}`;
const ATTENTION_PLACEHOLDER_SELECTOR = `${PLACEHOLDER_SELECTOR}[data-sidebar-windowed-attention]`;
const WINDOWED_ITEM_SELECTOR = "[data-sidebar-windowed-item]";
const ROW_SELECTOR = "[data-sidebar-tree-row]";
const CHEVRON_SELECTOR = ":scope > [data-sidebar-tree-chevron]";
const MENU_TRIGGER_SELECTOR = '[aria-haspopup="menu"]';
const ROW_MENU_TRIGGER_SELECTOR = "[data-thread-actions-trigger]";
const STICKY_GROUP_SELECTOR = "[data-sidebar-sticky-group]";
const STICKY_TIER_SELECTOR = ":scope > [data-sidebar-sticky-tier]";
const STICKY_STACK_SELECTOR = "[data-sidebar-sticky-stack]";
const SCROLLER_SELECTOR = '[data-sidebar="content"]';
const HIDDEN_SELECTOR = '[aria-hidden="true"], [inert], [hidden]';
const MODAL_SELECTOR = '[aria-modal="true"]';
const FOCUS_MARGIN_PX = 4;
const SCROLL_PADDING_BOTTOM_PX = 34;
const COARSE_SCROLL_PADDING_BOTTOM_PX = 46;
const COARSE_QUERY = "(max-width: 767px) and (pointer: coarse)";

type Edge = "first" | "last";
type Direction = "next" | "previous";

interface FocusedItem {
  item: HTMLElement;
  rowKey: string | null;
  index: number;
}

function levelOf(item: Element): number {
  return Number(item.getAttribute("aria-level")) || 1;
}

function expandedState(item: Element): boolean | null {
  if (item.hasAttribute("aria-haspopup")) return null;
  const value = item.getAttribute("aria-expanded");
  return value === null ? null : value === "true";
}

function rowOf(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>(ROW_SELECTOR);
}

function rungOf(item: Element): number {
  return Number(rowOf(item)?.getAttribute("data-sidebar-row-rung")) || 0;
}

function isPlaceholder(element: Element): boolean {
  return element.matches(PLACEHOLDER_SELECTOR);
}

function isNavigableIn(root: Element | null, element: HTMLElement): boolean {
  const hidden = element.closest(HIDDEN_SELECTOR);
  return hidden === null || (root !== null && hidden.contains(root));
}

export function treeItemFor(element: Element): HTMLElement | null {
  if (element.matches(TREE_ITEM_SELECTOR)) {
    return element instanceof HTMLElement ? element : null;
  }
  return rowOf(element)?.querySelector<HTMLElement>(TREE_ITEM_SELECTOR) ?? null;
}

export class SidebarTreeKeyboard {
  private root: HTMLElement | null = null;
  private focused: FocusedItem | null = null;
  private lastInputWasKey = false;
  private focusComposer: () => boolean = () => false;
  private scroller: {
    element: HTMLElement;
    top: string;
    bottom: string;
  } | null = null;
  private readonly isNavigable = (element: HTMLElement): boolean =>
    isNavigableIn(this.root, element);

  setComposerFocus(focusComposer: () => boolean): () => void {
    this.focusComposer = focusComposer;
    return () => {
      if (this.focusComposer === focusComposer) {
        this.focusComposer = () => false;
      }
    };
  }

  readonly attachRef = (root: HTMLElement | null): (() => void) | undefined =>
    root ? this.attach(root) : undefined;

  attach(root: HTMLElement): () => void {
    this.root = root;
    const onKeyDown = (event: KeyboardEvent) => this.onKeyDown(event);
    const onFocusIn = (event: FocusEvent) => this.onFocusIn(event);
    const onFocusOut = (event: FocusEvent) => this.onFocusOut(event);
    const onAnyKeyDown = () => {
      this.lastInputWasKey = true;
    };
    const onAnyPointerDown = () => {
      this.lastInputWasKey = false;
    };
    const document = root.ownerDocument;
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onAnyKeyDown, true);
    document.addEventListener("pointerdown", onAnyPointerDown, true);
    const observer = new MutationObserver(() => this.onMutations());
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-current"],
    });
    this.sync();
    return () => {
      observer.disconnect();
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onAnyKeyDown, true);
      document.removeEventListener("pointerdown", onAnyPointerDown, true);
      this.restoreScrollPadding();
      this.focused = null;
      if (this.root === root) this.root = null;
    };
  }

  contains(target: EventTarget | null): target is Element {
    return target instanceof Element && (this.root?.contains(target) ?? false);
  }

  focusAttention(from: Element, direction: Direction): boolean {
    const root = this.root;
    if (!root) return false;
    const origin = treeItemFor(from) ?? from;
    const entries = this.entries(
      `${TREE_ITEM_SELECTOR}, ${ATTENTION_PLACEHOLDER_SELECTOR}`,
    );
    const ordered = direction === "next" ? entries : [...entries].reverse();
    const startsAfter = (entry: HTMLElement) => {
      const position = origin.compareDocumentPosition(entry);
      return direction === "next"
        ? (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
            (position & Node.DOCUMENT_POSITION_CONTAINED_BY) === 0
        : (position & Node.DOCUMENT_POSITION_PRECEDING) !== 0 &&
            (position & Node.DOCUMENT_POSITION_CONTAINS) === 0;
    };
    for (const entry of ordered) {
      if (entry === origin || !startsAfter(entry)) continue;
      if (isPlaceholder(entry)) {
        realizeWindowedItem(entry, () => {
          this.focusAttention(from, direction);
        });
        return true;
      }
      if (rungOf(entry) >= ATTENTION_RUNG) {
        this.focusItem(entry);
        return true;
      }
    }
    return true;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !target.matches(TREE_ITEM_SELECTOR)
    ) {
      return;
    }
    if (!this.handleKey(event, target)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  private handleKey(event: KeyboardEvent, item: HTMLElement): boolean {
    const { key, altKey, ctrlKey, metaKey, shiftKey } = event;
    if (altKey || ctrlKey || metaKey) return false;
    if (key === "ContextMenu" || (key === "F10" && shiftKey)) {
      return this.openMenu(item);
    }
    if (key === "*") return this.expandSiblings(item);
    if (shiftKey) return false;
    switch (key) {
      case "ArrowDown":
        return this.moveFrom(item, "next");
      case "ArrowUp":
        return this.moveFrom(item, "previous");
      case "Home":
        return this.moveToEdge("first");
      case "End":
        return this.moveToEdge("last");
      case "ArrowRight":
        return this.expandOrEnter(item);
      case "ArrowLeft":
        return this.collapseOrLeave(item);
      case "Enter":
        return this.activate(item, false);
      case " ":
        return this.activate(item, true);
      case "Escape":
        return item.closest(MODAL_SELECTOR) === null
          ? this.focusComposer()
          : false;
      default:
        return false;
    }
  }

  private entries(selector = NAVIGABLE_SELECTOR): HTMLElement[] {
    const root = this.root;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
      this.isNavigable,
    );
  }

  private moveFrom(item: HTMLElement, direction: Direction): boolean {
    const entries = this.entries();
    const index = entries.indexOf(item);
    if (index === -1) return true;
    const next = entries[index + (direction === "next" ? 1 : -1)];
    if (next) this.focusEntry(next, direction === "next" ? "first" : "last");
    return true;
  }

  private moveToEdge(edge: Edge): boolean {
    const entries = this.entries();
    const entry = edge === "first" ? entries[0] : entries.at(-1);
    if (entry) this.focusEntry(entry, edge);
    return true;
  }

  private focusEntry(entry: HTMLElement, edge: Edge): void {
    if (!isPlaceholder(entry)) {
      this.focusItem(entry);
      return;
    }
    realizeWindowedItem(entry, () => {
      const inner = Array.from(
        entry.querySelectorAll<HTMLElement>(NAVIGABLE_SELECTOR),
      ).filter(this.isNavigable);
      const next = edge === "first" ? inner[0] : inner.at(-1);
      if (next) this.focusEntry(next, edge);
    });
  }

  private nextEntryAfter(
    item: HTMLElement,
    onFound: (entry: HTMLElement) => void,
  ): void {
    const entries = this.entries();
    const next = entries[entries.indexOf(item) + 1];
    if (!next) return;
    if (!isPlaceholder(next)) {
      onFound(next);
      return;
    }
    realizeWindowedItem(next, () => {
      const first = Array.from(
        next.querySelectorAll<HTMLElement>(NAVIGABLE_SELECTOR),
      ).find(this.isNavigable);
      if (first && !isPlaceholder(first)) onFound(first);
    });
  }

  private expandOrEnter(item: HTMLElement): boolean {
    const expanded = expandedState(item);
    if (expanded === false) {
      this.toggle(item);
      return true;
    }
    if (expanded === true) {
      const level = levelOf(item);
      this.nextEntryAfter(item, (entry) => {
        if (levelOf(entry) > level) this.focusItem(entry);
      });
    }
    return true;
  }

  private collapseOrLeave(item: HTMLElement): boolean {
    if (expandedState(item) === true) {
      this.toggle(item);
      return true;
    }
    const parent = this.parentOf(item);
    if (parent) this.focusItem(parent);
    return true;
  }

  private parentOf(item: HTMLElement): HTMLElement | null {
    const level = levelOf(item);
    if (level <= 1) return null;
    const items = this.entries(TREE_ITEM_SELECTOR);
    for (let index = items.indexOf(item) - 1; index >= 0; index -= 1) {
      const candidate = items[index];
      if (candidate && levelOf(candidate) < level) return candidate;
    }
    return null;
  }

  private toggle(item: HTMLElement): void {
    const chevron = rowOf(item)?.querySelector<HTMLElement>(CHEVRON_SELECTOR);
    (chevron ?? item).click();
  }

  private activate(item: HTMLElement, isSpace: boolean): boolean {
    if (item.matches(MENU_TRIGGER_SELECTOR)) return false;
    if (
      expandedState(item) !== null &&
      (isSpace || !(item instanceof HTMLAnchorElement))
    ) {
      this.toggle(item);
      return true;
    }
    if (item instanceof HTMLAnchorElement) {
      if (!isSpace) return false;
      item.click();
      return true;
    }
    item.click();
    return true;
  }

  private expandSiblings(item: HTMLElement): boolean {
    const level = levelOf(item);
    const parent = this.parentOf(item);
    const expand = (candidate: HTMLElement) => {
      if (levelOf(candidate) === level && expandedState(candidate) === false) {
        this.toggle(candidate);
      }
    };
    const items = this.entries(TREE_ITEM_SELECTOR);
    const start = parent ? items.indexOf(parent) + 1 : 0;
    for (const candidate of items.slice(start)) {
      if (parent && levelOf(candidate) <= levelOf(parent)) break;
      expand(candidate);
    }
    const wrapper = item.closest(WINDOWED_ITEM_SELECTOR);
    for (const sibling of Array.from(wrapper?.parentElement?.children ?? [])) {
      if (!sibling.matches(PLACEHOLDER_SELECTOR)) continue;
      realizeWindowedItem(sibling, () => {
        const row = sibling.querySelector<HTMLElement>(TREE_ITEM_SELECTOR);
        if (row) expand(row);
      });
    }
    return true;
  }

  private openMenu(item: HTMLElement): boolean {
    const row = rowOf(item) ?? item;
    const rect = row.getBoundingClientRect();
    const opened = !item.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 2,
        clientX: rect.left + Math.min(24, rect.width / 2),
        clientY: rect.bottom,
      }),
    );
    if (opened) return true;
    const triggers = Array.from(
      row.querySelectorAll<HTMLElement>(
        `${ROW_MENU_TRIGGER_SELECTOR}, ${MENU_TRIGGER_SELECTOR}`,
      ),
    );
    const trigger =
      triggers.find((candidate) =>
        candidate.matches(ROW_MENU_TRIGGER_SELECTOR),
      ) ?? triggers.at(-1);
    if (!trigger) return true;
    this.returnFocusFrom(trigger, item);
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        code: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    return true;
  }

  private returnFocusFrom(trigger: HTMLElement, item: HTMLElement): void {
    const root = this.root;
    if (!root) return;
    const onFocusIn = (event: FocusEvent) => {
      root.removeEventListener("focusin", onFocusIn, true);
      if (event.target === trigger && item.isConnected) {
        item.focus({ preventScroll: true });
      }
    };
    root.addEventListener("focusin", onFocusIn, true);
  }

  focusItem(item: HTMLElement): void {
    item.focus({ preventScroll: true });
    this.revealFocused(item);
  }

  private revealFocused(item: HTMLElement): void {
    const row = rowOf(item) ?? item;
    const scroller = row.closest<HTMLElement>(SCROLLER_SELECTOR);
    if (!scroller) return;
    const { top, bottom } = this.applyScrollPadding(row, scroller);
    const view = scroller.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    const minTop = view.top + scroller.clientTop + top;
    const maxBottom =
      view.top + scroller.clientTop + scroller.clientHeight - bottom;
    const isSticky =
      scroller.ownerDocument.defaultView?.getComputedStyle(row).position ===
      "sticky";
    if (rect.top < minTop && !isSticky) {
      scroller.scrollTop -= minTop - rect.top;
    } else if (rect.bottom > maxBottom) {
      scroller.scrollTop += Math.min(
        rect.bottom - maxBottom,
        Math.max(0, rect.top - minTop),
      );
    }
  }

  private applyScrollPadding(
    row: HTMLElement,
    scroller: HTMLElement,
  ): { top: number; bottom: number } {
    if (this.scroller?.element !== scroller) {
      this.restoreScrollPadding();
      this.scroller = {
        element: scroller,
        top: scroller.style.scrollPaddingTop,
        bottom: scroller.style.scrollPaddingBottom,
      };
    }
    const view = scroller.ownerDocument.defaultView;
    const stack = row.closest(STICKY_STACK_SELECTOR);
    let stuckBottom = stack
      ? Number.parseFloat(view?.getComputedStyle(stack).paddingTop ?? "") || 0
      : 0;
    for (
      let group = row.parentElement?.closest(STICKY_GROUP_SELECTOR) ?? null;
      group !== null;
      group = group.parentElement?.closest(STICKY_GROUP_SELECTOR) ?? null
    ) {
      const tier = group.querySelector<HTMLElement>(STICKY_TIER_SELECTOR);
      if (!tier || tier === row || tier.contains(row)) continue;
      const style = view?.getComputedStyle(tier);
      if (style?.position !== "sticky") continue;
      const tierTop = Number.parseFloat(style.top) || 0;
      stuckBottom = Math.max(
        stuckBottom,
        tierTop + tier.getBoundingClientRect().height,
      );
    }
    const top = Math.ceil(stuckBottom + FOCUS_MARGIN_PX);
    const bottom = view?.matchMedia?.(COARSE_QUERY).matches
      ? COARSE_SCROLL_PADDING_BOTTOM_PX
      : SCROLL_PADDING_BOTTOM_PX;
    scroller.style.scrollPaddingTop = `${top}px`;
    scroller.style.scrollPaddingBottom = `${bottom}px`;
    return { top, bottom };
  }

  private restoreScrollPadding(): void {
    const saved = this.scroller;
    this.scroller = null;
    if (!saved) return;
    saved.element.style.scrollPaddingTop = saved.top;
    saved.element.style.scrollPaddingBottom = saved.bottom;
  }

  private onFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const item = treeItemFor(target);
    if (!item) return;
    const items = this.entries();
    this.focused = {
      item,
      rowKey: rowOf(item)?.getAttribute("data-sidebar-row-key") ?? null,
      index: items.indexOf(item),
    };
    this.setTabStop(item);
    if (target === item && this.lastInputWasKey) this.revealFocused(item);
  }

  private onFocusOut(event: FocusEvent): void {
    if (this.contains(event.relatedTarget)) return;
    queueMicrotask(() => this.afterFocusLeft());
  }

  private afterFocusLeft(): void {
    const root = this.root;
    if (!root) return;
    const active = root.ownerDocument.activeElement;
    if (active && root.contains(active)) return;
    const focused = this.focused;
    if (focused && this.wasRemovedWhileFocused(focused)) {
      this.recover(focused);
      return;
    }
    this.focused = null;
    this.sync();
  }

  private wasRemovedWhileFocused(focused: FocusedItem): boolean {
    return (
      this.lastInputWasKey && !focused.item.isConnected && this.isFocusLost()
    );
  }

  private isFocusLost(): boolean {
    const document = this.root?.ownerDocument;
    if (!document) return false;
    return (
      document.activeElement === null ||
      document.activeElement === document.body
    );
  }

  private onMutations(): void {
    const focused = this.focused;
    if (focused && this.wasRemovedWhileFocused(focused)) {
      this.recover(focused);
      return;
    }
    this.sync();
  }

  private recover(focused: FocusedItem): void {
    const root = this.root;
    this.focused = null;
    if (!root) return;
    const sameRow = Array.from(
      root.querySelectorAll<HTMLElement>("[data-sidebar-row-key]"),
    )
      .find(
        (row) => row.getAttribute("data-sidebar-row-key") === focused.rowKey,
      )
      ?.querySelector<HTMLElement>(TREE_ITEM_SELECTOR);
    if (sameRow && this.isNavigable(sameRow)) {
      this.focusItem(sameRow);
      return;
    }
    const entries = this.entries();
    const next = entries[Math.min(focused.index, entries.length - 1)];
    if (next) {
      this.focusEntry(next, "first");
      return;
    }
    this.sync();
  }

  private sync(): void {
    const root = this.root;
    if (!root) return;
    const active = root.ownerDocument.activeElement;
    const focusedItem =
      active instanceof Element && root.contains(active)
        ? treeItemFor(active)
        : null;
    const next =
      focusedItem ??
      root.querySelector<HTMLElement>(
        `${TREE_ITEM_SELECTOR}[aria-current="page"]`,
      ) ??
      this.entries(TREE_ITEM_SELECTOR)[0] ??
      null;
    this.setTabStop(next);
  }

  private setTabStop(next: HTMLElement | null): void {
    const root = this.root;
    if (!root) return;
    if (next && next.tabIndex !== 0) next.tabIndex = 0;
    for (const other of root.querySelectorAll<HTMLElement>(
      `${TREE_ITEM_SELECTOR}[tabindex="0"]`,
    )) {
      if (other !== next) other.tabIndex = -1;
    }
  }
}
