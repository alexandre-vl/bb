// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { createInertScrollPositionKeeper } from "@/test/scroll-position-keeper";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import type { ThreadTimelineUnreadDividerPlacement } from "./types";

const ROW_COUNT = 240;
const READ_ROW_COUNT = 232;

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn(() => []);
  unobserve = vi.fn();
}

class ResizeObserverStub implements ResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

const rows: TimelineRow[] = Array.from({ length: ROW_COUNT }, (_, index) =>
  conversationRow({
    id: `long-message-${index}`,
    role: "assistant",
    seq: index + 1,
    startedAt: (index + 1) * 1_000,
    text: `Message ${index}\n\n${"A paragraph of generated agent output.\n\n".repeat(12)}`,
    turnId: `turn-${index}`,
  }),
);

const placement: ThreadTimelineUnreadDividerPlacement = {
  kind: "after-cutoff",
  cutoffAt: READ_ROW_COUNT * 1_000,
};

function makeBottomAnchor(): BottomAnchorContextValue {
  const scrollElement = document.createElement("div");
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

function renderRows(
  bottomAnchor: BottomAnchorContextValue,
  timelineRows: TimelineRow[],
  isCatchingUpTimeline = false,
) {
  const queryClient = new QueryClient();
  const tree = (nextRows: TimelineRow[], catchingUp: boolean) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <BottomAnchorContext.Provider value={bottomAnchor}>
          <ThreadTimelineRows
            isCatchingUpTimeline={catchingUp}
            threadId="thr_long"
            timelineRows={nextRows}
            threadRuntimeDisplayStatus="idle"
            unreadDividerAutoScroll
            unreadDividerPlacement={placement}
            workspaceRootPath={undefined}
          />
        </BottomAnchorContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(tree(timelineRows, isCatchingUpTimeline));
  return {
    rerender: (nextRows: TimelineRow[], catchingUp = false) =>
      view.rerender(tree(nextRows, catchingUp)),
    view,
  };
}

async function flushAnimationFrames(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

function divider(): HTMLElement | null {
  return document.querySelector('[data-testid="thread-unread-divider"]');
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ThreadTimelineRows unread divider scroll", () => {
  it("scrolls a long transcript to the divider shown with its first rows", async () => {
    const bottomAnchor = makeBottomAnchor();

    renderRows(bottomAnchor, rows);

    await waitFor(() => {
      expect(
        bottomAnchor.scrollElementIntoViewClampedToMaxScroll,
      ).toHaveBeenCalledWith({ element: divider() });
    });
  });

  it("scrolls to the divider that arrives with a cached transcript's catch-up", async () => {
    const bottomAnchor = makeBottomAnchor();
    const view = renderRows(bottomAnchor, rows.slice(0, READ_ROW_COUNT), true);
    await flushAnimationFrames();
    expect(divider()).toBeNull();

    view.rerender(rows);
    await flushAnimationFrames();

    expect(
      bottomAnchor.scrollElementIntoViewClampedToMaxScroll,
    ).toHaveBeenCalledWith({ element: divider() });
  });

  it("leaves the reader in place when the divider appears after the transcript was current", async () => {
    const bottomAnchor = makeBottomAnchor();
    const view = renderRows(bottomAnchor, rows.slice(0, READ_ROW_COUNT));
    await flushAnimationFrames();
    expect(divider()).toBeNull();

    view.rerender(rows);
    await flushAnimationFrames();

    expect(divider()).not.toBeNull();
    expect(
      bottomAnchor.scrollElementIntoViewClampedToMaxScroll,
    ).not.toHaveBeenCalled();
  });

  it("does not move a reader who scrolled before the divider's frame", async () => {
    const bottomAnchor = makeBottomAnchor();
    vi.spyOn(bottomAnchor.positionKeeper, "hasUserScrolled").mockReturnValue(
      true,
    );

    renderRows(bottomAnchor, rows);
    await flushAnimationFrames();

    expect(divider()).not.toBeNull();
    expect(
      bottomAnchor.scrollElementIntoViewClampedToMaxScroll,
    ).not.toHaveBeenCalled();
  });
});
