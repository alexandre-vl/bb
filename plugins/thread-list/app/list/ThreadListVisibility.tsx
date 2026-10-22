import { ThreadCreationPlacementScope } from "./ThreadCreationPlacement.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtom } from "jotai";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type { SidebarSectionId } from "../model/sidebar-section-id.js";
import { rollUpThreads } from "../model/thread-activity.js";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { ActionMenuSeparator } from "@/components/ui/action-menu-items";
import {
  SIDEBAR_CONTENT_SELECTOR,
  SidebarContentElementContext,
} from "../ui/sidebar.js";
import { reorderStoredOrder } from "../model/stored-order.js";
import { sidebarHiddenGroupsAtom } from "../preferences/atoms.js";
import { CollapsedThreadStatusGlyph } from "../rows/ThreadRow.js";
import { usePluginThreadRowStatusForThreads } from "./groupRollups.js";
import {
  SidebarMore,
  SidebarOverflowItem,
  SidebarVisibilityActionContent,
  SidebarCustomizeActionContent,
} from "./SidebarVisibilityControls.js";
import {
  SidebarVisibilityCustomize,
  type SidebarVisibilityItem,
} from "@/components/ui/sidebar-visibility-customize";
import { SidebarTouchSensor } from "../dnd/sidebarTouchSensor.js";
import {
  CustomizeRowActionsContext,
  ThreadRowActionsCustomizingContext,
  type ThreadRowActionsCustomizing,
} from "./customizeRowActionsContext.js";
import { useFinishRowActionsOnOutsideClick } from "./ThreadRowActionsCustomize.js";

export interface ThreadListVisibilityGroup extends SidebarVisibilityItem {
  id: SidebarSectionId;
  threads: readonly SidebarThread[];
  renderContent: (close: () => void) => ReactNode;
  onNewThread?: () => void;
}

interface ThreadListVisibilityState {
  hiddenGroups: readonly ThreadListVisibilityGroup[];
  hide: (id: string) => void;
  restore: (id: string) => void;
  customize: () => void;
  label: string;
  selectedThreadId?: string;
}

const VisibilityContext = createContext<ThreadListVisibilityState | null>(null);
const GroupContext = createContext<string | null>(null);
const THREAD_LINK_SELECTOR = "[data-sidebar-thread-id]";

function pickRowActionsThreadId(root: HTMLElement | null): string | null {
  const links = Array.from(
    root?.querySelectorAll<HTMLElement>(THREAD_LINK_SELECTOR) ?? [],
  );
  const view = root
    ?.closest<HTMLElement>(SIDEBAR_CONTENT_SELECTOR)
    ?.getBoundingClientRect();
  const visible =
    view === undefined
      ? []
      : links.filter((link) => {
          const rect = link.getBoundingClientRect();
          return (
            rect.height > 0 &&
            rect.top >= view.top &&
            rect.bottom <= view.bottom
          );
        });
  const candidates = visible.length > 0 ? visible : links;
  const target =
    candidates.find((link) => link.getAttribute("aria-current") === "page") ??
    candidates[0];
  return target?.dataset.sidebarThreadId ?? null;
}

export function ThreadListVisibility({
  groups,
  order,
  onOrderChange,
  label,
  selectedThreadId,
  children,
}: {
  groups: readonly ThreadListVisibilityGroup[];
  order: readonly SidebarSectionId[];
  onOrderChange: (order: SidebarSectionId[]) => void;
  label: string;
  selectedThreadId?: string;
  children: ReactNode;
}) {
  const [hidden, setHidden] = useAtom(sidebarHiddenGroupsAtom);
  const [customizing, setCustomizing] = useState<"list" | null>(null);
  const [rowActionsThreadId, setRowActionsThreadId] = useState<string | null>(
    null,
  );
  const compact = useIsCompactViewport();
  const container = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<string | null>(null);
  const rowActionsFocusTarget = useRef<string | null>(null);
  const rowActionsReturnFocus = useRef<HTMLElement | null>(null);
  const hiddenIds = useMemo(() => new Set(hidden), [hidden]);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const orderedGroups = order.flatMap((id) => {
    const group = groupsById.get(id);
    return group ? [group] : [];
  });
  const setVisible = (id: string, visible: boolean) => {
    setHidden((current) =>
      visible
        ? current.filter((key) => key !== id)
        : current.includes(id)
          ? current
          : [...current, id],
    );
  };
  useEffect(() => {
    if (focusTarget.current === null || customizing) return;
    const id = focusTarget.current;
    focusTarget.current = null;
    const frame = requestAnimationFrame(() => {
      const root = container.current;
      const target =
        id === "more"
          ? root?.querySelector<HTMLElement>(
              '[data-testid="sidebar-thread-list-more-trigger"]',
            )
          : Array.from(
              root?.querySelectorAll<HTMLElement>(
                "[data-sidebar-visibility-group]",
              ) ?? [],
            )
              .find((element) => element.dataset.sidebarVisibilityGroup === id)
              ?.querySelector<HTMLElement>(
                'button[aria-label$=" actions"], button',
              );
      (target ?? root)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [hidden, customizing]);
  useEffect(() => {
    if (rowActionsThreadId !== null) return;
    const threadId = rowActionsFocusTarget.current;
    const returnFocus = rowActionsReturnFocus.current;
    rowActionsFocusTarget.current = null;
    rowActionsReturnFocus.current = null;
    if (threadId === null) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const link = Array.from(
          container.current?.querySelectorAll<HTMLElement>(
            THREAD_LINK_SELECTOR,
          ) ?? [],
        ).find((element) => element.dataset.sidebarThreadId === threadId);
        const target =
          (returnFocus?.isConnected ? returnFocus : null) ??
          link ??
          container.current;
        target?.focus({ preventScroll: true });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [rowActionsThreadId]);
  const customizeRowActions = useCallback((returnFocus: HTMLElement | null) => {
    const threadId = pickRowActionsThreadId(container.current);
    if (threadId === null) return;
    rowActionsReturnFocus.current = returnFocus;
    setRowActionsThreadId(threadId);
  }, []);
  const finishCustomizingRowActions = useCallback(
    (restoreFocus: boolean) => {
      rowActionsFocusTarget.current = restoreFocus ? rowActionsThreadId : null;
      setRowActionsThreadId(null);
    },
    [rowActionsThreadId],
  );
  useFinishRowActionsOnOutsideClick(
    rowActionsThreadId === null ? null : finishCustomizingRowActions,
  );
  const rowActionsCustomizing = useMemo<ThreadRowActionsCustomizing | null>(
    () =>
      rowActionsThreadId === null
        ? null
        : {
            threadId: rowActionsThreadId,
            onDone: finishCustomizingRowActions,
          },
    [finishCustomizingRowActions, rowActionsThreadId],
  );
  const value: ThreadListVisibilityState = {
    hiddenGroups: orderedGroups.filter((group) => hiddenIds.has(group.id)),
    label,
    selectedThreadId,
    customize: () => {
      setRowActionsThreadId(null);
      setCustomizing("list");
    },
    hide: (id) => {
      focusTarget.current = "more";
      setVisible(id, false);
    },
    restore: (id) => {
      focusTarget.current = id;
      setVisible(id, true);
    },
  };
  return (
    <VisibilityContext.Provider value={value}>
      <CustomizeRowActionsContext.Provider value={customizeRowActions}>
        <ThreadRowActionsCustomizingContext.Provider
          value={rowActionsCustomizing}
        >
          <div ref={container} tabIndex={-1} className="min-w-0 outline-none">
            {customizing === "list" ? (
              <SidebarVisibilityCustomize
                items={orderedGroups}
                touchSensor={SidebarTouchSensor}
                visibleIds={orderedGroups
                  .filter((group) => !hiddenIds.has(group.id))
                  .map((group) => group.id)}
                onVisibleChange={setVisible}
                onReorder={(activeId, overId) => {
                  const groupIds = orderedGroups.map((group) => group.id);
                  const next = reorderStoredOrder({
                    activeId,
                    overId,
                    order: groupIds,
                    visibleIds: groupIds,
                  });
                  if (next) onOrderChange(next);
                }}
                onDone={() => {
                  focusTarget.current = "more";
                  setCustomizing(null);
                }}
                title="Customize list"
                listLabel={label}
                variant={compact ? "compact" : "card"}
                testIdPrefix="sidebar-thread-list"
              />
            ) : (
              children
            )}
          </div>
        </ThreadRowActionsCustomizingContext.Provider>
      </CustomizeRowActionsContext.Provider>
    </VisibilityContext.Provider>
  );
}

export function ThreadListVisibilityGroupScope({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <GroupContext.Provider value={id}>
      <ThreadCreationPlacementScope group={id}>
        <div data-sidebar-visibility-group={id}>{children}</div>
      </ThreadCreationPlacementScope>
    </GroupContext.Provider>
  );
}

export function ThreadListVisibilityMenuItems({
  surface = "dropdown",
  leadingSeparator = true,
}: {
  surface?: "dropdown" | "context";
  leadingSeparator?: boolean;
}) {
  const state = useContext(VisibilityContext);
  const id = useContext(GroupContext);
  if (!state) return null;
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  return (
    <>
      {leadingSeparator && <ActionMenuSeparator surface={surface} />}
      {id !== null && (
        <Item onSelect={() => state.hide(id)}>
          <SidebarVisibilityActionContent visible label="Hide from list" />
        </Item>
      )}
      <Item onSelect={state.customize}>
        <SidebarCustomizeActionContent label="Customize list" />
      </Item>
    </>
  );
}

function GroupActivity({ threads }: { threads: readonly SidebarThread[] }) {
  const pluginStatus = usePluginThreadRowStatusForThreads(threads);
  const rollup = useMemo(() => rollUpThreads(threads), [threads]);
  return (
    <CollapsedThreadStatusGlyph rollup={rollup} pluginStatus={pluginStatus} />
  );
}

function HiddenGroup({
  group,
  selected,
  close,
  restore,
}: {
  group: ThreadListVisibilityGroup;
  selected: boolean;
  close: () => void;
  restore: (id: string) => void;
}) {
  return (
    <SidebarOverflowItem
      item={group}
      selected={selected}
      empty={group.threads.length === 0}
      onClose={close}
      onAddToSidebar={restore}
      onNewThread={group.onNewThread}
      activity={<GroupActivity threads={group.threads} />}
    >
      {(closeSection) => group.renderContent(closeSection)}
    </SidebarOverflowItem>
  );
}

export function ThreadListMore() {
  const state = useContext(VisibilityContext);
  if (!state || state.hiddenGroups.length === 0) return null;
  const groups = state.hiddenGroups;
  const selectedGroupId = groups.find((group) =>
    group.threads.some((thread) => thread.id === state.selectedThreadId),
  )?.id;
  const threads = [
    ...new Map(
      groups
        .flatMap((group) => group.threads)
        .map((thread) => [thread.id, thread]),
    ).values(),
  ];
  return (
    <div className="mt-4">
      <SidebarMore
        ariaLabel={`More ${state.label.toLowerCase()}`}
        listLabel={`Hidden ${state.label.toLowerCase()}`}
        customizeLabel="Customize list"
        onCustomize={state.customize}
        selected={selectedGroupId !== undefined}
        activity={<GroupActivity threads={threads} />}
        testIdPrefix="sidebar-thread-list"
      >
        {(close) => (
          <SidebarContentElementContext.Provider value={null}>
            <div
              data-sidebar-overflow="true"
              className="flex min-h-0 flex-1 flex-col"
            >
              {groups.map((group) => (
                <HiddenGroup
                  key={group.id}
                  group={group}
                  selected={group.id === selectedGroupId}
                  close={close}
                  restore={state.restore}
                />
              ))}
            </div>
          </SidebarContentElementContext.Provider>
        )}
      </SidebarMore>
    </div>
  );
}
