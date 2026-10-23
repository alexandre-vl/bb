// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THREAD_ROW_LONG_PRESS_MS,
  THREAD_ROW_SWIPE_OPEN_PX,
  useThreadRowTouch,
} from "./useThreadRowTouch.js";

const ROW_WIDTH = 300;
const SETTLE_MS = 200;

function touchList(...touches: Touch[]): TouchList {
  const list = {
    length: touches.length,
    item: (index: number) => touches[index] ?? null,
  };
  touches.forEach((touch, index) => {
    Object.defineProperty(list, index, { value: touch });
  });
  return list as unknown as TouchList;
}

function fireTouch(
  target: Element | Window,
  type: "touchstart" | "touchmove" | "touchend",
  x: number,
  y: number,
): Event {
  const touch = { identifier: 1, clientX: x, clientY: y } as Touch;
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: type === "touchend" ? touchList() : touchList(touch) },
    changedTouches: { value: touchList(touch) },
  });
  fireEvent(target, event);
  return event;
}

function TouchRow({
  onLongPress,
  onArchive,
}: {
  onLongPress: () => void;
  onArchive: () => void;
}) {
  const { ref, phase, archive } = useThreadRowTouch({
    enabled: true,
    swipeEnabled: true,
    longPressEnabled: true,
    onLongPress,
    onArchive,
  });
  return (
    <>
      <div ref={ref} data-testid="row" data-phase={phase}>
        {phase !== "idle" ? (
          <button type="button" data-sidebar-swipe-under="" onClick={archive}>
            Archive
          </button>
        ) : null}
        <span>Thread title</span>
      </div>
      <button type="button" onClick={outsideClick}>
        Outside
      </button>
    </>
  );
}

const outsideClick = vi.fn();

function renderRow() {
  const onLongPress = vi.fn();
  const onArchive = vi.fn();
  render(<TouchRow onLongPress={onLongPress} onArchive={onArchive} />);
  const row = screen.getByTestId("row");
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
    width: ROW_WIDTH,
    height: 30,
    top: 0,
    left: 0,
    right: ROW_WIDTH,
    bottom: 30,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return { row, onLongPress, onArchive };
}

function settle() {
  act(() => {
    vi.advanceTimersByTime(SETTLE_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  outsideClick.mockClear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useThreadRowTouch", () => {
  it("settles a right swipe open at 104 px and archives from the revealed action", () => {
    const { row, onArchive } = renderRow();

    fireTouch(row, "touchstart", 20, 10);
    const move = fireTouch(window, "touchmove", 110, 12);
    expect(move.defaultPrevented).toBe(true);
    fireTouch(window, "touchend", 110, 12);
    settle();

    expect(row.dataset.phase).toBe("open");
    expect(row.style.getPropertyValue("--bb-sidebar-swipe-x")).toBe(
      `${THREAD_ROW_SWIPE_OPEN_PX}px`,
    );
    const archive = screen.getByRole("button", { name: "Archive" });
    fireEvent.pointerDown(archive);
    fireEvent.click(archive);
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("archives on a swipe across more than 55 % of the row", () => {
    const { row, onArchive } = renderRow();

    fireTouch(row, "touchstart", 20, 10);
    fireTouch(window, "touchmove", 20 + ROW_WIDTH * 0.56, 12);
    fireTouch(window, "touchend", 20 + ROW_WIDTH * 0.56, 12);
    expect(onArchive).not.toHaveBeenCalled();
    settle();

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(row.dataset.phase).toBe("idle");
  });

  it("springs back from a short swipe without archiving", () => {
    const { row, onArchive } = renderRow();

    fireTouch(row, "touchstart", 20, 10);
    fireTouch(window, "touchmove", 70, 12);
    fireTouch(window, "touchend", 70, 12);
    settle();

    expect(row.dataset.phase).toBe("idle");
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("leaves a left swipe unclaimed for the drawer", () => {
    const { row } = renderRow();

    fireTouch(row, "touchstart", 200, 10);
    const first = fireTouch(window, "touchmove", 185, 10);
    const second = fireTouch(window, "touchmove", 120, 10);
    fireTouch(window, "touchend", 120, 10);

    expect(first.defaultPrevented).toBe(false);
    expect(second.defaultPrevented).toBe(false);
    expect(row.dataset.phase).toBe("idle");
  });

  it("opens the sheet once on a long press and swallows the click that lands under the finger", () => {
    const { row, onLongPress } = renderRow();

    fireTouch(row, "touchstart", 40, 10);
    act(() => {
      vi.advanceTimersByTime(THREAD_ROW_LONG_PRESS_MS);
    });
    fireTouch(window, "touchend", 40, 10);
    fireEvent.click(screen.getByRole("button", { name: "Outside" }));

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(outsideClick).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    fireEvent.click(screen.getByRole("button", { name: "Outside" }));
    expect(outsideClick).toHaveBeenCalledTimes(1);
  });

  it("drops the long press once the finger starts scrolling", () => {
    const { row, onLongPress } = renderRow();

    fireTouch(row, "touchstart", 40, 10);
    fireTouch(window, "touchmove", 41, 30);
    act(() => {
      vi.advanceTimersByTime(THREAD_ROW_LONG_PRESS_MS);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
