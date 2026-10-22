import type { SidebarThread } from "./sidebar-thread.js";
import type {
  ProjectThreadItem,
  ThreadComparator,
} from "./project-thread-groups.js";
import { threadAttentionRung, type ThreadListRung } from "./thread-activity.js";

export type ThreadAttentionRungResolver = (
  thread: SidebarThread,
) => ThreadListRung;

export function buildSubtreeAttentionRungs(
  threads: readonly SidebarThread[],
  ownRung: (thread: SidebarThread) => ThreadListRung = threadAttentionRung,
): Map<string, ThreadListRung> {
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const rungs = new Map<string, ThreadListRung>();
  for (const thread of threads) {
    const rung = ownRung(thread);
    if (rung === 0) continue;
    const visited = new Set<string>();
    let current: SidebarThread | undefined = thread;
    while (current !== undefined && !visited.has(current.id)) {
      visited.add(current.id);
      rungs.set(current.id, maxRung(rungs.get(current.id) ?? 0, rung));
      current =
        current.parentThreadId === null
          ? undefined
          : threadById.get(current.parentThreadId);
    }
  }
  return rungs;
}

function maxRung(left: ThreadListRung, right: ThreadListRung): ThreadListRung {
  return left >= right ? left : right;
}

function itemAttentionRung(
  item: ProjectThreadItem,
  rungOf: ThreadAttentionRungResolver,
): ThreadListRung {
  switch (item.kind) {
    case "thread":
      return rungOf(item.node.thread);
    case "environment":
      return item.group.nodes.reduce<ThreadListRung>(
        (best, node) => maxRung(best, rungOf(node.thread)),
        0,
      );
    case "section":
      return 0;
  }
}

function versionItem(
  item: ProjectThreadItem,
  versionOf: (thread: SidebarThread) => SidebarThread,
): ProjectThreadItem {
  switch (item.kind) {
    case "thread": {
      const thread = versionOf(item.node.thread);
      return thread === item.node.thread
        ? item
        : { kind: "thread", node: { ...item.node, thread } };
    }
    case "environment": {
      const [first, second, ...rest] = item.group.nodes;
      const thread = versionOf(first.thread);
      return thread === first.thread
        ? item
        : {
            kind: "environment",
            group: {
              ...item.group,
              nodes: [{ ...first, thread }, second, ...rest],
            },
          };
    }
    case "section":
      return item;
  }
}

export function compareOrderVersions(
  compareThreads: ThreadComparator,
  versionOf: (thread: SidebarThread) => SidebarThread,
): ThreadComparator {
  const versioned: ThreadComparator = (left, right) =>
    compareThreads(versionOf(left), versionOf(right));
  const compareItems = compareThreads.compareItems;
  if (compareItems) {
    versioned.compareItems = (left, right) =>
      compareItems(versionItem(left, versionOf), versionItem(right, versionOf));
  }
  return versioned;
}

export function orderComparatorByAttention(
  compareThreads: ThreadComparator,
  rungOf: ThreadAttentionRungResolver,
): ThreadComparator {
  const ordered: ThreadComparator = (left, right) =>
    rungOf(right) - rungOf(left) || compareThreads(left, right);
  const compareItems = compareThreads.compareItems;
  if (compareItems) {
    ordered.compareItems = (left, right) =>
      itemAttentionRung(right, rungOf) - itemAttentionRung(left, rungOf) ||
      compareItems(left, right);
  }
  return ordered;
}
