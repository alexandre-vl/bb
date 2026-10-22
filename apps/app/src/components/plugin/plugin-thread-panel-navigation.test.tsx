// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createPluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { useBbNavigate } from "@/lib/plugin-sdk-hooks";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { PluginContext } from "./plugin-context";
import { PluginPanelTabContent } from "./PluginPanelActions";
import {
  getActiveThreadPanelOpener,
  PluginThreadPanelNavigationProvider,
  resetActiveThreadPanelOpenerForTest,
  usePublishThreadPanelOpener,
  type PluginThreadPanelOpenHandler,
} from "./plugin-thread-panel-navigation";

function Pane({
  opener,
  isFocused,
}: {
  opener: PluginThreadPanelOpenHandler;
  isFocused: boolean;
}) {
  usePublishThreadPanelOpener(opener, isFocused);
  return null;
}

afterEach(() => {
  cleanup();
  resetActiveThreadPanelOpenerForTest();
  resetPluginSlotStoreForTest();
});

it("publishes only the focused pane's opener", () => {
  const left = vi.fn(() => true);
  const right = vi.fn(() => true);
  const { rerender } = render(
    <>
      <Pane opener={left} isFocused={true} />
      <Pane opener={right} isFocused={false} />
    </>,
  );

  getActiveThreadPanelOpener()?.({ actionId: "a", pluginId: "p" });
  expect(left).toHaveBeenCalledTimes(1);
  expect(right).not.toHaveBeenCalled();

  rerender(
    <>
      <Pane opener={left} isFocused={false} />
      <Pane opener={right} isFocused={true} />
    </>,
  );
  getActiveThreadPanelOpener()?.({ actionId: "a", pluginId: "p" });
  expect(right).toHaveBeenCalledTimes(1);
  expect(left).toHaveBeenCalledTimes(1);
});

it("reports no opener when no thread view is focused", () => {
  render(<Pane opener={vi.fn(() => true)} isFocused={false} />);
  expect(getActiveThreadPanelOpener()).toBeNull();
});

function ReplaceButton({
  label,
  onResult,
}: {
  label: string;
  onResult: (label: string, replaced: boolean) => void;
}) {
  const navigate = useBbNavigate();
  return (
    <button
      type="button"
      onClick={() =>
        onResult(
          label,
          navigate.openThreadPanel({
            actionId: "issue",
            title: "Issue #2",
            params: { n: 2 },
            experimental_replace: true,
          }),
        )
      }
    >
      {label}
    </button>
  );
}

it.each([
  { surface: "thread", slot: "threadPanelActions" },
  { surface: "new-thread", slot: "newThreadPanelActions" },
] as const)(
  "lets only a $surface panel tab's own plugin replace that tab",
  ({ surface, slot }) => {
    const results: Record<string, boolean> = {};
    const onResult = (label: string, replaced: boolean) => {
      results[label] = replaced;
    };
    function TabBody() {
      return (
        <>
          <ReplaceButton label="Own tab" onResult={onResult} />
          <PluginContext.Provider value="other">
            <ReplaceButton label="Other plugin" onResult={onResult} />
          </PluginContext.Provider>
        </>
      );
    }
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        [slot]: [{ id: "issue", title: "Issue", component: TabBody }],
      }),
    );
    const tab = createPluginPanelFixedPanelTab({
      pluginId: "demo",
      actionId: "issue",
      title: "Issue",
      paramsJson: null,
    });
    const openThreadPanel = vi.fn<PluginThreadPanelOpenHandler>(() => true);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PluginThreadPanelNavigationProvider
            openThreadPanel={openThreadPanel}
          >
            <PluginPanelTabContent
              tab={tab}
              context={
                surface === "thread"
                  ? { kind: "thread", threadId: "thr_1" }
                  : { kind: "new-thread", projectId: null }
              }
            />
            <PluginContext.Provider value="demo">
              <ReplaceButton label="Outside a tab" onResult={onResult} />
            </PluginContext.Provider>
          </PluginThreadPanelNavigationProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    for (const label of ["Own tab", "Other plugin", "Outside a tab"]) {
      fireEvent.click(screen.getByText(label));
    }

    expect(results).toEqual({
      "Own tab": true,
      "Other plugin": false,
      "Outside a tab": false,
    });
    expect(openThreadPanel).toHaveBeenCalledExactlyOnceWith({
      pluginId: "demo",
      actionId: "issue",
      title: "Issue #2",
      params: { n: 2 },
      replaceTabId: tab.id,
    });
  },
);
