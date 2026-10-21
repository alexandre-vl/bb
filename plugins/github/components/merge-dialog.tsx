import { useCallback, useState } from "react";
import { useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { middleTruncate } from "../app-logic.js";
import type { githubRpcContract } from "../server.js";
import {
  errorText,
  plural,
  useRepoSettings,
  type MergeMethod,
  type RepoSettings,
} from "./shared.js";

export interface MergeTarget {
  repo: string;
  number: number;
  baseRefName: string;
  headRefName: string;
  headRefOid: string | null;
  isCrossRepository: boolean;
  summary: string;
  canDeleteBranch: boolean;
  environmentId: string | null;
}

const METHOD_ORDER: MergeMethod[] = ["squash", "merge", "rebase"];

const METHOD_LABEL: Record<MergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

const METHOD_DONE: Record<MergeMethod, string> = {
  squash: "Squash-merged",
  merge: "Merged",
  rebase: "Rebased and merged",
};

function methodHint(method: MergeMethod, base: string): string {
  switch (method) {
    case "squash":
      return `One commit on ${base}`;
    case "merge":
      return "Keeps every commit";
    case "rebase":
      return `Replays the commits on ${base}`;
  }
}

const FALLBACK_SETTINGS: RepoSettings = {
  viewerCanWrite: true,
  mergeMethods: ["squash", "merge", "rebase"],
  defaultMergeMethod: "squash",
  deleteBranchOnMerge: false,
};

export function useMerge(): {
  merging: ReadonlySet<string>;
  merge: (
    target: MergeTarget,
    method: MergeMethod,
    deleteBranch: boolean,
  ) => void;
  mergeAll: (
    targets: ReadonlyArray<{ target: MergeTarget; method: MergeMethod }>,
  ) => void;
} {
  const rpc = useRpc<typeof githubRpcContract>();
  const sdk = useSdk();
  const [merging, setMerging] = useState<ReadonlySet<string>>(new Set());
  const run = useCallback(
    (
      target: MergeTarget,
      method: MergeMethod,
      deleteBranch: boolean,
    ): Promise<{ method: MergeMethod; deletedBranch: boolean }> => {
      const key = `${target.repo}#${target.number}`;
      setMerging((current) => new Set([...current, key]));
      const request: Promise<{ method: MergeMethod; deletedBranch: boolean }> =
        target.environmentId !== null
          ? sdk.environments
              .mergePullRequest({
                environmentId: target.environmentId,
                method,
              })
              .then(() => rpc.call("refresh"))
              .then(() => ({ method, deletedBranch: false }))
          : rpc.call("mergePull", {
              repo: target.repo,
              number: target.number,
              method,
              deleteBranch,
              headRefOid: target.headRefOid,
            });
      return request.finally(() =>
        setMerging((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        }),
      );
    },
    [rpc, sdk],
  );
  const merge = useCallback(
    (target: MergeTarget, method: MergeMethod, deleteBranch: boolean) => {
      const id = toast.loading(
        `Merging #${target.number} into ${target.baseRefName}…`,
      );
      run(target, method, deleteBranch).then(
        (result) =>
          toast.success(
            `${METHOD_DONE[result.method]} #${target.number} into ${target.baseRefName}${result.deletedBranch ? ", branch deleted" : ""}`,
            { id },
          ),
        (error: unknown) =>
          toast.error(`Couldn't merge #${target.number}`, {
            id,
            description: errorText(error),
          }),
      );
    },
    [run],
  );
  const mergeAll = useCallback(
    (targets: ReadonlyArray<{ target: MergeTarget; method: MergeMethod }>) => {
      const id = toast.loading(
        `Merging ${plural(targets.length, "pull request")}…`,
      );
      void Promise.allSettled(
        targets.map(({ target, method }) => run(target, method, false)),
      ).then((results) => {
        const failures = results.flatMap((result, index) => {
          const target = targets[index]?.target;
          return result.status === "rejected" && target !== undefined
            ? [`#${target.number}: ${errorText(result.reason)}`]
            : [];
        });
        if (failures.length === 0) {
          toast.success(`${plural(targets.length, "pull request")} merged`, {
            id,
          });
          return;
        }
        toast.error(
          `Merged ${targets.length - failures.length} of ${targets.length}`,
          { id, description: failures.join("\n") },
        );
      });
    },
    [run],
  );
  return { merging, merge, mergeAll };
}

export function MergeDialog({
  target,
  onOpenChange,
  onConfirm,
}: {
  target: MergeTarget | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (
    target: MergeTarget,
    method: MergeMethod,
    deleteBranch: boolean,
  ) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {target === null ? null : (
          <MergeForm
            key={`${target.repo}#${target.number}`}
            target={target}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MergeForm({
  target,
  onCancel,
  onConfirm,
}: {
  target: MergeTarget;
  onCancel: () => void;
  onConfirm: (
    target: MergeTarget,
    method: MergeMethod,
    deleteBranch: boolean,
  ) => void;
}) {
  const settings = useRepoSettings()[target.repo] ?? FALLBACK_SETTINGS;
  const methods = METHOD_ORDER.filter((method) =>
    settings.mergeMethods.includes(method),
  );
  const [method, setMethod] = useState<MergeMethod>(
    methods.includes(settings.defaultMergeMethod)
      ? settings.defaultMergeMethod
      : (methods[0] ?? "squash"),
  );
  const [deleteBranch, setDeleteBranch] = useState(true);
  const branch = middleTruncate(target.headRefName, 44);
  const branchNote =
    target.environmentId !== null
      ? `A bb worktree holds ${branch}, so the branch is kept.`
      : target.isCrossRepository
        ? `${branch} lives in a fork and is kept.`
        : settings.deleteBranchOnMerge
          ? `GitHub deletes ${branch} after the merge.`
          : null;
  const offerDelete =
    branchNote === null && target.canDeleteBranch && !target.isCrossRepository;
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm(target, method, offerDelete && deleteBranch);
      }}
    >
      <DialogHeader>
        <DialogTitle>
          Merge #{target.number} into {target.baseRefName}
        </DialogTitle>
        <DialogDescription>{target.summary}</DialogDescription>
      </DialogHeader>
      {methods.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {target.repo} allows no merge method you can use.
        </p>
      ) : (
        <RadioGroup
          value={method}
          onValueChange={(value) => {
            const next = METHOD_ORDER.find((entry) => entry === value);
            if (next !== undefined) setMethod(next);
          }}
          aria-label="Merge method"
          className="gap-1"
        >
          {methods.map((entry) => (
            <label
              key={entry}
              className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-state-hover has-[[data-state=checked]]:bg-state-active"
            >
              <RadioGroupItem value={entry} className="mt-0.5" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground">
                  {METHOD_LABEL[entry]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {methodHint(entry, target.baseRefName)}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      )}
      {offerDelete ? (
        <label className="flex cursor-pointer items-center gap-2 px-2 text-sm text-foreground">
          <Checkbox
            checked={deleteBranch}
            onCheckedChange={(checked) => setDeleteBranch(checked === true)}
          />
          <span className="min-w-0 truncate">
            Delete <span className="font-mono">{branch}</span>
          </span>
        </label>
      ) : branchNote !== null ? (
        <p className="px-2 text-xs text-muted-foreground">{branchNote}</p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={methods.length === 0} autoFocus>
          {METHOD_LABEL[method]}
        </Button>
      </DialogFooter>
    </form>
  );
}
