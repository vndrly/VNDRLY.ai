import { embeddedPageRoute, type EmbeddedPagePath } from "@/lib/embedded-page-route";
import { setWebOverlayOwner } from "@/lib/overlay-owner";
import { pageBack } from "@/lib/page-back";
import React from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams, usePathname } from "expo-router";
import { useGateHeaderActions, type HeaderState } from "./gate/GateHeaderActions";
import { getApiBase } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import GateOfflineLog from "./gate/GateOfflineLog";
import { iosPageLayout } from "@/lib/ios-page-layout";
import { saveOfflineGate } from "@/lib/gate-offline-runtime";
import { createGateAskVBridge } from "@/lib/gate-askv-bridge";

export default function GateWebPage({ path, control }: { control?: "next-steps"; path: EmbeddedPagePath }) {
  const { i18n } = useTranslation();
  const nativePage = usePathname();
  const language = i18n.language?.startsWith("es") ? "es" : "en";
  const header = useGateHeaderActions();
  const register = header?.register;
  const setMapFullscreen = header?.setMapFullscreen;
  useEffect(() => () => setMapFullscreen?.(false), [setMapFullscreen, path]);
  const update = header?.update;
  const focused = useRef(false);
  const lastHeader = useRef<{ scope: string; state: HeaderState }>(undefined);
  const params = useLocalSearchParams<{ section?: string; siteId?: string; stationId?: string; handoffId?: string; range?: string; recordType?: string }>();
  const { user, activeMembershipId } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => () => setWebOverlayOwner(path, false), [path]);
  const api = new URL(getApiBase());
  const origin = api.hostname === "localhost" ? "http://localhost:5173" : api.origin;
  const scope = JSON.stringify([user?.id, activeMembershipId]);
  const voiceChannel = useMemo(() => `${Date.now()}:${Math.random()}`, [scope, path]);
  const voiceBridge = useRef<ReturnType<typeof createGateAskVBridge> | null>(null);
  useEffect(() => {
    if (!path.startsWith("/gate") || !user) return;
    const bridge = createGateAskVBridge(user.id, message => frame.current?.contentWindow?.postMessage(message, origin));
    voiceBridge.current = bridge;
    return () => { bridge.dispose(); voiceBridge.current = null; };
  }, [path, scope, origin, voiceChannel]);
  useFocusEffect(useCallback(() => {
    if (path === "/gate/header" || !register) return;
    focused.current = true;
    if (lastHeader.current?.scope === scope) update?.({ ...lastHeader.current.state, open: false });
    const unregister = register(mode => frame.current?.contentWindow?.postMessage({ type: mode === "askv" ? "gate-companion-open" : "gate-next-steps-toggle" }, origin));
    return () => {
      focused.current = false;
      frame.current?.contentWindow?.postMessage({ type: "gate-next-steps-close" }, origin);
      unregister();
    };
  }, [register, update, path, origin, scope]));
  const url = useMemo(() => {
    const dashboard = new URL(path, origin);
    dashboard.searchParams.set("gateDashboardEmbed", "1");
    if (path.startsWith("/work-hub")) Object.entries(params).forEach(([key, value]) => { if (key !== "module" && !key.startsWith("gate") && typeof value === "string") dashboard.searchParams.set(key, value); });
    dashboard.searchParams.set("gateBackBridge", "1");
    dashboard.searchParams.set("gateLanguage", language);
    // This surface is the local iOS preview.
    if (api.hostname === "localhost") dashboard.searchParams.set("gateDevice", "ios");
    dashboard.searchParams.set("gateVoiceChannel", voiceChannel);
    if (path === "/personal-agreements" && params.section === "eula") dashboard.searchParams.set("section", "eula");
    if (register) dashboard.searchParams.set("gateNativeHeader", "1");
    if (control) dashboard.searchParams.set("control", control);
  if (control === "next-steps") dashboard.searchParams.set("helpPage", nativePage);
    const current = new URL(window.location.href);
    const previous = path === "/gate/change-over" && current.searchParams.get("gateScope") === scope ? current.searchParams : null;
    const siteId = params.siteId ?? previous?.get("gateSite");
    const stationId = params.stationId ?? previous?.get("gateStation");
    if (siteId) dashboard.searchParams.set("siteId", siteId);
    if (stationId) dashboard.searchParams.set("stationId", stationId);
    if (path === "/gate/shift-notes" && params.handoffId) dashboard.searchParams.set("handoffId", params.handoffId);
    if (path === "/gate/history") {
      if (params.range) dashboard.searchParams.set("range", params.range);
      if (params.recordType) dashboard.searchParams.set("recordType", params.recordType);
    }
    return dashboard.href;
  }, [origin, path, control, nativePage, register, scope, voiceChannel, language, params.section, params.siteId, params.stationId, params.range, params.recordType, JSON.stringify(params)]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const reply = async (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "workspace-navigate" && event.data.channel === voiceChannel) { const route = embeddedPageRoute(event.data.href); if (route) router.push(route as never); return; }
      if (event.data?.type === "gate-overlay-state" && event.data.channel === voiceChannel && typeof event.data.open === "boolean") { setWebOverlayOwner(path,event.data.open); return; }
      if (path !== "/gate/header" && event.data?.type === "gate-page-back" && event.data.channel === voiceChannel) { pageBack(); return; }
      if (path !== "/gate/header" && event.data?.type === "gate-map-fullscreen" && typeof event.data.expanded === "boolean") setMapFullscreen?.(event.data.expanded);
      if (event.data?.channel === voiceChannel) voiceBridge.current?.receive(event.data);
      if (path === "/gate" && event.data?.type === "gate-offline-context" && event.data.userId === user.id) {
        await saveOfflineGate(user, event.data.snapshot).catch(() => undefined);
        return;
      }
      if (event.data?.type === "gate-next-steps-state" && typeof event.data.enabled === "boolean" && typeof event.data.open === "boolean" && Number.isFinite(event.data.count)) {
        if (event.data.channel && event.data.channel !== voiceChannel) return;
        lastHeader.current = { scope, state: event.data };
        if (focused.current) update?.(event.data);
        return;
      }
      if (path === "/gate/header" && event.data?.type === "gate-header-expanded") {
        setExpanded(event.data.expanded === true);
        return;
      }
      if (event.data?.type === "gate-dashboard-selection") {
        if (typeof event.data.siteId !== "string" || !/^\d*$/.test(event.data.siteId) || typeof event.data.stationId !== "string") return;
        const current = new URL(window.location.href);
        current.searchParams.set("gateScope", scope);
        current.searchParams.set("gateSite", event.data.siteId);
        current.searchParams.set("gateStation", event.data.stationId);
        window.history.replaceState(window.history.state, "", current);
        return;
      }
      if (event.data?.type !== "gate-dashboard-ready") return;
      const token = await getToken();
      if (active && token) frame.current?.contentWindow?.postMessage({ type: "gate-dashboard-session", token }, origin);
    };
    window.addEventListener("message", reply);
    return () => {
      active = false;
      window.removeEventListener("message", reply);
    };
  }, [origin, path, user, scope, update, voiceChannel, setMapFullscreen]);

  const anchor = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<{ top: number; left: number; width: number; right: number }>();
  useEffect(() => {
    if (path !== "/gate/header" || !anchor.current) return;
    const measure = () => { const r = anchor.current?.getBoundingClientRect(); if (r) setBounds({ top: r.top, left: r.left, width: r.width, right: Math.max(0, window.innerWidth - r.right) }); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("scroll", measure, true);
    return () => { observer.disconnect(); window.removeEventListener("scroll", measure, true); };
  }, [path, scope]);
  if (!user) return null;
  const iframe = <iframe key={JSON.stringify([user.id, activeMembershipId])} ref={frame} title={path.startsWith("/work-hub") ? "Work Hub" : path === "/gate/header" ? (control ? "Next Steps" : "Notifications") : path === "/gate/shift-notes" ? "Shift Notes" : path === "/gate/history" ? "Gate Log" : path === "/gate/map" ? "Gate Map" : path === "/gate" ? "Gate check-in" : path === "/admin/billing-payroll" ? "Billing & Payroll" : "Gate Dashboard"} src={url} style={expanded ? { position: "fixed", top: bounds?.top ?? 0, left: 0, right: bounds?.right ?? 0, bottom: 0, width: `calc(100% - ${bounds?.right ?? 0}px)`, height: `calc(100% - ${bounds?.top ?? 0}px)`, border: 0, zIndex: 2147483647 } : path === "/gate/header" ? { position: "fixed", top: bounds?.top, left: bounds?.left, width: bounds?.width, height: 44, border: 0, zIndex: 1000 } : { width: "100%", flex: 1, border: 0 }} />;
  return path === "/gate/header" ? <><div ref={anchor} style={{ width: "100%", height: 44 }} />{bounds && createPortal(iframe, document.body)}</> : <>{iframe}{!iosPageLayout && path === "/gate" && <GateOfflineLog key={scope} user={user} pageFailed={false} onRetry={() => { if (frame.current) frame.current.src = url; }} />}</>;
}
