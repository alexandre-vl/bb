// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RealtimeSubscriptionTarget } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENVIRONMENT_WORKSPACE_WATCH_LINGER_MS,
  MAX_LINGERING_ENVIRONMENT_WORKSPACE_WATCHES,
  useEnvironmentMergeBaseBranches,
  useEnvironmentWorkspaceWatch,
} from "./environment-queries";

vi.mock("@/lib/sdk", () => ({
  sdk: { environments: { diffBranches: vi.fn() } },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentDetailRealtimeSubscription: vi.fn(),
}));

const realtimeServer = vi.hoisted(() => {
  const holds = new Map<string, number>();
  const messages: string[] = [];
  const keyOf = (target: RealtimeSubscriptionTarget) =>
    target.kind === "environment-detail" ? target.environmentId : target.kind;
  return {
    holds,
    messages,
    wsManager: {
      subscribe(target: RealtimeSubscriptionTarget) {
        const key = keyOf(target);
        const count = (holds.get(key) ?? 0) + 1;
        holds.set(key, count);
        if (count === 1) messages.push(`subscribe ${key}`);
      },
      unsubscribe(target: RealtimeSubscriptionTarget) {
        const key = keyOf(target);
        const count = holds.get(key) ?? 0;
        if (count === 0) throw new Error(`unbalanced unsubscribe ${key}`);
        holds.set(key, count - 1);
        if (count === 1) messages.push(`unsubscribe ${key}`);
      },
    },
  };
});

vi.mock("@/lib/ws", () => ({ wsManager: realtimeServer.wsManager }));

const ENVIRONMENT_ID = "env-1";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function watchedEnvironments(): string[] {
  return [...realtimeServer.holds]
    .filter(([, count]) => count > 0)
    .map(([environmentId]) => environmentId)
    .sort();
}

describe("useEnvironmentWorkspaceWatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    realtimeServer.messages.length = 0;
  });

  it("keeps an environment watched when the thread view comes back to it", () => {
    const { rerender, unmount } = renderHook(
      ({ environmentId }: { environmentId: string }) =>
        useEnvironmentWorkspaceWatch(environmentId),
      { initialProps: { environmentId: "env-a" } },
    );

    rerender({ environmentId: "env-b" });
    vi.advanceTimersByTime(ENVIRONMENT_WORKSPACE_WATCH_LINGER_MS - 1);
    rerender({ environmentId: "env-a" });

    expect(realtimeServer.messages).toEqual([
      "subscribe env-a",
      "subscribe env-b",
    ]);

    unmount();
    vi.advanceTimersByTime(ENVIRONMENT_WORKSPACE_WATCH_LINGER_MS);
    expect(watchedEnvironments()).toEqual([]);
  });

  it("stops watching an environment the linger outlived", () => {
    const { unmount } = renderHook(() => useEnvironmentWorkspaceWatch("env-a"));

    unmount();
    vi.advanceTimersByTime(ENVIRONMENT_WORKSPACE_WATCH_LINGER_MS - 1);
    expect(watchedEnvironments()).toEqual(["env-a"]);

    vi.advanceTimersByTime(1);
    expect(realtimeServer.messages).toEqual([
      "subscribe env-a",
      "unsubscribe env-a",
    ]);
  });

  it("bounds how many environments stay watched after a fast walk through threads", () => {
    const environmentIds = Array.from(
      { length: MAX_LINGERING_ENVIRONMENT_WORKSPACE_WATCHES + 2 },
      (_, index) => `env-${index}`,
    );
    const { rerender } = renderHook(
      ({ environmentId }: { environmentId: string }) =>
        useEnvironmentWorkspaceWatch(environmentId),
      { initialProps: { environmentId: environmentIds[0] } },
    );

    for (const environmentId of environmentIds.slice(1)) {
      rerender({ environmentId });
    }

    expect(watchedEnvironments()).toEqual(environmentIds.slice(1).sort());
    expect(realtimeServer.messages).toContain("unsubscribe env-0");
  });

  it("keeps one watch per environment when two panes show it", () => {
    const first = renderHook(() => useEnvironmentWorkspaceWatch("env-a"));
    const second = renderHook(() => useEnvironmentWorkspaceWatch("env-a"));

    first.unmount();
    second.unmount();
    expect(watchedEnvironments()).toEqual(["env-a"]);

    vi.advanceTimersByTime(ENVIRONMENT_WORKSPACE_WATCH_LINGER_MS);
    expect(watchedEnvironments()).toEqual([]);
    expect(realtimeServer.messages).toEqual([
      "subscribe env-a",
      "unsubscribe env-a",
    ]);
  });
});

describe("useEnvironmentMergeBaseBranches", () => {
  it("only requests the query a typist settles on", async () => {
    const { wrapper } = createQueryClientTestHarness();
    vi.mocked(sdk.environments.diffBranches).mockResolvedValue({
      branches: ["main"],
      branchesTruncated: false,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
    });
    const { rerender } = renderHook(
      ({ query }: { query: string }) =>
        useEnvironmentMergeBaseBranches(ENVIRONMENT_ID, { query }),
      { wrapper, initialProps: { query: "" } },
    );
    await waitFor(() =>
      expect(sdk.environments.diffBranches).toHaveBeenCalledTimes(1),
    );

    for (const query of ["m", "ma", "mai"]) {
      rerender({ query });
    }
    rerender({ query: "main" });

    await waitFor(() =>
      expect(sdk.environments.diffBranches).toHaveBeenCalledWith(
        expect.objectContaining({ query: "main" }),
      ),
    );
    expect(sdk.environments.diffBranches).toHaveBeenCalledTimes(2);
  });
});
