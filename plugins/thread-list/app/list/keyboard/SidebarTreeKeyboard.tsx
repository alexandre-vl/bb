import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefCallback,
} from "react";
import {
  experimental_useSidebarListCommand,
  useComposers,
  type ExperimentalSidebarListCommand,
  type PluginComposerApi,
  type PluginThreadActionEntry,
} from "@get-bb/plugin-sdk/app";
import { SidebarTreeKeyboard, treeItemFor } from "./sidebar-tree-keyboard.js";

export const SIDEBAR_ROW_COMMAND_ACTION_KEYS = [
  "bb--core/archive",
  "bb--core/rename",
  "bb--core/read",
];

const ROW_ACTION_BY_COMMAND = {
  "thread.archive": "bb--core/archive",
  "thread.rename": "bb--core/rename",
  "thread.toggleRead": "bb--core/read",
} as const satisfies Partial<Record<ExperimentalSidebarListCommand, string>>;

type RowCommandEntries = () => readonly PluginThreadActionEntry[];

class SidebarRowCommands {
  private readonly rows = new Map<Element, RowCommandEntries>();

  register(item: Element, entries: RowCommandEntries): () => void {
    this.rows.set(item, entries);
    return () => {
      if (this.rows.get(item) === entries) this.rows.delete(item);
    };
  }

  run(item: Element, key: string): void {
    const entry = this.rows
      .get(item)?.()
      .find((candidate) => candidate.key === key);
    if (entry && !entry.action.disabled) void entry.action.run();
  }
}

const SidebarRowCommandsContext = createContext<SidebarRowCommands | null>(
  null,
);

export function useSidebarRowCommands(
  entries: readonly PluginThreadActionEntry[],
): RefCallback<Element> {
  const rows = useContext(SidebarRowCommandsContext);
  const entriesRef = useRef(entries);
  useLayoutEffect(() => {
    entriesRef.current = entries;
  });
  return useCallback(
    (item: Element | null) => {
      if (!rows || !item) return;
      return rows.register(item, () => entriesRef.current);
    },
    [rows],
  );
}

function pickComposer(
  composers: readonly PluginComposerApi[],
  activeThreadId: string | null,
): PluginComposerApi | undefined {
  return (
    composers.find(
      ({ scope }) =>
        scope.kind === "thread" && scope.threadId === activeThreadId,
    ) ??
    composers.find(({ scope }) => scope.kind === "new-thread") ??
    composers.find(({ scope }) => scope.kind === "thread")
  );
}

function useRowActionCommand(
  command: keyof typeof ROW_ACTION_BY_COMMAND,
  keyboard: SidebarTreeKeyboard,
  rows: SidebarRowCommands,
): void {
  experimental_useSidebarListCommand(command, ({ target }) => {
    if (!keyboard.contains(target)) return false;
    const item = treeItemFor(target);
    if (item === target) rows.run(item, ROW_ACTION_BY_COMMAND[command]);
    return true;
  });
}

function useAttentionCommand(
  command: "thread.previousAttention" | "thread.nextAttention",
  keyboard: SidebarTreeKeyboard,
): void {
  experimental_useSidebarListCommand(command, ({ target }) => {
    if (!keyboard.contains(target)) return false;
    return keyboard.focusAttention(
      target,
      command === "thread.nextAttention" ? "next" : "previous",
    );
  });
}

export function SidebarComposerFocus({
  activeThreadId,
  keyboard,
}: {
  activeThreadId: string | null;
  keyboard: SidebarTreeKeyboard;
}) {
  const composers = useComposers();
  useLayoutEffect(
    () =>
      keyboard.setComposerFocus(() => {
        const composer = pickComposer(composers, activeThreadId);
        if (!composer) return false;
        composer.focus();
        return true;
      }),
    [activeThreadId, composers, keyboard],
  );
  return null;
}

export function useSidebarTreeKeyboard(): {
  keyboard: SidebarTreeKeyboard;
  rows: SidebarRowCommands;
} {
  const [keyboard] = useState(() => new SidebarTreeKeyboard());
  const [rows] = useState(() => new SidebarRowCommands());
  useRowActionCommand("thread.archive", keyboard, rows);
  useRowActionCommand("thread.rename", keyboard, rows);
  useRowActionCommand("thread.toggleRead", keyboard, rows);
  useAttentionCommand("thread.previousAttention", keyboard);
  useAttentionCommand("thread.nextAttention", keyboard);
  return { keyboard, rows };
}

export function SidebarRowCommandsProvider({
  rows,
  children,
}: {
  rows: SidebarRowCommands;
  children: ReactNode;
}) {
  return (
    <SidebarRowCommandsContext.Provider value={rows}>
      {children}
    </SidebarRowCommandsContext.Provider>
  );
}
