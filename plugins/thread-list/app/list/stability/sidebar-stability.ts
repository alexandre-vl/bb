import { SIDEBAR_CONTENT_SELECTOR } from "../../ui/sidebar.js";

export const POINTER_STILL_RELEASE_MS = 2000;
export const POINTER_MOVE_THRESHOLD_PX = 3;
export const GATED_CLICK_WINDOW_MS = 500;
export const REORDER_ANIMATION_MS = 160;

const ROW_SELECTOR = "[data-sidebar-tree-row][data-sidebar-row-key]";
const POINTER_GATE_ATTRIBUTE = "data-sidebar-pointer-gate";
const ARCHIVE_GUARD_ATTRIBUTE = "data-sidebar-archive-guard";
const ARCHIVE_ACTION_SELECTOR = '[data-thread-action="bb--core/archive"]';

export interface SidebarRowAnchor {
  key: string;
  top: number;
}

export interface SidebarOrderMeasurement {
  anchor: SidebarRowAnchor | null;
  positions: ReadonlyMap<string, number>;
  rowUnderPointer: string | null;
  scrollTop: number | null;
  viewport: { top: number; bottom: number } | null;
}

export interface SidebarOrderState<Version> {
  deferred: boolean;
  kept: ReadonlyMap<string, Version>;
  held: ReadonlySet<string>;
  revision: number;
}

interface MeasuredRow {
  key: string;
  element: HTMLElement;
  top: number;
}

type Listener = () => void;

export function resolveCompensatedScrollTop({
  scrollTop,
  delta,
  maxScrollTop,
}: {
  scrollTop: number;
  delta: number;
  maxScrollTop: number;
}): number | null {
  const next = scrollTop + delta;
  if (next < -0.5 || next > maxScrollTop + 0.5) return null;
  return Math.min(Math.max(next, 0), maxScrollTop);
}

function rowKeyOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return (
    target.closest<HTMLElement>(ROW_SELECTOR)?.dataset.sidebarRowKey ?? null
  );
}

function prefersReducedMotion(root: HTMLElement): boolean {
  const view = root.ownerDocument.defaultView;
  return (
    typeof view?.matchMedia === "function" &&
    view.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isStuck(
  row: HTMLElement,
  top: number,
  scroller: HTMLElement | null,
): boolean {
  if (!scroller || !row.hasAttribute("data-sidebar-sticky-tier")) return false;
  const style = row.ownerDocument.defaultView?.getComputedStyle(row);
  if (style?.position !== "sticky") return false;
  const offset = Number.parseFloat(style.top);
  if (!Number.isFinite(offset)) return false;
  const scrollportTop =
    scroller.getBoundingClientRect().top + scroller.clientTop;
  return top <= scrollportTop + offset + 0.5;
}

function sameKeys(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}

function isOutsideViewport(
  element: HTMLElement,
  top: number,
  viewport: { top: number; bottom: number } | null,
): boolean {
  if (viewport === null) return false;
  const bottom = top + element.getBoundingClientRect().height;
  return bottom <= viewport.top || top >= viewport.bottom;
}

function sameEntries<Version>(
  left: ReadonlyMap<string, Version>,
  right: ReadonlyMap<string, Version>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function swallow(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

export class SidebarStabilityController<Version extends { id: string }> {
  private root: HTMLElement | null = null;
  private pointerInside = false;
  private pointerPressed = false;
  private pointerX = 0;
  private pointerY = 0;
  private movedFromX = Number.NaN;
  private movedFromY = Number.NaN;
  private hoverKey: string | null = null;
  private hoverHeld = true;
  private focusKey: string | null = null;
  private lastInputWasKey = false;
  private stillTimer: ReturnType<typeof setTimeout> | null = null;
  private state: SidebarOrderState<Version> = {
    deferred: false,
    kept: new Map(),
    held: new Set(),
    revision: 0,
  };
  private readonly listeners = new Set<Listener>();
  private appliedFrom: {
    threads: readonly Version[];
    kept: ReadonlyMap<string, Version>;
  } | null = null;
  private applied: ReadonlyMap<string, Version> = new Map();
  private staleKeys: ReadonlySet<string> = new Set();
  private revert: SidebarOrderMeasurement | null = null;
  private releasing = false;
  private committing: { focused: HTMLElement | null } | null = null;
  private gateKey: string | null = null;
  private gateAt = 0;
  private gateStill = false;
  private archivedKey: string | null = null;
  private guardedRow: HTMLElement | null = null;
  private readonly animations = new Set<Animation>();
  private nativeAnchoring: { scroller: HTMLElement; inline: string } | null =
    null;
  private nativeAnchoringFrame: number | null = null;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): SidebarOrderState<Version> => this.state;

  readonly attachRef = (root: HTMLElement | null): (() => void) | undefined =>
    root ? this.attach(root) : undefined;

  attach(root: HTMLElement): () => void {
    this.root = root;
    const document = root.ownerDocument;
    const onPointerMove = (event: PointerEvent) => this.onPointerMove(event);
    const onPointerLeave = () => this.onPointerLeave();
    const onFocusIn = (event: FocusEvent) => this.onFocusIn(event);
    const onFocusOut = (event: FocusEvent) => this.onFocusOut(event);
    const onClick = (event: MouseEvent) => this.onClickCapture(event);
    const onKeyDown = (event: KeyboardEvent) => this.onDocumentKeyDown(event);
    const onPointerDown = () => {
      this.pointerPressed = true;
      this.lastInputWasKey = false;
    };
    const onPointerUp = () => {
      this.pointerPressed = false;
    };
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerleave", onPointerLeave);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    root.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    return () => {
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
      this.clearStillTimer();
      this.clearGate();
      this.gateKey = null;
      this.clearArchiveGuard();
      this.finishAnimations();
      this.restoreNativeAnchoring();
      this.committing = null;
      this.pointerInside = false;
      this.hoverKey = null;
      this.hoverHeld = true;
      this.focusKey = null;
      this.archivedKey = null;
      if (this.root === root) this.root = null;
    };
  }

  measure(): SidebarOrderMeasurement | null {
    const root = this.root;
    if (!root || this.isDragging()) return null;
    this.finishAnimations();
    const active = root.ownerDocument.activeElement;
    this.committing = {
      focused:
        active instanceof HTMLElement && root.contains(active) ? active : null,
    };
    const rows = this.measureRows();
    const scroller = this.scroller();
    this.suspendNativeAnchoring(scroller);
    const rect = scroller?.getBoundingClientRect() ?? null;
    const viewport = rect && { top: rect.top, bottom: rect.bottom };
    return {
      anchor: this.resolveAnchor(rows, viewport),
      positions: new Map(rows.map((row) => [row.key, row.top])),
      rowUnderPointer: this.rowUnderPointer(),
      scrollTop: scroller?.scrollTop ?? null,
      viewport,
    };
  }

  commit(
    measurement: SidebarOrderMeasurement | null,
    threads: readonly Version[],
    kept: ReadonlyMap<string, Version>,
  ): void {
    const releasing = this.releasing;
    this.releasing = false;
    this.restoreFocus();
    this.scheduleNativeAnchoringRestore();
    const revert = this.revert;
    if (revert !== null) {
      this.revert = null;
      const scroller = this.scroller();
      if (scroller && revert.scrollTop !== null) {
        scroller.scrollTop = revert.scrollTop;
      }
      this.apply(threads, kept);
      this.settle(revert);
      return;
    }
    if (measurement === null) {
      this.apply(threads, kept);
      return;
    }
    const orderInputsChanged =
      this.appliedFrom !== null &&
      (this.appliedFrom.threads !== threads || this.appliedFrom.kept !== kept);
    const compensation = this.compensate(measurement);
    if (
      compensation === "impossible" &&
      measurement.anchor !== null &&
      orderInputsChanged &&
      !releasing &&
      !this.state.deferred
    ) {
      this.revert = measurement;
      this.setState({ deferred: true, kept: this.applied });
      this.restartStillTimer();
      return;
    }
    this.apply(threads, kept);
    this.settle(measurement);
    if (
      this.stillTimer === null &&
      this.pointerInside &&
      this.hoverHeld &&
      this.hoverKey !== null &&
      this.staleKeys.has(this.hoverKey)
    ) {
      this.restartStillTimer();
    }
  }

  release({ still = false }: { still?: boolean } = {}): void {
    this.clearStillTimer();
    if (still) this.hoverHeld = false;
    const kept = this.heldVersions(this.state.kept);
    if (!this.state.deferred && !this.hasUnheldStaleKeys()) {
      if (!sameEntries(kept, this.state.kept)) {
        this.state = { ...this.state, kept };
      }
      return;
    }
    this.releasing = true;
    this.setState({ deferred: false, kept });
  }

  private suspendNativeAnchoring(scroller: HTMLElement | null): void {
    this.cancelNativeAnchoringRestore();
    if (!scroller || this.nativeAnchoring?.scroller === scroller) return;
    this.restoreNativeAnchoring();
    this.nativeAnchoring = { scroller, inline: scroller.style.overflowAnchor };
    scroller.style.overflowAnchor = "none";
  }

  private scheduleNativeAnchoringRestore(): void {
    const view = this.root?.ownerDocument.defaultView;
    if (this.nativeAnchoring === null) return;
    if (!view || typeof view.requestAnimationFrame !== "function") {
      this.restoreNativeAnchoring();
      return;
    }
    this.cancelNativeAnchoringRestore();
    this.nativeAnchoringFrame = view.requestAnimationFrame(() => {
      this.nativeAnchoringFrame = view.requestAnimationFrame(() => {
        this.nativeAnchoringFrame = null;
        this.restoreNativeAnchoring();
      });
    });
  }

  private cancelNativeAnchoringRestore(): void {
    if (this.nativeAnchoringFrame === null) return;
    this.root?.ownerDocument.defaultView?.cancelAnimationFrame(
      this.nativeAnchoringFrame,
    );
    this.nativeAnchoringFrame = null;
  }

  private restoreNativeAnchoring(): void {
    this.cancelNativeAnchoringRestore();
    const suspended = this.nativeAnchoring;
    if (suspended === null) return;
    this.nativeAnchoring = null;
    suspended.scroller.style.overflowAnchor = suspended.inline;
  }

  private restoreFocus(): void {
    const focused = this.committing?.focused ?? null;
    this.committing = null;
    if (
      focused?.isConnected &&
      focused.ownerDocument.activeElement !== focused
    ) {
      focused.focus({ preventScroll: true });
    }
  }

  private setState({
    deferred,
    kept,
  }: {
    deferred: boolean;
    kept: ReadonlyMap<string, Version>;
  }): void {
    this.state = {
      deferred,
      kept,
      held: this.state.held,
      revision: this.state.revision + 1,
    };
    for (const listener of this.listeners) listener();
  }

  private apply(
    threads: readonly Version[],
    kept: ReadonlyMap<string, Version>,
  ): void {
    if (this.appliedFrom?.threads === threads && this.appliedFrom.kept === kept)
      return;
    this.appliedFrom = { threads, kept };
    const applied = new Map<string, Version>();
    const stale = new Set<string>();
    for (const thread of threads) {
      const version = kept.get(thread.id) ?? thread;
      applied.set(thread.id, version);
      if (version !== thread) stale.add(thread.id);
    }
    this.applied = applied;
    this.staleKeys = stale;
  }

  private heldVersions(
    current: ReadonlyMap<string, Version>,
  ): ReadonlyMap<string, Version> {
    const next = new Map<string, Version>();
    for (const key of [this.hoverHeld ? this.hoverKey : null, this.focusKey]) {
      if (key === null || next.has(key)) continue;
      const version = current.get(key) ?? this.applied.get(key);
      if (version !== undefined) next.set(key, version);
    }
    return next;
  }

  private setHeld(kind: "hover" | "focus", key: string | null): void {
    if ((kind === "hover" ? this.hoverKey : this.focusKey) === key) return;
    if (kind === "hover") {
      this.hoverKey = key;
      this.hoverHeld = true;
    } else {
      this.focusKey = key;
    }
    this.refreshHeld();
  }

  private refreshHeld(): void {
    const held = new Set<string>();
    if (this.hoverKey !== null) held.add(this.hoverKey);
    if (this.focusKey !== null) held.add(this.focusKey);
    const kept = this.state.deferred
      ? this.state.kept
      : this.heldVersions(this.state.kept);
    const nextHeld = sameKeys(held, this.state.held) ? this.state.held : held;
    const nextKept = sameEntries(kept, this.state.kept)
      ? this.state.kept
      : kept;
    if (nextHeld !== this.state.held || nextKept !== this.state.kept) {
      this.state = { ...this.state, held: nextHeld, kept: nextKept };
    }
  }

  private hasUnheldStaleKeys(): boolean {
    const hover = this.hoverHeld ? this.hoverKey : null;
    for (const key of this.staleKeys) {
      if (key !== hover && key !== this.focusKey) return true;
    }
    return false;
  }

  private isDragging(): boolean {
    return (
      this.pointerPressed ||
      this.root?.ownerDocument.body.dataset.sidebarDragging === "true"
    );
  }

  private scroller(): HTMLElement | null {
    return this.root?.closest<HTMLElement>(SIDEBAR_CONTENT_SELECTOR) ?? null;
  }

  private measureRows(): MeasuredRow[] {
    const root = this.root;
    if (!root) return [];
    const rows: MeasuredRow[] = [];
    for (const element of root.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
      const key = element.dataset.sidebarRowKey;
      if (key) {
        rows.push({ key, element, top: element.getBoundingClientRect().top });
      }
    }
    return rows;
  }

  private findRow(key: string): HTMLElement | null {
    const root = this.root;
    if (!root) return null;
    for (const row of root.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
      if (row.dataset.sidebarRowKey === key) return row;
    }
    return null;
  }

  private anchorKey(): string | null {
    if (this.lastInputWasKey && this.focusKey !== null) return this.focusKey;
    return this.rowUnderPointer();
  }

  private resolveAnchor(
    rows: readonly MeasuredRow[],
    viewport: { top: number; bottom: number } | null,
  ): SidebarRowAnchor | null {
    const key = this.anchorKey();
    if (key === null) return null;
    const index = rows.findIndex((row) => row.key === key);
    const row = rows[index];
    if (row === undefined || isOutsideViewport(row.element, row.top, viewport))
      return null;
    const scroller = this.scroller();
    if (!isStuck(row.element, row.top, scroller)) {
      return { key: row.key, top: row.top };
    }
    const bottom = row.top + row.element.getBoundingClientRect().height;
    for (const candidate of rows.slice(index + 1)) {
      if (
        candidate.top >= bottom - 0.5 &&
        !isStuck(candidate.element, candidate.top, scroller)
      ) {
        return isOutsideViewport(candidate.element, candidate.top, viewport)
          ? null
          : { key: candidate.key, top: candidate.top };
      }
    }
    return null;
  }

  private rowUnderPointer(): string | null {
    const root = this.root;
    if (!root || !this.pointerInside) return null;
    const document = root.ownerDocument;
    if (typeof document.elementFromPoint !== "function") return this.hoverKey;
    const element = document.elementFromPoint(this.pointerX, this.pointerY);
    return element !== null && root.contains(element)
      ? rowKeyOf(element)
      : null;
  }

  private anchorDelta(anchor: SidebarRowAnchor): number | null {
    const row = this.findRow(anchor.key);
    return row ? row.getBoundingClientRect().top - anchor.top : null;
  }

  private prevailingDelta(before: SidebarOrderMeasurement): number | null {
    const viewport = before.viewport;
    if (viewport === null) return null;
    const counts = new Map<number, number>();
    for (const row of this.measureRows()) {
      if (row.element.hasAttribute("data-sidebar-sticky-tier")) continue;
      const from = before.positions.get(row.key);
      if (
        from === undefined ||
        from < viewport.top ||
        from >= viewport.bottom
      ) {
        continue;
      }
      const delta = Math.round(row.top - from);
      counts.set(delta, (counts.get(delta) ?? 0) + 1);
    }
    let prevailing: number | null = null;
    let prevailingCount = 0;
    for (const [delta, count] of counts) {
      if (
        count > prevailingCount ||
        (count === prevailingCount &&
          prevailing !== null &&
          Math.abs(delta) < Math.abs(prevailing))
      ) {
        prevailing = delta;
        prevailingCount = count;
      }
    }
    return prevailing;
  }

  private compensate(
    measurement: SidebarOrderMeasurement,
  ): "none" | "scrolled" | "impossible" {
    if (measurement.anchor === null && (measurement.scrollTop ?? 0) < 0.5) {
      return "none";
    }
    const delta =
      measurement.anchor === null
        ? this.prevailingDelta(measurement)
        : this.anchorDelta(measurement.anchor);
    if (delta === null || Math.abs(delta) < 0.5) return "none";
    const scroller = this.scroller();
    if (!scroller) return "impossible";
    const next = resolveCompensatedScrollTop({
      scrollTop: scroller.scrollTop,
      delta,
      maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
    });
    if (next === null) return "impossible";
    scroller.scrollTop = next;
    return "scrolled";
  }

  private settle(before: SidebarOrderMeasurement): void {
    const after = this.rowUnderPointer();
    const previous = before.rowUnderPointer;
    if (this.pointerInside && after !== null && after !== previous) {
      const archived =
        previous !== null &&
        previous === this.archivedKey &&
        this.findRow(previous) === null;
      if (archived) this.guardArchive(after);
      else this.setGate(after);
    }
    if (this.archivedKey !== null && this.findRow(this.archivedKey) === null) {
      this.archivedKey = null;
    }
    this.animateFrom(before.positions);
  }

  private onPointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    if (event.buttons === 0) this.pointerPressed = false;
    this.pointerInside = true;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.lastInputWasKey = false;
    this.setHeld("hover", rowKeyOf(event.target));
    const distance = Math.hypot(
      event.clientX - this.movedFromX,
      event.clientY - this.movedFromY,
    );
    if (distance <= POINTER_MOVE_THRESHOLD_PX) return;
    this.movedFromX = event.clientX;
    this.movedFromY = event.clientY;
    this.clearGate();
    this.clearArchiveGuard();
    if (!this.hoverHeld) {
      this.hoverHeld = true;
      this.refreshHeld();
    }
    if (this.state.deferred || this.staleKeys.size > 0) {
      this.restartStillTimer();
    }
  }

  private onPointerLeave(): void {
    this.pointerInside = false;
    this.movedFromX = Number.NaN;
    this.movedFromY = Number.NaN;
    this.clearGate();
    this.gateKey = null;
    this.archivedKey = null;
    this.clearArchiveGuard();
    this.setHeld("hover", null);
    this.release();
  }

  private onFocusIn(event: FocusEvent): void {
    if (this.committing !== null) return;
    const previous = this.focusKey;
    const key = rowKeyOf(event.target);
    this.setHeld("focus", key);
    if (previous !== null && key !== previous) this.release();
  }

  private onFocusOut(event: FocusEvent): void {
    if (this.committing !== null) return;
    const next = event.relatedTarget;
    if (next instanceof Node && this.root?.contains(next)) return;
    if (this.focusKey === null) return;
    this.setHeld("focus", null);
    this.release();
  }

  private onDocumentKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    if (target instanceof Node && this.root?.contains(target)) {
      this.lastInputWasKey = true;
      if (this.state.deferred) this.restartStillTimer();
      return;
    }
    this.release();
  }

  private onClickCapture(event: MouseEvent): void {
    if (this.isGuardedArchiveClick(event)) {
      swallow(event);
      return;
    }
    const gateKey = this.gateKey;
    this.gateKey = null;
    if (
      gateKey !== null &&
      Date.now() - this.gateAt < GATED_CLICK_WINDOW_MS &&
      (this.gateStill || rowKeyOf(event.target) === gateKey)
    ) {
      swallow(event);
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest(ARCHIVE_ACTION_SELECTOR) !== null
    ) {
      this.archivedKey = rowKeyOf(event.target);
    }
  }

  private isGuardedArchiveClick(event: MouseEvent): boolean {
    const row = this.guardedRow;
    if (!row?.isConnected) return false;
    const action = row.querySelector<HTMLElement>(ARCHIVE_ACTION_SELECTOR);
    if (!action) return false;
    const rect = action.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  private restartStillTimer(): void {
    this.clearStillTimer();
    this.stillTimer = setTimeout(() => {
      this.stillTimer = null;
      this.release({ still: true });
    }, POINTER_STILL_RELEASE_MS);
  }

  private clearStillTimer(): void {
    if (this.stillTimer !== null) {
      clearTimeout(this.stillTimer);
      this.stillTimer = null;
    }
  }

  private setGate(rowKey: string): void {
    this.gateKey = rowKey;
    this.gateAt = Date.now();
    this.gateStill = true;
    this.root?.setAttribute(POINTER_GATE_ATTRIBUTE, "true");
  }

  private clearGate(): void {
    this.gateStill = false;
    this.root?.removeAttribute(POINTER_GATE_ATTRIBUTE);
  }

  private guardArchive(rowKey: string): void {
    const row = this.findRow(rowKey);
    if (!row || row.dataset.sidebarRowRisky !== "true") return;
    this.clearArchiveGuard();
    row.setAttribute(ARCHIVE_GUARD_ATTRIBUTE, "true");
    this.guardedRow = row;
  }

  private clearArchiveGuard(): void {
    this.guardedRow?.removeAttribute(ARCHIVE_GUARD_ATTRIBUTE);
    this.guardedRow = null;
  }

  private finishAnimations(): void {
    for (const animation of this.animations) animation.finish();
    this.animations.clear();
  }

  private animateFrom(before: ReadonlyMap<string, number>): void {
    const root = this.root;
    if (!root || prefersReducedMotion(root)) return;
    const viewportHeight = root.ownerDocument.defaultView?.innerHeight ?? 0;
    for (const row of root.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
      const key = row.dataset.sidebarRowKey;
      const from = key === undefined ? undefined : before.get(key);
      if (from === undefined || typeof row.animate !== "function") continue;
      const rect = row.getBoundingClientRect();
      const delta = from - rect.top;
      if (Math.abs(delta) < 1) continue;
      if (
        Math.min(from, rect.top) > viewportHeight ||
        Math.max(from, rect.top) + rect.height < 0
      ) {
        continue;
      }
      const animation = row.animate(
        [
          { transform: `translateY(${delta}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: REORDER_ANIMATION_MS, easing: "ease-out" },
      );
      this.animations.add(animation);
      animation.addEventListener("finish", () => {
        this.animations.delete(animation);
      });
    }
  }
}
