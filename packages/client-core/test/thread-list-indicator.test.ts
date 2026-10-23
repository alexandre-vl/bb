import { describe, expect, it } from "vitest";
import {
  THREAD_LIST_INDICATOR_PRECEDENCE,
  getThreadListIndicatorLabel,
  resolveThreadListIndicator,
  rollUpThreadListIndicators,
  threadListIndicatorAttention,
  threadListIndicatorRung,
  type ThreadAttention,
  type ThreadListIndicatorKind,
  type ThreadListIndicatorState,
  type ThreadListRung,
} from "../src/thread/thread-list-indicator.js";

const IDLE: ThreadListIndicatorState = {
  hasPendingInteraction: false,
  hasUnsubmittedDraft: false,
  hasUnreadError: false,
  hasUnreadSuccess: false,
  isBackgroundAgentActive: false,
  isBackgroundCommandActive: false,
  isGoalActive: false,
  isPlanModeActive: false,
  isRuntimeActive: false,
  isWaitingForHost: false,
  isWorkflowActive: false,
  queuedWork: "none",
};

const STATE_FOR_KIND = {
  "waiting-for-input": { hasPendingInteraction: true },
  "unread-error": { hasUnreadError: true },
  "queued-failed": { queuedWork: "failed" },
  "unread-success": { hasUnreadSuccess: true },
  "plan-mode": { isPlanModeActive: true },
  goal: { isGoalActive: true },
  runtime: { isRuntimeActive: true },
  workflow: { isWorkflowActive: true },
  "background-agent": { isBackgroundAgentActive: true },
  "background-command": { isBackgroundCommandActive: true },
  "waiting-for-host": { isWaitingForHost: true },
  "queued-waiting": { queuedWork: "waiting" },
  draft: { hasUnsubmittedDraft: true },
} satisfies Partial<
  Record<ThreadListIndicatorKind, Partial<ThreadListIndicatorState>>
>;

type ResolvableKind = keyof typeof STATE_FOR_KIND;

const RESOLVABLE_KINDS = THREAD_LIST_INDICATOR_PRECEDENCE.filter(
  (kind): kind is ResolvableKind => kind in STATE_FOR_KIND,
);

const RUNNING_KINDS = [
  "plan-mode",
  "goal",
  "runtime",
  "workflow",
  "background-agent",
  "background-command",
] as const satisfies readonly ResolvableKind[];

function stateFor(...kinds: ResolvableKind[]): ThreadListIndicatorState {
  return Object.assign(
    { ...IDLE },
    ...kinds.map((kind) => STATE_FOR_KIND[kind]),
  );
}

const PRECEDENCE_PAIRS = RESOLVABLE_KINDS.flatMap((higher, index) =>
  RESOLVABLE_KINDS.slice(index + 1)
    .filter(
      (lower) =>
        !(
          "queuedWork" in STATE_FOR_KIND[higher] &&
          "queuedWork" in STATE_FOR_KIND[lower]
        ),
    )
    .map((lower) => [higher, lower] as const),
);

describe("resolveThreadListIndicator", () => {
  it("resolves an idle thread to none", () => {
    expect(resolveThreadListIndicator(IDLE)).toBe("none");
  });

  it.each(RESOLVABLE_KINDS)("resolves the %s flag on its own", (kind) => {
    expect(resolveThreadListIndicator(stateFor(kind))).toBe(kind);
  });

  it("puts needs-you first, then failed, new, the running kinds, waiting for its machine, queued, draft", () => {
    expect(RESOLVABLE_KINDS).toEqual([
      "waiting-for-input",
      "unread-error",
      "queued-failed",
      "unread-success",
      "plan-mode",
      "goal",
      "runtime",
      "workflow",
      "background-agent",
      "background-command",
      "waiting-for-host",
      "queued-waiting",
      "draft",
    ]);
  });

  it.each(PRECEDENCE_PAIRS)("resolves %s over %s", (higher, lower) => {
    expect(resolveThreadListIndicator(stateFor(lower, higher))).toBe(higher);
  });

  it.each(RUNNING_KINDS)(
    "shows %s instead of a working draft when the thread holds a draft",
    (kind) => {
      expect(resolveThreadListIndicator(stateFor("draft", kind))).toBe(kind);
    },
  );

  it("never produces working-draft for any combination of flags", () => {
    const resolved = new Set<ThreadListIndicatorKind>();
    for (let mask = 0; mask < 1 << RESOLVABLE_KINDS.length; mask += 1) {
      const kinds = RESOLVABLE_KINDS.filter((_kind, bit) => mask & (1 << bit));
      resolved.add(resolveThreadListIndicator(stateFor(...kinds)));
    }
    expect(resolved.has("working-draft")).toBe(false);
    expect([...resolved].sort()).toEqual([...RESOLVABLE_KINDS, "none"].sort());
  });

  it("keeps the working-draft label for glyph callers that pass it", () => {
    expect(getThreadListIndicatorLabel("working-draft")).toBe(
      "Thread working with unsubmitted draft",
    );
    expect(getThreadListIndicatorLabel("none")).toBeNull();
  });
});

describe("threadListIndicatorRung", () => {
  it.each([
    ["waiting-for-input", 5],
    ["unread-error", 4],
    ["queued-failed", 4],
    ["unread-success", 3],
    ["plan-mode", 2],
    ["goal", 2],
    ["runtime", 2],
    ["workflow", 2],
    ["background-agent", 2],
    ["background-command", 2],
    ["working-draft", 2],
    ["waiting-for-host", 1],
    ["queued-waiting", 1],
    ["draft", 1],
    ["none", 0],
  ] satisfies [ThreadListIndicatorKind, ThreadListRung][])(
    "puts %s on rung %i",
    (kind, rung) => {
      expect(threadListIndicatorRung(kind)).toBe(rung);
    },
  );

  it("lists every kind once, from the highest rung down", () => {
    const rungs = THREAD_LIST_INDICATOR_PRECEDENCE.map(threadListIndicatorRung);
    expect(new Set(THREAD_LIST_INDICATOR_PRECEDENCE).size).toBe(15);
    expect(rungs).toEqual([...rungs].sort((left, right) => right - left));
  });

  it("reads a kind it does not know as settled", () => {
    const future = "future-kind" as ThreadListIndicatorKind;
    expect(threadListIndicatorRung(future)).toBe(0);
    expect(threadListIndicatorAttention(future)).toBeNull();
  });
});

describe("threadListIndicatorAttention", () => {
  it.each([
    ["waiting-for-input", "needs-you"],
    ["unread-error", "failed"],
    ["queued-failed", "failed"],
    ["unread-success", "new"],
    ["plan-mode", null],
    ["goal", null],
    ["runtime", null],
    ["workflow", null],
    ["background-agent", null],
    ["background-command", null],
    ["working-draft", null],
    ["waiting-for-host", null],
    ["queued-waiting", null],
    ["draft", null],
    ["none", null],
  ] satisfies [ThreadListIndicatorKind, ThreadAttention | null][])(
    "maps %s to %s",
    (kind, attention) => {
      expect(threadListIndicatorAttention(kind)).toBe(attention);
    },
  );
});

describe("rollUpThreadListIndicators", () => {
  it("returns none for no input", () => {
    expect(rollUpThreadListIndicators([])).toBe("none");
  });

  it("returns a lone kind unchanged, working-draft included", () => {
    for (const kind of THREAD_LIST_INDICATOR_PRECEDENCE) {
      expect(rollUpThreadListIndicators([kind])).toBe(kind);
    }
  });

  it.each([
    [["draft", "runtime", "unread-success"], "unread-success"],
    [["queued-failed", "waiting-for-input", "none"], "waiting-for-input"],
    [["queued-waiting", "background-command"], "background-command"],
    [["waiting-for-host", "runtime"], "runtime"],
    [["waiting-for-host", "background-command"], "background-command"],
    [["none", "draft", "none"], "draft"],
  ] satisfies [ThreadListIndicatorKind[], ThreadListIndicatorKind][])(
    "takes the highest rung of %j",
    (kinds, expected) => {
      expect(rollUpThreadListIndicators(kinds)).toBe(expected);
      expect(rollUpThreadListIndicators([...kinds].reverse())).toBe(expected);
    },
  );

  it.each([
    [["queued-failed", "unread-error"], "unread-error"],
    [["background-command", "runtime", "goal", "plan-mode"], "plan-mode"],
    [["workflow", "runtime"], "runtime"],
    [["working-draft", "background-command"], "background-command"],
    [["draft", "queued-waiting"], "queued-waiting"],
    [["queued-waiting", "waiting-for-host"], "waiting-for-host"],
  ] satisfies [ThreadListIndicatorKind[], ThreadListIndicatorKind][])(
    "breaks the rung tie in %j by precedence",
    (kinds, expected) => {
      expect(rollUpThreadListIndicators(kinds)).toBe(expected);
      expect(rollUpThreadListIndicators([...kinds].reverse())).toBe(expected);
    },
  );

  it.each(PRECEDENCE_PAIRS)(
    "agrees with the resolver on %s over %s",
    (higher, lower) => {
      const rolledUp = rollUpThreadListIndicators([
        resolveThreadListIndicator(stateFor(lower)),
        resolveThreadListIndicator(stateFor(higher)),
      ]);
      expect(rolledUp).toBe(higher);
      expect(rolledUp).toBe(
        resolveThreadListIndicator(stateFor(lower, higher)),
      );
    },
  );

  it("reads any iterable", () => {
    function* kinds(): Generator<ThreadListIndicatorKind> {
      yield "draft";
      yield "unread-error";
    }
    expect(rollUpThreadListIndicators(kinds())).toBe("unread-error");
    expect(rollUpThreadListIndicators(new Set(["goal", "none"] as const))).toBe(
      "goal",
    );
  });

  it("ignores a kind it does not know", () => {
    expect(
      rollUpThreadListIndicators([
        "future-kind" as ThreadListIndicatorKind,
        "draft",
      ]),
    ).toBe("draft");
    expect(
      rollUpThreadListIndicators(["future-kind" as ThreadListIndicatorKind]),
    ).toBe("none");
  });
});
