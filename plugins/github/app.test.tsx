// @vitest-environment jsdom

import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Toaster } from "sonner";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { assemblePullStatus, type RawPullStatus } from "./pull-status";

const app = await loadPluginApp(() => import("./app"));

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
      mergeable: "MERGEABLE",
      reviewDecision: null,
      isInMergeQueue: false,
      requestedReviewers: [],
      checkRunCounts: [{ state: "SUCCESS", count: 5 }],
      statusContextCounts: [],
      ...overrides,
    }),
  };
}

describe("GitHub pull request inbox", () => {
  it("groups pull requests by what they need next and says why on the second line", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "pulls" },
      {
        rpc: {
          listItems: () => ({
            items: [
              pull(1, "feat(list): Ship the inbox", "octocat"),
              pull(2, "Fix the flaky shard", "hubot", {
                isDraft: true,
                checkRunCounts: [
                  { state: "FAILURE", count: 2 },
                  { state: "SUCCESS", count: 3 },
                ],
              }),
              pull(3, "Review me", "hubot", {
                requestedReviewers: ["octocat"],
              }),
              pull(4, "Still a draft", "hubot", { isDraft: true }),
              pull(5, "Build on the inbox", "hubot", {
                baseRefName: "branch-1",
              }),
            ],
          }),
          listLinks: () => ({ links: {} }),
          status: () => ({
            ghOk: true,
            ghState: "ready",
            ghError: null,
            repos: [{ repo: "get-bb/bb", projectId: null }],
            lastSyncedAt: null,
          }),
          viewer: () => ({ login: "octocat" }),
        },
      },
    );

    await slot.findByText("Ship the inbox");
    await act(async () => {});
    const groups = slot
      .getAllByRole("region")
      .map((region) => region.querySelector("button")?.textContent);
    expect(groups).toEqual([
      "Your move1",
      "Ready to merge2",
      "Needs fixing1",
      "Drafts1",
    ]);
    expect(slot.getByText("feat(list):")).toBeTruthy();
    expect(slot.getByText("Your review is requested")).toBeTruthy();
    expect(slot.getByText("2 checks failing")).toBeTruthy();
    expect(slot.getByText("has #5 on top")).toBeTruthy();
    expect(slot.getByText("stacked on #1")).toBeTruthy();
    expect(slot.queryByText("Still a draft")).toBeNull();

    await act(async () => slot.getByRole("button", { name: /Drafts/ }).click());
    expect(slot.getByText("Still a draft")).toBeTruthy();

    await act(async () =>
      slot.getByRole("button", { name: /^#3 Review me/ }).click(),
    );
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/get-bb/bb/3" },
    });
    slot.lifecycle.unmount();
  });
});

describe("GitHub app navigation", () => {
  it("opens issue details in the URL-backed page instead of a fixed tab", async () => {
    const panel = app.navPanels[0]!;
    expect(panel.fixedTabs).toBeUndefined();

    const slot = renderSlot(
      panel,
      { subPath: "issues" },
      {
        rpc: {
          listItems: () => ({
            items: [
              {
                repo: "get-bb/bb",
                number: 42,
                kind: "issue",
                title: "Route-backed issue",
                state: "OPEN",
                author: "octocat",
                labels: [],
                assignees: [],
                url: "https://github.com/get-bb/bb/issues/42",
                body: "",
                updatedAt: "2026-08-20T00:00:00.000Z",
              },
            ],
          }),
          listLinks: () => ({ links: {} }),
          status: () => ({
            ghOk: true,
            ghState: "ready",
            ghError: null,
            repos: [{ repo: "get-bb/bb", projectId: null }],
            lastSyncedAt: null,
          }),
          viewer: () => ({ login: "octocat" }),
        },
      },
    );

    (await slot.findByText("Route-backed issue")).click();
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "issues/get-bb/bb/42" },
    });
    slot.lifecycle.unmount();
  });

  it("keeps removed pull-request files out of live workspace navigation", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr-1", params: null },
      {
        rpc: {
          pullForThread: () => ({
            pull: {
              repo: "get-bb/bb",
              number: 42,
              environmentId: "env-1",
            },
          }),
          getPull: () => ({
            pull: {
              repo: "get-bb/bb",
              number: 42,
              title: "Navigation fix",
              state: "OPEN",
              author: "octocat",
              body: "",
              url: "https://github.com/get-bb/bb/pull/42",
              createdAt: "2026-08-20T00:00:00.000Z",
              updatedAt: "2026-08-20T00:00:00.000Z",
              baseRefName: "main",
              headRefName: "fix-navigation",
              additions: 1,
              deletions: 1,
              changedFiles: 2,
              labels: [],
              assignees: [],
              reviewDecision: "",
              mergeStateStatus: "CLEAN",
              reviewRequests: [],
              checks: [],
              comments: [],
              reviews: [],
              reviewThreads: [],
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
            },
          }),
          listLinks: () => ({ links: {} }),
        },
      },
    );

    await act(async () => {});
    const removedFile = slot.getByText("removed.ts");
    const modifiedFile = slot.getByText("modified.ts");
    expect(removedFile.closest("a")).toBeNull();
    expect(modifiedFile.closest("a")?.getAttribute("href")).toBe(
      "./modified.ts",
    );

    const diffToggle = removedFile.parentElement?.querySelector("button");
    if (!(diffToggle instanceof HTMLButtonElement)) {
      throw new Error("removed file diff toggle was not rendered");
    }
    expect(diffToggle.getAttribute("aria-label")).toBe(
      "Expand removed.ts diff",
    );
    await act(async () => diffToggle.click());
    const diff = slot.getByTestId("bb-diff");
    expect(diff.getAttribute("data-path")).toBe("removed.ts");
    expect(diffToggle.getAttribute("aria-label")).toBe(
      "Collapse removed.ts diff",
    );
    slot.lifecycle.unmount();
  });
});

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
    reviewRequests: [],
    checks: [],
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
    viewerCanUpdate: true,
    viewerCanClose: true,
    viewerCanReopen: false,
    ...overrides,
  };
}

function fakeGithub(
  initial: Record<string, unknown> = {},
  options: { canReopen?: boolean; failWith?: string } = {},
) {
  let pull = pullDetail(initial);
  return {
    getPull: () => ({ pull }),
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
        target === "draft" ? true : target === "open" ? false : pull.isDraft;
      pull = {
        ...pull,
        state: closed ? "CLOSED" : isDraft ? "DRAFT" : "OPEN",
        isDraft,
        viewerCanReopen: closed && (options.canReopen ?? true),
      };
      return { ok: true, state: target };
    },
  };
}

function renderPull(github: {
  getPull: () => unknown;
  setPullState: (input: unknown) => unknown;
}) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "pulls/get-bb/bb/42" },
    {
      rpc: {
        ...github,
        listItems: () => ({ items: [] }),
        listLinks: () => ({ links: {} }),
        status: () => ({
          ghOk: true,
          ghState: "ready",
          ghError: null,
          repos: [{ repo: "get-bb/bb", projectId: null }],
          lastSyncedAt: null,
        }),
        viewer: () => ({ login: "octocat" }),
      },
    },
  );
}

function stateCalls(slot: ReturnType<typeof renderPull>) {
  return slot.rpcCalls
    .filter((call) => call.method === "setPullState")
    .map((call) => call.input);
}

function openWithKeyboard(trigger: HTMLElement) {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("GitHub pull request header", () => {
  afterEach(cleanup);

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
    ).toEqual(["DraftConvert to draft", "Open", "ClosedClose without merging"]);

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
    expect(stateCalls(slot)).toEqual([
      { repo: "get-bb/bb", number: 42, state: "draft" },
    ]);

    await toaster.findByText("#42 is a draft now");
    await act(async () =>
      fireEvent.click(toaster.getByRole("button", { name: "Undo" })),
    );
    await slot.findByRole("button", {
      name: "Status: Open. Change the status",
    });
    expect(stateCalls(slot)).toEqual([
      { repo: "get-bb/bb", number: 42, state: "draft" },
      { repo: "get-bb/bb", number: 42, state: "open" },
    ]);
    slot.lifecycle.unmount();
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
    slot.lifecycle.unmount();
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
    expect(stateCalls(slot)).toEqual([]);

    await act(async () => fireEvent.click(confirm));
    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Closed. Change the status",
      }),
    );
    expect(
      slot.getAllByRole("menuitemradio").map((item) => item.textContent),
    ).toEqual(["DraftReopen as a draft", "OpenReopen", "Closed"]);
    expect(stateCalls(slot)).toEqual([
      { repo: "get-bb/bb", number: 42, state: "closed" },
    ]);
    slot.lifecycle.unmount();
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
    expect(slot.getByText("Closed")).toBeTruthy();
    slot.lifecycle.unmount();
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
    slot.lifecycle.unmount();
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
    expect(
      slot.rpcCalls.filter((call) => call.method === "getPull"),
    ).toHaveLength(2);
    slot.lifecycle.unmount();
    toaster.unmount();
  });

  it("shows a plain status when the pull request cannot change", async () => {
    for (const [initial, label] of [
      [{ state: "MERGED" }, "Merged"],
      [
        {
          viewerCanUpdate: false,
          viewerCanClose: false,
          viewerCanReopen: false,
        },
        "Open",
      ],
    ] as const) {
      const slot = renderPull(fakeGithub(initial));
      expect(await slot.findByText(label)).toBeTruthy();
      expect(slot.queryByRole("button", { name: /^Status:/ })).toBeNull();
      slot.lifecycle.unmount();
    }
  });

  it("colours the diff stat like core, breaks it down by kind, and jumps to the files", async () => {
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
        delete (Element.prototype as { scrollIntoView?: unknown })
          .scrollIntoView;
      }
    });
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
    expect(
      slot.getByText(/^Code/, { selector: "p > span" }).parentElement
        ?.textContent,
    ).toBe("Code +1,000 -50Tests +200 -6Docs +34 -0");

    fireEvent.click(stat);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      behavior: "smooth",
    });
    slot.lifecycle.unmount();
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
    slot.lifecycle.unmount();
  });
});
