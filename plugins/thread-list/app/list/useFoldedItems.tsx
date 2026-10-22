import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import {
  foldRowLabel,
  planFold,
  type FoldInputs,
  type FoldKind,
  type FoldPlan,
} from "../model/fold-rows.js";
import type { ProjectThreadItem } from "../model/project-thread-groups.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { sidebarFoldSettledAtom } from "../preferences/atoms.js";
import { getSidebarItemKey } from "../rows/sidebarItemKeys.js";
import { useDraftThreadIds } from "./sidebarDraftPresence.js";

const FOLD_CLOCK_INTERVAL_MS = 10 * 60_000;

const openFoldKeysAtom = atom<ReadonlySet<string>>(new Set<string>());

export function moreFoldKey(threadId: string): string {
  return `more:${threadId}`;
}

export function olderRootsFoldKey(containerId: string): string {
  return `older:${containerId}`;
}

interface SidebarFoldEnvironment {
  versionOf: (thread: SidebarThread) => SidebarThread;
  heldThreadIds: ReadonlySet<string>;
  now: number;
}

const SidebarFoldContext = createContext<SidebarFoldEnvironment>({
  versionOf: (thread) => thread,
  heldThreadIds: new Set(),
  now: 0,
});

export function SidebarFoldProvider({
  versionOf,
  heldThreadIds,
  children,
}: {
  versionOf: (thread: SidebarThread) => SidebarThread;
  heldThreadIds: ReadonlySet<string>;
  children: ReactNode;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(
      () => setNow(Date.now()),
      FOLD_CLOCK_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, []);
  const value = useMemo(
    () => ({ versionOf, heldThreadIds, now }),
    [heldThreadIds, versionOf, now],
  );
  return (
    <SidebarFoldContext.Provider value={value}>
      {children}
    </SidebarFoldContext.Provider>
  );
}

export interface FoldResolution {
  items: readonly ProjectThreadItem[];
  hidden: readonly ProjectThreadItem[];
  open: boolean;
}

export type FoldResolver = (
  kind: FoldKind,
  foldKey: string,
  items: readonly ProjectThreadItem[],
) => FoldResolution | null;

const resolveNoFold: FoldResolver = () => null;

function createFoldResolver(
  inputs: FoldInputs,
  openFoldKeys: ReadonlySet<string>,
): FoldResolver {
  const plans = new WeakMap<
    readonly ProjectThreadItem[],
    Map<FoldKind, FoldPlan>
  >();
  return (kind, foldKey, items) => {
    let byKind = plans.get(items);
    if (byKind === undefined) {
      byKind = new Map();
      plans.set(items, byKind);
    }
    let plan = byKind.get(kind);
    if (plan === undefined) {
      plan = planFold(kind, items, inputs);
      byKind.set(kind, plan);
    }
    if (plan.hidden.length === 0) return null;
    const open = openFoldKeys.has(foldKey);
    return { items: open ? items : plan.visible, hidden: plan.hidden, open };
  };
}

export function useFoldResolver(
  selectedThreadId: string | undefined,
): FoldResolver {
  const foldSettled = useAtomValue(sidebarFoldSettledAtom);
  const { versionOf, heldThreadIds, now } = useContext(SidebarFoldContext);
  const draftThreadIds = useDraftThreadIds();
  const openFoldKeys = useAtomValue(openFoldKeysAtom);
  return useMemo(
    () =>
      foldSettled
        ? createFoldResolver(
            {
              versionOf,
              draftThreadIds,
              heldThreadIds,
              keepThreadId: selectedThreadId,
              now,
            },
            openFoldKeys,
          )
        : resolveNoFold,
    [
      draftThreadIds,
      foldSettled,
      heldThreadIds,
      now,
      openFoldKeys,
      selectedThreadId,
      versionOf,
    ],
  );
}

export interface SidebarFold {
  rowKey: string;
  label: string;
  open: boolean;
  toggle: () => void;
}

export function useFoldedItems({
  kind,
  foldKey,
  items,
  selectedThreadId,
}: {
  kind: FoldKind;
  foldKey: string;
  items: readonly ProjectThreadItem[];
  selectedThreadId: string | undefined;
}): {
  items: readonly ProjectThreadItem[];
  fold: SidebarFold | null;
  focusItemKey: string | undefined;
} {
  const resolveFold = useFoldResolver(selectedThreadId);
  const setOpenFoldKeys = useSetAtom(openFoldKeysAtom);
  const [focusItemKey, setFocusItemKey] = useState<string | undefined>();
  const resolution = useMemo(
    () => resolveFold(kind, foldKey, items),
    [foldKey, items, kind, resolveFold],
  );
  const open = resolution?.open ?? false;
  const firstHidden = resolution?.hidden[0];
  const toggle = useCallback(() => {
    setFocusItemKey(
      !open && firstHidden ? getSidebarItemKey(firstHidden) : undefined,
    );
    setOpenFoldKeys((current) => {
      const next = new Set(current);
      if (next.has(foldKey)) next.delete(foldKey);
      else next.add(foldKey);
      return next;
    });
  }, [firstHidden, foldKey, open, setOpenFoldKeys]);
  if (resolution === null) {
    return { items, fold: null, focusItemKey: undefined };
  }
  return {
    items: resolution.items,
    fold: {
      rowKey: `fold:${foldKey}`,
      label: foldRowLabel(kind, resolution.hidden.length, open),
      open,
      toggle,
    },
    focusItemKey: open ? focusItemKey : undefined,
  };
}
