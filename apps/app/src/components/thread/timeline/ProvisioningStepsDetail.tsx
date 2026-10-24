import { Fragment } from "react";
import type {
  TimelineProvisioningStep,
  TimelineRowStatus,
} from "@bb/server-contract";
import { assertNever, durationToCompactString } from "@bb/thread-view";
import { cn } from "@bb/shared-ui/lib/utils";
import { LiveDurationText } from "./LiveDurationText.js";

interface ProvisioningStepsDetailProps {
  error: string | null;
  steps: readonly TimelineProvisioningStep[];
}

function stepToneClass(status: TimelineRowStatus): string {
  switch (status) {
    case "pending":
      return "text-foreground";
    case "completed":
      return "text-muted-foreground";
    case "error":
      return "text-destructive-text";
    case "interrupted":
      return "text-subtle-foreground";
    default:
      return assertNever(status);
  }
}

function StepTime({ step }: { step: TimelineProvisioningStep }) {
  if (step.completedAt === null) {
    return <LiveDurationText startedAt={step.startedAt} />;
  }
  const elapsedMs = step.completedAt - step.startedAt;
  return elapsedMs > 0 ? <>{durationToCompactString(elapsedMs)}</> : null;
}

export function ProvisioningStepsDetail({
  error,
  steps,
}: ProvisioningStepsDetailProps) {
  const errorStepIndex = steps.findIndex((step) => step.status === "error");
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3 font-mono text-xs leading-tight">
      <div
        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-8 gap-y-1"
        data-testid="provisioning-steps"
      >
        {steps.map((step, index) => (
          <Fragment key={`${index}:${step.label}`}>
            <span
              className={cn(
                "truncate",
                stepToneClass(step.status),
                step.status === "pending" && "animate-shine",
              )}
            >
              {step.label}
            </span>
            <span
              className={cn(
                "text-right tabular-nums",
                stepToneClass(step.status),
              )}
            >
              <StepTime step={step} />
            </span>
            {step.output !== null ? (
              <span
                className={cn(
                  "col-span-2 pl-4 text-subtle-foreground",
                  step.status === "error"
                    ? "whitespace-pre-wrap break-words"
                    : "truncate",
                )}
              >
                {step.output}
              </span>
            ) : null}
            {index === errorStepIndex && error !== null ? (
              <span className="col-span-2 whitespace-pre-wrap break-words pl-4 text-destructive-text">
                {error}
              </span>
            ) : null}
          </Fragment>
        ))}
        {error !== null && errorStepIndex === -1 ? (
          <span className="col-span-2 whitespace-pre-wrap break-words text-destructive-text">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
