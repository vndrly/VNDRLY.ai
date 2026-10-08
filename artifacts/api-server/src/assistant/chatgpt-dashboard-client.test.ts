import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_CLIENT } from "./chatgpt-dashboard-client";
import { dashboardBrand } from "./chatgpt-dashboard-brand";

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
    window: { openai: { requestDisplayMode, notifyIntrinsicHeight: vi.fn() }, parent: { postMessage: vi.fn() } },
    current: { view: "my_workday" }, navigationPending: false, load,
    el: () => content, add: (parent: any, tag: string, text: string, css: string) => { const child = node(tag, text, css); parent.append(child); return child; },
    setInterval: (callback: () => void) => timers.push(callback),
  };
  runInNewContext(DASHBOARD_CLIENT, context);
  context.renderDashboard({ view: "my_workday", generatedAt: "2026-10-08T13:00:00Z", branding: { name: "Real Company", primaryColor: "#168e98", logoUrl: "https://vndrly.ai/uploads/logo.png" }, metrics: [{ label: "Tasks", value: 7 }] });
  return { context, nodes, load, timers, requestDisplayMode };
}

describe("compact workday dashboard", () => {
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
