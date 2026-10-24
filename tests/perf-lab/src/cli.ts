import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ElementHandle } from "puppeteer-core";
import { analyzeRecording, summarizeRuns } from "./analysis.js";
import { LabSession, NETWORK_PROFILES, resolveChromePath } from "./browser.js";
import { parseRouteDelay, startLabProxy, type LabProxy } from "./lab-proxy.js";
import {
  discoverThreadFixtures,
  enablePerfDiagnostics,
  resolveDevAppUrl,
  waitForServer,
  type ThreadFixture,
} from "./instance.js";
import {
  renderMarkdownReport,
  type LabReport,
  type RunFailure,
  type RunRecord,
  type StepReport,
} from "./report.js";
import {
  describeStep,
  SCENARIOS,
  THREAD_ROLES,
  type ScenarioStep,
  type ThreadRole,
} from "./scenarios.js";
import type { Recording } from "./types.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_SCENARIOS = ["switch-new", "switch-cached", "history-back"];
const CONTACT_SHEET_TIMES = [
  0, 100, 200, 300, 450, 600, 800, 1000, 1300, 1700, 2200, 3000, 4000, 5500,
  7000,
];
const OPEN_TIMEOUT_MS = 120_000;

interface Variant {
  appDist: string | null;
  failures: RunFailure[];
  label: string | null;
  outDir: string;
  proxy: LabProxy;
  stepReports: Map<string, StepReport>;
}
const NETWORK_QUIET_MS = 2_500;
const PRESS_DURATION_MS = 80;

const HELP = `bb perf lab — scripted thread-loading scenarios against a running bb instance

Usage: pnpm perf:lab [-- options]

Options:
  --scenario <names>     Comma-separated scenarios (default: ${DEFAULT_SCENARIOS.join(",")})
  --profile <name>       Network profile: ${Object.keys(NETWORK_PROFILES).join(", ")} (default: tunnel)
  --cpu <n>              CPU slowdown factor (default: 1; 4 approximates a phone)
  --runs <n>             Runs per scenario, each in a fresh browser profile (default: 3)
  --record <ms>          Recording window after each measured action (default: 6000)
  --settle <ms>          Wait after unmeasured steps (default: 1500)
  --stale-ms <ms>        Idle time for return-stale (default: 330000)
  --app <url>            bb app URL (default: this checkout's dev instance)
  --app-dist <dir>       Serve the web app from this build directory instead of the server, e.g. a
                         snapshot of apps/app/dist. Repeat to compare builds: runs alternate between
                         them on the same server and data, each build gets its own report under
                         <out>/<label>, and <out>/report.md compares every build with the first
  --transport <h1|h2>    h2 (default) serves the app to Chrome over HTTP/2 + TLS, like bb connect;
                         h1 uses plain HTTP/1.1 (6 connections per origin)
  --delay <glob>=<ms>    Hold matching requests before they reach the server; repeatable. The glob
                         matches the path and query, optionally prefixed by the method, e.g.
                         "/api/v1/environments/*/status*=1500" or "POST /api/v1/threads/*=300"
  --thread <role=id>     Pin a role (${THREAD_ROLES.join(", ")}) to a thread id; repeatable
  --out <dir>            Output directory (default: $TMPDIR/bb-perf-lab/<timestamp>)
  --baseline <file>      Earlier report.json to compare medians against
  --label <text>         Label stored in the report; repeat to name each --app-dist build in order
  --viewport <WxH>       Browser viewport (default: 1440x900)
  --chrome <path>        Chrome/Chromium binary (or BB_PERF_LAB_CHROME)
  --reanalyze <dir>      Recompute an earlier output directory's analyses and summaries from its
                         recordings with the current analysis code (with --baseline to compare);
                         needs no running instance
  --list                 Print scenarios and discovered threads, then exit

Scenarios:
${Object.entries(SCENARIOS)
  .map(([name, scenario]) => `  ${name.padEnd(14)} ${scenario.description}`)
  .join("\n")}
`;

function parsePositiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function parseViewport(value: string): { height: number; width: number } {
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (match === null) {
    throw new Error("--viewport must look like 1440x900");
  }
  return { height: Number(match[2]), width: Number(match[1]) };
}

function isThreadRole(value: string): value is ThreadRole {
  return (THREAD_ROLES as readonly string[]).includes(value);
}

function parseThreadPins(values: readonly string[]): Map<ThreadRole, string> {
  const pins = new Map<ThreadRole, string>();
  for (const value of values) {
    const [role, id] = value.split("=");
    if (role === undefined || id === undefined || !isThreadRole(role)) {
      throw new Error(
        `--thread expects role=id with role in ${THREAD_ROLES.join(", ")}`,
      );
    }
    pins.set(role, id);
  }
  return pins;
}

function assignRoles(
  fixtures: readonly ThreadFixture[],
  pins: ReadonlyMap<ThreadRole, string>,
): Partial<Record<ThreadRole, ThreadFixture>> {
  const assigned: Partial<Record<ThreadRole, ThreadFixture>> = {};
  const used = new Set<string>();
  for (const [role, id] of pins) {
    const fixture = fixtures.find((candidate) => candidate.id === id);
    if (fixture === undefined) {
      throw new Error(
        `--thread ${role}=${id}: no visible, unarchived thread with that id`,
      );
    }
    assigned[role] = fixture;
    used.add(id);
  }
  const remaining = fixtures.filter((fixture) => !used.has(fixture.id));
  for (const role of THREAD_ROLES) {
    if (assigned[role] === undefined) {
      const next = remaining.shift();
      if (next !== undefined) {
        assigned[role] = next;
      }
    }
  }
  return assigned;
}

function readGitSha(): string | null {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    const dirty =
      execFileSync("git", ["status", "--porcelain"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return null;
  }
}

function requireRole(
  threads: Partial<Record<ThreadRole, ThreadFixture>>,
  role: ThreadRole,
): ThreadFixture {
  const fixture = threads[role];
  if (fixture === undefined) {
    throw new Error(
      `The scenario needs a ${role} thread, but the instance has too few visible threads. Seed some with \`pnpm seed:perf -- --open-long-threads 8\`.`,
    );
  }
  return fixture;
}

async function findThreadLink(
  session: LabSession,
  thread: ThreadFixture,
): Promise<ElementHandle<Element>> {
  const link =
    (await session.page.$(
      `[data-sidebar=content] a[href$="/threads/${thread.id}"]`,
    )) ?? (await session.page.$(`a[href$="/threads/${thread.id}"]`));
  if (link === null) {
    throw new Error(
      `Thread ${thread.id} has no link in the page; is it visible in the sidebar?`,
    );
  }
  return link;
}

async function pointAtThreadLink(
  session: LabSession,
  thread: ThreadFixture,
): Promise<void> {
  const link = await findThreadLink(session, thread);
  try {
    await link.scrollIntoView();
    const box = await link.boundingBox();
    if (box === null) {
      throw new Error(`Thread ${thread.id}'s link is not rendered.`);
    }
    await session.page.mouse.move(
      box.x + Math.min(box.width / 2, 120),
      box.y + box.height / 2,
    );
  } finally {
    await link.dispose();
  }
}

async function clickSidebarThread(
  session: LabSession,
  thread: ThreadFixture,
): Promise<void> {
  await pointAtThreadLink(session, thread);
  await session.startProbe();
  await session.page.mouse.down();
  await new Promise((resolve) => setTimeout(resolve, PRESS_DURATION_MS));
  await session.page.mouse.up();
}

async function waitForThreadView(
  session: LabSession,
  thread: ThreadFixture,
): Promise<void> {
  await session.page.waitForFunction(
    (path: string) =>
      location.pathname === path &&
      document.querySelector(
        "[data-split-pane-id] [data-page-scroll-viewport]",
      ) !== null,
    { timeout: OPEN_TIMEOUT_MS },
    thread.path,
  );
  const quiet = await session.waitForNetworkQuiet(
    NETWORK_QUIET_MS,
    OPEN_TIMEOUT_MS,
  );
  if (!quiet) {
    process.stderr.write(
      `warning: requests still in flight ${OPEN_TIMEOUT_MS} ms after opening ${thread.id}\n`,
    );
  }
}

async function hoverSidebarThread(
  session: LabSession,
  thread: ThreadFixture,
): Promise<void> {
  await pointAtThreadLink(session, thread);
}

interface PerfLabWindow {
  __bbPerfLabProbe: { start: (fromNavigation: boolean) => number };
}

interface RunStepsArgs {
  appUrl: string;
  outDir: string;
  recordMs: number;
  session: LabSession;
  steps: readonly ScenarioStep[];
  threads: Partial<Record<ThreadRole, ThreadFixture>>;
}

interface MeasuredStep {
  label: string;
  recording: Recording;
}

async function runSteps(args: RunStepsArgs): Promise<MeasuredStep[]> {
  const measured: MeasuredStep[] = [];
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
  let lastThread: ThreadFixture | null = null;
  const visited: ThreadFixture[] = [];
  for (const [index, step] of args.steps.entries()) {
    const label = `${index}-${describeStep(step).replaceAll(":", "-")}`;
    const framesDir = join(args.outDir, label, "frames");
    switch (step.kind) {
      case "open": {
        const thread = requireRole(args.threads, step.thread);
        const open = async () => {
          await args.session.page.goto(`${args.appUrl}${thread.path}`, {
            timeout: OPEN_TIMEOUT_MS,
            waitUntil: "domcontentloaded",
          });
        };
        if (step.measure) {
          measured.push({
            label: describeStep(step),
            recording: await args.session.recordStep({
              action: open,
              framesDir,
              recordMs: args.recordMs,
              step: describeStep(step),
              targetPath: thread.path,
              targetThreadId: thread.id,
            }),
          });
        } else {
          await open();
          await waitForThreadView(args.session, thread);
        }
        lastThread = thread;
        visited.push(thread);
        break;
      }
      case "click": {
        const thread = requireRole(args.threads, step.thread);
        const click = () => clickSidebarThread(args.session, thread);
        if (step.measure) {
          measured.push({
            label: describeStep(step),
            recording: await args.session.recordStep({
              action: click,
              framesDir,
              recordMs: args.recordMs,
              step: describeStep(step),
              targetPath: thread.path,
              targetThreadId: thread.id,
            }),
          });
        } else {
          await click();
          await waitForThreadView(args.session, thread);
        }
        lastThread = thread;
        visited.push(thread);
        break;
      }
      case "hover": {
        await hoverSidebarThread(
          args.session,
          requireRole(args.threads, step.thread),
        );
        await sleep(step.ms);
        break;
      }
      case "back": {
        visited.pop();
        const target = visited.at(-1) ?? null;
        measured.push({
          label: describeStep(step),
          recording: await args.session.recordStep({
            action: async () => {
              await args.session.page.evaluate(() => {
                (window as unknown as PerfLabWindow).__bbPerfLabProbe.start(
                  false,
                );
                history.back();
              });
            },
            framesDir,
            recordMs: args.recordMs,
            step: describeStep(step),
            targetPath: target?.path ?? null,
            targetThreadId: target?.id ?? null,
          }),
        });
        lastThread = target;
        break;
      }
      case "idle": {
        await sleep(step.ms);
        break;
      }
      case "offline": {
        measured.push({
          label: describeStep(step),
          recording: await args.session.recordStep({
            action: async () => {
              await args.session.startProbe();
              await args.session.setOffline(true);
              await sleep(step.ms);
              await args.session.setOffline(false);
            },
            framesDir,
            recordMs: args.recordMs,
            step: describeStep(step),
            targetPath: lastThread?.path ?? null,
            targetThreadId: lastThread?.id ?? null,
          }),
        });
        break;
      }
    }
  }
  return measured;
}

function toRunRecord(
  recording: Recording,
  run: number,
  recordingFile: string,
  sheetFile: string | null,
  hostLoad: number | null,
): RunRecord {
  const analysis = analyzeRecording(recording);
  return {
    analysis,
    excludedReason:
      analysis.serverErrors > 0
        ? `${analysis.serverErrors} API responses with status 500 or more`
        : null,
    hostLoad,
    recordingFile,
    run,
    sheetFile,
  };
}

function summarizeSteps(steps: readonly StepReport[]): StepReport[] {
  return steps.map((step) => ({
    ...step,
    summary: summarizeRuns(
      step.runs
        .filter((run) => run.excludedReason === null)
        .map((run) => run.analysis),
    ),
  }));
}

function saveReport(
  outDir: string,
  report: LabReport,
  baselineFile: string | undefined,
): string {
  const baseline =
    baselineFile === undefined
      ? null
      : (JSON.parse(readFileSync(baselineFile, "utf8")) as LabReport);
  writeFileSync(
    join(outDir, "report.json"),
    `${JSON.stringify(report, null, 1)}\n`,
  );
  const markdown = renderMarkdownReport(report, baseline);
  writeFileSync(join(outDir, "report.md"), markdown);
  return markdown;
}

function writeReport(
  outDir: string,
  report: LabReport,
  baselineFile: string | undefined,
): void {
  const markdown = saveReport(outDir, report, baselineFile);
  process.stdout.write(`\n${markdown}\nReport: ${join(outDir, "report.md")}\n`);
}

function reanalyze(outDir: string, baselineFile: string | undefined): void {
  const previous = JSON.parse(
    readFileSync(join(outDir, "report.json"), "utf8"),
  ) as LabReport;
  const steps = summarizeSteps(
    previous.steps.map((step) => ({
      ...step,
      runs: step.runs.map((run) =>
        toRunRecord(
          JSON.parse(readFileSync(run.recordingFile, "utf8")) as Recording,
          run.run,
          run.recordingFile,
          run.sheetFile,
          run.hostLoad ?? null,
        ),
      ),
    })),
  );
  writeReport(
    outDir,
    {
      ...previous,
      failures: Array.isArray(previous.failures) ? previous.failures : [],
      steps,
    },
    baselineFile,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "--") {
    argv.shift();
  }
  const { values } = parseArgs({
    args: argv,
    options: {
      app: { type: "string" },
      "app-dist": { multiple: true, type: "string" },
      baseline: { type: "string" },
      chrome: { type: "string" },
      cpu: { default: "1", type: "string" },
      delay: { multiple: true, type: "string" },
      help: { short: "h", type: "boolean" },
      label: { multiple: true, type: "string" },
      list: { type: "boolean" },
      out: { type: "string" },
      profile: { default: "tunnel", type: "string" },
      reanalyze: { type: "string" },
      record: { default: "6000", type: "string" },
      runs: { default: "3", type: "string" },
      scenario: { default: DEFAULT_SCENARIOS.join(","), type: "string" },
      settle: { default: "1500", type: "string" },
      "stale-ms": { default: "330000", type: "string" },
      thread: { multiple: true, type: "string" },
      transport: { default: "h2", type: "string" },
      viewport: { default: "1440x900", type: "string" },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.reanalyze !== undefined) {
    reanalyze(resolve(values.reanalyze), values.baseline);
    return;
  }
  const scenarioNames = values.scenario.split(",").map((name) => name.trim());
  for (const name of scenarioNames) {
    if (!(name in SCENARIOS)) {
      throw new Error(
        `Unknown scenario ${name}. Known: ${Object.keys(SCENARIOS).join(", ")}`,
      );
    }
  }
  if (!(values.profile in NETWORK_PROFILES)) {
    throw new Error(
      `Unknown profile ${values.profile}. Known: ${Object.keys(NETWORK_PROFILES).join(", ")}`,
    );
  }
  const cpuSlowdown = parsePositiveInteger("cpu", values.cpu);
  const runs = parsePositiveInteger("runs", values.runs);
  const recordMs = parsePositiveInteger("record", values.record);
  const settleMs = parsePositiveInteger("settle", values.settle);
  const staleMs = parsePositiveInteger("stale-ms", values["stale-ms"]);
  const viewport = parseViewport(values.viewport);
  if (values.transport !== "h1" && values.transport !== "h2") {
    throw new Error("--transport must be h1 or h2");
  }
  const transport = values.transport;
  const delays = (values.delay ?? []).map(parseRouteDelay);
  const appUrl = (values.app ?? (await resolveDevAppUrl(REPO_ROOT))).replace(
    /\/$/u,
    "",
  );
  await waitForServer(appUrl);
  const fixtures = await discoverThreadFixtures(appUrl);
  const threads = assignRoles(fixtures, parseThreadPins(values.thread ?? []));
  if (values.list) {
    process.stdout.write(HELP);
    process.stdout.write(`\nThreads at ${appUrl} (largest first):\n`);
    for (const fixture of fixtures) {
      const role = THREAD_ROLES.find(
        (candidate) => threads[candidate]?.id === fixture.id,
      );
      process.stdout.write(
        `  ${fixture.id} ${String(fixture.maxSeq).padStart(7)} ${role ? `[${role}] ` : ""}${fixture.title}\n`,
      );
    }
    return;
  }
  const perfDiagnostics = await enablePerfDiagnostics(appUrl);
  if (perfDiagnostics === "unavailable") {
    process.stderr.write(
      "warning: the server was not started with --perf-diagnostics; in-app milestones and query timings will be missing.\n",
    );
  }
  const outDir = resolve(
    values.out ??
      join(
        tmpdir(),
        "bb-perf-lab",
        new Date().toISOString().replaceAll(":", "-"),
      ),
  );
  mkdirSync(outDir, { recursive: true });
  const chromePath = resolveChromePath(values.chrome);
  const networkProfile = NETWORK_PROFILES[values.profile] ?? null;
  const appDists = (values["app-dist"] ?? []).map((dir) => resolve(dir));
  for (const appDist of appDists) {
    if (!existsSync(join(appDist, "index.html"))) {
      throw new Error(`--app-dist ${appDist} has no index.html`);
    }
  }
  const builds = appDists.length > 0 ? appDists : [null];
  const comparing = builds.length > 1;
  const labels = values.label ?? [];
  const variants: Variant[] = [];
  const startedAt = new Date().toISOString();
  const gitSha = readGitSha();
  const reportFor = (variant: Variant): LabReport => ({
    appUrl,
    appDist: variant.appDist,
    cpuSlowdown,
    createdAt: startedAt,
    delays: delays.map((delay) => delay.source),
    failures: variant.failures,
    gitSha,
    label: variant.label,
    perfDiagnostics,
    profile: values.profile,
    runs,
    steps: summarizeSteps([...variant.stepReports.values()]),
    threads,
    transport,
  });
  try {
    for (const [index, appDist] of builds.entries()) {
      const label = labels[index] ?? (comparing ? `build-${index + 1}` : null);
      variants.push({
        appDist,
        failures: [],
        label,
        outDir:
          comparing && label !== null
            ? join(outDir, label.replace(/[^\w.-]+/gu, "-"))
            : outDir,
        proxy: await startLabProxy({
          appDist,
          backendUrl: appUrl,
          delays,
          transport,
        }),
        stepReports: new Map(),
      });
    }
    for (const scenario of scenarioNames) {
      const definition = SCENARIOS[scenario];
      if (definition === undefined) {
        continue;
      }
      const steps = definition.steps({ settleMs, staleMs });
      for (let run = 1; run <= runs; run += 1) {
        for (const variant of variants) {
          process.stdout.write(
            `▶ ${scenario} run ${run}/${runs}${comparing ? ` · ${variant.label}` : ""}\n`,
          );
          const runDir = join(variant.outDir, scenario, `run-${run}`);
          const browserUrl = variant.proxy.url;
          const hostLoad = loadavg()[0] ?? null;
          let session: LabSession | null = null;
          try {
            session = await LabSession.start({
              appUrl: browserUrl,
              chromePath,
              cpuSlowdown,
              height: viewport.height,
              networkProfile,
              width: viewport.width,
            });
            const measured = await runSteps({
              appUrl: browserUrl,
              outDir: runDir,
              recordMs,
              session,
              steps,
              threads,
            });
            for (const [index, { label, recording }] of measured.entries()) {
              const stepLabel = `${index + 1}. ${label}`;
              const key = `${scenario}::${stepLabel}`;
              const stepDir = join(runDir, `measured-${index + 1}`);
              mkdirSync(stepDir, { recursive: true });
              const recordingFile = join(stepDir, "recording.json");
              writeFileSync(
                recordingFile,
                `${JSON.stringify(recording, null, 1)}\n`,
              );
              const sheetFile = join(stepDir, "filmstrip.png");
              await session.renderContactSheet(
                `${scenario} › ${stepLabel} — run ${run} — ${values.profile} ${transport} ×${cpuSlowdown}`,
                recording.frames,
                CONTACT_SHEET_TIMES.filter((time) => time <= recordMs),
                sheetFile,
              );
              const runRecord = toRunRecord(
                recording,
                run,
                recordingFile,
                sheetFile,
                hostLoad,
              );
              const report = variant.stepReports.get(key) ?? {
                runs: [],
                scenario,
                step: stepLabel,
                summary: {},
              };
              report.runs.push(runRecord);
              variant.stepReports.set(key, report);
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            variant.failures.push({ error: message, run, scenario });
            process.stderr.write(
              `✗ ${scenario} run ${run}${comparing ? ` · ${variant.label}` : ""} failed: ${message}\n`,
            );
          } finally {
            await session?.close();
          }
          mkdirSync(variant.outDir, { recursive: true });
          saveReport(variant.outDir, reportFor(variant), undefined);
        }
      }
    }
  } finally {
    await Promise.all(variants.map((variant) => variant.proxy.close()));
  }
  const reports: LabReport[] = [];
  for (const [index, variant] of variants.entries()) {
    const report = reportFor(variant);
    const firstOutDir = variants[0]?.outDir ?? outDir;
    writeReport(
      variant.outDir,
      report,
      index === 0 ? values.baseline : join(firstOutDir, "report.json"),
    );
    reports.push(report);
  }
  const [first, ...others] = reports;
  if (comparing && first !== undefined) {
    writeFileSync(
      join(outDir, "report.md"),
      others.map((report) => renderMarkdownReport(report, first)).join("\n"),
    );
    process.stdout.write(`\nComparison: ${join(outDir, "report.md")}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
