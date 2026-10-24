import { parseThreadRoutePathname } from "@bb/client-core";

export const THREAD_LINK_DWELL_INTENT_MS = 80;

export type ThreadLinkIntentInput = "click" | "focus" | "hover" | "press";

export interface ThreadLinkIntent {
  input: ThreadLinkIntentInput;
  threadId: string;
}

export type ThreadLinkIntentListener = (intent: ThreadLinkIntent) => void;

interface PendingDwell {
  anchor: HTMLAnchorElement;
  input: "focus" | "hover";
  timeout: number;
}

function findThreadLink(
  target: EventTarget | null,
): { anchor: HTMLAnchorElement; threadId: string } | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) {
    return null;
  }
  const threadId = parseThreadRoutePathname(url.pathname);
  return threadId === null ? null : { anchor, threadId };
}

export function installThreadLinkIntent(
  listener: ThreadLinkIntentListener,
): () => void {
  let dwell: PendingDwell | null = null;

  const cancelDwell = () => {
    if (dwell !== null) {
      window.clearTimeout(dwell.timeout);
      dwell = null;
    }
  };

  const startDwell = (
    input: "focus" | "hover",
    link: { anchor: HTMLAnchorElement; threadId: string },
  ) => {
    if (dwell?.anchor === link.anchor) {
      return;
    }
    cancelDwell();
    dwell = {
      anchor: link.anchor,
      input,
      timeout: window.setTimeout(() => {
        dwell = null;
        listener({ input, threadId: link.threadId });
      }, THREAD_LINK_DWELL_INTENT_MS),
    };
  };

  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      return;
    }
    const link = findThreadLink(event.target);
    if (link !== null) {
      startDwell("hover", link);
    }
  };

  const onPointerOut = (event: PointerEvent) => {
    if (
      dwell?.input === "hover" &&
      !(
        event.relatedTarget instanceof Node &&
        dwell.anchor.contains(event.relatedTarget)
      )
    ) {
      cancelDwell();
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.pointerType === "touch") {
      return;
    }
    const link = findThreadLink(event.target);
    if (link !== null) {
      cancelDwell();
      listener({ input: "press", threadId: link.threadId });
    }
  };

  const onFocusIn = (event: FocusEvent) => {
    const link = findThreadLink(event.target);
    if (link !== null && link.anchor.matches(":focus-visible")) {
      startDwell("focus", link);
    }
  };

  const onFocusOut = () => {
    if (dwell?.input === "focus") {
      cancelDwell();
    }
  };

  const onClick = (event: MouseEvent) => {
    if (event.detail > 0) {
      return;
    }
    const link = findThreadLink(event.target);
    if (link !== null) {
      cancelDwell();
      listener({ input: "click", threadId: link.threadId });
    }
  };

  const options = { capture: true, passive: true } as const;
  document.addEventListener("pointerover", onPointerOver, options);
  document.addEventListener("pointerout", onPointerOut, options);
  document.addEventListener("pointerdown", onPointerDown, options);
  document.addEventListener("focusin", onFocusIn, options);
  document.addEventListener("focusout", onFocusOut, options);
  document.addEventListener("click", onClick, options);
  return () => {
    cancelDwell();
    document.removeEventListener("pointerover", onPointerOver, options);
    document.removeEventListener("pointerout", onPointerOut, options);
    document.removeEventListener("pointerdown", onPointerDown, options);
    document.removeEventListener("focusin", onFocusIn, options);
    document.removeEventListener("focusout", onFocusOut, options);
    document.removeEventListener("click", onClick, options);
  };
}
