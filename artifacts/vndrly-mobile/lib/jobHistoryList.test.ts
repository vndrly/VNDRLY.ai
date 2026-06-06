import { describe, expect, it } from "vitest";

import {
  closedJobWithinDays,
  mergeOpenAndRecentClosedJobs,
  type ClosedJobRow,
  type OpenJobRow,
} from "./jobHistoryList";

const NOW = new Date("2026-06-05T12:00:00Z").getTime();

describe("mergeOpenAndRecentClosedJobs", () => {
  const open: OpenJobRow[] = [
    {
      id: 1,
      status: "in_progress",
      siteName: "Open Site",
      partnerName: null,
      workTypeName: "Repair",
      fieldEmployeeFirstName: "Alex",
      fieldEmployeeLastName: "Lee",
      createdAt: "2026-06-01T10:00:00Z",
      updatedAt: "2026-06-04T10:00:00Z",
      unreadCommentCount: 2,
    },
  ];

  const closedRecent: ClosedJobRow = {
    id: 2,
    status: "completed",
    siteName: "Closed Site",
    partnerName: "Partner",
    workTypeName: "Install",
    checkOutTime: "2026-05-20T08:00:00Z",
    createdAt: "2026-05-20T06:00:00Z",
    updatedAt: "2026-05-20T08:00:00Z",
  };

  const closedOld: ClosedJobRow = {
    id: 3,
    status: "completed",
    siteName: "Old Site",
    partnerName: null,
    workTypeName: "Install",
    checkOutTime: "2026-04-01T08:00:00Z",
    createdAt: "2026-04-01T06:00:00Z",
    updatedAt: "2026-04-01T08:00:00Z",
  };

  it("includes open jobs and closed jobs within 30 days", () => {
    const merged = mergeOpenAndRecentClosedJobs(
      open,
      [closedRecent, closedOld],
      30,
      NOW,
    );
    expect(merged.map((row) => row.id)).toEqual([1, 2]);
    expect(merged[0]?.isClosed).toBe(false);
    expect(merged[1]?.isClosed).toBe(true);
  });

  it("dedupes when a ticket appears in both lists", () => {
    const merged = mergeOpenAndRecentClosedJobs(
      open,
      [{ ...closedRecent, id: 1 }],
      30,
      NOW,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.isClosed).toBe(false);
  });
});

describe("closedJobWithinDays", () => {
  it("uses checkOutTime when present", () => {
    expect(
      closedJobWithinDays(
        {
          checkOutTime: "2026-05-20T08:00:00Z",
          updatedAt: null,
          createdAt: "2026-05-01T08:00:00Z",
        },
        30,
        NOW,
      ),
    ).toBe(true);
  });
});
