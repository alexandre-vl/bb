import { describe, expect, it } from "vitest";
import { makeEnvironment } from "@bb/test-helpers/domain-fixtures";
import {
  formatWorkspaceCheckoutDisplay,
  resolveWorkspaceCheckout,
} from "./workspace-checkout-display";

describe("formatWorkspaceCheckoutDisplay", () => {
  it("formats a branch checkout as a copyable branch label", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "branch",
          branchName: "bb/thread",
          headSha: "1234567890abcdef",
        },
      }),
    ).toMatchObject({
      copyValue: "bb/thread",
      label: "bb/thread",
      rowLabel: "Branch",
      title: "Copy branch name: bb/thread",
    });
  });

  it("formats detached HEAD with a short SHA label and copyable full SHA", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "detached",
          headSha: "abcdef1234567890",
        },
      }),
    ).toMatchObject({
      copyValue: "abcdef1234567890",
      label: "detached abcdef1",
      rowLabel: "Checkout",
      title: "Detached HEAD: abcdef1234567890",
    });
  });

  it("formats detached HEAD without a SHA", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "detached",
          headSha: null,
        },
      }),
    ).toMatchObject({
      copyValue: null,
      label: "detached HEAD",
      rowLabel: "Checkout",
      title: "Detached HEAD",
    });
  });

  it("formats an unborn checkout with a branch name", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "unborn",
          branchName: "main",
        },
      }),
    ).toMatchObject({
      copyValue: null,
      label: "main (empty)",
      rowLabel: "Checkout",
      title: "Empty branch: main",
    });
  });

  it("formats an unborn checkout without a branch name", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "unborn",
          branchName: null,
        },
      }),
    ).toMatchObject({
      copyValue: null,
      label: "empty repo",
      rowLabel: "Checkout",
      title: "Empty repository",
    });
  });

  it("formats an unknown checkout", () => {
    expect(
      formatWorkspaceCheckoutDisplay({
        checkout: {
          kind: "unknown",
          reason: "HEAD is missing",
        },
      }),
    ).toMatchObject({
      copyValue: null,
      label: "unknown checkout",
      rowLabel: "Checkout",
      title: "Unknown checkout: HEAD is missing",
    });
  });
});

describe("resolveWorkspaceCheckout", () => {
  const provisionedWorktree = makeEnvironment({
    branchName: "bb/thread-chip",
    managed: true,
  });
  const userCheckout = makeEnvironment({
    branchName: "main",
    environmentProviderId: "project-checkout",
    isWorktree: false,
    managed: false,
    workspaceProvisionType: "unmanaged",
  });

  function displayFor(
    args: Parameters<typeof resolveWorkspaceCheckout>[0],
  ): ReturnType<typeof formatWorkspaceCheckoutDisplay> | null {
    const checkout = resolveWorkspaceCheckout(args);
    return checkout === null
      ? null
      : formatWorkspaceCheckoutDisplay({ checkout });
  }

  it("shows a bb-managed worktree's branch before git status, unchanged once git status agrees", () => {
    const beforeStatus = displayFor({
      environment: provisionedWorktree,
      workspaceStatus: undefined,
      workspaceStatusPending: true,
    });
    const afterStatus = displayFor({
      environment: provisionedWorktree,
      workspaceStatus: {
        checkout: {
          kind: "branch",
          branchName: "bb/thread-chip",
          headSha: "1234567890abcdef",
        },
      },
      workspaceStatusPending: false,
    });

    expect(beforeStatus?.label).toBe("bb/thread-chip");
    expect(afterStatus).toEqual(beforeStatus);
  });

  it("lets git status replace a provisioned branch the worktree has left", () => {
    expect(
      displayFor({
        environment: provisionedWorktree,
        workspaceStatus: {
          checkout: { kind: "detached", headSha: "abcdef1234567890" },
        },
        workspaceStatusPending: false,
      })?.label,
    ).toBe("detached abcdef1");
  });

  it("waits for git status in a checkout the user can switch", () => {
    expect(
      resolveWorkspaceCheckout({
        environment: userCheckout,
        workspaceStatus: undefined,
        workspaceStatusPending: true,
      }),
    ).toBeNull();
  });

  it("drops the provisioned branch once git status has failed", () => {
    expect(
      resolveWorkspaceCheckout({
        environment: provisionedWorktree,
        workspaceStatus: undefined,
        workspaceStatusPending: false,
      }),
    ).toBeNull();
  });

  it("does not trust the branch of a workspace that is not ready", () => {
    expect(
      resolveWorkspaceCheckout({
        environment: makeEnvironment({ managed: true, status: "provisioning" }),
        workspaceStatus: undefined,
        workspaceStatusPending: true,
      }),
    ).toBeNull();
  });
});
