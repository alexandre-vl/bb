import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { githubRpcContract } from "./server";

const fake = vi.hoisted(() => ({
  responses: new Map<string, string | Error>(),
  calls: [] as string[][],
}));
vi.mock("node:child_process", () => ({
  execFile(
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number },
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) {
    if (file !== "gh") throw new Error(`Unexpected executable ${file}`);
    fake.calls.push(args);
    if (args[0] === "--version" || args[0] === "auth")
      return callback(null, "ok", "");
    expect(options).toEqual({ timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    const name = args.find((arg) => arg.startsWith("name="))?.slice(5);
    const response = fake.responses.get(name ?? "");
    if (response === undefined)
      return callback(new Error("unexpected command"), "", "");
    if (response instanceof Error)
      return callback(response, "", response.message);
    callback(null, response, "");
  },
}));

function node(number: number, state = "OPEN") {
  return {
    number,
    state,
    title: `Title ${number}`,
    author: { login: "robot[bot]" },
    labels: { nodes: [{ name: "bug" }] },
    assignees: { nodes: [{ login: "alice" }] },
    body: "Body\ntext",
    url: `https://github.com/acme/one/issues/${number}`,
    updatedAt: "2026-09-10T00:00:00Z",
  };
}
function rollup(
  checkRuns: Array<{ state: string; count: number }>,
  statusContexts: Array<{ state: string; count: number }> = [],
) {
  return {
    nodes: [
      {
        commit: {
          statusCheckRollup: {
            contexts: {
              checkRunCountsByState: checkRuns,
              statusContextCountsByState: statusContexts,
            },
          },
        },
      },
    ],
  };
}
function openPull(number: number, extra: Record<string, unknown> = {}) {
  return {
    ...node(number),
    isDraft: false,
    headRefName: `feature-${number}`,
    baseRefName: "main",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    isInMergeQueue: false,
    reviewRequests: { nodes: [] },
    commits: rollup([{ state: "SUCCESS", count: 3 }]),
    ...extra,
  };
}
function closedPull(number: number, state: "CLOSED" | "MERGED") {
  return {
    ...node(number, state),
    isDraft: false,
    headRefName: `feature-${number}`,
    baseRefName: "main",
  };
}
function repository() {
  return {
    hasIssuesEnabled: true,
    openIssues: { nodes: [node(1)] },
    closedIssues: { nodes: [node(2, "CLOSED")] },
    openPrs: { nodes: [openPull(3)] },
    closedPrs: { nodes: [closedPull(4, "CLOSED"), closedPull(5, "MERGED")] },
  };
}
function response(repo = repository()) {
  return JSON.stringify({ data: { repository: repo } });
}
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
beforeEach(() => {
  fake.responses.clear();
  fake.calls = [];
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
async function start(repos = "acme/one") {
  const host = createFakePluginHost({
    pluginId: "github",
    settings: { extraRepos: repos },
    sdk: { projects: { list: async () => [] } },
  });
  hosts.push(host);
  await plugin(host.bb);
  return host;
}

it("maps all four lists into SQLite and preserves closed/merged filtering", async () => {
  fake.responses.set("one", response());
  const { harness, bb } = await start();
  expect(await harness.behavior.callRpc("refresh")).toEqual({
    repos: 1,
    items: 5,
  });
  expect(
    bb.storage.database().prepare("SELECT count(*) AS n FROM items").get(),
  ).toEqual({ n: 5 });
  const { items } = githubRpcContract.listItems.output.parse(
    await harness.behavior.callRpc("listItems", { state: "closed" }),
  );
  expect(items.map((item: { state: string }) => item.state).sort()).toEqual([
    "CLOSED",
    "CLOSED",
    "MERGED",
  ]);
  expect(
    await harness.behavior.callRpc("listItems", {
      kind: "issue",
      state: "open",
    }),
  ).toEqual({
    items: [
      {
        repo: "acme/one",
        kind: "issue",
        number: 1,
        state: "OPEN",
        title: "Title 1",
        author: "app/robot[bot]",
        labels: ["bug"],
        assignees: ["alice"],
        body: "Body\ntext",
        url: "https://github.com/acme/one/issues/1",
        updatedAt: "2026-09-10T00:00:00Z",
        pr: null,
      },
    ],
  });
  expect(fake.calls.filter((args) => args[1] === "graphql")).toHaveLength(1);
});

it("accepts deleted authors and empty connections, discards disabled issues, and clears stale rows on success", async () => {
  fake.responses.set("one", response());
  const { harness } = await start();
  await harness.behavior.callRpc("refresh");
  const repo = {
    ...repository(),
    hasIssuesEnabled: false,
    openPrs: {
      nodes: [
        {
          ...openPull(3),
          author: null,
          labels: { nodes: [] },
          assignees: { nodes: [] },
        },
      ],
    },
    closedPrs: { nodes: [] },
  };
  fake.responses.set("one", JSON.stringify({ data: { repository: repo } }));
  expect(await harness.behavior.callRpc("refresh")).toEqual({
    repos: 1,
    items: 1,
  });
  expect(await harness.behavior.callRpc("listItems", {})).toMatchObject({
    items: [{ number: 3, author: "app/", labels: [], assignees: [] }],
  });
  fake.responses.set(
    "one",
    response({
      hasIssuesEnabled: true,
      openIssues: { nodes: [] },
      closedIssues: { nodes: [] },
      openPrs: { nodes: [] },
      closedPrs: { nodes: [] },
    }),
  );
  expect(await harness.behavior.callRpc("refresh")).toEqual({
    repos: 1,
    items: 0,
  });
  expect(await harness.behavior.callRpc("listItems", {})).toEqual({
    items: [],
  });
});

it.each([
  ["process failure", new Error("timeout")],
  ["invalid JSON", "broken"],
  ["null repository", JSON.stringify({ data: { repository: null } })],
  [
    "missing alias",
    JSON.stringify({
      data: { repository: { ...repository(), closedPrs: undefined } },
    }),
  ],
  [
    "partial GraphQL error",
    JSON.stringify({
      data: { repository: repository() },
      errors: [
        { message: "resource limit", path: ["repository", "openIssues"] },
      ],
    }),
  ],
  [
    "null connection",
    JSON.stringify({
      data: { repository: { ...repository(), openIssues: null } },
    }),
  ],
  [
    "malformed node",
    response({
      ...repository(),
      openIssues: { nodes: [{ ...node(1), number: -1 }] },
    }),
  ],
])(
  "retains repository rows and cursor after %s, then allows another repository to succeed",
  async (_name, failed) => {
    fake.responses.set("one", response());
    const { harness, bb } = await start();
    await harness.behavior.callRpc("refresh");
    const before = await harness.behavior.callRpc("listItems", {});
    const cursor = await bb.storage.kv.get("sync-cursor");
    fake.responses.set("one", failed);
    await expect(harness.behavior.callRpc("refresh")).rejects.toThrow();
    expect(await harness.behavior.callRpc("listItems", {})).toEqual(before);
    expect(await bb.storage.kv.get("sync-cursor")).toEqual(cursor);
    await harness.behavior.setSettings({ extraRepos: "acme/one,acme/two" });
    fake.responses.set("two", response());
    expect(await harness.behavior.callRpc("refresh")).toEqual({
      repos: 2,
      items: 5,
    });
    expect(
      await harness.behavior.callRpc("listItems", { repo: "acme/one" }),
    ).toEqual(before);
    expect(
      bb.storage.database().prepare("SELECT count(*) AS n FROM items").get(),
    ).toEqual({ n: 10 });
  },
);

it("derives what each pull request needs next from the same list request", async () => {
  fake.responses.set(
    "one",
    response({
      hasIssuesEnabled: true,
      openIssues: { nodes: [] },
      closedIssues: { nodes: [] },
      openPrs: {
        nodes: [
          openPull(10, { mergeable: "CONFLICTING" }),
          openPull(11, {
            commits: rollup([
              { state: "FAILURE", count: 2 },
              { state: "SUCCESS", count: 5 },
              { state: "SKIPPED", count: 1 },
            ]),
          }),
          openPull(12, {
            commits: rollup(
              [{ state: "SUCCESS", count: 2 }],
              [{ state: "ERROR", count: 1 }],
            ),
          }),
          openPull(13, {
            commits: rollup([
              { state: "IN_PROGRESS", count: 2 },
              { state: "SUCCESS", count: 3 },
            ]),
          }),
          openPull(14, { isDraft: true }),
          openPull(15, {
            reviewDecision: "REVIEW_REQUIRED",
            reviewRequests: {
              nodes: [
                { requestedReviewer: { login: "alice" } },
                { requestedReviewer: { slug: "maintainers" } },
                { requestedReviewer: null },
              ],
            },
          }),
          openPull(16, { isInMergeQueue: true }),
          openPull(17),
          openPull(18, {
            mergeable: "UNKNOWN",
            commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
          }),
          openPull(19, { baseRefName: "feature-17" }),
        ],
      },
      closedPrs: { nodes: [closedPull(20, "MERGED")] },
    }),
  );
  const { harness } = await start();
  await harness.behavior.callRpc("refresh");
  const { items } = githubRpcContract.listItems.output.parse(
    await harness.behavior.callRpc("listItems", { kind: "pr" }),
  );
  const byNumber = new Map(items.map((item) => [item.number, item.pr]));
  expect(
    Object.fromEntries([...byNumber].map(([n, pr]) => [n, pr?.attention])),
  ).toEqual({
    10: "conflicts",
    11: "checks_failed",
    12: "checks_failed",
    13: "checks_pending",
    14: "draft",
    15: "review_requested",
    16: "queued",
    17: "ready_to_merge",
    18: "none",
    19: "ready_to_merge",
    20: "merged",
  });
  expect(byNumber.get(11)?.checks).toEqual({
    state: "failing",
    passed: 6,
    failed: 2,
    pending: 0,
  });
  expect(byNumber.get(15)?.review).toEqual({
    state: "review_requested",
    requested: ["alice", "maintainers"],
  });
  expect(byNumber.get(18)?.checks.state).toBe("no_checks");
  expect(byNumber.get(20)).toMatchObject({
    state: "merged",
    baseRefName: "main",
  });

  const cli = await harness.runCli(["prs", "acme/one", "--json"]);
  const rows = JSON.parse(cli.stdout).items as Array<{
    number: number;
    nextStep: string | null;
  }>;
  expect(
    Object.fromEntries(rows.map((row) => [row.number, row.nextStep])),
  ).toEqual({
    10: "Conflicts with main",
    11: "2 checks failing",
    12: "1 check failing",
    13: "Checks running · 3 of 5 done",
    14: "3 checks passed",
    15: "Review requested",
    16: "Queued to merge",
    17: "3 checks passed",
    18: "No checks",
    19: "3 checks passed",
  });
  const text = await harness.runCli(["prs", "acme/one"]);
  expect(text.stdout.split("\n")).toContain(
    "acme/one#10\t[OPEN]\tTitle 10\tConflicts with main",
  );
});

it("publishes a change when only a pull request's checks change", async () => {
  fake.responses.set("one", response());
  const { harness } = await start();
  await harness.behavior.callRpc("refresh");
  const changes = () =>
    harness.realtimeSignals.filter(
      (signal) => signal.channel === "data-changed",
    ).length;
  const before = changes();
  fake.responses.set(
    "one",
    response({
      ...repository(),
      openPrs: {
        nodes: [
          openPull(3, { commits: rollup([{ state: "FAILURE", count: 1 }]) }),
        ],
      },
    }),
  );
  await harness.behavior.callRpc("refresh");
  expect(changes()).toBe(before + 1);
  expect(
    await harness.behavior.callRpc("listItems", { kind: "pr", state: "open" }),
  ).toMatchObject({
    items: [{ number: 3, pr: { attention: "checks_failed" } }],
  });
});
