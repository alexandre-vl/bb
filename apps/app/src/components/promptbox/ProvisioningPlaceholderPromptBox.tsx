import { useMemo } from "react";
import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import { useProvisioningRemainingMs } from "@/hooks/useProvisioningRemainingMs";
import type { ActiveProvisioningEstimate } from "@/lib/thread-provisioning-estimate";
import {
  FollowUpPromptBox,
  type FollowUpPromptBoxProps,
} from "./FollowUpPromptBox";
import {
  getCompactFollowUpPromptPlaceholder,
  getFollowUpPromptPlaceholder,
} from "./follow-up-placeholder";

interface ProvisioningPlaceholderPromptBoxProps extends FollowUpPromptBoxProps {
  placeholderDisplayStatus: ThreadRuntimeDisplayStatus;
  provisioningEstimate: ActiveProvisioningEstimate | null;
}

export function ProvisioningPlaceholderPromptBox({
  composer,
  placeholderDisplayStatus,
  provisioningEstimate,
  ...promptBoxProps
}: ProvisioningPlaceholderPromptBoxProps) {
  const remainingMs = useProvisioningRemainingMs(
    placeholderDisplayStatus === "provisioning" ||
      placeholderDisplayStatus === "starting"
      ? provisioningEstimate
      : null,
  );
  const placeholderComposer = useMemo(
    () =>
      composer === null || remainingMs === null
        ? composer
        : {
            ...composer,
            promptPlaceholder: getFollowUpPromptPlaceholder(
              placeholderDisplayStatus,
              remainingMs,
            ),
            compactPromptPlaceholder: getCompactFollowUpPromptPlaceholder(
              placeholderDisplayStatus,
              remainingMs,
            ),
          },
    [composer, placeholderDisplayStatus, remainingMs],
  );
  return (
    <FollowUpPromptBox {...promptBoxProps} composer={placeholderComposer} />
  );
}
