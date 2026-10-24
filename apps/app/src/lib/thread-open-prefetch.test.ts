import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadWithIncludesResponse } from "@bb/server-contract";
import {
  threadDetailBootstrapQueryKey,
  threadTimelineQueryKey,
} from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  makeThreadResponse,
  makeThreadTimelineResponse,
} from "@/test/fixtures/thread-responses";
import { prefetchThreadOpen } from "./thread-open-prefetch";

vi.mock("@/views/thread-detail/LazyThreadDetailView", () => ({
  LazyThreadDetailView: { preload: vi.fn(() => Promise.resolve()) },
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      defaultExecutionOptions: vi.fn(),
      get: vi.fn(),
      interactions: { list: vi.fn() },
      queuedMessages: { list: vi.fn() },
      timeline: vi.fn(),
    },
  },
}));

const THREAD = {
  ...makeThreadResponse({ id: "thr_a", environmentId: null }),
  environment: null,
  host: null,
} satisfies ThreadWithIncludesResponse;

function requestCounts() {
  return {
    bootstrap: vi.mocked(sdk.threads.get).mock.calls.length,
    defaults: vi.mocked(sdk.threads.defaultExecutionOptions).mock.calls.length,
    interactions: vi.mocked(sdk.threads.interactions.list).mock.calls.length,
    queued: vi.mocked(sdk.threads.queuedMessages.list).mock.calls.length,
    timeline: vi.mocked(sdk.threads.timeline).mock.calls.length,
  };
}

beforeEach(() => {
  vi.mocked(sdk.threads.get).mockResolvedValue(THREAD);
  vi.mocked(sdk.threads.timeline).mockResolvedValue(
    makeThreadTimelineResponse({ maxSeq: 4 }),
  );
  vi.mocked(sdk.threads.interactions.list).mockResolvedValue([]);
  vi.mocked(sdk.threads.queuedMessages.list).mockResolvedValue([]);
  vi.mocked(sdk.threads.defaultExecutionOptions).mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("prefetchThreadOpen", () => {
  it("requests everything the thread screen needs first, once", async () => {
    const { queryClient } = createQueryClientTestHarness();

    expect(prefetchThreadOpen(queryClient, "thr_a")).toEqual([
      "bootstrap",
      "timeline",
      "interactions",
      "queued-messages",
      "execution-defaults",
    ]);
    expect(prefetchThreadOpen(queryClient, "thr_a")).toEqual([]);
    await vi.waitFor(() => {
      expect(
        queryClient.getQueryData(threadTimelineQueryKey("thr_a")),
      ).toBeDefined();
    });

    expect(requestCounts()).toEqual({
      bootstrap: 1,
      defaults: 1,
      interactions: 1,
      queued: 1,
      timeline: 1,
    });
    expect(prefetchThreadOpen(queryClient, "thr_a")).toEqual([]);
  });

  it("refreshes only a cached timeline that realtime marked stale", async () => {
    const { queryClient } = createQueryClientTestHarness();
    prefetchThreadOpen(queryClient, "thr_a");
    await vi.waitFor(() => {
      expect(
        queryClient.getQueryData(threadDetailBootstrapQueryKey("thr_a")),
      ).toBeDefined();
      expect(
        queryClient.getQueryData(threadTimelineQueryKey("thr_a")),
      ).toBeDefined();
    });
    await queryClient.invalidateQueries({
      queryKey: threadTimelineQueryKey("thr_a"),
      refetchType: "none",
    });

    expect(prefetchThreadOpen(queryClient, "thr_a")).toEqual(["timeline"]);
    await vi.waitFor(() => {
      expect(requestCounts().timeline).toBe(2);
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls[1]?.[0]).toMatchObject({
      afterSequence: "4",
      threadId: "thr_a",
    });
    expect(requestCounts().bootstrap).toBe(1);
  });
});
