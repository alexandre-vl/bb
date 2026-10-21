import { describe, expect, it } from "vitest";
import {
  assemblePullStatus,
  COLLAPSED_PULL_GROUPS,
  inPullView,
  mergeBlockedReason,
  pullGlyph,
  pullGroup,
  pullNextStep,
  pullPreset,
  pullStateCommands,
  stackChain,
  stackNotes,
  type RawPullStatus,
} from "./pull-status.js";

function raw(overrides: Partial<RawPullStatus> = {}): RawPullStatus {
  return {
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature",
    headRefOid: "0000000",
    isCrossRepository: false,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    mergedAt: null,
    checksVerdict: null,
    stack: null,
    headOwner: null,
    mergeable: "MERGEABLE",
    reviewDecision: null,
    isInMergeQueue: false,
    requestedReviewers: [],
    checkRunCounts: [{ state: "SUCCESS", count: 4 }],
    statusContextCounts: [],
    ...overrides,
  };
}

describe("pull request groups", () => {
  it("puts a review requested from the viewer in Your move, and leaves others waiting", () => {
    const status = assemblePullStatus(raw({ requestedReviewers: ["Octocat"] }));
    expect(pullGroup(status, "alice", "octocat")).toBe("you");
    expect(pullGroup(status, "alice", "hubot")).toBe("review");
    expect(pullGroup(status, "alice", null)).toBe("review");
    expect(pullNextStep(status, "you")).toBe("Your review is requested");
    expect(pullNextStep(status, "review")).toBe("Review requested");
    expect(pullGlyph(status, "you")).toMatchObject({
      icon: "Eye",
      tone: "you",
    });
  });

  it("puts changes requested on the viewer's own pull request in Your move", () => {
    const status = assemblePullStatus(
      raw({ reviewDecision: "CHANGES_REQUESTED" }),
    );
    expect(pullGroup(status, "alice", "alice")).toBe("you");
    expect(pullGroup(status, "alice", "bob")).toBe("fixing");
    expect(pullNextStep(status, "you")).toBe("Changes requested");
    expect(pullGlyph(status, "you").tone).toBe("action");
  });

  it("ranks conflicts and failing checks above a draft, and keeps drafts out of Ready", () => {
    const failingDraft = assemblePullStatus(
      raw({ isDraft: true, checkRunCounts: [{ state: "FAILURE", count: 1 }] }),
    );
    expect(failingDraft.state).toBe("draft");
    expect(pullGroup(failingDraft, "alice", null)).toBe("fixing");
    expect(pullNextStep(failingDraft, "fixing")).toBe("1 check failing");

    const greenDraft = assemblePullStatus(raw({ isDraft: true }));
    expect(pullGroup(greenDraft, "alice", null)).toBe("draft");
    expect(pullNextStep(greenDraft, "draft")).toBe("4 checks passed");

    const conflicting = assemblePullStatus(
      raw({
        mergeable: "CONFLICTING",
        checkRunCounts: [{ state: "FAILURE", count: 3 }],
      }),
    );
    expect(conflicting.attention).toBe("conflicts");
    expect(pullNextStep(conflicting, "fixing")).toBe("Conflicts with main");
  });

  it("does not call a pull request ready while GitHub has not computed mergeability", () => {
    const unknown = assemblePullStatus(raw({ mergeable: "UNKNOWN" }));
    expect(unknown.attention).toBe("none");
    expect(pullGroup(unknown, "alice", null)).toBe("open");
    expect(pullGlyph(unknown, "open")).toMatchObject({
      icon: "GitPullRequest",
      tone: "waiting",
    });
  });

  it("keeps a pull request in a merge queue out of Ready to merge", () => {
    const queued = assemblePullStatus(raw({ isInMergeQueue: true }));
    expect(queued.attention).toBe("queued");
    expect(pullGroup(queued, "alice", null)).toBe("progress");
    expect(pullNextStep(queued, "progress")).toBe("Queued to merge");
  });

  it("names the base of merged pull requests and ignores their checks", () => {
    const merged = assemblePullStatus(
      raw({ state: "MERGED", baseRefName: "release", checkRunCounts: [] }),
    );
    expect(pullGroup(merged, "alice", "alice")).toBe("merged");
    expect(pullNextStep(merged, "merged")).toBe("Merged into release");
    expect(pullGlyph(merged, "merged").tone).toBe("merged");
  });
});

describe("snoozed and agent-aware groups", () => {
  it("parks a snoozed pull request in Snoozed until it is merged or closed", () => {
    const failing = assemblePullStatus(
      raw({ checkRunCounts: [{ state: "FAILURE", count: 1 }] }),
    );
    expect(pullGroup(failing, "alice", null, { snoozed: true })).toBe(
      "snoozed",
    );
    expect(pullGlyph(failing, "snoozed")).toMatchObject({
      icon: "TimeSchedule",
      label: "Snoozed",
    });
    const merged = assemblePullStatus(raw({ state: "MERGED" }));
    expect(pullGroup(merged, "alice", null, { snoozed: true })).toBe("merged");
  });

  it("moves a waiting agent to Your move and a running one to In progress", () => {
    const conflicting = assemblePullStatus(raw({ mergeable: "CONFLICTING" }));
    expect(pullGroup(conflicting, "alice", null, { agent: "waiting" })).toBe(
      "you",
    );
    expect(pullGlyph(conflicting, "you", "waiting")).toMatchObject({
      icon: "MessageQuestion",
      label: "Waiting for you",
    });
    expect(pullGroup(conflicting, "alice", null, { agent: "running" })).toBe(
      "progress",
    );
    expect(pullGlyph(conflicting, "progress", "running").tone).toBe("working");
    expect(pullGroup(conflicting, "alice", null, { agent: "done" })).toBe(
      "fixing",
    );
  });

  it("says Waiting for GitHub while mergeability is unknown", () => {
    const unknown = assemblePullStatus(raw({ mergeable: "UNKNOWN" }));
    expect(pullNextStep(unknown, "open")).toBe("Waiting for GitHub");
  });
});

describe("views", () => {
  it("keeps the inbox to what needs someone, and Mine to the viewer's own", () => {
    expect(inPullView("inbox", "fixing", "alice", "bob")).toBe(true);
    expect(inPullView("inbox", "snoozed", "alice", "bob")).toBe(true);
    expect(inPullView("inbox", "review", "alice", "bob")).toBe(false);
    expect(inPullView("inbox", "draft", "alice", "bob")).toBe(false);
    expect(inPullView("mine", "draft", "Alice", "alice")).toBe(true);
    expect(inPullView("mine", "draft", "alice", "bob")).toBe(false);
    expect(inPullView("mine", "draft", "alice", null)).toBe(false);
    expect(inPullView("all", "closed", "alice", null)).toBe(true);
    expect(inPullView("all", "merged", "alice", null)).toBe(false);
    expect(inPullView("merged", "merged", "alice", null)).toBe(true);
    expect([...COLLAPSED_PULL_GROUPS.inbox]).toEqual(["snoozed"]);
  });
});

describe("agent presets and merge reasons", () => {
  it("picks the preset from what the pull request needs", () => {
    expect(
      pullPreset(assemblePullStatus(raw({ mergeable: "CONFLICTING" }))),
    ).toBe("conflicts");
    expect(
      pullPreset(
        assemblePullStatus(
          raw({ checkRunCounts: [{ state: "FAILURE", count: 1 }] }),
        ),
      ),
    ).toBe("fix");
    expect(pullPreset(assemblePullStatus(raw({ isDraft: true })))).toBe(
      "finish",
    );
    expect(pullPreset(assemblePullStatus(raw()))).toBe("review");
  });

  it("says why a pull request cannot be merged yet", () => {
    expect(mergeBlockedReason(assemblePullStatus(raw()))).toBeNull();
    expect(mergeBlockedReason(assemblePullStatus(raw({ isDraft: true })))).toBe(
      "Mark it ready first",
    );
    expect(
      mergeBlockedReason(
        assemblePullStatus(
          raw({ checkRunCounts: [{ state: "FAILURE", count: 2 }] }),
        ),
      ),
    ).toBe("2 checks failing");
    expect(
      mergeBlockedReason(assemblePullStatus(raw({ mergeable: "CONFLICTING" }))),
    ).toBe("Conflicts with main");
    expect(
      mergeBlockedReason(assemblePullStatus(raw({ isInMergeQueue: true }))),
    ).toBe("Queued to merge");
  });
});

describe("stack chains", () => {
  const pull = (
    number: number,
    head: string,
    base: string,
    state = "OPEN",
  ) => ({
    repo: "acme/one",
    number,
    pr: assemblePullStatus(
      raw({
        state: state as RawPullStatus["state"],
        headRefName: head,
        baseRefName: base,
      }),
    ),
  });

  it("walks down to the root and up through the first child", () => {
    const pulls = [
      pull(1, "a", "main"),
      pull(2, "b", "a"),
      pull(3, "c", "b"),
      pull(4, "x", "b"),
      pull(5, "lone", "main"),
      pull(6, "d", "c", "MERGED"),
    ];
    const numbers = (index: number) =>
      stackChain(pulls[index]!, pulls)?.map((entry) => entry.number) ?? null;
    expect(numbers(0)).toEqual([1, 2, 3]);
    expect(numbers(1)).toEqual([1, 2, 3]);
    expect(numbers(3)).toEqual([1, 2, 4]);
    expect(numbers(4)).toBeNull();
    expect(numbers(5)).toBeNull();
  });

  it("stops on a cycle", () => {
    const pulls = [pull(1, "a", "b"), pull(2, "b", "a")];
    expect(stackChain(pulls[0]!, pulls)?.map((entry) => entry.number)).toEqual([
      2, 1,
    ]);
  });
});

describe("stack notes", () => {
  it("describes each open pull request built on another one in the same repository", () => {
    const pull = (
      repo: string,
      number: number,
      head: string,
      base: string,
    ) => ({
      repo,
      number,
      pr: assemblePullStatus(raw({ headRefName: head, baseRefName: base })),
    });
    const notes = stackNotes([
      pull("acme/one", 1, "a", "main"),
      pull("acme/one", 2, "b", "a"),
      pull("acme/one", 3, "c", "b"),
      pull("acme/two", 4, "d", "a"),
      {
        repo: "acme/one",
        number: 5,
        pr: assemblePullStatus(
          raw({ state: "MERGED", headRefName: "e", baseRefName: "c" }),
        ),
      },
    ]);
    expect(Object.fromEntries(notes)).toEqual({
      "acme/one#1": "has #2 on top",
      "acme/one#2": "stacked on #1",
      "acme/one#3": "stacked on #2",
    });
  });
});

describe("pull request state changes", () => {
  it("runs the gh commands that reach each state", () => {
    const open = { state: "OPEN", isDraft: false } as const;
    const draft = { state: "OPEN", isDraft: true } as const;
    const closed = { state: "CLOSED", isDraft: false } as const;
    const closedDraft = { state: "CLOSED", isDraft: true } as const;

    expect(pullStateCommands(open, "draft")).toEqual([["ready", "--undo"]]);
    expect(pullStateCommands(open, "closed")).toEqual([["close"]]);
    expect(pullStateCommands(open, "open")).toEqual([]);
    expect(pullStateCommands(draft, "open")).toEqual([["ready"]]);
    expect(pullStateCommands(draft, "closed")).toEqual([["close"]]);
    expect(pullStateCommands(closed, "open")).toEqual([["reopen"]]);
    expect(pullStateCommands(closed, "draft")).toEqual([
      ["reopen"],
      ["ready", "--undo"],
    ]);
    expect(pullStateCommands(closedDraft, "open")).toEqual([
      ["reopen"],
      ["ready"],
    ]);
    expect(pullStateCommands(closedDraft, "draft")).toEqual([["reopen"]]);
    expect(pullStateCommands(closed, "closed")).toEqual([]);
  });

  it("refuses to change a merged pull request", () => {
    expect(() =>
      pullStateCommands({ state: "MERGED", isDraft: false }, "open"),
    ).toThrow("A merged pull request keeps its state.");
  });
});
