// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarTreeKeyboard } from "./sidebar-tree-keyboard.js";

interface RowSpec {
  key: string;
  label: string;
  level: number;
  expanded?: boolean;
  current?: boolean;
  anchor?: boolean;
  rung?: number;
  hidden?: boolean;
}

function rowHtml({
  key,
  label,
  level,
  expanded,
  current = false,
  anchor = true,
  rung = 0,
  hidden = false,
}: RowSpec): string {
  const tag = anchor ? "a" : "span";
  const href = anchor ? ` href="#${key}"` : "";
  const state =
    expanded === undefined ? "" : ` aria-expanded="${String(expanded)}"`;
  const chevron =
    expanded === undefined
      ? ""
      : `<button type="button" tabindex="-1" aria-hidden="true" data-sidebar-tree-chevron="" data-toggles="${key}"></button>`;
  return `<div data-sidebar-tree-row="" data-sidebar-row-key="${key}" data-sidebar-row-rung="${rung}"${
    hidden ? ' aria-hidden="true"' : ""
  }><${tag}${href} role="treeitem" tabindex="-1" data-sidebar-tree-item="" aria-level="${level}"${state}${
    current ? ' aria-current="page"' : ""
  }>${label}</${tag}>${chevron}</div>`;
}

const ROWS: readonly RowSpec[] = [
  {
    key: "project:p",
    label: "Project",
    level: 1,
    expanded: true,
    anchor: false,
  },
  { key: "thr_parent", label: "Parent", level: 2, expanded: true },
  { key: "thr_child", label: "Child", level: 3 },
  { key: "thr_open", label: "Open", level: 2, current: true },
  { key: "preview", label: "Preview", level: 2, hidden: true },
  { key: "thr_collapsed", label: "Collapsed", level: 2, expanded: false },
  { key: "thr_last", label: "Last", level: 2, rung: 4 },
];

const attached: (() => void)[] = [];

function mountTree(
  rows: readonly RowSpec[] = ROWS,
  focusComposer: () => boolean = () => true,
  container: HTMLElement = document.body,
) {
  const outside = document.createElement("button");
  outside.textContent = "Outside";
  const root = document.createElement("div");
  root.setAttribute("role", "tree");
  root.setAttribute("data-sidebar-thread-tree", "");
  root.innerHTML = rows.map(rowHtml).join("");
  document.body.append(outside);
  container.append(root);
  const toggles: string[] = [];
  root.addEventListener("click", (event) => {
    const toggle =
      event.target instanceof Element
        ? event.target.getAttribute("data-toggles")
        : null;
    if (toggle) toggles.push(toggle);
  });
  const keyboard = new SidebarTreeKeyboard();
  keyboard.setComposerFocus(focusComposer);
  attached.push(keyboard.attach(root));
  const item = (label: string) => {
    const found = Array.from(
      root.querySelectorAll<HTMLElement>("[data-sidebar-tree-item]"),
    ).find((candidate) => candidate.textContent === label);
    if (!found) throw new Error(`No treeitem ${label}`);
    return found;
  };
  const tabStops = () =>
    Array.from(
      root.querySelectorAll<HTMLElement>('[tabindex="0"]'),
      (stop) => stop.textContent,
    );
  return { root, outside, item, toggles, keyboard, tabStops };
}

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  return !fireEvent.keyDown(target, { key, ...init });
}

afterEach(() => {
  for (const detach of attached.splice(0)) detach();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("SidebarTreeKeyboard", () => {
  it("keeps one Tab stop: the open thread, then the focused row, then the open thread again", async () => {
    const { item, outside, tabStops } = mountTree();
    expect(tabStops()).toEqual(["Open"]);

    item("Child").focus();
    expect(tabStops()).toEqual(["Child"]);

    outside.focus();
    await Promise.resolve();
    expect(tabStops()).toEqual(["Open"]);

    item("Open").removeAttribute("aria-current");
    item("Last").setAttribute("aria-current", "page");
    await Promise.resolve();
    expect(tabStops()).toEqual(["Last"]);
  });

  it("keeps the Tab stop when the list mounts inside a closed drawer", () => {
    const drawer = document.createElement("div");
    drawer.setAttribute("inert", "");
    document.body.append(drawer);
    const { root, tabStops } = mountTree(
      ROWS.map((row) => ({ ...row, current: false })),
      () => true,
      drawer,
    );
    expect(drawer.contains(root)).toBe(true);
    expect(tabStops()).toEqual(["Project"]);
  });

  it("falls back to the first row when no thread is open", () => {
    const { tabStops } = mountTree(
      ROWS.map((row) => ({ ...row, current: false })),
    );
    expect(tabStops()).toEqual(["Project"]);
  });

  it("moves through visible rows in order and skips hidden ones", () => {
    const { item } = mountTree();
    item("Open").focus();

    expect(press(item("Open"), "ArrowDown")).toBe(true);
    expect(document.activeElement).toBe(item("Collapsed"));
    press(item("Collapsed"), "ArrowUp");
    expect(document.activeElement).toBe(item("Open"));
    press(item("Open"), "Home");
    expect(document.activeElement).toBe(item("Project"));
    press(item("Project"), "End");
    expect(document.activeElement).toBe(item("Last"));
  });

  it("expands and collapses through the chevron, and walks to children and parents", () => {
    const { item, toggles } = mountTree();
    item("Collapsed").focus();

    press(item("Collapsed"), "ArrowRight");
    expect(toggles).toEqual(["thr_collapsed"]);
    expect(document.activeElement).toBe(item("Collapsed"));

    item("Parent").focus();
    press(item("Parent"), "ArrowRight");
    expect(document.activeElement).toBe(item("Child"));
    press(item("Child"), "ArrowLeft");
    expect(document.activeElement).toBe(item("Parent"));
    press(item("Parent"), "ArrowLeft");
    expect(toggles).toEqual(["thr_collapsed", "thr_parent"]);
    press(item("Open"), "ArrowLeft");
    expect(document.activeElement).toBe(item("Project"));
  });

  it("toggles containers with Space, opens leaves with Space, and leaves Enter on a link to the browser", () => {
    const { item, toggles } = mountTree();
    const opened: string[] = [];
    item("Open").addEventListener("click", (event) => {
      event.preventDefault();
      opened.push("Open");
    });

    expect(press(item("Parent"), " ")).toBe(true);
    expect(toggles).toEqual(["thr_parent"]);
    expect(press(item("Open"), " ")).toBe(true);
    expect(opened).toEqual(["Open"]);
    expect(press(item("Open"), "Enter")).toBe(false);
    expect(press(item("Project"), "Enter")).toBe(true);
  });

  it("leaves the list's app command keys to the app", () => {
    const { item } = mountTree();
    const reached: string[] = [];
    const record = (event: KeyboardEvent) => reached.push(event.key);
    window.addEventListener("keydown", record);
    item("Open").focus();

    for (const [key, init] of [
      ["e", {}],
      ["F2", {}],
      ["u", {}],
      ["ArrowDown", { altKey: true }],
      ["ArrowUp", { altKey: true }],
    ] as const) {
      expect(press(item("Open"), key, init)).toBe(false);
    }
    window.removeEventListener("keydown", record);
    expect(reached).toEqual(["e", "F2", "u", "ArrowDown", "ArrowUp"]);
    expect(document.activeElement).toBe(item("Open"));
  });

  it("expands only collapsed siblings with *", () => {
    const { item, toggles } = mountTree();
    press(item("Open"), "*", { shiftKey: true });
    expect(toggles).toEqual(["thr_collapsed"]);
  });

  it("returns to the composer on Escape, except inside a modal drawer", () => {
    const focusComposer = vi.fn(() => true);
    const { item, root } = mountTree(ROWS, focusComposer);
    expect(press(item("Open"), "Escape")).toBe(true);
    expect(focusComposer).toHaveBeenCalledTimes(1);

    const drawer = document.createElement("div");
    drawer.setAttribute("aria-modal", "true");
    document.body.append(drawer);
    drawer.append(root);
    expect(press(item("Open"), "Escape")).toBe(false);
    expect(focusComposer).toHaveBeenCalledTimes(1);
  });

  it("opens the row's context menu on Shift+F10, else its actions menu, and brings focus back to the row", () => {
    const { item, root } = mountTree();
    const contextMenus: string[] = [];
    item("Open").addEventListener("contextmenu", (event) => {
      event.preventDefault();
      contextMenus.push("Open");
    });
    expect(press(item("Open"), "F10", { shiftKey: true })).toBe(true);
    expect(contextMenus).toEqual(["Open"]);

    const trigger = document.createElement("button");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.tabIndex = -1;
    const opened: string[] = [];
    trigger.addEventListener("keydown", (event) => opened.push(event.key));
    item("Project").closest("[data-sidebar-tree-row]")?.append(trigger);

    item("Project").focus();
    expect(press(item("Project"), "ContextMenu")).toBe(true);
    expect(opened).toEqual(["ArrowDown"]);
    trigger.focus();
    expect(document.activeElement).toBe(item("Project"));
    expect(root.contains(document.activeElement)).toBe(true);
  });

  it("moves focus to the row that takes a removed row's place after a key, not after a click", async () => {
    const { item, root } = mountTree();
    item("Open").focus();
    press(item("Open"), "e");
    item("Open").closest("[data-sidebar-tree-row]")?.remove();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.activeElement).toBe(item("Collapsed"));

    fireEvent.pointerDown(item("Collapsed"));
    item("Collapsed").focus();
    item("Collapsed").closest("[data-sidebar-tree-row]")?.remove();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.contains(document.activeElement)).toBe(false);
  });

  it("finds the next and previous rows that need attention", () => {
    const { item, keyboard } = mountTree(
      ROWS.map((row) => (row.key === "thr_child" ? { ...row, rung: 5 } : row)),
    );
    item("Project").focus();
    keyboard.focusAttention(item("Project"), "next");
    expect(document.activeElement).toBe(item("Child"));
    keyboard.focusAttention(item("Child"), "next");
    expect(document.activeElement).toBe(item("Last"));
    keyboard.focusAttention(item("Last"), "next");
    expect(document.activeElement).toBe(item("Last"));
    keyboard.focusAttention(item("Last"), "previous");
    expect(document.activeElement).toBe(item("Child"));
  });
});
