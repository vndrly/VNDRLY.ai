import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { summarizeWorkday, type WorkdayOwner, WorkdayHistoryPageSchema, WorkdaySnapshotSchema, WorkdayEventSchema } from "@workspace/api-zod";
import { z } from "zod/v4";
import { useAuth } from "@/hooks/use-auth";
import { useGateCopy } from "@/components/gate/GateChrome";
import { apiFetch } from "@/lib/api";
import { mobileOwner } from "@/lib/work-hub-mobile";
import { WorkspaceRow } from "./WorkspacePanel";
import HomeTaskCardRow, { TaskIcon } from "./HomeTaskCardRow";
import { ModalPressable as Pressable } from "@/components/ModalDraft";

type Shift = { id: string; startedAt: string; endedAt: string | null; milliseconds: number; state: string };
type Hours = { milliseconds: number; state: string | null; shifts: Shift[] };
type CompanyHours = { owner: WorkdayOwner; viewerUserId: number; range: { start: string; end: string }; mineMilliseconds: number; totalMilliseconds: number; employees: { userId: number; name: string; milliseconds: number }[] };
const detailSchema = z.object({ ...WorkdaySnapshotSchema.shape, events: z.array(WorkdayEventSchema) });
const formatHours = (milliseconds: number) => { const minutes = Math.floor(milliseconds / 60000); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; };
const month = () => { const now = new Date(); return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), end: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() }; };

async function loadHours(userId: number, owner: WorkdayOwner, range: { start: string; end: string }): Promise<Hours> {
  const shifts: Shift[] = [], seen = new Set<string>();
  let cursor: string | null = null, milliseconds = 0, state: string | null = null;
  do {
    const params = new URLSearchParams({ start: range.start, end: range.end, limit: "100", ...(cursor ? { after: cursor } : {}) });
    const page = WorkdayHistoryPageSchema.parse(await apiFetch(`/api/work-hub/workday/workers/${userId}?${params}`));
    if (Date.parse(page.range.start) !== Date.parse(range.start) || Date.parse(page.range.end) !== Date.parse(range.end)) throw Error("Workday range changed");
    for (const item of page.items) {
      if (item.workerUserId !== userId || item.owner.type !== owner.type || item.owner.id !== owner.id) throw Error("Workday account changed");
      if (item.summary.reviewFlags.includes("clock_ahead_of_server")) throw Error("Workday clock needs review");
      let amount = item.reportedWorkMillisecondsInRange;
      let summary = item.summary;
      if (amount === null) {
        const detail = detailSchema.parse(await apiFetch(`/api/work-hub/workday/shifts/${encodeURIComponent(item.id)}`));
        summary = summarizeWorkday(detail.events);
        if (detail.workerUserId !== userId || detail.owner.type !== owner.type || detail.owner.id !== owner.id || summary.reviewFlags.includes("clock_ahead_of_server")) throw Error("Workday account changed");
        let from: number | null = null;
        amount = 0;
        const start = Date.parse(range.start), end = Math.min(Date.now(), Date.parse(range.end));
        for (const event of detail.events) {
          const at = Date.parse(event.capturedAt);
          if (event.kind === "start_shift" || event.kind === "end_unpaid_break") from = at;
          else { if (from !== null) amount += Math.max(0, Math.min(end, at) - Math.max(start, from)); from = null; }
        }
        if (from !== null) amount += Math.max(0, end - Math.max(start, from));
      }
      if (!summary.endedAt) state = summary.state;
      milliseconds += amount;
      shifts.push({ id: item.id, startedAt: summary.startedAt, endedAt: summary.endedAt, state: summary.state, milliseconds: amount });
    }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw Error("Workday history did not advance");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { milliseconds, state, shifts: shifts.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)) };
}

function ShiftRecord({ shift, worker, mine = false }: { shift: Shift; worker?: number; mine?: boolean }) {
  const c = useGateCopy();
  const day = shift.startedAt.slice(0, 10);
  const status = shift.endedAt ? `${c("Ended", "Finalizó")} ${new Date(shift.endedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : shift.state === "on_break" ? c("On unpaid break", "En descanso no remunerado") : c("Shift in progress", "Turno en curso");
  return <Pressable accessibilityRole="link" onPress={() => router.push(`/work-hub/calendar?day=${encodeURIComponent(day)}${worker ? `&worker=${worker}` : ""}` as never)} style={{ minHeight: 48, borderBottomWidth: 1, borderBottomColor: "#343434", paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 }}>
    <View style={{ flex: 1 }}><Text style={{ color: mine ? "#4ade80" : "#ececec", fontSize: 13, fontWeight: "700" }}>{new Date(shift.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</Text><Text style={{ color: mine ? "#4ade80" : "#a3a3a3", fontSize: 11, marginTop: 2 }}>{status}</Text></View>
    <Text style={{ color: "#ececec", fontSize: 13 }}>{formatHours(shift.milliseconds)}</Text><TaskIcon kind="chevron" size={16} />
  </Pressable>;
}

function EmployeeHours({ person, owner, range, viewerId, webCard = false }: { person: CompanyHours["employees"][number]; owner: WorkdayOwner; range: { start: string; end: string }; viewerId: number; webCard?: boolean }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ["work-hub", "employee-shift-hours", viewerId, owner.type, owner.id, person.userId, range.start], queryFn: () => loadHours(person.userId, owner, range), enabled: open, retry: false, refetchInterval: open ? 15000 : false });
  const own = person.userId === viewerId;
  return <View>{webCard ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ minHeight: 48, borderBottomWidth: 1, borderBottomColor: "#343434", paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 }}><View style={{ flex: 1 }}><Text style={{ color: own ? "#4ade80" : "#ececec", fontSize: 13, fontWeight: "700" }}>{person.name}</Text>{own ? <Text style={{ color: "#4ade80", fontSize: 11, marginTop: 2 }}>Me</Text> : null}</View><Text style={{ color: own ? "#4ade80" : "#ececec", fontSize: 13 }}>{formatHours(person.milliseconds)}</Text><View style={open ? { transform: [{ rotate: "90deg" }] } : undefined}><TaskIcon kind="chevron" size={16} /></View></Pressable> : <WorkspaceRow icon="user" label={person.name} value={formatHours(person.milliseconds)} onPress={() => setOpen(!open)} expanded={open} />}{open ? <View style={{ paddingLeft: webCard ? 12 : 20 }}>
    {query.isPending ? <Text style={{ color: "#a3a3a3" }}>Loading shifts…</Text> : null}
    {query.isError ? <Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>Shift records are unavailable.</Text> : null}
    {query.data?.shifts.map(shift => webCard ? <ShiftRecord key={shift.id} shift={shift} worker={person.userId} mine={own} /> : <WorkspaceRow key={shift.id} icon="clock" label={new Date(shift.startedAt).toLocaleString()} value={formatHours(shift.milliseconds)} onPress={() => router.push(`/work-hub/calendar?day=${encodeURIComponent(shift.startedAt.slice(0, 10))}&worker=${person.userId}` as never)} />)}
    {query.data && !query.data.shifts.length ? <Text style={{ color: "#a3a3a3" }}>No recorded shifts in these dates.</Text> : null}
  </View> : null}</View>;
}

export default function HomeShiftHours({ expanded, onToggle, webCard = false }: { expanded: boolean; onToggle: () => void; webCard?: boolean }) {
  const { user, activeMembershipId } = useAuth();
  const c = useGateCopy();
  const owner = mobileOwner(user);
  const range = month();
  const membershipAdmin = !!user?.availableMemberships?.some(membership => membership.id === activeMembershipId && membership.role === "admin");
  const company = !!user && !user.managedSubcontractor && (user.role === "admin" || !["gatekeeper", "gate_supervisor"].includes(user.vendorRole ?? "") && (membershipAdmin || ["office", "both"].includes(user.vendorRole ?? "")));
  const key = [user?.id, activeMembershipId, owner?.type, owner?.id, range.start];
  const mine = useQuery({ queryKey: ["work-hub", "dashboard-shift-hours", ...key], queryFn: () => loadHours(user!.id, owner!, range), enabled: !!user && !!owner && !company, retry: false, refetchInterval: 15000 });
  const all = useQuery({ queryKey: ["work-hub", "dashboard-company-hours", ...key], queryFn: async () => {
    const result = await apiFetch<CompanyHours>(`/api/work-hub/workday/dashboard-hours?${new URLSearchParams(range)}`);
    if (result.viewerUserId !== user!.id || result.owner.type !== owner!.type || result.owner.id !== owner!.id || Date.parse(result.range.start) !== Date.parse(range.start) || Date.parse(result.range.end) !== Date.parse(range.end)) throw Error("Workday account or period changed");
    if (result.employees.reduce((sum, person) => sum + person.milliseconds, 0) !== result.totalMilliseconds) throw Error("Workday totals do not reconcile");
    return result;
  }, enabled: !!user && !!owner && company, retry: false, refetchInterval: 15000 });
  const value = company ? all.isError ? c("Unavailable", "No disponible") : all.data ? `${formatHours(all.data.mineMilliseconds)} ${c("mine", "mías")} | ${formatHours(all.data.totalMilliseconds)} ${c("total", "total")}` : c("Loading…", "Cargando…") : mine.isError ? c("Unavailable", "No disponible") : mine.data ? `${formatHours(mine.data.milliseconds)} ${c("this month", "este mes")}${mine.data.state === "on_break" ? " · on break" : ""}` : c("Loading…", "Cargando…");
  return <>{webCard ? <HomeTaskCardRow kind="hours" label={c("Hours", "Horas")} value={value} company={company} onPress={onToggle} expanded={expanded} /> : <WorkspaceRow icon="clock" label={c("Hours", "Horas")} value={value} onPress={onToggle} expanded={expanded} />}{expanded ? <View style={{ borderTopWidth: webCard ? 1 : 0, borderTopColor: "#3a3a3a", paddingLeft: 30, paddingTop: webCard ? 4 : 0, paddingBottom: 12 }}>
    <Text style={{ color: "#a3a3a3", fontSize: 12, paddingVertical: 8 }}>{new Date(range.start).toLocaleDateString()} – {new Date(Date.parse(range.end) - 86400000).toLocaleDateString()}</Text>
    {company ? <>
      {all.isPending ? <Text style={{ color: "#a3a3a3" }}>Loading employee hours…</Text> : null}
      {all.isError ? <Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>Employee hours are unavailable.</Text> : null}
      <ScrollView style={webCard ? { maxHeight: 360 } : undefined}>{all.data?.employees.map(person => <EmployeeHours key={person.userId} person={person} owner={all.data.owner} range={range} viewerId={user!.id} webCard={webCard} />)}</ScrollView>
      {all.data ? <Text style={{ color: "#a3a3a3", fontSize: 12, paddingTop: 8 }}>Recorded hours this month, including active shift time and excluding unpaid breaks. Total includes your hours.</Text> : null}
    </> : <>
      {mine.isPending ? <Text style={{ color: "#a3a3a3" }}>Loading shifts…</Text> : null}
      {mine.isError ? <Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>Shift records are unavailable.</Text> : null}
      <ScrollView style={webCard ? { maxHeight: 360 } : undefined}>{mine.data?.shifts.map(shift => webCard ? <ShiftRecord key={shift.id} shift={shift} /> : <WorkspaceRow key={shift.id} icon="clock" label={new Date(shift.startedAt).toLocaleString()} value={formatHours(shift.milliseconds)} onPress={() => router.push(`/work-hub/calendar?day=${encodeURIComponent(shift.startedAt.slice(0, 10))}` as never)} />)}</ScrollView>
      {mine.data && !mine.data.shifts.length ? <Text style={{ color: "#a3a3a3" }}>No recorded shifts in these dates.</Text> : null}
    </>}
  </View> : null}</>;
}
