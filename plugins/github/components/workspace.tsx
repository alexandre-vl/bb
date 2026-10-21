import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  experimental_copyToClipboard,
  experimental_Icon as Icon,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  inboxCount,
  issueGroups,
  parseCollapsed,
  parseDisplay,
  parseQuery,
  pullRowModels,
  pullViewGroups,
  type DisplayPrefs,
  type Item,
  type PullRowModel,
  type Route,
} from "../app-logic.js";
import {
  COLLAPSED_PULL_GROUPS,
  mergeBlockedReason,
  pullPreset,
  type AgentPreset,
  type PullAgentState,
  type PullStateTarget,
  type PullView,
} from "../pull-status.js";
import type { githubRpcContract } from "../server.js";
import { snoozeLabel } from "../snooze.js";
import { AgentSheet, type AgentTarget } from "./agent-sheet.js";
import { FilterChips, FilterInput } from "./filter-bar.js";
import {
  BulkBar,
  DisplayMenu,
  HelpMenu,
  INBOX_VIEWS,
  IssueListRow,
  ListMessage,
  PullList,
  PullListSkeleton,
  ViewBar,
  type InboxView,
  type PullListActions,
  type PullListContext,
  type RowMenuState,
  type SnoozeChoice,
} from "./inbox.js";
import { MergeDialog, useMerge, type MergeTarget } from "./merge-dialog.js";
import {
  PullDetailView,
  type DetailRequestKind,
  type PullDetailHandle,
} from "./pull-detail.js";
import {
  pullStateAfter,
  pullStateMessages,
  pullStateUndo,
} from "./pull-state.js";
import {
  errorText,
  itemKey,
  plural,
  readStored,
  recentManualSync,
  SYNC_TOAST_ID,
  TipButton,
  useAgents,
  useBranchEnvironment,
  useFollows,
  useItems,
  useLinks,
  useNow,
  useRepoSettings,
  useStatus,
  useStored,
  useSync,
  useViewer,
  writeStored,
  type RepoInfo,
  type Status,
} from "./shared.js";

const STORE = "bb-plugin-github:v3";

export function usePullDialogs(): {
  openMerge: (target: Omit<MergeTarget, "environmentId">) => void;
  openAgent: (target: AgentTarget) => void;
  mergeMany: (targets: Array<Omit<MergeTarget, "environmentId">>) => void;
  merging: ReadonlySet<string>;
  open: boolean;
  dialogs: ReactNode;
} {
  const { status } = useStatus();
  const findEnvironment = useBranchEnvironment();
  const settings = useRepoSettings();
  const { merging, merge, mergeAll } = useMerge();
  const [mergeTarget, setMergeTarget] = useState<MergeTarget | null>(null);
  const [agentTarget, setAgentTarget] = useState<AgentTarget | null>(null);
  const withEnvironment = useCallback(
    (target: Omit<MergeTarget, "environmentId">): MergeTarget => {
      const projectId =
        status?.repos.find((entry) => entry.repo === target.repo)?.projectId ??
        null;
      const environment = target.isCrossRepository
        ? null
        : findEnvironment(target.headRefName, projectId);
      return { ...target, environmentId: environment?.environmentId ?? null };
    },
    [findEnvironment, status],
  );
  const openMerge = useCallback(
    (target: Omit<MergeTarget, "environmentId">) =>
      setMergeTarget(withEnvironment(target)),
    [withEnvironment],
  );
  const mergeMany = useCallback(
    (targets: Array<Omit<MergeTarget, "environmentId">>) =>
      mergeAll(
        targets.map((target) => ({
          target: withEnvironment(target),
          method: settings[target.repo]?.defaultMergeMethod ?? "squash",
        })),
      ),
    [mergeAll, settings, withEnvironment],
  );
  return {
    openMerge,
    openAgent: setAgentTarget,
    mergeMany,
    merging,
    open: mergeTarget !== null || agentTarget !== null,
    dialogs: (
      <>
        <MergeDialog
          target={mergeTarget}
          onOpenChange={(open) => {
            if (!open) setMergeTarget(null);
          }}
          onConfirm={(target, method, deleteBranch) => {
            setMergeTarget(null);
            merge(target, method, deleteBranch);
          }}
        />
        <AgentSheet
          target={agentTarget}
          onOpenChange={(open) => {
            if (!open) setAgentTarget(null);
          }}
        />
      </>
    ),
  };
}

function mergeTargetOf(
  row: PullRowModel,
  canDeleteBranch: boolean,
): Omit<MergeTarget, "environmentId"> {
  const checks = row.pr.checks;
  return {
    repo: row.item.repo,
    number: row.item.number,
    baseRefName: row.pr.baseRefName,
    headRefName: row.pr.headRefName,
    headRefOid: row.pr.headRefOid,
    isCrossRepository: row.pr.isCrossRepository,
    summary: `${checks.passed > 0 ? `${plural(checks.passed, "check")} passed` : "No checks"} · no conflicts`,
    canDeleteBranch,
  };
}

function agentTargetOf(row: PullRowModel, preset: AgentPreset): AgentTarget {
  return {
    repo: row.item.repo,
    number: row.item.number,
    headRefName: row.pr.headRefName,
    isCrossRepository: row.pr.isCrossRepository,
    stacked: row.chain !== null,
    preset,
    prompt: null,
  };
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(
      "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='combobox']",
    ) !== null
  );
}

const COLLAPSED_ISSUE_GROUPS: ReadonlySet<string> = new Set(["closed"]);

function useCollapsed(
  view: InboxView,
): [(groupId: string) => boolean, (groupId: string) => void] {
  const key = `${STORE}:collapsed:${view}`;
  const [toggled, setToggled] = useStored(
    key,
    parseCollapsed,
    (value: Set<string>) => JSON.stringify([...value]),
  );
  const defaults: ReadonlySet<string> =
    view === "issues"
      ? COLLAPSED_ISSUE_GROUPS
      : (COLLAPSED_PULL_GROUPS[view] as ReadonlySet<string>);
  const collapsed = useCallback(
    (groupId: string) => defaults.has(groupId) !== toggled.has(groupId),
    [defaults, toggled],
  );
  const toggle = useCallback(
    (groupId: string) => {
      const next = new Set(toggled);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      setToggled(next);
    },
    [setToggled, toggled],
  );
  return [collapsed, toggle];
}

const serializeDisplay = (value: DisplayPrefs) => JSON.stringify(value);
const identity = (raw: string | null) => raw ?? "";
const keep = (value: string) => value;

export function lastPullTab(): PullView {
  const stored = readStored(`${STORE}:tab`);
  return stored === "mine" || stored === "all" || stored === "merged"
    ? stored
    : "inbox";
}

export function PullWorkspace({
  route,
  navigate,
  status,
  findRequest,
}: {
  route: Route;
  navigate: (route: Route) => void;
  status: Status | null;
  findRequest: number;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const bbNavigate = useBbNavigate();
  const viewer = useViewer();
  const links = useLinks();
  const agents = useAgents(links);
  const follows = useFollows();
  const settings = useRepoSettings();
  const sync = useSync();
  const { items, error, refetch } = useItems("pr");
  const dialogs = usePullDialogs();
  const now = useNow(30_000);
  const repos: RepoInfo[] = status?.repos ?? [];

  const view: InboxView =
    route.view === "issues"
      ? "issues"
      : route.view === "pulls"
        ? route.tab
        : lastPullTab();
  const openKey =
    route.view === "pull" ? `${route.repo}#${route.number}` : null;
  useEffect(() => {
    if (route.view === "pulls") writeStored(`${STORE}:tab`, route.tab);
  }, [route]);

  const [display, setDisplay] = useStored(
    `${STORE}:display`,
    parseDisplay,
    serializeDisplay,
  );
  const kind = view === "issues" ? "issue" : "pr";
  const [query, setQuery] = useStored(`${STORE}:query:${kind}`, identity, keep);
  const [searchOpen, setSearchOpen] = useState(query.trim().length > 0);
  const [focusSearch, setFocusSearch] = useState(0);
  const [collapsed, toggleGroup] = useCollapsed(view);
  const [cursor, setCursor] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [peek, setPeek] = useState<string | null>(null);
  const [menu, setMenu] = useState<RowMenuState | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
  const detailHandle = useRef<PullDetailHandle>(null);
  const [seenFind, setSeenFind] = useState(findRequest);
  if (seenFind !== findRequest) {
    setSeenFind(findRequest);
    setSearchOpen(true);
    setFocusSearch((value) => value + 1);
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const registerRow = useCallback(
    (key: string, element: HTMLButtonElement | null) => {
      if (element === null) rowButtons.current.delete(key);
      else rowButtons.current.set(key, element);
    },
    [],
  );

  const agentStates = useMemo(() => {
    const states = new Map<string, PullAgentState>();
    for (const [key, agent] of agents) states.set(key, agent.state);
    return states;
  }, [agents]);
  const rows = useMemo(
    () => (items === null ? null : pullRowModels(items, viewer, agentStates)),
    [agentStates, items, viewer],
  );
  const rowByKey = useMemo(
    () => new Map((rows ?? []).map((row) => [row.key, row])),
    [rows],
  );
  const readyKeys = useMemo(
    () =>
      rows === null
        ? null
        : rows.filter((row) => row.group === "ready").map((row) => row.key),
    [rows],
  );
  const seenReady = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (readyKeys === null) return;
    const before = seenReady.current;
    seenReady.current = new Set(readyKeys);
    if (before === null || !recentManualSync()) return;
    const fresh = readyKeys.filter((key) => !before.has(key));
    const first = fresh[0];
    if (first === undefined) return;
    toast.success(
      fresh.length === 1
        ? `Synced · #${first.split("#")[1] ?? ""} is ready to merge`
        : `Synced · ${fresh.length} pull requests are ready to merge`,
      { id: SYNC_TOAST_ID },
    );
  }, [readyKeys]);
  const parsed = useMemo(() => parseQuery(query), [query]);
  const groups = useMemo(
    () =>
      rows === null || view === "issues"
        ? []
        : pullViewGroups(rows, view, parsed, viewer, display.groupBy),
    [display.groupBy, parsed, rows, view, viewer],
  );
  const count = useMemo(
    () => (rows === null ? 0 : inboxCount(rows, viewer)),
    [rows, viewer],
  );
  const flat = useMemo(
    () =>
      groups.flatMap((group) =>
        group.label !== "" && collapsed(group.id) ? [] : group.rows,
      ),
    [collapsed, groups],
  );
  const visibleCount = groups.reduce(
    (sum, group) => sum + group.rows.length,
    0,
  );

  const canEdit = useCallback(
    (row: PullRowModel) =>
      settings[row.item.repo]?.viewerCanWrite === true ||
      (viewer !== null &&
        row.item.author.toLowerCase() === viewer.toLowerCase()),
    [settings, viewer],
  );

  const focusRow = useCallback((key: string) => {
    setCursor(key);
    const element = rowButtons.current.get(key);
    if (element !== undefined && document.activeElement !== element) {
      element.focus();
    }
    element?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const openPull = useCallback(
    (repo: string, number: number) => {
      setCursor(`${repo}#${number}`);
      setPeek(null);
      navigate({ view: "pull", repo, number });
    },
    [navigate],
  );
  const closeDetail = useCallback(() => {
    navigate({ view: "pulls", tab: view === "issues" ? "inbox" : view });
    if (openKey !== null) {
      requestAnimationFrame(() => focusRow(openKey));
    }
  }, [focusRow, navigate, openKey, view]);

  const snooze = useCallback(
    (targets: PullRowModel[], choice: SnoozeChoice) => {
      setMenu(null);
      Promise.all(
        targets.map((row) =>
          rpc.call("snoozePull", {
            repo: row.item.repo,
            number: row.item.number,
            rule: choice.rule,
            until: choice.until,
          }),
        ),
      ).then(
        (results) => {
          const label = snoozeLabel(
            results[0]?.snooze ?? { rule: choice.rule, until: choice.until },
            new Date(),
          );
          const first = targets[0];
          toast.success(
            targets.length === 1 && first !== undefined
              ? `#${first.item.number} snoozed ${label}`
              : `${plural(targets.length, "pull request")} snoozed ${label}`,
            {
              action: {
                label: "Undo",
                onClick: () => {
                  for (const row of targets) {
                    void rpc.call("unsnoozePull", {
                      repo: row.item.repo,
                      number: row.item.number,
                    });
                  }
                },
              },
            },
          );
          setPicked(new Set());
        },
        (failure: unknown) =>
          toast.error("Couldn't snooze", { description: errorText(failure) }),
      );
    },
    [rpc],
  );
  const unsnooze = useCallback(
    (row: PullRowModel) => {
      setMenu(null);
      rpc
        .call("unsnoozePull", { repo: row.item.repo, number: row.item.number })
        .then(
          () => toast.success(`#${row.item.number} is back in the inbox`),
          (failure: unknown) =>
            toast.error("Couldn't unsnooze", {
              description: errorText(failure),
            }),
        );
    },
    [rpc],
  );
  const changeRowState = useCallback(
    function changeRow(
      row: PullRowModel,
      from: string,
      target: PullStateTarget,
      undo: boolean,
    ): void {
      const messages = pullStateMessages(row.item.number, from, target);
      const back = undo
        ? pullStateUndo(from, target, row.pr.state === "draft")
        : null;
      const id = toast.loading(messages.loading);
      rpc
        .call("setPullState", {
          repo: row.item.repo,
          number: row.item.number,
          state: target,
        })
        .then(
          () =>
            toast.success(messages.done, {
              id,
              ...(back === null
                ? {}
                : {
                    action: {
                      label: "Undo",
                      onClick: () =>
                        changeRow(row, pullStateAfter(target), back, false),
                    },
                  }),
            }),
          (failure: unknown) =>
            toast.error(`Couldn't update #${row.item.number}`, {
              id,
              description: errorText(failure),
            }),
        );
    },
    [rpc],
  );
  const setRowState = useCallback(
    (row: PullRowModel, target: PullStateTarget) => {
      setMenu(null);
      changeRowState(
        row,
        row.pr.state === "draft" ? "DRAFT" : row.item.state,
        target,
        true,
      );
    },
    [changeRowState],
  );
  const copyBranch = useCallback((name: string) => {
    void experimental_copyToClipboard({ text: name }).then((ok) => {
      if (ok) toast.success(`Copied ${name}`);
      else toast.error("Could not copy the branch name");
    });
  }, []);
  const openThreadOf = useCallback(
    (key: string) => {
      const agent = agents.get(key);
      if (agent === undefined) {
        toast(`No agent works on #${key.split("#")[1] ?? ""} yet`);
        return;
      }
      bbNavigate.toThread(agent.threadId);
    },
    [agents, bbNavigate],
  );
  const merge = useCallback(
    (row: PullRowModel) => {
      setMenu(null);
      const blocked = mergeBlockedReason(row.pr);
      if (blocked !== null) {
        toast(`#${row.item.number} isn't ready to merge yet`, {
          description: blocked,
        });
        return;
      }
      if (settings[row.item.repo]?.viewerCanWrite === false) {
        toast(`You can't merge in ${row.item.repo}`);
        return;
      }
      dialogs.openMerge(mergeTargetOf(row, canEdit(row)));
    },
    [canEdit, dialogs, settings],
  );
  const startAgents = useCallback(
    (targets: PullRowModel[]) => {
      const keys = targets.map((row) => row.key);
      setStarting((current) => new Set([...current, ...keys]));
      Promise.allSettled(
        targets.map((row) =>
          rpc.call("startAgent", {
            repo: row.item.repo,
            number: row.item.number,
            preset: pullPreset(row.pr),
            prompt: null,
          }),
        ),
      )
        .then((results) => {
          const started = results.filter(
            (result) => result.status === "fulfilled",
          ).length;
          const failed = results.length - started;
          if (failed === 0)
            toast.success(`Started ${plural(started, "agent")}`);
          else {
            const reason = results.find(
              (result): result is PromiseRejectedResult =>
                result.status === "rejected",
            );
            toast.error(
              `Started ${plural(started, "agent")}, ${failed} failed`,
              { description: errorText(reason?.reason) },
            );
          }
          setPicked(new Set());
        })
        .finally(() =>
          setStarting((current) => {
            const next = new Set(current);
            for (const key of keys) next.delete(key);
            return next;
          }),
        );
    },
    [rpc],
  );

  const actions: PullListActions = useMemo(
    () => ({
      open: (row) => openPull(row.item.repo, row.item.number),
      focusRow: (key) => setCursor(key),
      togglePick: (row) =>
        setPicked((current) => {
          const next = new Set(current);
          if (next.has(row.key)) next.delete(row.key);
          else next.add(row.key);
          return next;
        }),
      setMenu,
      startAgent: (row, preset) => {
        setMenu(null);
        dialogs.openAgent(agentTargetOf(row, preset));
      },
      startAgents,
      merge,
      mergeAll: (targets) =>
        dialogs.mergeMany(targets.map((row) => mergeTargetOf(row, false))),
      openThread: (row) => openThreadOf(row.key),
      setState: setRowState,
      snooze,
      unsnooze,
      copyBranch: (row) => copyBranch(row.pr.headRefName),
      openOnGitHub: (row) => bbNavigate.openUrl(row.item.url),
    }),
    [
      bbNavigate,
      copyBranch,
      dialogs,
      merge,
      openPull,
      openThreadOf,
      setRowState,
      snooze,
      startAgents,
      unsnooze,
    ],
  );

  const context: PullListContext = {
    viewer,
    showRepo: repos.length > 1,
    display,
    agents,
    merging: dialogs.merging,
    starting,
    picked,
    cursor,
    openKey,
    peek,
    menu,
    split: openKey !== null,
    now,
    canEdit,
  };

  const openRow = openKey === null ? null : (rowByKey.get(openKey) ?? null);
  const cursorRow = cursor === null ? null : (rowByKey.get(cursor) ?? null);
  const targetRow = openKey !== null ? openRow : cursorRow;

  const requestDetail = useCallback((kind: DetailRequestKind) => {
    detailHandle.current?.run(kind);
  }, []);

  const moveCursor = useCallback(
    (delta: number) => {
      if (flat.length === 0) return;
      const anchor = openKey ?? cursor;
      const at =
        anchor === null ? -1 : flat.findIndex((row) => row.key === anchor);
      const next =
        flat[
          at < 0
            ? delta > 0
              ? 0
              : flat.length - 1
            : Math.max(0, Math.min(flat.length - 1, at + delta))
        ];
      if (next === undefined) return;
      if (openKey !== null) {
        openPull(next.item.repo, next.item.number);
        setCursor(next.key);
        return;
      }
      if (peek !== null) setPeek(next.key);
      focusRow(next.key);
    },
    [cursor, flat, focusRow, openKey, openPull, peek],
  );

  const switchView = useCallback(
    (next: InboxView) => {
      setPeek(null);
      setCursor(null);
      setMenu(null);
      navigate(
        next === "issues" ? { view: "issues" } : { view: "pulls", tab: next },
      );
    },
    [navigate],
  );

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const root = rootRef.current;
      const target = event.target;
      if (root === null) return;
      if (
        target !== document.body &&
        !(target instanceof Node && root.contains(target))
      ) {
        return;
      }
      if (isTyping(target) || dialogs.open) return;
      const element = target instanceof HTMLElement ? target : null;
      const onRow = element?.dataset.rowButton !== undefined;
      const onButton =
        element?.closest("button, a, [role='button'], [role='tab']") !== null &&
        element !== null &&
        element !== document.body;
      if ((event.key === "Enter" || event.key === " ") && onButton && !onRow)
        return;
      const inDetail =
        element?.closest("[data-github-detail]") !== null && element !== null;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handled = () => event.preventDefault();

      if (event.key === "Escape") {
        if (menu !== null || displayOpen || helpOpen) return;
        if (peek !== null) setPeek(null);
        else if (picked.size > 0) setPicked(new Set());
        else if (openKey !== null) closeDetail();
        else if (searchOpen) {
          setSearchOpen(false);
          setQuery("");
        } else if (cursor !== null) setCursor(null);
        else return;
        handled();
        return;
      }
      if (event.key === "?") {
        setHelpOpen((value) => !value);
        handled();
        return;
      }
      if (event.key === "V" && event.shiftKey) {
        setDisplayOpen((value) => !value);
        handled();
        return;
      }
      if (event.shiftKey && event.key !== "?") return;
      if (key === "/") {
        setSearchOpen(true);
        setFocusSearch((value) => value + 1);
        handled();
        return;
      }
      const sideways =
        (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
        !inDetail &&
        (onRow || target === document.body);
      if (key === "[" || key === "]" || sideways) {
        const forward = key === "]" || event.key === "ArrowRight";
        const at = INBOX_VIEWS.findIndex((entry) => entry.id === view);
        const next =
          INBOX_VIEWS[
            (at + (forward ? 1 : -1) + INBOX_VIEWS.length) % INBOX_VIEWS.length
          ];
        if (next !== undefined) switchView(next.id);
        handled();
        return;
      }
      if (view === "issues") return;
      if (key === "j" || (event.key === "ArrowDown" && !inDetail)) {
        moveCursor(1);
        handled();
        return;
      }
      if (key === "k" || (event.key === "ArrowUp" && !inDetail)) {
        moveCursor(-1);
        handled();
        return;
      }
      if (event.key === "Enter") {
        if (cursorRow !== null && openKey === null) {
          actions.open(cursorRow);
          handled();
        }
        return;
      }
      if (key === " ") {
        if (cursorRow !== null && openKey === null) {
          setPeek((current) =>
            current === cursorRow.key ? null : cursorRow.key,
          );
          handled();
        }
        return;
      }
      if (key === "x") {
        if (cursorRow !== null) actions.togglePick(cursorRow);
        handled();
        return;
      }
      const shortcuts: Record<string, DetailRequestKind> = {
        a: "agent",
        m: "merge",
        r: "ready",
        s: "status",
        z: "snooze",
        t: "thread",
        c: "copy",
        o: "open",
      };
      const request = shortcuts[key];
      if (request === undefined) return;
      handled();
      if (openKey !== null) {
        requestDetail(request);
        return;
      }
      const row = targetRow;
      if (row === null) return;
      const live = row.pr.state === "open" || row.pr.state === "draft";
      switch (request) {
        case "agent":
          if (live) actions.startAgent(row, pullPreset(row.pr));
          break;
        case "merge":
          merge(row);
          break;
        case "ready":
          if (row.pr.state === "draft" && canEdit(row))
            setRowState(row, "open");
          else if (row.pr.state === "draft")
            toast(`You can't change #${row.item.number}`);
          break;
        case "status":
          if (row.pr.state !== "merged") {
            focusRow(row.key);
            setMenu({ key: row.key, kind: "status" });
          }
          break;
        case "snooze":
          if (live) {
            focusRow(row.key);
            setMenu({ key: row.key, kind: "snooze" });
          }
          break;
        case "thread":
          openThreadOf(row.key);
          break;
        case "copy":
          copyBranch(row.pr.headRefName);
          break;
        case "open":
          bbNavigate.openUrl(row.item.url);
          break;
      }
    },
    [
      actions,
      bbNavigate,
      canEdit,
      closeDetail,
      copyBranch,
      cursor,
      cursorRow,
      dialogs.open,
      displayOpen,
      focusRow,
      helpOpen,
      menu,
      merge,
      moveCursor,
      openKey,
      openThreadOf,
      peek,
      picked.size,
      requestDetail,
      searchOpen,
      setQuery,
      setRowState,
      switchView,
      targetRow,
      view,
    ],
  );
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [onKey]);

  const pickedRows = useMemo(
    () =>
      [...picked].flatMap((key) => {
        const row = rowByKey.get(key);
        return row === undefined ? [] : [row];
      }),
    [picked, rowByKey],
  );

  const loading = items === null && error === null;
  const chainRows =
    openRow?.chain == null
      ? null
      : openRow.chain.flatMap((number) => {
          const row = rowByKey.get(`${openRow.item.repo}#${number}`);
          return row === undefined ? [] : [row];
        });

  const filterInput = (
    <FilterInput
      value={query}
      onChange={setQuery}
      onClose={() => {
        setQuery("");
        setSearchOpen(false);
      }}
      onExit={() => {
        const first = flat[0];
        if (first !== undefined) focusRow(first.key);
      }}
      items={items}
      repos={repos}
      kind={kind}
      viewer={viewer}
      focusRequest={focusSearch}
    />
  );

  const listBody =
    view === "issues" ? (
      <IssuesPane
        query={query}
        viewer={viewer}
        showRepo={repos.length > 1}
        now={now}
        collapsed={collapsed}
        onToggleGroup={toggleGroup}
        onOpen={(item) =>
          navigate({ view: "issue", repo: item.repo, number: item.number })
        }
      />
    ) : error !== null && items === null ? (
      <ListMessage
        icon="CloudOff"
        title="Can't reach GitHub"
        detail="The pull requests show up as soon as the connection is back."
        action={
          <Button type="button" size="sm" variant="ghost" onClick={refetch}>
            Try again
          </Button>
        }
      />
    ) : rows === null ? (
      <PullListSkeleton compact={display.density === "compact"} />
    ) : (
      <PullList
        groups={groups}
        collapsed={collapsed}
        onToggleGroup={toggleGroup}
        context={context}
        actions={actions}
        chains={
          new Map(
            rows.flatMap((row) =>
              row.chain === null ? [] : [[row.key, row.chain]],
            ),
          )
        }
        registerRow={registerRow}
        empty={
          query.trim().length > 0 ? (
            <ListMessage
              icon="Search"
              title="No pull requests match"
              detail="Try fewer conditions."
              action={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setQuery("")}
                >
                  Clear filter
                </Button>
              }
            />
          ) : view === "inbox" ? (
            <ListMessage
              icon="CircleCheck"
              title="Nothing needs you"
              detail="Every open pull request is green, merged, or in an agent's hands."
            />
          ) : (
            <ListMessage
              icon="GitPullRequest"
              title="No pull requests here"
              detail="They show up here as soon as they're opened."
            />
          )
        }
      />
    );

  const lastError =
    status === null
      ? null
      : (status.lastSyncError ??
        (status.ghState === "unavailable"
          ? (status.ghError ?? "GitHub is unreachable")
          : null));
  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 flex-1 flex-col"
      onKeyUp={(event) => {
        const element =
          event.target instanceof HTMLElement ? event.target : null;
        if (element?.dataset.rowButton !== undefined && event.key === " ") {
          event.preventDefault();
        }
      }}
    >
      {sync.syncing ? (
        <div
          role="progressbar"
          aria-label="Syncing with GitHub"
          className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden"
        >
          <div className="animate-indeterminate-progress h-full w-1/3 rounded-full bg-muted-foreground" />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div
          className={`relative min-w-0 flex-col ${
            openKey === null
              ? "flex flex-1"
              : "hidden border-r border-border @min-[60rem]/github:flex @min-[60rem]/github:max-w-135 @min-[60rem]/github:basis-[44%]"
          }`}
        >
          <ViewBar
            view={view}
            count={count}
            countLoading={loading}
            onView={switchView}
            search={searchOpen ? filterInput : null}
            trailing={
              <>
                <TipButton
                  label="Filter"
                  keys={["/"]}
                  icon="Search"
                  className="@max-[35rem]/github:size-9"
                  onClick={() => {
                    setSearchOpen(true);
                    setFocusSearch((value) => value + 1);
                  }}
                />
                {view === "issues" ? (
                  <TipButton
                    label="New issue"
                    icon="Plus"
                    className="@max-[35rem]/github:size-9"
                    onClick={() => navigate({ view: "new" })}
                  />
                ) : null}
                <DisplayMenu
                  open={displayOpen}
                  onOpenChange={setDisplayOpen}
                  display={display}
                  onDisplay={setDisplay}
                  onHelp={() => {
                    setDisplayOpen(false);
                    setHelpOpen(true);
                  }}
                />
                <HelpMenu open={helpOpen} onOpenChange={setHelpOpen} />
              </>
            }
          />
          {searchOpen || query.trim().length > 0 ? (
            <FilterChips
              query={query}
              viewer={viewer}
              count={
                view === "issues" ? null : rows === null ? null : visibleCount
              }
              noun={
                kind === "pr"
                  ? ["pull request", "pull requests"]
                  : ["issue", "issues"]
              }
              onChange={(next) => {
                setQuery(next);
                if (next.trim().length === 0) setSearchOpen(false);
              }}
            />
          ) : null}
          {lastError !== null && items !== null ? (
            <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border py-1 pr-2 pl-4 text-xs text-subtle-foreground motion-safe:animate-in motion-safe:fade-in-0">
              <Icon name="CloudOff" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                Can't reach GitHub · showing the last sync
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs"
                disabled={sync.syncing}
                onClick={sync.refresh}
              >
                Try again
              </Button>
            </div>
          ) : null}
          <div
            className="min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-10"
            aria-busy={loading}
          >
            {listBody}
          </div>
          <span className="sr-only" role="status">
            {loading
              ? "Loading pull requests"
              : error !== null && items === null
                ? "Couldn't load the pull requests"
                : ""}
          </span>
          {pickedRows.length > 0 && view !== "issues" ? (
            <BulkBar
              rows={pickedRows}
              now={now}
              busy={pickedRows.some((row) => starting.has(row.key))}
              onStartAgents={() => startAgents(pickedRows)}
              onMarkReady={() => {
                const drafts = pickedRows.filter(
                  (row) => row.pr.state === "draft" && canEdit(row),
                );
                Promise.allSettled(
                  drafts.map((row) =>
                    rpc.call("setPullState", {
                      repo: row.item.repo,
                      number: row.item.number,
                      state: "open",
                    }),
                  ),
                ).then((results) => {
                  const marked = drafts.filter(
                    (_, index) => results[index]?.status === "fulfilled",
                  );
                  const undo = {
                    label: "Undo",
                    onClick: () => {
                      for (const row of marked) {
                        void rpc.call("setPullState", {
                          repo: row.item.repo,
                          number: row.item.number,
                          state: "draft",
                        });
                      }
                    },
                  };
                  if (marked.length === results.length)
                    toast.success(
                      `Marked ${plural(marked.length, "pull request")} ready`,
                      { action: undo },
                    );
                  else
                    toast.error(
                      `Marked ${marked.length} ready, ${results.length - marked.length} failed`,
                      marked.length > 0 ? { action: undo } : {},
                    );
                  setPicked(new Set());
                });
              }}
              onSnooze={(choice) => snooze(pickedRows, choice)}
              onClear={() => setPicked(new Set())}
            />
          ) : null}
        </div>
        {route.view === "pull" ? (
          <div
            data-github-detail
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <PullDetailView
              key={openKey}
              repo={route.repo}
              number={route.number}
              row={openRow}
              chainRows={chainRows}
              agent={openKey === null ? null : (agents.get(openKey) ?? null)}
              follow={openKey === null ? null : (follows[openKey] ?? null)}
              merging={openKey !== null && dialogs.merging.has(openKey)}
              viewer={viewer}
              compact={false}
              split
              workspaceEnvironmentId={null}
              handle={detailHandle}
              backLabel="Back"
              onBack={closeDetail}
              onClose={closeDetail}
              onMerge={dialogs.openMerge}
              onStartAgent={dialogs.openAgent}
              onOpenPull={openPull}
              onSnooze={(choice) => {
                if (openRow !== null) snooze([openRow], choice);
              }}
              onUnsnooze={() => {
                if (openRow !== null) unsnooze(openRow);
              }}
            />
          </div>
        ) : null}
      </div>
      {dialogs.dialogs}
    </div>
  );
}

function IssuesPane({
  query,
  viewer,
  showRepo,
  now,
  collapsed,
  onToggleGroup,
  onOpen,
}: {
  query: string;
  viewer: string | null;
  showRepo: boolean;
  now: number;
  collapsed: (groupId: string) => boolean;
  onToggleGroup: (groupId: string) => void;
  onOpen: (item: Item) => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const bbNavigate = useBbNavigate();
  const { items, error, refetch } = useItems("issue");
  const [starting, setStarting] = useState<string | null>(null);
  const parsed = useMemo(() => parseQuery(query), [query]);
  const groups = useMemo(
    () => (items === null ? [] : issueGroups(items, parsed, viewer)),
    [items, parsed, viewer],
  );
  const start = (item: Item) => {
    setStarting(itemKey(item));
    rpc
      .call("startWork", { repo: item.repo, number: item.number })
      .then(
        (result) => bbNavigate.toThread(result.threadId),
        (failure: unknown) => toast.error(errorText(failure)),
      )
      .finally(() => setStarting(null));
  };
  if (error !== null && items === null) {
    return (
      <ListMessage
        icon="CloudOff"
        title="Can't reach GitHub"
        detail="The issues show up as soon as the connection is back."
        action={
          <Button type="button" size="sm" variant="ghost" onClick={refetch}>
            Try again
          </Button>
        }
      />
    );
  }
  if (items === null) return <PullListSkeleton compact={false} />;
  if (groups.length === 0) {
    return query.trim().length > 0 ? (
      <ListMessage
        icon="Search"
        title="No issues match"
        detail="Try fewer conditions."
      />
    ) : (
      <ListMessage
        icon="Circle"
        title="No issues here"
        detail="They show up here as soon as they're opened."
      />
    );
  }
  return (
    <div className="flex flex-col">
      {groups.map((group) => {
        const isCollapsed = collapsed(group.id);
        return (
          <section
            key={group.id}
            aria-label={group.label}
            className="flex flex-col gap-0.5 pt-3 first:pt-0"
          >
            <div className="sticky top-0 z-10 flex h-8 items-center rounded-md bg-sidebar px-2">
              <button
                type="button"
                onClick={() => onToggleGroup(group.id)}
                aria-expanded={!isCollapsed}
                className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <Icon
                    name="ChevronDown"
                    className={`size-3 transition-transform motion-reduce:transition-none ${isCollapsed ? "-rotate-90" : ""}`}
                  />
                </span>
                <span>{group.label}</span>
                <span className="font-normal tabular-nums">
                  {group.rows.length}
                </span>
              </button>
            </div>
            {isCollapsed
              ? null
              : group.rows.map((item) => (
                  <IssueListRow
                    key={itemKey(item)}
                    item={item}
                    isCursor={false}
                    showRepo={showRepo}
                    now={now}
                    starting={starting === itemKey(item)}
                    onOpen={() => onOpen(item)}
                    onFocus={() => {}}
                    onStart={() => start(item)}
                    registerRow={() => {}}
                    menu={<IssueRowMenu item={item} viewer={viewer} />}
                  />
                ))}
          </section>
        );
      })}
    </div>
  );
}

function IssueRowMenu({ item, viewer }: { item: Item; viewer: string | null }) {
  const rpc = useRpc<typeof githubRpcContract>();
  const bbNavigate = useBbNavigate();
  const assignedToMe = viewer !== null && item.assignees.includes(viewer);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          tabIndex={-1}
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label={`More actions for #${item.number}`}
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        mobileTitle={`#${item.number}`}
      >
        {viewer !== null ? (
          <DropdownMenuItem
            onSelect={() => {
              const next = assignedToMe
                ? item.assignees.filter((login) => login !== viewer)
                : [...item.assignees, viewer];
              rpc
                .call("setAssignees", {
                  repo: item.repo,
                  number: item.number,
                  assignees: next,
                })
                .then(
                  () =>
                    toast.success(
                      assignedToMe
                        ? `Unassigned from #${item.number}`
                        : `Assigned to #${item.number}`,
                    ),
                  (failure: unknown) => toast.error(errorText(failure)),
                );
            }}
          >
            <Icon name="UserRound" className="size-3.5 text-muted-foreground" />
            {assignedToMe ? "Unassign me" : "Assign to me"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onSelect={() => {
            const next = item.state === "OPEN" ? "closed" : "open";
            rpc
              .call("setIssueState", {
                repo: item.repo,
                number: item.number,
                state: next,
              })
              .then(
                () =>
                  toast.success(
                    next === "closed"
                      ? `#${item.number} closed`
                      : `#${item.number} reopened`,
                  ),
                (failure: unknown) => toast.error(errorText(failure)),
              );
          }}
        >
          <Icon
            name={item.state === "OPEN" ? "CircleCheck" : "Circle"}
            className="size-3.5 text-muted-foreground"
          />
          {item.state === "OPEN" ? "Close issue" : "Reopen issue"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => bbNavigate.openUrl(item.url)}>
          <Icon
            name="ExternalLink"
            className="size-3.5 text-muted-foreground"
          />
          Open on GitHub
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void experimental_copyToClipboard({ text: item.url }).then(
              (copied) => {
                if (copied) toast.success("Link copied");
                else toast.error("Could not copy the link");
              },
            );
          }}
        >
          <Icon name="Copy" className="size-3.5 text-muted-foreground" />
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
