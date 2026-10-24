import { describe, expect, it } from "vitest";
import {
  analyzeRecording,
  detectVisibleChanges,
  findContentAt,
  summarizeMetric,
  summarizeRuns,
} from "../src/analysis.js";
import type { ProbeSample, Recording, TraceEntry } from "../src/types.js";

const OLD_PATH = "/threads/thr_old";
const NEW_PATH = "/threads/thr_new";

function sample(at: number, overrides: Partial<ProbeSample> = {}): ProbeSample {
  return {
    at,
    atBottom: true,
    composerBoxHeight: 120,
    composerFooterControls: "Model | Permissions",
    composerFooterText: "Opus 5.5 Medium",
    composerRect: "700+180",
    composerStackText: "",
    hasTimeline: true,
    headerControls: "Open",
    headerText: "Old thread",
    panelWidth: null,
    path: OLD_PATH,
    scrollHeight: 4000,
    scrollTop: 3100,
    scrollToLatest: false,
    skeletons: 0,
    spinners: "",
    title: "Old thread",
    toc: false,
    viewportTextHash: "old",
    viewportTextHead: "old transcript",
    ...overrides,
  };
}

function recording(overrides: Partial<Recording>): Recording {
  return {
    cpuProfileStartMs: null,
    frames: [],
    loafs: [],
    network: [],
    samples: [],
    shifts: [],
    step: "click:secondary",
    targetPath: NEW_PATH,
    targetThreadId: "thr_new",
    traceEntries: [],
    websocketFrames: [],
    ...overrides,
  };
}

function mark(at: number, name: string, threadId: string): TraceEntry {
  return { at, detail: { threadId }, duration: 0, kind: "mark", name };
}

describe("findContentAt", () => {
  it("waits for the target transcript instead of the previous thread's text that lingers after navigation", () => {
    const samples = [
      sample(0),
      sample(50, { path: NEW_PATH }),
      sample(100, {
        path: NEW_PATH,
        viewportTextHash: "empty",
        viewportTextHead: "",
      }),
      sample(150, {
        path: NEW_PATH,
        viewportTextHash: "new",
        viewportTextHead: "new transcript",
      }),
    ];

    expect(findContentAt(samples, NEW_PATH)).toBe(150);
  });

  it("accepts the first non-empty transcript when the action stays on the same thread", () => {
    const samples = [
      sample(0, { viewportTextHash: "empty", viewportTextHead: "" }),
      sample(50),
    ];

    expect(findContentAt(samples, OLD_PATH)).toBe(50);
  });

  it("reports no content when the target never renders a transcript", () => {
    const samples = [
      sample(0),
      sample(50, { path: NEW_PATH, viewportTextHead: "" }),
    ];

    expect(findContentAt(samples, NEW_PATH)).toBeNull();
  });
});

describe("detectVisibleChanges", () => {
  it("merges a burst of scroll corrections but reports every chrome pop-in separately", () => {
    const changes = detectVisibleChanges([
      sample(0),
      sample(50, { scrollTop: 3000 }),
      sample(100, { scrollTop: 2900 }),
      sample(150, {
        composerFooterText: "Claude-Opus-5 Medium",
        scrollTop: 2800,
      }),
      sample(400, { composerFooterText: "Opus 5.5 Medium", scrollTop: 2700 }),
    ]);

    expect(
      changes.map(({ at, count, field, until }) => ({
        at,
        count,
        field,
        until,
      })),
    ).toEqual([
      { at: 50, count: 3, field: "scroll", until: 150 },
      { at: 150, count: 1, field: "composerFooterText", until: 150 },
      { at: 400, count: 1, field: "composerFooterText", until: 400 },
      { at: 400, count: 1, field: "scroll", until: 400 },
    ]);
  });
});

describe("analyzeRecording", () => {
  it("counts only chrome changes after the transcript appeared as pop-ins", () => {
    const analysis = analyzeRecording(
      recording({
        samples: [
          sample(0),
          sample(50, { headerControls: "", path: NEW_PATH }),
          sample(200, {
            headerControls: "",
            path: NEW_PATH,
            viewportTextHash: "new",
            viewportTextHead: "new transcript",
          }),
          sample(300, {
            headerControls: "Open",
            path: NEW_PATH,
            viewportTextHash: "new",
            viewportTextHead: "new transcript",
          }),
          sample(450, {
            composerFooterControls: "Model",
            headerControls: "Open",
            path: NEW_PATH,
            viewportTextHash: "new",
            viewportTextHead: "new transcript",
          }),
        ],
      }),
    );

    expect(analysis.contentAt).toBe(200);
    expect(analysis.chromeChangesAfterContent).toBe(2);
    expect(analysis.chromeUpdatesAfterContent).toBe(2);
    expect(analysis.settledAt).toBe(450);
  });

  it("counts chrome changes that land in the same frame as one update", () => {
    const content = {
      path: NEW_PATH,
      viewportTextHash: "new",
      viewportTextHead: "new transcript",
    };
    const analysis = analyzeRecording(
      recording({
        samples: [
          sample(0),
          sample(200, {
            ...content,
            composerFooterText: "Project",
            skeletons: 1,
          }),
          sample(400, {
            ...content,
            composerFooterText: "Project main",
            skeletons: 0,
          }),
        ],
      }),
    );

    expect(analysis.chromeChangesAfterContent).toBe(2);
    expect(analysis.chromeUpdatesAfterContent).toBe(1);
  });

  it("keeps only the target thread's first milestone at or after the action", () => {
    const analysis = analyzeRecording(
      recording({
        traceEntries: [
          mark(-20, "bb:thread-open:route", "thr_new"),
          mark(30, "bb:thread-open:route", "thr_new"),
          mark(35, "bb:thread-open:route", "thr_old"),
          mark(90, "bb:thread-open:timeline", "thr_new"),
          mark(140, "bb:thread-open:timeline", "thr_new"),
        ],
      }),
    );

    expect(analysis.milestones).toEqual({ route: 30, timeline: 90 });
  });

  it("keeps a prefetch that started before the action", () => {
    const analysis = analyzeRecording(
      recording({
        traceEntries: [
          mark(-250, "bb:thread-open:prefetch", "thr_new"),
          mark(-240, "bb:thread-open:route", "thr_new"),
          mark(20, "bb:thread-open:route", "thr_new"),
        ],
      }),
    );

    expect(analysis.milestones).toEqual({ prefetch: -250, route: 20 });
  });

  it("ignores input-driven layout shifts and non-API requests", () => {
    const analysis = analyzeRecording(
      recording({
        network: [
          {
            bytes: 1000,
            end: 180,
            method: "GET",
            path: "/api/v1/threads/thr_new",
            resourceType: "Fetch",
            start: 20,
            status: 200,
          },
          {
            bytes: 50_000,
            end: 400,
            method: "GET",
            path: "/assets/chunk.js",
            resourceType: "Script",
            start: 30,
            status: 200,
          },
        ],
        shifts: [
          { at: 100, hadRecentInput: false, sources: [], value: 0.05 },
          { at: 120, hadRecentInput: true, sources: [], value: 0.4 },
        ],
      }),
    );

    expect(analysis.apiRequests).toBe(1);
    expect(analysis.apiBytes).toBe(1000);
    expect(analysis.lastApiResponseAt).toBe(180);
    expect(analysis.layoutShiftScore).toBeCloseTo(0.05);
  });

  it("counts API responses the proxy or server failed", () => {
    const analysis = analyzeRecording(
      recording({
        network: [
          {
            bytes: 0,
            end: 90,
            method: "GET",
            path: "/api/v1/threads/thr_new",
            resourceType: "Fetch",
            start: 20,
            status: 502,
          },
          {
            bytes: 10,
            end: 95,
            method: "GET",
            path: "/api/v1/threads/thr_new/timeline",
            resourceType: "Fetch",
            start: 20,
            status: 404,
          },
          {
            bytes: 0,
            end: 99,
            method: "GET",
            path: "/assets/chunk.js",
            resourceType: "Script",
            start: 30,
            status: 503,
          },
        ],
      }),
    );

    expect(analysis.serverErrors).toBe(1);
  });
});

describe("summaries", () => {
  it("uses nearest-rank percentiles", () => {
    expect(summarizeMetric([300, 100, 200, 400])).toEqual({
      max: 400,
      median: 200,
      min: 100,
      p90: 400,
      runs: 4,
    });
  });

  it("summarizes a milestone only over the runs that reached it", () => {
    const reached = analyzeRecording(
      recording({
        traceEntries: [mark(80, "bb:thread-open:timeline", "thr_new")],
      }),
    );
    const missed = analyzeRecording(recording({}));

    const summary = summarizeRuns([reached, missed]);

    expect(summary["milestone.timeline"]).toMatchObject({
      median: 80,
      runs: 1,
    });
    expect(summary["settledAt"]).toMatchObject({ runs: 2 });
  });
});
