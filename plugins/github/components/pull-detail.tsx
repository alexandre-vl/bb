import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  detailPullStatus,
  issueKeyOf,
  linearLinkback,
  splitTitle,
  type PullRowModel,
} from "../app-logic.js";
import { presetInfo } from "../agent-presets.js";
import {
  checksSummary,
  isViewerReviewRequested,
  mergeBlockedReason,
  pullPreset,
  type AgentPreset,
  type PullStatus,
} from "../pull-status.js";
import type { githubRpcContract } from "../server.js";
import type { AgentTarget } from "./agent-sheet.js";
import type { SnoozeChoice } from "./inbox.js";
import { snoozeOptions } from "./inbox.js";
import { Markdown } from "./markdown-lite.js";
import type { MergeTarget } from "./merge-dialog.js";
import {
  BranchCopyChip,
  PullDiffStat,
  PullStateBadge,
  PullStateMenu,
  useCopy,
  usePullStateChange,
  type PullStateSubject,
} from "./pull-state.js";
import {
  ActivitySkeleton,
  ActivityTimeline,
  ChecksBar,
  ChecksSkeleton,
  ChecksTab,
  checkCounts,
  FilesSkeleton,
  FilesTab,
  ReplyBox,
  SectionError,
  useSendLog,
  type DetailTab,
  type SentMessage,
} from "./pull-tabs.js";
import {
  clockSince,
  errorText,
  plural,
  PullAuthor,
  relativeTime,
  TipButton,
  TriggerTip,
  useNow,
  usePendingQuestion,
  type AgentInfo,
  type PullDetail,
} from "./shared.js";

export type DetailRequestKind =
  | "merge"
  | "agent"
  | "ready"
  | "status"
  | "snooze"
  | "thread"
  | "copy"
  | "open";

export interface PullDetailHandle {
  run: (kind: DetailRequestKind) => void;
}

export interface PullDetailProps {
  repo: string;
  number: number;
  row: PullRowModel | null;
  chainRows: PullRowModel[] | null;
  agent: AgentInfo | null;
  follow: string | null;
  merging: boolean;
  viewer: string | null;
  compact: boolean;
  split: boolean;
  workspaceEnvironmentId: string | null;
  handle: React.Ref<PullDetailHandle> | null;
  backLabel: string;
  onBack: (() => void) | null;
  onClose: (() => void) | null;
  onMerge: (target: Omit<MergeTarget, "environmentId">) => void;
  onStartAgent: (target: AgentTarget) => void;
  onOpenPull: (repo: string, number: number) => void;
  onSnooze: (choice: SnoozeChoice) => void;
  onUnsnooze: () => void;
}

function mergeSummary(pull: PullDetail, status: PullStatus): string {
  const counts = checkCounts(pull.checks);
  const checks =
    counts.failed > 0
      ? `${plural(counts.failed, "check")} failing, not required`
      : counts.passed > 0
        ? `${plural(counts.passed, "check")} passed`
        : "No checks";
  return status.mergeability === "conflicts"
    ? `${checks} · conflicts with ${pull.baseRefName}`
    : `${checks} · no conflicts`;
}

const detailCache = new Map<string, PullDetail>();
const DETAIL_CACHE_SIZE = 24;
const CHECKS_POLL_MS = 20_000;

function rememberDetail(key: string, pull: PullDetail): void {
  detailCache.delete(key);
  detailCache.set(key, pull);
  const oldest = detailCache.keys().next().value;
  if (detailCache.size > DETAIL_CACHE_SIZE && oldest !== undefined) {
    detailCache.delete(oldest);
  }
}

function useDetail(repo: string, number: number) {
  const rpc = useRpc<typeof githubRpcContract>();
  const key = `${repo}#${number}`;
  const [pull, setPull] = useState<PullDetail | null>(
    () => detailCache.get(key) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    seq.current += 1;
    const current = seq.current;
    return rpc.call("getPull", { repo, number }).then(
      (result) => {
        rememberDetail(`${repo}#${number}`, result.pull);
        if (current !== seq.current) return;
        setPull(result.pull);
        setError(null);
      },
      (failure: unknown) => {
        if (current !== seq.current) return;
        setError(errorText(failure));
      },
    );
  }, [rpc, repo, number]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("data-changed", () => void load());
  const checksRunning =
    pull !== null &&
    pull.state !== "MERGED" &&
    pull.state !== "CLOSED" &&
    pull.checks.some((check) => check.status === "pending");
  useEffect(() => {
    if (!checksRunning) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, CHECKS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [checksRunning, load]);
  return { pull, error, load };
}

function CardHead({
  glyph,
  title,
  detail,
}: {
  glyph: ReactNode;
  title: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5 font-medium text-foreground">{title}</p>
        {detail === null ? null : (
          <p className="text-xs text-subtle-foreground">{detail}</p>
        )}
      </div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Next step"
      className="-mx-4 flex flex-col gap-3 rounded-lg border border-border p-4 @max-[35rem]/github:mx-0"
    >
      {children}
    </section>
  );
}

function CardActions({ children }: { children: ReactNode }) {
  return (
    <div className="ml-6 flex flex-wrap gap-2 @max-[35rem]/github:ml-0 @max-[35rem]/github:flex-col @max-[35rem]/github:[&>*]:w-full">
      {children}
    </div>
  );
}

function Glyph({ icon, tone }: { icon: string; tone: string }) {
  return <Icon name={icon} className={`size-4 ${tone}`} />;
}

function FailingList({ pull }: { pull: PullDetail }) {
  const failed = pull.checks.filter((check) => check.status === "failure");
  if (failed.length === 0) return null;
  return (
    <div className="ml-6 flex flex-col">
      {failed.map((check) => (
        <div
          key={`${check.workflow ?? ""}/${check.name}`}
          className="flex h-7 items-center gap-2"
        >
          <Icon name="CircleX" className="size-3.5 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
            {check.name}
          </span>
          {check.url.length > 0 ? <ViewLog url={check.url} /> : null}
        </div>
      ))}
    </div>
  );
}

function ViewLog({ url }: { url: string }) {
  const navigate = useBbNavigate();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-6 gap-1 px-1.5 text-xs font-normal text-muted-foreground"
      onClick={() => navigate.openUrl(url)}
    >
      View log
      <Icon name="ExternalLink" className="size-3" />
    </Button>
  );
}

function FollowRow({
  agent,
  follow,
  onFollow,
}: {
  agent: AgentInfo;
  follow: string | null;
  onFollow: (on: boolean) => void;
}) {
  const on = follow === agent.threadId;
  return (
    <label className="ml-6 flex min-h-8 cursor-pointer items-center gap-2 text-xs text-subtle-foreground @max-[35rem]/github:ml-0">
      <Icon name="BellDot" className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        Send CI results, reviews and comments to the agent's thread
      </span>
      <Switch
        checked={on}
        aria-label="Follow this pull request"
        onCheckedChange={onFollow}
      />
    </label>
  );
}

function AgentWaitingCard({
  agent,
  follow,
  onFollow,
  onOpenThread,
}: {
  agent: AgentInfo;
  follow: string | null;
  onFollow: (on: boolean) => void;
  onOpenThread: () => void;
}) {
  const sdk = useSdk();
  const pending = usePendingQuestion(agent.threadId);
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const resolve = (selected: string[], freeText: string | null) => {
    const question = pending.question;
    if (question === null) return;
    setSending(true);
    sdk.threads.interactions
      .resolve({
        threadId: agent.threadId,
        interactionId: question.interactionId,
        resolution: {
          kind: "user_answer",
          answers: {
            [question.questionId]: {
              selected,
              ...(freeText === null ? {} : { freeText }),
            },
          },
        },
      })
      .then(
        () => {
          setAnswer("");
          toast.success("Reply sent · the agent is back at work");
        },
        (error: unknown) =>
          toast.error("Couldn't send the reply", {
            description: errorText(error),
          }),
      )
      .finally(() => setSending(false));
  };
  const question = pending.question;
  return (
    <Card>
      <CardHead
        glyph={<Glyph icon="MessageQuestion" tone="text-foreground" />}
        title="The agent needs your answer"
        detail={`${agent.title} · asked ${relativeTime(agent.updatedAt)}`}
      />
      {pending.status === "loading" ? (
        <div
          aria-hidden
          className="ml-3 flex flex-col gap-2 rounded-lg bg-surface-recessed px-3 py-2.5"
        >
          <Skeleton className="h-2.5 w-3/5" />
          <Skeleton className="h-2.5 w-2/5" />
        </div>
      ) : question === null ? (
        <p className="ml-6 text-xs text-subtle-foreground">
          {pending.status === "error"
            ? "Couldn't read the question here."
            : "It's waiting for an approval or several answers."}{" "}
          Answer it in the thread.
        </p>
      ) : (
        <>
          <div className="ml-3 rounded-lg bg-surface-recessed px-3 py-2.5">
            <Markdown content={question.prompt} className="text-sm" />
          </div>
          {question.options.length > 0 ? (
            <div className="ml-3 flex flex-wrap gap-2">
              {question.options.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={sending}
                  onClick={() => resolve([option.value], null)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}
          {question.allowFreeText ? (
            <form
              className="ml-3 flex h-8 items-center gap-1.5 rounded-md border border-input pr-0.5 pl-3 focus-within:border-subtle-foreground"
              onSubmit={(event) => {
                event.preventDefault();
                if (answer.trim().length > 0) resolve([], answer.trim());
              }}
            >
              <input
                value={answer}
                disabled={sending}
                aria-label="Reply to the agent"
                placeholder="Reply to the agent"
                onChange={(event) => setAnswer(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
              />
              <Button
                type="submit"
                size="icon"
                className="size-7"
                variant={answer.trim().length > 0 ? "default" : "secondary"}
                disabled={sending || answer.trim().length === 0}
                aria-busy={sending ? true : undefined}
                aria-label="Send the reply"
              >
                <Icon
                  name={sending ? "Spinner" : "ArrowUp"}
                  className={`size-3.5 ${sending ? "animate-spin motion-reduce:animate-none" : ""}`}
                />
              </Button>
            </form>
          ) : null}
        </>
      )}
      <CardActions>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-ml-1.5"
          onClick={onOpenThread}
        >
          <Icon name="MessageSquare" />
          Open the thread
        </Button>
      </CardActions>
      <FollowRow agent={agent} follow={follow} onFollow={onFollow} />
    </Card>
  );
}

function AgentRunningCard({
  agent,
  pull,
  follow,
  onFollow,
  onOpenThread,
}: {
  agent: AgentInfo;
  pull: PullDetail | null;
  follow: string | null;
  onFollow: (on: boolean) => void;
  onOpenThread: () => void;
}) {
  const now = useNow(1_000);
  const sendLog = useSendLog();
  const failing =
    pull !== null && pull.checks.some((check) => check.status === "failure");
  return (
    <Card>
      <CardHead
        glyph={
          <Glyph
            icon="Spinner"
            tone="animate-spin text-muted-foreground motion-reduce:animate-none"
          />
        }
        title={
          <span className="animate-shine">
            An agent {presetInfo(agent.preset ?? "custom").doing}
          </span>
        }
        detail={
          <>
            {agent.title} ·{" "}
            <span className="tabular-nums">
              {clockSince(agent.startedAt, now)}
            </span>
          </>
        }
      />
      {pull !== null && failing ? <FailingList pull={pull} /> : null}
      <CardActions>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onOpenThread}
        >
          <Icon name="MessageSquare" />
          Open the thread
        </Button>
        {pull !== null && failing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => sendLog(agent, pull)}
          >
            Send the log to the agent
          </Button>
        ) : null}
      </CardActions>
      <FollowRow agent={agent} follow={follow} onFollow={onFollow} />
    </Card>
  );
}

function NextStepSkeleton({ failing = 0 }: { failing?: number }) {
  return (
    <Card>
      <div
        aria-hidden
        className="flex flex-col gap-2.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
      >
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-2.5 w-3/5" />
        {failing > 0 ? (
          <div className="flex flex-col gap-2 py-1">
            {Array.from({ length: Math.min(failing, 4) }, (_, index) => (
              <div key={index} className="flex items-center gap-2">
                <Skeleton className="size-3 rounded-full" />
                <Skeleton
                  className="h-2.5"
                  style={{ width: `${34 + ((index * 17) % 30)}%` }}
                />
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
    </Card>
  );
}

function NextStepCard({
  pull,
  status,
  agent,
  follow,
  viewer,
  merging,
  readyBusy,
  rerunning,
  onFollow,
  onOpenThread,
  onMerge,
  onAgent,
  onReady,
  onReopen,
  onRerun,
}: {
  pull: PullDetail;
  status: PullStatus;
  agent: AgentInfo | null;
  follow: string | null;
  viewer: string | null;
  merging: boolean;
  readyBusy: boolean;
  rerunning: boolean;
  onFollow: (on: boolean) => void;
  onOpenThread: () => void;
  onMerge: () => void;
  onAgent: (preset: AgentPreset) => void;
  onReady: () => void;
  onReopen: () => void;
  onRerun: () => void;
}) {
  const navigate = useBbNavigate();
  const counts = checkCounts(pull.checks);
  if (status.state === "merged") return null;
  if (status.state === "closed") {
    return (
      <Card>
        <CardHead
          glyph={<Glyph icon="GitPullRequestClosed" tone="text-destructive" />}
          title="Closed without merging"
          detail={
            <>
              Closed
              {pull.closedAt === null
                ? ""
                : ` ${relativeTime(pull.closedAt)}`}{" "}
              · the branch <span className="font-mono">{pull.headRefName}</span>{" "}
              {pull.headRefExists ? "is kept" : "was deleted"}
            </>
          }
        />
        {pull.viewerCanReopen ? (
          <CardActions>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onReopen}
            >
              <Icon name="GitPullRequestArrow" />
              Reopen
            </Button>
          </CardActions>
        ) : null}
      </Card>
    );
  }
  if (agent?.state === "waiting") {
    return (
      <AgentWaitingCard
        agent={agent}
        follow={follow}
        onFollow={onFollow}
        onOpenThread={onOpenThread}
      />
    );
  }
  if (agent?.state === "running") {
    return (
      <AgentRunningCard
        agent={agent}
        pull={pull}
        follow={follow}
        onFollow={onFollow}
        onOpenThread={onOpenThread}
      />
    );
  }
  const mergeButton = (primary: boolean) =>
    pull.viewerCanMerge ? (
      <Button
        type="button"
        size="sm"
        variant={primary ? "default" : "outline"}
        disabled={merging}
        aria-busy={merging ? true : undefined}
        aria-keyshortcuts="M"
        onClick={onMerge}
      >
        <Icon
          name={merging ? "Spinner" : "GitMerge"}
          className={
            merging ? "animate-spin motion-reduce:animate-none" : undefined
          }
        />
        {merging ? "Merging…" : "Merge"}
      </Button>
    ) : null;
  switch (status.attention) {
    case "queued":
      return (
        <Card>
          <CardHead
            glyph={<Glyph icon="Clock" tone="text-muted-foreground" />}
            title="Queued to merge"
            detail="GitHub merges it when its turn in the merge queue comes."
          />
        </Card>
      );
    case "conflicts":
      return (
        <Card>
          <CardHead
            glyph={<Glyph icon="AlertCircle" tone="text-destructive" />}
            title={`Conflicts with ${pull.baseRefName}`}
            detail="GitHub can't merge this branch automatically."
          />
          <CardActions>
            <Button
              type="button"
              size="sm"
              aria-keyshortcuts="A"
              onClick={() => onAgent("conflicts")}
            >
              <Icon name="Toolbox" />
              Resolve with an agent
            </Button>
          </CardActions>
        </Card>
      );
    case "checks_failed":
      return (
        <Card>
          <CardHead
            glyph={<Glyph icon="CircleX" tone="text-destructive" />}
            title={`${plural(counts.failed || status.checks.failed, "check")} failing`}
            detail={`On the latest commit${pull.headCommittedAt === null ? "" : `, ${relativeTime(pull.headCommittedAt)}`}${counts.passed > 0 ? ` · ${counts.passed} passed` : ""}`}
          />
          <FailingList pull={pull} />
          <CardActions>
            <Button
              type="button"
              size="sm"
              aria-keyshortcuts="A"
              onClick={() => onAgent("fix")}
            >
              <Icon name="Toolbox" />
              Fix with an agent
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={rerunning}
              aria-busy={rerunning ? true : undefined}
              onClick={onRerun}
            >
              <Icon
                name={rerunning ? "Spinner" : "RotateCcw"}
                className={
                  rerunning
                    ? "animate-spin motion-reduce:animate-none"
                    : undefined
                }
              />
              {rerunning ? "Re-running…" : "Re-run failed"}
            </Button>
            {pull.mergeStateStatus === "UNSTABLE" ? mergeButton(false) : null}
          </CardActions>
        </Card>
      );
    case "changes_requested": {
      const reviewers = pull.reviewVerdicts
        .filter((verdict) => verdict.state === "CHANGES_REQUESTED")
        .map((verdict) => verdict.author);
      return (
        <Card>
          <CardHead
            glyph={<Glyph icon="AlertCircle" tone="text-destructive" />}
            title="Changes requested"
            detail={
              reviewers.length > 0
                ? `${reviewers.join(", ")} asked for changes`
                : "A reviewer asked for changes"
            }
          />
          <CardActions>
            <Button type="button" size="sm" onClick={() => onAgent("custom")}>
              <Icon name="Zap" />
              Address with an agent
            </Button>
          </CardActions>
        </Card>
      );
    }
    case "draft":
      return (
        <Card>
          <CardHead
            glyph={
              <Glyph icon="GitPullRequestDraft" tone="text-muted-foreground" />
            }
            title={
              status.checks.state === "passing"
                ? "Ready for review?"
                : "Finish this draft"
            }
            detail={
              status.checks.state === "passing"
                ? `${plural(counts.passed, "check")} passed on the latest commit`
                : status.checks.state === "no_checks"
                  ? "No checks have run yet"
                  : checksSummary(status.checks)
            }
          />
          <CardActions>
            {pull.viewerCanUpdate ? (
              <Button
                type="button"
                size="sm"
                disabled={readyBusy}
                aria-busy={readyBusy ? true : undefined}
                aria-keyshortcuts="R"
                onClick={onReady}
              >
                <Icon
                  name={readyBusy ? "Spinner" : "Check"}
                  className={
                    readyBusy
                      ? "animate-spin motion-reduce:animate-none"
                      : undefined
                  }
                />
                {readyBusy ? "Marking ready…" : "Mark ready"}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onAgent("finish")}
            >
              <Icon name="Zap" />
              Finish with an agent
            </Button>
          </CardActions>
        </Card>
      );
    case "review_requested": {
      const mine = isViewerReviewRequested(status, viewer);
      return (
        <Card>
          <CardHead
            glyph={
              <Glyph
                icon="Eye"
                tone={mine ? "text-foreground" : "text-muted-foreground"}
              />
            }
            title={mine ? "Your review is requested" : "Waiting for review"}
            detail={
              mine
                ? `${pull.author} asked you to review`
                : pull.reviewRequests.length > 0
                  ? `Requested from ${pull.reviewRequests.join(", ")}`
                  : "A review is required before merging"
            }
          />
          <CardActions>
            <Button
              type="button"
              size="sm"
              variant={mine ? "default" : "outline"}
              onClick={() => onAgent("review")}
            >
              <Icon name="Eye" />
              Review with an agent
            </Button>
            {mine ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => navigate.openUrl(`${pull.url}/files`)}
              >
                Review on GitHub
                <Icon name="ExternalLink" />
              </Button>
            ) : null}
          </CardActions>
        </Card>
      );
    }
    case "checks_pending":
      return (
        <Card>
          <CardHead
            glyph={<Glyph icon="Clock" tone="text-muted-foreground" />}
            title={<span className="animate-shine">Checks running</span>}
            detail={`${counts.passed} of ${counts.passed + counts.pending + counts.failed} done`}
          />
          <ChecksBar
            checks={pull.checks}
            className="ml-6 @max-[35rem]/github:ml-0"
          />
        </Card>
      );
    case "ready_to_merge":
      return (
        <Card>
          <CardHead
            glyph={<Glyph icon="CircleCheck" tone="text-success" />}
            title="Ready to merge"
            detail={`${counts.passed > 0 ? `${plural(counts.passed, "check")} passed` : "No checks"} · no conflicts with ${pull.baseRefName}`}
          />
          <CardActions>
            {mergeButton(true) ?? (
              <p className="text-xs text-subtle-foreground">
                You can't merge in {pull.repo}; someone with write access can.
              </p>
            )}
            {agent === null ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onAgent("review")}
              >
                <Icon name="Eye" />
                Review with an agent
              </Button>
            ) : null}
          </CardActions>
        </Card>
      );
    default: {
      const blocked =
        pull.mergeStateStatus === "BLOCKED"
          ? ["Blocked", "Branch protection rules block the merge for now."]
          : pull.mergeStateStatus === "BEHIND"
            ? [
                `Behind ${pull.baseRefName}`,
                "Update the branch before merging.",
              ]
            : status.mergeability === "unknown"
              ? [
                  "Waiting for GitHub",
                  "Mergeability hasn't been computed for the latest commit yet.",
                ]
              : status.checks.state === "no_checks"
                ? [
                    "No checks ran",
                    `Nothing runs on this branch, and it has no conflicts with ${pull.baseRefName}.`,
                  ]
                : [
                    "Checks status unknown",
                    "GitHub didn't report a result for every check.",
                  ];
      const mergeable =
        status.mergeability === "mergeable" &&
        pull.mergeStateStatus !== "BLOCKED" &&
        pull.mergeStateStatus !== "BEHIND";
      return (
        <Card>
          <CardHead
            glyph={<Glyph icon="GitPullRequest" tone="text-muted-foreground" />}
            title={blocked[0]}
            detail={blocked[1]}
          />
          {mergeable && pull.viewerCanMerge ? (
            <CardActions>{mergeButton(false)}</CardActions>
          ) : null}
        </Card>
      );
    }
  }
}

function AgentSection({
  agent,
  follow,
  onFollow,
  onOpenThread,
}: {
  agent: AgentInfo;
  follow: string | null;
  onFollow: (on: boolean) => void;
  onOpenThread: () => void;
}) {
  const { providers } = experimental_useProviders();
  const provider = providers.find((entry) => entry.id === agent.providerId) ?? {
    id: agent.providerId,
  };
  return (
    <section aria-label="Agent" className="flex flex-col gap-1.5">
      <h3 className="flex h-6 items-center text-xs font-medium text-subtle-foreground">
        Agent
      </h3>
      <div className="flex min-h-10 items-center gap-2">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <ProviderIcon
            providerKind="agent"
            provider={provider}
            fallback="Bot"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {agent.title}
          </p>
          <p className="truncate text-xs text-subtle-foreground">
            Finished {relativeTime(agent.updatedAt)} ·{" "}
            {presetInfo(agent.preset ?? "custom").label}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-1.5 text-xs font-normal"
          onClick={onOpenThread}
        >
          Open
          <Icon name="ArrowUpRight" className="size-3" />
        </Button>
      </div>
      <label className="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-subtle-foreground">
        <Icon name="BellDot" className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          Send CI results, reviews and comments to the agent's thread
        </span>
        <Switch
          checked={follow === agent.threadId}
          aria-label="Follow this pull request"
          onCheckedChange={onFollow}
        />
      </label>
    </section>
  );
}

interface StackNode {
  number: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  attention: string;
}

function StackSection({
  current,
  nodes,
  base,
  onOpen,
  onRestack,
}: {
  current: number;
  nodes: StackNode[];
  base: string;
  onOpen: (number: number) => void;
  onRestack: () => void;
}) {
  const at = nodes.findIndex((node) => node.number === current);
  const label = (node: StackNode, index: number): ReactNode => {
    if (node.number === current) return null;
    if (node.attention === "conflicts") {
      return (
        <>
          <Icon name="AlertCircle" className="size-3 text-destructive" />
          Conflicts
        </>
      );
    }
    if (node.attention === "checks_failed" || node.attention === "failing") {
      return (
        <>
          <Icon name="CircleX" className="size-3 text-destructive" />
          Checks failing
        </>
      );
    }
    if (node.state === "draft") return "Draft";
    if (node.state === "merged") return "Merged";
    if (
      index === 0 &&
      (node.attention === "ready_to_merge" || node.attention === "ready")
    ) {
      return (
        <>
          <Icon name="CircleCheck" className="size-3 text-success" />
          Ready
        </>
      );
    }
    return null;
  };
  return (
    <section aria-label="Stack" className="flex flex-col gap-1.5">
      <div className="flex h-6 items-center gap-1.5 text-xs font-medium text-subtle-foreground">
        <h3>Stack</h3>
        <span className="font-normal tabular-nums">
          {at + 1} of {nodes.length}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-mr-1.5 h-6 gap-1 px-1.5 text-xs font-normal"
          onClick={onRestack}
        >
          <Icon name="RotateCcw" className="size-3.5" />
          Restack with an agent
        </Button>
      </div>
      <ol className="flex flex-col">
        {[...nodes].reverse().map((node) => {
          const here = node.number === current;
          return (
            <li key={node.number}>
              <button
                type="button"
                aria-current={here ? "true" : undefined}
                onClick={() => onOpen(node.number)}
                className={`relative -mx-2 flex h-8 w-[calc(100%+1rem)] items-center gap-2 rounded-md pr-2 pl-8 text-left text-sm before:absolute before:top-0 before:bottom-0 before:left-[15.5px] before:w-px before:bg-input first:before:top-1/2 ${here ? "bg-state-active" : "hover:bg-state-hover"}`}
              >
                <span
                  className={`absolute top-1/2 left-3 size-2 -translate-y-1/2 rounded-full border ${here ? "border-foreground bg-foreground" : "border-input bg-background"}`}
                />
                <span className="w-10 shrink-0 text-xs text-subtle-foreground tabular-nums">
                  #{node.number}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {splitTitle(node.title).text}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-subtle-foreground">
                  {label(node, nodes.indexOf(node))}
                </span>
              </button>
            </li>
          );
        })}
        <li className="relative -mx-2 flex h-8 items-center gap-2 pr-2 pl-8 before:absolute before:top-0 before:bottom-1/2 before:left-[15.5px] before:w-px before:bg-input">
          <span className="absolute top-1/2 left-3 size-2 -translate-y-1/2 rounded-sm border border-input bg-background" />
          <span className="flex w-10 shrink-0 items-center">
            <Icon name="GitBranch" className="size-3.5 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-subtle-foreground">
            {base}
          </span>
        </li>
      </ol>
    </section>
  );
}

function Description({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element !== null) setOverflows(element.scrollHeight > 140);
  }, [body]);
  if (body.trim().length === 0) return null;
  return (
    <section aria-label="Description" className="flex flex-col gap-1.5">
      <h3 className="flex h-6 items-center text-xs font-medium text-subtle-foreground">
        Description
      </h3>
      <div
        ref={ref}
        className={
          open || !overflows
            ? undefined
            : "max-h-34 overflow-hidden [mask-image:linear-gradient(180deg,black_45%,transparent)]"
        }
      >
        <Markdown content={body} className="text-sm" />
      </div>
      {overflows ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="-ml-1.5 h-6 px-1.5 text-xs font-normal"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Show less" : "Show more"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function DetailBar({
  number,
  repo,
  issueKey,
  issueUrl,
  headRefName,
  url,
  backLabel,
  split,
  snoozeMenu,
  onBack,
  onClose,
}: {
  number: number;
  repo: string;
  issueKey: string | null;
  issueUrl: string | null;
  headRefName: string | null;
  url: string;
  backLabel: string;
  split: boolean;
  snoozeMenu: ReactNode;
  onBack: (() => void) | null;
  onClose: (() => void) | null;
}) {
  const navigate = useBbNavigate();
  const [copiedKey, copyKey] = useCopy();
  const [copiedBranch, copyBranch] = useCopy();
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border px-2">
      {onBack === null ? null : (
        <span className={split ? "@min-[60rem]/github:hidden" : undefined}>
          <TipButton
            label={backLabel}
            keys={["Esc"]}
            icon="ArrowLeft"
            className="@max-[35rem]/github:size-9"
            onClick={onBack}
          />
        </span>
      )}
      <span
        className="flex min-w-0 items-center gap-1.5 pl-1.5 text-xs whitespace-nowrap text-subtle-foreground"
        title={`${repo}#${number}`}
      >
        <span className="@max-[35rem]/github:hidden">Pull request</span>
        <span className="text-subtle-foreground/60 @max-[35rem]/github:hidden">
          /
        </span>
        <span className="font-medium text-foreground">#{number}</span>
      </span>
      <span className="flex-1" />
      {issueKey === null ? null : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-1.5 text-xs font-normal text-muted-foreground @max-[35rem]/github:h-9"
          aria-label={
            issueUrl === null
              ? `Copy ${issueKey}`
              : `Open ${issueKey} in Linear`
          }
          onClick={() =>
            issueUrl === null
              ? copyKey(issueKey, "issue key")
              : navigate.openUrl(issueUrl)
          }
        >
          <Icon
            name={
              copiedKey ? "Check" : issueUrl === null ? "Link" : "ArrowUpRight"
            }
            className="size-3.5"
          />
          {issueKey}
        </Button>
      )}
      {snoozeMenu}
      {headRefName === null ? null : (
        <TipButton
          label={copiedBranch ? "Copied" : "Copy branch name"}
          keys={["C"]}
          icon={copiedBranch ? "Check" : "Copy"}
          className="@max-[35rem]/github:size-9"
          onClick={() => copyBranch(headRefName, "branch name")}
        />
      )}
      <TipButton
        label="Open on GitHub"
        keys={["O"]}
        icon="ExternalLink"
        className="@max-[35rem]/github:size-9"
        onClick={() => navigate.openUrl(url)}
      />
      {onClose === null ? null : (
        <span className="@max-[35rem]/github:hidden">
          <TipButton label="Close" keys={["Esc"]} icon="X" onClick={onClose} />
        </span>
      )}
    </div>
  );
}

function DetailHeaderSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2.5">
      <Skeleton className="h-4.5 w-4/5" />
      <Skeleton className="h-4.5 w-1/2" />
      <div className="flex items-center gap-2 pt-0.5">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-2.5 w-2/5" />
      </div>
    </div>
  );
}

export function PullDetailView(props: PullDetailProps) {
  const {
    repo,
    number,
    row,
    chainRows,
    agent,
    follow,
    merging,
    viewer,
    compact,
    split,
    workspaceEnvironmentId,
    handle,
    backLabel,
    onBack,
    onClose,
    onMerge,
    onStartAgent,
    onOpenPull,
    onSnooze,
    onUnsnooze,
  } = props;
  const rpc = useRpc<typeof githubRpcContract>();
  const navigate = useBbNavigate();
  const { pull, error, load } = useDetail(repo, number);
  const mergingBefore = useRef(merging);
  useEffect(() => {
    const settled = mergingBefore.current && !merging;
    mergingBefore.current = merging;
    if (settled) void load();
  }, [load, merging]);
  const [tab, setTab] = useState<DetailTab>("activity");
  const [sent, setSent] = useState<SentMessage[]>([]);
  const [rerunning, setRerunning] = useState(false);
  const [statusRequest, setStatusRequest] = useState(0);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [, copyBranch] = useCopy();

  const status: PullStatus | null =
    pull !== null ? detailPullStatus(pull) : (row?.pr ?? null);
  const subject: PullStateSubject = {
    repo,
    number,
    state:
      pull?.state ??
      (row === null
        ? "OPEN"
        : row.pr.state === "draft"
          ? "DRAFT"
          : row.item.state),
    isDraft: pull?.isDraft ?? row?.pr.state === "draft",
    viewerCanUpdate: pull?.viewerCanUpdate ?? false,
    viewerCanClose: pull?.viewerCanClose ?? false,
    viewerCanReopen: pull?.viewerCanReopen ?? false,
  };
  const reload = useCallback(() => load(), [load]);
  const control = usePullStateChange(subject, reload);
  const title = pull?.title ?? row?.item.title ?? null;
  const author = pull?.author ?? row?.item.author ?? null;
  const headRefName = pull?.headRefName ?? row?.pr.headRefName ?? null;
  const baseRefName = pull?.baseRefName ?? row?.pr.baseRefName ?? null;
  const url =
    pull?.url ?? row?.item.url ?? `https://github.com/${repo}/pull/${number}`;
  const issueKey = title === null ? null : issueKeyOf(title, headRefName);
  const issueUrl =
    issueKey === null || pull === null
      ? null
      : (pull.comments
          .map((comment) => linearLinkback(comment.body))
          .find((link) => link?.key === issueKey)?.url ?? null);
  const live =
    status !== null && (status.state === "open" || status.state === "draft");

  const agentTarget = useCallback(
    (preset: AgentPreset, prompt: string | null = null): AgentTarget | null =>
      headRefName === null
        ? null
        : {
            repo,
            number,
            headRefName,
            isCrossRepository:
              pull?.isCrossRepository ?? row?.pr.isCrossRepository ?? false,
            stacked:
              (pull?.stack ?? null) !== null || (chainRows ?? null) !== null,
            preset,
            prompt,
          },
    [
      chainRows,
      headRefName,
      number,
      pull?.isCrossRepository,
      pull?.stack,
      repo,
      row?.pr.isCrossRepository,
    ],
  );
  const startAgent = useCallback(
    (preset: AgentPreset, prompt: string | null = null) => {
      const target = agentTarget(preset, prompt);
      if (target !== null) onStartAgent(target);
    },
    [agentTarget, onStartAgent],
  );
  const mergeBlocked =
    status === null
      ? "Waiting for GitHub"
      : pull !== null && !pull.viewerCanMerge
        ? `You can't merge in ${repo}`
        : status.attention === "checks_failed" &&
            pull?.mergeStateStatus === "UNSTABLE"
          ? null
          : mergeBlockedReason(status);
  const merge = useCallback(() => {
    if (pull === null || status === null) return;
    if (mergeBlocked !== null) {
      toast(`#${number} isn't ready to merge yet`, {
        description: mergeBlocked,
      });
      return;
    }
    onMerge({
      repo,
      number,
      baseRefName: pull.baseRefName,
      headRefName: pull.headRefName,
      headRefOid: pull.headRefOid.length > 0 ? pull.headRefOid : null,
      isCrossRepository: pull.isCrossRepository,
      summary: mergeSummary(pull, status),
      canDeleteBranch: pull.viewerCanDeleteHeadRef,
    });
  }, [mergeBlocked, number, onMerge, pull, repo, status]);
  const agentState = agent?.state ?? null;
  const attention = pull === null ? null : (status?.attention ?? null);
  const seen = useRef({ agentState, attention });
  useEffect(() => {
    const before = seen.current;
    seen.current = { agentState, attention };
    if (agentState !== "done" || attention !== "ready_to_merge") return;
    if (
      before.agentState !== "running" &&
      (before.attention === null || before.attention === "ready_to_merge")
    ) {
      return;
    }
    toast.success(`#${number} is ready to merge`, {
      description: "The agent finished and the checks passed.",
      action: { label: "Merge", onClick: merge },
    });
  }, [agentState, attention, merge, number]);
  const openThread = useCallback(() => {
    if (agent === null) {
      toast(`No agent works on #${number} yet`);
      return;
    }
    navigate.toThread(agent.threadId);
  }, [agent, navigate, number]);
  const setFollow = useCallback(
    (on: boolean) => {
      if (agent === null) return;
      rpc
        .call("setFollow", {
          repo,
          number,
          threadId: on ? agent.threadId : null,
        })
        .then(
          () =>
            toast.success(
              on
                ? `CI results, reviews and comments on #${number} now go to the agent`
                : `Stopped sending #${number}'s updates to the agent`,
            ),
          (failure: unknown) =>
            toast.error("Couldn't change following", {
              description: errorText(failure),
            }),
        );
    },
    [agent, number, repo, rpc],
  );
  const rerun = useCallback(() => {
    setRerunning(true);
    rpc
      .call("rerunFailedChecks", { repo, number })
      .then(
        (result) => {
          toast.success(
            `Re-running ${plural(result.checks, "failed check")} on #${number}`,
          );
          return load();
        },
        (failure: unknown) =>
          toast.error(`Couldn't re-run the checks on #${number}`, {
            description: errorText(failure),
          }),
      )
      .finally(() => setRerunning(false));
  }, [load, number, repo, rpc]);
  const showFiles = useCallback(() => {
    setTab("files");
    tabsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);
  const onSent = useCallback(
    (message: SentMessage, done: Promise<void>) => {
      setSent((current) => [...current, message]);
      done.then(
        () => {
          setSent((current) =>
            current.map((entry) =>
              entry.id === message.id ? { ...entry, status: "sent" } : entry,
            ),
          );
          if (message.to === "github") void load();
        },
        (failure: unknown) => {
          setSent((current) =>
            current.map((entry) =>
              entry.id === message.id ? { ...entry, status: "failed" } : entry,
            ),
          );
          toast.error("Couldn't send the message", {
            description: errorText(failure),
          });
        },
      );
    },
    [load],
  );

  useImperativeHandle(handle, () => ({
    run(kind: DetailRequestKind) {
      switch (kind) {
        case "merge":
          merge();
          break;
        case "agent":
          if (live && status !== null) startAgent(pullPreset(status));
          break;
        case "ready":
          if (subject.state === "DRAFT" && subject.viewerCanUpdate)
            control.change("open");
          break;
        case "status":
          setStatusRequest((value) => value + 1);
          break;
        case "snooze":
          if (live) setSnoozeOpen(true);
          break;
        case "thread":
          openThread();
          break;
        case "copy":
          if (headRefName !== null) copyBranch(headRefName, "branch name");
          break;
        case "open":
          navigate.openUrl(url);
          break;
      }
    },
  }));

  const chainNodes: StackNode[] | null =
    pull?.stack != null && pull.stack.entries.length > 1
      ? pull.stack.entries.map((entry) => ({
          number: entry.number,
          title: entry.title,
          state: entry.state,
          attention: entry.attention,
        }))
      : chainRows !== null && chainRows.length > 1
        ? chainRows.map((entry) => ({
            number: entry.item.number,
            title: entry.item.title,
            state: entry.pr.state,
            attention: entry.pr.attention,
          }))
        : null;
  const stackBase =
    pull?.stack?.baseRefName ??
    chainRows?.[0]?.pr.baseRefName ??
    baseRefName ??
    "";
  const snoozed = row?.item.snooze ?? null;
  const snoozeMenu = live ? (
    <DropdownMenu open={snoozeOpen} onOpenChange={setSnoozeOpen}>
      <TriggerTip label={snoozed === null ? "Snooze" : "Snoozed"} keys={["Z"]}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={`size-7 hover:text-foreground ${snoozed === null ? "text-muted-foreground" : "text-foreground"}`}
            aria-label={snoozed === null ? "Snooze" : "Snoozed"}
          >
            <Icon name="TimeSchedule" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </TriggerTip>
      <DropdownMenuContent
        align="end"
        className="w-60"
        mobileTitle={`Snooze #${number}`}
      >
        <DropdownMenuLabel>Snooze #{number}</DropdownMenuLabel>
        {snoozeOptions(new Date(), agent !== null).map((option) => (
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
        {snoozed === null ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onUnsnooze}>
              <Icon name="X" className="size-3.5 text-muted-foreground" />
              Unsnooze
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const checksCount =
    pull === null
      ? row === null
        ? null
        : row.pr.checks.passed + row.pr.checks.failed + row.pr.checks.pending
      : pull.checks.length;
  const filesCount = pull?.changedFiles ?? row?.pr.changedFiles ?? null;
  const tabs: Array<{ id: DetailTab; label: string; count: number | null }> = [
    { id: "activity", label: "Activity", count: null },
    { id: "files", label: "Files", count: filesCount },
    {
      id: "checks",
      label: "Checks",
      count: status?.state === "merged" ? null : checksCount,
    },
  ];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-3">
      <DetailBar
        number={number}
        repo={repo}
        issueKey={issueKey}
        issueUrl={issueUrl}
        headRefName={headRefName}
        url={url}
        backLabel={backLabel}
        split={split}
        snoozeMenu={snoozeMenu}
        onBack={onBack}
        onClose={compact ? null : onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={`${compact ? "px-4 pt-4 pb-10" : "px-8 pt-6 pb-14 @max-[35rem]/github:px-4 @max-[35rem]/github:pt-5 @max-[35rem]/github:pb-12"}`}
        >
          <div className="flex max-w-180 min-w-0 flex-col gap-6">
            {error !== null && pull === null && row === null ? (
              <div className="flex flex-col items-center gap-1 px-6 py-16 text-center">
                <Icon
                  name="CloudOff"
                  className="size-5 text-subtle-foreground/60"
                />
                <p className="mt-2 text-sm font-medium text-foreground">
                  Can't reach GitHub
                </p>
                <p className="max-w-72 text-xs text-subtle-foreground">
                  The pull request shows up as soon as the connection is back.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => void load()}
                >
                  Try again
                </Button>
              </div>
            ) : title === null ? (
              <DelayedLoading>
                <div className="flex flex-col gap-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
                  <DetailHeaderSkeleton />
                  <NextStepSkeleton />
                  <ActivitySkeleton />
                </div>
              </DelayedLoading>
            ) : (
              <>
                <header className="flex flex-col gap-2.5">
                  <h1
                    className={`font-semibold tracking-tight text-pretty text-foreground ${compact ? "text-base" : "text-lg"}`}
                  >
                    {(() => {
                      const parts = splitTitle(title);
                      return (
                        <>
                          {parts.prefix === null ? null : (
                            <span className="font-normal text-subtle-foreground">
                              {parts.prefix}{" "}
                            </span>
                          )}
                          {parts.text}{" "}
                          <span className="font-normal text-subtle-foreground">
                            #{number}
                          </span>
                        </>
                      );
                    })()}
                  </h1>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-subtle-foreground">
                    {pull === null ? (
                      <PullStateBadge state={subject.state} />
                    ) : (
                      <PullStateMenu
                        subject={subject}
                        control={
                          merging
                            ? {
                                ...control,
                                pendingLabel: "Merging…",
                                settling: true,
                              }
                            : control
                        }
                        openRequest={statusRequest}
                        merge={
                          pull.viewerCanMerge
                            ? { reason: mergeBlocked, onMerge: merge }
                            : null
                        }
                      />
                    )}
                    <span className="text-subtle-foreground/60">·</span>
                    {author === null ? null : (
                      <span className="inline-flex items-center gap-1.5">
                        <PullAuthor login={author} />
                        {author.startsWith("app/") ? author.slice(4) : author}
                      </span>
                    )}
                    {headRefName === null || baseRefName === null ? null : (
                      <>
                        <span className="text-subtle-foreground/60 @max-[35rem]/github:hidden">
                          ·
                        </span>
                        <span className="flex min-w-0 items-center gap-1 @max-[35rem]/github:basis-full">
                          <BranchCopyChip name={headRefName} />
                          <span className="shrink-0 font-mono whitespace-pre">
                            → {baseRefName}
                          </span>
                        </span>
                      </>
                    )}
                    {pull !== null || row !== null ? (
                      <>
                        <span className="text-subtle-foreground/60 @max-[35rem]/github:hidden">
                          ·
                        </span>
                        <PullDiffStat
                          pull={
                            pull ?? {
                              additions: row!.pr.additions,
                              deletions: row!.pr.deletions,
                              changedFiles: row!.pr.changedFiles,
                              files: [],
                            }
                          }
                          onShowFiles={showFiles}
                        />
                      </>
                    ) : null}
                  </div>
                </header>
                {status === null || pull === null ? (
                  error !== null ? (
                    <SectionError
                      message="Couldn't load the pull request"
                      onRetry={() => void load()}
                    />
                  ) : (
                    <DelayedLoading>
                      <NextStepSkeleton
                        failing={
                          row?.pr.checks.state === "failing"
                            ? row.pr.checks.failed
                            : 0
                        }
                      />
                    </DelayedLoading>
                  )
                ) : (
                  <NextStepCard
                    pull={pull}
                    status={status}
                    agent={agent}
                    follow={follow}
                    viewer={viewer}
                    merging={merging}
                    readyBusy={control.pendingLabel === "Marking ready…"}
                    rerunning={rerunning}
                    onFollow={setFollow}
                    onOpenThread={openThread}
                    onMerge={merge}
                    onAgent={(preset) => startAgent(preset)}
                    onReady={() => control.change("open")}
                    onReopen={() =>
                      control.change(pull.isDraft ? "draft" : "open")
                    }
                    onRerun={rerun}
                  />
                )}
                {agent?.state === "done" && live ? (
                  <AgentSection
                    agent={agent}
                    follow={follow}
                    onFollow={setFollow}
                    onOpenThread={openThread}
                  />
                ) : null}
                {live && chainNodes !== null ? (
                  <StackSection
                    current={number}
                    nodes={chainNodes}
                    base={stackBase}
                    onOpen={(target) => onOpenPull(repo, target)}
                    onRestack={() => {
                      const root = chainNodes[0];
                      if (root === undefined) return;
                      if (root.number === number) {
                        startAgent("restack");
                        return;
                      }
                      const rootRow = chainRows?.find(
                        (entry) => entry.item.number === root.number,
                      );
                      if (rootRow === undefined) {
                        onOpenPull(repo, root.number);
                        return;
                      }
                      onStartAgent({
                        repo,
                        number: root.number,
                        headRefName: rootRow.pr.headRefName,
                        isCrossRepository: rootRow.pr.isCrossRepository,
                        stacked: true,
                        preset: "restack",
                        prompt: null,
                      });
                    }}
                  />
                ) : null}
                {pull === null ? null : <Description body={pull.body} />}
                <div ref={tabsRef} className="scroll-mt-4">
                  <div
                    role="tablist"
                    aria-label="Pull request"
                    className="-ml-2 mb-1 flex items-center gap-0.5"
                  >
                    {tabs.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        role="tab"
                        id={`github-tab-${entry.id}`}
                        aria-controls={`github-tabpanel-${entry.id}`}
                        aria-selected={tab === entry.id}
                        tabIndex={tab === entry.id ? 0 : -1}
                        onClick={() => setTab(entry.id)}
                        onKeyDown={(event) => {
                          if (
                            event.key !== "ArrowRight" &&
                            event.key !== "ArrowLeft"
                          )
                            return;
                          event.preventDefault();
                          event.stopPropagation();
                          const at = tabs.findIndex((item) => item.id === tab);
                          const next =
                            tabs[
                              (at +
                                (event.key === "ArrowRight" ? 1 : -1) +
                                tabs.length) %
                                tabs.length
                            ];
                          if (next !== undefined) setTab(next.id);
                        }}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-subtle-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-selected:bg-state-active aria-selected:text-foreground"
                      >
                        {entry.label}
                        {entry.count === null ? null : (
                          <span className="text-xs font-normal tabular-nums">
                            {entry.count}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div
                    role="tabpanel"
                    id={`github-tabpanel-${tab}`}
                    aria-labelledby={`github-tab-${tab}`}
                  >
                    {pull === null ? (
                      error !== null ? (
                        <SectionError
                          message={
                            tab === "files"
                              ? "Couldn't load the changed files"
                              : tab === "checks"
                                ? "Couldn't load the checks"
                                : "Couldn't load the activity"
                          }
                          onRetry={() => void load()}
                        />
                      ) : (
                        <DelayedLoading>
                          <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
                            {tab === "files" ? (
                              <FilesSkeleton count={filesCount ?? 4} />
                            ) : tab === "checks" ? (
                              <ChecksSkeleton />
                            ) : (
                              <ActivitySkeleton />
                            )}
                          </div>
                        </DelayedLoading>
                      )
                    ) : tab === "files" ? (
                      <FilesTab
                        pull={pull}
                        environmentId={workspaceEnvironmentId}
                      />
                    ) : tab === "checks" ? (
                      <ChecksTab
                        pull={pull}
                        rerunning={rerunning}
                        onRerun={live ? rerun : null}
                      />
                    ) : (
                      <>
                        <ActivityTimeline
                          pull={pull}
                          agent={agent}
                          echoes={control.echoes}
                          sent={sent.filter(
                            (message) =>
                              message.to !== "github" ||
                              message.status !== "sent" ||
                              !pull.comments.some(
                                (comment) =>
                                  comment.body.trim() === message.text.trim(),
                              ),
                          )}
                          onResend={(message) => {
                            setSent((current) =>
                              current.filter(
                                (entry) => entry.id !== message.id,
                              ),
                            );
                            const done =
                              message.to === "github"
                                ? rpc
                                    .call("commentPull", {
                                      repo,
                                      number,
                                      body: message.text,
                                    })
                                    .then(() => undefined)
                                : Promise.reject(
                                    new Error("Open the thread to resend it."),
                                  );
                            onSent(
                              {
                                ...message,
                                id: Date.now(),
                                at: Date.now(),
                                status: "pending",
                              },
                              done,
                            );
                          }}
                        />
                        {agent?.state === "waiting" ? null : (
                          <ReplyBox
                            repo={repo}
                            number={number}
                            agent={agent}
                            onSent={onSent}
                            onNewAgent={(text) => startAgent("custom", text)}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
