import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ guidance: { companyId: 4, state: "ready", active: { key: "first-watch", title: "First watch", action: { title: "Assign the saved shift", href: "/work-hub/calendar?siteId=14" } }, available: [], control: { targetId: "save-assignment", prompt: "Review this actual assignment" } } as any }));
vi.mock("./use-askv-gate-guidance", () => ({ useAskVGateGuidance: () => state.guidance }));
import { useAssistant } from "./use-assistant";
afterEach(() => vi.unstubAllGlobals());
it("passes the latest shared step to askV without fetching another Next Steps summary", async () => {
  const bodies: any[] = [];
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/conversations")) return new Response(JSON.stringify({ id: 8 }));
    bodies.push(JSON.parse(String(init?.body)));
    return new Response('event: done\ndata: {"content":"Review the saved shift assignment."}\n\n');
  });
  vi.stubGlobal("fetch", request);
  const hook = renderHook(() => useAssistant({ pageContext: { path: "/work-hub" }, liveUpdates: false }));
  await act(async () => { await hook.result.current.send("What does this step mean?"); });
  expect(bodies[0].pageContext.gateGuidance).toEqual(state.guidance);
  state.guidance = { ...state.guidance, control: { targetId: "employee", prompt: "Choose the eligible employee" } };
  hook.rerender();
  await act(async () => { await hook.result.current.send("Which control should I use?"); });
  expect(bodies[1].pageContext.gateGuidance.control.prompt).toBe("Choose the eligible employee");
  expect(request.mock.calls.some(([path]) => String(path).includes("account-next-steps"))).toBe(false);
});
it("keeps signed-in workflow context out of public signup chat", async () => {
  const bodies: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return new Response('event: done\ndata: {"content":"Welcome."}\n\n'); }));
  const hook = renderHook(() => useAssistant({ signupMode: { persona: "vendor" }, liveUpdates: false }));
  await act(async () => { await hook.result.current.send("How do I sign up?"); });
  expect(bodies[0]).not.toHaveProperty("pageContext");
});
it("attaches only a validated workflow hint from the live read-tool stream to this reply", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).endsWith("/conversations") ? new Response(JSON.stringify({ id: 8 })) : new Response('event: gate_guidance\ndata: {"kind":"gate_setup_progress","workflowKey":"first-watch","state":"actionable","role":"admin"}\n\nevent: done\ndata: {"content":"The employee is saved. Assign the existing shift next."}\n\n')));
  const hook = renderHook(() => useAssistant({ liveUpdates: false }));
  await act(async () => { await hook.result.current.send("I already saved the employee. What remains?"); });
  expect(hook.result.current.messages.at(-1)?.gateSetupProgress).toEqual({ kind: "gate_setup_progress", workflowKey: "first-watch", state: "actionable" });
});
it("receives askV's structured daily workflow offer without opening or saving anything", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).endsWith("/conversations") ? new Response(JSON.stringify({ id: 8 })) : new Response('event: gate_workflow_offer\ndata: {"kind":"gate_workflow_offer","companyId":4,"workflowKey":"gate-inner-arrival","context":{"siteId":14,"vehicleId":77},"href":"/admin"}\n\nevent: done\ndata: {"content":"I can guide this arrival in Next Steps."}\n\n')));
  const hook = renderHook(() => useAssistant({ liveUpdates: false }));
  await act(async () => { await hook.result.current.send("A vehicle is at the inner booth; show me the process."); });
  expect(hook.result.current.messages.at(-1)?.gateWorkflowOffer).toEqual({ kind: "gate_workflow_offer", companyId: 4, workflowKey: "gate-inner-arrival", context: { siteId: 14, vehicleId: 77 } });
});
