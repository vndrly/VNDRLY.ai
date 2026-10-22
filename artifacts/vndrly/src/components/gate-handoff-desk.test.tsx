import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ChangeOverState } from "@workspace/gate-booth";
import GateHandoffDesk, { type GateHandoffDeskProps } from "./gate-handoff-desk";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, values?: { name?: string }) => values?.name ? `${key}: ${values.name}` : key }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#0095a8", name: "MidCon Solutions" }) }));
afterEach(cleanup);

function state(): ChangeOverState {
  const snapshot = {
    generatedAt: "2026-10-22T12:00:00Z", startedAt: "2026-10-22T06:00:00Z", revision: "saved-revision", coverage: "recorded",
    metrics: { checkIns: 2, checkOuts: 1, onSiteVisitorRecords: 1, onSiteEmployeeRecords: 0, onSiteVehicles: 1, pendingAdmission: 0 },
    outstanding: [], exceptions: [], openItems: [{ id: "saved-item", text: "Saved action", status: "open" }], facts: [{ id: "saved-fact", text: "Saved gate fact" }],
  };
  return {
    station: { id: "gate", name: "Gate", site_id: 1 }, site: { id: 1, name: "Site" }, supervisor: false,
    shift: { id: "watch", operator_id: 7, operator_name: "Actual operator", started_at: snapshot.startedAt, preparation_id: "prep" },
    preparation: { id: "prep", notes: "Saved notes", snapshot, summary: { source: "structured_facts", facts: snapshot.facts }, created_at: "2026-10-22T12:01:00Z" },
    snapshot, stale: false, items: [{ id: "live-item", text: "Current action", status: "open" }],
  };
}
function props(overrides: Partial<GateHandoffDeskProps> = {}): GateHandoffDeskProps {
  return {
    current: state(), ownWatch: false, busy: false, online: true, readError: false, notes: "Saved notes", itemText: "", itemNotes: {}, reason: "",
    pendingWatch: false, onNotesChange: vi.fn(), onItemTextChange: vi.fn(), onItemNoteChange: vi.fn(), onItemAction: vi.fn(), onAddItem: vi.fn(),
    onSave: vi.fn(), onAssumeReviewed: vi.fn(), onRecoverWatch: vi.fn(), onReasonChange: vi.fn(), onWithdraw: vi.fn(), ...overrides,
  };
}

it("reviews saved facts, actions and notes through one explicit custody action", () => {
  const current = state();
  current.snapshot = { ...current.snapshot!, facts: [{ id: "live-fact", text: "Current live fact" }], openItems: current.items };
  const callbacks = props({ current });
  render(<GateHandoffDesk {...callbacks} />);
  expect(screen.getByText("Saved gate fact")).toBeTruthy();
  expect(screen.getByText("Saved action")).toBeTruthy();
  expect(screen.getByText("Saved notes")).toBeTruthy();
  expect(screen.queryByText("Current live fact")).toBeNull();
  expect(screen.queryByText("Current action")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "handoffDesk.assume" }));
  expect(callbacks.onAssumeReviewed).toHaveBeenCalledTimes(1);
  expect(callbacks.onSave).not.toHaveBeenCalled();
});

it.each(["offline", "readError", "stale", "mismatchedRevision", "pending", "busy"])("blocks incoming assumption for %s", (condition) => {
  const current = state();
  if (condition === "stale") current.stale = true;
  if (condition === "mismatchedRevision") current.snapshot = { ...current.snapshot!, revision: "later" };
  const callbacks = props({ current, online: condition !== "offline", readError: condition === "readError", pendingWatch: condition === "pending", busy: condition === "busy" });
  render(<GateHandoffDesk {...callbacks} />);
  const action = screen.getByRole("button", { name: "handoffDesk.assume" }) as HTMLButtonElement;
  expect(action.disabled).toBe(true);
  fireEvent.click(action);
  expect(callbacks.onAssumeReviewed).not.toHaveBeenCalled();
});

it("marks changed outgoing notes unsaved and saves without assuming watch", () => {
  const callbacks = props({ ownWatch: true, notes: "Updated notes" });
  render(<GateHandoffDesk {...callbacks} />);
  expect(screen.getByText("handoffDesk.needsSave")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "handoffDesk.save" }));
  expect(callbacks.onSave).toHaveBeenCalledTimes(1);
  expect(callbacks.onAssumeReviewed).not.toHaveBeenCalled();
});

it("identifies the actual operator while incoming waits for a saved handoff", () => {
  render(<GateHandoffDesk {...props({ current: { ...state(), preparation: null } })} />);
  expect(screen.getByText("handoffDesk.waiting: Actual operator")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "handoffDesk.assume" })).toBeNull();
});

it("keeps an uncertain watch request recoverable without issuing a new assumption", () => {
  const callbacks = props({ pendingWatch: true });
  render(<GateHandoffDesk {...callbacks} />);
  fireEvent.click(screen.getByRole("button", { name: "handoffDesk.checkRequest" }));
  expect(callbacks.onRecoverWatch).toHaveBeenCalledTimes(1);
  expect(callbacks.onAssumeReviewed).not.toHaveBeenCalled();
});
