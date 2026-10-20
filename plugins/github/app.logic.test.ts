import { describe, expect, it } from "vitest";
import {
  buildSuggestions,
  changeBreakdown,
  changeKind,
  diffSizeBlocks,
  matchesQuery,
  parseQuery,
  parseSubPath,
  pullStateOptions,
  routeToSubPath,
  unlistedChange,
  type Item,
  type Route,
} from "./app-logic.js";

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
};

describe("github panel routes", () => {
  it("round-trips list, create, issue, and pull routes", () => {
    const routes: Route[] = [
      { view: "issues" },
      { view: "pulls" },
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
    });
    expect(parseSubPath("issues/acme/widgets/not-a-number")).toEqual({
      view: "issues",
    });
    expect(parseSubPath("issues/acme/widgets/7/extra")).toEqual({
      view: "issues",
    });
    expect(parseSubPath("")).toEqual({ view: "issues" });
  });
});

describe("github panel query engine", () => {
  it("parses quoted qualifiers and matches viewer-relative filters", () => {
    const parsed = parseQuery(
      'is:open assignee:@me author:alice label:"good first issue" repo:acme/widgets #7',
    );

    expect(parsed).toEqual({
      states: ["OPEN"],
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

    expect(compact("is:", "pr")).toEqual([
      { insert: "is:open ", label: "open" },
      { insert: "is:closed ", label: "closed" },
      { insert: "is:merged ", label: "merged" },
    ]);
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
