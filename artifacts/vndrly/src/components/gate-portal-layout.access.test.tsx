import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GatePortalLayout } from "./gate-portal-layout";

const state = vi.hoisted(() => ({
  path: "/gate/change-over",
  navigate: vi.fn(),
  user: { role: "admin", vendorRole: null as string | null },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("wouter", () => ({ useLocation: () => [state.path, state.navigate] }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/field-ops-portal-shell", () => ({
  FieldOpsPortalShell: ({ tabs, children }: any) => <>{tabs.map((tab: any) => <button key={tab.testId} onClick={tab.onSelect || (() => state.navigate(tab.href))}>{tab.testId}</button>)}{children}</>,
}));

afterEach(() => {
  cleanup();
  state.navigate.mockClear();
  state.user.role = "admin";
  state.user.vendorRole = null;
  vi.unstubAllGlobals();
});

it("returns an authorized admin immediately without a PIN request", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<GatePortalLayout returnToAdmin>Dashboard</GatePortalLayout>);
  fireEvent.click(screen.getByText("tab-gate-return-admin"));
  expect(state.navigate).toHaveBeenCalledWith("/");
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("does not offer Return to Admin to an unauthorized gate worker", () => {
  state.user.role = "vendor";
  state.user.vendorRole = "gatekeeper";
  render(<GatePortalLayout returnToAdmin>Dashboard</GatePortalLayout>);
  expect(screen.queryByText("tab-gate-return-admin")).toBeNull();
});
