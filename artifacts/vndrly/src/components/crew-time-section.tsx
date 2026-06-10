import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/api-error";
import {
  useGetCrewSessions,
  useGetLaborSummary,
  useCrewCheckIn,
  useCrewCheckOut,
  useCorrectCrewSession,
  useGenerateLaborLineItems,
  useGetCrewRoster,
  useAddCrewRosterEntry,
  useRemoveCrewRosterEntry,
  getGetCrewSessionsQueryKey,
  getGetLaborSummaryQueryKey,
  getGetTicketLineItemsQueryKey,
  getGetCrewRosterQueryKey,
} from "@workspace/api-client-react";
import type { CrewSession, FieldEmployee } from "@workspace/api-client-react";
import {
  useEligibleVendorFieldEmployees,
  useClearStaleFieldEmployeeSelection,
} from "@/hooks/use-eligible-vendor-field-employees";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ImagePill from "@/components/image-pill";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import GreenButton from "@/components/green-button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Users, Clock, AlertTriangle, Pencil, RefreshCw, LogIn, LogOut, X, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Ticket-state-conflict codes the API may emit when the foreman taps × on
// a crew chip but the underlying roster has already moved on (the chip is
// about to vanish on the next refresh, so pinning a stale error under it
// would just confuse the user). Mirrors the mobile chip-remove path in
// `artifacts/vndrly-mobile/lib/apiErrors.ts` (`STATE_CONFLICT_CODES`)
// — Task #561 added `crew.not_on_roster` to the mobile set, and Task #586
// brings the web chip-remove flow into the same shape (silent refresh on
// any of these, inline error pinned below the chip otherwise). Keep this
// set in lockstep with the mobile mirror; the schedule-ticket-dialog
// keeps its own narrower mirror because the schedule SAVE flow doesn't
// surface `crew.not_on_roster`.
const ROSTER_REMOVE_STATE_CONFLICT_CODES: ReadonlySet<string> = new Set([
  "crew.not_on_roster",
]);

function getApiErrorCodeFrom(e: unknown): string | undefined {
  if (!(e && typeof e === "object" && e instanceof Error)) return undefined;
  const errAny = e as { code?: unknown; data?: { code?: unknown; error?: unknown } | null };
  if (typeof errAny.code === "string" && errAny.code) return errAny.code;
  const data = errAny.data;
  if (data && typeof data === "object") {
    if (typeof data.code === "string" && data.code) return data.code;
    if (typeof data.error === "string" && data.error) return data.error;
  }
  return undefined;
}

function fmt(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}
function money(n: number) { return `$${n.toFixed(2)}`; }

function CrewPill({ name, employeeId, onRemove, removeLabel }: { name: string; employeeId?: number; onRemove?: () => void; removeLabel?: string }) {
  return (
    <ImagePill
      color="blue"
      interactive
      className="min-w-[100px]"
      data-testid={employeeId != null ? `chip-crew-${employeeId}` : undefined}
    >
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? `Remove ${name}`}
          className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/25 hover:bg-white/45 transition-colors text-white"
          data-testid={`button-remove-crew-${name.replace(/\s+/g, "-").toLowerCase()}`}
        >
          <X className="w-3 h-3" strokeWidth={3} />
        </button>
      )}
    </ImagePill>
  );
}

function AddCrewPill({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <PillButton
      type="button"
      color="blue"
      onClick={onClick}
      disabled={disabled}
      className="min-w-[110px]"
      data-testid="button-add-crew-roster"
    >
      <Plus className="w-3.5 h-3.5" strokeWidth={3} />
      {label}
    </PillButton>
  );
}

export function CrewTimeSection({ ticketId, vendorId, canEdit, canEditRoster }: { ticketId: number; vendorId: number | null; canEdit: boolean; canEditRoster: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { data: sessions = [] } = useGetCrewSessions(ticketId, { query: { queryKey: getGetCrewSessionsQueryKey(ticketId) } });
  const { data: summary } = useGetLaborSummary(ticketId, { query: { queryKey: getGetLaborSummaryQueryKey(ticketId) } });
  // Task #519: source from the shared helper so a stale page from a
  // previously-active vendor membership can't briefly leak in. We still
  // re-filter by the ticket's vendorId because the helper only narrows its
  // fetch to user.vendorId for vendor sessions — admin / partner sessions
  // get the unscoped list and we only want this ticket's vendor's people.
  const { fieldEmployees } = useEligibleVendorFieldEmployees();
  const { data: roster = [] } = useGetCrewRoster(ticketId, { query: { queryKey: getGetCrewRosterQueryKey(ticketId) } });
  const checkIn = useCrewCheckIn();
  const checkOut = useCrewCheckOut();
  const correct = useCorrectCrewSession();
  const generate = useGenerateLaborLineItems();
  const addRoster = useAddCrewRosterEntry();
  const removeRoster = useRemoveCrewRosterEntry();
  const [addOpen, setAddOpen] = useState(false);
  const [pickedEmpId, setPickedEmpId] = useState("");
  const [rosterPickerOpen, setRosterPickerOpen] = useState(false);
  const [rosterPickedEmpId, setRosterPickedEmpId] = useState("");
  const [correctSession, setCorrectSession] = useState<CrewSession | null>(null);
  const [reason, setReason] = useState("");
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  // Task #586: per-chip inline error keyed by employeeId. Mirrors the
  // mobile chip-remove flow (Task #561 / #571): when the foreman taps ×
  // on a roster chip and the server rejects with a non-state-conflict
  // code, we pin the localized error directly under the chip instead of
  // popping a toast. State-conflict codes (`crew.not_on_roster` etc.)
  // trigger a silent roster invalidate so the chip vanishes on its own.
  const [removeErrorByEmployee, setRemoveErrorByEmployee] = useState<Record<number, string>>({});

  function clearRemoveErrorFor(employeeId: number) {
    setRemoveErrorByEmployee((prev) => {
      if (prev[employeeId] === undefined) return prev;
      const next = { ...prev };
      delete next[employeeId];
      return next;
    });
  }

  // Task #515: also drop deactivated vendor_people so the crew check-in
  // dialog mirrors the active-only set the phone-intake foreman dropdown
  // (Task #510) and the Create New Job picker (Task #511) expose. The
  // underlying `useListFieldEmployees` defaults to active-only, but we
  // re-assert as defense-in-depth so a dispatcher can't check in a
  // deactivated worker the Task #507 server tenancy guard would reject.
  const eligible: FieldEmployee[] = ((fieldEmployees ?? []) as FieldEmployee[])
    .filter(e => !vendorId || e.vendorId === vendorId)
    .filter(e => e.isActive !== false);
  const openIds = new Set(sessions.filter(s => !s.checkOutAt).map(s => s.employeeId));
  const hasOpen = openIds.size > 0;
  // "On-site too long" warning: any open session whose elapsed time exceeds 8h.
  const LONG_SESSION_HOURS = 8;
  const longOpenSessions = sessions.filter(
    s => !s.checkOutAt && (Date.now() - new Date(s.checkInAt).getTime()) / 3_600_000 > LONG_SESSION_HOURS,
  );
  const longOpenNames = Array.from(new Set(longOpenSessions.map(s => s.employeeName)));

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getGetCrewSessionsQueryKey(ticketId) });
    qc.invalidateQueries({ queryKey: getGetLaborSummaryQueryKey(ticketId) });
  };

  const invalidateRoster = () => {
    qc.invalidateQueries({ queryKey: getGetCrewRosterQueryKey(ticketId) });
  };

  const rosterEmployeeIds = new Set(roster.map(r => r.employeeId));
  // Task #515: same active-only contract for the "Crew on Site" roster
  // picker so it can't list deactivated vendor_people either.
  const eligibleForRoster: FieldEmployee[] = ((fieldEmployees ?? []) as FieldEmployee[])
    .filter(e => !vendorId || e.vendorId === vendorId)
    .filter(e => e.isActive !== false)
    .filter(e => !rosterEmployeeIds.has(e.id));

  // Task #519: clear stale single-pick selections so a membership switch /
  // soft-delete / deactivation while the picker is open can't let the user
  // submit an employeeId the server's Task #507 tenancy guard would 400 on.
  // The eligible set passed in is already scoped to this ticket's vendor
  // (and is also active-only per Task #515 — and for the roster picker,
  // excludes already-rostered crew), so the helper does the right cleanup
  // for both vendor and admin sessions.
  useClearStaleFieldEmployeeSelection({
    selectedId: pickedEmpId,
    eligibleForemen: eligible,
    fieldEmployees,
    onClear: () => setPickedEmpId(""),
  });
  useClearStaleFieldEmployeeSelection({
    selectedId: rosterPickedEmpId,
    eligibleForemen: eligibleForRoster,
    fieldEmployees,
    onClear: () => setRosterPickedEmpId(""),
  });

  function openCorrection(s: CrewSession) {
    setCorrectSession(s);
    setReason("");
    setEditIn(s.checkInAt ? new Date(s.checkInAt).toISOString().slice(0, 16) : "");
    setEditOut(s.checkOutAt ? new Date(s.checkOutAt).toISOString().slice(0, 16) : "");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />{t("crewTime.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Crew on Site roster — first thing in the card */}
        <div className="space-y-2" data-testid="section-crew-on-site">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("crewTime.crewOnSite")}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {roster.length === 0 && (
              <span className="text-sm text-muted-foreground italic">{t("crewTime.noCrewOnSite")}</span>
            )}
            {roster.map(r => {
              const inlineErr = removeErrorByEmployee[r.employeeId];
              return (
                <div key={r.id} className="flex flex-col items-start gap-0.5">
                  <CrewPill
                    name={r.employeeName ?? t("crewTime.employeeFallback", { id: r.employeeId })}
                    employeeId={r.employeeId}
                    removeLabel={t("crewTime.removeFromRoster")}
                    onRemove={canEditRoster ? async () => {
                      // Task #586: clear any prior pinned error for this
                      // chip before re-attempting so the message can't
                      // outlive the failure that produced it.
                      clearRemoveErrorFor(r.employeeId);
                      try {
                        await removeRoster.mutateAsync({ id: ticketId, employeeId: r.employeeId });
                        invalidateRoster();
                      } catch (e) {
                        const code = getApiErrorCodeFrom(e);
                        if (code && ROSTER_REMOVE_STATE_CONFLICT_CODES.has(code)) {
                          // The roster has already moved on — silently
                          // refresh so the chip vanishes on its own,
                          // matching the mobile behavior. No toast, no
                          // inline error pinned under a chip about to
                          // disappear.
                          invalidateRoster();
                          return;
                        }
                        // Non-conflict failure: pin the localized error
                        // under this specific chip instead of popping
                        // the generic crewTime.failed toast.
                        const message = translateApiError(e, t, t("crewTime.failed"));
                        setRemoveErrorByEmployee((prev) => ({ ...prev, [r.employeeId]: message }));
                      }
                    } : undefined}
                  />
                  {inlineErr && (
                    <div
                      className="text-[11px] text-red-600 ml-1"
                      data-testid={`inline-error-roster-remove-${r.employeeId}`}
                    >
                      {inlineErr}
                    </div>
                  )}
                </div>
              );
            })}
            {canEditRoster && (
              <Dialog open={rosterPickerOpen} onOpenChange={setRosterPickerOpen}>
                <DialogTrigger asChild>
                  <span>
                    <AddCrewPill
                      label={roster.length === 0 ? t("crewTime.addCrewMember") : t("crewTime.addAnother")}
                      onClick={() => setRosterPickerOpen(true)}
                      disabled={eligibleForRoster.length === 0}
                    />
                  </span>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{t("crewTime.addToRoster")}</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <Select value={rosterPickedEmpId} onValueChange={setRosterPickedEmpId}>
                      <SelectTrigger data-testid="select-roster-employee"><SelectValue placeholder={t("crewTime.pickEmployee")} /></SelectTrigger>
                      <SelectContent>
                        {eligibleForRoster.length === 0 && (
                          <div className="p-2 text-sm text-muted-foreground">{t("crewTime.noEligibleEmployees")}</div>
                        )}
                        {eligibleForRoster.map(e => (
                          <SelectItem key={e.id} value={String(e.id)}>
                            {e.firstName} {e.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex justify-end gap-2">
                      <PillButton color="red" onClick={() => setRosterPickerOpen(false)}>{t("crewTime.cancel")}</PillButton>
                      <PillButton
                        color="blue"
                        disabled={!rosterPickedEmpId || addRoster.isPending}
                        data-testid="button-confirm-add-roster"
                        onClick={async () => {
                          try {
                            await addRoster.mutateAsync({ id: ticketId, data: { employeeId: Number(rosterPickedEmpId) } });
                            invalidateRoster();
                            setRosterPickerOpen(false);
                            setRosterPickedEmpId("");
                            toast({ title: t("crewTime.addedToRoster") });
                          } catch (e) {
                            toast({ title: t("crewTime.failed"), description: e instanceof Error ? e.message : String(e), variant: "destructive" });
                          }
                        }}
                      >
                        {t("crewTime.add")}
                      </PillButton>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {hasOpen && (
          <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div>{t("crewTime.stillCheckedIn", { count: openIds.size })}</div>
          </div>
        )}

        {longOpenNames.length > 0 && (
          <div className="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div>
              {t("crewTime.onSiteOver", { hours: LONG_SESSION_HOURS, names: longOpenNames.join(", ") })}
            </div>
          </div>
        )}

        {summary && summary.people.length > 0 && (
          <div className="border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium">{t("crewTime.person")}</th>
                  <th className="text-right p-2 font-medium">{t("crewTime.regHrs")}</th>
                  <th className="text-right p-2 font-medium">{t("crewTime.otHrs")}</th>
                  <th className="text-right p-2 font-medium">{t("crewTime.totalHrs")}</th>
                  <th className="text-right p-2 font-medium">{t("crewTime.rate")}</th>
                  <th className="text-right p-2 font-medium">{t("crewTime.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.people.map(p => (
                  <tr key={p.employeeId} className="border-t">
                    <td className="p-2">{p.employeeName}</td>
                    <td className="p-2 text-right">{p.regularHours.toFixed(2)}</td>
                    <td className="p-2 text-right text-amber-700">{p.overtimeHours.toFixed(2)}</td>
                    <td className="p-2 text-right font-medium">{p.totalHours.toFixed(2)}</td>
                    <td className="p-2 text-right">{money(p.rate)}</td>
                    <td className="p-2 text-right font-medium">{money(p.totalCost)}</td>
                  </tr>
                ))}
                <tr className="border-t bg-muted/30 font-medium">
                  <td className="p-2">{t("crewTime.totals")}</td>
                  <td className="p-2 text-right">{summary.totals.regularHours.toFixed(2)}</td>
                  <td className="p-2 text-right">{summary.totals.overtimeHours.toFixed(2)}</td>
                  <td className="p-2 text-right">{summary.totals.totalHours.toFixed(2)}</td>
                  <td></td>
                  <td className="p-2 text-right">{money(summary.totals.totalCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {hasOpen && (
          <div className="border rounded overflow-hidden">
            <div className="bg-muted/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("crewTime.onSiteNow")}
            </div>
            <ul className="divide-y">
              {sessions.filter(s => !s.checkOutAt).map(s => {
                const elapsed = (Date.now() - new Date(s.checkInAt).getTime()) / 3_600_000;
                return (
                  <li key={s.id} className="flex items-center justify-between p-2 text-sm">
                    <span>{s.employeeName ?? t("crewTime.employeeFallback", { id: s.employeeId })}</span>
                    <span className={elapsed > 8 ? "text-red-700 font-medium" : "text-muted-foreground"}>
                      {t("crewTime.inForSince", { hours: elapsed.toFixed(1), when: fmt(s.checkInAt) })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 font-medium">{t("crewTime.person")}</th>
                <th className="text-left p-2 font-medium">{t("crewTime.checkInCol")}</th>
                <th className="text-left p-2 font-medium">{t("crewTime.checkOutCol")}</th>
                <th className="text-right p-2 font-medium">{t("crewTime.hours")}</th>
                <th className="text-right p-2 font-medium">{t("crewTime.rate")}</th>
                <th className="text-right p-2 font-medium">{t("crewTime.cost")}</th>
                <th className="text-left p-2 font-medium">{t("crewTime.source")}</th>
                {canEdit && <th className="p-2"></th>}
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 && (
                <tr><td colSpan={canEdit ? 8 : 7} className="p-3 text-muted-foreground text-center">{t("crewTime.noSessions")}</td></tr>
              )}
              {sessions.map(s => {
                const endMs = s.checkOutAt ? new Date(s.checkOutAt).getTime() : Date.now();
                const hours = Math.max(0, (endMs - new Date(s.checkInAt).getTime()) / 3_600_000);
                const rate = parseFloat(s.hourlyRateAtTime ?? "0");
                const cost = hours * rate;
                return (
                  <tr key={s.id} className="border-t">
                    <td className="p-2">{s.employeeName ?? t("crewTime.employeeFallback", { id: s.employeeId })}</td>
                    <td className="p-2">{fmt(s.checkInAt)}</td>
                    <td className="p-2">{s.checkOutAt ? fmt(s.checkOutAt) : <span className="text-amber-700 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{t("crewTime.stillIn")}</span>}</td>
                    <td className="p-2 text-right">{hours.toFixed(2)}</td>
                    <td className="p-2 text-right">{rate ? money(rate) : "—"}</td>
                    <td className="p-2 text-right font-medium">{rate ? money(cost) : "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{s.source}{s.correctedReason ? ` — ${s.correctedReason}` : ""}</td>
                    {canEdit && (
                      <td className="p-2 text-right space-x-1">
                        {!s.checkOutAt && (
                          <PillButton color="image" onClick={async () => {
                            await checkOut.mutateAsync({ id: ticketId, employeeId: s.employeeId, data: {} });
                            invalidateAll();
                            toast({ title: t("crewTime.checkedOutToast") });
                          }}><LogOut className="w-3 h-3 mr-1" />{t("crewTime.out")}</PillButton>
                        )}
                        <PillButton color="image" className="min-w-[28px] px-0" onClick={() => openCorrection(s)}><Pencil className="w-3 h-3" /></PillButton>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <PillButton color="image"><LogIn className="w-4 h-4 mr-1" />{t("crewTime.checkInCrewMember")}</PillButton>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{t("crewTime.checkInCrewMemberDialog")}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Select value={pickedEmpId} onValueChange={setPickedEmpId}>
                    <SelectTrigger><SelectValue placeholder={t("crewTime.pickEmployee")} /></SelectTrigger>
                    <SelectContent>
                      {eligible.length === 0 && (
                        <div
                          className="p-2 text-sm text-muted-foreground"
                          data-testid="empty-checkin-employee-list"
                        >
                          {t("crewTime.noEligibleEmployees")}
                        </div>
                      )}
                      {eligible.map(e => (
                        <SelectItem key={e.id} value={String(e.id)} disabled={openIds.has(e.id)}>
                          {e.firstName} {e.lastName}{openIds.has(e.id) ? ` ${t("crewTime.alreadyIn")}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex justify-end gap-2">
                    <PillButton color="red" onClick={() => setAddOpen(false)}>{t("crewTime.cancel")}</PillButton>
                    <PillButton color="blue" disabled={!pickedEmpId || checkIn.isPending} onClick={async () => {
                      try {
                        await checkIn.mutateAsync({ id: ticketId, employeeId: Number(pickedEmpId), data: {} });
                        invalidateAll();
                        setAddOpen(false);
                        setPickedEmpId("");
                        toast({ title: t("crewTime.checkedInToast") });
                      } catch (e) {
                        toast({ title: t("crewTime.failed"), description: e instanceof Error ? e.message : String(e), variant: "destructive" });
                      }
                    }}>{t("crewTime.checkIn")}</PillButton>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <PillButton color="image" onClick={async () => {
              const r = await generate.mutateAsync({ id: ticketId });
              qc.invalidateQueries({ queryKey: getGetTicketLineItemsQueryKey(ticketId) });
              toast({ title: t("crewTime.laborUpdated"), description: t("crewTime.rowsGenerated", { count: r?.created ?? 0 }) });
            }}><RefreshCw className="w-4 h-4 mr-1" />{t("crewTime.generateLabor")}</PillButton>
          </div>
        )}

        <Dialog open={!!correctSession} onOpenChange={(o) => { if (!o) setCorrectSession(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("crewTime.correctSession")}</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-muted-foreground">{t("crewTime.checkInCol")}</label>
                <Input type="datetime-local" value={editIn} onChange={(e) => setEditIn(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("crewTime.checkOutCol")}</label>
                <Input type="datetime-local" value={editOut} onChange={(e) => setEditOut(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("crewTime.reasonLabel")}</label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("crewTime.reasonPlaceholder")} />
              </div>
              <div className="flex justify-end gap-2">
                <PillButton color="red" onClick={() => setCorrectSession(null)}>{t("crewTime.cancel")}</PillButton>
                <GreenButton disabled={!reason.trim() || correct.isPending} onClick={async () => {
                  try {
                    await correct.mutateAsync({
                      id: ticketId,
                      sessionId: correctSession!.id,
                      data: {
                        reason,
                        checkInAt: editIn ? new Date(editIn).toISOString() : undefined,
                        checkOutAt: editOut ? new Date(editOut).toISOString() : null,
                      },
                    });
                    invalidateAll();
                    setCorrectSession(null);
                    toast({ title: t("crewTime.sessionCorrected") });
                  } catch (e) {
                    toast({ title: t("crewTime.failed"), description: e instanceof Error ? e.message : String(e), variant: "destructive" });
                  }
                }}>{t("crewTime.save")}</GreenButton>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
