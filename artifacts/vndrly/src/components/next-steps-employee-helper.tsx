import { useState } from "react";
import { PngPillButton as TogglePillButton } from "@/components/png-pill-rollover";
import ManagedSubcontractorEmployeesCard, { type ManagedSubcontractorWorker } from "@/components/managed-subcontractor-employees-card";
import { useGuidedTarget } from "./guided-target";
import { useNextSteps, type SavedNextStepsWorker } from "@/components/next-steps";

/** This helper chooses records; the shared profile editors perform every real save. */
export default function NextStepsEmployeeHelper({ vendorId, siteId, siteName, stationName, canManage, loading, people, savedWorker, onAddDirect, onEditDirect, onManagedSaved }: {
  vendorId: number; siteId: number; siteName?: string; stationName?: string;
  canManage: boolean; loading: boolean;
  people: { id: number; firstName: string; lastName: string; isActive?: boolean }[];
  savedWorker?: SavedNextStepsWorker;
  onAddDirect: () => void; onEditDirect: (personId: number) => void;
  onManagedSaved: (worker: ManagedSubcontractorWorker, companyId: string) => void;
}) {
  const nextSteps = useNextSteps();
  const [choice, setChoice] = useState<"direct" | "managed" | "existing" | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const returnToPlan = () => nextSteps?.show();
  const guidanceScope = `next-steps-employee-choice:${vendorId}:${siteId}`;
  const guidanceTarget = choice === "existing" ? selectedId ? "open-existing" : "existing-person" : "employment-choice";
  useGuidedTarget({ scopeId: guidanceScope, targetId: guidanceTarget, prompt: choice === "existing" ? selectedId ? "Open the exact employee you selected. Save Gatekeeper capability and authorized site access in their profile." : "Choose the actual direct employee for this gate." : "Choose whether this person is your direct employee, a contracted worker, or an existing employee." }, canManage && !loading && !!siteName && nextSteps?.selected?.id === "first-watch" && !!nextSteps.selected.action?.href.startsWith("/field-employees") && choice !== "managed", 20);
  return <section data-guidance-scope={guidanceScope} className="rounded-lg border p-4 space-y-3" style={{ borderColor: "var(--brand-primary)" }} aria-label="Next Steps employee helper" data-testid="next-steps-employee-helper">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Next Steps · Employee & site access</h2>{nextSteps && <button type="button" className="vendor-mini-card-button" onClick={returnToPlan}>Return to Next Steps</button>}</div>
    {(siteName || stationName) && <p className="text-sm text-muted-foreground">{[siteName, stationName].filter(Boolean).join(" · ")}</p>}
    <p className="text-sm">Choose who will staff this gate. Save their Gatekeeper capability and authorized site access in the existing employee profile. The next saved step will take you to the station’s shift and assignment.</p>
    {savedWorker && <p role="status" className="text-sm">Saved {savedWorker.kind === "managed" ? "contracted employee" : "employee"}: {savedWorker.name}. Reopen Next Steps to check the saved workflow. Enrollment or a linked login may still need attention in their profile.</p>}
    {!canManage ? <p role="status">A current company administrator must manage employee roles and site access.</p> : loading ? <p role="status">Loading authorized employees and sites…</p> : !siteName ? <p role="status">This site is unavailable in your current company’s authorized site list. Choose the saved site again from Next Steps.</p> : <>
      <div data-guidance-id="employment-choice" className="flex flex-wrap gap-2">
        <TogglePillButton color="brand" aria-pressed={choice === "direct"} onClick={() => { setChoice("direct"); onAddDirect(); }}>Add direct employee</TogglePillButton>
        <TogglePillButton color="brand" aria-pressed={choice === "managed"} onClick={() => setChoice("managed")}>Use contracted employee</TogglePillButton>
        <TogglePillButton color="brand" aria-pressed={choice === "existing"} onClick={() => setChoice("existing")}>Use existing direct employee</TogglePillButton>
      </div>
      {choice === "direct" && <p className="text-sm text-muted-foreground">Use the open employee profile to save this person. After creation, the same profile provides their existing enrollment, login, and certification controls.</p>}
      {choice === "existing" && <div className="space-y-2"><label className="block text-sm" htmlFor="next-steps-direct-employee">Direct employee</label><select data-guidance-id="existing-person" id="next-steps-direct-employee" className="staff-type-select" value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">Select an employee…</option>{people.filter(person => person.isActive !== false).map(person => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select><TogglePillButton data-guidance-id="open-existing" color="brand" disabled={!selectedId} onClick={() => onEditDirect(Number(selectedId))}>Open selected employee</TogglePillButton></div>}
      {choice === "managed" && <ManagedSubcontractorEmployeesCard vendorId={vendorId} embedded nextSteps={nextSteps?.selected?.id === "first-watch" && nextSteps.selected.action?.href.startsWith("/field-employees") ? { siteId, onSaved: onManagedSaved, onReturn: returnToPlan } : undefined} />}
    </>}
  </section>;
}
