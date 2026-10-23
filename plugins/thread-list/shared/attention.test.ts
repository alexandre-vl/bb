import { describe, expect, it } from "vitest";
import {
  listAttentionThreads,
  resolveThreadAttention,
  type AttentionCandidate,
  type ThreadAttention,
  type ThreadAttentionFacts,
} from "./attention.js";

const UNREAD = { lastReadAt: 10, latestAttentionAt: 20 };
const READ = { lastReadAt: 20, latestAttentionAt: 20 };

function facts(overrides: Partial<ThreadAttentionFacts>): ThreadAttentionFacts {
  return {
    hasPendingInteraction: false,
    status: "idle",
    queuedWork: "none",
    ...READ,
    ...overrides,
  };
}

const LADDER: Array<
  [string, Partial<ThreadAttentionFacts>, ThreadAttention | null]
> = [
  [
    "a pending interaction on a running thread",
    { hasPendingInteraction: true, status: "active" },
    "needs-you",
  ],
  [
    "a pending interaction over an unread error",
    { hasPendingInteraction: true, status: "error", ...UNREAD },
    "needs-you",
  ],
  [
    "a pending interaction over a failed queued message",
    { hasPendingInteraction: true, queuedWork: "failed" },
    "needs-you",
  ],
  ["an unread error", { status: "error", ...UNREAD }, "failed"],
  ["a read error", { status: "error" }, null],
  [
    "a failed queued message on a read idle thread",
    { queuedWork: "failed" },
    "failed",
  ],
  [
    "a failed queued message on a running thread",
    { queuedWork: "failed", status: "active" },
    "failed",
  ],
  [
    "a failed queued message over a new result",
    { queuedWork: "failed", ...UNREAD },
    "failed",
  ],
  ["an unread finished thread", { ...UNREAD }, "new"],
  [
    "a finished thread never read",
    { lastReadAt: null, latestAttentionAt: 1 },
    "new",
  ],
  [
    "a waiting queued message on an unread finished thread",
    { queuedWork: "waiting", ...UNREAD },
    "new",
  ],
  ["a read finished thread", {}, null],
  [
    "a thread read at its latest attention",
    { lastReadAt: 5, latestAttentionAt: 5 },
    null,
  ],
  [
    "a thread never read with no attention",
    { lastReadAt: null, latestAttentionAt: 0 },
    null,
  ],
  ["an unread running thread", { status: "active", ...UNREAD }, null],
  ["an unread starting thread", { status: "starting", ...UNREAD }, null],
  ["an unread stopping thread", { status: "stopping", ...UNREAD }, null],
  ["an unread pending thread", { status: "pending", ...UNREAD }, null],
];

describe("resolveThreadAttention", () => {
  it.each(LADDER)("maps %s", (_name, overrides, expected) => {
    expect(resolveThreadAttention(facts(overrides))).toBe(expected);
  });
});

function candidate(
  id: string,
  overrides: Partial<AttentionCandidate> = {},
): AttentionCandidate {
  return {
    id,
    title: id,
    titleFallback: null,
    projectId: "proj_a",
    parentThreadId: null,
    updatedAt: 0,
    ...facts({}),
    ...overrides,
  };
}

describe("listAttentionThreads", () => {
  it("keeps attention threads, children included, ordered by rung and then most recently updated", () => {
    const listed = listAttentionThreads([
      candidate("thr_new_old", { ...UNREAD, updatedAt: 100 }),
      candidate("thr_settled", { updatedAt: 900 }),
      candidate("thr_failed_child", {
        status: "error",
        ...UNREAD,
        parentThreadId: "thr_new_old",
        updatedAt: 60,
      }),
      candidate("thr_new_recent", { ...UNREAD, updatedAt: 300 }),
      candidate("thr_queue_failed", { queuedWork: "failed", updatedAt: 400 }),
      candidate("thr_needs_you", {
        hasPendingInteraction: true,
        status: "active",
        projectId: "proj_b",
        updatedAt: 10,
      }),
      candidate("thr_running", { status: "active", ...UNREAD, updatedAt: 800 }),
      candidate("thr_tie_b", { ...UNREAD, updatedAt: 100 }),
    ]);
    expect(
      listed.map(({ threadId, attention }) => [threadId, attention]),
    ).toEqual([
      ["thr_needs_you", "needs-you"],
      ["thr_queue_failed", "failed"],
      ["thr_failed_child", "failed"],
      ["thr_new_recent", "new"],
      ["thr_new_old", "new"],
      ["thr_tie_b", "new"],
    ]);
    expect(listed[2]).toEqual({
      threadId: "thr_failed_child",
      title: "thr_failed_child",
      projectId: "proj_a",
      parentThreadId: "thr_new_old",
      attention: "failed",
      updatedAt: 60,
    });
  });

  it("titles a thread the way bb does when it has no title", () => {
    const titles = listAttentionThreads([
      candidate("thr_fallback1", {
        ...UNREAD,
        title: " ",
        titleFallback: "Fix the build",
      }),
      candidate("thr_untitled", {
        ...UNREAD,
        title: null,
        titleFallback: null,
      }),
    ]).map((thread) => thread.title);
    expect(titles).toEqual(["Fix the build", "Thread thr_unti"]);
  });
});
