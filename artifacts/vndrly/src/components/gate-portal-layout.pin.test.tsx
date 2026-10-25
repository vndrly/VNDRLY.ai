import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GatePortalLayout } from "./gate-portal-layout";

const state = vi.hoisted(() => ({ path: "/gate/change-over", navigate: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => [state.path, state.navigate] }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/png-pill-rollover", () => ({ PngPillButton: (props: any) => <button {...props} /> }));
vi.mock("@/components/field-ops-portal-shell", () => ({ FieldOpsPortalShell: ({ tabs, children }: any) => <>{tabs.map((tab: any) => <button key={tab.testId} onClick={tab.onSelect || (() => state.navigate(tab.href))}>{tab.testId}</button>)}{children}</> }));
afterEach(() => { cleanup(); state.navigate.mockClear(); vi.unstubAllGlobals(); });

it("requires the correct PIN each time Return to Admin is selected on change-over", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ok:false,json:async()=>({message:"gateNav.incorrectPin"})}).mockResolvedValueOnce({ok:true,json:async()=>({ok:true})}));
  state.path = "/gate/change-over";
  render(<GatePortalLayout returnToAdmin>Dashboard</GatePortalLayout>);
  fireEvent.click(screen.getByText("tab-gate-return-admin"));
  const input = screen.getByLabelText("gateNav.enterPin");
  fireEvent.change(input, { target: { value: "9999" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("gateNav.incorrectPin"));
  expect(state.navigate).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "1029" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/"));
  fireEvent.click(screen.getByText("tab-gate-return-admin"));
  expect((screen.getByLabelText("gateNav.enterPin") as HTMLInputElement).value).toBe("");
});

it("leaves Return to Admin unchanged on other gate pages", () => {
  state.path = "/gate/history";
  render(<GatePortalLayout returnToAdmin>History</GatePortalLayout>);
  fireEvent.click(screen.getByText("tab-gate-return-admin"));
  expect(state.navigate).toHaveBeenCalledWith("/");
  expect(screen.queryByRole("dialog")).toBeNull();
});
