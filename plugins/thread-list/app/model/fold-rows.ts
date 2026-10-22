import {
  getProjectThreadItemDescendants,
  type ProjectThreadItem,
} from "./project-thread-groups.js";
import type { SidebarThread } from "./sidebar-thread.js";
import {
  threadIndicatorKind,
  threadListIndicatorRung,
} from "./thread-activity.js";

export const FOLD_VISIBLE_CHILD_ROWS = 5;
export const FOLD_MIN_HIDDEN_ROWS = 5;
export const FOLD_OLDER_IDLE_MS = 7 * 86_400_000;

export type FoldKind = "more" | "older";

export interface FoldInputs {
  versionOf: (thread: SidebarThread) => SidebarThread;
  draftThreadIds: ReadonlySet<string>;
  heldThreadIds: ReadonlySet<string>;
  keepThreadId: string | undefined;
  now: number;
}

export interface FoldPlan {
  visible: readonly ProjectThreadItem[];
  hidden: readonly ProjectThreadItem[];
}

function isSettledThread(thread: SidebarThread, inputs: FoldInputs): boolean {
  return (
    thread.id !== inputs.keepThreadId &&
    !inputs.draftThreadIds.has(thread.id) &&
    threadListIndicatorRung(threadIndicatorKind(inputs.versionOf(thread))) === 0
  );
}

function itemThreads(item: ProjectThreadItem): SidebarThread[] {
  return getProjectThreadItemDescendants([item]);
}

function isSettledItem(item: ProjectThreadItem, inputs: FoldInputs): boolean {
  return (
    item.kind !== "section" &&
    itemThreads(item).every((thread) => isSettledThread(thread, inputs))
  );
}

function isIdleItem(item: ProjectThreadItem, inputs: FoldInputs): boolean {
  const idleBefore = inputs.now - FOLD_OLDER_IDLE_MS;
  return itemThreads(item).every(
    (thread) => inputs.versionOf(thread).updatedAt <= idleBefore,
  );
}

function isHeldItem(item: ProjectThreadItem, inputs: FoldInputs): boolean {
  return itemThreads(item).some((thread) =>
    inputs.heldThreadIds.has(thread.id),
  );
}

function plan(
  items: readonly ProjectThreadItem[],
  inputs: FoldInputs,
  folds: (item: ProjectThreadItem, index: number) => boolean,
): FoldPlan {
  const folded = items.filter((item, index) => folds(item, index));
  if (folded.length < FOLD_MIN_HIDDEN_ROWS) {
    return { visible: items, hidden: [] };
  }
  const hidden = new Set(folded.filter((item) => !isHeldItem(item, inputs)));
  return hidden.size === 0
    ? { visible: items, hidden: [] }
    : {
        visible: items.filter((item) => !hidden.has(item)),
        hidden: [...hidden],
      };
}

export function planFold(
  kind: FoldKind,
  items: readonly ProjectThreadItem[],
  inputs: FoldInputs,
): FoldPlan {
  if (kind === "more") {
    return plan(
      items,
      inputs,
      (item, index) =>
        index >= FOLD_VISIBLE_CHILD_ROWS && isSettledItem(item, inputs),
    );
  }
  return plan(
    items,
    inputs,
    (item) =>
      item.kind === "thread" &&
      isSettledItem(item, inputs) &&
      isIdleItem(item, inputs),
  );
}

export function foldRowLabel(
  kind: FoldKind,
  hiddenCount: number,
  open: boolean,
): string {
  if (open) return "Show fewer";
  return kind === "more"
    ? `Show ${hiddenCount} more`
    : `Show ${hiddenCount} older`;
}
