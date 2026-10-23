import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  isUnreadDoneThread,
  threadListIndicatorStateForThread,
} from "../src/thread/thread-activity.js";
import { resolveThreadListIndicator } from "../src/thread/thread-list-indicator.js";

describe("isUnreadDoneThread", () => {
  it.each([
    ["idle", true],
    ["error", true],
    ["active", false],
    ["starting", false],
    ["stopping", false],
    ["pending", false],
  ] as const)("treats an unread %s thread as done: %s", (status, done) => {
    expect(
      isUnreadDoneThread({ status, latestAttentionAt: 20, lastReadAt: 10 }),
    ).toBe(done);
  });

  it("treats a read thread as not unread", () => {
    expect(
      isUnreadDoneThread({
        status: "error",
        latestAttentionAt: 20,
        lastReadAt: 20,
      }),
    ).toBe(false);
  });

  it("counts child threads like roots", () => {
    expect(
      isUnreadDoneThread(
        makeThreadListEntry({
          parentThreadId: "thr_parent",
          status: "error",
          latestAttentionAt: 20,
          lastReadAt: 10,
        }),
      ),
    ).toBe(true);
  });
});

describe("threadListIndicatorStateForThread", () => {
  it("marks an unread error thread as an unread error, not a success", () => {
    const thread = makeThreadListEntry({
      status: "error",
      latestAttentionAt: 20,
      lastReadAt: 10,
    });

    expect(threadListIndicatorStateForThread(thread, false)).toMatchObject({
      hasUnreadError: true,
      hasUnreadSuccess: false,
      hasUnsubmittedDraft: false,
    });
  });

  it("marks an unread idle thread as an unread success and passes the draft flag through", () => {
    const thread = makeThreadListEntry({
      status: "idle",
      latestAttentionAt: 20,
      lastReadAt: 10,
    });

    expect(threadListIndicatorStateForThread(thread, true)).toMatchObject({
      hasUnreadError: false,
      hasUnreadSuccess: true,
      hasUnsubmittedDraft: true,
    });
  });

  it("shows a failed child as failed", () => {
    const child = makeThreadListEntry({
      parentThreadId: "thr_parent",
      status: "error",
      latestAttentionAt: 20,
      lastReadAt: 10,
    });

    expect(
      resolveThreadListIndicator(
        threadListIndicatorStateForThread(child, false),
      ),
    ).toBe("unread-error");
  });

  it("shows a child marked unread as new, and a read child as settled", () => {
    const markedUnread = makeThreadListEntry({
      parentThreadId: "thr_parent",
      status: "idle",
      latestAttentionAt: 20,
      lastReadAt: null,
    });
    const read = makeThreadListEntry({
      parentThreadId: "thr_parent",
      status: "idle",
    });

    expect(
      resolveThreadListIndicator(
        threadListIndicatorStateForThread(markedUnread, false),
      ),
    ).toBe("unread-success");
    expect(
      resolveThreadListIndicator(
        threadListIndicatorStateForThread(read, false),
      ),
    ).toBe("none");
  });

  it("fills activity flags from the list entry", () => {
    const thread = makeThreadListEntry({
      hasPendingInteraction: true,
      queuedWork: "waiting",
      activity: {
        activeWorkflowCount: 1,
        activeBackgroundAgentCount: 0,
        activeBackgroundCommandCount: 1,
        activePlanModeCount: 0,
        activeGoalCount: 1,
      },
      runtime: { displayStatus: "active" },
    });

    expect(threadListIndicatorStateForThread(thread, false)).toEqual({
      hasPendingInteraction: true,
      hasUnsubmittedDraft: false,
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
});
