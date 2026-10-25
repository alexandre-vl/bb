import { describe, expect, it } from "vitest";
import type {
  ThreadTimelineResponse,
  TimelineThreadProvisioningSystemRow,
} from "@bb/server-contract";
import { createNodeBbSdk, type FetchImplementation } from "@bb/sdk/node";
import {
  fetchActiveProvisioning,
  formatActiveProvisioningLines,
} from "./provisioning.js";

const STARTED_AT = 1_778_000_000_000;

function provisioningRow(
  overrides: Partial<TimelineThreadProvisioningSystemRow> = {},
): TimelineThreadProvisioningSystemRow {
  return {
    id: "thr_1:op:thread-provisioning:tpv_1",
    threadId: "thr_1",
    turnId: null,
    sourceSeqStart: 3,
    sourceSeqEnd: 9,
    startedAt: STARTED_AT,
    createdAt: STARTED_AT,
    kind: "system",
    systemKind: "operation",
    operationKind: "thread-provisioning",
    provisioningId: "tpv_1",
    title: "Provisioning thread",
    detail: null,
    status: "pending",
    completedAt: null,
    steps: [
      {
        label: "Preparing worktree…",
        status: "completed",
        startedAt: STARTED_AT,
        completedAt: STARTED_AT + 390,
        output: null,
      },
      {
        label: "Running .bb-env-setup.sh",
        status: "pending",
        startedAt: STARTED_AT + 4_000,
        completedAt: null,
        output: "Progress: resolved 1094",
      },
    ],
    estimate: {
      p50Ms: 31_000,
      p90Ms: 40_000,
      runCount: 20,
      scope: "project",
    },
    ...overrides,
  };
}

function timelineResponse(
  rows: ThreadTimelineResponse["rows"],
): ThreadTimelineResponse {
  return {
    activePromptMode: null,
    contextBoundarySeq: null,
    completedTurnDisplay: "collapse",
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    providerCommands: null,
    sessionOptions: null,
    modelFallback: null,
    rows,
    maxSeq: 9,
    timelinePage: {
      returnedSegmentCount: rows.length,
      olderCursor: null,
      historySnapshot: "snapshot-1",
      olderRowsSourceSeqEnd: null,
    },
  };
}

describe("formatActiveProvisioningLines", () => {
  it("shows the elapsed time, the time left and the running step", () => {
    expect(
      formatActiveProvisioningLines(provisioningRow(), STARTED_AT + 19_000),
    ).toEqual([
      "  Provisioning: 19s · ~12s left (usually ~31s, p90 40s, last 20 runs in this project)",
      "    Running .bb-env-setup.sh (15s)",
    ]);
  });

  it("says when provisioning is slower than usual", () => {
    expect(
      formatActiveProvisioningLines(provisioningRow(), STARTED_AT + 41_000)[0],
    ).toBe(
      "  Provisioning: 41s · slower than usual (usually ~31s, p90 40s, last 20 runs in this project)",
    );
  });

  it("leaves out the p90 and never says slower than usual below 10 runs", () => {
    expect(
      formatActiveProvisioningLines(
        provisioningRow({
          estimate: {
            p50Ms: 31_000,
            p90Ms: null,
            runCount: 5,
            scope: "all-projects",
          },
        }),
        STARTED_AT + 60_000,
      )[0],
    ).toBe("  Provisioning: 1m (usually ~31s, last 5 runs across projects)");
  });

  it("shows only the elapsed time without history", () => {
    expect(
      formatActiveProvisioningLines(
        provisioningRow({ estimate: null, steps: [] }),
        STARTED_AT + 19_000,
      ),
    ).toEqual(["  Provisioning: 19s"]);
  });
});

describe("fetchActiveProvisioning", () => {
  it("reads the running provisioning row from the thread timeline", async () => {
    const requestUrls: string[] = [];
    const fetchMock: FetchImplementation = async (input) => {
      requestUrls.push(String(input));
      return Response.json(
        timelineResponse([
          provisioningRow({
            id: "earlier",
            status: "error",
            title: "Provisioning thread failed",
          }),
          provisioningRow(),
        ]),
      );
    };
    const sdk = createNodeBbSdk({
      baseUrl: "http://bb.test",
      fetch: fetchMock,
    });

    const row = await fetchActiveProvisioning({ sdk, threadId: "thr_1" });

    expect(row?.id).toBe("thr_1:op:thread-provisioning:tpv_1");
    expect(requestUrls).toEqual([
      "http://bb.test/api/v1/threads/thr_1/timeline?",
    ]);
  });

  it("reads the running provisioning row when a row after it was interrupted", async () => {
    const fetchMock: FetchImplementation = async () =>
      Response.json(
        timelineResponse([
          provisioningRow(),
          provisioningRow({
            id: "thr_1:op:thread-provisioning:tpv_initiator",
            provisioningId: "tpv_initiator",
            status: "interrupted",
            title: "Provisioning thread interrupted",
            estimate: null,
          }),
        ]),
      );
    const sdk = createNodeBbSdk({
      baseUrl: "http://bb.test",
      fetch: fetchMock,
    });

    const row = await fetchActiveProvisioning({ sdk, threadId: "thr_1" });

    expect(row?.provisioningId).toBe("tpv_1");
  });

  it("has nothing once the latest provisioning finished", async () => {
    const fetchMock: FetchImplementation = async () =>
      Response.json(
        timelineResponse([
          provisioningRow({
            status: "completed",
            completedAt: STARTED_AT + 33_000,
            title: "Provisioned thread",
          }),
        ]),
      );
    const sdk = createNodeBbSdk({
      baseUrl: "http://bb.test",
      fetch: fetchMock,
    });

    expect(await fetchActiveProvisioning({ sdk, threadId: "thr_1" })).toBe(
      null,
    );
  });
});
