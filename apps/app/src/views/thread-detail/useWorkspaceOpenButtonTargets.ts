import { useState } from "react";
import type { WorkspaceOpenTarget } from "@bb/host-daemon-contract";

export interface WorkspaceOpenButtonTargets {
  preferredTarget: WorkspaceOpenTarget;
  targets: WorkspaceOpenTarget[];
}

export function useWorkspaceOpenButtonTargets(
  current: WorkspaceOpenButtonTargets | null,
  isEnvironmentPending: boolean,
): WorkspaceOpenButtonTargets | null {
  const [lastShown, setLastShown] = useState(current);
  if (
    current !== null &&
    (current.preferredTarget !== lastShown?.preferredTarget ||
      current.targets !== lastShown.targets)
  ) {
    setLastShown(current);
  }
  return current ?? (isEnvironmentPending ? lastShown : null);
}
