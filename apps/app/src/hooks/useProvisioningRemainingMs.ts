import { provisioningEstimateProgress } from "@bb/thread-view";
import type { ActiveProvisioningEstimate } from "@/lib/thread-provisioning-estimate";
import { useSecondTickValue } from "./useSecondTick";

export function useProvisioningRemainingMs(
  estimate: ActiveProvisioningEstimate | null,
): number | null {
  return useSecondTickValue(estimate !== null, (nowMs) => {
    if (estimate === null) return null;
    const progress = provisioningEstimateProgress(
      estimate,
      nowMs - estimate.startedAt,
    );
    return progress.kind === "remaining" ? progress.remainingMs : null;
  });
}
