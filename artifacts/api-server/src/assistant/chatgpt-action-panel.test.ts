import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { ACTION_PANEL_HTML, actionRecordSummary } from "./chatgpt-action-panel";

function panelHarness() {
  const nodes = new Map<string, any>();
  for (const id of ["title", "status", "summary", "details", "submit", "device", "check"]) nodes.set(id, { textContent: "", hidden: true, setAttribute() {} });
  const requests: any[] = [];
  let receive: (event: any) => void;
  const parent = { postMessage: (message: any) => requests.push(message) };
  runInNewContext(ACTION_PANEL_HTML.match(/<script>([\s\S]*)<\/script>/)![1], {
    document: { getElementById: (id: string) => nodes.get(id), documentElement: { scrollHeight: 300 } },
    window: { parent, addEventListener: (_: string, callback: any) => { receive = callback; } },
    URL, setTimeout: () => 0, clearTimeout() {},
  });
  return { nodes, requests,
    publish: (requiresLocation = false, source = parent, reference = "17.reference") => receive!({ source, data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { _meta: { componentApproval: { toolName: "manage_ticket_record", reference, proof: requiresLocation ? undefined : "component-only", arguments: { description: "<img onerror=attack>" }, requiresLocation, approvalUrl: "https://vndrly.ai/api/assistant-connection/actions/17.reference" } } } } }),
    click: () => nodes.get("submit").onclick({ preventDefault() {} }),
    check: () => nodes.get("check").onclick({ preventDefault() {} }),
    failSubmission: () => { const sent = requests.filter(item => item.params?.name === "v_submit_panel_action").at(-1); receive!({ source: parent, data: { jsonrpc: "2.0", id: sent.id, error: { code: -32603 } } }); },
    status: async (state = "pending", result: unknown = null) => { const sent = requests.filter(item => item.method === "tools/call" && item.params.name === "v_action_status").at(-1); receive!({ source: parent, data: { jsonrpc: "2.0", id: sent.id, result: { structuredContent: { state, result } } } }); await Promise.resolve(); },
    reply: (outcome: unknown, isError = false) => { const sent = requests.find(item => item.method === "tools/call" && item.params.name === "v_submit_panel_action"); receive!({ source: parent, data: { jsonrpc: "2.0", id: sent.id, result: { structuredContent: outcome, isError } } }); },
  };
}
describe("VNDRLY component-mediated action panel", () => {
  it("shows a saved rejection after interruption without claiming success or resubmitting", async () => {
    const ui = panelHarness(); ui.publish(); await ui.status();
    const submission = ui.click(); ui.failSubmission(); await submission;
    const checking = ui.check();
    await ui.status("completed", { ok: false, status: 400, error: "Check the requested fields" }); await checking;
    expect(ui.nodes.get("status").textContent).toContain("rejected");
    expect(ui.nodes.get("status").textContent).not.toContain("completed");
    expect(ui.nodes.get("submit").hidden).toBe(true);
    expect(ui.requests.filter(item => item.params?.name === "v_submit_panel_action")).toHaveLength(1);
  });
  it("checks the same saved result after interruption without submitting again", async () => {
    const ui = panelHarness(); ui.publish(); await ui.status();
    const submission = ui.click(); ui.failSubmission(); await submission;
    expect(ui.nodes.get("submit").hidden).toBe(true);
    expect(ui.nodes.get("check").hidden).toBe(false);
    const checking = ui.check();
    expect(ui.requests.filter(item => item.params?.name === "v_submit_panel_action")).toHaveLength(1);
    await ui.status("completed", { operationId: "saved-on-server" }); await checking;
    expect(ui.nodes.get("status").textContent).toContain("completed");
    expect(ui.nodes.get("details").textContent).toContain("saved-on-server");
    expect(ui.nodes.get("submit").hidden).toBe(true);
    expect(ui.nodes.get("check").hidden).toBe(true);
  });
  it("offers retry only after a fresh pending result and requires another explicit click", async () => {
    const ui = panelHarness(); ui.publish(); await ui.status();
    const submission = ui.click(); ui.failSubmission(); await submission;
    const checking = ui.check(); await ui.status("pending"); await checking;
    expect(ui.nodes.get("submit").hidden).toBe(false);
    expect(ui.requests.filter(item => item.params?.name === "v_submit_panel_action")).toHaveLength(1);
  });
  it("shows coordinated steps without receipt or identity metadata while retaining exact details", async () => {
    const description = JSON.stringify({ schemaVersion: 1, version: 6, identity: { userId: 17 }, steps: [{ id: "payment_review", state: "pending", resultReferences: ["private-receipt"] }, { id: "hotlist", state: "waiting" }] });
    const result = { id: "plan-task", description };
    const ui = panelHarness(); ui.publish(); await ui.status("completed", result);
    const summary = ui.nodes.get("summary").textContent;
    expect(summary).toContain("Plan version: 6");
    expect(summary).toContain("Step: payment review — pending");
    expect(summary).toContain("Step: hotlist — waiting");
    expect(summary).not.toContain("private-receipt");
    expect(summary).not.toContain("userId");
    expect(ui.nodes.get("details").textContent).toContain("private-receipt");
    expect(actionRecordSummary("manage_work_hub_task", { description: '{"schemaVersion":1,"version":6,"steps":[{"id":"bad","state":"invented"}]}' })).toContain("Description:");
  });
  it("shows the exact target of a task completion outside its empty payload", () => {
    const summary = actionRecordSummary("manage_work_hub_task", { action: "complete", taskId: "synthetic-task", expectedVersion: 1, payload: {} });
    expect(summary).toContain("Task: synthetic-task");
    expect(summary).toContain("Action: complete");
    expect(summary).not.toContain("expectedVersion");
    expect(actionRecordSummary("confirm_asset_custody_action", { assetId: "synthetic-asset", action: "return", payload: { description: "Fictional return" } })).toContain("Asset: synthetic-asset");
  });
  it("summarizes the saved ticket using business fields while keeping full details", async () => {
    const ui = panelHarness(); ui.publish(); await ui.status("completed", { id: 100006, status: "awaiting_acceptance", siteName: "Demo well", description: "No real work", checkInLatitude: null, paymentDispersedById: null });
    expect(ui.nodes.get("summary").textContent).toContain("Ticket: 100006");
    expect(ui.nodes.get("summary").textContent).toContain("Status: awaiting acceptance");
    expect(ui.nodes.get("summary").textContent).toContain("Site: Demo well");
    expect(ui.nodes.get("summary").textContent).not.toContain("paymentDispersedById");
    expect(ui.nodes.get("details").textContent).toContain("paymentDispersedById");
    expect(ACTION_PANEL_HTML).toContain("<details><summary>Record details</summary>");
  });
  it("does not claim missing records or convert caller text into markup", () => {
    expect(actionRecordSummary("manage_ticket_record", null)).toContain("inspect the exact values");
    expect(actionRecordSummary("manage_ticket_record", { resource: { id: 3, description: "<img onerror=attack>" } })).toContain("<img onerror=attack>");
    const ui = panelHarness(); ui.publish();
    expect(ui.nodes.get("summary").textContent).toContain("<img onerror=attack>");
  });
  it("does not accept an outside frame's authorization and renders notes as text", () => {
    const ui = panelHarness();
    ui.publish(false, {} as any);
    expect(ui.nodes.get("details").textContent).toBe("");
    ui.publish();
    expect(ui.nodes.get("details").textContent).toContain("<img onerror=attack>");
  });
  it("submits once and shows the canonical rejected result without offering a duplicate", async () => {
    const ui = panelHarness(); ui.publish(); await ui.status();
    const first = ui.click(); await ui.click();
    expect(ui.requests.filter(item => item.params?.name === "v_submit_panel_action")).toHaveLength(1);
    ui.reply({ status: "completed", ok: false, result: { error: "ticket_not_approved" } }, true);
    await first;
    expect(ui.nodes.get("details").textContent).toContain("ticket_not_approved");
    expect(ui.nodes.get("submit").hidden).toBe(true);
  });
  it("preserves a newer action while an older submission finishes", async () => {
    const ui = panelHarness(); ui.publish(); await ui.status();
    const first = ui.click();
    ui.publish(false, undefined, "17.new-reference");
    await ui.status();
    ui.reply({ status: "completed", ok: true, result: { id: "older-result" } });
    await first;
    expect(ui.nodes.get("details").textContent).not.toContain("older-result");
    expect(ui.nodes.get("submit").hidden).toBe(false);
    expect(ui.nodes.get("status").textContent).toContain("pending");
  });
  it("requires the device path for fresh location and makes no submission call", async () => {
    const ui = panelHarness(); ui.publish(true); await ui.status(); await ui.click();
    expect(ui.nodes.get("submit").hidden).toBe(true);
    expect(ui.nodes.get("device").hidden).toBe(false);
    expect(ui.requests.filter(item => item.params?.name === "v_submit_panel_action")).toEqual([]);
  });
  it("reads a completed action on reopen without offering or submitting it again", async () => {
    const ui = panelHarness(); ui.publish();
    expect(ui.nodes.get("submit").hidden).toBe(true);
    await ui.status("completed", { operationId: "saved-operation", resource: { version: 2 } });
    expect(ui.nodes.get("status").textContent).toContain("completed");
    expect(ui.nodes.get("details").textContent).toContain("saved-operation");
    expect(ui.nodes.get("submit").hidden).toBe(true);
    expect(ui.requests.filter(item => item.params?.name === "v_submit_panel_action")).toEqual([]);
  });
  it("keeps an unresolved running action disabled and does not execute it", async () => {
    const ui = panelHarness(); ui.publish(); await ui.status("running");
    expect(ui.nodes.get("status").textContent).toContain("running");
    expect(ui.nodes.get("submit").hidden).toBe(true);
    expect(ui.nodes.get("device").hidden).toBe(true);
    expect(ui.requests.filter(item => item.params?.name === "v_submit_panel_action")).toEqual([]);
  });
});
