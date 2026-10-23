import type { BbSdk } from "@bb/sdk";
import type {
  TimelineRow,
  TimelineThreadProvisioningSystemRow,
} from "@bb/server-contract";
import {
  durationToCompactString,
  provisioningEstimateProgress,
} from "@bb/thread-view";

interface FetchActiveProvisioningArgs {
  sdk: Pick<BbSdk, "threads">;
  threadId: string;
}

function findActiveProvisioningRow(
  rows: readonly TimelineRow[],
): TimelineThreadProvisioningSystemRow | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (
      row?.kind === "system" &&
      row.systemKind === "operation" &&
      row.operationKind === "thread-provisioning" &&
      row.status === "pending"
    ) {
      return row;
    }
  }
  return null;
}

export async function fetchActiveProvisioning(
  args: FetchActiveProvisioningArgs,
): Promise<TimelineThreadProvisioningSystemRow | null> {
  try {
    const timeline = await args.sdk.threads.timeline({
      threadId: args.threadId,
    });
    return findActiveProvisioningRow(timeline.rows);
  } catch {
    return null;
  }
}

function formatEstimate(
  row: TimelineThreadProvisioningSystemRow,
  elapsedMs: number,
): string {
  if (row.estimate === null) return "";
  const progress = provisioningEstimateProgress(row.estimate, elapsedMs);
  const status =
    progress.kind === "remaining"
      ? ` · ~${durationToCompactString(progress.remainingMs)} left`
      : progress.kind === "slow"
        ? " · slower than usual"
        : "";
  const scope =
    row.estimate.scope === "project" ? "in this project" : "across projects";
  const p90 =
    row.estimate.p90Ms === null
      ? ""
      : `, p90 ${durationToCompactString(row.estimate.p90Ms)}`;
  return `${status} (usually ~${durationToCompactString(row.estimate.p50Ms)}${p90}, last ${row.estimate.runCount} runs ${scope})`;
}

export function formatActiveProvisioningLines(
  row: TimelineThreadProvisioningSystemRow | null,
  now: number,
): string[] {
  if (row === null) return [];
  const elapsedMs = Math.max(0, now - row.startedAt);
  const lines = [
    `  Provisioning: ${durationToCompactString(elapsedMs)}${formatEstimate(row, elapsedMs)}`,
  ];
  const running = row.steps.find((step) => step.status === "pending");
  if (running !== undefined) {
    lines.push(
      `    ${running.label} (${durationToCompactString(Math.max(0, now - running.startedAt))})`,
    );
  }
  return lines;
}
