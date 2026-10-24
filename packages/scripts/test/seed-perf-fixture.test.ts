import { describe, expect, it } from "vitest";
import { createMigratedConnection } from "@bb/db/testing";
import { parseStoredThreadEvent } from "@bb/domain";
import { seedPerfFixture } from "../src/lib/seed-perf-fixture.js";

interface SeededEventRow {
  data: string;
  providerThreadId: string | null;
  threadId: string;
  turnId: string | null;
  type: string;
}

describe("seedPerfFixture", () => {
  it("seeds a consistent fixture into a migrated database", () => {
    const db = createMigratedConnection();

    const result = seedPerfFixture(db, {
      hostId: "host_seedtest01",
      workspacesRootPath: "/tmp/seed-workspaces",
      projectCount: 3,
      threadCount: 12,
      eventCount: 600,
      maxThreadEventCount: 9_000,
      openLongThreadCount: 0,
      randomSeed: 7,
    });

    expect(result.projectIds).toHaveLength(3);
    expect(result.threadIds).toHaveLength(12);
    expect(result.eventRowCount).toBeGreaterThan(300);

    const foreignKeyViolations = db.$client.pragma("foreign_key_check");
    expect(foreignKeyViolations).toEqual([]);

    const scopeViolations = db.$client
      .prepare(
        `SELECT COUNT(*) AS violations FROM events
         WHERE (scope_kind = 'turn') != (turn_id IS NOT NULL)`,
      )
      .get();
    expect(scopeViolations).toEqual({ violations: 0 });

    const duplicateSequences = db.$client
      .prepare(
        `SELECT COUNT(*) AS duplicates FROM (
           SELECT thread_id FROM events
           GROUP BY thread_id, sequence HAVING COUNT(*) > 1
         )`,
      )
      .get();
    expect(duplicateSequences).toEqual({ duplicates: 0 });

    const eventRows = db.$client
      .prepare(
        `SELECT thread_id AS threadId, turn_id AS turnId, type,
                provider_thread_id AS providerThreadId, data
         FROM events`,
      )
      .all() as SeededEventRow[];
    expect(eventRows.length).toBeGreaterThan(0);
    const parseFailuresByType = new Map<string, string>();
    for (const row of eventRows) {
      const parsedData: unknown = JSON.parse(row.data);
      try {
        parseStoredThreadEvent({
          data: parsedData as Record<string, unknown>,
          providerThreadId: row.providerThreadId,
          scope:
            row.turnId === null
              ? { kind: "thread" }
              : { kind: "turn", turnId: row.turnId },
          threadId: row.threadId,
          type: row.type as never,
        });
      } catch (error) {
        if (!parseFailuresByType.has(row.type)) {
          parseFailuresByType.set(
            row.type,
            error instanceof Error ? error.message.slice(0, 400) : "unknown",
          );
        }
      }
    }
    expect(Object.fromEntries(parseFailuresByType)).toEqual({});

    const ftsRow = db.$client
      .prepare(
        `SELECT COUNT(*) AS indexed FROM thread_search_segments_fts
         WHERE thread_search_segments_fts MATCH 'test'`,
      )
      .get();
    expect(ftsRow).toBeDefined();

    const secondDb = createMigratedConnection();
    const secondResult = seedPerfFixture(secondDb, {
      hostId: "host_seedtest01",
      workspacesRootPath: "/tmp/seed-workspaces",
      projectCount: 3,
      threadCount: 12,
      eventCount: 600,
      maxThreadEventCount: 9_000,
      openLongThreadCount: 0,
      randomSeed: 7,
    });
    expect(secondResult.threadIds).toEqual(result.threadIds);
    expect(secondResult.eventRowCount).toBe(result.eventRowCount);
    secondDb.$client.close();
    db.$client.close();
  }, 15_000);

  it("keeps the longest transcripts open and caps each one", () => {
    const db = createMigratedConnection();

    seedPerfFixture(db, {
      hostId: "host_seedtest01",
      workspacesRootPath: "/tmp/seed-workspaces",
      projectCount: 2,
      threadCount: 16,
      eventCount: 6_000,
      maxThreadEventCount: 500,
      openLongThreadCount: 3,
      randomSeed: 11,
    });

    const threads = db.$client
      .prepare(
        `SELECT archived_at AS archivedAt, visibility,
                (SELECT COUNT(*) FROM events WHERE events.thread_id = threads.id) AS events
         FROM threads ORDER BY events DESC`,
      )
      .all() as {
      archivedAt: number | null;
      events: number;
      visibility: string;
    }[];
    expect(threads[0]?.events).toBeGreaterThan(400);
    expect(
      Math.max(...threads.map((thread) => thread.events)),
    ).toBeLessThanOrEqual(520);
    expect(
      threads
        .slice(0, 3)
        .map(({ archivedAt, visibility }) => ({ archivedAt, visibility })),
    ).toEqual([
      { archivedAt: null, visibility: "visible" },
      { archivedAt: null, visibility: "visible" },
      { archivedAt: null, visibility: "visible" },
    ]);
    db.$client.close();
  }, 15_000);
});
