import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SIDEBAR_CONTENT_SELECTOR,
  useSidebarContentElementRef,
} from "../ui/sidebar.js";
import {
  encodeSidebarWindowedNavigationEntries,
  SIDEBAR_WINDOWED_NAV_ATTRIBUTE,
  type SidebarWindowedNavigationEntry,
} from "./sidebarThreadShortcuts.js";
import {
  encodeSidebarWindowedAttention,
  SIDEBAR_WINDOWED_ATTENTION_ATTRIBUTE,
  type SidebarWindowedAttention,
} from "./windowedAttention.js";
import {
  SidebarTreePositionProvider,
  type SidebarTreePosition,
} from "./keyboard/tree-position.js";

const WINDOW_VIEWPORT_MARGIN_PX = 240;
const DEFAULT_ROW_HEIGHT_PX = 30;
const TAB_STOP_SELECTOR = '[data-sidebar-tree-item][tabindex="0"]';

type RealizeRequest = (onRealized: () => void) => void;

const realizeRequests = new WeakMap<Element, RealizeRequest>();

export function realizeWindowedItem(
  wrapper: Element,
  onRealized: () => void,
): boolean {
  const request = realizeRequests.get(wrapper);
  if (!request) return false;
  request(onRealized);
  return true;
}

function holdsKeyboardFocus(wrapper: Element): boolean {
  return (
    wrapper.querySelector(TAB_STOP_SELECTOR) !== null ||
    wrapper.contains(wrapper.ownerDocument.activeElement)
  );
}

interface MeasuredItemHeight {
  height: number;
  rows: number;
}

interface SidebarWindowedItemsProps {
  itemKeys: readonly string[];
  focusItemKey?: string;
  estimateRows: (index: number) => number;
  alwaysMountedKeys?: ReadonlySet<string>;
  getNavigationEntries?: (
    index: number,
  ) => readonly SidebarWindowedNavigationEntry[];
  getAttention?: (index: number) => SidebarWindowedAttention;
  hasAttention?: (index: number) => boolean;
  trailingSetItems?: number;
  renderItem: (index: number) => ReactNode;
}

const EMPTY_KEY_SET: ReadonlySet<string> = new Set();

function mergeRealizedKeys(
  previous: ReadonlySet<string>,
  {
    add,
    remove,
    retain,
  }: {
    add?: ReadonlySet<string> | readonly string[];
    remove?: ReadonlySet<string> | readonly string[];
    retain?: ReadonlySet<string>;
  },
): ReadonlySet<string> {
  let next: Set<string> | null = null;
  const current = () => next ?? previous;
  if (retain) {
    for (const key of previous) {
      if (!retain.has(key)) {
        next ??= new Set(previous);
        next.delete(key);
      }
    }
  }
  for (const key of remove ?? EMPTY_KEY_SET) {
    if (current().has(key)) {
      next ??= new Set(previous);
      next.delete(key);
    }
  }
  for (const key of add ?? EMPTY_KEY_SET) {
    if (!current().has(key)) {
      next ??= new Set(previous);
      next.add(key);
    }
  }
  return next ?? previous;
}

export function SidebarWindowedItems({
  itemKeys,
  focusItemKey,
  estimateRows,
  alwaysMountedKeys = EMPTY_KEY_SET,
  getNavigationEntries,
  getAttention,
  hasAttention,
  trailingSetItems = 0,
  renderItem,
}: SidebarWindowedItemsProps) {
  const scrollElementRef = useSidebarContentElementRef();
  const windowingEnabled = itemKeys.length > 0 && scrollElementRef !== null;

  const [realizedKeys, setRealizedKeys] =
    useState<ReadonlySet<string>>(EMPTY_KEY_SET);
  const measuredHeightsRef = useRef(new Map<string, MeasuredItemHeight>());
  const rowHeightRef = useRef(DEFAULT_ROW_HEIGHT_PX);
  const wrapperByKeyRef = useRef(new Map<string, HTMLDivElement>());
  const keyByWrapperRef = useRef(new Map<Element, string>());
  const wrapperRefCallbacksRef = useRef(
    new Map<string, (node: HTMLDivElement | null) => void>(),
  );
  const observerRef = useRef<IntersectionObserver | null>(null);
  const alwaysMountedKeysRef = useRef(alwaysMountedKeys);
  alwaysMountedKeysRef.current = alwaysMountedKeys;
  const estimateRowsRef = useRef(estimateRows);
  estimateRowsRef.current = estimateRows;
  const rowsByKeyRef = useRef(new Map<string, number>());
  const pendingRealizeRef = useRef(new Map<string, (() => void)[]>());

  const keySignature = useMemo(() => itemKeys.join("\u0000"), [itemKeys]);
  const setSize = itemKeys.length + trailingSetItems;
  const positions = useMemo(
    () =>
      Array.from(
        { length: itemKeys.length },
        (_, index): SidebarTreePosition => ({
          posinset: index + 1,
          setsize: setSize,
        }),
      ),
    [itemKeys.length, setSize],
  );

  useLayoutEffect(() => {
    if (!focusItemKey) return;
    const wrapper = wrapperByKeyRef.current.get(focusItemKey);
    const target = wrapper?.querySelector<HTMLElement>(
      "[data-sidebar-tree-item]",
    );
    target?.focus();
  }, [focusItemKey]);

  const getWrapperRefCallback = useCallback((key: string) => {
    const callbacks = wrapperRefCallbacksRef.current;
    let callback = callbacks.get(key);
    if (!callback) {
      callback = (node: HTMLDivElement | null) => {
        const previous = wrapperByKeyRef.current.get(key);
        if (previous && previous !== node) {
          keyByWrapperRef.current.delete(previous);
          observerRef.current?.unobserve(previous);
        }
        if (node) {
          wrapperByKeyRef.current.set(key, node);
          keyByWrapperRef.current.set(node, key);
          realizeRequests.set(node, (onRealized) => {
            if (!node.hasAttribute("data-sidebar-windowed-placeholder")) {
              onRealized();
              return;
            }
            const pending = pendingRealizeRef.current.get(key) ?? [];
            pending.push(onRealized);
            pendingRealizeRef.current.set(key, pending);
            setRealizedKeys((previous) =>
              mergeRealizedKeys(previous, { add: [key] }),
            );
          });
          observerRef.current?.observe(node);
        } else {
          wrapperByKeyRef.current.delete(key);
        }
      };
      callbacks.set(key, callback);
    }
    return callback;
  }, []);

  useLayoutEffect(() => {
    const pending = pendingRealizeRef.current;
    if (pending.size === 0) return;
    for (const [key, callbacks] of pending) {
      const wrapper = wrapperByKeyRef.current.get(key);
      if (wrapper?.hasAttribute("data-sidebar-windowed-placeholder") ?? true) {
        if (!wrapper) pending.delete(key);
        continue;
      }
      pending.delete(key);
      for (const callback of callbacks) callback();
    }
  });

  const resolveScrollElement = useCallback((): Element | null => {
    const fromRef = scrollElementRef?.current ?? null;
    if (fromRef) {
      return fromRef;
    }
    const firstWrapper = wrapperByKeyRef.current.values().next();
    return firstWrapper.done
      ? null
      : firstWrapper.value.closest(SIDEBAR_CONTENT_SELECTOR);
  }, [scrollElementRef]);

  const recordMeasuredHeight = useCallback((key: string, height: number) => {
    if (height <= 0) {
      return;
    }
    const rows = rowsByKeyRef.current.get(key) ?? 0;
    measuredHeightsRef.current.set(key, { height, rows });
    if (rows > 0) {
      const perRow = height / rows;
      if (perRow >= 20 && perRow <= 80) {
        rowHeightRef.current = perRow;
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (!windowingEnabled) {
      setRealizedKeys((previous) =>
        previous.size > 0 ? EMPTY_KEY_SET : previous,
      );
      return;
    }

    const keySet = new Set(itemKeys);
    for (const staleMap of [
      measuredHeightsRef.current,
      rowsByKeyRef.current,
      wrapperRefCallbacksRef.current,
    ] as const) {
      for (const key of staleMap.keys()) {
        if (!keySet.has(key)) {
          staleMap.delete(key);
        }
      }
    }

    const scrollElement = resolveScrollElement();
    const promoteAll =
      !scrollElement || typeof IntersectionObserver === "undefined";

    const promoted = new Set<string>();
    if (promoteAll) {
      for (const key of itemKeys) {
        promoted.add(key);
      }
    } else if (scrollElement.clientHeight > 0) {
      const viewport = scrollElement.getBoundingClientRect();
      const viewportTop = viewport.top - WINDOW_VIEWPORT_MARGIN_PX;
      const viewportBottom = viewport.bottom + WINDOW_VIEWPORT_MARGIN_PX;
      for (const [key, element] of wrapperByKeyRef.current) {
        if (realizedKeys.has(key) || !keySet.has(key)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.bottom >= viewportTop && rect.top <= viewportBottom) {
          promoted.add(key);
        }
      }
    }

    setRealizedKeys((previous) =>
      mergeRealizedKeys(previous, { add: promoted, retain: keySet }),
    );

    const observer = observerRef.current;
    if (observer) {
      for (const element of wrapperByKeyRef.current.values()) {
        observer.observe(element);
      }
    }
    // oxlint-disable-next-line react/exhaustive-deps
  }, [windowingEnabled, keySignature]);

  useEffect(() => {
    if (!windowingEnabled || typeof IntersectionObserver === "undefined") {
      return;
    }
    const scrollElement = resolveScrollElement();
    if (!scrollElement) {
      return;
    }

    let observer: IntersectionObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const connect = () => {
      if (observer || scrollElement.clientHeight === 0) {
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          const intended = new Map<string, boolean>();
          for (const entry of entries) {
            const key = keyByWrapperRef.current.get(entry.target);
            if (key === undefined) {
              continue;
            }
            if (entry.isIntersecting) {
              intended.set(key, true);
            } else if (
              !alwaysMountedKeysRef.current.has(key) &&
              !holdsKeyboardFocus(entry.target)
            ) {
              intended.set(key, false);
              recordMeasuredHeight(key, entry.boundingClientRect.height);
            }
          }
          if (intended.size === 0) {
            return;
          }
          const entering: string[] = [];
          const leaving: string[] = [];
          for (const [key, isEntering] of intended) {
            (isEntering ? entering : leaving).push(key);
          }
          startTransition(() =>
            setRealizedKeys((previous) =>
              mergeRealizedKeys(previous, { add: entering, remove: leaving }),
            ),
          );
        },
        {
          root: scrollElement,
          rootMargin: `${WINDOW_VIEWPORT_MARGIN_PX}px 0px`,
        },
      );
      observerRef.current = observer;
      for (const element of wrapperByKeyRef.current.values()) {
        observer.observe(element);
      }
      resizeObserver?.disconnect();
      resizeObserver = null;
    };

    connect();
    if (!observer && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => connect());
      resizeObserver.observe(scrollElement);
    }

    return () => {
      resizeObserver?.disconnect();
      observerRef.current = null;
      observer?.disconnect();
    };
  }, [windowingEnabled, resolveScrollElement, recordMeasuredHeight]);

  return (
    <>
      {itemKeys.map((key, index) => {
        const isRealized =
          !windowingEnabled ||
          realizedKeys.has(key) ||
          alwaysMountedKeys.has(key) ||
          focusItemKey === key;
        const rows = Math.max(1, estimateRowsRef.current(index));
        rowsByKeyRef.current.set(key, rows);
        let placeholderHeight: number | undefined;
        let navigationValue: string | undefined;
        let attentionValue: string | undefined;
        let attention = false;
        if (!isRealized) {
          const measured = measuredHeightsRef.current.get(key);
          placeholderHeight =
            measured && measured.rows === rows
              ? measured.height
              : rows * rowHeightRef.current;
          const entries = getNavigationEntries?.(index);
          navigationValue =
            entries && entries.length > 0
              ? encodeSidebarWindowedNavigationEntries(entries)
              : undefined;
          const counts = getAttention?.(index);
          attentionValue = counts
            ? encodeSidebarWindowedAttention(counts)
            : undefined;
          attention = hasAttention?.(index) ?? false;
        }
        return (
          <div
            key={key}
            ref={getWrapperRefCallback(key)}
            data-sidebar-windowed-item=""
            data-sidebar-windowed-placeholder={isRealized ? undefined : ""}
            data-sidebar-windowed-attention={attention ? "true" : undefined}
            {...(navigationValue !== undefined
              ? { [SIDEBAR_WINDOWED_NAV_ATTRIBUTE]: navigationValue }
              : undefined)}
            {...(attentionValue !== undefined
              ? { [SIDEBAR_WINDOWED_ATTENTION_ATTRIBUTE]: attentionValue }
              : undefined)}
            style={isRealized ? undefined : { height: placeholderHeight }}
          >
            {isRealized ? (
              <SidebarTreePositionProvider value={positions[index] ?? null}>
                {renderItem(index)}
              </SidebarTreePositionProvider>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
