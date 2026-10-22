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
    !inputs.heldThreadIds.has(thread.id) &&
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

function plan(
  items: readonly ProjectThreadItem[],
  folds: (item: ProjectThreadItem, index: number) => boolean,
): FoldPlan {
  const visible: ProjectThreadItem[] = [];
  const hidden: ProjectThreadItem[] = [];
  items.forEach((item, index) => {
    (folds(item, index) ? hidden : visible).push(item);
  });
  return hidden.length < FOLD_MIN_HIDDEN_ROWS
    ? { visible: items, hidden: [] }
    : { visible, hidden };
}

export function planFold(
  kind: FoldKind,
  items: readonly ProjectThreadItem[],
  inputs: FoldInputs,
): FoldPlan {
  if (kind === "more") {
    return plan(
      items,
      (item, index) =>
        index >= FOLD_VISIBLE_CHILD_ROWS && isSettledItem(item, inputs),
    );
  }
  return plan(
    items,
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
