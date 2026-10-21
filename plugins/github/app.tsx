import { useCallback, useEffect, useMemo, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  parseSubPath,
  pullRowModels,
  routeToSubPath,
  type Route,
} from "./app-logic.js";
import type { githubRpcContract } from "./server.js";
import {
  GITHUB_COMMANDS,
  GithubBridge,
  GithubHomeSection,
  GithubThreadPullChip,
  mountRowStatus,
  onFindRequest,
  useInboxBadge,
} from "./components/ambient.js";
import { EmptyState } from "./components/empty-state.js";
import { Markdown } from "./components/markdown-lite.js";
import { PullDetailView } from "./components/pull-detail.js";
import {
  Avatar,
  errorText,
  relativeTime,
  StateDot,
  TipButton,
  useAgents,
  useFollows,
  useItems,
  useLinks,
  useStatus,
  useSync,
  useViewer,
  type IssueDetail,
  type RepoInfo,
  type Status,
} from "./components/shared.js";
import { PullWorkspace, usePullDialogs } from "./components/workspace.js";

const PANEL_PATH = "github";

function useSubPathRoute(subPath: string): [Route, (route: Route) => void] {
  const bbNavigate = useBbNavigate();
  const route = useMemo(() => parseSubPath(subPath), [subPath]);
  const navigate = useCallback(
    (next: Route) => {
      bbNavigate.toPluginPanel(PANEL_PATH, { subPath: routeToSubPath(next) });
    },
    [bbNavigate],
  );
  return [route, navigate];
}

function useIssueMutations() {
  const rpc = useRpc<typeof githubRpcContract>();
  const setIssueState = useCallback(
    (repo: string, number: number, state: "open" | "closed") =>
      rpc
        .call("setIssueState", { repo, number, state })
        .then(() =>
          toast.success(
            state === "closed" ? `#${number} closed` : `#${number} reopened`,
          ),
        ),
    [rpc],
  );
  const setAssignees = useCallback(
    (repo: string, number: number, assignees: string[]) =>
      rpc.call("setAssignees", { repo, number, assignees }),
    [rpc],
  );
  const setLabels = useCallback(
    (repo: string, number: number, labels: string[]) =>
      rpc.call("setLabels", { repo, number, labels }),
    [rpc],
  );
  return { setIssueState, setAssignees, setLabels };
}

function SidebarHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium text-subtle-foreground">{children}</h3>
  );
}

function LabelChips({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {labels.map((label) => (
        <Badge
          key={label}
          variant="secondary"
          className="font-normal text-muted-foreground"
        >
          {label}
        </Badge>
      ))}
    </span>
  );
}

function AssigneePicker({
  repo,
  assignees,
  onToggle,
}: {
  repo: string;
  assignees: string[];
  onToggle: (login: string, assigned: boolean) => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const viewer = useViewer();
  const [users, setUsers] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (users !== null) return;
    rpc.call("assignableUsers", { repo }).then(
      (result) => setUsers(result.users),
      (error: unknown) => setLoadError(errorText(error)),
    );
  }, [rpc, repo, users]);
  const ordered =
    users === null
      ? null
      : [...users].sort((a, b) => Number(b === viewer) - Number(a === viewer));
  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-muted-foreground"
        >
          Edit
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 w-56 overflow-y-auto"
        mobileTitle="Assignees"
      >
        <DropdownMenuLabel>Assignees</DropdownMenuLabel>
        {loadError !== null ? (
          <DropdownMenuItem disabled>{loadError}</DropdownMenuItem>
        ) : ordered === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : ordered.length === 0 ? (
          <DropdownMenuItem disabled>No assignable users</DropdownMenuItem>
        ) : (
          ordered.map((login) => (
            <DropdownMenuCheckboxItem
              key={login}
              checked={assignees.includes(login)}
              onCheckedChange={(checked) => onToggle(login, checked)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Avatar login={login} size="size-4" />
                <span className="truncate">
                  {login}
                  {login === viewer ? " (you)" : ""}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LabelPicker({
  repo,
  labels,
  onToggle,
}: {
  repo: string;
  labels: string[];
  onToggle: (label: string, enabled: boolean) => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const [available, setAvailable] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (available !== null) return;
    rpc.call("repositoryLabels", { repo }).then(
      (result) => setAvailable(result.labels),
      (error: unknown) => setLoadError(errorText(error)),
    );
  }, [rpc, repo, available]);
  const ordered =
    available === null
      ? null
      : [...new Set([...labels, ...available])].sort((a, b) =>
          a.localeCompare(b),
        );
  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-muted-foreground"
        >
          Edit
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 w-56 overflow-y-auto"
        mobileTitle="Labels"
      >
        <DropdownMenuLabel>Labels</DropdownMenuLabel>
        {loadError !== null ? (
          <DropdownMenuItem disabled>{loadError}</DropdownMenuItem>
        ) : ordered === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : ordered.length === 0 ? (
          <DropdownMenuItem disabled>No labels in repo</DropdownMenuItem>
        ) : (
          ordered.map((label) => (
            <DropdownMenuCheckboxItem
              key={label}
              checked={labels.includes(label)}
              onCheckedChange={(checked) => onToggle(label, checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="min-w-0 truncate">{label}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DetailSkeleton() {
  return (
    <DelayedLoading>
      <div aria-hidden className="flex flex-col gap-4 p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    </DelayedLoading>
  );
}

function IssueDetailView({
  repo,
  number,
  onBack,
}: {
  repo: string;
  number: number;
  onBack: () => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const navigate = useBbNavigate();
  const links = useLinks();
  const { setIssueState, setAssignees, setLabels } = useIssueMutations();
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => {
    rpc.call("getIssue", { repo, number }).then(
      (result) => {
        setDetail(result.issue);
        setError(null);
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [rpc, repo, number]);
  useEffect(() => {
    load();
  }, [load]);

  const changeState = useCallback(
    (next: "open" | "closed") => {
      setDetail((prev) =>
        prev === null
          ? prev
          : { ...prev, state: next === "closed" ? "CLOSED" : "OPEN" },
      );
      setIssueState(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [setIssueState, repo, number, load],
  );
  const toggleAssignee = useCallback(
    (login: string, assigned: boolean) => {
      let next: string[] = [];
      setDetail((prev) => {
        if (prev === null) return prev;
        next = assigned
          ? [...new Set([...prev.assignees, login])]
          : prev.assignees.filter((entry) => entry !== login);
        return { ...prev, assignees: next };
      });
      setAssignees(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [setAssignees, repo, number, load],
  );
  const toggleLabel = useCallback(
    (label: string, enabled: boolean) => {
      let next: string[] = [];
      setDetail((prev) => {
        if (prev === null) return prev;
        next = enabled
          ? [...new Set([...prev.labels, label])]
          : prev.labels.filter((entry) => entry !== label);
        return { ...prev, labels: next };
      });
      setLabels(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [setLabels, repo, number, load],
  );
  const postComment = useCallback(() => {
    if (comment.trim().length === 0) return;
    setPosting(true);
    rpc
      .call("commentIssue", { repo, number, body: comment })
      .then(() => {
        setComment("");
        load();
      })
      .catch((err: unknown) => toast.error(errorText(err)))
      .finally(() => setPosting(false));
  }, [rpc, repo, number, comment, load]);
  const start = useCallback(() => {
    setStarting(true);
    rpc
      .call("startWork", { repo, number })
      .then(
        (result) => navigate.toThread(result.threadId),
        (err: unknown) => toast.error(errorText(err)),
      )
      .finally(() => setStarting(false));
  }, [navigate, number, repo, rpc]);

  const issueLinks = links[`issue:${repo}#${number}`] ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border px-2">
        <TipButton
          label="Back"
          keys={["Esc"]}
          icon="ArrowLeft"
          onClick={onBack}
        />
        <span className="flex min-w-0 items-center gap-1.5 pl-1.5 text-xs text-subtle-foreground">
          <span>Issue</span>
          <span className="text-subtle-foreground/60">/</span>
          <span className="font-medium text-foreground">#{number}</span>
        </span>
        <span className="flex-1" />
        {detail === null ? null : (
          <TipButton
            label="Open on GitHub"
            icon="ExternalLink"
            onClick={() => navigate.openUrl(detail.url)}
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error !== null ? (
          <div className="p-6">
            <EmptyState message={error} />
          </div>
        ) : detail === null ? (
          <DetailSkeleton />
        ) : (
          <div className="@container/github-detail flex flex-col gap-4 px-8 pt-6 pb-14 @max-[35rem]/github:px-4">
            <div className="flex items-start gap-3">
              <h1 className="min-w-0 flex-1 text-lg font-semibold tracking-tight text-foreground">
                {detail.title}{" "}
                <span className="font-normal text-subtle-foreground">
                  #{detail.number}
                </span>
              </h1>
              {detail.state === "OPEN" ? (
                <Button size="sm" disabled={starting} onClick={start}>
                  <Icon
                    name={starting ? "Spinner" : "Zap"}
                    className={
                      starting
                        ? "animate-spin motion-reduce:animate-none"
                        : undefined
                    }
                  />
                  {starting ? "Starting…" : "Start an agent"}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col gap-6 @min-[56rem]/github-detail:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <p className="flex items-center gap-2 text-xs text-subtle-foreground">
                  <Avatar login={detail.author} size="size-4" />
                  <span className="font-medium text-foreground">
                    {detail.author}
                  </span>
                  opened this issue · updated {relativeTime(detail.updatedAt)}
                </p>
                {detail.body.length > 0 ? (
                  <Markdown content={detail.body} className="text-sm" />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No description.
                  </p>
                )}
                {detail.comments.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-medium text-subtle-foreground">
                      Activity · {detail.comments.length}
                    </h3>
                    {detail.comments.map((entry, index) => (
                      <div
                        key={index}
                        className="rounded-lg border border-border p-3"
                      >
                        <p className="mb-1.5 flex items-center gap-2 text-xs text-subtle-foreground">
                          <Avatar login={entry.author} size="size-4" />
                          <span className="font-medium text-foreground">
                            {entry.author}
                          </span>{" "}
                          · {relativeTime(entry.createdAt)}
                        </p>
                        <Markdown content={entry.body} className="text-sm" />
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  <Textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Leave a comment on GitHub"
                    rows={3}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={posting || comment.trim().length === 0}
                      onClick={postComment}
                    >
                      {posting ? "Posting…" : "Comment"}
                    </Button>
                  </div>
                </div>
              </div>
              <aside className="flex w-full shrink-0 flex-col gap-5 @min-[56rem]/github-detail:w-56">
                <div className="flex flex-col gap-2">
                  <SidebarHeading>Status</SidebarHeading>
                  <Select
                    value={detail.state === "OPEN" ? "open" : "closed"}
                    onValueChange={(value) =>
                      changeState(value === "closed" ? "closed" : "open")
                    }
                  >
                    <SelectTrigger className="h-8 w-full text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">
                        <span className="flex items-center gap-2">
                          <StateDot kind="issue" state="OPEN" /> Open
                        </span>
                      </SelectItem>
                      <SelectItem value="closed">
                        <span className="flex items-center gap-2">
                          <StateDot kind="issue" state="CLOSED" /> Closed
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <SidebarHeading>Assignees</SidebarHeading>
                    <AssigneePicker
                      repo={repo}
                      assignees={detail.assignees}
                      onToggle={toggleAssignee}
                    />
                  </div>
                  {detail.assignees.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No one assigned
                    </p>
                  ) : (
                    detail.assignees.map((login) => (
                      <p
                        key={login}
                        className="flex items-center gap-2 text-sm text-foreground"
                      >
                        <Avatar login={login} />
                        <span className="truncate">{login}</span>
                      </p>
                    ))
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <SidebarHeading>Labels</SidebarHeading>
                    <LabelPicker
                      repo={repo}
                      labels={detail.labels}
                      onToggle={toggleLabel}
                    />
                  </div>
                  {detail.labels.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None yet</p>
                  ) : (
                    <LabelChips labels={detail.labels} />
                  )}
                </div>
                {issueLinks.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <SidebarHeading>Agents</SidebarHeading>
                    {issueLinks.map((link, index) => (
                      <button
                        key={link.threadId}
                        type="button"
                        className="-mx-1 flex items-center gap-2 rounded px-1 text-left text-sm text-foreground hover:bg-state-hover"
                        onClick={() => navigate.toThread(link.threadId)}
                      >
                        <Icon
                          name="Bot"
                          className="size-4 text-muted-foreground"
                        />
                        Agent thread
                        {issueLinks.length > 1 ? ` ${index + 1}` : ""}
                      </button>
                    ))}
                  </div>
                ) : null}
              </aside>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PullPickerList({
  onPick,
}: {
  onPick: (repo: string, number: number) => void;
}) {
  const { items, error } = useItems("pr");
  if (error !== null && items === null) return <EmptyState message={error} />;
  if (items === null) {
    return (
      <DelayedLoading>
        <div aria-hidden className="flex flex-col gap-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      </DelayedLoading>
    );
  }
  const open = items.filter((item) => item.state === "OPEN");
  if (open.length === 0) {
    return <EmptyState message="No open pull requests in the tracked repos." />;
  }
  return (
    <div className="@container/github-picker flex flex-col gap-0.5">
      {open.map((item) => (
        <button
          key={`${item.repo}#${item.number}`}
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-state-hover"
          onClick={() => onPick(item.repo, item.number)}
        >
          <StateDot
            kind="pr"
            state={item.pr?.state === "draft" ? "DRAFT" : item.state}
          />
          <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
            #{item.number}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {item.title}
          </span>
          <span className="hidden shrink-0 text-xs text-subtle-foreground @min-[32rem]/github-picker:block">
            {item.repo}
          </span>
        </button>
      ))}
    </div>
  );
}

function PullPanelTab({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof githubRpcContract>();
  const viewer = useViewer();
  const links = useLinks();
  const agents = useAgents(links);
  const follows = useFollows();
  const { items } = useItems("pr");
  const dialogs = usePullDialogs();
  const [resolved, setResolved] = useState(false);
  const [selected, setSelected] = useState<{
    repo: string;
    number: number;
    environmentId: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.call("pullForThread", { threadId }).then(
      (result) => {
        if (cancelled) return;
        if (result.pull !== null) setSelected(result.pull);
        setResolved(true);
      },
      () => {
        if (!cancelled) setResolved(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId]);

  if (!resolved) return <DetailSkeleton />;
  if (selected === null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          No pull request is linked to this thread yet. Pick one:
        </p>
        <PullPickerList
          onPick={(repo, number) =>
            setSelected({ repo, number, environmentId: null })
          }
        />
      </div>
    );
  }
  const key = `${selected.repo}#${selected.number}`;
  const item =
    items?.find(
      (entry) =>
        entry.repo === selected.repo && entry.number === selected.number,
    ) ?? null;
  const row =
    item === null
      ? null
      : (pullRowModels([item], viewer, new Map())[0] ?? null);
  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col @container/github">
      <PullDetailView
        key={key}
        repo={selected.repo}
        number={selected.number}
        row={row}
        chainRows={null}
        agent={agents.get(key) ?? null}
        follow={follows[key] ?? null}
        merging={dialogs.merging.has(key)}
        viewer={viewer}
        compact
        split={false}
        workspaceEnvironmentId={selected.environmentId}
        handle={null}
        backLabel="All pull requests"
        onBack={() => setSelected(null)}
        onClose={null}
        onMerge={dialogs.openMerge}
        onStartAgent={dialogs.openAgent}
        onOpenPull={(repo, number) =>
          setSelected({ repo, number, environmentId: null })
        }
        onSnooze={(choice) => {
          rpc
            .call("snoozePull", {
              repo: selected.repo,
              number: selected.number,
              rule: choice.rule,
              until: choice.until,
            })
            .then(
              () => toast.success(`#${selected.number} snoozed`),
              (failure: unknown) => toast.error(errorText(failure)),
            );
        }}
        onUnsnooze={() => {
          rpc
            .call("unsnoozePull", {
              repo: selected.repo,
              number: selected.number,
            })
            .then(
              () => toast.success(`#${selected.number} is back in the inbox`),
              (failure: unknown) => toast.error(errorText(failure)),
            );
        }}
      />
      {dialogs.dialogs}
    </div>
  );
}

function NewIssueForm({
  repos,
  onCreated,
  onCancel,
}: {
  repos: RepoInfo[];
  onCreated: (repo: string, number: number | null) => void;
  onCancel: () => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const [repo, setRepo] = useState(repos[0]?.repo ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [creating, setCreating] = useState(false);
  const create = useCallback(() => {
    setCreating(true);
    rpc
      .call("createIssue", { repo, title, body })
      .then((result) => {
        toast.success("Issue created");
        onCreated(repo, result.number);
      })
      .catch((err: unknown) => toast.error(errorText(err)))
      .finally(() => setCreating(false));
  }, [rpc, repo, title, body, onCreated]);
  return (
    <div className="flex max-w-2xl flex-col gap-3 p-6">
      <h2 className="text-lg font-semibold text-foreground">New issue</h2>
      <Select value={repo} onValueChange={setRepo}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Repository" />
        </SelectTrigger>
        <SelectContent>
          {repos.map((entry) => (
            <SelectItem key={entry.repo} value={entry.repo}>
              {entry.repo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title"
      />
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Description (markdown)"
        rows={8}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={creating || title.trim().length === 0 || repo.length === 0}
          onClick={create}
        >
          {creating ? "Creating…" : "Create issue"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PanelHeader() {
  const { status } = useStatus();
  const sync = useSync();
  const failed = sync.failed || (status?.lastSyncError ?? null) !== null;
  const label = sync.syncing
    ? "Syncing…"
    : failed
      ? "Couldn't sync · try again"
      : status?.lastSyncedAt == null
        ? "Refresh"
        : `Refresh · synced ${relativeTime(status.lastSyncedAt)}`;
  return (
    <TipButton
      label={label}
      icon={failed ? "CloudOff" : "RotateCcw"}
      tone={failed ? "text-destructive" : undefined}
      busy={sync.syncing}
      className="size-8"
      onClick={sync.refresh}
    />
  );
}

function SetupMessage({ status }: { status: Status }) {
  const sync = useSync();
  const [title, detail] =
    status.ghState === "unavailable"
      ? [
          "Can't reach GitHub",
          `The GitHub CLI couldn't reach GitHub; the plugin retries by itself. ${status.ghError ?? ""}`,
        ]
      : !status.ghOk
        ? [
            "Connect the GitHub CLI",
            `Install it from cli.github.com, run \`gh auth login\`, then reload the plugin. ${status.ghError ?? ""}`,
          ]
        : [
            "No GitHub repositories tracked yet",
            "Create a bb project whose checkout has a GitHub origin remote, or add repositories in the extraRepos plugin setting.",
          ];
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-20 text-center">
      <Icon name="Github" className="size-5 text-subtle-foreground/60" />
      <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-96 text-xs text-subtle-foreground">{detail}</p>
      {status.ghState === "unavailable" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-2"
          disabled={sync.syncing}
          onClick={sync.refresh}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function GithubPanel({ subPath }: PluginNavPanelProps) {
  const [route, navigate] = useSubPathRoute(subPath);
  const { status } = useStatus();
  const [findRequest, setFindRequest] = useState(0);
  useEffect(
    () => onFindRequest(() => setFindRequest((value) => value + 1)),
    [],
  );
  const blocked =
    status !== null &&
    ((status.ghState !== "unavailable" && !status.ghOk) ||
      status.repos.length === 0);
  let body: React.ReactNode;
  if (blocked && status !== null) {
    body = <SetupMessage status={status} />;
  } else if (route.view === "issue") {
    body = (
      <IssueDetailView
        key={`${route.repo}#${route.number}`}
        repo={route.repo}
        number={route.number}
        onBack={() => navigate({ view: "issues" })}
      />
    );
  } else if (route.view === "new") {
    body = (
      <NewIssueForm
        repos={status?.repos ?? []}
        onCreated={(repo, number) =>
          navigate(
            number !== null
              ? { view: "issue", repo, number }
              : { view: "issues" },
          )
        }
        onCancel={() => navigate({ view: "issues" })}
      />
    );
  } else {
    body = (
      <PullWorkspace
        route={route}
        navigate={navigate}
        status={status}
        findRequest={findRequest}
      />
    );
  }
  return (
    <div className="@container/github flex min-h-0 flex-1 flex-col">{body}</div>
  );
}

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
    title: "GitHub PR",
    icon: "Github",
    component: PullPanelTab,
  });
  app.slots.homepageSection({
    id: "inbox",
    title: "Pull requests",
    component: GithubHomeSection,
  });
  app.slots.experimental_threadHeaderAction({
    id: "pull",
    title: "Linked pull request",
    component: GithubThreadPullChip,
  });
  app.slots.experimental_appOverlay({
    id: "bridge",
    component: GithubBridge,
  });
  app.contentScripts.register({ id: "row-status", mount: mountRowStatus });
  for (const command of GITHUB_COMMANDS) app.commands.register(command);
});
