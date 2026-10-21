import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  experimental_Diff as Diff,
  experimental_FileLink as FileLink,
  experimental_Icon as Icon,
  UrlLink,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  changeKind,
  groupPullEvents,
  linearLinkback,
  openedAsDraft,
  pullEventText,
  readingOrder,
  type PullEventEntry,
} from "../app-logic.js";
import { presetInfo } from "../agent-presets.js";
import type { githubRpcContract } from "../server.js";
import { Markdown } from "./markdown-lite.js";
import { formatDiffCount, type PullStateEcho } from "./pull-state.js";
import {
  AgentGlyph,
  Avatar,
  errorText,
  plural,
  relativeTime,
  TriggerTip,
  type AgentInfo,
  type PullCheck,
  type PullDetail,
  type PullFile,
  type ReviewThread,
} from "./shared.js";

export type DetailTab = "activity" | "files" | "checks";

export interface SentMessage {
  id: number;
  to: "github" | "agent";
  text: string;
  at: number;
  status: "pending" | "sent" | "failed";
}

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: "approved these changes",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "reviewed",
  DISMISSED: "had a review dismissed",
  PENDING: "started a review",
};

const ECHO_TEXT: Record<
  PullStateEcho,
  { icon: string; tone: string; text: string }
> = {
  draft: {
    icon: "GitPullRequestDraft",
    tone: "text-muted-foreground",
    text: "marked this pull request as draft",
  },
  ready: {
    icon: "GitPullRequestArrow",
    tone: "text-success",
    text: "marked this pull request as ready for review",
  },
  closed: {
    icon: "GitPullRequestClosed",
    tone: "text-destructive",
    text: "closed this pull request",
  },
  reopened: {
    icon: "GitPullRequestArrow",
    tone: "text-success",
    text: "reopened this pull request",
  },
};

const EVENT_ICON: Record<
  PullEventEntry["kind"],
  { icon: string; tone: string }
> = {
  ready: { icon: "GitPullRequestArrow", tone: "text-success" },
  draft: { icon: "GitPullRequestDraft", tone: "text-muted-foreground" },
  closed: { icon: "GitPullRequestClosed", tone: "text-destructive" },
  reopened: { icon: "GitPullRequestArrow", tone: "text-success" },
  merged: { icon: "GitMerge", tone: "text-pr-merged" },
  force_pushed: { icon: "GitBranch", tone: "text-muted-foreground" },
  commit: { icon: "GitBranch", tone: "text-muted-foreground" },
  base_changed: { icon: "GitBranch", tone: "text-muted-foreground" },
  head_deleted: { icon: "Trash2", tone: "text-muted-foreground" },
};

function EventLine({
  glyph,
  children,
  time,
  trailing,
}: {
  glyph: ReactNode;
  children: ReactNode;
  time: string | null;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-1 text-xs text-subtle-foreground">
      <span className="flex size-4 shrink-0 items-center justify-center">
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        {children}
        {time === null ? null : <span> · {time}</span>}
      </span>
      {trailing}
    </div>
  );
}

function Who({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>;
}

function Bubble({
  children,
  pending,
}: {
  children: ReactNode;
  pending?: boolean;
}) {
  return (
    <div
      className={`mt-1 mb-2.5 ml-3 rounded-lg border border-border px-3 py-2.5 text-sm ${pending === true ? "opacity-60" : ""}`}
    >
      {children}
    </div>
  );
}

function ReviewThreadCard({ thread }: { thread: ReviewThread }) {
  return (
    <div className="mt-1 mb-2.5 ml-3 overflow-hidden rounded-lg border border-border">
      <p className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{thread.path}</span>
        {thread.line !== null ? (
          <span className="shrink-0">:{thread.line}</span>
        ) : null}
      </p>
      {thread.diffHunk.length > 0 ? (
        <div className="border-b border-border">
          <Diff patch={thread.diffHunk} path={thread.path} />
        </div>
      ) : null}
      <div className="flex flex-col gap-3 p-3">
        {thread.comments.map((entry, index) => (
          <div key={index}>
            <p className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Avatar login={entry.author} size="size-4" />
              <Who>{entry.author}</Who> · {relativeTime(entry.createdAt)}
            </p>
            <Markdown content={entry.body} className="text-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

type TimelineEntry = { at: string; key: string; node: ReactNode };

export function ActivityTimeline({
  pull,
  agent,
  echoes,
  sent,
  onResend,
}: {
  pull: PullDetail;
  agent: AgentInfo | null;
  echoes: ReadonlyArray<{ kind: PullStateEcho; at: number }>;
  sent: readonly SentMessage[];
  onResend: (message: SentMessage) => void;
}) {
  const entries = useMemo(() => {
    const list: TimelineEntry[] = [];
    const asDraft = openedAsDraft(pull.events, pull.isDraft);
    list.push({
      at: pull.createdAt,
      key: "opened",
      node: (
        <EventLine
          glyph={
            <Icon
              name={asDraft ? "GitPullRequestDraft" : "GitPullRequest"}
              className="size-3.5 text-muted-foreground"
            />
          }
          time={relativeTime(pull.createdAt)}
        >
          <Who>{pull.author}</Who> opened this {asDraft ? "draft " : ""}
          pull request
        </EventLine>
      ),
    });
    for (const [index, event] of groupPullEvents(pull.events).entries()) {
      const icon = EVENT_ICON[event.kind];
      list.push({
        at: event.createdAt,
        key: `event:${index}`,
        node: (
          <EventLine
            glyph={
              <Icon name={icon.icon} className={`size-3.5 ${icon.tone}`} />
            }
            time={relativeTime(event.createdAt)}
          >
            <Who>{event.actor.length > 0 ? event.actor : "Someone"}</Who>{" "}
            {pullEventText(event)}
          </EventLine>
        ),
      });
    }
    const failed = pull.checks.filter((check) => check.status === "failure");
    if (failed.length > 0) {
      const latest = failed
        .map((check) => check.completedAt)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1);
      list.push({
        at: latest ?? pull.updatedAt,
        key: "checks",
        node: (
          <EventLine
            glyph={
              <Icon name="CircleX" className="size-3.5 text-destructive" />
            }
            time={latest === undefined ? null : relativeTime(latest)}
          >
            <Who>{plural(failed.length, "check")}</Who> failed on the latest
            commit
          </EventLine>
        ),
      });
    }
    if (agent !== null) {
      const at = new Date(
        agent.state === "running" ? agent.startedAt : agent.updatedAt,
      ).toISOString();
      list.push({
        at,
        key: "agent",
        node: (
          <EventLine
            glyph={<AgentGlyph providerId={agent.providerId} />}
            time={relativeTime(at)}
          >
            <Who>{agent.title}</Who>{" "}
            {agent.state === "running"
              ? "started"
              : agent.state === "waiting"
                ? "asked a question"
                : "finished"}
          </EventLine>
        ),
      });
    }
    for (const [index, comment] of pull.comments.entries()) {
      const linear = linearLinkback(comment.body);
      list.push({
        at: comment.createdAt,
        key: `comment:${index}`,
        node:
          linear !== null ? (
            <EventLine
              glyph={
                <Icon name="Link" className="size-3.5 text-muted-foreground" />
              }
              time={relativeTime(comment.createdAt)}
            >
              <Who>Linear</Who> linked <Who>{linear.key}</Who> {linear.title}
            </EventLine>
          ) : (
            <>
              <EventLine
                glyph={<Avatar login={comment.author} size="size-4" />}
                time={relativeTime(comment.createdAt)}
              >
                <Who>{comment.author}</Who> commented
              </EventLine>
              <Bubble>
                <Markdown content={comment.body} className="text-sm" />
              </Bubble>
            </>
          ),
      });
    }
    for (const [index, review] of pull.reviews.entries()) {
      if (review.body.length === 0 && review.state === "COMMENTED") continue;
      list.push({
        at: review.createdAt,
        key: `review:${index}`,
        node: (
          <>
            <EventLine
              glyph={<Avatar login={review.author} size="size-4" />}
              time={relativeTime(review.createdAt)}
            >
              <Who>{review.author}</Who>{" "}
              <span
                className={
                  review.state === "APPROVED"
                    ? "text-success"
                    : review.state === "CHANGES_REQUESTED"
                      ? "text-destructive"
                      : undefined
                }
              >
                {REVIEW_STATE_LABELS[review.state] ??
                  review.state.toLowerCase()}
              </span>
            </EventLine>
            {review.body.length > 0 ? (
              <Bubble>
                <Markdown content={review.body} className="text-sm" />
              </Bubble>
            ) : null}
          </>
        ),
      });
    }
    for (const [index, thread] of pull.reviewThreads.entries()) {
      const first = thread.comments[0];
      if (first === undefined) continue;
      list.push({
        at: first.createdAt,
        key: `thread:${index}`,
        node: (
          <>
            <EventLine
              glyph={<Avatar login={first.author} size="size-4" />}
              time={relativeTime(first.createdAt)}
            >
              <Who>{first.author}</Who> commented on{" "}
              <span className="font-mono">
                {thread.path}
                {thread.line === null ? "" : `:${thread.line}`}
              </span>
            </EventLine>
            <ReviewThreadCard thread={thread} />
          </>
        ),
      });
    }
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [agent, pull]);

  const local = [
    ...echoes.map((echo, index) => ({
      at: echo.at,
      key: `echo:${index}`,
      node: (
        <EventLine
          glyph={
            <Icon
              name={ECHO_TEXT[echo.kind].icon}
              className={`size-3.5 ${ECHO_TEXT[echo.kind].tone}`}
            />
          }
          time="just now"
        >
          <Who>You</Who> {ECHO_TEXT[echo.kind].text}
        </EventLine>
      ),
    })),
    ...sent.map((message) => ({
      at: message.at,
      key: `sent:${message.id}`,
      node: (
        <>
          <EventLine
            glyph={
              <Icon
                name="MessageSquare"
                className="size-3.5 text-muted-foreground"
              />
            }
            time={
              message.status === "pending"
                ? "sending…"
                : message.status === "failed"
                  ? "couldn't send"
                  : "just now"
            }
            trailing={
              message.status === "failed" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="-my-1 h-6 px-1.5 text-xs"
                  onClick={() => onResend(message)}
                >
                  Retry
                </Button>
              ) : null
            }
          >
            <Who>You</Who>{" "}
            {message.to === "agent" ? "messaged the agent" : "commented"}
          </EventLine>
          <Bubble pending={message.status !== "sent"}>
            <p className="whitespace-pre-wrap">{message.text}</p>
          </Bubble>
        </>
      ),
    })),
  ].sort((a, b) => a.at - b.at);

  return (
    <div className="flex flex-col pt-2">
      {entries.map((entry) => (
        <div key={entry.key}>{entry.node}</div>
      ))}
      {local.map((entry) => (
        <div
          key={entry.key}
          className="motion-safe:animate-in motion-safe:fade-in-0"
        >
          {entry.node}
        </div>
      ))}
    </div>
  );
}

export function ActivitySkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-1 pt-2">
      {[58, 42, 66].map((width) => (
        <div key={width} className="flex items-center gap-2 py-1">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-2.5" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}

export function SectionError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-3 text-xs text-subtle-foreground">
      <Icon name="AlertCircle" className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-xs"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}

export function ReplyBox({
  repo,
  number,
  agent,
  onSent,
  onNewAgent,
}: {
  repo: string;
  number: number;
  agent: AgentInfo | null;
  onSent: (message: SentMessage, done: Promise<void>) => void;
  onNewAgent: (text: string) => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const sdk = useSdk();
  const [text, setText] = useState("");
  const [to, setTo] = useState<"github" | "agent">("github");
  const send = useCallback(() => {
    const body = text.trim();
    if (body.length === 0) return;
    if (to === "agent" && agent === null) {
      onNewAgent(body);
      setText("");
      return;
    }
    const message: SentMessage = {
      id: Date.now(),
      to,
      text: body,
      at: Date.now(),
      status: "pending",
    };
    const done =
      to === "agent" && agent !== null
        ? sdk.threads
            .send({
              threadId: agent.threadId,
              input: [{ type: "text", text: body, mentions: [] }],
              mode: "queue-if-active",
            })
            .then(() => undefined)
        : rpc.call("commentPull", { repo, number, body }).then(() => undefined);
    onSent(message, done);
    setText("");
  }, [agent, number, onNewAgent, onSent, repo, rpc, sdk, text, to]);
  const toLabel =
    to === "agent"
      ? agent === null
        ? "To a new agent"
        : "To the agent"
      : "To GitHub";
  return (
    <div className="mt-3 rounded-xl border border-border py-2.5 pr-2 pl-4 shadow-xs">
      <textarea
        value={text}
        rows={2}
        aria-label="Reply"
        placeholder={
          to === "agent"
            ? agent === null
              ? "Ask an agent; it starts a thread on this branch"
              : "Message the agent working on this pull request"
            : "Leave a comment on GitHub"
        }
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
        className="block min-h-10 w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
      />
      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="-ml-2 h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
            >
              <Icon
                name={to === "agent" ? "Zap" : "Github"}
                className="size-3.5"
              />
              {toLabel}
              <Icon name="ChevronDown" className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            className="w-56"
            mobileTitle="Send to"
          >
            <DropdownMenuItem
              role="menuitemradio"
              aria-checked={to === "agent"}
              onSelect={() => setTo("agent")}
            >
              <Icon name="Zap" className="size-3.5 text-muted-foreground" />
              <span className="flex-1">
                {agent === null ? "To a new agent" : "To the agent"}
              </span>
              {to === "agent" ? (
                <Icon name="Check" className="size-3.5" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              role="menuitemradio"
              aria-checked={to === "github"}
              onSelect={() => setTo("github")}
            >
              <Icon name="Github" className="size-3.5 text-muted-foreground" />
              <span className="flex-1">To GitHub</span>
              {to === "github" ? (
                <Icon name="Check" className="size-3.5" />
              ) : null}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        <TriggerTip label="Send" keys={["⌘", "↵"]}>
          <Button
            type="button"
            size="icon"
            className="size-7"
            variant={text.trim().length > 0 ? "default" : "secondary"}
            disabled={text.trim().length === 0}
            aria-label="Send"
            aria-keyshortcuts="Meta+Enter Control+Enter"
            onClick={send}
          >
            <Icon name="ArrowUp" className="size-3.5" />
          </Button>
        </TriggerTip>
      </div>
    </div>
  );
}

function FileName({ path }: { path: string }) {
  const slash = path.lastIndexOf("/");
  return (
    <>
      {slash >= 0 ? (
        <span className="text-subtle-foreground">
          {path.slice(0, slash + 1)}
        </span>
      ) : null}
      <span>{path.slice(slash + 1)}</span>
    </>
  );
}

function FileRow({
  file,
  environmentId,
  url,
  defaultOpen,
}: {
  file: PullFile;
  environmentId: string | null;
  url: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const quiet = changeKind(file.path) !== "code";
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="flex h-8 items-center gap-2 pr-3 pl-2.5 text-xs">
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center rounded text-subtle-foreground hover:bg-state-hover hover:text-foreground"
          aria-label={`${open ? "Collapse" : "Expand"} ${file.path} diff`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon
            name="ChevronDown"
            className={`size-3 transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
          />
        </button>
        {environmentId === null || file.status === "removed" ? (
          <span
            className={`min-w-0 flex-1 truncate font-mono ${quiet ? "text-subtle-foreground" : "text-foreground"}`}
          >
            <FileName path={file.path} />
          </span>
        ) : (
          <FileLink
            className={`min-w-0 flex-1 truncate font-mono hover:underline ${quiet ? "text-subtle-foreground" : "text-foreground"}`}
            target={{ kind: "workspace", environmentId, path: file.path }}
          >
            <FileName path={file.path} />
          </FileLink>
        )}
        {file.status !== "modified" ? (
          <Badge
            variant="secondary"
            className="shrink-0 font-normal text-muted-foreground"
          >
            {file.status}
          </Badge>
        ) : null}
        <span className="flex shrink-0 gap-1.5 font-mono tabular-nums">
          <span className="text-diff-added">
            +{formatDiffCount(file.additions)}
          </span>
          <span className="text-diff-removed">
            -{formatDiffCount(file.deletions)}
          </span>
        </span>
      </div>
      {open ? (
        file.patch !== null ? (
          <div className="max-h-80 overflow-auto border-t border-border">
            <Diff patch={file.patch} path={file.path} />
          </div>
        ) : (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            Diff too large to show here.{" "}
            <UrlLink href={`${url}/files`} className="underline">
              View it on GitHub
            </UrlLink>
          </p>
        )
      ) : null}
    </div>
  );
}

export function FilesTab({
  pull,
  environmentId,
}: {
  pull: PullDetail;
  environmentId: string | null;
}) {
  const files = useMemo(() => readingOrder(pull.files), [pull.files]);
  if (files.length === 0) {
    return (
      <p className="py-3 text-xs text-subtle-foreground">
        {pull.changedFiles > 0
          ? `${plural(pull.changedFiles, "file")} changed; GitHub didn't list them.`
          : "No files changed."}
      </p>
    );
  }
  return (
    <div>
      <p className="flex items-center gap-1.5 pt-3 pb-2.5 text-xs text-subtle-foreground">
        Ordered for reading: the change first, tests last
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        {files.map((file, index) => (
          <FileRow
            key={file.path}
            file={file}
            environmentId={environmentId}
            url={pull.url}
            defaultOpen={index === 0 && file.patch !== null}
          />
        ))}
      </div>
    </div>
  );
}

export function FilesSkeleton({ count }: { count: number }) {
  return (
    <div aria-hidden>
      <div className="pt-3 pb-2.5">
        <Skeleton className="h-2.5 w-1/3" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        {Array.from({ length: Math.max(1, Math.min(count, 8)) }, (_, index) => (
          <div key={index} className="border-t border-border first:border-t-0">
            <div className="flex h-8 items-center gap-2 px-3">
              <Skeleton className="size-3 rounded-sm" />
              <Skeleton
                className="h-2.5"
                style={{ width: `${30 + ((index * 23) % 38)}%` }}
              />
              <span className="flex-1" />
              <Skeleton className="h-2.5 w-12" />
            </div>
            {index === 0 ? (
              <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2.5">
                {Array.from({ length: 12 }, (_, line) => (
                  <Skeleton
                    key={line}
                    className="h-2"
                    style={{ width: `${20 + ((line * 37) % 62)}%` }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function checkCounts(checks: readonly PullCheck[]): {
  passed: number;
  failed: number;
  pending: number;
} {
  return {
    passed: checks.filter(
      (check) => check.status === "success" || check.status === "neutral",
    ).length,
    failed: checks.filter((check) => check.status === "failure").length,
    pending: checks.filter((check) => check.status === "pending").length,
  };
}

export function ChecksBar({
  checks,
  className,
}: {
  checks: readonly PullCheck[];
  className?: string;
}) {
  const counts = checkCounts(checks);
  return (
    <div
      aria-hidden
      className={`flex h-1 gap-0.5 overflow-hidden rounded-full ${className ?? ""}`}
    >
      {counts.passed > 0 ? (
        <span
          className="block h-full bg-success transition-[flex-grow] duration-500 motion-reduce:transition-none"
          style={{ flexGrow: counts.passed }}
        />
      ) : null}
      {counts.pending > 0 ? (
        <span
          className="block h-full bg-warning transition-[flex-grow] duration-500 motion-reduce:transition-none"
          style={{ flexGrow: counts.pending }}
        />
      ) : null}
      {counts.failed > 0 ? (
        <span
          className="block h-full bg-destructive transition-[flex-grow] duration-500 motion-reduce:transition-none"
          style={{ flexGrow: counts.failed }}
        />
      ) : null}
    </div>
  );
}

export function ChecksTab({
  pull,
  rerunning,
  onRerun,
}: {
  pull: PullDetail;
  rerunning: boolean;
  onRerun: (() => void) | null;
}) {
  const [showPassed, setShowPassed] = useState(false);
  const counts = checkCounts(pull.checks);
  if (pull.checks.length === 0) {
    return (
      <p className="py-3 text-xs text-subtle-foreground">
        No checks have run on the latest commit.
      </p>
    );
  }
  const failed = pull.checks.filter((check) => check.status === "failure");
  const passed = pull.checks.filter(
    (check) => check.status === "success" || check.status === "neutral",
  );
  return (
    <div>
      <ChecksBar checks={pull.checks} className="my-3" />
      <div className="overflow-hidden rounded-lg border border-border">
        {failed.map((check) => (
          <div
            key={`${check.workflow ?? ""}/${check.name}`}
            className="flex h-9 items-center gap-2 border-t border-border pr-2 pl-3 text-xs text-subtle-foreground first:border-t-0"
          >
            <Icon
              name="CircleX"
              className="size-3.5 shrink-0 text-destructive"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-foreground">
              {check.name}
            </span>
            {check.required ? <span>Required</span> : null}
            <span>Failed</span>
            {check.url.length > 0 ? (
              <UrlLink
                href={check.url}
                className="inline-flex h-6 items-center gap-1 rounded px-1.5 hover:bg-state-hover hover:text-foreground"
              >
                Log
                <Icon name="ExternalLink" className="size-3" />
              </UrlLink>
            ) : null}
          </div>
        ))}
        {counts.pending > 0 ? (
          <div className="flex h-9 items-center gap-2 border-t border-border pr-2 pl-3 text-xs text-subtle-foreground first:border-t-0">
            <Icon name="Clock" className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-foreground">
              <span className="animate-shine">
                {plural(counts.pending, "check")} running
              </span>
            </span>
          </div>
        ) : null}
        {passed.length > 0 ? (
          <>
            <button
              type="button"
              aria-expanded={showPassed}
              onClick={() => setShowPassed((value) => !value)}
              className="flex h-9 w-full items-center gap-2 border-t border-border pr-2 pl-3 text-left text-xs text-subtle-foreground first:border-t-0 hover:bg-state-hover"
            >
              <Icon
                name="CircleCheck"
                className="size-3.5 shrink-0 text-success"
              />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {plural(passed.length, "check")} passed
              </span>
              <Icon
                name="ChevronDown"
                className={`size-3 transition-transform motion-reduce:transition-none ${showPassed ? "" : "-rotate-90"}`}
              />
            </button>
            {showPassed
              ? passed.map((check) => (
                  <div
                    key={`${check.workflow ?? ""}/${check.name}`}
                    className="flex h-8 items-center gap-2 border-t border-border pr-2 pl-8 text-xs text-subtle-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {check.name}
                    </span>
                    {check.url.length > 0 ? (
                      <UrlLink
                        href={check.url}
                        className="inline-flex h-6 items-center gap-1 rounded px-1.5 hover:bg-state-hover hover:text-foreground"
                      >
                        Details
                        <Icon name="ExternalLink" className="size-3" />
                      </UrlLink>
                    ) : null}
                  </div>
                ))
              : null}
          </>
        ) : null}
      </div>
      {onRerun !== null && failed.length > 0 ? (
        <div className="pt-3">
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
        </div>
      ) : null}
    </div>
  );
}

export function ChecksSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="my-3 h-1 w-full rounded-full" />
      <div className="overflow-hidden rounded-lg border border-border">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="flex h-9 items-center gap-2 border-t border-border px-3 first:border-t-0"
          >
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton
              className="h-2.5"
              style={{ width: `${30 + index * 14}%` }}
            />
            <span className="flex-1" />
            <Skeleton className="h-2.5 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function useSendLog(): (agent: AgentInfo, pull: PullDetail) => void {
  const sdk = useSdk();
  return useCallback(
    (agent, pull) => {
      const failed = pull.checks.filter((check) => check.status === "failure");
      const runs = [
        ...new Set(
          failed.flatMap((check) =>
            check.runId === null ? [] : [check.runId],
          ),
        ),
      ];
      const text = [
        `${plural(failed.length, "check")} failing on ${pull.repo}#${pull.number}:`,
        ...failed.map((check) => {
          const note = check.annotations[0];
          return `- ${check.name}${note === undefined ? "" : `: ${note.message}`}`;
        }),
        ...runs.map(
          (run) => `Logs: \`gh run view ${run} -R ${pull.repo} --log-failed\``,
        ),
      ].join("\n");
      sdk.threads
        .send({
          threadId: agent.threadId,
          input: [{ type: "text", text, mentions: [] }],
          mode: "queue-if-active",
        })
        .then(
          () =>
            toast.success("Failing log sent to the agent", {
              description: presetInfo(agent.preset ?? "custom").label,
            }),
          (error: unknown) =>
            toast.error("Couldn't send the log to the agent", {
              description: errorText(error),
            }),
        );
    },
    [sdk],
  );
}
