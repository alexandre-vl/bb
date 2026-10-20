import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { installFakeGh } from "./testing/fake-gh";

let binDir: string;
let callLog: string;
let restoreEnv: () => void;

function ghCalls(): string[] {
  if (!existsSync(callLog)) return [];
  return readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean);
}

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), "bb-github-rpc-"));
  callLog = join(binDir, "gh-calls.log");
  const openIssue = [
    {
      number: 7,
      title: "Cache mutations",
      state: "OPEN",
      author: { login: "alice", id: "user-alice" },
      labels: { nodes: [{ name: "bug" }, { name: "old" }] },
      assignees: { nodes: [{ login: "octocat" }] },
      url: "https://github.com/acme/widgets/issues/7",
      body: "Keep the cache synchronized.",
      updatedAt: "2026-08-19T12:00:00Z",
    },
  ];
  const openPull = [
    {
      number: 42,
      title: "Normalize pull details",
      state: "OPEN",
      author: { login: "bob", id: "user-bob" },
      labels: { nodes: [{ name: "enhancement" }] },
      assignees: { nodes: [] },
      url: "https://github.com/acme/widgets/pull/42",
      body: "Normalize every GitHub shape.",
      updatedAt: "2026-08-19T13:00:00Z",
      isDraft: true,
      headRefName: "normalize",
      baseRefName: "main",
      mergeable: "MERGEABLE",
      reviewDecision: null,
      isInMergeQueue: false,
      reviewRequests: { nodes: [] },
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: {
                contexts: {
                  checkRunCountsByState: [
                    { state: "FAILURE", count: 1 },
                    { state: "SUCCESS", count: 4 },
                  ],
                  statusContextCountsByState: [],
                },
              },
            },
          },
        ],
      },
    },
  ];
  const lists = JSON.stringify({
    data: {
      repository: {
        hasIssuesEnabled: true,
        openIssues: { nodes: openIssue },
        closedIssues: { nodes: [] },
        openPrs: { nodes: openPull },
        closedPrs: { nodes: [] },
      },
    },
  });
  const issueDetail = JSON.stringify({
    number: 7,
    title: "Cache mutations",
    state: "OPEN",
    author: { login: "alice" },
    labels: [{ name: "bug" }],
    assignees: [{ login: "octocat" }],
    url: "https://github.com/acme/widgets/issues/7",
    body: "Live issue body.",
    updatedAt: "2026-08-19T12:00:00Z",
    comments: [],
  });
  const pullDetail = JSON.stringify({
    number: 42,
    title: "Normalize pull details",
    state: "OPEN",
    isDraft: true,
    author: { login: "bob" },
    body: "Pull body.",
    url: "https://github.com/acme/widgets/pull/42",
    createdAt: "2026-08-18T12:00:00Z",
    updatedAt: "2026-08-19T13:00:00Z",
    baseRefName: "main",
    headRefName: "feature",
    additions: 12,
    deletions: 3,
    labels: [{ name: "enhancement" }],
    assignees: [{ login: "octocat" }],
    reviewDecision: "REVIEW_REQUIRED",
    mergeStateStatus: "BLOCKED",
    reviewRequests: [{ login: "reviewer" }, { name: "core-team" }],
    statusCheckRollup: [
      {
        name: "build",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: "https://ci.example/build",
      },
      {
        context: "legacy",
        state: "FAILURE",
        targetUrl: "https://ci.example/legacy",
      },
      { name: "queued", status: "QUEUED" },
      { name: "skipped", status: "COMPLETED", conclusion: "SKIPPED" },
    ],
    comments: [
      {
        author: { login: "commenter" },
        body: "Conversation comment",
        createdAt: "2026-08-19T14:00:00Z",
      },
    ],
    reviews: [
      {
        author: { login: "reviewer" },
        state: "CHANGES_REQUESTED",
        body: "Please fix this.",
        submittedAt: "2026-08-19T15:00:00Z",
      },
    ],
  });
  const reviewComments = JSON.stringify([
    [
      {
        id: 100,
        path: "src/index.ts",
        line: 9,
        diff_hunk: "@@ -1 +1 @@",
        body: "Root comment",
        created_at: "2026-08-19T16:00:00Z",
        user: { login: "reviewer" },
      },
      {
        id: 101,
        in_reply_to_id: 100,
        body: "Reply",
        created_at: "2026-08-19T16:05:00Z",
        user: { login: "bob" },
      },
    ],
    [
      {
        id: 102,
        path: "src/other.ts",
        original_line: 4,
        body: "Second thread",
        created_at: "2026-08-19T17:00:00Z",
        user: { login: "reviewer" },
      },
    ],
  ]);
  const pullFiles = JSON.stringify([
    [
      {
        filename: "src/index.ts",
        status: "modified",
        additions: 10,
        deletions: 2,
        patch: "@@ -1 +1 @@",
      },
    ],
    [
      {
        filename: "src/other.ts",
        status: "added",
        additions: 2,
        deletions: 1,
      },
    ],
  ]);
  const pullPermissions = JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          viewerCanUpdate: true,
          viewerCanClose: true,
          viewerCanReopen: false,
        },
      },
    },
  });

  restoreEnv = installFakeGh(
    binDir,
    `const callLog = ${JSON.stringify(callLog)};
const joined = args.join(" ");
fs.appendFileSync(callLog, joined + "\\n");
if (process.env.FAKE_GH_FAIL && joined.includes(process.env.FAKE_GH_FAIL)) {
  err("HTTP 502: Bad Gateway\\n");
  process.exit(1);
}
const exact = {
  "--version": "gh version 2.96.0 (fake)",
  "auth status --hostname github.com --active": "authenticated",
  "api user": '{"login":"octocat"}',
  "api repos/acme/widgets/assignees?per_page=100": '[{"login":"zoe"},{"login":"alice"},{"login":""}]',
  "api repos/acme/widgets/labels?per_page=100": '[{"name":"triage"},{"name":" bug "},{"name":""}]',
  "issue view 7 -R acme/widgets --json labels": '{"labels":[{"name":"bug"},{"name":"old"}]}',
  "api --paginate --slurp repos/acme/widgets/pulls/42/comments?per_page=100": ${JSON.stringify(reviewComments)},
  "api --paginate --slurp repos/acme/widgets/pulls/42/files?per_page=100": ${JSON.stringify(pullFiles)},
};
const prefixed = [
  ["api graphql --hostname github.com -f query=query PullPermissions", ${JSON.stringify(pullPermissions)}],
  ["api graphql ", ${JSON.stringify(lists)}],
  ["pr view 43 -R acme/widgets --json state,isDraft", '{"state":"MERGED","isDraft":false}'],
  ["pr view 44 -R acme/widgets --json state,isDraft", '{"state":"CLOSED","isDraft":false}'],
  ["pr view 7 -R other/repo --json state,isDraft", '{"state":"OPEN","isDraft":false}'],
  ["issue view 7 -R acme/widgets --json", ${JSON.stringify(issueDetail)}],
  ["pr view 42 -R acme/widgets --json", ${JSON.stringify(pullDetail)}],
  ["issue edit ", "[]"],
];
const prefixMatch = prefixed.find(([prefix]) => joined.startsWith(prefix));
out((exact[joined] ?? prefixMatch?.[1] ?? "[]") + "\\n");`,
  );
});

afterEach(() => {
  delete process.env.FAKE_GH_FAIL;
  restoreEnv();
  rmSync(binDir, { recursive: true, force: true });
});

async function loadPlugin(extraRepos = "acme/widgets") {
  const host = createFakePluginHost({
    pluginId: "github",
    settings: { extraRepos },
  });
  await plugin(host.bb);
  return host;
}

describe("github plugin RPC behavior", () => {
  it("reports extraRepos entries it cannot honor instead of dropping them", async () => {
    const { harness } = await loadPlugin("acme/widgets, ACME-ORG/*, nonsense");

    await expect(harness.runCli(["repos"])).resolves.toEqual({
      exitCode: 0,
      stdout: "acme/widgets",
      stderr:
        'ignoring 2 extraRepos entries that are not "owner/repo": ACME-ORG/*, nonsense\n',
    });
    expect(harness.logEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message:
            'ignoring 2 extraRepos entries that are not "owner/repo": ACME-ORG/*, nonsense',
        }),
      ]),
    );

    await harness.runCli(["repos"]);
    expect(
      harness.logEntries.filter(
        (entry) =>
          entry.level === "warn" && entry.message.includes("extraRepos"),
      ),
    ).toHaveLength(1);
  });

  it("says nothing about extraRepos when every entry is usable", async () => {
    const { harness } = await loadPlugin("acme/widgets");

    await expect(harness.runCli(["repos"])).resolves.toEqual({
      exitCode: 0,
      stdout: "acme/widgets",
      stderr: "",
    });
    expect(
      harness.logEntries.filter((entry) =>
        entry.message.includes("extraRepos"),
      ),
    ).toEqual([]);
  });

  it("rejects malformed repositories as text and JSON and lists its commands in help", async () => {
    const { harness } = await loadPlugin();

    await expect(
      harness.runCli(["issues", "bad/repo/shape"]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: 'Invalid repository "bad/repo/shape"; expected owner/repo.\n',
    });

    const failure = await harness.runCli([
      "issues",
      "bad/repo/shape",
      "--json",
    ]);
    expect(failure.exitCode).toBe(1);
    expect(JSON.parse(failure.stdout)).toEqual({
      ok: false,
      error: {
        code: "invalid_repository",
        message: 'Invalid repository "bad/repo/shape"; expected owner/repo.',
      },
    });

    const help = await harness.runCli(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("bb github issues");
    expect(help.stdout).toContain("bb github sync");
  });

  it("rejects a malformed repository or item number when starting work", async () => {
    const { harness } = await loadPlugin();

    for (const input of [
      { repo: "not-a-repository", number: 1 },
      { repo: "acme/widgets", number: 0 },
    ]) {
      await expect(harness.callRpc("startWork", input)).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
  });

  it("reports repositories, cached rows, and sync counts as JSON", async () => {
    const { harness } = await loadPlugin();

    const repos = await harness.runCli(["repos", "--json"]);
    expect(repos.exitCode).toBe(0);
    expect(JSON.parse(repos.stdout)).toEqual({
      ok: true,
      repos: [{ repo: "acme/widgets", projectId: null }],
      ignoredExtraRepos: [],
    });

    const sync = await harness.runCli(["sync", "--json"]);
    expect(sync.exitCode).toBe(0);
    expect(JSON.parse(sync.stdout)).toEqual({ ok: true, repos: 1, items: 2 });

    const issues = await harness.runCli(["issues", "acme/widgets", "--json"]);
    expect(issues.exitCode).toBe(0);
    const payload = JSON.parse(issues.stdout);
    expect(payload).toMatchObject({
      ok: true,
      items: [
        {
          repo: "acme/widgets",
          number: 7,
          kind: "issue",
          state: "OPEN",
          title: "Cache mutations",
          labels: ["bug", "old"],
        },
      ],
    });
    expect(payload.items[0]).not.toHaveProperty("body");

    const prs = await harness.runCli(["prs", "acme/widgets", "--json"]);
    expect(JSON.parse(prs.stdout)).toMatchObject({
      ok: true,
      items: [
        {
          number: 42,
          kind: "pr",
          nextStep: "1 check failing",
          pr: { state: "draft", attention: "checks_failed" },
        },
      ],
    });
    await expect(harness.runCli(["prs", "acme/widgets"])).resolves.toEqual({
      exitCode: 0,
      stdout:
        "acme/widgets#42\t[OPEN]\tNormalize pull details\t1 check failing",
      stderr: "",
    });
  });

  it("syncs, filters, mutates, and exposes the same cached issue across surfaces", async () => {
    const { harness } = await loadPlugin();

    await expect(harness.callRpc("refresh")).resolves.toEqual({
      repos: 1,
      items: 2,
    });
    await expect(
      harness.callRpc("listItems", {
        kind: "issue",
        state: "open",
        mine: true,
        query: "#7",
      }),
    ).resolves.toMatchObject({
      items: [
        {
          repo: "acme/widgets",
          number: 7,
          kind: "issue",
          labels: ["bug", "old"],
          assignees: ["octocat"],
        },
      ],
    });

    await expect(
      harness.callRpc("setAssignees", {
        repo: "acme/widgets",
        number: 7,
        assignees: ["octocat", "hubot", "hubot"],
      }),
    ).resolves.toEqual({
      ok: true,
      assignees: ["octocat", "hubot"],
    });
    await expect(
      harness.callRpc("setLabels", {
        repo: "acme/widgets",
        number: 7,
        labels: ["bug", "feature", "feature", " "],
      }),
    ).resolves.toEqual({ ok: true, labels: ["bug", "feature"] });

    expect(ghCalls()).toEqual(
      expect.arrayContaining([
        "issue edit 7 -R acme/widgets --add-assignee hubot",
        "issue edit 7 -R acme/widgets --add-label feature --remove-label old",
      ]),
    );
    await expect(
      harness.callRpc("listItems", { kind: "issue" }),
    ).resolves.toMatchObject({
      items: [
        {
          number: 7,
          labels: ["bug", "feature"],
          assignees: ["octocat", "hubot"],
        },
      ],
    });

    await expect(harness.runCli(["issues", "acme/widgets"])).resolves.toEqual({
      exitCode: 0,
      stdout: "acme/widgets#7\t[OPEN]\tCache mutations",
      stderr: "",
    });
    const issueProvider = harness.registrations.mentionProviders.find(
      (provider) => provider.id === "issue",
    );
    if (issueProvider === undefined) {
      throw new Error("GitHub issue mention provider was not registered");
    }
    expect(
      issueProvider.search({
        query: "cache",
        trigger: "@",
        projectId: "project-1",
        threadId: "thread-1",
      }),
    ).toEqual([
      {
        id: "acme/widgets#7",
        title: "#7 Cache mutations",
        subtitle: "acme/widgets",
      },
    ]);
    await expect(
      issueProvider.resolve("acme/widgets#7"),
    ).resolves.toMatchObject({
      context: expect.stringContaining("Live issue body."),
    });
    expect(
      harness.realtimeSignals.filter(
        (signal) => signal.channel === "data-changed",
      ),
    ).toHaveLength(3);
  });

  it("normalizes draft state, checks, review threads, and paginated files", async () => {
    const { harness } = await loadPlugin();

    await expect(
      harness.callRpc("getPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toMatchObject({
      pull: {
        repo: "acme/widgets",
        number: 42,
        state: "DRAFT",
        changedFiles: 2,
        reviewRequests: ["reviewer", "core-team"],
        checks: [
          { name: "build", status: "success" },
          { name: "legacy", status: "failure" },
          { name: "queued", status: "pending" },
          { name: "skipped", status: "neutral" },
        ],
        reviewThreads: [
          {
            path: "src/index.ts",
            line: 9,
            comments: [
              { author: "reviewer", body: "Root comment" },
              { author: "bob", body: "Reply" },
            ],
          },
          {
            path: "src/other.ts",
            line: 4,
            comments: [{ author: "reviewer", body: "Second thread" }],
          },
        ],
        files: [
          {
            path: "src/index.ts",
            status: "modified",
            patch: "@@ -1 +1 @@",
          },
          { path: "src/other.ts", status: "added", patch: null },
        ],
      },
    });
  });

  it("reads what the viewer may change on a pull request", async () => {
    const { harness } = await loadPlugin();

    await expect(
      harness.callRpc("getPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toMatchObject({
      pull: {
        viewerCanUpdate: true,
        viewerCanClose: true,
        viewerCanReopen: false,
      },
    });
    expect(ghCalls()).toContain("} -f owner=acme -f name=widgets -F number=42");
  });

  it("still opens a pull request when GitHub will not say what the viewer may change", async () => {
    process.env.FAKE_GH_FAIL = "PullPermissions";
    const { harness } = await loadPlugin();

    await expect(
      harness.callRpc("getPull", { repo: "acme/widgets", number: 42 }),
    ).resolves.toMatchObject({
      pull: {
        number: 42,
        viewerCanUpdate: false,
        viewerCanClose: false,
        viewerCanReopen: false,
      },
    });
    expect(harness.logEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining(
            "could not read permissions for acme/widgets#42",
          ),
        }),
      ]),
    );
  });

  it("changes a pull request's state from the RPC and the CLI, then refreshes the list", async () => {
    const { harness } = await loadPlugin();

    await expect(
      harness.callRpc("setPullState", {
        repo: "acme/widgets",
        number: 42,
        state: "open",
      }),
    ).resolves.toEqual({ ok: true, state: "open" });
    await expect(
      harness.runCli(["pr-state", "acme/widgets", "42", "--state", "closed"]),
    ).resolves.toEqual({
      exitCode: 0,
      stdout: "acme/widgets#42 is closed.",
      stderr: "",
    });
    const json = await harness.runCli([
      "pr-state",
      "acme/widgets",
      "42",
      "--state",
      "draft",
      "--json",
    ]);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      ok: true,
      repo: "acme/widgets",
      number: 42,
      state: "draft",
    });

    expect(ghCalls().filter((call) => call.startsWith("pr "))).toEqual([
      "pr view 42 -R acme/widgets --json state,isDraft",
      "pr ready 42 -R acme/widgets",
      "pr view 42 -R acme/widgets --json state,isDraft",
      "pr close 42 -R acme/widgets",
      "pr view 42 -R acme/widgets --json state,isDraft",
    ]);
    await vi.waitFor(
      () =>
        expect(
          harness.realtimeSignals.filter(
            (signal) => signal.channel === "data-changed",
          ),
        ).toHaveLength(3),
      { timeout: 10_000 },
    );
  });

  it("reports why a pull request's state did not change", async () => {
    const { harness } = await loadPlugin();

    await expect(
      harness.runCli(["pr-state", "acme/widgets", "43", "--state", "open"]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: "A merged pull request keeps its state.\n",
    });
    for (const number of ["4x2", "1e1", "0x2A", "42.0", "0"]) {
      const badNumber = await harness.runCli([
        "pr-state",
        "acme/widgets",
        number,
        "--state",
        "open",
        "--json",
      ]);
      expect(badNumber.exitCode).toBe(1);
      expect(JSON.parse(badNumber.stdout)).toEqual({
        ok: false,
        error: {
          code: "invalid_number",
          message: `Invalid pull request number "${number}".`,
        },
      });
    }

    process.env.FAKE_GH_FAIL = "pr ready 42";
    await expect(
      harness.callRpc("setPullState", {
        repo: "acme/widgets",
        number: 42,
        state: "open",
      }),
    ).rejects.toThrow("gh pr ready 42 failed: HTTP 502: Bad Gateway");
    expect(ghCalls().filter((call) => call.startsWith("pr "))).toEqual([
      "pr view 43 -R acme/widgets --json state,isDraft",
      "pr view 42 -R acme/widgets --json state,isDraft",
      "pr ready 42 -R acme/widgets",
    ]);
    await vi.waitFor(
      () =>
        expect(
          harness.realtimeSignals.filter(
            (signal) => signal.channel === "data-changed",
          ),
        ).toHaveLength(2),
      { timeout: 10_000 },
    );
  });

  it("refreshes the list when a two-step change fails after its first step", async () => {
    const { harness } = await loadPlugin();
    process.env.FAKE_GH_FAIL = "pr ready 44";

    await expect(
      harness.callRpc("setPullState", {
        repo: "acme/widgets",
        number: 44,
        state: "draft",
      }),
    ).rejects.toThrow("gh pr ready 44 failed: HTTP 502: Bad Gateway");
    expect(ghCalls().filter((call) => call.startsWith("pr "))).toEqual([
      "pr view 44 -R acme/widgets --json state,isDraft",
      "pr reopen 44 -R acme/widgets",
      "pr ready 44 -R acme/widgets --undo",
    ]);
    await vi.waitFor(
      () =>
        expect(
          harness.realtimeSignals.filter(
            (signal) => signal.channel === "data-changed",
          ),
        ).toHaveLength(1),
      { timeout: 10_000 },
    );
  });

  it("changes a pull request in an untracked repository without caching that repository", async () => {
    const { harness } = await loadPlugin();

    await expect(
      harness.runCli(["pr-state", "other/repo", "7", "--state", "closed"]),
    ).resolves.toEqual({
      exitCode: 0,
      stdout: "other/repo#7 is closed.",
      stderr: "",
    });
    expect(ghCalls()).toContain("pr close 7 -R other/repo");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      harness.realtimeSignals.filter(
        (signal) => signal.channel === "data-changed",
      ),
    ).toEqual([]);
    await expect(
      harness.callRpc("listItems", { repo: "other/repo" }),
    ).resolves.toEqual({ items: [] });
  });
});
