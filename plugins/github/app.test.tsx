// @vitest-environment jsdom

import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Toaster } from "sonner";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
  type PluginSdkTestFakes,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginCommandContext,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { GITHUB_COMMANDS } from "./components/ambient";
import { assemblePullStatus, type RawPullStatus } from "./pull-status";

const app = await loadPluginApp(() => import("./app"));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function pull(
  number: number,
  title: string,
  author: string,
  overrides: Partial<RawPullStatus> = {},
) {
  return {
    repo: "get-bb/bb",
    number,
    kind: "pr",
    title,
    state: "OPEN",
    author,
    labels: [],
    assignees: [],
    url: `https://github.com/get-bb/bb/pull/${number}`,
    body: "",
    updatedAt: "2026-08-20T00:00:00.000Z",
    pr: assemblePullStatus({
      state: "OPEN",
      isDraft: false,
      baseRefName: "main",
      headRefName: `branch-${number}`,
      headRefOid: `sha-${number}`,
      isCrossRepository: false,
      additions: 12,
      deletions: 3,
      changedFiles: 2,
      mergedAt: null,
      mergeable: "MERGEABLE",
      reviewDecision: null,
      isInMergeQueue: false,
      requestedReviewers: [],
      checkRunCounts: [{ state: "SUCCESS", count: 5 }],
      statusContextCounts: [],
      checksVerdict: null,
      stack: null,
      headOwner: "get-bb",
      ...overrides,
    }),
    snooze: null,
  };
}

function issue(number: number, title: string, state = "OPEN") {
  return {
    repo: "get-bb/bb",
    number,
    kind: "issue",
    title,
    state,
    author: "octocat",
    labels: [],
    assignees: [],
    url: `https://github.com/get-bb/bb/issues/${number}`,
    body: "",
    updatedAt: "2026-08-20T00:00:00.000Z",
    pr: null,
    snooze: null,
  };
}

const INBOX = [
  pull(1, "feat(list): Ship the inbox", "octocat"),
  pull(2, "Fix the flaky shard", "hubot", {
    checkRunCounts: [
      { state: "FAILURE", count: 2 },
      { state: "SUCCESS", count: 3 },
    ],
  }),
  pull(3, "Review me", "hubot", { requestedReviewers: ["octocat"] }),
  pull(4, "Still a draft", "octocat", { isDraft: true }),
  pull(5, "Build on the inbox", "hubot", { baseRefName: "branch-1" }),
];

const STATUS = {
  ghOk: true,
  ghState: "ready",
  ghError: null,
  repos: [{ repo: "get-bb/bb", projectId: "project-1" }],
  lastSyncedAt: "2026-10-21T00:00:00.000Z",
  lastSyncError: null,
};

type Handler = (input: unknown) => unknown;
type InteractionFakes = NonNullable<
  NonNullable<PluginSdkTestFakes["threads"]>["interactions"]
>;
type PendingInteraction = Awaited<
  ReturnType<NonNullable<InteractionFakes["list"]>>
>[number];

function rpc(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    status: () => STATUS,
    viewer: () => ({ login: "octocat" }),
    listItems: (input) =>
      typeof input === "object" &&
      input !== null &&
      "kind" in input &&
      input.kind === "issue"
        ? { items: [] }
        : { items: INBOX },
    listLinks: () => ({ links: {} }),
    listFollows: () => ({ follows: {} }),
    repoSettings: () => ({
      repos: {
        "get-bb/bb": {
          viewerCanWrite: true,
          mergeMethods: ["squash", "merge"],
          defaultMergeMethod: "squash",
          deleteBranchOnMerge: false,
        },
      },
    }),
    ...overrides,
  };
}

function check(
  name: string,
  status: "success" | "failure" | "pending" | "neutral",
  runId: number | null = 7,
) {
  return {
    name,
    workflow: "CI",
    status,
    url: `https://github.com/get-bb/bb/actions/runs/${runId ?? 0}`,
    runId,
    completedAt: status === "pending" ? null : "2026-08-20T00:00:00.000Z",
    required: true,
    annotations: [],
  };
}

function pullDetail(overrides: Record<string, unknown> = {}) {
  return {
    repo: "get-bb/bb",
    number: 42,
    title: "Status menu",
    state: "OPEN",
    isDraft: false,
    author: "octocat",
    body: "",
    url: "https://github.com/get-bb/bb/pull/42",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    baseRefName: "main",
    headRefName: "status-menu",
    additions: 1234,
    deletions: 56,
    changedFiles: 3,
    labels: [],
    assignees: [],
    reviewDecision: "",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewRequests: [],
    headRefOid: "abc123",
    isCrossRepository: false,
    isInMergeQueue: false,
    headCommittedAt: "2026-08-20T00:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    mergedBy: null,
    viewerCanUpdate: true,
    viewerCanClose: true,
    viewerCanReopen: false,
    viewerCanMerge: true,
    viewerCanDeleteHeadRef: true,
    isMergeQueueEnabled: false,
    headRefExists: true,
    checksVerdict: null,
    mergeMethods: ["squash", "merge"],
    defaultMergeMethod: "squash",
    deleteBranchOnMerge: false,
    reviewVerdicts: [],
    events: [],
    stack: null,
    checks: [check("build", "success")],
    comments: [],
    reviews: [],
    reviewThreads: [],
    files: [
      {
        path: "plugins/github/app.tsx",
        status: "modified",
        additions: 1000,
        deletions: 50,
        patch: null,
      },
      {
        path: "plugins/github/app.test.tsx",
        status: "modified",
        additions: 200,
        deletions: 6,
        patch: null,
      },
      {
        path: "plugins/github/README.md",
        status: "modified",
        additions: 34,
        deletions: 0,
        patch: null,
      },
    ],
    ...overrides,
  };
}

function sidebarThread(
  overrides: Partial<PluginSidebarThread> & { id: string },
): PluginSidebarThread {
  return {
    projectId: "project-1",
    title: "Fix · get-bb/bb#2",
    titleFallback: null,
    displayTitle: "Fix · get-bb/bb#2",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/project-1/threads/${overrides.id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: Date.parse("2026-10-21T00:00:00.000Z"),
    updatedAt: Date.parse("2026-10-21T00:00:00.000Z"),
    lastReadAt: null,
    latestAttentionAt: 1,
    ...overrides,
  };
}

function userQuestion(threadId: string): PendingInteraction {
  return {
    id: "int-1",
    threadId,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
    turnId: "turn-1",
    providerId: "codex",
    providerThreadId: "provider-thread-1",
    providerRequestId: "request-1",
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "q1",
          prompt: "Rebase on main or merge it in?",
          multiSelect: false,
          allowFreeText: true,
          options: [
            { value: "rebase", label: "Rebase" },
            { value: "merge", label: "Merge main" },
          ],
        },
      ],
    },
    resolution: null,
  };
}

function link(threadId: string, number: number, preset: string | null) {
  return {
    kind: "pr",
    repo: "get-bb/bb",
    number,
    threadId,
    createdAt: "2026-10-21T00:00:00.000Z",
    preset,
  };
}

function renderInbox(
  subPath = "pulls",
  overrides: Record<string, Handler> = {},
  options: Omit<RenderSlotOptions, "rpc"> = {},
) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath },
    { ...options, rpc: rpc(overrides) },
  );
}

function renderPull(
  github: Record<string, Handler>,
  options: Omit<RenderSlotOptions, "rpc"> = {},
) {
  return renderInbox(
    "pulls/get-bb/bb/42",
    { listItems: () => ({ items: [] }), ...github },
    options,
  );
}

function fakeGithub(
  initial: Record<string, unknown> = {},
  options: { canReopen?: boolean; failWith?: string } = {},
) {
  let detail = pullDetail(initial);
  return {
    getPull: () => ({ pull: detail }),
    setPullState: (input: unknown) => {
      if (options.failWith !== undefined) {
        return Promise.reject(new Error(options.failWith));
      }
      const target =
        typeof input === "object" && input !== null && "state" in input
          ? input.state
          : null;
      const closed = target === "closed";
      const isDraft =
        target === "draft" ? true : target === "open" ? false : detail.isDraft;
      detail = {
        ...detail,
        state: closed ? "CLOSED" : isDraft ? "DRAFT" : "OPEN",
        isDraft,
        viewerCanReopen: closed && (options.canReopen ?? true),
      };
      return { ok: true, state: target };
    },
  };
}

function calls(slot: ReturnType<typeof renderSlot>, method: string) {
  return slot.rpcCalls
    .filter((call) => call.method === method)
    .map((call) => call.input);
}

async function nextStepCard(
  slot: ReturnType<typeof renderSlot>,
  text: string,
): Promise<HTMLElement> {
  await waitFor(() =>
    expect(
      slot.getByRole("region", { name: "Next step" }).textContent,
    ).toContain(text),
  );
  return slot.getByRole("region", { name: "Next step" });
}

function openWithKeyboard(trigger: HTMLElement) {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

function stubResizeObserver() {
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  onTestFinished(() => {
    globalThis.ResizeObserver = original;
  });
}

function stubScrollIntoView() {
  const scrollIntoView = vi.fn();
  const original = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView",
  );
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  onTestFinished(() => {
    if (original !== undefined) {
      Object.defineProperty(Element.prototype, "scrollIntoView", original);
    } else {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
  return scrollIntoView;
}

describe("GitHub pull request inbox", () => {
  it("groups the inbox by what each pull request needs next and says why", async () => {
    const slot = renderInbox();

    await slot.findByText("Ship the inbox");
    await act(async () => {});
    expect(
      slot
        .getAllByRole("region")
        .map((region) => region.getAttribute("aria-label")),
    ).toEqual(["Your move", "Ready to merge", "Needs fixing"]);
    expect(slot.getByRole("tab", { name: /^Inbox/ }).textContent).toBe(
      "Inbox4",
    );
    expect(slot.getByText("feat(list):")).toBeTruthy();
    expect(slot.getByText("Your review is requested")).toBeTruthy();
    expect(slot.getByText("2 checks failing")).toBeTruthy();
    expect(slot.getByText("has #5 on top")).toBeTruthy();
    expect(slot.getByText("stacked on #1")).toBeTruthy();
    expect(slot.queryByText("Still a draft")).toBeNull();

    await act(async () =>
      slot
        .getByRole("button", {
          name: "#3 Review me: Your review is requested",
        })
        .click(),
    );
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/get-bb/bb/3" },
    });

    await act(async () => slot.getByRole("tab", { name: "Mine" }).click());
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/mine" },
    });
  });

  it("shows the viewer's drafts under Mine, collapsed until asked", async () => {
    const slot = renderInbox("pulls/mine");

    await slot.findByText("Ship the inbox");
    expect(slot.queryByText("Still a draft")).toBeNull();
    await act(async () =>
      slot.getByRole("button", { name: /^Drafts/ }).click(),
    );
    expect(slot.getByText("Still a draft")).toBeTruthy();
    expect(slot.queryByText("Review me")).toBeNull();
  });

  it("walks the rows with j and k, opens with Enter, and switches views with ]", async () => {
    const slot = renderInbox();
    await slot.findByText("Ship the inbox");
    await act(async () => {});

    await act(async () => fireEvent.keyDown(document.body, { key: "j" }));
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "#3 Review me: Your review is requested",
    );
    await act(async () =>
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "j" }),
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "#1 feat(list): Ship the inbox: 5 checks passed",
    );
    await act(async () =>
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "k" }),
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "#3 Review me: Your review is requested",
    );
    await act(async () =>
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Enter",
      }),
    );
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/get-bb/bb/3" },
    });

    await act(async () =>
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "]" }),
    );
    expect(slot.navigateCalls.at(-1)).toEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/mine" },
    });
  });

  it("snoozes a pull request from its row menu until its checks change", async () => {
    const toaster = render(<Toaster />);
    const slot = renderInbox("pulls", {
      snoozePull: (input) => ({
        ok: true,
        snooze:
          typeof input === "object" && input !== null && "rule" in input
            ? { rule: input.rule, until: null }
            : null,
      }),
      unsnoozePull: () => ({ ok: true }),
    });
    await slot.findByText("Fix the flaky shard");

    fireEvent.pointerDown(
      slot.getByRole("button", { name: "More actions for #2" }),
    );
    fireEvent.click(await slot.findByRole("menuitem", { name: /^Snooze…/ }));
    expect(
      slot.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Until checks change/),
        expect.stringMatching(/^Until a new push/),
        expect.stringMatching(/^Tomorrow/),
        expect.stringMatching(/^Next week/),
      ]),
    );
    await act(async () =>
      fireEvent.click(
        slot.getByRole("menuitem", { name: /^Until checks change/ }),
      ),
    );
    expect(calls(slot, "snoozePull")).toEqual([
      { repo: "get-bb/bb", number: 2, rule: "checks", until: null },
    ]);
    await toaster.findByText(/^#2 snoozed/);
    await act(async () =>
      fireEvent.click(toaster.getByRole("button", { name: "Undo" })),
    );
    expect(calls(slot, "unsnoozePull")).toEqual([
      { repo: "get-bb/bb", number: 2 },
    ]);
    toaster.unmount();
  });

  it("filters with / and shows each qualifier as a removable chip", async () => {
    const slot = renderInbox("pulls/all");
    await slot.findByText("Ship the inbox");
    await act(async () => {});

    await act(async () => fireEvent.keyDown(document.body, { key: "/" }));
    const input = slot.getByRole("combobox");
    await waitFor(() => expect(document.activeElement).toBe(input));
    await act(async () =>
      fireEvent.change(input, { target: { value: "author:hubot " } }),
    );
    expect(slot.queryByText("Ship the inbox")).toBeNull();
    expect(slot.getByText("Review me")).toBeTruthy();
    expect(slot.getByText("Fix the flaky shard")).toBeTruthy();

    await act(async () =>
      fireEvent.click(
        slot.getByRole("button", { name: 'Remove "Author is hubot"' }),
      ),
    );
    expect(slot.getByText("Ship the inbox")).toBeTruthy();
  });

  it("restores a saved filter as chips without taking focus", async () => {
    window.localStorage.setItem(
      "bb-plugin-github:v3:query:pr",
      "author:hubot ",
    );
    const slot = renderInbox("pulls/all");

    await slot.findByText("Review me");
    await act(async () => {});
    expect(slot.queryByText("Ship the inbox")).toBeNull();
    expect(
      slot.getByRole("button", { name: 'Remove "Author is hubot"' }),
    ).toBeTruthy();
    expect(document.activeElement).not.toBe(slot.getByRole("combobox"));
    expect(slot.queryByRole("listbox")).toBeNull();
  });

  it("merges every ready pull request of a group after a confirmation", async () => {
    const toaster = render(<Toaster />);
    const slot = renderInbox("pulls", {
      mergePull: (input) => ({
        ok: true,
        method:
          typeof input === "object" && input !== null && "method" in input
            ? input.method
            : "squash",
        deletedBranch: false,
      }),
      refresh: () => ({ repos: 1, items: 5 }),
    });
    await slot.findByText("Ship the inbox");

    fireEvent.pointerDown(slot.getByRole("button", { name: "Merge all" }));
    expect(calls(slot, "mergePull")).toEqual([]);
    const confirmMerge = await slot.findByRole("menuitem", {
      name: /^Merge 2/,
    });
    await act(async () => fireEvent.click(confirmMerge));
    await waitFor(() =>
      expect(calls(slot, "mergePull")).toEqual([
        {
          repo: "get-bb/bb",
          number: 1,
          method: "squash",
          deleteBranch: false,
          headRefOid: "sha-1",
        },
        {
          repo: "get-bb/bb",
          number: 5,
          method: "squash",
          deleteBranch: false,
          headRefOid: "sha-5",
        },
      ]),
    );
    await toaster.findByText("2 pull requests merged");
    toaster.unmount();
  });

  it("sums up a bulk merge that partly failed in one toast", async () => {
    const toaster = render(<Toaster />);
    const slot = renderInbox("pulls", {
      mergePull: (input) =>
        typeof input === "object" &&
        input !== null &&
        "number" in input &&
        input.number === 5
          ? Promise.reject(new Error("Base branch was modified"))
          : { ok: true, method: "squash", deletedBranch: false },
      refresh: () => ({ repos: 1, items: 5 }),
    });
    await slot.findByText("Ship the inbox");

    fireEvent.pointerDown(slot.getByRole("button", { name: "Merge all" }));
    const confirmMerge = await slot.findByRole("menuitem", {
      name: /^Merge 2/,
    });
    await act(async () => fireEvent.click(confirmMerge));
    await toaster.findByText("Merged 1 of 2");
    expect(toaster.getByText("#5: Base branch was modified")).toBeTruthy();
    expect(toaster.queryByText("2 pull requests merged")).toBeNull();
    toaster.unmount();
  });

  it("changes a row's status from its menu and undoes it from the toast", async () => {
    const toaster = render(<Toaster />);
    const slot = renderInbox("pulls", {
      setPullState: (input) => ({
        ok: true,
        state:
          typeof input === "object" && input !== null && "state" in input
            ? input.state
            : null,
      }),
    });
    await slot.findByText("Ship the inbox");

    fireEvent.pointerDown(
      slot.getByRole("button", { name: "More actions for #1" }),
    );
    fireEvent.click(
      await slot.findByRole("menuitem", { name: /^Change status…/ }),
    );
    const draft = await slot.findByRole("menuitemradio", { name: /^Draft/ });
    await act(async () => fireEvent.click(draft));
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 1, state: "draft" },
    ]);
    await toaster.findByText("#1 is a draft now");
    await act(async () =>
      fireEvent.click(toaster.getByRole("button", { name: "Undo" })),
    );
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 1, state: "draft" },
      { repo: "get-bb/bb", number: 1, state: "open" },
    ]);
    await toaster.findByText("#1 is ready for review");
    toaster.unmount();
  });

  it("puts a waiting agent's question on its row", async () => {
    const slot = renderInbox(
      "pulls",
      {
        listLinks: () => ({
          links: { "pr:get-bb/bb#2": [link("thr-ask", 2, "fix")] },
        }),
      },
      {
        sidebarThreads: {
          threads: [
            sidebarThread({
              id: "thr-ask",
              status: "active",
              hasPendingInteraction: true,
            }),
          ],
        },
        sdk: {
          threads: {
            interactions: { list: async () => [userQuestion("thr-ask")] },
          },
        },
      },
    );

    expect(
      await slot.findByRole("button", {
        name: "#2 Fix the flaky shard: Agent asks: Rebase on main or merge it in?",
      }),
    ).toBeTruthy();
  });

  it("keeps the last sync on screen while GitHub is unreachable", async () => {
    const slot = renderInbox("pulls", {
      status: () => ({
        ...STATUS,
        ghOk: false,
        ghState: "unavailable",
        ghError: "connect ETIMEDOUT 140.82.112.6:443",
      }),
      refresh: () => ({ repos: 1, items: 5 }),
    });

    await slot.findByText("Ship the inbox");
    expect(
      await slot.findByText("Can't reach GitHub · showing the last sync"),
    ).toBeTruthy();
    expect(slot.queryByText(/ETIMEDOUT/)).toBeNull();
    await act(async () =>
      slot.getByRole("button", { name: "Try again" }).click(),
    );
    expect(calls(slot, "refresh")).toHaveLength(1);
  });

  it("marks a running agent on its row and opens its thread", async () => {
    const slot = renderInbox(
      "pulls",
      {
        listLinks: () => ({
          links: { "pr:get-bb/bb#2": [link("thr-fix", 2, "fix")] },
        }),
      },
      {
        sidebarThreads: {
          threads: [sidebarThread({ id: "thr-fix", status: "active" })],
        },
      },
    );
    const row = await slot.findByRole("button", {
      name: /^#2 Fix the flaky shard: Agent/,
    });
    expect(row.getAttribute("aria-label")).toMatch(
      /Agent is fixing the failing checks/,
    );
    expect(
      slot
        .getAllByRole("region")
        .map((region) => region.getAttribute("aria-label")),
    ).toContain("In progress");
    await act(async () =>
      slot.getByRole("button", { name: "Open the agent's thread" }).click(),
    );
    expect(slot.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr-fix",
    });
  });
});

describe("GitHub pull request detail", () => {
  it("says what the pull request needs next and merges it with the chosen method", async () => {
    stubResizeObserver();
    const toaster = render(<Toaster />);
    let merged = false;
    const slot = renderPull({
      getPull: () => ({
        pull: pullDetail(
          merged
            ? {
                state: "MERGED",
                mergedAt: "2026-08-21T00:00:00.000Z",
                mergedBy: "octocat",
              }
            : {},
        ),
      }),
      mergePull: () => {
        merged = true;
        return { ok: true, method: "merge", deletedBranch: true };
      },
    });

    await nextStepCard(slot, "Ready to merge");
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Merge" })),
    );
    const dialog = await slot.findByRole("dialog");
    expect(dialog.textContent).toContain("Merge #42 into main");
    await act(async () =>
      fireEvent.click(
        slot.getByRole("radio", { name: /Create a merge commit/ }),
      ),
    );
    expect(
      slot
        .getByRole("checkbox", { name: /Delete status-menu/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await act(async () =>
      fireEvent.click(
        slot.getByRole("button", { name: "Create a merge commit" }),
      ),
    );
    expect(calls(slot, "mergePull")).toEqual([
      {
        repo: "get-bb/bb",
        number: 42,
        method: "merge",
        deleteBranch: true,
        headRefOid: "abc123",
      },
    ]);
    await toaster.findByText("Merged #42 into main, branch deleted");
    await waitFor(() =>
      expect(slot.queryByRole("button", { name: /^Status:/ })).toBeNull(),
    );
    expect(slot.getAllByText("Merged").length).toBeGreaterThan(0);
    expect(slot.queryByRole("button", { name: "Merge" })).toBeNull();
    toaster.unmount();
  });

  it("lists the failing checks and starts an agent from the sheet", async () => {
    const toaster = render(<Toaster />);
    const spawn = vi.fn(async (request: { title?: string }) =>
      makeThreadResponse({ id: "thr-new", title: request.title ?? null }),
    );
    const slot = renderPull(
      {
        ...fakeGithub({
          checks: [
            check("lint", "failure", 9),
            check("unit (shard 2)", "failure", 9),
            check("build", "success"),
          ],
        }),
        agentPrompt: (input) => ({
          prompt: `Fix the failing checks (${JSON.stringify(input)})`,
          title: "Fix · get-bb/bb#42: Status menu",
        }),
        linkThread: () => ({ ok: true }),
      },
      { sdk: { threads: { spawn } } },
    );

    const card = await nextStepCard(slot, "2 checks failing");
    expect(card.textContent).toContain("lint");
    expect(card.textContent).toContain("unit (shard 2)");

    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Fix with an agent" })),
    );
    const dialog = await slot.findByRole("dialog");
    expect(dialog.textContent).toContain(
      "On #42; the agent checks out status-menu first",
    );
    expect(
      slot
        .getByRole("radio", { name: "Fix checks" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    const composer = await slot.findByTestId("bb-new-thread-composer");
    expect(composer.getAttribute("data-draft-key")).toBe(
      "github:get-bb/bb#42:fix",
    );
    expect(
      (slot.getByTestId("bb-new-thread-composer-input") as HTMLTextAreaElement)
        .value,
    ).toBe(
      'Fix the failing checks ({"repo":"get-bb/bb","number":42,"preset":"fix","branchCheckout":"checkout"})',
    );

    await act(async () =>
      fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit")),
    );
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[0]).toMatchObject({
      title: "Fix · get-bb/bb#42: Status menu",
      pluginMetadata: {
        pullRequest: { repo: "get-bb/bb", number: 42, preset: "fix" },
      },
    });
    expect(calls(slot, "linkThread")).toEqual([
      {
        kind: "pr",
        repo: "get-bb/bb",
        number: 42,
        threadId: "thr-new",
        preset: "fix",
      },
    ]);
    await toaster.findByText("Agent started on #42");
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    toaster.unmount();
  });

  it("puts the agent's question on the card and answers it in place", async () => {
    const question = userQuestion("thr-agent");
    const resolve = vi.fn(async () => question);
    const slot = renderPull(
      {
        ...fakeGithub({ checks: [check("lint", "failure", 9)] }),
        listLinks: () => ({
          links: { "pr:get-bb/bb#42": [link("thr-agent", 42, "fix")] },
        }),
      },
      {
        sidebarThreads: {
          threads: [
            sidebarThread({
              id: "thr-agent",
              status: "active",
              hasPendingInteraction: true,
              displayTitle: "Fix · get-bb/bb#42",
            }),
          ],
        },
        sdk: {
          threads: {
            interactions: { list: async () => [question], resolve },
          },
        },
      },
    );

    const card = await nextStepCard(slot, "Rebase on main or merge it in?");
    expect(card.textContent).toContain("The agent needs your answer");
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Rebase" })),
    );
    expect(resolve).toHaveBeenCalledWith({
      threadId: "thr-agent",
      interactionId: "int-1",
      resolution: {
        kind: "user_answer",
        answers: { q1: { selected: ["rebase"] } },
      },
    });
  });

  it("offers Reopen on a closed pull request", async () => {
    const slot = renderPull(
      fakeGithub({
        state: "CLOSED",
        viewerCanReopen: true,
        closedAt: "2026-08-21T00:00:00.000Z",
      }),
    );
    await nextStepCard(slot, "Closed without merging");
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Reopen" })),
    );
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 42, state: "open" },
    ]);
  });

  it("tells the story on Activity and replies to GitHub", async () => {
    const github = fakeGithub({
      events: [
        {
          kind: "commit",
          actor: "octocat",
          createdAt: "2026-08-20T01:00:00.000Z",
          detail: "Add the menu",
        },
        {
          kind: "commit",
          actor: "octocat",
          createdAt: "2026-08-20T02:00:00.000Z",
          detail: "Polish the menu",
        },
      ],
      comments: [
        {
          author: "hubot",
          body: "Looks close.",
          createdAt: "2026-08-20T03:00:00.000Z",
        },
      ],
      reviews: [
        {
          author: "hubot",
          state: "APPROVED",
          body: "",
          createdAt: "2026-08-20T04:00:00.000Z",
        },
      ],
    });
    const posted: Array<{ author: string; body: string; createdAt: string }> =
      [];
    let finishComment = () => {};
    const slot = renderPull({
      ...github,
      getPull: () => {
        const { pull: detail } = github.getPull();
        return {
          pull: { ...detail, comments: [...detail.comments, ...posted] },
        };
      },
      commentPull: (input) =>
        new Promise((resolve) => {
          finishComment = () => {
            posted.push({
              author: "octocat",
              body:
                typeof input === "object" && input !== null && "body" in input
                  ? String(input.body)
                  : "",
              createdAt: "2026-10-21T00:00:00.000Z",
            });
            resolve({ ok: true });
          };
        }),
    });

    const activity = await slot.findByRole("tabpanel");
    await waitFor(() => expect(activity.textContent).toContain("Looks close."));
    expect(activity.textContent).toContain("pushed 2 commits");
    expect(activity.textContent).toContain("approved");

    const reply = slot.getByRole("textbox", { name: "Reply" });
    await act(async () =>
      fireEvent.change(reply, { target: { value: "Thanks, merging." } }),
    );
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Send" })),
    );
    expect(calls(slot, "commentPull")).toEqual([
      { repo: "get-bb/bb", number: 42, body: "Thanks, merging." },
    ]);
    expect(slot.getByRole("tabpanel").textContent).toMatch(
      /You commented.*sending….*Thanks, merging\./,
    );
    await act(async () => finishComment());
    await waitFor(() => expect(calls(slot, "getPull")).toHaveLength(2));
    expect(
      slot.getByRole("tabpanel").textContent?.split("Thanks, merging.").length,
    ).toBe(2);
  });

  it("shows the checks with their logs and re-runs the failed ones", async () => {
    const slot = renderPull({
      ...fakeGithub({
        checks: [check("lint", "failure", 9), check("build", "success")],
      }),
      rerunFailedChecks: () => ({ ok: true, runs: 1, checks: 1 }),
    });

    const checksTab = await slot.findByRole("tab", { name: /^Checks/ });
    await act(async () => fireEvent.click(checksTab));
    const panel = slot.getByRole("tabpanel");
    expect(panel.textContent).toContain("lint");
    expect(panel.textContent).toContain("Failed");
    const reruns = slot.getAllByRole("button", { name: "Re-run failed" });
    await act(async () => fireEvent.click(reruns.at(-1)!));
    expect(calls(slot, "rerunFailedChecks")).toEqual([
      { repo: "get-bb/bb", number: 42 },
    ]);
  });

  it("colours the diff stat like core, breaks it down by kind, and opens the files", async () => {
    const scrollIntoView = stubScrollIntoView();
    const slot = renderPull(fakeGithub({ changedFiles: 4, additions: 1300 }));

    const stat = await slot.findByRole("button", {
      name: "1300 lines added and 56 removed in 4 files. Show the files",
    });
    expect(stat.querySelector(".text-diff-added")?.textContent).toBe("+1,300");
    expect(stat.querySelector(".text-diff-removed")?.textContent).toBe("-56");
    expect(stat.querySelectorAll(".bg-diff-added")).toHaveLength(5);

    fireEvent.keyDown(document, { key: "Tab" });
    fireEvent.focus(stat);
    const tooltip = await slot.findByRole("tooltip");
    expect(tooltip.textContent).toBe(
      "Code+1,000-501 fileTests+200-61 fileDocs+34-01 fileNot listed+66-01 fileTotal+1,300-564 files",
    );

    await act(async () => fireEvent.click(stat));
    expect(
      slot.getByRole("tab", { name: /^Files/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("opens the Linear issue named in the title from the header", async () => {
    const slot = renderPull(
      fakeGithub({
        title: "Status menu [ENG-123]",
        comments: [
          {
            author: "linear",
            body: '<!-- linear-linkback --><a href="https://linear.app/acme/issue/ENG-123/status-menu">ENG-123 Status menu</a>',
            createdAt: "2026-08-20T00:00:00.000Z",
          },
        ],
      }),
    );

    const key = await slot.findByRole("button", {
      name: "Open ENG-123 in Linear",
    });
    await act(async () => key.click());
    expect(slot.navigateCalls).toContainEqual({
      method: "openUrl",
      url: "https://linear.app/acme/issue/ENG-123/status-menu",
    });
  });

  it("copies the head branch name from its chip", async () => {
    const slot = renderPull(fakeGithub());

    const chip = await slot.findByRole("button", {
      name: "Copy the branch name status-menu",
    });
    await act(async () => fireEvent.click(chip));
    expect(slot.experimental_clipboardWrites).toEqual([
      { text: "status-menu" },
    ]);
    expect(slot.getByText("Branch name copied")).toBeTruthy();
  });
});

describe("GitHub pull request status menu", () => {
  it("changes the status from its menu, keeps focus on the pill, and undoes it from the toast", async () => {
    const toaster = render(<Toaster />);
    const slot = renderPull(fakeGithub());

    openWithKeyboard(
      await slot.findByRole("button", {
        name: "Status: Open. Change the status",
      }),
    );
    expect(
      slot
        .getByRole("menuitemradio", { name: /^Open/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      slot.getAllByRole("menuitemradio").map((item) => item.textContent),
    ).toEqual([
      "DraftConvert to draft",
      "Open",
      "ClosedClose without merging",
      "MergedMerge…M",
    ]);

    await act(async () =>
      fireEvent.keyDown(
        slot.getByRole("menuitemradio", { name: /Convert to draft/ }),
        { key: "Enter" },
      ),
    );
    const draft = await slot.findByRole("button", {
      name: "Status: Draft. Change the status",
    });
    await waitFor(() => expect(document.activeElement).toBe(draft));
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 42, state: "draft" },
    ]);

    await toaster.findByText("#42 is a draft now");
    await act(async () =>
      fireEvent.click(toaster.getByRole("button", { name: "Undo" })),
    );
    await slot.findByRole("button", {
      name: "Status: Open. Change the status",
    });
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 42, state: "draft" },
      { repo: "get-bb/bb", number: 42, state: "open" },
    ]);
    toaster.unmount();
  });

  it("keeps the menu shut while a change is in flight", async () => {
    let finish = () => {};
    const github = fakeGithub();
    const slot = renderPull({
      ...github,
      setPullState: (input: unknown) =>
        new Promise<unknown>((resolve) => {
          finish = () => resolve(github.setPullState(input));
        }),
    });

    openWithKeyboard(
      await slot.findByRole("button", {
        name: "Status: Open. Change the status",
      }),
    );
    await act(async () =>
      fireEvent.keyDown(
        slot.getByRole("menuitemradio", { name: /Convert to draft/ }),
        { key: "Enter" },
      ),
    );
    const busy = slot.getByRole("button", { name: "Converting…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(busy));
    fireEvent.pointerDown(busy);
    expect(slot.queryByRole("menuitemradio")).toBeNull();

    await act(async () => finish());
    expect(
      await slot.findByRole("button", {
        name: "Status: Draft. Change the status",
      }),
    ).toBeTruthy();
  });

  it("closes only after a second press and then offers Reopen", async () => {
    const slot = renderPull(fakeGithub());

    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Open. Change the status",
      }),
    );
    fireEvent.click(
      slot.getByRole("menuitemradio", { name: /Close without merging/ }),
    );
    const confirm = slot.getByRole("menuitemradio", {
      name: /Close without merging\?/,
    });
    expect(confirm.textContent).toBe("Close without merging?Press again");
    expect(
      slot.getByText("Press Closed again to close #42 without merging"),
    ).toBeTruthy();
    expect(calls(slot, "setPullState")).toEqual([]);

    await act(async () => fireEvent.click(confirm));
    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Closed. Change the status",
      }),
    );
    expect(
      slot.getAllByRole("menuitemradio").map((item) => item.textContent),
    ).toEqual(["DraftReopen as a draft", "OpenReopen", "Closed"]);
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 42, state: "closed" },
    ]);
  });

  it("shows a plain Closed status when GitHub will not let the viewer reopen it", async () => {
    const slot = renderPull(fakeGithub({}, { canReopen: false }));

    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Open. Change the status",
      }),
    );
    fireEvent.click(
      slot.getByRole("menuitemradio", { name: /Close without merging/ }),
    );
    await act(async () =>
      fireEvent.click(
        slot.getByRole("menuitemradio", { name: /Close without merging\?/ }),
      ),
    );
    await waitFor(() =>
      expect(slot.queryByRole("button", { name: /^Status:/ })).toBeNull(),
    );
    expect(slot.getAllByText("Closed").length).toBeGreaterThan(0);
  });

  it("offers no Undo when reopening changed the draft flag", async () => {
    const toaster = render(<Toaster />);
    const slot = renderPull(
      fakeGithub({ state: "CLOSED", viewerCanReopen: true }),
    );

    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Closed. Change the status",
      }),
    );
    await act(async () =>
      fireEvent.click(
        slot.getByRole("menuitemradio", { name: /Reopen as a draft/ }),
      ),
    );
    await toaster.findByText("Reopened #42 as a draft");
    expect(toaster.queryByRole("button", { name: "Undo" })).toBeNull();
    toaster.unmount();
  });

  it("keeps the status when GitHub refuses the change, says why, and reloads", async () => {
    const toaster = render(<Toaster />);
    const slot = renderPull(
      fakeGithub(
        { state: "DRAFT", isDraft: true },
        {
          failWith:
            "gh pr ready 42 failed: GraphQL: Resource not accessible by integration",
        },
      ),
    );

    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Draft. Change the status",
      }),
    );
    await act(async () =>
      fireEvent.click(
        slot.getByRole("menuitemradio", { name: /Ready for review/ }),
      ),
    );
    await toaster.findByText("Couldn't update #42");
    expect(
      toaster.getByText(
        "gh pr ready 42 failed: GraphQL: Resource not accessible by integration",
      ),
    ).toBeTruthy();
    expect(
      await slot.findByRole("button", {
        name: "Status: Draft. Change the status",
      }),
    ).toBeTruthy();
    expect(calls(slot, "getPull")).toHaveLength(2);
    toaster.unmount();
  });

  it("shows a plain status when the pull request cannot change", async () => {
    for (const [initial, label] of [
      [{ state: "MERGED", mergedAt: "2026-08-21T00:00:00.000Z" }, "Merged"],
      [
        {
          viewerCanUpdate: false,
          viewerCanClose: false,
          viewerCanReopen: false,
          viewerCanMerge: false,
        },
        "Open",
      ],
    ] as const) {
      const slot = renderPull(fakeGithub(initial));
      await waitFor(() =>
        expect(slot.getAllByText(label).length).toBeGreaterThan(0),
      );
      expect(slot.queryByRole("button", { name: /^Status:/ })).toBeNull();
      slot.lifecycle.unmount();
    }
  });
});

describe("GitHub thread panel", () => {
  it("shows the linked pull request and keeps removed files out of workspace navigation", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr-1", params: null },
      {
        rpc: rpc({
          pullForThread: () => ({
            pull: { repo: "get-bb/bb", number: 42, environmentId: "env-1" },
          }),
          getPull: () => ({
            pull: pullDetail({
              title: "Navigation fix",
              files: [
                {
                  path: "removed.ts",
                  status: "removed",
                  additions: 0,
                  deletions: 1,
                  patch: "@@ -1 +0,0 @@\n-removed",
                },
                {
                  path: "modified.ts",
                  status: "modified",
                  additions: 1,
                  deletions: 0,
                  patch: "@@ -0,0 +1 @@\n+added",
                },
              ],
            }),
          }),
        }),
      },
    );

    const filesTab = await slot.findByRole("tab", { name: /^Files/ });
    await act(async () => fireEvent.click(filesTab));
    const removedFile = slot.getByText("removed.ts");
    const modifiedFile = slot.getByText("modified.ts");
    expect(removedFile.closest("a")).toBeNull();
    expect(modifiedFile.closest("a")?.getAttribute("href")).toBe(
      "./modified.ts",
    );
    const toggle = slot.getByRole("button", {
      name: "Collapse removed.ts diff",
    });
    expect(slot.getByTestId("bb-diff").getAttribute("data-path")).toBe(
      "removed.ts",
    );
    await act(async () => fireEvent.click(toggle));
    expect(slot.queryByTestId("bb-diff")).toBeNull();
    expect(toggle.getAttribute("aria-label")).toBe("Expand removed.ts diff");
  });

  it("lets the user pick a pull request when the thread has none", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr-1", params: null },
      {
        rpc: rpc({
          pullForThread: () => ({ pull: null }),
          getPull: () => ({
            pull: pullDetail({ number: 3, title: "Review me" }),
          }),
        }),
      },
    );

    const pick = await slot.findByRole("button", { name: /#3\s*Review me/ });
    await act(async () => fireEvent.click(pick));
    expect(calls(slot, "getPull")).toEqual([{ repo: "get-bb/bb", number: 3 }]);
  });
});

describe("GitHub issues", () => {
  it("lists open issues and opens one in the URL-backed page", async () => {
    const panel = app.navPanels[0]!;
    expect(panel.fixedTabs).toBeUndefined();
    const slot = renderInbox("issues", {
      listItems: (input) =>
        typeof input === "object" &&
        input !== null &&
        "kind" in input &&
        input.kind === "issue"
          ? {
              items: [
                issue(42, "Route-backed issue"),
                issue(41, "Old issue", "CLOSED"),
              ],
            }
          : { items: INBOX },
    });

    const row = await slot.findByRole("button", {
      name: "#42 Route-backed issue: open",
    });
    expect(slot.queryByText("Old issue")).toBeNull();
    await act(async () => fireEvent.click(row));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "issues/get-bb/bb/42" },
    });
  });
});

describe("GitHub ambient surfaces", () => {
  it("sums up the inbox on the home page and opens it", async () => {
    const slot = renderSlot(
      app.homepageSections[0]!,
      { projectId: "project-1" },
      { rpc: rpc() },
    );

    await slot.findByText("1 your move · 2 ready · 1 need fixing");
    expect(slot.getByText("Review me")).toBeTruthy();
    expect(slot.getByText("Fix the flaky shard")).toBeTruthy();
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Open the inbox" })),
    );
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
    });
  });

  it("says on the home page what a waiting agent asks, like the inbox", async () => {
    const slot = renderSlot(
      app.homepageSections[0]!,
      { projectId: "project-1" },
      {
        rpc: rpc({
          listLinks: () => ({
            links: { "pr:get-bb/bb#3": [link("thr-ask", 3, "review")] },
          }),
        }),
        sidebarThreads: {
          threads: [
            sidebarThread({
              id: "thr-ask",
              status: "active",
              hasPendingInteraction: true,
            }),
          ],
        },
        sdk: {
          threads: {
            interactions: { list: async () => [userQuestion("thr-ask")] },
          },
        },
      },
    );

    expect(
      await slot.findByText("#3 · Agent asks: Rebase on main or merge it in?"),
    ).toBeTruthy();
    expect(slot.queryByText("#3 · Your review is requested")).toBeNull();
  });

  it("shows the linked pull request in the thread header when core shows none", async () => {
    const slot = renderSlot(
      app.threadHeaderActions[0]!,
      { threadId: "thr-fix", projectId: "project-1", isCompactViewport: false },
      {
        rpc: rpc({
          pullForThread: () => ({
            pull: { repo: "get-bb/bb", number: 2, environmentId: null },
          }),
        }),
      },
    );

    const chip = await slot.findByRole("button", {
      name: "#2: 2 checks failing",
    });
    fireEvent.click(chip);
    expect(
      await slot.findByRole("button", { name: "Send the failing checks here" }),
    ).toBeTruthy();
    await act(async () =>
      fireEvent.click(
        slot.getByRole("button", { name: "Open in the GitHub panel" }),
      ),
    );
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/get-bb/bb/2" },
    });
  });

  it("stays out of the header when core already shows the pull request", async () => {
    const slot = renderSlot(
      app.threadHeaderActions[0]!,
      { threadId: "thr-fix", projectId: "project-1", isCompactViewport: false },
      {
        rpc: rpc({
          pullForThread: () => ({
            pull: { repo: "get-bb/bb", number: 2, environmentId: null },
          }),
        }),
        sidebarPullRequests: {
          "thr-fix": {
            number: 2,
            title: "Fix the flaky shard",
            url: "https://github.com/get-bb/bb/pull/2",
            state: "open",
            attention: "checks_failed",
            experimental_autoMerge: false,
            experimental_inMergeQueue: false,
            experimental_checks: { state: "failing" },
            experimental_review: { state: "none" },
            experimental_mergeability: { state: "mergeable" },
          },
        },
      },
    );

    await act(async () => {});
    expect(slot.container.textContent).toBe("");
    expect(calls(slot, "pullForThread")).toEqual([]);
  });

  it("puts each linked pull request's next step on its thread rows", async () => {
    const scripts = await mountPluginContentScripts(app, {
      pluginId: "github",
    });
    onTestFinished(() => scripts.lifecycle.dispose());
    const slot = renderSlot(
      app.appOverlays[0]!,
      {},
      {
        rpc: rpc({
          listLinks: () => ({
            links: {
              "pr:get-bb/bb#2": [link("thr-fix", 2, "fix")],
              "pr:get-bb/bb#1": [link("thr-ship", 1, null)],
            },
          }),
        }),
      },
    );

    await waitFor(() =>
      expect(scripts.inspection.getThreadRowStatus("thr-fix")).toEqual({
        icon: "CircleX",
        label: "#2 · 2 checks failing",
        tone: "error",
      }),
    );
    expect(scripts.inspection.getThreadRowStatus("thr-ship")).toEqual({
      icon: "CircleCheck",
      label: "#1 · 5 checks passed",
      tone: "success",
    });
    slot.lifecycle.unmount();
  });

  it("badges the panel with the pull requests that need the viewer", async () => {
    const useBadge = app.navPanels[0]!.experimental_useBadge!;
    function Probe() {
      const badge = useBadge();
      return (
        <output>
          {badge === null ? "none" : `${badge.count}|${badge.label}`}
        </output>
      );
    }
    const slot = renderSlot({ component: Probe }, {}, { rpc: rpc() });
    expect((await slot.findByText(/^4\|/)).textContent).toBe(
      "4|4 pull requests need you",
    );
  });

  it("registers palette commands that reach the inbox and the thread's pull request", async () => {
    expect(GITHUB_COMMANDS.map((command) => command.title)).toEqual([
      "GitHub: Open the inbox",
      "GitHub: Find a pull request…",
      "GitHub: Open this thread's pull request",
    ]);
    const threadPull = GITHUB_COMMANDS[2]!;
    const openPanel = vi.fn(() => true);
    const context = (threadId: string | null): PluginCommandContext => ({
      threadId,
      projectId: "project-1",
      openPanel,
    });
    expect(threadPull.isAvailable?.(context(null))).toBe(false);
    expect(threadPull.isAvailable?.(context("thr-1"))).toBe(true);
    await threadPull.run(context("thr-1"));
    expect(openPanel).toHaveBeenCalledWith({ actionId: "pull" });

    const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: rpc() });
    await act(async () => {});
    await GITHUB_COMMANDS[0]!.run(context(null));
    expect(overlay.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
    });
    overlay.lifecycle.unmount();
  });
});
