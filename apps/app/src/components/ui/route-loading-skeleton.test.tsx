// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { SidebarProvider } from "@/components/ui/sidebar";
import { RouteLoadingSkeleton } from "./route-loading-skeleton";

afterEach(() => {
  cleanup();
});

function renderSkeleton({
  isBoundedPane = false,
  isSidebarOpen = true,
  secondaryPanelWidthPercent,
}: {
  isBoundedPane?: boolean;
  isSidebarOpen?: boolean;
  secondaryPanelWidthPercent?: number;
} = {}) {
  render(
    <SidebarProvider open={isSidebarOpen} onOpenChange={() => {}}>
      <div data-testid="skeleton-host">
        <RouteLoadingSkeleton
          isBoundedPane={isBoundedPane}
          secondaryPanelWidthPercent={secondaryPanelWidthPercent}
        />
      </div>
      <div data-testid="page-header-host">
        <AppPageHeader center={<p>Thread title</p>} />
      </div>
    </SidebarProvider>,
  );
  return {
    skeleton: screen.getByTestId("route-loading-skeleton"),
    page: screen.queryByTestId("route-loading-skeleton-page"),
    panel: screen.queryByTestId("route-loading-skeleton-secondary-panel"),
  };
}

function headerLayout(hostTestId: string) {
  const header = screen.getByTestId(hostTestId).querySelector("header");
  const row = header?.querySelector(
    '[data-testid="app-page-header-content-row"]',
  );
  return { header: header?.className, row: row?.className };
}

describe("RouteLoadingSkeleton", () => {
  it("bleeds through standalone page padding", () => {
    const { skeleton } = renderSkeleton();

    expect([...skeleton.classList]).toEqual(
      expect.arrayContaining(["-mx-4", "-mt-4", "md:-mx-5", "md:-mt-5"]),
    );
  });

  it("keeps bounded-pane placeholders inside their pane", () => {
    const { skeleton } = renderSkeleton({ isBoundedPane: true });

    expect(skeleton.classList.contains("flex")).toBe(true);
    for (const token of ["-mx-4", "-mt-4", "md:-mx-5", "md:-mt-5"]) {
      expect(skeleton.classList.contains(token)).toBe(false);
    }
  });

  it.each([true, false])(
    "lays its header out like the page header it stands in for (sidebar open: %s)",
    (isSidebarOpen) => {
      renderSkeleton({ isSidebarOpen });

      expect(headerLayout("skeleton-host").header).toBeDefined();
      expect(headerLayout("skeleton-host")).toEqual(
        headerLayout("page-header-host"),
      );
    },
  );

  it("splits the persisted right panel width off the page column that holds the header and composer", () => {
    const { page, panel } = renderSkeleton({ secondaryPanelWidthPercent: 35 });

    expect(page?.style.flex).toBe("65 1 0px");
    expect(panel?.style.flex).toBe("35 1 0px");
    expect(page?.querySelector("header")).not.toBeNull();
    expect(panel?.querySelector("header")).toBeNull();
    expect(panel?.querySelector(".border-l")).not.toBeNull();
  });

  it("gives the whole pane to the panel when the conversation is collapsed", () => {
    const { page, panel } = renderSkeleton({ secondaryPanelWidthPercent: 100 });

    expect(page?.style.flex).toBe("0 1 0px");
    expect(page?.style.minWidth).toBe("0px");
    expect(panel?.style.flex).toBe("100 1 0px");
    expect(panel?.querySelector(".border-l")).toBeNull();
  });

  it("renders outside the sidebar layout", () => {
    render(<RouteLoadingSkeleton isBoundedPane={false} />);

    expect(screen.getByTestId("route-loading-skeleton")).toBeDefined();
  });

  it("reserves no panel column when no panel is open", () => {
    const { page, panel } = renderSkeleton();

    expect(page).toBeNull();
    expect(panel).toBeNull();
  });
});
