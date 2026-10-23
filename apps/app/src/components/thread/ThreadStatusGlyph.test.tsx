// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginSidebarThreadIndicator } from "@get-bb/plugin-sdk";
import { ThreadStatusGlyph, resolveThreadStatus } from "./ThreadStatusGlyph";

afterEach(() => {
  cleanup();
});

const INDICATOR_GLYPHS: readonly (readonly [
  PluginSidebarThreadIndicator,
  string,
  string,
  string,
])[] = [
  [
    "waiting-for-input",
    "Thread needs user input",
    "needs-you",
    "text-attention-text",
  ],
  ["unread-error", "Unread thread failed", "failed", "text-destructive-text"],
  [
    "queued-failed",
    "Queued message failed to send",
    "failed",
    "text-destructive-text",
  ],
  [
    "unread-success",
    "Unread thread succeeded",
    "new",
    "text-sidebar-foreground",
  ],
  ["plan-mode", "Plan mode active", "running", "text-sidebar-glyph-faint"],
  ["goal", "Goal active", "running", "text-sidebar-glyph-faint"],
  ["runtime", "Thread working", "running", "text-sidebar-glyph-faint"],
  ["workflow", "Workflow running", "running", "text-sidebar-glyph-faint"],
  [
    "background-agent",
    "Background agent running",
    "running",
    "text-sidebar-glyph-faint",
  ],
  [
    "background-command",
    "Background command running",
    "running",
    "text-sidebar-glyph-faint",
  ],
  [
    "working-draft",
    "Thread working with unsubmitted draft",
    "running",
    "text-sidebar-glyph-faint",
  ],
  [
    "queued-waiting",
    "Thread has a message waiting to send",
    "queued",
    "text-sidebar-glyph-faint",
  ],
  [
    "draft",
    "Thread has unsubmitted draft",
    "draft",
    "text-sidebar-glyph-faint",
  ],
];

const ROW_STATUS = { icon: "AiContentGenerator01", label: "Improving" };

function classesOf(element: Element): string[] {
  return Array.from(element.classList);
}

describe("ThreadStatusGlyph", () => {
  it.each(INDICATOR_GLYPHS)(
    "draws %s as the labelled %s glyph",
    (indicator, label, shape, colorClass) => {
      render(<ThreadStatusGlyph indicator={indicator} />);

      const glyph = screen.getByLabelText(label);
      expect(glyph.getAttribute("data-status-glyph")).toBe(shape);
      expect(classesOf(glyph)).toEqual(
        expect.arrayContaining([colorClass, "size-4"]),
      );
    },
  );

  it("draws nothing for none", () => {
    const { container } = render(<ThreadStatusGlyph indicator="none" />);

    expect(container.firstChild).toBeNull();
  });

  it("spins only the running glyph, and holds it still under reduced motion", () => {
    const { container } = render(
      <>
        {INDICATOR_GLYPHS.map(([indicator]) => (
          <ThreadStatusGlyph key={indicator} indicator={indicator} />
        ))}
        <ThreadStatusGlyph
          indicator="none"
          rowStatus={{ ...ROW_STATUS, tone: "running" }}
        />
      </>,
    );

    const glyphs = [...container.querySelectorAll("[data-status-glyph]")];
    expect(glyphs).toHaveLength(INDICATOR_GLYPHS.length);
    for (const glyph of glyphs) {
      const running = glyph.getAttribute("data-status-glyph") === "running";
      expect(glyph.classList.contains("animate-spin")).toBe(running);
      expect(glyph.classList.contains("motion-reduce:animate-none")).toBe(
        running,
      );
    }
    expect(container.querySelectorAll(".animate-spin").length).toBeGreaterThan(
      0,
    );
  });

  it("knocks the question mark out of its own needs-you disc", () => {
    const { container } = render(
      <>
        <ThreadStatusGlyph indicator="waiting-for-input" />
        <ThreadStatusGlyph indicator="waiting-for-input" />
      </>,
    );

    const maskIds = Array.from(container.querySelectorAll("svg")).map(
      (glyph) => {
        const maskId = glyph.querySelector("mask")?.id ?? "";
        expect(glyph.querySelector("circle[mask]")?.getAttribute("mask")).toBe(
          `url(#${maskId})`,
        );
        return maskId;
      },
    );
    expect(new Set(maskIds).size).toBe(2);
    expect(maskIds).not.toContain("");
  });

  it("scales every glyph to 14 px when compact", () => {
    const { container } = render(
      <>
        {INDICATOR_GLYPHS.map(([indicator]) => (
          <ThreadStatusGlyph
            key={indicator}
            indicator={indicator}
            size="compact"
          />
        ))}
      </>,
    );

    for (const glyph of container.querySelectorAll("[data-status-glyph]")) {
      expect(classesOf(glyph)).toContain("size-3.5");
      expect(classesOf(glyph)).not.toContain("size-4");
    }
  });

  it("hides the idle draft glyph from assistive technology on request", () => {
    const { container } = render(
      <ThreadStatusGlyph indicator="draft" hideIdleDraftLabel />,
    );

    const draft = container.querySelector('[data-status-glyph="draft"]');
    expect(draft?.getAttribute("aria-hidden")).toBe("true");
    expect(draft?.hasAttribute("aria-label")).toBe(false);
    expect(screen.queryByLabelText("Thread has unsubmitted draft")).toBeNull();
  });

  it("draws the archive glyph for archived threads", () => {
    render(<ThreadStatusGlyph indicator="runtime" archived />);

    expect(
      screen.getByLabelText("Archived thread").getAttribute("data-icon"),
    ).toBe("Archive");
  });

  it.each([
    ["running", "text-success"],
    ["success", "text-success-foreground"],
    ["error", "text-destructive"],
    ["default", "text-muted-foreground"],
  ] as const)("draws a %s row status with its tone", (tone, className) => {
    render(
      <ThreadStatusGlyph
        indicator="draft"
        rowStatus={{ ...ROW_STATUS, tone }}
      />,
    );

    const status = screen.getByLabelText("Improving");
    expect(status.getAttribute("data-icon")).toBe("AiContentGenerator01");
    expect(classesOf(status)).toContain(className);
    expect(screen.queryByLabelText("Thread has unsubmitted draft")).toBeNull();
  });

  it.each(["none", "draft", "queued-waiting"] as const)(
    "shows a row status over %s, rung 1 or lower",
    (indicator) => {
      render(
        <ThreadStatusGlyph indicator={indicator} rowStatus={ROW_STATUS} />,
      );

      expect(screen.getByLabelText("Improving")).not.toBeNull();
      expect(document.querySelector("[data-status-glyph]")).toBeNull();
    },
  );

  it.each(
    INDICATOR_GLYPHS.filter(
      ([indicator]) => indicator !== "draft" && indicator !== "queued-waiting",
    ),
  )("keeps %s, rung 2 or higher, ahead of a row status", (indicator, label) => {
    render(<ThreadStatusGlyph indicator={indicator} rowStatus={ROW_STATUS} />);

    expect(screen.getByLabelText(label)).not.toBeNull();
    expect(screen.queryByLabelText("Improving")).toBeNull();
  });

  it("hides a row status on an archived thread", () => {
    render(
      <ThreadStatusGlyph indicator="none" rowStatus={ROW_STATUS} archived />,
    );

    expect(screen.getByLabelText("Archived thread")).not.toBeNull();
    expect(screen.queryByLabelText("Improving")).toBeNull();
  });
});

describe("resolveThreadStatus", () => {
  it("labels the row with what the glyph draws", () => {
    expect(resolveThreadStatus("draft", ROW_STATUS).accessibleLabel).toBe(
      "Improving",
    );
    expect(resolveThreadStatus("unread-success", ROW_STATUS)).toEqual({
      accessibleLabel: "Unread thread succeeded",
      indicatorKind: "unread-success",
      rowStatusIsVisible: false,
    });
    expect(resolveThreadStatus("none").accessibleLabel).toBeNull();
    expect(resolveThreadStatus("runtime", null, true).accessibleLabel).toBe(
      "Archived thread",
    );
  });
});
