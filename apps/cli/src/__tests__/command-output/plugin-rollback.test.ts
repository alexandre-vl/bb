import { describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  readlineMocks,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerPluginCommands } from "../../commands/plugin.js";

const until = Date.UTC(2026, 9, 28, 9, 30);
const rollback = { version: "1.0.0", display: "notes@1.0.0", until };
const reverted = {
  applied: true,
  from: { version: "1.1.0", display: "notes@1.1.0" },
  to: { version: "1.0.0", display: "notes@1.0.0" },
  outcome: "reverted",
};

function pluginList(updateState: object) {
  return {
    plugins: [
      {
        id: "notes",
        source: "npm:notes@^1.0.0",
        rootDir: "/plugins/notes",
        version: "1.1.0",
        provenance: "direct",
        publisherLabel: null,
        isOrphanedBuiltin: false,
        sourceDisplay: "npm · notes · tracks compatible",
        updateState,
        enabled: true,
        description: null,
        name: null,
        icon: null,
        iconUrl: null,
        status: "running",
        statusDetail: null,
        handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
        services: [],
        schedules: [],
        cliCommand: null,
        hasSettings: false,
        app: { hasApp: false, bundle: null },
        logoUrl: null,
        logoDarkUrl: null,
      },
    ],
  };
}

function rollbackJob(fields: object) {
  return {
    job: {
      id: "rollback-1",
      pluginId: "notes",
      displayName: "Notes",
      kind: "rollback",
      ...fields,
    },
  };
}

describe("bb plugin rollback", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it("names the kept release, warns about restored state, and rolls back only that release", async () => {
    readlineMocks.question.mockResolvedValueOnce("y");
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(pluginList({ rollback })))
      .mockResolvedValueOnce(
        Response.json(rollbackJob({ state: "completed", result: reverted }), {
          status: 202,
        }),
      );

    await runCommand(["plugin", "rollback", "notes"], register);

    expect(readlineMocks.question).toHaveBeenCalledWith(
      "Roll back and activate? [y/N] ",
    );
    const [input, request] = vi.mocked(fetch).mock.calls[1] ?? [];
    expect(String(input)).toBe("http://server/api/v1/plugins/notes/rollback");
    expect(JSON.parse(String(request?.body))).toEqual({
      expectedVersion: "1.0.0",
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "notes: roll back 1.1.0 to notes@1.0.0, the release its last update replaced (kept until 2026-10-28T09:30:00.000Z).",
      "notes: settings, KV entries, data.db, secrets, and schedules return to their values from before the update; changes made since then are discarded.",
      "notes: rolled back notes@1.1.0 → notes@1.0.0; its settings, KV entries, data.db, secrets, and schedules are back to their values from before the update.",
      "notes: its tracked source is unchanged, so `bb plugin update notes` can offer notes@1.1.0 again.",
    ]);
  });

  it("prints only the result with --json", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(pluginList({ rollback })))
      .mockResolvedValueOnce(
        Response.json(rollbackJob({ state: "completed", result: reverted }), {
          status: 202,
        }),
      );

    await runCommand(
      ["plugin", "rollback", "notes", "--yes", "--json"],
      register,
    );

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify({ ok: true, result: reverted }, null, 2),
    ]);
  });

  it("refuses a plugin without a rollback point before asking anything", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(pluginList({})));

    await expect(
      runCommand(["plugin", "rollback", "notes", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      'Error: plugin "notes" has no rollback point; bb rolls back only the most recent update of a git or npm plugin, while it keeps the release that update replaced',
    );
    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-TTY rollback without --yes", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(pluginList({ rollback })),
    );

    await expect(
      runCommand(["plugin", "rollback", "notes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "Refusing to roll back without confirmation — re-run with --yes.",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "a refused rollback",
      job: {
        state: "failed",
        error:
          "rollback refused: expected 1.0.0, but the rollback point is now notes@0.9.0; review the plugin again",
      },
      message:
        "Error: rollback refused: expected 1.0.0, but the rollback point is now notes@0.9.0; review the plugin again",
    },
    {
      name: "a rollback that failed and restored the updated release",
      job: {
        state: "completed",
        result: {
          ...reverted,
          applied: false,
          outcome: "rolled-back",
          detail:
            "rolling back to 1.0.0 failed, so bb restored 1.1.0 and the data it had before the rollback: factory threw",
        },
      },
      message:
        "Error: rolling back to 1.0.0 failed, so bb restored 1.1.0 and the data it had before the rollback: factory threw",
    },
  ])("exits with an error for $name", async ({ job, message }) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(pluginList({ rollback })))
      .mockResolvedValueOnce(Response.json(rollbackJob(job), { status: 202 }));

    await expect(
      runCommand(["plugin", "rollback", "notes", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(message);
    expect(
      collectLogPayloads(vi.mocked(console.log)).some((line) =>
        line.includes("rolled back"),
      ),
    ).toBe(false);
  });

  it("labels rollback jobs in update-jobs", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        jobs: [
          rollbackJob({ state: "completed", result: reverted }).job,
          {
            id: "update-1",
            pluginId: "notes",
            displayName: "Notes",
            state: "running",
            phase: "checking",
          },
        ],
      }),
    );

    await runCommand(["plugin", "update-jobs"], register);

    const rows = collectLogPayloads(vi.mocked(console.log))
      .join("\n")
      .split("\n");
    expect(rows.find((row) => row.startsWith("rollback-1"))).toMatch(
      /Notes\s+rollback\s+completed\s+reverted$/u,
    );
    expect(rows.find((row) => row.startsWith("update-1"))).toMatch(
      /Notes\s+update\s+running\s+checking$/u,
    );
  });
});
