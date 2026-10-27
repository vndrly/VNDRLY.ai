import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

it("replaces withdrawal with a top-right Edit Shift control that saves revised notes",async()=>{
  const current=state();current.supervisor=true;
  const onEditSave=vi.fn().mockResolvedValue(undefined);
  render(<GateHandoffDesk {...props({current,onEditSave})}/>);
  expect(screen.queryByText("handoffDesk.withdraw")).toBeNull();
  expect(screen.getByRole("button",{name:"handoffDesk.editShift"}).closest("header")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"handoffDesk.editShift"}));
  const editor=screen.getByRole("textbox",{name:"handoffDesk.savedNotes"});expect((editor as HTMLTextAreaElement).value).toBe("Saved notes");
  fireEvent.change(editor,{target:{value:"Revised shift notes"}});fireEvent.click(screen.getByRole("button",{name:"handoffDesk.save"}));
  await waitFor(()=>expect(onEditSave).toHaveBeenCalledWith("Revised shift notes"));
  await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
});
it("adds a new note and expands Shift Notes with the saved entry above the composer",async()=>{
  let current=state();current.supervisor=true;
  const onAddNote=vi.fn().mockImplementation(async input=>{
    current={...current,preparation:{...current.preparation!,id:input.operationId,notes:`Saved notes\n\nNew operator note: ${input.text}`}};
    view.rerender(<GateHandoffDesk {...props({current,onAddNote})}/>);
  });
  const view=render(<GateHandoffDesk {...props({current,onAddNote})}/>);
  fireEvent.click(screen.getByText("handoffDesk.addNewNote"));fireEvent.change(screen.getByRole("textbox",{name:"handoffDesk.newNote"}),{target:{value:"Delivery moved to the east gate"}});
  fireEvent.click(screen.getByRole("button",{name:"handoffDesk.addNote"}));
  await waitFor(()=>expect(onAddNote).toHaveBeenCalledWith({operationId:expect.any(String),expectedWatchId:"watch",text:"Delivery moved to the east gate"}));
  const branch=screen.getByRole("group",{name:"handoffDesk.savedNotes"}) as HTMLDetailsElement;
  await waitFor(()=>expect(branch.open).toBe(true));expect(within(branch).getByText(/Delivery moved to the east gate/)).toBeTruthy();
  expect((screen.getByRole("textbox",{name:"handoffDesk.newNote"}) as HTMLTextAreaElement).value).toBe("");
});

it.each(["offline", "readError", "pending", "busy"])("blocks incoming assumption for %s", (condition) => {
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

it("saves changed outgoing notes without an update badge or assuming watch", () => {
  const callbacks = props({ ownWatch: true, notes: "Updated notes" });
  render(<GateHandoffDesk {...callbacks} />);
  expect(screen.queryByText("handoffDesk.needsSave")).toBeNull();
  expect(screen.queryByText("handoffDesk.ready")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "handoffDesk.save" }));
  expect(callbacks.onSave).toHaveBeenCalledTimes(1);
  expect(callbacks.onAssumeReviewed).not.toHaveBeenCalled();
});

it.each([false, true])("removes the old readiness indicator for incoming and outgoing watches (%s)", (ownWatch) => {
  render(<GateHandoffDesk {...props({ ownWatch })} />);
  expect(screen.queryByText("handoffDesk.ready")).toBeNull();
  expect(screen.queryByLabelText("handoffDesk.nextActions")).toBeNull();
});

it.each([
  { ownWatch: false, notes: "Saved notes", reminder: "handoffDesk.nextReview" },
  { ownWatch: true, notes: "  ", reminder: "handoffDesk.nextPrepare" },
  { ownWatch: true, notes: "New notes not saved yet", reminder: "handoffDesk.nextHandoff" },
  { ownWatch: true, notes: "Saved notes", reminder: "handoffDesk.nextHandoff" },
])("shows the on-duty gatekeeper's next action: $reminder", ({ ownWatch, notes, reminder }) => {
  render(<GateHandoffDesk {...props({ ownWatch, notes, gatekeeperOnDuty: true })} />);
  const card = screen.getByLabelText("handoffDesk.nextActions");
  expect(card.textContent).toContain(reminder);
  expect(card.querySelector("button, a, input, [tabindex]")).toBeNull();
});

it("identifies the actual operator while incoming waits for a saved handoff", () => {
  render(<GateHandoffDesk {...props({ current: { ...state(), preparation: null } })} />);
  expect(screen.getByText("handoffDesk.waiting: Actual operator")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect((screen.getByRole("button", { name: "handoffDesk.assume" }) as HTMLButtonElement).disabled).toBe(false);
});

it("keeps a released watch's saved notes reviewable before the next operator assumes",()=>{
  const current=state();current.releasedWatch=current.shift;current.shift=null;
  const callbacks=props({current});render(<GateHandoffDesk {...callbacks}/>);
  expect(screen.getByText("Saved notes")).toBeTruthy();
  const action=screen.getByRole("button",{name:"handoffDesk.assume"}) as HTMLButtonElement;
  expect(action.disabled).toBe(false);fireEvent.click(action);
  expect(callbacks.onAssumeReviewed).toHaveBeenCalledOnce();
});

it("keeps an uncertain watch request recoverable without issuing a new assumption", () => {
  const callbacks = props({ pendingWatch: true });
  render(<GateHandoffDesk {...callbacks} />);
  fireEvent.click(screen.getByRole("button", { name: "handoffDesk.checkRequest" }));
  expect(callbacks.onRecoverWatch).toHaveBeenCalledTimes(1);
  expect(callbacks.onAssumeReviewed).not.toHaveBeenCalled();
});
it("puts reviewed assumption last and removes the independence footer",()=>{
  const view=render(<GateHandoffDesk {...props()}/>);
  expect(screen.queryByText("handoffDesk.independent")).toBeNull();
  expect(view.container.querySelector(".gate-handoff-desk")?.lastElementChild?.id).toBe("watch-review");
});
it("signs exact notes from the top control, then toggles signed handoff back to editing",async()=>{
  let current=state();let signedInput:unknown;
  const onSignHandoff=vi.fn().mockImplementation(async input=>{
    signedInput=input;current={...current,preparation:{...current.preparation!,id:input.operationId,summary:{...current.preparation!.summary,signature:{userId:7,name:"Actual operator",signedAt:new Date().toISOString(),contentHash:"signed-hash"}}}};
    view.rerender(<GateHandoffDesk {...props({current,ownWatch:true,onSignHandoff})}/>);
  });
  const view=render(<GateHandoffDesk {...props({current,ownWatch:true,onSignHandoff})}/>);
  fireEvent.click(screen.getByRole("button",{name:"handoffDesk.signHandoff"}));
  await waitFor(()=>expect(onSignHandoff).toHaveBeenCalledOnce());expect(signedInput).toEqual({operationId:expect.any(String),expectedWatchId:"watch",expectedPreparationId:"prep",notes:"Saved notes"});
  const edit=await screen.findByRole("button",{name:"handoffDesk.editShift"});fireEvent.click(edit);
  expect(screen.getByRole("button",{name:"handoffDesk.signHandoff"})).toBeTruthy();expect(screen.getByRole("textbox",{name:"changeOver.outgoingNotes"})).toBeTruthy();
});
