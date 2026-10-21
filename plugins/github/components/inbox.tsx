import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { experimental_Icon as Icon, useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { Skeleton } from "@/components/ui/skeleton";
import {
  issueKeyOf,
  pullStateOptions,
  splitTitle,
  type DisplayPrefs,
  type GroupBy,
  type Item,
  type PullRowGroup,
  type PullRowModel,
  type RowProp,
} from "../app-logic.js";
import { presetInfo } from "../agent-presets.js";
import {
  mergeBlockedReason,
  PULL_VIEWS,
  pullGlyph,
  pullNextStep,
  pullPreset,
  type AgentPreset,
  type PullStateTarget,
  type PullView,
} from "../pull-status.js";
import type { githubRpcContract } from "../server.js";
import {
  nextMondayMorning,
  snoozeLabel,
  tomorrowMorning,
  type SnoozeRule,
} from "../snooze.js";
import { pullStateDisplay } from "./pull-state.js";
import {
  compactAge,
  KeyCaps,
  plural,
  PULL_TONE_CLASS,
  PullAuthor,
  TipButton,
  TriggerTip,
  usePendingQuestion,
  type AgentInfo,
} from "./shared.js";

export type InboxView = PullView | "issues";

export const INBOX_VIEWS: ReadonlyArray<{ id: InboxView; label: string }> = [
  ...PULL_VIEWS,
  { id: "issues", label: "Issues" },
];

export interface SnoozeChoice {
  rule: SnoozeRule;
  until: string | null;
}

export interface RowMenuState {
  key: string;
  kind: "more" | "snooze" | "status";
}

export interface PullListContext {
  viewer: string | null;
  showRepo: boolean;
  display: DisplayPrefs;
  agents: ReadonlyMap<string, AgentInfo>;
  merging: ReadonlySet<string>;
  starting: ReadonlySet<string>;
  picked: ReadonlySet<string>;
  cursor: string | null;
  openKey: string | null;
  peek: string | null;
  menu: RowMenuState | null;
  split: boolean;
  now: number;
  canEdit: (row: PullRowModel) => boolean;
}

export interface PullListActions {
  open: (row: PullRowModel) => void;
  focusRow: (key: string) => void;
  togglePick: (row: PullRowModel) => void;
  setMenu: (menu: RowMenuState | null) => void;
  startAgent: (row: PullRowModel, preset: AgentPreset) => void;
  startAgents: (rows: PullRowModel[]) => void;
  merge: (row: PullRowModel) => void;
  mergeAll: (rows: PullRowModel[]) => void;
  openThread: (row: PullRowModel) => void;
  setState: (row: PullRowModel, target: PullStateTarget) => void;
  snooze: (rows: PullRowModel[], choice: SnoozeChoice) => void;
  unsnooze: (row: PullRowModel) => void;
  copyBranch: (row: PullRowModel) => void;
  openOnGitHub: (row: PullRowModel) => void;
}

export function snoozeOptions(
  now: Date,
  hasAgent: boolean,
): Array<{ choice: SnoozeChoice; label: string; hint: string | null }> {
  return [
    {
      choice: { rule: "checks", until: null },
      label: "Until checks change",
      hint: null,
    },
    ...(hasAgent
      ? [
          {
            choice: { rule: "reply" as const, until: null },
            label: "Until the agent replies",
            hint: null,
          },
        ]
      : []),
    {
      choice: { rule: "push", until: null },
      label: "Until a new push",
      hint: null,
    },
    {
      choice: { rule: "time", until: tomorrowMorning(now).toISOString() },
      label: "Tomorrow",
      hint: "8:00",
    },
    {
      choice: { rule: "time", until: nextMondayMorning(now).toISOString() },
      label: "Next week",
      hint: "Mon 8:00",
    },
  ];
}

export function rowReason(
  row: PullRowModel,
  agent: AgentInfo | null,
  merging: boolean,
  now: number,
  question: string | null = null,
): string {
  if (merging) return `Merging into ${row.pr.baseRefName}…`;
  if (row.group === "snoozed" && row.item.snooze !== null) {
    return `Snoozed ${snoozeLabel(row.item.snooze, new Date(now))}`;
  }
  if (agent?.state === "waiting") {
    return question === null
      ? "Agent waiting for your answer"
      : `Agent asks: ${question}`;
  }
  if (agent?.state === "running") {
    return `Agent ${presetInfo(agent.preset ?? "custom").doing} · ${compactAge(agent.startedAt, now)}`;
  }
  const step = pullNextStep(row.pr, row.group);
  if (agent?.state === "done" && row.pr.attention === "ready_to_merge") {
    return `${step} · ${agent.preset === "review" ? "reviewed by an agent" : "an agent finished"}`;
  }
  return step;
}

function isLive(row: PullRowModel): boolean {
  return row.pr.state === "open" || row.pr.state === "draft";
}

function quickAction(
  row: PullRowModel,
  agent: AgentInfo | null,
): {
  label: string;
  keys: string[];
  icon: string;
  kind: "open" | "thread" | "merge" | "agent";
  preset: AgentPreset;
} | null {
  if (!isLive(row)) return null;
  if (agent?.state === "waiting") {
    return {
      label: "Answer the agent",
      keys: ["↵"],
      icon: "MessageQuestion",
      kind: "open",
      preset: "custom",
    };
  }
  if (agent?.state === "running") {
    return {
      label: "Open the agent's thread",
      keys: ["T"],
      icon: "MessageSquare",
      kind: "thread",
      preset: "custom",
    };
  }
  switch (row.pr.attention) {
    case "ready_to_merge":
      return {
        label: "Merge",
        keys: ["M"],
        icon: "GitMerge",
        kind: "merge",
        preset: "review",
      };
    case "checks_failed":
      return {
        label: "Fix with an agent",
        keys: ["A"],
        icon: "Toolbox",
        kind: "agent",
        preset: "fix",
      };
    case "conflicts":
      return {
        label: "Resolve with an agent",
        keys: ["A"],
        icon: "Toolbox",
        kind: "agent",
        preset: "conflicts",
      };
    default:
      return {
        label: "Start an agent",
        keys: ["A"],
        icon: "Zap",
        kind: "agent",
        preset: pullPreset(row.pr),
      };
  }
}

function listState(row: PullRowModel): string {
  if (row.pr.state === "draft") return "DRAFT";
  return row.item.state;
}

function Sep() {
  return <span className="text-subtle-foreground/60"> · </span>;
}

function RowProps({
  row,
  show,
}: {
  row: PullRowModel;
  show: Record<RowProp, boolean>;
}) {
  const parts: ReactNode[] = [];
  if (show.stack && row.stack !== null) {
    parts.push(
      <span key="stack" className="inline-flex items-center gap-1">
        <Icon name="Layers" className="size-3" />
        {row.stack.index}/{row.stack.size}
      </span>,
    );
  }
  const key = show.issueKey
    ? issueKeyOf(row.item.title, row.pr.headRefName)
    : null;
  if (key !== null) {
    parts.push(
      <span key="issue" className="font-mono">
        {key}
      </span>,
    );
  }
  const checks = row.pr.checks;
  if (
    show.checks &&
    row.pr.state !== "merged" &&
    checks.passed + checks.failed + checks.pending > 0
  ) {
    parts.push(
      <span key="checks" className="inline-flex items-center gap-1">
        <Icon
          name={checks.failed > 0 ? "CircleX" : "CircleCheck"}
          className="size-3"
        />
        {checks.failed > 0 ? checks.failed : checks.passed}
      </span>,
    );
  }
  if (show.diff && row.pr.additions + row.pr.deletions > 0) {
    parts.push(
      <span key="diff" className="inline-flex gap-1">
        <span className="text-diff-added">+{row.pr.additions}</span>
        <span className="text-diff-removed">-{row.pr.deletions}</span>
      </span>,
    );
  }
  return <>{parts}</>;
}

function SnoozeItems({
  row,
  now,
  hasAgent,
  onSnooze,
  onUnsnooze,
}: {
  row: PullRowModel;
  now: number;
  hasAgent: boolean;
  onSnooze: (choice: SnoozeChoice) => void;
  onUnsnooze: () => void;
}) {
  return (
    <>
      <DropdownMenuLabel>Snooze #{row.item.number}</DropdownMenuLabel>
      {snoozeOptions(new Date(now), hasAgent).map((option) => (
        <DropdownMenuItem
          key={option.label}
          onSelect={() => onSnooze(option.choice)}
        >
          <Icon
            name="TimeSchedule"
            className="size-3.5 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.hint === null ? null : (
            <span className="shrink-0 pl-3 text-xs text-muted-foreground">
              {option.hint}
            </span>
          )}
        </DropdownMenuItem>
      ))}
      {row.item.snooze === null ? null : (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onUnsnooze}>
            <Icon name="X" className="size-3.5 text-muted-foreground" />
            Unsnooze
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

function StatusItems({
  row,
  canEdit,
  onSetState,
  onMerge,
}: {
  row: PullRowModel;
  canEdit: boolean;
  onSetState: (target: PullStateTarget) => void;
  onMerge: () => void;
}) {
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => {
    if (!confirmClose) return;
    const timer = window.setTimeout(() => setConfirmClose(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [confirmClose]);
  const state = listState(row);
  const options = pullStateOptions({
    state,
    isDraft: row.pr.state === "draft",
    viewerCanUpdate: canEdit,
    viewerCanClose: canEdit,
    viewerCanReopen: canEdit,
  });
  const targets: PullStateTarget[] = ["draft", "open", "closed"];
  const current: Record<PullStateTarget, string> = {
    draft: "DRAFT",
    open: "OPEN",
    closed: "CLOSED",
  };
  const blocked = mergeBlockedReason(row.pr);
  const merged = pullStateDisplay("MERGED");
  return (
    <>
      <DropdownMenuLabel>Status of #{row.item.number}</DropdownMenuLabel>
      {targets.map((target) => {
        const display = pullStateDisplay(current[target]);
        const isCurrent = current[target] === state;
        const option = options.find((entry) => entry.target === target);
        if (!isCurrent && option === undefined) return null;
        const confirming = target === "closed" && confirmClose && !isCurrent;
        return (
          <DropdownMenuItem
            key={target}
            role="menuitemradio"
            aria-checked={isCurrent}
            variant={confirming ? "destructive" : "default"}
            onSelect={(event) => {
              if (isCurrent) return;
              if (target === "closed" && !confirmClose) {
                event.preventDefault();
                setConfirmClose(true);
                return;
              }
              onSetState(target);
            }}
          >
            <Icon
              name={display.icon}
              className={`size-3.5 shrink-0 ${confirming ? "" : display.tone}`}
            />
            {confirming ? (
              <span className="min-w-0 flex-1 truncate">
                Close without merging?
              </span>
            ) : (
              <>
                <span className="w-14 shrink-0">{display.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {option?.hint}
                </span>
              </>
            )}
            {isCurrent ? (
              <Icon
                name="Check"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            ) : confirming ? (
              <span className="shrink-0 text-xs">Press again</span>
            ) : target === "open" && state === "DRAFT" ? (
              <KeyCaps keys={["R"]} />
            ) : null}
          </DropdownMenuItem>
        );
      })}
      {state === "OPEN" || state === "DRAFT" ? (
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={false}
          disabled={blocked !== null}
          onSelect={onMerge}
        >
          <Icon
            name={merged.icon}
            className={`size-3.5 shrink-0 ${merged.tone}`}
          />
          <span className="w-14 shrink-0">{merged.label}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {blocked ?? `Merge into ${row.pr.baseRefName}…`}
          </span>
          {blocked === null ? <KeyCaps keys={["M"]} /> : null}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

function PullRowMenu({
  row,
  context,
  actions,
}: {
  row: PullRowModel;
  context: PullListContext;
  actions: PullListActions;
}) {
  const menu = context.menu?.key === row.key ? context.menu : null;
  const agent = context.agents.get(row.key) ?? null;
  const live = isLive(row);
  const canEdit = context.canEdit(row);
  return (
    <DropdownMenu
      open={menu !== null}
      onOpenChange={(open) =>
        actions.setMenu(open ? { key: row.key, kind: "more" } : null)
      }
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          tabIndex={-1}
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label={`More actions for #${row.item.number}`}
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64"
        mobileTitle={`#${row.item.number}`}
      >
        {menu?.kind === "snooze" ? (
          <SnoozeItems
            row={row}
            now={context.now}
            hasAgent={agent !== null}
            onSnooze={(choice) => actions.snooze([row], choice)}
            onUnsnooze={() => actions.unsnooze(row)}
          />
        ) : menu?.kind === "status" ? (
          <StatusItems
            row={row}
            canEdit={canEdit}
            onSetState={(target) => actions.setState(row, target)}
            onMerge={() => actions.merge(row)}
          />
        ) : (
          <>
            {live ? (
              <DropdownMenuItem
                onSelect={() => actions.startAgent(row, pullPreset(row.pr))}
              >
                <Icon name="Zap" className="size-3.5 text-muted-foreground" />
                Start an agent…
                <KeyCaps keys={["A"]} />
              </DropdownMenuItem>
            ) : null}
            {agent !== null ? (
              <DropdownMenuItem onSelect={() => actions.openThread(row)}>
                <Icon
                  name="MessageSquare"
                  className="size-3.5 text-muted-foreground"
                />
                Open the agent's thread
                <KeyCaps keys={["T"]} />
              </DropdownMenuItem>
            ) : null}
            {live && row.pr.state === "draft" && canEdit ? (
              <DropdownMenuItem onSelect={() => actions.setState(row, "open")}>
                <Icon name="Check" className="size-3.5 text-muted-foreground" />
                Mark ready
                <KeyCaps keys={["R"]} />
              </DropdownMenuItem>
            ) : null}
            {row.pr.state !== "merged" ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  actions.setMenu({ key: row.key, kind: "status" });
                }}
              >
                <Icon
                  name={pullStateDisplay(listState(row)).icon}
                  className="size-3.5 text-muted-foreground"
                />
                Change status…
                <KeyCaps keys={["S"]} />
              </DropdownMenuItem>
            ) : null}
            {live ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  actions.setMenu({ key: row.key, kind: "snooze" });
                }}
              >
                <Icon
                  name="TimeSchedule"
                  className="size-3.5 text-muted-foreground"
                />
                Snooze…
                <KeyCaps keys={["Z"]} />
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.copyBranch(row)}>
              <Icon name="Copy" className="size-3.5 text-muted-foreground" />
              Copy branch name
              <KeyCaps keys={["C"]} />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.openOnGitHub(row)}>
              <Icon
                name="ExternalLink"
                className="size-3.5 text-muted-foreground"
              />
              Open on GitHub
              <KeyCaps keys={["O"]} />
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowTitle({ title, split }: { title: string; split: boolean }) {
  const { prefix, text } = splitTitle(title);
  return (
    <>
      {prefix !== null ? (
        <span
          className={`font-normal text-subtle-foreground ${split ? "@min-[60rem]/github:hidden" : ""}`}
        >
          {prefix}{" "}
        </span>
      ) : null}
      {text}
    </>
  );
}

export function PullListRow({
  row,
  context,
  actions,
  registerRow,
}: {
  row: PullRowModel;
  context: PullListContext;
  actions: PullListActions;
  registerRow: (key: string, element: HTMLButtonElement | null) => void;
}) {
  const agent = context.agents.get(row.key) ?? null;
  const merging = context.merging.has(row.key);
  const picked = context.picked.has(row.key);
  const isCursor = context.cursor === row.key;
  const isOpen = context.openKey === row.key;
  const menuOpen = context.menu?.key === row.key;
  const compact = context.display.density === "compact";
  const glyph = merging
    ? { icon: "Spinner", tone: "working" as const, label: "Merging" }
    : pullGlyph(row.pr, row.group, agent?.state ?? null);
  const pending = usePendingQuestion(
    agent?.state === "waiting" ? agent.threadId : null,
    agent?.updatedAt ?? 0,
  );
  const reason = rowReason(
    row,
    agent,
    merging,
    context.now,
    pending.question?.prompt ?? null,
  );
  const live =
    merging || agent?.state === "running" || row.pr.checks.state === "pending";
  const parts = [
    ...(row.pr.state === "draft" && row.group !== "draft" ? ["draft"] : []),
    ...(row.note === null ? [] : [row.note]),
  ];
  const showAuthor =
    context.display.show.author &&
    (context.viewer === null ||
      row.item.author.toLowerCase() !== context.viewer.toLowerCase());
  const age = compactAge(
    row.pr.state === "merged" && row.pr.mergedAt !== null
      ? row.pr.mergedAt
      : row.item.updatedAt,
    context.now,
  );
  const action = merging ? null : quickAction(row, agent);
  const showActions = isCursor || menuOpen;
  const number = `${context.showRepo ? row.item.repo : ""}#${row.item.number}`;
  return (
    <div
      data-row-key={row.key}
      aria-busy={merging ? true : undefined}
      className={`group/row relative flex gap-2 rounded-md px-2 ${
        compact
          ? "h-8 items-center"
          : "min-h-12 items-start py-1.5 @max-[35rem]/github:min-h-16"
      } ${
        isOpen || isCursor
          ? "bg-state-active"
          : picked || menuOpen
            ? "bg-state-hover"
            : "hover:bg-state-hover"
      }`}
    >
      <button
        ref={(element) => registerRow(row.key, element)}
        type="button"
        data-row-button=""
        tabIndex={isCursor ? 0 : -1}
        title={row.item.title}
        aria-current={isOpen ? "true" : undefined}
        aria-label={`#${row.item.number} ${row.item.title}: ${reason}`}
        onClick={() => actions.open(row)}
        onFocus={() => actions.focusRow(row.key)}
        className="absolute inset-0 cursor-default rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <span
        className={`group/lead relative flex size-4 shrink-0 items-center justify-center @max-[35rem]/github:size-5 ${compact ? "" : "mt-0.5"}`}
      >
        <span
          title={glyph.label}
          className={`flex ${picked ? "invisible" : "group-hover/lead:invisible @max-[35rem]/github:group-hover/lead:visible"}`}
        >
          <Icon
            name={glyph.icon}
            aria-label={glyph.label}
            className={`size-4 @max-[35rem]/github:size-5 ${PULL_TONE_CLASS[glyph.tone]}`}
          />
        </span>
        <Checkbox
          checked={picked}
          tabIndex={-1}
          aria-label={`Select #${row.item.number}`}
          onCheckedChange={() => actions.togglePick(row)}
          className={`absolute inset-0 ${picked ? "flex" : "hidden group-hover/lead:flex"} items-center justify-center @max-[35rem]/github:hidden`}
        />
      </span>
      {compact ? (
        <>
          <span className="w-11 shrink-0 text-xs text-subtle-foreground tabular-nums">
            #{row.item.number}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            <RowTitle title={row.item.title} split={context.split} />
          </span>
          <span
            className={`max-w-[42%] shrink-0 truncate text-xs text-subtle-foreground ${live ? "animate-shine" : ""}`}
          >
            {reason}
          </span>
        </>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="block truncate text-sm font-medium text-foreground @max-[35rem]/github:line-clamp-2 @max-[35rem]/github:whitespace-normal">
            <RowTitle title={row.item.title} split={context.split} />
          </span>
          <span className="block truncate text-xs text-subtle-foreground">
            {number}
            <Sep />
            <span className={live ? "animate-shine" : undefined}>{reason}</span>
            {parts.map((part) => (
              <span key={part}>
                <Sep />
                {part}
              </span>
            ))}
          </span>
        </span>
      )}
      <span
        className={`flex h-5 shrink-0 items-center justify-end gap-2 text-xs text-subtle-foreground tabular-nums ${
          showActions ? "invisible" : "group-hover/row:invisible"
        }`}
      >
        <span className="hidden items-center gap-2 @min-[35rem]/github:flex">
          <RowProps row={row} show={context.display.show} />
          {showAuthor ? <PullAuthor login={row.item.author} /> : null}
        </span>
        <span className="min-w-6 text-right">{age}</span>
      </span>
      <span
        className={`absolute top-0.5 right-1 items-center gap-0.5 @max-[35rem]/github:hidden ${
          showActions ? "flex" : "hidden group-hover/row:flex"
        }`}
      >
        {action === null ? null : (
          <TipButton
            label={action.label}
            keys={action.keys}
            icon={action.icon}
            onClick={() => {
              if (action.kind === "open") actions.open(row);
              else if (action.kind === "thread") actions.openThread(row);
              else if (action.kind === "merge") actions.merge(row);
              else actions.startAgent(row, action.preset);
            }}
          />
        )}
        {merging ? null : (
          <PullRowMenu row={row} context={context} actions={actions} />
        )}
      </span>
    </div>
  );
}

function GroupHeader({
  label,
  count,
  avatar,
  collapsed,
  onToggle,
  bulk,
}: {
  label: string;
  count: number;
  avatar: string | null;
  collapsed: boolean;
  onToggle: () => void;
  bulk: ReactNode;
}) {
  return (
    <div className="group/grp sticky top-0 z-10 flex h-8 items-center gap-2 rounded-md bg-sidebar px-2 @max-[35rem]/github:h-10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Icon
            name="ChevronDown"
            className={`size-3 transition-transform motion-reduce:transition-none ${collapsed ? "-rotate-90" : ""}`}
          />
        </span>
        {avatar === null ? null : <PullAuthor login={avatar} />}
        <span className="truncate">{label}</span>
        <span className="font-normal tabular-nums">{count}</span>
      </button>
      {bulk}
    </div>
  );
}

function GroupBulk({
  group,
  context,
  actions,
}: {
  group: PullRowGroup;
  context: PullListContext;
  actions: PullListActions;
}) {
  const [confirm, setConfirm] = useState(false);
  if (group.rows.length < 2) return null;
  if (group.id === "ready") {
    const ready = group.rows.filter((row) => !context.merging.has(row.key));
    const busy = ready.length === 0;
    return (
      <DropdownMenu open={confirm} onOpenChange={setConfirm}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            aria-busy={busy ? true : undefined}
            className="invisible h-6 gap-1 px-1.5 text-xs font-normal text-muted-foreground group-hover/grp:visible focus-visible:visible data-[state=open]:visible @max-[35rem]/github:hidden"
          >
            <Icon
              name={busy ? "Spinner" : "GitMerge"}
              className={`size-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
            {busy ? "Merging…" : "Merge all"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-72"
          mobileTitle="Merge all"
        >
          <DropdownMenuLabel>
            Merge {plural(ready.length, "pull request")} with each repository's
            default method?
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => actions.mergeAll(ready)}>
            <Icon name="GitMerge" className="size-3.5 text-pr-merged" />
            Merge {ready.length}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  if (group.id === "fixing") {
    const idle = group.rows.filter(
      (row) => !context.starting.has(row.key) && !context.agents.has(row.key),
    );
    const busy = group.rows.some((row) => context.starting.has(row.key));
    if (idle.length === 0 && !busy) return null;
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy}
        aria-busy={busy ? true : undefined}
        onClick={() => actions.startAgents(idle)}
        className={`h-6 gap-1 px-1.5 text-xs font-normal text-muted-foreground focus-visible:visible @max-[35rem]/github:hidden ${busy ? "visible" : "invisible group-hover/grp:visible"}`}
      >
        <Icon
          name={busy ? "Spinner" : "Toolbox"}
          className={`size-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        {busy ? "Starting…" : "Fix all with agents"}
      </Button>
    );
  }
  return null;
}

type PeekDetail = {
  failing: string[];
  error: boolean;
} | null;

const peekCache = new Map<string, { at: number; failing: string[] }>();

function usePeekDetail(row: PullRowModel): PeekDetail {
  const rpc = useRpc<typeof githubRpcContract>();
  const failing = row.pr.checks.state === "failing";
  const [detail, setDetail] = useState<PeekDetail>(() => {
    const cached = peekCache.get(row.key);
    return cached !== undefined && Date.now() - cached.at < 60_000
      ? { failing: cached.failing, error: false }
      : null;
  });
  const loaded = detail !== null;
  useEffect(() => {
    if (!failing || loaded) return;
    let cancelled = false;
    rpc.call("getPull", { repo: row.item.repo, number: row.item.number }).then(
      (result) => {
        const names = [
          ...new Set(
            result.pull.checks
              .filter((check) => check.status === "failure")
              .map((check) => check.name),
          ),
        ];
        peekCache.set(row.key, { at: Date.now(), failing: names });
        if (!cancelled) setDetail({ failing: names, error: false });
      },
      () => {
        if (!cancelled) setDetail({ failing: [], error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [failing, loaded, row.item.number, row.item.repo, row.key, rpc]);
  return detail;
}

function PeekLine({
  icon,
  tone,
  children,
}: {
  icon: string;
  tone?: string;
  children: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon
        name={icon}
        className={`size-3.5 shrink-0 ${tone ?? "text-muted-foreground"}`}
      />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export function PullPeek({
  row,
  chain,
  agent,
  now,
}: {
  row: PullRowModel;
  chain: number[] | null;
  agent: AgentInfo | null;
  now: number;
}) {
  const detail = usePeekDetail(row);
  const checks = row.pr.checks;
  return (
    <div
      role="note"
      aria-label={`Peek at #${row.item.number}`}
      className="mt-1 mr-2 mb-2.5 ml-8 flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2.5 text-xs text-subtle-foreground motion-safe:animate-in motion-safe:fade-in-0"
    >
      <PeekLine icon="GitBranch">
        <span className="font-mono">
          {row.pr.headRefName} → {row.pr.baseRefName}
        </span>
      </PeekLine>
      {checks.state === "failing" ? (
        <PeekLine icon="CircleX" tone="text-destructive">
          {plural(checks.failed, "check")} failing
          {detail === null ? (
            <Skeleton className="ml-2 inline-block h-2.5 w-24 align-middle" />
          ) : detail.failing.length > 0 ? (
            <>
              :{" "}
              <span className="font-medium text-foreground">
                {detail.failing.join(", ")}
              </span>
            </>
          ) : null}
          {checks.passed > 0 ? ` · ${checks.passed} passed` : ""}
        </PeekLine>
      ) : checks.state === "pending" ? (
        <PeekLine icon="Clock">
          {checks.passed} of {checks.passed + checks.pending} checks done
        </PeekLine>
      ) : checks.passed > 0 ? (
        <PeekLine icon="CircleCheck" tone="text-success">
          {plural(checks.passed, "check")} passed
        </PeekLine>
      ) : (
        <PeekLine icon="Circle">No checks on the latest commit</PeekLine>
      )}
      {agent === null ? null : (
        <PeekLine icon="Bot" tone="text-foreground">
          <span className="font-medium text-foreground">{agent.title}</span>
          {" · "}
          {agent.state === "running"
            ? `working ${compactAge(agent.startedAt, now)}`
            : agent.state === "waiting"
              ? "waiting for you"
              : `finished ${compactAge(agent.updatedAt, now)} ago`}
        </PeekLine>
      )}
      {chain === null ? null : (
        <PeekLine icon="Layers">
          {chain.map((number, index) => (
            <span key={number}>
              {index > 0 ? " → " : ""}
              {number === row.item.number ? (
                <span className="font-medium text-foreground">#{number}</span>
              ) : (
                `#${number}`
              )}
            </span>
          ))}
        </PeekLine>
      )}
      <span className="flex flex-wrap gap-3 pt-1">
        {[
          ["↵", "Open"],
          ["A", "Agent"],
          ["Z", "Snooze"],
          ["Space", "Close"],
        ].map(([key, label]) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <KeyCaps keys={[key!]} />
            {label}
          </span>
        ))}
      </span>
    </div>
  );
}

const SKELETON_GROUPS = [1, 4, 6];

export function PullListSkeleton({ compact }: { compact: boolean }) {
  return (
    <DelayedLoading>
      <div
        aria-hidden
        className="flex flex-col motion-safe:animate-in motion-safe:fade-in-0"
      >
        {SKELETON_GROUPS.map((rows, group) => (
          <div key={group} className="flex flex-col gap-0.5 pt-3 first:pt-0">
            <div className="flex h-8 items-center gap-2 rounded-md bg-sidebar px-2">
              <span className="size-4" />
              <Skeleton className="h-2.5 w-20" />
            </div>
            {Array.from({ length: rows }, (_, row) => (
              <div
                key={row}
                className={`flex gap-2 px-2 ${compact ? "h-8 items-center" : "min-h-12 items-start py-1.5"}`}
              >
                <Skeleton className="mt-0.5 size-4 rounded-full" />
                <span className="flex flex-1 flex-col gap-2 pt-0.5">
                  <Skeleton
                    className="h-3"
                    style={{ width: `${44 + ((row * 17 + group * 11) % 36)}%` }}
                  />
                  {compact ? null : (
                    <Skeleton
                      className="h-2.5"
                      style={{
                        width: `${26 + ((row * 13 + group * 7) % 24)}%`,
                      }}
                    />
                  )}
                </span>
                <Skeleton className="mt-1 h-2.5 w-6" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </DelayedLoading>
  );
}

export function ListMessage({
  icon,
  title,
  detail,
  action,
}: {
  icon: string;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-20 text-center">
      <Icon name={icon} className="size-5 text-subtle-foreground/60" />
      <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-72 text-xs text-subtle-foreground">{detail}</p>
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}

function useRowMotion(
  container: RefObject<HTMLElement | null>,
  groups: readonly PullRowGroup[],
): void {
  const tops = useRef(new Map<string, number>());
  const seenGroups = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    const root = container.current;
    if (root === null) return;
    const groupOf = new Map<string, string>();
    for (const group of groups) {
      for (const row of group.rows) groupOf.set(row.key, group.id);
    }
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextTops = new Map<string, number>();
    for (const element of root.querySelectorAll<HTMLElement>(
      "[data-row-key]",
    )) {
      const key = element.dataset.rowKey;
      if (key === undefined) continue;
      const top = element.offsetTop;
      nextTops.set(key, top);
      const before = seenGroups.current.get(key);
      const after = groupOf.get(key);
      if (
        reduce ||
        typeof element.animate !== "function" ||
        before === undefined ||
        after === undefined ||
        before === after
      ) {
        continue;
      }
      const previous = tops.current.get(key);
      const delta = previous === undefined ? 0 : previous - top;
      if (delta !== 0 && Math.abs(delta) < 480) {
        element.animate(
          [{ transform: `translateY(${delta}px)` }, { transform: "none" }],
          { duration: 300, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      } else {
        element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
      }
      element.animate(
        [
          { backgroundColor: "var(--state-active)" },
          { backgroundColor: "transparent" },
        ],
        { duration: 1800, easing: "cubic-bezier(.4,0,.2,1)" },
      );
    }
    tops.current = nextTops;
    seenGroups.current = groupOf;
  });
}

export function PullList({
  groups,
  collapsed,
  onToggleGroup,
  context,
  actions,
  chains,
  registerRow,
  empty,
}: {
  groups: PullRowGroup[];
  collapsed: (groupId: string) => boolean;
  onToggleGroup: (groupId: string) => void;
  context: PullListContext;
  actions: PullListActions;
  chains: ReadonlyMap<string, number[]>;
  registerRow: (key: string, element: HTMLButtonElement | null) => void;
  empty: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useRowMotion(ref, groups);
  if (groups.length === 0) return <>{empty}</>;
  return (
    <div
      ref={ref}
      className="flex flex-col motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
    >
      {groups.map((group) => {
        const isCollapsed = group.label !== "" && collapsed(group.id);
        return (
          <section
            key={group.id}
            aria-label={group.label === "" ? "Pull requests" : group.label}
            className="flex flex-col gap-0.5 pt-3 first:pt-0"
          >
            {group.label === "" ? null : (
              <GroupHeader
                label={group.label}
                count={group.rows.length}
                avatar={group.avatar}
                collapsed={isCollapsed}
                onToggle={() => onToggleGroup(group.id)}
                bulk={
                  isCollapsed ? null : (
                    <GroupBulk
                      group={group}
                      context={context}
                      actions={actions}
                    />
                  )
                }
              />
            )}
            {isCollapsed
              ? null
              : group.rows.map((row) => (
                  <div key={row.key} className="flex flex-col">
                    <PullListRow
                      row={row}
                      context={context}
                      actions={actions}
                      registerRow={registerRow}
                    />
                    {context.peek === row.key ? (
                      <PullPeek
                        row={row}
                        chain={chains.get(row.key) ?? null}
                        agent={context.agents.get(row.key) ?? null}
                        now={context.now}
                      />
                    ) : null}
                  </div>
                ))}
          </section>
        );
      })}
    </div>
  );
}

export function IssueListRow({
  item,
  isCursor,
  showRepo,
  now,
  starting,
  onOpen,
  onFocus,
  onStart,
  registerRow,
  menu,
}: {
  item: Item;
  isCursor: boolean;
  showRepo: boolean;
  now: number;
  starting: boolean;
  onOpen: () => void;
  onFocus: () => void;
  onStart: () => void;
  registerRow: (key: string, element: HTMLButtonElement | null) => void;
  menu: ReactNode;
}) {
  const open = item.state === "OPEN";
  const key = `${item.repo}#${item.number}`;
  return (
    <div
      className={`group/row relative flex min-h-12 items-start gap-2 rounded-md px-2 py-1.5 @max-[35rem]/github:min-h-16 ${isCursor ? "bg-state-active" : "hover:bg-state-hover"}`}
    >
      <button
        ref={(element) => registerRow(key, element)}
        type="button"
        tabIndex={isCursor ? 0 : -1}
        title={item.title}
        aria-label={`#${item.number} ${item.title}: ${open ? "open" : "closed"}`}
        onClick={onOpen}
        onFocus={onFocus}
        className="absolute inset-0 cursor-default rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <Icon
          name={open ? "Circle" : "CircleCheck"}
          aria-label={open ? "Open" : "Closed"}
          className={`size-4 ${open ? "text-success" : "text-pr-merged"}`}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="block truncate text-sm font-medium text-foreground @max-[35rem]/github:line-clamp-2 @max-[35rem]/github:whitespace-normal">
          {item.title}
        </span>
        <span className="block truncate text-xs text-subtle-foreground">
          {showRepo ? item.repo : ""}#{item.number}
          <Sep />
          Opened by {item.author}
          {item.labels.length > 0 ? (
            <>
              <Sep />
              {item.labels.slice(0, 3).join(", ")}
            </>
          ) : null}
        </span>
      </span>
      <span
        className={`flex h-5 shrink-0 items-center gap-2 text-xs text-subtle-foreground tabular-nums ${isCursor ? "invisible" : "group-hover/row:invisible"}`}
      >
        {item.assignees.length > 0 ? (
          <span className="hidden @min-[35rem]/github:flex">
            <PullAuthor login={item.assignees[0]!} />
          </span>
        ) : null}
        <span className="min-w-6 text-right">
          {compactAge(item.updatedAt, now)}
        </span>
      </span>
      <span
        className={`absolute top-0.5 right-1 items-center gap-0.5 has-[[data-state=open]]:flex @max-[35rem]/github:hidden ${isCursor ? "flex" : "hidden group-hover/row:flex"}`}
      >
        {open ? (
          <TipButton
            label="Start an agent"
            keys={["A"]}
            icon="Zap"
            busy={starting}
            onClick={onStart}
          />
        ) : null}
        {menu}
      </span>
    </div>
  );
}

export function ViewBar({
  view,
  count,
  countLoading,
  onView,
  search,
  trailing,
}: {
  view: InboxView;
  count: number;
  countLoading: boolean;
  onView: (view: InboxView) => void;
  search: ReactNode | null;
  trailing: ReactNode;
}) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border px-2 @max-[35rem]/github:h-13">
      {search ?? (
        <>
          <div className="relative min-w-0 flex-1">
            <div
              role="tablist"
              aria-label="Views"
              className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                const at = INBOX_VIEWS.findIndex((entry) => entry.id === view);
                const next =
                  INBOX_VIEWS[
                    (at +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      INBOX_VIEWS.length) %
                      INBOX_VIEWS.length
                  ];
                if (next === undefined) return;
                onView(next.id);
                tabs.current[INBOX_VIEWS.indexOf(next)]?.focus();
              }}
            >
              {INBOX_VIEWS.map((entry, index) => (
                <button
                  key={entry.id}
                  ref={(element) => {
                    tabs.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={view === entry.id}
                  tabIndex={view === entry.id ? 0 : -1}
                  title={entry.id === "inbox" ? `${count} need you` : undefined}
                  onClick={() => onView(entry.id)}
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium whitespace-nowrap text-subtle-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-selected:bg-state-active aria-selected:text-foreground @max-[35rem]/github:h-9"
                >
                  {entry.label}
                  {entry.id !== "inbox" ? null : countLoading ? (
                    <Skeleton aria-hidden className="h-2 w-3.5" />
                  ) : count > 0 ? (
                    <span className="text-xs font-normal tabular-nums">
                      {count}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <OverflowFade
              placement="right"
              className="@min-[35rem]/github:hidden"
            />
          </div>
          {trailing}
        </>
      )}
    </div>
  );
}

const ROW_PROPS: ReadonlyArray<{ id: RowProp; label: string }> = [
  { id: "author", label: "Author" },
  { id: "checks", label: "Checks" },
  { id: "stack", label: "Stack" },
  { id: "issueKey", label: "Issue key" },
  { id: "diff", label: "Changes" },
];

export function DisplayMenu({
  open,
  onOpenChange,
  display,
  onDisplay,
  onHelp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  display: DisplayPrefs;
  onDisplay: (display: DisplayPrefs) => void;
  onHelp: () => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <TriggerTip label="Display" keys={["⇧", "V"]}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-foreground @max-[35rem]/github:size-9"
            aria-label="Display options"
          >
            <Icon name="SlidersHorizontal" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </TriggerTip>
      <DropdownMenuContent align="end" className="w-60" mobileTitle="Display">
        <DropdownMenuLabel>Group by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={display.groupBy}
          onValueChange={(value) => {
            const groupBy: GroupBy =
              value === "author" || value === "none" ? value : "attention";
            onDisplay({ ...display, groupBy });
          }}
        >
          <DropdownMenuRadioItem value="attention">
            Whose move
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="author">Author</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="none">
            No grouping
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Rows</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={display.density}
          onValueChange={(value) =>
            onDisplay({
              ...display,
              density: value === "compact" ? "compact" : "comfortable",
            })
          }
        >
          <DropdownMenuRadioItem value="comfortable">
            Two lines
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact">
            One line
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Show on rows</DropdownMenuLabel>
        {ROW_PROPS.map((prop) => (
          <DropdownMenuCheckboxItem
            key={prop.id}
            checked={display.show[prop.id]}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              onDisplay({
                ...display,
                show: { ...display.show, [prop.id]: checked === true },
              })
            }
          >
            {prop.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onHelp}>
          <Icon name="Keyboard" className="size-3.5 text-muted-foreground" />
          Keyboard shortcuts
          <KeyCaps keys={["?"]} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const SHORTCUTS: ReadonlyArray<[label: string, keys: string[]]> = [
  ["Move", ["J", "K"]],
  ["Peek", ["Space"]],
  ["Open, back", ["↵", "Esc"]],
  ["Select", ["X"]],
  ["Start an agent", ["A"]],
  ["Open the agent's thread", ["T"]],
  ["Merge", ["M"]],
  ["Mark ready", ["R"]],
  ["Change status", ["S"]],
  ["Snooze", ["Z"]],
  ["Copy branch name", ["C"]],
  ["Open on GitHub", ["O"]],
  ["Filter", ["/"]],
  ["Display", ["⇧", "V"]],
  ["Next or previous view", ["→", "←"]],
];

export function HelpMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none -ml-0.5 size-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64"
        mobileTitle="Keyboard shortcuts"
      >
        <DropdownMenuLabel>Keyboard shortcuts</DropdownMenuLabel>
        {SHORTCUTS.map(([label, keys]) => (
          <DropdownMenuItem
            key={label}
            onSelect={(event) => event.preventDefault()}
            className="cursor-default"
          >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <KeyCaps keys={keys} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BulkBar({
  rows,
  now,
  busy,
  onStartAgents,
  onMarkReady,
  onSnooze,
  onClear,
}: {
  rows: PullRowModel[];
  now: number;
  busy: boolean;
  onStartAgents: () => void;
  onMarkReady: () => void;
  onSnooze: (choice: SnoozeChoice) => void;
  onClear: () => void;
}) {
  const drafts = rows.filter((row) => row.pr.state === "draft").length;
  return (
    <div
      role="toolbar"
      aria-label={`${rows.length} selected`}
      className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-background py-1 pr-1 pl-3 text-xs whitespace-nowrap shadow-md motion-safe:animate-in motion-safe:fade-in-0"
    >
      <span className="mr-1 font-semibold tabular-nums">{rows.length}</span>
      <span className="text-subtle-foreground">selected</span>
      <span className="mx-1.5 h-4 w-px bg-border" />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs font-normal"
        disabled={busy}
        aria-busy={busy ? true : undefined}
        onClick={onStartAgents}
      >
        <Icon
          name={busy ? "Spinner" : "Zap"}
          className={`size-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        {busy ? "Starting…" : `Start ${plural(rows.length, "agent")}`}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs font-normal"
        disabled={drafts === 0}
        onClick={onMarkReady}
      >
        <Icon name="Check" className="size-3.5" />
        Mark ready
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs font-normal"
          >
            <Icon name="TimeSchedule" className="size-3.5" />
            Snooze
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          className="w-60"
          mobileTitle={`Snooze ${rows.length}`}
        >
          <DropdownMenuLabel>
            Snooze {plural(rows.length, "pull request")}
          </DropdownMenuLabel>
          {snoozeOptions(new Date(now), false).map((option) => (
            <DropdownMenuItem
              key={option.label}
              onSelect={() => onSnooze(option.choice)}
            >
              <Icon
                name="TimeSchedule"
                className="size-3.5 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.hint === null ? null : (
                <span className="shrink-0 pl-3 text-xs text-muted-foreground">
                  {option.hint}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <TipButton
        label="Clear the selection"
        keys={["Esc"]}
        icon="X"
        onClick={onClear}
      />
    </div>
  );
}
