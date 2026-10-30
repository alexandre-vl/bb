import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type { ThreadComparator } from "../model/project-thread-groups.js";
import type { ThreadListRung } from "../model/thread-activity.js";
import {
  buildSubtreeAttentionRungs,
  compareOrderVersions,
  heldAttentionRung,
  orderComparatorByAttention,
  rememberHeldOpenRung,
  resolveHeldOpenRung,
  restoreHeldOpenRung,
  type HeldOpenRung,
} from "../model/attention-ordering.js";
import type { SidebarThreadVersionOf } from "./stability/SidebarOrderStability.js";
import {
  collapsedParentIds,
  toggleThreadId,
} from "../model/thread-collapse.js";
import {
  collapsedThreadIdsAtom,
  expandedThreadIdsAtom,
  sidebarAttentionFirstAtom,
  sidebarParentsStartCollapsedAtom,
} from "../preferences/atoms.js";

function useHeldOpenRung(
  threads: readonly SidebarThread[],
  selectedThreadId: string | undefined,
): HeldOpenRung | null {
  const [held, setHeld] = useState<HeldOpenRung | null>(() =>
    restoreHeldOpenRung(selectedThreadId),
  );
  const next = resolveHeldOpenRung(held, threads, selectedThreadId);
  if (next !== held) {
    setHeld(next);
  }
  useEffect(() => {
    rememberHeldOpenRung(held);
  }, [held]);
  return next;
}

function haveSameRungs(
  left: ReadonlyMap<string, ThreadListRung> | null,
  right: ReadonlyMap<string, ThreadListRung> | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null || left.size !== right.size) {
    return false;
  }
  for (const [threadId, rung] of left) {
    if (right.get(threadId) !== rung) return false;
  }
  return true;
}

function useStableRungs(
  rungs: ReadonlyMap<string, ThreadListRung> | null,
): ReadonlyMap<string, ThreadListRung> | null {
  const rungsRef = useRef(rungs);
  if (!haveSameRungs(rungsRef.current, rungs)) {
    rungsRef.current = rungs;
  }
  return rungsRef.current;
}

export function useAttentionOrdering({
  threads,
  selectedThreadId,
  comparator,
  versionOf,
}: {
  threads: readonly SidebarThread[];
  selectedThreadId: string | undefined;
  comparator: ThreadComparator;
  versionOf: SidebarThreadVersionOf;
}) {
  const attentionFirst = useAtomValue(sidebarAttentionFirstAtom);
  const parentsStartCollapsed = useAtomValue(sidebarParentsStartCollapsedAtom);
  const heldOpenRung = useHeldOpenRung(threads, selectedThreadId);
  const [collapsedThreadIdList, setCollapsedThreadIdList] = useAtom(
    collapsedThreadIdsAtom,
  );
  const [expandedThreadIdList, setExpandedThreadIdList] = useAtom(
    expandedThreadIdsAtom,
  );
  const subtreeRungs = useStableRungs(
    useMemo(
      () =>
        attentionFirst
          ? buildSubtreeAttentionRungs(
              threads,
              heldAttentionRung(heldOpenRung, versionOf),
            )
          : null,
      [attentionFirst, heldOpenRung, threads, versionOf],
    ),
  );
  const versionedComparator = useMemo(
    () => compareOrderVersions(comparator, versionOf),
    [comparator, versionOf],
  );
  const orderedComparator = useMemo(
    () =>
      subtreeRungs === null
        ? versionedComparator
        : orderComparatorByAttention(
            versionedComparator,
            (thread) => subtreeRungs.get(thread.id) ?? 0,
          ),
    [versionedComparator, subtreeRungs],
  );
  const collapsedThreadIds = useMemo(
    () =>
      parentsStartCollapsed
        ? collapsedParentIds(threads, expandedThreadIdList)
        : new Set(collapsedThreadIdList),
    [
      collapsedThreadIdList,
      expandedThreadIdList,
      parentsStartCollapsed,
      threads,
    ],
  );
  const toggleThreadCollapsed = useCallback(
    (threadId: string) => {
      if (parentsStartCollapsed) {
        setExpandedThreadIdList((current) => toggleThreadId(current, threadId));
      } else {
        setCollapsedThreadIdList((current) =>
          toggleThreadId(current, threadId),
        );
      }
    },
    [parentsStartCollapsed, setCollapsedThreadIdList, setExpandedThreadIdList],
  );
  return {
    comparator: orderedComparator,
    collapsedThreadIds,
    subtreeRungs,
    toggleThreadCollapsed,
  };
}

export function useExpandThreadAncestors() {
  const parentsStartCollapsed = useAtomValue(sidebarParentsStartCollapsedAtom);
  const setCollapsedThreadIdList = useSetAtom(collapsedThreadIdsAtom);
  const setExpandedThreadIdList = useSetAtom(expandedThreadIdsAtom);
  return useCallback(
    (threadIds: ReadonlySet<string>) => {
      if (!parentsStartCollapsed) {
        setCollapsedThreadIdList((current) =>
          current.some((id) => threadIds.has(id))
            ? current.filter((id) => !threadIds.has(id))
            : current,
        );
      } else {
        setExpandedThreadIdList((current) =>
          [...threadIds].every((id) => current.includes(id))
            ? current
            : [...new Set([...current, ...threadIds])],
        );
      }
    },
    [parentsStartCollapsed, setCollapsedThreadIdList, setExpandedThreadIdList],
  );
}
