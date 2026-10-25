import {
  assertNever,
  durationToCompactString,
  provisioningEstimateProgress,
} from "@bb/thread-view";
import { cn } from "@bb/shared-ui/lib/utils";
import { useSecondTick } from "@/hooks/useSecondTick";

interface ProvisioningEstimateTextProps {
  className: string;
  p50Ms: number;
  p90Ms: number | null;
  startedAt: number;
}

export function ProvisioningEstimateText({
  className,
  p50Ms,
  p90Ms,
  startedAt,
}: ProvisioningEstimateTextProps) {
  const progress = provisioningEstimateProgress(
    { p50Ms, p90Ms },
    useSecondTick() - startedAt,
  );
  switch (progress.kind) {
    case "remaining":
      return (
        <span className={cn(className, "tabular-nums text-subtle-foreground")}>
          · ~{durationToCompactString(progress.remainingMs)} left
        </span>
      );
    case "slow":
      return (
        <span className={cn(className, "text-warning-text")}>
          · slower than usual
        </span>
      );
    case "usual":
      return null;
    default:
      return assertNever(progress);
  }
}
