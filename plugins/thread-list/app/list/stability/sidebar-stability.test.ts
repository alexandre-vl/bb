// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GATED_CLICK_WINDOW_MS,
  POINTER_STILL_RELEASE_MS,
  SidebarStabilityController,
  resolveCompensatedScrollTop,
} from "./sidebar-stability.js";

const ROW_HEIGHT = 30;
const VIEWPORT_HEIGHT = 90;

interface Entry {
  id: string;
  revision: number;
}

let scroller: HTMLDivElement;
let root: HTMLDivElement;
let scrollTop = 0;
let controller: SidebarStabilityController<Entry>;
let detach: () => void;
let notifications = 0;
const originalElementFromPoint = document.elementFromPoint;

function rows(): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-sidebar-row-key]")];
}

function row(key: string): HTMLElement {
  const element = rows().find((candidate) => candidate.dataset.sidebarRowKey === key);
  if (!element) throw new Error(`missing row ${key}`);
  return element;
}

function rowTop(element: HTMLElement): number {
  return rows().indexOf(element) * ROW_HEIGHT - scrollTop;
}

function renderRows(keys: readonly string[], risky: readonly string[] = []) {
  const existing = new Map(rows().map((element) => [element.dataset.sidebarRowKey, element]));
  root.replaceChildren(
    ...keys.map((key) => {
      const element = existing.get(key) ?? document.createElement("div");
      element.setAttribute("data-sidebar-tree-row", "");
      element.setAttribute("data-sidebar-row-key", key);
      if (risky.includes(key)) element.setAttribute("data-sidebar-row-risky", "true");
      else element.removeAttribute("data-sidebar-row-risky");
      if (!element.querySelector("button")) {
        const archive = document.createElement("button");
        archive.setAttribute("data-thread-action", "bb--core/archive");
        archive.dataset.archiveFor = key;
        element.append(archive);
      }
      return element;
    }),
  );
}

function entries(keys: readonly string[], revision = 0): Entry[] {
  return keys.map((id) => ({ id, revision }));
}

function pointAt(key: string): { clientX: number; clientY: number } {
  return { clientX: 20, clientY: rowTop(row(key)) + ROW_HEIGHT / 2 };
}

function movePointer(target: HTMLElement, point: { clientX: number; clientY: number }) {
  target.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, ...point }));
}

function click(target: HTMLElement, point: { clientX: number; clientY: number }) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...point });
  target.dispatchEvent(event);
  return event;
}

function update(
  keys: readonly string[],
  threads: readonly Entry[],
  risky: readonly string[] = [],
) {
  const measurement = controller.measure();
  renderRows(keys, risky);
  controller.commit(measurement, threads, controller.getState().kept);
}

beforeEach(() => {
  vi.useFakeTimers();
  scrollTop = 0;
  notifications = 0;
  scroller = document.createElement("div");
  scroller.setAttribute("data-sidebar", "content");
  Object.defineProperties(scroller, {
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    },
    clientHeight: { configurable: true, get: () => VIEWPORT_HEIGHT },
    scrollHeight: {
      configurable: true,
      get: () => rows().length * ROW_HEIGHT,
    },
  });
  root = document.createElement("div");
  scroller.append(root);
  document.body.append(scroller);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this === scroller) return new DOMRect(0, 0, 300, VIEWPORT_HEIGHT);
      const host = this.closest<HTMLElement>("[data-sidebar-row-key]");
      if (!host || !root.contains(host)) return new DOMRect(0, 0, 0, 0);
      const top = rowTop(host);
      return this === host
        ? new DOMRect(0, top, 300, ROW_HEIGHT)
        : new DOMRect(240, top + 4, 22, 22);
    },
  );
  document.elementFromPoint = (x: number, y: number) => {
    const hit = rows().find((element) => {
      const top = rowTop(element);
      return y >= top && y < top + ROW_HEIGHT;
    });
    if (!hit) return null;
    const archive = hit.querySelector("button");
    return archive && x >= 240 && x <= 262 ? archive : hit;
  };
  controller = new SidebarStabilityController<Entry>();
  controller.subscribe(() => {
    notifications += 1;
  });
  detach = controller.attach(root);
});

afterEach(() => {
  detach();
  scroller.remove();
  document.elementFromPoint = originalElementFromPoint;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("resolveCompensatedScrollTop", () => {
  it("returns the shifted offset inside the scroll range", () => {
    expect(resolveCompensatedScrollTop({ scrollTop: 30, delta: 30, maxScrollTop: 60 })).toBe(60);
    expect(resolveCompensatedScrollTop({ scrollTop: 30, delta: -30, maxScrollTop: 60 })).toBe(0);
  });

  it("refuses an offset the scroller cannot reach", () => {
    expect(resolveCompensatedScrollTop({ scrollTop: 60, delta: 30, maxScrollTop: 60 })).toBeNull();
    expect(resolveCompensatedScrollTop({ scrollTop: 0, delta: -30, maxScrollTop: 60 })).toBeNull();
  });
});

describe("SidebarStabilityController", () => {
  const order = ["a", "b", "c", "d", "e"];

  beforeEach(() => {
    renderRows(order);
    controller.commit(null, entries(order), new Map());
  });

  it("scrolls to keep the hovered row still when a row moves above it", () => {
    scrollTop = 30;
    movePointer(row("c"), pointAt("c"));
    const before = rowTop(row("c"));

    update(["e", "a", "b", "c", "d"], entries(order, 1));

    expect(rowTop(row("c"))).toBe(before);
    expect(scrollTop).toBe(60);
    expect(controller.getState().deferred).toBe(false);
  });

  it("keeps the previous order when the scroller cannot absorb the move", () => {
    scrollTop = 60;
    movePointer(row("c"), pointAt("c"));
    const original = entries(order);

    update(["e", "a", "b", "c", "d"], entries(order, 1));

    const { deferred, kept } = controller.getState();
    expect(deferred).toBe(true);
    expect(notifications).toBe(1);
    expect(kept.get("e")).toEqual(original[4]);

    scrollTop = 0;
    update(order, entries(order, 1));
    expect(scrollTop).toBe(60);
  });

  it("holds the hovered row at the version it is displayed with", () => {
    const shown = entries(order);
    renderRows(order);
    controller.commit(null, shown, new Map());

    movePointer(row("b"), pointAt("b"));
    expect(controller.getState().kept.get("b")).toBe(shown[1]);

    movePointer(row("d"), pointAt("d"));
    expect([...controller.getState().kept.keys()]).toEqual(["d"]);
  });

  describe("release", () => {
    function deferReorder() {
      scrollTop = 60;
      movePointer(row("c"), pointAt("c"));
      update(["e", "a", "b", "c", "d"], entries(order, 1));
      update(order, entries(order, 1));
      notifications = 0;
    }

    it("applies a deferred order when the pointer leaves the list", () => {
      deferReorder();
      root.dispatchEvent(new MouseEvent("pointerleave"));
      expect(controller.getState().deferred).toBe(false);
      expect(notifications).toBe(1);
    });

    it("applies a deferred order after 2 s without a move over 3 px", () => {
      deferReorder();
      vi.advanceTimersByTime(POINTER_STILL_RELEASE_MS - 500);
      const { clientX, clientY } = pointAt("c");
      movePointer(row("c"), { clientX: clientX + 2, clientY });
      vi.advanceTimersByTime(500);
      expect(controller.getState().deferred).toBe(false);
    });

    it("restarts the 2 s wait when the pointer moves over 3 px", () => {
      deferReorder();
      vi.advanceTimersByTime(POINTER_STILL_RELEASE_MS - 500);
      const { clientX, clientY } = pointAt("c");
      movePointer(row("c"), { clientX: clientX + 5, clientY });
      vi.advanceTimersByTime(500);
      expect(controller.getState().deferred).toBe(true);
      vi.advanceTimersByTime(POINTER_STILL_RELEASE_MS);
      expect(controller.getState().deferred).toBe(false);
    });

    it("applies a deferred order on a key press outside the list", () => {
      deferReorder();
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "a" }),
      );
      expect(controller.getState().deferred).toBe(false);
    });
  });

  describe("gate", () => {
    function releaseUnderRestingPointer() {
      scrollTop = 60;
      const point = pointAt("c");
      movePointer(row("c"), point);
      update(["e", "a", "b", "c", "d"], entries(order, 1));
      update(order, entries(order, 1));
      vi.advanceTimersByTime(POINTER_STILL_RELEASE_MS);
      update(["e", "a", "b", "c", "d"], entries(order, 1));
      return point;
    }

    it("hides hover actions and ignores a quick click on a row that slid under the pointer", () => {
      const point = releaseUnderRestingPointer();

      expect(root.getAttribute("data-sidebar-pointer-gate")).toBe("true");
      const under = document.elementFromPoint(point.clientX, point.clientY);
      expect(under).toBe(row("b"));
      expect(click(row("b"), point).defaultPrevented).toBe(true);
    });

    it("lets a click through once 500 ms have passed", () => {
      const point = releaseUnderRestingPointer();
      vi.advanceTimersByTime(GATED_CLICK_WINDOW_MS);
      expect(click(row("b"), point).defaultPrevented).toBe(false);
    });

    it("shows hover actions again after a move over 3 px", () => {
      const point = releaseUnderRestingPointer();
      movePointer(row("b"), { clientX: point.clientX + 5, clientY: point.clientY });
      expect(root.hasAttribute("data-sidebar-pointer-gate")).toBe(false);
    });
  });

  describe("archive guard", () => {
    it("hides Archive on a risky row that slides into an archived row's place", () => {
      renderRows(order, ["c"]);
      const point = pointAt("b");
      movePointer(row("b"), point);

      update(["a", "c", "d", "e"], entries(["a", "c", "d", "e"]), ["c"]);

      expect(row("c").getAttribute("data-sidebar-archive-guard")).toBe("true");
      expect(root.hasAttribute("data-sidebar-pointer-gate")).toBe(false);
      const archivePoint = { clientX: 250, clientY: point.clientY };
      expect(click(row("c"), archivePoint).defaultPrevented).toBe(true);
      expect(click(row("c"), point).defaultPrevented).toBe(false);

      movePointer(row("c"), { clientX: 250, clientY: point.clientY + 4 });
      expect(row("c").hasAttribute("data-sidebar-archive-guard")).toBe(false);
    });

    it("lets a second Archive click act on a safe row", () => {
      const point = pointAt("b");
      movePointer(row("b"), point);

      update(["a", "c", "d", "e"], entries(["a", "c", "d", "e"]));

      expect(row("c").hasAttribute("data-sidebar-archive-guard")).toBe(false);
      expect(root.hasAttribute("data-sidebar-pointer-gate")).toBe(false);
      expect(
        click(row("c"), { clientX: 250, clientY: point.clientY }).defaultPrevented,
      ).toBe(false);
    });
  });

  describe("without a pointer or focus anchor", () => {
    const long = ["a", "b", "c", "d", "e", "f", "g"];

    beforeEach(() => {
      renderRows(long);
      controller.commit(null, entries(long), new Map());
      scrollTop = 60;
    });

    it("keeps the visible rows still when a row lands above them", () => {
      update(["g", "a", "b", "c", "d", "e", "f"], entries(long, 1));
      expect(scrollTop).toBe(90);
    });

    it("does not follow a visible row that jumps away", () => {
      update(["c", "a", "b", "d", "e", "f", "g"], entries(long, 1));
      expect(scrollTop).toBe(60);
    });
  });

  it("returns focus to a row the commit moved", () => {
    const target = row("c").querySelector("button");
    if (!target) throw new Error("missing button");
    target.focus();
    const measurement = controller.measure();
    target.blur();
    renderRows(["c", "a", "b", "d", "e"]);
    controller.commit(measurement, entries(order, 1), new Map());
    expect(document.activeElement).toBe(target);
  });
});
