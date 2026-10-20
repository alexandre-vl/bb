import semver from "semver";
import {
  getInstalledPlugin,
  setInstalledPluginTrackingRange,
  type InstalledPluginRow,
  type InstalledPluginTrackingRangeChange,
} from "@bb/db";
import type {
  PluginTrackingRangeRequest,
  PluginTrackingRangeResult,
  PluginUpdateCheckEntry,
} from "@bb/server-contract";
import { gitSelectorForRow } from "./git-source-intent.js";
import {
  BARE_VERSION_SPEC_PATTERN,
  gitRangeSourceSpec,
  gitSemverTagVersion,
  parsePluginSource,
} from "./install-sources.js";
import { npmSourceString } from "./managed-plugin-artifacts.js";
import type { PluginServiceDeps } from "./plugin-service-internal.js";
import type { PluginResolvedUpdateVersion } from "./update-resolver.js";

export type PluginTrackingRangeOutcome =
  | { ok: true; result: PluginTrackingRangeResult }
  | { ok: false; reason: "unknown-plugin" | "refused"; error: string };

export interface PluginTrackingRangePlan {
  previousRange: string | null;
  range: string;
  unchanged: boolean;
  change: InstalledPluginTrackingRangeChange;
  proposed: InstalledPluginRow;
}

type PlanResult =
  | { ok: true; plan: PluginTrackingRangePlan }
  | { ok: false; error: string };

const REMOVE_DELETES_DATA =
  "removing deletes its settings, secrets, and schedules";

function refused(error: string): PlanResult {
  return { ok: false, error };
}

function namesSingleVersion(range: string): boolean {
  const normalized = semver.validRange(range);
  return (
    semver.valid(range) !== null ||
    BARE_VERSION_SPEC_PATTERN.test(range) ||
    (normalized !== null && semver.valid(normalized) !== null)
  );
}

function rangeProblem(range: string, installed: string): string | null {
  if (semver.validRange(range) === null) {
    return `"${range}" is not a valid semver range; use a range like ^1.2.3 or >=1.2.0 <2.0.0`;
  }
  if (namesSingleVersion(range)) {
    const example = semver.coerce(range)?.version ?? "1.2.3";
    return `"${range}" names a single version, not a range; use a range like ^${example}`;
  }
  const options = { includePrerelease: true };
  if (semver.minVersion(range) === null) {
    return `${range} admits no version; use a range like ^${installed}`;
  }
  if (
    semver.satisfies(installed, range, options) ||
    semver.intersects(range, `>${installed}`, options)
  ) {
    return null;
  }
  return `${range} would only offer releases older than the installed ${installed}; bb does not downgrade. Use a range that includes ${installed} or only newer releases`;
}

function sourceRefusal(row: InstalledPluginRow): string | null {
  if (row.sourceKind === "path") {
    return `plugin "${row.id}" is a local path source and has no release range; edit it in place and run \`bb plugin reload ${row.id}\``;
  }
  if (row.sourceKind === "builtin") {
    return `plugin "${row.id}" is bundled with bb and updates with bb; it has no release range to change`;
  }
  if (row.sourceKind === "git") {
    const selector = gitSelectorForRow(row);
    if (selector?.kind === "range") return null;
    const ref = row.sourceGitRequestedRef ?? "HEAD";
    const follows =
      selector === null
        ? `follows the git ref "${ref}"`
        : selector.refKind === "branch"
          ? `follows the git branch "${ref}"`
          : `is pinned to the git ${selector.refKind} "${ref}"`;
    return `plugin "${row.id}" ${follows}, not a release range; to track releases, remove it and install \`git:${row.sourceGitUrl ?? "<url>"}@semver:<range>\` (${REMOVE_DELETES_DATA})`;
  }
  if (row.activeArtifactId === null) {
    return `plugin "${row.id}" was installed by an earlier bb into a directory named after its npm version spec, so bb cannot change its range in place; its next \`bb plugin update ${row.id}\` moves it to managed storage, after which the range can change. To change it now, remove it and install \`npm:${row.sourceNpmPackage ?? row.id}@<range>\` (${REMOVE_DELETES_DATA})`;
  }
  return null;
}

function installedRelease(row: InstalledPluginRow): string {
  const version =
    row.sourceKind === "git"
      ? row.sourceGitResolvedTag === null || row.sourceGitTagPrefix === null
        ? null
        : gitSemverTagVersion(row.sourceGitResolvedTag, row.sourceGitTagPrefix)
      : row.npmResolvedVersion;
  if (version === null || semver.valid(version) === null) {
    throw new Error(
      `plugin "${row.id}" has no semver release recorded for its installed version`,
    );
  }
  return version;
}

function previousRangeOf(row: InstalledPluginRow): string | null {
  if (row.sourceKind === "npm" && row.sourceNpmSpecKind === "default") {
    return null;
  }
  const previous =
    row.sourceKind === "git" ? row.sourceGitRange : row.sourceNpmRequestedSpec;
  if (previous === null) {
    throw new Error(`plugin "${row.id}" has corrupt normalized source state`);
  }
  return previous;
}

function sourceForRange(row: InstalledPluginRow, range: string): string {
  if (row.sourceKind === "git") {
    if (row.sourceGitUrl === null || row.sourceGitTagPrefix === null) {
      throw new Error(`plugin "${row.id}" has corrupt normalized git state`);
    }
    const source = gitRangeSourceSpec({
      url: row.sourceGitUrl,
      range,
      tagPrefix: row.sourceGitTagPrefix,
    });
    const parsed = parsePluginSource(source);
    if (
      parsed.kind !== "git" ||
      parsed.url !== row.sourceGitUrl ||
      parsed.selector.kind !== "range" ||
      parsed.selector.range !== range ||
      parsed.selector.tagPrefix !== row.sourceGitTagPrefix
    ) {
      throw new Error(`plugin "${row.id}" cannot record the range ${range}`);
    }
    return source;
  }
  if (row.sourceNpmPackage === null || row.sourceNpmRegistry === null) {
    throw new Error(`plugin "${row.id}" has corrupt normalized npm state`);
  }
  return npmSourceString({
    packageName: row.sourceNpmPackage,
    registry: row.sourceNpmRegistry,
    requestedSpec: range,
    specKind: "range",
  });
}

export function planTrackingRangeChange(
  row: InstalledPluginRow,
  requestedRange: string,
): PlanResult {
  const unsupported = sourceRefusal(row);
  if (unsupported !== null) return refused(unsupported);
  if (row.sourceKind !== "git" && row.sourceKind !== "npm") {
    return refused(`plugin "${row.id}" has no release range to change`);
  }
  const range = requestedRange.split(/\s+/).filter(Boolean).join(" ");
  if (range.length === 0) {
    return refused("the range is empty; use a range like ^1.2.3");
  }
  const previousRange = previousRangeOf(row);
  const unchanged =
    range === previousRange &&
    (row.sourceKind === "git" || row.sourceNpmSpecKind === "range");
  if (!unchanged) {
    const problem = rangeProblem(range, installedRelease(row));
    if (problem !== null) return refused(problem);
  }
  const source = sourceForRange(row, range);
  const cleared = {
    lastUpdateCheckAt: null,
    availableCompatibleVersion: null,
    newestIncompatibleVersion: null,
    updateStatusDetail: null,
    lastFailureVersion: null,
    lastFailureAt: null,
    lastFailureDetail: null,
  };
  const proposed: InstalledPluginRow =
    row.sourceKind === "git"
      ? { ...row, ...cleared, source, sourceGitRange: range }
      : {
          ...row,
          ...cleared,
          source,
          sourceNpmRequestedSpec: range,
          sourceNpmSpecKind: "range",
        };
  return {
    ok: true,
    plan: {
      previousRange,
      range,
      unchanged,
      change: {
        sourceKind: row.sourceKind,
        expectedSource: row.source,
        source,
        range,
      },
      proposed,
    },
  };
}

interface PluginTrackingRangeContext {
  deps: Pick<PluginServiceDeps, "db" | "logger">;
  registrationMutationKey: string;
  withLifecycleLock: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  withPluginOperationLock: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  installedUpdateVersion: (
    row: InstalledPluginRow,
  ) => PluginResolvedUpdateVersion;
  previewUpdateCheck: (
    row: InstalledPluginRow,
  ) => Promise<PluginUpdateCheckEntry>;
  checkUpdates: (row: InstalledPluginRow) => Promise<PluginUpdateCheckEntry[]>;
  persistUpdateEntry: (entry: PluginUpdateCheckEntry) => void;
  notifyPluginsChanged: () => void;
}

export function createPluginTrackingRange(context: PluginTrackingRangeContext) {
  const { deps } = context;

  function unavailableEntry(
    row: InstalledPluginRow,
    error: unknown,
  ): PluginUpdateCheckEntry {
    return {
      id: row.id,
      outcome: "unavailable",
      installed: context.installedUpdateVersion(row),
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  async function previewCheck(
    row: InstalledPluginRow,
  ): Promise<PluginUpdateCheckEntry> {
    try {
      return await context.previewUpdateCheck(row);
    } catch (error) {
      return unavailableEntry(row, error);
    }
  }

  async function checkChangedRow(
    row: InstalledPluginRow,
  ): Promise<PluginUpdateCheckEntry> {
    try {
      const [entry] = await context.checkUpdates(row);
      if (entry === undefined) {
        throw new Error(`plugin "${row.id}" was not checked`);
      }
      return entry;
    } catch (error) {
      const entry = unavailableEntry(row, error);
      context.persistUpdateEntry(entry);
      context.notifyPluginsChanged();
      return entry;
    }
  }

  async function setTrackingRange(
    id: string,
    request: PluginTrackingRangeRequest,
  ): Promise<PluginTrackingRangeOutcome> {
    return context.withPluginOperationLock(
      context.registrationMutationKey,
      async () => {
        const row = getInstalledPlugin(deps.db, id);
        if (row === undefined) {
          return {
            ok: false,
            reason: "unknown-plugin",
            error: `unknown plugin "${id}"`,
          };
        }
        const planned = planTrackingRangeChange(row, request.range);
        if (!planned.ok) {
          return { ok: false, reason: "refused", error: planned.error };
        }
        const { plan } = planned;
        const ranges = { previousRange: plan.previousRange, range: plan.range };
        if (request.dryRun === true || plan.unchanged) {
          return {
            ok: true,
            result: {
              applied: false,
              ...ranges,
              check: await previewCheck(plan.proposed),
            },
          };
        }
        const changed = await context.withLifecycleLock(id, async () =>
          setInstalledPluginTrackingRange(deps.db, id, plan.change),
        );
        if (!changed) {
          throw new Error(
            `plugin "${id}" changed while its range was changing`,
          );
        }
        deps.logger.info(
          `plugin ${id} now tracks ${plan.range} instead of ${plan.previousRange ?? "its latest release"}; settings, secrets, and schedules were kept`,
        );
        const updated = getInstalledPlugin(deps.db, id);
        if (updated === undefined) {
          throw new Error(`plugin "${id}" disappeared after its range changed`);
        }
        return {
          ok: true,
          result: {
            applied: true,
            ...ranges,
            check: await checkChangedRow(updated),
          },
        };
      },
    );
  }

  return { setTrackingRange };
}
