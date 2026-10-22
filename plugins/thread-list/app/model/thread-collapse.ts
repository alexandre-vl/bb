import type { SidebarThread } from "./sidebar-thread.js";

export function collapsedParentIds(
  threads: readonly Pick<SidebarThread, "parentThreadId">[],
  expandedThreadIds: readonly string[],
): Set<string> {
  const expanded = new Set(expandedThreadIds);
  const collapsed = new Set<string>();
  for (const thread of threads) {
    if (
      thread.parentThreadId !== null &&
      !expanded.has(thread.parentThreadId)
    ) {
      collapsed.add(thread.parentThreadId);
    }
  }
  return collapsed;
}

export function toggleThreadId(
  ids: readonly string[],
  id: string,
): string[] {
  return ids.includes(id)
    ? ids.filter((current) => current !== id)
    : [...ids, id];
}
