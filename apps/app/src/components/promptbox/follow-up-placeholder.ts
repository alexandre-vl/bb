import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import { assertNever } from "@bb/core-ui";
import { durationToCompactString } from "@bb/thread-view";

function withProvisioningRemaining(
  placeholder: string,
  provisioningRemainingMs: number | null,
): string {
  return provisioningRemainingMs === null
    ? placeholder
    : `${placeholder} ~${durationToCompactString(provisioningRemainingMs)}`;
}

export function getFollowUpPromptPlaceholder(
  displayStatus: ThreadRuntimeDisplayStatus,
  provisioningRemainingMs: number | null,
): string {
  switch (displayStatus) {
    case "provisioning":
      return withProvisioningRemaining(
        "Setting up workspace...",
        provisioningRemainingMs,
      );
    case "starting":
      return withProvisioningRemaining(
        "Starting thread...",
        provisioningRemainingMs,
      );
    case "stopping":
      return "Queue a message to run after the stop";
    case "waiting-for-host":
      return "Queue a message for when the host reconnects";
    case "error":
      return "Retry by sending a follow-up message";
    case "pending":
    case "idle":
    case "active":
      return "Ask for a follow-up. @ to mention files, folders, sections, or threads";
    default:
      return assertNever(displayStatus);
  }
}

export function getCompactFollowUpPromptPlaceholder(
  displayStatus: ThreadRuntimeDisplayStatus,
  provisioningRemainingMs: number | null,
): string {
  switch (displayStatus) {
    case "provisioning":
      return withProvisioningRemaining(
        "Setting up...",
        provisioningRemainingMs,
      );
    case "starting":
      return withProvisioningRemaining("Starting...", provisioningRemainingMs);
    case "stopping":
      return "Queue for after the stop";
    case "waiting-for-host":
      return "Queue for when the host is back";
    case "error":
      return "Send a follow-up";
    case "pending":
    case "idle":
    case "active":
      return "Ask a follow-up";
    default:
      return assertNever(displayStatus);
  }
}
