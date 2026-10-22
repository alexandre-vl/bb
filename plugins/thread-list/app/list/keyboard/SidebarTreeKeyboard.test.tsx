// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installTestPluginRuntime,
  renderSlot,
  type TestThreadActionsResolver,
} from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginSidebarThread,
  PluginThreadActionEntry,
} from "@get-bb/plugin-sdk/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { makeSidebarThread } from "../../model/fixtures.js";

installTestPluginRuntime();
const { ThreadRow } = await import("../../rows/ThreadRow.js");
const { SidebarRenameProvider } =
  await import("../../rows/SidebarInlineRename.js");
const { ThreadRowNavigationProvider } =
  await import("../../rows/threadRowNavigation.js");
const {
  SidebarComposerFocus,
  SidebarRowCommandsProvider,
  useSidebarTreeKeyboard,
} = await import("./SidebarTreeKeyboard.js");
const { ATTENTION_ANNOUNCEMENT_BATCH_MS, SidebarAttentionAnnouncer } =
  await import("../SidebarAttentionAnnouncer.js");

const QUIET = { lastReadAt: 2 };

function TreeHarness({
  threads,
  activeThreadId,
}: {
  threads: readonly PluginSidebarThread[];
  activeThreadId: string | null;
}) {
  const { keyboard, rows } = useSidebarTreeKeyboard();
  const attachTree = useCallback(
    (node: HTMLDivElement | null) => keyboard.attachRef(node),
    [keyboard],
  );
  return (
    <TooltipProvider>
      <ThreadRowNavigationProvider>
        <SidebarRenameProvider>
          <SidebarComposerFocus
            activeThreadId={activeThreadId}
            keyboard={keyboard}
          />
          <button type="button">Outside</button>
          <div
            ref={attachTree}
            role="tree"
            aria-label="Threads"
            data-sidebar-thread-tree=""
          >
            <SidebarRowCommandsProvider rows={rows}>
              <div data-sidebar-tree-row="" data-sidebar-row-key="project:p">
                <span
                  role="treeitem"
                  tabIndex={-1}
                  data-sidebar-tree-item=""
                  aria-level={1}
                >
                  Project
                </span>
              </div>
              {threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  crossProjectId={null}
                  isActive={thread.id === activeThreadId}
                  options={{ kind: "default", depth: 0 }}
                />
              ))}
            </SidebarRowCommandsProvider>
          </div>
        </SidebarRenameProvider>
      </ThreadRowNavigationProvider>
    </TooltipProvider>
  );
}

interface RanAction {
  key: string;
  threadId: string;
}

function rowActions(ran: RanAction[]): TestThreadActionsResolver {
  return (thread, { requestRename }) => {
    const entry = (
      key: string,
      label: string,
      run: () => void = () => {
        ran.push({ key, threadId: thread.id });
      },
    ): PluginThreadActionEntry => ({
      key,
      pluginId: "bb--core",
      group: "2_organize",
      action: { label, icon: "Archive", run: async () => run() },
      experimental_shortcut: null,
    });
    return [
      entry("bb--core/read", "Mark as read"),
      entry("bb--core/rename", "Rename", () => requestRename(thread.id)),
      entry("bb--core/archive", "Archive"),
    ];
  };
}

const THREADS = [
  makeSidebarThread({ id: "thr_open", title: "Open thread", ...QUIET }),
  makeSidebarThread({ id: "thr_other", title: "Other thread", ...QUIET }),
];

function renderTree(ran: RanAction[] = []) {
  const slot = renderSlot(
    { component: TreeHarness },
    { threads: THREADS, activeThreadId: "thr_open" },
    {
      sidebarThreads: { threads: THREADS, projects: [] },
      threadActions: rowActions(ran),
    },
  );
  const row = (name: string) =>
    screen.getByRole("treeitem", { name: new RegExp(`^${name}`) });
  return { slot, row };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sidebar list commands", () => {
  it("runs a list command on the focused row instead of the open thread", async () => {
    const ran: RanAction[] = [];
    const { slot, row } = renderTree(ran);

    expect(
      await slot.behavior.experimental_runSidebarListCommand(
        "thread.archive",
        row("Other thread"),
      ),
    ).toBe(true);
    expect(
      await slot.behavior.experimental_runSidebarListCommand(
        "thread.toggleRead",
        row("Open thread"),
      ),
    ).toBe(true);
    expect(ran).toEqual([
      { key: "bb--core/archive", threadId: "thr_other" },
      { key: "bb--core/read", threadId: "thr_open" },
    ]);
  });

  it("takes the key on a list row that has no thread, and leaves targets outside the list alone", async () => {
    const ran: RanAction[] = [];
    const { slot, row } = renderTree(ran);

    expect(
      await slot.behavior.experimental_runSidebarListCommand(
        "thread.archive",
        row("Project"),
      ),
    ).toBe(true);
    expect(
      await slot.behavior.experimental_runSidebarListCommand(
        "thread.archive",
        screen.getByRole("button", { name: "Outside" }),
      ),
    ).toBe(false);
    expect(ran).toEqual([]);
  });

  it("renames the focused row inline", async () => {
    const { slot, row } = renderTree();
    await slot.behavior.experimental_runSidebarListCommand(
      "thread.rename",
      row("Other thread"),
    );
    expect(
      await screen.findByRole("textbox", { name: "Thread name" }),
    ).toHaveProperty("value", "Other thread");
  });

  it("returns focus to the composer on Escape", () => {
    const { slot, row } = renderTree();
    row("Other thread").focus();
    fireEvent.keyDown(row("Other thread"), { key: "Escape" });
    expect(slot.composer.focusCount).toBe(1);
  });
});

function announcerFor(threads: readonly PluginSidebarThread[]) {
  return (
    <SidebarAttentionAnnouncer threads={threads} activeThreadId="thr_open" />
  );
}

function levelActions(
  levels: Readonly<Record<string, string>>,
): TestThreadActionsResolver {
  return (thread) => {
    const detail = levels[thread.id];
    return detail === undefined
      ? []
      : [
          {
            key: "push-notifications/notifications",
            pluginId: "push-notifications",
            group: "1_state",
            action: {
              label: "Notifications",
              detail,
              icon: "BellDot",
              run: async () => {},
            },
            experimental_shortcut: null,
          },
        ];
  };
}

function renderAnnouncer(
  threads: readonly PluginSidebarThread[],
  levels: Readonly<Record<string, string>> = {},
) {
  vi.useFakeTimers();
  const slot = renderSlot(
    { component: SidebarAttentionAnnouncer },
    { threads, activeThreadId: "thr_open" },
    {
      sidebarThreads: { threads, projects: [] },
      threadActions: levelActions(levels),
    },
  );
  const status = () =>
    document.querySelector("[data-sidebar-attention-announcer]")?.textContent ??
    "";
  return { slot, status };
}

describe("SidebarAttentionAnnouncer", () => {
  it("batches arrivals into one message after 1.2 s and stays quiet on mount", () => {
    const quiet = [
      makeSidebarThread({ id: "thr_open", title: "Open", ...QUIET }),
      makeSidebarThread({ id: "thr_a", title: "Alpha", ...QUIET }),
      makeSidebarThread({ id: "thr_b", title: "Beta", ...QUIET }),
    ];
    const { slot, status } = renderAnnouncer(quiet);
    const [open, alpha, beta] = quiet;
    if (!open || !alpha || !beta) throw new Error("fixture");

    slot.lifecycle.rerender(
      announcerFor([open, { ...alpha, hasPendingInteraction: true }, beta]),
    );
    act(() => vi.advanceTimersByTime(600));
    slot.lifecycle.rerender(
      announcerFor([
        open,
        { ...alpha, hasPendingInteraction: true },
        { ...beta, hasPendingInteraction: true },
      ]),
    );
    act(() => vi.advanceTimersByTime(ATTENTION_ANNOUNCEMENT_BATCH_MS - 601));
    expect(status()).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(status()).toBe("2 threads need your input: Alpha; Beta.");
  });

  it("follows each thread's notification level and never announces the open thread", () => {
    const quiet = [
      makeSidebarThread({ id: "thr_open", title: "Open", ...QUIET }),
      makeSidebarThread({ id: "thr_muted", title: "Muted", ...QUIET }),
      makeSidebarThread({ id: "thr_input", title: "Input", ...QUIET }),
      makeSidebarThread({ id: "thr_failing", title: "Failing", ...QUIET }),
    ];
    const { slot, status } = renderAnnouncer(quiet, {
      thr_muted: "Muted",
      thr_input: "Needs input only",
      thr_failing: "Needs input only",
    });
    const [open, muted, input, failing] = quiet;
    if (!open || !muted || !input || !failing) throw new Error("fixture");

    slot.lifecycle.rerender(
      announcerFor([
        { ...open, hasPendingInteraction: true },
        { ...muted, status: "error", isUnread: true },
        { ...input, isUnread: true },
        { ...failing, status: "error", isUnread: true },
      ]),
    );
    act(() => vi.advanceTimersByTime(ATTENTION_ANNOUNCEMENT_BATCH_MS));
    expect(status()).toBe("1 thread failed: Failing.");
  });
});
