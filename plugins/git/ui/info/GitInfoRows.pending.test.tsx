// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { GitStatusState } from "../../status-state.js";
import { makeWorkspaceStatus } from "../../testing.js";

const gitStatus = vi.hoisted(() => ({
  current: undefined as GitStatusState | undefined,
}));

vi.mock("../queries.js", () => ({
  useGitStatus: () => gitStatus.current,
}));

const { BranchInfoRow, GitStatusInfoRow } = await import("./GitInfoRows.js");

installTestPluginRuntime();

function status(overrides: Partial<GitStatusState>): GitStatusState {
  return {
    result: undefined,
    workspace: undefined,
    failure: undefined,
    errorMessage: null,
    isLoading: false,
    retry: () => {},
    ...overrides,
  };
}

function renderRows(): string {
  const props = {
    threadId: "thread-1",
    projectId: "project-1",
    environment: { id: "env-1" },
  };
  return renderToStaticMarkup(
    <TooltipProvider>
      <BranchInfoRow {...props} />
      <GitStatusInfoRow {...props} />
    </TooltipProvider>,
  );
}

describe("git Info rows while git status loads", () => {
  beforeEach(() => {
    gitStatus.current = undefined;
  });

  it("holds the branch and git status rows with placeholders", () => {
    gitStatus.current = status({ isLoading: true });

    const markup = renderRows();

    expect(markup).toContain("Branch");
    expect(markup).toContain("Git status");
    expect(markup.match(/animate-pulse/g)).toHaveLength(2);
    expect(markup).not.toContain("unavailable");
  });

  it("drops both rows when there is no git status to wait for", () => {
    gitStatus.current = status({ isLoading: false });

    expect(renderRows()).toBe("");
  });

  it("shows the known checkout instead of a placeholder", () => {
    gitStatus.current = status({
      isLoading: true,
      workspace: makeWorkspaceStatus({
        checkout: { kind: "branch", branchName: "bb/info-row", headSha: null },
      }),
    });

    const markup = renderRows();

    expect(markup).not.toContain("animate-pulse");
    expect(markup).toContain("bb/info-row");
  });
});
