// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installThreadLinkIntent,
  THREAD_LINK_DWELL_INTENT_MS,
  type ThreadLinkIntent,
} from "./thread-link-intent";

const intents: ThreadLinkIntent[] = [];
let uninstall: () => void = () => {};

function preventNavigation(event: Event): void {
  event.preventDefault();
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`Missing #${id}`);
  }
  return found;
}

function pointer(
  type: string,
  target: Element,
  init: PointerEventInit = {},
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      pointerType: "mouse",
      ...init,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <nav>
      <a id="thread-a" href="/projects/proj_1/threads/thr_a"><span id="thread-a-label">Thread A</span></a>
      <a id="thread-b" href="/threads/thr_b">Thread B</a>
      <a id="settings" href="/settings">Settings</a>
      <a id="external" href="https://example.com/projects/proj_1/threads/thr_x">External</a>
    </nav>`;
  intents.length = 0;
  uninstall = installThreadLinkIntent((intent) => intents.push(intent));
  document.addEventListener("click", preventNavigation);
});

afterEach(() => {
  document.removeEventListener("click", preventNavigation);
  uninstall();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("installThreadLinkIntent", () => {
  it("reports a hover only after the pointer dwells on a thread link", () => {
    pointer("pointerover", element("thread-a-label"));
    vi.advanceTimersByTime(THREAD_LINK_DWELL_INTENT_MS - 1);
    expect(intents).toEqual([]);

    vi.advanceTimersByTime(1);

    expect(intents).toEqual([{ input: "hover", threadId: "thr_a" }]);
  });

  it("drops a hover when the pointer leaves the link before the dwell ends", () => {
    pointer("pointerover", element("thread-a"));
    pointer("pointerout", element("thread-a"), {
      relatedTarget: element("settings"),
    });
    vi.advanceTimersByTime(THREAD_LINK_DWELL_INTENT_MS * 2);

    expect(intents).toEqual([]);
  });

  it("keeps the dwell while the pointer moves inside the link", () => {
    pointer("pointerover", element("thread-a"));
    pointer("pointerout", element("thread-a"), {
      relatedTarget: element("thread-a-label"),
    });
    pointer("pointerover", element("thread-a-label"));
    vi.advanceTimersByTime(THREAD_LINK_DWELL_INTENT_MS);

    expect(intents).toEqual([{ input: "hover", threadId: "thr_a" }]);
  });

  it("reports a primary press immediately and replaces the pending hover", () => {
    pointer("pointerover", element("thread-b"));
    pointer("pointerdown", element("thread-b"));
    vi.advanceTimersByTime(THREAD_LINK_DWELL_INTENT_MS * 2);

    expect(intents).toEqual([{ input: "press", threadId: "thr_b" }]);
  });

  it("ignores secondary presses, touch hovers, and links that are not threads", () => {
    pointer("pointerdown", element("thread-a"), { button: 2 });
    pointer("pointerover", element("thread-a"), { pointerType: "touch" });
    pointer("pointerdown", element("settings"));
    pointer("pointerdown", element("external"));
    pointer("pointerover", element("settings"));
    vi.advanceTimersByTime(THREAD_LINK_DWELL_INTENT_MS * 2);

    expect(intents).toEqual([]);
  });

  it("reports keyboard activation but not the click that follows a press", () => {
    element("thread-a").dispatchEvent(
      new MouseEvent("click", { bubbles: true, detail: 1 }),
    );
    element("thread-b").dispatchEvent(
      new MouseEvent("click", { bubbles: true, detail: 0 }),
    );

    expect(intents).toEqual([{ input: "click", threadId: "thr_b" }]);
  });
});
