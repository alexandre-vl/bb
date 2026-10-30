import { describe, expect, it } from "vitest";
import {
  getCompactFollowUpPromptPlaceholder,
  getFollowUpPromptPlaceholder,
} from "./follow-up-placeholder";

describe("follow-up placeholder", () => {
  it("adds the provisioning time left only while the thread starts with an estimate", () => {
    expect(getFollowUpPromptPlaceholder("starting", 12_000)).toBe(
      "Starting thread... ~12s",
    );
    expect(getCompactFollowUpPromptPlaceholder("starting", 12_000)).toBe(
      "Starting... ~12s",
    );
    expect(getFollowUpPromptPlaceholder("provisioning", 12_000)).toBe(
      "Setting up workspace... ~12s",
    );
    expect(getCompactFollowUpPromptPlaceholder("provisioning", 12_000)).toBe(
      "Setting up... ~12s",
    );
    expect(getFollowUpPromptPlaceholder("starting", null)).toBe(
      "Starting thread...",
    );
    expect(getFollowUpPromptPlaceholder("idle", 12_000)).toBe(
      "Ask for a follow-up. @ to mention files, folders, sections, or threads",
    );
  });
});
