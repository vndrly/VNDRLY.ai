import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { isOfflineWorkHubFailure, queueNativeWorkHubRequest } from "@/lib/work-hub-queue-runtime";

export default function WorkHubConversation({ channel, onClose }: { channel: Record<string, any>; onClose: () => void }) {
  const colors = useColors(); const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]), [draft, setDraft] = useState(""), [error, setError] = useState("");
  const [reply, setReply] = useState<any>(null), [editing, setEditing] = useState<any>(null), [busy, setBusy] = useState(false);
  const attempt = useRef<{ body: string; id: string } | null>(null);
  const base = `/api/work-hub/channels/${channel.id}`;
  const draftKey = `work-hub-draft:${user?.id}:${channel.id}`;
  const load = async () => { const rows = await apiFetch<any[]>(`${base}/messages`); setMessages([...rows].reverse()); const last = rows[0]; if (last) await apiFetch(`${base}/read-cursor`, { method: "PUT", body: JSON.stringify({ lastMessageId: last.id }) }); };
  useEffect(() => { let live = true; void AsyncStorage.getItem(draftKey).then(value => { if (live) setDraft(value ?? ""); }); void load().catch(e => setError(e.message)); const timer = setInterval(() => void load().catch(e => setError(e.message)), 5000); return () => { live = false; clearInterval(timer); }; }, [channel.id]);
  const changeDraft = (value: string) => { setDraft(value); void AsyncStorage.setItem(draftKey, value).catch(() => undefined); };
  const envelope = (payload: unknown, version?: number, operationId: string = crypto.randomUUID()) => ({ operationId, payloadVersion: 1, expectedVersion: version ?? null, owner: { type: channel.ownerOrgType, id: channel.ownerOrgId }, context: { kind: channel.contextKind ?? "organization", id: channel.contextId ?? channel.ownerOrgId }, payload });
  const send = async () => {
    if (!draft.trim() || busy) return; setBusy(true); setError("");
    const body = JSON.stringify({ body: draft.trim(), parentMessageId: reply?.id ?? null, mentionUserIds: [] });
    if (attempt.current?.body !== body) attempt.current = { body, id: crypto.randomUUID() };
    const path = `${base}/messages${editing ? `/${editing.id}` : ""}`;
    const method = editing ? "PATCH" : "POST";
    const requestBody = envelope(JSON.parse(body), editing?.version, attempt.current.id);
    try { await apiFetch(path, { method, body: JSON.stringify(requestBody) }); changeDraft(""); setReply(null); setEditing(null); attempt.current = null; await load(); }
    catch (cause: any) {
      if (user && isOfflineWorkHubFailure(cause)) {
        await queueNativeWorkHubRequest(user, path, method, requestBody);
        changeDraft(""); setReply(null); setEditing(null); attempt.current = null;
        setError("Saved securely on this device. It will send when you reconnect.");
      } else setError(cause.message);
    } finally { setBusy(false); }
  };
  const remove = (message: any) => Alert.alert("Delete message?", "The conversation will show that this message was deleted.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => { void apiFetch(`${base}/messages/${message.id}`, { method: "DELETE", body: JSON.stringify(envelope({}, message.version)) }).then(load).catch(e => setError(e.message)); } }]);
  return <View style={{ gap: 14 }}><Pressable onPress={onClose}><Text style={{ color: colors.primary }}>Back to conversations</Text></Pressable><Text style={{ color: colors.text, fontWeight: "700", fontSize: 22 }}>{channel.name ?? "Conversation"}</Text>{!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}{messages.map(message => <View key={message.id} style={{ borderWidth: 1, borderColor: colors.border, padding: 12, borderRadius: 10, gap: 8 }}><Text style={{ color: colors.mutedForeground }}>{message.authorName ?? "Participant"} · {new Date(message.createdAt).toLocaleString()}{message.editedAt ? " · edited" : ""}</Text>{message.parentMessageId && <Text style={{ color: colors.mutedForeground }}>Reply to {messages.find(row => row.id === message.parentMessageId)?.body?.slice(0, 80) ?? "message"}</Text>}<Text style={{ color: colors.text }}>{message.deletedAt ? "Message deleted" : message.body}</Text>{!message.deletedAt && <View style={{ flexDirection: "row", gap: 20 }}><Pressable onPress={() => { setReply(message); setEditing(null); }}><Text style={{ color: colors.primary }}>Reply</Text></Pressable>{message.authorUserId === user?.id && <><Pressable onPress={() => { setEditing(message); setReply(null); changeDraft(message.body); }}><Text style={{ color: colors.primary }}>Edit</Text></Pressable><Pressable onPress={() => remove(message)}><Text style={{ color: colors.destructive }}>Delete</Text></Pressable></>}</View>}</View>)}{(reply || editing) && <Pressable onPress={() => { setReply(null); setEditing(null); }}><Text style={{ color: colors.primary }}>{editing ? "Editing message" : "Replying"} · Cancel</Text></Pressable>}<TextInput accessibilityLabel="Message" multiline value={draft} onChangeText={changeDraft} placeholder="Type a message" placeholderTextColor={colors.mutedForeground} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.text }} /><Pressable accessibilityRole="button" disabled={busy || !draft.trim()} onPress={send}><Text style={{ padding: 12, color: colors.primary }}>{busy ? "Sending…" : editing ? "Save edit" : "Send"}</Text></Pressable></View>;
}
