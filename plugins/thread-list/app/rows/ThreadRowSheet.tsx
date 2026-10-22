import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  experimental_Icon as RegisteredIcon,
  experimental_useThreadActions,
  type PluginThreadActionEntry,
} from "@get-bb/plugin-sdk/app";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ResponsiveDrawerShell } from "@/components/ui/responsive-overlay";
import { Icon } from "@/components/ui/icon";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { toThreadActionTarget } from "./threadActionTarget.js";

export interface ThreadRowSheetRequest {
  thread: SidebarThread;
  title: string;
  summary: string;
  requestRename: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

interface ThreadRowSheetState {
  request: ThreadRowSheetRequest | null;
  open: boolean;
}

const LEADING_ACTION_KEYS = [
  "bb--core/archive",
  "bb--core/pin",
  "bb--core/read",
  "bb--core/rename",
  "bb--core/copyLink",
];
const TRAILING_ACTION_KEYS = ["bb--core/delete"];
const SHEET_ACTION_KEYS = new Set([
  ...LEADING_ACTION_KEYS,
  ...TRAILING_ACTION_KEYS,
]);
const FOLLOW_UP_ACTION_KEYS = new Set(["bb--core/rename", "bb--core/delete"]);
const SHEET_ITEM_CLASS = "pointer-coarse:py-2";

export class ThreadRowSheetController {
  private state: ThreadRowSheetState = { request: null, open: false };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): ThreadRowSheetState => this.state;

  open(request: ThreadRowSheetRequest): void {
    this.setState({ request, open: true });
  }

  close(): void {
    if (this.state.open) this.setState({ ...this.state, open: false });
  }

  isOpenFor(threadId: string): boolean {
    return this.state.open && this.state.request?.thread.id === threadId;
  }

  private setState(next: ThreadRowSheetState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

const ThreadRowSheetContext = createContext<ThreadRowSheetController | null>(
  null,
);

function subscribeNowhere(): () => void {
  return () => {};
}

export function useThreadRowSheet(): ThreadRowSheetController | null {
  return useContext(ThreadRowSheetContext);
}

export function useIsThreadRowSheetOpen(
  controller: ThreadRowSheetController | null,
  threadId: string,
): boolean {
  const isOpen = () => controller?.isOpenFor(threadId) ?? false;
  return useSyncExternalStore(
    controller?.subscribe ?? subscribeNowhere,
    isOpen,
    isOpen,
  );
}

export function ThreadRowSheetProvider({
  threads,
  children,
}: {
  threads: readonly SidebarThread[];
  children: ReactNode;
}) {
  const [controller] = useState(() => new ThreadRowSheetController());
  return (
    <ThreadRowSheetContext.Provider value={controller}>
      {children}
      <ThreadRowSheet controller={controller} threads={threads} />
    </ThreadRowSheetContext.Provider>
  );
}

function ThreadRowSheet({
  controller,
  threads,
}: {
  controller: ThreadRowSheetController;
  threads: readonly SidebarThread[];
}) {
  const { request, open } = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const titleId = useId();
  const summaryId = useId();
  const liveThread =
    request === null
      ? undefined
      : threads.find((candidate) => candidate.id === request.thread.id);
  const isOpen = open && liveThread !== undefined;
  const [stepState, setStepState] = useState<{
    request: ThreadRowSheetRequest;
    key: string;
  } | null>(null);
  useEffect(() => {
    if (open && request !== null && liveThread === undefined) {
      controller.close();
    }
  }, [controller, liveThread, open, request]);
  if (request === null) return null;
  const step = isOpen && stepState?.request === request ? stepState.key : null;
  const setStep = (key: string | null) =>
    setStepState(key === null ? null : { request, key });
  const thread = liveThread ?? request.thread;
  return (
    <CompactViewportOverrideProvider isCompactViewport>
      <DropdownMenu
        open={isOpen}
        onOpenChange={(next) => {
          if (!next) controller.close();
        }}
      >
        <ResponsiveDrawerShell
          open={isOpen}
          onOpenChange={(next) => {
            if (!next) controller.close();
          }}
          labelledBy={titleId}
          contentClassName="md:mx-auto md:w-full md:max-w-md"
          describedBy={request.summary ? summaryId : undefined}
          onAfterCloseAutoFocus={() =>
            request.onCloseAutoFocus(
              new Event("closeAutoFocus", { cancelable: true }),
            )
          }
        >
          <div
            data-sidebar-thread-sheet=""
            className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5 px-2 pb-2">
              <span
                id={titleId}
                className="line-clamp-2 text-sm font-medium text-foreground"
              >
                {request.title}
              </span>
              {request.summary ? (
                <span id={summaryId} className="text-xs text-muted-foreground">
                  {request.summary}
                </span>
              ) : null}
            </div>
            <ThreadRowSheetItems
              thread={thread}
              requestRename={request.requestRename}
              step={step}
              onStepChange={setStep}
            />
          </div>
        </ResponsiveDrawerShell>
      </DropdownMenu>
    </CompactViewportOverrideProvider>
  );
}

function orderSheetEntries(
  entries: readonly PluginThreadActionEntry[],
): PluginThreadActionEntry[][] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const pick = (keys: readonly string[]) =>
    keys.flatMap((key) => {
      const entry = byKey.get(key);
      return entry === undefined ? [] : [entry];
    });
  return [
    pick(LEADING_ACTION_KEYS),
    entries.filter((entry) => !SHEET_ACTION_KEYS.has(entry.key)),
    pick(TRAILING_ACTION_KEYS),
  ].filter((group) => group.length > 0);
}

function ThreadRowSheetItems({
  thread,
  requestRename,
  step,
  onStepChange,
}: {
  thread: SidebarThread;
  requestRename: () => void;
  step: string | null;
  onStepChange: (step: string | null) => void;
}) {
  const entries = experimental_useThreadActions(toThreadActionTarget(thread), {
    requestRename,
  });
  const stepEntry =
    step === null ? undefined : entries.find((entry) => entry.key === step);
  const choices = stepEntry?.action.choices;
  if (stepEntry !== undefined && choices !== undefined) {
    const { action } = stepEntry;
    return (
      <>
        <DropdownMenuItem
          className={SHEET_ITEM_CLASS}
          onSelect={(event) => {
            event.preventDefault();
            onStepChange(null);
          }}
        >
          <Icon name="ChevronLeft" aria-hidden="true" />
          Back
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{choices.heading ?? action.label}</DropdownMenuLabel>
        {choices.items.map((choice) => (
          <DropdownMenuItem
            key={choice.id}
            className={SHEET_ITEM_CLASS}
            aria-current={choice.selected ? "true" : undefined}
            disabled={choice.disabled}
            onSelect={() => {
              void action.run(choice.id);
            }}
          >
            {choice.icon !== undefined ? (
              <RegisteredIcon name={choice.icon} aria-hidden="true" />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{choice.label}</span>
            {choice.selected ? (
              <Icon name="Check" className="ml-auto" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
        {choices.hint !== undefined ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {choices.hint}
          </div>
        ) : null}
      </>
    );
  }
  return orderSheetEntries(entries).map((group, index) => (
    <Fragment key={group[0]?.key ?? index}>
      {index > 0 ? <DropdownMenuSeparator /> : null}
      {group.map((entry) => (
        <DropdownMenuItem
          key={entry.key}
          className={SHEET_ITEM_CLASS}
          variant={entry.action.variant}
          disabled={entry.action.disabled}
          onSelect={(event) => {
            if (entry.action.choices !== undefined) {
              event.preventDefault();
              onStepChange(entry.key);
              return;
            }
            void entry.action.run();
          }}
        >
          <RegisteredIcon name={entry.action.icon} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {FOLLOW_UP_ACTION_KEYS.has(entry.key)
              ? `${entry.action.label}…`
              : entry.action.label}
          </span>
          {entry.action.choices !== undefined ? (
            <Icon name="ChevronRight" className="ml-auto" aria-hidden="true" />
          ) : null}
        </DropdownMenuItem>
      ))}
    </Fragment>
  ));
}
