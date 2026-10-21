import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_copyToClipboard,
  experimental_Icon as Icon,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CHANGE_KINDS,
  changeBreakdown,
  diffSizeBlocks,
  middleTruncate,
  pullStateOptions,
  unlistedChange,
  type ChangeTotals,
} from "../app-logic.js";
import type { PullStateTarget } from "../pull-status.js";
import type { githubRpcContract } from "../server.js";
import { errorText, KeyCaps } from "./shared.js";

export interface PullStateSubject {
  repo: string;
  number: number;
  state: string;
  isDraft: boolean;
  viewerCanUpdate: boolean;
  viewerCanClose: boolean;
  viewerCanReopen: boolean;
}

export type PullStateEcho = "ready" | "draft" | "closed" | "reopened";

export interface PullStateControl {
  state: string;
  pendingLabel: string | null;
  settling: boolean;
  echoes: ReadonlyArray<{ kind: PullStateEcho; at: number }>;
  change: (to: PullStateTarget, undo?: boolean) => void;
}

const PULL_STATE_DISPLAY: Record<
  string,
  { icon: string; tone: string; label: string }
> = {
  OPEN: { icon: "GitPullRequestArrow", tone: "text-success", label: "Open" },
  DRAFT: {
    icon: "GitPullRequestDraft",
    tone: "text-muted-foreground",
    label: "Draft",
  },
  MERGED: { icon: "GitMerge", tone: "text-pr-merged", label: "Merged" },
  CLOSED: {
    icon: "GitPullRequestClosed",
    tone: "text-destructive",
    label: "Closed",
  },
};

const PULL_STATE_ORDER: PullStateTarget[] = ["draft", "open", "closed"];

const TARGET_DETAIL_STATE: Record<PullStateTarget, string> = {
  open: "OPEN",
  draft: "DRAFT",
  closed: "CLOSED",
};

const DETAIL_STATE_TARGET: Record<string, PullStateTarget> = {
  OPEN: "open",
  DRAFT: "draft",
  CLOSED: "closed",
};

export function pullStateDisplay(state: string) {
  return PULL_STATE_DISPLAY[state] ?? PULL_STATE_DISPLAY.CLOSED!;
}

export function pullStateMessages(
  number: number,
  from: string,
  to: PullStateTarget,
): { pending: string; loading: string; done: string; echo: PullStateEcho } {
  if (to === "closed") {
    return {
      pending: "Closing…",
      loading: `Closing #${number}…`,
      done: `Closed #${number} without merging`,
      echo: "closed",
    };
  }
  if (from === "CLOSED") {
    return to === "draft"
      ? {
          pending: "Reopening…",
          loading: `Reopening #${number} as a draft…`,
          done: `Reopened #${number} as a draft`,
          echo: "reopened",
        }
      : {
          pending: "Reopening…",
          loading: `Reopening #${number}…`,
          done: `Reopened #${number}`,
          echo: "reopened",
        };
  }
  return to === "draft"
    ? {
        pending: "Converting…",
        loading: `Converting #${number} to a draft…`,
        done: `#${number} is a draft now`,
        echo: "draft",
      }
    : {
        pending: "Marking ready…",
        loading: `Marking #${number} ready for review…`,
        done: `#${number} is ready for review`,
        echo: "ready",
      };
}

export function pullStateUndo(
  from: string,
  to: PullStateTarget,
  isDraft: boolean,
): PullStateTarget | null {
  const back = DETAIL_STATE_TARGET[from];
  const reversible =
    from !== "CLOSED" ||
    TARGET_DETAIL_STATE[to] === (isDraft ? "DRAFT" : "OPEN");
  return reversible && back !== undefined ? back : null;
}

export function pullStateAfter(to: PullStateTarget): string {
  return TARGET_DETAIL_STATE[to];
}

export function usePullStateChange(
  subject: PullStateSubject,
  onChanged: () => Promise<void>,
): PullStateControl {
  const rpc = useRpc<typeof githubRpcContract>();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [shownState, setShownState] = useState<string | null>(null);
  const [seenState, setSeenState] = useState(subject.state);
  const [echoes, setEchoes] = useState<
    Array<{ kind: PullStateEcho; at: number }>
  >([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  if (seenState !== subject.state) {
    setSeenState(subject.state);
    setShownState(null);
  }
  const state = shownState ?? subject.state;
  const { repo, number, isDraft } = subject;

  const request = useCallback(
    function requestChange(
      from: string,
      to: PullStateTarget,
      undo: boolean,
    ): void {
      const messages = pullStateMessages(number, from, to);
      const back = undo ? pullStateUndo(from, to, isDraft) : null;
      const id = toast.loading(messages.loading);
      inFlight.current += 1;
      setSettling(true);
      queue.current = queue.current
        .then(() => {
          setPendingLabel(messages.pending);
          return rpc.call("setPullState", { repo, number, state: to });
        })
        .then(
          () => {
            setShownState(TARGET_DETAIL_STATE[to]);
            setEchoes((current) => [
              ...current,
              { kind: messages.echo, at: Date.now() },
            ]);
            toast.success(messages.done, {
              id,
              ...(back !== null
                ? {
                    action: {
                      label: "Undo",
                      onClick: () =>
                        requestChange(TARGET_DETAIL_STATE[to], back, false),
                    },
                  }
                : {}),
            });
          },
          (error: unknown) => {
            toast.error(`Couldn't update #${number}`, {
              id,
              description: errorText(error),
            });
          },
        )
        .then(() => {
          setPendingLabel(null);
          return onChanged();
        })
        .finally(() => {
          inFlight.current -= 1;
          if (inFlight.current === 0) setSettling(false);
        });
    },
    [isDraft, number, onChanged, repo, rpc],
  );

  const change = useCallback(
    (to: PullStateTarget, undo = true) => request(state, to, undo),
    [request, state],
  );
  return { state, pendingLabel, settling, echoes, change };
}

export function PullStateBadge({ state }: { state: string }) {
  const display = pullStateDisplay(state);
  return (
    <Badge variant="outline" className="h-6 gap-1.5 rounded-full font-normal">
      <Icon
        name={display.icon}
        className={`size-3.5 shrink-0 ${display.tone}`}
      />
      {display.label}
    </Badge>
  );
}

export interface PullMergeRow {
  reason: string | null;
  onMerge: () => void;
}

export function PullStateMenu({
  subject,
  control,
  merge,
  openRequest = 0,
}: {
  subject: PullStateSubject;
  control: PullStateControl;
  merge: PullMergeRow | null;
  openRequest?: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [seenRequest, setSeenRequest] = useState(openRequest);
  const { state, pendingLabel, settling, change } = control;
  if (seenRequest !== openRequest) {
    setSeenRequest(openRequest);
    if (!settling) setMenuOpen(true);
  }
  useEffect(() => {
    if (!confirmClose) return;
    const timer = window.setTimeout(() => setConfirmClose(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [confirmClose]);

  const options = pullStateOptions({ ...subject, state });
  const display = pullStateDisplay(state);
  const mergeRow =
    merge !== null && (state === "OPEN" || state === "DRAFT") ? merge : null;
  if (
    !settling &&
    options.length === 0 &&
    (mergeRow === null || mergeRow.reason !== null)
  ) {
    return <PullStateBadge state={state} />;
  }
  const rows = PULL_STATE_ORDER.flatMap(
    (target): Array<{ target: PullStateTarget; hint: string | null }> => {
      if (TARGET_DETAIL_STATE[target] === state) {
        return [{ target, hint: null }];
      }
      const option = options.find((entry) => entry.target === target);
      return option === undefined ? [] : [{ target, hint: option.hint }];
    },
  );
  const merged = pullStateDisplay("MERGED");
  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        if (open && settling) return;
        setMenuOpen(open);
        if (!open) setConfirmClose(false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-6 gap-1.5 rounded-full px-2 text-xs font-normal aria-disabled:cursor-default data-[state=open]:bg-state-active"
          aria-label={
            pendingLabel ??
            (settling
              ? `Status: ${display.label}`
              : `Status: ${display.label}. Change the status`)
          }
          aria-busy={settling}
          aria-disabled={settling}
        >
          {pendingLabel !== null ? (
            <>
              <Icon
                name="Loading"
                className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
              />
              {pendingLabel}
            </>
          ) : (
            <>
              <Icon
                name={display.icon}
                className={`size-3.5 shrink-0 ${display.tone}`}
              />
              {display.label}
              {settling ? null : (
                <Icon
                  name="ChevronDown"
                  className="size-3 shrink-0 text-muted-foreground"
                />
              )}
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-80"
        mobileTitle={`Status of #${subject.number}`}
      >
        <DropdownMenuLabel>Status of #{subject.number}</DropdownMenuLabel>
        <span className="sr-only" aria-live="polite">
          {confirmClose
            ? `Press Closed again to close #${subject.number} without merging`
            : ""}
        </span>
        {rows.map(({ target, hint }) => {
          const rowDisplay = pullStateDisplay(TARGET_DETAIL_STATE[target]);
          const current = hint === null;
          const confirming = target === "closed" && confirmClose && !current;
          return (
            <DropdownMenuItem
              key={target}
              role="menuitemradio"
              aria-checked={current}
              variant={confirming ? "destructive" : "default"}
              onSelect={(event) => {
                if (current) return;
                if (target === "closed" && !confirmClose) {
                  event.preventDefault();
                  setConfirmClose(true);
                  return;
                }
                change(target);
              }}
            >
              <Icon
                name={rowDisplay.icon}
                className={`size-3.5 shrink-0 ${confirming ? "" : rowDisplay.tone}`}
              />
              {confirming ? (
                <span className="min-w-0 flex-1 truncate">
                  Close without merging?
                </span>
              ) : (
                <>
                  <span className="w-14 shrink-0">{rowDisplay.label}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {hint}
                  </span>
                </>
              )}
              {current ? (
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
        {mergeRow === null ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              role="menuitemradio"
              aria-checked={false}
              disabled={mergeRow.reason !== null}
              onSelect={() => mergeRow.onMerge()}
            >
              <Icon
                name={merged.icon}
                className={`size-3.5 shrink-0 ${merged.tone}`}
              />
              <span className="w-14 shrink-0">{merged.label}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {mergeRow.reason ?? "Merge…"}
              </span>
              {mergeRow.reason === null ? <KeyCaps keys={["M"]} /> : null}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const DIFF_COUNT_FORMAT = new Intl.NumberFormat("en-US");

export function formatDiffCount(value: number): string {
  return DIFF_COUNT_FORMAT.format(value);
}

export function DiffSizeBar({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="flex shrink-0 gap-px" aria-hidden>
      {diffSizeBlocks(additions, deletions).map((block, index) => (
        <span
          key={index}
          className={`size-1.5 rounded-[1px] ${
            block === "added"
              ? "bg-diff-added"
              : block === "removed"
                ? "bg-diff-removed"
                : "bg-muted"
          }`}
        />
      ))}
    </span>
  );
}

export interface DiffStatSubject {
  additions: number;
  deletions: number;
  changedFiles: number;
  files: ReadonlyArray<{ path: string; additions: number; deletions: number }>;
}

export function PullDiffStat({
  pull,
  onShowFiles,
}: {
  pull: DiffStatSubject;
  onShowFiles: (() => void) | null;
}) {
  const breakdown = changeBreakdown(pull.files);
  const unlisted = unlistedChange(pull, breakdown);
  const fileCount = `${pull.changedFiles} file${pull.changedFiles === 1 ? "" : "s"}`;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="-mx-1 inline-flex items-center gap-1.5 rounded px-1 tabular-nums transition-colors enabled:hover:bg-state-hover enabled:hover:text-foreground @max-[35rem]/github:h-7"
            aria-label={`${pull.additions} lines added and ${pull.deletions} removed in ${fileCount}${onShowFiles === null ? "" : ". Show the files"}`}
            disabled={onShowFiles === null}
            onClick={onShowFiles ?? undefined}
          >
            <span className="text-diff-added">
              +{formatDiffCount(pull.additions)}
            </span>
            <span className="text-diff-removed">
              -{formatDiffCount(pull.deletions)}
            </span>
            <DiffSizeBar
              additions={pull.additions}
              deletions={pull.deletions}
            />
            <span>· {fileCount}</span>
          </button>
        </TooltipTrigger>
        {breakdown.length > 0 ? (
          <TooltipContent
            side="bottom"
            align="start"
            className="border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md"
          >
            <div className="grid grid-cols-[auto_auto_auto_auto] gap-x-4 gap-y-1 tabular-nums">
              {breakdown.map((entry) => (
                <ChangeRow
                  key={entry.kind}
                  label={CHANGE_KINDS[entry.kind]}
                  additions={entry.additions}
                  deletions={entry.deletions}
                  files={entry.files}
                />
              ))}
              {unlisted === null ? null : (
                <ChangeRow
                  label="Not listed"
                  additions={unlisted.additions}
                  deletions={unlisted.deletions}
                  files={unlisted.files}
                />
              )}
              <span className="col-span-4 border-t border-border" />
              <ChangeRow
                label="Total"
                additions={pull.additions}
                deletions={pull.deletions}
                files={pull.changedFiles}
              />
            </div>
          </TooltipContent>
        ) : null}
      </Tooltip>
    </TooltipProvider>
  );
}

export function ChangeKinds({ rows }: { rows: ChangeTotals[] }) {
  if (rows.length < 2) return null;
  return (
    <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
      {rows.map((row) => (
        <span key={row.kind}>
          {CHANGE_KINDS[row.kind]}{" "}
          <span className="text-diff-added">
            +{formatDiffCount(row.additions)}
          </span>{" "}
          <span className="text-diff-removed">
            -{formatDiffCount(row.deletions)}
          </span>
        </span>
      ))}
    </p>
  );
}

function ChangeRow({
  label,
  additions,
  deletions,
  files,
}: {
  label: string;
  additions: number;
  deletions: number;
  files: number;
}) {
  return (
    <>
      <span>{label}</span>
      <span className="text-right text-diff-added">
        +{formatDiffCount(additions)}
      </span>
      <span className="text-right text-diff-removed">
        -{formatDiffCount(deletions)}
      </span>
      <span className="text-right text-muted-foreground">
        {files} file{files === 1 ? "" : "s"}
      </span>
    </>
  );
}

export function useCopy(): [boolean, (text: string, what: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = useCallback((text: string, what: string) => {
    void experimental_copyToClipboard({ text }).then((ok) => {
      if (ok) setCopied(true);
      else toast.error(`Could not copy the ${what}`);
    });
  }, []);
  return [copied, copy];
}

export function BranchCopyChip({ name }: { name: string }) {
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      className="-mx-1 inline-flex min-w-0 items-center gap-1 rounded px-1 font-mono transition-colors hover:bg-state-hover hover:text-foreground @max-[35rem]/github:h-7"
      title={copied ? "Copied" : `Copy ${name}`}
      aria-label={`Copy the branch name ${name}`}
      onClick={() => copy(name, "branch name")}
    >
      <span className="min-w-0 truncate">{middleTruncate(name, 44)}</span>
      <Icon
        name={copied ? "Check" : "Copy"}
        className={`size-3 shrink-0 ${copied ? "text-success" : "text-muted-foreground"}`}
      />
      <span className="sr-only" aria-live="polite">
        {copied ? "Branch name copied" : ""}
      </span>
    </button>
  );
}
