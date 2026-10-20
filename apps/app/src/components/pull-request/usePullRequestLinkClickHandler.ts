import { useCallback } from "react";
import { usePluginThreadPanelOpenHandler } from "@/components/plugin/plugin-thread-panel-navigation";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  isPlainPrimaryClick,
  useUrlAnchorClickHandler,
  type UrlAnchorClickHandler,
} from "@/lib/url-open-routing";

export function usePullRequestLinkClickHandler(
  url: string | undefined,
): UrlAnchorClickHandler {
  const { threadPanelActions } = usePluginSlots();
  const openThreadPanel = usePluginThreadPanelOpenHandler();
  const handleUrlClick = useUrlAnchorClickHandler(url);
  const pullRequestAction = threadPanelActions.find(
    (action) => action.experimental_pullRequest === true,
  );
  const pluginId = pullRequestAction?.pluginId;
  const actionId = pullRequestAction?.id;

  return useCallback(
    (event) => {
      if (
        openThreadPanel !== null &&
        pluginId !== undefined &&
        actionId !== undefined &&
        isPlainPrimaryClick(event) &&
        openThreadPanel({ pluginId, actionId })
      ) {
        event.preventDefault();
        return;
      }
      handleUrlClick(event);
    },
    [actionId, handleUrlClick, openThreadPanel, pluginId],
  );
}
