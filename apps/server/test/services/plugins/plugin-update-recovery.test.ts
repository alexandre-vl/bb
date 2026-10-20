import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteInstalledPlugin,
  getInstalledPluginRegistration,
  listPluginStateSnapshots,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { Logger } from "@bb/logger";
import { createAiServiceRegistry } from "../../../src/services/ai/ai-service-registry.js";
import {
  createPluginService,
  type PluginService,
  type PluginServiceDeps,
} from "../../../src/services/plugins/plugin-service.js";
import { createNoopTelemetryService } from "../../../src/services/system/telemetry.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;
const run = promisify(execFile);
const PLUGIN_ID = "recovering";
const BYSTANDER_ID = "bystander";

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

describe("plugin update recovery", () => {
  let db: DbConnection;
  let workDir: string;
  let repo: string;
  let dataDir: string;
  let service: PluginService;

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

  async function restart(overrides: Partial<PluginServiceDeps> = {}) {
    await service.stop();
    service = createService(overrides);
    await service.start();
  }

  async function release(version: string): Promise<string> {
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        name: `bb-plugin-${PLUGIN_ID}`,
        version,
        bb: {
          name: "Recovery fixture",
          description: "Plugin recovery fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(repo, "server.ts"),
      `export default function plugin() {
        if (((globalThis as any).__bbFailingReleases ?? []).includes(${JSON.stringify(version)})) {
          throw new Error(${JSON.stringify(`release ${version} failed to start`)});
        }
      }`,
    );
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-qm", version]);
    await git(repo, ["tag", `v${version}`]);
    return git(repo, ["rev-parse", "HEAD"]);
  }

  function failReleases(...versions: string[]) {
    vi.stubGlobal("__bbFailingReleases", versions);
  }

  function listed(id: string) {
    return service.list().find((plugin) => plugin.id === id);
  }

  async function offered(version: string): Promise<string> {
    const commit = await release(version);
    expect(await service.checkForUpdates(PLUGIN_ID)).toMatchObject([
      { outcome: "update-available", candidate: { version: commit } },
    ]);
    return commit;
  }

  async function interruptFailedUpdate() {
    await restart({
      afterPluginRollbackStateRestored: async () => {
        throw new Error("simulated process exit during recovery");
      },
    });
    const commit = await offered("1.1.0");
    failReleases("1.1.0");
    await expect(
      service.applyUpdate(PLUGIN_ID, { expectedVersion: commit }),
    ).rejects.toThrow("simulated process exit during recovery");
    const [snapshot, ...others] = listPluginStateSnapshots(db, PLUGIN_ID);
    expect(others).toEqual([]);
    expect(snapshot).toMatchObject({ status: "restoring" });
    if (snapshot === undefined) throw new Error("missing snapshot");
    vi.unstubAllGlobals();
    return snapshot;
  }

  beforeEach(async () => {
    db = createMigratedConnection();
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-update-recovery-"));
    dataDir = join(workDir, "data");
    repo = join(workDir, "repo");
    await mkdir(repo, { recursive: true });
    await git(repo, ["init", "-q", "-b", "main"]);
    await git(repo, ["config", "user.email", "test@example.com"]);
    await git(repo, ["config", "user.name", "Test"]);
    await release("1.0.0");
    const bystander = join(workDir, BYSTANDER_ID);
    await mkdir(bystander, { recursive: true });
    await writeFile(
      join(bystander, "package.json"),
      JSON.stringify({
        name: `bb-plugin-${BYSTANDER_ID}`,
        version: "1.0.0",
        bb: {
          name: "Bystander",
          description: "A healthy plugin next to the one being restored.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(bystander, "server.ts"),
      "export default function plugin() {}",
    );
    service = createService();
    await service.install(`git:${repo}@semver:^1.0.0`, { kind: "root" });
    await service.installPath(bystander);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
    db.$client.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("keeps a plugin removed while its restore was unfinished removed after a restart", async () => {
    const snapshot = await interruptFailedUpdate();

    await expect(service.remove(PLUGIN_ID)).resolves.toBe(true);
    expect(listPluginStateSnapshots(db, PLUGIN_ID)).toEqual([]);
    await expect(stat(snapshot.snapshotPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await restart();

    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toBeUndefined();
    expect(listed(PLUGIN_ID)).toBeUndefined();
    expect(listed(BYSTANDER_ID)).toMatchObject({ status: "running" });
  }, 60_000);

  it("deletes instead of restoring an unfinished restore whose plugin is gone", async () => {
    const snapshot = await interruptFailedUpdate();
    await service.stop();
    deleteInstalledPlugin(db, PLUGIN_ID);

    service = createService();
    await service.start();

    expect(getInstalledPluginRegistration(db, PLUGIN_ID)).toBeUndefined();
    expect(listed(PLUGIN_ID)).toBeUndefined();
    expect(listPluginStateSnapshots(db, PLUGIN_ID)).toEqual([]);
    await expect(stat(snapshot.snapshotPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(listed(BYSTANDER_ID)).toMatchObject({ status: "running" });
  }, 60_000);
});
