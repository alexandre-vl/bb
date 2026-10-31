// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_ACTIVITY_WINDOW_MS } from "@/lib/user-activity";
import { useThreadReadTracking } from "./useThreadReadTracking";

type MarkThreadReadMutation = Parameters<
  typeof useThreadReadTracking
>[0]["markThreadRead"];

function makeMarkThreadRead() {
  return {
    hasFailed: vi.fn<MarkThreadReadMutation["hasFailed"]>(() => false),
    noteSeenRead: vi.fn<MarkThreadReadMutation["noteSeenRead"]>(),
    mutateAsync: vi.fn<MarkThreadReadMutation["mutateAsync"]>(
      () => new Promise(() => {}),
    ),
  } satisfies MarkThreadReadMutation;
}

function setDocumentVisibilityState(
  visibilityState: DocumentVisibilityState,
): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
}

function hideDocument(): void {
  act(() => {
    setDocumentVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function pressKey(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown"));
  });
}

function pressKeyWithFakeTimers(): void {
  hideDocument();
  setDocumentVisibilityState("visible");
  vi.useFakeTimers();
  pressKey();
}

describe("useThreadReadTracking", () => {
  beforeEach(() => {
    pressKey();
  });

  afterEach(() => {
    cleanup();
    hideDocument();
    setDocumentVisibilityState("visible");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not mark read without a visible thread", () => {
    const markThreadRead = makeMarkThreadRead();

    renderHook(() =>
      useThreadReadTracking({
        markThreadRead,
        descendants: [],
        thread: undefined,
      }),
    );

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();
  });

  it("marks a thread restored by a mobile pageshow read on the next touch", () => {
    hideDocument();
    const markThreadRead = makeMarkThreadRead();

    renderHook(() =>
      useThreadReadTracking({
        markThreadRead,
        descendants: [],
        thread: {
          id: "thr_mobile_restore",
          lastReadAt: 10,
          latestAttentionAt: 20,
        },
      }),
    );

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    act(() => {
      setDocumentVisibilityState("visible");
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("touchstart"));
    });

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);
    expect(markThreadRead.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: "thr_mobile_restore" }),
    );
  });

  it("marks an unread thread once per attention timestamp", () => {
    const markThreadRead = makeMarkThreadRead();
    const { rerender } = renderHook(
      ({ latestAttentionAt }: { latestAttentionAt: number }) =>
        useThreadReadTracking({
          markThreadRead,
          descendants: [],
          thread: {
            id: "thr_side_chat",
            lastReadAt: 10,
            latestAttentionAt,
          },
        }),
      { initialProps: { latestAttentionAt: 20 } },
    );

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);
    expect(markThreadRead.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: "thr_side_chat" }),
    );

    rerender({ latestAttentionAt: 20 });
    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);

    rerender({ latestAttentionAt: 30 });
    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("reads a read thread again with its descendants when it opens with one unread", () => {
    const markThreadRead = makeMarkThreadRead();

    renderHook(() =>
      useThreadReadTracking({
        markThreadRead,
        thread: { id: "thr_parent", lastReadAt: 20, latestAttentionAt: 20 },
        descendants: [
          { id: "thr_child", lastReadAt: 10, latestAttentionAt: 40 },
          { id: "thr_grandchild", lastReadAt: 30, latestAttentionAt: 30 },
        ],
      }),
    );

    expect(markThreadRead.mutateAsync).toHaveBeenCalledExactlyOnceWith({
      threadId: "thr_parent",
      throughAttentionAt: 20,
      descendantsThroughAttentionAt: 40,
    });
  });

  it("reads a descendant that turns up unread after the thread opened", () => {
    const markThreadRead = makeMarkThreadRead();
    type Descendants = {
      id: string;
      lastReadAt: number;
      latestAttentionAt: number;
    }[];
    const { rerender } = renderHook(
      ({ descendants }: { descendants: Descendants }) =>
        useThreadReadTracking({
          markThreadRead,
          thread: { id: "thr_parent", lastReadAt: 20, latestAttentionAt: 20 },
          descendants,
        }),
      { initialProps: { descendants: [] as Descendants } },
    );
    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    rerender({
      descendants: [
        { id: "thr_spawned", lastReadAt: 25, latestAttentionAt: 25 },
      ],
    });
    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    rerender({
      descendants: [
        { id: "thr_spawned", lastReadAt: 25, latestAttentionAt: 25 },
        { id: "thr_failed", lastReadAt: 10, latestAttentionAt: 30 },
      ],
    });
    expect(markThreadRead.mutateAsync).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ descendantsThroughAttentionAt: 30 }),
    );
  });

  it("reads the descendants again when one gets new attention while the thread stays open", () => {
    const markThreadRead = makeMarkThreadRead();
    const { rerender } = renderHook(
      ({ childAttentionAt }: { childAttentionAt: number }) =>
        useThreadReadTracking({
          markThreadRead,
          thread: { id: "thr_parent", lastReadAt: 20, latestAttentionAt: 20 },
          descendants: [
            {
              id: "thr_child",
              lastReadAt: 30,
              latestAttentionAt: childAttentionAt,
            },
          ],
        }),
      { initialProps: { childAttentionAt: 30 } },
    );
    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    rerender({ childAttentionAt: 50 });

    expect(markThreadRead.mutateAsync).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ descendantsThroughAttentionAt: 50 }),
    );
  });

  it("leaves a descendant marked unread while the thread stays open, and reads it on reopen", async () => {
    const markThreadRead = makeMarkThreadRead();
    type FamilyProps = { childReadAt: number | null; open: boolean };
    const initialProps: FamilyProps = { childReadAt: 30, open: true };
    const { rerender } = renderHook(
      ({ childReadAt, open }: FamilyProps) =>
        useThreadReadTracking({
          markThreadRead,
          thread: open
            ? { id: "thr_parent", lastReadAt: 20, latestAttentionAt: 20 }
            : undefined,
          descendants: open
            ? [
                {
                  id: "thr_child",
                  lastReadAt: childReadAt,
                  latestAttentionAt: 30,
                },
              ]
            : [],
        }),
      { initialProps },
    );

    rerender({ childReadAt: null, open: true });
    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    rerender({ childReadAt: null, open: false });
    await act(async () => {});
    rerender({ childReadAt: null, open: true });

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("retries a failed read after pageshow while already visible", async () => {
    const markThreadRead = makeMarkThreadRead();
    markThreadRead.mutateAsync.mockRejectedValueOnce(new Error("Failed"));
    renderHook(() =>
      useThreadReadTracking({
        markThreadRead,
        descendants: [],
        thread: {
          id: "thr_side_chat",
          lastReadAt: 10,
          latestAttentionAt: 20,
        },
      }),
    );
    await act(async () => {});
    markThreadRead.hasFailed.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("does not undo marking the visible thread unread after tab refocus", () => {
    const markThreadRead = makeMarkThreadRead();
    type VisibleThreadProps = { lastReadAt: number | null };
    const initialProps: VisibleThreadProps = { lastReadAt: 20 };
    const { rerender } = renderHook(
      ({ lastReadAt }: VisibleThreadProps) =>
        useThreadReadTracking({
          markThreadRead,
          descendants: [],
          thread: {
            id: "thr_side_chat",
            lastReadAt,
            latestAttentionAt: 20,
          },
        }),
      { initialProps },
    );

    rerender({ lastReadAt: null });
    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    act(() => {
      setDocumentVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      setDocumentVisibilityState("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();
  });

  it("marks a previously auto-read thread read when reopened after manual unread", async () => {
    const markThreadRead = makeMarkThreadRead();
    type ReopenThreadProps = {
      lastReadAt: number | null;
      visible: boolean;
    };
    const initialProps: ReopenThreadProps = {
      lastReadAt: 10,
      visible: true,
    };
    const { rerender } = renderHook(
      ({ lastReadAt, visible }: ReopenThreadProps) =>
        useThreadReadTracking({
          markThreadRead,
          descendants: [],
          thread: visible
            ? {
                id: "thr_side_chat",
                lastReadAt,
                latestAttentionAt: 20,
              }
            : undefined,
        }),
      { initialProps },
    );

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);

    rerender({ lastReadAt: 20, visible: true });
    rerender({ lastReadAt: null, visible: true });
    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);

    rerender({ lastReadAt: null, visible: false });
    await act(async () => {});
    rerender({ lastReadAt: null, visible: true });

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("waits for input when the window is visible but not focused", () => {
    hideDocument();
    setDocumentVisibilityState("visible");
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const markThreadRead = makeMarkThreadRead();

    renderHook(() =>
      useThreadReadTracking({
        markThreadRead,
        descendants: [],
        thread: { id: "thr_unfocused", lastReadAt: 10, latestAttentionAt: 20 },
      }),
    );
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new WheelEvent("wheel"));
    });

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("waits for input when attention arrives after the user went idle", () => {
    pressKeyWithFakeTimers();
    const markThreadRead = makeMarkThreadRead();
    const { rerender } = renderHook(
      ({ latestAttentionAt }: { latestAttentionAt: number }) =>
        useThreadReadTracking({
          markThreadRead,
          descendants: [],
          thread: { id: "thr_idle", lastReadAt: 20, latestAttentionAt },
        }),
      { initialProps: { latestAttentionAt: 20 } },
    );

    act(() => {
      vi.advanceTimersByTime(USER_ACTIVITY_WINDOW_MS);
    });
    rerender({ latestAttentionAt: 30 });

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    pressKey();

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("goes idle when the window loses focus", () => {
    pressKeyWithFakeTimers();
    const markThreadRead = makeMarkThreadRead();
    const { rerender } = renderHook(
      ({ latestAttentionAt }: { latestAttentionAt: number }) =>
        useThreadReadTracking({
          markThreadRead,
          descendants: [],
          thread: { id: "thr_blurred", lastReadAt: 20, latestAttentionAt },
        }),
      { initialProps: { latestAttentionAt: 20 } },
    );

    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(0);
    });
    rerender({ latestAttentionAt: 30 });

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();
  });

  it("keeps a thread marked unread elsewhere while the user is idle", () => {
    pressKeyWithFakeTimers();
    const markThreadRead = makeMarkThreadRead();
    const { rerender } = renderHook(
      ({ lastReadAt }: { lastReadAt: number | null }) =>
        useThreadReadTracking({
          markThreadRead,
          descendants: [],
          thread: {
            id: "thr_remote_unread",
            lastReadAt,
            latestAttentionAt: 20,
          },
        }),
      { initialProps: { lastReadAt: 20 as number | null } },
    );

    act(() => {
      vi.advanceTimersByTime(USER_ACTIVITY_WINDOW_MS);
    });
    rerender({ lastReadAt: null });
    pressKey();

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();
  });
});
