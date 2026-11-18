import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import { AskVFloatingLauncherMark, ASKV_LAUNCHER_HEIGHT, ASKV_LAUNCHER_WIDTH } from "./askv-logo";
import AskVStatusIndicator from "./askv-status-indicator";
import { AssistantMarkdown } from "./assistant-markdown";
import { ASKV_PANE_BG } from "./nav-pane-tokens";
import { AskVGateHelperOffer } from "./askv-gate-helper-offer";

const AssistantPanel = lazy(() => import("./assistant-panel").then(m => ({ default: m.AssistantPanel })));

/** A content-sized conversation strip; the page below keeps its own scroll. */
export default function AskVTopPane({ children }: { children?: ReactNode }) {
  const voice = useAskVVoiceSession(), { i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const [open, setOpen] = useState(false), [more, setMore] = useState(false), [input, setInput] = useState("");
  const [sendError, setSendError] = useState("");
  const assistant = voice.assistant;
  const latestReply = assistant?.messages.filter(m => m.role === "assistant").at(-1);
  const reply = latestReply?.content;
  const active = ["connecting", "greeting", "listening", "thinking", "speaking"].includes(voice.state);
  const previousActive = useRef(false);
  useEffect(() => {
    if (active && !previousActive.current) setOpen(true);
    previousActive.current = active;
  }, [active]);
  useEffect(() => {
    voice.setPanelOpen?.(open || more);
    return () => voice.setPanelOpen?.(false);
  }, [open, more, voice.setPanelOpen]);
  function show() {
    setOpen(true);
    if (!assistant?.messages.length) void assistant?.loadLatest();
    if (!voice.muted) void voice.startConversation("open AskV");
  }
  async function send() {
    const text = input.trim(); if (!text || assistant?.streaming) return;
    setSendError(""); setInput("");
    try { await voice.sendText(text); } catch (e) { setInput(text); setSendError(e instanceof Error ? e.message : c("Could not send. Try again.", "No se pudo enviar. Inténtalo de nuevo.")); }
  }
  const message = sendError || assistant?.error || reply || voice.error || voice.greeting ||
    (voice.state === "listening" ? c("Listening…", "Escuchando…") : voice.state === "thinking" || assistant?.streaming ? c("Thinking…", "Pensando…") : c("Ask V about your work.", "Pregunta a V sobre tu trabajo."));
  return <div data-testid="askv-pane" data-open={open} className="relative isolate z-40 shrink-0 min-w-0 border-b border-[var(--brand-primary)] text-gray-100" style={{ backgroundColor: ASKV_PANE_BG }}>
    <div className="flex min-h-12 items-center gap-1 px-2">
      <div className="relative flex shrink-0 items-center">
        <button type="button" className="relative top-[3px] inline-flex items-center justify-center" style={{ width: ASKV_LAUNCHER_WIDTH, height: ASKV_LAUNCHER_HEIGHT }}
          data-testid="assistant-launcher" aria-label={open ? "Close Ask V" : "Open Ask V"} aria-expanded={open}
          onClick={() => { if (open) { setOpen(false); voice.closePanel(); } else show(); }}><AskVFloatingLauncherMark engaged={active} panelOpen={open} /></button>
        <div className="-ml-[10.8px]"><AskVStatusIndicator placement="top-strip" /></div>
      </div>
      {open ? <div className="ml-auto flex items-center gap-4 text-xs text-[var(--brand-primary)]">
        <button type="button" className="min-h-11" onClick={() => voice.setMuted(true)}>{c("Stop V", "Detener V")}</button>
        <button type="button" className="min-h-11" onClick={() => setMore(true)}>{c("More", "Más")}</button>
        <button type="button" className="min-h-11" onClick={() => { setOpen(false); voice.closePanel(); }}>{c("Close", "Cerrar")}</button>
      </div> : <div className="ml-auto flex items-center">{children}</div>}
    </div>
    {open && <div className="px-3 pb-2" data-testid="askv-top-conversation">
      <div data-testid="askv-top-reply" role="log" aria-live="polite" aria-label={c("AskV reply", "Respuesta de AskV")}
        className="overflow-y-auto overscroll-contain break-words text-sm leading-5 [&_p]:mb-2 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto"
        style={{ maxHeight: "min(28vh, 280px)", overflowWrap: "anywhere" }}><AssistantMarkdown text={message} /></div>
      <AskVGateHelperOffer question={assistant?.messages.filter(m => m.role === "user").at(-1)?.content ?? ""} workflowOffer={latestReply?.gateWorkflowOffer} setupProgress={latestReply?.gateSetupProgress} toolCalls={latestReply?.toolCalls} />
      <form className="flex gap-2 mt-1" onSubmit={e => { e.preventDefault(); void send(); }}>
        <input aria-label={c("Message AskV", "Mensaje para AskV")} placeholder={c("Message AskV…", "Mensaje para AskV…")} value={input} onChange={e => setInput(e.target.value)} disabled={assistant?.streaming}
          className="h-9 min-w-0 flex-1 rounded-full border border-[var(--brand-primary)] bg-[#303034] px-3 text-sm" />
        <button type="submit" className="px-2 text-xs text-[var(--brand-primary)] disabled:opacity-50" disabled={!input.trim() || assistant?.streaming}>{c("Send", "Enviar")}</button>
      </form>
    </div>}
    {more && <Suspense fallback={null}><AssistantPanel open onOpenChange={setMore} /></Suspense>}
  </div>;
}
