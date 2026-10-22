import { describe, expect, it } from "vitest";
import {
  buildSubtreeAttentionRungs,
  orderComparatorByAttention,
} from "./attention-ordering.js";
import {
  buildProjectThreadGroups,
  compareStandardThreads,
  type ProjectThreadItem,
} from "./project-thread-groups.js";
import {
  makeSidebarEnvironment,
  makeSidebarThread,
  type SidebarThreadOverrides,
} from "./fixtures.js";
import type { SidebarThread } from "./sidebar-thread.js";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";

installTestPluginRuntime();

function thread(id: string, overrides: SidebarThreadOverrides = {}) {
  return makeSidebarThread({
    id,
    title: id,
    titleFallback: id,
    lastReadAt: 10,
    latestAttentionAt: 10,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

const failedUnread = { status: "error" as const, latestAttentionAt: 20 };
const freshUnread = { latestAttentionAt: 20 };

function itemIds(items: readonly ProjectThreadItem[]): string[] {
  return items.map((item) => {
    switch (item.kind) {
      case "thread":
        return item.node.thread.id;
      case "environment":
        return `env:${item.group.nodes.map((node) => node.thread.id).join("+")}`;
      case "section":
        return `section:${item.group.id}`;
    }
  });
}

function orderedGroups(threads: readonly SidebarThread[]) {
  const rungs = buildSubtreeAttentionRungs(threads);
  return buildProjectThreadGroups(
    threads,
    orderComparatorByAttention(
      compareStandardThreads,
      (candidate) => rungs.get(candidate.id) ?? 0,
    ),
  );
}

describe("buildSubtreeAttentionRungs", () => {
  it("lifts each ancestor to the highest attention rung below it", () => {
    const rungs = buildSubtreeAttentionRungs([
      thread("root"),
      thread("child", { parentThreadId: "root", ...freshUnread }),
      thread("grandchild", {
        parentThreadId: "child",
        hasPendingInteraction: true,
      }),
      thread("sibling", { parentThreadId: "root", ...failedUnread }),
    ]);

    expect(Object.fromEntries(rungs)).toEqual({
      root: 5,
      child: 5,
      grandchild: 5,
      sibling: 4,
    });
  });

  it("never lifts running or queued threads", () => {
    const rungs = buildSubtreeAttentionRungs([
      thread("running", { status: "active", runtimeStatus: "active" }),
      thread("queued", { queuedWork: "waiting" }),
    ]);

    expect(rungs.size).toBe(0);
  });

  it("stops on a parent cycle", () => {
    const rungs = buildSubtreeAttentionRungs([
      thread("a", { parentThreadId: "b", ...freshUnread }),
      thread("b", { parentThreadId: "a" }),
    ]);

    expect(Object.fromEntries(rungs)).toEqual({ a: 3, b: 3 });
  });
});

describe("orderComparatorByAttention", () => {
  it("lists needs-you, failed and new threads first, then the user's sort", () => {
    const items = orderedGroups([
      thread("settled-new", { updatedAt: 50 }),
      thread("fresh", { ...freshUnread, updatedAt: 10 }),
      thread("running", {
        status: "active",
        runtimeStatus: "active",
        updatedAt: 40,
      }),
      thread("failed", { ...failedUnread, updatedAt: 5 }),
      thread("needs-you", { hasPendingInteraction: true, updatedAt: 1 }),
      thread("settled-old", { updatedAt: 2 }),
    ]);

    expect(itemIds(items)).toEqual([
      "needs-you",
      "failed",
      "fresh",
      "running",
      "settled-new",
      "settled-old",
    ]);
  });

  it("lifts a parent by its subtree and orders its children the same way", () => {
    const items = orderedGroups([
      thread("quiet-parent", { updatedAt: 50 }),
      thread("parent", { updatedAt: 1 }),
      thread("child-settled", { parentThreadId: "parent", updatedAt: 9 }),
      thread("child-failed", {
        parentThreadId: "parent",
        ...failedUnread,
        updatedAt: 2,
      }),
    ]);

    expect(itemIds(items)).toEqual(["parent", "quiet-parent"]);
    const parent = items[0];
    if (parent?.kind !== "thread") throw new Error("expected a thread item");
    expect(itemIds(parent.node.children)).toEqual([
      "child-failed",
      "child-settled",
    ]);
  });

  it("lifts a worktree group by its most urgent thread", () => {
    const environment = makeSidebarEnvironment({
      id: "env_feature",
      providerId: "git-worktree",
      isWorktree: true,
    });
    const items = orderedGroups([
      thread("loose", { updatedAt: 90 }),
      thread("worktree-settled", { environment, updatedAt: 3 }),
      thread("worktree-failed", { environment, ...failedUnread, updatedAt: 2 }),
    ]);

    expect(itemIds(items)).toEqual([
      "env:worktree-failed+worktree-settled",
      "loose",
    ]);
  });
});
