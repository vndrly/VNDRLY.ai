import React, { useEffect, useState } from "react";
import { Text, View, ScrollView } from "react-native";
import * as Crypto from "expo-crypto";
import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { mobileOwner, mobileCommandEnvelope } from "@/lib/work-hub-mobile";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";

type Person = { id: number; displayName: string };
export default function NewConversation({ kind, onCreated, onCancel }: { kind: "chat" | "channel"; onCreated: (id: string) => void; onCancel: () => void }) {
  const colors = useColors(), { user } = useAuth();
  const [name, setName] = useState(""), [search, setSearch] = useState("");
  const [people, setPeople] = useState<Person[]>([]), [selected, setSelected] = useState<Person[]>([]);
  const [visibility, setVisibility] = useState<"organization" | "private">("organization");
  const [operationId, setOperationId] = useState(Crypto.randomUUID);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const scope = captureAuthScope();
    void apiFetch<Person[]>(`/api/work-hub/people?search=${encodeURIComponent(search)}`, undefined, scope)
      .then(rows => { if (active && isAuthScopeCurrent(scope)) setPeople(rows.filter(person => person.id !== user?.id)); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Could not load people"); });
    return () => { active = false; };
  }, [search, user?.id, user?.activeMembershipId]);
  const changed = () => { setOperationId(Crypto.randomUUID()); setError(""); };
  const create = async () => {
    if (busy) return;
    setBusy(true); setError("");
    const scope = captureAuthScope();
    try {
      const owner = mobileOwner(user);
      if (!owner) throw new Error("Select a company first.");
      const participantUserIds = selected.map(person => person.id);
      const result = await apiFetch<{ channel?: { id: string }; resource?: { id: string } }>(
        kind === "channel" ? "/api/work-hub/channels" : "/api/work-hub/channels/start-chat",
        { method: "POST", body: JSON.stringify(kind === "channel"
          ? mobileCommandEnvelope(owner, { name: name.trim(), visibility, participantUserIds }, undefined, { kind: "organization", id: owner.id }, operationId)
          : { name: name.trim() || undefined, participantUserIds, operationId }) }, scope);
      if (!isAuthScopeCurrent(scope)) return;
      const id = result.channel?.id ?? result.resource?.id;
      if (!id) throw new Error("The conversation was not returned. Retry to recover it.");
      onCreated(id);
    } catch (cause) { if (isAuthScopeCurrent(scope)) setError(cause instanceof Error ? cause.message : "Could not create conversation"); }
    finally { setBusy(false); }
  };
  const input = { color: colors.text, borderWidth: 1, borderColor: colors.primary, borderRadius: 8, padding: 12, minHeight: 44 };
  return <View style={{ gap: 12 }}>
    <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{kind === "channel" ? "New channel" : "New chat"}</Text>
    <TextInput accessibilityLabel={kind === "channel" ? "New channel name" : "Chat name (optional)"} placeholder={kind === "channel" ? "Channel name" : "Chat name (optional)"} value={name} editable={!busy} onChangeText={value => { setName(value); changed(); }} style={input} />
    {kind === "channel" && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {(["organization", "private"] as const).map(value => <ProfileMiniCardButton key={value} inHeader borderColor={colors.primary} selected={visibility === value} disabled={busy} onPress={() => { setVisibility(value); changed(); }}>{value === "organization" ? "Everyone in the company" : "Private channel"}</ProfileMiniCardButton>)}
    </View>}
    <TextInput accessibilityLabel="Find participants" placeholder="Search people by name or email" value={search} onChangeText={setSearch} style={input} />
    {selected.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{selected.map(person => <ProfileMiniCardButton key={person.id} inHeader borderColor={colors.primary} accessibilityLabel={`Remove ${person.displayName}`} disabled={busy} onPress={() => { setSelected(rows => rows.filter(row => row.id !== person.id)); changed(); }}>{`${person.displayName} ×`}</ProfileMiniCardButton>)}</View>}
    <ScrollView style={{ height: 192, borderWidth: 1, borderRadius: 10, borderColor: colors.primary }} contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", padding: 12, gap: 8 }}>
      {people.map(person => <Pressable key={person.id} accessibilityRole="checkbox" accessibilityLabel={person.displayName} accessibilityState={{ checked: selected.some(row => row.id === person.id), disabled: busy }} disabled={busy} onPress={() => { setSelected(rows => rows.some(row => row.id === person.id) ? rows.filter(row => row.id !== person.id) : [...rows, person]); changed(); }} style={{ minWidth: 150, flexGrow: 1, minHeight: 44, justifyContent: "center" }}><Text style={{ color: colors.text }}>{selected.some(row => row.id === person.id) ? "☑ " : "☐ "}{person.displayName}</Text></Pressable>)}
    </ScrollView>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <ProfileMiniCardButton inHeader borderColor={colors.primary} loading={busy} disabled={kind === "channel" ? !name.trim() : !selected.length} onPress={() => void create()}>{kind === "channel" ? "Create Channel" : "Start Chat"}</ProfileMiniCardButton>
      <ProfileMiniCardButton inHeader borderColor={colors.primary} disabled={busy} onPress={onCancel}>Cancel</ProfileMiniCardButton>
    </View>
  </View>;
}
