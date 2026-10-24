// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProvisioningRemainingMs } from "./useProvisioningRemainingMs";

describe("useProvisioningRemainingMs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down each second, then stops re-rendering past the median", () => {
    vi.useFakeTimers({ now: 50_000 });
    let renders = 0;
    const { result, unmount } = renderHook(() => {
      renders += 1;
      return useProvisioningRemainingMs({
        p50Ms: 3_000,
        p90Ms: 5_000,
        startedAt: 50_000,
      });
    });
    const rendersAfterMount = renders;
    const seen = [result.current];

    for (let second = 0; second < 8; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      seen.push(result.current);
    }

    expect(seen).toEqual([
      3_000,
      2_000,
      1_000,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(renders - rendersAfterMount).toBe(3);

    unmount();
  });
});
