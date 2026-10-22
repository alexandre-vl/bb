import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const threadAttentionSchema = z.enum(["needs-you", "failed", "new"]);
export type ThreadAttention = z.infer<typeof threadAttentionSchema>;

const ATTENTION_RANK: Record<ThreadAttention, number> = {
  "needs-you": 0,
  failed: 1,
  new: 2,
};

export type ThreadAttentionFacts = Pick<
  PluginSidebarThread,
  | "hasPendingInteraction"
  | "status"
  | "queuedWork"
  | "lastReadAt"
  | "latestAttentionAt"
>;

function isThreadUnread(
  thread: Pick<ThreadAttentionFacts, "lastReadAt" | "latestAttentionAt">,
): boolean {
  return (thread.lastReadAt ?? 0) < thread.latestAttentionAt;
}

export function resolveThreadAttention(
  thread: ThreadAttentionFacts,
): ThreadAttention | null {
  if (thread.hasPendingInteraction) return "needs-you";
  const unread = isThreadUnread(thread);
  if (thread.queuedWork === "failed" || (unread && thread.status === "error")) {
    return "failed";
  }
  if (unread && thread.status === "idle") return "new";
  return null;
}

export const attentionThreadSchema = z
  .object({
    threadId: z.string(),
    title: z.string(),
    projectId: z.string(),
    parentThreadId: z.string().nullable(),
    attention: threadAttentionSchema,
    updatedAt: z.number(),
  })
  .strict();
export type AttentionThread = z.infer<typeof attentionThreadSchema>;

export interface AttentionCandidate extends ThreadAttentionFacts {
  id: string;
  title: string | null;
  titleFallback: string | null;
  projectId: string;
  parentThreadId: string | null;
  updatedAt: number;
}

function displayTitle(
  thread: Pick<AttentionCandidate, "id" | "title" | "titleFallback">,
): string {
  if (thread.title && thread.title.trim().length > 0) return thread.title;
  if (thread.titleFallback && thread.titleFallback.trim().length > 0) {
    return thread.titleFallback;
  }
  return `Thread ${thread.id.slice(0, 8)}`;
}

function compareAttentionThreads(
  left: AttentionThread,
  right: AttentionThread,
): number {
  const byRung = ATTENTION_RANK[left.attention] - ATTENTION_RANK[right.attention];
  if (byRung !== 0) return byRung;
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
  if (left.threadId === right.threadId) return 0;
  return left.threadId < right.threadId ? -1 : 1;
}

export function listAttentionThreads(
  threads: readonly AttentionCandidate[],
): AttentionThread[] {
  return threads
    .flatMap((thread): AttentionThread[] => {
      const attention = resolveThreadAttention(thread);
      if (attention === null) return [];
      return [
        {
          threadId: thread.id,
          title: displayTitle(thread),
          projectId: thread.projectId,
          parentThreadId: thread.parentThreadId,
          attention,
          updatedAt: thread.updatedAt,
        },
      ];
    })
    .sort(compareAttentionThreads);
}
