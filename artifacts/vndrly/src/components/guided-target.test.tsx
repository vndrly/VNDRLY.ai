import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { findGuidanceTarget, GuidedTargetProvider, GuidanceTargetStatus, useGuidedTarget } from "./guided-target";
const rectangle = { left: 20, top: 80, right: 220, bottom: 120, width: 200, height: 40, x: 20, y: 80, toJSON() {} };
let scroll: ReturnType<typeof vi.fn>;
beforeEach(() => {
 scroll = vi.fn();
 vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) { return this.closest("[hidden]") ? [] as unknown as DOMRectList : [rectangle] as unknown as DOMRectList; });
 vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rectangle);
 Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
 vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
 vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Publisher({ active = true, scopeId = "employee:7:30", targetId = "save", priority = 20, prompt = "Use the employee’s existing Save control." }) {
 useGuidedTarget({ scopeId, targetId, prompt }, active, priority); return null;
}
function Scene({ missing = false, duplicate = false, active = true, company = "company-7", modal = false }) {
 return <GuidedTargetProvider scope={company} active={active}>
  <Publisher active={active} />
  <div data-guidance-scope="employee:7:30"><button data-guidance-id={missing ? "different" : "save"}>Actual employee save</button>{duplicate && <button data-guidance-id="save">Other ambiguous save</button>}</div>
  <div data-guidance-scope="employee:8:30"><button data-guidance-id="save">Another company’s save</button></div>
  {modal && <><Publisher scopeId="modal:7:30" targetId="first-name" prompt="Enter the selected employee’s first name." priority={100} /><div data-guidance-scope="modal:7:30"><input data-guidance-id="first-name" aria-label="Actual first name" /></div></>}
  <GuidanceTargetStatus />
 </GuidedTargetProvider>;
}

it("points only at the exact registered company/person control and never auto-clicks or steals focus", async () => {
 const click = vi.fn(); render(<Scene />);
 const target = screen.getByRole("button", { name: "Actual employee save" }); target.addEventListener("click", click);
 const ring = await screen.findByTestId("guidance-target-ring");
 expect(ring.getAttribute("aria-hidden")).toBe("true"); expect(ring.style.left).toBe("16px");
 expect(findGuidanceTarget({ scopeId: "employee:7:30", targetId: "save", prompt: "" })).toBe(target);
 expect(click).not.toHaveBeenCalled(); expect(document.activeElement).not.toBe(target);
});

it("keeps the contextual prompt with no highlight when an exact target is missing, hidden, or ambiguous", async () => {
 const view = render(<Scene missing />);
 expect(screen.getByText("Use the employee’s existing Save control.")).toBeTruthy(); expect(screen.queryByTestId("guidance-target-ring")).toBeNull();
 view.rerender(<Scene duplicate />);
 await waitFor(() => expect(screen.queryByTestId("guidance-target-ring")).toBeNull());
 expect(findGuidanceTarget({ scopeId: "employee:7:30", targetId: "save", prompt: "" })).toBeNull();
 view.rerender(<Scene />); await screen.findByTestId("guidance-target-ring");
 screen.getByRole("button", { name: "Actual employee save" }).hidden = true;
 expect(findGuidanceTarget({ scopeId: "employee:7:30", targetId: "save", prompt: "" })).toBeNull();
});

it("stops attention after the actual control is used, and prioritizes the active employee modal over the page", async () => {
 render(<Scene modal />);
 expect(screen.getByText("Enter the selected employee’s first name.")).toBeTruthy(); await screen.findByTestId("guidance-target-ring");
 fireEvent.input(screen.getByLabelText("Actual first name"), { target: { value: "Pat" } });
 await waitFor(() => expect(screen.queryByTestId("guidance-target-ring")).toBeNull());
 expect(screen.getByText("Enter the selected employee’s first name.")).toBeTruthy();
});

it("scrolls only after Show me is explicitly clicked and respects reduced motion", async () => {
 vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
 render(<Scene />); await screen.findByTestId("guidance-target-ring"); expect(scroll).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button", { name: "Show me" })); expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "center", inline: "nearest" });
 expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Actual employee save" }));
});

it("clears the target when guidance stops or the company scope is reset", async () => {
 const view = render(<Scene />); await screen.findByTestId("guidance-target-ring");
 view.rerender(<Scene active={false} />); expect(screen.queryByTestId("guidance-target-ring")).toBeNull();
 view.rerender(<Scene company="company-8" active={false} />); expect(screen.queryByRole("button", { name: "Show me" })).toBeNull();
});

it("can point at an explicitly registered existing test id inside the exact active employee scope", async () => {
 render(<GuidedTargetProvider scope="company-7" active><Publisher targetId="testid:staff-login-portal-enabled" /><div data-guidance-scope="employee:7:30"><input data-testid="staff-login-portal-enabled" aria-label="Existing Gate login" type="checkbox" /></div><GuidanceTargetStatus /></GuidedTargetProvider>);
 await screen.findByTestId("guidance-target-ring");
 expect(findGuidanceTarget({ scopeId:"employee:7:30", targetId:"testid:staff-login-portal-enabled", prompt:"" })).toBe(screen.getByLabelText("Existing Gate login"));
 fireEvent.click(screen.getByLabelText("Existing Gate login"));
 await waitFor(()=>expect(screen.queryByTestId("guidance-target-ring")).toBeNull());
});
