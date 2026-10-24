import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer, {
  type Browser,
  type CDPSession,
  type Page,
} from "puppeteer-core";
import type { CpuProfile } from "./cpu-profile.js";
import type {
  FilmstripFrame,
  NetworkRequest,
  RawProbeSample,
  Recording,
  LayoutShiftEntry,
  LongFrameEntry,
  TraceEntry,
  WebSocketFrame,
} from "./types.js";

export interface NetworkProfile {
  downloadBytesPerSecond: number;
  latencyMs: number;
  uploadBytesPerSecond: number;
}

export const NETWORK_PROFILES: Record<string, NetworkProfile | null> = {
  none: null,
  tunnel: {
    downloadBytesPerSecond: 2_500_000,
    latencyMs: 150,
    uploadBytesPerSecond: 625_000,
  },
  slow: {
    downloadBytesPerSecond: 200_000,
    latencyMs: 400,
    uploadBytesPerSecond: 94_000,
  },
};

const CHROME_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const LONG_LIVED_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "EventSource",
  "WebSocket",
]);
const NETWORK_QUIET_POLL_MS = 100;
const CPU_PROFILE_SAMPLING_INTERVAL_US = 200;
const NAVIGATION_STALL_POLL_MS = 500;

export class NavigationStalledError extends Error {}

const PROBE_SOURCE = readFileSync(
  new URL("./page-probe.js", import.meta.url),
  "utf8",
);

export function resolveChromePath(explicit: string | undefined): string {
  const candidates = [
    explicit,
    process.env["BB_PERF_LAB_CHROME"],
    ...CHROME_CANDIDATES,
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      "No Chrome or Chromium binary found. Pass --chrome <path> or set BB_PERF_LAB_CHROME.",
    );
  }
  return found;
}

interface ProbeCollection {
  loafs: LongFrameEntry[];
  samples: RawProbeSample[];
  shifts: LayoutShiftEntry[];
  t0Epoch: number;
  traceEntries: TraceEntry[];
}

interface PendingRequest extends Omit<NetworkRequest, "end" | "start"> {
  endEpoch: number | null;
  startEpoch: number;
}

interface PendingFrame {
  data: string;
  epoch: number;
}

interface PendingWebSocketFrame extends Omit<WebSocketFrame, "at"> {
  epoch: number;
}

export interface LabSessionOptions {
  appUrl: string;
  chromeArgs: readonly string[];
  chromePath: string;
  cpuProfile: boolean;
  cpuSlowdown: number;
  height: number;
  navigationStallMs: number;
  networkProfile: NetworkProfile | null;
  width: number;
}

export interface RecordedCpuProfile {
  profile: CpuProfile;
  startOffsetMs: number;
}

export interface RecordedStep {
  cpuProfile: RecordedCpuProfile | null;
  recording: Recording;
}

export interface RecordStepArgs {
  action: () => Promise<void>;
  framesDir: string;
  recordMs: number;
  step: string;
  targetPath: string | null;
  targetThreadId: string | null;
}

export class LabSession {
  private readonly requests: PendingRequest[] = [];
  private readonly requestsById = new Map<string, PendingRequest>();
  private readonly inFlightRequestIds = new Set<string>();
  private readonly websocketFrames: PendingWebSocketFrame[] = [];
  private readonly frames: PendingFrame[] = [];
  private clockOffsetMs: number | null = null;
  private lastNetworkProgressAt = Date.now();

  private constructor(
    private readonly browser: Browser,
    readonly page: Page,
    private readonly cdp: CDPSession,
    private readonly options: LabSessionOptions,
  ) {}

  static async start(options: LabSessionOptions): Promise<LabSession> {
    const browser = await puppeteer.launch({
      acceptInsecureCerts: true,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--ignore-certificate-errors",
        ...options.chromeArgs,
      ],
      defaultViewport: { height: options.height, width: options.width },
      executablePath: options.chromePath,
      headless: true,
    });
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    const session = new LabSession(browser, page, cdp, options);
    await session.attach();
    return session;
  }

  private async attach(): Promise<void> {
    const origin = new URL(this.options.appUrl).origin;
    await this.cdp.send("Network.enable");
    await this.cdp.send("Page.enable");
    this.cdp.on("Network.requestWillBeSent", (event) => {
      this.lastNetworkProgressAt = Date.now();
      this.clockOffsetMs ??= event.wallTime * 1000 - event.timestamp * 1000;
      const url = new URL(event.request.url);
      if (url.origin !== origin) {
        return;
      }
      const request: PendingRequest = {
        bytes: null,
        endEpoch: null,
        method: event.request.method,
        path: url.pathname + url.search,
        resourceType: event.type ?? "other",
        startEpoch: event.timestamp * 1000 + this.clockOffsetMs,
        status: null,
      };
      this.requestsById.set(event.requestId, request);
      this.requests.push(request);
      if (!LONG_LIVED_RESOURCE_TYPES.has(request.resourceType)) {
        this.inFlightRequestIds.add(event.requestId);
      }
    });
    this.cdp.on("Network.dataReceived", () => {
      this.lastNetworkProgressAt = Date.now();
    });
    this.cdp.on("Network.responseReceived", (event) => {
      this.lastNetworkProgressAt = Date.now();
      const request = this.requestsById.get(event.requestId);
      if (request !== undefined) {
        request.status = event.response.status;
      }
    });
    this.cdp.on("Network.loadingFinished", (event) => {
      this.lastNetworkProgressAt = Date.now();
      this.inFlightRequestIds.delete(event.requestId);
      const request = this.requestsById.get(event.requestId);
      if (request !== undefined && this.clockOffsetMs !== null) {
        request.endEpoch = event.timestamp * 1000 + this.clockOffsetMs;
        request.bytes = event.encodedDataLength;
      }
    });
    this.cdp.on("Network.loadingFailed", (event) => {
      this.inFlightRequestIds.delete(event.requestId);
      const request = this.requestsById.get(event.requestId);
      if (request !== undefined && this.clockOffsetMs !== null) {
        request.endEpoch = event.timestamp * 1000 + this.clockOffsetMs;
        request.status = `failed:${event.errorText}`;
      }
    });
    this.cdp.on("Network.webSocketFrameReceived", (event) => {
      if (this.clockOffsetMs === null) {
        return;
      }
      const payload = event.response.payloadData ?? "";
      this.websocketFrames.push({
        bytes: payload.length,
        epoch: event.timestamp * 1000 + this.clockOffsetMs,
        kind: describeWebSocketPayload(payload),
      });
    });
    this.cdp.on("Page.screencastFrame", (event) => {
      this.frames.push({
        data: event.data,
        epoch: (event.metadata.timestamp ?? 0) * 1000,
      });
      void this.cdp
        .send("Page.screencastFrameAck", { sessionId: event.sessionId })
        .catch(() => undefined);
    });
    await this.applyNetworkProfile(this.options.networkProfile);
    if (this.options.cpuSlowdown > 1) {
      await this.cdp.send("Emulation.setCPUThrottlingRate", {
        rate: this.options.cpuSlowdown,
      });
    }
    if (this.options.cpuProfile) {
      await this.cdp.send("Profiler.enable");
      await this.cdp.send("Profiler.setSamplingInterval", {
        interval: CPU_PROFILE_SAMPLING_INTERVAL_US,
      });
    }
    await this.page.evaluateOnNewDocument(PROBE_SOURCE);
  }

  async applyNetworkProfile(profile: NetworkProfile | null): Promise<void> {
    await this.cdp.send(
      "Network.emulateNetworkConditions",
      profile === null
        ? {
            downloadThroughput: -1,
            latency: 0,
            offline: false,
            uploadThroughput: -1,
          }
        : {
            downloadThroughput: profile.downloadBytesPerSecond,
            latency: profile.latencyMs,
            offline: false,
            uploadThroughput: profile.uploadBytesPerSecond,
          },
    );
  }

  async setOffline(offline: boolean): Promise<void> {
    if (offline) {
      await this.cdp.send("Network.emulateNetworkConditions", {
        downloadThroughput: -1,
        latency: 0,
        offline: true,
        uploadThroughput: -1,
      });
      return;
    }
    await this.applyNetworkProfile(this.options.networkProfile);
  }

  async navigate(url: string, timeoutMs: number): Promise<void> {
    const navigation = this.page.goto(url, {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    });
    navigation.catch(() => undefined);
    let watchdog: NodeJS.Timeout | undefined;
    const stalled = new Promise<never>((_, reject) => {
      watchdog = setInterval(() => {
        const quietMs = Date.now() - this.lastNetworkProgressAt;
        if (
          this.inFlightRequestIds.size > 0 &&
          quietMs >= this.options.navigationStallMs
        ) {
          const pending = [...this.inFlightRequestIds]
            .map((id) => this.requestsById.get(id)?.path ?? id)
            .slice(0, 3)
            .join(", ");
          reject(
            new NavigationStalledError(
              `Navigation stalled: ${this.inFlightRequestIds.size} requests received no data for ${quietMs} ms (${pending})`,
            ),
          );
        }
      }, NAVIGATION_STALL_POLL_MS);
    });
    try {
      await Promise.race([navigation, stalled]);
    } finally {
      clearInterval(watchdog);
    }
  }

  async waitForNetworkQuiet(
    quietMs: number,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
      if (this.inFlightRequestIds.size > 0) {
        quietSince = Date.now();
      } else if (Date.now() - quietSince >= quietMs) {
        return true;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, NETWORK_QUIET_POLL_MS),
      );
    }
    return false;
  }

  async startProbe(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as BbPerfLabWindow).__bbPerfLabProbe.start(false);
    });
  }

  async recordStep(args: RecordStepArgs): Promise<RecordedStep> {
    const requestsFrom = this.requests.length;
    const websocketFramesFrom = this.websocketFrames.length;
    this.frames.length = 0;
    await this.cdp.send("Page.startScreencast", {
      everyNthFrame: 1,
      format: "jpeg",
      quality: 55,
    });
    if (this.options.cpuProfile) {
      await this.cdp.send("Profiler.start");
    }
    await args.action();
    await new Promise((resolve) => setTimeout(resolve, args.recordMs));
    const profile = this.options.cpuProfile
      ? (await this.cdp.send("Profiler.stop")).profile
      : null;
    const collected = await this.page.evaluate(
      () =>
        (
          window as unknown as BbPerfLabWindow
        ).__bbPerfLabProbe.collect() as unknown,
    );
    await this.cdp.send("Page.stopScreencast");
    const probe = collected as ProbeCollection;
    const relative = (epoch: number) => Math.round(epoch - probe.t0Epoch);
    let cpuProfile: RecordedCpuProfile | null = null;
    if (profile !== null) {
      if (this.clockOffsetMs === null) {
        throw new Error(
          "The CPU profile cannot be aligned: the page made no request.",
        );
      }
      cpuProfile = {
        profile,
        startOffsetMs:
          profile.startTime / 1000 + this.clockOffsetMs - probe.t0Epoch,
      };
    }
    mkdirSync(args.framesDir, { recursive: true });
    const frames: FilmstripFrame[] = [];
    let previousData: string | null = null;
    for (const frame of this.frames) {
      if (frame.data === previousData) {
        continue;
      }
      previousData = frame.data;
      const at = Math.max(0, relative(frame.epoch));
      const file = join(args.framesDir, `${String(at).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(frame.data, "base64"));
      frames.push({ at, file });
    }
    const recording: Recording = {
      cpuProfileStartMs: cpuProfile?.startOffsetMs ?? null,
      frames,
      loafs: probe.loafs,
      network: this.requests.slice(requestsFrom).map((request) => ({
        bytes: request.bytes,
        end: request.endEpoch === null ? null : relative(request.endEpoch),
        method: request.method,
        path: request.path,
        resourceType: request.resourceType,
        start: relative(request.startEpoch),
        status: request.status,
      })),
      samples: probe.samples,
      shifts: probe.shifts,
      step: args.step,
      targetPath: args.targetPath,
      targetThreadId: args.targetThreadId,
      traceEntries: probe.traceEntries,
      websocketFrames: this.websocketFrames
        .slice(websocketFramesFrom)
        .map((frame) => ({
          at: relative(frame.epoch),
          bytes: frame.bytes,
          kind: frame.kind,
        })),
    };
    return { cpuProfile, recording };
  }

  async renderContactSheet(
    title: string,
    frames: readonly FilmstripFrame[],
    times: readonly number[],
    outFile: string,
  ): Promise<void> {
    const cells = times
      .map((time) => {
        const frame = frames.filter((candidate) => candidate.at <= time).at(-1);
        if (frame === undefined) {
          return `<figure><div class="empty"></div><figcaption>t=${time}ms (no frame)</figcaption></figure>`;
        }
        const data = readFileSync(frame.file).toString("base64");
        return `<figure><img src="data:image/jpeg;base64,${data}"><figcaption>t=${time}ms (frame ${frame.at}ms)</figcaption></figure>`;
      })
      .join("");
    const sheet = await this.browser.newPage();
    await sheet.setViewport({ height: 1200, width: 1800 });
    await sheet.setContent(
      `<!doctype html><style>body{margin:0;font:12px sans-serif;background:#222;color:#eee}h1{font-size:14px;margin:6px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px}figure{margin:0}img{width:100%;display:block;border:1px solid #555}.empty{aspect-ratio:${this.options.width}/${this.options.height};background:#444}</style><h1>${escapeHtml(title)}</h1><main>${cells}</main>`,
    );
    await sheet.screenshot({
      fullPage: true,
      path: outFile as `${string}.png`,
    });
    await sheet.close();
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

interface BbPerfLabProbe {
  collect: () => unknown;
  start: (fromNavigation: boolean) => number;
}

interface BbPerfLabWindow {
  __bbPerfLabProbe: BbPerfLabProbe;
}

function describeWebSocketPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const kind = parsed["type"] ?? parsed["kind"] ?? parsed["event"];
    return typeof kind === "string"
      ? kind.slice(0, 60)
      : Object.keys(parsed).slice(0, 3).join(",");
  } catch {
    return payload.slice(0, 60);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
