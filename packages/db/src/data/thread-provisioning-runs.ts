import { and, desc, eq, sql } from "drizzle-orm";
import type { EnvironmentMachineSelection } from "@bb/domain";
import type { DbQueryConnection } from "../connection.js";
import { threadProvisioningRuns } from "../schema.js";

export type ThreadProvisioningRun = typeof threadProvisioningRuns.$inferInsert;

export type ThreadProvisioningRunScope =
  | { kind: "project"; projectId: string }
  | { kind: "all-projects" };

export interface ListRecentProvisioningDurationsArgs {
  environmentProviderId: string;
  limit: number;
  machineKind: EnvironmentMachineSelection["type"];
  scope: ThreadProvisioningRunScope;
}

export function insertThreadProvisioningRun(
  db: DbQueryConnection,
  run: ThreadProvisioningRun,
): void {
  db.insert(threadProvisioningRuns).values(run).onConflictDoNothing().run();
}

export function listRecentProvisioningDurations(
  db: DbQueryConnection,
  args: ListRecentProvisioningDurationsArgs,
): number[] {
  return db
    .select({
      durationMs: sql<number>`${threadProvisioningRuns.finishedAt} - ${threadProvisioningRuns.startedAt}`,
    })
    .from(threadProvisioningRuns)
    .where(
      and(
        args.scope.kind === "project"
          ? eq(threadProvisioningRuns.projectId, args.scope.projectId)
          : undefined,
        eq(
          threadProvisioningRuns.environmentProviderId,
          args.environmentProviderId,
        ),
        eq(threadProvisioningRuns.machineKind, args.machineKind),
      ),
    )
    .orderBy(desc(threadProvisioningRuns.finishedAt))
    .limit(args.limit)
    .all()
    .map((row) => row.durationMs);
}
