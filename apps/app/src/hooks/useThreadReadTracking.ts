import { useEffect, useRef } from "react";
import type { Thread } from "@bb/domain";
import { isThreadRead, type ThreadReadState } from "@bb/client-core";
import {
  useDocumentVisibilityRevision,
  useDocumentVisible,
} from "@/lib/document-visibility";
import { useUserActive } from "@/lib/user-activity";

type ThreadReadTrackingState = ThreadReadState & Pick<Thread, "id">;

interface MarkThreadReadMutation {
  hasFailed: (threadId: string, latestAttentionAt: number) => boolean;
  noteSeenRead: (threadId: string) => void;
  mutateAsync: (input: {
    threadId: string;
    throughAttentionAt: number;
    descendantsThroughAttentionAt: number;
  }) => Promise<unknown>;
}

interface UseThreadReadTrackingParams {
  markThreadRead: MarkThreadReadMutation;
  thread?: ThreadReadTrackingState;
  descendants: readonly ThreadReadTrackingState[];
}

interface ReadTrackingSnapshot {
  isActive: boolean;
  isVisible: boolean;
  isRead: boolean | null;
  attentionAtById: ReadonlyMap<string, number>;
  threadId: string | null;
  visibilityRevision: number;
}

function hasNewAttention(
  previousAttentionAtById: ReadonlyMap<string, number>,
  subtree: readonly ThreadReadTrackingState[],
): boolean {
  return subtree.some((member) => {
    const previousAttentionAt = previousAttentionAtById.get(member.id);
    return previousAttentionAt === undefined
      ? !isThreadRead(member)
      : previousAttentionAt !== member.latestAttentionAt;
  });
}

export function useThreadReadTracking({
  markThreadRead,
  thread,
  descendants,
}: UseThreadReadTrackingParams) {
  const manuallyUnreadRef = useRef(false);
  const previousSnapshotRef = useRef<ReadTrackingSnapshot | null>(null);
  const visibilityRevision = useDocumentVisibilityRevision();
  const isVisible = useDocumentVisible();
  const isActive = useUserActive();

  useEffect(() => {
    const previousSnapshot = previousSnapshotRef.current;
    const subtree = thread ? [thread, ...descendants] : [];
    const subtreeIsRead = thread ? subtree.every(isThreadRead) : null;
    previousSnapshotRef.current = {
      isActive,
      isVisible,
      isRead: subtreeIsRead,
      attentionAtById: new Map(
        subtree.map((member) => [member.id, member.latestAttentionAt]),
      ),
      threadId: thread?.id ?? null,
      visibilityRevision,
    };

    if (!isVisible) {
      return;
    }
    if (!thread) {
      return;
    }

    const isSameThread = previousSnapshot?.threadId === thread.id;
    const attentionArrived =
      isSameThread &&
      hasNewAttention(previousSnapshot.attentionAtById, subtree);
    if (!isSameThread || attentionArrived) {
      manuallyUnreadRef.current = false;
    }

    if (subtreeIsRead) {
      markThreadRead.noteSeenRead(thread.id);
      manuallyUnreadRef.current = false;
      return;
    }

    const readFailed = markThreadRead.hasFailed(
      thread.id,
      thread.latestAttentionAt,
    );
    if (
      isSameThread &&
      !attentionArrived &&
      previousSnapshot.isVisible &&
      previousSnapshot.isRead === true &&
      !readFailed
    ) {
      manuallyUnreadRef.current = true;
    }
    if (manuallyUnreadRef.current) {
      return;
    }

    if (!isActive) {
      return;
    }
    const becameActive = isSameThread && previousSnapshot.isActive === false;
    const retryFailedRead =
      readFailed && previousSnapshot?.visibilityRevision !== visibilityRevision;
    if (
      isSameThread &&
      !attentionArrived &&
      !becameActive &&
      !retryFailedRead
    ) {
      return;
    }

    void markThreadRead
      .mutateAsync({
        threadId: thread.id,
        throughAttentionAt: thread.latestAttentionAt,
        descendantsThroughAttentionAt: subtree.reduce(
          (latest, member) => Math.max(latest, member.latestAttentionAt),
          thread.latestAttentionAt,
        ),
      })
      .catch(() => undefined);
  }, [
    descendants,
    isActive,
    isVisible,
    markThreadRead,
    thread,
    visibilityRevision,
  ]);
}
