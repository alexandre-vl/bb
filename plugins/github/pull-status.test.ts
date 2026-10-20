import { describe, expect, it } from "vitest";
import {
  assemblePullStatus,
  pullGlyph,
  pullGroup,
  pullNextStep,
  pullStateCommands,
  stackNotes,
  type RawPullStatus,
} from "./pull-status.js";

function raw(overrides: Partial<RawPullStatus> = {}): RawPullStatus {
  return {
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature",
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
