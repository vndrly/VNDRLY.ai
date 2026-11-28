import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NativeGateJournal from "./NativeGateJournal";

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), journal: vi.fn() }));
vi.mock("@/lib/native-operation-journal-runtime", () => ({ enqueueNativeOperation: mocks.enqueue, readNativeJournal: mocks.journal }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({}), isAuthScopeCurrent: () => true }));
vi.mock("@/lib/native-uuid", () => ({ nativeUuid: () => "00000000-0000-4000-8000-000000000009" }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1, activeMembershipId: 2 } }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "white" }) }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button onClick={onPress} disabled={disabled}>{children}</button> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, values: any = {}) => key === "nativeJournal.recordExit" ? `Record observed exit for ${values.plate}` : key }) }));

const visitor = { firstName: "", lastName: "", company: "", purpose: "", notes: "", vehiclePlate: "TYPED1", plateState: null };
const entry = (operationId: string, state: string, payload: object) => ({ operationId, domain: "gate", capturedAt: "2026-11-28T12:00:00Z", state, attempts: 0, payload: { siteLocationId: 42, direction: "entry", ...payload } });

beforeEach(() => { vi.clearAllMocks(); mocks.enqueue.mockImplementation(async (_user, value) => ({ ...value, state: "pending", attempts: 0 })); });
afterEach(cleanup);

it("keeps a visitor checked in on this device in view and checks them out with the tag they came in with, which may be none", async () => {
  mocks.journal.mockResolvedValue([
    entry("00000000-0000-4000-8000-000000000001", "pending", { reportedVisitor: { firstName: "Pat", lastName: "Offline" } }),
    entry("00000000-0000-4000-8000-000000000002", "synced", { plate: "OLD1", reportedVisitor: { firstName: "Already", lastName: "Uploaded" } }),
  ]);
  const screen = render(<NativeGateJournal siteId={42} visitor={visitor} onRecorded={() => {}} />);
  fireEvent.click(await screen.findByText("Record observed exit for Pat Offline"));
  await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
  const payload = mocks.enqueue.mock.calls[0][1].payload;
  expect(payload).toMatchObject({ siteLocationId: 42, direction: "exit", entryOperationId: "00000000-0000-4000-8000-000000000001" });
  expect(payload.plate).toBeUndefined();
  expect(screen.queryByText("Record observed exit for Already Uploaded · OLD1")).toBeNull();
});
