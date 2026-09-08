import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 1, role: "partner", partnerId: 2 } }) }));
vi.mock("@workspace/api-client-react", () => ({ useListSiteLocations: () => ({ data: [{ id: 1, name: "Site One", partnerId: 2, partnerName: "Warwick" }] }) }));
vi.mock("@/components/png-pill-rollover", () => ({ PngPillButton: ({ color: _color, children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("@/lib/gate-report-api", () => ({ loadGateReport: vi.fn() }));
import { loadGateReport } from "@/lib/gate-report-api";
import GateReport from "./gate-report";
beforeEach(() => vi.mocked(loadGateReport).mockReset());
describe("Gate Log report controls", () => {
  it("waits for explicit submit and passes a visitor source independently from category", async () => {
    vi.mocked(loadGateReport).mockResolvedValue({ snapshotId: "snapshot", generatedAt: "2026-09-07T12:00:00Z", filters: { from: "2026-09-01T00:00:00Z", to: "2026-09-08T00:00:00Z", siteLocationId: null, partnerId: null, company: "Midcon", purpose: "", category: "all", recordKind: "visitor" }, rows: [], nextOffset: null, totals: { entries: 0, visitorEntries: 0, employeeCheckins: 0, currentOnsiteEntries: 0, uniqueRecordedIdentities: 0, unidentifiedEntries: 0, incompleteEntries: 0, unclassifiedEntries: 0, pendingAdmissionEntries: 0 } });
    const { container } = render(<GateReport />);
    expect(loadGateReport).not.toHaveBeenCalled();
    fireEvent.change(container.querySelector("#gate-report-source")!, { target: { value: "visitor" } });
    fireEvent.change(container.querySelector("#gate-report-company")!, { target: { value: "Midcon" } });
    expect(loadGateReport).not.toHaveBeenCalled();
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(loadGateReport).toHaveBeenCalled());
    expect(vi.mocked(loadGateReport).mock.calls[0][0]).toMatchObject({ recordKind: "visitor", company: "Midcon", category: "all" });
    await waitFor(() => expect(container.querySelector("#gate-report-print")).not.toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
