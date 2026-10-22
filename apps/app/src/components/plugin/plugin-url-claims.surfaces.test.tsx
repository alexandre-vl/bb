// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ThreadPullRequest } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadPromptContextBanner } from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { PullRequestRow } from "@/components/secondary-panel/ThreadMetadataContent";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { PluginUrlClaimContext } from "./plugin-url-claims";

const PULL_URL = "https://github.com/acme/bb/pull/128";

const pullRequest: ThreadPullRequest = {
  number: 128,
  title: "Open pull requests in the GitHub side panel",
  state: "open",
  url: PULL_URL,
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

type OpenClaimedUrl = (href: string) => boolean;

interface MountedSurface {
  link: HTMLElement;
  openedWithoutPlugins(): boolean;
}

interface Surface {
  name: string;
  mount(openClaimedUrl: OpenClaimedUrl): MountedSurface;
}

function mountInThreadView(openClaimedUrl: OpenClaimedUrl, content: ReactNode) {
  render(
    <MemoryRouter>
      <PluginUrlClaimContext.Provider value={openClaimedUrl}>
        {content}
      </PluginUrlClaimContext.Provider>
    </MemoryRouter>,
  );
}

function mountPullRequestLink(
  openClaimedUrl: OpenClaimedUrl,
  content: ReactNode,
): MountedSurface {
  const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
  mountInThreadView(openClaimedUrl, content);
  return {
    link: screen.getByRole("link", { name: /^Pull request 128:/ }),
    openedWithoutPlugins: () =>
      openWindow.mock.calls.some(([url]) => url === PULL_URL),
  };
}

const surfaces: readonly Surface[] = [
  {
    name: "a Markdown link",
    mount(openClaimedUrl) {
      const onOpenLink = vi.fn<(link: { href: string }) => boolean>(() => true);
      mountInThreadView(
        openClaimedUrl,
        <MarkdownPreview
          content={`See [the pull request](${PULL_URL}).`}
          linkRouting={{ onOpenLink }}
        />,
      );
      return {
        link: screen.getByRole("link", { name: "the pull request" }),
        openedWithoutPlugins: () =>
          onOpenLink.mock.calls.some(([link]) => link.href === PULL_URL),
      };
    },
  },
  {
    name: "the prompt banner's pull request",
    mount: (openClaimedUrl) =>
      mountPullRequestLink(
        openClaimedUrl,
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
        />,
      ),
  },
  {
    name: "the Info tab's pull request",
    mount: (openClaimedUrl) =>
      mountPullRequestLink(
        openClaimedUrl,
        <PullRequestRow pullRequest={pullRequest} />,
      ),
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(surfaces)("$name in a thread view", (surface) => {
  it("opens the tab of the plugin that claims it on a plain click", () => {
    const openClaimedUrl = vi.fn<OpenClaimedUrl>(() => true);
    const { link, openedWithoutPlugins } = surface.mount(openClaimedUrl);

    expect(fireEvent.click(link)).toBe(false);
    expect(openClaimedUrl).toHaveBeenCalledExactlyOnceWith(PULL_URL);
    expect(openedWithoutPlugins()).toBe(false);
  });

  it("opens the URL as before when no plugin tab takes it", () => {
    const openClaimedUrl = vi.fn<OpenClaimedUrl>(() => false);
    const { link, openedWithoutPlugins } = surface.mount(openClaimedUrl);

    fireEvent.click(link);
    expect(openClaimedUrl).toHaveBeenCalledExactlyOnceWith(PULL_URL);
    expect(openedWithoutPlugins()).toBe(true);
  });

  it.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
  ])("never offers a %s-click to plugins", (_name, modifiers) => {
    const openClaimedUrl = vi.fn<OpenClaimedUrl>(() => true);
    const { link } = surface.mount(openClaimedUrl);

    fireEvent.click(link, modifiers);
    expect(openClaimedUrl).not.toHaveBeenCalled();
  });
});
