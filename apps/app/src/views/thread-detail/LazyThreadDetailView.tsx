import type { ComponentProps } from "react";
import { defineSplit } from "@/lib/define-split";
import { useRouteState } from "@/hooks/useRouteState";
import { usePaneContext } from "./PaneContext";
import type { ThreadDetailView } from "./ThreadDetailView";
import { ThreadRouteLoadingSkeleton } from "./ThreadRouteLoadingSkeleton";

function ThreadDetailViewLoading(
  props: ComponentProps<typeof ThreadDetailView>,
) {
  const { isBoundedPane } = usePaneContext();
  const route = useRouteState();
  return (
    <ThreadRouteLoadingSkeleton
      isBoundedPane={isBoundedPane}
      threadId={props.surface === "pane" ? props.threadId : route.threadId}
    />
  );
}

export const LazyThreadDetailView = defineSplit<
  ComponentProps<typeof ThreadDetailView>
>({
  id: "thread-detail",
  tier: "preload",
  load: () =>
    import("./ThreadDetailView").then((module) => module.ThreadDetailView),
  loading: ThreadDetailViewLoading,
});
