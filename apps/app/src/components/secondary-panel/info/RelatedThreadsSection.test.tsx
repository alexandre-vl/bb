// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { RelatedThreadsSection } from "./RelatedThreadsSection";

afterEach(cleanup);

function child(
  id: string,
  overrides: Parameters<typeof makeThreadListEntry>[0],
) {
  return makeThreadListEntry({
    id,
    title: id,
    parentThreadId: "thr_parent",
    ...overrides,
  });
}

describe("RelatedThreadsSection", () => {
  it("shows a failed or unread child's status and the idle icon for a settled one", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <RelatedThreadsSection
            label="Child threads"
            idleIcon="ChildThread"
            threads={[
              child("thr_failed", {
                status: "error",
                lastReadAt: 1,
                latestAttentionAt: 9,
              }),
              child("thr_marked_unread", { lastReadAt: null }),
              child("thr_settled", {}),
            ]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Unread thread failed")).toBeTruthy();
    expect(screen.getByLabelText("Unread thread succeeded")).toBeTruthy();
    expect(
      container.querySelectorAll('[data-icon="ChildThread"]'),
    ).toHaveLength(1);
  });
});
