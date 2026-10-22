import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type { ThreadComparator } from "../model/project-thread-groups.js";
import {
  buildSubtreeAttentionRungs,
  orderComparatorByAttention,
} from "../model/attention-ordering.js";
import {
  threadAttentionRung,
  type ThreadListRung,
} from "../model/thread-activity.js";
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

interface HeldOpenRung {
  threadId: string;
  rung: ThreadListRung;
}

let lastHeldOpenRung: HeldOpenRung | null = null;

function rememberHeldOpenRung(held: HeldOpenRung | null): void {
  lastHeldOpenRung = held;
}

function useHeldOpenRung(
  threads: readonly SidebarThread[],
  selectedThreadId: string | undefined,
): HeldOpenRung | null {
  const [held, setHeld] = useState<HeldOpenRung | null>(() =>
    lastHeldOpenRung?.threadId === selectedThreadId ? lastHeldOpenRung : null,
  );
  let next = held;
  if (held?.threadId !== selectedThreadId) {
    const thread =
      selectedThreadId === undefined
        ? undefined
        : threads.find((candidate) => candidate.id === selectedThreadId);
    next = thread
      ? { threadId: thread.id, rung: threadAttentionRung(thread) }
      : null;
  }
  if (next !== held) {
    setHeld(next);
  }
  useEffect(() => {
    rememberHeldOpenRung(held);
  }, [held]);
  return next;
}

export function useAttentionOrdering({
  threads,
  selectedThreadId,
  comparator,
}: {
  threads: readonly SidebarThread[];
  selectedThreadId: string | undefined;
  comparator: ThreadComparator;
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
  const subtreeRungs = useMemo(
    () =>
      attentionFirst
        ? buildSubtreeAttentionRungs(threads, (thread) =>
            heldOpenRung?.threadId === thread.id
              ? heldOpenRung.rung
              : threadAttentionRung(thread),
          )
        : null,
    [attentionFirst, heldOpenRung, threads],
  );
  const orderedComparator = useMemo(
    () =>
      subtreeRungs === null
        ? comparator
        : orderComparatorByAttention(
            comparator,
            (thread) => subtreeRungs.get(thread.id) ?? 0,
          ),
    [comparator, subtreeRungs],
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
    (threadIds: ReadonlySet<string>, fromNavigation: boolean) => {
      if (!parentsStartCollapsed) {
        setCollapsedThreadIdList((current) =>
          current.some((id) => threadIds.has(id))
            ? current.filter((id) => !threadIds.has(id))
            : current,
        );
      } else if (fromNavigation) {
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
