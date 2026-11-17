import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { Switch } from "./ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { ProfileActionButton, profileRequest } from "./gate-profile-chrome";
import { WorkHubAwaySettings } from "./work-hub/away-settings";
import notificationCopy from "@/lib/gate-profile-notification-copy.json";

type ScheduleDraft = { startDay: string; endDay: string; allDay: boolean; startTime: string; endTime: string };
type Schedule = ScheduleDraft & { startsAt: string; endsAt: string };
type Preferences = Record<string, unknown> & { mode?: "gate" | "office"; pushEnabled: boolean; dndImmediate?: boolean; dndSchedule?: Schedule | null; dndStartHour: number | null; dndEndHour: number | null; alertsSmsAvailable?: boolean };
const initialSchedule: ScheduleDraft = { startDay: "", endDay: "", allDay: true, startTime: "09:00", endTime: "17:00" };
const gateRows = [["scheduleEnabled", "schedule"], ["gateCrewEnabled", "gate_crew"], ["messagesEnabled", "messages"], ["handoffsEnabled", "handoffs"], ["tasksEnabled", "tasks"], ["complianceEnabled", "compliance"], ["alertsEnabled", "alerts"]] as const;
const officeRows = [["ticketsEnabled", "tickets"], ["hotlistEnabled", "hotlist"], ["complianceEnabled", "compliance"], ["crewEnabled", "crew"], ["systemEnabled", "system"], ["commentsEnabled", "comments"], ["commentMentionEmailEnabled", "commentMentionEmail"], ["commentReplyEmailEnabled", "commentReplyEmail"]] as const;

export function notificationSchedule(draft: ScheduleDraft): Schedule | null {
  if (!draft.startDay && !draft.endDay) return null;
  const starts = new Date(`${draft.startDay}T${draft.allDay ? "00:00" : draft.startTime}`);
  const ends = new Date(`${draft.endDay}T${draft.allDay ? "00:00" : draft.endTime}`);
  if (draft.allDay) ends.setDate(ends.getDate() + 1);
  if (!draft.startDay || !draft.endDay || !Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || starts >= ends) throw Error("Choose a valid start and end for Do Not Disturb.");
  return { ...draft, startsAt: starts.toISOString(), endsAt: ends.toISOString() };
}

export default function GateProfileNotifications() {
  const { user } = useAuth(), { i18n } = useTranslation();
  const es = i18n.language.startsWith("es"), copy = es ? notificationCopy.es : notificationCopy.en;
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [prefs, setPrefs] = useState<Preferences | null>(null), [schedule, setSchedule] = useState(initialSchedule);
  const [busy, setBusy] = useState(false), [smsChanged, setSmsChanged] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false), [away, setAway] = useState(false);
  const query = useQuery({ queryKey: ["gate-profile-notifications", user?.userId, user?.activeMembershipId],
    queryFn: ({ signal }) => profileRequest<Preferences>("/notifications/preferences", { signal }) });
  useEffect(() => { if (query.data && !prefs) { setPrefs(query.data); setSchedule(query.data.dndSchedule ?? initialSchedule); } }, [query.data, prefs]);
  const rows = prefs?.mode === "gate" ? [
    ...gateRows.map(([key, category]) => ({ key, label: copy.categories[category], description: copy.gateDescriptions[category] })),
    { key: "alertsEmailEnabled", label: copy.alertChannels.email, description: copy.alertChannels.emailDesc },
    { key: "alertsSmsEnabled", label: copy.alertChannels.sms, description: copy.alertChannels.smsDisclosure },
  ] : [
    ...officeRows.map(([key, category]) => ({ key, label: copy.rows[category], description: copy.rows[`${category}Desc`] })),
    { key: "workHubMessagesEnabled", label: c("Work Hub messages", "Mensajes de Work Hub"), description: c("Message notices and sound when notifications are permitted. Your device controls background sound.", "Avisos y sonido de mensajes con notificaciones permitidas. El dispositivo controla el sonido en segundo plano.") },
  ];
  rows.push({ key: "pushEnabled", label: copy.rows.push, description: copy.rows.pushDesc });
  async function save() {
    if (!prefs || busy) return;
    setBusy(true); setError(""); setSaved(false);
    try {
      const planned = notificationSchedule(schedule);
      const body = Object.fromEntries(rows.filter(row => row.key !== "alertsSmsEnabled" || smsChanged).map(row => [row.key, row.key === "workHubMessagesEnabled" ? prefs[row.key] !== false : Boolean(prefs[row.key])]));
      const next = await profileRequest<Preferences>("/notifications/preferences", { method: "PATCH", body: JSON.stringify({
        ...body, dndStartHour: prefs.dndStartHour, dndEndHour: prefs.dndEndHour,
        ...(planned || prefs.dndSchedule ? { dndSchedule: planned, dndStartHour: null, dndEndHour: null } : {}),
      }) });
      setPrefs(next); setSmsChanged(false); setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : c("Could not save preferences.", "No se pudieron guardar las preferencias.")); } finally { setBusy(false); }
  }
  async function immediate(value: boolean) {
    setBusy(true); setError(""); setSaved(false);
    try { const next = await profileRequest<Preferences>("/notifications/preferences", { method: "PATCH", body: JSON.stringify({ dndImmediate: value }) }); setPrefs(current => current && { ...current, dndImmediate: next.dndImmediate }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  }
  if (query.error) return <p role="alert">{query.error.message}<ProfileActionButton onClick={() => void query.refetch()}>{c("Retry", "Reintentar")}</ProfileActionButton></p>;
  if (!prefs) return <p>{c("Loading…", "Cargando…")}</p>;
  const dndTitle = c("Do Not Disturb / Vacation", "No molestar / Vacaciones");
  const membership = user?.availableMemberships.find(m => m.id === user.activeMembershipId);
  const owner = membership ? { type: membership.orgType, id: membership.orgId } : user?.vendorId ? { type: "vendor" as const, id: user.vendorId } : user?.partnerId ? { type: "partner" as const, id: user.partnerId } : null;
  return <div className="space-y-6" data-testid="gate-profile-notifications">
    <div className="rounded-xl border border-[var(--brand-primary)] divide-y divide-white/10">
      {rows.map(row => <div key={row.key} className="flex items-center justify-between gap-3 p-3.5">
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{row.label}</p><p className="text-xs text-muted-foreground leading-4 mt-1">{row.description}</p>
          {row.key === "alertsSmsEnabled" && !prefs.alertsSmsAvailable && <p className="text-xs text-muted-foreground">{copy.alertChannels.phoneRequired}</p>}
        </div><Switch aria-label={row.label} checked={row.key === "workHubMessagesEnabled" ? prefs[row.key] !== false : Boolean(prefs[row.key])}
          disabled={busy || (row.key === "alertsSmsEnabled" && !prefs.alertsSmsAvailable && !prefs.alertsSmsEnabled)} onCheckedChange={value => { setPrefs({ ...prefs, [row.key]: value }); if (row.key === "alertsSmsEnabled") setSmsChanged(true); setSaved(false); }} />
      </div>)}
    </div>
    <section className="rounded-xl border border-[var(--brand-primary)] p-3.5 space-y-3" data-testid="profile-dnd">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{dndTitle}</h3><Switch aria-label={dndTitle} checked={Boolean(prefs.dndImmediate)} disabled={busy} onCheckedChange={value => void immediate(value)} /></div>
      <p className="text-xs text-muted-foreground">{c("Mute push notifications during the selected dates and times.", "Silencia las notificaciones push durante el período seleccionado.")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {([ ["startDay", c("Start day", "Día de inicio")], ["endDay", c("End day", "Día de fin")] ] as const).map(([key, label]) => <label key={key} className="text-xs space-y-1">{label}<input aria-label={label} type="date" className="block w-full min-w-0 p-2" value={schedule[key]} disabled={busy} onChange={e => { setSchedule({ ...schedule, [key]: e.target.value }); setSaved(false); }} /></label>)}
      </div>
      <label className="flex items-center gap-2 text-sm">{c("All day", "Todo el día")}<Switch aria-label={c("All day", "Todo el día")} checked={schedule.allDay} disabled={busy} onCheckedChange={allDay => { setSchedule({ ...schedule, allDay }); setSaved(false); }} /></label>
      {!schedule.allDay && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {([ ["startTime", c("Start time", "Hora de inicio")], ["endTime", c("End time", "Hora de fin")] ] as const).map(([key, label]) => <label key={key} className="text-xs space-y-1">{label}<input aria-label={label} type="time" className="block w-full min-w-0 p-2" value={schedule[key]} disabled={busy} onChange={e => { setSchedule({ ...schedule, [key]: e.target.value }); setSaved(false); }} /></label>)}
      </div>}
      {error && <p role="alert" className="text-sm">{error}</p>}{saved && <p role="status" className="text-sm">{c("Preferences saved.", "Preferencias guardadas.")}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProfileActionButton onClick={() => setAway(true)}>{c("Away replies", "Respuestas durante tu ausencia")}</ProfileActionButton>
        <ProfileActionButton onClick={() => void save()} disabled={busy}>{c("Save preferences", "Guardar preferencias")}</ProfileActionButton>
      </div>
    </section>
    <Dialog open={away} onOpenChange={setAway}><DialogContent className="gate-profile-page max-h-[85vh] overflow-y-auto border-[var(--brand-primary)] bg-[#242426] text-[#ececec]">
      <DialogHeader><DialogTitle>{c("Away replies", "Respuestas durante tu ausencia")}</DialogTitle><DialogDescription>{c("Choose when and where to use your away reply.", "Elige cuándo y dónde usar tu respuesta de ausencia.")}</DialogDescription></DialogHeader>
      {owner && user ? <WorkHubAwaySettings miniCard identity={`${user.userId}:${user.activeMembershipId}`} actorId={user.userId} owner={owner} /> : <p>{c("Select your company to manage away replies.", "Selecciona tu empresa para administrar las respuestas de ausencia.")}</p>}
    </DialogContent></Dialog>
  </div>;
}
