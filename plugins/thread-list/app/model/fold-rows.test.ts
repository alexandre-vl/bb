import { describe, expect, it } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import {
  FOLD_OLDER_IDLE_MS,
  foldRowLabel,
  planFold,
  type FoldInputs,
} from "./fold-rows.js";
import { makeSidebarThread, type SidebarThreadOverrides } from "./fixtures.js";
import {
  buildProjectThreadGroups,
  type ProjectThreadItem,
} from "./project-thread-groups.js";
import type { SidebarThread } from "./sidebar-thread.js";

installTestPluginRuntime();

const NOW = 100 * 86_400_000;

function thread(id: string, overrides: SidebarThreadOverrides = {}) {
  return makeSidebarThread({
    id,
    title: id,
    titleFallback: id,
    lastReadAt: 10,
    latestAttentionAt: 10,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

function inputs(overrides: Partial<FoldInputs> = {}): FoldInputs {
  return {
    versionOf: (entry) => entry,
    draftThreadIds: new Set(),
    keepThreadId: undefined,
    now: NOW,
    ...overrides,
  };
}

function children(
  count: number,
  overrides: (index: number) => SidebarThreadOverrides = () => ({}),
): ProjectThreadItem[] {
  const threads: SidebarThread[] = [
    thread("parent"),
    ...Array.from({ length: count }, (_, index) =>
      thread(`child_${index}`, {
        parentThreadId: "parent",
        updatedAt: NOW - index,
        ...overrides(index),
      }),
    ),
  ];
  const [parent] = buildProjectThreadGroups(threads, undefined, false);
  if (parent?.kind !== "thread") throw new Error("missing parent");
  return parent.node.children;
}

function ids(items: readonly ProjectThreadItem[]): string[] {
  return items.map((item) =>
    item.kind === "thread" ? item.node.thread.id : item.kind,
  );
}

describe("planFold", () => {
  it.each([
    [8, 8, 0],
    [11, 5, 6],
    [18, 5, 13],
  ])("shows %i sub-agents as %i rows and %i folded", (count, shown, folded) => {
    const plan = planFold("more", children(count), inputs());
    expect(plan.visible).toHaveLength(shown);
    expect(plan.hidden).toHaveLength(folded);
  });

  it("keeps live, open and drafted sub-agents beyond five rows visible", () => {
    const items = children(12, (index) =>
      index === 7 ? { status: "active", runtimeStatus: "active" } : {},
    );
    const plan = planFold(
      "more",
      items,
      inputs({ keepThreadId: "child_8", draftThreadIds: new Set(["child_9"]) }),
    );
    expect(ids(plan.visible)).toEqual(
      expect.arrayContaining(["child_7", "child_8", "child_9"]),
    );
    expect(plan.visible).toHaveLength(7);
    expect(plan.hidden).toHaveLength(5);
  });

  it("keeps a held row at the version it is shown with", () => {
    const items = children(11);
    const held = items[6];
    if (held?.kind !== "thread") throw new Error("missing child");
    const live = thread(held.node.thread.id, {
      parentThreadId: "parent",
      status: "active",
      runtimeStatus: "active",
    });
    const plan = planFold(
      "more",
      items,
      inputs({
        versionOf: (entry) => (entry.id === live.id ? live : entry),
      }),
    );
    expect(ids(plan.visible)).toContain(live.id);
    expect(plan.hidden).toHaveLength(5);
  });

  it("folds settled roots idle for seven days only when five or more would fold", () => {
    const old = (id: string) =>
      thread(id, { updatedAt: NOW - FOLD_OLDER_IDLE_MS - 1 });
    const recent = [thread("a"), thread("b")];
    const four = buildProjectThreadGroups(
      [...recent, ...["o1", "o2", "o3", "o4"].map(old)],
      undefined,
      false,
    );
    expect(planFold("older", four, inputs()).hidden).toHaveLength(0);

    const five = buildProjectThreadGroups(
      [...recent, ...["o1", "o2", "o3", "o4", "o5"].map(old)],
      undefined,
      false,
    );
    const plan = planFold("older", five, inputs());
    expect(ids(plan.visible)).toEqual(["a", "b"]);
    expect(plan.hidden).toHaveLength(5);
  });

  it("never folds an old root that still needs attention", () => {
    const roots = buildProjectThreadGroups(
      ["o1", "o2", "o3", "o4", "o5", "o6"].map((id, index) =>
        thread(id, {
          updatedAt: NOW - FOLD_OLDER_IDLE_MS - 1,
          ...(index === 0 ? { status: "error", latestAttentionAt: 20 } : {}),
        }),
      ),
      undefined,
      false,
    );
    const plan = planFold("older", roots, inputs());
    expect(ids(plan.visible)).toEqual(["o1"]);
    expect(plan.hidden).toHaveLength(5);
  });
});

describe("foldRowLabel", () => {
  it("names the folded rows and the way back", () => {
    expect(foldRowLabel("more", 6, false)).toBe("Show 6 more");
    expect(foldRowLabel("older", 5, false)).toBe("Show 5 older");
    expect(foldRowLabel("more", 6, true)).toBe("Show fewer");
  });
});
