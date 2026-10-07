import WorkHubChannelMembers from "./WorkHubChannelMembers";
import WorkHubMessageReactions from "./WorkHubMessageReactions";
import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { isOfflineWorkHubFailure, queueNativeWorkHubRequest } from "@/lib/work-hub-queue-runtime";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";

export default function WorkHubConversation({ channel, onClose }: { channel: Record<string, any>; onClose: () => void }) {
  const { user } = useAuth();
  const scope = captureAuthScope();
  const identity = JSON.stringify([scope.generation, user?.id, user?.activeMembershipId, user?.vendorId, user?.partnerId, channel.id]);
  return <Conversation key={identity} channel={channel} onClose={onClose} />;
}

function Conversation({ channel, onClose }: { channel: Record<string, any>; onClose: () => void }) {
  const colors = useColors(); const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]), [draft, setDraft] = useState(""), [error, setError] = useState("");
  const [reply, setReply] = useState<any>(null), [editing, setEditing] = useState<any>(null), [busy, setBusy] = useState(false);
  const attempt = useRef<{ path: string; method: "POST" | "PATCH" | "DELETE"; requestBody: ReturnType<typeof envelope> } | null>(null);
  const scope = useRef(captureAuthScope()).current;
  const alive = useRef(true);
  const current = () => alive.current && isAuthScopeCurrent(scope);
  const base = `/api/work-hub/channels/${channel.id}`;
  const draftKey = `work-hub-draft:${user?.id}:${channel.id}`;
  const load = async () => { const rows = await apiFetch<any[]>(`${base}/messages`, {}, scope); if (!current()) return; setMessages([...rows].reverse()); const last = rows[0]; if (last) await apiFetch(`${base}/read-cursor`, { method: "PUT", body: JSON.stringify({ lastMessageId: last.id }) }, scope); };
  useEffect(() => { alive.current = true; let live = true; void AsyncStorage.getItem(draftKey).then(value => { if (live && current()) setDraft(value ?? ""); }); void load().catch(e => { if (current()) setError(e.message); }); const timer = setInterval(() => void load().catch(e => { if (current()) setError(e.message); }), 5000); return () => { live = false; alive.current = false; clearInterval(timer); }; }, [channel.id]);
  const changeDraft = (value: string) => { setDraft(value); void AsyncStorage.setItem(draftKey, value).catch(() => undefined); };
  const envelope = (payload: unknown, version?: number, operationId: string = crypto.randomUUID()) => ({ operationId, payloadVersion: 1, expectedVersion: version ?? null, owner: { type: channel.ownerOrgType, id: channel.ownerOrgId }, context: { kind: channel.contextKind ?? "organization", id: channel.contextId ?? channel.ownerOrgId }, payload });
  const send = async () => {
    if ((!draft.trim() && !attempt.current) || busy || !current()) return; setBusy(true); setError("");
    if (!attempt.current) attempt.current = { path: `${base}/messages${editing ? `/${editing.id}` : ""}`, method: editing ? "PATCH" : "POST", requestBody: envelope(editing ? { body: draft.trim() } : { body: draft.trim(), parentMessageId: reply?.id ?? null, mentionUserIds: [] }, editing?.version) };
    const { path, method, requestBody } = attempt.current;
    try {
      const receipt = await apiFetch<any>(path, { method, body: JSON.stringify(requestBody) }, scope);
      if (!current()) return;
      const saved = receipt?.resource;
      if (receipt?.operationId !== requestBody.operationId || saved?.channelId !== channel.id || saved?.authorUserId !== user?.id ||
          (method !== "POST" && saved?.id !== path.slice(path.lastIndexOf("/") + 1)) ||
          saved?.version !== (requestBody.expectedVersion ?? 0) + 1 ||
          (method === "DELETE" ? saved?.body !== "" || !saved?.deletedAt : saved?.body !== (requestBody.payload as { body: string }).body || saved?.deletedAt != null)) throw new Error("Unverified saved response");
      changeDraft(""); setReply(null); setEditing(null); attempt.current = null;
      try { await load(); } catch { if (current()) setError("Saved. Refresh the conversation to see the current messages."); }
    }
    catch (cause: any) {
      if (!current()) return;
      if (user && isOfflineWorkHubFailure(cause)) {
        try { await queueNativeWorkHubRequest(user, path, method, requestBody); }
        catch { if (current()) setError("Could not queue the request. Retry the exact original request."); return; }
        if (!current()) return;
        changeDraft(""); setReply(null); setEditing(null); attempt.current = null;
        setError("Saved securely on this device. It will send when you reconnect.");
      } else if ([400, 409].includes(cause.status)) { attempt.current = null; setReply(null); setEditing(null); setError(cause.message); void load().catch(() => undefined); }
      else setError("Result unresolved. Retry the exact original request.");
    } finally { if (current()) setBusy(false); }
  };
  const remove = (message: any) => { if (busy || attempt.current || !current()) return; Alert.alert("Delete message?", "The conversation will show that this message was deleted.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => { if (!current() || attempt.current) return; attempt.current = { path: `${base}/messages/${message.id}`, method: "DELETE", requestBody: envelope({}, message.version) }; void send(); } }]); };
  return <View style={{ gap: 14 }}><WorkHubChannelMembers channelId={channel.id} /><Pressable onPress={onClose}><Text style={{ color: colors.primary }}>Back to conversations</Text></Pressable><Text style={{ color: colors.text, fontWeight: "700", fontSize: 22 }}>{channel.name ?? "Conversation"}</Text>{!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}{messages.map(message => <View key={message.id} style={{ borderWidth: 1, borderColor: colors.border, padding: 12, borderRadius: 10, gap: 8 }}><Text style={{ color: colors.mutedForeground }}>{message.authorName ?? "Participant"} · {new Date(message.createdAt).toLocaleString()}{message.editedAt ? " · edited" : ""}</Text>{message.parentMessageId && <Text style={{ color: colors.mutedForeground }}>Reply to {messages.find(row => row.id === message.parentMessageId)?.body?.slice(0, 80) ?? "message"}</Text>}<Text style={{ color: colors.text }}>{message.deletedAt ? "Message deleted" : message.body}</Text>{!message.deletedAt && <View style={{ flexDirection: "row", gap: 20 }}><Pressable onPress={() => { setReply(message); setEditing(null); }}><Text style={{ color: colors.primary }}>Reply</Text></Pressable>{message.authorUserId === user?.id && <><Pressable onPress={() => { setEditing(message); setReply(null); changeDraft(message.body); }}><Text style={{ color: colors.primary }}>Edit</Text></Pressable><Pressable onPress={() => remove(message)}><Text style={{ color: colors.destructive }}>Delete</Text></Pressable></>}</View>}{!message.deletedAt && <WorkHubMessageReactions channel={channel} message={message} onSaved={load} />}</View>)}{(reply || editing) && <Pressable onPress={() => { setReply(null); setEditing(null); }}><Text style={{ color: colors.primary }}>{editing ? "Editing message" : "Replying"} · Cancel</Text></Pressable>}<TextInput accessibilityLabel="Message" multiline editable={!attempt.current} value={draft} onChangeText={changeDraft} placeholder="Type a message" placeholderTextColor={colors.mutedForeground} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.text }} /><Pressable accessibilityRole="button" disabled={busy || (!draft.trim() && !attempt.current)} onPress={send}><Text style={{ padding: 12, color: colors.primary }}>{busy ? "Sending…" : attempt.current ? "Retry original request" : editing ? "Save edit" : "Send"}</Text></Pressable></View>;
}
