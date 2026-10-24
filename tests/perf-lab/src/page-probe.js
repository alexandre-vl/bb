(() => {
  if (window.__bbPerfLabProbe) return;
  const SAMPLE_INTERVAL_MS = 50;
  const probe = {
    generation: 0,
    loafs: [],
    running: false,
    samples: [],
    shifts: [],
    t0: 0,
  };
  window.__bbPerfLabProbe = probe;

  const roundRect = (rect) =>
    rect
      ? [
          Math.round(rect.x),
          Math.round(rect.y),
          Math.round(rect.width),
          Math.round(rect.height),
        ]
      : null;

  const describe = (node) => {
    if (!node) return null;
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element) return "#text";
    const attributes = [...element.attributes]
      .filter(
        (attribute) =>
          (attribute.name.startsWith("data-") &&
            !attribute.name.startsWith("data-state")) ||
          attribute.name === "aria-label",
      )
      .map((attribute) =>
        attribute.value
          ? `${attribute.name}=${attribute.value.slice(0, 28)}`
          : attribute.name,
      )
      .join(" ");
    const text = (element.textContent || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 48);
    return `${element.tagName.toLowerCase()}${attributes ? `[${attributes}]` : ""}${text ? ` "${text}"` : ""}`;
  };

  const observe = (type, onEntry) => {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) onEntry(entry);
      }).observe({ type, buffered: true });
    } catch {}
  };

  observe("layout-shift", (entry) => {
    probe.shifts.push({
      at: entry.startTime,
      hadRecentInput: entry.hadRecentInput,
      sources: (entry.sources || []).slice(0, 4).map((source) => ({
        current: roundRect(source.currentRect),
        node: describe(source.node),
        previous: roundRect(source.previousRect),
      })),
      value: entry.value,
    });
  });

  observe("long-animation-frame", (entry) => {
    probe.loafs.push({
      at: entry.startTime,
      blockingDuration: entry.blockingDuration,
      duration: entry.duration,
      renderStart: entry.renderStart,
      scripts: (entry.scripts || [])
        .slice()
        .sort((left, right) => right.duration - left.duration)
        .slice(0, 3)
        .map((script) => ({
          duration: Math.round(script.duration),
          function: script.sourceFunctionName || null,
          invoker: script.invoker || null,
          source: script.sourceURL
            ? script.sourceURL.replace(/^.*\//, "")
            : null,
        })),
    });
  });

  const isVisible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    if (
      rect.bottom <= 0 ||
      rect.top >= innerHeight ||
      rect.right <= 0 ||
      rect.left >= innerWidth
    ) {
      return false;
    }
    const style = getComputedStyle(element);
    return (
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity) > 0.05
    );
  };
  const textOf = (element) =>
    element ? (element.innerText || "").replace(/\s+/g, " ").trim() : null;
  const labelsIn = (element) =>
    element
      ? [
          ...element.querySelectorAll(
            "button[aria-label], a[aria-label], [role=button][aria-label]",
          ),
        ]
          .filter(isVisible)
          .map((control) =>
            control.getAttribute("aria-label").replace(/\s*\(.*\)$/, ""),
          )
      : [];
  const hash = (value) => {
    let result = 0;
    for (let index = 0; index < value.length; index += 1) {
      result = (Math.imul(result, 31) + value.charCodeAt(index)) | 0;
    }
    return (result >>> 0).toString(36);
  };
  const viewportText = (scroller) => {
    if (!scroller) return "";
    const scrollerRect = scroller.getBoundingClientRect();
    const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT);
    const parts = [];
    let node;
    let visited = 0;
    while ((node = walker.nextNode()) && visited < 4000) {
      visited += 1;
      const text = node.textContent.trim();
      if (!text) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest("[data-scroll-footer]")) continue;
      const rect = parent.getBoundingClientRect();
      if (
        rect.bottom <= scrollerRect.top ||
        rect.top >= scrollerRect.bottom ||
        rect.height === 0
      )
        continue;
      parts.push(text);
    }
    return parts.join(" ");
  };

  const sample = () => {
    const pane =
      document.querySelector("[data-split-pane-id]") || document.body;
    if (!pane) return { at: performance.now(), empty: true };
    const header = pane.querySelector("header");
    const scroller = pane.querySelector("[data-page-scroll-viewport]");
    const composer = pane.querySelector("[data-app-composer-role=primary]");
    const composerBox = composer
      ? composer.querySelector("[data-composer-box]")
      : null;
    const footer = composer
      ? composer.querySelector("[data-follow-up-composer-footer]")
      : null;
    const composerStack = composer
      ? [...composer.children].find(
          (child) => !child.hasAttribute("data-follow-up-composer-anchor"),
        )
      : null;
    const skeletons = [
      ...pane.querySelectorAll('[class*="animate-pulse"], [aria-busy="true"]'),
    ].filter(isVisible);
    const spinners = [
      ...document.querySelectorAll(
        '[class*="animate-spin"], [role="progressbar"]',
      ),
    ]
      .filter(isVisible)
      .map((element) => {
        const host =
          element.closest("button, [aria-label], [data-testid]") || element;
        const rect = element.getBoundingClientRect();
        return `${describe(host).slice(0, 70)}@${Math.round(rect.x)},${Math.round(rect.y)}`;
      });
    const visibleText = viewportText(scroller);
    const composerRect = composer ? composer.getBoundingClientRect() : null;
    const composerBoxRect = composerBox
      ? composerBox.getBoundingClientRect()
      : null;
    const panel =
      document.querySelector(
        "[data-testid=thread-secondary-panel-placeholder]",
      ) || document.querySelector("[data-testid=workspace-panel]");
    return {
      at: performance.now(),
      atBottom: scroller
        ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4
        : null,
      composerBoxHeight: composerBoxRect
        ? Math.round(composerBoxRect.height)
        : null,
      composerFooterControls: labelsIn(footer).join(" | "),
      composerFooterText: textOf(footer),
      composerRect: composerRect
        ? `${Math.round(composerRect.y)}+${Math.round(composerRect.height)}`
        : null,
      composerStackText: composerStack
        ? (textOf(composerStack) || "").slice(0, 160)
        : null,
      hasTimeline: Boolean(scroller),
      headerControls: labelsIn(header).join(" | "),
      headerText: textOf(header),
      panelWidth: panel
        ? Math.round(panel.getBoundingClientRect().width)
        : null,
      path: location.pathname,
      scrollHeight: scroller ? Math.round(scroller.scrollHeight) : null,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
      scrollToLatest: [
        ...pane.querySelectorAll('button[aria-label="Scroll to latest event"]'),
      ].some(isVisible),
      skeletons: skeletons.length,
      spinners: spinners.join(" || "),
      title: document.title,
      toc: Boolean(pane.querySelector("[data-thread-toc]")),
      viewportTextHash: hash(visibleText),
      viewportTextHead: visibleText.slice(0, 90),
    };
  };

  probe.start = (fromNavigation) => {
    probe.t0 = fromNavigation ? 0 : performance.now();
    probe.samples = [];
    probe.shiftsFrom = fromNavigation ? 0 : probe.shifts.length;
    probe.loafsFrom = fromNavigation ? 0 : probe.loafs.length;
    probe.running = true;
    probe.generation += 1;
    const generation = probe.generation;
    const tick = () => {
      if (!probe.running || generation !== probe.generation) return;
      try {
        probe.samples.push(sample());
      } catch (error) {
        probe.samples.push({ at: performance.now(), error: String(error) });
      }
      setTimeout(tick, SAMPLE_INTERVAL_MS);
    };
    tick();
    return performance.timeOrigin + probe.t0;
  };

  probe.collect = () => {
    probe.running = false;
    const t0 = probe.t0;
    const relative = (at) => Math.round((at - t0) * 10) / 10;
    const traceEntries = [
      ...performance.getEntriesByType("mark"),
      ...performance.getEntriesByType("measure"),
    ]
      .filter(
        (entry) => entry.name.startsWith("bb:") && entry.startTime >= t0 - 5000,
      )
      .map((entry) => ({
        at: relative(entry.startTime),
        detail: entry.detail ?? null,
        duration: Math.round(entry.duration * 10) / 10,
        kind: entry.entryType,
        name: entry.name,
      }));
    return {
      loafs: probe.loafs.slice(probe.loafsFrom).map((loaf) => ({
        ...loaf,
        at: relative(loaf.at),
        renderStart: relative(loaf.renderStart),
      })),
      samples: probe.samples.map((entry) => ({
        ...entry,
        at: relative(entry.at),
      })),
      shifts: probe.shifts
        .slice(probe.shiftsFrom)
        .map((shift) => ({ ...shift, at: relative(shift.at) })),
      t0Epoch: performance.timeOrigin + t0,
      traceEntries,
    };
  };

  probe.start(true);
})();
