import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPortalTicketsForHome, mapPortalTicket } from "./portal-tickets";

const apiFetch = vi.fn();

vi.mock("./api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

describe("fetchPortalTicketsForHome", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("loads Site tickets from GET /api/tickets (same as web Tracking)", async () => {
    apiFetch.mockResolvedValue([
      {
        id: 2,
        status: "kicked_back",
        siteLocationId: 10,
        siteName: "Tiger 7",
        partnerName: "ExxonMobil",
        vendorName: "Baker",
        workTypeName: "Mobilization",
        fieldEmployeeId: 1,
        fieldEmployeeName: "Joe Boggs",
        createdAt: "2026-06-01T12:00:00.000Z",
        updatedAt: "2026-06-20T08:00:00.000Z",
        unreadCommentCount: 0,
      },
      {
        id: 1,
        status: "in_progress",
        siteLocationId: 11,
        siteName: "Pad 2",
        partnerName: "ExxonMobil",
        vendorName: "Baker",
        workTypeName: "Roustabout",
        fieldEmployeeId: 2,
        fieldEmployeeName: "Sam Lee",
        createdAt: "2026-06-02T12:00:00.000Z",
        updatedAt: "2026-06-19T08:00:00.000Z",
        unreadCommentCount: 1,
      },
    ]);

    const rows = await fetchPortalTicketsForHome();

    expect(apiFetch).toHaveBeenCalledWith("/api/tickets");
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(rows[0]?.fieldEmployeeFirstName).toBe("Joe");
    expect(rows[0]?.fieldEmployeeLastName).toBe("Boggs");
  });

  it("mapPortalTicket splits a full employee name", () => {
    const row = mapPortalTicket({
      id: 9,
      status: "submitted",
      siteLocationId: 3,
      siteName: "Tiger 7",
      partnerName: "ExxonMobil",
      vendorName: "Baker",
      workTypeName: "Mob",
      fieldEmployeeId: 4,
      fieldEmployeeName: "Joe Boggs",
      createdAt: "2026-06-01T12:00:00.000Z",
      updatedAt: "2026-06-20T08:00:00.000Z",
      unreadCommentCount: 2,
    });
    expect(row.fieldEmployeeFirstName).toBe("Joe");
    expect(row.fieldEmployeeLastName).toBe("Boggs");
  });
});
