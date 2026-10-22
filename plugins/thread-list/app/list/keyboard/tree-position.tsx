import { createContext, useContext } from "react";

export interface SidebarTreePosition {
  posinset: number;
  setsize: number;
}

const SidebarTreePositionContext = createContext<SidebarTreePosition | null>(
  null,
);

export const SidebarTreePositionProvider = SidebarTreePositionContext.Provider;

export function useSidebarTreePosition(): SidebarTreePosition | null {
  return useContext(SidebarTreePositionContext);
}

export function getTreePositionProps(position: SidebarTreePosition | null): {
  "aria-posinset"?: number;
  "aria-setsize"?: number;
} {
  return position === null
    ? {}
    : { "aria-posinset": position.posinset, "aria-setsize": position.setsize };
}
