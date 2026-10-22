import {
  Component,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { SidebarThread } from "../../model/sidebar-thread.js";
import {
  SidebarStabilityController,
  type SidebarOrderMeasurement,
} from "./sidebar-stability.js";

export type SidebarThreadVersionOf = (thread: SidebarThread) => SidebarThread;

const liveVersion: SidebarThreadVersionOf = (thread) => thread;

export interface SidebarOrderStability {
  controller: SidebarStabilityController<SidebarThread>;
  threads: readonly SidebarThread[];
  kept: ReadonlyMap<string, SidebarThread>;
  versionOf: SidebarThreadVersionOf;
}

export function useSidebarOrderStability(
  threads: readonly SidebarThread[],
): SidebarOrderStability {
  const [controller] = useState(
    () => new SidebarStabilityController<SidebarThread>(),
  );
  const { kept } = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const versionOf = useMemo<SidebarThreadVersionOf>(
    () =>
      kept.size === 0 ? liveVersion : (thread) => kept.get(thread.id) ?? thread,
    [kept],
  );
  return { controller, threads, kept, versionOf };
}

interface SidebarOrderStabilityBoundaryProps {
  stability: SidebarOrderStability;
  children: ReactNode;
}

export class SidebarOrderStabilityBoundary extends Component<SidebarOrderStabilityBoundaryProps> {
  override componentDidMount(): void {
    const { controller, threads, kept } = this.props.stability;
    controller.commit(null, threads, kept);
  }

  override getSnapshotBeforeUpdate(): SidebarOrderMeasurement | null {
    return this.props.stability.controller.measure();
  }

  override componentDidUpdate(
    _previous: SidebarOrderStabilityBoundaryProps,
    _state: unknown,
    measurement: SidebarOrderMeasurement | null,
  ): void {
    const { controller, threads, kept } = this.props.stability;
    controller.commit(measurement, threads, kept);
  }

  override render(): ReactNode {
    return this.props.children;
  }
}
