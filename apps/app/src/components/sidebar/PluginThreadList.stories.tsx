import { useEffect, useState } from "react";
import {
  QueryClientProvider,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { SidebarContent, SidebarProvider } from "@/components/ui/sidebar";
import {
  hostsQueryKey,
  sidebarNavigationQueryKey,
  systemConfigQueryKey,
} from "@/hooks/queries/query-keys";
import { collectPluginAppRegistrations } from "@/lib/plugin-app-definition";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { createAppQueryClient } from "@/lib/query-client";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { loadPluginAppDefinition } from "../../../.ladle/plugin-app-module";
import {
  PROJECT_IDS,
  makeProject,
  makeThreadListEntry,
} from "../../../.ladle/story-fixtures";
import { PluginThreadList } from "./PluginThreadList";
import { useThreadListReplacement } from "./threadListProvider";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { SidebarThreadEntriesProvider } from "@/lib/sidebar-thread-entries";

installTestPluginRuntime();
const threadListApp = await loadPluginAppDefinition(
  import.meta.glob<unknown>("../../../../../plugins/thread-list/app.tsx"),
);

export default { title: "sidebar/Thread list" };

const THREAD_LIST_PLUGIN_ID = "thread-list";
const INBOX = { id: "sec_inbox", name: "Inbox", createdAt: 1, updatedAt: 1 };
const READ_AT = 10_000;

function inboxEntry(
  id: string,
  title: string,
  latestAttentionAt: number,
  unread: boolean,
  overrides: Parameters<typeof makeThreadListEntry>[0] = {},
) {
  return makeThreadListEntry({
    id,
    projectId: PROJECT_IDS.bb,
    title,
    titleFallback: title,
    sectionId: INBOX.id,
    environmentId: null,
    latestAttentionAt,
    createdAt: latestAttentionAt,
    updatedAt: latestAttentionAt,
    lastReadAt: unread ? 0 : READ_AT,
    ...overrides,
  });
}

const INBOX_THREADS = [
  inboxEntry("thr_flaky", "Fix flaky composer test", 900, false),
  inboxEntry("thr_release", "Release notes draft", 800, true),
  inboxEntry("thr_ambient", "Ambient shader palette", 700, false),
  inboxEntry("thr_digest", "Digest: GitHub activity", 600, true),
  inboxEntry("thr_pins", "File Pins menu alignment", 500, false),
  inboxEntry("thr_places", "Saved Places import", 400, true),
  inboxEntry("thr_catalog", "Plugin catalog refresh", 200, false),
  inboxEntry("thr_catalog_shots", "Catalog screenshots", 190, false, {
    parentThreadId: "thr_catalog",
  }),
  inboxEntry("thr_catalog_copy", "Catalog descriptions", 180, true, {
    parentThreadId: "thr_catalog",
  }),
];

function sidebarNavigation(
  threads: SidebarBootstrapResponse["projects"][number]["threads"],
): SidebarBootstrapResponse {
  return {
    sections: [INBOX],
    projects: [{ ...makeProject(), defaultExecutionOptions: null, threads }],
    personalProject: {
      ...makeProject({
        id: PERSONAL_PROJECT_ID,
        kind: "personal",
        name: "Personal",
        sources: [],
      }),
      defaultExecutionOptions: null,
      threads: [],
    },
  };
}

function createThreadListQueryClient() {
  const queryClient = createAppQueryClient({
    showMutationErrorToasts: false,
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false, staleTime: Infinity },
    },
  });
  queryClient.setQueryData(hostsQueryKey(), []);
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    sidebarNavigation(INBOX_THREADS),
  );
  return queryClient;
}

function useThreadListPreferenceRpc(initial: Record<string, unknown>) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const preferences = { ...initial };
    const prefix = `/api/v1/plugins/${THREAD_LIST_PLUGIN_ID}/rpc/`;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = url.includes(prefix) ? url.split(prefix)[1] : null;
      const reply = (result: unknown) =>
        new Response(JSON.stringify({ ok: true, result }), {
          headers: { "content-type": "application/json" },
        });
      if (method === "listPreferences") return reply({ preferences });
      if (method === "setPreference" && typeof init?.body === "string") {
        const { key, value } = JSON.parse(init.body) as {
          key: string;
          value: unknown;
        };
        preferences[key] = value;
        return reply({ key, value });
      }
      return originalFetch(input, init);
    };
    setReady(true);
    return () => {
      globalThis.fetch = originalFetch;
    };
  }, [initial]);
  return ready;
}

function useThreadListPlugin() {
  useEffect(() => {
    setPluginSlotRegistrations(
      THREAD_LIST_PLUGIN_ID,
      makePluginRegistrationSet({
        threadLists: collectPluginAppRegistrations(threadListApp).threadLists,
      }),
    );
    return () => removePluginSlotRegistrations(THREAD_LIST_PLUGIN_ID);
  }, []);
}

function ThreadListSidebar() {
  const replacement = useThreadListReplacement();
  const { data } = useSidebarNavigation();
  return (
    <SidebarThreadEntriesProvider navigation={data}>
      <SidebarProvider defaultOpen className="min-h-0 w-auto">
        <div className="flex h-[560px] w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-sidebar-border bg-sidebar text-sidebar-foreground">
          <SidebarContent>
            <PluginThreadList replacement={replacement} onNavigate={() => {}} />
          </SidebarContent>
        </div>
      </SidebarProvider>
    </SidebarThreadEntriesProvider>
  );
}

function OpenThreadControls() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [, refresh] = useState(0);
  const openThreadId = pathname.match(/\/threads\/([^/]+)/)?.[1] ?? null;
  const navigation = queryClient.getQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
  );
  const openThread = navigation?.projects[0]?.threads.find(
    (thread) => thread.id === openThreadId,
  );
  const openThreadIsUnread =
    openThread !== undefined &&
    (openThread.lastReadAt ?? 0) < openThread.latestAttentionAt;
  const markOpenThreadRead = () => {
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
      (current) =>
        current && {
          ...current,
          projects: current.projects.map((project) => ({
            ...project,
            threads: project.threads.map((thread) =>
              thread.id === openThreadId
                ? { ...thread, lastReadAt: READ_AT }
                : thread,
            ),
          })),
        },
    );
    refresh((count) => count + 1);
  };
  return (
    <section className="grid max-w-xs content-start gap-3 text-sm">
      <p className="text-muted-foreground">
        Attention first starts on and parents start collapsed, as for a user
        migrated from By read status. Click a thread to open it, then mark it
        read the way bb does when you view it. It keeps its place until you
        open another thread.
      </p>
      <p className="text-xs text-muted-foreground">
        Open thread: {openThread?.title ?? "none"}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 disabled:opacity-50"
          disabled={!openThreadIsUnread}
          onClick={markOpenThreadRead}
        >
          Mark open thread read
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1"
          onClick={() => {
            queryClient.setQueryData(
              sidebarNavigationQueryKey(),
              sidebarNavigation(INBOX_THREADS),
            );
            navigate("/");
          }}
        >
          Reset
        </button>
      </div>
    </section>
  );
}

const ATTENTION_FIRST_PREFERENCES = {
  organizationMode: "chronological",
  attentionFirst: true,
  parentsStartCollapsed: true,
  expandedThreads: [],
};

export function InboxAttentionFirst() {
  const [queryClient] = useState(createThreadListQueryClient);
  const rpcReady = useThreadListPreferenceRpc(ATTENTION_FIRST_PREFERENCES);
  useThreadListPlugin();
  if (!rpcReady) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ThreadActionsProvider>
        <main className="flex gap-6 p-6">
          <ThreadListSidebar />
          <OpenThreadControls />
        </main>
      </ThreadActionsProvider>
    </QueryClientProvider>
  );
}

const ACTION_TITLES = [
  ["short", "Plan"],
  ["long", "Migrate billing to webhooks and improve retry handling"],
];
const ACTION_THREADS = ACTION_TITLES.flatMap(([length, title]) => [
  inboxEntry(`thr_actions_leaf_${length}`, title, 900, true),
  ...["collapsed", "expanded"].flatMap((state) => {
    const id = `thr_actions_${length}_${state}`;
    return [
      inboxEntry(id, title, 800, true),
      inboxEntry(`${id}_child`, "Check retry handling", 700, false, {
        parentThreadId: id,
      }),
    ];
  }),
]);
const ACTION_PREFERENCES = {
  organizationMode: "chronological",
  attentionFirst: false,
  collapsedThreads: [
    "thr_actions_short_collapsed",
    "thr_actions_long_collapsed",
  ],
};

function ActionSidebar() {
  const replacement = useThreadListReplacement();
  const { data } = useSidebarNavigation();
  return (
    <SidebarThreadEntriesProvider navigation={data}>
      <SidebarProvider defaultOpen className="min-h-0 w-auto">
        <main
          data-thread-row-fixture
          className="bg-sidebar text-sidebar-foreground"
          style={{ width: 288 }}
        >
          <SidebarContent>
            <PluginThreadList replacement={replacement} onNavigate={() => {}} />
          </SidebarContent>
        </main>
      </SidebarProvider>
    </SidebarThreadEntriesProvider>
  );
}

export function ActionAlignment() {
  const [queryClient] = useState(() => {
    const client = createThreadListQueryClient();
    client.setQueryData(systemConfigQueryKey(), makeSystemConfig());
    client.setQueryData(
      sidebarNavigationQueryKey(),
      sidebarNavigation(ACTION_THREADS),
    );
    return client;
  });
  const ready = useThreadListPreferenceRpc(ACTION_PREFERENCES);
  useThreadListPlugin();
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ThreadActionsProvider>
        <ActionSidebar />
      </ThreadActionsProvider>
    </QueryClientProvider>
  );
}

const V2_NOW = 1_000_000_000;
const V2_DAY = 86_400_000;
const V2_EMPTY_PROJECT_ID = "proj_berth";
let v2Clock = 0;

function v2Entry(
  id: string,
  title: string,
  overrides: Parameters<typeof makeThreadListEntry>[0] = {},
) {
  v2Clock += 1;
  const at = V2_NOW - v2Clock * 60_000;
  return makeThreadListEntry({
    id,
    projectId: PROJECT_IDS.bb,
    title,
    titleFallback: title,
    sectionId: null,
    environmentId: null,
    latestAttentionAt: at,
    createdAt: at,
    updatedAt: at,
    lastReadAt: at,
    ...overrides,
  });
}

const V2_UNREAD = { lastReadAt: 0 };
const V2_RUNNING = {
  status: "active" as const,
  runtime: { displayStatus: "active" as const },
};
const V2_FAILED = { status: "error" as const, lastReadAt: 0 };
const V2_WORKTREE = {
  environmentId: "env_fix",
  environmentBranchName: "fix/session-timeout",
  environmentProviderId: "git-worktree",
  environmentIsWorktree: true,
};

const V2_THREADS = [
  v2Entry("thr_v2_pinned", "Sidebar V2 spec", { pinnedAt: 1 }),
  v2Entry("thr_v2_slow", "Investigate slow /listings endpoint", V2_FAILED),
  v2Entry("thr_v2_greeting", "Greeting, no task yet", V2_RUNNING),
  v2Entry("thr_v2_r8", "R8: last verification of 0.43.4", V2_UNREAD),
  v2Entry("thr_v2_approve", "Approve the database migration plan", {
    hasPendingInteraction: true,
  }),
  v2Entry("thr_v2_staff", "Investigate staff report 1562109789117620438", {
    ...V2_RUNNING,
  }),
  ...Array.from({ length: 11 }, (_, index) =>
    v2Entry(`thr_v2_staff_${index}`, `Check shard ${index + 1} of the report`, {
      parentThreadId: "thr_v2_staff",
      ...(index === 3 ? V2_FAILED : index < 2 ? V2_RUNNING : {}),
    }),
  ),
  v2Entry("thr_v2_fix_a", "Session timeout repro", {
    ...V2_WORKTREE,
    ...V2_RUNNING,
  }),
  v2Entry("thr_v2_fix_b", "Session timeout fix", V2_WORKTREE),
  v2Entry("thr_v2_fork", "Propose changes via fork", {}),
  v2Entry("thr_v2_provisioning", "Implement provisioning time (#5918)", {
    parentThreadId: "thr_v2_fork",
  }),
  v2Entry("thr_v2_cold", "Measure cold-start of provisioning", {
    parentThreadId: "thr_v2_provisioning",
  }),
  v2Entry("thr_v2_rebase", "Rebase #6004 and #5910 onto main", {
    queuedWork: "waiting",
  }),
  v2Entry("thr_v2_deploy", "Deploy berth 57a982d to staging", {}),
  ...Array.from({ length: 6 }, (_, index) =>
    v2Entry(`thr_v2_old_${index}`, `Old exploration ${index + 1}`, {
      updatedAt: V2_NOW - (8 + index) * V2_DAY,
      latestAttentionAt: V2_NOW - (8 + index) * V2_DAY,
      lastReadAt: V2_NOW,
    }),
  ),
];

function v2Navigation(): SidebarBootstrapResponse {
  return {
    sections: [],
    projects: [
      {
        ...makeProject({ name: "kops-discordbot" }),
        defaultExecutionOptions: null,
        threads: V2_THREADS,
      },
      {
        ...makeProject({ id: V2_EMPTY_PROJECT_ID, name: "berth" }),
        defaultExecutionOptions: null,
        threads: [],
      },
    ],
    personalProject: {
      ...makeProject({
        id: PERSONAL_PROJECT_ID,
        kind: "personal",
        name: "Personal",
        sources: [],
      }),
      defaultExecutionOptions: null,
      threads: [],
    },
  };
}

const V2_PREFERENCES = {
  organizationMode: "project",
  showProviderIcons: false,
  attentionFirst: true,
  parentsStartCollapsed: false,
  collapsedThreads: ["thr_v2_staff"],
};

function V2Sidebar({
  width,
  height = 900,
}: {
  width: number;
  height?: number;
}) {
  const replacement = useThreadListReplacement();
  const { data } = useSidebarNavigation();
  return (
    <SidebarThreadEntriesProvider navigation={data}>
      <SidebarProvider defaultOpen className="min-h-0 w-auto">
        <main
          data-sidebar-v2-fixture
          className="flex flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
          style={{ width, height }}
        >
          <SidebarContent>
            <PluginThreadList replacement={replacement} onNavigate={() => {}} />
          </SidebarContent>
        </main>
      </SidebarProvider>
    </SidebarThreadEntriesProvider>
  );
}

export function SidebarV2States() {
  const [queryClient] = useState(() => {
    const client = createThreadListQueryClient();
    client.setQueryData(systemConfigQueryKey(), makeSystemConfig());
    client.setQueryData(sidebarNavigationQueryKey(), v2Navigation());
    return client;
  });
  const ready = useThreadListPreferenceRpc(V2_PREFERENCES);
  useThreadListPlugin();
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ThreadActionsProvider>
        <V2Sidebar width={288} />
      </ThreadActionsProvider>
    </QueryClientProvider>
  );
}

type V2ThreadEntry = SidebarBootstrapResponse["projects"][number]["threads"][number];

const V2_BACKGROUND_UPDATES: readonly {
  action: string;
  label: string;
  threadId: string;
  patch: Partial<V2ThreadEntry>;
}[] = [
  {
    action: "fail-deploy",
    label: "Deploy fails",
    threadId: "thr_v2_deploy",
    patch: { ...V2_FAILED, latestAttentionAt: V2_NOW },
  },
  {
    action: "read-slow",
    label: "Slow endpoint is read",
    threadId: "thr_v2_slow",
    patch: { lastReadAt: V2_NOW },
  },
  {
    action: "ask-rebase",
    label: "Rebase needs input",
    threadId: "thr_v2_rebase",
    patch: { hasPendingInteraction: true, queuedWork: "none" },
  },
];

function patchV2Thread(
  client: QueryClient,
  threadId: string,
  patch: Partial<V2ThreadEntry>,
) {
  client.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (current) =>
      current && {
        ...current,
        projects: current.projects.map((project) => ({
          ...project,
          threads: project.threads.map((thread) =>
            thread.id === threadId ? { ...thread, ...patch } : thread,
          ),
        })),
      },
  );
}

function useArchiveRoutes() {
  useEffect(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const match = url.match(/\/api\/v1\/threads\/([^/]+)\/(child-summary|archive-all)/);
      if (!match) return originalFetch(input, init);
      const [, threadId, route] = match;
      const body =
        route === "child-summary"
          ? { nonDeletedChildCount: 0, unarchivedDescendantCount: 0 }
          : { ok: true, archivedThreadIds: [threadId] };
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    };
    return () => {
      globalThis.fetch = originalFetch;
    };
  }, []);
}

const V2_RANDOM_STATES: readonly Partial<V2ThreadEntry>[] = [
  V2_FAILED,
  { hasPendingInteraction: true, status: "idle", lastReadAt: V2_NOW },
  { ...V2_RUNNING, hasPendingInteraction: false, lastReadAt: V2_NOW },
  { status: "idle", hasPendingInteraction: false, lastReadAt: 0 },
  { status: "idle", hasPendingInteraction: false, lastReadAt: V2_NOW },
];

function nextRandom(seed: number): number {
  return (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
}

function BackgroundUpdateControls() {
  const queryClient = useQueryClient();
  const [seed, setSeed] = useState(7);
  const randomUpdate = () => {
    const threadSeed = nextRandom(seed);
    const stateSeed = nextRandom(threadSeed);
    const thread = V2_THREADS[threadSeed % V2_THREADS.length];
    const state = V2_RANDOM_STATES[stateSeed % V2_RANDOM_STATES.length];
    if (thread && state) {
      patchV2Thread(queryClient, thread.id, {
        ...state,
        latestAttentionAt: V2_NOW + stateSeed,
        updatedAt: V2_NOW + (stateSeed % 1000),
      });
    }
    setSeed(stateSeed);
  };
  return (
    <section className="grid max-w-xs content-start gap-3 text-sm">
      <p className="text-muted-foreground">
        Rest the pointer on a row, then send a background update. The row under
        the pointer keeps its place: the list scrolls around it, or the new
        order waits until the pointer leaves or rests for 2 s.
      </p>
      <div className="flex flex-wrap gap-2">
        {V2_BACKGROUND_UPDATES.map(({ action, label, threadId, patch }) => (
          <button
            key={action}
            type="button"
            data-sv2-action={action}
            className="rounded-md border border-border px-2 py-1"
            onClick={() => patchV2Thread(queryClient, threadId, patch)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          data-sv2-action="random"
          className="rounded-md border border-border px-2 py-1"
          onClick={randomUpdate}
        >
          Random update
        </button>
        <button
          type="button"
          data-sv2-action="reset"
          className="rounded-md border border-border px-2 py-1"
          onClick={() =>
            queryClient.setQueryData(sidebarNavigationQueryKey(), v2Navigation())
          }
        >
          Reset
        </button>
      </div>
    </section>
  );
}

export function SidebarV2Stability() {
  const [queryClient] = useState(() => {
    const client = createThreadListQueryClient();
    client.setQueryData(systemConfigQueryKey(), makeSystemConfig());
    client.setQueryData(sidebarNavigationQueryKey(), v2Navigation());
    return client;
  });
  const ready = useThreadListPreferenceRpc(V2_PREFERENCES);
  useArchiveRoutes();
  useThreadListPlugin();
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ThreadActionsProvider>
        <main className="flex gap-6 p-6">
          <V2Sidebar width={288} height={420} />
          <BackgroundUpdateControls />
        </main>
      </ThreadActionsProvider>
    </QueryClientProvider>
  );
}
