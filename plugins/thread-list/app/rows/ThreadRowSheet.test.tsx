// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginThreadActionEntry } from "@get-bb/plugin-sdk/app";
import {
  installTestPluginRuntime,
  renderSlot,
  type TestThreadActionsResolver,
} from "@get-bb/plugin-sdk/testing/app";
import { makeSidebarThread } from "../model/fixtures.js";

installTestPluginRuntime();
const { ThreadRowSheetProvider, useThreadRowSheet } =
  await import("./ThreadRowSheet.js");

const THREAD = makeSidebarThread({
  id: "thr_sheet",
  title: "Investigate staff report",
});

function entry(key: string, label: string): PluginThreadActionEntry {
  return {
    key,
    pluginId: key.split("/")[0] ?? "bb--core",
    group: "2_organize",
    action: { label, icon: "Circle", run: async () => undefined },
  };
}

const HOST_ORDER: TestThreadActionsResolver = () => [
  entry("bb--core/copyLink", "Copy link"),
  entry("bb--core/delete", "Delete"),
  entry("thread-list/move", "Move to section"),
  entry("bb--core/rename", "Rename"),
  entry("bb--core/read", "Mark unread"),
  entry("bb--core/pin", "Pin"),
  entry("bb--core/archive", "Archive"),
];

function SheetOpener() {
  const sheet = useThreadRowSheet();
  return (
    <button
      type="button"
      onClick={() =>
        sheet?.open({
          thread: THREAD,
          title: "Investigate staff report",
          summary: "working · 11 sub-agents: 1 failed, 2 working",
          requestRename: () => undefined,
          onCloseAutoFocus: () => undefined,
        })
      }
    >
      Open sheet
    </button>
  );
}

function SheetHarness() {
  return (
    <ThreadRowSheetProvider threads={[THREAD]}>
      <SheetOpener />
    </ThreadRowSheetProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("ThreadRowSheet", () => {
  it("leads with Archive and ends with Delete whatever order the host lists actions in", async () => {
    renderSlot({ component: SheetHarness }, {}, { threadActions: HOST_ORDER });

    fireEvent.click(screen.getByRole("button", { name: "Open sheet" }));

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Archive",
      "Pin",
      "Mark unread",
      "Rename…",
      "Copy link",
      "Move to section",
      "Delete…",
    ]);
    expect(
      screen.getByText("working · 11 sub-agents: 1 failed, 2 working"),
    ).not.toBeNull();
  });
});
