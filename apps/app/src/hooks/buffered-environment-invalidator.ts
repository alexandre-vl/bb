import {
  createDebouncedCallbackScheduler,
  type EnvironmentChangeKind,
} from "@bb/domain";

interface ChangedEnvironment {
  changeKinds: EnvironmentChangeKind[];
  environmentId: string;
  receivedAtFetchOrder: number;
}

interface BufferedEnvironmentInvalidatorOptions {
  debounceMs: number;
  flushChangedEnvironmentIds: (
    changedEnvironments: ChangedEnvironment[],
  ) => void;
  maxWaitMs: number;
  readQueryFetchOrder: () => number;
}

interface BufferedEnvironmentInvalidator {
  dispose: () => void;
  markChanged: (
    environmentId: string,
    changeKinds: readonly EnvironmentChangeKind[],
  ) => void;
}

interface PendingEnvironmentChange {
  changeKinds: Set<EnvironmentChangeKind>;
  receivedAtFetchOrder: number;
}

export function createBufferedEnvironmentInvalidator(
  options: BufferedEnvironmentInvalidatorOptions,
): BufferedEnvironmentInvalidator {
  const pendingChangesById = new Map<string, PendingEnvironmentChange>();

  const flush = () => {
    if (pendingChangesById.size === 0) {
      return;
    }
    options.flushChangedEnvironmentIds(
      Array.from(
        pendingChangesById.entries(),
        ([environmentId, { changeKinds, receivedAtFetchOrder }]) => ({
          changeKinds: Array.from(changeKinds),
          environmentId,
          receivedAtFetchOrder,
        }),
      ),
    );
    pendingChangesById.clear();
  };

  const scheduler = createDebouncedCallbackScheduler({
    debounceMs: options.debounceMs,
    maxWaitMs: options.maxWaitMs,
    onFlush: flush,
  });

  return {
    dispose: () => {
      scheduler.dispose();
      pendingChangesById.clear();
    },
    markChanged: (
      environmentId: string,
      changeKinds: readonly EnvironmentChangeKind[],
    ) => {
      const receivedAtFetchOrder = options.readQueryFetchOrder();
      let entry = pendingChangesById.get(environmentId);
      if (!entry) {
        entry = { changeKinds: new Set(), receivedAtFetchOrder };
        pendingChangesById.set(environmentId, entry);
      }
      entry.receivedAtFetchOrder = receivedAtFetchOrder;
      for (const changeKind of changeKinds) {
        entry.changeKinds.add(changeKind);
      }
      scheduler.schedule();
    },
  };
}
