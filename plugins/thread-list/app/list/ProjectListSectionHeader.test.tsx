// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rollUpThreads } from "../model/thread-activity.js";
import type {
  PluginSidebarSplitLayout,
  PluginSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type { SectionThreadDndState } from "../dnd/useSectionThreadDnd.js";
import { makeSidebarThread } from "../model/fixtures.js";

installTestPluginRuntime();
const { TopLevelSidebarSection } = await import("./TopLevelSidebarSection.js");
const { SidebarControlButton } = await import("../rows/SidebarRowControls.js");
const { SectionThreadDndProvider } =
  await import("../dnd/SectionThreadDndContext.js");

function Slot({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

function renderTree(
  children: ReactNode,
  options: {
    splitLayout?: PluginSidebarSplitLayout;
    rowStatuses?: Record<string, PluginSidebarThreadRowStatus>;
  } = {},
) {
  return renderSlot(
    { component: Slot },
    { children },
    {
      sidebarSplitLayout: options.splitLayout,
      sidebarRowStatuses: options.rowStatuses ?? {},
    },
  );
}

function dndState(
  dragOverParentKey: string | null,
  activeThread: SectionThreadDndState["activeThread"],
  unchangedParentKey: string | null = null,
): SectionThreadDndState {
  return {
    activeItemId: activeThread?.id ?? null,
    activeThread,
    dragOverParentKey,
    unchangedParentKey,
    consumeClickSuppression: () => false,
    dndContextProps: {},
    itemIdsByParentKey: new Map(),
    onClickCapture: () => undefined,
    nestTarget: null,
    nestPreviewBeforeKey: null,
    reorderTarget: null,
    pinnedItemIds: [],
    pinnedReorderPending: false,
  };
}

function renderSectionWithDrag(state: SectionThreadDndState): string | null {
  const { container } = renderTree(
    <SectionThreadDndProvider value={state}>
      <TopLevelSidebarSection label="Design" dropParentKey="section:design">
        <div>Thread</div>
      </TopLevelSidebarSection>
    </SectionThreadDndProvider>,
  );
  const dropState = container
    .querySelector("[data-sidebar-drop-target]")
    ?.getAttribute("data-sidebar-drop-target");
  cleanup();
  return dropState ?? null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SidebarControlButton", () => {
  it("drops pointer focus before a section action opens a picker", () => {
    let triggerWasFocused = true;
    renderTree(
      <SidebarControlButton
        label="New thread"
        icon="MessageSquarePlus"
        onClick={() => {
          triggerWasFocused =
            document.activeElement ===
            screen.getByRole("button", { name: "New thread" });
        }}
      />,
    );
    const trigger = screen.getByRole("button", { name: "New thread" });
    trigger.focus();

    fireEvent.click(trigger, { detail: 1 });

    expect(triggerWasFocused).toBe(false);
    expect(document.activeElement).not.toBe(trigger);
  });

  it("retains section-action focus for keyboard activation", () => {
    renderTree(
      <SidebarControlButton
        label="New thread"
        icon="MessageSquarePlus"
        onClick={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "New thread" });
    trigger.focus();

    fireEvent.click(trigger, { detail: 0 });

    expect(document.activeElement).toBe(trigger);
  });
});

describe("TopLevelSidebarSection", () => {
  it("toggles from anywhere on the header except its controls", () => {
    const onToggleCollapsed = vi.fn();
    renderTree(
      <TopLevelSidebarSection
        label="Pinned"
        actions={<button type="button">Pinned actions</button>}
        collapseControl={{ isCollapsed: false, onToggleCollapsed }}
      >
        <div>Pinned thread</div>
      </TopLevelSidebarSection>,
    );

    fireEvent.click(screen.getByText("Pinned"));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Pinned actions" }));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it("names the header with its thread summary instead of a visible count", () => {
    renderTree(
      <TopLevelSidebarSection
        label="kops-discordbot"
        rollup={rollUpThreads([
          makeSidebarThread({ id: "one", status: "error", latestAttentionAt: 5 }),
          makeSidebarThread({ id: "two", lastReadAt: 1 }),
          makeSidebarThread({ id: "three", lastReadAt: 1 }),
          makeSidebarThread({ id: "four", lastReadAt: 1 }),
        ])}
        collapseControl={{ isCollapsed: false, onToggleCollapsed: vi.fn() }}
      >
        <div>Thread</div>
      </TopLevelSidebarSection>,
    );

    const header = screen.getByRole("treeitem");
    expect(header.getAttribute("aria-level")).toBe("1");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(header.textContent).toBe("kops-discordbot, 4 threads: 1 failed");
    expect(
      header
        .closest("[data-sidebar-tree-row]")
        ?.getAttribute("data-sidebar-row-tooltip"),
    ).toBe("kops-discordbot · 4 threads: 1 failed");
    expect(document.querySelector("[data-thread-status-glyph]")).toBeNull();
  });

  it("renders an empty project as a bare header", () => {
    const onToggleCollapsed = vi.fn();
    renderTree(
      <TopLevelSidebarSection
        label="berth"
        isEmpty
        collapseControl={{ isCollapsed: false, onToggleCollapsed }}
      >
        <div>No threads</div>
      </TopLevelSidebarSection>,
    );

    const header = screen.getByRole("treeitem");
    expect(header.hasAttribute("aria-expanded")).toBe(false);
    expect(document.querySelector("[data-sidebar-section-caret]")).toBeNull();
    expect(screen.queryByText("No threads")).toBeNull();
    fireEvent.click(screen.getByText("berth"));
    expect(onToggleCollapsed).not.toHaveBeenCalled();
  });

  it("highlights the whole section only while it is the resolved drop parent", () => {
    const dragged = makeSidebarThread({
      id: "dragged",
      lastReadAt: 100,
      latestAttentionAt: 100,
      createdAt: 0,
      updatedAt: 100,
    });

    expect(renderSectionWithDrag(dndState(null, dragged))).toBeNull();
    expect(
      renderSectionWithDrag(dndState("section:other", dragged)),
    ).toBeNull();
    expect(renderSectionWithDrag(dndState("section:design", dragged))).toBe(
      "active",
    );
    expect(renderSectionWithDrag(dndState("section:design", null))).toBeNull();
  });

  it("marks the section a dragged thread already sits in as unchanged", () => {
    const dragged = makeSidebarThread({
      id: "dragged",
      lastReadAt: 100,
      latestAttentionAt: 100,
      createdAt: 0,
      updatedAt: 100,
    });

    expect(
      renderSectionWithDrag(dndState(null, dragged, "section:design")),
    ).toBe("unchanged");
    expect(
      renderSectionWithDrag(dndState(null, dragged, "section:other")),
    ).toBeNull();
    expect(
      renderSectionWithDrag(dndState(null, null, "section:design")),
    ).toBeNull();
  });

  it("shows the hidden threads' highest state in the trailing controls only while collapsed", () => {
    const renderSection = (isCollapsed: boolean) => (
      <TopLevelSidebarSection
        label="TODO"
        actions={<button type="button">Actions</button>}
        rollup={rollUpThreads([
          makeSidebarThread({
            id: "busy",
            status: "active",
            runtimeStatus: "active",
          }),
        ])}
        collapseControl={{ isCollapsed, onToggleCollapsed: vi.fn() }}
      >
        <div>Active thread</div>
      </TopLevelSidebarSection>
    );
    const result = renderTree(renderSection(true));

    const indicator = document.querySelector(
      '[data-thread-status-glyph="runtime"]',
    );
    const trailingControls = indicator?.closest(
      "[data-sidebar-trailing-controls]",
    );
    expect(trailingControls).not.toBeNull();
    expect(screen.queryByText("Active thread")).toBeNull();

    result.rerender(<Slot>{renderSection(false)}</Slot>);

    expect(document.querySelector("[data-thread-status-glyph]")).toBeNull();
    expect(screen.getByText("Active thread")).not.toBeNull();
  });

  it("rolls a hidden split thread up to a collapsed top-level section", () => {
    renderTree(
      <TopLevelSidebarSection
        label="Pinned"
        collapsedThreads={[{ id: "thread-one" }]}
        collapseControl={{ isCollapsed: true, onToggleCollapsed: vi.fn() }}
      >
        <div>Pinned thread</div>
      </TopLevelSidebarSection>,
      {
        splitLayout: {
          panes: [
            {
              paneId: "pane-thread",
              rect: { x: 0, y: 0, width: 0.5, height: 1 },
              threadId: "thread-one",
              isFocused: true,
            },
            {
              paneId: "pane-compose",
              rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
              threadId: null,
              isFocused: false,
            },
          ],
        },
      },
    );

    expect(
      screen.getByRole("img", {
        name: "Pinned — contains a thread open in split",
      }),
    ).not.toBeNull();
    expect(screen.queryByText("Pinned thread")).toBeNull();
  });

  it("rolls up a hidden plugin status only while the section is collapsed", () => {
    const renderSection = (isCollapsed: boolean) => (
      <TopLevelSidebarSection
        label="Building"
        collapsedThreads={[{ id: "thread-one" }]}
        collapseControl={{ isCollapsed, onToggleCollapsed: vi.fn() }}
      >
        <div>Draft thread</div>
      </TopLevelSidebarSection>
    );
    const result = renderTree(renderSection(true), {
      rowStatuses: {
        "thread-one": {
          icon: "AiContentGenerator01",
          label: "Plugin improving draft",
          tone: "running",
        },
      },
    });

    const glyph = document.querySelector("[data-thread-status-glyph]");
    expect(glyph?.getAttribute("data-row-status")).toBe(
      "Plugin improving draft",
    );
    expect(glyph?.getAttribute("data-row-status-tone")).toBe("running");
    expect(screen.queryByText("Draft thread")).toBeNull();

    result.rerender(<Slot>{renderSection(false)}</Slot>);

    expect(document.querySelector("[data-thread-status-glyph]")).toBeNull();
    expect(screen.getByText("Draft thread")).not.toBeNull();
  });
});
