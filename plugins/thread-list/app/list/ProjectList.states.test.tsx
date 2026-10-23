// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { preferencesReadyAtom } from "../preferences/preferences-sync.js";

installTestPluginRuntime();
const { ProjectList } = await import("./ProjectList.js");
const { resetSidebarDataCacheForTest } =
  await import("../model/use-sidebar-data.js");

afterEach(() => {
  cleanup();
  resetSidebarDataCacheForTest();
});

function Harness({
  children,
  store,
}: {
  children: ReactNode;
  store: ReturnType<typeof createStore>;
}) {
  return (
    <TooltipProvider>
      <Provider store={store}>{children}</Provider>
    </TooltipProvider>
  );
}

describe("ProjectList load error", () => {
  it("keeps Retry focused and busy until the retry settles", async () => {
    const store = createStore();
    store.set(preferencesReadyAtom(), true);
    let settle = () => {};
    let retries = 0;
    renderSlot(
      { component: Harness },
      { children: <ProjectList activeThreadId={null} />, store },
      {
        sidebarThreads: {
          status: "error",
          experimental_refetch: () => {
            retries += 1;
            return new Promise<void>((resolve) => {
              settle = resolve;
            });
          },
        },
      },
    );
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);

    const busy = screen.getByRole("button", { name: "Retrying…" });
    expect(busy).toBe(retry);
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(busy);
    expect(retries).toBe(1);

    await act(async () => settle());
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
  });
});
