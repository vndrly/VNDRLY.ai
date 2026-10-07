import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import en from "@/lib/locales/en.json";
import ShiftScheduling from "./ShiftScheduling";
const m = vi.hoisted(() => ({
  api: vi.fn(),
  current: true,
  listeners: [] as (() => void)[],
  user: {
    id: 6,
    vendorId: 11,
    role: "vendor",
    activeMembershipId: 2,
    vendorRole: "office",
    availableMemberships: [{ id: 2, role: "admin" }],
  },
}));
vi.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => m.api(...a) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => m.current,
  subscribeUser: (fn: () => void) => {
    m.listeners.push(fn);
    return () => {};
  },
  subscribeToken: () => () => {},
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ text: "black", border: "gray" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, params?: any) => {
      const [ns, k] = key.split(".");
      return ((en as any)[ns]?.[k] ?? key).replace("{{id}}", params?.id ?? "");
    },
  }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("./GateShiftAssignments", () => ({
  default: ({ shiftId }: any) => <div>Saved Gate staffing {shiftId}</div>,
}));
const id = "10000000-0000-4000-8000-000000000001";
let row: any;
function fill() {
  for (const [label, value] of [
    ["Shift title", "Synthetic shift"],
    ["Start date", "2026-10-08"],
    ["End date", "2026-10-08"],
    ["Start time", "13:00"],
    ["End time", "15:15"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
beforeEach(() => {
  m.current = true;
  m.listeners = [];
  m.user.vendorRole = "office";
  m.user.availableMemberships = [{ id: 2, role: "admin" }];
  m.api.mockReset();
  row = null;
  m.api.mockImplementation(async (path: string, init?: any) => {
    if (path.endsWith("people"))
      return [
        { id: 8, displayName: "Company coworker", sameCompany: true },
        { id: 9, displayName: "Foreign person", sameCompany: false },
      ];
    if (path.endsWith("/sites"))
      return { sites: [{ id: 5, name: "Synthetic site" }] };
    if (path.includes("/stations?"))
      return { stations: [{ id, name: "Synthetic station" }] };
    if (path.includes("/calendar?"))
      return { shifts: row ? [{ item: row }] : [] };
    if (path.endsWith("/shifts")) {
      const b = JSON.parse(init.body);
      row = {
        id,
        ownerOrgType: "vendor",
        ownerOrgId: 11,
        createdById: 6,
        ...b.payload,
        version: 1,
      };
      return {
        operationId: b.operationId,
        appliedAt: "2026-10-07T18:00:00Z",
        replayed: false,
        resource: row,
      };
    }
    return { source: "vndrly", authority: "work_hub_shift", item: row };
  });
});
afterEach(cleanup);
describe("native explicit shift scheduling", () => {
  it("reviews exact entered time and named company assignees before any write", async () => {
    render(<ShiftScheduling />);
    await screen.findByText("Company coworker");
    expect(screen.queryByText("Foreign person")).toBeNull();
    fill();
    fireEvent.click(screen.getByText("Company coworker"));
    fireEvent.click(screen.getByText("Review shift"));
    await screen.findByText("Save reviewed shift");
    expect(m.api.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByText("Save reviewed shift"));
    await screen.findByText("Shift saved for the reviewed schedule.");
    const b = JSON.parse(
      m.api.mock.calls.find((c) => c[1]?.method === "POST")![1].body,
    );
    expect(b.payload.assigneeUserIds).toEqual([8]);
    expect(Date.parse(b.payload.endsAt) - Date.parse(b.payload.startsAt)).toBe(
      135 * 60_000,
    );
  });
  it("retains uncertain creation and only checks recorded matches without resending", async () => {
    m.api.mockImplementation(async (path: string) =>
      path.endsWith("people")
        ? []
        : path.includes("/calendar?")
          ? { shifts: [] }
          : Promise.reject(Error("dropped")),
    );
    render(<ShiftScheduling />);
    await waitFor(() =>
      expect(
        (screen.getByText("Review shift") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fill();
    fireEvent.click(screen.getByText("Review shift"));
    await screen.findByText("Save reviewed shift");
    fireEvent.click(screen.getByText("Save reviewed shift"));
    await screen.findByText("Check saved shifts");
    fireEvent.click(screen.getByText("Check saved shifts"));
    await waitFor(() =>
      expect(
        m.api.mock.calls.filter((c) => c[1]?.method === "POST"),
      ).toHaveLength(1),
    );
    expect(screen.queryByLabelText("Shift title")).toBeNull();
  });
  it("hides scheduling from ordinary workers and discards late account results", async () => {
    m.user.availableMemberships = [{ id: 2, role: "member" }];
    render(<ShiftScheduling />);
    expect(screen.queryByText("Review shift")).toBeNull();
    expect(m.api).not.toHaveBeenCalled();
  });
  it("creates unassigned Gate shift before opening the separately saved staffing workflow", async () => {
    m.user.vendorRole = "gate_supervisor";
    m.user.availableMemberships = [{ id: 2, role: "member" }];
    render(<ShiftScheduling />);
    fireEvent.click(await screen.findByText("Synthetic site"));
    fireEvent.click(await screen.findByText("Synthetic station"));
    fill();
    fireEvent.click(screen.getByText("Review shift"));
    await screen.findByText("Save reviewed shift");
    fireEvent.click(screen.getByText("Save reviewed shift"));
    await screen.findByText("Saved Gate staffing " + id);
    const b = JSON.parse(
      m.api.mock.calls.find((c) => c[1]?.method === "POST")![1].body,
    );
    expect(b.payload.assigneeUserIds).toEqual([]);
    expect(b.payload.siteLocationId).toBe(5);
    expect(b.payload.gateStationId).toBe(id);
  });
  it("clears reviewed private fields on account invalidation before any write", async () => {
    render(<ShiftScheduling />);
    await screen.findByText("Company coworker");
    fill();
    fireEvent.click(screen.getByText("Review shift"));
    await screen.findByText("Save reviewed shift");
    m.current = false;
    for (const fn of m.listeners) fn();
    await waitFor(() =>
      expect(screen.queryByText("Save reviewed shift")).toBeNull(),
    );
    expect(
      (screen.getByLabelText("Shift title") as HTMLInputElement).value,
    ).toBe("");
    expect(m.api.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });
  it("recovers dropped creation only from its exact operation receipt and matching current assignments", async () => {
    let receipt: any;
    const original = m.api.getMockImplementation()!;
    m.api.mockImplementation(async (path: string, init?: any) => {
      if (path.includes("/shifts/operations/")) return { receipt };
      if (init?.method === "POST") {
        const result = await original(path, init);
        receipt = { ...result, replayed: true };
        throw Error("dropped");
      }
      return original(path, init);
    });
    render(<ShiftScheduling />);
    await screen.findByText("Company coworker");
    fill();
    fireEvent.click(screen.getByText("Company coworker"));
    fireEvent.click(screen.getByText("Review shift"));
    await screen.findByText("Save reviewed shift");
    fireEvent.click(screen.getByText("Save reviewed shift"));
    await screen.findByText("Check saved shifts");
    fireEvent.click(screen.getByText("Check saved shifts"));
    await screen.findByText(/This creation request is recorded/);
    expect(
      m.api.mock.calls.filter((c) => c[1]?.method === "POST"),
    ).toHaveLength(1);
    expect(
      m.api.mock.calls.find((c) => c[0].includes("/shifts/operations/"))![0],
    ).toContain(receipt.operationId);
    expect(m.api.mock.calls.some((c) => c[0].includes("/calendar?"))).toBe(
      false,
    );
  });
});
