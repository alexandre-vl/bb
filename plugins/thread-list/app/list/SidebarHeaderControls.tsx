import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SidebarSectionId } from "../model/sidebar-section-id.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarControlButton,
  SidebarRowControls,
} from "../rows/SidebarRowControls.js";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "@/components/ui/sidebar-row-classes";
import { ThreadListVisibilityMenuItems } from "./ThreadListVisibility.js";
import { SidebarHeaderMenuContents } from "./SidebarViewItems.js";
import { useCustomizeThreadRowActions } from "./customizeRowActionsContext.js";

export interface HeaderCreationActions {
  onNewSection?: (anchorSectionId?: SidebarSectionId) => void;
  isCreatingSection?: boolean;
}

const HeaderCreationContext = createContext<HeaderCreationActions>({});
export const SidebarHeaderActionsProvider = HeaderCreationContext.Provider;

export function SidebarHeaderControls({
  label,
  sectionId,
  onNewThread,
  showNewThread = true,
  children,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  label: string;
  sectionId?: SidebarSectionId;
  onNewThread?: () => void;
  showNewThread?: boolean;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const creation = useContext(HeaderCreationContext);
  const compact = useIsCompactViewport();
  const [page, setPage] = useState<"organize" | "sort" | "filter" | null>(null);
  const startCustomizingRowActions = useCustomizeThreadRowActions();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const afterClose = useRef<(() => void) | null>(null);
  const changeOpen = (next: boolean) => {
    if (!next) setPage(null);
    onOpenChange?.(next);
  };
  const customizeRowActions =
    startCustomizingRowActions === null
      ? undefined
      : () => {
          const start = () => startCustomizingRowActions(triggerRef.current);
          if (compact) start();
          else afterClose.current = start;
        };
  const handleCloseAutoFocus = (event: Event) => {
    const run = afterClose.current;
    if (run === null) {
      onCloseAutoFocus?.(event);
      return;
    }
    afterClose.current = null;
    event.preventDefault();
    run();
  };
  return (
    <SidebarRowControls
      primaryAction={
        showNewThread ? (
          <SidebarControlButton
            label={`New thread in ${label}`}
            icon="MessageSquarePlus"
            onClick={() => onNewThread?.()}
            disabled={!onNewThread}
          />
        ) : null
      }
    >
      <DropdownMenu open={open} onOpenChange={changeOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${label} actions`}
            data-sidebar-rename-anchor=""
            className={SIDEBAR_CONTROL_BUTTON_CLASS}
          >
            <Icon
              name="MoreHorizontal"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={8}
          onCloseAutoFocus={handleCloseAutoFocus}
          mobileTitle={
            page === "organize"
              ? "Organize"
              : page === "sort"
                ? "Sort by"
                : page === "filter"
                  ? "Filter"
                  : `${label} actions`
          }
        >
          <SidebarHeaderMenuContents
            creation={creation}
            anchorSectionId={sectionId}
            compact={compact}
            page={page}
            onPageChange={setPage}
            onCustomizeRowActions={customizeRowActions}
          >
            {children}
          </SidebarHeaderMenuContents>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarRowControls>
  );
}

export function SidebarSectionMenuItems({
  onRename,
  onRemove,
}: {
  onRename?: () => void;
  onRemove?: () => void;
}) {
  return (
    <>
      {onRename && (
        <DropdownMenuItem onSelect={onRename}>
          <Icon name="Edit" />
          Rename
        </DropdownMenuItem>
      )}
      <ThreadListVisibilityMenuItems />
      {onRemove && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            <Icon name="Trash2" />
            Remove
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
