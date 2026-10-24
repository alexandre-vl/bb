import type { TimelineRow } from "@bb/server-contract";

export interface ActiveProvisioningEstimate {
  p50Ms: number;
  p90Ms: number | null;
  startedAt: number;
}

export function findActiveProvisioningEstimate(
  rows: readonly TimelineRow[],
): ActiveProvisioningEstimate | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (
      row?.kind !== "system" ||
      row.systemKind !== "operation" ||
      row.operationKind !== "thread-provisioning" ||
      row.status !== "pending"
    ) {
      continue;
    }
    return row.estimate === null
      ? null
      : {
          p50Ms: row.estimate.p50Ms,
          p90Ms: row.estimate.p90Ms,
          startedAt: row.startedAt,
        };
  }
  return null;
}
