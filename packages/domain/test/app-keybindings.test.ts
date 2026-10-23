import { describe, expect, it } from "vitest";
import {
  appDefaultKeybindingsSchema,
  appKeybindingOverridesSchema,
} from "../src/app-keybindings.js";

const BARE_U = {
  key: "u",
  mod: false,
  meta: false,
  control: false,
  alt: false,
  shift: false,
};

function listBinding(command: string, contexts: readonly string[]) {
  return {
    command,
    desktopOnly: false,
    shortcut: BARE_U,
    when: { all: ["mainSurface", ...contexts], none: ["editableFocus"] },
  };
}

describe("app keybinding schemas", () => {
  it("accept the thread-list commands under the sidebar list focus context", () => {
    const commands = [
      "thread.toggleRead",
      "thread.previousAttention",
      "thread.nextAttention",
      "sidebar.focus",
    ];

    expect(
      appDefaultKeybindingsSchema.safeParse(
        commands.map((command) => listBinding(command, ["sidebarListFocus"])),
      ).success,
    ).toBe(true);
    expect(
      appKeybindingOverridesSchema.safeParse(
        commands.map((command) => ({ command, shortcut: BARE_U })),
      ).success,
    ).toBe(true);
    expect(
      appDefaultKeybindingsSchema.safeParse([
        listBinding("thread.toggleRead", ["sidebarFocus"]),
      ]).success,
    ).toBe(false);
    expect(
      appKeybindingOverridesSchema.safeParse([
        { command: "thread.markRead", shortcut: BARE_U },
      ]).success,
    ).toBe(false);
  });
});
