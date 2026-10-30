import { describe, expect, it } from "vitest";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import {
  keepHostsChangedOnlyByHeartbeat,
  selectHosts,
  selectPrimaryHost,
} from "./host-queries";

function host(overrides: Partial<Host> & Pick<Host, "id">): Host {
  return makeHost({
    name: overrides.id,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

describe("selectPrimaryHost", () => {
  it("returns the server-resolved primary even when another host connected first", () => {
    const hosts = [host({ id: "host_a" }), host({ id: "host_b" })];
    expect(selectPrimaryHost(hosts, "host_b")?.id).toBe("host_b");
  });

  it("does not promote another machine when the server primary is not in the list", () => {
    const hosts = [host({ id: "host_a" })];
    expect(selectPrimaryHost(hosts, "host_gone")).toBeNull();
  });

  it("falls back to the connected-first heuristic only without a server value", () => {
    const hosts = [
      host({ id: "host_stale", status: "disconnected" }),
      host({ id: "host_live" }),
    ];
    expect(selectPrimaryHost(hosts, null)?.id).toBe("host_live");
    expect(selectPrimaryHost([hosts[0]], null)?.id).toBe("host_stale");
  });

  it("allows a provider-made host to be selected as primary", () => {
    const sandbox = host({
      id: "host_modal",
      machineProviderId: "modal-sandbox",
    });
    const laptop = host({ id: "host_laptop", status: "disconnected" });
    expect(selectPrimaryHost([sandbox], null)?.id).toBe(sandbox.id);
    expect(selectPrimaryHost([sandbox], sandbox.id)?.id).toBe(sandbox.id);
    expect(selectPrimaryHost([sandbox, laptop], null)?.id).toBe(sandbox.id);
  });

  it("returns null for an empty or missing host list", () => {
    expect(selectPrimaryHost(undefined, "host_a")).toBeNull();
    expect(selectPrimaryHost([], null)).toBeNull();
  });
});

describe("selectHosts", () => {
  const hosts = [
    host({ id: "host_local", type: "persistent" }),
    host({
      id: "host_modal",
      type: "ephemeral",
      machineProviderId: "modal-sandbox",
    }),
  ];

  it("drops disposable sandboxes from machine choices", () => {
    expect(
      selectHosts(hosts, "persistent").map((candidate) => candidate.id),
    ).toEqual(["host_local"]);
  });

  it("keeps every machine when a caller asks for all of them", () => {
    expect(selectHosts(hosts, "all").map((candidate) => candidate.id)).toEqual([
      "host_local",
      "host_modal",
    ]);
  });
});

describe("keepHostsChangedOnlyByHeartbeat", () => {
  const laptop = host({ id: "host_laptop", lastSeenAt: 1 });
  const sandbox = host({ id: "host_sandbox", lastSeenAt: 1 });

  function heartbeat(previous: Host, at: number): Host {
    return { ...previous, lastSeenAt: at, updatedAt: at };
  }

  it("keeps a connected host whose only change is a newer heartbeat", () => {
    const next = keepHostsChangedOnlyByHeartbeat(
      [laptop, sandbox],
      [heartbeat(laptop, 9), heartbeat(sandbox, 9)],
    );
    expect(next[0]).toBe(laptop);
    expect(next[1]).toBe(sandbox);
  });

  it("takes the new host when anything besides the heartbeat changed", () => {
    const changes: Host[] = [
      { ...heartbeat(laptop, 9), status: "disconnected" },
      { ...heartbeat(laptop, 9), name: "Renamed" },
      {
        ...heartbeat(laptop, 9),
        lifecycle: { ...laptop.lifecycle, phase: "suspending" },
      },
    ];
    for (const changed of changes) {
      expect(keepHostsChangedOnlyByHeartbeat([laptop], [changed])[0]).toBe(
        changed,
      );
    }
  });

  it("takes a disconnected host's new last-seen time", () => {
    const offline = host({
      id: "host_laptop",
      lastSeenAt: 1,
      status: "disconnected",
    });
    const seenAgain = heartbeat(offline, 9);
    expect(keepHostsChangedOnlyByHeartbeat([offline], [seenAgain])[0]).toBe(
      seenAgain,
    );
  });

  it("follows the new list's membership and order", () => {
    const added = host({ id: "host_added" });
    const next = keepHostsChangedOnlyByHeartbeat(
      [laptop, sandbox],
      [added, heartbeat(laptop, 9)],
    );
    expect(next.map((candidate) => candidate.id)).toEqual([
      "host_added",
      "host_laptop",
    ]);
    expect(next[1]).toBe(laptop);
  });
});
