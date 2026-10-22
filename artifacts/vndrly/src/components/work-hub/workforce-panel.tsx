import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { AlertTriangle, Bell, ChevronRight, Clock3, UserCheck, Users } from "lucide-react";
import { WorkforceRosterSchema, WorkforceOffersSchema, WorkforceIncomingOffersSchema, GateShiftStaffingCandidatesSchema, type WorkforceRoster, type GateShiftStaffingCandidates } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { createWorkHubOperationId, workHubRequest } from "@/lib/work-hub-client";
import { WorkforceAttemptSchema, fingerprintWorkforceAttempt, submitWorkforceAttempt, type WorkforceAttempt } from "@/lib/workforce-offer-client";
import MiniCardDialogContent from "@/components/mini-card-dialog-content";
import { Dialog } from "@/components/ui/dialog";
import { WorkspacePanel, WorkspaceRow } from "./workspace-panel";
import "./workforce-panel.css";

type Employee = WorkforceRoster["employees"][number];
type Gap = { id: string; shiftId: string; shiftTitle?: string; startsAt: string; endsAt?: string; assignedCount: number; requiredCount: number; state: string };
type Copy = (en: string, es: string) => string;
type OfferCommand = { shiftId: string; expectedVersion: number; workerUserId: number } | { shiftId: string; offerId: string; expectedVersion: number; decision: "accepted" | "declined" };

export default function WorkforcePanel() {
  const { user } = useAuth();
  if (!user?.vendorId) return null;
  // Remount all expansion, profile and saved-operation state when the account context changes.
  const identity = JSON.stringify([user.userId, user.activeMembershipId, user.role, user.vendorRole, user.vendorId, user.partnerId]);
  return <Workforce key={identity} identity={identity} actor={user.userId} vendorId={user.vendorId} membershipId={user.activeMembershipId ?? 0} />;
}

function Workforce({ identity, actor, vendorId, membershipId }: { identity: string; actor: number; vendorId: number; membershipId: number }) {
  const { i18n } = useTranslation(), brand = useBrand(), qc = useQueryClient();
  const [, navigate] = useLocation();
  const c: Copy = (en, es) => i18n.language.startsWith("es") ? es : en;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [shiftFilter, setShiftFilter] = useState<"active" | "inactive" | "unknown">("active");
  const [callFilter, setCallFilter] = useState<"active" | "inactive" | "unknown">("active");
  const [profile, setProfile] = useState<Employee | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [attempt, setAttempt] = useState<WorkforceAttempt | null>(null), [invalidJournal, setInvalidJournal] = useState(false);
  const alive = useRef(true), lock = useRef(false);
  const headers = { "X-VNDRLY-Actor-User": String(actor), "X-VNDRLY-Vendor": String(vendorId), "X-VNDRLY-Membership": String(membershipId) };
  const journalKey = `workforce-offer:${identity}`;
  const roster = useQuery({ queryKey: ["work-hub", "workforce-roster", identity], queryFn: async () => {
    const result = WorkforceRosterSchema.parse(await workHubRequest("/workforce/roster", { headers }));
    if (result.owner.id !== vendorId) throw Error("workforce.context_changed");
    return result;
  }, refetchInterval: 15000, retry: false });
  const incoming = useQuery({ queryKey: ["work-hub", "workforce-incoming", identity], queryFn: async () => WorkforceIncomingOffersSchema.parse(await workHubRequest("/workforce/offers", { headers })), refetchInterval: 15000, retry: false });
  const gaps = useQuery({ queryKey: ["work-hub", "workforce-gaps", identity], queryFn: async () => {
    const response = await fetch("/api/implementation-a/workforce/coverage", { credentials: "include", headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error("coverage_unavailable");
    const value = await response.json() as { coverage: Gap[] };
    if (!Array.isArray(value.coverage)) throw Error("coverage_unavailable");
    return value.coverage.filter(row => row.state !== "covered" && row.assignedCount < row.requiredCount);
  }, retry: false, refetchInterval: 30000 });
  useEffect(() => {
    alive.current = true;
    try {
      const stored = sessionStorage.getItem(journalKey);
      if (stored) {
        const saved = WorkforceAttemptSchema.parse(JSON.parse(stored));
        if (saved.actorUserId !== actor || saved.vendorId !== vendorId) throw Error("wrong_account");
        setAttempt(saved);
      }
    } catch { setInvalidJournal(true); }
    return () => { alive.current = false; };
  }, [journalKey, actor, vendorId]);
  const assertCurrent = () => { if (!alive.current) throw Error("account_changed"); };
  async function refresh() { await qc.invalidateQueries({ queryKey: ["work-hub"] }); }
  async function execute(command?: OfferCommand) {
    if (lock.current || invalidJournal || !command && !attempt || command && attempt) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      let saved = attempt;
      if (!saved && command) {
        const { shiftId, ...rest } = command;
        const offerId = "offerId" in rest ? rest.offerId : undefined;
        const input = "decision" in rest ? { operationId: createWorkHubOperationId(), expectedVersion: rest.expectedVersion, decision: rest.decision } : { operationId: createWorkHubOperationId(), expectedVersion: rest.expectedVersion, workerUserId: rest.workerUserId };
        const base = { actorUserId: actor, vendorId, shiftId, ...(offerId ? { offerId } : {}), input };
        saved = { ...base, commandFingerprint: await fingerprintWorkforceAttempt(base) };
        assertCurrent();
        // Saving must succeed before sending, so a restart can recover the original request.
        sessionStorage.setItem(journalKey, JSON.stringify(saved)); setAttempt(saved);
      }
      if (!saved) return;
      const receipt = await submitWorkforceAttempt(saved, async (path, method, body) => {
        assertCurrent();
        const result = await workHubRequest(path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
        assertCurrent(); return result;
      });
      assertCurrent(); sessionStorage.removeItem(journalKey); setAttempt(null);
      setMessage(receipt.status === "pending" ? c("Offer saved. Awaiting the employee’s response.", "Oferta guardada. En espera de la respuesta del empleado.") : receipt.status === "accepted" ? c("Offer accepted. Assignment saved.", "Oferta aceptada. Asignación guardada.") : c("Offer declined.", "Oferta rechazada."));
      await refresh();
    } catch (error) {
      if (alive.current && (error as { rejected?: boolean })?.rejected) {
        sessionStorage.removeItem(journalKey); setAttempt(null);
        setMessage(c("This request was not applied. Review the refreshed shift and employee eligibility.", "No se aplicó esta solicitud. Revise el turno actualizado y la elegibilidad del empleado."));
        await refresh();
      } else if (alive.current) setMessage(c("The result could not be verified. Check the saved request before trying another offer.", "No se pudo verificar el resultado. Consulte la solicitud guardada antes de otra oferta."));
    }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function openMessage(person: Employee) {
    if (lock.current || !person.canMessage) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      assertCurrent();
      const result = await workHubRequest<{ channel?: { id: string } }>("/chats", { method: "POST", headers, body: JSON.stringify({ recipientUserId: person.userId }) });
      assertCurrent();
      if (!result.channel?.id) throw Error("chat_unavailable");
      navigate(`/work-hub/chat?channel=${encodeURIComponent(result.channel.id)}`);
    } catch { if (alive.current) setMessage(c("The conversation could not be opened. Try again.", "No se pudo abrir la conversación. Inténtelo de nuevo.")); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const staff = roster.isSuccess ? roster.data.employees : undefined;
  const onShift = staff?.filter(person => person.onShift === true), offShift = staff?.filter(person => person.onShift === false), unknownShift = staff?.filter(person => person.onShift === null);
  const onCall = staff?.filter(person => person.onCall === "active"), unavailable = staff?.filter(person => person.onCall === "inactive"), unknownCall = staff?.filter(person => person.onCall === "unknown");
  const toggle = (value: string) => setExpanded(expanded === value ? null : value);
  const unknown = c("Unknown", "Sin verificar"), missing = c("Unavailable", "No disponible");
  const openEmployee = (person: Employee) => setProfile(person);
  const employeeList = (people: Employee[] | undefined) => !people ? <p role="status">{missing}</p> : people.length ? people.map(person => <button type="button" className="hub-mini-record workforce-person" key={person.userId} onClick={() => openEmployee(person)}><span><strong>{person.name}</strong>{person.assignment && <small>{person.assignment}</small>}</span><ChevronRight aria-hidden="true" /></button>) : <p>{c("No employees in this list.", "No hay empleados en esta lista.")}</p>;
  const pending = incoming.isSuccess ? incoming.data.offers.filter(offer => offer.status === "pending") : [];
  return <WorkspacePanel title={c("Workforce", "Personal")} subtitle={c("Coverage, shifts, and availability", "Cobertura, turnos y disponibilidad")} icon={Users}>
    <WorkspaceRow icon={AlertTriangle} label={c("Coverage Gaps", "Brechas de cobertura")} value={gaps.isSuccess ? `${gaps.data.length} ${c("open", "abiertas")}` : missing} onClick={() => toggle("coverage")} expanded={expanded === "coverage"} />
    {expanded === "coverage" && <div className="hub-inline-panel" role="region" aria-label={c("Coverage gap details", "Detalles de brechas de cobertura")}>
      {gaps.isSuccess ? gaps.data.length ? gaps.data.map(gap => <CoverageGap key={gap.id} gap={gap} identity={identity} headers={headers} canOffer={roster.isSuccess && roster.data.canManageOffers} staff={staff ?? []} openEmployee={openEmployee} offer={command => void execute(command)} disabled={busy || !!attempt || invalidJournal} c={c} />) : <p>{c("No recorded coverage gaps.", "No hay brechas de cobertura registradas.")}</p> : <p role="status">{missing}</p>}
    </div>}
    <WorkspaceRow icon={UserCheck} label={c("On Shift Now", "En turno ahora")} value={onShift ? `${onShift.length} ${c("on shift", "en turno")}` : missing} onClick={() => toggle("shift")} expanded={expanded === "shift"} />
    {expanded === "shift" && <div className="hub-inline-panel" role="region" aria-label={c("Employee shifts", "Turnos de empleados")}>
      <div className="workforce-filters"><button type="button" aria-pressed={shiftFilter === "active"} onClick={() => setShiftFilter("active")}>{c("On Shift", "En turno")} · {onShift?.length ?? "—"}</button><button type="button" aria-pressed={shiftFilter === "inactive"} onClick={() => setShiftFilter("inactive")}>{c("Off Shift", "Fuera de turno")} · {offShift?.length ?? "—"}</button></div>
      {!!unknownShift?.length && <button type="button" className="workforce-unknown" aria-pressed={shiftFilter === "unknown"} onClick={() => setShiftFilter("unknown")}>{unknown} · {unknownShift.length}</button>}
      {employeeList(shiftFilter === "active" ? onShift : shiftFilter === "inactive" ? offShift : unknownShift)}
    </div>}
    <WorkspaceRow icon={Bell} label={c("On Call", "Guardia")} value={onCall ? `${onCall.length} ${c("on call", "de guardia")} · ${unavailable!.length} ${c("unavailable", "no disponibles")}` : missing} onClick={() => toggle("call")} expanded={expanded === "call"} />
    {expanded === "call" && <div className="hub-inline-panel" role="region" aria-label={c("Employee availability", "Disponibilidad de empleados")}>
      <div className="workforce-filters"><button type="button" aria-pressed={callFilter === "active"} onClick={() => setCallFilter("active")}>{c("Available", "Disponibles")} · {onCall?.length ?? "—"}</button><button type="button" aria-pressed={callFilter === "inactive"} onClick={() => setCallFilter("inactive")}>{c("Unavailable", "No disponibles")} · {unavailable?.length ?? "—"}</button></div>
      {!!unknownCall?.length && <button type="button" className="workforce-unknown" aria-pressed={callFilter === "unknown"} onClick={() => setCallFilter("unknown")}>{unknown} · {unknownCall.length}</button>}
      {employeeList(callFilter === "active" ? onCall : callFilter === "inactive" ? unavailable : unknownCall)}
    </div>}
    {pending.length > 0 && <><WorkspaceRow icon={Clock3} label={c("My Shift Offers", "Mis ofertas de turno")} value={`${pending.length}`} onClick={() => toggle("offers")} expanded={expanded === "offers"} />{expanded === "offers" && <div className="hub-inline-panel" role="region" aria-label={c("My Shift Offers", "Mis ofertas de turno")}>{pending.map(offer => <div className="hub-mini-record workforce-offer" key={offer.id}><div><strong>{offer.shiftTitle}</strong><small>{new Date(offer.startsAt).toLocaleString()} – {new Date(offer.endsAt).toLocaleString()}</small></div><div className="workforce-actions"><button type="button" disabled={busy || !!attempt || invalidJournal} onClick={() => void execute({ shiftId: offer.shiftId, offerId: offer.id, expectedVersion: offer.shiftVersion, decision: "accepted" })}>{c("Accept", "Aceptar")}</button><button type="button" disabled={busy || !!attempt || invalidJournal} onClick={() => void execute({ shiftId: offer.shiftId, offerId: offer.id, expectedVersion: offer.shiftVersion, decision: "declined" })}>{c("Decline", "Rechazar")}</button></div></div>)}</div>}</>}
    {staff && <p className="workforce-scope">{roster.data?.scope === "self" ? c("Your record", "Su registro") : roster.data?.scope === "managed_sites" ? c("Employees at your managed sites", "Empleados de sus sitios administrados") : c("Company gatekeepers", "Personal de acceso de la empresa")}{(unknownCall?.length ?? 0) > 0 ? ` · ${unknownCall!.length} ${unknown.toLowerCase()}` : ""}</p>}
    {incoming.isError && <p className="workforce-scope" role="status">{c("Shift offers are unavailable.", "Las ofertas de turno no están disponibles.")}</p>}
    {invalidJournal && <p role="alert" className="workforce-notice">{c("A saved request could not be verified. Do not create a replacement request.", "No se pudo verificar una solicitud guardada. No cree otra solicitud.")}</p>}
    {attempt && <button type="button" className="hub-text-link" disabled={busy} onClick={() => void execute()}>{c("Check saved offer request", "Consultar solicitud de oferta guardada")}</button>}
    {message && <p role="status" className="workforce-notice">{message}</p>}
    <Dialog open={!!profile} onOpenChange={open => { if (!open) setProfile(null); }}>
      {profile && <MiniCardDialogContent icon={Users} label={profile.name} definition={c("Employee work profile", "Perfil laboral del empleado")} iconColor={brand.primary}>
        <dl className="workforce-profile"><dt>{c("Shift", "Turno")}</dt><dd>{profile.onShift === null ? unknown : profile.onShift ? c("On Shift", "En turno") : c("Off Shift", "Fuera de turno")}</dd><dt>{c("On Call", "Guardia")}</dt><dd>{profile.onCall === "unknown" ? unknown : profile.onCall === "active" ? c("Available", "Disponible") : c("Unavailable", "No disponible")}</dd>{profile.assignment && <><dt>{c("Assignment", "Asignación")}</dt><dd>{profile.assignment}</dd></>}</dl>
        <div className="workforce-actions">{profile.profileHref?.match(/^\/field-employees\/[1-9]\d*$/) && <Link href={profile.profileHref}>{c("Open employee profile", "Abrir perfil del empleado")}</Link>}{profile.canMessage && <button type="button" disabled={busy} onClick={() => void openMessage(profile)}>{c("Message employee", "Enviar mensaje al empleado")}</button>}</div>
      </MiniCardDialogContent>}
    </Dialog>
  </WorkspacePanel>;
}

function eligible(evidence: GateShiftStaffingCandidates, person: GateShiftStaffingCandidates["candidates"][number]) {
  return evidence.qualificationConfiguration !== "unknown" && person.qualificationState !== "missing_or_unverified" && person.availability === "recorded_available" && person.eligibility.allowed && !person.eligibility.overrideRequired && person.requirements.every(requirement => requirement.currentRecorded && requirement.vendorVerified);
}
function CoverageGap({ gap, identity, headers, canOffer, staff, openEmployee, offer, disabled, c }: { gap: Gap; identity: string; headers: Record<string, string>; canOffer: boolean; staff: Employee[]; openEmployee: (person: Employee) => void; offer: (command: OfferCommand) => void; disabled: boolean; c: Copy }) {
  const [open, setOpen] = useState(false);
  const candidates = useQuery({ queryKey: ["work-hub", "workforce-candidates", identity, gap.shiftId], queryFn: async () => GateShiftStaffingCandidatesSchema.parse(await workHubRequest(`/shifts/${gap.shiftId}/staffing-candidates`, { headers })), enabled: open && canOffer, retry: false });
  const offers = useQuery({ queryKey: ["work-hub", "workforce-offers", identity, gap.shiftId], queryFn: async () => WorkforceOffersSchema.parse(await workHubRequest(`/shifts/${gap.shiftId}/offers`, { headers })), enabled: open && canOffer, retry: false, refetchInterval: 15000 });
  return <details className="workforce-gap" onToggle={event => setOpen(event.currentTarget.open)}><summary><span><strong>{gap.shiftTitle ?? c("Gate shift", "Turno de acceso")}</strong><small>{gap.assignedCount} / {gap.requiredCount} {c("assigned", "asignados")} · {new Date(gap.startsAt).toLocaleString()}</small></span></summary>
    {canOffer ? <>
      {(candidates.isPending || offers.isPending) && <p role="status">{c("Checking employees and saved offers…", "Consultando empleados y ofertas guardadas…")}</p>}
      {(candidates.isError || offers.isError) && <p role="status">{c("Staffing records are unavailable. Refresh before offering this shift.", "Los registros no están disponibles. Actualice antes de ofrecer este turno.")}</p>}
      {candidates.isSuccess && candidates.data.candidates.map(person => {
        const existing = offers.isSuccess ? offers.data.offers.filter(row => row.workerUserId === person.userId).at(-1) : undefined;
        const employee = staff.find(row => row.userId === person.userId) ?? { userId: person.userId, vendorPeopleId: person.vendorPeopleId, name: person.name, onCall: "unknown", onShift: null, shiftStartedAt: null, assignment: null, profileHref: null, canMessage: false };
        return <div className="hub-mini-record workforce-offer" key={person.userId}><button type="button" className="workforce-person" onClick={() => openEmployee(employee)}><strong>{person.name}</strong><small>{eligible(candidates.data, person) ? c("Recorded available for this shift", "Disponibilidad registrada para este turno") : c("Availability or eligibility needs review", "Revisar disponibilidad o elegibilidad")}</small></button>{existing ? <span className="workforce-offer-status">{existing.status === "pending" ? c("Offered · Pending", "Ofrecido · Pendiente") : existing.status === "accepted" ? c("Accepted", "Aceptado") : c("Declined", "Rechazado")}</span> : <button type="button" className="workforce-action" disabled={disabled || !offers.isSuccess || !eligible(candidates.data, person) || offers.data.shiftVersion !== candidates.data.shiftVersion || Date.parse(gap.startsAt) <= Date.now()} onClick={() => offer({ shiftId: gap.shiftId, expectedVersion: candidates.data.shiftVersion, workerUserId: person.userId })}>{c("Offer Shift", "Ofrecer turno")}</button>}</div>;
      })}
      {candidates.isSuccess && !candidates.data.candidates.length && <p>{c("No eligible company gatekeepers were returned.", "No se recibieron empleados de acceso elegibles.")}</p>}
      {candidates.data?.truncated && <p>{c("Showing the first 25 eligible records. Open the schedule to review more.", "Se muestran los primeros 25 registros. Abra el calendario para revisar más.")}</p>}
      {offers.isSuccess && offers.data.offers.filter(row => !candidates.data?.candidates.some(person => person.userId === row.workerUserId)).map(row => <div className="hub-mini-record" key={row.id}><strong>{row.workerName}</strong><span>{row.status === "pending" ? c("Offered · Pending", "Ofrecido · Pendiente") : row.status === "accepted" ? c("Accepted", "Aceptado") : c("Declined", "Rechazado")}</span></div>)}
    </> : <p>{c("Open the schedule to review coverage with your supervisor.", "Abra el calendario para revisar la cobertura con su supervisor.")}</p>}
    <Link className="hub-text-link" href={`/work-hub/calendar?shift=${encodeURIComponent(gap.shiftId)}`}>{c("Open shift", "Abrir turno")}</Link>
  </details>;
}
