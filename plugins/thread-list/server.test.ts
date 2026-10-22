import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin, {
  migrateFromUiPreferences,
  migrateToSidebarV2,
} from "./server.js";
import type { AttentionCandidate } from "./shared/attention.js";
import { defaultPreferences } from "./shared/preferences.js";

const PLUGIN_ID = "thread-list";
const KNOWN_PROJECT_IDS = new Set(["proj_a", "proj_b", "proj_quiet"]);

interface TestThread extends AttentionCandidate {
  visibility: "visible" | "hidden";
  archivedAt: number | null;
}

function thread(id: string, overrides: Partial<TestThread> = {}): TestThread {
  return {
    id,
    title: id,
    titleFallback: null,
    projectId: "proj_a",
    parentThreadId: null,
    updatedAt: 0,
    hasPendingInteraction: false,
    status: "idle",
    queuedWork: "none",
    lastReadAt: 20,
    latestAttentionAt: 20,
    visibility: "visible",
    archivedAt: null,
    ...overrides,
  };
}

function listThreads(
  threads: readonly TestThread[],
  args: { archived?: boolean; includeHidden?: boolean; projectId?: string } = {},
): TestThread[] {
  if (args.projectId !== undefined && !KNOWN_PROJECT_IDS.has(args.projectId)) {
    throw Object.assign(new Error("HTTP 404: Project not found"), {
      status: 404,
      code: "project_not_found",
    });
  }
  return threads.filter(
    (candidate) =>
      (args.projectId === undefined || candidate.projectId === args.projectId) &&
      (args.includeHidden === true || candidate.visibility === "visible") &&
      (args.archived === undefined ||
        (candidate.archivedAt !== null) === args.archived),
  );
}

function setup(options: {
  uiPreferences?: Record<string, { revision: number; value: unknown }>;
  uiPreferencesFail?: boolean;
  threads?: readonly TestThread[];
} = {}) {
  return createFakePluginHost({
    pluginId: PLUGIN_ID,
    sdk: {
      system: {
        uiPreferences: {
          list: async () => {
            if (options.uiPreferencesFail) throw new Error("offline");
            return { preferences: options.uiPreferences ?? {} };
          },
        },
      },
      threads: {
        list: async (args) => listThreads(options.threads ?? [], args),
      },
    },
  });
}

function parseCliError(stdout: string): { code: string; message: string } {
  const envelope = JSON.parse(stdout) as {
    ok: boolean;
    error: { code: string; message: string };
  };
  expect(envelope.ok).toBe(false);
  return envelope.error;
}

describe("thread-list preferences rpc", () => {
  it("lists defaults on a fresh install and round-trips a valid write", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    await expect(harness.behavior.callRpc("listPreferences", null)).resolves.toEqual({
      preferences: defaultPreferences(),
    });
    await expect(harness.behavior.callRpc("listPreferences", null)).resolves.toMatchObject({
      preferences: { showProviderIcons: true },
    });
    await harness.behavior.callRpc("setPreference", {
      key: "showProviderIcons",
      value: false,
    });
    await migrateFromUiPreferences(bb);
    await expect(harness.behavior.callRpc("listPreferences", null)).resolves.toMatchObject({
      preferences: { showProviderIcons: false },
    });

    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "organizationMode",
        value: "machine",
      }),
    ).resolves.toEqual({ key: "organizationMode", value: "machine" });
    await expect(bb.storage.kv.get("preference:organizationMode")).resolves.toBe(
      "machine",
    );
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { organizationMode: string };
    };
    expect(listed.preferences.organizationMode).toBe("machine");
    expect(harness.realtimeSignals).toEqual([
      { channel: "preferences", payload: { key: "showProviderIcons", value: false } },
      { channel: "preferences", payload: { key: "organizationMode", value: "machine" } },
    ]);
  });

  it("rejects a value that fails the preference's schema and leaves storage alone", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "organizationMode",
        value: "sideways",
      }),
    ).rejects.toThrow(/Invalid value for organizationMode/);
    await expect(bb.storage.kv.get("preference:organizationMode")).resolves.toBeUndefined();
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "hiddenGroups",
        value: ["project:a", "bogus"],
      }),
    ).rejects.toThrow(/Invalid value for hiddenGroups/);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "showProviderIcons",
        value: "false",
      }),
    ).rejects.toThrow(/Invalid value for showProviderIcons/);
  });

  it("dedupes hidden groups and resets to the default", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "hiddenGroups",
        value: ["threads", "project:a", "project:a", "machine:m"],
      }),
    ).resolves.toEqual({
      key: "hiddenGroups",
      value: ["threads", "project:a", "machine:m"],
    });
    await expect(
      harness.behavior.callRpc("resetPreference", { key: "hiddenGroups" }),
    ).resolves.toEqual({ key: "hiddenGroups", value: [] });
    await expect(bb.storage.kv.get("preference:hiddenGroups")).resolves.toBeUndefined();
  });

  it("defaults row actions to archive, migrates bare ids, dedupes them, and rejects malformed or too many keys", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { rowActions: string[] };
    };
    expect(listed.preferences.rowActions).toEqual(["bb--core/archive"]);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["pin", "core/archive", "bb--core/pin"],
      }),
    ).resolves.toEqual({
      key: "rowActions",
      value: ["bb--core/pin", "bb--core/archive"],
    });
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["move", "push-notifications/level"],
      }),
    ).resolves.toEqual({
      key: "rowActions",
      value: ["thread-list/move", "push-notifications/level"],
    });
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["archive", "delete"],
      }),
    ).rejects.toThrow(/Invalid value for rowActions/);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["archive", "pin", "read", "rename"],
      }),
    ).rejects.toThrow(/at most 3 row actions/);
  });

  it("migrates stored bare ids and core/<id> keys and drops unknown ones instead of resetting the rest", async () => {
    const { bb, harness } = setup();
    await bb.storage.kv.set("preference:rowActions", [
      "pin",
      "futureAction",
      "move",
      "core/rename",
    ]);
    await plugin(bb);
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { rowActions: string[] };
    };
    expect(listed.preferences.rowActions).toEqual([
      "bb--core/pin",
      "thread-list/move",
      "bb--core/rename",
    ]);
  });

  it("falls back to the default when a stored value no longer parses", async () => {
    const { bb, harness } = setup();
    await bb.storage.kv.set("preference:chronologicalSort", "by-vibes");
    await plugin(bb);
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: { chronologicalSort: string };
    };
    expect(listed.preferences.chronologicalSort).toBe("updated");
  });
});

describe("migration from bb's sidebar preferences", () => {
  it("copies non-default values once and never overwrites a value the plugin already has", async () => {
    const { bb } = setup({
      uiPreferences: {
        "sidebar.organizationMode": { revision: 3, value: "machine" },
        "sidebar.sectionOrder": { revision: 1, value: ["proj_a"] },
        "sidebar.chronologicalSort": { revision: 0, value: "updated" },
        "sidebar.hiddenGroups": { revision: 2, value: ["not-a-group"] },
      },
    });
    await bb.storage.kv.set("preference:sectionOrder", ["proj_mine"]);
    const first = await migrateFromUiPreferences(bb);
    expect(first.migrated).toEqual(["organizationMode"]);
    await expect(bb.storage.kv.get("preference:organizationMode")).resolves.toBe(
      "machine",
    );
    await expect(bb.storage.kv.get("preference:sectionOrder")).resolves.toEqual([
      "proj_mine",
    ]);
    await expect(bb.storage.kv.get("preference:chronologicalSort")).resolves.toBeUndefined();
    await expect(bb.storage.kv.get("preference:hiddenGroups")).resolves.toBeUndefined();

    await bb.storage.kv.delete("preference:organizationMode");
    const second = await migrateFromUiPreferences(bb);
    expect(second.migrated).toEqual([]);
    await expect(bb.storage.kv.get("preference:organizationMode")).resolves.toBeUndefined();
  });

  it("skips the migration without marking it done when bb cannot be read", async () => {
    const { bb } = setup({ uiPreferencesFail: true });
    expect((await migrateFromUiPreferences(bb)).migrated).toEqual([]);
    await expect(bb.storage.kv.get("migration:ui-preferences:v1")).resolves.toBeUndefined();
  });
});

describe("bb thread-list prefs", () => {
  it("names the CLI after the plugin id", async () => {
    const builtIn = setup();
    await plugin(builtIn.bb);
    expect(builtIn.harness.inspection.registrations.cli?.name).toBe(
      "thread-list",
    );

    const copy = createFakePluginHost({ pluginId: "my-sidebar" });
    await plugin(copy.bb);
    expect(copy.harness.inspection.registrations.cli?.name).toBe("my-sidebar");
  });

  it("lists, gets, sets, and resets through the CLI", async () => {
    const { bb, harness } = setup();
    await plugin(bb);

    const listed = await harness.behavior.runCli(["prefs", "list", "--json"]);
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toEqual(defaultPreferences());

    const set = await harness.behavior.runCli([
      "prefs",
      "set",
      "manualSectionOrder",
      '["threads","pinned","sections"]',
    ]);
    expect(set.exitCode).toBe(0);
    expect(set.stdout).toBe('manualSectionOrder = ["threads","pinned","sections"]');

    const bare = await harness.behavior.runCli(["prefs", "set", "organizationMode", "project"]);
    expect(bare.exitCode).toBe(0);

    const got = await harness.behavior.runCli(["prefs", "get", "organizationMode"]);
    expect(got.stdout).toBe('"project"');

    const iconsOn = await harness.behavior.runCli([
      "prefs", "set", "showProviderIcons", "true",
    ]);
    expect(iconsOn.exitCode).toBe(0);
    expect(iconsOn.stdout).toBe("showProviderIcons = true");
    await expect(bb.storage.kv.get("preference:showProviderIcons")).resolves.toBe(true);
    const resetIcons = await harness.behavior.runCli([
      "prefs", "reset", "showProviderIcons", "--json",
    ]);
    expect(JSON.parse(resetIcons.stdout)).toEqual({
      key: "showProviderIcons",
      value: true,
    });

    const bad = await harness.behavior.runCli(["prefs", "set", "organizationMode", "nope"]);
    expect(bad.exitCode).not.toBe(0);
    expect(bad.stderr).toMatch(/Invalid value for organizationMode/);

    const unknown = await harness.behavior.runCli(["prefs", "get", "colour"]);
    expect(unknown.exitCode).not.toBe(0);
    expect(unknown.stderr).toMatch(/Unknown preference: colour/);

    const reset = await harness.behavior.runCli(["prefs", "reset", "organizationMode", "--json"]);
    expect(JSON.parse(reset.stdout)).toEqual({
      key: "organizationMode",
      value: "chronological",
    });
  });
});

it("validates lifecycle selection through CLI and RPC and broadcasts it", async () => {
  const { bb, harness } = setup();
  await plugin(bb);
  expect((await harness.behavior.runCli(["prefs", "set", "threadLifecycles", '["archived"]'])).exitCode).toBe(0);
  await expect(bb.storage.kv.get("preference:threadLifecycles")).resolves.toEqual(["archived"]);
  for (const value of [[], ["archived", "archived"], ["deleted"]]) {
    await expect(harness.behavior.callRpc("setPreference", { key: "threadLifecycles", value })).rejects.toThrow(/Invalid value/);
  }
  await expect(bb.storage.kv.get("preference:threadLifecycles")).resolves.toEqual(["archived"]);
  expect(harness.realtimeSignals).toContainEqual({
    channel: "preferences", payload: { key: "threadLifecycles", value: ["archived"] },
  });
});

describe("migration to sidebar V2", () => {
  it("turns read-status grouping on into attention first with parents collapsed and tells open windows", async () => {
    const { bb, harness } = setup();
    await bb.storage.kv.set("preference:groupByReadStatus", true);
    await expect(migrateToSidebarV2(bb)).resolves.toEqual({
      migrated: ["attentionFirst", "parentsStartCollapsed", "expandedThreads"],
    });
    await expect(bb.storage.kv.get("preference:attentionFirst")).resolves.toBe(true);
    await expect(bb.storage.kv.get("preference:parentsStartCollapsed")).resolves.toBe(true);
    await expect(bb.storage.kv.get("preference:expandedThreads")).resolves.toEqual([]);
    await expect(bb.storage.kv.get("preference:groupByReadStatus")).resolves.toBeUndefined();
    await expect(bb.storage.kv.get("migration:sidebar-v2:v1")).resolves.toBe(true);
    expect(harness.inspection.realtimeSignals).toEqual([
      { channel: "preferences", payload: { key: "attentionFirst", value: true } },
      { channel: "preferences", payload: { key: "parentsStartCollapsed", value: true } },
      { channel: "preferences", payload: { key: "expandedThreads", value: [] } },
    ]);
  });

  it("turns attention first off for a user who had grouping off", async () => {
    const { bb } = setup();
    await bb.storage.kv.set("preference:groupByReadStatus", false);
    await expect(migrateToSidebarV2(bb)).resolves.toEqual({ migrated: ["attentionFirst"] });
    await expect(bb.storage.kv.get("preference:attentionFirst")).resolves.toBe(false);
    await expect(bb.storage.kv.get("preference:parentsStartCollapsed")).resolves.toBeUndefined();
    await expect(bb.storage.kv.get("preference:groupByReadStatus")).resolves.toBeUndefined();
  });

  it("writes nothing when grouping was never stored or no longer parses, so the defaults apply", async () => {
    for (const stored of [undefined, "yes"]) {
      const { bb, harness } = setup();
      if (stored !== undefined) await bb.storage.kv.set("preference:groupByReadStatus", stored);
      await expect(migrateToSidebarV2(bb)).resolves.toEqual({ migrated: [] });
      await expect(bb.storage.kv.list("preference:")).resolves.toEqual([]);
      await expect(bb.storage.kv.get("migration:sidebar-v2:v1")).resolves.toBe(true);
      expect(harness.inspection.realtimeSignals).toEqual([]);
    }
  });

  it("keeps a sidebar V2 preference the user already set", async () => {
    const { bb } = setup();
    await bb.storage.kv.set("preference:groupByReadStatus", true);
    await bb.storage.kv.set("preference:attentionFirst", false);
    await bb.storage.kv.set("preference:expandedThreads", ["thr_open"]);
    await expect(migrateToSidebarV2(bb)).resolves.toEqual({
      migrated: ["parentsStartCollapsed"],
    });
    await expect(bb.storage.kv.get("preference:attentionFirst")).resolves.toBe(false);
    await expect(bb.storage.kv.get("preference:expandedThreads")).resolves.toEqual([
      "thr_open",
    ]);
  });

  it("runs once", async () => {
    const { bb, harness } = setup();
    await bb.storage.kv.set("preference:groupByReadStatus", false);
    await migrateToSidebarV2(bb);
    await bb.storage.kv.delete("preference:attentionFirst");
    await bb.storage.kv.set("preference:groupByReadStatus", true);
    await expect(migrateToSidebarV2(bb)).resolves.toEqual({ migrated: [] });
    await expect(bb.storage.kv.list("preference:")).resolves.toEqual([
      "preference:groupByReadStatus",
    ]);
    expect(harness.inspection.realtimeSignals).toHaveLength(1);
  });

  it("migrates on load, after which groupByReadStatus is an unknown preference", async () => {
    const { bb, harness } = setup();
    await bb.storage.kv.set("preference:groupByReadStatus", true);
    await plugin(bb);
    await expect(harness.behavior.callRpc("listPreferences", null)).resolves.toMatchObject({
      preferences: {
        attentionFirst: true,
        parentsStartCollapsed: true,
        expandedThreads: [],
        foldSettled: true,
      },
    });
    const listed = (await harness.behavior.callRpc("listPreferences", null)) as {
      preferences: Record<string, unknown>;
    };
    expect(listed.preferences).not.toHaveProperty("groupByReadStatus");

    const set = await harness.behavior.runCli([
      "prefs", "set", "groupByReadStatus", "true", "--json",
    ]);
    expect(set.exitCode).toBe(1);
    expect(parseCliError(set.stdout)).toEqual({
      code: "unknown_preference",
      message: "Unknown preference: groupByReadStatus",
      hint: expect.stringContaining("attentionFirst"),
    });
    await expect(
      harness.behavior.callRpc("setPreference", { key: "groupByReadStatus", value: true }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

const ATTENTION_THREADS = [
  thread("thr_new_old", { lastReadAt: 10, updatedAt: 100 }),
  thread("thr_settled", { updatedAt: 900 }),
  thread("thr_failed_child", {
    status: "error",
    lastReadAt: 10,
    parentThreadId: "thr_new_old",
    updatedAt: 60,
  }),
  thread("thr_new_recent", { lastReadAt: 10, updatedAt: 300 }),
  thread("thr_queue_failed", { queuedWork: "failed", updatedAt: 400 }),
  thread("thr_needs_you", {
    hasPendingInteraction: true,
    status: "active",
    projectId: "proj_b",
    updatedAt: 10,
  }),
  thread("thr_running", { status: "active", lastReadAt: 10, updatedAt: 800 }),
  thread("thr_archived", { status: "error", lastReadAt: 10, archivedAt: 5, updatedAt: 700 }),
  thread("thr_hidden", { hasPendingInteraction: true, visibility: "hidden", updatedAt: 600 }),
];

describe("listAttention", () => {
  it("lists live threads that need attention by rung, then most recently updated", async () => {
    const { bb, harness } = setup({ threads: ATTENTION_THREADS });
    await plugin(bb);
    const result = (await harness.behavior.callRpc("listAttention", null)) as {
      threads: Array<{ threadId: string; attention: string }>;
    };
    expect(result.threads.map(({ threadId, attention }) => [threadId, attention])).toEqual([
      ["thr_needs_you", "needs-you"],
      ["thr_queue_failed", "failed"],
      ["thr_failed_child", "failed"],
      ["thr_new_recent", "new"],
      ["thr_new_old", "new"],
    ]);
    expect(result.threads[0]).toEqual({
      threadId: "thr_needs_you",
      title: "thr_needs_you",
      projectId: "proj_b",
      parentThreadId: null,
      attention: "needs-you",
      updatedAt: 10,
    });
    expect(harness.inspection.sdk.callsTo("threads.list")).toEqual([[{ archived: false }]]);
  });

  it("filters by project and refuses an unknown one", async () => {
    const { bb, harness } = setup({ threads: ATTENTION_THREADS });
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("listAttention", { projectId: "proj_b" }),
    ).resolves.toMatchObject({ threads: [{ threadId: "thr_needs_you" }] });
    await expect(
      harness.behavior.callRpc("listAttention", { projectId: "proj_quiet" }),
    ).resolves.toEqual({ threads: [] });
    expect(harness.inspection.sdk.callsTo("threads.list")).toEqual([
      [{ archived: false, projectId: "proj_b" }],
      [{ archived: false, projectId: "proj_quiet" }],
    ]);
    await expect(
      harness.behavior.callRpc("listAttention", { projectId: "proj_missing" }),
    ).rejects.toMatchObject({
      code: "not_found",
      message: "Project not found: proj_missing",
    });
    await expect(
      harness.behavior.callRpc("listAttention", { projectId: "" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("prints the same list through bb thread-list attention", async () => {
    const { bb, harness } = setup({ threads: ATTENTION_THREADS });
    await plugin(bb);
    const rpc = (await harness.behavior.callRpc("listAttention", {})) as {
      threads: unknown[];
    };
    const json = await harness.behavior.runCli(["attention", "--json"]);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual(rpc.threads);

    const text = await harness.behavior.runCli(["attention", "--project", "proj_a"]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout.split("\n")).toEqual([
      "failed\tthr_queue_failed\tproj_a\tthr_queue_failed",
      "failed\tthr_failed_child\tproj_a\tthr_failed_child",
      "new\tthr_new_recent\tproj_a\tthr_new_recent",
      "new\tthr_new_old\tproj_a\tthr_new_old",
    ]);

    const quiet = await harness.behavior.runCli(["attention", "--project", "proj_quiet"]);
    expect(quiet.stdout).toBe("No threads need attention.");
  });

  it("reports an unknown or empty project as a CLI error", async () => {
    const { bb, harness } = setup({ threads: ATTENTION_THREADS });
    await plugin(bb);
    const missing = await harness.behavior.runCli([
      "attention", "--project", "proj_missing", "--json",
    ]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toMatch(/Project not found: proj_missing/);
    expect(parseCliError(missing.stdout)).toMatchObject({ code: "project_not_found" });

    const empty = await harness.behavior.runCli(["attention", "--project", "", "--json"]);
    expect(empty.exitCode).toBe(1);
    expect(parseCliError(empty.stdout)).toMatchObject({ code: "invalid_value" });
  });
});

const TREE_THREADS = [
  thread("thr_parent_1"),
  thread("thr_child_1a", { parentThreadId: "thr_parent_1" }),
  thread("thr_child_1b", { parentThreadId: "thr_parent_1" }),
  thread("thr_parent_2", { projectId: "proj_b" }),
  thread("thr_child_2", { parentThreadId: "thr_parent_2", projectId: "proj_b" }),
  thread("thr_archived_parent", { archivedAt: 5 }),
  thread("thr_archived_child", { parentThreadId: "thr_archived_parent", archivedAt: 5 }),
  thread("thr_hidden_child", { parentThreadId: "thr_leaf", visibility: "hidden" }),
  thread("thr_leaf"),
];

interface CollapseCase {
  parentsStartCollapsed: boolean;
  ref: string;
  collapsed: boolean;
  stored: Record<string, string[]>;
  key: string;
  value: string[];
}

const COLLAPSE_CASES: CollapseCase[] = [
  { parentsStartCollapsed: false, ref: "thr_b", collapsed: true, stored: { collapsedThreads: ["thr_a"] }, key: "collapsedThreads", value: ["thr_a", "thr_b"] },
  { parentsStartCollapsed: false, ref: "thr_a", collapsed: false, stored: { collapsedThreads: ["thr_a", "thr_b"] }, key: "collapsedThreads", value: ["thr_b"] },
  { parentsStartCollapsed: true, ref: "thr_a", collapsed: true, stored: { expandedThreads: ["thr_a", "thr_b"] }, key: "expandedThreads", value: ["thr_b"] },
  { parentsStartCollapsed: true, ref: "thr_b", collapsed: false, stored: { expandedThreads: ["thr_a"] }, key: "expandedThreads", value: ["thr_a", "thr_b"] },
  { parentsStartCollapsed: false, ref: "all", collapsed: true, stored: { collapsedThreads: ["thr_gone", "thr_parent_2"] }, key: "collapsedThreads", value: ["thr_gone", "thr_parent_2", "thr_parent_1"] },
  { parentsStartCollapsed: false, ref: "all", collapsed: false, stored: { collapsedThreads: ["thr_parent_1"] }, key: "collapsedThreads", value: [] },
  { parentsStartCollapsed: true, ref: "all", collapsed: true, stored: { expandedThreads: ["thr_parent_1"] }, key: "expandedThreads", value: [] },
  { parentsStartCollapsed: true, ref: "all", collapsed: false, stored: { expandedThreads: ["thr_gone"] }, key: "expandedThreads", value: ["thr_gone", "thr_parent_1", "thr_parent_2"] },
  ...[false, true].flatMap((parentsStartCollapsed): CollapseCase[] => [
    { parentsStartCollapsed, ref: "project:proj_a", collapsed: true, stored: {}, key: "collapsedProjects", value: ["proj_a"] },
    { parentsStartCollapsed, ref: "project:proj_a", collapsed: false, stored: { collapsedProjects: ["proj_a", "proj_b"] }, key: "collapsedProjects", value: ["proj_b"] },
    { parentsStartCollapsed, ref: "env:env_a", collapsed: true, stored: { collapsedEnvironments: ["env_b"] }, key: "collapsedEnvironments", value: ["env_b", "env_a"] },
    { parentsStartCollapsed, ref: "env:env_a", collapsed: false, stored: { collapsedEnvironments: ["env_a"] }, key: "collapsedEnvironments", value: [] },
    { parentsStartCollapsed, ref: "section:sec_a", collapsed: true, stored: {}, key: "collapsedThreadSections", value: ["chronological::sec_a"] },
    { parentsStartCollapsed, ref: "section:sec_a", collapsed: false, stored: { collapsedThreadSections: ["chronological::sec_a"] }, key: "collapsedThreadSections", value: [] },
    { parentsStartCollapsed, ref: "section:threads", collapsed: true, stored: { collapsedSections: ["pinned"] }, key: "collapsedSections", value: ["pinned", "threads"] },
    { parentsStartCollapsed, ref: "section:pinned", collapsed: false, stored: { collapsedSections: ["pinned", "threads"] }, key: "collapsedSections", value: ["threads"] },
  ]),
];

describe("setCollapsed", () => {
  it.each(COLLAPSE_CASES)(
    "$ref collapsed=$collapsed with parentsStartCollapsed=$parentsStartCollapsed writes $key",
    async ({ parentsStartCollapsed, ref, collapsed, stored, key, value }) => {
      const { bb, harness } = setup({ threads: TREE_THREADS });
      await plugin(bb);
      await bb.storage.kv.set("preference:parentsStartCollapsed", parentsStartCollapsed);
      for (const [storedKey, storedValue] of Object.entries(stored)) {
        await bb.storage.kv.set(`preference:${storedKey}`, storedValue);
      }
      await expect(
        harness.behavior.callRpc("setCollapsed", { ref, collapsed }),
      ).resolves.toEqual({ key, value });
      await expect(bb.storage.kv.get(`preference:${key}`)).resolves.toEqual(value);
      expect(harness.inspection.realtimeSignals).toEqual([
        { channel: "preferences", payload: { key, value } },
      ]);
      const listsEveryParent = ref === "all" && collapsed !== parentsStartCollapsed;
      expect(harness.inspection.sdk.callsTo("threads.list")).toEqual(
        listsEveryParent ? [[{ archived: false }]] : [],
      );
    },
  );

  it("finds every parent among the lifecycles the list shows", async () => {
    const { bb, harness } = setup({ threads: TREE_THREADS });
    await plugin(bb);
    await bb.storage.kv.set("preference:threadLifecycles", ["active", "archived"]);
    await expect(
      harness.behavior.callRpc("setCollapsed", { ref: "all", collapsed: true }),
    ).resolves.toEqual({
      key: "collapsedThreads",
      value: ["thr_parent_1", "thr_parent_2", "thr_archived_parent"],
    });
    await bb.storage.kv.set("preference:threadLifecycles", ["archived"]);
    await bb.storage.kv.delete("preference:collapsedThreads");
    await expect(
      harness.behavior.callRpc("setCollapsed", { ref: "all", collapsed: true }),
    ).resolves.toEqual({ key: "collapsedThreads", value: ["thr_archived_parent"] });
    expect(harness.inspection.sdk.callsTo("threads.list")).toEqual([[{}], [{ archived: true }]]);
  });

  it("keeps both of two concurrent changes to the same list", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    await Promise.all([
      harness.behavior.callRpc("setCollapsed", { ref: "thr_a", collapsed: true }),
      harness.behavior.callRpc("setCollapsed", { ref: "thr_b", collapsed: true }),
    ]);
    const stored = await bb.storage.kv.get<string[]>("preference:collapsedThreads");
    expect([...(stored ?? [])].sort()).toEqual(["thr_a", "thr_b"]);
  });

  it("rejects a malformed ref", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    for (const ref of ["folder:a", "project:", "thr a", ""]) {
      await expect(
        harness.behavior.callRpc("setCollapsed", { ref, collapsed: true }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(bb.storage.kv.list("preference:")).resolves.toEqual([]);
  });
});

describe("bb thread-list collapse and expand", () => {
  it("writes the same lists as setCollapsed and prints the key and value", async () => {
    const { bb, harness } = setup({ threads: TREE_THREADS });
    await plugin(bb);
    const collapsed = await harness.behavior.runCli(["collapse", "thr_parent_1", "--json"]);
    expect(collapsed.exitCode).toBe(0);
    expect(JSON.parse(collapsed.stdout)).toEqual({
      key: "collapsedThreads",
      value: ["thr_parent_1"],
    });
    const section = await harness.behavior.runCli(["collapse", "section:sec_a"]);
    expect(section.stdout).toBe('collapsedThreadSections = ["chronological::sec_a"]');

    await harness.behavior.runCli(["prefs", "set", "parentsStartCollapsed", "true"]);
    const expandedAll = await harness.behavior.runCli(["expand", "--all"]);
    expect(expandedAll.exitCode).toBe(0);
    expect(expandedAll.stdout).toBe('expandedThreads = ["thr_parent_1","thr_parent_2"]');
    const collapsedOne = await harness.behavior.runCli(["collapse", "thr_parent_2", "--json"]);
    expect(JSON.parse(collapsedOne.stdout)).toEqual({
      key: "expandedThreads",
      value: ["thr_parent_1"],
    });
    await expect(bb.storage.kv.get("preference:collapsedThreads")).resolves.toEqual([
      "thr_parent_1",
    ]);
  });

  it("requires exactly one of <ref> and --all and rejects a malformed ref", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const cases: Array<[string[], string, RegExp]> = [
      [["collapse", "--json"], "missing_required", /<ref> or --all/],
      [["expand", "thr_a", "--all", "--json"], "unexpected_argument", /cannot be combined/],
      [["collapse", "folder:a", "--json"], "invalid_ref", /Unknown ref "folder:a"/],
      [["expand", "env:", "--json"], "invalid_ref", /Invalid environment id ""/],
    ];
    for (const [argv, code, message] of cases) {
      const result = await harness.behavior.runCli(argv);
      expect(result.exitCode).toBe(1);
      const error = parseCliError(result.stdout);
      expect(error.code).toBe(code);
      expect(error.message).toMatch(message);
    }
    await expect(bb.storage.kv.list("preference:")).resolves.toEqual([]);
  });
});
