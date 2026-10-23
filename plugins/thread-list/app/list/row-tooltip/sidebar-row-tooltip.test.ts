// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROW_TOOLTIP_DELAY_MS,
  SidebarRowTooltipController,
} from "./sidebar-row-tooltip.js";

let detach: () => void = () => undefined;

function mount() {
  document.body.innerHTML = `
    <div data-sidebar="content">
      <div data-sidebar-thread-tree role="tree">
        <div data-sidebar-tree-row data-sidebar-row-key="alpha"
          data-sidebar-row-tooltip="Alpha · working · 2 sub-agents: 1 failed">
          <button type="button" data-sidebar-tree-chevron title="Expand"></button>
          <a data-sidebar-tree-item role="treeitem" href="#alpha" tabindex="-1">
            <span data-sidebar-row-title><span>Alpha</span></span>
          </a>
        </div>
        <div data-sidebar-tree-row data-sidebar-row-key="beta"
          data-sidebar-row-tooltip="Beta" data-sidebar-row-tooltip-title-only>
          <a data-sidebar-tree-item role="treeitem" href="#beta" tabindex="-1">
            <span data-sidebar-row-title><span data-clip>Beta</span></span>
          </a>
        </div>
      </div>
      <div data-tip hidden></div>
    </div>`;
  const root = document.querySelector<HTMLElement>(
    "[data-sidebar-thread-tree]",
  );
  const tip = document.querySelector<HTMLElement>("[data-tip]");
  if (!root || !tip) throw new Error("fixture did not mount");
  detach = new SidebarRowTooltipController().attach(root, tip);
  const part = (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`missing ${selector}`);
    return element;
  };
  return { root, tip, part };
}

function hover(element: Element) {
  element.dispatchEvent(
    new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
  );
}

function shown(tip: HTMLElement): string | null {
  return tip.hidden ? null : tip.textContent;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  detach();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("SidebarRowTooltipController", () => {
  it("shows a row's summary after the hover delay, its meta muted", () => {
    const { tip, part } = mount();
    hover(part('[data-sidebar-row-key="alpha"] [data-sidebar-row-title] span'));
    vi.advanceTimersByTime(ROW_TOOLTIP_DELAY_MS - 1);
    expect(shown(tip)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown(tip)).toBe("Alpha · working · 2 sub-agents: 1 failed");
    expect(tip.querySelector(".text-muted-foreground")?.textContent).toBe(
      " · working · 2 sub-agents: 1 failed",
    );
  });

  it("stays away from the row's controls", () => {
    const { tip, part } = mount();
    hover(part('[data-sidebar-row-key="alpha"] [data-sidebar-tree-chevron]'));
    vi.advanceTimersByTime(ROW_TOOLTIP_DELAY_MS);
    expect(shown(tip)).toBeNull();
  });

  it("skips a title-only row unless its title is clipped", () => {
    const { tip, part } = mount();
    const title = part("[data-clip]");
    hover(title);
    vi.advanceTimersByTime(ROW_TOOLTIP_DELAY_MS);
    expect(shown(tip)).toBeNull();
    hover(part('[data-sidebar-row-key="alpha"] [data-sidebar-row-title]'));
    Object.defineProperty(title, "clientWidth", { value: 100 });
    Object.defineProperty(title, "scrollWidth", { value: 140 });
    hover(title);
    vi.advanceTimersByTime(ROW_TOOLTIP_DELAY_MS);
    expect(shown(tip)).toBe("Beta");
  });

  it("hides on press and stays hidden while the pointer rests on that row", () => {
    const { tip, part } = mount();
    const title = part(
      '[data-sidebar-row-key="alpha"] [data-sidebar-row-title]',
    );
    hover(title);
    vi.advanceTimersByTime(ROW_TOOLTIP_DELAY_MS);
    title.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
    );
    expect(shown(tip)).toBeNull();
    hover(title.firstElementChild ?? title);
    vi.advanceTimersByTime(ROW_TOOLTIP_DELAY_MS);
    expect(shown(tip)).toBeNull();
  });

  it("hides when the list scrolls or the pointer leaves it", () => {
    const { root, tip, part } = mount();
    const title = part(
      '[data-sidebar-row-key="alpha"] [data-sidebar-row-title]',
    );
    hover(title);
    vi.advanceTimersByTime(ROW_TOOLTIP_DELAY_MS);
    part('[data-sidebar="content"]').dispatchEvent(new Event("scroll"));
    expect(shown(tip)).toBeNull();
    hover(part('[data-sidebar-row-key="alpha"] [data-sidebar-tree-item]'));
    vi.advanceTimersByTime(ROW_TOOLTIP_DELAY_MS);
    expect(shown(tip)).not.toBeNull();
    root.dispatchEvent(
      new PointerEvent("pointerleave", { pointerType: "mouse" }),
    );
    expect(shown(tip)).toBeNull();
  });
});
