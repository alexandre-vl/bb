// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ThreadPullRequest } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginThreadPanelNavigationProvider,
  type PluginThreadPanelOpenHandler,
} from "@/components/plugin/plugin-thread-panel-navigation";
import { ThreadPromptContextBanner } from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { PullRequestRow } from "@/components/secondary-panel/ThreadMetadataContent";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const pullRequest: ThreadPullRequest = {
  number: 128,
  title: "Open pull requests in the GitHub side panel",
  state: "open",
  url: "https://github.com/acme/bb/pull/128",
  baseRefName: "main",
  headRefName: "bb/pr-side-panel",
  updatedAt: "2026-10-21T12:30:00Z",
  autoMerge: false,
  inMergeQueue: false,
  checks: {
    state: "passing",
    totalCount: 1,
    passedCount: 1,
    failedCount: 0,
    pendingCount: 0,
  },
  review: { state: "none", reviewRequestCount: 0 },
  mergeability: {
    state: "mergeable",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  },
  attention: "ready_to_merge",
};

function PanelComponent() {
  return null;
}

function registerPullRequestPanel(experimentalPullRequest: boolean) {
  setPluginSlotRegistrations(
    "github",
    makePluginRegistrationSet({
      threadPanelActions: [
        {
          id: "pull",
          title: "GitHub PR",
          component: PanelComponent,
          ...(experimentalPullRequest
            ? { experimental_pullRequest: true }
            : {}),
        },
      ],
    }),
  );
}

const surfaces: readonly { name: string; render: () => ReactNode }[] = [
  {
    name: "prompt banner",
    render: () => (
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{ pullRequest }}
        expandedSection={null}
        onToggleSection={() => {}}
      />
    ),
  },
  {
    name: "Info tab",
    render: () => <PullRequestRow pullRequest={pullRequest} />,
  },
];

function renderSurface(
  surface: (typeof surfaces)[number],
  openThreadPanel: PluginThreadPanelOpenHandler,
) {
  render(
    <MemoryRouter>
      <PluginThreadPanelNavigationProvider openThreadPanel={openThreadPanel}>
        {surface.render()}
      </PluginThreadPanelNavigationProvider>
    </MemoryRouter>,
  );
  return screen.getByRole("link", { name: /^Pull request 128:/ });
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe.each(surfaces)("pull request link in the $name", (surface) => {
  it("opens the plugin's pull request tab on a plain click", () => {
    registerPullRequestPanel(true);
    const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
    const openThreadPanel = vi.fn(() => true);
    const link = renderSurface(surface, openThreadPanel);

    expect(fireEvent.click(link)).toBe(false);
    expect(openThreadPanel).toHaveBeenCalledWith({
      pluginId: "github",
      actionId: "pull",
    });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Shift", { shiftKey: true }],
  ])("leaves a %s-click to the browser", (_name, modifiers) => {
    registerPullRequestPanel(true);
    const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
    const openThreadPanel = vi.fn(() => true);
    const link = renderSurface(surface, openThreadPanel);

    expect(fireEvent.click(link, modifiers)).toBe(true);
    expect(openThreadPanel).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens the URL when no tab declares the pull request", () => {
    registerPullRequestPanel(false);
    const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
    const openThreadPanel = vi.fn(() => true);
    const link = renderSurface(surface, openThreadPanel);

    fireEvent.click(link);
    expect(openThreadPanel).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(
      pullRequest.url,
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("opens the URL when the side panel declines", () => {
    registerPullRequestPanel(true);
    const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
    const openThreadPanel = vi.fn(() => false);
    const link = renderSurface(surface, openThreadPanel);

    fireEvent.click(link);
    expect(openThreadPanel).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith(
      pullRequest.url,
      "_blank",
      "noopener,noreferrer",
    );
  });
});
