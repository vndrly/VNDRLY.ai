import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_CLIENT } from "./chatgpt-dashboard-client";
import { dashboardBrand } from "./chatgpt-dashboard-brand";
import { workspaceOutput } from "./chatgpt-workspace";

function harness(mode?: string) {
  const nodes: any[] = [];
  const node = (tag = "div", textContent = "", className = ""): any => {
    const value = { tag, textContent, className, style: {}, children: [] as any[], append(child: any) { this.children.push(child); }, replaceChildren() { this.children = []; }, setAttribute: vi.fn(), remove: vi.fn() };
    nodes.push(value); return value;
  };
  const content = node();
  const load = vi.fn();
  const timers: (() => void)[] = [];
  const requestDisplayMode = mode ? vi.fn().mockResolvedValue({ mode }) : undefined;
  const context: any = {
    document: { body: { getBoundingClientRect: () => ({ height: 84 }), classList: { add: vi.fn(), remove: vi.fn() } }, documentElement: { scrollHeight: 500 }, visibilityState: "visible", createElement: node },
    window: { addEventListener: vi.fn(), openai: { requestDisplayMode, notifyIntrinsicHeight: vi.fn() }, parent: { postMessage: vi.fn() } },
    request: vi.fn().mockResolvedValue({ mode: "pip" }),
    current: { view: "my_workday" }, navigationPending: false, load,
    el: () => content, add: (parent: any, tag: string, text: string, css: string) => { const child = node(tag, text, css); parent.append(child); return child; },
    setInterval: (callback: () => void) => timers.push(callback),
  };
  runInNewContext(DASHBOARD_CLIENT, context);
  context.renderDashboard({ view: "my_workday", generatedAt: "2026-10-08T13:00:00Z", branding: { name: "Real Company", primaryColor: "#168e98", logoUrl: "https://vndrly.ai/uploads/logo.png" }, metrics: [{ label: "Tasks", value: 7 }] });
  return { context, nodes, load, timers, requestDisplayMode };
}

describe("compact workday dashboard", () => {
  it("counts canonical workday records and outstanding attention", () => {
    const output = workspaceOutput("my_workday", "get_work_hub_briefing", {}, { shifts: [{ shift: { title: "Shift" } }], tasks: [{ title: "Overdue", status: "open", dueAt: "2026-10-01T00:00:00Z" }], meetings: [], announcements: [{ announcement: { title: "Required", acknowledgementRequired: true }, recipient: {} }] }, new Date("2026-10-08T00:00:00Z"));
    expect(output.metrics).toEqual([{ label: "Shifts", value: 1 }, { label: "Tasks", value: 1 }, { label: "Meetings", value: 0 }, { label: "Need attention", value: 2 }]);
  });
  it("renders saved branding and sourced counts without another composer", () => {
    const { nodes, context } = harness();
    expect(nodes.find(n => n.tag === "img").src).toBe("https://vndrly.ai/uploads/logo.png");
    expect(nodes.find(n => n.className === "dashboard-strip").style.borderTopColor).toBe("#168e98");
    expect(nodes.map(n => n.textContent)).toContain("7");
    expect(nodes.filter(n => ["textarea", "input"].includes(n.tag))).toHaveLength(0);
    expect(context.window.openai.notifyIntrinsicHeight).toHaveBeenCalledWith(84);
  });
  it.each([["pip", "Pinned by ChatGPT"], ["fullscreen", "ChatGPT opened fullscreen instead of pinning"], ["inline", "ChatGPT kept this dashboard inline"]])("reports the actual host mode %s", async (mode, status) => {
    const { nodes, requestDisplayMode } = harness(mode);
    await nodes.find(n => n.tag === "button" && n.textContent === "Pin").onclick();
    expect(requestDisplayMode).toHaveBeenCalledWith({ mode: "pip" });
    expect(nodes.find(n => n.className === "dashboard-status").textContent).toBe(status);
  });
  it("does not claim pinning without host support", async () => {
    const { nodes } = harness();
    await nodes.find(n => n.textContent === "Pin").onclick();
    expect(nodes.find(n => n.className === "dashboard-status").textContent).toContain("unavailable");
  });
  it("uses the standard bridge when the host advertises PiP", async () => {
    const { context, nodes } = harness();
    context.updateDashboardHost({ availableDisplayModes: ["inline", "pip"] });
    await nodes.find(n => n.textContent === "Pin").onclick();
    expect(context.request).toHaveBeenCalledWith("ui/request-display-mode", { mode: "pip" });
    expect(nodes.find(n => n.className === "dashboard-status").textContent).toBe("Pinned by ChatGPT");
  });
  it("respects a host that advertises inline only", async () => {
    const { context, nodes, requestDisplayMode } = harness("pip");
    context.updateDashboardHost({ availableDisplayModes: ["inline"] });
    await nodes.find(n => n.textContent === "Pin").onclick();
    expect(context.request).not.toHaveBeenCalled();
    expect(requestDisplayMode).not.toHaveBeenCalled();
    expect(nodes.find(n => n.className === "dashboard-status").textContent).toContain("unavailable");
  });
  it("refreshes through authorized workspace reads and skips hidden or pending views", () => {
    const { context, nodes, load, timers } = harness();
    nodes.find(n => n.textContent === "Refresh").onclick();
    expect(load).toHaveBeenLastCalledWith("my_workday", true);
    load.mockClear(); timers[0](); expect(load).toHaveBeenCalledTimes(1);
    context.document.visibilityState = "hidden"; timers[0]();
    context.document.visibilityState = "visible"; context.navigationPending = true; timers[0]();
    context.navigationPending = false; context.current.view = "tickets"; timers[0]();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("saved dashboard branding", () => {
  const brand = { name: "Company", primaryColor: "#168e98", logoSquareUrl: null, logoUrl: "/uploads/company.png" };
  it("uses the existing company logo and color", () => {
    expect(dashboardBrand(brand, "https://vndrly.ai")).toEqual({ name: "Company", primaryColor: "#168e98", logoUrl: "https://vndrly.ai/uploads/company.png" });
  });
  it.each(["https://evil.example/logo.png", "javascript:alert(1)", "http://[", "https://user:pass@vndrly.ai/logo.png"])("rejects unusable logo %s without breaking workday reads", logoUrl => {
    expect(dashboardBrand({ ...brand, logoUrl, primaryColor: "red;display:none" }, "https://vndrly.ai")).toEqual({ name: "Company" });
  });
  it("falls back from an invalid square logo to the saved full logo", () => {
    expect(dashboardBrand({ ...brand, logoSquareUrl: "http://[" }, "https://vndrly.ai").logoUrl).toContain("/uploads/company.png");
  });
});
