// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_THREAD_ROLLUP,
  rollUpThreads,
} from "../model/thread-activity.js";
import { makeSidebarThread } from "../model/fixtures.js";
import type {
  PluginSidebarSplitLayout,
  PluginSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";

installTestPluginRuntime();
const { SidebarSectionRow } = await import("./SidebarSectionRow.js");

type SectionRowProps = Parameters<typeof SidebarSectionRow>[0];

function renderSectionRow(
  props: Partial<SectionRowProps>,
  options: {
    splitLayout?: PluginSidebarSplitLayout;
    rowStatuses?: Record<string, PluginSidebarThreadRowStatus>;
  } = {},
) {
  return renderSlot(
    { component: SidebarSectionRow },
    {
      name: "Nested work",
      label: "Nested work",
      depth: 1,
      rollup: EMPTY_THREAD_ROLLUP,
      isCollapsed: false,
      onToggleCollapsed: vi.fn(),
      ...props,
    },
    {
      sidebarSplitLayout: options.splitLayout,
      sidebarRowStatuses: options.rowStatuses ?? {},
    },
  );
}

afterEach(() => {
  cleanup();
});

describe("SidebarSectionRow", () => {
  it("leads with the disclosure and toggles from the whole row", () => {
    const onToggleCollapsed = vi.fn();
    renderSectionRow({
      onToggleCollapsed,
      rollup: rollUpThreads([
        makeSidebarThread({ id: "one", hasPendingInteraction: true }),
        makeSidebarThread({ id: "two", lastReadAt: 1 }),
      ]),
    });

    const disclosure = screen.getByRole("button", {
      name: "Collapse Nested work section",
    });
    const item = screen.getByRole("treeitem");
    expect(
      disclosure.compareDocumentPosition(item) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(disclosure.tabIndex).toBe(-1);
    expect(item.getAttribute("aria-level")).toBe("3");
    expect(item.textContent).toBe(
      "Nested work, section, 2 threads: 1 needs your input",
    );

    fireEvent.click(screen.getByText("Nested work"));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
    fireEvent.click(disclosure);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(2);
  });

  it("rolls hidden split threads up to the collapsed section row", () => {
    renderSectionRow(
      {
        name: "Build",
        label: "Work / Build",
        rollup: rollUpThreads([
          makeSidebarThread({ id: "thread-one", hasPendingInteraction: true }),
        ]),
        collapsedThreads: [{ id: "thread-one" }, { id: "thread-two" }],
        isCollapsed: true,
      },
      {
        splitLayout: {
          panes: [
            {
              paneId: "pane-first-thread",
              rect: { x: 0, y: 0, width: 0.34, height: 1 },
              threadId: "thread-one",
              isFocused: false,
            },
            {
              paneId: "pane-compose",
              rect: { x: 0.34, y: 0, width: 0.33, height: 1 },
              threadId: null,
              isFocused: false,
            },
            {
              paneId: "pane-second-thread",
              rect: { x: 0.67, y: 0, width: 0.33, height: 1 },
              threadId: "thread-two",
              isFocused: true,
            },
          ],
        },
      },
    );

    const splitMaps = screen.getAllByRole("img", {
      name: "Work / Build — contains a thread open in split",
    });
    const splitMap = splitMaps[0];
    if (!splitMap) {
      throw new Error("Expected a collapsed split mini-map");
    }
    const slots = splitMap.querySelectorAll("rect");

    expect(slots).toHaveLength(3);
    expect(slots[0]?.getAttribute("class")).toContain("fill-muted-foreground");
    expect(slots[1]?.getAttribute("class")).toContain("fill-none");
    expect(slots[2]?.getAttribute("class")).toContain("fill-primary");
    expect(document.querySelector("[data-thread-status-glyph]")).toBeNull();
  });

  it("rolls a hidden plugin status up to the collapsed section row", () => {
    renderSectionRow(
      {
        name: "Building",
        label: "Work / Building",
        collapsedThreads: [{ id: "thread-one" }],
        isCollapsed: true,
      },
      {
        rowStatuses: {
          "thread-one": {
            icon: "AiContentGenerator01",
            label: "Plugin improving draft",
            tone: "running",
          },
        },
      },
    );

    expect(
      document
        .querySelector("[data-thread-status-glyph]")
        ?.getAttribute("data-row-status"),
    ).toBe("Plugin improving draft");
  });

  it("does not roll a plugin status up while the section is expanded", () => {
    renderSectionRow(
      {
        name: "Building",
        label: "Work / Building",
        collapsedThreads: [{ id: "thread-one" }],
        isCollapsed: false,
      },
      {
        rowStatuses: {
          "thread-one": {
            icon: "AiContentGenerator01",
            label: "Plugin improving draft",
            tone: "running",
          },
        },
      },
    );

    expect(document.querySelector("[data-thread-status-glyph]")).toBeNull();
  });
});
