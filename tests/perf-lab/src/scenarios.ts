export const THREAD_ROLES = ["primary", "secondary", "tertiary"] as const;

export type ThreadRole = (typeof THREAD_ROLES)[number];

export type ScenarioStep =
  | { kind: "open"; measure: boolean; thread: ThreadRole }
  | { kind: "click"; measure: boolean; thread: ThreadRole }
  | { kind: "hover"; ms: number; thread: ThreadRole }
  | { kind: "back"; measure: boolean }
  | { kind: "idle"; ms: number }
  | { kind: "offline"; measure: boolean; ms: number };

export interface ScenarioOptions {
  settleMs: number;
  staleMs: number;
}

export interface ScenarioDefinition {
  description: string;
  steps: (options: ScenarioOptions) => ScenarioStep[];
}

const openPrimary = (options: ScenarioOptions): ScenarioStep[] => [
  { kind: "open", measure: false, thread: "primary" },
  { kind: "idle", ms: options.settleMs },
];

export const SCENARIOS: Record<string, ScenarioDefinition> = {
  "cold-open": {
    description:
      "Load the app directly on the primary thread URL in a fresh browser profile.",
    steps: () => [{ kind: "open", measure: true, thread: "primary" }],
  },
  "switch-new": {
    description:
      "From the primary thread, click the secondary thread in the sidebar (never opened in this browser).",
    steps: (options) => [
      ...openPrimary(options),
      { kind: "click", measure: true, thread: "secondary" },
    ],
  },
  "switch-cached": {
    description:
      "Visit the secondary thread, then click back to the primary thread while its data is cached and fresh.",
    steps: (options) => [
      ...openPrimary(options),
      { kind: "click", measure: false, thread: "secondary" },
      { kind: "idle", ms: options.settleMs },
      { kind: "click", measure: true, thread: "primary" },
    ],
  },
  "return-stale": {
    description:
      "Visit the secondary thread, wait --stale-ms (default past the 5-minute query gcTime), then click back to the primary thread.",
    steps: (options) => [
      ...openPrimary(options),
      { kind: "click", measure: false, thread: "secondary" },
      { kind: "idle", ms: options.staleMs },
      { kind: "click", measure: true, thread: "primary" },
    ],
  },
  "history-back": {
    description:
      "Visit the secondary thread, then use browser history to go back to the primary thread.",
    steps: (options) => [
      ...openPrimary(options),
      { kind: "click", measure: false, thread: "secondary" },
      { kind: "idle", ms: options.settleMs },
      { kind: "back", measure: true },
    ],
  },
  "hover-switch": {
    description:
      "Hover the secondary thread's sidebar row for 250 ms, then click it (measures prefetch on intent).",
    steps: (options) => [
      ...openPrimary(options),
      { kind: "hover", ms: 250, thread: "secondary" },
      { kind: "click", measure: true, thread: "secondary" },
    ],
  },
  tour: {
    description:
      "Click through secondary, tertiary and back to primary, then go back in history; every step is measured.",
    steps: (options) => [
      ...openPrimary(options),
      { kind: "click", measure: true, thread: "secondary" },
      { kind: "click", measure: true, thread: "tertiary" },
      { kind: "click", measure: true, thread: "primary" },
      { kind: "back", measure: true },
    ],
  },
  reconnect: {
    description:
      "On the primary thread, drop the network for 4 s and record the recovery.",
    steps: (options) => [
      ...openPrimary(options),
      { kind: "offline", measure: true, ms: 4_000 },
    ],
  },
};

export function describeStep(step: ScenarioStep): string {
  switch (step.kind) {
    case "open":
    case "click":
      return `${step.kind}:${step.thread}`;
    case "hover":
      return `hover:${step.thread}:${step.ms}ms`;
    case "back":
      return "back";
    case "idle":
      return `idle:${step.ms}ms`;
    case "offline":
      return `offline:${step.ms}ms`;
  }
}
