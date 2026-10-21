import { useCallback, useEffect, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreads,
  useBbNavigate,
  useRpc,
  useSdk,
  type NewThreadComposerProps,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_PRESETS } from "../agent-presets.js";
import { middleTruncate } from "../app-logic.js";
import type { AgentPreset } from "../pull-status.js";
import type { githubRpcContract } from "../server.js";
import {
  errorText,
  useBranchEnvironment,
  useProjectHost,
  useStatus,
} from "./shared.js";

export interface AgentTarget {
  repo: string;
  number: number;
  headRefName: string;
  isCrossRepository: boolean;
  stacked: boolean;
  preset: AgentPreset;
  prompt: string | null;
}

type BranchCheckout = "same-branch" | "new-branch" | "checkout";

interface Placement {
  ready: boolean;
  projectId: string | null;
  environment: NewThreadComposerProps["defaultEnvironment"];
  branchCheckout: BranchCheckout;
}

function usePlacement(target: AgentTarget): Placement {
  const { status } = useStatus();
  const sidebar = experimental_useSidebarThreads();
  const findEnvironment = useBranchEnvironment();
  const hostOf = useProjectHost();
  const ready = status !== null && sidebar.status !== "loading";
  const projectId =
    status?.repos.find((entry) => entry.repo === target.repo)?.projectId ??
    null;
  const reuse = target.isCrossRepository
    ? null
    : findEnvironment(target.headRefName, projectId);
  if (reuse !== null) {
    return {
      ready,
      projectId,
      environment: { type: "reuse", environmentId: reuse.environmentId },
      branchCheckout: "same-branch",
    };
  }
  const hostId = hostOf(projectId);
  if (!target.isCrossRepository && hostId !== null) {
    return {
      ready,
      projectId,
      environment: {
        type: "host",
        hostId,
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "named", name: `origin/${target.headRefName}` },
        },
      },
      branchCheckout: "new-branch",
    };
  }
  return {
    ready,
    projectId,
    environment: undefined,
    branchCheckout: "checkout",
  };
}

function placementLine(
  target: AgentTarget,
  placement: Placement,
  launching: boolean,
): string {
  const branch = middleTruncate(target.headRefName, 32);
  if (launching) {
    return placement.branchCheckout === "new-branch"
      ? `Creating the worktree on ${branch}…`
      : `Starting the agent on ${branch}…`;
  }
  switch (placement.branchCheckout) {
    case "same-branch":
      return `On #${target.number}, in the bb worktree that holds ${branch}`;
    case "new-branch":
      return `On #${target.number}, in its own worktree on ${branch}`;
    case "checkout":
      return `On #${target.number}; the agent checks out ${branch} first`;
  }
}

export function AgentSheet({
  target,
  onOpenChange,
}: {
  target: AgentTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-3">
        {target === null ? null : (
          <AgentSheetBody
            key={`${target.repo}#${target.number}`}
            target={target}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const promptCache = new Map<string, { prompt: string; title: string }>();

function AgentSheetBody({
  target,
  onDone,
}: {
  target: AgentTarget;
  onDone: () => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const placement = usePlacement(target);
  const [preset, setPreset] = useState<AgentPreset>(target.preset);
  const [launching, setLaunching] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cacheKey = `${target.repo}#${target.number}:${preset}:${placement.branchCheckout}`;
  const [fetched, setFetched] = useState<{
    key: string;
    prompt: string;
    title: string;
  } | null>(null);
  const [failed, setFailed] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const cached = promptCache.get(cacheKey);
  const seed =
    cached !== undefined
      ? { key: cacheKey, ...cached }
      : fetched?.key === cacheKey
        ? fetched
        : null;
  const error = failed?.key === cacheKey ? failed.message : null;
  const seedTitle = seed?.title ?? null;

  useEffect(() => {
    if (!placement.ready || promptCache.has(cacheKey)) return;
    let cancelled = false;
    rpc
      .call("agentPrompt", {
        repo: target.repo,
        number: target.number,
        preset,
        branchCheckout: placement.branchCheckout,
      })
      .then(
        (result) => {
          promptCache.set(cacheKey, result);
          if (!cancelled) setFetched({ key: cacheKey, ...result });
        },
        (failure: unknown) => {
          if (!cancelled)
            setFailed({ key: cacheKey, message: errorText(failure) });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [
    attempt,
    cacheKey,
    placement.branchCheckout,
    placement.ready,
    preset,
    rpc,
    target.number,
    target.repo,
  ]);

  const submit = useCallback(
    async (request: NewThreadRequest) => {
      if (seedTitle === null) return;
      setLaunching(true);
      let threadId: string;
      try {
        const thread = await sdk.threads.spawn({
          ...request,
          title: seedTitle,
          pluginMetadata: {
            pullRequest: {
              repo: target.repo,
              number: target.number,
              preset,
            },
          },
        });
        threadId = thread.id;
      } catch (failure) {
        setLaunching(false);
        toast.error(`Couldn't start an agent on #${target.number}`, {
          description: errorText(failure),
        });
        throw failure;
      }
      try {
        await rpc.call("linkThread", {
          kind: "pr",
          repo: target.repo,
          number: target.number,
          threadId,
          preset,
        });
        toast.success(`Agent started on #${target.number}`, {
          description: "Its thread is linked to the pull request.",
          action: {
            label: "Open",
            onClick: () => navigate.toThread(threadId),
          },
        });
      } catch (failure) {
        toast.warning(`Agent started, but #${target.number} isn't linked`, {
          description: errorText(failure),
        });
      }
      setLaunching(false);
      onDone();
    },
    [navigate, onDone, preset, rpc, sdk, seedTitle, target.number, target.repo],
  );

  const presets = AGENT_PRESETS.filter(
    (entry) => entry.id !== "restack" || target.stacked,
  );
  const draftKey = `github:${target.repo}#${target.number}:${preset}${target.prompt === null ? "" : ":reply"}`;
  const initialPrompt =
    seed === null
      ? undefined
      : target.prompt !== null && preset === target.preset
        ? `${seed.prompt}${target.prompt}`
        : seed.prompt;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Start an agent</DialogTitle>
        <DialogDescription
          className={launching ? "animate-shine" : undefined}
          aria-live="polite"
        >
          {placementLine(target, placement, launching)}
        </DialogDescription>
      </DialogHeader>
      <div
        role="radiogroup"
        aria-label="What the agent should do"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
      >
        {presets.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={preset === entry.id}
            disabled={launching}
            onClick={() => setPreset(entry.id)}
            className="h-6 shrink-0 rounded px-2 text-xs whitespace-nowrap text-foreground outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 aria-checked:bg-state-active"
          >
            {entry.label}
          </button>
        ))}
      </div>
      {error !== null ? (
        <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1">
            Couldn't prepare the prompt: {error}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setFailed(null);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : !placement.ready || seed === null ? (
        <DelayedLoading>
          <div
            aria-hidden
            className="flex flex-col gap-2 rounded-xl border border-border p-4"
          >
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-2/5" />
            <div className="flex justify-between pt-6">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="size-7 rounded-full" />
            </div>
          </div>
        </DelayedLoading>
      ) : (
        <NewThreadComposer
          key={draftKey}
          {...(placement.projectId === null
            ? {}
            : { defaultProjectId: placement.projectId })}
          {...(placement.environment === undefined
            ? {}
            : { defaultEnvironment: placement.environment })}
          {...(initialPrompt === undefined ? {} : { initialPrompt })}
          draftKey={draftKey}
          layout="document"
          focusRequest={1}
          className="min-h-40"
          onSubmit={submit}
        />
      )}
    </>
  );
}
