// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rollUpThreads } from "../model/thread-activity.js";
import { makeSidebarThread } from "../model/fixtures.js";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type { BuiltInSidebarSectionOptionsById } from "./BuiltInSidebarSection.js";

installTestPluginRuntime();
const { renderBuiltInSidebarSection } =
  await import("./BuiltInSidebarSection.js");

const SECTIONS: BuiltInSidebarSectionOptionsById = {
  pinned: {
    label: "Pinned",
    content: <div>Pinned content</div>,
  },
  threads: {
    label: "Threads",
    content: <div>Threads content</div>,
  },
};

function Slot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function renderSections(children: ReactNode) {
  return renderSlot({ component: Slot }, { children });
}

function BuiltInSectionsProbe({ showPinned }: { showPinned: boolean }) {
  const sharedProps = {
    sections: SECTIONS,
    disabled: true,
    collapsedSectionIds: new Set<"pinned" | "threads">(),
    onToggleCollapsed: vi.fn(),
    showPinnedSection: showPinned,
  };

  return (
    <>
      {renderBuiltInSidebarSection({
        ...sharedProps,
        sectionId: "pinned",
      })}
      {renderBuiltInSidebarSection({
        ...sharedProps,
        sectionId: "threads",
      })}
    </>
  );
}

afterEach(() => cleanup());

describe("built-in sidebar section renderer", () => {
  it.each([false, true])(
    "keeps Pinned and Threads headers sticky (collapsed: %s)",
    (collapsed) => {
      renderSections(
        <>
          {(["pinned", "threads"] as const).map((sectionId) =>
            renderBuiltInSidebarSection({
              sections: SECTIONS,
              disabled: true,
              collapsedSectionIds: new Set(collapsed ? [sectionId] : []),
              onToggleCollapsed: vi.fn(),
              sectionId,
              showPinnedSection: true,
            }),
          )}
        </>,
      );

      const group = (label: string) =>
        screen.getByText(label).closest("[data-sidebar-sticky-group]");

      for (const label of ["Pinned", "Threads"]) {
        expect(group(label)?.hasAttribute("data-sidebar-sticky-header")).toBe(
          false,
        );
      }
      expect(screen.queryByText("Pinned content") !== null).toBe(!collapsed);
    },
  );

  it("hides Pinned without hiding Threads, then restores Pinned", () => {
    const result = renderSections(<BuiltInSectionsProbe showPinned={false} />);

    expect(screen.queryByText("Pinned content")).toBeNull();
    expect(screen.getByText("Threads content")).not.toBeNull();

    result.rerender(
      <Slot>
        <BuiltInSectionsProbe showPinned />
      </Slot>,
    );

    expect(screen.getByText("Pinned content")).not.toBeNull();
    expect(screen.getByText("Threads content")).not.toBeNull();
    expect(result.container.querySelector('[data-icon="Pin"]')).toBeNull();
  });

  it("surfaces the hidden threads' state when Threads is collapsed", () => {
    renderSections(
      renderBuiltInSidebarSection({
        collapsedSectionIds: new Set(["threads"]),
        disabled: true,
        onToggleCollapsed: vi.fn(),
        sectionId: "threads",
        sections: {
          ...SECTIONS,
          threads: {
            ...SECTIONS.threads,
            rollup: rollUpThreads([
              makeSidebarThread({
                id: "goal-thread",
                lastReadAt: 1,
                activity: {
                  workflows: 0,
                  backgroundAgents: 0,
                  backgroundCommands: 0,
                  planMode: 0,
                  goals: 1,
                },
              }),
            ]),
          },
        },
        showPinnedSection: false,
      }),
    );

    expect(screen.queryByText("Threads content")).toBeNull();
    expect(
      Array.from(
        document.querySelectorAll("[data-thread-status-glyph]"),
        (glyph) => glyph.getAttribute("data-thread-status-glyph"),
      ),
    ).toEqual(["goal"]);
  });
});
