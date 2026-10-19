import { useState } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import BrandPillButton from "@/components/brand-pill-button";

type Status = { configured: boolean; connected: boolean; accountGeneration?: string; account?: { displayName: string; username: string }; errorCode?: string; capabilities: string[] };
type Event = { id: string; subject: string; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string }; isCancelled?: boolean; webLink?: string; onlineMeeting?: { joinUrl?: string } };
type Chat = { id: string; topic?: string; chatType: string; webUrl?: string };
type Message = { id: string; text: string; sender: string; createdAt: string; webUrl?: string };
type Meeting = { occurrenceId: string; title: string; startsAt: string; endsAt?: string; status: string; teamsJoinUrl?: string; syncState?: string };
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/work-hub/teams${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", signal, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(value?.message ?? `Microsoft Teams (${response.status})`);
  return value as T;
}
function safeLink(value?: string) {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : undefined; } catch { return undefined; }
}
export function TeamsConnectionPanel() {
  const { user } = useAuth();
  if (!user) return null;
  const scope = `${user.userId}:${user.activeMembershipId}:${user.vendorId}:${user.partnerId}`;
  return <TeamsPanel key={scope} scope={scope} />;
}
function TeamsPanel({ scope }: { scope: string }) {
  const base = ["work-hub-teams", scope];
  const status = useQuery({ queryKey: [...base, "status"], queryFn: ({ signal }) => request<Status>("/status", undefined, signal) });
  return <TeamsWorkspace key={`${scope}:${status.data?.accountGeneration ?? "disconnected"}`} scope={scope} status={status} />;
}
function TeamsWorkspace({ scope, status }: { scope: string; status: UseQueryResult<Status, Error> }) {
  const { i18n } = useTranslation();
  const copy = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const cache = useQueryClient();
  const base = ["work-hub-teams", scope];
  const expectedGeneration = status.data?.accountGeneration ?? "";
  const storageKey = `vndrly-teams-pending:${scope}:${expectedGeneration}`;
  const [restored] = useState<{ operationId: string; chatId: string } | null>(() => {
    try { const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null"); return value && typeof value.operationId === "string" && typeof value.chatId === "string" ? value : null; } catch { return null; }
  });
  const callbackError = new URLSearchParams(window.location.search).get("teams_error");
  // Include the provider identity so a replacement Microsoft account cannot reuse old private reads.
  const account = status.data?.account?.username ?? "";
  const connected = status.data?.connected === true && Boolean(expectedGeneration);
  const key = [...base, expectedGeneration, account];
  const calendar = useQuery({ queryKey: [...key, "calendar"], enabled: connected, queryFn: ({ signal }) => request<{ events: Event[] }>("/calendar", undefined, signal) });
  const chats = useQuery({ queryKey: [...key, "chats"], enabled: connected, queryFn: ({ signal }) => request<{ chats: Chat[] }>("/chats", undefined, signal) });
  const meetings = useQuery({ queryKey: [...key, "meetings"], enabled: connected, queryFn: ({ signal }) => request<{ meetings: Meeting[] }>("/meetings", undefined, signal) });
  const [chatId, setChatId] = useState(restored?.chatId ?? "");
  const messages = useQuery({ queryKey: [...key, "messages", chatId], enabled: connected && Boolean(chatId), queryFn: ({ signal }) => request<{ messages: Message[] }>(`/chats/${encodeURIComponent(chatId)}/messages`, undefined, signal) });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(Boolean(restored));
  const [attempt, setAttempt] = useState<{ operationId: string; chatId: string; text: string } | null>(null);
  const [publishIds] = useState(() => new Map<string, string>());
  async function run(action: () => Promise<void>) {
    setBusy(true); setNotice("");
    try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : copy("Request failed.", "La solicitud falló.")); }
    finally { setBusy(false); }
  }
  const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(i18n.language); };
  const selectedChat = chats.data?.chats.find(chat => chat.id === chatId);
  const error = status.error ?? calendar.error ?? chats.error ?? meetings.error ?? messages.error;
  return <section className="rounded-xl border-2 border-amber-500 p-4 space-y-4" aria-label="Microsoft Teams">
    <h2 className="font-semibold text-lg">Microsoft Teams</h2>
    <p className="text-sm">{copy("Calendar and chats are private to your connected account. Only meetings you explicitly publish are shared with Teams.", "El calendario y los chats son privados de su cuenta conectada. Solo las reuniones que publique explícitamente se comparten con Teams.")}</p>
    {status.isPending ? <p>{copy("Loading…", "Cargando…")}</p> : null}
    {callbackError ? <p role="alert">{copy("Microsoft sign-in was not completed. Your organization may require an administrator to approve access. Try connecting again or ask your Microsoft administrator.", "No se completó el inicio de sesión de Microsoft. Su organización puede requerir que un administrador apruebe el acceso. Vuelva a conectar o consulte a su administrador de Microsoft.")}{/^[a-z_]{1,80}$/.test(callbackError) ? ` (${callbackError})` : ""}</p> : null}
    {error ? <p role="alert">{error.message}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!status.data?.configured && !status.isPending ? <p>{copy("Microsoft app registration must be configured before connecting.", "Debe configurarse el registro de la aplicación de Microsoft antes de conectar.")}</p> : null}
    {status.data?.errorCode ? <p>{status.data.errorCode}</p> : null}
    {connected ? <>
      <p className="text-sm font-medium">{status.data?.account?.displayName} · {account}</p>
      <div className="flex flex-wrap gap-2">
        <BrandPillButton tone="amber" disabled={busy} onClick={() => void run(async () => { await request("/sync", { expectedGeneration }); await cache.invalidateQueries({ queryKey: base }); })}>{copy("Refresh linked meetings", "Actualizar reuniones vinculadas")}</BrandPillButton>
        <BrandPillButton disabled={busy} onClick={() => void run(async () => { await request("/disconnect", {}); cache.removeQueries({ queryKey: base }); setChatId(""); setText(""); setAttempt(null); setUncertain(false); await status.refetch(); })}>{copy("Disconnect", "Desconectar")}</BrandPillButton>
      </div>
      <h3 className="font-semibold">{copy("Your Microsoft calendar", "Su calendario de Microsoft")}</h3>
      {calendar.isPending ? <p>{copy("Loading…", "Cargando…")}</p> : null}
      {calendar.data?.events.length === 0 ? <p>{copy("No events in this calendar window.", "No hay eventos en este intervalo del calendario.")}</p> : null}
      <ul className="space-y-2">{calendar.data?.events.map(event => <li key={event.id} className="border rounded p-2 text-sm"><strong>{event.subject}</strong><div>{event.start.dateTime} — {event.end.dateTime} ({event.start.timeZone})</div>{event.isCancelled ? <span>{copy("Cancelled", "Cancelado")}</span> : safeLink(event.onlineMeeting?.joinUrl) ? <a className="underline" href={safeLink(event.onlineMeeting?.joinUrl)} target="_blank" rel="noopener noreferrer">{copy("Join in Teams", "Unirse en Teams")}</a> : null}</li>)}</ul>
      <h3 className="font-semibold">{copy("Work Hub meetings", "Reuniones de Work Hub")}</h3>
      {meetings.data?.meetings.length === 0 ? <p>{copy("No eligible meetings.", "No hay reuniones disponibles.")}</p> : null}
      <ul className="space-y-2">{meetings.data?.meetings.map(meeting => <li key={meeting.occurrenceId} className="border rounded p-2 space-y-1 text-sm"><strong>{meeting.title}</strong><div>{date(meeting.startsAt)} — {meeting.endsAt ? date(meeting.endsAt) : "—"} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</div><div>{meeting.status} {meeting.syncState ? `· ${meeting.syncState}` : ""}</div>{safeLink(meeting.teamsJoinUrl) ? <a className="underline block" href={safeLink(meeting.teamsJoinUrl)} target="_blank" rel="noopener noreferrer">{copy("Join in Teams", "Unirse en Teams")}</a> : null}<BrandPillButton tone="amber" disabled={busy} onClick={() => void run(async () => { const operationId = publishIds.get(meeting.occurrenceId) ?? crypto.randomUUID(); publishIds.set(meeting.occurrenceId, operationId); await request(`/meetings/${encodeURIComponent(meeting.occurrenceId)}/publish`, { operationId, expectedGeneration }); publishIds.delete(meeting.occurrenceId); await cache.invalidateQueries({ queryKey: key }); setNotice(copy("Meeting sync requested. Check the sync status above.", "Sincronización solicitada. Revise el estado de arriba.")); })}>{copy("Publish / update in Teams", "Publicar / actualizar en Teams")}</BrandPillButton></li>)}</ul>
      <h3 className="font-semibold">{copy("Your Teams chats", "Sus chats de Teams")}</h3>
      {uncertain ? <div className="space-y-2"><p role="status">{copy("A previous send has no confirmed result. Check the destination in Teams before starting another message. No message text is stored in your browser.", "Un envío anterior no tiene resultado confirmado. Revise el destino en Teams antes de iniciar otro mensaje. No se guarda el texto del mensaje en su navegador.")}</p><BrandPillButton disabled={busy} onClick={() => { try { sessionStorage.removeItem(storageKey); } catch { setNotice(copy("Browser storage is unavailable.", "El almacenamiento del navegador no está disponible.")); return; } setAttempt(null); setText(""); setUncertain(false); setNotice(""); }}>{copy("I checked Teams; start a new message", "Revisé Teams; iniciar un mensaje nuevo")}</BrandPillButton></div> : null}
      <label className="block text-sm">{copy("Destination chat", "Chat de destino")}<select className="block w-full border rounded p-2 bg-background" value={chatId} disabled={busy || uncertain} onChange={event => { setChatId(event.target.value); setAttempt(null); setText(""); }}><option value="">{copy("Choose a chat", "Elija un chat")}</option>{chats.data?.chats.map(chat => <option key={chat.id} value={chat.id}>{chat.topic || chat.id} ({chat.chatType})</option>)}</select></label>
      {selectedChat ? <>
        <p className="text-sm">{account} → {selectedChat.topic || selectedChat.id}</p>
        <ul className="max-h-72 overflow-auto space-y-2" aria-label={copy("Teams messages", "Mensajes de Teams")}>{messages.data?.messages.map(message => <li key={message.id} className="border rounded p-2 text-sm"><strong>{message.sender}</strong> · {date(message.createdAt)}<p className="whitespace-pre-wrap break-words">{message.text}</p></li>)}</ul>
        <label className="block text-sm">{copy("Message to send to Teams", "Mensaje para enviar a Teams")}<textarea className="block w-full border rounded p-2 bg-background" maxLength={10000} value={text} disabled={busy || uncertain} onChange={event => { setText(event.target.value); setAttempt(null); }} /></label>
        <BrandPillButton tone="amber" disabled={busy || uncertain || !text.trim()} onClick={() => void run(async () => {
          const intent = attempt ?? { operationId: crypto.randomUUID(), chatId, text: text.trim() };
          // Persist a lock before sending, never the private message body. Failure to persist blocks the send.
          sessionStorage.setItem(storageKey, JSON.stringify({ operationId: intent.operationId, chatId: intent.chatId }));
          setAttempt(intent);
          // A network error after sending is ambiguous. Never offer a fresh send that could duplicate it.
          setUncertain(true);
          const result = await request<{ messageId?: string; status: "sent" | "uncertain"; replayed: boolean }>(`/chats/${encodeURIComponent(intent.chatId)}/messages`, { operationId: intent.operationId, text: intent.text, confirmSend: true, expectedGeneration });
          if (result.status === "sent") { sessionStorage.removeItem(storageKey); setUncertain(false); setAttempt(null); setText(""); setNotice(copy("Sent to Teams.", "Enviado a Teams.")); await messages.refetch(); }
          else setNotice(copy("Delivery is uncertain. Check Teams before taking further action; resend is disabled.", "La entrega es incierta. Revise Teams antes de continuar; el reenvío está deshabilitado."));
        })}>{copy("Send to Teams", "Enviar a Teams")}</BrandPillButton>
        {uncertain ? <p role="status">{copy("This send is locked to prevent duplicates. Check the destination chat in Teams.", "Este envío está bloqueado para evitar duplicados. Revise el chat de destino en Teams.")}</p> : null}
      </> : null}
    </> : <BrandPillButton tone="amber" disabled={busy || !status.data?.configured} onClick={() => void run(async () => { const result = await request<{ authorizationUrl: string }>("/connect", {}); const url = new URL(result.authorizationUrl); if (url.protocol !== "https:" || url.hostname !== "login.microsoftonline.com") throw new Error(copy("Unexpected Microsoft sign-in address.", "Dirección de inicio de sesión inesperada.")); window.location.assign(url.href); })}>{copy("Connect Microsoft Teams", "Conectar Microsoft Teams")}</BrandPillButton>}
  </section>;
}
