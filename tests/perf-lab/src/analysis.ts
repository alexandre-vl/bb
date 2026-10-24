import type {
  MetricSummary,
  ProbeSample,
  QueryTiming,
  RawProbeSample,
  Recording,
  RecordingAnalysis,
  VisibleChange,
} from "./types.js";

const IDENTITY_FIELDS = ["path", "title", "headerText", "hasTimeline"] as const;

export const CHROME_FIELDS = [
  "headerControls",
  "composerFooterText",
  "composerFooterControls",
  "composerStackText",
  "composerBoxHeight",
  "composerRect",
  "skeletons",
  "spinners",
  "toc",
  "scrollToLatest",
  "panelWidth",
] as const;

const MERGEABLE_FIELDS = new Set(["scroll", "transcript"]);
const MERGE_WINDOW_MS = 120;
const THREAD_OPEN_MARK_PREFIX = "bb:thread-open:";
const PRE_ACTION_MILESTONES: ReadonlySet<string> = new Set(["prefetch"]);
const QUERY_MEASURE_NAME = "bb:query";
const VALUE_MAX_LENGTH = 110;

const CHROME_FIELD_SET: ReadonlySet<string> = new Set(CHROME_FIELDS);

export function isProbeSample(sample: RawProbeSample): sample is ProbeSample {
  return !("empty" in sample) && !("error" in sample);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "∅";
  }
  const text = String(value);
  return text.length > VALUE_MAX_LENGTH
    ? `${text.slice(0, VALUE_MAX_LENGTH - 1)}…`
    : text;
}

function describeScroll(sample: ProbeSample): string {
  return `${sample.scrollTop ?? "∅"}/${sample.scrollHeight ?? "∅"}${sample.atBottom ? " bottom" : ""}`;
}

export function detectVisibleChanges(
  samples: readonly ProbeSample[],
): VisibleChange[] {
  const changes: VisibleChange[] = [];
  const lastMergeable = new Map<string, VisibleChange>();
  const push = (at: number, field: string, from: string, to: string) => {
    const last = lastMergeable.get(field);
    if (last !== undefined && at - last.until <= MERGE_WINDOW_MS) {
      last.to = to;
      last.until = at;
      last.count += 1;
      return;
    }
    const change = { at, count: 1, field, from, to, until: at };
    changes.push(change);
    if (MERGEABLE_FIELDS.has(field)) {
      lastMergeable.set(field, change);
    }
  };
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    for (const field of [...IDENTITY_FIELDS, ...CHROME_FIELDS]) {
      if (previous[field] !== current[field]) {
        push(
          current.at,
          field,
          formatValue(previous[field]),
          formatValue(current[field]),
        );
      }
    }
    if (
      previous.scrollTop !== current.scrollTop ||
      previous.scrollHeight !== current.scrollHeight
    ) {
      push(
        current.at,
        "scroll",
        describeScroll(previous),
        describeScroll(current),
      );
    }
    if (previous.viewportTextHash !== current.viewportTextHash) {
      push(
        current.at,
        "transcript",
        formatValue(previous.viewportTextHead),
        formatValue(current.viewportTextHead),
      );
    }
  }
  return changes;
}

export function findContentAt(
  samples: readonly ProbeSample[],
  targetPath: string | null,
): number | null {
  const initial = samples[0];
  if (initial === undefined) {
    return null;
  }
  for (const sample of samples) {
    if (targetPath !== null && sample.path !== targetPath) {
      continue;
    }
    if (sample.viewportTextHead.length === 0) {
      continue;
    }
    if (
      sample.path !== initial.path &&
      sample.viewportTextHash === initial.viewportTextHash
    ) {
      continue;
    }
    return sample.at;
  }
  return null;
}

function detailString(
  detail: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = detail?.[key];
  return typeof value === "string" ? value : null;
}

export function extractMilestones(
  recording: Pick<Recording, "targetThreadId" | "traceEntries">,
): Record<string, number> {
  const milestones: Record<string, number> = {};
  for (const entry of recording.traceEntries) {
    if (
      entry.kind !== "mark" ||
      !entry.name.startsWith(THREAD_OPEN_MARK_PREFIX)
    ) {
      continue;
    }
    const milestone = entry.name.slice(THREAD_OPEN_MARK_PREFIX.length);
    if (entry.at < 0 && !PRE_ACTION_MILESTONES.has(milestone)) {
      continue;
    }
    if (
      recording.targetThreadId !== null &&
      detailString(entry.detail, "threadId") !== recording.targetThreadId
    ) {
      continue;
    }
    milestones[milestone] ??= entry.at;
  }
  return milestones;
}

export function extractQueries(
  recording: Pick<Recording, "traceEntries">,
): QueryTiming[] {
  return recording.traceEntries
    .filter(
      (entry) =>
        entry.kind === "measure" &&
        entry.name === QUERY_MEASURE_NAME &&
        entry.at + entry.duration >= 0,
    )
    .map((entry) => ({
      at: entry.at,
      duration: entry.duration,
      initial: entry.detail?.["initial"] === true,
      key: detailString(entry.detail, "key") ?? "?",
      outcome: detailString(entry.detail, "outcome") ?? "?",
    }))
    .sort((left, right) => left.at - right.at);
}

export function analyzeRecording(recording: Recording): RecordingAnalysis {
  const samples = recording.samples.filter(isProbeSample);
  const visibleChanges = detectVisibleChanges(samples);
  const contentAt = findContentAt(samples, recording.targetPath);
  const chromeChangesAfterContent =
    contentAt === null
      ? []
      : visibleChanges.filter(
          (change) =>
            CHROME_FIELD_SET.has(change.field) && change.at > contentAt,
        );
  const apiRequests = recording.network.filter((request) =>
    request.path.startsWith("/api/"),
  );
  const responseEnds = apiRequests
    .map((request) => request.end)
    .filter((end): end is number => end !== null);
  return {
    apiBytes: apiRequests.reduce(
      (sum, request) => sum + (request.bytes ?? 0),
      0,
    ),
    apiRequests: apiRequests.length,
    chromeChangesAfterContent: chromeChangesAfterContent.length,
    chromeUpdatesAfterContent: new Set(
      chromeChangesAfterContent.map((change) => change.at),
    ).size,
    contentAt,
    lastApiResponseAt:
      responseEnds.length > 0 ? Math.max(...responseEnds) : null,
    layoutShiftScore: recording.shifts
      .filter((shift) => !shift.hadRecentInput)
      .reduce((sum, shift) => sum + shift.value, 0),
    longestFrame: recording.loafs.reduce(
      (longest, frame) => Math.max(longest, frame.duration),
      0,
    ),
    milestones: extractMilestones(recording),
    queries: extractQueries(recording),
    serverErrors: apiRequests.filter(
      (request) => typeof request.status === "number" && request.status >= 500,
    ).length,
    settledAt: visibleChanges.reduce(
      (latest, change) => Math.max(latest, change.until),
      0,
    ),
    totalBlockingTime: recording.loafs.reduce(
      (sum, frame) => sum + frame.blockingDuration,
      0,
    ),
    visibleChanges,
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index] ?? Number.NaN;
}

export function summarizeMetric(values: readonly number[]): MetricSummary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    max: sorted.at(-1) ?? Number.NaN,
    median: percentile(sorted, 0.5),
    min: sorted[0] ?? Number.NaN,
    p90: percentile(sorted, 0.9),
    runs: sorted.length,
  };
}

export function flattenMetrics(
  analysis: RecordingAnalysis,
): Record<string, number> {
  const metrics: Record<string, number> = {
    apiBytes: analysis.apiBytes,
    apiRequests: analysis.apiRequests,
    chromeChangesAfterContent: analysis.chromeChangesAfterContent,
    chromeUpdatesAfterContent: analysis.chromeUpdatesAfterContent,
    layoutShiftScore: analysis.layoutShiftScore,
    longestFrame: analysis.longestFrame,
    settledAt: analysis.settledAt,
    totalBlockingTime: analysis.totalBlockingTime,
    visibleChanges: analysis.visibleChanges.length,
  };
  if (analysis.contentAt !== null) {
    metrics["contentAt"] = analysis.contentAt;
  }
  if (analysis.lastApiResponseAt !== null) {
    metrics["lastApiResponseAt"] = analysis.lastApiResponseAt;
  }
  for (const [milestone, at] of Object.entries(analysis.milestones)) {
    metrics[`milestone.${milestone}`] = at;
  }
  return metrics;
}

export function summarizeRuns(
  analyses: readonly RecordingAnalysis[],
): Record<string, MetricSummary> {
  const valuesByMetric = new Map<string, number[]>();
  for (const analysis of analyses) {
    for (const [metric, value] of Object.entries(flattenMetrics(analysis))) {
      const values = valuesByMetric.get(metric) ?? [];
      values.push(value);
      valuesByMetric.set(metric, values);
    }
  }
  return Object.fromEntries(
    [...valuesByMetric]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([metric, values]) => [metric, summarizeMetric(values)]),
  );
}
