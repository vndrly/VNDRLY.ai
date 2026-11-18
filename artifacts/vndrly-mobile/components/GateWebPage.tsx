import React from "react";
import { useTranslation } from "react-i18next";
import { useEffect, useState, useRef, useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { useGateHeaderActions } from "./gate/GateHeaderActions";
import { getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { Platform, View } from "react-native";
import GateOfflineLog from "./gate/GateOfflineLog";
import { saveOfflineGate } from "@/lib/gate-offline-runtime";
import { createGateAskVBridge } from "@/lib/gate-askv-bridge";

export default function GateWebPage({ path, control }: { control?: "next-steps"; path: "/gate" | "/gate/change-over" | "/gate/map" | "/gate/history" | "/gate/shift-notes" | "/gate/header" | "/personal-agreements" }) {
  const { i18n } = useTranslation();
  const header = useGateHeaderActions();
  const web = useRef<WebView>(null);
  const register = header?.register;
  const setMapFullscreen = header?.setMapFullscreen;
  useEffect(() => () => setMapFullscreen?.(false), [setMapFullscreen, path]);
  const params = useLocalSearchParams<{ section?: string; siteId?: string; stationId?: string; range?: string; recordType?: string; from?: string; to?: string; page?: string; search?: string; staffUserId?: string; equipmentId?: string; reveal?: string }>();
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
  useEffect(() => {
    if (path === "/gate/header" || !register) return;
    return register(() => web.current?.injectJavaScript('window.dispatchEvent(new Event("gate-next-steps-toggle")); true;'));
  }, [register, path, scope]);
  useEffect(() => {
    let active = true;
    if (scope) void getToken().then(token => {
      if (active) setSession(token ? { scope, token } : undefined);
    });
    return () => { active = false; };
  }, [scope]);

  if (!scope || session?.scope !== scope) return null;
  const url = new URL(path, getApiBase());
  url.searchParams.set("gateDashboardEmbed", "1");
  url.searchParams.set("gateLanguage", i18n.language?.startsWith("es") ? "es" : "en");
  if (Platform.OS === "ios") url.searchParams.set("gateDevice", "ios");
  url.searchParams.set("gateVoiceChannel", voiceChannel);
  if (path === "/personal-agreements" && params.section === "eula") url.searchParams.set("section", "eula");
  if (header) url.searchParams.set("gateNativeHeader", "1");
  if (control) url.searchParams.set("control", control);
  if (params.siteId) url.searchParams.set("siteId", params.siteId);
  if (params.stationId) url.searchParams.set("stationId", params.stationId);
  if (path === "/gate/map") for (const key of ["staffUserId", "equipmentId", "reveal"] as const) if (params[key]) url.searchParams.set(key, params[key]!);
  if (path === "/gate/history") {
    if (params.range) url.searchParams.set("range", params.range);
    if (params.recordType) url.searchParams.set("recordType", params.recordType);
    for (const key of ["from", "to", "page", "search"] as const) if (params[key]) url.searchParams.set(key, params[key]!);
  }
  const bootstrap = `if (location.origin === ${JSON.stringify(url.origin)} && location.pathname === ${JSON.stringify(path)}) { window.__gateDashboardSession = ${JSON.stringify(session.token)}; } true;`;
  return <View style={{ flex: 1 }}><WebView ref={web} key={scope} style={{ flex: 1 }}
    onLoadStart={() => voiceBridge.current?.clear()}
    onError={() => { setMapFullscreen?.(false); voiceBridge.current?.clear(); setPageFailed(true); }}
    onHttpError={event => { if (event.nativeEvent.statusCode >= 500) setPageFailed(true); }}
    onLoad={() => setPageFailed(false)}
    onMessage={event => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (path !== "/gate/header" && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path && message.type === "gate-map-fullscreen" && typeof message.expanded === "boolean") setMapFullscreen?.(message.expanded);
        if (message?.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) voiceBridge.current?.receive(message);
        if (path === "/gate" && user && new URL(event.nativeEvent.url).origin === url.origin &&
          new URL(event.nativeEvent.url).pathname === "/gate" && message.type === "gate-offline-context" && message.userId === user.id) {
          void saveOfflineGate(user, message.snapshot).catch(() => setPageFailed(true));
        }
        if (new URL(event.nativeEvent.url).origin === url.origin && message.type === "gate-next-steps-state" && typeof message.enabled === "boolean" && typeof message.open === "boolean" && Number.isFinite(message.count)) header?.update(message);
      } catch { /* Ignore unrelated page messages. */ }
    }} source={{ uri: url.href }} originWhitelist={[url.origin]}
    onShouldStartLoadWithRequest={request => new URL(request.url).origin === url.origin}
    injectedJavaScriptBeforeContentLoaded={bootstrap} />
    {Platform.OS !== "ios" && path === "/gate" && user && <GateOfflineLog key={scope} user={user} pageFailed={pageFailed}
      onRetry={() => { setPageFailed(false); web.current?.reload(); }} />}
  </View>;
}
