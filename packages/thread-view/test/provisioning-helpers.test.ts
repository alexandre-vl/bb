import { describe, expect, it } from "vitest";
import { mergeProvisioningMetadata } from "../src/provisioning-helpers.js";

describe("mergeProvisioningMetadata", () => {
  it("keeps every phase of a step in arrival order with its receipt time", () => {
    const merged = mergeProvisioningMetadata(
      {
        provisioningId: "provision_1",
        transcript: [
          {
            type: "step",
            key: "provider-step-1-Preparing worktree…",
            text: "Preparing worktree…",
            status: "started",
            receivedAt: 1_000,
          },
        ],
      },
      {
        environmentId: "env_1",
        provisioningId: "provision_1",
        transcript: [
          {
            type: "step",
            key: "provider-step-1-Preparing worktree…",
            text: "Preparing worktree…",
            status: "completed",
            receivedAt: 4_000,
          },
          {
            type: "step",
            key: "setup-started",
            text: "Running .bb-env-setup.sh",
            status: "started",
            receivedAt: 4_000,
          },
        ],
      },
    );

    expect(merged?.environmentId).toBe("env_1");
    expect(
      merged?.transcript?.map((entry) => [entry.status, entry.receivedAt]),
    ).toEqual([
      ["started", 1_000],
      ["completed", 4_000],
      ["started", 4_000],
    ]);
  });
});
