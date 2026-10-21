import { describe, expect, it } from "vitest";
import {
  addQueryToken,
  buildSuggestions,
  detailPullStatus,
  groupPullEvents,
  inboxCount,
  issueGroups,
  linearLinkback,
  openedAsDraft,
  pullEventText,
  pullRowModels,
  pullViewGroups,
  readingOrder,
  changeBreakdown,
  changeKind,
  DEFAULT_DISPLAY,
  diffSizeBlocks,
  issueKeyOf,
  matchesQuery,
  middleTruncate,
  parseDisplay,
  parseQuery,
  parseSubPath,
  pullStateOptions,
  queryChips,
  removeQueryToken,
  routeToSubPath,
  splitTitle,
  unlistedChange,
  type Item,
  type Route,
} from "./app-logic.js";
import { assemblePullStatus, type RawPullStatus } from "./pull-status.js";

const issue: Item = {
  repo: "acme/widgets",
  number: 7,
  kind: "issue",
  title: "Fix cache invalidation",
  state: "OPEN",
  author: "alice",
  labels: ["bug", "good first issue"],
  assignees: ["octocat"],
  url: "https://github.com/acme/widgets/issues/7",
  body: "",
  updatedAt: "2026-08-19T12:00:00Z",
  pr: null,
  snooze: null,
};

describe("github panel routes", () => {
  it("round-trips list, create, issue, and pull routes", () => {
    const routes: Route[] = [
      { view: "issues" },
      { view: "pulls", tab: "inbox" },
      { view: "pulls", tab: "mine" },
      { view: "pulls", tab: "all" },
      { view: "pulls", tab: "merged" },
      { view: "new" },
      { view: "issue", repo: "acme/widgets", number: 7 },
      { view: "pull", repo: "get-bb/bb", number: 42 },
    ];

    for (const route of routes) {
      expect(parseSubPath(routeToSubPath(route))).toEqual(route);
    }
  });

  it("falls back to the owning list for malformed detail paths", () => {
    expect(parseSubPath("pulls/acme/widgets/not-a-number")).toEqual({
      view: "pulls",
      tab: "inbox",
    });
    expect(parseSubPath("pulls/everything")).toEqual({
      view: "pulls",
      tab: "inbox",
    });
    expect(parseSubPath("issues/acme/widgets/not-a-number")).toEqual({
      view: "issues",
    });
    expect(parseSubPath("issues/acme/widgets/7/extra")).toEqual({
      view: "issues",
    });
    expect(parseSubPath("")).toEqual({ view: "pulls", tab: "inbox" });
    expect(parseSubPath("somewhere/else")).toEqual({
      view: "pulls",
      tab: "inbox",
    });
  });
});

describe("github panel query engine", () => {
  it("parses quoted qualifiers and matches viewer-relative filters", () => {
    const parsed = parseQuery(
      'is:open assignee:@me author:alice label:"good first issue" repo:acme/widgets #7',
    );

    expect(parsed).toEqual({
      states: ["OPEN"],
      flags: [],
      ci: [],
      agents: [],
      bases: [],
      stack: null,
      assignees: ["@me"],
      authors: ["alice"],
      labels: ["good first issue"],
      repos: ["acme/widgets"],
      noAssignee: false,
      noLabel: false,
      text: ["#7"],
    });
    expect(matchesQuery(issue, parsed, "octocat")).toBe(true);
    expect(matchesQuery(issue, parsed, null)).toBe(false);
  });

  it("applies negative, state, and plain-text filters independently", () => {
    expect(matchesQuery(issue, parseQuery("is:closed"), "octocat")).toBe(false);
    expect(matchesQuery(issue, parseQuery("no:assignee"), "octocat")).toBe(
      false,
    );
    expect(matchesQuery(issue, parseQuery("no:label"), "octocat")).toBe(false);
    expect(
      matchesQuery(issue, parseQuery("cache acme/widgets"), "octocat"),
    ).toBe(true);
    expect(matchesQuery(issue, parseQuery("missing"), "octocat")).toBe(false);
    expect(matchesQuery(issue, parseQuery("state:"), "octocat")).toBe(true);
  });

  it("builds bounded qualifier values without losing labels containing spaces", () => {
    const vocab = {
      users: ["alice", "octocat"],
      labels: ["bug", "good first issue"],
      repos: ["acme/widgets"],
    };
    const compact = (token: string, kind: "issue" | "pr") =>
      buildSuggestions(token, vocab, kind, "octocat").map(
        ({ insert, label }) => ({ insert, label }),
      );

    expect(compact("is:", "pr").map(({ label }) => label)).toEqual([
      "open",
      "closed",
      "merged",
      "draft",
      "ready",
      "conflict",
      "failing",
      "stacked",
      "snoozed",
    ]);
    expect(compact("is:", "issue").map(({ label }) => label)).toEqual([
      "open",
      "closed",
    ]);
    expect(compact("ci:fa", "pr")).toEqual([
      { insert: "ci:failing ", label: "failing" },
    ]);
    expect(compact("ci:", "issue")).toEqual([]);
    expect(compact("", "issue").map(({ label }) => label)).not.toContain("ci:");
    expect(compact("label:good", "issue")).toEqual([
      {
        insert: 'label:"good first issue" ',
        label: "good first issue",
      },
    ]);
    expect(compact("assignee:@", "issue")).toEqual([
      { insert: "assignee:@me ", label: "@me (octocat)" },
    ]);
    expect(compact("no:l", "issue")).toEqual([
      { insert: "no:label ", label: "no:label" },
    ]);
    expect(compact("unknown:value", "issue")).toEqual([]);
    expect(buildSuggestions("is:o", vocab, "pr", "octocat")[0]?.icon).toEqual({
      kind: "state",
      itemKind: "pr",
      state: "OPEN",
    });
    expect(
      buildSuggestions("author:ali", vocab, "issue", "octocat")[0]?.icon,
    ).toEqual({ kind: "avatar", login: "alice" });
  });
});

function raw(overrides: Partial<RawPullStatus> = {}): RawPullStatus {
  return {
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature/cache",
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

function pull(overrides: Partial<RawPullStatus> = {}, author = "alice"): Item {
  return {
    ...issue,
    kind: "pr",
    number: 42,
    title: "feat(cache): drop stale entries",
    author,
    labels: [],
    assignees: [],
    pr: assemblePullStatus(raw(overrides)),
  };
}

describe("pull request qualifiers", () => {
  const matches = (
    item: Item,
    query: string,
    extra: Parameters<typeof matchesQuery>[3] = {},
  ) => matchesQuery(item, parseQuery(query), "octocat", extra);

  it("finds drafts with is:draft, although GitHub reports them as open", () => {
    const draft = pull({ isDraft: true });
    expect(draft.state).toBe("OPEN");
    expect(matches(draft, "is:draft")).toBe(true);
    expect(matches(draft, "is:open is:draft")).toBe(true);
    expect(matches(pull(), "is:draft")).toBe(false);
    expect(matches(issue, "is:draft")).toBe(false);
  });

  it("matches readiness, conflicts, and failing checks from the list status", () => {
    expect(matches(pull(), "is:ready")).toBe(true);
    expect(matches(pull({ mergeable: "CONFLICTING" }), "is:conflict")).toBe(
      true,
    );
    expect(matches(pull({ mergeable: "CONFLICTING" }), "is:conflicts")).toBe(
      true,
    );
    const failing = pull({ checkRunCounts: [{ state: "FAILURE", count: 2 }] });
    expect(matches(failing, "is:failing")).toBe(true);
    expect(matches(failing, "is:ready")).toBe(false);
    expect(matches(failing, "is:draft is:failing")).toBe(false);
  });

  it("matches ci: by the checks state and ORs repeated values", () => {
    const running = pull({
      checkRunCounts: [{ state: "IN_PROGRESS", count: 1 }],
    });
    expect(matches(running, "ci:running")).toBe(true);
    expect(matches(running, "ci:pending")).toBe(true);
    expect(matches(running, "ci:failing")).toBe(false);
    expect(matches(running, "ci:failing ci:running")).toBe(true);
    expect(matches(pull(), "ci:passing")).toBe(true);
    expect(matches(pull({ checkRunCounts: [] }), "ci:none")).toBe(true);
  });

  it("uses the caller's stack, snooze, and agent facts", () => {
    expect(matches(pull(), "stack:yes", { stacked: true })).toBe(true);
    expect(matches(pull(), "stack:no", { stacked: true })).toBe(false);
    expect(matches(pull(), "is:stacked")).toBe(false);
    expect(matches(pull(), "is:snoozed", { snoozed: true })).toBe(true);
    expect(matches(pull(), "agent:none")).toBe(true);
    expect(matches(pull(), "agent:any", { agent: "waiting" })).toBe(true);
    expect(matches(pull(), "agent:running", { agent: "waiting" })).toBe(false);
    expect(matches(pull(), "agent:bogus", { agent: "waiting" })).toBe(false);
  });

  it("matches base:, author:me, and the head branch as plain text", () => {
    expect(matches(pull(), "base:main")).toBe(true);
    expect(matches(pull(), "base:dev")).toBe(false);
    expect(matches(pull({}, "octocat"), "author:me")).toBe(true);
    expect(matches(pull({}, "octocat"), "author:@me")).toBe(true);
    expect(matches(pull(), "author:me")).toBe(false);
    expect(matches(pull(), "feature/cache")).toBe(true);
  });
});

describe("filter chips", () => {
  it("describes each token and removes one at a time", () => {
    const query = "is:draft author:me ci:failing cache ";
    expect(queryChips(query, "octocat")).toEqual([
      { index: 0, key: "Is", value: "a draft" },
      { index: 1, key: "Author is", value: "octocat" },
      { index: 2, key: "Checks are", value: "failing" },
      { index: 3, key: "Contains", value: "cache" },
    ]);
    expect(removeQueryToken(query, 1)).toBe("is:draft ci:failing cache ");
    expect(removeQueryToken("is:draft", 0)).toBe("");
    expect(addQueryToken("is:draft", "stack:yes")).toBe("is:draft stack:yes ");
    expect(addQueryToken("", "ci:failing")).toBe("ci:failing ");
  });
});

describe("titles and branches", () => {
  it("splits the conventional prefix and the trailing issue key", () => {
    expect(splitTitle("feat(api): add retries (LIN-123)")).toEqual({
      prefix: "feat(api):",
      text: "add retries",
      issueKey: "LIN-123",
    });
    expect(splitTitle("Add retries")).toEqual({
      prefix: null,
      text: "Add retries",
      issueKey: null,
    });
    expect(issueKeyOf("Add retries", "alex/lin-77-retries")).toBe("LIN-77");
    expect(issueKeyOf("Add retries", "feature/retries")).toBeNull();
  });

  it("truncates a branch in the middle", () => {
    expect(middleTruncate("short", 10)).toBe("short");
    expect(middleTruncate("alexandre/very-long-branch-name", 11)).toBe(
      "alexa…-name",
    );
  });
});

describe("display preferences", () => {
  it("falls back to the defaults for missing or malformed values", () => {
    expect(parseDisplay(null)).toEqual(DEFAULT_DISPLAY);
    expect(parseDisplay("not json")).toEqual(DEFAULT_DISPLAY);
    expect(
      parseDisplay(
        JSON.stringify({
          groupBy: "author",
          density: "compact",
          show: { checks: true, author: "yes" },
        }),
      ),
    ).toEqual({
      groupBy: "author",
      density: "compact",
      show: { ...DEFAULT_DISPLAY.show, checks: true },
    });
  });
});

describe("pull request diff stat", () => {
  it("sorts changed files into code, tests, docs, and generated files", () => {
    expect(
      Object.fromEntries(
        [
          "plugins/github/app.tsx",
          "plugins/github/app.test.tsx",
          "plugins/github/testing/fake-gh.ts",
          "src/__tests__/cache.ts",
          "pkg/cache_test.go",
          "tests/test_cache.py",
          "README.md",
          "docs/plugins/github.mdx",
          "LICENSE",
          "pnpm-lock.yaml",
          "packages/sdk/dist/index.js",
          "src/__snapshots__/view.test.tsx.snap",
          "src/schema.generated.ts",
          "src/latest.ts",
          "src/contest.ts",
        ].map((path) => [path, changeKind(path)]),
      ),
    ).toEqual({
      "plugins/github/app.tsx": "code",
      "plugins/github/app.test.tsx": "tests",
      "plugins/github/testing/fake-gh.ts": "tests",
      "src/__tests__/cache.ts": "tests",
      "pkg/cache_test.go": "tests",
      "tests/test_cache.py": "tests",
      "README.md": "docs",
      "docs/plugins/github.mdx": "docs",
      LICENSE: "docs",
      "pnpm-lock.yaml": "generated",
      "packages/sdk/dist/index.js": "generated",
      "src/__snapshots__/view.test.tsx.snap": "generated",
      "src/schema.generated.ts": "generated",
      "src/latest.ts": "code",
      "src/contest.ts": "code",
    });
  });

  it("totals each kind in a fixed order and leaves out kinds with no files", () => {
    expect(
      changeBreakdown([
        { path: "README.md", additions: 4, deletions: 1 },
        { path: "src/a.ts", additions: 10, deletions: 2 },
        { path: "src/a.test.ts", additions: 7, deletions: 0 },
        { path: "src/b.ts", additions: 3, deletions: 5 },
      ]),
    ).toEqual([
      { kind: "code", additions: 13, deletions: 7, files: 2 },
      { kind: "tests", additions: 7, deletions: 0, files: 1 },
      { kind: "docs", additions: 4, deletions: 1, files: 1 },
    ]);
    expect(changeBreakdown([])).toEqual([]);
  });

  it("accounts for files GitHub did not list, so the rows add up to the total", () => {
    const rows = changeBreakdown([
      { path: "src/a.ts", additions: 10, deletions: 2 },
      { path: "src/a.test.ts", additions: 5, deletions: 1 },
    ]);
    expect(
      unlistedChange({ additions: 15, deletions: 3, changedFiles: 2 }, rows),
    ).toBeNull();
    expect(
      unlistedChange({ additions: 40, deletions: 9, changedFiles: 5 }, rows),
    ).toEqual({ additions: 25, deletions: 6, files: 3 });
    expect(
      unlistedChange({ additions: 1, deletions: 0, changedFiles: 3 }, rows),
    ).toEqual({ additions: 0, deletions: 0, files: 1 });
  });

  it("fills the same five blocks as core's DiffSizeBar", () => {
    expect(diffSizeBlocks(0, 0)).toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    expect(diffSizeBlocks(1, 0)).toEqual([
      "added",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    expect(diffSizeBlocks(74, 14)).toEqual([
      "added",
      "added",
      "added",
      "removed",
      "empty",
    ]);
    expect(diffSizeBlocks(10, 2_000)).toEqual([
      "removed",
      "removed",
      "removed",
      "removed",
      "removed",
    ]);
  });
});

describe("pull request status menu", () => {
  const allowed = {
    isDraft: false,
    viewerCanUpdate: true,
    viewerCanClose: true,
    viewerCanReopen: true,
  };

  it("offers only the states the viewer may move the pull request to", () => {
    expect(pullStateOptions({ ...allowed, state: "OPEN" })).toEqual([
      { target: "draft", hint: "Convert to draft" },
      { target: "closed", hint: "Close without merging" },
    ]);
    expect(
      pullStateOptions({ ...allowed, isDraft: true, state: "DRAFT" }),
    ).toEqual([
      { target: "open", hint: "Ready for review" },
      { target: "closed", hint: "Close without merging" },
    ]);
    expect(pullStateOptions({ ...allowed, state: "CLOSED" })).toEqual([
      { target: "open", hint: "Reopen" },
      { target: "draft", hint: "Reopen as a draft" },
    ]);
    expect(pullStateOptions({ ...allowed, state: "MERGED" })).toEqual([]);
  });

  it("reopens a closed draft as a draft, and marks it ready only with the right to update it", () => {
    const closedDraft = { ...allowed, isDraft: true, state: "CLOSED" };
    expect(pullStateOptions(closedDraft)).toEqual([
      { target: "draft", hint: "Reopen as a draft" },
      { target: "open", hint: "Reopen and mark ready" },
    ]);
    expect(
      pullStateOptions({ ...closedDraft, viewerCanUpdate: false }),
    ).toEqual([{ target: "draft", hint: "Reopen as a draft" }]);
  });

  it("hides what GitHub says the viewer cannot do", () => {
    expect(
      pullStateOptions({ ...allowed, viewerCanUpdate: false, state: "OPEN" }),
    ).toEqual([{ target: "closed", hint: "Close without merging" }]);
    expect(
      pullStateOptions({
        ...allowed,
        isDraft: true,
        viewerCanClose: false,
        state: "DRAFT",
      }),
    ).toEqual([{ target: "open", hint: "Ready for review" }]);
    expect(
      pullStateOptions({ ...allowed, viewerCanUpdate: false, state: "CLOSED" }),
    ).toEqual([{ target: "open", hint: "Reopen" }]);
    expect(
      pullStateOptions({ ...allowed, viewerCanReopen: false, state: "CLOSED" }),
    ).toEqual([]);
    expect(
      pullStateOptions({
        state: "OPEN",
        isDraft: false,
        viewerCanUpdate: false,
        viewerCanClose: false,
        viewerCanReopen: false,
      }),
    ).toEqual([]);
  });
});

describe("pull request rows", () => {
  const at = (
    number: number,
    author: string,
    overrides: Partial<RawPullStatus> = {},
    extra: Partial<Item> = {},
  ): Item => ({
    ...pull({ headRefName: `branch-${number}`, ...overrides }, author),
    number,
    title: `Pull ${number}`,
    ...extra,
  });
  const items = [
    at(1, "octocat"),
    at(2, "hubot", { baseRefName: "branch-1" }),
    at(3, "hubot", { checkRunCounts: [{ state: "FAILURE", count: 1 }] }),
    at(4, "octocat", { isDraft: true }),
    at(5, "hubot", { requestedReviewers: ["octocat"] }),
    at(6, "hubot", { state: "MERGED", mergedAt: "2026-08-19T00:00:00Z" }),
    at(7, "hubot", { state: "MERGED", mergedAt: "2026-08-21T00:00:00Z" }),
    at(
      8,
      "app/renovate",
      {},
      {
        snooze: { rule: "checks", until: null },
      },
    ),
  ];

  it("links stacked pull requests both ways and keeps agents per key", () => {
    const rows = pullRowModels(
      items,
      "octocat",
      new Map([["acme/widgets#3", "running" as const]]),
    );
    const byNumber = new Map(rows.map((row) => [row.item.number, row]));
    expect(byNumber.get(1)?.note).toBe("has #2 on top");
    expect(byNumber.get(2)?.note).toBe("stacked on #1");
    expect(byNumber.get(2)?.chain).toEqual([1, 2]);
    expect(byNumber.get(3)?.agent).toBe("running");
    expect(byNumber.get(3)?.group).toBe("progress");
    expect(byNumber.get(8)?.group).toBe("snoozed");
    expect(
      rows.every((row) => row.key === `acme/widgets#${row.item.number}`),
    ).toBe(true);
  });

  it("groups each view by attention, author, or not at all", () => {
    const rows = pullRowModels(items, "octocat", new Map());
    const ids = (groups: ReturnType<typeof pullViewGroups>) =>
      groups.map((group) => [
        group.id,
        group.rows.map((row) => row.item.number),
      ]);
    expect(
      ids(
        pullViewGroups(rows, "inbox", parseQuery(""), "octocat", "attention"),
      ),
    ).toEqual([
      ["you", [5]],
      ["ready", [1, 2]],
      ["fixing", [3]],
      ["snoozed", [8]],
    ]);
    expect(
      ids(pullViewGroups(rows, "merged", parseQuery(""), "octocat", "none")),
    ).toEqual([["all", [7, 6]]]);
    const byAuthor = pullViewGroups(
      rows,
      "all",
      parseQuery(""),
      "octocat",
      "author",
    );
    expect(byAuthor.map((group) => group.label)).toEqual([
      "octocat",
      "hubot",
      "renovate",
    ]);
    expect(
      ids(
        pullViewGroups(rows, "all", parseQuery("is:draft"), "octocat", "none"),
      ),
    ).toEqual([["all", [4]]]);
    expect(inboxCount(rows, "octocat")).toBe(4);
  });

  it("splits issues into open and closed after the filter", () => {
    const closed = { ...issue, number: 8, state: "CLOSED", title: "Old bug" };
    expect(
      issueGroups([issue, closed], parseQuery(""), "octocat").map((group) => [
        group.id,
        group.rows.map((row) => row.number),
      ]),
    ).toEqual([
      ["open", [7]],
      ["closed", [8]],
    ]);
    expect(issueGroups([issue, closed], parseQuery("old"), "octocat")).toEqual([
      { id: "closed", label: "Closed", rows: [closed] },
    ]);
  });
});

describe("pull request detail facts", () => {
  const detail = {
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature",
    headRefOid: "abc",
    isCrossRepository: false,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    mergedAt: null,
    mergeable: "MERGEABLE",
    reviewDecision: "",
    isInMergeQueue: false,
    reviewRequests: [],
    checksVerdict: null,
    checks: [{ status: "success" as const }, { status: "neutral" as const }],
    stack: null,
  };

  it("reads the list's status from the detail payload", () => {
    expect(detailPullStatus(detail).attention).toBe("ready_to_merge");
    expect(
      detailPullStatus({
        ...detail,
        checks: [{ status: "failure" }, { status: "success" }],
      }).checks,
    ).toMatchObject({ state: "failing", failed: 1, passed: 1 });
    expect(detailPullStatus({ ...detail, state: "DRAFT" }).state).toBe("draft");
    expect(
      detailPullStatus({
        ...detail,
        stack: { number: 3, position: 1, entries: [{}, {}, {}] },
      }).stack,
    ).toEqual({ number: 3, size: 3, position: 1 });
  });

  it("folds runs of commits, drops the close that a merge implies, and says whether it opened as a draft", () => {
    const events = [
      {
        kind: "merged" as const,
        actor: "octocat",
        createdAt: "2026-08-20T05:00:00Z",
        detail: null,
      },
      {
        kind: "commit" as const,
        actor: "octocat",
        createdAt: "2026-08-20T01:00:00Z",
        detail: "First",
      },
      {
        kind: "commit" as const,
        actor: "octocat",
        createdAt: "2026-08-20T02:00:00Z",
        detail: "Second",
      },
      {
        kind: "ready" as const,
        actor: "octocat",
        createdAt: "2026-08-20T03:00:00Z",
        detail: null,
      },
      {
        kind: "commit" as const,
        actor: "hubot",
        createdAt: "2026-08-20T04:00:00Z",
        detail: "Third",
      },
      {
        kind: "closed" as const,
        actor: "octocat",
        createdAt: "2026-08-20T05:00:00Z",
        detail: null,
      },
    ];
    const grouped = groupPullEvents(events);
    expect(grouped.map((event) => pullEventText(event))).toEqual([
      "pushed 2 commits",
      "marked this pull request as ready for review",
      "pushed Third",
      "merged this pull request",
    ]);
    expect(grouped[0]?.createdAt).toBe("2026-08-20T02:00:00Z");
    expect(openedAsDraft(events, false)).toBe(true);
    expect(openedAsDraft([], true)).toBe(true);
    expect(openedAsDraft([], false)).toBe(false);
  });

  it("finds Linear's linkback in a comment", () => {
    expect(
      linearLinkback(
        '<p><a href="https://linear.app/acme/issue/ENG-12/fix-cache">ENG-12 Fix the cache</a></p>\n<!-- linear-linkback -->',
      ),
    ).toEqual({
      key: "ENG-12",
      title: "Fix the cache",
      url: "https://linear.app/acme/issue/ENG-12/fix-cache",
    });
    expect(linearLinkback("Plain comment about ENG-12")).toBeNull();
  });

  it("orders files for reading: code, then docs, tests, and generated files", () => {
    expect(
      readingOrder([
        { path: "pnpm-lock.yaml" },
        { path: "src/cache.test.ts" },
        { path: "README.md" },
        { path: "src/cache.ts" },
        { path: "src/store.ts" },
      ]).map((file) => file.path),
    ).toEqual([
      "src/cache.ts",
      "src/store.ts",
      "README.md",
      "src/cache.test.ts",
      "pnpm-lock.yaml",
    ]);
  });
});
