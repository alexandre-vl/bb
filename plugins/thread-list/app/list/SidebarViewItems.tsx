import type { ReactNode } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { experimental_useExperiment } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import type { SidebarSectionId } from "../model/sidebar-section-id.js";
import type { HeaderCreationActions } from "./SidebarHeaderControls.js";
import { ThreadListVisibilityMenuItems } from "./ThreadListVisibility.js";
import {
  sidebarThreadLifecyclesAtom,
  sidebarOrganizationModeAtom,
  sidebarChronologicalSortAtom,
  sidebarSortDirectionAtom,
  sidebarGroupThreadsByEnvironmentAtom,
  sidebarEnvironmentGroupingAtom,
  sidebarAttentionFirstAtom,
  sidebarFoldSettledAtom,
  sidebarParentsStartCollapsedAtom,
  sidebarShowProviderIconsAtom,
  sidebarShowRowMetadataAtom,
  THREAD_ROW_METADATA_EXPERIMENT,
} from "../preferences/atoms.js";

const SIDEBAR_ORGANIZE_OPTIONS = [
  { label: "By project", mode: "project" },
  { label: "By machine", mode: "machine" },
  { label: "Custom", mode: "chronological" },
] as const;

const SIDEBAR_SORT_OPTIONS = [
  { label: "Updated at", sort: "updated", direction: "descending" },
  { label: "Created at", sort: "created", direction: "descending" },
  { label: "Alphabetical", sort: "alpha", direction: "ascending" },
] as const;

type SidebarViewPage = "organize" | "sort" | "filter";

export function SidebarHeaderMenuContents({
  creation,
  anchorSectionId,
  compact,
  page,
  onPageChange,
  onCustomizeRowActions,
  onNewThread,
  children,
}: {
  creation: HeaderCreationActions;
  anchorSectionId?: SidebarSectionId;
  compact: boolean;
  page: SidebarViewPage | null;
  onPageChange: (page: SidebarViewPage | null) => void;
  onCustomizeRowActions?: () => void;
  onNewThread?: { label: string; run: () => void };
  children?: ReactNode;
}) {
  if (compact && page) {
    return (
      <>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onPageChange(null);
          }}
        >
          <Icon name="ChevronLeft" />
          Back
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <SidebarViewItems
          page={page}
          onCustomizeRowActions={onCustomizeRowActions}
        />
      </>
    );
  }
  return (
    <>
      {onNewThread ? (
        <DropdownMenuItem onSelect={onNewThread.run}>
          <Icon name="MessageSquarePlus" />
          {onNewThread.label}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        disabled={!creation.onNewSection || creation.isCreatingSection}
        onSelect={() => creation.onNewSection?.(anchorSectionId)}
      >
        <Icon name="SectionAdd" />
        New section
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {(
        [
          { page: "organize", label: "Organize", icon: "Layers" },
          { page: "sort", label: "Sort by", icon: "ArrowUpDown" },
          { page: "filter", label: "Filter", icon: "SlidersHorizontal" },
        ] as const
      ).map((item) =>
        compact ? (
          <DropdownMenuItem
            key={item.page}
            className="[&>[data-icon-root]:last-child]:size-3 [&>[data-icon-root]:last-child]:text-subtle-foreground"
            onSelect={(event) => {
              event.preventDefault();
              onPageChange(item.page);
            }}
          >
            <Icon name={item.icon} />
            {item.label}
            <Icon name="ChevronRight" className="ml-auto" />
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub key={item.page}>
            <DropdownMenuSubTrigger className="[&>[data-icon-root]:last-child]:size-3 [&>[data-icon-root]:last-child]:text-subtle-foreground">
              <Icon name={item.icon} />
              {item.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent
                className={
                  item.page === "organize"
                    ? "min-w-32"
                    : "w-max min-w-28 max-w-64"
                }
              >
                <SidebarViewItems
                  page={item.page}
                  onCustomizeRowActions={onCustomizeRowActions}
                />
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ),
      )}
      {children ? (
        <>
          <DropdownMenuSeparator />
          {children}
        </>
      ) : (
        <ThreadListVisibilityMenuItems />
      )}
    </>
  );
}

function SidebarViewToggleItem({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={checked}
      onSelect={(event) => {
        event.preventDefault();
        onToggle();
      }}
    >
      {label}
      <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
        {checked && <Icon name="Check" className="size-4" />}
      </span>
    </DropdownMenuItem>
  );
}

function SidebarViewItems({
  page,
  onCustomizeRowActions,
}: {
  page: SidebarViewPage;
  onCustomizeRowActions?: () => void;
}) {
  const [lifecycles, setLifecycles] = useAtom(sidebarThreadLifecyclesAtom);
  const [organization, setOrganization] = useAtom(sidebarOrganizationModeAtom);
  const [sort, setSort] = useAtom(sidebarChronologicalSortAtom);
  const [savedDirection, setDirection] = useAtom(sidebarSortDirectionAtom);
  const setEnvironmentGrouping = useSetAtom(sidebarEnvironmentGroupingAtom);
  const groupByEnvironment = useAtomValue(sidebarGroupThreadsByEnvironmentAtom);
  const [attentionFirst, setAttentionFirst] = useAtom(
    sidebarAttentionFirstAtom,
  );
  const [foldSettled, setFoldSettled] = useAtom(sidebarFoldSettledAtom);
  const [parentsStartCollapsed, setParentsStartCollapsed] = useAtom(
    sidebarParentsStartCollapsedAtom,
  );
  const [showProviderIcons, setShowProviderIcons] = useAtom(
    sidebarShowProviderIconsAtom,
  );
  const [showRowMetadata, setShowRowMetadata] = useAtom(
    sidebarShowRowMetadataAtom,
  );
  const rowMetadataEnabled = experimental_useExperiment(
    THREAD_ROW_METADATA_EXPERIMENT,
  );
  const selectedSort = sort === "none" ? "updated" : sort;
  if (page === "filter") {
    return (
      <DropdownMenuGroup aria-label="Filter">
        {(["active", "archived"] as const).map((lifecycle) => {
          const checked = lifecycles.includes(lifecycle);
          const required = checked && lifecycles.length === 1;
          return (
            <DropdownMenuItem
              key={lifecycle}
              role="menuitemcheckbox"
              aria-checked={checked}
              title={required ? "Keep at least one filter selected" : undefined}
              onSelect={(event) => {
                event.preventDefault();
                if (required) return;
                setLifecycles(
                  checked
                    ? lifecycles.filter((value) => value !== lifecycle)
                    : [...lifecycles, lifecycle],
                );
              }}
            >
              {lifecycle === "active" ? "Active" : "Archived"}
              <span className="ml-auto inline-flex size-4 items-center justify-center">
                {checked && <Icon name="Check" className="size-4" />}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuGroup>
    );
  }
  if (page === "organize") {
    return (
      <>
        <DropdownMenuGroup aria-label="Sections">
          <DropdownMenuLabel>Sections</DropdownMenuLabel>
          {SIDEBAR_ORGANIZE_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.mode}
              role="menuitemradio"
              aria-checked={organization === option.mode}
              onSelect={(event) => {
                event.preventDefault();
                setOrganization(option.mode);
              }}
            >
              {option.label}
              <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
                {organization === option.mode && (
                  <Icon name="Check" className="size-4" />
                )}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup aria-label="Groups">
          <DropdownMenuLabel>Groups</DropdownMenuLabel>
          <DropdownMenuItem
            role="menuitemcheckbox"
            aria-checked={groupByEnvironment}
            onSelect={(event) => {
              event.preventDefault();
              setEnvironmentGrouping(!groupByEnvironment);
            }}
          >
            By environment
            <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
              {groupByEnvironment && <Icon name="Check" className="size-4" />}
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup aria-label="Order">
          <DropdownMenuLabel>Order</DropdownMenuLabel>
          <SidebarViewToggleItem
            label="Attention first"
            checked={attentionFirst}
            onToggle={() => setAttentionFirst(!attentionFirst)}
          />
          <SidebarViewToggleItem
            label="Fold settled threads"
            checked={foldSettled}
            onToggle={() => setFoldSettled(!foldSettled)}
          />
          <SidebarViewToggleItem
            label="Collapse new parents"
            checked={parentsStartCollapsed}
            onToggle={() => setParentsStartCollapsed(!parentsStartCollapsed)}
          />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup aria-label="Rows">
          <DropdownMenuLabel>Rows</DropdownMenuLabel>
          <DropdownMenuItem
            role="menuitemcheckbox"
            aria-checked={showProviderIcons}
            onSelect={(event) => {
              event.preventDefault();
              setShowProviderIcons(!showProviderIcons);
            }}
          >
            Provider icons
            <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
              {showProviderIcons && <Icon name="Check" className="size-4" />}
            </span>
          </DropdownMenuItem>
          {rowMetadataEnabled ? (
            <DropdownMenuItem
              role="menuitemcheckbox"
              aria-checked={showRowMetadata}
              onSelect={(event) => {
                event.preventDefault();
                setShowRowMetadata(!showRowMetadata);
              }}
            >
              Metadata
              <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
                {showRowMetadata && <Icon name="Check" className="size-4" />}
              </span>
            </DropdownMenuItem>
          ) : null}
          {onCustomizeRowActions && (
            <DropdownMenuItem onSelect={onCustomizeRowActions}>
              Customize actions
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </>
    );
  }
  return (
    <DropdownMenuGroup aria-label="Sort">
      {SIDEBAR_SORT_OPTIONS.map((option) => {
        const selected = selectedSort === option.sort;
        const direction =
          savedDirection === "default" ? option.direction : savedDirection;
        const nextDirection = selected
          ? direction === "ascending"
            ? "descending"
            : "ascending"
          : option.direction;
        return (
          <DropdownMenuItem
            key={option.sort}
            role="menuitemradio"
            aria-checked={selected}
            aria-label={
              selected
                ? `${option.label}, ${direction}. Sort ${nextDirection}`
                : option.label
            }
            onSelect={(event) => {
              event.preventDefault();
              setSort(option.sort);
              setDirection(nextDirection);
            }}
          >
            {option.label}
            {selected && (
              <span className="sr-only">
                , {direction}. Sort {nextDirection}
              </span>
            )}
            <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
              {selected && (
                <Icon
                  name={direction === "ascending" ? "ArrowUp" : "ArrowDown"}
                  className="size-4"
                />
              )}
            </span>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuGroup>
  );
}
