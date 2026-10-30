// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";
import { ScrollPositionKeeper } from "@/components/ui/scroll-position-keeper";
import { installFakeFlowLayout } from "@/test/fake-flow-layout";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

const VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT = 120;
const ROW_COUNT = 200;
const cleanups: (() => void)[] = [];

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

const rows = Array.from({ length: ROW_COUNT }, (_, index) =>
  conversationRow({
    id: `paint-row-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    seq: index + 1,
    text: `Painted message ${index}`,
    turnId: `turn-${index}`,
  }),
);

function setup() {
  const scrollElement = document.createElement("div");
  const content = document.createElement("div");
  scrollElement.append(content);
  document.body.append(scrollElement);
  const layout = installFakeFlowLayout({
    scrollElement,
    viewportHeight: VIEWPORT_HEIGHT,
  });
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
  const positionKeeper = new ScrollPositionKeeper({
    bottomThresholdPx: 4,
    deferWritesWhileScrolling: false,
    getContentElement: () => content,
    getFloorElement: () => null,
    getFooterElement: () => null,
    getScrollElement: () => scrollElement,
    getTopLevelRows: () =>
      content.querySelectorAll<HTMLElement>(
        '[data-timeline-row-list="top-level"] > [data-timeline-items] > [data-timeline-row-id]',
      ),
    initiallyAttached: true,
  });
  const disconnect = positionKeeper.connect(scrollElement);
  cleanups.push(layout.restore, disconnect);
  const bottomAnchor: BottomAnchorContextValue = {
    getScrollElement: () => scrollElement,
    holdContentPosition: vi.fn(),
    isAtBottom: true,
    positionKeeper,
    scrollElementIntoView: vi.fn(),
    scrollToBottom: vi.fn(),
  };
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <BottomAnchorContext.Provider value={bottomAnchor}>
          <ThreadTimelineRows
            threadId="thr_first_paint"
            timelineRows={rows}
            threadRuntimeDisplayStatus="idle"
            workspaceRootPath={undefined}
          />
        </BottomAnchorContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
    { container: content },
  );
  const mounted = () =>
    [...content.querySelectorAll<HTMLElement>("[data-timeline-row-id]")].map(
      (row) => row.dataset.timelineRowId ?? "",
    );
  const inView = () =>
    mounted().filter((id) => {
      const row = content.querySelector(`[data-timeline-row-id="${id}"]`);
      const top = row?.getBoundingClientRect().top ?? Infinity;
      return top < VIEWPORT_HEIGHT && top + ROW_HEIGHT > 0;
    });
  const lastRowBottom = () =>
    content
      .querySelector(`[data-timeline-row-id="paint-row-${ROW_COUNT - 1}"]`)
      ?.getBoundingClientRect().bottom;
  return { inView, lastRowBottom, layout, mounted };
}

async function paintFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
    });
  });
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const run of cleanups.splice(0).reverse()) run();
  document.body.replaceChildren();
});

describe("ThreadTimelineRows first paint", () => {
  it("mounts the rows in view at the bottom first and the overscan after the paint", async () => {
    const harness = setup();
    const firstPaint = harness.mounted();
    const firstPaintInView = harness.inView();

    expect(firstPaint).toContain(`paint-row-${ROW_COUNT - 1}`);
    expect(firstPaint).toEqual(expect.arrayContaining(firstPaintInView));
    expect(firstPaint.length).toBeLessThan(firstPaintInView.length + 8);
    expect(harness.lastRowBottom()).toBe(VIEWPORT_HEIGHT);

    await paintFrame();

    const afterPaint = harness.mounted();
    expect(afterPaint).toEqual(expect.arrayContaining(firstPaint));
    expect(afterPaint.length).toBeGreaterThanOrEqual(
      harness.inView().length + 8,
    );
    expect(harness.inView()).toEqual(firstPaintInView);
    expect(harness.lastRowBottom()).toBe(VIEWPORT_HEIGHT);
    expect(harness.layout.scrollTop).toBe(harness.layout.maxScrollTop());
  });
});
