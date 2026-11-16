import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GateOfflineLog from "./GateOfflineLog";
import en from "@/lib/locales/en.json";
const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), journal: vi.fn(), cache: vi.fn(), refresh: vi.fn(), current: vi.fn(() => true) }));
vi.mock("@/lib/native-operation-journal-runtime", () => ({ enqueueNativeOperation: mocks.enqueue, readNativeJournal: mocks.journal }));
vi.mock("@/lib/gate-offline-runtime", () => ({ readOfflineGate: mocks.cache, refreshOfflineGate: mocks.refresh }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({}), isAuthScopeCurrent: mocks.current }));
vi.mock("@/lib/native-uuid", () => ({ nativeUuid: () => "00000000-0000-4000-8000-000000000009" }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "white", background: "black", border: "gray" }) }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button onClick={onPress} disabled={disabled}>{children}</button> }));
vi.mock("@/components/DismissibleModal", () => ({ default: ({ children, visible, onRequestClose, dismissDisabled }: any) => visible ? <div>{children}<button data-testid="modal-safe-cancel" disabled={dismissDisabled} onClick={onRequestClose}>Close</button></div> : null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, opts: any = {}) => {
  const value = key.startsWith("gateOffline.") ? (en.gateOffline as any)[key.slice(12)] : opts.defaultValue ?? key;
  return String(value).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ""));
} }) }));
const user = { id: 1, activeMembershipId: 2, vendorId: 3 } as any;
const snapshot = { siteId: 1, siteName: "Synthetic site", stationId: "00000000-0000-4000-8000-000000000001", stationName: "Synthetic gate", capturedAt: Date.now(), visits: [{
  id: 7, siteLocationId: 1, firstName: "Existing", lastName: "Visitor", company: "Synthetic", vehiclePlate: "TEST7", plateState: "TX", checkInTime: "2026-11-15T12:00:00Z",
}] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.current.mockReturnValue(true); mocks.cache.mockResolvedValue(snapshot); mocks.journal.mockResolvedValue([]);
  mocks.refresh.mockRejectedValue(new Error("Server down"));
  mocks.enqueue.mockImplementation(async (_user, entry) => ({ ...entry, state: "pending", attempts: 0 }));
});
afterEach(cleanup);
it("opens a dismissible native fallback during an outage and confirms a durable entry once", async () => {
  const screen = render(<GateOfflineLog user={user} pageFailed onRetry={() => {}} />);
  await screen.findByText("Synthetic site · Synthetic gate");
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Synthetic" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Driver" } });
  fireEvent.click(screen.getByText("Review check-in"));
  expect(mocks.enqueue).not.toHaveBeenCalled();
  const save = screen.getByText("Confirm · Save on device");
  fireEvent.click(save); fireEvent.click(save);
  await screen.findByText(en.gateOffline.saved);
  expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  expect(mocks.enqueue.mock.calls[0][1].payload).toMatchObject({ siteLocationId: 1, gateStationId: snapshot.stationId, direction: "entry", reportedVisitor: { firstName: "Synthetic", lastName: "Driver" } });
  fireEvent.click(screen.getByTestId("modal-safe-cancel"));
  await waitFor(() => expect(screen.queryByText(en.gateOffline.title)).toBeNull());
});
it("records an exact pre-outage visitor exit rather than matching a plate", async () => {
  const screen = render(<GateOfflineLog user={user} pageFailed onRetry={() => {}} />);
  await screen.findByText("Synthetic site · Synthetic gate");
  fireEvent.click(screen.getByText("Check-outs"));
  fireEvent.click(screen.getByText("Review check-out"));
  fireEvent.click(screen.getByText("Confirm · Save on device"));
  await screen.findByText(en.gateOffline.saved);
  expect(mocks.enqueue.mock.calls[0][1].payload).toMatchObject({ direction: "exit", originalVisitId: 7, gateStationId: snapshot.stationId });
});
it("does not claim a save or erase draft details when local storage fails", async () => {
  mocks.enqueue.mockRejectedValue(new Error("disk full"));
  const screen = render(<GateOfflineLog user={user} pageFailed onRetry={() => {}} />);
  await screen.findByText("Synthetic site · Synthetic gate");
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Keep" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Details" } });
  fireEvent.click(screen.getByText("Review check-in"));
  fireEvent.click(screen.getByText("Confirm · Save on device"));
  await screen.findByText(en.gateOffline.storageError);
  expect(screen.queryByText(en.gateOffline.saved)).toBeNull();
  fireEvent.click(screen.getByText("Cancel"));
  expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Keep");
});
