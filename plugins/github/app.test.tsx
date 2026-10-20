// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { act } from "react";
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
