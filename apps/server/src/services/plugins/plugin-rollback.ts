import {
  findPluginRollbackSnapshot,
  getInstalledPlugin,
  listRetainedPluginRollbackSnapshots,
  type InstalledPluginRow,
  type PluginArtifactRow,
  type PluginExactResolution,
  type PluginSourceIntent,
  type PluginStateSnapshotRow,
} from "@bb/db";
import type {
  PluginRollbackPoint,
  PluginRollbackRequest,
} from "@bb/server-contract";
import { hashInstallDir, realPathInside } from "./install-sources.js";
import { readPluginManifest, type PluginManifest } from "./manifest.js";
import {
  PluginActivationRolledBackError,
  type PluginRollbackActivation,
} from "./plugin-activation.js";
import {
  pluginArtifactStorageRoot,
  removeUnusedPluginArtifacts,
} from "./plugin-artifact-gc.js";
import type { SafeModeActivationRefusalArgs } from "./plugin-runtime.js";
import type {
  PluginApplyUpdateOutcome,
  PluginServiceDeps,
} from "./plugin-service-internal.js";
import { readPluginSnapshotRegistration } from "./plugin-state-snapshot.js";
import {
  evaluateCompatibility,
  type PluginResolvedUpdateVersion,
} from "./update-resolver.js";

interface ResolvedRollbackPoint {
  snapshot: PluginStateSnapshotRow;
  artifact: PluginArtifactRow;
  registration: InstalledPluginRow;
  target: PluginResolvedUpdateVersion;
}

type RollbackPointLookup =
  | { outcome: "found"; point: ResolvedRollbackPoint }
  | { outcome: "none"; detail: string };

function rollbackRegistration(
  current: InstalledPluginRow,
  previous: InstalledPluginRow,
): InstalledPluginRow | null {
  if (
    previous.id !== current.id ||
    previous.sourceKind !== current.sourceKind ||
    previous.sourceGitUrl !== current.sourceGitUrl ||
    previous.sourceGitSubdirectory !== current.sourceGitSubdirectory ||
    previous.sourceGitRequestedRef !== current.sourceGitRequestedRef ||
    (previous.sourceGitRange === null) !== (current.sourceGitRange === null) ||
    previous.sourceNpmPackage !== current.sourceNpmPackage ||
    previous.sourceNpmRegistry !== current.sourceNpmRegistry
  ) {
    return null;
  }
  return {
    ...previous,
    source: current.source,
    sourceGitRange: current.sourceGitRange,
    sourceNpmRequestedSpec: current.sourceNpmRequestedSpec,
    sourceNpmSpecKind: current.sourceNpmSpecKind,
    enabled: current.enabled,
    enabledFollowsDefault: current.enabledFollowsDefault,
  };
}

export function createPluginRollbackPoints(context: {
  deps: PluginServiceDeps;
  now: () => number;
  installedUpdateVersion: (
    row: InstalledPluginRow,
  ) => PluginResolvedUpdateVersion;
}) {
  const { deps, now, installedUpdateVersion } = context;
  const registrations = new Map<string, InstalledPluginRow>();

  function remember(snapshotId: string, registration: InstalledPluginRow) {
    registrations.set(snapshotId, registration);
  }

  async function load(): Promise<void> {
    for (const snapshot of listRetainedPluginRollbackSnapshots(
      deps.db,
      now(),
    )) {
      if (registrations.has(snapshot.id)) continue;
      try {
        remember(
          snapshot.id,
          await readPluginSnapshotRegistration({
            db: deps.db,
            snapshotId: snapshot.id,
          }),
        );
      } catch (error) {
        deps.logger.warn(
          `plugin rollback snapshot ${snapshot.id} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  function candidate(row: InstalledPluginRow) {
    if (
      (row.sourceKind !== "git" && row.sourceKind !== "npm") ||
      row.activeArtifactId === null
    ) {
      return undefined;
    }
    return findPluginRollbackSnapshot(deps.db, {
      pluginId: row.id,
      activeArtifactId: row.activeArtifactId,
      now: now(),
    });
  }

  function noRollbackPoint(row: InstalledPluginRow, reason: string) {
    return {
      outcome: "none" as const,
      detail: `plugin "${row.id}" has no rollback point: ${reason}`,
    };
  }

  function lookupFor(
    row: InstalledPluginRow,
    found: {
      snapshot: PluginStateSnapshotRow;
      artifact: PluginArtifactRow | null;
    },
    previous: InstalledPluginRow,
  ): RollbackPointLookup {
    const registration = rollbackRegistration(row, previous);
    if (registration === null) {
      return noRollbackPoint(
        row,
        `its source changed since the update (${previous.source} → ${row.source})`,
      );
    }
    let target: PluginResolvedUpdateVersion;
    try {
      target = installedUpdateVersion(registration);
    } catch (error) {
      return noRollbackPoint(
        row,
        `its rollback snapshot is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      found.artifact === null ||
      found.artifact.pluginId !== row.id ||
      found.artifact.validationResult !== "valid" ||
      registration.activeArtifactId !== found.artifact.id
    ) {
      return noRollbackPoint(
        row,
        `bb no longer keeps the release the update replaced (${target.display})`,
      );
    }
    return {
      outcome: "found",
      point: {
        snapshot: found.snapshot,
        artifact: found.artifact,
        registration,
        target,
      },
    };
  }

  function find(row: InstalledPluginRow): PluginRollbackPoint | undefined {
    const found = candidate(row);
    if (found === undefined) return undefined;
    const previous = registrations.get(found.snapshot.id);
    if (previous === undefined) return undefined;
    const lookup = lookupFor(row, found, previous);
    if (lookup.outcome === "none") return undefined;
    return {
      version: lookup.point.target.version,
      display: lookup.point.target.display,
      until: lookup.point.snapshot.retainedUntil,
    };
  }

  async function resolve(
    row: InstalledPluginRow,
  ): Promise<RollbackPointLookup> {
    const found = candidate(row);
    if (found === undefined) {
      return noRollbackPoint(
        row,
        "no update to its current version is still within the rollback window",
      );
    }
    let previous = registrations.get(found.snapshot.id);
    if (previous === undefined) {
      try {
        previous = await readPluginSnapshotRegistration({
          db: deps.db,
          snapshotId: found.snapshot.id,
        });
      } catch (error) {
        return noRollbackPoint(
          row,
          `its rollback snapshot is unreadable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      remember(found.snapshot.id, previous);
    }
    return lookupFor(row, found, previous);
  }

  function prune(): void {
    const retained = new Set(
      listRetainedPluginRollbackSnapshots(deps.db, now()).map(({ id }) => id),
    );
    for (const snapshotId of registrations.keys()) {
      if (!retained.has(snapshotId)) registrations.delete(snapshotId);
    }
  }

  return { find, load, prune, remember, resolve };
}

export type PluginRollbackPoints = ReturnType<
  typeof createPluginRollbackPoints
>;

interface PluginRollbackContext {
  deps: PluginServiceDeps;
  now: () => number;
  registrationMutationKey: string;
  withPluginOperationLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  withArtifactLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  safeModeActivationRefusal: (
    args: SafeModeActivationRefusalArgs,
  ) => string | null;
  installedUpdateVersion: (
    row: InstalledPluginRow,
  ) => PluginResolvedUpdateVersion;
  sourceIntentForRow: (row: InstalledPluginRow) => PluginSourceIntent;
  exactResolutionForRow: (row: InstalledPluginRow) => PluginExactResolution;
  rollbackPoints: PluginRollbackPoints;
  activateManagedUpdate: (args: {
    row: InstalledPluginRow;
    rootDir: string;
    manifest: PluginManifest;
    source: string;
    sourceIntent: PluginSourceIntent;
    exactResolution: PluginExactResolution;
    artifactId: string;
    rollback?: PluginRollbackActivation;
  }) => Promise<void>;
  runArtifactGc: () => Promise<void>;
}

function rollbackSourceRefusal(row: InstalledPluginRow): string | null {
  if (row.sourceKind === "path") {
    return `plugin "${row.id}" is a local path source; bb runs it from ${row.sourcePath ?? row.rootDir} and keeps no earlier release to roll back to`;
  }
  if (row.sourceKind === "builtin") {
    return `plugin "${row.id}" is included with bb and changes only when bb does; there is no earlier plugin release to roll back to`;
  }
  return null;
}

function artifactLockKey(artifact: PluginArtifactRow): string {
  return artifact.sourceKind === "git"
    ? (artifact.gitCheckoutRoot ?? artifact.path)
    : (pluginArtifactStorageRoot(artifact) ?? artifact.path);
}

export function createPluginRollback(context: PluginRollbackContext) {
  const {
    deps,
    now,
    registrationMutationKey: REGISTRATION_MUTATION_KEY,
    withPluginOperationLock,
    withArtifactLock,
    safeModeActivationRefusal,
    installedUpdateVersion,
    sourceIntentForRow,
    exactResolutionForRow,
    rollbackPoints,
    activateManagedUpdate,
    runArtifactGc,
  } = context;

  async function readRollbackManifest(
    point: ResolvedRollbackPoint,
  ): Promise<{ manifest: PluginManifest } | { refusal: string }> {
    const { artifact, target } = point;
    const contentRoot =
      artifact.sourceKind === "git"
        ? artifact.path
        : pluginArtifactStorageRoot(artifact);
    const contentHash =
      contentRoot === null
        ? null
        : await hashInstallDir(contentRoot).catch(() => null);
    if (artifact.contentHash === null || contentHash !== artifact.contentHash) {
      return {
        refusal: `rollback refused: the copy of ${target.display} that bb kept changed or is incomplete on disk; update the plugin instead`,
      };
    }
    let manifest: PluginManifest;
    try {
      manifest = await readPluginManifest(
        artifact.sourceKind === "git" && artifact.gitCheckoutRoot !== null
          ? await realPathInside(
              artifact.gitCheckoutRoot,
              artifact.path,
              "git plugin subdirectory",
              point.registration.sourceGitSubdirectory === null,
            )
          : artifact.path,
      );
    } catch (error) {
      return {
        refusal: `rollback refused: the kept copy of ${target.display} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (manifest.id !== point.registration.id) {
      return {
        refusal: `rollback refused: the kept copy of ${target.display} declares plugin id "${manifest.id}"`,
      };
    }
    const compatibility = evaluateCompatibility({
      bbRange: manifest.bbEngineRange,
      sdkRange: manifest.bbPluginSdkRange,
      appVersion: deps.appVersion,
    });
    if (compatibility.effective.length > 0) {
      return {
        refusal: `rollback refused: ${target.display} is incompatible with this bb: ${compatibility.effective.map((problem) => problem.message).join("; ")}`,
      };
    }
    return { manifest };
  }

  async function rollbackUpdate(
    id: string,
    request: PluginRollbackRequest = {},
  ): Promise<PluginApplyUpdateOutcome> {
    return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
      const row = getInstalledPlugin(deps.db, id);
      if (row === undefined) {
        return { ok: false, error: `unknown plugin "${id}"` };
      }
      const sourceRefusal = rollbackSourceRefusal(row);
      if (sourceRefusal !== null) return { ok: false, error: sourceRefusal };
      const safeModeRefusal = safeModeActivationRefusal({
        pluginId: id,
        provenance: row.provenance,
        builtinName: null,
        action: "roll back",
      });
      if (safeModeRefusal !== null) {
        return { ok: false, error: safeModeRefusal };
      }
      const lookup = await rollbackPoints.resolve(row);
      if (lookup.outcome === "none") return { ok: false, error: lookup.detail };
      const { point } = lookup;
      const from = installedUpdateVersion(row);
      if (
        request.expectedVersion !== undefined &&
        request.expectedVersion !== point.target.version
      ) {
        return {
          ok: false,
          error: `rollback refused: expected ${request.expectedVersion}, but the rollback point is now ${point.target.display}; review the plugin again`,
        };
      }
      let refusal: string | null;
      try {
        refusal = await withArtifactLock(
          artifactLockKey(point.artifact),
          async () => {
            const prepared = await readRollbackManifest(point);
            if ("refusal" in prepared) return prepared.refusal;
            await activateManagedUpdate({
              row,
              rootDir: point.artifact.path,
              manifest: prepared.manifest,
              source: point.registration.source,
              sourceIntent: sourceIntentForRow(point.registration),
              exactResolution: exactResolutionForRow(point.registration),
              artifactId: point.artifact.id,
              rollback: {
                snapshotId: point.snapshot.id,
                registration: point.registration,
              },
            });
            return null;
          },
        );
      } catch (error) {
        if (error instanceof PluginActivationRolledBackError) {
          return {
            ok: true,
            result: {
              applied: false,
              from,
              to: point.target,
              outcome: "rolled-back",
              detail: error.message,
            },
          };
        }
        throw error;
      }
      if (refusal !== null) return { ok: false, error: refusal };
      await removeUnusedPluginArtifacts({
        db: deps.db,
        dataDir: deps.dataDir,
        pluginId: id,
        now: now(),
        warn: (message) => deps.logger.warn(message),
      });
      await runArtifactGc();
      return {
        ok: true,
        result: { applied: true, from, to: point.target, outcome: "reverted" },
      };
    });
  }

  return { rollbackUpdate };
}
