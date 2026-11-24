import React, { useState } from "react";
import { Image, Text, TextInput, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { expirationShield } from "@workspace/api-zod/profile-status";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import DismissibleModal from "@/components/DismissibleModal";
import StatusShield from "@/components/StatusShield";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { mobileCommandEnvelope, mobileOwner } from "@/lib/work-hub-mobile";

type Step = { id: string; title: string; ordinal: number; complete: boolean; progressState: string; type: string; href: string; expiresAt?: string };
type Course = { id: string; title: string; complete: boolean; augmented?: boolean; percent: number; completedCount: number; totalCount: number; steps: Step[] };
type Progress = { displayGroups: { title: string; items: Course[] }[]; overallPercent: number; canViewTeamTraining?: boolean };
type SafetyScore = { score: number; maximum: number; bonus: number };
type TeamPerson = { userId: number; name: string; percentLabel: string; status: { color: string; label: string }; courses: { id: string; title: string; assignedAt: string; complete: boolean }[] };

type CertificateIconKind = "graduation" | "check" | "layers" | "users" | "chevron" | "mail";
function CertificateIcon({ kind, size = 19, color }: { kind: CertificateIconKind; size?: number; color: string }) {
  const shapes = {
    graduation: <><Path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" /><Path d="M22 10v6" /><Path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" /></>,
    check: <><Circle cx="12" cy="12" r="10" /><Path d="m9 12 2 2 4-4" /></>,
    layers: <><Path d="m12.83 2.18 7.99 4.57a2 2 0 0 1 0 3.5l-7.99 4.57a2 2 0 0 1-1.66 0L3.18 10.25a2 2 0 0 1 0-3.5l7.99-4.57a2 2 0 0 1 1.66 0Z" /><Path d="m2.67 12.1 8.5 4.72a2 2 0 0 0 1.66 0l8.5-4.72M2.67 16.1l8.5 4.72a2 2 0 0 0 1.66 0l8.5-4.72" /></>,
    users: <><Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><Circle cx="9" cy="7" r="4" /><Path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    chevron: <Path d="m9 18 6-6-6-6" />,
    mail: <><Rect x="2" y="4" width="20" height="16" rx="2" /><Path d="m22 7-8.97 5.7a2 2 0 0 1-2.06 0L2 7" /></>,
  };
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{shapes[kind]}</Svg>;
}

function certificateDisplayTitle(title: string): string {
  const parts = title.split(/\s+—\s+|\s+\|\s+/).map(part => part.trim());
  if (parts.length < 2) return title;
  const [category, ...name] = parts.length > 2 && title.includes(" — ") ? parts.slice(1) : parts;
  return `${category} | ${name.join(" | ").replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase())}`;
}

function CertificateRow({ label, value, kind, complete, augmented, color, expanded, onPress }: { label: string; value?: string; kind: "graduation" | "users"; complete?: boolean; augmented?: boolean; color?: string; expanded: boolean; onPress: () => void }) {
  const { primary } = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded }} onPress={onPress} style={({ pressed }) => ({ height: 44, borderTopWidth: 1, borderTopColor: "#3a3a3a", flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10, opacity: pressed ? 0.72 : 1 })}>
    <CertificateIcon kind={kind} color={primary} />
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 }}>
      {complete ? <CertificateIcon kind="check" size={17} color="#ececec" /> : null}
      <Text numberOfLines={1} style={{ color: color ?? "#ececec", fontSize: 15, fontWeight: "600", flexShrink: 1 }}>{label}</Text>
      {augmented ? <CertificateIcon kind="layers" size={16} color={primary} /> : null}
    </View>
    {value ? <Text style={{ color: color ?? "#b3b3b3", fontSize: 13 }}>{value}</Text> : null}
    <View style={expanded ? { transform: [{ rotate: "90deg" }] } : undefined}><CertificateIcon kind="chevron" size={18} color="#a3a3a3" /></View>
  </Pressable>;
}

/** Native version of CertificationProgress embedded in the web home. */
export default function HomeCertificates() {
  const { user, activeMembershipId } = useAuth();
  const { primary } = useColors();
  const canMessageTeam = user?.role === "admin" || user?.availableMemberships?.some(membership => membership.id === activeMembershipId && membership.role === "admin");
  const cache = useQueryClient();
  const owner = mobileOwner(user);
  const identity = [user?.id, activeMembershipId, user?.vendorId, user?.partnerId];
  const progress = useQuery({ queryKey: ["training-progress", ...identity], queryFn: () => apiFetch<Progress>("/api/work-hub/repository/progress"), enabled: !!user, retry: false, refetchInterval: 30000 });
  const safety = useQuery({ queryKey: ["training-progress", "safety-summary", ...identity], queryFn: () => apiFetch<SafetyScore>("/api/work-hub/repository/safety-summary"), enabled: !!user, retry: false, refetchInterval: 30000 });
  const team = useQuery({ queryKey: ["training-progress", "team", ...identity], queryFn: () => apiFetch<{ people: TeamPerson[]; percentLabel: string }>("/api/work-hub/repository/team-progress"), enabled: !!user && !!owner && !!progress.data?.canViewTeamTraining, retry: false, refetchInterval: 30000 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [openPerson, setOpenPerson] = useState<number | null>(null);
  const [messagePerson, setMessagePerson] = useState<TeamPerson | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [sentChannel, setSentChannel] = useState("");
  const [messageAttempt, setMessageAttempt] = useState<{ body: string; operationId: string; channelId?: string } | null>(null);
  const action = useMutation({
    mutationFn: async ({ kind, payload }: { kind: "renew" | "ack"; payload: unknown }) => {
      if (!owner) throw new Error("Choose a company");
      return apiFetch(`/api/work-hub/repository/${kind}`, { method: "POST", body: JSON.stringify({ ...mobileCommandEnvelope(owner, payload, undefined, { kind: "organization", id: owner.id }, randomUUID()), expectedVersion: null }) });
    },
    onSuccess: async () => { await cache.invalidateQueries({ queryKey: ["training-progress"] }); },
  });
  const repoButton = (label: string, onPress: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={action.isPending} onPress={onPress} style={{ minHeight: 34, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: primary, borderRadius: 7, marginVertical: 4 }}><Text style={{ color: "#ececec", fontSize: 12, fontWeight: "600" }}>{label}</Text></Pressable>;
  const sendTrainingMessage = async () => {
    if (!owner || !messagePerson || messageBusy || !(messageAttempt || messageBody.trim())) return;
    const saved = messageAttempt ?? { body: messageBody.trim(), operationId: randomUUID() };
    setMessageAttempt(saved); setMessageBusy(true); setMessageError("");
    try {
      let channelId = saved.channelId;
      if (!channelId) {
        const opened = await apiFetch<{ channel?: { id: string } }>("/api/work-hub/chats", { method: "POST", body: JSON.stringify({ recipientUserId: messagePerson.userId }) });
        if (!opened.channel?.id) throw Error("A direct chat could not be opened in this company.");
        channelId = opened.channel.id;
        saved.channelId = channelId;
        setMessageAttempt({ ...saved });
      }
      const result = await apiFetch<{ operationId: string }>(`/api/work-hub/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify(mobileCommandEnvelope(owner, { body: saved.body, mentionUserIds: [] }, undefined, { kind: "organization", id: owner.id }, saved.operationId)) });
      if (result.operationId !== saved.operationId) throw Error("Message delivery was not confirmed. Retry to verify the original send.");
      setSentChannel(channelId); setMessageAttempt(null); setMessageBody("");
      await cache.invalidateQueries({ queryKey: ["work-hub"] });
    } catch (error) { setMessageError(error instanceof Error ? error.message : "Message could not be sent."); }
    finally { setMessageBusy(false); }
  };
  return <><View accessibilityLabel="VNDRLY/U Certificates" style={{ minWidth: 0, backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingTop: 16 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingBottom: 6 }}>
      <CertificateIcon kind="graduation" size={20} color={primary} />
      <View style={{ flex: 1, minWidth: 0 }}><Image accessibilityLabel="VNDRLY/U Certificates" source={require("@/assets/images/vndrly-u-wordmark.png")} resizeMode="contain" style={{ width: 205, maxWidth: "100%", height: 28 }} /><Text style={{ color: "#a3a3a3", fontSize: 12, marginTop: 2 }}>Your certificates and assigned courses</Text></View>
      {progress.data ? <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 8 }}><Text accessibilityLabel="Overall training completion" style={{ color: "#ececec", fontSize: 14, fontWeight: "600" }}>{progress.data.overallPercent}%</Text>{safety.data ? <><Text accessibilityLabel="Company safety score" style={{ color: "#ececec", fontSize: 14, fontWeight: "600" }}>{safety.data.score}/{safety.data.maximum}</Text><Text accessibilityLabel="Safety bonus points" style={{ color: "#ececec", fontSize: 14, fontWeight: "600" }}>+{safety.data.bonus}</Text></> : null}</View> : null}
    </View>
    {progress.isError ? <Text accessibilityRole="alert" style={{ color: "#a3a3a3", paddingVertical: 10 }}>Training progress is unavailable. Refresh to try again.</Text> : null}
    {progress.isPending ? <Text style={{ color: "#a3a3a3", paddingVertical: 10 }}>Consulting your Advisor…</Text> : null}
    {progress.data?.displayGroups.map(group => <View key={group.title}>
      {group.title !== "Standalone Courses" ? <Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 15, fontWeight: "700", marginTop: 12, marginBottom: 6 }}>{group.title}</Text> : null}
      {group.items.map(course => <View key={course.id}>
        <CertificateRow kind="graduation" label={certificateDisplayTitle(course.title)} complete={course.complete} augmented={course.augmented} value={`${course.percent}%`} onPress={() => setExpanded(expanded === course.id ? null : course.id)} expanded={expanded === course.id} />
        {expanded === course.id ? <View style={{ paddingLeft: 30, paddingBottom: 12 }}>
          <Text style={{ color: "#b3b3b3", fontSize: 12, paddingVertical: 8 }}>{course.completedCount} / {course.totalCount} complete</Text>
          {course.augmented && !course.complete ? repoButton("Prepare current course assignments", () => action.mutate({ kind: "renew", payload: { augmentationId: course.id } })) : null}
          {course.steps.map(step => <View key={step.id} style={{ borderTopWidth: 1, borderTopColor: primary, paddingVertical: 12, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}><View accessibilityLabel={step.progressState === "next" ? "Next step" : undefined} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: primary, justifyContent: "center", alignItems: "center" }}><Text style={{ color: "#ececec", fontWeight: "700" }}>{step.complete ? "✓" : step.ordinal}</Text></View><Text style={{ color: "#ececec", fontSize: 14 }}>{step.progressState === "completed" ? "Completed" : step.progressState === "next" ? "Next step" : "Upcoming"}</Text></View>{repoButton(step.type === "course" ? certificateDisplayTitle(step.title) : step.title, () => router.push(step.href as never))}{step.expiresAt ? <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Text style={{ color: "#ececec", fontSize: 14 }}>Valid until {new Date(step.expiresAt).toLocaleDateString()}</Text><StatusShield status={expirationShield(step.expiresAt)} label="Certification expiration status" /></View> : null}{course.augmented && step.type === "material" && !step.complete ? repoButton("Confirm completed", () => action.mutate({ kind: "ack", payload: { augmentationId: course.id, documentId: step.id, confirmed: true } })) : null}</View>)}
        </View> : null}
      </View>)}
    </View>)}
    {progress.data?.canViewTeamTraining ? <>
      <CertificateRow kind="users" label="Team Training" value={team.data?.percentLabel ?? "…"} onPress={() => setTeamOpen(value => !value)} expanded={teamOpen} />
      {teamOpen ? <View style={{ paddingLeft: 30, paddingBottom: 12 }}>
        <Text style={{ color: "#a3a3a3", fontSize: 12, paddingVertical: 8 }}>Unfinished assignments: green through 7 days · amber over 7–14 days · red over 14 days.</Text>
        {team.isPending ? <Text style={{ color: "#a3a3a3" }}>Consulting your Advisor…</Text> : null}
        {team.isError ? <Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>Team training is unavailable. Try again shortly.</Text> : null}
        {team.data?.people.map(person => <View key={person.userId}>
          <View style={{ flexDirection: "row", alignItems: "center" }}><View style={{ flex: 1 }}><Pressable accessibilityRole="button" accessibilityLabel={person.name} accessibilityState={{ expanded: openPerson === person.userId }} onPress={() => setOpenPerson(openPerson === person.userId ? null : person.userId)} style={{ height: 44, borderTopWidth: 1, borderTopColor: "#3a3a3a", flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: person.status.color }} /><Text style={{ color: person.status.color, fontSize: 15, fontWeight: "600", flex: 1 }}>{person.name}</Text><Text style={{ color: person.status.color, fontSize: 13 }}>{person.percentLabel}</Text><View style={openPerson === person.userId ? { transform: [{ rotate: "90deg" }] } : undefined}><CertificateIcon kind="chevron" size={18} color="#a3a3a3" /></View></Pressable></View>{canMessageTeam && person.userId !== user?.id ? <Pressable accessibilityRole="button" accessibilityLabel={`Message ${person.name} about training`} onPress={() => { setMessagePerson(person); setSentChannel(""); setMessageBody(""); setMessageAttempt(null); setMessageError(""); }} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 8 }}><CertificateIcon kind="mail" size={18} color={primary} /></Pressable> : null}</View>
          {openPerson === person.userId ? <View style={{ paddingLeft: 20, paddingBottom: 8 }}>
            <Text style={{ color: person.status.color, fontSize: 12, paddingVertical: 6 }}>{person.status.label}</Text>
            {person.courses.map(course => <View key={course.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 7 }}><Text style={{ color: "#ececec", flex: 1, fontSize: 13 }}>{course.title}</Text><Text style={{ color: "#a3a3a3", fontSize: 12 }}>{course.complete ? "Completed" : `Assigned ${new Date(course.assignedAt).toLocaleDateString()}`}</Text></View>)}
          </View> : null}
        </View>)}
        {team.data && !team.data.people.length ? <Text style={{ color: "#a3a3a3", paddingVertical: 8 }}>No current company members.</Text> : null}
      </View> : null}
    </> : null}
    {action.isError ? <Text accessibilityRole="alert" style={{ color: "#fca5a5", paddingVertical: 8 }}>{action.error instanceof Error ? action.error.message : "Could not update training progress."}</Text> : null}
  </View><DismissibleModal dismissLabel="close" visible={!!messagePerson} transparent onRequestClose={() => { if (!messageBusy) setMessagePerson(null); }}><View style={{ flex: 1, justifyContent: "center", backgroundColor: "#0009", padding: 20 }}><View style={{ backgroundColor: "#242426", borderWidth: 2, borderColor: primary, borderRadius: 16, padding: 18, gap: 10 }}><Text accessibilityRole="header" style={{ color: "#ececec", fontSize: 18, fontWeight: "700" }}>Message {messagePerson?.name}</Text><Text style={{ color: "#a3a3a3", fontSize: 12 }}>Send a private training follow-up to your direct chat in Communications.</Text>{sentChannel ? <><Text style={{ color: "#ececec" }}>Message sent.</Text>{repoButton("Open chat", () => { setMessagePerson(null); router.push(`/work-hub/chat?view=chat&channel=${encodeURIComponent(sentChannel)}` as never); })}</> : <><TextInput accessibilityLabel="Message" multiline maxLength={4000} editable={!messageBusy && !messageAttempt} placeholder={`Hi ${messagePerson?.name ?? ""}, how is your training progressing?`} placeholderTextColor="#a3a3a3" value={messageAttempt?.body ?? messageBody} onChangeText={setMessageBody} style={{ minHeight: 110, borderWidth: 1, borderColor: primary, borderRadius: 8, padding: 10, color: "#ececec", textAlignVertical: "top" }} />{messageError ? <Text accessibilityRole="alert" style={{ color: "#fca5a5" }}>{messageError}</Text> : null}{repoButton(messageBusy ? "Sending…" : messageError ? "Retry Submit" : "Submit", () => void sendTrainingMessage())}</>}{repoButton("Close", () => { if (!messageBusy) setMessagePerson(null); })}</View></View></DismissibleModal></>;
}
