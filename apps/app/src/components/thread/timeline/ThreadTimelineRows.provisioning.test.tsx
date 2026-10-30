// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TimelineProvisioningEstimate,
  TimelineProvisioningStep,
  TimelineRow,
  TimelineRowStatus,
} from "@bb/server-contract";
import { systemRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

const STARTED_AT = 1_778_000_000_000;

interface ProvisioningRowArgs {
  completedAt?: number | null;
  detail?: string | null;
  estimate?: TimelineProvisioningEstimate | null;
  status?: TimelineRowStatus;
  steps?: TimelineProvisioningStep[];
  title?: string;
}

function provisioningRow({
  completedAt = null,
  detail = null,
  estimate = null,
  status = "pending",
  steps = [],
  title = "Provisioning thread",
}: ProvisioningRowArgs = {}): TimelineRow {
  return systemRow({
    id: "thr_provisioning:op:thread-provisioning:tpv_1",
    threadId: "thr_provisioning",
    startedAt: STARTED_AT,
    createdAt: STARTED_AT,
    systemKind: "operation",
    operationKind: "thread-provisioning",
    title,
    detail,
    status,
    completedAt,
    steps,
    estimate,
  });
}

function renderRow(row: TimelineRow) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ThreadTimelineRows
          initialExpanded={new Set([row.id])}
          timelineRows={[row]}
          threadRuntimeDisplayStatus="provisioning"
          workspaceRootPath={undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function titleText(): string {
  const title = screen.getByTitle((value) => value.startsWith("Provision"));
  return title.textContent?.replace(/\s+/gu, " ").trim() ?? "";
}

const ESTIMATE: TimelineProvisioningEstimate = {
  p50Ms: 31_000,
  p90Ms: 40_000,
  runCount: 20,
  scope: "project",
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("thread provisioning row", () => {
  it("runs a clock with the time left, then says it is slower than usual past the p90", () => {
    vi.useFakeTimers({ now: STARTED_AT + 19_000 });
    renderRow(provisioningRow({ estimate: ESTIMATE }));

    expect(titleText()).toBe("Provisioning thread… 19s · ~12s left");

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(titleText()).toBe("Provisioning thread… 34s");

    act(() => {
      vi.advanceTimersByTime(7_000);
    });
    expect(titleText()).toBe("Provisioning thread… 41s · slower than usual");
  });

  it("never says slower than usual without a p90", () => {
    vi.useFakeTimers({ now: STARTED_AT + 41_000 });
    renderRow(
      provisioningRow({ estimate: { ...ESTIMATE, p90Ms: null, runCount: 5 } }),
    );

    expect(titleText()).toBe("Provisioning thread… 41s");
  });

  it("shows only the clock without provisioning history", () => {
    vi.useFakeTimers({ now: STARTED_AT + 19_000 });
    renderRow(provisioningRow());

    expect(titleText()).toBe("Provisioning thread… 19s");
  });

  it("shows the final duration once provisioned", () => {
    renderRow(
      provisioningRow({
        completedAt: STARTED_AT + 33_000,
        status: "completed",
        title: "Provisioned thread",
      }),
    );

    expect(titleText()).toBe("Provisioned thread 33s");
  });

  it("lists each step with its time and keeps only the running step's last output line", () => {
    vi.useFakeTimers({ now: STARTED_AT + 6_000 });
    renderRow(
      provisioningRow({
        steps: [
          {
            label: "Preparing worktree…",
            status: "completed",
            startedAt: STARTED_AT,
            completedAt: STARTED_AT + 390,
            output: null,
          },
          {
            label: "Using workspace: /tmp/worktrees/env_1/repo",
            status: "completed",
            startedAt: STARTED_AT + 390,
            completedAt: STARTED_AT + 390,
            output: null,
          },
          {
            label: "Running .bb-env-setup.sh",
            status: "pending",
            startedAt: STARTED_AT + 1_000,
            completedAt: null,
            output: "Progress: resolved 1094, reused 1093",
          },
        ],
      }),
    );

    const steps = screen.getByTestId("provisioning-steps");
    expect(
      Array.from(steps.children, (cell) => cell.textContent ?? ""),
    ).toEqual([
      "Preparing worktree…",
      "390ms",
      "Using workspace: /tmp/worktrees/env_1/repo",
      "",
      "Running .bb-env-setup.sh",
      "5s",
      "Progress: resolved 1094, reused 1093",
    ]);
  });

  it("puts the provisioning error under the failed step", () => {
    renderRow(
      provisioningRow({
        completedAt: STARTED_AT + 259,
        detail: "fatal: invalid reference: dev",
        status: "error",
        steps: [
          {
            label: "Preparing worktree…",
            status: "error",
            startedAt: STARTED_AT,
            completedAt: STARTED_AT + 259,
            output: null,
          },
        ],
        title: "Provisioning thread failed",
      }),
    );

    const steps = screen.getByTestId("provisioning-steps");
    expect(
      Array.from(steps.children, (cell) => cell.textContent ?? ""),
    ).toEqual([
      "Preparing worktree…",
      "259ms",
      "fatal: invalid reference: dev",
    ]);
    expect(steps.children[2]?.className).toContain("text-destructive-text");
  });

  it("keeps the failed step's last output lines above the error", () => {
    renderRow(
      provisioningRow({
        completedAt: STARTED_AT + 1_200,
        detail: "Setup script failed with exit code 1: /work/.bb-env-setup.sh",
        status: "error",
        steps: [
          {
            label: "Running .bb-env-setup.sh",
            status: "error",
            startedAt: STARTED_AT,
            completedAt: STARTED_AT + 1_200,
            output: [
              "Installing dependencies",
              "ERR_PNPM_NO_LOCKFILE  Cannot install with frozen-lockfile because pnpm-lock.yaml is absent",
            ].join("\n"),
          },
        ],
        title: "Provisioning thread failed",
      }),
    );

    const steps = screen.getByTestId("provisioning-steps");
    expect(
      Array.from(steps.children, (cell) => cell.textContent ?? ""),
    ).toEqual([
      "Running .bb-env-setup.sh",
      "1s",
      "Installing dependencies\nERR_PNPM_NO_LOCKFILE  Cannot install with frozen-lockfile because pnpm-lock.yaml is absent",
      "Setup script failed with exit code 1: /work/.bb-env-setup.sh",
    ]);
    expect(steps.children[2]?.className).toContain("whitespace-pre-wrap");
    expect(steps.children[3]?.className).toContain("text-destructive-text");
  });
});
