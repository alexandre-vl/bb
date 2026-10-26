import type { ThreadEventRow } from "@bb/domain";
import type {
  TimelineProvisioningEstimate,
  TimelineRow,
  TimelineThreadProvisioningSystemRow,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildThreadTimelineFromEvents,
  buildTimelineRowTitle,
  formatThreadTimelineText,
  provisioningEstimateProgress,
} from "../src/index.js";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import {
  createTimelineEventFactory,
  fromRows,
  type TimelineEventFactory,
} from "./timeline-test-harness.js";

const TITLE_OPTIONS = { summaryStyle: "bundle", workStyle: "default" } as const;
const WORKSPACE = "/work/fixture";

interface ProvisioningThreadState {
  activeProvisioningId?: string;
  threadStatus: "starting" | "active" | "idle";
}

const IDLE: ProvisioningThreadState = { threadStatus: "idle" };
const PROVISIONING: ProvisioningThreadState = {
  activeProvisioningId: "tpv-test",
  threadStatus: "starting",
};

function buildProvisioningRows(
  rows: ThreadEventRow[],
  state: ProvisioningThreadState = IDLE,
): TimelineThreadProvisioningSystemRow[] {
  const timeline = buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [],
    events: fromRows(rows),
    options: {
      activeProvisioningId: state.activeProvisioningId,
      completedTurnDisplay: "collapse",
      includeNestedRows: true,
      includeDiagnosticOperations: false,
      summarizeShellCommands: true,
      isLatestPage: true,
      threadStatus: state.threadStatus,
      threadName: "",
      workspaceRoot: null,
    },
  });
  return timeline.rows.filter(
    (candidate): candidate is TimelineThreadProvisioningSystemRow =>
      candidate.kind === "system" &&
      candidate.systemKind === "operation" &&
      candidate.operationKind === "thread-provisioning",
  );
}

function buildProvisioningRow(
  rows: ThreadEventRow[],
  state: ProvisioningThreadState = IDLE,
): TimelineThreadProvisioningSystemRow {
  const [row] = buildProvisioningRows(rows, state);
  if (row === undefined) throw new Error("Expected a provisioning row");
  return row;
}

function newEventFactory(): TimelineEventFactory {
  return createTimelineEventFactory({ threadId: "thread-1" });
}

function worktreeRunEvents(
  event: TimelineEventFactory,
  count = 7,
): ThreadEventRow[] {
  return [
    event.threadProvisioning({
      createdAt: 10_000,
      status: "active",
      entries: [
        {
          type: "step",
          key: "workspace-started",
          text: "Preparing workspace",
          status: "started",
        },
      ],
    }),
    event.threadProvisioning({
      createdAt: 10_007,
      status: "active",
      entries: [
        {
          type: "step",
          key: "provider-step-1-Preparing Worktree…",
          text: "Preparing Worktree…",
          status: "started",
        },
      ],
    }),
    event.threadProvisioning({
      createdAt: 10_397,
      status: "active",
      entries: [
        {
          type: "step",
          key: "provider-step-1-Preparing Worktree…",
          text: "Preparing Worktree…",
          status: "completed",
        },
        {
          type: "step",
          key: `provider-step-1-Using workspace: ${WORKSPACE}`,
          text: `Using workspace: ${WORKSPACE}`,
          status: "started",
        },
      ],
    }),
    event.threadProvisioning({
      createdAt: 10_410,
      status: "active",
      entries: [
        {
          type: "step",
          key: `provider-step-1-Using workspace: ${WORKSPACE}`,
          text: `Using workspace: ${WORKSPACE}`,
          status: "completed",
        },
      ],
    }),
    event.threadProvisioning({
      createdAt: 11_460,
      status: "active",
      entries: [
        {
          type: "step",
          key: "setup-started",
          text: "Running .bb-env-setup.sh",
          status: "started",
          startedAt: 9_000_000,
        },
        {
          type: "output",
          key: "setup-output-1",
          text: "Resolving packages: step 1 of 4",
        },
      ],
    }),
    event.threadProvisioning({
      createdAt: 13_500,
      status: "active",
      entries: [
        {
          type: "output",
          key: "setup-output-2",
          text: "Resolving packages: step 4 of 4",
        },
      ],
    }),
    event.threadProvisioning({
      createdAt: 14_694,
      status: "active",
      entries: [
        {
          type: "step",
          key: "setup-completed",
          text: ".bb-env-setup.sh finished",
          status: "completed",
          startedAt: 9_000_000,
          metadata: { durationMs: 4_047 },
        },
        {
          type: "step",
          key: "workspace-path",
          text: `Using workspace: ${WORKSPACE}`,
          status: "completed",
        },
        {
          type: "step",
          key: "workspace-branch",
          text: "Using branch: bb/fixture (5abadc8)",
          status: "completed",
        },
      ],
    }),
  ].slice(0, count);
}

const SETUP_LOCKFILE_ERROR =
  "ERR_PNPM_NO_LOCKFILE  Cannot install with frozen-lockfile because pnpm-lock.yaml is absent";

function failedSetupEvents(
  event: TimelineEventFactory,
  progressLineCount: number,
): ThreadEventRow[] {
  return [
    ...worktreeRunEvents(event, 4),
    event.threadProvisioning({
      createdAt: 11_000,
      status: "active",
      entries: [
        {
          type: "step",
          key: "setup-started",
          text: "Running .bb-env-setup.sh",
          status: "started",
        },
        {
          type: "output",
          key: "setup-output-1",
          text: Array.from(
            { length: progressLineCount },
            (_, index) => `Progress: step ${index + 1}`,
          ).join("\n"),
        },
      ],
    }),
    event.threadProvisioning({
      createdAt: 11_900,
      status: "active",
      entries: [
        { type: "output", key: "setup-output-2", text: SETUP_LOCKFILE_ERROR },
        {
          type: "step",
          key: "setup-failed",
          text: ".bb-env-setup.sh failed",
          status: "failed",
          metadata: { durationMs: 900 },
        },
      ],
    }),
    event.threadProvisioning({
      createdAt: 12_000,
      status: "failed",
      entries: [
        {
          type: "step",
          key: "workspace-failed",
          text: "Workspace setup failed",
          status: "failed",
        },
      ],
    }),
    event.systemError({
      createdAt: 12_001,
      code: "thread_provisioning_failed",
      message: "Provisioning thread failed",
      detail: `Setup script failed with exit code 1: ${WORKSPACE}/.bb-env-setup.sh`,
    }),
  ];
}

function stepTimes(row: TimelineThreadProvisioningSystemRow) {
  return row.steps.map((step) => ({
    label: step.label,
    status: step.status,
    durationMs:
      step.completedAt === null ? null : step.completedAt - step.startedAt,
    output: step.output,
  }));
}

describe("thread provisioning steps", () => {
  it("times each step from the server's receipt of its events", () => {
    const event = newEventFactory();
    const row = buildProvisioningRow([
      ...worktreeRunEvents(event),
      event.threadProvisioning({
        createdAt: 14_819,
        status: "completed",
        entries: [],
      }),
    ]);

    expect(row.detail).toBeNull();
    expect(stepTimes(row)).toEqual([
      {
        label: "Preparing workspace",
        status: "completed",
        durationMs: 7,
        output: null,
      },
      {
        label: "Preparing Worktree…",
        status: "completed",
        durationMs: 390,
        output: null,
      },
      {
        label: `Using workspace: ${WORKSPACE}`,
        status: "completed",
        durationMs: 13,
        output: null,
      },
      {
        label: "Running .bb-env-setup.sh",
        status: "completed",
        durationMs: 4_284,
        output: null,
      },
      {
        label: "Using branch: bb/fixture (5abadc8)",
        status: "completed",
        durationMs: 0,
        output: null,
      },
    ]);
  });

  it("keeps only the running step's last output line", () => {
    const row = buildProvisioningRow(
      worktreeRunEvents(newEventFactory(), 6),
      PROVISIONING,
    );

    expect(row.status).toBe("pending");
    expect(row.completedAt).toBeNull();
    expect(stepTimes(row)).toEqual([
      {
        label: "Preparing workspace",
        status: "completed",
        durationMs: 7,
        output: null,
      },
      {
        label: "Preparing Worktree…",
        status: "completed",
        durationMs: 390,
        output: null,
      },
      {
        label: `Using workspace: ${WORKSPACE}`,
        status: "completed",
        durationMs: 13,
        output: null,
      },
      {
        label: "Running .bb-env-setup.sh",
        status: "pending",
        durationMs: null,
        output: "Resolving packages: step 4 of 4",
      },
    ]);
    expect(row.steps.at(-1)?.startedAt).toBe(10_410);
  });

  it("reduces carriage-return progress to the visible last line", () => {
    const event = newEventFactory();
    const row = buildProvisioningRow(
      [
        event.threadProvisioning({
          status: "active",
          entries: [
            {
              type: "step",
              key: "git-worktree-started",
              text: "Creating worktree",
              status: "started",
            },
            {
              type: "output",
              key: "git-worktree-output-1",
              text: [
                "Preparing worktree (new branch 'bb/example')\n",
                "Updating files:  44% (1017/2287)\r",
                "Updating files: 100% (2287/2287), done.",
              ].join(""),
            },
          ],
        }),
      ],
      PROVISIONING,
    );

    expect(row.steps.map((step) => step.output)).toEqual([
      "Updating files: 100% (2287/2287), done.",
    ]);
  });

  it("marks the step that was running when provisioning failed", () => {
    const event = newEventFactory();
    const row = buildProvisioningRow([
      ...worktreeRunEvents(event, 4),
      event.threadProvisioning({
        createdAt: 10_500,
        status: "active",
        entries: [
          {
            type: "step",
            key: "git-worktree-started",
            text: "Creating branch bb/fixture from dev",
            status: "started",
          },
        ],
      }),
      event.threadProvisioning({
        createdAt: 10_669,
        status: "active",
        entries: [
          {
            type: "step",
            key: "git-worktree-failed",
            text: "Worktree setup failed",
            status: "failed",
          },
        ],
      }),
      event.threadProvisioning({
        createdAt: 10_700,
        status: "failed",
        entries: [
          {
            type: "step",
            key: "workspace-failed",
            text: "Workspace setup failed",
            status: "failed",
          },
        ],
      }),
      event.systemError({
        createdAt: 10_701,
        code: "thread_provisioning_failed",
        message: "Provisioning thread failed",
        detail: "fatal: invalid reference: dev",
      }),
    ]);

    expect(row.status).toBe("error");
    expect(row.detail).toBe("fatal: invalid reference: dev");
    expect(stepTimes(row).slice(-1)).toEqual([
      {
        label: "Creating branch bb/fixture from dev",
        status: "error",
        durationMs: 259,
        output: null,
      },
    ]);
    expect(row.steps.map((step) => step.label)).not.toContain(
      "Workspace setup failed",
    );
  });

  it("closes the step a user stopped as interrupted", () => {
    const event = newEventFactory();
    const row = buildProvisioningRow([
      ...worktreeRunEvents(event, 5),
      event.threadProvisioning({
        createdAt: 12_000,
        status: "cancelled",
        entries: [
          {
            type: "step",
            key: "provisioning-stopped",
            text: "Provisioning stopped by user request",
            status: "completed",
          },
        ],
      }),
    ]);

    expect(row.status).toBe("interrupted");
    expect(stepTimes(row).slice(-2)).toEqual([
      {
        label: "Running .bb-env-setup.sh",
        status: "interrupted",
        durationMs: 1_590,
        output: null,
      },
      {
        label: "Provisioning stopped by user request",
        status: "completed",
        durationMs: 0,
        output: null,
      },
    ]);
  });

  it("keeps the last output lines of the step that failed", () => {
    const row = buildProvisioningRow(failedSetupEvents(newEventFactory(), 30));

    expect(row.status).toBe("error");
    expect(row.steps.at(-1)).toMatchObject({
      label: "Running .bb-env-setup.sh",
      status: "error",
    });
    expect(row.steps.at(-1)?.output?.split("\n")).toEqual([
      ...Array.from(
        { length: 19 },
        (_, index) => `Progress: step ${index + 12}`,
      ),
      SETUP_LOCKFILE_ERROR,
    ]);
  });

  it("closes the running step as interrupted when the daemon reports its cancel after the stop", () => {
    const event = newEventFactory();
    const row = buildProvisioningRow([
      ...worktreeRunEvents(event, 5),
      event.threadProvisioning({
        createdAt: 12_000,
        status: "cancelled",
        entries: [
          {
            type: "step",
            key: "provisioning-stopped",
            text: "Provisioning stopped by user request",
            status: "completed",
          },
        ],
      }),
      event.threadProvisioning({
        createdAt: 12_400,
        status: "cancelled",
        entries: [
          {
            type: "step",
            key: "setup-cancelled",
            text: ".bb-env-setup.sh cancelled",
            status: "failed",
            metadata: { durationMs: 940 },
          },
        ],
      }),
    ]);

    expect(row.status).toBe("interrupted");
    expect(stepTimes(row).slice(-2)).toEqual([
      {
        label: "Running .bb-env-setup.sh",
        status: "interrupted",
        durationMs: 1_590,
        output: null,
      },
      {
        label: "Provisioning stopped by user request",
        status: "completed",
        durationMs: 0,
        output: null,
      },
    ]);
  });

  it("stops the clock of a provisioning that a retry replaced", () => {
    const event = newEventFactory();
    const events = [
      event.threadProvisioning({
        provisioningId: "tpv-first",
        createdAt: 10_000,
        status: "active",
        entries: [
          {
            type: "step",
            key: "workspace-started",
            text: "Preparing workspace",
            status: "started",
          },
        ],
      }),
      event.threadProvisioning({
        provisioningId: "tpv-retry",
        createdAt: 7_210_000,
        status: "active",
        entries: [
          {
            type: "step",
            key: "workspace-started",
            text: "Preparing workspace",
            status: "started",
          },
        ],
      }),
    ];

    expect(
      buildProvisioningRows(events, {
        activeProvisioningId: "tpv-retry",
        threadStatus: "starting",
      }).map((row) => [row.provisioningId, row.status]),
    ).toEqual([
      ["tpv-first", "interrupted"],
      ["tpv-retry", "pending"],
    ]);
    expect(
      buildProvisioningRows(events, { threadStatus: "active" }).map(
        (row) => row.status,
      ),
    ).toEqual(["interrupted", "interrupted"]);
  });

  it("keeps the thread's own provisioning running when a shared workspace reports under the provisioning that created it", () => {
    const event = newEventFactory();
    const events = [
      event.threadProvisioning({
        provisioningId: "tpv-own",
        createdAt: 10_000,
        status: "active",
        entries: [
          {
            type: "step",
            key: "workspace-started",
            text: "Preparing workspace",
            status: "started",
          },
        ],
      }),
      event.threadProvisioning({
        provisioningId: "tpv-initiator",
        createdAt: 20_000,
        status: "active",
        entries: [
          {
            type: "step",
            key: "workspace-path",
            text: `Using workspace: ${WORKSPACE}`,
            status: "completed",
          },
          {
            type: "step",
            key: "workspace-branch",
            text: "Using branch: bb/initiator",
            status: "completed",
          },
        ],
      }),
    ];

    expect(
      buildProvisioningRows(events, {
        activeProvisioningId: "tpv-own",
        threadStatus: "starting",
      }).map((row) => [row.provisioningId, row.status, row.title]),
    ).toEqual([
      ["tpv-own", "pending", "Provisioning thread"],
      ["tpv-initiator", "interrupted", "Provisioning thread interrupted"],
    ]);
  });
});

describe("thread provisioning title", () => {
  const estimate: TimelineProvisioningEstimate = {
    p50Ms: 31_000,
    p90Ms: 63_000,
    runCount: 12,
    scope: "project",
  };

  it("runs a live clock and the estimate while provisioning", () => {
    const row = buildProvisioningRow(
      worktreeRunEvents(newEventFactory(), 2),
      PROVISIONING,
    );
    const title = buildTimelineRowTitle({ ...row, estimate }, TITLE_OPTIONS);

    expect(title.segments.map((segment) => segment.text)).toEqual([
      "Provisioning thread…",
    ]);
    expect(title.decorations).toEqual([
      { kind: "duration", startedAt: 10_000, completedAt: null, em: false },
      {
        kind: "provisioning-estimate",
        startedAt: 10_000,
        p50Ms: 31_000,
        p90Ms: 63_000,
      },
    ]);
    expect(title.plain).toBe("Provisioning thread… (usually ~31s)");
  });

  it("shows only the clock without an estimate", () => {
    const row = buildProvisioningRow(
      worktreeRunEvents(newEventFactory(), 2),
      PROVISIONING,
    );

    expect(buildTimelineRowTitle(row, TITLE_OPTIONS).decorations).toEqual([
      { kind: "duration", startedAt: 10_000, completedAt: null, em: false },
    ]);
  });

  it("ends with the total provisioning time", () => {
    const event = newEventFactory();
    const row = buildProvisioningRow([
      ...worktreeRunEvents(event),
      event.threadProvisioning({
        createdAt: 43_000,
        status: "completed",
        entries: [],
      }),
    ]);

    expect(buildTimelineRowTitle(row, TITLE_OPTIONS).plain).toBe(
      "Provisioned thread (33s)",
    );
  });

  it("keeps the failure status next to the time it failed after", () => {
    const event = newEventFactory();
    const row = buildProvisioningRow([
      ...worktreeRunEvents(event, 2),
      event.threadProvisioning({
        createdAt: 49_000,
        status: "failed",
        entries: [],
      }),
    ]);

    expect(buildTimelineRowTitle(row, TITLE_OPTIONS).plain).toBe(
      "Provisioning thread failed (39s, error)",
    );
  });
});

describe("provisioningEstimateProgress", () => {
  const estimate = { p50Ms: 31_000, p90Ms: 63_000 };

  it("counts down to the median in whole seconds", () => {
    expect(provisioningEstimateProgress(estimate, 19_400)).toEqual({
      kind: "remaining",
      remainingMs: 12_000,
    });
    expect(provisioningEstimateProgress(estimate, 30_900)).toEqual({
      kind: "remaining",
      remainingMs: 1_000,
    });
  });

  it("says nothing between the median and the p90", () => {
    expect(provisioningEstimateProgress(estimate, 31_000)).toEqual({
      kind: "usual",
    });
    expect(provisioningEstimateProgress(estimate, 63_000)).toEqual({
      kind: "usual",
    });
  });

  it("flags a run past the p90 as slower than usual", () => {
    expect(provisioningEstimateProgress(estimate, 63_001)).toEqual({
      kind: "slow",
    });
  });

  it("never calls a run slow without a p90", () => {
    const withoutP90 = { p50Ms: 31_000, p90Ms: null };

    expect(provisioningEstimateProgress(withoutP90, 19_400)).toEqual({
      kind: "remaining",
      remainingMs: 12_000,
    });
    expect(provisioningEstimateProgress(withoutP90, 600_000)).toEqual({
      kind: "usual",
    });
  });
});

describe("thread provisioning CLI text", () => {
  it("lists each step with its duration under the total", () => {
    const event = newEventFactory();
    const row: TimelineRow = buildProvisioningRow([
      ...worktreeRunEvents(event),
      event.threadProvisioning({
        createdAt: 14_819,
        status: "completed",
        entries: [],
      }),
    ]);

    expect(formatThreadTimelineText([row])).toBe(
      [
        "── Provisioned thread (5s) ─────────────────────────────────",
        "  Preparing workspace                 7ms",
        "  Preparing Worktree…                 390ms",
        "  Using workspace: /work/fixture      13ms",
        "  Running .bb-env-setup.sh            4s",
        "  Using branch: bb/fixture (5abadc8)",
      ].join("\n"),
    );
  });

  it("keeps the times in one column when a step label is very long", () => {
    const longLabel = `Using workspace: ${"/nested".repeat(8)}/repo`;
    const row: TimelineRow = {
      id: "thread-1:op:thread-provisioning:tpv_1",
      threadId: "thread-1",
      turnId: null,
      sourceSeqStart: 1,
      sourceSeqEnd: 3,
      startedAt: 0,
      createdAt: 0,
      kind: "system",
      systemKind: "operation",
      operationKind: "thread-provisioning",
      provisioningId: "tpv_1",
      title: "Provisioned thread",
      detail: null,
      status: "completed",
      completedAt: 2_000,
      steps: [
        {
          label: "Creating worktree",
          status: "completed",
          startedAt: 0,
          completedAt: 300,
          output: null,
        },
        {
          label: longLabel,
          status: "completed",
          startedAt: 300,
          completedAt: 305,
          output: null,
        },
        {
          label: "Running .bb-env-setup.sh",
          status: "completed",
          startedAt: 305,
          completedAt: 2_000,
          output: null,
        },
      ],
      estimate: null,
    };

    expect(formatThreadTimelineText([row]).split("\n").slice(1)).toEqual([
      `  ${"Creating worktree".padEnd(48)}  300ms`,
      `  ${longLabel}  5ms`,
      `  ${"Running .bb-env-setup.sh".padEnd(48)}  2s`,
    ]);
  });

  it("shows the running step with its last output line", () => {
    const row: TimelineRow = buildProvisioningRow(
      worktreeRunEvents(newEventFactory(), 6),
      PROVISIONING,
    );

    expect(formatThreadTimelineText([row])).toContain(
      [
        "  Running .bb-env-setup.sh        running",
        "    Resolving packages: step 4 of 4",
      ].join("\n"),
    );
  });

  it("prints the failed step's last output lines under it", () => {
    const row: TimelineRow = buildProvisioningRow(
      failedSetupEvents(newEventFactory(), 2),
    );

    expect(formatThreadTimelineText([row])).toContain(
      [
        "  Running .bb-env-setup.sh        1s error",
        "    Progress: step 1",
        "    Progress: step 2",
        `    ${SETUP_LOCKFILE_ERROR}`,
        `  Setup script failed with exit code 1: ${WORKSPACE}/.bb-env-setup.sh`,
      ].join("\n"),
    );
  });
});
