import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { WorkforceRosterSchema, WorkforceOffersSchema, WorkforceIncomingOffersSchema, GateShiftStaffingCandidatesSchema, type WorkforceRoster } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import WorkHubConversation from "@/components/WorkHubConversation";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent, type AuthScope } from "@/lib/auth";
import { canShowWorkforce, workforceCandidateEligible, WorkforceAttemptSchema, fingerprintWorkforceAttempt, submitWorkforceAttempt, type WorkforceAttempt } from "@/lib/workforce-offer-client";

type Employee = WorkforceRoster["employees"][number];
type Command = { shiftId: string; expectedVersion: number; workerUserId: number } | { shiftId: string; offerId: string; expectedVersion: number; decision: "accepted" | "declined" };
type Copy = (en: string, es: string) => string;
const GapSchema = z.object({ id: z.string(), shiftId: z.uuid(), shiftTitle: z.string().optional(), startsAt: z.iso.datetime(), assignedCount: z.number().int().nonnegative(), requiredCount: z.number().int().nonnegative(), state: z.string() });
type Gap = z.infer<typeof GapSchema>;

export default function NativeWorkforce() {
  const { user, activeMembership, activeMembershipId } = useAuth();
  const membership = activeMembership ?? user?.availableMemberships?.find(item => item.id === (activeMembershipId ?? user?.activeMembershipId));
  const scope = captureAuthScope();
  const identity = JSON.stringify([user?.id, activeMembershipId ?? user?.activeMembershipId, user?.role, user?.vendorRole, user?.vendorId, user?.partnerId, membership?.orgType, membership?.orgId, membership?.role]);
  return user?.vendorId && membership?.orgType !== "partner" && user.role !== "partner" ? <WorkforceGate key={`${identity}:${scope.generation}`} identity={identity} actor={user.id} vendorId={user.vendorId} membershipId={activeMembershipId ?? user.activeMembershipId ?? 0} scope={scope} allowed={categories => canShowWorkforce(user, categories, membership)} /> : null;
}
function WorkforceGate({ allowed, ...props }: { identity: string; actor: number; vendorId: number; membershipId: number; scope: AuthScope; allowed: (categories: readonly string[]) => boolean }) {
  const operations = useQuery({ queryKey: ["native-workforce-operations", props.identity, props.scope.generation], queryFn: async () => {
    const result = await apiFetch<{ vendorId: number; categories: string[] }>("/api/company-operations", {}, props.scope);
    if (result.vendorId !== props.vendorId || !Array.isArray(result.categories)) throw Error("workforce.context_changed");
    return result;
  }, retry: false });
  return allowed(operations.isSuccess ? operations.data.categories : []) ? <Workforce {...props} /> : null;
}
function Workforce({ identity, actor, vendorId, membershipId, scope }: { identity: string; actor: number; vendorId: number; membershipId: number; scope: AuthScope }) {
  const colors = useColors(), qc = useQueryClient(), { i18n } = useTranslation();
  const c: Copy = (en, es) => i18n.language.startsWith("es") ? es : en;
  const [expanded, setExpanded] = useState<string | null>(null), [shiftFilter, setShiftFilter] = useState("active"), [callFilter, setCallFilter] = useState("active");
  const [profile, setProfile] = useState<Employee | null>(null), [channel, setChannel] = useState<Record<string, any> | null>(null);
  const [attempt, setAttempt] = useState<WorkforceAttempt | null>(null), [ready, setReady] = useState(false), [invalidJournal, setInvalidJournal] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const alive = useRef(true), lock = useRef(false), journalKey = `vndrly.workforce-offer:${identity}`;
  const headers = { "X-VNDRLY-Actor-User": String(actor), "X-VNDRLY-Vendor": String(vendorId), "X-VNDRLY-Membership": String(membershipId) };
  const current = () => alive.current && isAuthScopeCurrent(scope);
  const assertCurrent = () => { if (!current()) throw Error("workforce.context_changed"); };
  const http = async (path: string, method: "GET" | "POST" = "GET", body?: unknown) => {
    assertCurrent();
    const value = await apiFetch(`/api/work-hub${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }, scope);
    assertCurrent(); return value;
  };
  const roster = useQuery({ queryKey: ["native-workforce", identity, scope.generation, "roster"], queryFn: async () => { const result = WorkforceRosterSchema.parse(await http("/workforce/roster")); if (result.owner.id !== vendorId) throw Error("workforce.context_changed"); return result; }, retry: false, refetchInterval: 15000 });
  const incoming = useQuery({ queryKey: ["native-workforce", identity, scope.generation, "incoming"], queryFn: async () => WorkforceIncomingOffersSchema.parse(await http("/workforce/offers")), retry: false, refetchInterval: 15000 });
  const gaps = useQuery({ queryKey: ["native-workforce", identity, scope.generation, "gaps"], queryFn: async () => {
    const result = z.object({ coverage: z.array(GapSchema) }).parse(await apiFetch("/api/implementation-a/workforce/coverage", { headers }, scope));
    assertCurrent(); return result.coverage.filter(gap => gap.state !== "covered" && gap.assignedCount < gap.requiredCount);
  }, retry: false, refetchInterval: 30000 });
  useEffect(() => {
    alive.current = true;
    void AsyncStorage.getItem(journalKey).then(raw => {
      if (!current()) return;
      if (raw) { const saved = WorkforceAttemptSchema.parse(JSON.parse(raw)); if (saved.actorUserId !== actor || saved.vendorId !== vendorId) throw Error("workforce.journal_invalid"); setAttempt(saved); }
      setReady(true);
    }).catch(() => { if (current()) { setInvalidJournal(true); setReady(true); } });
    return () => { alive.current = false; };
  }, [journalKey]);
  async function refresh() { await qc.invalidateQueries({ queryKey: ["native-workforce", identity] }); }
  async function execute(command?: Command) {
    if (!current() || lock.current || !ready || invalidJournal || !command && !attempt || command && attempt) return;
    lock.current = true; setBusy(true); setNotice("");
    try {
      let saved = attempt;
      if (!saved && command) {
        const { shiftId } = command;
        const input = "decision" in command ? { operationId: Crypto.randomUUID(), expectedVersion: command.expectedVersion, decision: command.decision } : { operationId: Crypto.randomUUID(), expectedVersion: command.expectedVersion, workerUserId: command.workerUserId };
        const base = { actorUserId: actor, vendorId, shiftId, ...("offerId" in command ? { offerId: command.offerId } : {}), input };
        saved = { ...base, commandFingerprint: await fingerprintWorkforceAttempt(base) };
        assertCurrent();
        // Persist before sending; a failed response must never create a replacement offer.
        await AsyncStorage.setItem(journalKey, JSON.stringify(saved)); assertCurrent(); setAttempt(saved);
      }
      if (!saved) return;
      const receipt = await submitWorkforceAttempt(saved, http);
      assertCurrent(); await AsyncStorage.removeItem(journalKey); assertCurrent(); setAttempt(null);
      setNotice(receipt.status === "pending" ? c("Offer saved. Awaiting the employee’s response.", "Oferta guardada. En espera de la respuesta del empleado.") : receipt.status === "accepted" ? c("Offer accepted. Assignment saved.", "Oferta aceptada. Asignación guardada.") : c("Offer declined.", "Oferta rechazada."));
      await refresh();
    } catch (error) {
      if (!current()) return;
      if ((error as { rejected?: boolean })?.rejected) { await AsyncStorage.removeItem(journalKey); if (!current()) return; setAttempt(null); setNotice(c("This request was not applied. Review current shift and employee eligibility.", "No se aplicó esta solicitud. Revise el turno y la elegibilidad actuales.")); await refresh(); }
      else setNotice(c("The result could not be verified. Check the saved request before another offer.", "No se pudo verificar el resultado. Consulte la solicitud guardada antes de otra oferta."));
    } finally { lock.current = false; if (current()) setBusy(false); }
  }
  async function messageEmployee(person: Employee) {
    if (!current() || lock.current || !person.canMessage) return;
    lock.current = true; setBusy(true); setNotice("");
    try { const result = await http("/chats", "POST", { recipientUserId: person.userId }) as { channel?: Record<string, any> }; if (!result.channel?.id) throw Error("chat_unavailable"); setProfile(null); setChannel(result.channel); }
    catch { if (current()) setNotice(c("The conversation could not be opened. Try again.", "No se pudo abrir la conversación. Inténtelo de nuevo.")); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  const staff = roster.isSuccess ? roster.data.employees : undefined;
  const onShift = staff?.filter(person => person.onShift === true), offShift = staff?.filter(person => person.onShift === false), unknownShift = staff?.filter(person => person.onShift === null);
  const onCall = staff?.filter(person => person.onCall === "active"), unavailable = staff?.filter(person => person.onCall === "inactive"), unknownCall = staff?.filter(person => person.onCall === "unknown");
  const missing = c("Unavailable", "No disponible"), unknown = c("Unknown", "Sin verificar");
  const text = { color: colors.text, fontSize: 14 }, muted = { color: colors.mutedForeground, fontSize: 12 };
  const blocked = busy || !ready || !!attempt || invalidJournal;
  const pending = incoming.isSuccess ? incoming.data.offers.filter(offer => offer.status === "pending") : [];
  const row = (key: string, label: string, value: string) => <Pressable accessibilityRole="button" accessibilityLabel={`${label} · ${value}`} accessibilityState={{ expanded: expanded === key }} onPress={() => setExpanded(expanded === key ? null : key)} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, borderTopWidth: 1, borderColor: colors.border, paddingVertical: 14 }}><Text style={{ ...text, fontWeight: "600" }}>{label}</Text><Text style={muted}>{value} {expanded === key ? "⌃" : "⌄"}</Text></Pressable>;
  const people = (list?: Employee[]) => !list ? <Text style={muted}>{missing}</Text> : list.length ? list.map(person => <Pressable key={person.userId} accessibilityRole="button" accessibilityLabel={person.name} onPress={() => setProfile(person)} style={{ paddingVertical: 12, gap: 4 }}><Text style={{ ...text, fontWeight: "600" }}>{person.name}</Text>{person.assignment ? <Text style={muted}>{person.assignment}</Text> : null}</Pressable>) : <Text style={muted}>{c("No employees in this list.", "No hay empleados en esta lista.")}</Text>;
  const filter = (value: string, label: string, count: number | undefined, selected: string, select: (value: string) => void) => <TogglePillButton accessibilityLabel={`${label} · ${count ?? "—"}`} accessibilityState={{ selected: value === selected }} onPress={() => select(value)}>{label} · {count ?? "—"}</TogglePillButton>;
  return <View style={{ backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 16, borderWidth: 2, padding: 16, gap: 8 }}>
    <Text accessibilityRole="header" style={{ ...text, fontSize: 19, fontWeight: "700" }}>{c("Workforce", "Personal")}</Text>
    <Text style={muted}>{c("Coverage, shifts, and availability", "Cobertura, turnos y disponibilidad")}</Text>
    {row("coverage", c("Coverage Gaps", "Brechas de cobertura"), gaps.isSuccess ? `${gaps.data.length} ${c("open", "abiertas")}` : missing)}
    {expanded === "coverage" && (gaps.isSuccess ? gaps.data.length ? gaps.data.map(gap => <CoverageGap key={gap.id} gap={gap} identity={identity} generation={scope.generation} canOffer={roster.isSuccess && roster.data.canManageOffers} http={http} staff={staff ?? []} openEmployee={setProfile} offer={command => void execute(command)} disabled={blocked} c={c} />) : <Text style={muted}>{c("No recorded coverage gaps.", "No hay brechas de cobertura registradas.")}</Text> : <Text style={muted}>{missing}</Text>)}
    {row("shift", c("On Shift Now", "En turno ahora"), onShift ? `${onShift.length} ${c("on shift", "en turno")}` : missing)}
    {expanded === "shift" && <View style={{ gap: 8 }}><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{filter("active", c("On Shift", "En turno"), onShift?.length, shiftFilter, setShiftFilter)}{filter("inactive", c("Off Shift", "Fuera de turno"), offShift?.length, shiftFilter, setShiftFilter)}{!!unknownShift?.length && filter("unknown", unknown, unknownShift.length, shiftFilter, setShiftFilter)}</View>{people(shiftFilter === "active" ? onShift : shiftFilter === "inactive" ? offShift : unknownShift)}</View>}
    {row("call", c("On Call", "Guardia"), onCall ? `${onCall.length} ${c("available", "disponibles")} · ${unavailable!.length} ${c("unavailable", "no disponibles")}` : missing)}
    {expanded === "call" && <View style={{ gap: 8 }}><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{filter("active", c("Available", "Disponibles"), onCall?.length, callFilter, setCallFilter)}{filter("inactive", c("Unavailable", "No disponibles"), unavailable?.length, callFilter, setCallFilter)}{!!unknownCall?.length && filter("unknown", unknown, unknownCall.length, callFilter, setCallFilter)}</View>{people(callFilter === "active" ? onCall : callFilter === "inactive" ? unavailable : unknownCall)}</View>}
    {pending.length > 0 && <>{row("offers", c("My Shift Offers", "Mis ofertas de turno"), String(pending.length))}{expanded === "offers" && pending.map(offer => <View key={offer.id} style={{ gap: 8, paddingVertical: 10 }}><Text style={text}>{offer.shiftTitle}</Text><Text style={muted}>{new Date(offer.startsAt).toLocaleString()} – {new Date(offer.endsAt).toLocaleString()}</Text><TogglePillButton disabled={blocked} onPress={() => void execute({ shiftId: offer.shiftId, offerId: offer.id, expectedVersion: offer.shiftVersion, decision: "accepted" })}>{c("Accept", "Aceptar")}</TogglePillButton><TogglePillButton disabled={blocked} onPress={() => void execute({ shiftId: offer.shiftId, offerId: offer.id, expectedVersion: offer.shiftVersion, decision: "declined" })}>{c("Decline", "Rechazar")}</TogglePillButton></View>)}</>}
    {roster.isSuccess && <Text style={muted}>{roster.data.scope === "self" ? c("Your record", "Su registro") : roster.data.scope === "managed_sites" ? c("Employees at your managed sites", "Empleados de sus sitios administrados") : c("Company gatekeepers", "Personal de acceso de la empresa")}</Text>}
    {incoming.isError && <Text style={muted}>{c("Shift offers are unavailable.", "Las ofertas de turno no están disponibles.")}</Text>}
    {invalidJournal && <Text accessibilityRole="alert" style={text}>{c("A saved request could not be verified. Do not create a replacement request.", "No se pudo verificar una solicitud guardada. No cree otra solicitud.")}</Text>}
    {attempt && <TogglePillButton disabled={busy} onPress={() => void execute()}>{c("Check saved offer request", "Consultar solicitud de oferta guardada")}</TogglePillButton>}
    {busy && <ActivityIndicator accessibilityLabel={c("Checking workforce request", "Consultando solicitud de personal")} />}
    {!!notice && <Text accessibilityLiveRegion="polite" style={text}>{notice}</Text>}
    <Modal visible={!!profile || !!channel} animationType="slide" onRequestClose={() => { setProfile(null); setChannel(null); }}><ScrollView contentContainerStyle={{ padding: 24, gap: 16, backgroundColor: colors.card, flexGrow: 1 }}>
      {profile && <><Text accessibilityRole="header" style={{ ...text, fontSize: 21, fontWeight: "700" }}>{profile.name}</Text><Text style={text}>{c("Shift", "Turno")}: {profile.onShift === null ? unknown : profile.onShift ? c("On Shift", "En turno") : c("Off Shift", "Fuera de turno")}</Text><Text style={text}>{c("On Call", "Guardia")}: {profile.onCall === "unknown" ? unknown : profile.onCall === "active" ? c("Available", "Disponible") : c("Unavailable", "No disponible")}</Text>{profile.assignment && <Text style={text}>{profile.assignment}</Text>}{profile.profileHref === `/field-employees/${profile.vendorPeopleId}` && <TogglePillButton onPress={() => { const path = profile.profileHref!.replace("/field-employees/", "/employee/"); setProfile(null); router.push(path as never); }}>{c("Open employee profile", "Abrir perfil del empleado")}</TogglePillButton>}{profile.canMessage && <TogglePillButton disabled={busy} onPress={() => void messageEmployee(profile)}>{c("Message employee", "Enviar mensaje al empleado")}</TogglePillButton>}</>}
      {channel && <WorkHubConversation channel={channel} onClose={() => setChannel(null)} />}
      <TogglePillButton onPress={() => { setProfile(null); setChannel(null); }}>{c("Close", "Cerrar")}</TogglePillButton>
    </ScrollView></Modal>
  </View>;
}
function CoverageGap({ gap, identity, generation, canOffer, http, staff, openEmployee, offer, disabled, c }: { gap: Gap; identity: string; generation: number; canOffer: boolean; http: (path: string) => Promise<unknown>; staff: Employee[]; openEmployee: (employee: Employee) => void; offer: (command: Command) => void; disabled: boolean; c: Copy }) {
  const colors = useColors(), [open, setOpen] = useState(false);
  const candidates = useQuery({ queryKey: ["native-workforce", identity, generation, "candidates", gap.shiftId], queryFn: async () => GateShiftStaffingCandidatesSchema.parse(await http(`/shifts/${gap.shiftId}/staffing-candidates`)), enabled: open && canOffer, retry: false });
  const offers = useQuery({ queryKey: ["native-workforce", identity, generation, "offers", gap.shiftId], queryFn: async () => WorkforceOffersSchema.parse(await http(`/shifts/${gap.shiftId}/offers`)), enabled: open && canOffer, retry: false, refetchInterval: 15000 });
  const text = { color: colors.text, fontSize: 14 }, muted = { color: colors.mutedForeground, fontSize: 12 };
  const status = (value: string) => value === "pending" ? c("Offered · Pending", "Ofrecido · Pendiente") : value === "accepted" ? c("Accepted", "Aceptado") : c("Declined", "Rechazado");
  return <View style={{ gap: 10, borderTopWidth: 1, borderColor: colors.border, paddingVertical: 10 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}><Text style={{ ...text, fontWeight: "700" }}>{gap.shiftTitle ?? c("Gate shift", "Turno de acceso")}</Text><Text style={muted}>{gap.assignedCount} / {gap.requiredCount} {c("assigned", "asignados")} · {new Date(gap.startsAt).toLocaleString()}</Text></Pressable>
    {open && (canOffer ? <>
      {(candidates.isPending || offers.isPending) && <Text style={muted}>{c("Checking employees and saved offers…", "Consultando empleados y ofertas guardadas…")}</Text>}
      {(candidates.isError || offers.isError) && <Text style={muted}>{c("Staffing records are unavailable. Refresh before offering this shift.", "Los registros no están disponibles. Actualice antes de ofrecer este turno.")}</Text>}
      {candidates.isSuccess && candidates.data.candidates.map(person => {
        const existing = offers.isSuccess ? offers.data.offers.filter(row => row.workerUserId === person.userId).at(-1) : undefined;
        const employee = staff.find(row => row.userId === person.userId) ?? { userId: person.userId, vendorPeopleId: person.vendorPeopleId, name: person.name, onCall: "unknown" as const, onShift: null, shiftStartedAt: null, assignment: null, profileHref: null, canMessage: false };
        const eligible = workforceCandidateEligible(candidates.data, person);
        return <View key={person.userId} style={{ gap: 8, paddingVertical: 10 }}><Pressable accessibilityRole="button" onPress={() => openEmployee(employee)}><Text style={{ ...text, fontWeight: "600" }}>{person.name}</Text><Text style={muted}>{eligible ? c("Recorded available for this shift", "Disponibilidad registrada para este turno") : c("Availability or eligibility needs review", "Revisar disponibilidad o elegibilidad")}</Text></Pressable>{existing ? <Text style={text}>{status(existing.status)}</Text> : <TogglePillButton disabled={disabled || !offers.isSuccess || !eligible || offers.data.shiftVersion !== candidates.data.shiftVersion || Date.parse(gap.startsAt) <= Date.now()} onPress={() => offer({ shiftId: gap.shiftId, expectedVersion: candidates.data.shiftVersion, workerUserId: person.userId })}>{c("Offer Shift", "Ofrecer turno")}</TogglePillButton>}</View>;
      })}
      {candidates.isSuccess && !candidates.data.candidates.length && <Text style={muted}>{c("No eligible company gatekeepers were returned.", "No se recibieron empleados de acceso elegibles.")}</Text>}
      {candidates.data?.truncated && <Text style={muted}>{c("Showing the first 25 records. Open the schedule to review more.", "Se muestran los primeros 25 registros. Abra el calendario para revisar más.")}</Text>}
      {offers.isSuccess && offers.data.offers.filter(row => !candidates.data?.candidates.some(person => person.userId === row.workerUserId)).map(row => <Text key={row.id} style={text}>{row.workerName} · {status(row.status)}</Text>)}
    </> : <Text style={muted}>{c("Review coverage with your supervisor.", "Revise la cobertura con su supervisor.")}</Text>)}
  </View>;
}
