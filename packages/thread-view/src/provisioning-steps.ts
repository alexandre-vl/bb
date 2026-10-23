import { readTerminalOutputLines } from "@bb/domain";
import type {
  TimelineProvisioningStep,
  TimelineRowStatus,
} from "@bb/server-contract";
import type { EventProjectionProvisioningTranscriptEntry } from "./event-projection-types.js";

export const PROVISIONING_FAILED_STEP_OUTPUT_LINE_LIMIT = 20;

interface BuildProvisioningStepsArgs {
  completedAt: number | null;
  errorDetail: string | null;
  startedAt: number;
  status: TimelineRowStatus;
  transcript: readonly EventProjectionProvisioningTranscriptEntry[];
}

interface OpenProvisioningStep {
  family: string;
  index: number;
  outputTail: string[];
}

interface ProvisioningStepsState {
  boundary: number;
  open: OpenProvisioningStep | null;
  steps: TimelineProvisioningStep[];
  stopped: boolean;
}

const STEP_PHASE_KEY_SUFFIX = /-(?:started|completed|failed|cancelled)$/u;
const STEP_CANCELLED_KEY_SUFFIX = /-cancelled$/u;
const PROVISIONING_STOPPED_KEY = "provisioning-stopped";

function provisioningStepFamily(key: string): string {
  return key.replace(STEP_PHASE_KEY_SUFFIX, "");
}

function updateStep(
  state: ProvisioningStepsState,
  index: number,
  change: Partial<TimelineProvisioningStep>,
): void {
  const step = state.steps[index];
  if (step !== undefined) state.steps[index] = { ...step, ...change };
}

function closeOpenStep(
  state: ProvisioningStepsState,
  at: number,
  status: TimelineRowStatus,
): void {
  if (state.open === null) return;
  const { index, outputTail } = state.open;
  updateStep(state, index, {
    status,
    completedAt: at,
    output:
      status === "error" && outputTail.length > 0
        ? outputTail.join("\n")
        : null,
  });
  state.boundary = at;
  state.open = null;
}

function pushStep(
  state: ProvisioningStepsState,
  step: TimelineProvisioningStep,
): void {
  state.steps.push(step);
  if (state.open === null) state.boundary = step.completedAt ?? state.boundary;
}

function closingStatus(
  entry: EventProjectionProvisioningTranscriptEntry,
): TimelineRowStatus {
  if (STEP_CANCELLED_KEY_SUFFIX.test(entry.key)) return "interrupted";
  return entry.status === "failed" ? "error" : "completed";
}

function applyStepEntry(
  state: ProvisioningStepsState,
  entry: EventProjectionProvisioningTranscriptEntry,
): void {
  if (state.stopped) return;
  if (entry.key === PROVISIONING_STOPPED_KEY) {
    closeOpenStep(state, entry.receivedAt, "interrupted");
    state.stopped = true;
    pushStep(state, {
      label: entry.text,
      status: "completed",
      startedAt: entry.receivedAt,
      completedAt: entry.receivedAt,
      output: null,
    });
    return;
  }
  const family = provisioningStepFamily(entry.key);
  const phase = entry.status ?? "started";
  if (phase === "started") {
    if (state.open?.family === family) return;
    closeOpenStep(state, entry.receivedAt, "completed");
    state.steps.push({
      label: entry.text,
      status: "pending",
      startedAt: state.boundary,
      completedAt: null,
      output: null,
    });
    state.open = { family, index: state.steps.length - 1, outputTail: [] };
    return;
  }
  const status = closingStatus(entry);
  if (
    state.open?.family === family ||
    (status !== "completed" && state.open !== null)
  ) {
    closeOpenStep(state, entry.receivedAt, status);
    return;
  }
  if (status !== "completed") {
    if (status === "interrupted" || state.steps.at(-1)?.status === "error") {
      return;
    }
    pushStep(state, {
      label: entry.text,
      status,
      startedAt: state.boundary,
      completedAt: entry.receivedAt,
      output: null,
    });
    return;
  }
  if (state.steps.some((step) => step.label === entry.text)) return;
  pushStep(state, {
    label: entry.text,
    status: "completed",
    startedAt: state.open === null ? state.boundary : entry.receivedAt,
    completedAt: entry.receivedAt,
    output: null,
  });
}

function applyOutputEntry(
  state: ProvisioningStepsState,
  entry: EventProjectionProvisioningTranscriptEntry,
): void {
  const open = state.open;
  const lines = readTerminalOutputLines(entry.text);
  if (state.stopped || open === null || lines.length === 0) return;
  open.outputTail.push(...lines);
  open.outputTail.splice(
    0,
    open.outputTail.length - PROVISIONING_FAILED_STEP_OUTPUT_LINE_LIMIT,
  );
  updateStep(state, open.index, { output: lines.at(-1) ?? null });
}

export function buildProvisioningSteps(
  args: BuildProvisioningStepsArgs,
): TimelineProvisioningStep[] {
  const state: ProvisioningStepsState = {
    boundary: args.startedAt,
    open: null,
    steps: [],
    stopped: false,
  };
  let lastReceivedAt = args.startedAt;
  for (const entry of args.transcript) {
    lastReceivedAt = Math.max(lastReceivedAt, entry.receivedAt);
    if (entry.type === "step") {
      applyStepEntry(state, entry);
    } else {
      applyOutputEntry(state, entry);
    }
  }
  if (args.status !== "pending") {
    closeOpenStep(state, args.completedAt ?? lastReceivedAt, args.status);
  }
  return withoutErrorDetailLines(state.steps, args.errorDetail);
}

function withoutErrorDetailLines(
  steps: TimelineProvisioningStep[],
  errorDetail: string | null,
): TimelineProvisioningStep[] {
  const detailLines = new Set(
    (errorDetail ?? "").split("\n").map((line) => line.trim()),
  );
  return steps.map((step) => {
    if (step.status !== "error" || step.output === null) return step;
    const output = step.output
      .split("\n")
      .filter((line) => !detailLines.has(line.trim()))
      .join("\n");
    return { ...step, output: output.length > 0 ? output : null };
  });
}
