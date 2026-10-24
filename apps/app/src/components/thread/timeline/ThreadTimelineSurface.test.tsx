// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultStore } from "jotai";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomAnchorContext } from "@/components/ui/bottom-anchored-scroll-body.js";
import { PageShell } from "@/components/ui/page-shell";
import { threadTimelineScrollAnchorAtomFamily } from "@/lib/thread-timeline-scroll-anchor";
import { installFakeFlowLayout } from "@/test/fake-flow-layout";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineSurface } from "./ThreadTimelineSurface";
import { createInertScrollPositionKeeper } from "@/test/scroll-position-keeper";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function paintFrame(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(32);
      return;
    }
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
    });
  });
}

describe("ThreadTimelineSurface load-older control", () => {
  it("resumes auto-loading after a context boundary replaces a timeline whose older page failed", async () => {
    const intersectionCallbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallbacks.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const emitLatestSentinelIntersection = () => {
      act(() => {
        intersectionCallbacks.at(-1)?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
    };
    const scrollElement = document.createElement("div");
    vi.spyOn(scrollElement, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 500),
    );
    const anchor = {
      positionKeeper: createInertScrollPositionKeeper(),
      holdContentPosition: vi.fn(),
      getScrollElement: () => scrollElement,
      isAtBottom: false,
      scrollElementIntoView: vi.fn(),
      scrollElementIntoViewClampedToMaxScroll: vi.fn(),
      scrollToBottom: vi.fn(),
    };
    const onLoadOlderRows = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Server error"))
      .mockReturnValue(new Promise(() => {}));
    const surface = (contextBoundarySeq: number | null) => (
      <BottomAnchorContext.Provider value={anchor}>
        <ThreadTimelineSurface
          activeThinking={null}
          contextBoundarySeq={contextBoundarySeq}
          hasOlderTimelineRows
          isThreadTimelinePending={false}
          onLoadOlderRows={onLoadOlderRows}
          showOngoingIndicator={false}
          threadId="thread-1"
          threadRuntimeDisplayStatus="idle"
          timelineError={false}
          timelineRows={[]}
          workspaceRootPath={undefined}
        />
      </BottomAnchorContext.Provider>
    );
    const view = render(surface(null));

    emitLatestSentinelIntersection();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load older messages" }),
      ).not.toBeNull();
    });

    view.rerender(surface(10));
    expect(screen.getByRole("status")).not.toBeNull();

    emitLatestSentinelIntersection();
    expect(onLoadOlderRows).toHaveBeenCalledTimes(2);
  });
});

describe("ThreadTimelineSurface catch-up indicator", () => {
  const props = {
    activeThinking: null,
    contextBoundarySeq: null,
    isThreadTimelinePending: false,
    showOngoingIndicator: false,
    threadId: "catch-up",
    threadRuntimeDisplayStatus: "idle" as const,
    timelineError: false,
    timelineRows: [],
    workspaceRootPath: undefined,
  };

  it("never shows loading for a catch-up that finishes within one second", async () => {
    vi.useFakeTimers();
    const view = render(
      <ThreadTimelineSurface {...props} isCatchingUpTimeline />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(
      <ThreadTimelineSurface {...props} isCatchingUpTimeline={false} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("delays each thread's indicator and hides immediately when caught up", async () => {
    vi.useFakeTimers();
    const view = render(
      <ThreadTimelineSurface {...props} isCatchingUpTimeline />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole("status").textContent).toBe(
      "Loading latest messages…",
    );
    view.rerender(
      <ThreadTimelineSurface
        {...props}
        threadId="another-thread"
        isCatchingUpTimeline
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("status").textContent).toBe(
      "Loading latest messages…",
    );
    view.rerender(
      <ThreadTimelineSurface
        {...props}
        threadId="another-thread"
        isCatchingUpTimeline={false}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(
      <ThreadTimelineSurface
        {...props}
        threadId="another-thread"
        isCatchingUpTimeline
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("ThreadTimelineSurface working indicator", () => {
  const INDICATOR_HEIGHT_PX = 44;
  const runningProps = {
    activeThinking: null,
    contextBoundarySeq: null,
    threadId: "running",
    threadRuntimeDisplayStatus: "active" as const,
    timelineError: false,
    workspaceRootPath: undefined,
  };
  const loadedRows = [
    conversationRow({ id: "request", role: "user", seq: 1, text: "Go" }),
  ];

  async function renderSurface() {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(
      INDICATOR_HEIGHT_PX,
    );
    const queryClient = new QueryClient();
    const surface = (
      props: Pick<
        ComponentProps<typeof ThreadTimelineSurface>,
        "isThreadTimelinePending" | "showOngoingIndicator" | "timelineRows"
      >,
    ) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ThreadTimelineSurface {...runningProps} {...props} />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const view = render(
      surface({
        isThreadTimelinePending: true,
        showOngoingIndicator: false,
        timelineRows: [],
      }),
    );
    await paintFrame();
    const styleChanges = new MutationObserver(() => {});
    styleChanges.observe(view.container, {
      attributeFilter: ["style"],
      attributeOldValue: true,
      subtree: true,
    });
    return { styleChanges, surface, view };
  }

  function indicatorHeightWrapper(): HTMLElement {
    const wrapper = screen
      .getByText("Working...")
      .closest<HTMLElement>('[style*="height 180ms"]');
    if (wrapper === null) throw new Error("Missing indicator height wrapper");
    return wrapper;
  }

  function grewFromCollapsed(
    records: MutationRecord[],
    wrapper: HTMLElement,
  ): boolean {
    return records.some(
      (record) =>
        record.target === wrapper &&
        (record.oldValue ?? "").includes("height: 0px") &&
        wrapper.style.transitionDuration !== "0s",
    );
  }

  it("appears at full height when it arrives with the thread's timeline", async () => {
    const { styleChanges, surface, view } = await renderSurface();

    view.rerender(
      surface({
        isThreadTimelinePending: false,
        showOngoingIndicator: true,
        timelineRows: loadedRows,
      }),
    );

    const wrapper = indicatorHeightWrapper();
    expect(wrapper.style.height).toBe(`${INDICATOR_HEIGHT_PX}px`);
    expect(grewFromCollapsed(styleChanges.takeRecords(), wrapper)).toBe(false);
  });

  it("appears at full height when the thread's timeline was already loaded", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(
      INDICATOR_HEIGHT_PX,
    );
    const view = render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ThreadTimelineSurface
            {...runningProps}
            isThreadTimelinePending={false}
            showOngoingIndicator
            timelineRows={loadedRows}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const styleChanges = new MutationObserver(() => {});
    styleChanges.observe(view.container, {
      attributeFilter: ["style"],
      attributeOldValue: true,
      subtree: true,
    });

    await paintFrame();

    const wrapper = indicatorHeightWrapper();
    expect(wrapper.style.height).toBe(`${INDICATOR_HEIGHT_PX}px`);
    expect(grewFromCollapsed(styleChanges.takeRecords(), wrapper)).toBe(false);
  });

  it("still animates open when a turn starts on a loaded timeline", async () => {
    const { styleChanges, surface, view } = await renderSurface();
    view.rerender(
      surface({
        isThreadTimelinePending: false,
        showOngoingIndicator: false,
        timelineRows: loadedRows,
      }),
    );
    styleChanges.takeRecords();

    view.rerender(
      surface({
        isThreadTimelinePending: false,
        showOngoingIndicator: true,
        timelineRows: loadedRows,
      }),
    );

    const wrapper = indicatorHeightWrapper();
    expect(wrapper.style.height).toBe(`${INDICATOR_HEIGHT_PX}px`);
    expect(grewFromCollapsed(styleChanges.takeRecords(), wrapper)).toBe(true);
  });
});

describe("ThreadTimelineSurface loading skeleton", () => {
  const generatedRows = Array.from({ length: 60 }, (_, index) =>
    conversationRow({
      id: `switch-row-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      seq: index + 1,
      text: `Generated message ${index}\n\n${"Detailed agent output line.\n".repeat(8)}`,
      turnId: `turn-${index}`,
    }),
  );

  function surface(
    threadId: string,
    pending: boolean,
    replacesThreadRows = false,
  ) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ThreadTimelineSurface
            key={threadId}
            activeThinking={null}
            contextBoundarySeq={null}
            isThreadTimelinePending={pending}
            replacesThreadRows={replacesThreadRows}
            showOngoingIndicator={false}
            threadId={threadId}
            threadRuntimeDisplayStatus="idle"
            timelineError={false}
            timelineRows={pending ? [] : generatedRows}
            workspaceRootPath={undefined}
          />
        </QueryClientProvider>
      </MemoryRouter>
    );
  }

  it("waits before showing a skeleton for a first load", async () => {
    vi.useFakeTimers();
    render(surface("thread-cold", true));

    expect(screen.queryByRole("status", { name: "Loading thread" })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(
      screen.getByRole("status", { name: "Loading thread" }),
    ).not.toBeNull();
  });

  it("shows the skeleton at once when it replaces another thread's rows", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    );
    const view = render(surface("thread-a", false));
    await paintFrame();
    expect(screen.getByText(/Generated message 59/)).not.toBeNull();

    view.rerender(surface("thread-b", true, true));

    expect(
      screen.getByRole("status", { name: "Loading thread" }),
    ).not.toBeNull();
  });
});

describe("ThreadTimelineSurface first paint", () => {
  const rowsFor = (label: string) =>
    Array.from({ length: 40 }, (_, index) =>
      conversationRow({
        id: `${label}-row-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        seq: index + 1,
        text: `${label} message ${index}`,
        turnId: `${label}-turn-${index}`,
      }),
    );
  const threadARows = rowsFor("Alpha");
  const threadBRows = rowsFor("Beta");

  function anchor(): ComponentProps<
    typeof BottomAnchorContext.Provider
  >["value"] {
    const scrollElement = document.createElement("div");
    vi.spyOn(scrollElement, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 600, 800),
    );
    return {
      positionKeeper: createInertScrollPositionKeeper(),
      holdContentPosition: vi.fn(),
      getScrollElement: () => scrollElement,
      isAtBottom: true,
      scrollElementIntoView: vi.fn(),
      scrollElementIntoViewClampedToMaxScroll: vi.fn(),
      scrollToBottom: vi.fn(),
    };
  }

  function surface({
    bottomAnchor,
    onLoadOlderRows = vi.fn(),
    pending = false,
    rows,
    threadId,
  }: {
    bottomAnchor: ReturnType<typeof anchor>;
    onLoadOlderRows?: () => Promise<void> | void;
    pending?: boolean;
    rows: ReturnType<typeof rowsFor>;
    threadId: string;
  }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <BottomAnchorContext.Provider value={bottomAnchor}>
            <ThreadTimelineSurface
              activeThinking={null}
              contextBoundarySeq={null}
              hasOlderTimelineRows
              isThreadTimelinePending={pending}
              onLoadOlderRows={onLoadOlderRows}
              showOngoingIndicator
              threadId={threadId}
              threadRuntimeDisplayStatus="active"
              timelineError={false}
              timelineRows={pending ? [] : rows}
              workspaceRootPath={undefined}
            />
          </BottomAnchorContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    );
  });

  it("shows rows that were ready on its first render without a loading skeleton", () => {
    render(
      surface({
        bottomAnchor: anchor(),
        rows: threadARows,
        threadId: "thread-a",
      }),
    );

    expect(screen.getByText("Alpha message 39")).not.toBeNull();
    expect(screen.getByText("Working...")).not.toBeNull();
    expect(screen.queryByRole("status", { name: "Loading thread" })).toBeNull();
  });

  it("renders rows that arrive after the shell painted in the same commit", async () => {
    const bottomAnchor = anchor();
    const view = render(
      surface({
        bottomAnchor,
        pending: true,
        rows: threadARows,
        threadId: "thread-a",
      }),
    );
    await paintFrame();

    view.rerender(
      surface({ bottomAnchor, rows: threadARows, threadId: "thread-a" }),
    );

    expect(screen.getByText("Alpha message 39")).not.toBeNull();
  });

  it("switches straight to the next thread's rows when they are already loaded", async () => {
    const bottomAnchor = anchor();
    const view = render(
      surface({ bottomAnchor, rows: threadARows, threadId: "thread-a" }),
    );
    await paintFrame();
    expect(screen.getByText("Alpha message 39")).not.toBeNull();

    view.rerender(
      surface({ bottomAnchor, rows: threadBRows, threadId: "thread-b" }),
    );

    expect(screen.queryByText("Alpha message 39")).toBeNull();
    expect(screen.getByText("Beta message 39")).not.toBeNull();
    expect(screen.queryByRole("status", { name: "Loading thread" })).toBeNull();
  });
});

describe("ThreadTimelineSurface first paint scroll restoration", () => {
  const ROW_HEIGHT = 120;
  const THREAD_ID = "thread-restore";
  const rows = Array.from({ length: 40 }, (_, index) =>
    conversationRow({
      id: `restore-row-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      seq: index + 1,
      text: `Restore message ${index}`,
      turnId: `restore-turn-${index}`,
    }),
  );
  let restoreLayout: (() => void) | null = null;

  afterEach(() => {
    restoreLayout?.();
    restoreLayout = null;
    getDefaultStore().set(
      threadTimelineScrollAnchorAtomFamily(THREAD_ID),
      null,
    );
  });

  it("restores the saved reading row on the first render and keeps it in place once the window settles", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    );
    const getAttribute = Element.prototype.getAttribute;
    vi.spyOn(Element.prototype, "getAttribute").mockImplementation(function (
      this: Element,
      name: string,
    ) {
      if (
        name === "data-fake-height" &&
        getAttribute.call(this, "data-timeline-row-id") !== null
      ) {
        return String(ROW_HEIGHT);
      }
      return getAttribute.call(this, name);
    });
    const layout = installFakeFlowLayout({
      scrollElement: () =>
        document.querySelector<HTMLElement>("[data-page-scroll-viewport]"),
      viewportHeight: 600,
    });
    restoreLayout = layout.restore;
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily(THREAD_ID), {
      atBottom: false,
      offsetWithinRow: 30,
      rowId: "restore-row-10",
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <PageShell
            footer={<div data-fake-height={80}>composer</div>}
            scrollAnchorThreadId={THREAD_ID}
            scrollBehavior="bottom-anchor"
          >
            <ThreadTimelineSurface
              activeThinking={null}
              contextBoundarySeq={null}
              isThreadTimelinePending={false}
              showOngoingIndicator={false}
              threadId={THREAD_ID}
              threadRuntimeDisplayStatus="idle"
              timelineError={false}
              timelineRows={rows}
              workspaceRootPath={undefined}
            />
          </PageShell>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const isMounted = (index: number) =>
      document.querySelector(
        `[data-timeline-row-id="restore-row-${index}"]`,
      ) !== null;
    const readerTop = () =>
      document
        .querySelector('[data-timeline-row-id="restore-row-10"]')
        ?.getBoundingClientRect().top;

    expect(screen.queryByRole("status", { name: "Loading thread" })).toBeNull();
    act(() => layout.flushResizeObservers());

    expect(readerTop()).toBe(-30);

    await paintFrame();
    act(() => layout.flushResizeObservers());

    expect(readerTop()).toBe(-30);
    expect(isMounted(2)).toBe(true);
    expect(isMounted(22)).toBe(true);
  });
});
