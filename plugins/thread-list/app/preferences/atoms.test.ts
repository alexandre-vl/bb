import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { sidebarGroupThreadsByEnvironmentAtom } from "./atoms.js";
import { preferenceValueAtom } from "./preferences-sync.js";

describe("sidebarGroupThreadsByEnvironmentAtom", () => {
  it("groups worktrees automatically outside chronological mode", () => {
    const store = createStore();
    store.set(preferenceValueAtom("environmentGrouping"), "auto");
    store.set(preferenceValueAtom("organizationMode"), "project");
    expect(store.get(sidebarGroupThreadsByEnvironmentAtom)).toBe(true);

    store.set(preferenceValueAtom("organizationMode"), "chronological");
    expect(store.get(sidebarGroupThreadsByEnvironmentAtom)).toBe(false);
  });

  it("honours an explicit choice with attention-first ordering on", () => {
    const store = createStore();
    store.set(preferenceValueAtom("attentionFirst"), true);
    store.set(preferenceValueAtom("organizationMode"), "chronological");
    store.set(preferenceValueAtom("environmentGrouping"), true);
    expect(store.get(sidebarGroupThreadsByEnvironmentAtom)).toBe(true);
  });
});
