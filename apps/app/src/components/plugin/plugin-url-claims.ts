import { createContext, useCallback, useContext } from "react";
import { z } from "zod";
import { jsonValueSchema } from "@bb/domain";
import type { PluginPanelActionOpenOptions } from "@get-bb/plugin-sdk";
import { useLatestRef } from "@/hooks/useLatestRef";
import {
  isThreadTab,
  usePluginSlots,
  type PluginTabSlot,
} from "@/lib/plugin-slots";
import {
  isPlainPrimaryClick,
  useUrlAnchorClickHandler,
  type UrlAnchorClickEvent,
  type UrlAnchorClickHandler,
} from "@/lib/url-open-routing";
import type { PluginThreadPanelOpenHandler } from "./plugin-thread-panel-navigation";

type PluginUrlClaim = Parameters<PluginThreadPanelOpenHandler>[0];

export const PluginUrlClaimContext = createContext<
  ((href: string) => boolean) | null
>(null);

const claimedOpenOptionsSchema = z.object({
  title: z.string().optional(),
  params: jsonValueSchema.optional(),
});

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseWebUrl(href: string): URL | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

function readClaimedOpenOptions(
  value: unknown,
): PluginPanelActionOpenOptions | null {
  if (value === null || value === undefined) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("must return panel open options or null");
  }
  return claimedOpenOptionsSchema.parse(value);
}

function claimUrlForThreadPanel(
  tabs: readonly PluginTabSlot[],
  href: string,
): PluginUrlClaim | null {
  const url = parseWebUrl(href);
  if (url === null) return null;
  for (const tab of tabs) {
    if (
      !isThreadTab(tab) ||
      tab.availability !== "action" ||
      tab.experimental_claimUrl === undefined
    ) {
      continue;
    }
    let options: PluginPanelActionOpenOptions | null;
    try {
      options = readClaimedOpenOptions(tab.experimental_claimUrl(new URL(url)));
    } catch (error) {
      console.warn(
        `[plugin:${tab.pluginId}] experimental_tab "${tab.id}" experimental_claimUrl failed: ${describeError(error)}`,
      );
      continue;
    }
    if (options !== null) {
      return { ...options, pluginId: tab.pluginId, actionId: tab.id };
    }
  }
  return null;
}

export function useOpenClaimedUrl(
  openThreadPanel: PluginThreadPanelOpenHandler,
): (href: string) => boolean {
  const { tabs } = usePluginSlots();
  const latestRef = useLatestRef({ openThreadPanel, tabs });
  return useCallback(
    (href: string) => {
      const latest = latestRef.current;
      const claim = claimUrlForThreadPanel(latest.tabs, href);
      return claim !== null && latest.openThreadPanel(claim);
    },
    [latestRef],
  );
}

export function useOpenClaimedUrlOnClick(): (
  event: UrlAnchorClickEvent,
  href: string,
) => boolean {
  const openClaimedUrl = useContext(PluginUrlClaimContext);
  return useCallback(
    (event, href) => {
      if (
        openClaimedUrl === null ||
        !isPlainPrimaryClick(event) ||
        !openClaimedUrl(href)
      ) {
        return false;
      }
      event.preventDefault();
      return true;
    },
    [openClaimedUrl],
  );
}

export function useClaimableUrlAnchorClickHandler(
  url: string | undefined,
): UrlAnchorClickHandler {
  const openClaimedUrlOnClick = useOpenClaimedUrlOnClick();
  const handleUrlClick = useUrlAnchorClickHandler(url);
  return useCallback(
    (event) => {
      if (url !== undefined && openClaimedUrlOnClick(event, url)) return;
      handleUrlClick(event);
    },
    [handleUrlClick, openClaimedUrlOnClick, url],
  );
}
