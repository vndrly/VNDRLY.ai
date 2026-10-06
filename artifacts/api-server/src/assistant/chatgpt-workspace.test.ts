import { describe, expect, it } from "vitest";
import { workspaceOutput, workspaceRequest, WORKSPACE_HTML } from "./chatgpt-workspace";
const now = new Date("2026-10-05T17:00:00Z");
describe("VNDRLY workspace presentation", () => {
  it("maps only returned reliable positions and preserves freshness states", () => {
    const output = workspaceOutput("fleet", "query_field_trips", {}, { trips: [{ driverName: "Synthetic Driver", vehicleName: "Truck", presenceState: "on_site", trackingState: "active", freshness: "stale", recordedAt: now.toISOString(), location: { latitude: 35, longitude: -97 } }, { driverName: "Redacted Driver", presenceState: "en_route", freshness: "redacted", location: null }] }, now);
    expect(output.fleetMap?.points).toEqual([expect.objectContaining({ label: "Truck · Synthetic Driver", freshness: "stale" })]);
    expect(output.attention).toHaveLength(1);
    expect(workspaceRequest({ view: "fleet" }).sourceTool).toBe("query_field_trips");
    expect(() => workspaceOutput("fleet", "query_field_trips", {}, {}, now)).toThrow("Incomplete");
  });
  it("shows authorized ticket statuses without inventing age or tracking claims", () => {
    const output = workspaceOutput("tickets", "query_tickets", {}, { tickets: [{ id: 42, status: "kicked_back", createdAt: "2026-10-01T12:00:00Z" }, { id: 43, status: "approved" }] }, now);
    expect(output.attention).toEqual([expect.objectContaining({ title: "Ticket 42", attention: "Returned for changes" })]);
    expect(JSON.stringify(output)).not.toMatch(/stale|tracking/i);
    expect(workspaceRequest({ view: "tickets" }).sourceTool).toBe("query_tickets");
    expect(() => workspaceOutput("tickets", "query_tickets", {}, {}, now)).toThrow("Incomplete");
  });
  it("uses canonical personal notification rows and rejects incomplete responses", () => {
    const output = workspaceOutput("notifications", "query_notifications", {}, { rows: [{ title: "<script>text</script>", body: "Meeting scheduled", createdAt: now.toISOString() }] }, now);
    expect(output.sections[0].rows[0].title).toBe("<script>text</script>");
    expect(workspaceRequest({ view: "notifications" }).sourceArguments).toEqual({ limit: 50, unreadOnly: true });
    expect(() => workspaceOutput("notifications", "query_notifications", {}, {}, now)).toThrow("Incomplete");
  });
  it("shows canonical onboarding steps without private payload fields", () => {
    const output = workspaceOutput("onboarding", "lookup_user_progress", {}, { progress: { orgType: "vendor", currentStep: "branding", completedSteps: ["company-basics"], skippedSteps: [], payload: { taxId: "private-tax-value" } } }, now);
    expect(output.sections[0].rows.find(row => row.title === "Vendor branding")).toMatchObject({ detail: "Current step" });
    expect(output.sections[0].rows.some(row => row.detail === "Completed")).toBe(true);
    expect(JSON.stringify(output)).not.toContain("private-tax-value");
    expect(workspaceRequest({ view: "onboarding" }).sourceTool).toBe("lookup_user_progress");
    expect(() => workspaceOutput("onboarding", "lookup_user_progress", {}, {}, now)).toThrow("Incomplete");
    expect(workspaceOutput("onboarding", "lookup_user_progress", {}, { progress: null }, now).sections[0].rows).toEqual([]);
  });
  it("projects canonical nested calendar meetings", () => {
    const output = workspaceOutput("work_calendar", "get_work_hub_calendar", {}, { tasks: [], shifts: [], meetings: [{ item: { meeting: { title: "Safety briefing" }, occurrence: { startsAt: now.toISOString() } } }] }, now);
    expect(output.sections[1].rows[0]).toMatchObject({ title: "Safety briefing", time: now.toISOString() });
  });
  it("reports display limits and rejects incomplete selected-gate results", () => {
    const output = workspaceOutput("my_workday", "get_work_hub_briefing", {}, { tasks: Array.from({ length: 51 }, () => ({ title: "Task" })), shifts: [], meetings: [] }, now);
    expect(output.sections[1].rows).toHaveLength(50);
    expect(output.attention[0].detail).toContain("50 of 51");
    expect(() => workspaceOutput("gate_board", "query_gate_change_over", {}, {}, now)).toThrow("Incomplete");
  });
  it("rejects arbitrary views, invalid gate identifiers and excessive calendar windows", () => {
    expect(() => workspaceRequest({ view: "arbitrary_tool" })).toThrow();
    expect(() => workspaceRequest({ view: "gate_board", stationId: "untrusted" })).toThrow();
    expect(() => workspaceRequest({ view: "gate_board", siteId: -1 })).toThrow();
    expect(() => workspaceRequest({ view: "work_calendar", start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z" })).toThrow();
    expect(workspaceRequest({ view: "my_workday", sourceTool: "delete_records" })).toEqual({ view: "my_workday", sourceTool: "get_work_hub_briefing", sourceArguments: {} });
  });
  it("flags only announcements requiring acknowledgement", () => {
    const output = workspaceOutput("my_workday", "get_work_hub_briefing", {}, { tasks: [], shifts: [], meetings: [], announcements: [{ announcement: { title: "FYI", acknowledgementRequired: false }, recipient: {} }, { announcement: { title: "Required", acknowledgementRequired: true }, recipient: {} }] }, now);
    expect(output.attention.map(row => row.title)).toEqual(["Required"]);
  });
  it("marks overdue open tasks without marking completed tasks overdue", () => {
    const output = workspaceOutput("my_workday", "get_work_hub_briefing", {}, { tasks: [{ title: "Open", dueAt: "2026-10-04T12:00:00Z", status: "open" }, { title: "Done", dueAt: "2026-10-04T12:00:00Z", status: "completed" }], shifts: [], meetings: [], announcements: [] }, now);
    expect(output.attention.map(row => row.title)).toEqual(["Open"]);
    expect(output.sections[1].rows).toHaveLength(2);
  });
  it("preserves empty results but rejects canonical tool failures", () => {
    expect(workspaceOutput("work_calendar", "get_work_hub_calendar", {}, { shifts: [], meetings: [], tasks: [] }, now).sections.every(section => section.rows.length === 0)).toBe(true);
    expect(() => workspaceOutput("my_workday", "get_work_hub_briefing", {}, { error: "Not authorized" }, now)).toThrow();
  });
  it("never creates shift counts when no gate shift is active", () => {
    const output = workspaceOutput("gate_board", "query_gate_change_over", { stationId: "gate" }, { station: { name: "North Gate" }, shift: null, snapshot: null, items: [], roster: [] }, now);
    expect(output.metrics).toEqual([]);
    expect(output.sections[0].empty).toContain("unavailable");
  });
  it("keeps visitor and employee record counts separate and shows source exceptions", () => {
    const output = workspaceOutput("gate_board", "query_gate_change_over", {}, { station: { name: "Gate" }, shift: { started_at: now.toISOString() }, snapshot: { generatedAt: now.toISOString(), metrics: { onSiteVisitorRecords: 2, onSiteEmployeeRecords: 3 }, outstanding: [{ name: "Fixture driver", plate: "TEST" }], exceptions: [{ text: "Visit exceeds its expected duration." }] }, items: [] }, now);
    expect(output.metrics).toEqual([{ label: "Visitor records on site", value: 2 }, { label: "Employee records on site", value: 3 }]);
    expect(output.attention[0].title).toContain("expected duration");
    expect(output.sections[1].rows[0].title).toBe("Fixture driver");
  });
  it("does not propagate credential-like or unrelated fields into display data", () => {
    const output = workspaceOutput("my_workday", "get_work_hub_briefing", {}, { tasks: [{ title: "<img src=x onerror=alert(1)>", password: "secret", token: "secret" }], shifts: [], meetings: [], announcements: [], token: "secret" }, now);
    expect(JSON.stringify(output)).not.toContain("secret");
    expect(output.sections[1].rows[0].title).toContain("<img");
    expect(WORKSPACE_HTML).not.toContain("innerHTML");
  });
});

