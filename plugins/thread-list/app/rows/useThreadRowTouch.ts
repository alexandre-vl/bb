import { useCallback, useLayoutEffect, useRef, useState } from "react";

export const THREAD_ROW_LONG_PRESS_MS = 700;
export const THREAD_ROW_SWIPE_OPEN_PX = 104;
export const THREAD_ROW_SWIPE_FULL_RATIO = 0.55;

const LONG_PRESS_SLOP_PX = 10;
const SWIPE_INTENT_PX = 12;
const SWIPE_OPEN_MIN_PX = 72;
const SWIPE_SETTLE_MS = 160;
const SWIPE_OFFSET_PROPERTY = "--bb-sidebar-swipe-x";
const SWIPE_UNDER_SELECTOR = "[data-sidebar-swipe-under]";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type ThreadRowSwipePhase = "idle" | "dragging" | "settling" | "open";

type SwipeOutcome = "idle" | "open" | "archive";

interface ThreadRowTouchOptions {
  enabled: boolean;
  swipeEnabled: boolean;
  longPressEnabled: boolean;
  onLongPress: () => void;
  onArchive: () => void;
}

interface TouchGesture {
  id: number;
  startX: number;
  startY: number;
  offset: number;
  swiping: boolean;
  longPressed: boolean;
  timer: number | null;
}

interface PendingSettle {
  offset: number;
  outcome: SwipeOutcome;
}

interface OpenSwipe {
  owner: object;
  close: () => void;
}

let openSwipe: OpenSwipe | null = null;

function findTouch(list: TouchList, id: number): Touch | null {
  for (let index = 0; index < list.length; index += 1) {
    const touch = list.item(index);
    if (touch?.identifier === id) return touch;
  }
  return null;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
}

export function useThreadRowTouch(options: ThreadRowTouchOptions) {
  const ownerRef = useRef<object>({});
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  const [phase, setPhase] = useState<ThreadRowSwipePhase>("idle");
  const phaseRef = useRef<ThreadRowSwipePhase>("idle");
  const elementRef = useRef<HTMLElement | null>(null);
  const gestureRef = useRef<TouchGesture | null>(null);
  const pendingRef = useRef<PendingSettle | null>(null);
  const disarmClickRef = useRef<(() => void) | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const stopGestureRef = useRef<(() => void) | null>(null);

  const updatePhase = useCallback((next: ThreadRowSwipePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const setOffset = useCallback((offset: number) => {
    elementRef.current?.style.setProperty(SWIPE_OFFSET_PROPERTY, `${offset}px`);
  }, []);

  const settle = useCallback(
    (offset: number, outcome: SwipeOutcome) => {
      pendingRef.current = { offset, outcome };
      updatePhase("settling");
    },
    [updatePhase],
  );

  const releaseOpenSwipe = useCallback(() => {
    if (openSwipe?.owner === ownerRef.current) openSwipe = null;
  }, []);

  const close = useCallback(() => {
    releaseOpenSwipe();
    if (phaseRef.current === "open") settle(0, "idle");
  }, [releaseOpenSwipe, settle]);

  const reset = useCallback(() => {
    releaseOpenSwipe();
    pendingRef.current = null;
    elementRef.current?.style.removeProperty(SWIPE_OFFSET_PROPERTY);
    updatePhase("idle");
  }, [releaseOpenSwipe, updatePhase]);

  const archive = useCallback(() => {
    optionsRef.current.onArchive();
    reset();
  }, [reset]);

  useLayoutEffect(() => {
    if (phase !== "settling") return;
    const pending = pendingRef.current;
    if (pending === null) return;
    setOffset(pending.offset);
    const timer = window.setTimeout(
      () => {
        pendingRef.current = null;
        if (pending.outcome === "open") {
          openSwipe = { owner: ownerRef.current, close };
          updatePhase("open");
          return;
        }
        if (pending.outcome === "archive") {
          archive();
          return;
        }
        reset();
      },
      prefersReducedMotion() ? 0 : SWIPE_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [archive, close, phase, reset, setOffset, updatePhase]);

  useLayoutEffect(() => {
    if (phase !== "open") return;
    const element = elementRef.current;
    if (element === null) return;
    const closeFromOutside = (event: Event) => {
      if (event.target instanceof Node && element.contains(event.target)) {
        return;
      }
      close();
    };
    const doc = element.ownerDocument;
    doc.addEventListener("touchstart", closeFromOutside, {
      capture: true,
      passive: true,
    });
    doc.addEventListener("pointerdown", closeFromOutside, true);
    return () => {
      doc.removeEventListener("touchstart", closeFromOutside, true);
      doc.removeEventListener("pointerdown", closeFromOutside, true);
    };
  }, [close, phase]);

  const attach = useCallback(
    (element: HTMLElement) => {
      const doc = element.ownerDocument;
      const suppressClick = () => {
        disarmClickRef.current?.();
        const disarm = () => {
          doc.removeEventListener("click", swallowClick, true);
          doc.removeEventListener("pointerdown", disarm, true);
          doc.removeEventListener("keydown", disarm, true);
          if (disarmClickRef.current === disarm) disarmClickRef.current = null;
        };
        const swallowClick = (event: MouseEvent) => {
          disarm();
          event.preventDefault();
          event.stopPropagation();
        };
        doc.addEventListener("click", swallowClick, true);
        doc.addEventListener("pointerdown", disarm, true);
        doc.addEventListener("keydown", disarm, true);
        disarmClickRef.current = disarm;
      };
      const clearLongPress = (gesture: TouchGesture) => {
        if (gesture.timer === null) return;
        window.clearTimeout(gesture.timer);
        gesture.timer = null;
      };
      const firePress = (gesture: TouchGesture) => {
        clearLongPress(gesture);
        if (gesture.longPressed) return;
        gesture.longPressed = true;
        suppressClick();
        optionsRef.current.onLongPress();
      };
      const stopGesture = () => {
        stopGestureRef.current?.();
        stopGestureRef.current = null;
        const gesture = gestureRef.current;
        gestureRef.current = null;
        if (gesture !== null) clearLongPress(gesture);
        return gesture;
      };
      const onMove = (event: TouchEvent) => {
        const gesture = gestureRef.current;
        if (gesture === null) return;
        const touch =
          findTouch(event.touches, gesture.id) ??
          findTouch(event.changedTouches, gesture.id);
        if (touch === null) return;
        const dx = touch.clientX - gesture.startX;
        const dy = touch.clientY - gesture.startY;
        if (!gesture.swiping) {
          if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) clearLongPress(gesture);
          if (gesture.longPressed) return;
          const claims =
            optionsRef.current.swipeEnabled &&
            dx > SWIPE_INTENT_PX &&
            Math.abs(dx) > Math.abs(dy) * 1.25 &&
            element.dataset.sidebarTouchArmed !== "true";
          if (!claims) {
            if (Math.abs(dy) > SWIPE_INTENT_PX || dx < -SWIPE_INTENT_PX) {
              stopGesture();
            }
            return;
          }
          gesture.swiping = true;
          clearLongPress(gesture);
          updatePhase("dragging");
        }
        if (event.cancelable) event.preventDefault();
        gesture.offset = Math.min(
          element.getBoundingClientRect().width,
          Math.max(0, dx),
        );
        setOffset(gesture.offset);
      };
      const onEnd = (event: TouchEvent) => {
        const current = gestureRef.current;
        if (
          current === null ||
          findTouch(event.changedTouches, current.id) === null
        ) {
          return;
        }
        const gesture = stopGesture();
        if (gesture === null) return;
        if (gesture.longPressed) {
          suppressClick();
          return;
        }
        if (!gesture.swiping) return;
        suppressClick();
        if (event.type === "touchcancel") {
          settle(0, "idle");
          return;
        }
        const width = element.getBoundingClientRect().width;
        if (gesture.offset >= width * THREAD_ROW_SWIPE_FULL_RATIO) {
          settle(width, "archive");
        } else if (gesture.offset >= SWIPE_OPEN_MIN_PX) {
          settle(THREAD_ROW_SWIPE_OPEN_PX, "open");
        } else {
          settle(0, "idle");
        }
      };
      const onStart = (event: TouchEvent) => {
        if (openSwipe !== null && openSwipe.owner !== ownerRef.current) {
          openSwipe.close();
        }
        stopGesture();
        const current = optionsRef.current;
        if (!current.enabled || event.touches.length !== 1) return;
        if (phaseRef.current === "open") {
          if (
            event.target instanceof Element &&
            event.target.closest(SWIPE_UNDER_SELECTOR) !== null
          ) {
            return;
          }
          suppressClick();
          close();
          return;
        }
        if (phaseRef.current !== "idle") return;
        const touch = event.touches.item(0);
        if (touch === null) return;
        const gesture: TouchGesture = {
          id: touch.identifier,
          startX: touch.clientX,
          startY: touch.clientY,
          offset: 0,
          swiping: false,
          longPressed: false,
          timer: null,
        };
        if (current.longPressEnabled) {
          gesture.timer = window.setTimeout(
            () => firePress(gesture),
            THREAD_ROW_LONG_PRESS_MS,
          );
        }
        gestureRef.current = gesture;
        const view = element.ownerDocument.defaultView ?? window;
        view.addEventListener("touchmove", onMove, { passive: false });
        view.addEventListener("touchend", onEnd);
        view.addEventListener("touchcancel", onEnd);
        stopGestureRef.current = () => {
          view.removeEventListener("touchmove", onMove);
          view.removeEventListener("touchend", onEnd);
          view.removeEventListener("touchcancel", onEnd);
        };
      };
      const onContextMenu = (event: MouseEvent) => {
        const current = optionsRef.current;
        if (!current.enabled || !current.longPressEnabled) return;
        event.preventDefault();
        const gesture = gestureRef.current;
        if (gesture === null) {
          suppressClick();
          current.onLongPress();
          return;
        }
        firePress(gesture);
      };
      element.addEventListener("touchstart", onStart, { passive: true });
      element.addEventListener("contextmenu", onContextMenu);
      return () => {
        element.removeEventListener("touchstart", onStart);
        element.removeEventListener("contextmenu", onContextMenu);
        disarmClickRef.current?.();
        stopGesture();
        releaseOpenSwipe();
      };
    },
    [close, releaseOpenSwipe, setOffset, settle, updatePhase],
  );

  const ref = useCallback(
    (element: HTMLElement | null) => {
      detachRef.current?.();
      detachRef.current = null;
      elementRef.current = element;
      if (element !== null) detachRef.current = attach(element);
    },
    [attach],
  );

  return { ref, phase, archive, close };
}
