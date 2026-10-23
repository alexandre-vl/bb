import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  experimental_useThreadActions,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
  FAILED_RUNG,
  NEEDS_YOU_RUNG,
  NEW_RUNG,
  threadAttentionRung,
} from "../model/thread-activity.js";
import { toThreadActionTarget } from "../rows/threadActionTarget.js";

export const ATTENTION_ANNOUNCEMENT_BATCH_MS = 1200;

const NOTIFICATIONS_ACTION_KEYS = ["push-notifications/notifications"];

type AttentionKind = "needs-you" | "failed" | "new";

type NotificationLevel = "all" | "input-only" | "muted";

const NOTIFICATION_LEVEL_BY_DETAIL: Readonly<
  Record<string, NotificationLevel>
> = {
  "All activity": "all",
  "Needs input only": "input-only",
  Muted: "muted",
};

const ATTENTION_KIND_BY_RUNG: Readonly<Record<number, AttentionKind>> = {
  [NEEDS_YOU_RUNG]: "needs-you",
  [FAILED_RUNG]: "failed",
  [NEW_RUNG]: "new",
};

const ATTENTION_KIND_ORDER: readonly AttentionKind[] = [
  "needs-you",
  "failed",
  "new",
];

export interface AttentionEvent {
  threadId: string;
  title: string;
  kind: AttentionKind;
}

function attentionKindOf(thread: SidebarThread): AttentionKind | null {
  return ATTENTION_KIND_BY_RUNG[threadAttentionRung(thread)] ?? null;
}

export function isAnnouncedAtLevel(
  kind: AttentionKind,
  level: NotificationLevel,
): boolean {
  if (level === "muted") return false;
  return level === "all" || kind !== "new";
}

function describeGroup(kind: AttentionKind, titles: readonly string[]): string {
  const one = titles.length === 1;
  const subject = `${titles.length} ${one ? "thread" : "threads"}`;
  const predicate =
    kind === "needs-you"
      ? one
        ? "needs your input"
        : "need your input"
      : kind === "failed"
        ? "failed"
        : one
          ? "has a new result"
          : "have new results";
  return `${subject} ${predicate}: ${titles.join("; ")}.`;
}

export function describeAttentionEvents(
  events: readonly AttentionEvent[],
): string {
  return ATTENTION_KIND_ORDER.flatMap((kind) => {
    const titles = events
      .filter((event) => event.kind === kind)
      .map((event) => event.title);
    return titles.length === 0 ? [] : [describeGroup(kind, titles)];
  }).join(" ");
}

function NotificationLevelProbe({
  thread,
  levels,
}: {
  thread: PluginThreadActionTarget;
  levels: Map<string, NotificationLevel>;
}) {
  const [entry] = experimental_useThreadActions(thread, {
    keys: NOTIFICATIONS_ACTION_KEYS,
  });
  const detail = entry?.action.detail;
  const level =
    (detail === undefined ? undefined : NOTIFICATION_LEVEL_BY_DETAIL[detail]) ??
    "all";
  useLayoutEffect(() => {
    levels.set(thread.id, level);
  }, [level, levels, thread.id]);
  return null;
}

export function SidebarAttentionAnnouncer({
  threads,
  activeThreadId,
}: {
  threads: readonly SidebarThread[];
  activeThreadId: string | null;
}) {
  const kindsRef = useRef<ReadonlyMap<string, AttentionKind | null> | null>(
    null,
  );
  const startedAtRef = useRef(0);
  const pendingRef = useRef<AttentionEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeThreadIdRef = useRef(activeThreadId);
  const [levels] = useState(() => new Map<string, NotificationLevel>());
  const [probes, setProbes] = useState<readonly PluginThreadActionTarget[]>([]);
  const [announcement, setAnnouncement] = useState({ text: "", sequence: 0 });

  useLayoutEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  });

  useEffect(() => {
    const previous = kindsRef.current;
    const next = new Map(
      threads.map((thread) => [thread.id, attentionKindOf(thread)]),
    );
    kindsRef.current = next;
    if (previous === null) {
      startedAtRef.current = Date.now();
      return;
    }
    const arrived = threads.flatMap((thread): AttentionEvent[] => {
      const kind = next.get(thread.id) ?? null;
      if (
        kind === null ||
        thread.id === activeThreadId ||
        thread.archivedAt !== null ||
        (previous.has(thread.id)
          ? kind === previous.get(thread.id)
          : thread.createdAt < startedAtRef.current)
      ) {
        return [];
      }
      return [{ threadId: thread.id, title: thread.displayTitle, kind }];
    });
    if (arrived.length === 0) return;
    const arrivedIds = new Set(arrived.map((event) => event.threadId));
    pendingRef.current = [
      ...pendingRef.current.filter((event) => !arrivedIds.has(event.threadId)),
      ...arrived,
    ];
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    setProbes(
      pendingRef.current.flatMap((event) => {
        const thread = byId.get(event.threadId);
        return thread ? [toThreadActionTarget(thread)] : [];
      }),
    );
    if (timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const batch = pendingRef.current;
      pendingRef.current = [];
      setProbes([]);
      const announced = batch.filter(
        (event) =>
          event.threadId !== activeThreadIdRef.current &&
          isAnnouncedAtLevel(event.kind, levels.get(event.threadId) ?? "all"),
      );
      if (announced.length === 0) return;
      setAnnouncement((current) => ({
        text: describeAttentionEvents(announced),
        sequence: current.sequence + 1,
      }));
    }, ATTENTION_ANNOUNCEMENT_BATCH_MS);
  }, [activeThreadId, levels, threads]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-sidebar-attention-announcer=""
      className="sr-only"
    >
      {probes.map((thread) => (
        <NotificationLevelProbe
          key={thread.id}
          thread={thread}
          levels={levels}
        />
      ))}
      {announcement.text ? (
        <span key={announcement.sequence}>{announcement.text}</span>
      ) : null}
    </div>
  );
}
