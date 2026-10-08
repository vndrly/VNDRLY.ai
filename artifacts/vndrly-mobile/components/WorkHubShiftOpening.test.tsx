import React from "react";
import { createHash } from "node:crypto";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import WorkHubShiftOpening from "./WorkHubShiftOpening";
import { workHubShiftOpeningFingerprintValues } from "@workspace/api-zod";
const m = vi.hoisted(() => ({
  api: vi.fn(),
  current: true,
  storage: new Map<string, string>(),
  user: {
    id: 6,
    vendorId: 11,
    role: "vendor",
    activeMembershipId: 2,
    vendorRole: "office",
    availableMemberships: [{ id: 2, role: "admin" }],
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => m.current,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => m.api(...args),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => m.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.storage.set(k, v);
    },
    removeItem: async (k: string) => {
      m.storage.delete(k);
    },
  },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "10000000-0000-4000-8000-000000000002",
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_a: string, s: string) =>
    createHash("sha256").update(s).digest("hex"),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("./TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const id = "10000000-0000-4000-8000-000000000001";
let row: any, receipt: any, phase: string;
beforeEach(() => {
  m.current = true;
  m.storage.clear();
  m.user.availableMemberships = [{ id: 2, role: "admin" }];
  m.api.mockReset();
  phase = "normal";
  receipt = null;
  row = {
    id,
    title: "Synthetic shift",
    ownerOrgType: "vendor",
    ownerOrgId: 11,
    version: 2,
    open: false,
    startsAt: "2099-10-08T10:00:00Z",
    endsAt: "2099-10-08T11:00:00Z",
    timezone: "UTC",
    milestoneStatus: "upcoming",
    assigneeUserIds: [],
    gateStationId: null,
    siteLocationId: null,
  };
  m.api.mockImplementation(async (path: string, init: any) => {
    if (path.includes("/calendar/items/")) return { item: row };
    if (init.method === "GET") {
      if (phase === "denied") throw Error("403");
      return { receipt };
    }
    const b = JSON.parse(init.body);
    const input = {
      operationId: b.operationId,
      expectedVersion: b.expectedVersion,
      open: b.payload.open,
    };
    receipt = {
      ...input,
      actorUserId: 6,
      ownerOrgType: "vendor",
      ownerOrgId: 11,
      shiftId: id,
      previousVersion: 2,
      resultingVersion: 3,
      commandFingerprint: createHash("sha256")
        .update(
          JSON.stringify(
            workHubShiftOpeningFingerprintValues(id, 6, "vendor", 11, input),
          ),
        )
        .digest("hex"),
      recordedAt: "2026-10-07T20:00:00Z",
      physicalAttendanceVerified: false,
    };
    delete receipt.expectedVersion;
    if (phase === "lost") throw Error("response lost");
    return receipt;
  });
});
afterEach(cleanup);
async function review() {
  render(<WorkHubShiftOpening shifts={[{ item: { id, title: row.title } }]} />);
  await waitFor(() =>
    expect(screen.getByText(row.title).hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(screen.getByText(row.title));
  await screen.findByText("Save reviewed change");
}
it("saves the exact reviewed version despite later list changes and separates saved refresh failure", async () => {
  const refresh = vi.fn().mockRejectedValue(Error("refresh"));
  render(
    <WorkHubShiftOpening
      shifts={[{ item: { id, title: row.title } }]}
      onSaved={refresh}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText(row.title).hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(screen.getByText(row.title));
  await screen.findByText("Save reviewed change");
  row.version = 9;
  fireEvent.click(screen.getByText("Save reviewed change"));
  await screen.findByText("Saved. Refresh to view the shift.");
  const writes = m.api.mock.calls.filter(([, i]) => i.method === "PATCH");
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1].body)).toMatchObject({
    expectedVersion: 2,
    payload: { action: "update", open: true },
  });
  expect(m.storage.size).toBe(0);
});
it("lost committed response then denied lookup retains original; later exact receipt recovers without PATCH", async () => {
  phase = "lost";
  await review();
  fireEvent.click(screen.getByText("Save reviewed change"));
  await screen.findByText(
    "Result unresolved. Check the same request before another.",
  );
  const original = [...m.storage.values()][0];
  phase = "denied";
  fireEvent.click(screen.getByText("Check the same request"));
  await waitFor(() =>
    expect(
      screen.getByText("Check the same request").hasAttribute("disabled"),
    ).toBe(false),
  );
  expect([...m.storage.values()][0]).toBe(original);
  phase = "normal";
  fireEvent.click(screen.getByText("Check the same request"));
  await screen.findByText(
    "Claim window saved. No duty or attendance recorded.",
  );
  expect(m.api.mock.calls.filter(([, i]) => i.method === "PATCH")).toHaveLength(
    1,
  );
});
it("denies assigned/non-upcoming shifts and suppresses old account effects", async () => {
  row.assigneeUserIds = [7];
  render(<WorkHubShiftOpening shifts={[{ item: { id, title: row.title } }]} />);
  await waitFor(() =>
    expect(screen.getByText(row.title).hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(screen.getByText(row.title));
  await screen.findByText("This shift cannot be changed.");
  expect(screen.queryByText("Save reviewed change")).toBeNull();
  expect(m.api.mock.calls.filter(([, i]) => i.method === "PATCH")).toHaveLength(
    0,
  );
  cleanup();
  row.assigneeUserIds = [];
  row.milestoneStatus = "in_progress";
  render(<WorkHubShiftOpening shifts={[{ item: { id, title: row.title } }]} />);
  await waitFor(() =>
    expect(screen.getByText(row.title).hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(screen.getByText(row.title));
  await screen.findByText("This shift cannot be changed.");
  expect(screen.queryByText("Save reviewed change")).toBeNull();
  cleanup();
  row.milestoneStatus = "upcoming";
  await review();
  m.current = false;
  fireEvent.click(screen.getByText("Save reviewed change"));
  await waitFor(() =>
    expect(
      m.api.mock.calls.filter(([, i]) => i.method === "PATCH"),
    ).toHaveLength(0),
  );
});
