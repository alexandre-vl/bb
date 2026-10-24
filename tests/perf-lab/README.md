# bb perf lab

Scripted, repeatable measurements of how the web app loads and switches threads.
Each scenario runs in a fresh headless Chrome profile against a running bb
instance, under an emulated network and CPU, and records:

| Layer              | Source                                                                                                        | Where it lands                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| What the user sees | 50 ms DOM samples of the thread pane (header, transcript viewport, composer, side panel, skeletons, spinners) | `visibleChanges`, `contentAt`, `settledAt`, `chromeChangesAfterContent`    |
| Frames             | CDP screencast                                                                                                | `frames/*.jpg`, `filmstrip.png`                                            |
| Layout stability   | `layout-shift` entries with their source nodes                                                                | `layoutShiftScore`, `recording.json › shifts`                              |
| Main thread        | Long Animation Frames with their top scripts                                                                  | `longestFrame`, `totalBlockingTime`, `recording.json › loafs`              |
| App milestones     | `bb:thread-open:<milestone>` marks (`apps/app/src/lib/perf-trace.ts`)                                         | `milestone.*`                                                              |
| Data layer         | `bb:query` measures: one per TanStack Query fetch, with key, outcome and whether it was the first fetch       | `queries`                                                                  |
| Network            | Every same-origin request (timing, status, bytes) and WebSocket frame                                         | `apiRequests`, `apiBytes`, `lastApiResponseAt`, `recording.json › network` |

Times are milliseconds from the measured action: the click, the history step,
the network drop, or navigation start for `open`.

## Run it

```bash
pnpm seed:perf -- --open-long-threads 8        # once: a store with very long transcripts
pnpm start:worktree --perf-diagnostics          # keep running; enables the in-app trace
pnpm perf:lab -- --list                         # scenarios and the threads each role uses
pnpm perf:lab -- --scenario switch-new,switch-cached --runs 5 --label before
pnpm perf:lab -- --scenario switch-new,switch-cached --runs 5 --label after \
  --baseline /tmp/bb-perf-lab/<before-run>/report.json
```

`pnpm seed:perf` refuses an existing database; see "Seeding a perf database" in
[docs/debugging-and-qa.md](../../docs/debugging-and-qa.md) for the data
directory it writes and the size flags. Without `--perf-diagnostics` the lab
still measures everything the browser sees, but `milestone.*` and `queries` stay
empty and the report says `in-app trace: unavailable`.

The lab finds Chrome in the usual install locations; pass `--chrome <path>` or
set `BB_PERF_LAB_CHROME` otherwise. `pnpm perf:lab -- --help` lists every flag.

## Scenarios

The lab assigns the largest visible threads to the roles `primary`,
`secondary` and `tertiary`; pin them with `--thread secondary=thr_…`.

| Scenario        | What it measures                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `cold-open`     | Loading the app directly on a thread URL                                                         |
| `switch-new`    | Clicking a thread this browser has never opened                                                  |
| `switch-cached` | Clicking back to a thread whose data is cached and fresh                                         |
| `return-stale`  | Clicking back after `--stale-ms` (default 5.5 min, past TanStack Query's default 5 min `gcTime`) |
| `history-back`  | Browser back to the previous thread                                                              |
| `hover-switch`  | Hovering the sidebar row for 250 ms before clicking (prefetch on intent)                         |
| `tour`          | Three switches and a back, each measured                                                         |
| `reconnect`     | A 4 s network drop on an open thread                                                             |

Network profiles: `none`, `tunnel` (150 ms RTT, 2.5 MB/s down — a remote
connection through bb connect), `slow` (400 ms, 200 KB/s). `--cpu 4`
approximates a mid-range phone.

Chrome reaches the app through a local proxy the lab starts. By default it
speaks HTTP/2 over TLS like bb connect, so requests are not queued behind
HTTP/1.1's six connections per origin; `--transport h1` measures plain
HTTP/1.1. The proxy rewrites `Host` and `Origin` to the server's like the bb
connect gate does.

`--delay <glob>=<ms>` holds matching requests in the proxy before they reach
the server, to simulate the slow parts of a real machine. The glob matches the
path and query string, optionally prefixed by the method:

```bash
pnpm perf:lab -- --scenario switch-new \
  --delay '/api/v1/environments/*/status*=1200' \
  --delay '/api/v1/plugins/bb--github-pr-status/rpc/*=1500'
```

`--app-dist <dir>` serves the web app from a built `apps/app/dist` copy
instead of the server, so frontend builds can be compared against the same
server, data and transport. Snapshot the build before a change, rebuild, then
give both builds to one run. Runs alternate between the builds, so load from
other processes on a shared machine affects both alike:

```bash
cp -r apps/app/dist /tmp/dist-before
# change the app, then rebuild it (pnpm start:worktree rebuilds on start)
pnpm perf:lab -- --scenario switch-new --runs 5 \
  --app-dist /tmp/dist-before --label before \
  --app-dist apps/app/dist --label after
```

Each build gets its own report under `<out>/<label>/`, and `<out>/report.md`
compares every build with the first. Every step also records the host's load
average at the start of each run; compare runs taken under similar load.

A run in which any `/api/` response has status 500 or more (the server
restarted or the proxy lost it) is kept on disk but left out of the summary;
the report names it under its step. A run that throws (a navigation timeout, a
crashed browser) is listed under "Failed runs" and the battery goes on. Each
build's `report.json` is rewritten after every run, so a battery that is
interrupted still leaves the runs it finished.

Add a scenario in `src/scenarios.ts`; steps are `open`, `click`, `hover`,
`back`, `idle` and `offline`, and only steps with `measure: true` produce a
recording.

## Output

```text
<out>/report.md                      medians, p90, min, max per metric; Δ against --baseline
<out>/report.json                    the same data plus every run's analysis, for scripts
<out>/<scenario>/run-<n>/measured-<k>/recording.json   raw samples, shifts, frames, trace, network
<out>/<scenario>/run-<n>/measured-<k>/filmstrip.png    the screen at fixed times after the action
```

Compare two runs by their `report.json`: `steps[].summary[metric].median`
keyed by `scenario` and `step`. Rely on medians of five or more runs; single
runs on a shared machine vary by tens of milliseconds.

The analysis is a pure function of the recordings. After changing
`src/analysis.ts`, recompute earlier output directories instead of measuring
again; no instance needs to run:

```bash
pnpm perf:lab -- --reanalyze /tmp/bb-perf-lab/<before-run>
pnpm perf:lab -- --reanalyze /tmp/bb-perf-lab/<after-run> --baseline /tmp/bb-perf-lab/<before-run>/report.json
```

## Metrics

| Metric                                         | Meaning                                                                                                                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentAt`                                    | First sample showing the target thread's transcript. The previous thread's text lingering on the new URL does not count.                                                                                                                |
| `settledAt`                                    | Last visible change in the recording window.                                                                                                                                                                                            |
| `chromeChangesAfterContent`                    | Header, composer, panel, skeleton or spinner changes after the transcript appeared: the late pop-ins a user notices.                                                                                                                    |
| `chromeUpdatesAfterContent`                    | The distinct moments those changes happened; a skeleton replaced by its content in one frame counts once.                                                                                                                               |
| `visibleChanges`                               | All distinct visible changes; scroll and transcript changes within 120 ms merge into one.                                                                                                                                               |
| `layoutShiftScore`                             | Sum of layout shifts without recent input.                                                                                                                                                                                              |
| `longestFrame`, `totalBlockingTime`            | From Long Animation Frames.                                                                                                                                                                                                             |
| `milestone.<name>`                             | When the app first had that piece ready for the target thread: `route`, `thread`, `bootstrap`, `environment`, `interactions`, `work-status`, `execution-defaults`, `queued-messages`, `timeline-skeleton`, `timeline`, `timeline-rows`. |
| `apiRequests`, `apiBytes`, `lastApiResponseAt` | Same-origin `/api/` traffic during the window.                                                                                                                                                                                          |
| `serverErrors`                                 | Per run in `report.json`: `/api/` responses with status 500 or more. A run with any is excluded from the summary.                                                                                                                       |

## In-app trace

`apps/app/src/lib/perf-trace.ts` writes User Timing entries only while
performance diagnostics are on, so every browser and profiler sees them:

- `bb:thread-open:intent` when a pointer press or keyboard activation targets
  a thread link (`detail.threadId`, `detail.input`).
- `bb:thread-open:prefetch` when a press, an 80 ms hover or keyboard focus on a
  thread link started requests (`detail.requested` lists them). The lab keeps
  this mark when it precedes the measured action.
- `bb:thread-open:<milestone>` once per thread view mount (`detail.threadId`).
- `bb:query` measures for each query fetch (`detail.key`, `detail.outcome`:
  `success`, `error` or `cancelled`, `detail.initial`, `detail.observers`).
- `bb:timeline-applied` and `bb:stream-row-commit` for streaming turns.

To add a milestone, extend `THREAD_OPEN_MILESTONES` and report readiness from
the component that owns the data through `useThreadOpenTraceMilestones`.
