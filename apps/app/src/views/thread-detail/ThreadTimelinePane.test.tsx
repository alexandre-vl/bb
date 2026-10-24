// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import type { ThreadTimelineSurfaceProps } from "@/components/thread/timeline/ThreadTimelineSurface";

vi.mock("@/components/thread/timeline/ThreadTimelineSurface", () => ({
  ThreadTimelineSurface: (props: ThreadTimelineSurfaceProps) => (
    <div data-testid="timeline">
      <span data-testid="plugin-panel-opener">
        {props.onOpenPluginPanel === undefined ? "missing" : "available"}
      </span>
      <span data-testid="navigation-target">
        {props.timelineNavigationTargetRowId ?? "none"}
      </span>
      <span data-testid="replaces-thread-rows">
        {String(props.replacesThreadRows ?? false)}
      </span>
    </div>
  ),
}));

vi.mock("@/components/thread/toc/ThreadTableOfContents", () => ({
  ThreadTableOfContents: ({
    onNavigateToRow,
  }: {
    onNavigateToRow?: (rowId: string) => void;
  }) => (
    <button type="button" onClick={() => onNavigateToRow?.("row-target")}>
      Jump to row
    </button>
  ),
}));

const { ThreadTimelinePane } = await import("./ThreadTimelinePane");

afterEach(cleanup);

function pane(
  threadId: string,
  timeline: Pick<
    ComponentProps<typeof ThreadTimelinePane>,
    "isThreadTimelinePending" | "timelineRows"
  >,
) {
  return (
    <ThreadTimelinePane
      activeThinking={null}
      canSpawnChild={false}
      contextBoundarySeq={null}
      footer={null}
      hasOlderTimelineRows={false}
      isLoadingOlderTimelineRows={false}
      isStopping={false}
      onLoadOlderRows={() => undefined}
      projectId="proj_1"
      resolveMentionLink={() => null}
      showOngoingIndicator={false}
      stoppingAnchorAt={0}
      threadId={threadId}
      threadRuntimeDisplayStatus="idle"
      timelineError={false}
      unreadDividerAutoScroll={false}
      unreadDividerPlacement={null}
      workspaceRootPath={undefined}
      {...timeline}
    />
  );
}

it("tells a loading timeline whether it replaces another thread's rows", () => {
  const replacesRows = () =>
    screen.getByTestId("replaces-thread-rows").textContent;
  const rows = [conversationRow({ id: "row-a", text: "Thread A" })];
  const view = render(
    pane("thr_a", { isThreadTimelinePending: true, timelineRows: [] }),
  );
  expect(replacesRows()).toBe("false");

  view.rerender(
    pane("thr_a", { isThreadTimelinePending: false, timelineRows: rows }),
  );
  view.rerender(
    pane("thr_b", { isThreadTimelinePending: true, timelineRows: [] }),
  );
  expect(replacesRows()).toBe("true");

  view.rerender(
    pane("thr_b", { isThreadTimelinePending: false, timelineRows: rows }),
  );
  expect(replacesRows()).toBe("false");
});

it("forwards pane callbacks to the timeline and conversation outline", () => {
  render(
    <ThreadTimelinePane
      activeThinking={null}
      canSpawnChild={false}
      contextBoundarySeq={null}
      footer={null}
      hasOlderTimelineRows={false}
      isLoadingOlderTimelineRows={false}
      isStopping={false}
      isThreadTimelinePending={false}
      onLoadOlderRows={() => undefined}
      onOpenPluginPanel={() => true}
      projectId="proj_1"
      resolveMentionLink={() => null}
      showOngoingIndicator={false}
      stoppingAnchorAt={0}
      threadId="thr_1"
      threadRuntimeDisplayStatus="idle"
      timelineError={false}
      timelineRows={[]}
      unreadDividerAutoScroll={false}
      unreadDividerPlacement={null}
      workspaceRootPath={undefined}
    />,
  );

  expect(screen.getByTestId("plugin-panel-opener").textContent).toBe(
    "available",
  );
  expect(screen.getByTestId("navigation-target").textContent).toBe("none");
  fireEvent.click(screen.getByRole("button", { name: "Jump to row" }));
  expect(screen.getByTestId("navigation-target").textContent).toBe(
    "row-target",
  );
});
