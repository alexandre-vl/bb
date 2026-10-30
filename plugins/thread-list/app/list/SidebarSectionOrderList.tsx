import type { ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { SidebarSectionId } from "../model/sidebar-section-id.js";
import type { ReorderDndContextProps } from "@/components/ui/use-reorder-dnd";

interface SidebarSectionOrderListProps {
  children: (sectionId: SidebarSectionId) => ReactNode;
  dndContextProps?: ReorderDndContextProps;
  order: readonly SidebarSectionId[];
  trailing?: ReactNode;
}

export function SidebarSectionOrderList({
  children,
  dndContextProps,
  order,
  trailing,
}: SidebarSectionOrderListProps) {
  const content = (
    <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
      <div
        data-sidebar-section-list=""
        className="space-y-3 pointer-coarse:space-y-8"
      >
        {order.map(children)}
      </div>
    </SortableContext>
  );

  return dndContextProps ? (
    <DndContext {...dndContextProps}>
      {content}
      {trailing}
    </DndContext>
  ) : (
    content
  );
}
