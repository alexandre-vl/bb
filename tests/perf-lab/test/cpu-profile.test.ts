import { TraceMap } from "@jridgewell/trace-mapping";
import { describe, expect, it } from "vitest";
import {
  functionNameAt,
  shortenSourcePath,
  summarizeCpuProfile,
  type CpuProfile,
  type CpuProfileNode,
} from "../src/cpu-profile.js";

const APP_SCRIPT = "https://127.0.0.1:4000/assets/index-abc.js";
const VENDOR_SCRIPT = "https://127.0.0.1:4000/assets/vendor-def.js";

function node(
  id: number,
  functionName: string,
  url: string,
  columnNumber: number,
  children: number[] = [],
): CpuProfileNode {
  return {
    callFrame: {
      columnNumber,
      functionName,
      lineNumber: 0,
      scriptId: "1",
      url,
    },
    children,
    id,
  };
}

const profile: CpuProfile = {
  endTime: 1_010_000,
  nodes: [
    node(1, "(root)", "", -1, [2, 5, 6, 7]),
    node(2, "Xe", APP_SCRIPT, 20, [3]),
    node(3, "Qe", APP_SCRIPT, 40, [4, 8]),
    node(4, "Xe", APP_SCRIPT, 20),
    node(5, "(idle)", "", -1),
    node(6, "(garbage collector)", "", -1),
    node(7, "flush", VENDOR_SCRIPT, 4),
    node(8, "Ze", APP_SCRIPT, 60),
  ],
  samples: [5, 2, 4, 4, 3, 8, 6, 7, 5],
  startTime: 1_000_000,
  timeDeltas: [0, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
};

const REPO_ROOT = "/repo";

const appSourceMap = new TraceMap(
  {
    mappings: [
      [
        [0, 0, 0, 0],
        [20, 0, 10, 2, 0],
        [40, 0, 30, 4, 1],
        [59, 0, 50, 6, 2],
        [60, 0, 50, 13],
      ],
    ],
    names: ["renderTimeline", "measureRows", "commitRows"],
    sources: ["../../src/components/Timeline.tsx"],
    version: 3,
  },
  "file:///repo/apps/app/dist/assets/index-abc.js.map",
);

describe("summarizeCpuProfile", () => {
  const [frame, whole] = summarizeCpuProfile(profile, {
    limit: 10,
    repoRoot: REPO_ROOT,
    sourceMaps: new Map([[APP_SCRIPT, appSourceMap]]),
    startOffsetMs: -1,
    windows: [
      { from: 0, label: "frame", to: 5 },
      { from: 0, label: "whole", to: 10 },
    ],
  });

  it("attributes each sample's interval to its function, inside the window only", () => {
    expect(frame?.sampledMs).toBe(5);
    expect(
      frame?.bySelf.map((entry) => [entry.name, entry.location, entry.selfMs]),
    ).toEqual([
      ["renderTimeline", "apps/app/src/components/Timeline.tsx:11", 3],
      ["measureRows", "apps/app/src/components/Timeline.tsx:31", 1],
      ["commitRows", "apps/app/src/components/Timeline.tsx:51", 1],
    ]);
    expect(frame?.bySource).toEqual([
      { selfMs: 5, source: "apps/app/src/components/Timeline.tsx" },
    ]);
  });

  it("counts a recursive function once per sample in its total time", () => {
    expect(
      frame?.byInclusive.map((entry) => [entry.name, entry.totalMs]),
    ).toEqual([
      ["renderTimeline", 5],
      ["measureRows", 4],
      ["commitRows", 1],
    ]);
  });

  it("keeps idle, GC and unmapped scripts, gives the last sample the time to the profile's end", () => {
    expect(whole?.sampledMs).toBe(9);
    expect(
      whole?.bySelf.map((entry) => [entry.name, entry.location, entry.selfMs]),
    ).toEqual([
      ["renderTimeline", "apps/app/src/components/Timeline.tsx:11", 3],
      ["(idle)", "", 2],
      ["measureRows", "apps/app/src/components/Timeline.tsx:31", 1],
      ["commitRows", "apps/app/src/components/Timeline.tsx:51", 1],
      ["(garbage collector)", "", 1],
      ["flush", "assets/vendor-def.js:1:5", 1],
    ]);
    expect(whole?.byInclusive.map((entry) => entry.name)).not.toContain(
      "(idle)",
    );
  });
});

describe("shortenSourcePath", () => {
  it("keeps the package path for dependencies and the repo path for sources", () => {
    expect(
      shortenSourcePath(
        "file:///repo/node_modules/.pnpm/react-dom@19.2.0/node_modules/react-dom/cjs/react-dom-client.production.js",
        REPO_ROOT,
      ),
    ).toBe("react-dom/cjs/react-dom-client.production.js");
    expect(
      shortenSourcePath(
        "file:///repo/packages/thread-view/src/rows.ts",
        REPO_ROOT,
      ),
    ).toBe("packages/thread-view/src/rows.ts");
    expect(shortenSourcePath("file:///elsewhere/a.ts", REPO_ROOT)).toBe(
      "/elsewhere/a.ts",
    );
    expect(
      shortenSourcePath(
        "http://127.0.0.1:3000/src/views/ThreadDetailView.tsx",
        REPO_ROOT,
      ),
    ).toBe("src/views/ThreadDetailView.tsx");
    expect(
      shortenSourcePath(
        "http://127.0.0.1:3000/repo/apps/app/src/lib/sdk.ts",
        REPO_ROOT,
      ),
    ).toBe("apps/app/src/lib/sdk.ts");
  });
});

describe("anonymous functions", () => {
  it("are not named after the identifier their first mapping points at", () => {
    const [window] = summarizeCpuProfile(
      {
        endTime: 2_000,
        nodes: [node(1, "(root)", "", -1, [2]), node(2, "", APP_SCRIPT, 80)],
        samples: [2],
        startTime: 1_000,
        timeDeltas: [0],
      },
      {
        limit: 10,
        repoRoot: REPO_ROOT,
        sourceMaps: new Map([
          [
            APP_SCRIPT,
            new TraceMap(
              {
                mappings: [[[80, 0, 389, 4, 0]]],
                names: ["node"],
                sources: ["../../src/components/TimelineWindowedItems.tsx"],
                version: 3,
              },
              "file:///repo/apps/app/dist/assets/index-abc.js.map",
            ),
          ],
        ]),
        startOffsetMs: 0,
        windows: [{ from: 0, label: "all", to: 10 }],
      },
    );
    expect(window?.bySelf).toEqual([
      {
        location: "apps/app/src/components/TimelineWindowedItems.tsx:390",
        name: "(anonymous)",
        selfMs: 1,
        totalMs: 1,
      },
    ]);
  });
});

describe("functionNameAt", () => {
  it("reads the name of the function that starts at a mapped position", () => {
    expect(functionNameAt("function performWorkOnRoot(root, lanes) {", 9)).toBe(
      "performWorkOnRoot",
    );
    expect(
      functionNameAt("function mergeProps(slotProps, childProps) {", 0),
    ).toBe("mergeProps");
    expect(functionNameAt("export async function loadThread(id) {", 7)).toBe(
      "loadThread",
    );
    expect(functionNameAt("  private apply(", 10)).toBe("apply");
    expect(functionNameAt("    const Provider = (props) => {", 21)).toBe(
      "Provider",
    );
  });

  it("leaves inline callbacks unnamed instead of naming them after a parameter or the call", () => {
    expect(functionNameAt("    (node: HTMLDivElement | null) => {", 4)).toBe(
      null,
    );
    expect(functionNameAt("  useCallback((node) => {", 14)).toBe(null);
    expect(functionNameAt("  items.map(item => item.id)", 12)).toBe(null);
  });
});
