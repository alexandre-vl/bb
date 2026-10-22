export const SIDEBAR_TREE_GEOMETRY_CLASS =
  "[--bb-sidebar-chevron-zone:24px] [--bb-sidebar-text-inset:8px] [--bb-sidebar-tree-step:calc(var(--bb-sidebar-chevron-zone)+4px)] data-[sidebar-provider-icons=true]:[--bb-sidebar-chevron-zone:30px] max-md:pointer-coarse:[--bb-sidebar-chevron-zone:32px]";

export function getTreeLeafPaddingLeft(depth: number): string {
  return `calc(var(--bb-sidebar-tree-step) * ${depth} + var(--bb-sidebar-text-inset))`;
}

export function getTreeContainerPaddingLeft(depth: number): string {
  return `calc(var(--bb-sidebar-tree-step) * ${depth})`;
}

export function getTreeGuideLeft(parentDepth: number): string {
  return `calc(var(--bb-sidebar-tree-step) * ${parentDepth} + var(--bb-sidebar-chevron-zone) / 2 - 0.5px)`;
}

export const SIDEBAR_TREE_CHEVRON_ZONE_CLASS =
  "w-(--bb-sidebar-chevron-zone) shrink-0";
