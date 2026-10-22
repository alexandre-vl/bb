import { describe, expect, it } from "vitest";
import {
  EMPTY_THREAD_ROLLUP,
  describeThreadRollup,
  hasThreadListWorkingActivity,
  isUnreadDoneThread,
  resolveThreadKindStatus,
  resolveThreadListIndicator,
  rollUpThreadListIndicators,
  rollUpThreads,
  rollUpWithDraft,
  threadAttentionRung,
  threadIndicatorKind,
  threadListIndicatorRung,
  threadListIndicatorStateForThread,
  type ThreadListIndicatorKind,
  type ThreadListIndicatorState,
} from "./thread-activity.js";
import { makeSidebarThread, type SidebarThreadOverrides } from "./fixtures.js";

function makeEntry(overrides: SidebarThreadOverrides = {}) {
  return makeSidebarThread({
    lastReadAt: 100,
    latestAttentionAt: 100,
    ...overrides,
  });
}

const idleIndicatorState: ThreadListIndicatorState = {
  hasPendingInteraction: false,
  hasUnsubmittedDraft: false,
  hasUnreadError: false,
  hasUnreadSuccess: false,
  isBackgroundAgentActive: false,
  isBackgroundCommandActive: false,
  isGoalActive: false,
  queuedWork: "none",
  isPlanModeActive: false,
  isRuntimeActive: false,
  isWorkflowActive: false,
};

const pending = makeEntry({ id: "pending", hasPendingInteraction: true });
const failed = makeEntry({
  id: "failed",
  status: "error",
  latestAttentionAt: 120,
});
const fresh = makeEntry({ id: "fresh", latestAttentionAt: 120 });
const working = makeEntry({
  id: "working",
  status: "active",
  runtimeStatus: "active",
});
const queued = makeEntry({ id: "queued", queuedWork: "waiting" });
const settled = makeEntry({ id: "settled" });

describe("thread-activity", () => {
  describe("resolveThreadListIndicator", () => {
    it("ranks needing input over an unread failure", () => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          hasPendingInteraction: true,
          hasUnreadError: true,
          isRuntimeActive: true,
        }),
      ).toBe("waiting-for-input");
    });

    it("ranks a failed send over a new result and running work", () => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          queuedWork: "failed",
          hasUnreadSuccess: true,
          isRuntimeActive: true,
        }),
      ).toBe("queued-failed");
    });

    it("ranks a new result over running work", () => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          hasUnreadSuccess: true,
          isRuntimeActive: true,
        }),
      ).toBe("unread-success");
    });

    it.each([
      "isRuntimeActive",
      "isWorkflowActive",
      "isBackgroundAgentActive",
      "isBackgroundCommandActive",
      "isPlanModeActive",
      "isGoalActive",
    ] as const)("shows running work over a draft with %s", (flag) => {
      const kind = resolveThreadListIndicator({
        ...idleIndicatorState,
        hasUnsubmittedDraft: true,
        [flag]: true,
      });
      expect(kind).not.toBe("working-draft");
      expect(threadListIndicatorRung(kind)).toBe(2);
    });

    it("shows the queued clock over a draft", () => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          hasUnsubmittedDraft: true,
          queuedWork: "waiting",
        }),
      ).toBe("queued-waiting");
    });
  });

  describe("rollUpThreadListIndicators", () => {
    it.each<[ThreadListIndicatorKind[], ThreadListIndicatorKind]>([
      [[], "none"],
      [["draft", "runtime"], "runtime"],
      [["runtime", "unread-success"], "unread-success"],
      [["queued-failed", "unread-error"], "unread-error"],
      [["unread-error", "waiting-for-input"], "waiting-for-input"],
      [["queued-waiting", "draft"], "queued-waiting"],
      [["workflow", "plan-mode"], "plan-mode"],
    ])("rolls %j up to %s", (kinds, expected) => {
      expect(rollUpThreadListIndicators(kinds)).toBe(expected);
    });
  });

  describe("isUnreadDoneThread", () => {
    it("treats a finished unread child like a root", () => {
      expect(isUnreadDoneThread({ status: "error", isUnread: true })).toBe(
        true,
      );
      expect(isUnreadDoneThread({ status: "idle", isUnread: true })).toBe(
        true,
      );
      expect(isUnreadDoneThread({ status: "active", isUnread: true })).toBe(
        false,
      );
    });

    it("shows a failed child as failed", () => {
      const child = makeEntry({
        parentThreadId: "parent",
        status: "error",
        latestAttentionAt: 120,
      });
      expect(threadIndicatorKind(child)).toBe("unread-error");
      expect(threadAttentionRung(child)).toBe(4);
    });
  });

  describe("threadListIndicatorStateForThread", () => {
    it("marks an unread error thread as an unread error, not a success", () => {
      const thread = makeEntry({
        status: "error",
        latestAttentionAt: 120,
      });

      expect(threadListIndicatorStateForThread(thread, false)).toMatchObject({
        hasUnreadError: true,
        hasUnreadSuccess: false,
        hasUnsubmittedDraft: false,
      });
    });

    it("fills activity flags from the list entry", () => {
      const thread = makeEntry({
        hasPendingInteraction: true,
        queuedWork: "waiting",
        activity: {
          workflows: 1,
          backgroundAgents: 0,
          backgroundCommands: 1,
          planMode: 0,
          goals: 1,
        },
        runtimeStatus: "active",
      });

      expect(threadListIndicatorStateForThread(thread, true)).toEqual({
        hasPendingInteraction: true,
        hasUnsubmittedDraft: true,
        hasUnreadError: false,
        hasUnreadSuccess: false,
        isBackgroundAgentActive: false,
        isBackgroundCommandActive: true,
        isGoalActive: true,
        queuedWork: "waiting",
        isPlanModeActive: false,
        isRuntimeActive: true,
        isWorkflowActive: true,
      });
    });

    it("counts a running plugin status as working activity", () => {
      expect(hasThreadListWorkingActivity(idleIndicatorState)).toBe(false);
      expect(hasThreadListWorkingActivity(idleIndicatorState, true)).toBe(true);
    });
  });

  describe("threadAttentionRung", () => {
    it.each([
      ["needs you", pending, 5],
      ["failed", failed, 4],
      ["new", fresh, 3],
      ["working", working, 0],
      ["queued", queued, 0],
      ["settled", settled, 0],
    ] as const)("ranks a %s thread at %#", (_name, thread, rung) => {
      expect(threadAttentionRung(thread)).toBe(rung);
    });
  });

  describe("resolveThreadKindStatus", () => {
    const rowStatus = {
      icon: "AiContentGenerator01",
      tone: "running",
      label: "Deploying",
    } as const;

    it("shows a plugin row status only over a draft or nothing", () => {
      expect(
        resolveThreadKindStatus("draft", rowStatus).rowStatusIsVisible,
      ).toBe(true);
      expect(
        resolveThreadKindStatus("none", rowStatus).rowStatusIsVisible,
      ).toBe(true);
      expect(
        resolveThreadKindStatus("runtime", rowStatus).rowStatusIsVisible,
      ).toBe(false);
      expect(
        resolveThreadKindStatus("unread-success", rowStatus),
      ).toMatchObject({
        rowStatusIsVisible: false,
        accessibleLabel: "Unread thread succeeded",
      });
    });
  });

  describe("rollUpThreads", () => {
    it("returns the empty rollup for no threads", () => {
      expect(rollUpThreads([])).toBe(EMPTY_THREAD_ROLLUP);
    });

    it("counts each state and keeps the highest rung", () => {
      const rollup = rollUpThreads([
        settled,
        working,
        fresh,
        failed,
        queued,
        working,
      ]);
      expect(rollup.kind).toBe("unread-error");
      expect(rollup.threadIds).toEqual([
        "settled",
        "working",
        "fresh",
        "failed",
        "queued",
        "working",
      ]);
      expect(rollup.counts).toEqual({
        needsYou: 0,
        failed: 1,
        fresh: 1,
        working: 2,
        queued: 1,
      });
    });

    it("lets a hidden draft show only over settled threads", () => {
      expect(rollUpWithDraft(rollUpThreads([settled]), true)).toBe("draft");
      expect(rollUpWithDraft(rollUpThreads([queued]), true)).toBe(
        "queued-waiting",
      );
      expect(rollUpWithDraft(rollUpThreads([working]), true)).toBe("runtime");
      expect(rollUpWithDraft(rollUpThreads([settled]), false)).toBe("none");
    });
  });

  describe("describeThreadRollup", () => {
    it("names the total and every non-zero state in ladder order", () => {
      expect(
        describeThreadRollup(
          rollUpThreads([working, failed, pending, working, fresh, settled]),
          "sub-agent",
          "sub-agents",
        ),
      ).toBe(
        "6 sub-agents: 1 needs your input, 1 failed, 1 new result, 2 working",
      );
    });

    it("uses singular nouns and omits an empty detail", () => {
      expect(
        describeThreadRollup(rollUpThreads([settled]), "thread", "threads"),
      ).toBe("1 thread");
      expect(
        describeThreadRollup(
          rollUpThreads([pending, pending]),
          "thread",
          "threads",
        ),
      ).toBe("2 threads: 2 need your input");
    });
  });
});
