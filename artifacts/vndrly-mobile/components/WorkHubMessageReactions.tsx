import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";

type Row = Record<string, any>;
export default function WorkHubMessageReactions({ channel, message, onSaved }: { channel: Row; message: Row; onSaved: () => Promise<unknown> }) {
  const { user } = useAuth();
  const identity = JSON.stringify([captureAuthScope().generation, user?.id, user?.activeMembershipId, user?.vendorId, user?.partnerId, channel.id, message.id]);
  return <Reactions key={identity} channel={channel} message={message} actorUserId={user?.id ?? 0} onSaved={onSaved} />;
}

function Reactions({ channel, message, actorUserId, onSaved }: { channel: Row; message: Row; actorUserId: number; onSaved: () => Promise<unknown> }) {
  const { i18n } = useTranslation();
  const es = i18n.language.startsWith("es");
  const scope = useRef(captureAuthScope()).current, alive = useRef(true), lock = useRef(false);
  const current = () => alive.current && isAuthScopeCurrent(scope);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [blocked, setBlocked] = useState<Row | null>(null);
  const [attempt, setAttempt] = useState<{ operationId: string; payloadVersion: number; expectedVersion: number; owner: { type: string; id: number }; context: { kind: string; id: string | number }; payload: { emoji: string; action: "add" | "remove" } } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = async (emoji?: string) => {
    if (lock.current || !current() || !actorUserId || (blocked === message && !attempt)) return;
    lock.current = true; setBusy(true); setNotice("");
    const own = message.reactions?.some((row: Row) => row.userId === actorUserId && row.emoji === emoji);
    const original = attempt ?? { operationId: crypto.randomUUID(), payloadVersion: 1, expectedVersion: message.version, owner: { type: channel.ownerOrgType, id: channel.ownerOrgId }, context: { kind: channel.contextKind ?? "organization", id: channel.contextId ?? channel.ownerOrgId }, payload: { emoji: emoji!, action: own ? "remove" as const : "add" as const } };
    setAttempt(original);
    try {
      const result = await apiFetch<Row>(`/api/work-hub/channels/${channel.id}/messages/${message.id}/reactions`, { method: "POST", body: JSON.stringify(original) }, scope);
      if (!current()) return;
      const saved = result.resource;
      if (result.operationId !== original.operationId || saved?.actorUserId !== actorUserId || saved?.channelId !== channel.id || saved?.messageId !== message.id || saved?.expectedVersion !== original.expectedVersion || saved?.emoji !== original.payload.emoji || saved?.action !== original.payload.action || saved?.active !== (original.payload.action === "add")) throw Error("Unverified reaction receipt");
      setAttempt(null); setBlocked(message); setNotice(es ? "Reacción guardada." : "Reaction saved.");
      try { await onSaved(); } catch { if (current()) setNotice(es ? "Guardada. Actualiza la conversación." : "Saved. Refresh the conversation."); }
    } catch (error: any) {
      if (!current()) return;
      if ([400, 409].includes(error.status)) { setAttempt(null); setBlocked(message); setNotice(es ? "Actualiza la conversación antes de volver a intentarlo." : "Refresh the conversation before trying again."); try { await onSaved(); } catch {} }
      else setNotice(es ? "Resultado sin confirmar. Reintenta la solicitud original." : "Result unresolved. Retry the original request.");
    } finally { lock.current = false; if (current()) setBusy(false); }
  };
  return <View style={{ gap: 6 }}>
    <View style={{ flexDirection: "row", gap: 8 }}>{["👍", "❤️", "✅"].map(emoji => <TogglePillButton key={emoji} color="blue" accessibilityLabel={`${es ? "Reaccionar" : "React"} ${emoji}`} disabled={busy || !!attempt || blocked === message} onPress={() => void run(emoji)}>{emoji} {message.reactions?.filter((row: Row) => row.emoji === emoji).length || ""}</TogglePillButton>)}</View>
    {attempt && <TogglePillButton color="blue" disabled={busy} onPress={() => void run()}>{es ? "Reintentar solicitud original" : "Retry original request"}</TogglePillButton>}
    {!!notice && <Text accessibilityRole="alert">{notice}</Text>}
  </View>;
}
