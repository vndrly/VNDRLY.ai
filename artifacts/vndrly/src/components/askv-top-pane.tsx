import { readGateVoiceDraft, subscribeGateVoiceDraft, gateCheckInFocusAvailable } from "@workspace/gate-booth";
import { GuidanceTabs, selectGuidance, useGuidanceMode } from "./guidance-surface";
import { GuidedHelperPortal } from "./guided-target";
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
export function AskVCompanion() {
  const voice = useAskVVoiceSession(), { i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const [open, setOpen] = useState(false), [more, setMore] = useState(false), [input, setInput] = useState("");
  const [sendError, setSendError] = useState("");
  const [gateDraft, setGateDraft] = useState(readGateVoiceDraft);
  const focusEntered = useRef(false);
  const focusReply = useRef<string | number | undefined>(undefined);
  const nativeReplyRef = useRef<string | undefined>(undefined), focusNativeReply = useRef<string | undefined>(undefined);
  const recentReply = voice.assistant?.messages.filter(m => m.role === "assistant").at(-1)?.id;
  const recentReplyRef = useRef(recentReply); recentReplyRef.current = recentReply;
  const startVoice = useRef(voice.startConversation); startVoice.current = voice.startConversation;
  useEffect(() => {
    let disposed = false;
    const update = () => queueMicrotask(() => {
      if (disposed) return;
      const draft = readGateVoiceDraft(); setGateDraft(draft);
      const focused = gateCheckInFocusAvailable({ path: window.location.pathname, gateDraft: draft });
      if (focused && !focusEntered.current) {
        focusReply.current = recentReplyRef.current; focusNativeReply.current = nativeReplyRef.current;
        setOpen(true); selectGuidance("askv");
        const native = (window as Window & { ReactNativeWebView?: { postMessage: (value: string) => void } }).ReactNativeWebView;
        if (native) native.postMessage(JSON.stringify({ type: "gate-focus-start", channel: new URLSearchParams(window.location.search).get("gateVoiceChannel") }));
        else void startVoice.current();
      }
      focusEntered.current = focused;
    });
    update(); const unsubscribe = subscribeGateVoiceDraft(update);
    return () => { disposed = true; unsubscribe(); };
  }, []);
  const [nativeState,setNativeState] = useState<{message?:string;confirmationReference?:string;busy?:boolean;error?:string}|null>(null);
  nativeReplyRef.current = nativeState?.message;
  const [nativeSending,setNativeSending] = useState(false);
  const pendingNative = useRef<string|null>(null);
  useEffect(() => {
    if (!nativeSending) return;
    const timer = window.setTimeout(() => { pendingNative.current=null;setNativeSending(false);setSendError("AskV has not acknowledged this message. Check the conversation before retrying."); }, 120000);
    return () => window.clearTimeout(timer);
  }, [nativeSending]);
  useEffect(() => {
    const state = (event:Event) => setNativeState((event as CustomEvent).detail);
    const result = (event:Event) => { const value=(event as CustomEvent).detail; if(value?.id !== pendingNative.current)return;pendingNative.current=null;setNativeSending(false);if(value.ok)setInput("");else setSendError(value.error || "Could not send. Try again."); };
    window.addEventListener("gate-companion-state",state);window.addEventListener("gate-companion-result",result);
    return () => {window.removeEventListener("gate-companion-state",state);window.removeEventListener("gate-companion-result",result);};
  },[]);
  function nativeSend(text?:string, confirmationReference?:string) {
    const native=(window as Window & {ReactNativeWebView?:{postMessage:(value:string)=>void}}).ReactNativeWebView;
    if(!native || nativeSending)return;
    const id=crypto.randomUUID();pendingNative.current=id;setNativeSending(true);setSendError("");
    native.postMessage(JSON.stringify({type:"gate-companion-send",id,channel:new URLSearchParams(window.location.search).get("gateVoiceChannel"),text,confirmationReference}));
  }
  const mode = useGuidanceMode();
  useEffect(() => { const reveal = () => setOpen(true); window.addEventListener("vndrly-guidance-askv", reveal); return () => window.removeEventListener("vndrly-guidance-askv", reveal); }, []);
  useEffect(() => { const close = () => {setOpen(false);voice.closePanel();};window.addEventListener("vndrly-guidance-close",close);return()=>window.removeEventListener("vndrly-guidance-close",close); }, [voice.closePanel]);
  useEffect(() => {window.dispatchEvent(new CustomEvent("vndrly-guidance-visible",{detail:open && mode === "askv"}));}, [open,mode]);
  const assistant = voice.assistant;
  const latestReply = assistant?.messages.filter(m => m.role === "assistant").at(-1);
  const latestUser = assistant?.messages.filter(m => m.role === "user").at(-1);
  const focused = gateCheckInFocusAvailable({ path: window.location.pathname, gateDraft });
  const reply = focused && latestReply?.id === focusReply.current ? undefined : latestReply?.content;
  const active = ["connecting", "greeting", "listening", "thinking", "speaking"].includes(voice.state);
  const previousActive = useRef(false);
  useEffect(() => {
    if (active && !previousActive.current) { setOpen(true); selectGuidance("askv"); }
    previousActive.current = active;
  }, [active]);
  useEffect(() => {
    voice.setPanelOpen?.(open || more);
    return () => voice.setPanelOpen?.(false);
  }, [open, more, voice.setPanelOpen]);
  useEffect(() => { if(open && !focused && !nativeState && !assistant?.messages.length) void assistant?.loadLatest(); }, [open, focused]);
  async function send() {
    const text = input.trim(); if (!text || assistant?.streaming) return;
    if (nativeState) { nativeSend(text); return; }
    setSendError(""); setInput("");
    try { await voice.sendText(text); } catch (e) { setInput(text); setSendError(e instanceof Error ? e.message : c("Could not send. Try again.", "No se pudo enviar. Inténtalo de nuevo.")); }
  }
  const message = sendError || nativeState?.error || (!focused || nativeState?.message !== focusNativeReply.current ? nativeState?.message : undefined) || assistant?.error || reply || voice.error || voice.greeting ||
    (voice.state === "listening" ? c("Listening…", "Escuchando…") : voice.state === "thinking" || assistant?.streaming ? c("Thinking…", "Pensando…") : focused ? c("Say submit when ready.", "Di enviar cuando estés listo.") : c("Ask V about your work.", "Pregunta a V sobre tu trabajo."));
  return <>
    {open && <GuidedHelperPortal>{inModal => <section hidden={mode !== "askv"} data-guidance-surface data-embedded={inModal} className="next-steps-panel next-steps-active-helper px-3 pb-2" data-testid="askv-top-conversation" aria-label="AskV"><GuidanceTabs /><button type="button" className="min-h-11" onClick={() => setMore(value => !value)}>{c("More", "Más")}</button><button type="button" className="next-steps-icon-button self-end" onClick={() => { setOpen(false); voice.closePanel(); }} aria-label={c("Close AskV", "Cerrar AskV")}>×</button>
      {gateDraft && gateCheckInFocusAvailable({ path: window.location.pathname, gateDraft }) && <div data-testid="askv-live-check-in" className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={c("Current check-in", "Registro actual")}>
        {[ ["firstName", c("First name", "Nombre")], ["lastName", c("Last name", "Apellido")], ["company", c("Company", "Empresa")], ["vehiclePlate", c("Plate", "Placa")], ["plateState", c("State", "Estado")], ["siteName", c("Site", "Sitio")], ["gateStationName", c("Gate", "Puerta")], ["purpose", c("Reason", "Motivo")], ["notes", c("Notes", "Notas")] ].map(([key, label]) => gateDraft[key] ? <span key={key}>{label}: {String(gateDraft[key])}</span> : null)}
      </div>}
      {(voice as typeof voice & {focusMode?:boolean}).focusMode && <div data-testid="askv-focus-dialog">{latestUser?.content}</div>}
      <div data-testid="askv-top-reply" role="log" aria-live="polite" aria-label={c("AskV reply", "Respuesta de AskV")}
        className="overflow-y-auto overscroll-contain break-words text-sm leading-5 [&_p]:mb-2 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto"
        style={{ maxHeight: "min(28vh, 280px)", overflowWrap: "anywhere" }}><AssistantMarkdown text={message} /></div>
      {!focused && nativeState?.confirmationReference && <button type="button" className="min-h-11" disabled={nativeSending || nativeState.busy} onClick={() => nativeSend(undefined,nativeState.confirmationReference)}>{c("Confirm current request", "Confirmar solicitud actual")}</button>}
      {!focused && !nativeState && <AskVGateHelperOffer question={latestUser?.content ?? ""} workflowOffer={latestReply?.gateWorkflowOffer} setupProgress={latestReply?.gateSetupProgress} toolCalls={latestReply?.toolCalls} />}
      {more && <Suspense fallback={null}><AssistantPanel embedded open onOpenChange={setMore} /></Suspense>}
      <form className="flex gap-2 mt-1" onSubmit={e => { e.preventDefault(); void send(); }}>
        <input aria-label={c("Message AskV", "Mensaje para AskV")} placeholder={c("Message AskV…", "Mensaje para AskV…")} value={input} onChange={e => setInput(e.target.value)} disabled={assistant?.streaming || nativeSending || nativeState?.busy}
          className="h-9 min-w-0 flex-1 rounded-full border border-[var(--brand-primary)] bg-[#303034] px-3 text-sm" />
        <button type="submit" className="px-2 text-xs text-[var(--brand-primary)] disabled:opacity-50" disabled={!input.trim() || assistant?.streaming || nativeSending || nativeState?.busy}>{c("Send", "Enviar")}</button>
      </form>
    </section>}</GuidedHelperPortal>}

  </>;
}

export default function AskVTopPane({ children }: { children?: ReactNode }) {
  const voice = useAskVVoiceSession();
  const [open,setOpen] = useState(false);
  useEffect(()=>{const update=(event:Event)=>setOpen(Boolean((event as CustomEvent).detail));window.addEventListener("vndrly-guidance-visible",update);return()=>window.removeEventListener("vndrly-guidance-visible",update);},[]);
  const active = ["connecting", "greeting", "listening", "thinking", "speaking"].includes(voice.state);
  return <div data-testid="askv-pane" className="relative z-40 flex min-h-12 shrink-0 items-center gap-1 border-b border-[var(--brand-primary)] px-2 text-gray-100" style={{ backgroundColor: ASKV_PANE_BG }}>
    <div className="relative flex shrink-0 items-center" data-testid="askv-combined-control">
      <button type="button" className="relative top-[3px] inline-flex items-center justify-center" aria-label={open ? "Close Ask V" : "Open Ask V"} aria-expanded={open} data-testid="assistant-launcher" style={{width: ASKV_LAUNCHER_WIDTH,height: ASKV_LAUNCHER_HEIGHT}} onClick={() => {
        if(open){window.dispatchEvent(new Event("vndrly-guidance-close"));return;}
        selectGuidance("askv");window.dispatchEvent(new Event("vndrly-guidance-askv"));if(!voice.muted)void voice.startConversation("open AskV");
      }}><AskVFloatingLauncherMark engaged={active} panelOpen={open} /></button>
      <div className="-ml-[10.8px]"><AskVStatusIndicator placement="top-strip" /></div>
    </div>
    {active && <button type="button" className="min-h-11 px-2" onClick={() => voice.setMuted(true)}>Stop V</button>}
    <div className="ml-auto flex items-center">{children}</div>
  </div>;
}
