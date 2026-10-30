// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider, createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
import {
  createEmptyFixedPanelTabsState,
  createThreadInfoFixedPanelTab,
  FIXED_PANEL_TABS_IDLE_EXPIRY_MS,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
  type FixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import { ThreadRouteLoadingSkeleton } from "./ThreadRouteLoadingSkeleton";

const THREAD_ID = "thr_route_skeleton";
const INFO_TAB = createThreadInfoFixedPanelTab();
const OPEN_PANEL: FixedPanelTabsState["secondary"] = {
  activeTabId: INFO_TAB.id,
  isOpen: true,
  tabs: [INFO_TAB],
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function storePanelState(
  secondary: FixedPanelTabsState["secondary"],
  { lastUsedAt = Date.now(), threadId = THREAD_ID } = {},
) {
  window.localStorage.setItem(
    getFixedPanelTabsStateStorageKey({ threadId }),
    serializeFixedPanelTabsState({
      state: createEmptyFixedPanelTabsState({ lastUsedAt, secondary }),
    }),
  );
}

function ThreadViewPanelOpenProbe() {
  const state = useFixedPanelTabsState(THREAD_ID, null);
  return (
    <output data-testid="thread-view-panel-open">
      {String(state.secondary.isOpen)}
    </output>
  );
}

function renderSkeleton({
  isBoundedPane = false,
  isCompactViewport = false,
} = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <JotaiProvider store={createStore()}>
        <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
          <SidebarProvider>
            <ThreadRouteLoadingSkeleton
              isBoundedPane={isBoundedPane}
              threadId={THREAD_ID}
            />
            <ThreadViewPanelOpenProbe />
          </SidebarProvider>
        </CompactViewportOverrideProvider>
      </JotaiProvider>
    </QueryClientProvider>,
  );
  return {
    panel: screen.queryByTestId("route-loading-skeleton-secondary-panel"),
    isThreadViewPanelOpen:
      screen.getByTestId("thread-view-panel-open").textContent === "true",
  };
}

describe("ThreadRouteLoadingSkeleton", () => {
  it.each([
    ["an open panel", () => storePanelState(OPEN_PANEL), true],
    [
      "an open panel without tabs",
      () => storePanelState({ activeTabId: null, isOpen: true, tabs: [] }),
      false,
    ],
    [
      "an open panel left idle past expiry",
      () =>
        storePanelState(OPEN_PANEL, {
          lastUsedAt: Date.now() - FIXED_PANEL_TABS_IDLE_EXPIRY_MS - 1,
        }),
      false,
    ],
    [
      "a closed panel",
      () => storePanelState({ ...OPEN_PANEL, isOpen: false }),
      false,
    ],
    [
      "another thread's open panel",
      () => storePanelState(OPEN_PANEL, { threadId: "thr_other" }),
      false,
    ],
    [
      "unreadable panel state",
      () =>
        window.localStorage.setItem(
          getFixedPanelTabsStateStorageKey({ threadId: THREAD_ID }),
          "{",
        ),
      false,
    ],
  ])(
    "reserves the panel slot exactly when the thread view opens the panel: %s",
    (_label, arrange, isOpen) => {
      arrange();

      const { panel, isThreadViewPanelOpen } = renderSkeleton();

      expect(isThreadViewPanelOpen).toBe(isOpen);
      expect(panel !== null).toBe(isOpen);
    },
  );

  it("sizes the slot from the persisted panel width, and fills the pane when the conversation is collapsed", () => {
    storePanelState(OPEN_PANEL);
    window.localStorage.setItem("bb.thread.secondaryPanel.widthPercent", "35");

    expect(renderSkeleton().panel?.style.flex).toBe("35 1 0px");

    cleanup();
    window.localStorage.setItem(
      `bb.thread.conversation.collapsed-${THREAD_ID}`,
      "true",
    );

    expect(renderSkeleton().panel?.style.flex).toBe("100 1 0px");
  });

  it("leaves the panel to the split host in bounded panes and to the drawer on compact viewports", () => {
    storePanelState(OPEN_PANEL);

    expect(renderSkeleton({ isBoundedPane: true }).panel).toBeNull();
    cleanup();
    expect(renderSkeleton({ isCompactViewport: true }).panel).toBeNull();
  });
});
