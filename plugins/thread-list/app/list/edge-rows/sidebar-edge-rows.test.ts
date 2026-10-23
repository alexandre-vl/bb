import { describe, expect, it } from "vitest";
import {
  describeEdgeRowCounts,
  resolveEdgeRow,
  resolveTopEdgeRowTop,
  type EdgeRowLayout,
  type EdgeRowTarget,
} from "./sidebar-edge-rows.js";

function layout(overrides: Partial<EdgeRowLayout>): EdgeRowLayout {
  return {
    scrollport: { top: 0, bottom: 400 },
    stuckBottom: 0,
    stickyRows: [],
    targets: [],
    edgeHeight: 30,
    ...overrides,
  };
}

function target(top: number, kind: "needsYou" | "failed"): EdgeRowTarget {
  return {
    top,
    bottom: top + 28,
    needsYou: kind === "needsYou" ? 1 : 0,
    failed: kind === "failed" ? 1 : 0,
  };
}

describe("resolveEdgeRow", () => {
  it("ignores rows that are even partly visible", () => {
    expect(
      resolveEdgeRow(
        layout({
          stuckBottom: 30,
          targets: [target(380, "failed"), target(10, "needsYou")],
        }),
      ),
    ).toBeNull();
  });

  it("names every row below and points at the nearest, ahead of rows above", () => {
    expect(
      resolveEdgeRow(
        layout({
          stuckBottom: 60,
          targets: [
            target(10, "needsYou"),
            target(700, "failed"),
            target(450, "needsYou"),
          ],
        }),
      ),
    ).toEqual({
      direction: "below",
      needsYou: 1,
      failed: 1,
      nearest: 2,
      top: 370,
    });
  });

  it("counts rows hidden under the stuck headers as above", () => {
    expect(
      resolveEdgeRow(
        layout({
          stuckBottom: 60,
          targets: [
            target(30, "failed"),
            target(-200, "needsYou"),
            target(100, "needsYou"),
          ],
        }),
      ),
    ).toEqual({
      direction: "above",
      needsYou: 1,
      failed: 1,
      nearest: 0,
      top: 60,
    });
  });

  it("adds up a collapsed container's counts", () => {
    expect(
      resolveEdgeRow(
        layout({
          targets: [{ top: 500, bottom: 528, needsYou: 2, failed: 3 }],
        }),
      ),
    ).toMatchObject({ direction: "below", needsYou: 2, failed: 3 });
  });

  it("shows nothing when the top edge row would not fit under the sticky rows", () => {
    expect(
      resolveEdgeRow(
        layout({
          scrollport: { top: 0, bottom: 100 },
          stuckBottom: 60,
          stickyRows: [{ top: 60, bottom: 88 }],
          targets: [target(-100, "failed")],
        }),
      ),
    ).toBeNull();
  });
});

describe("resolveTopEdgeRowTop", () => {
  it("drops below each sticky row it would overlap", () => {
    expect(
      resolveTopEdgeRowTop({
        stuckBottom: 30,
        stickyRows: [
          { top: 70, bottom: 98 },
          { top: 40, bottom: 68 },
        ],
        edgeHeight: 30,
      }),
    ).toBe(98);
  });

  it("stays under the stuck rows when the next sticky row is an edge row away", () => {
    expect(
      resolveTopEdgeRowTop({
        stuckBottom: 30,
        stickyRows: [{ top: 61, bottom: 89 }],
        edgeHeight: 30,
      }),
    ).toBe(30);
  });
});

describe("describeEdgeRowCounts", () => {
  it.each([
    [{ needsYou: 1, failed: 0 }, "1 needs you"],
    [{ needsYou: 2, failed: 1 }, "2 need you · 1 failed"],
    [{ needsYou: 0, failed: 3 }, "3 failed"],
  ])("describes %o as %s", (counts, label) => {
    expect(describeEdgeRowCounts(counts)).toBe(label);
  });
});
