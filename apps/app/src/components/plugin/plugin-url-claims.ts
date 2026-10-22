import { useCallback } from "react";
import { z } from "zod";
import { jsonValueSchema } from "@bb/domain";
import type { PluginPanelActionOpenOptions } from "@get-bb/plugin-sdk";
import { useLatestRef } from "@/hooks/useLatestRef";
import {
  usePluginSlots,
  type PluginThreadPanelActionSlot,
} from "@/lib/plugin-slots";
import type { PluginThreadPanelOpenHandler } from "./plugin-thread-panel-navigation";

type PluginUrlClaim = Parameters<PluginThreadPanelOpenHandler>[0];

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
  actions: readonly PluginThreadPanelActionSlot[],
  href: string,
): PluginUrlClaim | null {
  const url = parseWebUrl(href);
  if (url === null) return null;
  for (const action of actions) {
    if (action.experimental_claimUrl === undefined) continue;
    let options: PluginPanelActionOpenOptions | null;
    try {
      options = readClaimedOpenOptions(
        action.experimental_claimUrl(new URL(url)),
      );
    } catch (error) {
      console.warn(
        `[plugin:${action.pluginId}] threadPanelAction "${action.id}" experimental_claimUrl failed: ${describeError(error)}`,
      );
      continue;
    }
    if (options !== null) {
      return { ...options, pluginId: action.pluginId, actionId: action.id };
    }
  }
  return null;
}

export function useOpenClaimedUrl(
  openThreadPanel: PluginThreadPanelOpenHandler,
): (href: string) => boolean {
  const { threadPanelActions } = usePluginSlots();
  const latestRef = useLatestRef({ openThreadPanel, threadPanelActions });
  return useCallback(
    (href: string) => {
      const latest = latestRef.current;
      const claim = claimUrlForThreadPanel(latest.threadPanelActions, href);
      return claim !== null && latest.openThreadPanel(claim);
    },
    [latestRef],
  );
}
