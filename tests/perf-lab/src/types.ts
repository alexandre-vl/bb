export interface ProbeSample {
  at: number;
  atBottom: boolean | null;
  composerBoxHeight: number | null;
  composerFooterControls: string;
  composerFooterText: string | null;
  composerRect: string | null;
  composerStackText: string | null;
  hasTimeline: boolean;
  headerControls: string;
  headerText: string | null;
  panelWidth: number | null;
  path: string;
  scrollHeight: number | null;
  scrollTop: number | null;
  scrollToLatest: boolean;
  skeletons: number;
  spinners: string;
  title: string;
  toc: boolean;
  viewportTextHash: string;
  viewportTextHead: string;
}

export type RawProbeSample =
  | ProbeSample
  | { at: number; empty: true }
  | { at: number; error: string };

export interface LayoutShiftSource {
  current: number[] | null;
  node: string | null;
  previous: number[] | null;
}

export interface LayoutShiftEntry {
  at: number;
  hadRecentInput: boolean;
  sources: LayoutShiftSource[];
  value: number;
}

export interface LongFrameScript {
  duration: number;
  function: string | null;
  invoker: string | null;
  source: string | null;
}

export interface LongFrameEntry {
  at: number;
  blockingDuration: number;
  duration: number;
  renderStart: number;
  scripts: LongFrameScript[];
}

export interface TraceEntry {
  at: number;
  detail: Record<string, unknown> | null;
  duration: number;
  kind: "mark" | "measure";
  name: string;
}

export interface NetworkRequest {
  bytes: number | null;
  end: number | null;
  method: string;
  path: string;
  resourceType: string;
  start: number;
  status: number | string | null;
}

export interface WebSocketFrame {
  at: number;
  bytes: number;
  kind: string;
}

export interface FilmstripFrame {
  at: number;
  file: string;
}

export interface Recording {
  frames: FilmstripFrame[];
  loafs: LongFrameEntry[];
  network: NetworkRequest[];
  samples: RawProbeSample[];
  shifts: LayoutShiftEntry[];
  step: string;
  targetPath: string | null;
  targetThreadId: string | null;
  traceEntries: TraceEntry[];
  websocketFrames: WebSocketFrame[];
}

export interface VisibleChange {
  at: number;
  count: number;
  field: string;
  from: string;
  to: string;
  until: number;
}

export interface QueryTiming {
  at: number;
  duration: number;
  initial: boolean;
  key: string;
  outcome: string;
}

export interface RecordingAnalysis {
  apiBytes: number;
  apiRequests: number;
  chromeChangesAfterContent: number;
  chromeUpdatesAfterContent: number;
  contentAt: number | null;
  lastApiResponseAt: number | null;
  layoutShiftScore: number;
  longestFrame: number;
  milestones: Record<string, number>;
  queries: QueryTiming[];
  serverErrors: number;
  settledAt: number;
  totalBlockingTime: number;
  visibleChanges: VisibleChange[];
}

export interface MetricSummary {
  max: number;
  median: number;
  min: number;
  p90: number;
  runs: number;
}

export interface ScenarioSummary {
  metrics: Record<string, MetricSummary>;
  scenario: string;
}
