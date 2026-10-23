import { createContext, useContext } from "react";

export type StartCustomizingRowActions = (
  returnFocus: HTMLElement | null,
) => void;

export const CustomizeRowActionsContext =
  createContext<StartCustomizingRowActions | null>(null);

export function useCustomizeThreadRowActions(): StartCustomizingRowActions | null {
  return useContext(CustomizeRowActionsContext);
}

export interface ThreadRowActionsCustomizing {
  threadId: string;
  onDone: (restoreFocus: boolean) => void;
}

export const ThreadRowActionsCustomizingContext =
  createContext<ThreadRowActionsCustomizing | null>(null);

export function useThreadRowActionsCustomizing(
  threadId: string,
): ((restoreFocus: boolean) => void) | null {
  const customizing = useContext(ThreadRowActionsCustomizingContext);
  return customizing?.threadId === threadId ? customizing.onDone : null;
}
