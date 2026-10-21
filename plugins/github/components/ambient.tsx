import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  experimental_Icon as Icon,
  experimental_useSidebarThreadPullRequest,
  useBbNavigate,
  useRpc,
  useSdk,
  type BbNavigate,
  type ExperimentalBadge,
  type PluginCommandRegistration,
  type PluginComposerThreadRowStatus,
  type PluginContentScriptContext,
  type PluginHomepageSectionProps,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  inboxCount,
  pullRowModels,
  pullViewGroups,
  parseQuery,
  splitTitle,
  type PullRowModel,
} from "../app-logic.js";
import {
  pullGlyph,
  pullNextStep,
  type PullAgentState,
  type PullTone,
} from "../pull-status.js";
import type { githubRpcContract } from "../server.js";
import { rowReason } from "./inbox.js";
import {
  compactAge,
  errorText,
  plural,
  PULL_TONE_CLASS,
  useAgents,
  useItems,
  useLinks,
  useNow,
  usePendingQuestion,
  useStatus,
  useViewer,
  type AgentInfo,
} from "./shared.js";

const PANEL_PATH = "github";

function useInboxRows(projectId: string | null): {
  rows: PullRowModel[] | null;
  error: string | null;
  agents: Map<string, AgentInfo>;
} {
  const { items, error } = useItems("pr");
  const { status } = useStatus();
  const viewer = useViewer();
  const agents = useAgents(useLinks());
  return useMemo(() => {
    if (items === null) return { rows: null, error, agents };
    const scoped =
      projectId === null || status === null
        ? null
        : new Set(
            status.repos
              .filter((entry) => entry.projectId === projectId)
              .map((entry) => entry.repo),
          );
    const states = new Map<string, PullAgentState>();
    for (const [key, agent] of agents) states.set(key, agent.state);
    const all = pullRowModels(items, viewer, states);
    return {
      rows:
        scoped === null || scoped.size === 0
          ? all
          : all.filter((row) => scoped.has(row.item.repo)),
      error,
      agents,
    };
  }, [agents, error, items, projectId, status, viewer]);
}

export function GithubHomeSection({ projectId }: PluginHomepageSectionProps) {
  const navigate = useBbNavigate();
  const viewer = useViewer();
  const { rows, error, agents } = useInboxRows(projectId);
  const now = useNow(30_000);
  const groups = useMemo(
    () =>
      rows === null
        ? []
        : pullViewGroups(rows, "inbox", parseQuery(""), viewer, "attention"),
    [rows, viewer],
  );
  const counts = new Map(groups.map((group) => [group.id, group.rows.length]));
  const top = groups
    .filter((group) => group.id !== "snoozed")
    .flatMap((group) => group.rows)
    .slice(0, 4);
  const summary = [
    ["you", "your move"],
    ["ready", "ready"],
    ["fixing", "need fixing"],
  ].flatMap(([id, label]) => {
    const count = counts.get(id as string) ?? 0;
    return count === 0 ? [] : [`${count} ${label}`];
  });
  if (error !== null && rows === null) {
    return (
      <p className="text-xs text-muted-foreground">
        Can't reach GitHub right now.
      </p>
    );
  }
  if (rows === null) {
    return (
      <DelayedLoading>
        <div aria-hidden className="flex flex-col gap-2">
          <Skeleton className="h-2.5 w-48" />
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-2 py-1">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton
                className="h-3"
                style={{ width: `${40 + index * 12}%` }}
              />
            </div>
          ))}
        </div>
      </DelayedLoading>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-subtle-foreground">
        <span className="min-w-0 flex-1 truncate">
          {summary.length === 0 ? "Nothing needs you" : summary.join(" · ")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-mr-2 h-6 gap-1 px-1.5 text-xs font-normal"
          onClick={() => navigate.toPluginPanel(PANEL_PATH)}
        >
          Open the inbox
          <Icon name="ArrowUpRight" className="size-3" />
        </Button>
      </div>
      {top.map((row) => (
        <HomeRow
          key={row.key}
          row={row}
          agent={agents.get(row.key) ?? null}
          now={now}
          onOpen={() =>
            navigate.toPluginPanel(PANEL_PATH, {
              subPath: `pulls/${row.item.repo}/${row.item.number}`,
            })
          }
        />
      ))}
    </div>
  );
}

function HomeRow({
  row,
  agent,
  now,
  onOpen,
}: {
  row: PullRowModel;
  agent: AgentInfo | null;
  now: number;
  onOpen: () => void;
}) {
  const pending = usePendingQuestion(
    agent?.state === "waiting" ? agent.threadId : null,
    agent?.updatedAt ?? 0,
  );
  const glyph = pullGlyph(row.pr, row.group, row.agent);
  const { prefix, text } = splitTitle(row.item.title);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="-mx-2 flex min-h-10 items-center gap-2 rounded-md px-2 text-left hover:bg-state-hover"
    >
      <Icon
        name={glyph.icon}
        aria-label={glyph.label}
        className={`size-4 shrink-0 ${PULL_TONE_CLASS[glyph.tone]}`}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {prefix === null ? null : (
            <span className="font-normal text-subtle-foreground">
              {prefix}{" "}
            </span>
          )}
          {text}
        </span>
        <span className="truncate text-xs text-subtle-foreground">
          #{row.item.number} ·{" "}
          {rowReason(row, agent, false, now, pending.question?.prompt ?? null)}
        </span>
      </span>
      <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
        {compactAge(row.item.updatedAt, now)}
      </span>
    </button>
  );
}

export function GithubThreadPullChip({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const core = experimental_useSidebarThreadPullRequest(threadId);
  const rpc = useRpc<typeof githubRpcContract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const viewer = useViewer();
  const { items } = useItems("pr");
  const [linked, setLinked] = useState<{ repo: string; number: number } | null>(
    null,
  );
  useEffect(() => {
    if (core.isLoading || core.pullRequest !== null) return;
    let cancelled = false;
    rpc.call("pullForThread", { threadId }).then(
      (result) => {
        if (!cancelled) setLinked(result.pull);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [core.isLoading, core.pullRequest, rpc, threadId]);
  if (core.isLoading || core.pullRequest !== null || linked === null) {
    return null;
  }
  const item =
    items?.find(
      (entry) => entry.repo === linked.repo && entry.number === linked.number,
    ) ?? null;
  const row =
    item === null
      ? null
      : (pullRowModels([item], viewer, new Map())[0] ?? null);
  const glyph =
    row === null
      ? {
          icon: "GitPullRequest",
          tone: "waiting" as PullTone,
          label: "Pull request",
        }
      : pullGlyph(row.pr, row.group);
  const step = row === null ? null : pullNextStep(row.pr, row.group);
  const subPath = `pulls/${linked.repo}/${linked.number}`;
  const sendFailing = () => {
    rpc
      .call("getPull", linked)
      .then((result) => {
        const failed = result.pull.checks.filter(
          (check) => check.status === "failure",
        );
        const runs = [
          ...new Set(
            failed.flatMap((check) =>
              check.runId === null ? [] : [check.runId],
            ),
          ),
        ];
        const text = [
          `${plural(failed.length, "check")} failing on ${linked.repo}#${linked.number}:`,
          ...failed.map((check) => `- ${check.name}`),
          ...runs.map(
            (run) =>
              `Logs: \`gh run view ${run} -R ${linked.repo} --log-failed\``,
          ),
        ].join("\n");
        return sdk.threads.send({
          threadId,
          input: [{ type: "text", text, mentions: [] }],
          mode: "queue-if-active",
        });
      })
      .then(
        () => toast.success("Failing checks sent to this thread"),
        (error: unknown) =>
          toast.error("Couldn't send the failing checks", {
            description: errorText(error),
          }),
      );
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 max-w-64 gap-1.5 px-2 text-xs font-normal"
          aria-label={`#${linked.number}: ${step ?? glyph.label}`}
        >
          <Icon
            name={glyph.icon}
            className={`size-3.5 shrink-0 ${PULL_TONE_CLASS[glyph.tone]}`}
          />
          <span className="tabular-nums">#{linked.number}</span>
          {isCompactViewport || step === null ? null : (
            <span className="min-w-0 truncate text-muted-foreground">
              {step}
            </span>
          )}
          <Icon
            name="ChevronDown"
            className="size-3 shrink-0 text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        <div className="flex flex-col gap-0.5 px-2 py-1.5">
          <p className="truncate text-sm font-medium text-foreground">
            {item === null
              ? `${linked.repo}#${linked.number}`
              : splitTitle(item.title).text}
          </p>
          {step === null ? null : (
            <p className="truncate text-xs text-muted-foreground">{step}</p>
          )}
        </div>
        {row?.pr.checks.state === "failing" ? (
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start gap-2 px-2 text-xs font-normal"
            onClick={sendFailing}
          >
            <Icon name="CircleX" className="size-3.5 text-destructive" />
            Send the failing checks here
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          className="h-8 w-full justify-start gap-2 px-2 text-xs font-normal"
          onClick={() => navigate.toPluginPanel(PANEL_PATH, { subPath })}
        >
          <Icon name="Github" className="size-3.5 text-muted-foreground" />
          Open in the GitHub panel
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 w-full justify-start gap-2 px-2 text-xs font-normal"
          onClick={() =>
            navigate.openUrl(
              item?.url ??
                `https://github.com/${linked.repo}/pull/${linked.number}`,
            )
          }
        >
          <Icon
            name="ExternalLink"
            className="size-3.5 text-muted-foreground"
          />
          Open on GitHub
        </Button>
      </PopoverContent>
    </Popover>
  );
}

type RowStatusSetter = NonNullable<
  PluginContentScriptContext["experimental_setThreadRowStatus"]
>;

let rowStatusSetter: RowStatusSetter | null = null;
const rowStatusListeners = new Set<() => void>();
let capturedNavigate: BbNavigate | null = null;
let findListener: (() => void) | null = null;
let pendingFind = false;

function publishRowStatusSetter(next: RowStatusSetter | null): void {
  rowStatusSetter = next;
  for (const listener of rowStatusListeners) listener();
}

function subscribeRowStatusSetter(listener: () => void): () => void {
  rowStatusListeners.add(listener);
  return () => rowStatusListeners.delete(listener);
}

export function mountRowStatus(
  context: PluginContentScriptContext,
): () => void {
  publishRowStatusSetter(context.experimental_setThreadRowStatus ?? null);
  return () => publishRowStatusSetter(null);
}

const ROW_TONE: Record<PullTone, PluginComposerThreadRowStatus["tone"]> = {
  action: "error",
  ready: "success",
  merged: "default",
  you: "default",
  waiting: "default",
  closed: "default",
  working: "default",
};

export function GithubBridge() {
  const navigate = useBbNavigate();
  const viewer = useViewer();
  const links = useLinks();
  const { items } = useItems("pr");
  const setter = useSyncExternalStore(
    subscribeRowStatusSetter,
    () => rowStatusSetter,
    () => null,
  );
  const applied = useRef<{
    setter: RowStatusSetter | null;
    statuses: Map<string, string>;
  }>({ setter: null, statuses: new Map() });
  useEffect(() => {
    capturedNavigate = navigate;
    return () => {
      if (capturedNavigate === navigate) capturedNavigate = null;
    };
  }, [navigate]);
  useEffect(() => {
    if (setter === null || items === null) return;
    if (applied.current.setter !== setter) {
      applied.current = { setter, statuses: new Map() };
    }
    const byKey = new Map(
      items.map((item) => [`${item.repo}#${item.number}`, item]),
    );
    const next = new Map<string, PluginComposerThreadRowStatus>();
    for (const [linkKey, entries] of Object.entries(links)) {
      if (!linkKey.startsWith("pr:")) continue;
      const item = byKey.get(linkKey.slice(3));
      if (item === undefined || item.pr === null) continue;
      const row = pullRowModels([item], viewer, new Map())[0];
      if (row === undefined) continue;
      const glyph = pullGlyph(row.pr, row.group);
      for (const link of entries) {
        next.set(link.threadId, {
          icon: glyph.icon,
          label: `#${item.number} · ${pullNextStep(row.pr, row.group)}`,
          tone: ROW_TONE[glyph.tone],
        });
      }
    }
    const previous = applied.current.statuses;
    for (const threadId of previous.keys()) {
      if (!next.has(threadId)) setter(threadId, null);
    }
    const written = new Map<string, string>();
    for (const [threadId, status] of next) {
      const signature = JSON.stringify(status);
      if (previous.get(threadId) !== signature) setter(threadId, status);
      written.set(threadId, signature);
    }
    applied.current = { setter, statuses: written };
  }, [items, links, setter, viewer]);
  return null;
}

export function openInbox(): void {
  capturedNavigate?.toPluginPanel(PANEL_PATH);
}

export function findPullRequest(): void {
  capturedNavigate?.toPluginPanel(PANEL_PATH, { subPath: "pulls/all" });
  if (findListener !== null) findListener();
  else pendingFind = true;
}

export function onFindRequest(listener: () => void): () => void {
  findListener = listener;
  if (pendingFind) {
    pendingFind = false;
    listener();
  }
  return () => {
    if (findListener === listener) findListener = null;
  };
}

export const GITHUB_COMMANDS: readonly PluginCommandRegistration[] = [
  {
    id: "open-inbox",
    title: "GitHub: Open the inbox",
    run: () => openInbox(),
  },
  {
    id: "find-pull",
    title: "GitHub: Find a pull request…",
    run: () => findPullRequest(),
  },
  {
    id: "thread-pull",
    title: "GitHub: Open this thread's pull request",
    isAvailable: (context) => context.threadId !== null,
    run: (context) => {
      context.openPanel({ actionId: "pull" });
    },
  },
];

export function useInboxBadge(): ExperimentalBadge | null {
  const viewer = useViewer();
  const { rows } = useInboxRows(null);
  if (rows === null) return null;
  const count = inboxCount(rows, viewer);
  return count === 0
    ? null
    : {
        count,
        label: `${plural(count, "pull request")} need${count === 1 ? "s" : ""} you`,
      };
}
