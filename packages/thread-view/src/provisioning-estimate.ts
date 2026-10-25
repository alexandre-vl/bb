import type { TimelineProvisioningEstimate } from "@bb/server-contract";

export type ProvisioningEstimateProgress =
  | { kind: "remaining"; remainingMs: number }
  | { kind: "usual" }
  | { kind: "slow" };

export function provisioningEstimateProgress(
  estimate: Pick<TimelineProvisioningEstimate, "p50Ms" | "p90Ms">,
  elapsedMs: number,
): ProvisioningEstimateProgress {
  if (estimate.p90Ms !== null && elapsedMs > estimate.p90Ms) {
    return { kind: "slow" };
  }
  if (elapsedMs < estimate.p50Ms) {
    return {
      kind: "remaining",
      remainingMs: Math.ceil((estimate.p50Ms - elapsedMs) / 1_000) * 1_000,
    };
  }
  return { kind: "usual" };
}
