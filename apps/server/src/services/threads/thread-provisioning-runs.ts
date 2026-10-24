import { performance } from "node:perf_hooks";
import {
  getStoredEventCreatedAt,
  getThread,
  insertThreadProvisioningRun,
  listRecentProvisioningDurations,
  type DbQueryConnection,
  type DbTransaction,
  type ThreadProvisioningRunScope,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import type {
  TimelineProvisioningEstimate,
  TimelineRow,
} from "@bb/server-contract";
import {
  getThreadProvisionContext,
  type ThreadProvisionContext,
  type ThreadProvisionRequestedProvider,
} from "./thread-startup-store.js";

export const PROVISIONING_ESTIMATE_RUN_LIMIT = 20;
export const PROVISIONING_ESTIMATE_MIN_RUNS = 3;
export const PROVISIONING_ESTIMATE_P90_MIN_RUNS = 10;

const SERVER_PROCESS_STARTED_AT = performance.timeOrigin;

interface RecordCompletedThreadProvisioningRunArgs {
  completedSequence: number;
  context: ThreadProvisionContext;
  threadId: string;
}

export function recordCompletedThreadProvisioningRunInTransaction(
  db: DbTransaction,
  args: RecordCompletedThreadProvisioningRunArgs,
): void {
  const { provisionEventSequence: startSequence, requestedProvider } =
    args.context.state;
  if (requestedProvider === null || startSequence === null) return;
  const thread = getThread(db, args.threadId);
  const startedAt = getStoredEventCreatedAt(db, {
    sequence: startSequence,
    threadId: args.threadId,
  });
  const finishedAt = getStoredEventCreatedAt(db, {
    sequence: args.completedSequence,
    threadId: args.threadId,
  });
  if (
    thread === null ||
    startedAt === null ||
    finishedAt === null ||
    startedAt < SERVER_PROCESS_STARTED_AT
  ) {
    return;
  }
  insertThreadProvisioningRun(db, {
    provisioningId: args.context.state.provisioningId,
    threadId: thread.id,
    projectId: thread.projectId,
    environmentProviderId: requestedProvider.environmentProviderId,
    machineKind: requestedProvider.machineKind,
    startedAt,
    finishedAt,
  });
}

interface ResolveProvisioningEstimateArgs extends ThreadProvisionRequestedProvider {
  projectId: string;
}

export interface ActiveThreadProvisioning {
  estimate: TimelineProvisioningEstimate | null;
  provisioningId: string;
}

function nearestRankPercentile(
  sortedDurations: readonly number[],
  percentile: number,
): number | undefined {
  const rank = Math.ceil(percentile * sortedDurations.length);
  return sortedDurations[Math.max(rank, 1) - 1];
}

function summarizeProvisioningDurations(
  durations: readonly number[],
  scope: TimelineProvisioningEstimate["scope"],
): TimelineProvisioningEstimate | null {
  if (durations.length < PROVISIONING_ESTIMATE_MIN_RUNS) return null;
  const sorted = [...durations].sort((left, right) => left - right);
  const p50Ms = nearestRankPercentile(sorted, 0.5);
  if (p50Ms === undefined) return null;
  const p90Ms =
    sorted.length >= PROVISIONING_ESTIMATE_P90_MIN_RUNS
      ? (nearestRankPercentile(sorted, 0.9) ?? null)
      : null;
  return { p50Ms, p90Ms, runCount: sorted.length, scope };
}

export function resolveProvisioningEstimate(
  db: DbQueryConnection,
  args: ResolveProvisioningEstimateArgs,
): TimelineProvisioningEstimate | null {
  const listDurations = (scope: ThreadProvisioningRunScope) =>
    listRecentProvisioningDurations(db, {
      environmentProviderId: args.environmentProviderId,
      limit: PROVISIONING_ESTIMATE_RUN_LIMIT,
      machineKind: args.machineKind,
      scope,
    });
  return (
    summarizeProvisioningDurations(
      listDurations({ kind: "project", projectId: args.projectId }),
      "project",
    ) ??
    summarizeProvisioningDurations(
      listDurations({ kind: "all-projects" }),
      "all-projects",
    )
  );
}

export function resolveActiveThreadProvisioning(
  db: DbQueryConnection,
  thread: Pick<Thread, "id" | "projectId" | "status">,
): ActiveThreadProvisioning | null {
  if (thread.status !== "starting") return null;
  const context = getThreadProvisionContext(db, thread.id);
  if (context === null) return null;
  const { provisioningId, requestedProvider } = context.state;
  return {
    estimate:
      requestedProvider === null
        ? null
        : resolveProvisioningEstimate(db, {
            ...requestedProvider,
            projectId: thread.projectId,
          }),
    provisioningId,
  };
}

export function withProvisioningEstimate(
  row: TimelineRow,
  active: ActiveThreadProvisioning | null,
): TimelineRow {
  if (
    active === null ||
    active.estimate === null ||
    row.kind !== "system" ||
    row.systemKind !== "operation" ||
    row.operationKind !== "thread-provisioning" ||
    row.status !== "pending" ||
    row.provisioningId !== active.provisioningId
  ) {
    return row;
  }
  return { ...row, estimate: active.estimate };
}
