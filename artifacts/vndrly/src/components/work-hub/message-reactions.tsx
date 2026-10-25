import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { ThumbsUp, Heart, Check, RotateCcw, CircleHelp, TriangleAlert } from "lucide-react";
import { commandEnvelope, workHubRequest } from "@/lib/work-hub-client";

type Row = Record<string, any>;
export function MessageReactions({ channel, message, onSaved }: { channel: Row; message: Row; onSaved: () => Promise<unknown> }) {
  const { user } = useAuth();
  const identity = JSON.stringify([user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, channel.id, message.id]);
  return <ReactionControl key={identity} channel={channel} message={message} actorUserId={user?.userId ?? 0} onSaved={onSaved} />;
}

function ReactionControl({ channel, message, actorUserId, onSaved }: { channel: Row; message: Row; actorUserId: number; onSaved: () => Promise<unknown> }) {
  const { i18n } = useTranslation();
  const es = i18n.language.startsWith("es");
  const alive = useRef(true);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [blocked, setBlocked] = useState<Row | null>(null);
  const [attempt, setAttempt] = useState<ReturnType<typeof commandEnvelope<{ emoji: string; action: "add" | "remove" }>> | null>(null);
  const lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = async (emoji?: string) => {
    if (lock.current || !actorUserId || (blocked === message && !attempt)) return;
    lock.current = true; setBusy(true); setNotice("");
    const own = message.reactions?.some((row: Row) => row.userId === actorUserId && row.emoji === emoji);
    const original = attempt ?? commandEnvelope({ type: channel.ownerOrgType, id: channel.ownerOrgId }, { emoji: emoji!, action: own ? "remove" as const : "add" as const }, undefined, message.version, { kind: channel.contextKind, id: channel.contextId });
    setAttempt(original);
    try {
      const result = await workHubRequest<Row>(`/channels/${channel.id}/messages/${message.id}/reactions`, { method: "POST", body: JSON.stringify(original) });
      if (!alive.current) return;
      const saved = result.resource;
      if (result.operationId !== original.operationId || saved?.actorUserId !== actorUserId || saved?.channelId !== channel.id || saved?.messageId !== message.id || saved?.expectedVersion !== original.expectedVersion || saved?.emoji !== original.payload.emoji || saved?.action !== original.payload.action || saved?.active !== (original.payload.action === "add")) throw Error("Unverified reaction receipt");
      setAttempt(null); setBlocked(message);
      setNotice("");
      try { await onSaved(); } catch { if (alive.current) setNotice(es ? "Guardada. Actualiza la conversación." : "Saved. Refresh the conversation."); }
    } catch (error: any) {
      if (!alive.current) return;
      if ([400, 409].includes(error.status)) { setAttempt(null); setBlocked(message); setNotice(es ? "Actualiza la conversación antes de volver a intentarlo." : "Refresh the conversation before trying again."); try { await onSaved(); } catch {} }
      else setNotice(es ? "Resultado sin confirmar. Reintenta la solicitud original." : "Result unresolved. Retry the original request.");
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <span className="inline-flex flex-wrap items-center justify-end gap-1">
    {[{ emoji: "👍", Icon: ThumbsUp }, { emoji: "❤️", Icon: Heart }, { emoji: "✅", Icon: Check }, { emoji: "❓", Icon: CircleHelp, label: es ? "Pregunta" : "Question" }, { emoji: "⚠️", Icon: TriangleAlert, label: es ? "Necesita atención" : "Needs attention" }].map(({ emoji, Icon, label }) => <button type="button" className="hub-message-action" key={emoji} title={label ?? `${es ? "Reaccionar" : "React"} ${emoji}`} aria-label={label ?? `${es ? "Reaccionar" : "React"} ${emoji}`} aria-pressed={!!message.reactions?.some((row: Row) => row.userId === actorUserId && row.emoji === emoji)} disabled={busy || !!attempt || blocked === message} onClick={() => void run(emoji)}><Icon className="h-4 w-4" aria-hidden="true" />{message.reactions?.filter((row: Row) => row.emoji === emoji).length || ""}</button>)}
    {attempt && <button type="button" className="hub-message-action" title={es ? "Reintentar solicitud original" : "Retry original request"} aria-label={es ? "Reintentar solicitud original" : "Retry original request"} disabled={busy} onClick={() => void run()}><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>}
    {notice && !["Reaction saved.", "Reacción guardada."].includes(notice) && <span role="status">{notice}</span>}
  </span>;
}
