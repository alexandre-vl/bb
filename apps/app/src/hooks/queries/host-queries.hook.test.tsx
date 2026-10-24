// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { hostsQueryKey } from "./query-keys";
import { useHosts } from "./host-queries";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { hosts: { list: mocks.list } },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useHostListRealtimeSubscription: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function connectedHost(seenAt: number): Host {
  return makeHost({ id: "host_laptop", lastSeenAt: seenAt, updatedAt: seenAt });
}

async function renderHostsAfterFirstFetch(first: Host[]) {
  const { queryClient, wrapper } = createQueryClientTestHarness();
  mocks.list.mockResolvedValueOnce(first);
  let renders = 0;
  const view = renderHook(
    () => {
      renders += 1;
      return useHosts().data;
    },
    { wrapper },
  );
  await waitFor(() => expect(view.result.current).toEqual(first));
  return {
    refetchWith: async (next: Host[]) => {
      mocks.list.mockResolvedValueOnce(next);
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: hostsQueryKey() });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    renders: () => renders,
    view,
  };
}

describe("useHosts", () => {
  it("does not re-render its callers when a refetch only brings newer heartbeats", async () => {
    const { refetchWith, renders, view } = await renderHostsAfterFirstFetch([
      connectedHost(1),
    ]);
    const firstData = view.result.current;
    const rendersAfterFirstFetch = renders();

    await refetchWith([connectedHost(2)]);

    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(view.result.current).toBe(firstData);
    expect(renders()).toBe(rendersAfterFirstFetch);
  });

  it("hands callers the new list when a host disconnects", async () => {
    const { refetchWith, view } = await renderHostsAfterFirstFetch([
      connectedHost(1),
    ]);
    const disconnected: Host = { ...connectedHost(2), status: "disconnected" };

    await refetchWith([disconnected]);

    expect(view.result.current).toEqual([disconnected]);
  });
});
