import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GREATEST_LOWER_BOUND,
  originalPositionFor,
  sourceContentFor,
  TraceMap,
} from "@jridgewell/trace-mapping";

export interface CpuProfileCallFrame {
  columnNumber: number;
  functionName: string;
  lineNumber: number;
  scriptId: string;
  url: string;
}

export interface CpuProfileNode {
  callFrame: CpuProfileCallFrame;
  children?: number[];
  id: number;
}

export interface CpuProfile {
  endTime: number;
  nodes: CpuProfileNode[];
  samples?: number[];
  startTime: number;
  timeDeltas?: number[];
}

export interface ProfileWindow {
  from: number;
  label: string;
  to: number;
}

export interface ProfiledFunction {
  location: string;
  name: string;
  selfMs: number;
  totalMs: number;
}

export interface ProfiledSource {
  selfMs: number;
  source: string;
}

export interface CpuProfileWindowSummary {
  byInclusive: ProfiledFunction[];
  bySelf: ProfiledFunction[];
  bySource: ProfiledSource[];
  from: number;
  label: string;
  sampledMs: number;
  to: number;
}

export interface SummarizeCpuProfileOptions {
  limit: number;
  repoRoot: string;
  sourceMaps: ReadonlyMap<string, TraceMap>;
  startOffsetMs: number;
  windows: readonly ProfileWindow[];
}

interface ResolvedFrame {
  key: string;
  location: string;
  name: string;
  source: string;
}

export function parseSourceMap(text: string, mapUrl: string): TraceMap {
  return new TraceMap(text, mapUrl);
}

export function shortenSourcePath(source: string, repoRoot: string): string {
  const modules = source.lastIndexOf("node_modules/");
  if (modules !== -1) {
    return source.slice(modules + "node_modules/".length);
  }
  if (source.startsWith("file:")) {
    return pathInRepo(fileURLToPath(source), repoRoot);
  }
  if (/^https?:/u.test(source)) {
    const path = decodeURIComponent(new URL(source).pathname);
    return path.startsWith(`${repoRoot}/`)
      ? pathInRepo(path, repoRoot)
      : path.replace(/^\//u, "");
  }
  return source.replace(/^(\.\.?\/)+/u, "");
}

function pathInRepo(path: string, repoRoot: string): string {
  const inRepo = relative(repoRoot, path);
  return inRepo.startsWith("..") ? path : inRepo.split(sep).join("/");
}

function scriptPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//u, "");
  } catch {
    return url;
  }
}

const sourceLinesByMap = new WeakMap<TraceMap, Map<string, string[] | null>>();

function originalLine(
  map: TraceMap,
  source: string,
  line: number,
): string | null {
  let sources = sourceLinesByMap.get(map);
  if (sources === undefined) {
    sources = new Map();
    sourceLinesByMap.set(map, sources);
  }
  let lines = sources.get(source);
  if (lines === undefined) {
    lines = sourceContentFor(map, source)?.split("\n") ?? null;
    sources.set(source, lines);
  }
  return lines?.[line - 1] ?? null;
}

export function functionNameAt(text: string, column: number): string | null {
  const after = text.slice(column);
  const before = text.slice(0, column);
  const declared = /^(?:async\s+)?function\s*\*?\s*([\w$]+)/u.exec(after);
  if (declared !== null) {
    return declared[1] ?? null;
  }
  const named = /^([\w$#]+)\s*[(<]/u.exec(after);
  if (named !== null && /(?:^|[\s{;,(*])$/u.test(before)) {
    return named[1] ?? null;
  }
  if (after.startsWith("(")) {
    const method = /([\w$#]+)\s*$/u.exec(before);
    if (method !== null) {
      return method[1] ?? null;
    }
    const assigned = /([\w$]+)\s*[:=]\s*(?:async\s*)?$/u.exec(before);
    if (assigned !== null) {
      return assigned[1] ?? null;
    }
  }
  return null;
}

function resolveFrame(
  frame: CpuProfileCallFrame,
  sourceMaps: ReadonlyMap<string, TraceMap>,
  repoRoot: string,
): ResolvedFrame {
  const compiledName = frame.functionName || "(anonymous)";
  if (frame.url === "") {
    return {
      key: compiledName,
      location: "",
      name: compiledName,
      source: compiledName.startsWith("(") ? compiledName : "(native)",
    };
  }
  const map = sourceMaps.get(frame.url);
  if (map !== undefined) {
    const position = originalPositionFor(map, {
      bias: GREATEST_LOWER_BOUND,
      column: frame.columnNumber,
      line: frame.lineNumber + 1,
    });
    if (position.source !== null) {
      const preceding =
        position.name === null && frame.columnNumber > 0
          ? originalPositionFor(map, {
              bias: GREATEST_LOWER_BOUND,
              column: frame.columnNumber - 1,
              line: frame.lineNumber + 1,
            })
          : null;
      const source = shortenSourcePath(position.source, repoRoot);
      const text = originalLine(map, position.source, position.line);
      const name =
        frame.functionName === ""
          ? compiledName
          : ((text === null ? null : functionNameAt(text, position.column)) ??
            position.name ??
            preceding?.name ??
            compiledName);
      const location = `${source}:${position.line}`;
      return { key: `${name} ${location}`, location, name, source };
    }
  }
  const script = scriptPath(frame.url);
  const location = `${script}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
  return {
    key: `${compiledName} ${location}`,
    location,
    name: compiledName,
    source: script,
  };
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

export function summarizeCpuProfile(
  profile: CpuProfile,
  options: SummarizeCpuProfileOptions,
): CpuProfileWindowSummary[] {
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  const parents = new Map<number, number>();
  const frames = new Map<number, ResolvedFrame>();
  for (const node of profile.nodes) {
    frames.set(
      node.id,
      resolveFrame(node.callFrame, options.sourceMaps, options.repoRoot),
    );
    for (const child of node.children ?? []) {
      parents.set(child, node.id);
    }
  }
  const timestamps: number[] = [];
  let timestamp = profile.startTime;
  for (const delta of deltas.slice(0, samples.length)) {
    timestamp += delta;
    timestamps.push(timestamp);
  }
  const relativeMs = (micros: number) =>
    options.startOffsetMs + (micros - profile.startTime) / 1000;
  return options.windows.map((window) => {
    const self = new Map<string, { frame: ResolvedFrame; ms: number }>();
    const inclusive = new Map<string, number>();
    const bySource = new Map<string, number>();
    let sampledMs = 0;
    for (const [index, nodeId] of samples.entries()) {
      const at = timestamps[index];
      if (at === undefined) {
        continue;
      }
      const relative = relativeMs(at);
      if (relative < window.from || relative >= window.to) {
        continue;
      }
      const next = timestamps[index + 1] ?? profile.endTime;
      const durationMs = Math.max(0, next - at) / 1000;
      const frame = frames.get(nodeId);
      if (frame === undefined) {
        continue;
      }
      sampledMs += durationMs;
      const entry = self.get(frame.key) ?? { frame, ms: 0 };
      entry.ms += durationMs;
      self.set(frame.key, entry);
      bySource.set(
        frame.source,
        (bySource.get(frame.source) ?? 0) + durationMs,
      );
      const seen = new Set<string>();
      for (
        let current: number | undefined = nodeId;
        current !== undefined;
        current = parents.get(current)
      ) {
        const ancestor = frames.get(current);
        if (ancestor === undefined || seen.has(ancestor.key)) {
          continue;
        }
        seen.add(ancestor.key);
        inclusive.set(
          ancestor.key,
          (inclusive.get(ancestor.key) ?? 0) + durationMs,
        );
      }
    }
    const describe = (key: string): ProfiledFunction => {
      const frame =
        self.get(key)?.frame ??
        [...frames.values()].find((candidate) => candidate.key === key);
      return {
        location: frame?.location ?? "",
        name: frame?.name ?? key,
        selfMs: roundMs(self.get(key)?.ms ?? 0),
        totalMs: roundMs(inclusive.get(key) ?? 0),
      };
    };
    const isScript = (key: string) => {
      const frame = self.get(key)?.frame;
      return frame === undefined || frame.location !== "";
    };
    return {
      byInclusive: [...inclusive.entries()]
        .filter(([key]) => key !== "(root)" && isScript(key))
        .sort((left, right) => right[1] - left[1])
        .slice(0, options.limit)
        .map(([key]) => describe(key)),
      bySelf: [...self.entries()]
        .sort((left, right) => right[1].ms - left[1].ms)
        .slice(0, options.limit)
        .map(([key]) => describe(key)),
      bySource: [...bySource.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, options.limit)
        .map(([source, ms]) => ({ selfMs: roundMs(ms), source })),
      from: window.from,
      label: window.label,
      sampledMs: roundMs(sampledMs),
      to: window.to,
    };
  });
}

export function collectScriptUrls(profile: CpuProfile): string[] {
  return [
    ...new Set(
      profile.nodes
        .map((node) => node.callFrame.url)
        .filter((url) => url.startsWith("http")),
    ),
  ];
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|");
}

export function renderCpuProfileMarkdown(
  title: string,
  summaries: readonly CpuProfileWindowSummary[],
  resolvedScripts: number,
  totalScripts: number,
): string {
  const lines = [
    `# CPU profile — ${title}`,
    "",
    `Source maps resolved ${resolvedScripts} of ${totalScripts} scripts. Times are milliseconds from the measured action. Open \`cpu-profile.cpuprofile\` in Chrome DevTools (Performance › Load profile) or https://www.speedscope.app for the call tree.`,
  ];
  for (const summary of summaries) {
    lines.push(
      "",
      `## ${summary.label}: ${Math.round(summary.from)}–${Math.round(summary.to)} ms, ${summary.sampledMs} ms sampled`,
      "",
      "Self time by source:",
      "",
      "| self ms | source |",
      "| ---: | --- |",
      ...summary.bySource.map(
        (entry) => `| ${entry.selfMs} | ${escapeCell(entry.source)} |`,
      ),
      "",
      "Functions by self time:",
      "",
      "| self ms | total ms | function | location |",
      "| ---: | ---: | --- | --- |",
      ...summary.bySelf.map(
        (entry) =>
          `| ${entry.selfMs} | ${entry.totalMs} | ${escapeCell(entry.name)} | ${escapeCell(entry.location)} |`,
      ),
      "",
      "Functions by total time:",
      "",
      "| total ms | self ms | function | location |",
      "| ---: | ---: | --- | --- |",
      ...summary.byInclusive.map(
        (entry) =>
          `| ${entry.totalMs} | ${entry.selfMs} | ${escapeCell(entry.name)} | ${escapeCell(entry.location)} |`,
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}
