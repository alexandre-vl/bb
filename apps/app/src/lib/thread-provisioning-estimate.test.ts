import { describe, expect, it } from "vitest";
import type {
  TimelineProvisioningEstimate,
  TimelineRowStatus,
} from "@bb/server-contract";
import { systemRow } from "@/test/fixtures/thread-timeline-rows";
import { findActiveProvisioningEstimate } from "./thread-provisioning-estimate";

const ESTIMATE: TimelineProvisioningEstimate = {
  p50Ms: 12_000,
  p90Ms: 20_000,
  runCount: 4,
  scope: "all-projects",
};

function provisioningRow(id: string, status: TimelineRowStatus) {
  return systemRow({
    id,
    startedAt: 5_000,
    operationKind: "thread-provisioning",
    status,
    estimate: status === "pending" ? ESTIMATE : null,
  });
}

describe("findActiveProvisioningEstimate", () => {
  it("reads the estimate of the running provisioning row", () => {
    expect(
      findActiveProvisioningEstimate([
        provisioningRow("first", "error"),
        provisioningRow("retry", "pending"),
      ]),
    ).toEqual({ p50Ms: 12_000, p90Ms: 20_000, startedAt: 5_000 });
  });

  it("reads the running row's estimate when a row after it was interrupted", () => {
    expect(
      findActiveProvisioningEstimate([
        provisioningRow("own", "pending"),
        provisioningRow("initiator", "interrupted"),
      ]),
    ).toEqual({ p50Ms: 12_000, p90Ms: 20_000, startedAt: 5_000 });
  });

  it("has nothing once the latest provisioning finished", () => {
    expect(
      findActiveProvisioningEstimate([
        provisioningRow("first", "interrupted"),
        provisioningRow("retry", "completed"),
        systemRow({ id: "compaction", operationKind: "compaction" }),
      ]),
    ).toBeNull();
  });
});
