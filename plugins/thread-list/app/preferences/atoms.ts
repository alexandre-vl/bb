import { atom } from "jotai";
import { createSyncedPreferenceAtom } from "./synced-preference-atom.js";

export const collapsedProjectIdsAtom =
  createSyncedPreferenceAtom("collapsedProjects");
export const collapsedThreadIdsAtom =
  createSyncedPreferenceAtom("collapsedThreads");
export const expandedThreadIdsAtom =
  createSyncedPreferenceAtom("expandedThreads");
export const collapsedEnvironmentIdsAtom = createSyncedPreferenceAtom(
  "collapsedEnvironments",
);
export const collapsedSidebarSectionIdsAtom =
  createSyncedPreferenceAtom("collapsedSections");
export const sidebarSectionOrderAtom =
  createSyncedPreferenceAtom("sectionOrder");
export const sidebarManualSectionOrderAtom =
  createSyncedPreferenceAtom("manualSectionOrder");
export const sidebarMachineSectionOrderAtom = createSyncedPreferenceAtom(
  "machineSectionOrder",
);
export const sidebarHiddenGroupsAtom =
  createSyncedPreferenceAtom("hiddenGroups");
export const threadRowActionsAtom = createSyncedPreferenceAtom("rowActions");
export const sidebarOrganizationModeAtom =
  createSyncedPreferenceAtom("organizationMode");
export const sidebarEnvironmentGroupingAtom = createSyncedPreferenceAtom(
  "environmentGrouping",
);
export const sidebarAttentionFirstAtom =
  createSyncedPreferenceAtom("attentionFirst");
export const sidebarFoldSettledAtom = createSyncedPreferenceAtom("foldSettled");
export const sidebarParentsStartCollapsedAtom = createSyncedPreferenceAtom(
  "parentsStartCollapsed",
);
export const sidebarGroupThreadsByEnvironmentAtom = atom((get) => {
  const grouping = get(sidebarEnvironmentGroupingAtom);
  if (grouping !== "auto") return grouping;
  return get(sidebarOrganizationModeAtom) !== "chronological";
});
export const sidebarChronologicalSortAtom =
  createSyncedPreferenceAtom("chronologicalSort");
export const sidebarSortDirectionAtom =
  createSyncedPreferenceAtom("sortDirection");
export const sidebarCollapsedThreadSectionsAtom = createSyncedPreferenceAtom(
  "collapsedThreadSections",
);
export const sidebarCollapsedMachinesAtom =
  createSyncedPreferenceAtom("collapsedMachines");

export const sidebarThreadLifecyclesAtom =
  createSyncedPreferenceAtom("threadLifecycles");
export const sidebarShowProviderIconsAtom =
  createSyncedPreferenceAtom("showProviderIcons");
export const sidebarShowRowMetadataAtom =
  createSyncedPreferenceAtom("showRowMetadata");
export const THREAD_ROW_METADATA_EXPERIMENT = "threadRowMetadata";
