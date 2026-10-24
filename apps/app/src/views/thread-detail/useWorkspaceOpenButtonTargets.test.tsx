// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import type { WorkspaceOpenTarget } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it } from "vitest";
import {
  useWorkspaceOpenButtonTargets,
  type WorkspaceOpenButtonTargets,
} from "./useWorkspaceOpenButtonTargets";

const vscode: WorkspaceOpenTarget = {
  capabilities: { openDirectory: true, openFile: true, openFileAtLine: true },
  id: "vscode",
  label: "VS Code",
};
const finder: WorkspaceOpenTarget = {
  capabilities: { openDirectory: true, openFile: false, openFileAtLine: false },
  id: "finder",
  label: "Finder",
};

interface Props {
  current: WorkspaceOpenButtonTargets | null;
  isEnvironmentPending: boolean;
}

afterEach(() => {
  cleanup();
});

describe("useWorkspaceOpenButtonTargets", () => {
  it("keeps the open button while the next thread's environment loads", () => {
    const shown = { preferredTarget: vscode, targets: [vscode, finder] };
    const { result, rerender } = renderHook<
      WorkspaceOpenButtonTargets | null,
      Props
    >(
      ({ current, isEnvironmentPending }) =>
        useWorkspaceOpenButtonTargets(current, isEnvironmentPending),
      { initialProps: { current: shown, isEnvironmentPending: false } },
    );

    rerender({ current: null, isEnvironmentPending: true });
    expect(result.current).toEqual(shown);

    rerender({
      current: { preferredTarget: finder, targets: [vscode, finder] },
      isEnvironmentPending: false,
    });
    expect(result.current?.preferredTarget).toBe(finder);
  });

  it("drops the open button once the next environment turns out to have no workspace to open", () => {
    const { result, rerender } = renderHook<
      WorkspaceOpenButtonTargets | null,
      Props
    >(
      ({ current, isEnvironmentPending }) =>
        useWorkspaceOpenButtonTargets(current, isEnvironmentPending),
      {
        initialProps: {
          current: { preferredTarget: vscode, targets: [vscode] },
          isEnvironmentPending: false,
        },
      },
    );

    rerender({ current: null, isEnvironmentPending: true });
    rerender({ current: null, isEnvironmentPending: false });

    expect(result.current).toBeNull();
  });

  it("shows nothing for a first thread whose environment is still loading", () => {
    const { result } = renderHook(() =>
      useWorkspaceOpenButtonTargets(null, true),
    );

    expect(result.current).toBeNull();
  });
});
