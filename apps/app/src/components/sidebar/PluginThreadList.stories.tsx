import { useEffect, useState, type ReactNode } from "react";
import {
  QueryClientProvider,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  PERSONAL_PROJECT_ID,
  type AppKeybinding,
  type AppShortcut,
} from "@bb/domain";
import type { PluginThreadActionRegistration } from "@get-bb/plugin-sdk";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@bb/shared-ui/lib/utils";
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
import { NAV_RAIL_WIDTH_CLASS } from "./navRailWidth";

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
        read the way bb does when you view it. It keeps its place until you open
        another thread.
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

const V2_NOW = Date.now();
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
  footer,
}: {
  width: number;
  height?: number | string;
  footer?: ReactNode;
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
          {footer}
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

type SidebarBootstrapScript = "pending" | "fail-then-load";

function emptyV2Navigation(): SidebarBootstrapResponse {
  const navigation = v2Navigation();
  return {
    ...navigation,
    projects: navigation.projects.map((project) => ({
      ...project,
      threads: [],
    })),
  };
}

function useSidebarBootstrapScript(script: SidebarBootstrapScript | null) {
  useEffect(() => {
    if (script === null) return;
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.includes("/sidebar-bootstrap")) {
        return originalFetch(input, init);
      }
      calls += 1;
      if (script === "fail-then-load" && calls === 1) {
        return new Response(JSON.stringify({ error: "unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason));
        if (script === "fail-then-load") {
          window.setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify(v2Navigation()), {
                  headers: { "content-type": "application/json" },
                }),
              ),
            900,
          );
        }
      });
    };
    return () => {
      globalThis.fetch = originalFetch;
    };
  }, [script]);
}

function V2StateStory({
  navigation,
  script,
  preferences = V2_PREFERENCES,
}: {
  navigation: SidebarBootstrapResponse | null;
  script: SidebarBootstrapScript | null;
  preferences?: Record<string, unknown>;
}) {
  const [queryClient] = useState(() => {
    const client = createThreadListQueryClient();
    client.setQueryData(systemConfigQueryKey(), makeSystemConfig());
    client.removeQueries({ queryKey: sidebarNavigationQueryKey() });
    if (navigation !== null) {
      client.setQueryData(sidebarNavigationQueryKey(), navigation);
    }
    return client;
  });
  const ready = useThreadListPreferenceRpc(preferences);
  useSidebarBootstrapScript(script);
  useThreadListPlugin();
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ThreadActionsProvider>
        <V2Sidebar width={288} height={420} />
      </ThreadActionsProvider>
    </QueryClientProvider>
  );
}

export function SidebarV2Loading() {
  return <V2StateStory navigation={null} script="pending" />;
}

export function SidebarV2NoThreads() {
  return <V2StateStory navigation={emptyV2Navigation()} script={null} />;
}

const V2_CHRONOLOGICAL_PREFERENCES = {
  ...V2_PREFERENCES,
  organizationMode: "chronological",
};

export function SidebarV2NoThreadsChronological() {
  return (
    <V2StateStory
      navigation={emptyV2Navigation()}
      script={null}
      preferences={V2_CHRONOLOGICAL_PREFERENCES}
    />
  );
}

export function SidebarV2LoadError() {
  return <V2StateStory navigation={null} script="fail-then-load" />;
}

type V2ThreadEntry =
  SidebarBootstrapResponse["projects"][number]["threads"][number];

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
  {
    action: "ask-fork",
    label: "Fork needs input",
    threadId: "thr_v2_fork",
    patch: { hasPendingInteraction: true },
  },
  {
    action: "finish-cold",
    label: "Cold-start result",
    threadId: "thr_v2_cold",
    patch: { lastReadAt: 0, latestAttentionAt: V2_NOW },
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
      const match = url.match(
        /\/api\/v1\/threads\/([^/]+)\/(child-summary|archive-all)/,
      );
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
            queryClient.setQueryData(
              sidebarNavigationQueryKey(),
              v2Navigation(),
            )
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

const V2_EDGE_PROJECT_ID = "proj_dashboard";
const V2_EDGE_PREFERENCES = {
  ...V2_PREFERENCES,
  collapsedThreads: [],
  rowActions: ["bb--core/archive"],
};
const V2_EDGE_ARCHIVE_BINDING = {
  command: "thread.archive",
  desktopOnly: false,
  shortcut: {
    key: "e",
    mod: false,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  },
  when: {
    all: ["mainSurface", "sidebarListFocus"],
    none: ["modalOpen", "editableFocus"],
  },
} satisfies AppKeybinding;
const V2_EDGE_SYSTEM_CONFIG = makeSystemConfig({
  keybindings: [V2_EDGE_ARCHIVE_BINDING],
  defaultKeybindings: [V2_EDGE_ARCHIVE_BINDING],
});

function v2EdgeNavigation(): SidebarBootstrapResponse {
  const navigation = v2Navigation();
  const dashboard = Array.from({ length: 14 }, (_, index) =>
    v2Entry(`thr_v2_dash_${index}`, `Dashboard task ${index + 1}`, {
      projectId: V2_EDGE_PROJECT_ID,
      ...(index === 9
        ? V2_FAILED
        : index === 12
          ? { hasPendingInteraction: true }
          : {}),
    }),
  );
  const [bb, ...rest] = navigation.projects;
  if (bb === undefined) return navigation;
  return {
    ...navigation,
    projects: [
      bb,
      {
        ...makeProject({ id: V2_EDGE_PROJECT_ID, name: "kops-dashboard" }),
        defaultExecutionOptions: null,
        threads: dashboard,
      },
      ...rest,
    ],
  };
}

export function SidebarV2EdgeRows() {
  const [queryClient] = useState(() => {
    const client = createThreadListQueryClient();
    client.setQueryData(systemConfigQueryKey(), V2_EDGE_SYSTEM_CONFIG);
    client.setQueryData(sidebarNavigationQueryKey(), v2EdgeNavigation());
    return client;
  });
  const ready = useThreadListPreferenceRpc(V2_EDGE_PREFERENCES);
  useArchiveRoutes();
  useThreadListPlugin();
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <AppCommandProvider>
        <ThreadActionsProvider>
          <V2Sidebar
            width={288}
            height="100vh"
            footer={
              <div className="flex h-12 shrink-0 items-center border-t border-sidebar-border px-4 text-sm text-sidebar-foreground-quiet">
                Settings
              </div>
            }
          />
        </ThreadActionsProvider>
      </AppCommandProvider>
    </QueryClientProvider>
  );
}

function OpenPhoneDrawer() {
  const { isCompactViewport, openMobileSidebar } = useSidebar();
  useEffect(() => {
    if (isCompactViewport) openMobileSidebar();
  }, [isCompactViewport, openMobileSidebar]);
  return (
    <main className="grid h-dvh place-items-center bg-background p-6">
      <button
        type="button"
        data-sv2-action="open-drawer"
        className="rounded-md border border-border px-2 py-1 text-sm"
        onClick={openMobileSidebar}
      >
        Open the sidebar
      </button>
    </main>
  );
}

function V2PhoneDrawer() {
  const replacement = useThreadListReplacement();
  const { data } = useSidebarNavigation();
  return (
    <SidebarThreadEntriesProvider navigation={data}>
      <SidebarProvider defaultOpen>
        <Sidebar>
          <div
            data-sidebar-v2-fixture
            className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)]"
          >
            <div className={cn("bg-surface-recessed", NAV_RAIL_WIDTH_CLASS)} />
            <div className="flex min-h-0 min-w-0 flex-col">
              <SidebarContent>
                <PluginThreadList
                  replacement={replacement}
                  onNavigate={() => {}}
                />
              </SidebarContent>
            </div>
          </div>
        </Sidebar>
        <OpenPhoneDrawer />
      </SidebarProvider>
    </SidebarThreadEntriesProvider>
  );
}

export function SidebarV2Phone() {
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
        <V2PhoneDrawer />
      </ThreadActionsProvider>
    </QueryClientProvider>
  );
}

function shortcut(
  key: string,
  modifiers: Partial<AppShortcut> = {},
): AppShortcut {
  return {
    key,
    mod: false,
    meta: false,
    control: false,
    alt: false,
    shift: false,
    ...modifiers,
  };
}

function listBinding(
  command: AppKeybinding["command"],
  keys: AppShortcut,
): AppKeybinding {
  return {
    command,
    desktopOnly: false,
    shortcut: keys,
    when: {
      all: ["mainSurface", "sidebarListFocus"],
      none: ["modalOpen", "editableFocus"],
    },
  };
}

const V2_KEYBINDINGS: AppKeybinding[] = [
  {
    command: "sidebar.focus",
    desktopOnly: false,
    shortcut: shortcut("l", { mod: true, shift: true }),
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  },
  listBinding("thread.archive", shortcut("e")),
  listBinding("thread.rename", shortcut("F2")),
  listBinding("thread.toggleRead", shortcut("u")),
  listBinding("thread.previousAttention", shortcut("ArrowUp", { alt: true })),
  listBinding("thread.nextAttention", shortcut("ArrowDown", { alt: true })),
];

const V2_NOTIFICATION_LEVELS: Readonly<Record<string, string>> = {
  thr_v2_deploy: "Muted",
  thr_v2_cold: "Needs input only",
};

const V2_NOTIFICATIONS_ACTION: PluginThreadActionRegistration<unknown> = {
  id: "notifications",
  title: "Notifications",
  icon: "BellDot",
  group: "1_state",
  order: 50,
  item: ({ thread }) => ({
    label: "Notifications",
    detail: V2_NOTIFICATION_LEVELS[thread.id] ?? "All activity",
    icon: "BellDot",
    run: () => {},
  }),
};

function useNotificationLevels() {
  useEffect(() => {
    setPluginSlotRegistrations(
      "push-notifications",
      makePluginRegistrationSet({ threadActions: [V2_NOTIFICATIONS_ACTION] }),
    );
    return () => removePluginSlotRegistrations("push-notifications");
  }, []);
}

function useKeyboardStoryClient() {
  const [queryClient] = useState(() => {
    const client = createThreadListQueryClient();
    client.setQueryData(
      systemConfigQueryKey(),
      makeSystemConfig({
        keybindings: V2_KEYBINDINGS,
        defaultKeybindings: V2_KEYBINDINGS,
      }),
    );
    client.setQueryData(sidebarNavigationQueryKey(), v2Navigation());
    return client;
  });
  const ready = useThreadListPreferenceRpc(V2_PREFERENCES);
  useArchiveRoutes();
  useThreadListPlugin();
  useNotificationLevels();
  return ready ? queryClient : null;
}

export function SidebarV2Keyboard() {
  const queryClient = useKeyboardStoryClient();
  if (!queryClient) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <AppCommandProvider>
        <ThreadActionsProvider>
          <main className="flex gap-6 p-6">
            <V2Sidebar width={288} height={420} />
            <BackgroundUpdateControls />
          </main>
        </ThreadActionsProvider>
      </AppCommandProvider>
    </QueryClientProvider>
  );
}

function OpenDrawerButton() {
  const { openMobileSidebar } = useSidebar();
  return (
    <button
      type="button"
      data-sv2-action="open-drawer"
      className="rounded-md border border-border px-2 py-1"
      onClick={openMobileSidebar}
    >
      Open sidebar
    </button>
  );
}

function V2DrawerSidebar() {
  const replacement = useThreadListReplacement();
  const { data } = useSidebarNavigation();
  return (
    <SidebarThreadEntriesProvider navigation={data}>
      <SidebarProvider className="min-h-0 w-auto">
        <OpenDrawerButton />
        <Sidebar data-sidebar-v2-fixture="">
          <SidebarContent>
            <PluginThreadList replacement={replacement} onNavigate={() => {}} />
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    </SidebarThreadEntriesProvider>
  );
}

export function SidebarV2KeyboardDrawer() {
  const queryClient = useKeyboardStoryClient();
  if (!queryClient) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <AppCommandProvider>
        <ThreadActionsProvider>
          <main className="grid gap-4 p-4">
            <V2DrawerSidebar />
            <BackgroundUpdateControls />
          </main>
        </ThreadActionsProvider>
      </AppCommandProvider>
    </QueryClientProvider>
  );
}
