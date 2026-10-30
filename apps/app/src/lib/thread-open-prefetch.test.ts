// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { ProviderModelCatalogScope } from "@bb/domain";
import type {
  SystemExecutionOptionsResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import {
  makeEnvironment,
  makeHost,
  makeProviderInfo,
  makeThreadListEntry,
} from "@bb/test-helpers/domain-fixtures";
import {
  allSystemExecutionOptionsQueryKeyPrefix,
  sidebarNavigationQueryKey,
  systemProvidersQueryKey,
  threadDetailBootstrapQueryKey,
  threadTimelineQueryKey,
} from "@/hooks/queries/query-keys";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
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
    providers: { list: vi.fn() },
    system: { executionOptions: vi.fn() },
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
    catalog: vi.mocked(sdk.system.executionOptions).mock.calls.length,
    defaults: vi.mocked(sdk.threads.defaultExecutionOptions).mock.calls.length,
    interactions: vi.mocked(sdk.threads.interactions.list).mock.calls.length,
    providers: vi.mocked(sdk.providers.list).mock.calls.length,
    queued: vi.mocked(sdk.threads.queuedMessages.list).mock.calls.length,
    timeline: vi.mocked(sdk.threads.timeline).mock.calls.length,
  };
}

function providerCatalog(
  providerId: string,
  modelCatalogScope: ProviderModelCatalogScope,
): SystemExecutionOptionsResponse {
  return {
    providers: [
      makeProviderInfo({ id: providerId, capabilities: { modelCatalogScope } }),
    ],
    models: [],
    selectedOnlyModels: [],
    permissionCeiling: "full",
    modelLoadError: null,
  };
}

function showInSidebar(queryClient: QueryClient): void {
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    makeSidebarBootstrapResponse({
      projects: [
        makeProjectWithThreadsResponse({
          threads: [
            makeThreadListEntry({
              id: "thr_side",
              environmentId: "env_side",
              environmentHostId: "host_side",
              providerId: "codex",
            }),
          ],
        }),
      ],
    }),
  );
}

beforeEach(() => {
  vi.mocked(sdk.threads.get).mockResolvedValue(THREAD);
  vi.mocked(sdk.threads.timeline).mockResolvedValue(
    makeThreadTimelineResponse({ maxSeq: 4 }),
  );
  vi.mocked(sdk.threads.interactions.list).mockResolvedValue([]);
  vi.mocked(sdk.threads.queuedMessages.list).mockResolvedValue([]);
  vi.mocked(sdk.threads.defaultExecutionOptions).mockResolvedValue(null);
  vi.mocked(sdk.system.executionOptions).mockResolvedValue(
    providerCatalog("codex", "host"),
  );
  vi.mocked(sdk.providers.list).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
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
      expect(requestCounts().providers).toBe(1);
    });

    expect(requestCounts()).toEqual({
      bootstrap: 1,
      catalog: 1,
      defaults: 1,
      interactions: 1,
      providers: 1,
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
      expect(requestCounts().providers).toBe(1);
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
      afterTag: "timeline-4",
      threadId: "thr_a",
    });
    expect(requestCounts().bootstrap).toBe(1);
  });

  it.each([
    { known: "unknown", routing: { environmentId: "env_side" } },
    { known: "host", routing: { hostId: "host_side" } },
  ] as const)(
    "starts a sidebar thread's model catalog at intent under the key its composer reads when the catalog scope is $known",
    async ({ known, routing }) => {
      vi.mocked(sdk.threads.get).mockReturnValue(new Promise(() => {}));
      const { queryClient, wrapper } = createQueryClientTestHarness();
      showInSidebar(queryClient);
      if (known === "host") {
        queryClient.setQueryData(
          systemProvidersQueryKey(),
          providerCatalog("codex", "host").providers,
        );
      }

      expect(prefetchThreadOpen(queryClient, "thr_side")).toContain(
        "provider-catalog",
      );
      expect(sdk.system.executionOptions).toHaveBeenCalledWith(
        expect.objectContaining({ ...routing, providerId: "codex" }),
      );
      await vi.waitFor(() => {
        expect(
          queryClient.isFetching({
            queryKey: allSystemExecutionOptionsQueryKeyPrefix(),
          }),
        ).toBe(0);
      });

      const { result } = renderHook(
        () =>
          useThreadCreationOptions({
            scope: "component-local",
            environmentId: "env_side",
            environmentHostId: "host_side",
            resetKey: "thr_side",
            initialProviderId: "codex",
            initialModel: "gpt-5.5",
            initialReasoningLevel: "medium",
            initialPermissionMode: "full",
          }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.modelCatalogIsSettled).toBe(true);
      });
      expect(result.current.executionOptionsRouting).toEqual(routing);
      expect(sdk.system.executionOptions).toHaveBeenCalledTimes(1);
    },
  );

  it("loads an unlisted thread's model catalog as soon as its bootstrap names the environment", async () => {
    let resolveBootstrap: (
      thread: ThreadWithIncludesResponse,
    ) => void = () => {};
    vi.mocked(sdk.threads.get).mockReturnValue(
      new Promise((resolve) => {
        resolveBootstrap = resolve;
      }),
    );
    const { queryClient } = createQueryClientTestHarness();

    expect(prefetchThreadOpen(queryClient, "thr_far")).not.toContain(
      "provider-catalog",
    );
    expect(sdk.system.executionOptions).not.toHaveBeenCalled();

    resolveBootstrap({
      ...makeThreadResponse({
        id: "thr_far",
        environmentId: "env_far",
        providerId: "claude-code",
      }),
      environment: makeEnvironment({ id: "env_far", hostId: "host_far" }),
      host: makeHost({ id: "host_far" }),
    });

    await vi.waitFor(() => {
      expect(sdk.system.executionOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          environmentId: "env_far",
          providerId: "claude-code",
        }),
      );
      expect(sdk.providers.list).toHaveBeenCalledWith(
        expect.objectContaining({ environmentId: "env_far" }),
      );
    });
  });
});
