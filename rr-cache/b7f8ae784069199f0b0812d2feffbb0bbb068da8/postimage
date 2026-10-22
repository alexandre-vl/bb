import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useBbNavigate,
  useRpc,
  type PluginCommandRegistration,
  type PluginNavPanelProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import { Skeleton } from "@/components/ui/skeleton";
import {
  claimItemUrl,
  itemRefFromParams,
  itemTabOptions,
  itemUrl,
  parseSubPath,
  pullRowModels,
  routeToSubPath,
  splitTitle,
  type Item,
  type ItemRef,
  type Route,
} from "./app-logic.js";
import type { PullGlyph } from "./pull-status.js";
import type { githubRpcContract } from "./server.js";
import { AgentSheet, type AgentTarget } from "./components/agent-sheet.js";
import { GithubHomeSection, useInboxBadge } from "./components/home-section.js";
import { IssueDetailView, NewIssueForm } from "./components/issues.js";
import { PullDetailView } from "./components/pull-detail.js";
import { ListMessage, rowGlyph } from "./components/pull-list.js";
import {
  errorText,
  PANEL_PATH,
  PULL_TONE_CLASS,
  relativeTime,
  TipButton,
  useItems,
  useStatus,
  useSync,
  useViewer,
  type Status,
} from "./components/shared.js";
import { PullWorkspace, type PanelNavigator } from "./components/workspace.js";

function usePanelNavigator(): PanelNavigator {
  const bbNavigate = useBbNavigate();
  const backTo = useRef<string | null>(null);
  return useMemo(
    () => ({
      go(route: Route, options?: { replace?: boolean }) {
        const replace = options?.replace === true;
        const deeper =
          route.view === "pull" ||
          route.view === "issue" ||
          route.view === "new";
        if (!replace) backTo.current = deeper ? window.location.href : null;
        bbNavigate.toPluginPanel(PANEL_PATH, {
          subPath: routeToSubPath(route),
          ...(replace ? { replace: true } : {}),
        });
      },
      back(fallback: Route) {
        const from = backTo.current;
        backTo.current = null;
        if (from !== null && from !== window.location.href) {
          window.history.back();
          return;
        }
        bbNavigate.toPluginPanel(PANEL_PATH, {
          subPath: routeToSubPath(fallback),
          replace: true,
        });
      },
    }),
    [bbNavigate],
  );
}

function PanelHeader() {
  const status = useStatus();
  const sync = useSync();
  const label = sync.syncing
    ? "Syncing…"
    : status?.lastSyncedAt == null
      ? "Refresh"
      : `Refresh · Synced ${relativeTime(status.lastSyncedAt)}`;
  return (
    <TipButton
      label={label}
      icon="RotateCcw"
      busy={sync.syncing}
      onClick={sync.refresh}
    />
  );
}

function SetupMessage({ status }: { status: Status }) {
  const [title, detail] = !status.ghOk
    ? [
        "Connect the GitHub CLI",
        <>
          Install it from cli.github.com, run <code>gh auth login</code>, then
          reload the plugin. {status.ghError ?? ""}
        </>,
      ]
    : [
        "No GitHub repositories tracked yet",
        "Create a bb project whose checkout has a GitHub origin remote, or add repositories in the extraRepos plugin setting.",
      ];
  return <ListMessage icon="Github" title={title} detail={detail} />;
}

function GithubPanel({ subPath }: PluginNavPanelProps) {
  const route = useMemo(() => parseSubPath(subPath), [subPath]);
  const navigator = usePanelNavigator();
  const status = useStatus();
  let body: ReactNode;
  if (
    status !== null &&
    ((status.ghState !== "unavailable" && !status.ghOk) ||
      status.repos.length === 0)
  ) {
    body = <SetupMessage status={status} />;
  } else if (route.view === "issue") {
    body = (
      <IssueDetailView
        key={`${route.repo}#${route.number}`}
        repo={route.repo}
        number={route.number}
        onBack={() => navigator.back({ view: "issues" })}
      />
    );
  } else if (route.view === "new") {
    body = (
      <NewIssueForm
        repos={status?.repos ?? []}
        onCreated={(repo, number) =>
          navigator.go(
            number === null
              ? { view: "issues" }
              : { view: "issue", repo, number },
            { replace: true },
          )
        }
        onCancel={() => navigator.back({ view: "issues" })}
      />
    );
  } else {
    body = (
      <PullWorkspace route={route} navigator={navigator} status={status} />
    );
  }
  return (
    <div className="@container/github flex min-h-0 flex-1 flex-col">{body}</div>
  );
}

function PanelSkeleton() {
  return (
    <DelayedLoading>
      <div aria-hidden className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-2 h-24 w-full rounded-lg" />
      </div>
    </DelayedLoading>
  );
}

function PullPicker({
  intro,
  onPick,
}: {
  intro: string;
  onPick: (repo: string, number: number) => void;
}) {
  const viewer = useViewer();
  const { items, error, refetch } = useItems("pr");
  const rows = useMemo(() => {
    if (items === null) return null;
    const me = viewer?.toLowerCase() ?? null;
    return pullRowModels(items, viewer)
      .filter((row) => row.pr.state === "open" || row.pr.state === "draft")
      .sort(
        (a, b) =>
          Number(b.item.author.toLowerCase() === me) -
            Number(a.item.author.toLowerCase() === me) ||
          b.item.updatedAt.localeCompare(a.item.updatedAt),
      );
  }, [items, viewer]);
  if (error !== null && rows === null) {
    return (
      <ListMessage
        icon="CloudOff"
        title="Can't reach GitHub"
        detail={error}
        action={
          <Button type="button" size="sm" variant="ghost" onClick={refetch}>
            Try again
          </Button>
        }
      />
    );
  }
  if (rows === null) return <PanelSkeleton />;
  if (rows.length === 0) {
    return (
      <ListMessage
        icon="GitPullRequest"
        title="No open pull requests"
        detail="Pull requests in the tracked repositories show up here."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-subtle-foreground">{intro}</p>
      <div className="flex flex-col">
        {rows.map((row) => (
          <PickerRow
            key={row.key}
            glyph={rowGlyph(row, null)}
            title={splitTitle(row.item.title).text}
            detail={`${row.item.repo}#${row.item.number}`}
            onPick={() => onPick(row.item.repo, row.item.number)}
          />
        ))}
      </div>
    </div>
  );
}

const OPEN_ISSUE_GLYPH: PullGlyph = {
  icon: "Circle",
  tone: "ready",
  label: "Open",
};

function IssuePicker({
  onPick,
}: {
  onPick: (repo: string, number: number) => void;
}) {
  const { items, error, refetch } = useItems("issue");
  const issues = useMemo(
    () =>
      items === null
        ? null
        : items
            .filter((item) => item.state === "OPEN")
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [items],
  );
  if (error !== null && issues === null) {
    return (
      <ListMessage
        icon="CloudOff"
        title="Can't reach GitHub"
        detail={error}
        action={
          <Button type="button" size="sm" variant="ghost" onClick={refetch}>
            Try again
          </Button>
        }
      />
    );
  }
  if (issues === null) return <PanelSkeleton />;
  if (issues.length === 0) {
    return (
      <ListMessage
        icon="Circle"
        title="No open issues"
        detail="Issues in the tracked repositories show up here."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-subtle-foreground">
        Pick an issue to show here.
      </p>
      <div className="flex flex-col">
        {issues.map((item) => (
          <PickerRow
            key={`${item.repo}#${item.number}`}
            glyph={OPEN_ISSUE_GLYPH}
            title={splitTitle(item.title).text}
            detail={`${item.repo}#${item.number}`}
            onPick={() => onPick(item.repo, item.number)}
          />
        ))}
      </div>
    </div>
  );
}

function PickerRow({
  glyph,
  title,
  detail,
  onPick,
}: {
  glyph: PullGlyph;
  title: string;
  detail: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="-mx-2 flex items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:py-2.5"
    >
      <span
        title={glyph.label}
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center"
      >
        <Icon
          name={glyph.icon}
          aria-hidden
          className={`size-4 ${PULL_TONE_CLASS[glyph.tone]}`}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="truncate text-xs text-subtle-foreground">
          {detail}
        </span>
      </span>
    </button>
  );
}

interface ThreadPull extends ItemRef {
  environmentId: string | null;
}

type ThreadPullLookup =
  | { status: "loading" }
  | { status: "failed"; error: string; retry: () => void }
  | { status: "resolved"; pull: ThreadPull | null };

const ITEM_PANEL_ACTION_IDS: Record<Item["kind"], string> = {
  pr: "pull",
  issue: "issue",
};

function isSameItem(a: ItemRef, b: ItemRef): boolean {
  return a.repo === b.repo && a.number === b.number;
}

function useThreadPull(
  threadId: string,
  onResolved?: (pull: ThreadPull | null) => void,
): ThreadPullLookup {
  const rpc = useRpc<typeof githubRpcContract>();
  const onResolvedRef = useRef(onResolved);
  const [attempt, setAttempt] = useState(0);
  const [lookup, setLookup] = useState<{
    key: string;
    result: { pull: ThreadPull | null } | { error: string };
  } | null>(null);
  const key = `${threadId}:${attempt}`;

  useEffect(() => {
    onResolvedRef.current = onResolved;
  });

  useEffect(() => {
    let cancelled = false;
    rpc.call("pullForThread", { threadId }).then(
      (result) => {
        if (cancelled) return;
        setLookup({ key, result: { pull: result.pull } });
        onResolvedRef.current?.(result.pull);
      },
      (failure: unknown) => {
        if (cancelled) return;
        setLookup({ key, result: { error: errorText(failure) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, rpc, threadId]);

  if (lookup === null || lookup.key !== key) return { status: "loading" };
  if ("error" in lookup.result) {
    return {
      status: "failed",
      error: lookup.result.error,
      retry: () => setAttempt((current) => current + 1),
    };
  }
  return { status: "resolved", pull: lookup.result.pull };
}

function useShowItemInThisTab(kind: Item["kind"]): (item: ItemRef) => boolean {
  const navigate = useBbNavigate();
  return useCallback(
    (item) =>
      navigate.openThreadPanel({
        actionId: ITEM_PANEL_ACTION_IDS[kind],
        ...itemTabOptions(kind, item),
        experimental_replace: true,
      }),
    [kind, navigate],
  );
}

function PullPanelTab({ threadId, params }: PluginThreadPanelProps) {
  const linked = itemRefFromParams(params);
  if (linked === null) {
    return <ThreadPullPanel key={threadId} threadId={threadId} />;
  }
  return (
    <LinkedPullPanel
      key={`${threadId}:${linked.repo}#${linked.number}`}
      threadId={threadId}
      pull={linked}
    />
  );
}

function LinkedPullPanel({
  threadId,
  pull,
}: {
  threadId: string;
  pull: ItemRef;
}) {
  const threadPull = useThreadPull(threadId);
  return (
    <PullTabDetail
      pull={pull}
      environmentId={
        threadPull.status === "resolved" &&
        threadPull.pull !== null &&
        isSameItem(threadPull.pull, pull)
          ? threadPull.pull.environmentId
          : null
      }
      onBack={null}
    />
  );
}

function ThreadPullPanel({ threadId }: { threadId: string }) {
  const showInThisTab = useShowItemInThisTab("pr");
  const [choice, setChoice] = useState<"picker" | ThreadPull | null>(null);
  const lookup = useThreadPull(threadId, (pull) => {
    if (pull !== null && !showInThisTab(pull)) setChoice(pull);
  });

  if (lookup.status === "loading") return <PanelSkeleton />;
  if (lookup.status === "failed") {
    return (
      <ListMessage
        icon="CloudOff"
        title="Can't reach GitHub"
        detail={lookup.error}
        action={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={lookup.retry}
          >
            Try again
          </Button>
        }
      />
    );
  }
  const view = choice ?? (lookup.pull === null ? "picker" : null);
  if (view === null) return <PanelSkeleton />;
  if (view === "picker") {
    return (
      <PullPicker
        intro={
          lookup.pull === null
            ? "No pull request is linked to this thread. Pick one to show it here."
            : "Pick a pull request to show here."
        }
        onPick={(repo, number) => {
          const pull = { repo, number, environmentId: null };
          if (!showInThisTab(pull)) setChoice(pull);
        }}
      />
    );
  }
  return (
    <PullTabDetail
      pull={view}
      environmentId={view.environmentId}
      onBack={() => setChoice("picker")}
    />
  );
}

function PullTabDetail({
  pull,
  environmentId,
  onBack,
}: {
  pull: ItemRef;
  environmentId: string | null;
  onBack: (() => void) | null;
}) {
  const navigate = useBbNavigate();
  const viewer = useViewer();
  const { items } = useItems("pr");
  const [agentTarget, setAgentTarget] = useState<AgentTarget | null>(null);
  const item = items?.find((entry) => isSameItem(entry, pull)) ?? null;
  const row = item === null ? null : (pullRowModels([item], viewer)[0] ?? null);
  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col @container/github">
      <PullDetailView
        key={`${pull.repo}#${pull.number}`}
        repo={pull.repo}
        number={pull.number}
        row={row}
        chain={null}
        viewer={viewer}
        layout="panel"
        environmentId={environmentId}
        handle={null}
        pendingRequest={null}
        onBack={onBack}
        onClose={null}
        onOpenPull={(repo, number) => {
          const opened = navigate.openThreadPanel({
            actionId: ITEM_PANEL_ACTION_IDS.pr,
            ...itemTabOptions("pr", { repo, number }),
          });
          if (!opened) navigate.openUrl(itemUrl("pr", { repo, number }));
        }}
        onStartAgent={setAgentTarget}
      />
      <AgentSheet
        target={agentTarget}
        onOpenChange={(open) => {
          if (!open) setAgentTarget(null);
        }}
      />
    </div>
  );
}

function IssuePanelTab({ params }: PluginThreadPanelProps) {
  const linked = itemRefFromParams(params);
  if (linked === null) return <IssuePickerPanel />;
  return (
    <IssueTabDetail
      key={`${linked.repo}#${linked.number}`}
      issue={linked}
      onBack={null}
    />
  );
}

function IssuePickerPanel() {
  const showInThisTab = useShowItemInThisTab("issue");
  const [shown, setShown] = useState<ItemRef | null>(null);
  if (shown === null) {
    return (
      <IssuePicker
        onPick={(repo, number) => {
          const issue = { repo, number };
          if (!showInThisTab(issue)) setShown(issue);
        }}
      />
    );
  }
  return <IssueTabDetail issue={shown} onBack={() => setShown(null)} />;
}

function IssueTabDetail({
  issue,
  onBack,
}: {
  issue: ItemRef;
  onBack: (() => void) | null;
}) {
  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col @container/github">
      <IssueDetailView
        key={`${issue.repo}#${issue.number}`}
        repo={issue.repo}
        number={issue.number}
        onBack={onBack}
      />
    </div>
  );
}

export const THREAD_PULL_COMMAND: PluginCommandRegistration = {
  id: "thread-pull",
  title: "GitHub: Open this thread's pull request",
  isAvailable: (context) => context.threadId !== null,
  run: (context) => {
    context.openPanel({ actionId: "pull" });
  },
};

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "github",
    title: "GitHub",
    icon: "Github",
    path: PANEL_PATH,
    component: GithubPanel,
    headerContent: PanelHeader,
    experimental_useBadge: useInboxBadge,
  });
  app.slots.threadPanelAction({
    id: "pull",
    title: "GitHub",
    icon: "Github",
    component: PullPanelTab,
    experimental_claimUrl: (url) => claimItemUrl("pr", url),
  });
  app.slots.threadPanelAction({
    id: "issue",
    title: "GitHub issue",
    icon: "Github",
    component: IssuePanelTab,
    experimental_claimUrl: (url) => claimItemUrl("issue", url),
  });
  app.slots.homepageSection({
    id: "inbox",
    title: "GitHub",
    component: GithubHomeSection,
  });
  app.commands.register(THREAD_PULL_COMMAND);
});
