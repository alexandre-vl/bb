import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { atom, useAtom, useAtomValue } from "jotai";
import { foldRowLabel, planFold, type FoldKind } from "../model/fold-rows.js";
import type { ProjectThreadItem } from "../model/project-thread-groups.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { sidebarFoldSettledAtom } from "../preferences/atoms.js";
import { getSidebarItemKey } from "../rows/sidebarItemKeys.js";
import { useDraftThreadIds } from "./sidebarDraftPresence.js";

const FOLD_CLOCK_INTERVAL_MS = 10 * 60_000;

const openFoldKeysAtom = atom<ReadonlySet<string>>(new Set<string>());

interface SidebarFoldEnvironment {
  versionOf: (thread: SidebarThread) => SidebarThread;
  now: number;
}

const SidebarFoldContext = createContext<SidebarFoldEnvironment>({
  versionOf: (thread) => thread,
  now: 0,
});

export function SidebarFoldProvider({
  versionOf,
  children,
}: {
  versionOf: (thread: SidebarThread) => SidebarThread;
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
  const value = useMemo(() => ({ versionOf, now }), [versionOf, now]);
  return (
    <SidebarFoldContext.Provider value={value}>
      {children}
    </SidebarFoldContext.Provider>
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
  const foldSettled = useAtomValue(sidebarFoldSettledAtom);
  const { versionOf, now } = useContext(SidebarFoldContext);
  const draftThreadIds = useDraftThreadIds();
  const [openFoldKeys, setOpenFoldKeys] = useAtom(openFoldKeysAtom);
  const [focusItemKey, setFocusItemKey] = useState<string | undefined>();
  const plan = useMemo(
    () =>
      foldSettled
        ? planFold(kind, items, {
            versionOf,
            draftThreadIds,
            keepThreadId: selectedThreadId,
            now,
          })
        : null,
    [
      draftThreadIds,
      foldSettled,
      items,
      kind,
      now,
      selectedThreadId,
      versionOf,
    ],
  );
  const open = openFoldKeys.has(foldKey);
  const firstHidden = plan?.hidden[0];
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
  if (plan === null || plan.hidden.length === 0) {
    return { items, fold: null, focusItemKey: undefined };
  }
  return {
    items: open ? items : plan.visible,
    fold: {
      rowKey: `fold:${foldKey}`,
      label: foldRowLabel(kind, plan.hidden.length, open),
      open,
      toggle,
    },
    focusItemKey: open ? focusItemKey : undefined,
  };
}
