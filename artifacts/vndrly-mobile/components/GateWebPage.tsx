import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import { setWebOverlayOwner } from "@/lib/overlay-owner";
import { pageBack } from "@/lib/page-back";
import React from "react";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useFocusEffect, useLocalSearchParams, usePathname } from "expo-router";
import { WebView } from "react-native-webview";
import { useGateHeaderActions, type HeaderState } from "./gate/GateHeaderActions";
import { getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { Platform, View } from "react-native";
import GateOfflineLog from "./gate/GateOfflineLog";
import { saveOfflineGate } from "@/lib/gate-offline-runtime";
import { createGateAskVBridge } from "@/lib/gate-askv-bridge";

export default function GateWebPage({ path, control }: { control?: "next-steps"; path: "/gate" | "/gate/change-over" | "/gate/map" | "/gate/history" | "/gate/shift-notes" | "/gate/header" | "/personal-agreements" | "/admin/billing-payroll" | "/admin/import-export" }) {
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
  const lastHeader = useRef<{ scope: string; state: HeaderState }>(undefined);
  useEffect(() => () => setWebOverlayOwner(path, false), [path]);
  const setMapFullscreen = header?.setMapFullscreen;
  useEffect(() => () => setMapFullscreen?.(false), [setMapFullscreen, path]);
  const params = useLocalSearchParams<{ section?: string; siteId?: string; stationId?: string; range?: string; recordType?: string }>();
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
  if (path === "/gate/history") {
    if (params.range) url.searchParams.set("range", params.range);
    if (params.recordType) url.searchParams.set("recordType", params.recordType);
  }
  const bootstrap = `if (location.origin === ${JSON.stringify(url.origin)} && location.pathname === ${JSON.stringify(path)}) { window.__gateDashboardSession = ${JSON.stringify(session.token)}; } true;`;
  return <View style={[{ flex: 1 }, entryBackground]}><WebView ref={web} key={scope} style={[{ flex: 1 }, entryBackground]}
    hideKeyboardAccessoryView={iosGateEntry}
    onLoadStart={() => { setWebOverlayOwner(path, false); voiceBridge.current?.clear(); }}
    onError={() => { setMapFullscreen?.(false); voiceBridge.current?.clear(); setPageFailed(true); setWebOverlayOwner(path, false); }}
    onHttpError={event => { if (event.nativeEvent.statusCode >= 500) setPageFailed(true); }}
    onLoad={() => { setPageFailed(false); web.current?.injectJavaScript('window.dispatchEvent(new CustomEvent("gate-companion-state",{detail:' + companionState + '})); true;'); }}
    onMessage={event => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
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
