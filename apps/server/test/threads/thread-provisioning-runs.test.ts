import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { and, eq } from "drizzle-orm";
import {
  createProject,
  createThread,
  deleteThread,
  environments,
  events,
  getThread,
  insertThreadProvisioningRun,
  listEvents,
  noopNotifier,
  threadProvisioningRuns,
  upsertHost,
  type DbConnection,
  type ThreadProvisioningRun,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import {
  encodeClientTurnRequestIdNumber,
  type ResolvedThreadExecutionOptions,
} from "@bb/domain";
import {
  threadTimelineResponseSchema,
  type TimelineProvisioningEstimate,
  type TimelineRow,
  type TimelineThreadProvisioningSystemRow,
} from "@bb/server-contract";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { afterEach, describe, expect, it } from "vitest";
import { sweepProviderEnvironment } from "../../src/services/environments/environment-engine.js";
import { DEFAULT_ENVIRONMENT_PROVIDER_ID } from "../../src/services/environments/environment-provider-ids.js";
import { setPluginEnvironmentProviderBridge } from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { appendThreadProvisioningEvent } from "../../src/services/threads/thread-events.js";
import { advanceThreadProvisioning } from "../../src/services/threads/thread-provisioning.js";
import { failThreadProvisioning } from "../../src/services/threads/thread-provisioning-environment.js";
import {
  resolveProvisioningEstimate,
  withProvisioningEstimate,
} from "../../src/services/threads/thread-provisioning-runs.js";
import {
  clearAllThreadProvisionSchedules,
  createThreadStartup,
  getThreadProvisionContext,
  saveThreadProvisionContext,
} from "../../src/services/threads/thread-startup-store.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  type QueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKTREE = "git-worktree";
const CHECKOUT = "project-checkout";
const WORKSPACE_PATH = "/tmp/thread-provisioning-runs-project";

interface EstimateFixture {
  db: DbConnection;
  projectIds: [string, string];
  threadIds: [string, string];
}

function setupEstimateFixture(): EstimateFixture {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "estimate-host" });
  const projects = ["first", "second"].map(
    (name) =>
      createProject(db, noopNotifier, {
        name,
        source: { type: "local_path", hostId: host.id, path: `/tmp/${name}` },
      }).project,
  );
  const [first, second] = projects;
  if (first === undefined || second === undefined) {
    throw new Error("Expected two projects");
  }
  const threadIds = [first, second].map(
    (project) =>
      createThread(db, noopNotifier, {
        projectId: project.id,
        environmentId: null,
        providerId: "codex",
        status: "idle",
      }).id,
  );
  const [firstThreadId, secondThreadId] = threadIds;
  if (firstThreadId === undefined || secondThreadId === undefined) {
    throw new Error("Expected two threads");
  }
  return {
    db,
    projectIds: [first.id, second.id],
    threadIds: [firstThreadId, secondThreadId],
  };
}

interface SeedRunsArgs {
  durationsMs: readonly number[];
  environmentProviderId?: string;
  finishedAfter: number;
  machineKind?: ThreadProvisioningRun["machineKind"];
  project: 0 | 1;
}

function seedRuns(fixture: EstimateFixture, args: SeedRunsArgs): void {
  args.durationsMs.forEach((durationMs, index) => {
    const finishedAt = args.finishedAfter + index * 60_000;
    insertThreadProvisioningRun(fixture.db, {
      provisioningId: `tpv_${randomUUID()}`,
      threadId: fixture.threadIds[args.project],
      projectId: fixture.projectIds[args.project],
      environmentProviderId: args.environmentProviderId ?? WORKTREE,
      machineKind: args.machineKind ?? "existing",
      startedAt: finishedAt - durationMs,
      finishedAt,
    });
  });
}

function estimateFor(fixture: EstimateFixture) {
  return resolveProvisioningEstimate(fixture.db, {
    environmentProviderId: WORKTREE,
    machineKind: "existing",
    projectId: fixture.projectIds[0],
  });
}

function seconds(values: readonly number[]): number[] {
  return values.map((value) => value * 1_000);
}

function pendingProvisioningRow(provisioningId: string): TimelineRow {
  return {
    id: `thr_1:op:thread-provisioning:${provisioningId}`,
    threadId: "thr_1",
    turnId: null,
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    startedAt: 0,
    createdAt: 0,
    kind: "system",
    systemKind: "operation",
    operationKind: "thread-provisioning",
    provisioningId,
    title: "Provisioning thread",
    detail: null,
    status: "pending",
    completedAt: null,
    steps: [],
    estimate: null,
  };
}

describe("provisioning estimate", () => {
  it("takes p50 and p90 of the last 20 runs of the same project, environment and machine kind", () => {
    const fixture = setupEstimateFixture();
    seedRuns(fixture, {
      project: 0,
      durationsMs: seconds(Array.from({ length: 25 }, (_, index) => index + 1)),
      finishedAfter: 1_000_000,
    });
    seedRuns(fixture, {
      project: 0,
      durationsMs: seconds([500]),
      environmentProviderId: CHECKOUT,
      finishedAfter: 9_000_000,
    });
    seedRuns(fixture, {
      project: 0,
      durationsMs: seconds([500]),
      finishedAfter: 9_000_000,
      machineKind: "new",
    });
    seedRuns(fixture, {
      project: 1,
      durationsMs: seconds([500, 500, 500]),
      finishedAfter: 9_000_000,
    });

    expect(estimateFor(fixture)).toEqual({
      p50Ms: 15_000,
      p90Ms: 23_000,
      runCount: 20,
      scope: "project",
    });
  });

  it("falls back to the environment and machine kind across all projects below 3 project runs", () => {
    const fixture = setupEstimateFixture();
    seedRuns(fixture, {
      project: 0,
      durationsMs: seconds([10, 12]),
      finishedAfter: 1_000_000,
    });
    seedRuns(fixture, {
      project: 1,
      durationsMs: seconds([20, 30, 40]),
      finishedAfter: 2_000_000,
    });
    seedRuns(fixture, {
      project: 1,
      durationsMs: seconds([900]),
      environmentProviderId: CHECKOUT,
      finishedAfter: 3_000_000,
    });

    expect(estimateFor(fixture)).toEqual({
      p50Ms: 20_000,
      p90Ms: null,
      runCount: 5,
      scope: "all-projects",
    });

    seedRuns(fixture, {
      project: 0,
      durationsMs: seconds([14]),
      finishedAfter: 4_000_000,
    });

    expect(estimateFor(fixture)).toEqual({
      p50Ms: 12_000,
      p90Ms: null,
      runCount: 3,
      scope: "project",
    });
  });

  it("needs 3 runs across all projects too", () => {
    const fixture = setupEstimateFixture();
    seedRuns(fixture, {
      project: 0,
      durationsMs: seconds([10]),
      finishedAfter: 1_000_000,
    });
    seedRuns(fixture, {
      project: 1,
      durationsMs: seconds([20]),
      finishedAfter: 2_000_000,
    });

    expect(estimateFor(fixture)).toBeNull();

    seedRuns(fixture, {
      project: 1,
      durationsMs: seconds([30]),
      finishedAfter: 3_000_000,
    });

    expect(estimateFor(fixture)).toEqual({
      p50Ms: 20_000,
      p90Ms: null,
      runCount: 3,
      scope: "all-projects",
    });
  });

  it("gives a p90 only from 10 runs", () => {
    const fixture = setupEstimateFixture();
    seedRuns(fixture, {
      project: 0,
      durationsMs: seconds([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      finishedAfter: 1_000_000,
    });

    expect(estimateFor(fixture)).toEqual({
      p50Ms: 5_000,
      p90Ms: null,
      runCount: 9,
      scope: "project",
    });

    seedRuns(fixture, {
      project: 0,
      durationsMs: seconds([30]),
      finishedAfter: 2_000_000,
    });

    expect(estimateFor(fixture)).toEqual({
      p50Ms: 5_000,
      p90Ms: 9_000,
      runCount: 10,
      scope: "project",
    });
  });

  it("has no estimate without a run of that environment and machine kind", () => {
    const fixture = setupEstimateFixture();
    expect(estimateFor(fixture)).toBeNull();

    seedRuns(fixture, {
      project: 0,
      durationsMs: seconds([5, 6, 7]),
      environmentProviderId: CHECKOUT,
      finishedAfter: 1_000_000,
    });
    seedRuns(fixture, {
      project: 1,
      durationsMs: seconds([7, 8, 9]),
      finishedAfter: 1_000_000,
      machineKind: "new",
    });

    expect(estimateFor(fixture)).toBeNull();
  });

  it("puts the estimate only on the row of the running provisioning", () => {
    const estimate: TimelineProvisioningEstimate = {
      p50Ms: 6_000,
      p90Ms: null,
      runCount: 3,
      scope: "project",
    };
    const active = { estimate, provisioningId: "tpv_retry" };

    expect(
      [
        pendingProvisioningRow("tpv_first"),
        pendingProvisioningRow("tpv_retry"),
      ].map((row) => {
        const withEstimate = withProvisioningEstimate(row, active);
        return withEstimate.kind === "system" &&
          withEstimate.systemKind === "operation" &&
          withEstimate.operationKind === "thread-provisioning"
          ? withEstimate.estimate
          : undefined;
      }),
    ).toEqual([null, estimate]);
  });
});

async function readProvisioningRows(
  harness: TestAppHarness,
  threadId: string,
): Promise<TimelineThreadProvisioningSystemRow[]> {
  const timeline = threadTimelineResponseSchema.parse(
    await readJson(
      await harness.app.request(`/api/v1/threads/${threadId}/timeline`),
    ),
  );
  return timeline.rows.filter(
    (row): row is TimelineThreadProvisioningSystemRow =>
      row.kind === "system" &&
      row.systemKind === "operation" &&
      row.operationKind === "thread-provisioning",
  );
}

async function readProvisioningRow(harness: TestAppHarness, threadId: string) {
  return (await readProvisioningRows(harness, threadId)).at(-1) ?? null;
}

function listRuns(harness: TestAppHarness) {
  return harness.db.select().from(threadProvisioningRuns).all();
}

function provisioningStatuses(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "system/thread-provisioning")
    .map((event) => {
      const data: unknown = JSON.parse(event.data);
      return typeof data === "object" && data !== null && "status" in data
        ? data.status
        : null;
    });
}

interface StartedProvisioning {
  attach: QueuedCommand;
  threadId: string;
}

async function startProvisioning(
  harness: TestAppHarness,
  options: { asChild?: boolean } = {},
): Promise<StartedProvisioning> {
  const { host } = seedHostSession(harness.deps, {
    id: "host-provisioning-runs",
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const parent =
    options.asChild === true
      ? seedThread(harness.deps, { projectId: project.id })
      : null;
  const thread = await createThreadFromRequest(harness.deps, {
    environment: {
      type: "host",
      hostId: host.id,
      workspace: { type: "unmanaged", path: WORKSPACE_PATH },
    },
    input: textInput("Provision the workspace"),
    origin: "app",
    ...(parent === null ? {} : { parentThreadId: parent.id }),
    projectId: project.id,
    providerId: "codex",
    startedOnBehalfOf: null,
  });
  const attach = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "environment.attach" &&
      command.initiator?.threadId === thread.id,
  );
  return { attach, threadId: thread.id };
}

async function finishAttach(
  harness: TestAppHarness,
  started: StartedProvisioning,
): Promise<QueuedCommand> {
  if (started.attach.command.type !== "environment.attach") {
    throw new Error("Expected environment.attach command");
  }
  await reportQueuedCommandSuccess(harness, started.attach, {
    path: started.attach.command.path,
    isGitRepo: true,
    isWorktree: false,
    branchName: "main",
    defaultBranch: "main",
    transcript: [],
  });
  return waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "thread.start" && command.threadId === started.threadId,
  );
}

async function settleStart(
  harness: TestAppHarness,
  start: QueuedCommand,
): Promise<void> {
  await reportQueuedCommandError(harness, start, {
    errorCode: "test_cleanup",
    errorMessage: "Settle test start",
  });
}

describe("finished provisioning runs", () => {
  it("shows the estimate on the running row, then records the finished run", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-provisioning-runs",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: WORKSPACE_PATH,
      });
      const earlier = seedThread(harness.deps, { projectId: project.id });
      seconds([4, 6, 9]).forEach((durationMs, index) => {
        insertThreadProvisioningRun(harness.db, {
          provisioningId: `tpv_earlier_${index}`,
          threadId: earlier.id,
          projectId: project.id,
          environmentProviderId:
            DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
          machineKind: "existing",
          startedAt: index * 60_000,
          finishedAt: index * 60_000 + durationMs,
        });
      });

      const thread = await createThreadFromRequest(harness.deps, {
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: WORKSPACE_PATH },
        },
        input: textInput("Provision with an estimate"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });
      const attach = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.attach" &&
          command.initiator?.threadId === thread.id,
      );
      const context = getThreadProvisionContext(harness.db, thread.id);
      expect(context?.request.environmentIntent.type).toBe("reuse");
      expect(await readProvisioningRow(harness, thread.id)).toMatchObject({
        provisioningId: context?.state.provisioningId,
        status: "pending",
        completedAt: null,
        estimate: {
          p50Ms: 6_000,
          p90Ms: null,
          runCount: 3,
          scope: "project",
        },
      });

      const start = await finishAttach(harness, {
        attach,
        threadId: thread.id,
      });
      const provisioningEvents = listEvents(harness.db, {
        threadId: thread.id,
      }).filter((event) => event.type === "system/thread-provisioning");

      expect(await readProvisioningRow(harness, thread.id)).toMatchObject({
        status: "completed",
        startedAt: provisioningEvents[0]?.createdAt,
        completedAt: provisioningEvents.at(-1)?.createdAt,
        estimate: null,
      });
      expect(
        listRuns(harness).filter((run) => run.threadId === thread.id),
      ).toEqual([
        {
          provisioningId: context?.state.provisioningId,
          threadId: thread.id,
          projectId: project.id,
          environmentProviderId:
            DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
          machineKind: "existing",
          startedAt: provisioningEvents[0]?.createdAt,
          finishedAt: provisioningEvents.at(-1)?.createdAt,
        },
      ]);

      await settleStart(harness, start);
    });
  });

  it("does not count a spawned child's provisioning that started before this server booted", async () => {
    await withTestHarness(async (harness) => {
      const started = await startProvisioning(harness, { asChild: true });
      const startSequence = getThreadProvisionContext(
        harness.db,
        started.threadId,
      )?.state.provisionEventSequence;
      if (startSequence === null || startSequence === undefined) {
        throw new Error("Expected a provisioning start event");
      }
      harness.db
        .update(events)
        .set({ createdAt: Math.floor(performance.timeOrigin) - 60_000 })
        .where(
          and(
            eq(events.threadId, started.threadId),
            eq(events.sequence, startSequence),
          ),
        )
        .run();

      const start = await finishAttach(harness, started);

      expect(provisioningStatuses(harness, started.threadId).at(-1)).toBe(
        "completed",
      );
      expect(getThread(harness.db, started.threadId)?.parentThreadId).not.toBe(
        null,
      );
      expect(listRuns(harness)).toEqual([]);

      await settleStart(harness, start);
    });
  });

  it("records no run when the environment fails to provision", async () => {
    await withTestHarness(async (harness) => {
      const started = await startProvisioning(harness);

      await reportQueuedCommandError(harness, started.attach, {
        errorCode: "attach_failed",
        errorMessage: "Workspace path is missing",
      });

      expect(provisioningStatuses(harness, started.threadId).at(-1)).toBe(
        "failed",
      );
      expect(
        await readProvisioningRow(harness, started.threadId),
      ).toMatchObject({ status: "error" });
      expect(listRuns(harness)).toEqual([]);
    });
  });

  it("closes the provisioning row when the thread fails after its environment attached, without a run", async () => {
    await withTestHarness(async (harness) => {
      const started = await startProvisioning(harness);
      const thread = getThread(harness.db, started.threadId);
      const environmentId =
        getThreadProvisionContext(harness.db, started.threadId)?.state
          .environmentId ?? null;
      if (thread === null || environmentId === null) {
        throw new Error("Expected a thread whose environment attached");
      }

      failThreadProvisioning(harness.deps, {
        detail: "Environment is destroyed",
        environmentId,
        thread,
      });

      expect(provisioningStatuses(harness, started.threadId).at(-1)).toBe(
        "failed",
      );
      expect(listRuns(harness)).toEqual([]);
    });
  });

  it("records no run when the user stops provisioning", async () => {
    await withTestHarness(async (harness) => {
      const started = await startProvisioning(harness);

      const stopped = await harness.app.request(
        `/api/v1/threads/${started.threadId}/stop`,
        { method: "POST" },
      );

      expect(stopped.status).toBe(200);
      expect(provisioningStatuses(harness, started.threadId).at(-1)).toBe(
        "cancelled",
      );
      expect(listRuns(harness)).toEqual([]);
    });
  });
});

const REUSING_THREAD_EXECUTION = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "accept-edits",
  source: "client/turn/requested",
} satisfies ResolvedThreadExecutionOptions;

describe("shared workspace provisioning", () => {
  it("keeps a thread's own provisioning running when the workspace it reuses finishes before it attaches", async () => {
    await withTestHarness(async (harness) => {
      const initiator = await startProvisioning(harness);
      const initiatorThread = getThread(harness.db, initiator.threadId);
      const initiatorProvisioningId = getThreadProvisionContext(
        harness.db,
        initiator.threadId,
      )?.state.provisioningId;
      const environmentId = initiatorThread?.environmentId ?? null;
      if (initiatorThread === null || environmentId === null) {
        throw new Error("Expected the initiator's environment");
      }
      const reusing = seedThread(harness.deps, {
        projectId: initiatorThread.projectId,
        environmentId,
        status: "starting",
      });
      const context = createThreadStartup({
        clientRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
        environmentIntent: { type: "reuse", environmentId },
        execution: REUSING_THREAD_EXECUTION,
        fork: null,
        input: [],
        titleProvided: true,
        seedWithoutRun: false,
      });
      context.state.provisionEventSequence = appendThreadProvisioningEvent(
        harness.deps,
        {
          threadId: reusing.id,
          environmentId,
          provisioningId: context.state.provisioningId,
          status: "active",
          entries: [
            {
              type: "step",
              key: "workspace-started",
              text: "Preparing workspace",
              status: "started",
            },
          ],
        },
      );
      saveThreadProvisionContext({
        db: harness.db,
        replace: true,
        threadId: reusing.id,
        context,
      });

      const start = await finishAttach(harness, initiator);

      expect(
        (await readProvisioningRows(harness, reusing.id)).map((row) => [
          row.provisioningId,
          row.status,
        ]),
      ).toEqual([
        [context.state.provisioningId, "pending"],
        [initiatorProvisioningId, "interrupted"],
      ]);

      await settleStart(harness, start);
    });
  });
});

const RESTORE_PROVIDER_ID = "test-worktree";

function registerRestorableProvider() {
  const restoreCalls: string[] = [];
  const created = {
    status: "created" as const,
    path: "/tmp/restored-worktree",
    ownsPath: true,
  };
  const record = {
    pluginId: "test",
    provider: validatePluginEnvironmentProviderDeclaration({
      id: RESTORE_PROVIDER_ID,
      displayName: "Worktree",
      description: "Create an isolated Git worktree for your changes.",
      icon: "Folder",
      policy: { retireGraceMs: 0, pathKeys: "per-attempt" },
      create: async () => created,
      restore: async (context) => {
        restoreCalls.push(context.previous.environment.branchName ?? "");
        return created;
      },
      remove: async () => ({ status: "removed" }),
    }),
  };
  setPluginEnvironmentProviderBridge({
    listEnvironmentProviders: () => [record],
    getEnvironmentProvider: (id) =>
      id === record.provider.id ? record : undefined,
    invokeProvider: async (_id, _label, run) => ({
      ok: true,
      value: await run(),
    }),
    decisionTimeoutMs: 10_000,
  });
  return restoreCalls;
}

describe("restored workspace runs", () => {
  afterEach(() => {
    setPluginEnvironmentProviderBridge(undefined);
  });

  it("keeps a restored workspace's run after its thread is deleted", async () => {
    await withTestHarness(async (harness) => {
      const restoreCalls = registerRestorableProvider();
      const { host } = seedHostSession(harness.deps, { id: "host_restore" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/worktree",
        environmentProviderId: RESTORE_PROVIDER_ID,
        environmentProviderPluginId: "test",
        providerOwnsPath: true,
        branchName: "bb/important-work",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "prov-1",
        threadId: thread.id,
      });
      const archived = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive-all`,
        { method: "POST" },
      );
      expect(archived.status).toBe(200);
      await sweepProviderEnvironment(harness.deps, environment.id);
      expect(
        (
          await harness.app.request(`/api/v1/threads/${thread.id}/unarchive`, {
            method: "POST",
          })
        ).status,
      ).toBe(200);

      const restored = await harness.app.request(
        `/api/v1/threads/${thread.id}/restore-environment`,
        { method: "POST" },
      );
      expect(restored.status, await restored.clone().text()).toBe(200);
      await expect.poll(() => restoreCalls).toEqual(["bb/important-work"]);
      clearAllThreadProvisionSchedules();
      harness.db
        .update(environments)
        .set({ status: "ready" })
        .where(
          eq(
            environments.id,
            getThread(harness.db, thread.id)?.environmentId ?? "",
          ),
        )
        .run();
      await advanceThreadProvisioning(harness.deps, { threadId: thread.id });

      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(listRuns(harness)).toMatchObject([
        {
          threadId: thread.id,
          projectId: project.id,
          environmentProviderId: RESTORE_PROVIDER_ID,
          machineKind: "existing",
        },
      ]);

      expect(deleteThread(harness.db, noopNotifier, thread.id)).toBe(true);
      expect(getThread(harness.db, thread.id)).toBeNull();
      expect(listRuns(harness)).toHaveLength(1);
    });
  });
});
