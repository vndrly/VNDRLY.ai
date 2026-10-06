import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { workspaceOutput, workspaceRequest, WORKSPACE_HTML } from "./chatgpt-workspace";
const now = new Date("2026-10-05T17:00:00Z");
function workspaceHarness() {
  const nodes = new Map<string, any>();
  const makeNode = () => ({ textContent: "", className: "", append() {}, replaceChildren() {}, setAttribute() {}, removeAttribute() {} });
  for (const id of ["title", "status", "content", "updated", "refresh"]) nodes.set(id, makeNode());
  const links = ["fleet", "tickets", "notifications"].map(view => ({ ...makeNode(), dataset: { view }, hidden: false, onclick: undefined as any }));
  const requests: any[] = [];
  const intervals: (() => void)[] = [];
  let receive: (event: any) => void;
  const parent = { postMessage: (message: any) => requests.push(message) };
  runInNewContext(WORKSPACE_HTML.match(/<script>([\s\S]*)<\/script>/)![1], {
    document: { getElementById: (id: string) => nodes.get(id), createElement: makeNode, querySelectorAll: () => links, documentElement: { scrollHeight: 300 } },
    window: { parent, addEventListener: (_: string, callback: any) => { receive = callback; } },
    setTimeout: () => 0, clearTimeout() {}, setInterval: (callback: () => void) => { intervals.push(callback); return 0; },
  });
  const output = (view: string) => ({ view, title: view, availableViews: ["tickets", "notifications"], sections: [], attention: [], metrics: [], generatedAt: now.toISOString(), sourceArguments: {} });
  return {
    nodes,
    requests,
    tick: () => intervals.forEach(callback => callback()),
    publish: (view: string) => receive!({ source: parent, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: output(view) } } }),
    click: (view: string) => links.find(link => link.dataset.view === view)!.onclick({ preventDefault() {} }),
    reply: async (view: string, failed = false) => {
      const sent = requests.find(message => message.params?.arguments?.view === view);
      receive!({ source: parent, data: { jsonrpc: "2.0", id: sent.id, result: failed ? { isError: true } : { structuredContent: output(view) } } });
      await Promise.resolve();
    },
  };
}
describe("VNDRLY workspace presentation", () => {
  it("shows only the canonical inventory projection and highlights missing assets", () => {
    expect(workspaceRequest({ view: "inventory" })).toMatchObject({ sourceTool: "query_asset_custody", sourceArguments: {} });
    const output = workspaceOutput("inventory", "query_asset_custody", {}, { assets: [{ name: "Test truck", status: "checked_out", currentHolderDisplayName: "User 7", condition: "missing", privateTelemetry: "secret" }] }, now);
    expect(output.sections[0].rows[0]).toMatchObject({ title: "Test truck", attention: "missing" });
    expect(output.sections[0].rows[0].detail).toContain("User 7");
    expect(JSON.stringify(output)).not.toContain("secret");
    expect(() => workspaceOutput("inventory", "query_asset_custody", {}, {}, now)).toThrow("Incomplete inventory");
  });
  it("labels fleet package capabilities unavailable without inventing truck positions", () => {
    const output = workspaceOutput("fleet", "query_field_trips", {}, { trips: [] }, now);
    expect(output.sections[1]).toMatchObject({ title: "VENDRY Fleet" });
    expect(output.sections[1].rows[0].detail).toContain("not connected yet");
    expect(output.fleetMap?.points).toEqual([]);
  });
  it("refreshes an initially host-rendered Fleet panel without overlapping a pending refresh", async () => {
    const ui = workspaceHarness();
    ui.publish("fleet");
    ui.tick();
    ui.tick();
    expect(ui.requests.filter(message => message.method === "tools/call")).toHaveLength(1);
    await ui.reply("fleet");
    ui.tick();
    expect(ui.requests.filter(message => message.method === "tools/call")).toHaveLength(2);
  });
  it("does not let Fleet polling override a newer panel while navigation is pending", async () => {
    const ui = workspaceHarness();
    ui.click("fleet");
    await ui.reply("fleet");
    ui.click("tickets");
    ui.tick();
    expect(ui.requests.filter(message => message.method === "tools/call").map(message => message.params.arguments.view)).toEqual(["fleet", "tickets"]);
    await ui.reply("tickets");
    expect(ui.nodes.get("title").textContent).toBe("tickets");
  });
  it("keeps the latest selected panel when older requests finish afterward", async () => {
    const ui = workspaceHarness();
    ui.click("tickets");
    ui.click("notifications");
    await ui.reply("notifications");
    expect(ui.nodes.get("title").textContent).toBe("notifications");
    await ui.reply("tickets");
    expect(ui.nodes.get("title").textContent).toBe("notifications");
  });
  it("does not overwrite a newer panel with an older request failure", async () => {
    const ui = workspaceHarness();
    ui.click("tickets");
    ui.click("notifications");
    await ui.reply("notifications");
    await ui.reply("tickets", true);
    expect(ui.nodes.get("title").textContent).toBe("notifications");
    expect(ui.nodes.get("status").textContent).toBe("");
  });
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

