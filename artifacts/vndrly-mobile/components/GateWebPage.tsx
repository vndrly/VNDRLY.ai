import { embeddedPageRoute, type EmbeddedPagePath } from "@/lib/embedded-page-route";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import { setWebOverlayOwner } from "@/lib/overlay-owner";
import { pageBack } from "@/lib/page-back";
import { registerAskVControl, subscribeAskVGateCreateDraft, type AskVGateCreateDraftResult } from "@/lib/askv-client-tools";
import React from "react";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { router, useFocusEffect, useLocalSearchParams, usePathname } from "expo-router";
import { WebView } from "react-native-webview";
import { useGateHeaderActions, type HeaderState } from "./gate/GateHeaderActions";
import { getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { Platform, View } from "react-native";
import GateOfflineLog from "./gate/GateOfflineLog";
import { saveOfflineGate } from "@/lib/gate-offline-runtime";
import { createGateAskVBridge } from "@/lib/gate-askv-bridge";

export default function GateWebPage({ path, control }: { control?: "next-steps"; path: EmbeddedPagePath }) {
  const { i18n } = useTranslation();
  const nativePage = usePathname();
  const iosGateEntry = Platform.OS === "ios" && path === "/gate";
  const entryBackground = iosGateEntry ? { backgroundColor: "#3a3d42" } : undefined;
  const header = useGateHeaderActions();
  const web = useRef<WebView>(null);
  const companion = useAskVVoiceSession();
  const companionSending = useRef(false);
  const register = header?.register;
  const updateHeader = header?.update;
  const focused = useRef(false);
  const gateMapFocused = useRef(false);
  const gateMapLoaded = useRef(false);
  const gateDraftPending = useRef(new Map<string, (result: AskVGateCreateDraftResult) => void>());
  const [gateMapFocusTargets, setGateMapFocusTargets] = useState<string[]>([]);

  const lastHeader = useRef<{ scope: string; state: HeaderState }>(undefined);
  useEffect(() => () => setWebOverlayOwner(path, false), [path]);
  const setMapFullscreen = header?.setMapFullscreen;
  useEffect(() => () => setMapFullscreen?.(false), [setMapFullscreen, path]);
  const params = useLocalSearchParams<{ section?: string; siteId?: string; stationId?: string; handoffId?: string; range?: string; recordType?: string }>();
  const { user, activeMembershipId } = useAuth();
  const [session, setSession] = useState<{ scope: string; token: string }>();
  const [pageFailed, setPageFailed] = useState(false);
  const scope = user ? JSON.stringify([user.id, activeMembershipId]) : "";
  const voiceChannel = useMemo(() => `${Date.now()}:${Math.random()}`, [scope, path]);
  const voiceBridge = useRef<ReturnType<typeof createGateAskVBridge> | null>(null);
  useEffect(() => {
    if (!path.startsWith("/gate") || !user) return;
    const bridge = createGateAskVBridge(user.id, message => web.current?.injectJavaScript(
      `if (location.origin === ${JSON.stringify(new URL(getApiBase()).origin)} && location.pathname === ${JSON.stringify(path)}) window.dispatchEvent(new CustomEvent("gate-askv-command", {detail:${JSON.stringify(message)}})); true;`,
    ));
    voiceBridge.current = bridge;
    return () => { bridge.dispose(); voiceBridge.current = null; };
  }, [path, scope, voiceChannel]);
  useFocusEffect(useCallback(() => {
    if (path === "/gate/header" || !register) return;
    focused.current = true;
    if (lastHeader.current?.scope === scope) updateHeader?.({ ...lastHeader.current.state, open: false });
    const unregister = register(mode => web.current?.injectJavaScript(mode === 'askv' ? 'window.dispatchEvent(new Event("gate-companion-open")); true;' : 'window.dispatchEvent(new Event("gate-next-steps-toggle")); true;'));
    return () => {
      focused.current = false;
      web.current?.injectJavaScript('window.dispatchEvent(new Event("gate-next-steps-close")); true;');
      unregister();
    };
  }, [register, updateHeader, path, scope]));
  useFocusEffect(useCallback(() => {
    if (path !== "/gate/map") return;
    gateMapFocused.current = true;
    return () => { gateMapFocused.current = false; };
  }, [path]));
  useEffect(() => {
    if (path !== "/gate/map" || Platform.OS !== "ios") return;
    const remove = gateMapFocusTargets.map(id => registerAskVControl("/gate/map", id, () => {
      if (!gateMapFocused.current || !web.current) return false;
      web.current.injectJavaScript(`(() => { const field = document.querySelector('[data-guidance-id=${JSON.stringify(id)}]'); if (!field || field.disabled) return; field.scrollIntoView({block:'center'}); field.focus(); })(); true;`);
      return true;
    }));
    return () => remove.forEach(unregister => unregister());
  }, [gateMapFocusTargets, path]);
  useEffect(() => {
    if (path !== "/gate/map" || Platform.OS !== "ios") return;
    const unsubscribe = subscribeAskVGateCreateDraft(async draft => {
      const deadline = Date.now() + 10_000;
      while (!gateMapLoaded.current && Date.now() < deadline && gateMapFocused.current) await new Promise(resolve => setTimeout(resolve, 50));
      if (!gateMapLoaded.current || !gateMapFocused.current || !web.current) return { requestId: draft.requestId, ok: false, reason: "Gate Map is not ready." };
      return new Promise<AskVGateCreateDraftResult>(resolve => {
        const timer = setTimeout(() => {
          gateDraftPending.current.delete(draft.requestId);
          resolve({ requestId: draft.requestId, ok: false, reason: "Gate creation form did not respond. Nothing was saved." });
        }, 8_500);
        gateDraftPending.current.set(draft.requestId, result => { clearTimeout(timer); resolve(result); });
        web.current?.injectJavaScript(`(() => {
          if (location.origin !== ${JSON.stringify(new URL(getApiBase()).origin)} || location.pathname !== '/gate/map') return;
          const draft = ${JSON.stringify(draft)};
          const channel = ${JSON.stringify(voiceChannel)};
          let attempts = 0;
          const reply = event => {
            const result = event.detail;
            if (result?.requestId !== draft.requestId) return;
            if (!result.ok && result.reason === 'The authorized create form is not ready.' && attempts < 35) return;
            clearInterval(retry);
            window.removeEventListener('askv:gate-create-draft-result', reply);
            window.ReactNativeWebView?.postMessage(JSON.stringify({type:'gate-native-create-draft-result',channel,result}));
          };
          window.addEventListener('askv:gate-create-draft-result', reply);
          const send = () => { attempts++; window.dispatchEvent(new CustomEvent('askv:gate-create-draft',{detail:draft})); if (attempts >= 40) { clearInterval(retry); window.removeEventListener('askv:gate-create-draft-result', reply); } };
          const retry = setInterval(send, 200);
          send();
        })(); true;`);
      });
    });
    return () => {
      unsubscribe();
      for (const [requestId, resolve] of gateDraftPending.current) resolve({ requestId, ok: false, reason: "Gate Map closed. Nothing was saved." });
      gateDraftPending.current.clear();
    };
  }, [path, voiceChannel]);
  useEffect(() => {
    let active = true;
    if (scope) void getToken().then(token => {
      if (active) setSession(token ? { scope, token } : undefined);
    });
    return () => { active = false; };
  }, [scope]);

  const companionMessage = [...companion.assistant.messages].reverse().find(message => message.role === "assistant");
  const confirmationReference = companion.assistant.messages.at(-1) === companionMessage && !companionMessage?.pending ? companionMessage?.confirmationReference : undefined;
  const companionState = JSON.stringify({message:companionMessage?.content, confirmationReference, busy:companion.assistant.streaming, error:companion.error});
  useEffect(() => { web.current?.injectJavaScript('window.dispatchEvent(new CustomEvent("gate-companion-state",{detail:' + companionState + '})); true;'); }, [companionState, path, session]);

  if (!scope || session?.scope !== scope) return null;
  const url = new URL(path, getApiBase());
  url.searchParams.set("gateDashboardEmbed", "1");
  if (path.startsWith("/work-hub")) Object.entries(params).forEach(([key, value]) => { if (key !== "module" && !key.startsWith("gate") && typeof value === "string") url.searchParams.set(key, value); });
  url.searchParams.set("gateBackBridge", "1");
  url.searchParams.set("gateLanguage", i18n.language?.startsWith("es") ? "es" : "en");
  if (Platform.OS === "ios") url.searchParams.set("gateDevice", "ios");
  url.searchParams.set("gateVoiceChannel", voiceChannel);
  if (path === "/personal-agreements" && params.section === "eula") url.searchParams.set("section", "eula");
  if (header) url.searchParams.set("gateNativeHeader", "1");
  if (control) url.searchParams.set("control", control);
  if (control === "next-steps") url.searchParams.set("helpPage", nativePage);
  if (params.siteId) url.searchParams.set("siteId", params.siteId);
  if (params.stationId) url.searchParams.set("stationId", params.stationId);
  if (path === "/gate/shift-notes" && params.handoffId) url.searchParams.set("handoffId", params.handoffId);
  if (path === "/gate/history") {
    if (params.range) url.searchParams.set("range", params.range);
    if (params.recordType) url.searchParams.set("recordType", params.recordType);
  }
  const gateMapFocusBridge = `(() => {
    if (window.__gateMapFocusBridgeCleanup) window.__gateMapFocusBridgeCleanup();
    const ids = ["gate-site","choose-gate","gate-name","location-method","gate-latitude","gate-longitude","gate-address","save-gate","remove-gate","confirm-remove"];
    let last = "";
    const report = () => {
      const targets = ids.filter(id => { const field = document.querySelector('[data-guidance-id="' + id + '"]'); return field && !field.disabled && field.getClientRects().length > 0; });
      const message = JSON.stringify({type:"gate-native-focus-targets",channel:${JSON.stringify(voiceChannel)},targets});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","disabled","open","data-guidance-id"]});
    const timer = setInterval(report,500);
    window.__gateMapFocusBridgeCleanup = () => {observer.disconnect();clearInterval(timer);};
    report();
  })(); true;`;
  const bootstrap = `if (location.origin === ${JSON.stringify(url.origin)} && location.pathname === ${JSON.stringify(path)}) { window.__gateDashboardSession = ${JSON.stringify(session.token)}; } true;`;
  return <View style={[{ flex: 1 }, entryBackground]}><WebView ref={web} key={scope} style={[{ flex: 1 }, entryBackground]}
    hideKeyboardAccessoryView={iosGateEntry}
    onLoadStart={() => { gateMapLoaded.current = false; setWebOverlayOwner(path, false); voiceBridge.current?.clear(); }}
    onError={() => { setMapFullscreen?.(false); voiceBridge.current?.clear(); setPageFailed(true); setWebOverlayOwner(path, false); }}
    onHttpError={event => { if (event.nativeEvent.statusCode >= 500) setPageFailed(true); }}
    onLoad={() => { gateMapLoaded.current = true; if (Platform.OS === "ios" && path === "/gate/map") web.current?.injectJavaScript(gateMapFocusBridge); setPageFailed(false); web.current?.injectJavaScript('window.dispatchEvent(new CustomEvent("gate-companion-state",{detail:' + companionState + '})); true;'); }}
    onMessage={event => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (message.type === "workspace-navigate" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin) { const route = embeddedPageRoute(message.href); if (route) router.push(route as never); return; }
        if (message.type === "gate-native-create-draft-result" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const result = message.result as AskVGateCreateDraftResult;
          if (!result || typeof result.requestId !== "string" || typeof result.ok !== "boolean" || result.reason !== undefined && typeof result.reason !== "string" || result.state !== undefined && (!result.state || typeof result.state.mode !== "string" || !Array.isArray(result.state.missing) || !result.state.missing.every((item: unknown) => typeof item === "string") || typeof result.state.readyToReview !== "boolean")) return;
          const resolve = gateDraftPending.current.get(result.requestId);
          if (resolve) { gateDraftPending.current.delete(result.requestId); resolve(result); }
          return;
        }
        if (message.type === "gate-native-focus-targets" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (!Array.isArray(message.targets) || !message.targets.every((id: unknown) => typeof id === "string" && ["gate-site","choose-gate","gate-name","location-method","gate-latitude","gate-longitude","gate-address","save-gate","remove-gate","confirm-remove"].includes(id))) return;
          setGateMapFocusTargets(message.targets);
          return;
        }
        if (message.type === "gate-focus-start" && message.channel === voiceChannel && path === "/gate" && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (!companion.muted) void companion.startConversation();
          return;
        }
        if (message.type === "gate-companion-send" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (typeof message.id !== "string") return;
          const reject = (error:string) => web.current?.injectJavaScript('window.dispatchEvent(new CustomEvent("gate-companion-result",{detail:' + JSON.stringify({id:message.id,ok:false,error}) + '})); true;');
          if (companion.assistant.streaming || companionSending.current) { reject("AskV is still responding. Try again shortly."); return; }
          const text = typeof message.text === "string" && message.text.trim() && message.text.length <= 20000 ? message.text : null;
          const reference = typeof message.confirmationReference === "string" && message.confirmationReference === confirmationReference ? confirmationReference : undefined;
          if (!text && !reference) { reject("This request has changed. Review the current request before confirming."); return; }
          companionSending.current = true;
          void (async () => {
            let result: {id:string;ok:boolean;error?:string};
            try { await companion.assistant.send(reference ? "Confirmed" : text!, "ios_text", reference); result={id:message.id,ok:true}; }
            catch(error) { result={id:message.id,ok:false,error:error instanceof Error ? error.message : "Could not send. Try again."}; }
            finally { companionSending.current=false; }
            web.current?.injectJavaScript('window.dispatchEvent(new CustomEvent("gate-companion-result",{detail:' + JSON.stringify(result) + '})); true;');
          })();
          return;
        }
        if (message.type === "gate-overlay-state" && message.channel === voiceChannel && typeof message.open === "boolean" && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) { setWebOverlayOwner(path, message.open); return; }
        if (path !== "/gate/header" && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path && message.type === "gate-page-back" && message.channel === voiceChannel) { pageBack(); return; }
        if (path !== "/gate/header" && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path && message.type === "gate-map-fullscreen" && typeof message.expanded === "boolean") setMapFullscreen?.(message.expanded);
        if (message?.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) voiceBridge.current?.receive(message);
        if (path === "/gate" && user && new URL(event.nativeEvent.url).origin === url.origin &&
          new URL(event.nativeEvent.url).pathname === "/gate" && message.type === "gate-offline-context" && message.userId === user.id) {
          void saveOfflineGate(user, message.snapshot).catch(() => setPageFailed(true));
        }
        if (message.type === "gate-next-steps-state" && typeof message.enabled === "boolean" && typeof message.open === "boolean" && Number.isFinite(message.count)) {
          const source = new URL(event.nativeEvent.url);
          if (source.origin !== url.origin || (message.channel ? message.channel !== voiceChannel : source.pathname !== path)) return;
          lastHeader.current = { scope, state: message };
          if (focused.current) updateHeader?.(message);
        }
      } catch { /* Ignore unrelated page messages. */ }
    }} source={{ uri: url.href }} originWhitelist={[url.origin]}
    onShouldStartLoadWithRequest={request => new URL(request.url).origin === url.origin}
    injectedJavaScriptBeforeContentLoaded={bootstrap} />
    {Platform.OS !== "ios" && path === "/gate" && user && <GateOfflineLog key={scope} user={user} pageFailed={pageFailed}
      onRetry={() => { setPageFailed(false); web.current?.reload(); }} />}
  </View>;
}
