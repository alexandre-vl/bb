import type { PerfDiagnosticsState, ThreadFixture } from "./instance.js";
import type { ThreadRole } from "./scenarios.js";
import type { MetricSummary, RecordingAnalysis } from "./types.js";

export interface RunRecord {
  analysis: RecordingAnalysis;
  excludedReason: string | null;
  hostLoad: number | null;
  recordingFile: string;
  run: number;
  sheetFile: string | null;
}

export interface RunFailure {
  error: string;
  run: number;
  scenario: string;
}

export interface StepReport {
  runs: RunRecord[];
  scenario: string;
  step: string;
  summary: Record<string, MetricSummary>;
}

export interface LabReport {
  appDist: string | null;
  appUrl: string;
  cpuSlowdown: number;
  createdAt: string;
  delays: string[];
  failures: RunFailure[];
  gitSha: string | null;
  label: string | null;
  perfDiagnostics: PerfDiagnosticsState;
  profile: string;
  retries: RunFailure[];
  runs: number;
  steps: StepReport[];
  threads: Partial<Record<ThreadRole, ThreadFixture>>;
  transport: "h1" | "h2";
}

const HEADLINE_METRICS = [
  "contentAt",
  "settledAt",
  "chromeChangesAfterContent",
  "chromeUpdatesAfterContent",
  "visibleChanges",
  "layoutShiftScore",
  "longestFrame",
  "totalBlockingTime",
  "apiRequests",
  "lastApiResponseAt",
];

const MAX_DETAIL_ROWS = 40;

function formatNumber(value: number): string {
  if (Number.isNaN(value)) {
    return "–";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatDelta(current: number, baseline: number | undefined): string {
  if (baseline === undefined || Number.isNaN(baseline)) {
    return "";
  }
  const delta = current - baseline;
  if (delta === 0) {
    return "=";
  }
  return `${delta > 0 ? "+" : ""}${formatNumber(delta)}`;
}

function stepKey(step: Pick<StepReport, "scenario" | "step">): string {
  return `${step.scenario}::${step.step}`;
}

function orderedMetrics(summary: Record<string, MetricSummary>): string[] {
  const milestones = Object.keys(summary)
    .filter((metric) => metric.startsWith("milestone."))
    .sort(
      (left, right) =>
        (summary[left]?.median ?? 0) - (summary[right]?.median ?? 0),
    );
  return [
    ...HEADLINE_METRICS.filter((metric) => metric in summary),
    ...milestones,
  ];
}

export function renderMarkdownReport(
  report: LabReport,
  baseline: LabReport | null,
): string {
  const baselineSteps = new Map(
    (baseline?.steps ?? []).map((step) => [stepKey(step), step]),
  );
  const lines = [
    `# bb perf lab — ${report.label ?? "unlabelled run"}`,
    "",
    `- created: ${report.createdAt}`,
    `- git: ${report.gitSha ?? "unknown"}`,
    `- app: ${report.appUrl}${report.appDist === null ? "" : ` · web build served from ${report.appDist}`}`,
    `- network profile: ${report.profile} over ${report.transport === "h2" ? "HTTP/2" : "HTTP/1.1"} · cpu slowdown: ×${report.cpuSlowdown} · runs per scenario: ${report.runs}`,
    `- simulated server delays: ${report.delays.length > 0 ? report.delays.map((delay) => `\`${delay}\``).join(", ") : "none"}`,
    `- in-app trace (performance diagnostics): ${report.perfDiagnostics}`,
    `- baseline: ${baseline ? `${baseline.label ?? "unlabelled"} (${baseline.createdAt}, ${baseline.gitSha ?? "?"})` : "none"}`,
    "",
    ...(report.failures.length > 0
      ? [
          `⚠ Failed runs, in no summary: ${report.failures
            .map(
              (failure) =>
                `${failure.scenario} run ${failure.run} (${failure.error})`,
            )
            .join("; ")}`,
          "",
        ]
      : []),
    ...(report.retries.length > 0
      ? [
          `↻ Runs restarted in a new browser after a stalled navigation: ${report.retries
            .map(
              (retry) => `${retry.scenario} run ${retry.run} (${retry.error})`,
            )
            .join("; ")}`,
          "",
        ]
      : []),
    "| role | thread | events (maxSeq) | title |",
    "| --- | --- | --- | --- |",
    ...Object.entries(report.threads).map(
      ([role, thread]) =>
        `| ${role} | ${thread?.id ?? "–"} | ${thread?.maxSeq ?? "–"} | ${thread?.title ?? "–"} |`,
    ),
    "",
    "Times are milliseconds from the measured action (click, history step, offline) or from navigation start for `open`.",
    "`contentAt`: target transcript visible · `settledAt`: last visible change · `chromeChangesAfterContent`: header/composer/panel changes after the transcript appeared (pop-ins) · `chromeUpdatesAfterContent`: distinct moments those changes happened.",
    "",
  ];
  for (const step of report.steps) {
    const baselineStep = baselineSteps.get(stepKey(step));
    lines.push(`## ${step.scenario} › ${step.step}`, "");
    const hostLoads = step.runs.flatMap((run) =>
      typeof run.hostLoad === "number" ? [run.hostLoad] : [],
    );
    if (hostLoads.length > 0) {
      lines.push(
        `Host load (1-minute average) at run start: ${Math.min(...hostLoads).toFixed(2)}–${Math.max(...hostLoads).toFixed(2)}`,
        "",
      );
    }
    const excluded = step.runs.filter((run) => run.excludedReason !== null);
    if (excluded.length > 0) {
      lines.push(
        `⚠ Excluded from the summary: ${excluded
          .map((run) => `run ${run.run} (${run.excludedReason})`)
          .join(", ")}`,
        "",
      );
    }
    lines.push(
      baselineStep
        ? "| metric | median | p90 | min | max | baseline median | Δ median |"
        : "| metric | median | p90 | min | max |",
    );
    lines.push(
      baselineStep
        ? "| --- | --- | --- | --- | --- | --- | --- |"
        : "| --- | --- | --- | --- | --- |",
    );
    for (const metric of orderedMetrics(step.summary)) {
      const summary = step.summary[metric];
      if (summary === undefined) {
        continue;
      }
      const baselineMedian = baselineStep?.summary[metric]?.median;
      lines.push(
        `| ${metric} | ${formatNumber(summary.median)} | ${formatNumber(summary.p90)} | ${formatNumber(summary.min)} | ${formatNumber(summary.max)} |${
          baselineStep
            ? ` ${baselineMedian === undefined ? "–" : formatNumber(baselineMedian)} | ${formatDelta(summary.median, baselineMedian)} |`
            : ""
        }`,
      );
    }
    const firstRun =
      step.runs.find((run) => run.excludedReason === null) ?? step.runs[0];
    if (firstRun !== undefined) {
      const { analysis } = firstRun;
      lines.push(
        "",
        `<details><summary>Run ${firstRun.run} detail (${firstRun.recordingFile})</summary>`,
        "",
      );
      if (firstRun.sheetFile !== null) {
        lines.push(`Filmstrip: ${firstRun.sheetFile}`, "");
      }
      lines.push("Visible changes:", "");
      for (const change of analysis.visibleChanges.slice(0, MAX_DETAIL_ROWS)) {
        const span =
          change.count > 1
            ? `${change.at}–${change.until}ms ×${change.count}`
            : `${change.at}ms`;
        lines.push(
          `- ${span} \`${change.field}\`: ${change.from} → ${change.to}`,
        );
      }
      const milestones = Object.entries(analysis.milestones).sort(
        ([, left], [, right]) => left - right,
      );
      if (milestones.length > 0) {
        lines.push("", "Milestones:", "");
        for (const [milestone, at] of milestones) {
          lines.push(`- ${Math.round(at)}ms ${milestone}`);
        }
      }
      if (analysis.queries.length > 0) {
        lines.push(
          "",
          "Queries (start → duration, outcome, initial fetch):",
          "",
        );
        for (const query of analysis.queries.slice(0, MAX_DETAIL_ROWS)) {
          lines.push(
            `- ${Math.round(query.at)}ms +${Math.round(query.duration)}ms ${query.outcome}${query.initial ? " initial" : ""} \`${query.key}\``,
          );
        }
      }
      lines.push("", "</details>", "");
    }
  }
  return `${lines.join("\n")}\n`;
}
