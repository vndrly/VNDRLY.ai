import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { ACTION_PANEL_HTML } from "./chatgpt-action-panel";

function panelHarness() {
  const nodes = new Map<string, any>();
  for (const id of ["title", "status", "details", "submit", "device"]) nodes.set(id, { textContent: "", hidden: true, setAttribute() {} });
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
    status: async (state = "pending", result: unknown = null) => { const sent = requests.filter(item => item.method === "tools/call" && item.params.name === "v_action_status").at(-1); receive!({ source: parent, data: { jsonrpc: "2.0", id: sent.id, result: { structuredContent: { state, result } } } }); await Promise.resolve(); },
    reply: (outcome: unknown, isError = false) => { const sent = requests.find(item => item.method === "tools/call" && item.params.name === "v_submit_panel_action"); receive!({ source: parent, data: { jsonrpc: "2.0", id: sent.id, result: { structuredContent: outcome, isError } } }); },
  };
}
describe("VNDRLY component-mediated action panel", () => {
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
