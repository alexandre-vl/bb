import { reportPluginUpdatePhase } from "./plugin-update-progress.js";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import {
  getInstalledPlugin,
  getPluginArtifact,
  getPluginStateSnapshot,
  listIncompletePluginRollbackSnapshots,
  setInstalledPluginLastFailure,
  setPluginStateSnapshotRollbackPending,
  setPluginStateSnapshotStatus,
  upsertInstalledPlugin,
  type InstalledPluginRow,
  type PluginExactResolution,
  type PluginProvenance,
  type PluginSourceIntent,
  type PluginStateSnapshotRow,
} from "@bb/db";
import {
  applyPluginStateSnapshot,
  createPluginStateSnapshotOnDisk,
  readPluginSnapshotRegistration,
  restorePluginHostStateSnapshot,
  restorePluginStateSnapshot,
} from "./plugin-state-snapshot.js";
import {
  garbageCollectPluginArtifacts,
  pluginArtifactStorageRoot,
  removePluginStateSnapshots,
} from "./plugin-artifact-gc.js";
import type { PluginRuntimeStatus } from "@bb/server-contract";
import type { PluginServiceDeps } from "./plugin-service-internal.js";
import type { PluginManifest } from "./manifest.js";

export class PluginActivationRolledBackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginActivationRolledBackError";
  }
}

export interface PluginRollbackActivation {
  snapshotId: string;
  registration: InstalledPluginRow;
}

interface PluginActivationContext {
  deps: PluginServiceDeps;
  now: () => number;
  artifactRetentionMs: number;
  stabilizationWindowMs: number;
  scheduleStabilizationWindow: (
    durationMs: number,
    onElapsed: () => void,
  ) => () => void;
  stabilizingPluginIds: Set<string>;
  statuses: Map<string, { status: PluginRuntimeStatus; detail: string | null }>;
  statusListeners: Map<
    string,
    Set<(status: PluginRuntimeStatus, detail: string | null) => void>
  >;
  withArtifactLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  withLifecycleLock: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  disposeOne: (id: string) => Promise<void>;
  loadOne: (row: InstalledPluginRow) => Promise<string | null>;
  restoreRegistration: (row: InstalledPluginRow) => void;
  provenanceForRow: (row: InstalledPluginRow) => PluginProvenance;
  registrationMatchesForActivation: (
    current: InstalledPluginRow,
    expected: InstalledPluginRow,
  ) => boolean;
  emptyPluginUpdateState: () => {
    readonly lastCheckAt: null;
    readonly availableCompatibleVersion: null;
    readonly newestIncompatibleVersion: null;
    readonly statusDetail: null;
  };
  sourceFingerprint: (row: InstalledPluginRow) => string;
  rememberSnapshotRegistration: (
    snapshotId: string,
    registration: InstalledPluginRow,
  ) => void;
  pruneSnapshotRegistrations: () => void;
  syncCliSkill: () => Promise<void>;
  notifyPluginsChanged: () => void;
}

export function createPluginActivation(context: PluginActivationContext) {
  const {
    deps,
    now,
    artifactRetentionMs,
    stabilizationWindowMs,
    scheduleStabilizationWindow,
    stabilizingPluginIds,
    statuses,
    statusListeners,
    withArtifactLock,
    withLifecycleLock,
    disposeOne,
    loadOne,
    restoreRegistration,
    provenanceForRow,
    registrationMatchesForActivation,
    emptyPluginUpdateState,
    sourceFingerprint,
    rememberSnapshotRegistration,
    pruneSnapshotRegistrations,
    syncCliSkill,
    notifyPluginsChanged,
  } = context;
  const logger = deps.logger;

  function requireRollbackMetadata(snapshot: PluginStateSnapshotRow) {
    if (
      snapshot.rollbackCandidateVersion === null ||
      snapshot.rollbackSourceFingerprint === null ||
      snapshot.rollbackBbVersion === null ||
      snapshot.rollbackSdkVersion === null ||
      snapshot.rollbackDetail === null
    ) {
      throw new Error(
        `plugin rollback snapshot ${snapshot.id} is missing rollback metadata`,
      );
    }
    return {
      candidateVersion: snapshot.rollbackCandidateVersion,
      sourceFingerprint: snapshot.rollbackSourceFingerprint,
      bbVersion: snapshot.rollbackBbVersion,
      sdkVersion: snapshot.rollbackSdkVersion,
      detail: snapshot.rollbackDetail,
    };
  }

  async function recoverRollbackWithinLifecycle(
    snapshotId: string,
  ): Promise<void> {
    const snapshot = getPluginStateSnapshot(deps.db, snapshotId);
    if (snapshot === undefined) {
      throw new Error(`plugin rollback snapshot disappeared: ${snapshotId}`);
    }
    const rollback = requireRollbackMetadata(snapshot);
    const previousRegistration = await readPluginSnapshotRegistration({
      db: deps.db,
      snapshotId,
    });
    if (previousRegistration.id !== snapshot.pluginId) {
      throw new Error(
        `plugin rollback snapshot ${snapshot.id} registration id does not match`,
      );
    }
    await disposeOne(snapshot.pluginId);
    await restorePluginStateSnapshot({
      db: deps.db,
      dataDir: deps.dataDir,
      snapshotId,
      now: now(),
    });
    await deps.afterPluginRollbackStateRestored?.({
      pluginId: snapshot.pluginId,
      snapshotId,
    });
    restoreRegistration(previousRegistration);
    if (
      !setInstalledPluginLastFailure(deps.db, snapshot.pluginId, {
        version: rollback.candidateVersion,
        detail: rollback.detail,
        at: now(),
      })
    ) {
      throw new Error(
        `plugin "${snapshot.pluginId}" disappeared during rollback`,
      );
    }
    const previous = getInstalledPlugin(deps.db, snapshot.pluginId);
    if (previous) await loadOne(previous);
    const runtime = statuses.get(snapshot.pluginId);
    if (runtime?.status === "error") {
      throw new Error(
        `plugin "${snapshot.pluginId}" failed to reload during rollback: ${runtime.detail ?? "unknown error"}`,
      );
    }
    await restorePluginHostStateSnapshot({ db: deps.db, snapshotId });
    if (!setPluginStateSnapshotStatus(deps.db, snapshotId, "restored", now())) {
      throw new Error(`plugin rollback snapshot disappeared: ${snapshotId}`);
    }
    pruneSnapshotRegistrations();
  }

  async function recoverIncompletePluginRollbacks(): Promise<void> {
    for (const snapshot of listIncompletePluginRollbackSnapshots(deps.db)) {
      if (getInstalledPlugin(deps.db, snapshot.pluginId) === undefined) {
        logger.warn(
          `plugin ${snapshot.pluginId} was removed before bb finished restoring it, so bb deletes its snapshots instead of restoring it`,
        );
        await removePluginStateSnapshots({
          db: deps.db,
          pluginId: snapshot.pluginId,
          warn: (message) => logger.warn(message),
        });
        continue;
      }
      const artifact = getPluginArtifact(deps.db, snapshot.toArtifactId);
      const artifactLockKey =
        (artifact === undefined ? null : pluginArtifactStorageRoot(artifact)) ??
        snapshot.snapshotPath;
      await withArtifactLock(artifactLockKey, () =>
        withLifecycleLock(snapshot.pluginId, () =>
          recoverRollbackWithinLifecycle(snapshot.id),
        ),
      );
    }
  }

  async function activateManagedUpdate(args: {
    row: InstalledPluginRow;
    rootDir: string;
    manifest: PluginManifest;
    source: string;
    sourceIntent: PluginSourceIntent;
    exactResolution: PluginExactResolution;
    artifactId: string;
    beforePersist?: () => Promise<void>;
    rollback?: PluginRollbackActivation;
  }): Promise<void> {
    const provenance = provenanceForRow(args.row);
    const registration = args.rollback?.registration ?? args.row;
    const candidateVersion =
      args.exactResolution.kind === "npm"
        ? args.exactResolution.version
        : args.exactResolution.kind === "git"
          ? args.exactResolution.commit
          : args.manifest.version;
    const markRollbackPending = (snapshotId: string, detail: string) => {
      if (
        !setPluginStateSnapshotRollbackPending(deps.db, snapshotId, {
          candidateVersion,
          sourceFingerprint: sourceFingerprint(args.row),
          bbVersion: deps.appVersion,
          sdkVersion: PLUGIN_SDK_VERSION,
          detail,
          updatedAt: now(),
        })
      ) {
        throw new Error(
          `plugin rollback snapshot ${snapshotId} could not be marked pending`,
        );
      }
    };
    await withLifecycleLock(args.row.id, async () => {
      const beforeDispose = getInstalledPlugin(deps.db, args.row.id);
      if (
        beforeDispose === undefined ||
        !registrationMatchesForActivation(beforeDispose, args.row)
      ) {
        throw new Error(
          `plugin "${args.row.id}" registration changed during update`,
        );
      }
      await disposeOne(args.row.id);
      const snapshotNow = now();
      let snapshot: Awaited<ReturnType<typeof createPluginStateSnapshotOnDisk>>;
      try {
        snapshot = await createPluginStateSnapshotOnDisk({
          db: deps.db,
          dataDir: deps.dataDir,
          pluginId: args.row.id,
          fromArtifactId: args.row.activeArtifactId,
          toArtifactId: args.artifactId,
          now: snapshotNow,
          retainedUntil: snapshotNow + artifactRetentionMs,
          previousRegistration: args.row,
        });
      } catch (error) {
        const previous = getInstalledPlugin(deps.db, args.row.id);
        if (previous) await loadOne(previous);
        throw error;
      }
      rememberSnapshotRegistration(snapshot.id, args.row);
      let pointerWritten = false;
      try {
        if (args.rollback !== undefined) {
          markRollbackPending(
            snapshot.id,
            `rolling back to ${args.manifest.version} was interrupted before it finished`,
          );
        }
        reportPluginUpdatePhase("activating");
        await args.beforePersist?.();
        const beforeWrite = getInstalledPlugin(deps.db, args.row.id);
        if (
          beforeWrite === undefined ||
          !registrationMatchesForActivation(beforeWrite, args.row)
        ) {
          throw new Error(
            `plugin "${args.row.id}" registration changed during activation`,
          );
        }
        upsertInstalledPlugin(deps.db, {
          id: args.row.id,
          source: args.source,
          provenance,
          sourceIntent: args.sourceIntent,
          exactResolution: args.exactResolution,
          updateState:
            args.rollback === undefined
              ? emptyPluginUpdateState()
              : {
                  lastCheckAt: registration.lastUpdateCheckAt,
                  availableCompatibleVersion:
                    registration.availableCompatibleVersion,
                  newestIncompatibleVersion:
                    registration.newestIncompatibleVersion,
                  statusDetail: registration.updateStatusDetail,
                },
          activeArtifactId: args.artifactId,
          rootDir: args.rootDir,
          version: args.manifest.version,
          enabled: registration.enabled,
          enabledFollowsDefault: registration.enabledFollowsDefault,
        });
        pointerWritten = true;
        if (args.rollback !== undefined) {
          await applyPluginStateSnapshot({
            db: deps.db,
            dataDir: deps.dataDir,
            snapshotId: args.rollback.snapshotId,
          });
        }
        const current = getInstalledPlugin(deps.db, args.row.id);
        stabilizingPluginIds.add(args.row.id);
        if (current) await loadOne(current);
        const immediate = statuses.get(args.row.id);
        if (immediate?.status === "error") {
          throw new Error(immediate.detail ?? "plugin failed to load");
        }
        if (stabilizationWindowMs > 0) {
          reportPluginUpdatePhase("checking");
          const failure = await new Promise<string | null>((resolveFailure) => {
            let cancelWindow = () => {};
            const listener = (
              status: PluginRuntimeStatus,
              detail: string | null,
            ) => {
              if (status !== "error") return;
              cancelWindow();
              const currentListeners = statusListeners.get(args.row.id);
              currentListeners?.delete(listener);
              if (currentListeners?.size === 0) {
                statusListeners.delete(args.row.id);
              }
              resolveFailure(detail ?? "plugin entered error status");
            };
            let listeners = statusListeners.get(args.row.id);
            if (listeners === undefined) {
              listeners = new Set();
              statusListeners.set(args.row.id, listeners);
            }
            listeners.add(listener);
            cancelWindow = scheduleStabilizationWindow(
              stabilizationWindowMs,
              () => {
                listeners.delete(listener);
                if (listeners.size === 0) statusListeners.delete(args.row.id);
                resolveFailure(null);
              },
            );
            const currentStatus = statuses.get(args.row.id);
            if (currentStatus?.status === "error") {
              listener(currentStatus.status, currentStatus.detail);
            }
          });
          if (failure !== null) throw new Error(failure);
        }
        if (args.rollback !== undefined) {
          setPluginStateSnapshotStatus(
            deps.db,
            snapshot.id,
            "discarded",
            now(),
          );
          setPluginStateSnapshotStatus(
            deps.db,
            args.rollback.snapshotId,
            "restored",
            now(),
          );
        }
      } catch (error) {
        if (!pointerWritten) {
          if (args.rollback !== undefined) {
            setPluginStateSnapshotStatus(
              deps.db,
              snapshot.id,
              "discarded",
              now(),
            );
          }
          const previous = getInstalledPlugin(deps.db, args.row.id);
          if (previous) await loadOne(previous);
          throw error;
        }
        const detail = error instanceof Error ? error.message : String(error);
        markRollbackPending(snapshot.id, detail);
        reportPluginUpdatePhase("rolling-back");
        await recoverRollbackWithinLifecycle(snapshot.id);
        throw new PluginActivationRolledBackError(
          args.rollback === undefined
            ? `activation of ${args.manifest.version} failed and was rolled back: ${detail}; run apply update again to retry explicitly`
            : `rolling back to ${args.manifest.version} failed, so bb restored ${args.row.version} and the data it had before the rollback: ${detail}`,
        );
      } finally {
        stabilizingPluginIds.delete(args.row.id);
        pruneSnapshotRegistrations();
      }
    });
    await syncCliSkill();
    notifyPluginsChanged();
  }

  async function runArtifactGc(): Promise<void> {
    await garbageCollectPluginArtifacts({
      db: deps.db,
      dataDir: deps.dataDir,
      now: now(),
      retentionMs: artifactRetentionMs,
      warn: (message) => logger.warn(message),
    });
    pruneSnapshotRegistrations();
  }

  return {
    activateManagedUpdate,
    recoverIncompletePluginRollbacks,
    runArtifactGc,
  };
}
