import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getInstalledPluginRegistration,
  getPluginKvValue,
  getPluginSettingsValues,
  listPluginArtifacts,
  listPluginSchedules,
  listPluginStateSnapshots,
  recordPluginScheduleResult,
  setPluginSettingsValues,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { pluginUpdateJobResponseSchema } from "@bb/server-contract";
import { registerPluginUpdateJobRoutes } from "../../../src/routes/plugin-update-jobs.js";
import { registerPluginRoutes } from "../../../src/routes/plugins.js";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import { createPluginInstallJobs } from "../../../src/services/plugins/plugin-install-jobs.js";
import {
  createPluginService,
  type PluginService,
  type PluginServiceDeps,
} from "../../../src/services/plugins/plugin-service.js";
import { createPluginUpdateJobs } from "../../../src/services/plugins/plugin-update-jobs.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;
const run = promisify(execFile);
const PLUGIN_ID = "rollbacker";
const RETENTION_MS = 7 * 24 * 60 * 60_000;

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

const hasNpm = await run("npm", ["--version"]).then(
  () => true,
  () => false,
);

describe("plugin update rollback", () => {
  let db: DbConnection;
  let workDir: string;
  let repo: string;
  let dataDir: string;
  let service: PluginService;
  let app: Hono;

  function createService(overrides: Partial<PluginServiceDeps> = {}) {
    return createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginChanged: () => {},
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir,
      appVersion: "1.0.0",
      loadTimeoutMs: 2000,
      stabilizationWindowMs: 0,
      ...overrides,
    });
  }

  function mountRoutes(): void {
    app = new Hono();
    const updateJobs = createPluginUpdateJobs({ notifyChanged: () => {} });
    registerPluginUpdateJobRoutes(app, updateJobs);
    registerPluginRoutes(
      app,
      { config: { serverPort: 3334 }, db },
      service,
      createPluginInstallJobs({ notifyChanged: () => {} }),
      updateJobs,
    );
  }

  async function release(
    version: string,
    schedules: string[] = ["nightly"],
  ): Promise<string> {
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: `bb-plugin-${PLUGIN_ID}`,
        version,
        bb: {
          name: "Rollback fixture",
          description: "Plugin rollback fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(repo, "server.ts"),
      `export default function plugin(bb: any) {
        if ((globalThis as any).__bbFailRelease === ${JSON.stringify(version)}) {
          throw new Error(${JSON.stringify(`release ${version} failed to start`)});
        }
        ${schedules
          .map(
            (name) =>
              `bb.background.schedule(${JSON.stringify(name)}, "0 3 * * *", () => {});`,
          )
          .join("\n")}
      }`,
    );
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-qm", version]);
    await git(repo, ["tag", `v${version}`]);
    return git(repo, ["rev-parse", "HEAD"]);
  }

  function registration() {
    const row = getInstalledPluginRegistration(db, PLUGIN_ID);
    if (row === undefined) throw new Error("missing registration");
    return row;
  }

  function installed() {
    const entry = service.list().find((plugin) => plugin.id === PLUGIN_ID);
    if (entry === undefined) throw new Error("missing installed plugin");
    return entry;
  }

  async function writeState(label: string, scheduleStatus: "ok" | "error") {
    const api = service.getApi(PLUGIN_ID);
    if (api === undefined) throw new Error("plugin did not load");
    const database = api.storage.database();
    database.exec("CREATE TABLE IF NOT EXISTS state (value TEXT NOT NULL)");
    database.exec("DELETE FROM state");
    database.prepare("INSERT INTO state VALUES (?)").run(label);
    await api.storage.kv.set("cursor", label);
    setPluginSettingsValues(db, PLUGIN_ID, { mode: JSON.stringify(label) });
    await mkdir(join(dataDir, "plugins", PLUGIN_ID, "secrets"), {
      recursive: true,
    });
    await writeFile(
      join(dataDir, "plugins", PLUGIN_ID, "secrets", "token"),
      label,
      { mode: 0o600 },
    );
    recordPluginScheduleResult(db, {
      pluginId: PLUGIN_ID,
      name: "nightly",
      status: scheduleStatus,
      error: scheduleStatus === "error" ? `${label} failed` : null,
      now: Date.now(),
    });
  }

  async function readState() {
    const database = new Database(
      join(dataDir, "plugins", PLUGIN_ID, "data.db"),
      { readonly: true },
    );
    try {
      return {
        database: database.prepare("SELECT value FROM state").pluck().get(),
        kv: getPluginKvValue(db, PLUGIN_ID, "cursor"),
        settings: getPluginSettingsValues(db, PLUGIN_ID),
        secret: await readFile(
          join(dataDir, "plugins", PLUGIN_ID, "secrets", "token"),
          "utf8",
        ),
        schedules: listPluginSchedules(db, PLUGIN_ID).map(
          ({ name, lastStatus, lastError }) => ({
            name,
            lastStatus,
            lastError,
          }),
        ),
      };
    } finally {
      database.close();
    }
  }

  function expectedState(label: string, status: "ok" | "error") {
    return {
      database: label,
      kv: JSON.stringify(label),
      settings: { mode: JSON.stringify(label) },
      secret: label,
      schedules: expect.arrayContaining([
        {
          name: "nightly",
          lastStatus: status,
          lastError: status === "error" ? `${label} failed` : null,
        },
      ]),
    };
  }

  async function applyCandidate(pluginId: string, commit: string) {
    expect(await service.checkForUpdates(pluginId)).toMatchObject([
      { outcome: "update-available", candidate: { version: commit } },
    ]);
    await expect(
      service.applyUpdate(pluginId, { expectedVersion: commit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "updated" } });
  }

  async function updateTo(version: string, schedules: string[]) {
    const commit = await release(version, schedules);
    await applyCandidate(PLUGIN_ID, commit);
    return commit;
  }

  async function updateToNextRelease(): Promise<{
    previousCommit: string;
    nextCommit: string;
  }> {
    const previousCommit = registration().gitResolvedCommit ?? "";
    const nextCommit = await updateTo("1.1.0", ["nightly", "hourly"]);
    return { previousCommit, nextCommit };
  }

  async function rollbackOverHttp(body: unknown): Promise<Response> {
    return app.request(`/plugins/${PLUGIN_ID}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-rollback-"));
    dataDir = join(workDir, "data");
    repo = join(workDir, "repo");
    await mkdir(repo, { recursive: true });
    await git(repo, ["init", "-q", "-b", "main"]);
    await git(repo, ["config", "user.email", "test@example.com"]);
    await git(repo, ["config", "user.name", "Test"]);
    await release("1.0.0");
    service = createService();
    mountRoutes();
    await service.install(`git:${repo}@semver:^1.0.0`, { kind: "root" });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("restores the previous release and the data it had before the update", async () => {
    const before = registration();
    await writeState("v1", "ok");
    const { previousCommit, nextCommit } = await updateToNextRelease();
    const updatedRoot = registration().rootDir;
    await writeState("v2", "error");
    expect(await readState()).toEqual({
      ...expectedState("v2", "error"),
      schedules: expect.arrayContaining([
        { name: "hourly", lastStatus: null, lastError: null },
      ]),
    });

    const [snapshot] = listPluginStateSnapshots(db, PLUGIN_ID);
    expect(snapshot).toMatchObject({
      status: "ready",
      fromArtifactId: before.activeArtifactId,
    });
    const target = {
      version: previousCommit,
      display: `${repo}@v1.0.0 (${previousCommit.slice(0, 12)})`,
    };
    expect(installed().updateState.rollback).toEqual({
      ...target,
      until: snapshot?.retainedUntil,
    });
    expect((snapshot?.retainedUntil ?? 0) - (snapshot?.createdAt ?? 0)).toBe(
      RETENTION_MS,
    );
    await stat(before.rootDir);

    const started = await app.request(`/plugins/${PLUGIN_ID}/rollback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "respond-async",
      },
      body: JSON.stringify({ expectedVersion: previousCommit }),
    });
    expect(started.status).toBe(202);
    const { job } = pluginUpdateJobResponseSchema.parse(await started.json());
    expect(job).toMatchObject({ kind: "rollback", pluginId: PLUGIN_ID });
    await vi.waitFor(
      async () => {
        const got = await app.request(`/plugins/update-jobs/${job.id}`);
        expect(await got.json()).toMatchObject({
          job: {
            kind: "rollback",
            state: "completed",
            result: {
              applied: true,
              outcome: "reverted",
              from: { version: nextCommit },
              to: target,
            },
          },
        });
      },
      { timeout: 20_000 },
    );

    expect(registration()).toMatchObject({
      version: "1.0.0",
      gitResolvedCommit: previousCommit,
      sourceGitResolvedTag: "v1.0.0",
      sourceGitRange: "^1.0.0",
      activeArtifactId: before.activeArtifactId,
      rootDir: before.rootDir,
      enabled: true,
      lastFailureVersion: null,
    });
    expect(installed()).toMatchObject({ version: "1.0.0", status: "running" });
    expect(await readState()).toEqual({
      ...expectedState("v1", "ok"),
      schedules: [{ name: "nightly", lastStatus: "ok", lastError: null }],
    });
    expect(
      listPluginStateSnapshots(db, PLUGIN_ID).map(({ status }) => status),
    ).toEqual(["restored", "discarded"]);
    expect(listPluginArtifacts(db, PLUGIN_ID).map(({ id }) => id)).toEqual([
      before.activeArtifactId,
    ]);
    await expect(stat(updatedRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(installed().updateState).not.toHaveProperty("rollback");
    expect(installed().updateState).toMatchObject({
      outcome: "update-available",
      availableVersion: nextCommit,
    });
    await expect(service.rollbackUpdate(PLUGIN_ID)).resolves.toEqual({
      ok: false,
      error: `plugin "${PLUGIN_ID}" has no rollback point: no update to its current version is still within the rollback window`,
    });
  }, 60_000);

  it("keeps the tracking range the user chose after the update", async () => {
    const { previousCommit } = await updateToNextRelease();
    db.$client
      .prepare(
        "UPDATE plugins SET source = ?, source_git_range = ? WHERE id = ?",
      )
      .run(`git:${repo}@semver:>=1.0.0 <3.0.0`, ">=1.0.0 <3.0.0", PLUGIN_ID);

    await expect(
      service.rollbackUpdate(PLUGIN_ID, { expectedVersion: previousCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "reverted" } });

    expect(registration()).toMatchObject({
      source: `git:${repo}@semver:>=1.0.0 <3.0.0`,
      sourceGitRange: ">=1.0.0 <3.0.0",
      sourceGitTagPrefix: "",
      sourceGitResolvedTag: "v1.0.0",
      gitResolvedCommit: previousCommit,
      version: "1.0.0",
    });
  }, 60_000);

  it("brings back the updated release and its data when the previous one fails to start", async () => {
    await writeState("v1", "ok");
    const { previousCommit, nextCommit } = await updateToNextRelease();
    const updated = registration();
    await writeState("v2", "error");
    vi.stubGlobal("__bbFailRelease", "1.0.0");

    const response = await rollbackOverHttp({
      expectedVersion: previousCommit,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      applied: false,
      outcome: "rolled-back",
      from: { version: nextCommit },
      to: { version: previousCommit },
      detail: expect.stringContaining("release 1.0.0 failed to start"),
    });

    expect(registration()).toMatchObject({
      version: "1.1.0",
      gitResolvedCommit: nextCommit,
      sourceGitResolvedTag: "v1.1.0",
      activeArtifactId: updated.activeArtifactId,
      lastFailureVersion: previousCommit,
      lastFailureDetail: expect.stringContaining(
        "release 1.0.0 failed to start",
      ),
    });
    expect(installed()).toMatchObject({ version: "1.1.0", status: "running" });
    expect(await readState()).toEqual({
      ...expectedState("v2", "error"),
      schedules: expect.arrayContaining([
        { name: "hourly", lastStatus: null, lastError: null },
      ]),
    });
    expect(installed().updateState.rollback).toMatchObject({
      version: previousCommit,
    });
  }, 60_000);

  it("finishes an interrupted rollback on the updated release after a restart", async () => {
    await writeState("v1", "ok");
    const { previousCommit, nextCommit } = await updateToNextRelease();
    await writeState("v2", "error");
    await service.stop();
    service = createService({
      afterPluginRollbackStateRestored: async () => {
        throw new Error("simulated process exit during rollback");
      },
    });
    await service.start();
    vi.stubGlobal("__bbFailRelease", "1.0.0");

    await expect(
      service.rollbackUpdate(PLUGIN_ID, { expectedVersion: previousCommit }),
    ).rejects.toThrow("simulated process exit during rollback");
    expect(
      listPluginStateSnapshots(db, PLUGIN_ID).map(({ status }) => status),
    ).toEqual(["ready", "restoring"]);

    await service.stop();
    vi.unstubAllGlobals();
    service = createService();
    await service.start();

    expect(registration()).toMatchObject({
      version: "1.1.0",
      gitResolvedCommit: nextCommit,
    });
    expect(installed()).toMatchObject({ version: "1.1.0", status: "running" });
    expect(await readState()).toEqual(expectedState("v2", "error"));
  }, 60_000);

  it("refuses to roll back to a release other than the one the user reviewed", async () => {
    const { nextCommit } = await updateToNextRelease();
    const before = registration();

    const refused = await rollbackOverHttp({ expectedVersion: nextCommit });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({
      error: expect.stringContaining(
        `rollback refused: expected ${nextCommit}`,
      ),
    });
    expect(registration()).toEqual(before);
    expect(
      listPluginStateSnapshots(db, PLUGIN_ID).map(({ status }) => status),
    ).toEqual(["ready"]);

    for (const body of [{ expectedVersion: "" }, { version: nextCommit }]) {
      expect((await rollbackOverHttp(body)).status).toBe(400);
    }
  }, 60_000);

  it("refuses without a rollback point, for local and bundled sources, and in safe mode", async () => {
    const neverUpdated = await rollbackOverHttp({});
    expect(neverUpdated.status).toBe(422);
    expect(await neverUpdated.json()).toEqual({
      error: `plugin "${PLUGIN_ID}" has no rollback point: no update to its current version is still within the rollback window`,
    });

    const localRoot = join(workDir, "local");
    await mkdir(localRoot, { recursive: true });
    await writeFile(
      join(localRoot, "package.json"),
      JSON.stringify({
        name: "bb-plugin-local-rollback",
        version: "1.0.0",
        bb: {
          name: "Local fixture",
          description: "Local plugin fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(localRoot, "server.ts"),
      "export default function plugin() {}",
    );
    await service.installPath(localRoot);
    await expect(service.rollbackUpdate("local-rollback")).resolves.toEqual({
      ok: false,
      error: `plugin "local-rollback" is a local path source; bb runs it from ${localRoot} and keeps no earlier release to roll back to`,
    });

    upsertInstalledPlugin(db, {
      id: "bundled-rollback",
      source: "builtin:bundled-rollback",
      provenance: { kind: "builtin" },
      sourceIntent: { kind: "builtin", name: "bundled-rollback" },
      exactResolution: { kind: "builtin" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: join(workDir, "bundled"),
      version: "1.0.0",
      enabled: false,
      enabledFollowsDefault: false,
    });
    await expect(service.rollbackUpdate("bundled-rollback")).resolves.toEqual({
      ok: false,
      error:
        'plugin "bundled-rollback" is included with bb and changes only when bb does; there is no earlier plugin release to roll back to',
    });
    await expect(service.rollbackUpdate("missing")).resolves.toEqual({
      ok: false,
      error: 'unknown plugin "missing"',
    });

    const { previousCommit } = await updateToNextRelease();
    const updated = registration();
    await service.setSafeMode(true);
    await expect(
      service.rollbackUpdate(PLUGIN_ID, { expectedVersion: previousCommit }),
    ).resolves.toEqual({
      ok: false,
      error: `plugin safe mode is on; turn it off with \`bb plugin safe-mode off\` before you roll back "${PLUGIN_ID}"`,
    });
    expect(registration()).toEqual(updated);
    await service.setSafeMode(false);
    await expect(
      service.rollbackUpdate(PLUGIN_ID, { expectedVersion: previousCommit }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "reverted" } });
  }, 60_000);

  it("refuses when the kept copy of the previous release changed on disk", async () => {
    const before = registration();
    await updateToNextRelease();
    await writeFile(join(before.rootDir, "server.ts"), "tampered");

    await expect(service.rollbackUpdate(PLUGIN_ID)).resolves.toEqual({
      ok: false,
      error: `rollback refused: the copy of ${repo}@v1.0.0 (${(before.gitResolvedCommit ?? "").slice(0, 12)}) that bb kept changed or is incomplete on disk; update the plugin instead`,
    });
    expect(registration()).toMatchObject({ version: "1.1.0" });
  }, 60_000);

  it("steps back one update per rollback while the earlier release is kept", async () => {
    const first = registration();
    await writeState("v1", "ok");
    const { previousCommit: firstCommit, nextCommit: secondCommit } =
      await updateToNextRelease();
    const second = registration();
    await writeState("v2", "error");
    const thirdCommit = await updateTo("1.2.0", ["nightly"]);
    await writeState("v3", "ok");
    expect(installed().updateState.rollback).toMatchObject({
      version: secondCommit,
    });

    await expect(
      service.rollbackUpdate(PLUGIN_ID, { expectedVersion: secondCommit }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        outcome: "reverted",
        from: { version: thirdCommit },
        to: { version: secondCommit },
      },
    });
    expect(registration()).toMatchObject({
      version: "1.1.0",
      gitResolvedCommit: secondCommit,
      sourceGitResolvedTag: "v1.1.0",
      activeArtifactId: second.activeArtifactId,
      rootDir: second.rootDir,
    });
    expect(await readState()).toEqual({
      ...expectedState("v2", "error"),
      schedules: expect.arrayContaining([
        { name: "hourly", lastStatus: null, lastError: null },
      ]),
    });
    const firstUpdate = listPluginStateSnapshots(db, PLUGIN_ID).find(
      (snapshot) =>
        snapshot.fromArtifactId === first.activeArtifactId &&
        snapshot.toArtifactId === second.activeArtifactId,
    );
    expect(installed().updateState.rollback).toEqual({
      version: firstCommit,
      display: `${repo}@v1.0.0 (${firstCommit.slice(0, 12)})`,
      until: firstUpdate?.retainedUntil,
    });

    await expect(
      service.rollbackUpdate(PLUGIN_ID, { expectedVersion: firstCommit }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        outcome: "reverted",
        from: { version: secondCommit },
        to: { version: firstCommit },
      },
    });
    expect(registration()).toMatchObject({
      version: "1.0.0",
      gitResolvedCommit: firstCommit,
      sourceGitResolvedTag: "v1.0.0",
      activeArtifactId: first.activeArtifactId,
      rootDir: first.rootDir,
    });
    expect(installed()).toMatchObject({ version: "1.0.0", status: "running" });
    expect(await readState()).toEqual({
      ...expectedState("v1", "ok"),
      schedules: [{ name: "nightly", lastStatus: "ok", lastError: null }],
    });
    expect(installed().updateState).not.toHaveProperty("rollback");
    expect(listPluginArtifacts(db, PLUGIN_ID).map(({ id }) => id)).toEqual([
      first.activeArtifactId,
    ]);
  }, 90_000);

  it("rolls back a plugin installed from a monorepo subdirectory with a tag prefix", async () => {
    const mono = join(workDir, "mono");
    await mkdir(mono, { recursive: true });
    await git(mono, ["init", "-q", "-b", "main"]);
    await git(mono, ["config", "user.email", "test@example.com"]);
    await git(mono, ["config", "user.name", "Test"]);
    async function writeMonoPlugin(name: string, version: string) {
      const dir = join(mono, "plugins", name);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
          name: `bb-plugin-mono-${name}`,
          version,
          bb: {
            name: `Mono ${name}`,
            description: "Monorepo rollback fixture.",
            branding: { icon: "Zap" },
            server: "./server.ts",
          },
        }),
      );
      await writeFile(
        join(dir, "server.ts"),
        `export default function plugin(bb: any) { bb.log.info(${JSON.stringify(`${name} ${version}`)}); }`,
      );
    }
    async function tagRelease(tags: string[]) {
      await git(mono, ["add", "-A"]);
      await git(mono, ["commit", "-qm", tags.join(" ")]);
      for (const tag of tags) await git(mono, ["tag", tag]);
      return git(mono, ["rev-parse", "HEAD"]);
    }
    function monoPlugin(id: string) {
      const row = getInstalledPluginRegistration(db, id);
      if (row === undefined) throw new Error(`missing ${id}`);
      return row;
    }
    function listed(id: string) {
      return service.list().find((entry) => entry.id === id);
    }

    await writeMonoPlugin("notes", "1.0.0");
    await writeMonoPlugin("other", "1.0.0");
    const firstCommit = await tagRelease([
      "notes/v1.0.0",
      "other/v1.0.0",
      "v9.0.0",
    ]);
    await service.install(`git:${mono}@semver:notes/:^1.0.0`, {
      kind: "subdirectory",
      path: "plugins/notes",
    });
    await service.install(`git:${mono}@semver:other/:^1.0.0`, {
      kind: "subdirectory",
      path: "plugins/other",
    });
    const notes = monoPlugin("mono-notes");
    const other = monoPlugin("mono-other");
    expect(notes).toMatchObject({
      sourceGitSubdirectory: "plugins/notes",
      sourceGitTagPrefix: "notes/",
      sourceGitResolvedTag: "notes/v1.0.0",
      gitResolvedCommit: firstCommit,
    });

    await writeMonoPlugin("notes", "1.1.0");
    const secondCommit = await tagRelease(["notes/v1.1.0"]);
    await applyCandidate("mono-notes", secondCommit);
    const updated = monoPlugin("mono-notes");
    expect(updated).toMatchObject({
      version: "1.1.0",
      sourceGitResolvedTag: "notes/v1.1.0",
      gitResolvedCommit: secondCommit,
    });
    expect(listed("mono-notes")?.updateState.rollback).toMatchObject({
      version: firstCommit,
      display: expect.stringContaining(
        `@notes/v1.0.0 (${firstCommit.slice(0, 12)})`,
      ),
    });

    await expect(
      service.rollbackUpdate("mono-notes", { expectedVersion: firstCommit }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        outcome: "reverted",
        from: { version: secondCommit },
        to: { version: firstCommit },
      },
    });
    expect(monoPlugin("mono-notes")).toMatchObject({
      sourceGitSubdirectory: "plugins/notes",
      sourceGitTagPrefix: "notes/",
      sourceGitRange: "^1.0.0",
      sourceGitResolvedTag: "notes/v1.0.0",
      gitResolvedCommit: firstCommit,
      version: "1.0.0",
      activeArtifactId: notes.activeArtifactId,
      rootDir: notes.rootDir,
    });
    expect(listed("mono-notes")).toMatchObject({
      version: "1.0.0",
      status: "running",
    });
    expect(monoPlugin("mono-other")).toEqual(other);
    expect(listed("mono-other")).toMatchObject({ status: "running" });
    await stat(other.rootDir);
    await expect(stat(updated.rootDir)).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 90_000);
});

describe.skipIf(!hasNpm)("npm plugin update rollback", () => {
  const packageName = "@acme/bb-plugin-npmrollback";
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;
  let registry: Server;
  const tarballs = new Map<string, Buffer>();
  const savedEnv = new Map<string, string | undefined>();

  async function publish(version: string): Promise<void> {
    const fixtureDir = join(workDir, `fixture-${version}`);
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(
      join(fixtureDir, "package.json"),
      JSON.stringify({
        name: packageName,
        version,
        bb: {
          name: "Npm rollback fixture",
          description: "Npm plugin rollback fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(fixtureDir, "server.ts"),
      "export default function plugin() {}",
    );
    const packDir = join(workDir, `pack-${version}`);
    await mkdir(packDir, { recursive: true });
    await run("npm", ["pack", "--pack-destination", packDir], {
      cwd: fixtureDir,
    });
    const [tarballName] = await readdir(packDir);
    if (tarballName === undefined) throw new Error("npm pack made no tarball");
    tarballs.set(version, await readFile(join(packDir, tarballName)));
  }

  function setEnv(name: string, value: string): void {
    if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
    process.env[name] = value;
  }

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-npm-rollback-"));
    tarballs.clear();
    registry = await new Promise<Server>((resolvePromise) => {
      let origin = "";
      const server = createServer((request, response) => {
        const url = decodeURIComponent(request.url ?? "");
        const tarball = /^\/package-(.+)\.tgz$/u.exec(url);
        if (tarball !== null) {
          response.writeHead(200, {
            "content-type": "application/octet-stream",
          });
          response.end(tarballs.get(tarball[1] ?? ""));
          return;
        }
        if (url !== `/${packageName}`) {
          response.writeHead(404);
          response.end();
          return;
        }
        const versions = Object.fromEntries(
          [...tarballs].map(([version, bytes]) => [
            version,
            {
              name: packageName,
              version,
              dist: {
                tarball: `${origin}/package-${version}.tgz`,
                shasum: createHash("sha1").update(bytes).digest("hex"),
                integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
              },
            },
          ]),
        );
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            name: packageName,
            "dist-tags": { latest: [...tarballs.keys()].at(-1) },
            versions,
          }),
        );
      });
      server.listen(0, "127.0.0.1", () => {
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolvePromise(server);
      });
    });
    const port = (registry.address() as AddressInfo).port;
    const userConfig = join(workDir, "npmrc");
    await writeFile(
      userConfig,
      `@acme:registry=http://127.0.0.1:${port}\nregistry=https://registry.npmjs.org\n`,
    );
    setEnv("NPM_CONFIG_USERCONFIG", userConfig);
    setEnv("npm_config_cache", join(workDir, "npm-cache"));
    setEnv("npm_config_package_lock", "false");
    service = createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginChanged: () => {},
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "1.0.0",
      loadTimeoutMs: 2000,
      stabilizationWindowMs: 0,
    });
  });

  afterEach(async () => {
    await service.stop();
    db.$client.close();
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    savedEnv.clear();
    await new Promise<void>((resolvePromise) =>
      registry.close(() => resolvePromise()),
    );
    await rm(workDir, { recursive: true, force: true });
  });

  it("returns to the previous npm release and keeps the requested range", async () => {
    await publish("1.0.0");
    await service.install(`npm:${packageName}@^1.0.0`, { kind: "root" });
    const before = getInstalledPluginRegistration(db, "npmrollback");
    if (before === undefined) throw new Error("missing npm install");
    await publish("1.1.0");
    expect(await service.checkForUpdates("npmrollback")).toMatchObject([
      { outcome: "update-available", candidate: { version: "1.1.0" } },
    ]);
    await expect(
      service.applyUpdate("npmrollback", { expectedVersion: "1.1.0" }),
    ).resolves.toMatchObject({ ok: true, result: { outcome: "updated" } });
    expect(
      service.list().find((entry) => entry.id === "npmrollback")?.updateState
        .rollback,
    ).toMatchObject({
      version: "1.0.0",
      display: `${packageName}@1.0.0`,
    });
    db.$client
      .prepare(
        "UPDATE plugins SET source = ?, source_npm_requested_spec = ? WHERE id = ?",
      )
      .run(
        `npm:${packageName}@>=1.0.0 <3.0.0`,
        ">=1.0.0 <3.0.0",
        "npmrollback",
      );

    await expect(
      service.rollbackUpdate("npmrollback", { expectedVersion: "1.0.0" }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        applied: true,
        outcome: "reverted",
        from: { version: "1.1.0" },
        to: { version: "1.0.0", display: `${packageName}@1.0.0` },
      },
    });
    expect(getInstalledPluginRegistration(db, "npmrollback")).toMatchObject({
      source: `npm:${packageName}@>=1.0.0 <3.0.0`,
      sourceNpmRequestedSpec: ">=1.0.0 <3.0.0",
      sourceNpmSpecKind: "range",
      npmResolvedVersion: "1.0.0",
      npmIntegrity: before.npmIntegrity,
      activeArtifactId: before.activeArtifactId,
      rootDir: before.rootDir,
      version: "1.0.0",
    });
    expect(
      service.list().find((entry) => entry.id === "npmrollback"),
    ).toMatchObject({ version: "1.0.0", status: "running" });
  }, 120_000);
});
