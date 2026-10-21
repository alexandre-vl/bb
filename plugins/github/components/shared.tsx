import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders,
  experimental_useSidebarThreads,
  useRealtime,
  useRpc,
  useSdk,
  type PluginRpcResult,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { ShortcutPill } from "@/components/ui/shortcut-pill";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import type { Item } from "../app-logic.js";
import type { AgentPreset, PullAgentState, PullTone } from "../pull-status.js";
import type { githubRpcContract } from "../server.js";

export type { Item };
export type IssueDetail = PluginRpcResult<
  (typeof githubRpcContract)["getIssue"]
>["issue"];
export type PullDetail = PluginRpcResult<
  (typeof githubRpcContract)["getPull"]
>["pull"];
export type PullCheck = PullDetail["checks"][number];
export type ReviewThread = PullDetail["reviewThreads"][number];
export type PullFile = PullDetail["files"][number];
export type Status = PluginRpcResult<(typeof githubRpcContract)["status"]>;
export type RepoInfo = Status["repos"][number];
export type LinksMap = PluginRpcResult<
  (typeof githubRpcContract)["listLinks"]
>["links"];
export type ThreadLink = LinksMap[string][number];
export type RepoSettings = PluginRpcResult<
  (typeof githubRpcContract)["repoSettings"]
>["repos"][string];
export type MergeMethod = RepoSettings["defaultMergeMethod"];

export function itemKey(item: { repo: string; number: number }): string {
  return `${item.repo}#${item.number}`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function compactAge(iso: string | number, now = Date.now()): string {
  const then = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(1, Math.floor((now - then) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export function relativeTime(iso: string | number, now = Date.now()): string {
  const then = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (now - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function clockSince(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

export function useItems(kind: "issue" | "pr"): {
  items: Item[] | null;
  error: string | null;
  refetch: () => void;
} {
  const rpc = useRpc<typeof githubRpcContract>();
  const [state, setState] = useState<{
    items: Item[] | null;
    error: string | null;
  }>({ items: null, error: null });
  const refetch = useCallback(() => {
    rpc.call("listItems", { kind }).then(
      (result) => setState({ items: result.items, error: null }),
      (error: unknown) =>
        setState((current) => ({
          items: current.items,
          error: errorText(error),
        })),
    );
  }, [rpc, kind]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("data-changed", refetch);
  return { ...state, refetch };
}

export function useLinks(): LinksMap {
  const rpc = useRpc<typeof githubRpcContract>();
  const [links, setLinks] = useState<LinksMap>({});
  const refetch = useCallback(() => {
    rpc.call("listLinks").then(
      (result) => setLinks(result.links),
      () => {},
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("links-changed", refetch);
  return links;
}

export function useFollows(): Record<string, string> {
  const rpc = useRpc<typeof githubRpcContract>();
  const [follows, setFollows] = useState<Record<string, string>>({});
  const refetch = useCallback(() => {
    rpc.call("listFollows").then(
      (result) => setFollows(result.follows),
      () => {},
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("links-changed", refetch);
  return follows;
}

export function useRepoSettings(): Record<string, RepoSettings> {
  const rpc = useRpc<typeof githubRpcContract>();
  const [repos, setRepos] = useState<Record<string, RepoSettings>>({});
  const refetch = useCallback(() => {
    rpc.call("repoSettings").then(
      (result) => setRepos(result.repos),
      () => {},
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("data-changed", refetch);
  return repos;
}

interface SyncState {
  syncing: boolean;
  failed: boolean;
}

let syncState: SyncState = { syncing: false, failed: false };
const syncListeners = new Set<() => void>();

function setSyncState(next: SyncState): void {
  syncState = next;
  for (const listener of syncListeners) listener();
}

function subscribeSync(listener: () => void): () => void {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

export const SYNC_TOAST_ID = "github-sync";
let manualSyncAt: number | null = null;

export function recentManualSync(now = Date.now()): boolean {
  return manualSyncAt !== null && now - manualSyncAt < 15_000;
}

export function useSync(): SyncState & { refresh: () => void } {
  const rpc = useRpc<typeof githubRpcContract>();
  const state = useSyncExternalStore(
    subscribeSync,
    () => syncState,
    () => syncState,
  );
  const refresh = useCallback(() => {
    if (syncState.syncing) return;
    setSyncState({ syncing: true, failed: false });
    rpc.call("refresh").then(
      () => {
        manualSyncAt = Date.now();
        setSyncState({ syncing: false, failed: false });
        toast.success("Synced with GitHub", { id: SYNC_TOAST_ID });
      },
      (error: unknown) => {
        setSyncState({ syncing: false, failed: true });
        toast.error("Couldn't sync with GitHub", {
          id: SYNC_TOAST_ID,
          description: errorText(error),
        });
      },
    );
  }, [rpc]);
  return { ...state, refresh };
}

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

export function useStored<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => parse(readStored(key)));
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setValue(parse(readStored(key)));
  }
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writeStored(key, serialize(next));
    },
    [key, serialize],
  );
  return [value, update];
}

export function useStatus(): { status: Status | null; refetch: () => void } {
  const rpc = useRpc<typeof githubRpcContract>();
  const [status, setStatus] = useState<Status | null>(null);
  const refetch = useCallback(() => {
    rpc.call("status").then(
      (result) => setStatus(result),
      () => {},
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("data-changed", refetch);
  return { status, refetch };
}

let viewerLogin: string | null = null;

export function useViewer(): string | null {
  const rpc = useRpc<typeof githubRpcContract>();
  const [login, setLogin] = useState<string | null>(viewerLogin);
  useEffect(() => {
    if (viewerLogin !== null) return;
    rpc.call("viewer").then(
      (result) => {
        viewerLogin = result.login;
        setLogin(result.login);
      },
      () => {},
    );
  }, [rpc]);
  return login;
}

export interface AgentInfo {
  state: PullAgentState;
  threadId: string;
  title: string;
  href: string;
  providerId: string;
  preset: AgentPreset | null;
  startedAt: number;
  updatedAt: number;
}

const RUNNING_STATUSES = new Set(["pending", "starting", "active", "stopping"]);

export function agentStateOf(thread: PluginSidebarThread): PullAgentState {
  if (thread.hasPendingInteraction) return "waiting";
  if (RUNNING_STATUSES.has(thread.status)) return "running";
  return "done";
}

export function useAgents(links: LinksMap): Map<string, AgentInfo> {
  const { threads } = experimental_useSidebarThreads();
  return useMemo(() => {
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const agents = new Map<string, AgentInfo>();
    for (const [key, entries] of Object.entries(links)) {
      if (!key.startsWith("pr:")) continue;
      const newest = [...entries].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      for (const link of newest) {
        const thread = byId.get(link.threadId);
        if (thread === undefined || thread.isArchived) continue;
        agents.set(key.slice(3), {
          state: agentStateOf(thread),
          threadId: thread.id,
          title: thread.displayTitle,
          href: thread.href,
          providerId: thread.providerId,
          preset: link.preset,
          startedAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        });
        break;
      }
    }
    return agents;
  }, [links, threads]);
}

export type PendingQuestion = {
  interactionId: string;
  questionId: string;
  prompt: string;
  options: Array<{ value: string; label: string }>;
  allowFreeText: boolean;
};

export function usePendingQuestion(threadId: string | null, version = 0) {
  const sdk = useSdk();
  const [state, setState] = useState<{
    status: "loading" | "question" | "other" | "error";
    question: PendingQuestion | null;
  }>({ status: "loading", question: null });
  useEffect(() => {
    if (threadId === null) return;
    let cancelled = false;
    sdk.threads.interactions.list({ threadId }).then(
      (interactions) => {
        if (cancelled) return;
        for (const interaction of interactions) {
          if (interaction.status !== "pending") continue;
          const payload = interaction.payload;
          if (payload.kind !== "user_question") continue;
          const first = payload.questions[0];
          if (payload.questions.length !== 1 || first === undefined) break;
          setState({
            status: "question",
            question: {
              interactionId: interaction.id,
              questionId: first.id,
              prompt: first.prompt,
              options:
                first.multiSelect || first.options === undefined
                  ? []
                  : first.options.map((option) => ({
                      value: option.value,
                      label: option.label,
                    })),
              allowFreeText: first.allowFreeText,
            },
          });
          return;
        }
        setState({ status: "other", question: null });
      },
      () => {
        if (!cancelled) setState({ status: "error", question: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sdk, threadId, version]);
  return state;
}

export function useBranchEnvironment(): (
  branch: string,
  projectId: string | null,
) => { environmentId: string; hostId: string | null } | null {
  const { threads } = experimental_useSidebarThreads();
  return useCallback(
    (branch, projectId) => {
      for (const thread of threads) {
        if (thread.isArchived) continue;
        if (projectId !== null && thread.projectId !== projectId) continue;
        const environment = thread.environment;
        if (environment?.id == null || environment.branchName !== branch) {
          continue;
        }
        return {
          environmentId: environment.id,
          hostId: thread.host?.id ?? null,
        };
      }
      return null;
    },
    [threads],
  );
}

export function useProjectHost(): (projectId: string | null) => string | null {
  const state = experimental_useSidebarThreads();
  return useCallback(
    (projectId) => {
      const sorted = [...state.threads].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
      const match =
        sorted.find(
          (thread) =>
            thread.host !== null &&
            (projectId === null || thread.projectId === projectId),
        ) ?? null;
      return match?.host?.id ?? state.experimental_hosts?.[0]?.id ?? null;
    },
    [state],
  );
}

export function Avatar({
  login,
  size = "size-5",
  className,
}: {
  login: string;
  size?: string;
  className?: string;
}) {
  return (
    <img
      src={`https://github.com/${encodeURIComponent(login)}.png?size=64`}
      alt=""
      title={login}
      loading="lazy"
      className={`${size} shrink-0 rounded-full bg-muted ${className ?? ""}`}
    />
  );
}

export function AgentGlyph({
  providerId,
  className = "size-3.5",
}: {
  providerId: string;
  className?: string;
}) {
  const { providers } = experimental_useProviders();
  const provider = providers.find((entry) => entry.id === providerId) ?? {
    id: providerId,
  };
  return (
    <ProviderIcon
      providerKind="agent"
      provider={provider}
      fallback="Bot"
      className={className}
    />
  );
}

export function PullAuthor({
  login,
  size = "size-4",
}: {
  login: string;
  size?: string;
}) {
  if (login.startsWith("app/")) {
    return (
      <span title={login.slice(4)} className={`flex ${size} items-center`}>
        <Icon name="Bot" className={`${size} text-muted-foreground`} />
      </span>
    );
  }
  return <Avatar login={login} size={size} />;
}

export const PULL_TONE_CLASS: Record<PullTone, string> = {
  action: "text-destructive",
  ready: "text-success",
  merged: "text-pr-merged",
  you: "text-foreground",
  waiting: "text-muted-foreground",
  closed: "text-destructive",
  working: "text-muted-foreground animate-spin motion-reduce:animate-none",
};

export function stateDotClass(kind: "issue" | "pr", state: string): string {
  if (state === "OPEN") return "bg-success";
  if (state === "DRAFT") return "bg-muted-foreground";
  if (kind === "pr" && state === "CLOSED") return "bg-destructive";
  return "bg-pr-merged";
}

export function StateDot({
  kind,
  state,
}: {
  kind: "issue" | "pr";
  state: string;
}) {
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${stateDotClass(kind, state)}`}
    />
  );
}

export function KeyCaps({ keys }: { keys: readonly string[] }) {
  return (
    <span className="ml-auto flex shrink-0 gap-0.5 pl-3">
      {keys.map((key) => (
        <ShortcutPill key={key} shortcut={{ label: key }} />
      ))}
    </span>
  );
}

export function TipButton({
  label,
  keys,
  icon,
  onClick,
  disabled,
  busy,
  className,
  tone,
}: {
  label: string;
  keys?: readonly string[];
  icon: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  tone?: string;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={`size-7 text-muted-foreground hover:text-foreground ${className ?? ""}`}
            aria-label={label}
            aria-busy={busy === true ? true : undefined}
            disabled={disabled === true || busy === true}
            onClick={onClick}
          >
            <Icon
              name={busy === true ? "Spinner" : icon}
              className={`size-4 ${busy === true ? "animate-spin motion-reduce:animate-none" : (tone ?? "")}`}
            />
          </Button>
        </TooltipTrigger>
        <TipContent label={label} keys={keys} />
      </Tooltip>
    </TooltipProvider>
  );
}

function TipContent({
  label,
  keys,
}: {
  label: string;
  keys: readonly string[] | undefined;
}) {
  return (
    <TooltipContent className="flex items-center gap-2">
      {label}
      {keys === undefined ? null : (
        <span className="flex gap-0.5">
          {keys.map((key) => (
            <kbd
              key={key}
              className="rounded-sm bg-background/20 px-1 font-sans text-xs"
            >
              {key}
            </kbd>
          ))}
        </span>
      )}
    </TooltipContent>
  );
}

export function TriggerTip({
  label,
  keys,
  children,
}: {
  label: string;
  keys?: readonly string[];
  children: React.ReactElement;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TipContent label={label} keys={keys} />
      </Tooltip>
    </TooltipProvider>
  );
}

export function SectionHeading({
  children,
  count,
  action,
}: {
  children: React.ReactNode;
  count?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-7 items-center gap-2 text-xs font-medium text-subtle-foreground">
      <h3>{children}</h3>
      {count === undefined ? null : (
        <span className="font-normal tabular-nums">{count}</span>
      )}
      <span className="flex-1" />
      {action}
    </div>
  );
}
