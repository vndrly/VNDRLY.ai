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
import { readMapboxAccessToken } from "@/lib/maps";
import { getToken } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { Platform, Pressable, Text, View } from "react-native";
import GateOfflineLog from "./gate/GateOfflineLog";
import { saveOfflineGate } from "@/lib/gate-offline-runtime";
import { createGateAskVBridge } from "@/lib/gate-askv-bridge";
import GateDashboardAdministratorCard from "./gate/GateDashboardAdministratorCard";
import GateDashboardAdminDialogNative, { type AdminDialog } from "./gate/GateDashboardAdminDialogNative";
import GateIncidentReportNative, { type GateIncidentReportData } from "./gate/GateIncidentReportNative";
import GateEntryHeaderNative from "./gate/GateEntryHeaderNative";
import GateDashboardAssumeWatchNative, { type GateDashboardAssumeWatchData } from "./gate/GateDashboardAssumeWatchNative";
import GateDashboardWorkdayCard from "./gate/GateDashboardWorkdayCard";
import GateDashboardStatusNative, { type GateDashboardStatus } from "./gate/GateDashboardStatusNative";
import GateDashboardActivityCard from "./gate/GateDashboardActivityCard";
import GateMapActivityNative from "./gate/GateMapActivityNative";
import GateDashboardOnSiteCard from "./gate/GateDashboardOnSiteCard";
import HomeDashboardTasks from "./work-hub/HomeDashboardTasks";
import GateDashboardWatchCard from "./gate/GateDashboardWatchCard";
import GateDashboardHandoffNative, { GateDashboardHandoffPending } from "./gate/GateDashboardHandoffNative";
import GateDashboardSupervisorCard from "./gate/GateDashboardSupervisorCard";
import GateMapStaffLocationsCard, { type MapStaffGroup } from "./gate/GateMapStaffLocationsCard";
import GateMapSitePresenceCard from "./gate/GateMapSitePresenceCard";
import GateShiftNoteNativeCard from "./gate/GateShiftNoteNativeCard";
import GateShiftAuditNativeCard, { type ShiftAuditAction } from "./gate/GateShiftAuditNativeCard";
import GateDashboardHeaderNative from "./gate/GateDashboardHeaderNative";
import GateMapConfirmedLocationsCard, { type GateConfirmedVisit } from "./gate/GateMapConfirmedLocationsCard";
import GateMapTimeNative from "./gate/GateMapTimeNative";
import GateLogRecordNative, { type GateLogRecord } from "./gate/GateLogRecordNative";
import GateLogArrivalNative, { type GateLogArrival } from "./gate/GateLogArrivalNative";
import GateLogFilterNative, { type GateLogView } from "./gate/GateLogFilterNative";
import GateLogQueryNative, { type GateLogQuery } from "./gate/GateLogQueryNative";
import GateSiteGateSelect from "./GateSiteGateSelect";
import GateLogHeaderNative from "./gate/GateLogHeaderNative";
import GateLogExportNative, { type GateLogExportFilters } from "./gate/GateLogExportNative";
import GateLogPagesNative, { type GateLogPages } from "./gate/GateLogPagesNative";
import GateLogRecordDetailsNative from "./gate/GateLogRecordDetailsNative";
import GateLogArrivalDetailsNative from "./gate/GateLogArrivalDetailsNative";
import GateLogCardHeadingNative from "./gate/GateLogCardHeadingNative";
import GateLogStatusNative, { type GateLogStatus } from "./gate/GateLogStatusNative";
import GateLogMovementsNative from "./gate/GateLogMovementsNative";
import GateMapHeaderNative from "./gate/GateMapHeaderNative";
import GateMapPageHeaderNative from "./gate/GateMapPageHeaderNative";
import GateMapStatusNative, { type GateMapStatus } from "./gate/GateMapStatusNative";
import GateMapPinFlyoutNative, { type GateMapPinForm } from "./gate/GateMapPinFlyoutNative";
import GateMapGateFlyoutNative from "./gate/GateMapGateFlyoutNative";
import GateMapActivityPopupNative, { type GateMapActivityPopupData } from "./gate/GateMapActivityPopupNative";
import GateMapAdministrationNative, { type GateAdminCard } from "./gate/GateMapAdministrationNative";
import GateMapCanvasNative, { type GateMapCanvas } from "./gate/GateMapCanvasNative";
import GateEntryNativeCard, { type GateEntryCard } from "./gate/GateEntryNativeCard";
import GatePresenceNativeCard, { type GatePresenceCard } from "./gate/GatePresenceNativeCard";
import GateEntryWorkdayCard, { type GateEntryWorkdayData } from "./gate/GateEntryWorkdayCard";
import GateLiveFlashNative, { type GateLiveFlashData } from "./gate/GateLiveFlashNative";
import GateShiftNotesListNative, { type GateShiftNotesGate } from "./gate/GateShiftNotesListNative";
import type { ChangeOverSnapshot, ChangeOverState, ShiftNote } from "@workspace/gate-booth";

type AdminCardBounds = { top: number; left: number; width: number; height: number; stationId: string; active: boolean; gateGoDemo: boolean };
type WorkdayCardBounds = { top: number; left: number; width: number; height: number; siteId: number; stationId: string; gateName: string; active: boolean };
type ActivityCardBounds = { top: number; left: number; width: number; height: number; active: boolean };
type ActivityCardData = { snapshot: ChangeOverSnapshot | null; historyBaseHref: string; activityWindow?: "24h"; scopeLabel?: string };
type ShiftNoteOverlay = ActivityCardBounds & { id: string; note: ShiftNote };
type GateLogRecordOverlay = ActivityCardBounds & { id: string; record: GateLogRecord };
type GateLogArrivalOverlay = ActivityCardBounds & { id: string; arrival: GateLogArrival };
type GateMapPageHeaderOverlay = ActivityCardBounds & { expanded: boolean; title: string; backLabel: string; fallbackHref: string };
type GateMapStatusOverlay = ActivityCardBounds & { status: GateMapStatus };

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
  const [adminCard, setAdminCard] = useState<AdminCardBounds | null>(null);
  const [adminDialog, setAdminDialog] = useState<AdminDialog | null>(null);
  const [incidentReport, setIncidentReport] = useState<GateIncidentReportData | null>(null);
  const [entryHeader, setEntryHeader] = useState<{ top: number; left: number; width: number; height: number; active: boolean; title: string; backLabel: string; statuses: string[] } | null>(null);
  const [shiftNotesPageHeader, setShiftNotesPageHeader] = useState<{ top: number; left: number; width: number; height: number; active: boolean; title: string; subtitle?: string; backLabel: string; fallbackHref: string } | null>(null);
  const [shiftNotesAllLink, setShiftNotesAllLink] = useState<(ActivityCardBounds & { label: string; href: string }) | null>(null);
  const [assumeWatch, setAssumeWatch] = useState<GateDashboardAssumeWatchData | null>(null);
  const [incidentConfirmation, setIncidentConfirmation] = useState<{ title: string; description: string } | null>(null);
  useEffect(() => { if (!incidentConfirmation) return; const timer = setTimeout(() => setIncidentConfirmation(null), 5000); return () => clearTimeout(timer); }, [incidentConfirmation]);
  const [workdayCard, setWorkdayCard] = useState<WorkdayCardBounds | null>(null);
  const [dashboardStatuses, setDashboardStatuses] = useState<(ActivityCardBounds & { status: GateDashboardStatus })[]>([]);
  const [linkedNoteStatuses, setLinkedNoteStatuses] = useState<(ActivityCardBounds & { status: GateDashboardStatus })[]>([]);
  const [activityCard, setActivityCard] = useState<ActivityCardBounds | null>(null);
  const [activityData, setActivityData] = useState<ActivityCardData | null>(null);
  const [onSiteCard, setOnSiteCard] = useState<(ActivityCardBounds & { allGates: boolean }) | null>(null);
  const [tasksCard, setTasksCard] = useState<ActivityCardBounds | null>(null);
  const [watchCard, setWatchCard] = useState<ActivityCardBounds | null>(null);
  const [watchData, setWatchData] = useState<{ stationId: string; current: ChangeOverState | null; phase: "ready" | "pending" | "error" } | null>(null);
  const [handoffCard, setHandoffCard] = useState<ActivityCardBounds | null>(null);
  const [handoffData, setHandoffData] = useState<{ stationId: string; current: ChangeOverState | null; phase: "ready" | "pending" | "error"; gatekeeperOnDuty: boolean; online: boolean; readError: boolean; pendingWatch: boolean } | null>(null);
  const [supervisorCard, setSupervisorCard] = useState<ActivityCardBounds | null>(null);
  const [supervisorData, setSupervisorData] = useState<{ stationId: string; current: ChangeOverState } | null>(null);
  const [mapStaffCard, setMapStaffCard] = useState<ActivityCardBounds | null>(null);
  const [mapHeaderCard, setMapHeaderCard] = useState<(ActivityCardBounds & { sites: { id: number; name: string }[]; siteId: number; gateId: string; gateName: string; showTitle: boolean; showSelector: boolean }) | null>(null);
  const [mapPageHeaders, setMapPageHeaders] = useState<GateMapPageHeaderOverlay[]>([]);
  const [mapStatuses, setMapStatuses] = useState<GateMapStatusOverlay[]>([]);
  const [mapPinForm, setMapPinForm] = useState<GateMapPinForm | null>(null);
  const [mapGateForm, setMapGateForm] = useState<AdminDialog | null>(null);
  const [mapActivityPopup, setMapActivityPopup] = useState<(ActivityCardBounds & { data: GateMapActivityPopupData }) | null>(null);
  const [mapAdminCard, setMapAdminCard] = useState<(ActivityCardBounds & { data: GateAdminCard }) | null>(null);
  const [mapCanvasCard, setMapCanvasCard] = useState<(ActivityCardBounds & { data: GateMapCanvas }) | null>(null);
  const [gateEntryCard, setGateEntryCard] = useState<(ActivityCardBounds & { data: GateEntryCard }) | null>(null);
  const [gatePresenceCard, setGatePresenceCard] = useState<GatePresenceCard | null>(null);
  const [gateEntryWorkday, setGateEntryWorkday] = useState<(ActivityCardBounds & { data: GateEntryWorkdayData }) | null>(null);
  const [gateLiveFlash, setGateLiveFlash] = useState<(ActivityCardBounds & { data: GateLiveFlashData }) | null>(null);
  const [mapStaffData, setMapStaffData] = useState<{ groups: MapStaffGroup[]; locationError: string; sort: "name" | "nearest" | "first" | "latest" } | null>(null);
  const [mapActivityCard, setMapActivityCard] = useState<ActivityCardBounds | null>(null);
  const [mapActivityData, setMapActivityData] = useState<ActivityCardData & { recordHistoryHrefs: Record<string, string>; showAllLogLink: boolean; mode: "metrics" | "fallback"; status: string; statusTone: "normal" | "error" } | null>(null);
  const [mapPresenceCard, setMapPresenceCard] = useState<ActivityCardBounds | null>(null);
  const [mapPresenceData, setMapPresenceData] = useState<{ snapshot: ChangeOverSnapshot | null; loading: boolean; sites: { siteId: number; siteName: string }[]; recordHistoryHrefs: Record<string, string>; historyBaseHref: string } | null>(null);
  const [shiftNoteCards, setShiftNoteCards] = useState<ShiftNoteOverlay[]>([]);
  const [shiftNotesHeader, setShiftNotesHeader] = useState<(ActivityCardBounds & { sites: { id: number; name: string }[]; gates: GateShiftNotesGate[]; siteId: number; gateId: string; gateName: string; filters: GateLogExportFilters | null; search: string; loading: boolean; error: boolean }) | null>(null);
  const [shiftAuditCard, setShiftAuditCard] = useState<(ActivityCardBounds & { actions: ShiftAuditAction[] }) | null>(null);
  const [dashboardHeader, setDashboardHeader] = useState<(ActivityCardBounds & { title: string; subtitle: string }) | null>(null);
  const [confirmedLocations, setConfirmedLocations] = useState<(ActivityCardBounds & { visits: GateConfirmedVisit[] }) | null>(null);
  const [mapTimeControl, setMapTimeControl] = useState<(ActivityCardBounds & { instant: string | null; liveConnected: boolean }) | null>(null);
  const [gateLogRecords, setGateLogRecords] = useState<GateLogRecordOverlay[]>([]);
  const [gateLogArrivals, setGateLogArrivals] = useState<GateLogArrivalOverlay[]>([]);
  const [gateLogFilter, setGateLogFilter] = useState<(ActivityCardBounds & { selected: GateLogView }) | null>(null);
  const [gateLogQuery, setGateLogQuery] = useState<(ActivityCardBounds & { query: GateLogQuery }) | null>(null);
  const [gateLogSelect, setGateLogSelect] = useState<(ActivityCardBounds & { sites: { id: number; name: string }[]; gates: { id: string; name: string; siteId: number }[]; siteId: number; gateId: string; gateName: string }) | null>(null);
  const [gateLogHeader, setGateLogHeader] = useState<(ActivityCardBounds & { title: string; subtitle: string; backLabel: string; fallbackHref: string }) | null>(null);
  const [gateLogExport, setGateLogExport] = useState<(ActivityCardBounds & { filters: GateLogExportFilters | null; disabled: boolean }) | null>(null);
  const [gateLogPages, setGateLogPages] = useState<(ActivityCardBounds & { pages: GateLogPages }) | null>(null);
  const [gateLogDetailId, setGateLogDetailId] = useState<string | null>(null);
  const [gateLogArrivalDetail, setGateLogArrivalDetail] = useState<{ runId: string; siteId: number; previewDetail: GateLogArrival["previewDetail"] } | null>(null);
  const [gateLogCardHeading, setGateLogCardHeading] = useState<(ActivityCardBounds & { title: string }) | null>(null);
  const [gateLogStatus, setGateLogStatus] = useState<(ActivityCardBounds & { status: GateLogStatus }) | null>(null);
  const [gateLogMovements, setGateLogMovements] = useState<(ActivityCardBounds & { siteId: number; gateId: string; expanded: boolean }) | null>(null);
  const [webOverlayOpen, setWebOverlayOpen] = useState(false);
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
  const changeNativeGateSelection = useCallback((siteId: number, stationId: string) => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent("gate-native-workday-selection",{detail:${JSON.stringify({ siteId, stationId })}})); true;`), []);
  const refreshWebWorkday = useCallback(() => web.current?.injectJavaScript('window.dispatchEvent(new Event("focus")); true;'), []);

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
  if (path === "/gate/shift-notes" && params.handoffId) url.searchParams.set("handoffId", params.handoffId);
  if (path === "/gate/history") {
    if (params.range) url.searchParams.set("range", params.range);
    if (params.recordType) url.searchParams.set("recordType", params.recordType);
  }
  const bootstrap = `if (location.origin === ${JSON.stringify(url.origin)} && location.pathname === ${JSON.stringify(path)}) { window.__gateDashboardSession = ${JSON.stringify(session.token)}; } true;`;
  const adminBridge = `(() => {
    if (window.__gateAdminBridgeCleanup) window.__gateAdminBridgeCleanup();
    let last = "";
    const report = () => {
      const candidate = document.getElementById("gate-admin-native-slot");
      const card = candidate?.dataset.nativeReplaceable === "1" && candidate.dataset.nativeAdmin === "1" ? candidate : null;
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const rect = card?.getBoundingClientRect();
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,stationId:card.dataset.stationId,active:!dialog,gateGoDemo:card.dataset.nativeGategoDemo === "1"} : null;
      const payload = JSON.stringify({type:"gate-native-admin-layout",channel:${JSON.stringify(voiceChannel)},bounds});
      if (payload !== last) {last = payload; window.ReactNativeWebView?.postMessage(payload);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","open","data-native-admin","data-native-gatego-demo"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateAdminBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const adminDialogBridge = `(() => {
    if (window.__gateAdminDialogCleanup) window.__gateAdminDialogCleanup();
    let last = '';
    const report = () => {
      const card = document.getElementById('gate-admin-native-slot');
      const authorized = card?.dataset.nativeReplaceable === '1' && card.dataset.nativeAdmin === '1';
      const dialog = authorized && window.__gateAdminDialogOwner ? document.querySelector('[role="dialog"][data-state="open"]') : null;
      let data = null;
      if (dialog) {
        const title = dialog.querySelector('h2,[role="heading"]')?.textContent?.trim() || '';
        const description = dialog.querySelector('[data-dialog-description]')?.textContent?.trim() || '';
        const nodes = [...dialog.querySelectorAll('input,textarea,button,a,select,[role="combobox"],[role="switch"],[role="slider"],p,dt,dd,legend'), ...document.querySelectorAll('[role="listbox"] [role="option"]')];
        const items = [];
        nodes.forEach((node,index) => {
          if (node.closest('[role="dialog"]') !== dialog && node.getAttribute('role') !== 'option') return;
          if (node.matches('input[type="hidden"]')) return;
          if (node.matches('p,dt,dd,legend') && node.closest('button,a,[role="combobox"],[role="option"]')) return;
          if (node.matches('p,dt,dd,legend')) {
            const label = node.textContent?.trim();
            if (label && label !== description && !node.querySelector('button,input,textarea,select')) items.push({id:'text-'+index,kind:'text',label});
            return;
          }
          const kind = node.matches('[role="option"]') ? 'option' : node.matches('input[type="range"],[role="slider"]') ? 'range' : node.matches('input[type="checkbox"],[role="switch"]') ? 'toggle' : node.matches('input,textarea') ? 'input' : node.matches('select,[role="combobox"]') ? 'select' : node.matches('a') ? 'link' : 'button';
          const label = node.getAttribute('aria-label') || node.closest('label')?.textContent?.trim() || node.getAttribute('placeholder') || node.textContent?.trim() || node.getAttribute('title') || kind;
          node.dataset.nativeAdminDialogId = String(index);
          items.push({id:String(index),kind,label,value:node.value ?? node.getAttribute('aria-valuenow') ?? '',inputType:node.getAttribute('type') || '',disabled:node.disabled || node.getAttribute('aria-disabled') === 'true',checked:node.checked || node.getAttribute('data-state') === 'checked',selected:node.getAttribute('data-state') === 'checked',min:Number(node.getAttribute('min') ?? 0),max:Number(node.getAttribute('max') ?? 2)});
          if (node.matches('select')) [...node.options].forEach((option,optionIndex) => { option.dataset.nativeAdminDialogId = String(index)+'-option-'+optionIndex; items.push({id:option.dataset.nativeAdminDialogId,parentId:String(index),kind:'option',label:option.textContent?.trim() || option.value,value:option.value,disabled:node.disabled || option.disabled,selected:option.selected}); });
        });
        data = {title,description,items};
      } else if (window.__gateAdminDialogOwner && (window.__gateAdminDialogSeen || Date.now() - window.__gateAdminDialogOpenedAt > 15000)) window.__gateAdminDialogOwner = false;
      if (dialog) window.__gateAdminDialogSeen = true;
      const payload = JSON.stringify({type:'gate-native-admin-dialog',channel:${JSON.stringify(voiceChannel)},dialog:data});
      if (payload !== last) {last=payload;window.ReactNativeWebView?.postMessage(payload);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-state','disabled','aria-disabled','aria-valuenow','value','open']});
    const timer = setInterval(report,350);
    window.__gateAdminDialogReport = report;
    window.__gateAdminDialogCleanup = () => {observer.disconnect();clearInterval(timer);delete window.__gateAdminDialogReport;};
    report();
  })(); true;`;
  const workdayBridge = `(() => {
    if (window.__gateWorkdayBridgeCleanup) window.__gateWorkdayBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-workday-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,siteId:Number(card.dataset.siteId || 0),stationId:card.dataset.stationId || "",gateName:card.dataset.gateName || "",active:!dialog} : null;
      const payload = JSON.stringify({type:"gate-native-workday-layout",channel:${JSON.stringify(voiceChannel)},bounds});
      if (payload !== last) {last = payload; window.ReactNativeWebView?.postMessage(payload);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-site-id","data-station-id","data-gate-name"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateWorkdayBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const dashboardStatusBridge = `(() => {
    if (window.__gateDashboardStatusBridgeCleanup) window.__gateDashboardStatusBridgeCleanup();
    let last = '';
    const report = () => {
      const strips = Array.from(document.querySelectorAll('[data-gate-dashboard-status-native-slot]')).map(node => {
        if (node.style.opacity !== '0') node.style.opacity = '0';
        const rect = node.getBoundingClientRect();
        return {id:node.dataset.gateDashboardStatusNativeSlot,top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!document.querySelector('[role="dialog"][data-state="open"]'),message:node.dataset.nativeMessage || node.firstChild?.textContent?.trim() || '',retryLabel:node.querySelector('button')?.textContent?.trim() || ''};
      });
      const payload=JSON.stringify({type:'gate-native-dashboard-statuses',channel:${JSON.stringify(voiceChannel)},strips});
      if(payload!==last){last=payload;window.ReactNativeWebView?.postMessage(payload);}
    };
    const observer=new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','data-state','data-native-message']});
    document.addEventListener('scroll',report,true);window.addEventListener('resize',report);
    const timer=setInterval(report,1000);
    window.__gateDashboardStatusBridgeCleanup=()=>{observer.disconnect();document.removeEventListener('scroll',report,true);window.removeEventListener('resize',report);clearInterval(timer);};
    report();
  })(); true;`;
  const activityBridge = `(() => {
    if (window.__gateActivityBridgeCleanup) window.__gateActivityBridgeCleanup();
    let lastBounds = "", lastData = "";
    const report = () => {
      const card = document.getElementById("gate-activity-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog} : null;
      const layout = JSON.stringify({type:"gate-native-activity-layout",channel:${JSON.stringify(voiceChannel)},bounds});
      if (layout !== lastBounds) {lastBounds = layout; window.ReactNativeWebView?.postMessage(layout);}
      const data = card ? JSON.stringify({type:"gate-native-activity-data",channel:${JSON.stringify(voiceChannel)},snapshot:card.dataset.snapshot || "",historyBaseHref:card.dataset.historyBaseHref || "",activityWindow:card.dataset.activityWindow || "",scopeLabel:card.dataset.scopeLabel || ""}) : "";
      if (data && data !== lastData) {lastData = data; window.ReactNativeWebView?.postMessage(data);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-snapshot","data-history-base-href","data-activity-window","data-scope-label","open"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateActivityBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const onSiteBridge = `(() => {
    if (window.__gateOnSiteBridgeCleanup) window.__gateOnSiteBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-on-site-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,allGates:card.dataset.allGates === "1"} : null;
      const payload = JSON.stringify({type:"gate-native-on-site-layout",channel:${JSON.stringify(voiceChannel)},bounds});
      if (payload !== last) {last = payload; window.ReactNativeWebView?.postMessage(payload);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-all-gates","open"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateOnSiteBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const tasksBridge = `(() => {
    if (window.__gateTasksBridgeCleanup) window.__gateTasksBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-tasks-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog} : null;
      const payload = JSON.stringify({type:"gate-native-tasks-layout",channel:${JSON.stringify(voiceChannel)},bounds});
      if (payload !== last) {last = payload; window.ReactNativeWebView?.postMessage(payload);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","open"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateTasksBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const watchBridge = `(() => {
    if (window.__gateWatchBridgeCleanup) window.__gateWatchBridgeCleanup();
    let lastBounds = "", lastData = "";
    const report = () => {
      const card = document.getElementById("gate-watch-native-slot");
      if (card && card.style.opacity !== "0") card.style.opacity = "0";
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog} : null;
      const layout = JSON.stringify({type:"gate-native-watch-layout",channel:${JSON.stringify(voiceChannel)},bounds});
      if (layout !== lastBounds) {lastBounds = layout; window.ReactNativeWebView?.postMessage(layout);}
      const data = card ? JSON.stringify({type:"gate-native-watch-data",channel:${JSON.stringify(voiceChannel)},stationId:card.dataset.stationId || "",phase:card.dataset.phase || "ready",current:card.dataset.current || ""}) : "";
      if (data && data !== lastData) {lastData = data; window.ReactNativeWebView?.postMessage(data);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-current","data-phase","data-station-id","open"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateWatchBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const handoffBridge = `(() => {
    if (window.__gateHandoffBridgeCleanup) window.__gateHandoffBridgeCleanup();
    let lastBounds = "", lastData = "";
    const report = () => {
      const card = document.getElementById("gate-handoff-native-slot");
      if (card && card.style.opacity !== "0") card.style.opacity = "0";
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog} : null;
      const layout = JSON.stringify({type:"gate-native-handoff-layout",channel:${JSON.stringify(voiceChannel)},bounds});
      if (layout !== lastBounds) {lastBounds = layout; window.ReactNativeWebView?.postMessage(layout);}
      const data = card ? JSON.stringify({type:"gate-native-handoff-data",channel:${JSON.stringify(voiceChannel)},stationId:card.dataset.stationId || "",phase:card.dataset.phase || "ready",current:card.dataset.current || "",gatekeeperOnDuty:card.dataset.gatekeeperOnDuty === "1",online:card.dataset.online === "1",readError:card.dataset.readError === "1",pendingWatch:card.dataset.pendingWatch === "1"}) : "";
      if (data && data !== lastData) {lastData = data; window.ReactNativeWebView?.postMessage(data);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-current","data-phase","data-station-id","data-gatekeeper-on-duty","data-online","data-read-error","data-pending-watch","open"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateHandoffBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const supervisorBridge = `(() => {
    if (window.__gateSupervisorBridgeCleanup) window.__gateSupervisorBridgeCleanup();
    let lastBounds = "", lastData = "";
    const report = () => {
      const card = document.getElementById("gate-supervisor-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog} : null;
      const layout = JSON.stringify({type:"gate-native-supervisor-layout",channel:${JSON.stringify(voiceChannel)},bounds});
      if (layout !== lastBounds) {lastBounds = layout; window.ReactNativeWebView?.postMessage(layout);}
      const data = card ? JSON.stringify({type:"gate-native-supervisor-data",channel:${JSON.stringify(voiceChannel)},stationId:card.dataset.stationId || "",current:card.dataset.current || ""}) : "";
      if (data && data !== lastData) {lastData = data; window.ReactNativeWebView?.postMessage(data);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-current","data-station-id","open"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateSupervisorBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateEntryBridge = `(() => {
    if (window.__gateEntryBridgeCleanup) window.__gateEntryBridgeCleanup();
    let last = "", previewSource = "", previewData = "";
    const report = () => {
      const panel = document.getElementById('gate-entry-panel');
      const card = panel?.querySelector('[data-testid="gate-new-entry-card"]');
      const rect = card?.getBoundingClientRect();
      const action = id => card?.querySelector('[data-testid="' + id + '"]');
      const field = id => {
        const control = card?.querySelector('#' + id);
        if (!control) return null;
        const label = card.querySelector('label[for="' + id + '"]');
        return {id,label:label?.textContent?.trim() || control.closest('label')?.firstChild?.textContent?.trim() || id,value:control.value || '',placeholder:control.getAttribute('placeholder') || '',disabled:!!control.disabled,required:!!control.required,options:control.tagName === 'SELECT' ? Array.from(control.options).map(option => ({value:option.value,label:option.textContent?.trim() || '',disabled:option.disabled})) : undefined};
      };
      const photo = id => action(id);
      const arrival = card?.querySelector('[data-native-entry-arrival]');
      const voice = card?.querySelector('[data-native-entry-voice]');
      const previous = card?.querySelector('[data-native-entry-previous]');
      const recognition = card?.querySelector('[data-testid="gate-recognition-review"]');
      const recognitionImage = recognition?.querySelector('img');
      if (recognitionImage?.src && recognitionImage.src !== previewSource) {
        previewSource = recognitionImage.src; previewData = "";
        const currentSource = previewSource;
        fetch(currentSource).then(response => response.blob()).then(blob => { const reader = new FileReader(); reader.onload = () => { if (recognitionImage.src === currentSource && typeof reader.result === 'string') { previewData = reader.result; report(); } }; reader.readAsDataURL(blob); }).catch(() => {});
      }
      const checkIn = action('button-gate-check-in'), reset = action('button-gate-reset-entry');
      const platePhoto = photo('button-gate-read-plate'), vehiclePhoto = photo('button-gate-vehicle-photo');
      const plateStateTrigger = action('plate-state-picker-trigger');
      const data = card && rect && !panel.hidden ? {
        top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!panel.hidden && !document.querySelector('[role="dialog"][data-state="open"]'),
        title:Array.from(card.querySelector('.app-card-heading')?.childNodes || []).filter(node=>node.nodeType === Node.TEXT_NODE).map(node=>node.textContent).join('').trim(),switchLabel:card.querySelector('.gate-card-swap-icon')?.getAttribute('aria-label') || '',
        checkInLabel:checkIn?.textContent?.trim() || '',checkInDisabled:!!checkIn?.disabled,resetLabel:reset?.textContent?.trim() || '',resetDisabled:!!reset?.disabled,
        platePhotoLabel:platePhoto?.textContent?.trim() || '',platePhotoDisabled:!!platePhoto?.disabled,vehiclePhotoLabel:vehiclePhoto?.textContent?.trim() || '',vehiclePhotoDisabled:!!vehiclePhoto?.disabled,
        plateState:panel.dataset.nativePlateState || '',preferredStates:panel.dataset.nativePreferredStates || '[]',plateStateError:plateStateTrigger?.parentElement?.querySelector('[role="alert"]')?.textContent?.trim() || '',
        fields:['gate-vehicle-plate','gate-first-name','gate-last-name','gate-company','gate-expected-duration','gate-destination','gate-purpose','gate-notes'].map(field).filter(Boolean),
        memoryField:panel.dataset.nativeMemoryField || '',suggestions:panel.dataset.nativeMemorySuggestions || '[]',
        arrival:arrival ? {text:Array.from(arrival.querySelectorAll('p')).map(item=>item.textContent?.trim() || ''),actions:Array.from(arrival.querySelectorAll('button')).map(item=>item.textContent?.trim() || '')} : null,
        error:card.querySelector('[data-native-entry-error]')?.textContent?.trim() || '',
        voice:voice ? {prompt:voice.querySelector('p')?.textContent?.trim() || '',cancel:voice.querySelector('button:first-child')?.textContent?.trim() || '',confirm:voice.querySelector('button:last-child')?.textContent?.trim() || '',confirmDisabled:!!voice.querySelector('button:last-child')?.disabled} : null,
        previous:previous ? {text:previous.querySelector('span')?.textContent?.trim() || '',action:previous.querySelector('button')?.textContent?.trim() || ''} : null,
        lastDriver:card.querySelector('[data-testid="gate-last-driver-hint"]')?.textContent?.trim() || '',notices:Array.from(card.querySelectorAll('[data-native-entry-notice]')).filter(item=>!item.hidden).map(item=>item.textContent?.trim() || '').filter(Boolean),siteLoading:!!card.querySelector('[data-native-entry-site-loading]'),
        recognition:recognition ? {preview:previewData,width:recognitionImage?.naturalWidth || 0,height:recognitionImage?.naturalHeight || 0,guide:recognition.querySelector('.space-y-2 > p')?.textContent?.trim() || '',summary:Array.from(recognition.querySelectorAll(':scope > p')).map(item=>item.textContent?.trim() || ''),cancel:recognition.querySelector(':scope > button')?.textContent?.trim() || '',cropLabel:recognition.querySelector('.space-y-2 > button')?.textContent?.trim() || '',disabled:!!recognition.querySelector('.space-y-2 > button')?.disabled} : null,
        es:document.documentElement.lang?.startsWith('es') || false
      } : null;
      const message = JSON.stringify({type:'gate-native-entry-card',channel:${JSON.stringify(voiceChannel)},data});
      if (message !== last) { last = message; window.ReactNativeWebView?.postMessage(message); }
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','hidden','disabled','data-state','data-native-plate-state','data-native-preferred-states','data-native-memory-suggestions','data-native-memory-field','value']});
    document.addEventListener('input',report,true); document.addEventListener('change',report,true); document.addEventListener('scroll',report,true); window.addEventListener('resize',report);
    const timer = setInterval(report,1000);
    window.__gateEntryBridgeCleanup = () => {observer.disconnect();document.removeEventListener('input',report,true);document.removeEventListener('change',report,true);document.removeEventListener('scroll',report,true);window.removeEventListener('resize',report);clearInterval(timer);};
    report();
  })(); true;`;
  const gatePresenceBridge = `(() => {
    if (window.__gatePresenceBridgeCleanup) window.__gatePresenceBridgeCleanup();
    let last = '', nextId = 0;
    const ids = new WeakMap();
    const idFor = element => {
      if (!element) return '';
      let id = ids.get(element);
      if (!id) { id = 'presence-' + (++nextId); ids.set(element,id); element.setAttribute('data-gate-native-presence-id',id); }
      return id;
    };
    const text = element => (element?.innerText || element?.textContent || '').trim();
    const children = (element,depth) => Array.from(element.children || []).flatMap(child => collect(child,depth + 1));
    const collect = (element,depth = 0) => {
      if (!element || depth > 16 || element.hidden || element.getAttribute('aria-hidden') === 'true' || element.classList?.contains('sr-only')) return [];
      const tag = element.tagName;
      if (['SVG','PATH','SCRIPT','STYLE'].includes(tag)) return [];
      if (element.matches('.animate-spin')) return [{kind:'loading'}];
      if (tag === 'LABEL' && element.querySelector('input[type="file"][data-native-exit-visit]')) { const input=element.querySelector('input[type="file"]'); return [{kind:'photo',id:input.dataset.nativeExitVisit,text:text(element),disabled:input.disabled}]; }
      if (tag === 'LABEL' && element.querySelector('select')) { const select=element.querySelector('select'); return collect(select,depth + 1).map(node => ({...node,text:text(element).replace(text(select),'').trim() || select.getAttribute('aria-label') || node.text})); }
      if (tag === 'INPUT' && element.type === 'file') return [];
      if (tag === 'INPUT' || tag === 'TEXTAREA') return [{kind:'input',id:idFor(element),text:element.closest('label')?.firstChild?.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '',value:element.value || '',disabled:element.disabled}];
      if (tag === 'SELECT') return [{kind:'select',id:idFor(element),text:element.getAttribute('aria-label') || '',value:element.value || '',disabled:element.disabled,options:Array.from(element.options).map(option=>({value:option.value,label:text(option),disabled:option.disabled}))}];
      if (tag === 'IMG') return [{kind:'image',uri:element.src,text:element.alt || ''}];
      if (tag === 'A' && element.querySelector('img')) return [{kind:'group',children:[...collect(element.querySelector('img'),depth + 1),{kind:'action',id:idFor(element),text:text(element) || element.getAttribute('aria-label') || '',disabled:false}]}];
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return [{kind:'action',id:idFor(element),text:element.getAttribute('aria-label') || text(element),disabled:element.disabled || false,pressed:element.getAttribute('aria-pressed') === 'true',alert:!!element.dataset.unread}];
      if (tag === 'DETAILS') return [{kind:'group',children:[...collect(element.querySelector(':scope > summary'),depth + 1),...(element.open ? Array.from(element.children).filter(child=>child.tagName!=='SUMMARY').flatMap(child=>collect(child,depth + 1)) : [])]}];
      if (element.classList?.contains('gate-traffic-record')) { const opener=element.querySelector('.gate-record-link'); const name=text(opener?.querySelector('.font-semibold')); const status=text(opener?.querySelector('.gate-traffic-status')); const description=text(opener?.querySelector('.text-xs')); const extras=Array.from(opener?.children || []).slice(2).map(child=>text(child)).filter(Boolean); const footer=element.querySelector('.gate-traffic-footer'); return [{kind:'record',children:[{kind:'action',id:idFor(opener),text:[name,status].filter(Boolean).join(' · '),disabled:false},{kind:'text',text:description},...extras.map(value=>({kind:'text',text:value})),...(footer ? children(footer,depth) : [])]}]; }
      if (element.classList?.contains('gate-movement-header')) return [{kind:'header',children:children(element,depth)}];
      if (tag === 'ARTICLE') return [{kind:'record',children:children(element,depth)}];
      if (['P','H1','H2','H3','H4','STRONG','DT','DD','TIME','LI'].includes(tag) && !element.querySelector('button,a,input,select,textarea,details')) return [{kind:'text',text:text(element),alert:element.getAttribute('role') === 'alert'}];
      if (!element.children.length) return text(element) ? [{kind:'text',text:text(element),alert:element.getAttribute('role') === 'alert' || element.classList?.contains('gate-traffic-flag')}] : [];
      const directText=Array.from(element.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent?.trim() || '').filter(Boolean).join(' ');
      const items = [...(directText ? [{kind:'text',text:directText,alert:element.getAttribute('role')==='alert' || element.classList?.contains('gate-traffic-flag')}] : []),...children(element,depth)];
      return items.length ? [{kind:'group',children:items}] : [];
    };
    const report = () => {
      const panel=document.getElementById('gate-activity-panel');
      const card=panel?.querySelector('[data-testid="gate-on-site-card"]');
      const rect=card?.getBoundingClientRect();
      const tabs=card?.querySelectorAll('.gate-presence-minicard') || [];
      const refresh=card?.querySelector('[data-testid="button-gate-refresh"]');
      const region=card?.querySelector('[role="region"]');
      const history=card?.querySelector('[data-testid="button-gate-full-history"]');
      const dialog=window.__gatePresenceOwnDialog ? Array.from(document.querySelectorAll('[role="dialog"][data-state="open"]')).at(-1) : null;
      if (!dialog && Date.now() > (window.__gatePresenceDialogUntil || 0)) window.__gatePresenceOwnDialog = false;
      if (dialog && dialog.style.opacity !== '0') dialog.style.opacity='0';
      const body=dialog?.querySelector('[data-testid="modal-body"]');
      const close=dialog && Array.from(dialog.querySelectorAll('button')).find(button=>text(button)==='Close'||text(button)==='Cerrar');
      const data=card && rect && !panel.hidden ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,
        tabs:[card.querySelector('.gate-card-swap-icon'),...tabs].filter(Boolean).map((tab,index)=>({id:idFor(tab),label:tab.getAttribute('aria-label') || text(tab),count:index ? text(tab.querySelector('.gate-presence-count')) : '',pressed:tab.getAttribute('aria-pressed')==='true',alert:!!tab.dataset.unread,disabled:!!tab.disabled})),
        refresh:refresh ? {id:idFor(refresh),label:refresh.getAttribute('aria-label') || text(refresh),disabled:!!refresh.disabled} : null,
        items:region ? children(region,0) : [],history:history ? {id:idFor(history),label:text(history)} : null,
        dialog:dialog ? {title:text(dialog.querySelector('[role="heading"]')) || text(dialog.querySelector('h2')),description:text(dialog.querySelector('[id$="-description"]')),items:body ? Array.from(body.children).filter(child=>child.tagName!=='H2' && !child.id?.endsWith('-description')).flatMap(child=>collect(child,0)) : [],closeId:idFor(close)} : null,
        es:document.documentElement.lang?.startsWith('es') || false} : null;
      const message=JSON.stringify({type:'gate-native-presence-card',channel:${JSON.stringify(voiceChannel)},data});
      if (message!==last) {last=message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer=new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','hidden','disabled','open','aria-pressed','data-state','value']});
    document.addEventListener('input',report,true);document.addEventListener('change',report,true);document.addEventListener('scroll',report,true);window.addEventListener('resize',report);
    const timer=setInterval(report,1000);
    window.__gatePresenceBridgeCleanup=()=>{observer.disconnect();document.removeEventListener('input',report,true);document.removeEventListener('change',report,true);document.removeEventListener('scroll',report,true);window.removeEventListener('resize',report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateEntryWorkdayBridge = `(() => {
    if (window.__gateEntryWorkdayCleanup) window.__gateEntryWorkdayCleanup();
    let last='';
    const report=()=>{
      const card=document.getElementById('gate-entry-workday-native-slot');
      const rect=card?.getBoundingClientRect();
      const data=card && rect && rect.width>0 && rect.height>0 ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!document.querySelector('[role="dialog"][data-state="open"]'),sites:card.dataset.nativeSites || '[]',siteId:Number(card.dataset.siteId || 0),gateId:card.dataset.stationId || '',gateName:card.dataset.gateName || '',gpsStatus:card.dataset.gpsStatus || 'unavailable',gpsLabel:card.dataset.gpsLabel || '',gpsDetail:card.dataset.gpsDetail || ''} : null;
      const message=JSON.stringify({type:'gate-native-entry-workday',channel:${JSON.stringify(voiceChannel)},data});
      if(message!==last){last=message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer=new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','hidden','data-state','data-native-sites','data-site-id','data-station-id','data-gate-name','data-gps-status','data-gps-label','data-gps-detail']});
    document.addEventListener('scroll',report,true);window.addEventListener('resize',report);
    const timer=setInterval(report,1000);
    window.__gateEntryWorkdayCleanup=()=>{observer.disconnect();document.removeEventListener('scroll',report,true);window.removeEventListener('resize',report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateLiveFlashBridge = `(() => {
    if (window.__gateLiveFlashCleanup) window.__gateLiveFlashCleanup();
    let last='';
    const report=()=>{
      const card=document.getElementById('gate-live-flash-native-slot');
      const rect=card?.getBoundingClientRect();
      const photo=card?.dataset.nativePhoto || '';
      const pill=card?.querySelector('[data-testid="live-connection-pill"]');
      const data=card && rect && rect.width>0 && rect.height>0 ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!document.querySelector('[role="dialog"][data-state="open"]'),message:card.dataset.nativeMessage || '',detail:card.dataset.nativeDetail || '',photo:photo ? new URL(photo,location.origin).href : '',status:card.dataset.nativeStatus || 'connecting',statusLabel:pill?.querySelector('[data-testid="live-connection-pill-label"]')?.textContent?.trim() || '',refreshLabel:pill?.getAttribute('aria-label') || ''} : null;
      const message=JSON.stringify({type:'gate-native-live-flash',channel:${JSON.stringify(voiceChannel)},data});
      if(message!==last){last=message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer=new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','hidden','data-state','data-native-message','data-native-detail','data-native-photo','data-native-status','aria-label']});
    document.addEventListener('scroll',report,true);window.addEventListener('resize',report);
    const timer=setInterval(report,1000);
    window.__gateLiveFlashCleanup=()=>{observer.disconnect();document.removeEventListener('scroll',report,true);window.removeEventListener('resize',report);clearInterval(timer);};
    report();
  })(); true;`;
  const mapCanvasBridge = `(() => {
    if (window.__gateMapCanvasBridgeCleanup) window.__gateMapCanvasBridgeCleanup();
    let last = "", nextId = 0;
    const ids = new WeakMap();
    const identify = element => { let id = ids.get(element); if (!id) { id = "gate-map-menu-" + (++nextId); ids.set(element,id); element.dataset.nativeMapId = id; } return id; };
    const report = () => {
      const card = document.getElementById("gate-map-canvas-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const menuRoot = card?.querySelector('.gate-map-reveal-card');
      const menu = menuRoot ? Array.from(menuRoot.querySelectorAll('summary,button,p,a')).filter(element => {
        if (element.closest('details')?.open === false && !element.matches('summary') || element.matches('a')) return false;
        return true;
      }).map(element => ({ id:identify(element),label:element.getAttribute('aria-label') || element.textContent?.trim() || '',kind:element.matches('summary')?'summary':element.matches('button')?'button':'text',disabled:!!element.disabled,depth:element.closest('details details')?2:element.closest('details')?1:0 })).filter(item => item.label) : [];
      const equipmentSection=card?.querySelector('.equipment-map-detail');
      const equipmentPoint=card?.dataset.selectedPointId?.startsWith('equipment:') ? JSON.parse(card.dataset.points || '[]').find(point=>point.id===card.dataset.selectedPointId) : null;
      const equipmentLink=equipmentSection?.querySelector('a[href]');
      const equipmentDetail=equipmentSection && equipmentPoint && equipmentLink ? JSON.stringify({id:card.dataset.selectedPointId.slice('equipment:'.length),name:equipmentSection.querySelector('h3')?.textContent?.trim() || '',lines:Array.from(equipmentSection.querySelectorAll('p')).map(node=>node.textContent?.trim() || ''),linkLabel:equipmentLink.textContent?.trim() || '',href:equipmentLink.getAttribute('href') || '',latitude:equipmentPoint.latitude,longitude:equipmentPoint.longitude}) : '';
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog && card.dataset.webDetailOpen !== "1",
        points:card.dataset.points || "[]",fitPoints:card.dataset.fitPoints || "[]",lines:card.dataset.lines || "[]",circles:card.querySelector('.gate-map-canvas')?.dataset.nativeCircles || card.dataset.circles || "[]",accessToken:card.querySelector('.gate-map-canvas')?.dataset.nativeMapToken || "",
        center:card.dataset.center || "null",selectedPointId:card.dataset.selectedPointId || "",styleKind:card.dataset.styleKind || "satellite",cameraRevision:Number(card.dataset.cameraRevision || 0),
        expanded:card.dataset.expanded === "1",instant:!!card.dataset.instant,showLinks:card.dataset.showLinks === "1",showSiteLocations:card.dataset.showSiteLocations === "1",
        staffVisible:card.dataset.staffVisible === "1",equipmentVisible:card.dataset.equipmentVisible === "1",settingsOpen:card.dataset.settingsOpen === "1",revealOpen:card.dataset.revealOpen === "1",equipmentOpen:card.dataset.equipmentOpen === "1",
        droppingGate:card.dataset.droppingGate === "1",droppingPin:card.dataset.droppingPin === "1",movingPointId:card.dataset.movingPointId || "",managementAllowed:card.dataset.managementAllowed === "1",siteAvailable:card.dataset.siteAvailable === "1",es:card.dataset.es === "1",pinDetail:card.dataset.pinDetail || "",equipmentDetail,menu} : null;
      const message = JSON.stringify({type:"gate-native-map-canvas",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) { last = message; window.ReactNativeWebView?.postMessage(message); }
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["style","data-state","open","disabled","data-points","data-fit-points","data-lines","data-circles","data-native-circles","data-native-map-token","data-center","data-selected-point-id","data-pin-detail","data-style-kind","data-camera-revision","data-expanded","data-instant","data-show-links","data-show-site-locations","data-staff-visible","data-equipment-visible","data-settings-open","data-reveal-open","data-equipment-open","data-dropping-gate","data-dropping-pin","data-moving-point-id","data-management-allowed","data-site-available","data-web-detail-open","data-es"]});
    document.addEventListener("scroll",report,true); window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateMapCanvasBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const mapPageHeaderBridge = `(() => {
    if (window.__gateMapPageHeaderBridgeCleanup) window.__gateMapPageHeaderBridgeCleanup();
    let last = "";
    const report = () => {
      const expanded = document.getElementById('gate-map-expanded-page-header-native-slot');
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const headers = [document.getElementById('gate-map-page-header-native-slot'), expanded].filter(Boolean).map(card => {
        const rect = card.getBoundingClientRect();
        const back = card.querySelector('[data-page-back]');
        const isExpanded = card === expanded;
        return {expanded:isExpanded,top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog && (isExpanded || !expanded),title:card.querySelector('h1')?.textContent?.trim() || '',backLabel:back?.getAttribute('aria-label') || 'Back',fallbackHref:back?.getAttribute('href') || '/gate/change-over'};
      });
      const message = JSON.stringify({type:'gate-native-map-page-headers',channel:${JSON.stringify(voiceChannel)},headers});
      if (message !== last) {last=message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','data-state','aria-label','open']});
    document.addEventListener('scroll',report,true);window.addEventListener('resize',report);
    const timer = setInterval(report,1000);
    window.__gateMapPageHeaderBridgeCleanup = () => {observer.disconnect();document.removeEventListener('scroll',report,true);window.removeEventListener('resize',report);clearInterval(timer);};
    report();
  })(); true;`;
  const mapStatusBridge = `(() => {
    if (window.__gateMapStatusBridgeCleanup) window.__gateMapStatusBridgeCleanup();
    let last = '';
    const report = () => {
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const strips = Array.from(document.querySelectorAll('[data-gate-map-status-native-slot]')).map(card => {
        const rect = card.getBoundingClientRect();
        const button = card.querySelector('button');
        const directText = Array.from(card.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent || '').join('').trim();
        const message = directText || (card.textContent || '').replace(button?.textContent || '', '').trim();
        return {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,status:{id:card.dataset.nativeMapStatusId || '',message,actionLabel:button?.textContent?.trim() || null,actionDisabled:!!button?.disabled,tone:card.getAttribute('role')==='alert'?'error':card.classList.contains('text-amber-500')?'warning':'normal'}};
      });
      const message = JSON.stringify({type:'gate-native-map-statuses',channel:${JSON.stringify(voiceChannel)},strips});
      if (message !== last) {last=message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','data-state','disabled','open']});
    document.addEventListener('scroll',report,true);window.addEventListener('resize',report);
    const timer = setInterval(report,1000);
    window.__gateMapStatusBridgeCleanup = () => {observer.disconnect();document.removeEventListener('scroll',report,true);window.removeEventListener('resize',report);clearInterval(timer);};
    report();
  })(); true;`;
  const mapHeaderBridge = `(() => {
    if (window.__gateMapHeaderBridgeCleanup) window.__gateMapHeaderBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-map-header-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,sites:card.dataset.sites || "[]",siteId:Number(card.dataset.siteId || 0),gateId:card.dataset.gateId || "",gateName:card.dataset.gateName || "",showTitle:card.dataset.showTitle === "1",showSelector:card.dataset.showSelector === "1"} : null;
      const message = JSON.stringify({type:"gate-native-map-header",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) { last = message; window.ReactNativeWebView?.postMessage(message); }
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-sites","data-site-id","data-gate-id","data-gate-name","data-show-title","data-show-selector"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateMapHeaderBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const mapPinBridge = `(() => {
    if (window.__gateMapPinBridgeCleanup) window.__gateMapPinBridgeCleanup();
    let last = "";
    const report = () => {
      const form = document.getElementById("gate-map-pin-native-slot");
      const data = form ? { pin:form.dataset.pin || "", latitude:Number(form.dataset.latitude), longitude:Number(form.dataset.longitude), siteId:Number(form.dataset.siteId), sites:form.dataset.sites || "[]" } : null;
      const message = JSON.stringify({type:"gate-native-map-pin-form",channel:${JSON.stringify(voiceChannel)},data});
      if(message !== last){last=message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["data-pin","data-latitude","data-longitude","data-site-id","data-sites"]});
    const timer = setInterval(report,1000);
    window.__gateMapPinBridgeCleanup = () => {observer.disconnect();clearInterval(timer);};
    report();
  })(); true;`;
  const mapGateFormBridge = `(() => {
    if (window.__gateMapGateFormCleanup) window.__gateMapGateFormCleanup();
    let last = '';
    const report = () => {
      const root = document.getElementById('gate-map-gate-native-slot');
      const dialog = root?.dataset.nativeAuthorized === '1' ? root.closest('[role="dialog"]') : null;
      let data = null;
      if (dialog) {
        const title = dialog.querySelector('h2,[role="heading"]')?.textContent?.trim() || '';
        const logo = dialog.querySelector('img.platform-agreement-logo')?.src || undefined;
        const nodes = [...dialog.querySelectorAll('h2,h3,legend,p,button,a,summary,input,textarea,select,[role="button"],[role="checkbox"],[role="combobox"],[role="switch"],[role="slider"]'), ...document.querySelectorAll('[role="listbox"] [role="option"]')];
        const items = [];
        nodes.forEach((node,index) => {
          if (node.closest('[role="dialog"]') !== dialog && node.getAttribute('role') !== 'option') return;
          if (node.matches('input[type="hidden"]')) return;
          if (node.matches('h2,h3,legend,p') && node.closest('button,a,[role="combobox"],[role="option"]')) return;
          if (node.matches('h2,h3,legend,p')) { const label=node.textContent?.trim(); if(label && !(node.matches('h2') && label===title) && !node.querySelector('button,input,textarea,select')) items.push({id:'text-'+index,kind:node.matches('h2,h3,legend')?'heading':'text',label}); return; }
          const kind = node.matches('[role="option"]') ? 'option' : node.matches('input[type="range"],[role="slider"]') ? 'range' : node.matches('input[type="checkbox"],[role="switch"],[role="checkbox"]') ? 'toggle' : node.matches('input,textarea') ? 'input' : node.matches('select,[role="combobox"]') ? 'select' : node.matches('a') ? 'link' : 'button';
          const labelNode=node.closest('label');
          const labelText=labelNode ? [...labelNode.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent?.trim()).filter(Boolean).join(' ') : '';
          const labelBase=node.getAttribute('aria-label') || labelText || node.getAttribute('placeholder') || node.textContent?.trim() || node.getAttribute('title') || kind;
          const label=node.getAttribute('role')==='combobox' ? labelBase+' · '+(node.textContent?.trim() || '') : labelBase;
          node.dataset.nativeMapGateId=String(index);
          items.push({id:String(index),kind,label,value:node.value ?? node.getAttribute('aria-valuenow') ?? '',inputType:node.getAttribute('type') || '',disabled:node.disabled || node.getAttribute('aria-disabled') === 'true',checked:node.checked || node.getAttribute('data-state') === 'checked',selected:node.getAttribute('data-state') === 'checked' || node.getAttribute('aria-pressed') === 'true',min:Number(node.getAttribute('min') ?? 0),max:Number(node.getAttribute('max') ?? 2)});
          if (node.matches('select')) [...node.options].forEach((option,optionIndex)=>{option.dataset.nativeMapGateId=String(index)+'-option-'+optionIndex;items.push({id:option.dataset.nativeMapGateId,parentId:String(index),kind:'option',label:option.textContent?.trim() || option.value,value:option.value,disabled:node.disabled || option.disabled,selected:option.selected});});
        });
        data = {title,description:'',logo,items};
      }
      const payload=JSON.stringify({type:'gate-native-map-gate-form',channel:${JSON.stringify(voiceChannel)},data});
      if(payload!==last){last=payload;window.ReactNativeWebView?.postMessage(payload);}
    };
    const observer=new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','aria-disabled','aria-pressed','data-state','value','open']});
    const timer=setInterval(report,350);
    window.__gateMapGateFormReport=report;
    window.__gateMapGateFormCleanup=()=>{observer.disconnect();clearInterval(timer);delete window.__gateMapGateFormReport;};
    report();
  })(); true;`;
  const mapActivityPopupBridge = `(() => {
    if (window.__gateMapActivityPopupBridgeCleanup) window.__gateMapActivityPopupBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-map-activity-popup-native-slot");
      const rect = card?.getBoundingClientRect();
      const status = card?.querySelector(".gate-map-gate-status");
      const confirm = card?.querySelector(".gate-map-status-confirm");
      const actions = confirm?.querySelectorAll("button");
      const data = card && rect ? {
        top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:true,
        stationId:card.dataset.stationId || "",siteId:Number(card.dataset.siteId || 0),
        siteName:card.dataset.siteName || "",gateName:card.dataset.gateName || "",
        gateActive:card.dataset.active === "1",latitude:card.dataset.latitude === "" ? null : Number(card.dataset.latitude),
        longitude:card.dataset.longitude === "" ? null : Number(card.dataset.longitude),
        historical:card.dataset.historical === "1",es:card.dataset.es === "1",
        activity:card.dataset.activity || "null",loading:card.dataset.loading === "1",error:card.dataset.error === "1",refreshing:card.dataset.refreshing === "1",
        statusLabel:status?.textContent?.trim() || "",statusActionLabel:status?.getAttribute("aria-label") || "",
        confirmation:confirm?.querySelector(":scope > span:first-child")?.textContent?.trim() || "",
        confirmationAction:actions?.[0]?.textContent?.trim() || "",confirmationError:confirm?.querySelector('[role="alert"]')?.textContent?.trim() || "",
        statusBusy:!!actions?.[0]?.disabled,editAllowed:!!card.querySelector(":scope > .gate-history-filter")
      } : null;
      const message = JSON.stringify({type:"gate-native-map-activity-popup",channel:${JSON.stringify(voiceChannel)},data});
      if(message !== last){last=message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["style","data-active","data-activity","data-loading","data-error","data-refreshing","disabled"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateMapActivityPopupBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const mapAdminBridge = `(() => {
    if (window.__gateMapAdminBridgeCleanup) window.__gateMapAdminBridgeCleanup();
    const ids = new WeakMap(); let nextId = 0, last = "";
    const identify = element => { let id = ids.get(element); if (!id) { id = "gate-admin-" + (++nextId); ids.set(element,id); } element.dataset.gateNativeId = id; return id; };
    const report = () => {
      const card = document.querySelector(".gate-map-page > .gate-administration-card");
      const form = card?.querySelector("form.gate-administration");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const items = form ? Array.from(form.querySelectorAll("h3,legend,label,button,p")).map(element => {
        if (element.matches("h3,legend")) return {id:identify(element),kind:"heading",label:element.textContent?.trim() || ""};
        if (element.matches("p")) return {id:identify(element),kind:"text",label:element.textContent?.trim() || "",tone:element.getAttribute("role") === "alert" ? "error" : element.getAttribute("role") === "status" ? "success" : undefined};
        if (element.matches("button")) return {id:identify(element),kind:"button",label:element.textContent?.trim() || element.getAttribute("aria-label") || "",disabled:element.disabled,pressed:element.getAttribute("aria-pressed") === "true"};
        const control = element.querySelector("input,select,textarea");
        if (!control) return null;
        const label = element.cloneNode(true);
        label.querySelectorAll("input,select,textarea").forEach(child => child.remove());
        return {id:identify(control),kind:"field",label:label.textContent?.trim() || control.getAttribute("aria-label") || "",value:control.value || "",inputKind:control.tagName.toLowerCase(),inputType:control.type || "",maxLength:control.maxLength > 0 ? control.maxLength : undefined,required:control.required,disabled:control.disabled,options:control.tagName === "SELECT" ? Array.from(control.options).map(option => ({value:option.value,label:option.textContent?.trim() || "",disabled:option.disabled})) : undefined};
      }).filter(Boolean) : [];
      const data = card && form && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,title:card.querySelector("header h2")?.textContent?.trim() || "",subtitle:card.querySelector("header p")?.textContent?.trim() || "",mode:form.dataset.nativeMode || "",es:form.dataset.nativeEs === "1",busy:form.dataset.nativeBusy === "1",items} : null;
      const message = JSON.stringify({type:"gate-native-map-administration",channel:${JSON.stringify(voiceChannel)},data});
      if(message !== last){last=message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["style","data-state","data-native-mode","data-native-busy","disabled","aria-pressed"]});
    document.addEventListener("input",report,true); document.addEventListener("change",report,true); document.addEventListener("click",report,true); document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateMapAdminBridgeCleanup = () => {observer.disconnect();document.removeEventListener("input",report,true);document.removeEventListener("change",report,true);document.removeEventListener("click",report,true);document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const mapStaffBridge = `(() => {
    if (window.__gateMapStaffBridgeCleanup) window.__gateMapStaffBridgeCleanup();
    let lastBounds = "", lastData = "";
    const report = () => {
      const card = document.getElementById("gate-map-staff-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog} : null;
      const layout = JSON.stringify({type:"gate-native-map-staff-layout",channel:${JSON.stringify(voiceChannel)},bounds});
      if (layout !== lastBounds) {lastBounds = layout; window.ReactNativeWebView?.postMessage(layout);}
      const data = card ? JSON.stringify({type:"gate-native-map-staff-data",channel:${JSON.stringify(voiceChannel)},groups:card.dataset.groups || "",locationError:card.dataset.locationError || "",sort:card.dataset.staffSort || "name"}) : "";
      if (data && data !== lastData) {lastData = data; window.ReactNativeWebView?.postMessage(data);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-groups","data-location-error","data-staff-sort","open"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateMapStaffBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const mapActivityBridge = `(() => {
    if (window.__gateMapActivityBridgeCleanup) window.__gateMapActivityBridgeCleanup();
    let lastBounds = "", lastData = "";
    const report = () => {
      const card = document.getElementById("gate-map-activity-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog} : null;
      const layout = JSON.stringify({type:"gate-native-map-activity-layout",channel:${JSON.stringify(voiceChannel)},bounds});
      if (layout !== lastBounds) {lastBounds = layout; window.ReactNativeWebView?.postMessage(layout);}
      const data = card ? JSON.stringify({type:"gate-native-map-activity-data",channel:${JSON.stringify(voiceChannel)},snapshot:card.dataset.snapshot || "",historyBaseHref:card.dataset.historyBaseHref || "",recordHistoryHrefs:card.dataset.recordHistoryHrefs || "{}",showAllLogLink:card.dataset.showAllLogLink === "1",mode:card.dataset.nativeMode || "",status:card.dataset.status || "",statusTone:card.dataset.statusTone || "normal"}) : "";
      if (data && data !== lastData) {lastData = data; window.ReactNativeWebView?.postMessage(data);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-snapshot","data-history-base-href","data-record-history-hrefs","data-show-all-log-link","data-native-mode","data-status","data-status-tone","open"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateMapActivityBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const mapPresenceBridge = `(() => {
    if (window.__gateMapPresenceBridgeCleanup) window.__gateMapPresenceBridgeCleanup();
    let lastBounds = "", lastData = "";
    const report = () => {
      const card = document.querySelector("[data-gate-site-presence-native-slot]");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog} : null;
      const layout = JSON.stringify({type:"gate-native-map-presence-layout",channel:${JSON.stringify(voiceChannel)},bounds});
      if (layout !== lastBounds) {lastBounds = layout; window.ReactNativeWebView?.postMessage(layout);}
      const data = card ? JSON.stringify({type:"gate-native-map-presence-data",channel:${JSON.stringify(voiceChannel)},snapshot:card.dataset.snapshot || "",loading:card.dataset.loading === "1",sites:card.dataset.sites || "[]",recordHistoryHrefs:card.dataset.recordHistoryHrefs || "{}",historyBaseHref:card.dataset.historyBaseHref || ""}) : "";
      if (data && data !== lastData) {lastData = data; window.ReactNativeWebView?.postMessage(data);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-snapshot","data-loading","data-sites","data-record-history-hrefs","data-history-base-href","open"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateMapPresenceBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const confirmedLocationsBridge = `(() => {
    if (window.__gateConfirmedLocationsBridgeCleanup) window.__gateConfirmedLocationsBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-map-confirmed-locations-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,visits:card.dataset.visits || "[]"} : null;
      const message = JSON.stringify({type:"gate-native-confirmed-locations",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-visits","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateConfirmedLocationsBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const mapTimeBridge = `(() => {
    if (window.__gateMapTimeBridgeCleanup) window.__gateMapTimeBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-map-time-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,instant:card.dataset.instant || null,liveConnected:card.dataset.liveConnected === "1"} : null;
      const message = JSON.stringify({type:"gate-native-map-time",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-instant","data-live-connected","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateMapTimeBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
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
  const gateLogRecordBridge = `(() => {
    if (window.__gateLogRecordBridgeCleanup) window.__gateLogRecordBridgeCleanup();
    let last = "";
    const report = () => {
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const cards = Array.from(document.querySelectorAll('[data-gate-log-native-record]')).slice(0,50).map(card => {
        const rect = card.getBoundingClientRect();
        return {id:card.dataset.recordId || "",record:card.dataset.nativeRecord || "",top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog};
      });
      const arrivals = Array.from(document.querySelectorAll('[data-gate-log-native-arrival]')).slice(0,50).map(card => {
        const rect = card.getBoundingClientRect();
        return {id:card.dataset.arrivalId || "",arrival:card.dataset.nativeArrival || "",top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog};
      });
      const message = JSON.stringify({type:"gate-native-log-records",channel:${JSON.stringify(voiceChannel)},cards,arrivals});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-native-record","data-native-arrival","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateLogRecordBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateLogFilterBridge = `(() => {
    if (window.__gateLogFilterBridgeCleanup) window.__gateLogFilterBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-log-filter-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,selected:card.dataset.view} : null;
      const message = JSON.stringify({type:"gate-native-log-filter",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-view","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateLogFilterBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateLogQueryBridge = `(() => {
    if (window.__gateLogQueryBridgeCleanup) window.__gateLogQueryBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-log-query-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,query:{search:card.dataset.search || "",range:card.dataset.range || "",recordType:card.dataset.recordType || "",recordTypeDisabled:card.dataset.recordTypeDisabled === "1",customWindow:card.dataset.customWindow || null}} : null;
      const message = JSON.stringify({type:"gate-native-log-query",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-search","data-range","data-record-type","data-record-type-disabled","data-custom-window","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateLogQueryBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateLogSelectBridge = `(() => {
    if (window.__gateLogSelectBridgeCleanup) window.__gateLogSelectBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-log-select-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,sites:card.dataset.sites || "[]",gates:card.dataset.gates || "[]",siteId:Number(card.dataset.siteId || 0),gateId:card.dataset.gateId || "",gateName:card.dataset.gateName || ""} : null;
      const message = JSON.stringify({type:"gate-native-log-select",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-sites","data-gates","data-site-id","data-gate-id","data-gate-name","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateLogSelectBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateLogHeaderBridge = `(() => {
    if (window.__gateLogHeaderBridgeCleanup) window.__gateLogHeaderBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-log-header-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const back = card?.querySelector('[data-page-back]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,title:card.dataset.title || "",subtitle:card.dataset.subtitle || "",backLabel:back?.getAttribute('aria-label') || 'Back',fallbackHref:back?.getAttribute('href') || '/gate/change-over'} : null;
      const message = JSON.stringify({type:"gate-native-log-header",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-title","data-subtitle","href","aria-label","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateLogHeaderBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateLogCardHeadingBridge = `(() => {
    if (window.__gateLogCardHeadingCleanup) window.__gateLogCardHeadingCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-log-card-heading-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,title:card.dataset.title || ""} : null;
      const message = JSON.stringify({type:"gate-native-log-card-heading",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-title","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateLogCardHeadingCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateLogStatusBridge = `(() => {
    if (window.__gateLogStatusCleanup) window.__gateLogStatusCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-log-status-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect && rect.height > 0 ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,loading:card.dataset.loading === "1",messages:card.dataset.messages || "[]"} : null;
      const message = JSON.stringify({type:"gate-native-log-status",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-loading","data-messages","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateLogStatusCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateLogMovementsBridge = `(() => {
    if (window.__gateLogMovementsCleanup) window.__gateLogMovementsCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-log-movements-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,siteId:Number(card.dataset.siteId || 0),gateId:card.dataset.gateId || "",expanded:card.open} : null;
      const message = JSON.stringify({type:"gate-native-log-movements",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-site-id","data-gate-id","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateLogMovementsCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateLogExportBridge = `(() => {
    if (window.__gateLogExportBridgeCleanup) window.__gateLogExportBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-log-export-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,filters:card.dataset.filters || "null",disabled:card.dataset.disabled === "1"} : null;
      const message = JSON.stringify({type:"gate-native-log-export",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-filters","data-disabled","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateLogExportBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const gateLogPagesBridge = `(() => {
    if (window.__gateLogPagesBridgeCleanup) window.__gateLogPagesBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-log-pages-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,pages:{start:Number(card.dataset.start),end:Number(card.dataset.end),total:Number(card.dataset.total),page:Number(card.dataset.page),lastPage:Number(card.dataset.lastPage)}} : null;
      const message = JSON.stringify({type:"gate-native-log-pages",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-start","data-end","data-total","data-page","data-last-page","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateLogPagesBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const shiftNotesPageHeaderBridge = `(() => {
    if (window.__gateShiftNotesPageHeaderBridgeCleanup) window.__gateShiftNotesPageHeaderBridgeCleanup();
    let last = '';
    const report = () => {
      const header = document.getElementById('gate-shift-notes-page-header-native-slot');
      const rect = header?.getBoundingClientRect();
      const back = header?.querySelector('[data-page-back]');
      const bounds = header && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!document.querySelector('[role="dialog"][data-state="open"]'),title:header.querySelector('h1')?.textContent?.trim() || '',subtitle:header.querySelector('h1 + p')?.textContent?.trim() || '',backLabel:back?.getAttribute('aria-label') || 'Back',fallbackHref:header.dataset.fallbackHref || back?.getAttribute('href') || '/gate/change-over'} : null;
      const payload=JSON.stringify({type:'gate-native-shift-notes-page-header',channel:${JSON.stringify(voiceChannel)},bounds});
      if(payload!==last){last=payload;window.ReactNativeWebView?.postMessage(payload);}
    };
    const observer=new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','data-state','href','aria-label']});
    document.addEventListener('scroll',report,true);window.addEventListener('resize',report);
    const timer=setInterval(report,1000);
    window.__gateShiftNotesPageHeaderBridgeCleanup=()=>{observer.disconnect();document.removeEventListener('scroll',report,true);window.removeEventListener('resize',report);clearInterval(timer);};
    report();
  })(); true;`;
  const shiftNotesAllLinkBridge = `(() => {
    if (window.__gateShiftNotesAllLinkBridgeCleanup) window.__gateShiftNotesAllLinkBridgeCleanup();
    let last = '';
    const report = () => {
      const link = document.getElementById('gate-all-shift-notes-native-slot');
      if (link && link.style.opacity !== '0') link.style.opacity = '0';
      const rect = link?.getBoundingClientRect();
      const bounds = link && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!document.querySelector('[role="dialog"][data-state="open"]'),label:link.textContent?.trim() || '',href:link.getAttribute('href') || ''} : null;
      const payload = JSON.stringify({type:'gate-native-all-shift-notes-link',channel:${JSON.stringify(voiceChannel)},bounds});
      if (payload !== last) { last = payload; window.ReactNativeWebView?.postMessage(payload); }
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','href','data-state']});
    document.addEventListener('scroll',report,true);window.addEventListener('resize',report);
    const timer=setInterval(report,1000);
    window.__gateShiftNotesAllLinkBridgeCleanup=()=>{observer.disconnect();document.removeEventListener('scroll',report,true);window.removeEventListener('resize',report);clearInterval(timer);};
    report();
  })(); true;`;
  const linkedNoteStatusBridge = `(() => {
    if (window.__gateLinkedNoteStatusBridgeCleanup) window.__gateLinkedNoteStatusBridgeCleanup();
    let last = '';
    const report = () => {
      const strips = Array.from(document.querySelectorAll('[data-gate-linked-status-native-slot]')).map(node => {
        if (node.style.opacity !== '0') node.style.opacity = '0';
        const rect = node.getBoundingClientRect();
        return {id:node.dataset.gateLinkedStatusNativeSlot,top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!document.querySelector('[role="dialog"][data-state="open"]'),message:node.dataset.nativeMessage || node.firstChild?.textContent?.trim() || '',retryLabel:node.querySelector('button')?.textContent?.trim() || ''};
      });
      const payload=JSON.stringify({type:'gate-native-linked-note-statuses',channel:${JSON.stringify(voiceChannel)},strips});
      if(payload!==last){last=payload;window.ReactNativeWebView?.postMessage(payload);}
    };
    const observer=new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','data-state','data-native-message']});
    document.addEventListener('scroll',report,true);window.addEventListener('resize',report);
    const timer=setInterval(report,1000);
    window.__gateLinkedNoteStatusBridgeCleanup=()=>{observer.disconnect();document.removeEventListener('scroll',report,true);window.removeEventListener('resize',report);clearInterval(timer);};
    report();
  })(); true;`;
  const shiftNotesHeaderBridge = `(() => {
    if (window.__gateShiftNotesHeaderBridgeCleanup) window.__gateShiftNotesHeaderBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-shift-notes-header-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,sites:card.dataset.sites || "[]",gates:card.dataset.gates || "[]",siteId:Number(card.dataset.siteId || 0),gateId:card.dataset.gateId || "",gateName:card.dataset.gateName || "",filters:card.dataset.filters || "null",search:card.dataset.search || "",loading:card.dataset.loading === "1",error:card.dataset.error === "1"} : null;
      const message = JSON.stringify({type:"gate-native-shift-notes-header",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message; window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-sites","data-gates","data-site-id","data-gate-id","data-gate-name","data-filters","data-search","data-loading","data-error"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateShiftNotesHeaderBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const shiftNoteBridge = `(() => {
    if (window.__gateShiftNoteBridgeCleanup) window.__gateShiftNoteBridgeCleanup();
    let last = "";
    const report = () => {
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const cards = Array.from(document.querySelectorAll('[data-shift-note-native-slot]')).slice(0, 50).map(card => {
        const rect = card.getBoundingClientRect();
        return {id:card.dataset.noteId || "",note:card.dataset.note || "",top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog};
      });
      const audit = document.getElementById("gate-shift-audit-native-slot");
      const rect = audit?.getBoundingClientRect();
      const auditCard = audit && rect ? {actions:audit.dataset.actions || "[]",top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog} : null;
      const message = JSON.stringify({type:"gate-native-shift-notes",channel:${JSON.stringify(voiceChannel)},cards,auditCard});
      if (message !== last) {last = message; window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-note","data-actions","open"]});
    document.addEventListener("scroll",report,true);
    window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateShiftNoteBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const incidentReportBridge = `(() => {
    if (window.__gateIncidentReportBridgeCleanup) window.__gateIncidentReportBridgeCleanup();
    let last = '';
    const report = () => {
      const sheet = document.querySelector('[data-native-gate-incident="1"][data-state="open"]');
      const form = sheet?.querySelector('[data-testid="safety-report-page"]');
      const site = form?.querySelector('[data-testid="input-safety-site-id"]');
      const title = form?.querySelector('[data-testid="input-safety-title"]');
      const description = form?.querySelector('[data-testid="input-safety-description"]');
      const anonymous = form?.querySelector('[data-testid="checkbox-safety-anonymous"]');
      const stopWork = form?.querySelector('[data-testid="checkbox-safety-stop-work"]');
      const submit = form?.querySelector('[data-testid="button-submit-safety-report"]');
      const label = id => form?.querySelector('label[for="'+id+'"]')?.textContent?.trim() || '';
      const data = sheet && form && site && title && description && anonymous && stopWork && submit ? {
        title:sheet.querySelector('[data-slot="sheet-title"]')?.textContent?.trim() || 'Report an incident',
        description:sheet.querySelector('[data-slot="sheet-description"]')?.textContent?.trim() || '',
        formTitle:form.querySelector('[data-slot="card-title"]')?.textContent?.trim() || form.querySelector('h3')?.textContent?.trim() || 'Report an incident',
        siteLabel:label('site-id'),siteId:site.value,
        sites:[...site.options].filter(option=>option.value).map(option=>({id:option.value,name:option.textContent?.trim() || option.value})),
        eventTypes:[...form.querySelectorAll('[data-testid^="button-event-type-"]')].map(button=>({id:button.dataset.testid.slice('button-event-type-'.length),label:button.textContent?.trim() || '',selected:button.getAttribute('aria-pressed')==='true'})),
        incidentTitleLabel:label('safety-title'),incidentTitle:title.value,
        descriptionLabel:label('safety-description'),incidentDescription:description.value,
        anonymousLabel:label('safety-anonymous'),anonymous:anonymous.getAttribute('data-state')==='checked',
        stopWorkLabel:label('safety-stop-work'),stopWork:stopWork.getAttribute('data-state')==='checked',
        submitLabel:submit.textContent?.trim() || 'Submit',submitting:submit.disabled,
        error:form.dataset.nativeError || '',requiredMessage:form.dataset.nativeRequiredMessage || ''
      } : null;
      const payload=JSON.stringify({type:'gate-native-incident-report',channel:${JSON.stringify(voiceChannel)},data});
      if(payload!==last){last=payload;window.ReactNativeWebView?.postMessage(payload);}
    };
    const observer=new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-state','aria-pressed','disabled','data-native-error','value']});
    const success = event => { const detail=event.detail; if(typeof detail?.title!=='string'||typeof detail?.description!=='string') return; window.ReactNativeWebView?.postMessage(JSON.stringify({type:'gate-native-incident-success',channel:${JSON.stringify(voiceChannel)},title:detail.title,description:detail.description})); };
    window.addEventListener('gate-native-incident-success',success);
    const timer=setInterval(report,300);
    window.__gateIncidentReportBridgeCleanup=()=>{observer.disconnect();window.removeEventListener('gate-native-incident-success',success);clearInterval(timer);};
    report();
  })(); true;`;
  const assumeWatchBridge = `(() => {
    if (window.__gateAssumeWatchBridgeCleanup) window.__gateAssumeWatchBridgeCleanup();
    let last = '';
    const report = () => {
      const dialog = document.querySelector('[data-native-gate-assume="1"][data-state="open"]');
      let data = null;
      if (dialog?.dataset.nativeAssumeState) try { data = JSON.parse(dialog.dataset.nativeAssumeState); } catch {}
      const payload = JSON.stringify({type:'gate-native-assume-watch',channel:${JSON.stringify(voiceChannel)},data});
      if (payload !== last) { last = payload; window.ReactNativeWebView?.postMessage(payload); }
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-state','data-native-assume-state']});
    const timer = setInterval(report,300);
    window.__gateAssumeWatchBridgeCleanup = () => { observer.disconnect(); clearInterval(timer); };
    report();
  })(); true;`;
  const entryHeaderBridge = `(() => {
    if (window.__gateEntryHeaderBridgeCleanup) window.__gateEntryHeaderBridgeCleanup();
    let last = '';
    const report = () => {
      const header = document.getElementById('gate-entry-header-native-slot');
      const rect = header?.getBoundingClientRect();
      const bounds = header && rect ? {
        top:rect.top,left:rect.left,width:rect.width,height:rect.height,
        active:!document.querySelector('[role="dialog"][data-state="open"]'),
        title:header.querySelector('h1')?.textContent?.trim() || '',
        backLabel:header.querySelector('[data-page-back]')?.getAttribute('aria-label') || 'Back',
        statuses:[...header.querySelectorAll('[role="status"]')].map(node=>node.textContent?.trim() || '').filter(Boolean)
      } : null;
      const payload=JSON.stringify({type:'gate-native-entry-header',channel:${JSON.stringify(voiceChannel)},bounds});
      if(payload!==last){last=payload;window.ReactNativeWebView?.postMessage(payload);}
    };
    const observer=new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','data-state','aria-label']});
    document.addEventListener('scroll',report,true);window.addEventListener('resize',report);
    const timer=setInterval(report,1000);
    window.__gateEntryHeaderBridgeCleanup=()=>{observer.disconnect();document.removeEventListener('scroll',report,true);window.removeEventListener('resize',report);clearInterval(timer);};
    report();
  })(); true;`;
  const dashboardHeaderBridge = `(() => {
    if (window.__gateDashboardHeaderBridgeCleanup) window.__gateDashboardHeaderBridgeCleanup();
    let last = "";
    const report = () => {
      const card = document.getElementById("gate-dashboard-header-native-slot");
      const rect = card?.getBoundingClientRect();
      const dialog = !!document.querySelector('[role="dialog"][data-state="open"]');
      const bounds = card && rect ? {top:rect.top,left:rect.left,width:rect.width,height:rect.height,active:!dialog,title:card.dataset.title || "",subtitle:card.dataset.subtitle || ""} : null;
      const message = JSON.stringify({type:"gate-native-dashboard-header",channel:${JSON.stringify(voiceChannel)},bounds});
      if (message !== last) {last = message;window.ReactNativeWebView?.postMessage(message);}
    };
    const observer = new MutationObserver(report);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["style","data-state","data-title","data-subtitle","open"]});
    document.addEventListener("scroll",report,true);window.addEventListener("resize",report);
    const timer = setInterval(report,1000);
    window.__gateDashboardHeaderBridgeCleanup = () => {observer.disconnect();document.removeEventListener("scroll",report,true);window.removeEventListener("resize",report);clearInterval(timer);};
    report();
  })(); true;`;
  const adminAction = (action: { type: "profitability" } | { type: "group"; group: string } | { type: "ticket-profitability"; ticketId: number } | { type: "ticket"; ticketId: number; action: string }) => {
    const script = `(() => {
      const card = document.getElementById("gate-admin-native-slot");
      if (!card) return;
      const action = ${JSON.stringify(action)};
      const click = node => {if (node && !node.disabled) node.click();};
      if (action.type === "profitability") click(card.querySelector('[data-native-profitability="aggregate"] summary'));
      if (action.type === "group") click(card.querySelector('[data-native-billing-group="' + action.group + '"] summary'));
      if (action.type === "ticket-profitability") click(card.querySelector('[data-native-ticket-id="' + action.ticketId + '"] [data-native-ticket-profitability="true"] summary'));
      if (action.type === "ticket") {
        window.__gateAdminDialogOwner = true;
        window.__gateAdminDialogSeen = false;
        window.__gateAdminDialogOpenedAt = Date.now();
        const attempt = remaining => {
          const ticket = card.querySelector('[data-native-ticket-id="' + action.ticketId + '"]');
          if (!ticket && remaining > 0) return setTimeout(() => attempt(remaining - 1), 200);
          click(ticket?.querySelector('[data-native-billing-action="' + action.action + '"]'));
          setTimeout(() => window.__gateAdminDialogReport?.(), 100);
        };
        attempt(10);
      }
    })(); true;`;
    web.current?.injectJavaScript(script);
  };
  return <View style={[{ flex: 1 }, entryBackground]}><WebView ref={web} key={scope} style={[{ flex: 1 }, entryBackground]}
    hideKeyboardAccessoryView={iosGateEntry}
    onLoadStart={() => { gateMapLoaded.current = false; setMapPageHeaders([]); setMapStatuses([]); setMapPinForm(null); setMapGateForm(null); setMapActivityPopup(null); setMapAdminCard(null); setMapCanvasCard(null); setGateEntryCard(null); setEntryHeader(null); setGatePresenceCard(null); setGateEntryWorkday(null); setGateLiveFlash(null); setGateLogDetailId(null); setGateLogArrivalDetail(null); setGateLogCardHeading(null); setGateLogStatus(null); setGateLogMovements(null); setGateLogPages(null); setGateLogExport(null); setGateLogHeader(null); setGateLogSelect(null); setGateLogQuery(null); setGateLogFilter(null); setGateLogArrivals([]); setGateLogRecords([]); setGateMapFocusTargets([]); setMapTimeControl(null); setConfirmedLocations(null); setDashboardHeader(null); setAdminCard(null); setAdminDialog(null); setIncidentReport(null); setIncidentConfirmation(null); setAssumeWatch(null); setWorkdayCard(null); setDashboardStatuses([]); setLinkedNoteStatuses([]); setActivityCard(null); setActivityData(null); setOnSiteCard(null); setTasksCard(null); setWatchCard(null); setWatchData(null); setHandoffCard(null); setSupervisorCard(null); setSupervisorData(null); setMapHeaderCard(null); setMapStaffCard(null); setMapStaffData(null); setMapActivityCard(null); setMapActivityData(null); setMapPresenceCard(null); setMapPresenceData(null); setShiftNoteCards([]); setShiftNotesPageHeader(null); setShiftNotesAllLink(null); setShiftNotesHeader(null); setShiftAuditCard(null); setWebOverlayOpen(false); setWebOverlayOwner(path, false); voiceBridge.current?.clear(); }}
    onError={() => { gateMapLoaded.current = false; setMapFullscreen?.(false); voiceBridge.current?.clear(); setPageFailed(true); setWebOverlayOwner(path, false); }}
    onHttpError={event => { if (event.nativeEvent.statusCode >= 500) setPageFailed(true); }}
    onLoad={() => { gateMapLoaded.current = true; setPageFailed(false); web.current?.injectJavaScript('window.dispatchEvent(new CustomEvent("gate-companion-state",{detail:' + companionState + '})); true;'); if (Platform.OS === "ios" && path === "/gate") { web.current?.injectJavaScript(gateEntryBridge); web.current?.injectJavaScript(entryHeaderBridge); web.current?.injectJavaScript(gatePresenceBridge); web.current?.injectJavaScript(gateEntryWorkdayBridge); web.current?.injectJavaScript(gateLiveFlashBridge); } if (Platform.OS === "ios" && path === "/gate/change-over") { web.current?.injectJavaScript(dashboardHeaderBridge); web.current?.injectJavaScript(incidentReportBridge); web.current?.injectJavaScript(assumeWatchBridge); web.current?.injectJavaScript(adminBridge); web.current?.injectJavaScript(adminDialogBridge); web.current?.injectJavaScript(workdayBridge); web.current?.injectJavaScript(dashboardStatusBridge); web.current?.injectJavaScript(activityBridge); web.current?.injectJavaScript(onSiteBridge); web.current?.injectJavaScript(watchBridge); web.current?.injectJavaScript(handoffBridge); web.current?.injectJavaScript(supervisorBridge); } if (Platform.OS === "ios" && path === "/gate/map") { web.current?.injectJavaScript(mapStatusBridge); web.current?.injectJavaScript(mapPageHeaderBridge); web.current?.injectJavaScript(mapHeaderBridge); web.current?.injectJavaScript(mapCanvasBridge); web.current?.injectJavaScript(mapPinBridge); web.current?.injectJavaScript(mapGateFormBridge); web.current?.injectJavaScript(mapActivityPopupBridge); web.current?.injectJavaScript(mapAdminBridge); web.current?.injectJavaScript(mapStaffBridge); web.current?.injectJavaScript(mapActivityBridge); web.current?.injectJavaScript(mapPresenceBridge); web.current?.injectJavaScript(confirmedLocationsBridge); web.current?.injectJavaScript(mapTimeBridge); web.current?.injectJavaScript(gateMapFocusBridge); } if (Platform.OS === "ios" && path === "/gate/shift-notes") { web.current?.injectJavaScript(shiftNotesPageHeaderBridge); web.current?.injectJavaScript(shiftNotesAllLinkBridge); web.current?.injectJavaScript(linkedNoteStatusBridge); web.current?.injectJavaScript(shiftNotesHeaderBridge); web.current?.injectJavaScript(shiftNoteBridge); } if (Platform.OS === "ios" && path === "/gate/history") { web.current?.injectJavaScript(activityBridge); web.current?.injectJavaScript(gateLogRecordBridge); web.current?.injectJavaScript(gateLogFilterBridge); web.current?.injectJavaScript(gateLogQueryBridge); web.current?.injectJavaScript(gateLogSelectBridge); web.current?.injectJavaScript(gateLogHeaderBridge); web.current?.injectJavaScript(gateLogCardHeadingBridge); web.current?.injectJavaScript(gateLogStatusBridge); web.current?.injectJavaScript(gateLogMovementsBridge); web.current?.injectJavaScript(gateLogExportBridge); web.current?.injectJavaScript(gateLogPagesBridge); } }}
    onMessage={event => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (message.type === "gate-native-create-draft-result" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const result = message.result as AskVGateCreateDraftResult;
          if (!result || typeof result.requestId !== "string" || typeof result.ok !== "boolean" || result.reason !== undefined && typeof result.reason !== "string" || result.state !== undefined && (!result.state || typeof result.state.mode !== "string" || !Array.isArray(result.state.missing) || !result.state.missing.every((item: unknown) => typeof item === "string") || typeof result.state.readyToReview !== "boolean")) return;
          const resolve = gateDraftPending.current.get(result.requestId);
          if (resolve) { gateDraftPending.current.delete(result.requestId); resolve(result); }
          return;
        }
        if (message.type === "gate-native-live-flash" && path === "/gate" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.data;
          if (!b) { setGateLiveFlash(null); return; }
          if (![b.top,b.left,b.width,b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || ![b.message,b.detail,b.photo,b.status,b.statusLabel,b.refreshLabel].every(value => typeof value === "string") || !["connecting","live","reconnecting","refreshed"].includes(b.status)) return;
          if (b.photo && !["http:","https:"].includes(new URL(b.photo).protocol)) return;
          setGateLiveFlash({top:b.top,left:b.left,width:b.width,height:b.height,active:b.active,data:{message:b.message,detail:b.detail,photo:b.photo,status:b.status,statusLabel:b.statusLabel,refreshLabel:b.refreshLabel}});
          web.current?.injectJavaScript(`document.getElementById('gate-live-flash-native-slot')?.style.setProperty('opacity',${b.active ? "'0'" : "'1'"}); true;`);
          return;
        }
        if (message.type === "gate-native-entry-header" && path === "/gate" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (b === null) { setEntryHeader(null); return; }
          if (!b || !Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.title !== "string" || typeof b.backLabel !== "string" || !Array.isArray(b.statuses) || !b.statuses.every((status: unknown) => typeof status === "string")) return;
          setEntryHeader(b);
          web.current?.injectJavaScript('document.getElementById("gate-entry-header-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-entry-workday" && path === "/gate" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.data;
          if (!b) { setGateEntryWorkday(null); return; }
          if (![b.top,b.left,b.width,b.height,b.siteId].every(Number.isFinite) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || ![b.sites,b.gateId,b.gateName,b.gpsStatus,b.gpsLabel,b.gpsDetail].every(value => typeof value === "string") || !["verified","mismatch","unavailable"].includes(b.gpsStatus)) return;
          const sites = JSON.parse(b.sites) as GateEntryWorkdayData["sites"];
          if (!Array.isArray(sites) || sites.length > 500 || !sites.every(site => Number.isSafeInteger(site.id) && site.id > 0 && typeof site.name === "string")) return;
          setGateEntryWorkday({top:b.top,left:b.left,width:b.width,height:b.height,active:b.active,data:{sites,siteId:b.siteId,gateId:b.gateId,gateName:b.gateName,gpsStatus:b.gpsStatus,gpsLabel:b.gpsLabel,gpsDetail:b.gpsDetail}});
          web.current?.injectJavaScript(`document.getElementById('gate-entry-workday-native-slot')?.style.setProperty('opacity',${b.active ? "'0'" : "'1'"}); true;`);
          return;
        }
        if (message.type === "gate-native-presence-card" && path === "/gate" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.data as GatePresenceCard | null;
          if (!b) { setGatePresenceCard(null); return; }
          if (![b.top,b.left,b.width,b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || !Array.isArray(b.tabs) || b.tabs.length !== 4 || !Array.isArray(b.items) || b.items.length > 500 || (b.dialog && (!Array.isArray(b.dialog.items) || b.dialog.items.length > 300))) return;
          setGatePresenceCard(b);
          web.current?.injectJavaScript(`document.querySelector('#gate-activity-panel [data-testid="gate-on-site-card"]')?.style.setProperty('opacity',${b.active ? "'0'" : "'1'"}); true;`);
          return;
        }
        if (message.type === "gate-native-entry-card" && path === "/gate" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.data;
          if (!b) { setGateEntryCard(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" ||
            ![b.title,b.switchLabel,b.checkInLabel,b.resetLabel,b.platePhotoLabel,b.vehiclePhotoLabel,b.plateState,b.preferredStates,b.plateStateError,b.memoryField,b.suggestions,b.error,b.lastDriver].every(value => typeof value === "string") ||
            !Array.isArray(b.fields) || b.fields.length > 12 || !b.fields.every((field: GateEntryCard["fields"][number]) => typeof field.id === "string" && field.id.startsWith("gate-") && typeof field.label === "string" && typeof field.value === "string" && typeof field.disabled === "boolean" && typeof field.required === "boolean" && (field.options === undefined || Array.isArray(field.options) && field.options.every(option => typeof option.value === "string" && typeof option.label === "string" && typeof option.disabled === "boolean"))) ||
            !Array.isArray(b.notices) || !b.notices.every((notice: unknown) => typeof notice === "string") || typeof b.siteLoading !== "boolean" || b.recognition && (typeof b.recognition.preview !== "string" || b.recognition.preview.length > 20_000_000 || b.recognition.preview && !b.recognition.preview.startsWith("data:image/") || !Number.isFinite(b.recognition.width) || !Number.isFinite(b.recognition.height))) return;
          const preferredStates = JSON.parse(b.preferredStates) as string[];
          const suggestions = JSON.parse(b.suggestions) as GateEntryCard["suggestions"];
          if (!Array.isArray(preferredStates) || !preferredStates.every(value => typeof value === "string") || !Array.isArray(suggestions) || suggestions.length > 20 || !suggestions.every(item => (typeof item.id === "string" || typeof item.id === "number") && typeof item.label === "string" && typeof item.detail === "string")) return;
          setGateEntryCard({top:b.top,left:b.left,width:b.width,height:b.height,active:b.active,data:{title:b.title,switchLabel:b.switchLabel,checkInLabel:b.checkInLabel,checkInDisabled:b.checkInDisabled,resetLabel:b.resetLabel,resetDisabled:b.resetDisabled,platePhotoLabel:b.platePhotoLabel,platePhotoDisabled:b.platePhotoDisabled,vehiclePhotoLabel:b.vehiclePhotoLabel,vehiclePhotoDisabled:b.vehiclePhotoDisabled,plateState:b.plateState,preferredStates,plateStateError:b.plateStateError,fields:b.fields,memoryField:b.memoryField,suggestions:suggestions.map(item => ({...item,id:String(item.id)})),arrival:b.arrival,error:b.error,voice:b.voice,previous:b.previous,lastDriver:b.lastDriver,notices:b.notices,siteLoading:b.siteLoading,recognition:b.recognition,es:b.es}});
          web.current?.injectJavaScript(`document.querySelector('#gate-entry-panel [data-testid="gate-new-entry-card"]')?.style.setProperty('opacity',${b.active ? "'0'" : "'1'"}); true;`);
          return;
        }
        if (message.type === "gate-native-map-canvas" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setMapCanvasCard(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.accessToken !== "string" || b.accessToken.length > 512 || (b.accessToken && !b.accessToken.startsWith("pk.")) ||
            !["street","satellite","dark"].includes(b.styleKind) || !Number.isSafeInteger(b.cameraRevision) || ![b.points,b.fitPoints,b.lines,b.circles,b.center,b.pinDetail ?? "",b.equipmentDetail ?? ""].every(value => typeof value === "string") ||
            !Array.isArray(b.menu) || b.menu.length > 400 || !b.menu.every((item: GateMapCanvas["menu"][number]) => typeof item.id === "string" && item.id.startsWith("gate-map-menu-") && typeof item.label === "string" && ["summary","button","text"].includes(item.kind) && typeof item.disabled === "boolean" && Number.isSafeInteger(item.depth))) return;
          const points = JSON.parse(b.points) as GateMapCanvas["points"];
          const fitPoints = JSON.parse(b.fitPoints) as GateMapCanvas["fitPoints"];
          const lines = JSON.parse(b.lines) as GateMapCanvas["lines"];
          const circles = JSON.parse(b.circles) as GateMapCanvas["circles"];
          const center = JSON.parse(b.center) as GateMapCanvas["center"];
          const pinDetail = b.pinDetail ? JSON.parse(b.pinDetail) as GateMapCanvas["pinDetail"] : null;
          const equipmentDetail = b.equipmentDetail ? JSON.parse(b.equipmentDetail) as GateMapCanvas["equipmentDetail"] : null;
          const validPoint = (item: GateMapCanvas["points"][number]) => item && typeof item.id === "string" && Number.isFinite(item.latitude) && Math.abs(item.latitude) <= 90 && Number.isFinite(item.longitude) && Math.abs(item.longitude) <= 180;
          if (!Array.isArray(points) || points.length > 2000 || !points.every(validPoint) || !Array.isArray(fitPoints) || !fitPoints.every(validPoint) || !Array.isArray(lines) || lines.length > 2000 || !lines.every(line => typeof line.id === "string" && Array.isArray(line.coordinates) && line.coordinates.every(pair => Array.isArray(pair) && pair.length === 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))) || !Array.isArray(circles) || !circles.every(circle => validPoint(circle) && Number.isFinite(circle.radiusMeters)) || center !== null && (!Array.isArray(center) || center.length !== 2 || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) || pinDetail && (typeof pinDetail.id !== "string" || typeof pinDetail.label !== "string" || typeof pinDetail.notes !== "string" || !Number.isFinite(pinDetail.latitude) || !Number.isFinite(pinDetail.longitude) || typeof pinDetail.createdAt !== "string" || typeof pinDetail.historical !== "boolean" || typeof pinDetail.pending !== "boolean" || typeof pinDetail.error !== "string" || typeof pinDetail.es !== "boolean") || equipmentDetail && (typeof equipmentDetail.id !== "string" || typeof equipmentDetail.name !== "string" || !Array.isArray(equipmentDetail.lines) || equipmentDetail.lines.length > 15 || !equipmentDetail.lines.every(line=>typeof line === "string") || typeof equipmentDetail.linkLabel !== "string" || typeof equipmentDetail.href !== "string" || !equipmentDetail.href.startsWith('/work-hub/assets') || !Number.isFinite(equipmentDetail.latitude) || !Number.isFinite(equipmentDetail.longitude))) return;
          const nativeMapEnabled = Boolean(b.accessToken || readMapboxAccessToken());
          setMapCanvasCard({top:b.top,left:b.left,width:b.width,height:b.height,active:b.active && nativeMapEnabled,data:{points,fitPoints,lines,circles,accessToken:b.accessToken,center,selectedPointId:b.selectedPointId,styleKind:b.styleKind,cameraRevision:b.cameraRevision,expanded:b.expanded,instant:b.instant,showLinks:b.showLinks,showSiteLocations:b.showSiteLocations,staffVisible:b.staffVisible,equipmentVisible:b.equipmentVisible,settingsOpen:b.settingsOpen,revealOpen:b.revealOpen,equipmentOpen:b.equipmentOpen,droppingGate:b.droppingGate,droppingPin:b.droppingPin,movingPointId:b.movingPointId,managementAllowed:b.managementAllowed,siteAvailable:b.siteAvailable,es:b.es,pinDetail,equipmentDetail,menu:b.menu}});
          web.current?.injectJavaScript(`(() => { const card=document.getElementById('gate-map-canvas-native-slot'); if(card) card.style.opacity=${b.active && nativeMapEnabled ? "'0'" : "'1'"}; })(); true;`);
          return;
        }
        if (message.type === "gate-native-map-statuses" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const allowed = ["center-error", "pin-error", "moving-pin", "removed-pin", "dropping-gate", "dropping-pin", "coverage-loading", "coverage-error", "no-points", "location-note", "vehicle-feed-error", "vehicles-truncated"];
          if (!Array.isArray(message.strips) || message.strips.length > allowed.length || !message.strips.every((item: GateMapStatusOverlay) => item && Number.isFinite(item.top) && Number.isFinite(item.left) && Number.isFinite(item.width) && Number.isFinite(item.height) && item.width > 0 && item.height > 0 && typeof item.active === "boolean" && item.status && allowed.includes(item.status.id) && typeof item.status.message === "string" && item.status.message.length <= 1200 && (item.status.actionLabel === null || typeof item.status.actionLabel === "string" && item.status.actionLabel.length <= 80) && typeof item.status.actionDisabled === "boolean" && ["normal", "error", "warning"].includes(item.status.tone))) return;
          setMapStatuses(message.strips);
          web.current?.injectJavaScript('document.querySelectorAll("[data-gate-map-status-native-slot]").forEach(strip => strip.style.setProperty("opacity","0")); true;');
          return;
        }
        if (message.type === "gate-native-map-page-headers" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (!Array.isArray(message.headers) || message.headers.length > 2 || !message.headers.every((item: GateMapPageHeaderOverlay) => item && typeof item.expanded === "boolean" && Number.isFinite(item.top) && Number.isFinite(item.left) && Number.isFinite(item.width) && Number.isFinite(item.height) && item.width > 0 && item.height > 0 && typeof item.active === "boolean" && typeof item.title === "string" && typeof item.backLabel === "string" && typeof item.fallbackHref === "string" && item.fallbackHref.startsWith("/gate/change-over"))) return;
          setMapPageHeaders(message.headers);
          web.current?.injectJavaScript('document.querySelectorAll("#gate-map-page-header-native-slot,#gate-map-expanded-page-header-native-slot").forEach(header => header.style.setProperty("opacity","0")); true;');
          return;
        }
        if (message.type === "gate-native-map-header" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setMapHeaderCard(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.sites !== "string" || !Number.isSafeInteger(b.siteId) || typeof b.gateId !== "string" || typeof b.gateName !== "string" || typeof b.showTitle !== "boolean" || typeof b.showSelector !== "boolean") return;
          const sites = JSON.parse(b.sites) as { id: number; name: string }[];
          if (!Array.isArray(sites) || !sites.every(site => Number.isSafeInteger(site.id) && typeof site.name === "string")) return;
          setMapHeaderCard({ ...b, sites });
          web.current?.injectJavaScript('document.getElementById("gate-map-header-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-map-gate-form" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const data = message.data;
          if (data === null) { setMapGateForm(null); return; }
          if (!data || typeof data.title !== "string" || !Array.isArray(data.items) || !data.items.every((item: any) => typeof item.id === "string" && typeof item.kind === "string" && typeof item.label === "string")) return;
          setMapGateForm(data);
          web.current?.injectJavaScript('document.querySelector(".gate-administration-flyout")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-map-pin-form" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (message.data === null) { setMapPinForm(null); return; }
          const data = message.data;
          if (!data || typeof data.pin !== "string" || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude) || !Number.isSafeInteger(data.siteId) || typeof data.sites !== "string") return;
          const pin = data.pin ? JSON.parse(data.pin) as GateMapPinForm["pin"] : null;
          const sites = JSON.parse(data.sites) as GateMapPinForm["sites"];
          if (!Array.isArray(sites) || !sites.every(site => Number.isSafeInteger(site.id) && typeof site.name === "string") || !sites.some(site => site.id === data.siteId) || pin && (typeof pin.id !== "string" || !Number.isSafeInteger(pin.siteId) || typeof pin.label !== "string" || typeof pin.notes !== "string" || !Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude))) return;
          setMapPinForm({ pin, latitude: data.latitude, longitude: data.longitude, siteId: data.siteId, sites });
          web.current?.injectJavaScript('document.getElementById("gate-map-pin-native-slot")?.closest("[role=dialog]")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-map-activity-popup" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.data;
          if (b === null) { setMapActivityPopup(null); return; }
          if (!b || !Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 ||
            typeof b.stationId !== "string" || !Number.isSafeInteger(b.siteId) || b.siteId <= 0 || typeof b.siteName !== "string" || typeof b.gateName !== "string" ||
            typeof b.gateActive !== "boolean" || b.latitude !== null && !Number.isFinite(b.latitude) || b.longitude !== null && !Number.isFinite(b.longitude) ||
            typeof b.historical !== "boolean" || typeof b.es !== "boolean" || typeof b.activity !== "string" || typeof b.loading !== "boolean" || typeof b.error !== "boolean" || typeof b.refreshing !== "boolean" ||
            typeof b.statusLabel !== "string" || typeof b.statusActionLabel !== "string" || typeof b.confirmation !== "string" || typeof b.confirmationAction !== "string" ||
            typeof b.confirmationError !== "string" || typeof b.statusBusy !== "boolean" || typeof b.editAllowed !== "boolean") return;
          const activity = JSON.parse(b.activity) as GateMapActivityPopupData["activity"];
          if (activity && (activity.stationId !== b.stationId || activity.siteId !== b.siteId || !["gate_attributed", "linked_gates"].includes(activity.scope) || !activity.metrics ||
            ![activity.metrics.checkIns, activity.metrics.checkOuts, activity.metrics.pendingAdmission, activity.metrics.itemsToReview].every(value => Number.isSafeInteger(value) && value >= 0))) return;
          setMapActivityPopup({ top: b.top, left: b.left, width: b.width, height: b.height, active: true,
            data: { stationId: b.stationId, siteId: b.siteId, siteName: b.siteName, gateName: b.gateName, active: b.gateActive,
              latitude: b.latitude, longitude: b.longitude, historical: b.historical, es: b.es, activity, loading: b.loading, error: b.error, refreshing: b.refreshing,
              statusLabel: b.statusLabel, statusActionLabel: b.statusActionLabel, confirmation: b.confirmation, confirmationAction: b.confirmationAction,
              confirmationError: b.confirmationError, statusBusy: b.statusBusy, editAllowed: b.editAllowed } });
          web.current?.injectJavaScript('document.getElementById("gate-map-activity-popup-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-map-administration" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.data;
          if (b === null) { setMapAdminCard(null); return; }
          if (!b || !Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" ||
            typeof b.title !== "string" || typeof b.subtitle !== "string" || !["create", "edit"].includes(b.mode) || typeof b.es !== "boolean" || typeof b.busy !== "boolean" || !Array.isArray(b.items) || b.items.length > 200 ||
            !b.items.every((item: GateAdminCard["items"][number]) => typeof item.id === "string" && item.id.startsWith("gate-admin-") && ["heading", "text", "field", "button"].includes(item.kind) && typeof item.label === "string" &&
              (item.kind !== "field" || typeof item.value === "string" && ["input", "select", "textarea"].includes(item.inputKind ?? "") && (item.options === undefined || Array.isArray(item.options) && item.options.every(option => typeof option.value === "string" && typeof option.label === "string" && typeof option.disabled === "boolean"))))) return;
          setMapAdminCard({ top: b.top, left: b.left, width: b.width, height: b.height, active: b.active, data: { title: b.title, subtitle: b.subtitle, mode: b.mode, es: b.es, busy: b.busy, items: b.items } });
          web.current?.injectJavaScript('(() => { const card=document.querySelector(".gate-map-page > .gate-administration-card"); if(card){card.style.opacity="0";card.style.overflow="hidden";card.style.pointerEvents="none";} })(); true;');
          return;
        }
        if (message.type === "gate-native-shift-notes-page-header" && path === "/gate/shift-notes" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (b === null) { setShiftNotesPageHeader(null); return; }
          if (!b || !Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.title !== "string" || b.subtitle !== undefined && typeof b.subtitle !== "string" || typeof b.backLabel !== "string" || typeof b.fallbackHref !== "string" || !b.fallbackHref.startsWith("/gate/change-over")) return;
          setShiftNotesPageHeader(b);
          web.current?.injectJavaScript('document.getElementById("gate-shift-notes-page-header-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-all-shift-notes-link" && path === "/gate/shift-notes" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (b === null) { setShiftNotesAllLink(null); return; }
          if (!b || !Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.label !== "string" || typeof b.href !== "string") return;
          const destination = new URL(b.href, url.origin);
          if (destination.origin !== url.origin || destination.pathname !== "/gate/shift-notes" || destination.searchParams.has("handoffId")) return;
          setShiftNotesAllLink(b);
          web.current?.injectJavaScript('document.getElementById("gate-all-shift-notes-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-linked-note-statuses" && path === "/gate/shift-notes" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (!Array.isArray(message.strips) || message.strips.length > 5) return;
          const strips: (ActivityCardBounds & { status: GateDashboardStatus })[] = [];
          for (const strip of message.strips) {
            if (!strip || !["offline", "loading", "error", "no-sites", "no-notes"].includes(strip.id) || !Number.isFinite(strip.top) || !Number.isFinite(strip.left) || !Number.isFinite(strip.width) || !Number.isFinite(strip.height) || strip.width <= 0 || strip.height <= 0 || typeof strip.active !== "boolean" || typeof strip.message !== "string" || strip.message.length > 1000 || typeof strip.retryLabel !== "string" || strip.retryLabel.length > 80) return;
            strips.push({ top: strip.top, left: strip.left, width: strip.width, height: strip.height, active: strip.active, status: { id: strip.id, message: strip.message, retryLabel: strip.retryLabel } });
          }
          setLinkedNoteStatuses(strips);
          return;
        }
        if (message.type === "gate-native-shift-notes-header" && path === "/gate/shift-notes" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setShiftNotesHeader(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.sites !== "string" || typeof b.gates !== "string" || !Number.isSafeInteger(b.siteId) || typeof b.gateId !== "string" || typeof b.gateName !== "string" || typeof b.filters !== "string" || typeof b.search !== "string" || typeof b.loading !== "boolean" || typeof b.error !== "boolean") return;
          const sites = JSON.parse(b.sites) as { id: number; name: string }[];
          const gates = JSON.parse(b.gates) as GateShiftNotesGate[];
          const filters = JSON.parse(b.filters) as GateLogExportFilters | null;
          if (!Array.isArray(sites) || !sites.every(site => Number.isSafeInteger(site.id) && typeof site.name === "string") || !Array.isArray(gates) || !gates.every(gate => typeof gate.id === "string" && typeof gate.name === "string" && Number.isSafeInteger(gate.siteId) && typeof gate.siteName === "string") || filters !== null && (!Number.isSafeInteger(filters.siteId) || filters.range !== "30d" || filters.recordType !== "all" || filters.siteIds !== undefined && (!Array.isArray(filters.siteIds) || !filters.siteIds.every(Number.isSafeInteger)))) return;
          setShiftNotesHeader({ ...b, sites, gates, filters });
          web.current?.injectJavaScript('(() => { const slot=document.getElementById("gate-shift-notes-header-native-slot"); if(slot){slot.style.opacity="0";slot.style.overflow="hidden";slot.style.pointerEvents="none";} })(); true;');
          return;
        }
        if (message.type === "gate-native-log-card-heading" && path === "/gate/history" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setGateLogCardHeading(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.title !== "string") return;
          setGateLogCardHeading(b);
          web.current?.injectJavaScript('document.getElementById("gate-log-card-heading-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-log-status" && path === "/gate/history" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setGateLogStatus(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.loading !== "boolean" || typeof b.messages !== "string") return;
          const messages = JSON.parse(b.messages) as GateLogStatus["messages"];
          if (!Array.isArray(messages) || messages.length > 8 || !messages.every(item => item && typeof item.text === "string" && item.text.length < 1000 && ["error", "muted"].includes(item.tone))) return;
          setGateLogStatus({ top: b.top, left: b.left, width: b.width, height: b.height, active: b.active, status: { loading: b.loading, messages } });
          web.current?.injectJavaScript('document.getElementById("gate-log-status-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-log-movements" && path === "/gate/history" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setGateLogMovements(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || !Number.isInteger(b.siteId) || b.siteId <= 0 || typeof b.gateId !== "string" || typeof b.expanded !== "boolean") return;
          setGateLogMovements(b);
          web.current?.injectJavaScript('document.getElementById("gate-log-movements-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-log-pages" && path === "/gate/history" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setGateLogPages(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || !b.pages || ![b.pages.start,b.pages.end,b.pages.total,b.pages.page,b.pages.lastPage].every(Number.isInteger) || b.pages.total < 0 || b.pages.page < 0 || b.pages.lastPage < 0) return;
          setGateLogPages(b);
          web.current?.injectJavaScript('document.getElementById("gate-log-pages-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-log-export" && path === "/gate/history" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setGateLogExport(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.filters !== "string" || typeof b.disabled !== "boolean") return;
          const filters = JSON.parse(b.filters) as GateLogExportFilters | null;
          if (filters !== null && (!filters || !Number.isInteger(filters.siteId) || filters.siteId < 0 || typeof filters.range !== "string" || typeof filters.recordType !== "string" || filters.siteIds !== undefined && (!Array.isArray(filters.siteIds) || !filters.siteIds.every(Number.isInteger)))) return;
          setGateLogExport({ top: b.top, left: b.left, width: b.width, height: b.height, active: b.active, filters, disabled: b.disabled });
          web.current?.injectJavaScript('document.getElementById("gate-log-export-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-log-header" && path === "/gate/history" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setGateLogHeader(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.title !== "string" || typeof b.subtitle !== "string" || typeof b.backLabel !== "string" || typeof b.fallbackHref !== "string" || !b.fallbackHref.startsWith("/gate/change-over")) return;
          setGateLogHeader(b);
          web.current?.injectJavaScript('document.getElementById("gate-log-header-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-log-select" && path === "/gate/history" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setGateLogSelect(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.sites !== "string" || typeof b.gates !== "string" || !Number.isInteger(b.siteId) || b.siteId < 0 || typeof b.gateId !== "string" || typeof b.gateName !== "string") return;
          const sites = JSON.parse(b.sites) as { id: number; name: string }[];
          const gates = JSON.parse(b.gates) as { id: string; name: string; siteId: number }[];
          if (!Array.isArray(sites) || sites.length > 500 || !sites.every(site => Number.isInteger(site.id) && site.id > 0 && typeof site.name === "string") || !Array.isArray(gates) || gates.length > 2000 || !gates.every(gate => typeof gate.id === "string" && typeof gate.name === "string" && Number.isInteger(gate.siteId) && gate.siteId > 0)) return;
          setGateLogSelect({ top: b.top, left: b.left, width: b.width, height: b.height, active: b.active, sites, gates, siteId: b.siteId, gateId: b.gateId, gateName: b.gateName });
          web.current?.injectJavaScript('document.getElementById("gate-log-select-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-log-query" && path === "/gate/history" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setGateLogQuery(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || !b.query || typeof b.query.search !== "string" || typeof b.query.range !== "string" || typeof b.query.recordType !== "string" || typeof b.query.recordTypeDisabled !== "boolean" || !(b.query.customWindow === null || typeof b.query.customWindow === "string")) return;
          setGateLogQuery(b);
          web.current?.injectJavaScript('document.getElementById("gate-log-query-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-log-filter" && path === "/gate/history" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setGateLogFilter(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || !["arrivals", "on_site", "departures", "all"].includes(b.selected)) return;
          setGateLogFilter(b);
          web.current?.injectJavaScript('document.getElementById("gate-log-filter-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-log-records" && path === "/gate/history" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (!Array.isArray(message.cards) || message.cards.length > 50 || !Array.isArray(message.arrivals) || message.arrivals.length > 50) return;
          const cards: GateLogRecordOverlay[] = [];
          for (const b of message.cards) {
            if (!b || typeof b.id !== "string" || !b.id || typeof b.record !== "string" || !Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean") return;
            const record = JSON.parse(b.record) as GateLogRecord;
            if (record.id !== b.id || typeof record.name !== "string" || typeof record.description !== "string" || typeof record.status !== "string" || typeof record.overdue !== "boolean" || !Array.isArray(record.flags) || typeof record.actionLabel !== "string" || typeof record.actionDisabled !== "boolean") return;
            cards.push({ id: b.id, record, top: b.top, left: b.left, width: b.width, height: b.height, active: b.active });
          }
          const arrivals: GateLogArrivalOverlay[] = [];
          for (const b of message.arrivals) {
            if (!b || typeof b.id !== "string" || !b.id || typeof b.arrival !== "string" || !Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean") return;
            const arrival = JSON.parse(b.arrival) as GateLogArrival;
            if (arrival.id !== b.id || typeof arrival.name !== "string" || typeof arrival.description !== "string" || typeof arrival.status !== "string" || !Array.isArray(arrival.flags) || typeof arrival.detail !== "string" || typeof arrival.eta !== "string" || !(arrival.actionLabel === null || typeof arrival.actionLabel === "string") || typeof arrival.isNew !== "boolean" || !(arrival.previewDetail == null || arrival.previewDetail.runId === arrival.runId && arrival.previewDetail.siteLocationId === arrival.siteId && Array.isArray(arrival.previewDetail.loads) && Array.isArray(arrival.previewDetail.events) && Array.isArray(arrival.previewDetail.linkedVisitIds))) return;
            arrivals.push({ id: b.id, arrival, top: b.top, left: b.left, width: b.width, height: b.height, active: b.active });
          }
          setGateLogRecords(cards);
          setGateLogArrivals(arrivals);
          if (cards.length) web.current?.injectJavaScript('document.querySelectorAll("[data-gate-log-native-record]").forEach(card => card.style.setProperty("opacity","0")); true;');
          if (arrivals.length) web.current?.injectJavaScript('document.querySelectorAll("[data-gate-log-native-arrival]").forEach(card => card.style.setProperty("opacity","0")); true;');
          return;
        }
        if (message.type === "gate-native-focus-targets" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (!Array.isArray(message.targets) || !message.targets.every((id: unknown) => typeof id === "string" && ["gate-site","choose-gate","gate-name","location-method","gate-latitude","gate-longitude","gate-address","save-gate","remove-gate","confirm-remove"].includes(id))) return;
          setGateMapFocusTargets(message.targets);
          return;
        }
        if (message.type === "gate-native-map-time" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setMapTimeControl(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.liveConnected !== "boolean" || !(b.instant === null || typeof b.instant === "string" && !Number.isNaN(Date.parse(b.instant)))) return;
          setMapTimeControl(b);
          web.current?.injectJavaScript('document.getElementById("gate-map-time-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-confirmed-locations" && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setConfirmedLocations(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.visits !== "string") return;
          const visits = JSON.parse(b.visits) as GateConfirmedVisit[];
          if (!Array.isArray(visits) || !visits.every(visit => visit && typeof visit.id === "string" && typeof visit.name === "string" && (visit.location === null || typeof visit.location === "string") && (visit.destination === null || typeof visit.destination === "string"))) return;
          setConfirmedLocations({ top: b.top, left: b.left, width: b.width, height: b.height, active: b.active, visits });
          web.current?.injectJavaScript('document.getElementById("gate-map-confirmed-locations-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-incident-report" && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const data = message.data;
          if (data === null) { setIncidentReport(null); return; }
          const valid = data && typeof data.title === "string" && typeof data.description === "string" && typeof data.siteId === "string" && Array.isArray(data.sites) && data.sites.every((site: any) => typeof site.id === "string" && typeof site.name === "string") && Array.isArray(data.eventTypes) && data.eventTypes.every((type: any) => typeof type.id === "string" && typeof type.label === "string" && typeof type.selected === "boolean") && typeof data.incidentTitle === "string" && typeof data.incidentDescription === "string" && typeof data.anonymous === "boolean" && typeof data.stopWork === "boolean" && typeof data.submitting === "boolean";
          if (!valid) return;
          setIncidentReport(data);
          web.current?.injectJavaScript('document.querySelector("[data-native-gate-incident=\"1\"][data-state=open]")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-incident-success" && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path && typeof message.title === "string" && typeof message.description === "string") {
          setIncidentReport(null);
          setIncidentConfirmation({ title: message.title, description: message.description });
          return;
        }
        if (message.type === "gate-native-assume-watch" && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const data = message.data;
          if (data === null) { setAssumeWatch(null); return; }
          if (!data || typeof data.title !== "string" || typeof data.description !== "string" || typeof data.siteGate !== "string" || typeof data.loading !== "boolean" || typeof data.loadError !== "boolean" || typeof data.confirmLabel !== "string" || typeof data.confirmDisabled !== "boolean" || typeof data.discrepancy !== "string" || !Array.isArray(data.handoverFacts) || !data.handoverFacts.every((text: unknown) => typeof text === "string") || !Array.isArray(data.handoverOpenItems) || !data.handoverOpenItems.every((text: unknown) => typeof text === "string") || !Array.isArray(data.currentFacts) || !data.currentFacts.every((text: unknown) => typeof text === "string") || !Array.isArray(data.areas) || !data.areas.every((area: any) => typeof area.area === "string" && Number.isFinite(area.count))) return;
          setAssumeWatch(data);
          web.current?.injectJavaScript('document.querySelector("[data-native-gate-assume=\"1\"][data-state=open]")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-dashboard-header" && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          if (!b) { setDashboardHeader(null); return; }
          if (!Number.isFinite(b.top) || !Number.isFinite(b.left) || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width <= 0 || b.height <= 0 || typeof b.active !== "boolean" || typeof b.title !== "string" || typeof b.subtitle !== "string") return;
          setDashboardHeader(b);
          web.current?.injectJavaScript('document.getElementById("gate-dashboard-header-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-shift-notes" && path === "/gate/shift-notes" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (!Array.isArray(message.cards) || message.cards.length > 50) return;
          const cards: ShiftNoteOverlay[] = [];
          for (const entry of message.cards) {
            if (!entry || typeof entry.id !== "string" || !entry.id || typeof entry.note !== "string" || !Number.isFinite(entry.top) || !Number.isFinite(entry.left) || !Number.isFinite(entry.width) || !Number.isFinite(entry.height) || entry.width <= 0 || entry.height <= 0 || typeof entry.active !== "boolean") return;
            const note = JSON.parse(entry.note) as ShiftNote;
            if (note.id !== entry.id || !note.snapshot || !Array.isArray(note.snapshot.openItems) || !note.snapshot.metrics) return;
            cards.push({ id: entry.id, note, top: entry.top, left: entry.left, width: entry.width, height: entry.height, active: entry.active });
          }
          setShiftNoteCards(cards);
          web.current?.injectJavaScript('document.querySelectorAll("[data-shift-note-native-slot]").forEach(card => card.style.setProperty("opacity","0")); true;');
          if (message.auditCard) {
            const audit = message.auditCard;
            if (typeof audit.actions === "string" && Number.isFinite(audit.top) && Number.isFinite(audit.left) && Number.isFinite(audit.width) && Number.isFinite(audit.height) && audit.width > 0 && audit.height > 0 && typeof audit.active === "boolean") {
              const actions = JSON.parse(audit.actions) as ShiftAuditAction[];
              if (Array.isArray(actions) && actions.every(action => typeof action.id === "string" && typeof action.actor_name === "string" && typeof action.text === "string" && typeof action.kind === "string" && typeof action.created_at === "string")) {
                setShiftAuditCard({ actions, top: audit.top, left: audit.left, width: audit.width, height: audit.height, active: audit.active });
                web.current?.injectJavaScript('document.getElementById("gate-shift-audit-native-slot")?.style.setProperty("opacity","0"); true;');
              }
            }
          } else setShiftAuditCard(null);
          return;
        }
        if ((message.type === "gate-native-map-presence-layout" || message.type === "gate-native-map-presence-data") && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (message.type === "gate-native-map-presence-layout") {
            const b = message.bounds;
            const valid = b && Number.isFinite(b.top) && Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0;
            setMapPresenceCard(valid ? b : null);
            if (valid && mapPresenceData) web.current?.injectJavaScript('document.querySelector("[data-gate-site-presence-native-slot]")?.style.setProperty("opacity","0"); true;');
          } else if (typeof message.sites === "string" && typeof message.recordHistoryHrefs === "string" && typeof message.historyBaseHref === "string" && message.historyBaseHref.startsWith("/gate/history?") && typeof message.loading === "boolean") {
            const sites = JSON.parse(message.sites) as { siteId: number; siteName: string }[];
            const links = JSON.parse(message.recordHistoryHrefs) as Record<string, string>;
            if (Array.isArray(sites) && sites.every(site => Number.isInteger(site.siteId) && typeof site.siteName === "string") && links && typeof links === "object" && !Array.isArray(links) && Object.values(links).every(href => typeof href === "string" && href.startsWith("/gate/history?"))) {
              setMapPresenceData({ snapshot: message.snapshot ? JSON.parse(message.snapshot) as ChangeOverSnapshot : null, loading: message.loading, sites, recordHistoryHrefs: links, historyBaseHref: message.historyBaseHref });
              web.current?.injectJavaScript('document.querySelector("[data-gate-site-presence-native-slot]")?.style.setProperty("opacity","0"); true;');
            }
          }
          return;
        }
        if ((message.type === "gate-native-map-activity-layout" || message.type === "gate-native-map-activity-data") && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (message.type === "gate-native-map-activity-layout") {
            const b = message.bounds;
            const valid = b && Number.isFinite(b.top) && Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0;
            setMapActivityCard(valid ? b : null);
            if (valid && mapActivityData) web.current?.injectJavaScript('document.getElementById("gate-map-activity-native-slot")?.style.setProperty("opacity","0"); true;');
          } else if (typeof message.historyBaseHref === "string" && message.historyBaseHref.startsWith("/gate/history?") && typeof message.recordHistoryHrefs === "string" && typeof message.showAllLogLink === "boolean" && ["metrics", "fallback"].includes(message.mode) && typeof message.status === "string" && message.status.length <= 500 && ["normal", "error"].includes(message.statusTone)) {
            const links = JSON.parse(message.recordHistoryHrefs) as Record<string, string>;
            if (links && typeof links === "object" && !Array.isArray(links) && Object.values(links).every(href => typeof href === "string" && href.startsWith("/gate/history?"))) {
              setMapActivityData({ snapshot: message.snapshot ? JSON.parse(message.snapshot) as ChangeOverSnapshot : null, historyBaseHref: message.historyBaseHref, recordHistoryHrefs: links, showAllLogLink: message.showAllLogLink, mode: message.mode, status: message.status, statusTone: message.statusTone });
              web.current?.injectJavaScript('document.getElementById("gate-map-activity-native-slot")?.style.setProperty("opacity","0"); true;');
            }
          }
          return;
        }
        if ((message.type === "gate-native-map-staff-layout" || message.type === "gate-native-map-staff-data") && path === "/gate/map" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (message.type === "gate-native-map-staff-layout") {
            const b = message.bounds;
            const valid = b && Number.isFinite(b.top) && Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0;
            setMapStaffCard(valid ? b : null);
            if (valid && mapStaffData) web.current?.injectJavaScript('document.getElementById("gate-map-staff-native-slot")?.style.setProperty("opacity","0"); true;');
          } else if (typeof message.groups === "string" && typeof message.locationError === "string" && ["name", "nearest", "first", "latest"].includes(message.sort)) {
            const groups = JSON.parse(message.groups) as MapStaffGroup[];
            if (Array.isArray(groups) && groups.every(group => ["watch", "call", "other"].includes(group.id) && Array.isArray(group.people))) {
              setMapStaffData({ groups, locationError: message.locationError, sort: message.sort });
              web.current?.injectJavaScript('document.getElementById("gate-map-staff-native-slot")?.style.setProperty("opacity","0"); true;');
            }
          }
          return;
        }
        if ((message.type === "gate-native-supervisor-layout" || message.type === "gate-native-supervisor-data") && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (message.type === "gate-native-supervisor-layout") {
            const b = message.bounds;
            const valid = b && Number.isFinite(b.top) && Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0;
            setSupervisorCard(valid ? b : null);
            if (valid && supervisorData) web.current?.injectJavaScript('document.getElementById("gate-supervisor-native-slot")?.style.setProperty("opacity","0"); true;');
          } else if (typeof message.stationId === "string" && typeof message.current === "string" && message.current) {
            setSupervisorData({ stationId: message.stationId, current: JSON.parse(message.current) as ChangeOverState });
            web.current?.injectJavaScript('document.getElementById("gate-supervisor-native-slot")?.style.setProperty("opacity","0"); true;');
          }
          return;
        }
        if ((message.type === "gate-native-handoff-layout" || message.type === "gate-native-handoff-data") && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (message.type === "gate-native-handoff-layout") {
            const b = message.bounds;
            const valid = b && Number.isFinite(b.top) && Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0;
            setHandoffCard(valid ? b : null);
            if (valid && handoffData) web.current?.injectJavaScript('document.getElementById("gate-handoff-native-slot")?.style.setProperty("opacity","0"); true;');
          } else if (typeof message.stationId === "string" && typeof message.current === "string" && (message.phase === "pending" || message.phase === "error" || ((message.phase === "ready" || message.phase === undefined) && message.current)) && typeof message.gatekeeperOnDuty === "boolean" && typeof message.online === "boolean" && typeof message.readError === "boolean" && typeof message.pendingWatch === "boolean") {
            setHandoffData({ stationId: message.stationId, phase: message.phase === "pending" || message.phase === "error" ? message.phase : "ready", current: message.current && message.phase !== "pending" && message.phase !== "error" ? JSON.parse(message.current) as ChangeOverState : null, gatekeeperOnDuty: message.gatekeeperOnDuty, online: message.online, readError: message.readError, pendingWatch: message.pendingWatch });
            web.current?.injectJavaScript('document.getElementById("gate-handoff-native-slot")?.style.setProperty("opacity","0"); true;');
          }
          return;
        }
        if ((message.type === "gate-native-watch-layout" || message.type === "gate-native-watch-data") && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (message.type === "gate-native-watch-layout") {
            const b = message.bounds;
            const valid = b && Number.isFinite(b.top) && Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0;
            setWatchCard(valid ? b : null);
            if (valid && watchData) web.current?.injectJavaScript('document.getElementById("gate-watch-native-slot")?.style.setProperty("opacity","0"); true;');
          } else if (typeof message.stationId === "string" && typeof message.current === "string" && (message.phase === "pending" || message.phase === "error" || ((message.phase === "ready" || message.phase === undefined) && message.current))) {
            setWatchData({ stationId: message.stationId, phase: message.phase === "pending" || message.phase === "error" ? message.phase : "ready", current: message.current && message.phase !== "pending" && message.phase !== "error" ? JSON.parse(message.current) as ChangeOverState : null });
            web.current?.injectJavaScript('document.getElementById("gate-watch-native-slot")?.style.setProperty("opacity","0"); true;');
          }
          return;
        }
        if (message.type === "gate-native-tasks-layout" && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          const valid = b && Number.isFinite(b.top) && Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0;
          setTasksCard(valid ? b : null);
          if (valid) web.current?.injectJavaScript('document.getElementById("gate-tasks-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-on-site-layout" && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          const valid = b && Number.isFinite(b.top) && Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0 && typeof b.allGates === "boolean";
          setOnSiteCard(valid ? b : null);
            if (valid && activityData) web.current?.injectJavaScript('document.getElementById("gate-on-site-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if ((message.type === "gate-native-activity-layout" || message.type === "gate-native-activity-data") && (path === "/gate/change-over" || path === "/gate/history") && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (message.type === "gate-native-activity-layout") {
            const b = message.bounds;
            const valid = b && Number.isFinite(b.top) && Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0;
            setActivityCard(valid ? b : null);
            if (valid && activityData) web.current?.injectJavaScript('document.getElementById("gate-activity-native-slot")?.style.setProperty("opacity","0"); true;');
          } else if (typeof message.historyBaseHref === "string" && message.historyBaseHref.startsWith("/gate/history?")) {
            const snapshot = message.snapshot ? JSON.parse(message.snapshot) as ChangeOverSnapshot : null;
            setActivityData({ snapshot, historyBaseHref: message.historyBaseHref, activityWindow: message.activityWindow === "24h" ? "24h" : undefined, scopeLabel: typeof message.scopeLabel === "string" ? message.scopeLabel : undefined });
            web.current?.injectJavaScript('document.getElementById("gate-activity-native-slot")?.style.setProperty("opacity","0"); document.getElementById("gate-on-site-native-slot")?.style.setProperty("opacity","0"); true;');
          }
          return;
        }
        if (message.type === "gate-native-workday-layout" && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          const valid = b && Number.isFinite(b.top) && Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0 && Number.isInteger(b.siteId) && b.siteId >= 0 && typeof b.stationId === "string" && typeof b.gateName === "string";
          setWorkdayCard(valid ? b : null);
          if (valid) web.current?.injectJavaScript('document.getElementById("gate-workday-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-dashboard-statuses" && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          if (!Array.isArray(message.strips) || message.strips.length > 5) return;
          const strips: (ActivityCardBounds & { status: GateDashboardStatus })[] = [];
          for (const strip of message.strips) {
            if (!strip || !["waiting", "offline", "loading", "error", "no-sites"].includes(strip.id) || !Number.isFinite(strip.top) || !Number.isFinite(strip.left) || !Number.isFinite(strip.width) || !Number.isFinite(strip.height) || strip.width <= 0 || strip.height <= 0 || typeof strip.active !== "boolean" || typeof strip.message !== "string" || strip.message.length > 1000 || typeof strip.retryLabel !== "string" || strip.retryLabel.length > 80) return;
            strips.push({ top: strip.top, left: strip.left, width: strip.width, height: strip.height, active: strip.active, status: { id: strip.id, message: strip.message, retryLabel: strip.retryLabel } });
          }
          setDashboardStatuses(strips);
          return;
        }
        if (message.type === "gate-native-admin-layout" && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const b = message.bounds;
          const valid = b && Number.isFinite(b.top) && Number.isFinite(b.left) && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width > 0 && b.height > 0 && typeof b.stationId === "string" && typeof b.gateGoDemo === "boolean";
          setAdminCard(valid ? b : null);
          if (valid) web.current?.injectJavaScript('document.getElementById("gate-admin-native-slot")?.style.setProperty("opacity","0"); true;');
          return;
        }
        if (message.type === "gate-native-admin-dialog" && path === "/gate/change-over" && Platform.OS === "ios" && message.channel === voiceChannel && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) {
          const dialog = message.dialog;
          const valid = dialog && typeof dialog.title === "string" && Array.isArray(dialog.items) && dialog.items.every((item: any) => typeof item.id === "string" && typeof item.kind === "string" && typeof item.label === "string");
          setAdminDialog(valid ? dialog : null);
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
            try { await companion.assistant.send(reference ? "Confirmed" : text!, "ios_text", reference, true); result={id:message.id,ok:true}; }
            catch(error) { result={id:message.id,ok:false,error:error instanceof Error ? error.message : "Could not send. Try again."}; }
            finally { companionSending.current=false; }
            web.current?.injectJavaScript('window.dispatchEvent(new CustomEvent("gate-companion-result",{detail:' + JSON.stringify(result) + '})); true;');
          })();
          return;
        }
        if (message.type === "gate-overlay-state" && message.channel === voiceChannel && typeof message.open === "boolean" && new URL(event.nativeEvent.url).origin === url.origin && new URL(event.nativeEvent.url).pathname === path) { setWebOverlayOpen(message.open); setWebOverlayOwner(path, message.open); return; }
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
    {entryHeader && <View pointerEvents={entryHeader.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-entry-header-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: entryHeader.top, left: entryHeader.left, width: entryHeader.width, opacity: entryHeader.active && !webOverlayOpen ? 1 : 0 }}><GateEntryHeaderNative title={entryHeader.title} backLabel={entryHeader.backLabel} statuses={entryHeader.statuses} onBack={() => router.canGoBack() ? pageBack() : router.replace("/change-over")} /></View>}
    {gateEntryWorkday && <View pointerEvents={gateEntryWorkday.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-entry-workday-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateEntryWorkday.top, left: gateEntryWorkday.left, width: gateEntryWorkday.width, opacity: gateEntryWorkday.active && !webOverlayOpen ? 1 : 0 }}><GateEntryWorkdayCard data={gateEntryWorkday.data} onSelection={(siteId,gateId) => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-entry-gate-selection',{detail:${JSON.stringify({siteId,gateId})}})); true;`)} /></View>}
    {gateLiveFlash && <View pointerEvents={gateLiveFlash.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-live-flash-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateLiveFlash.top, left: gateLiveFlash.left, width: gateLiveFlash.width, opacity: gateLiveFlash.active && !webOverlayOpen ? 1 : 0 }}><GateLiveFlashNative data={gateLiveFlash.data} onRefresh={() => web.current?.injectJavaScript(`document.querySelector('#gate-live-flash-native-slot [data-testid="live-connection-pill"]')?.click(); true;`)} /></View>}
    {gatePresenceCard && <View pointerEvents={gatePresenceCard.active && !webOverlayOpen ? "box-none" : "none"} style={{ position: "absolute", top: gatePresenceCard.top, left: gatePresenceCard.left, width: gatePresenceCard.width, height: gatePresenceCard.height, opacity: gatePresenceCard.active && !webOverlayOpen ? 1 : 0 }}><GatePresenceNativeCard card={gatePresenceCard}
      onPress={id => web.current?.injectJavaScript(`(() => { const el=document.querySelector('[data-gate-native-presence-id="${id}"]'); if(!el || el.disabled) return; if(el.matches('.gate-arrival-record,.gate-record-link') || /^(Edit|Editar|Undo check-out|Revertir salida)$/.test(el.textContent?.trim() || '')) { window.__gatePresenceOwnDialog=true; window.__gatePresenceDialogUntil=Date.now()+2000; } el.click(); })(); true;`)}
      onChange={(id,value) => web.current?.injectJavaScript(`(() => { const el=document.querySelector('[data-gate-native-presence-id="${id}"]'); if(!el || el.disabled || !el.matches('input,textarea,select')) return; const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true})); })(); true;`)}
      onPhoto={(visitId,base64,mimeType) => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-presence-exit-photo',{detail:${JSON.stringify({visitId,base64,mimeType})}})); true;`)}
      onCloseDialog={() => web.current?.injectJavaScript(`document.querySelector('[data-gate-native-presence-id="${gatePresenceCard.dialog?.closeId ?? ""}"]')?.click(); true;`)} /></View>}
    {gateEntryCard && <View pointerEvents={gateEntryCard.active && !webOverlayOpen ? "box-none" : "none"} onLayout={event => web.current?.injectJavaScript(`document.querySelector('#gate-entry-panel [data-testid="gate-new-entry-card"]')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateEntryCard.top, left: gateEntryCard.left, width: gateEntryCard.width, opacity: gateEntryCard.active && !webOverlayOpen ? 1 : 0 }}><GateEntryNativeCard card={gateEntryCard.data}
      onAction={action => web.current?.injectJavaScript(`(() => { const root=document.querySelector('#gate-entry-panel [data-testid="gate-new-entry-card"]'); const selectors={switch:'.gate-card-swap-icon',checkin:'[data-testid="button-gate-check-in"]',reset:'[data-testid="button-gate-reset-entry"]','arrival-use':'[data-native-entry-arrival] button:first-of-type','arrival-remove':'[data-native-entry-arrival] button:last-of-type','voice-cancel':'[data-native-entry-voice] button:first-of-type','voice-confirm':'[data-testid="button-gate-voice-confirm-checkin"]','previous-use':'[data-native-entry-previous] button','recognition-cancel':'[data-testid="gate-recognition-review"] > button'}; root?.querySelector(selectors[${JSON.stringify(action)}])?.click(); })(); true;`)}
      onChange={(id,value) => web.current?.injectJavaScript(`(() => { const el=document.getElementById(${JSON.stringify(id)}); if (!el) return; const value=${JSON.stringify(value)}; const proto=el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(el,value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input',{bubbles:true})); })(); true;`)}
      onFocus={id => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-entry-action',{detail:${JSON.stringify({action:"focus",field:({"gate-vehicle-plate":"vehiclePlate","gate-first-name":"firstName","gate-last-name":"lastName","gate-company":"company"} as Record<string,string>)[id] ?? id})}})); true;`)}
      onPick={id => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-entry-action',{detail:${JSON.stringify({action:"pick",id})}})); true;`)}
      onPlateState={state => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-entry-action',{detail:${JSON.stringify({action:"plate-state",state})}})); true;`)}
      onPhoto={(kind,base64,mimeType) => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-entry-action',{detail:${JSON.stringify({action:"photo",kind,base64,mimeType})}})); true;`)}
      onCrop={box => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-entry-action',{detail:${JSON.stringify({action:"crop",kind:"plate",box})}})); true;`)} /></View>}
    {mapCanvasCard && <View pointerEvents={mapCanvasCard.active && !webOverlayOpen ? "auto" : "none"} style={{ position: "absolute", top: mapCanvasCard.top, left: mapCanvasCard.left, width: mapCanvasCard.width, height: mapCanvasCard.height, opacity: mapCanvasCard.active && !webOverlayOpen ? 1 : 0 }}><GateMapCanvasNative data={mapCanvasCard.data} height={mapCanvasCard.height}
      onMapAction={(action,id,latitude,longitude) => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-map-action',{detail:${JSON.stringify({action,id,latitude,longitude})}})); true;`)}
      onControl={name => web.current?.injectJavaScript(`(() => { const root=document.getElementById('gate-map-canvas-native-slot'); const name=${JSON.stringify(name)}; const controls={settings:'.gate-map-settings-control button:first-child',staff:'[data-map-reveal-toggle]',equipment:'[data-map-equipment-toggle]',center:'[aria-label="Center on Me"],[aria-label="Centrar en mí"]','drop-gate':'[aria-label="Drop Gate"],[aria-label="Colocar acceso"]','drop-pin':'[aria-label="Drop Pin"],[aria-label="Agregar pin"]',expand:'.gate-map-view-controls button:first-child',fit:'.gate-map-view-controls button:last-child',links:'#gate-map-settings .gate-map-layer-toggles button:nth-of-type(1)',sites:'#gate-map-settings .gate-map-layer-toggles button:nth-of-type(2)',style:'#gate-map-settings .gate-map-style-toggle',dark:'#gate-map-settings .gate-map-layer-toggles button:last-child'}; root?.querySelector(controls[name])?.click(); })(); true;`)}
      onMenu={id => web.current?.injectJavaScript(`(() => { const root=document.getElementById('gate-map-canvas-native-slot'); const element=Array.from(root?.querySelectorAll('[data-native-map-id]') || []).find(node=>node.dataset.nativeMapId===${JSON.stringify(id)}); if(element?.matches('summary')) element.click(); else if(element?.matches('button') && !element.disabled) element.click(); })(); true;`)}
      onPinDetail={(action,pinId) => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-map-pin-detail',{detail:${JSON.stringify({action,pinId})}})); true;`)}
      onEquipmentDetail={(action,equipmentId) => web.current?.injectJavaScript(`(() => { const root=document.getElementById('gate-map-canvas-native-slot'); if(root?.dataset.selectedPointId!==${JSON.stringify(`equipment:${equipmentId}`)}) return; const popup=root.querySelector('.equipment-map-detail'); if(${JSON.stringify(action)}==='open') popup?.querySelector('a[href^="/work-hub/assets"]')?.click(); else popup?.closest('.mapboxgl-popup')?.querySelector('.mapboxgl-popup-close-button')?.click(); })(); true;`)} /></View>}
    {dashboardHeader && <View pointerEvents={dashboardHeader.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-dashboard-header-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: dashboardHeader.top, left: dashboardHeader.left, width: dashboardHeader.width, opacity: dashboardHeader.active && !webOverlayOpen ? 1 : 0 }}><GateDashboardHeaderNative title={dashboardHeader.title} subtitle={dashboardHeader.subtitle} onReport={() => web.current?.injectJavaScript('document.querySelector("[data-gate-report-incident]")?.click(); true;')} /></View>}
    {workdayCard && <View pointerEvents={workdayCard.active && !webOverlayOpen ? "auto" : "none"} style={{ position: "absolute", top: workdayCard.top, left: workdayCard.left, width: workdayCard.width, opacity: workdayCard.active && !webOverlayOpen ? 1 : 0 }}><GateDashboardWorkdayCard siteId={workdayCard.siteId} stationId={workdayCard.stationId} gateName={workdayCard.gateName} onSelection={changeNativeGateSelection} onShiftChange={refreshWebWorkday} /></View>}
    {dashboardStatuses.map(item => <View key={item.status.id} pointerEvents={item.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.querySelector('[data-gate-dashboard-status-native-slot=${JSON.stringify(item.status.id)}]')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: item.top, left: item.left, width: item.width, opacity: item.active && !webOverlayOpen ? 1 : 0 }}><GateDashboardStatusNative status={item.status} onRetry={() => web.current?.injectJavaScript(`document.querySelector('[data-gate-dashboard-status-native-slot=${JSON.stringify(item.status.id)}] button')?.click(); true;`)} /></View>)}
    {activityCard && activityData && <View pointerEvents={activityCard.active && !webOverlayOpen ? "auto" : "none"} style={{ position: "absolute", top: activityCard.top, left: activityCard.left, width: activityCard.width, opacity: activityCard.active && !webOverlayOpen ? 1 : 0 }}><GateDashboardActivityCard {...activityData} onExpandedChange={key => web.current?.injectJavaScript(`document.querySelector('#gate-activity-native-slot [data-testid="dashboard-metric-${key}"] > summary')?.click(); true;`)} /></View>}
    {onSiteCard && activityData && <View pointerEvents={onSiteCard.active && !webOverlayOpen ? "auto" : "none"} style={{ position: "absolute", top: onSiteCard.top, left: onSiteCard.left, width: onSiteCard.width, opacity: onSiteCard.active && !webOverlayOpen ? 1 : 0 }}><GateDashboardOnSiteCard snapshot={activityData.snapshot} historyBaseHref={activityData.historyBaseHref} allGates={onSiteCard.allGates} onExpandedChange={key => web.current?.injectJavaScript(`document.querySelector('#gate-on-site-native-slot [data-testid="dashboard-metric-${key}"] > summary')?.click(); true;`)} /></View>}
    {tasksCard && <View pointerEvents={tasksCard.active && !webOverlayOpen ? "auto" : "none"} style={{ position: "absolute", top: tasksCard.top, left: tasksCard.left, width: tasksCard.width, opacity: tasksCard.active && !webOverlayOpen ? 1 : 0 }}><HomeDashboardTasks webCard onPanelChange={key => web.current?.injectJavaScript(`document.querySelector('#gate-tasks-native-slot [data-gate-native-task-group="${key}"] > button')?.click(); true;`)} /></View>}
    {watchCard && watchData && <View pointerEvents={watchCard.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById("gate-watch-native-slot")?.style.setProperty("height","${Math.ceil(event.nativeEvent.layout.height)}px"); true;`)} style={{ position: "absolute", top: watchCard.top, left: watchCard.left, width: watchCard.width, opacity: watchCard.active && !webOverlayOpen ? 1 : 0 }}><GateDashboardWatchCard {...watchData} onWebAction={action => web.current?.injectJavaScript(`(() => { const root = document.getElementById('gate-watch-native-slot'); const action = ${JSON.stringify(action)}; if (action === 'release') root?.querySelector('.gate-watch-release')?.click(); else if (action === 'turnover') root?.querySelector('a[href="#gate-turnover"]')?.click(); else Array.from(root?.querySelectorAll('button') || []).find(button => button.textContent?.trim() === 'Assume Watch' || button.textContent?.trim() === 'Asumir vigilancia')?.click(); })(); true;`)} onExpandedChange={section => web.current?.injectJavaScript(`(() => { const order = ['radar','schedule','roster','previous','next','notes']; const index = order.indexOf(${JSON.stringify(section)}); const details = Array.from(document.querySelectorAll('#gate-watch-native-slot details.gate-panel-disclosure')).filter(node => !node.parentElement?.closest('details')); if (index >= 0) details[index]?.querySelector(':scope > summary')?.click(); })(); true;`)} /></View>}
    {handoffCard && handoffData && <View pointerEvents={handoffCard.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById("gate-handoff-native-slot")?.style.setProperty("height","${Math.ceil(event.nativeEvent.layout.height)}px"); true;`)} style={{ position: "absolute", top: handoffCard.top, left: handoffCard.left, width: handoffCard.width, opacity: handoffCard.active && !webOverlayOpen ? 1 : 0 }}>{handoffData.current ? <GateDashboardHandoffNative {...handoffData} current={handoffData.current} onWebAction={action => web.current?.injectJavaScript(`(() => { const root = document.getElementById('gate-handoff-native-slot'); if (${JSON.stringify(action)} === 'assume') root?.querySelector('#watch-review button')?.click(); else root?.querySelector('.handoff-recovery button')?.click(); })(); true;`)} onChanged={() => web.current?.injectJavaScript('window.dispatchEvent(new Event("focus")); true;')} /> : <GateDashboardHandoffPending phase={handoffData.phase === "error" ? "error" : "pending"} />}</View>}
    {supervisorCard && supervisorData && <View pointerEvents={supervisorCard.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById("gate-supervisor-native-slot")?.style.setProperty("height","${Math.ceil(event.nativeEvent.layout.height)}px"); true;`)} style={{ position: "absolute", top: supervisorCard.top, left: supervisorCard.left, width: supervisorCard.width, opacity: supervisorCard.active && !webOverlayOpen ? 1 : 0 }}><GateDashboardSupervisorCard {...supervisorData} onChanged={() => web.current?.injectJavaScript('window.dispatchEvent(new Event("focus")); true;')} /></View>}
    {adminCard && adminCard.width > 0 && adminCard.height > 0 && <View pointerEvents={adminCard.active && !webOverlayOpen ? "auto" : "none"} style={{ position: "absolute", top: adminCard.top, left: adminCard.left, width: adminCard.width, opacity: adminCard.active && !webOverlayOpen ? 1 : 0 }}><GateDashboardAdministratorCard height={adminCard.height} gateGoDemo={adminCard.gateGoDemo} onAction={adminAction} /></View>}
    {mapStatuses.map(item => <View key={item.status.id} pointerEvents={item.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`Array.from(document.querySelectorAll('[data-gate-map-status-native-slot]')).find(strip => strip.dataset.nativeMapStatusId === ${JSON.stringify(item.status.id)})?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: item.top, left: item.left, width: item.width, opacity: item.active && !webOverlayOpen ? 1 : 0 }}><GateMapStatusNative status={item.status} onAction={() => web.current?.injectJavaScript(`(() => { const strip=Array.from(document.querySelectorAll('[data-gate-map-status-native-slot]')).find(node=>node.dataset.nativeMapStatusId===${JSON.stringify(item.status.id)}); const button=strip?.querySelector('button'); if(button && !button.disabled) button.click(); })(); true;`)} /></View>)}
    {mapPageHeaders.map(item => <View key={item.expanded ? "expanded" : "page"} pointerEvents={item.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById(${JSON.stringify(item.expanded ? "gate-map-expanded-page-header-native-slot" : "gate-map-page-header-native-slot")})?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: item.top, left: item.left, width: item.width, opacity: item.active && !webOverlayOpen ? 1 : 0 }}><GateMapPageHeaderNative title={item.title} backLabel={item.backLabel} onBack={() => { if (item.expanded) { web.current?.injectJavaScript('document.querySelector("#gate-map-expanded-page-header-native-slot [data-page-back]")?.click(); true;'); return; } if (router.canGoBack()) { pageBack(); return; } const target = new URL(item.fallbackHref, url.origin); router.replace({ pathname: "/change-over", params: { siteId: target.searchParams.get("siteId") ?? undefined, stationId: target.searchParams.get("stationId") ?? undefined } }); }} /></View>)}
    {mapHeaderCard && <View pointerEvents={mapHeaderCard.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-map-header-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: mapHeaderCard.top, left: mapHeaderCard.left, width: mapHeaderCard.width, opacity: mapHeaderCard.active && !webOverlayOpen ? 1 : 0 }}><GateMapHeaderNative {...mapHeaderCard} onSelect={gateId => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-map-selection',{detail:${JSON.stringify(gateId)}})); true;`)} /></View>}
    {mapStaffCard && mapStaffData && <View pointerEvents={mapStaffCard.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById("gate-map-staff-native-slot")?.style.setProperty("height","${Math.ceil(event.nativeEvent.layout.height)}px"); true;`)} style={{ position: "absolute", top: mapStaffCard.top, left: mapStaffCard.left, width: mapStaffCard.width, opacity: mapStaffCard.active && !webOverlayOpen ? 1 : 0 }}><GateMapStaffLocationsCard {...mapStaffData} onSort={sort => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-map-staff-sort',{detail:${JSON.stringify(sort)}})); true;`)} onFocus={userId => web.current?.injectJavaScript(`document.querySelector('#gate-map-staff-native-slot [data-user-id="${userId}"] .gate-map-staff-link')?.click(); true;`)} onExpandedChange={group => web.current?.injectJavaScript(`document.querySelector('#gate-map-staff-native-slot details.gate-map-staff-group[data-group=${JSON.stringify(group)}] > summary')?.click(); true;`)} /></View>}
    {mapActivityCard && mapActivityData && <View pointerEvents={mapActivityCard.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById("gate-map-activity-native-slot")?.style.setProperty("height","${Math.ceil(event.nativeEvent.layout.height)}px"); true;`)} style={{ position: "absolute", top: mapActivityCard.top, left: mapActivityCard.left, width: mapActivityCard.width, opacity: mapActivityCard.active && !webOverlayOpen ? 1 : 0 }}><GateMapActivityNative {...mapActivityData} onExpandedChange={key => web.current?.injectJavaScript(`document.querySelector('#gate-map-activity-native-slot [data-testid="dashboard-metric-${key}"] > summary')?.click(); true;`)} /></View>}
    {mapPresenceCard && mapPresenceData && <View pointerEvents={mapPresenceCard.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.querySelector("[data-gate-site-presence-native-slot]")?.style.setProperty("height","${Math.ceil(event.nativeEvent.layout.height)}px"); true;`)} style={{ position: "absolute", top: mapPresenceCard.top, left: mapPresenceCard.left, width: mapPresenceCard.width, opacity: mapPresenceCard.active && !webOverlayOpen ? 1 : 0 }}><GateMapSitePresenceCard {...mapPresenceData} /></View>}
    {confirmedLocations && <View pointerEvents="none" onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-map-confirmed-locations-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: confirmedLocations.top, left: confirmedLocations.left, width: confirmedLocations.width, opacity: confirmedLocations.active && !webOverlayOpen ? 1 : 0 }}><GateMapConfirmedLocationsCard visits={confirmedLocations.visits} /></View>}
    {mapTimeControl && <View pointerEvents={mapTimeControl.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-map-time-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: mapTimeControl.top, left: mapTimeControl.left, width: mapTimeControl.width, opacity: mapTimeControl.active && !webOverlayOpen ? 1 : 0 }}><GateMapTimeNative instant={mapTimeControl.instant} liveConnected={mapTimeControl.liveConnected} onChange={instant => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-map-time',{detail:${JSON.stringify(instant)}})); true;`)} onRefresh={() => web.current?.injectJavaScript('document.querySelector("#gate-map-time-native-slot .gate-map-refresh")?.click(); true;')} /></View>}
    {mapActivityPopup && <View pointerEvents={!webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-map-activity-popup-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: mapActivityPopup.top, left: mapActivityPopup.left, width: mapActivityPopup.width, opacity: !webOverlayOpen ? 1 : 0 }}><GateMapActivityPopupNative data={mapActivityPopup.data} onAction={action => web.current?.injectJavaScript(`(() => { const card = document.getElementById('gate-map-activity-popup-native-slot'); const target = ${JSON.stringify(action)} === 'edit' ? card?.querySelector(':scope > .gate-history-filter') : ${JSON.stringify(action)} === 'status' ? card?.querySelector('button.gate-map-gate-status') : ${JSON.stringify(action)} === 'confirm' ? card?.querySelector('.gate-map-status-actions button:first-child') : ${JSON.stringify(action)} === 'cancel' ? card?.querySelector('.gate-map-status-actions button:last-child') : card?.querySelector('[role=alert] button'); target?.click(); })(); true;`)} /></View>}
    {mapAdminCard && <View pointerEvents={mapAdminCard.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.querySelector('.gate-map-page > .gate-administration-card')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: mapAdminCard.top, left: mapAdminCard.left, width: mapAdminCard.width, opacity: mapAdminCard.active && !webOverlayOpen ? 1 : 0 }}><GateMapAdministrationNative card={mapAdminCard.data} onMode={mode => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-admin-mode',{detail:${JSON.stringify({ mode })}})); true;`)} onChange={(id, value) => web.current?.injectJavaScript(`(() => { const root=document.querySelector('.gate-map-page > .gate-administration-card'); const el=Array.from(root?.querySelectorAll('[data-gate-native-id]') || []).find(node => node.dataset.gateNativeId === ${JSON.stringify(id)}); if(!el || !el.matches('input,select,textarea') || el.disabled) return; const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,'value')?.set?.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true})); })(); true;`)} onPress={id => web.current?.injectJavaScript(`(() => { const root=document.querySelector('.gate-map-page > .gate-administration-card'); const el=Array.from(root?.querySelectorAll('button[data-gate-native-id]') || []).find(node => node.dataset.gateNativeId === ${JSON.stringify(id)}); if(el && !el.disabled) el.click(); })(); true;`)} /></View>}
    {gateLogRecords.map(card => <View key={card.id} pointerEvents={card.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`Array.from(document.querySelectorAll('[data-gate-log-native-record]')).find(card => card.dataset.recordId === ${JSON.stringify(card.id)})?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: card.top, left: card.left, width: card.width, opacity: card.active && !webOverlayOpen ? 1 : 0 }}><GateLogRecordNative record={card.record} onOpen={() => setGateLogDetailId(card.id)} onAction={() => web.current?.injectJavaScript(`Array.from(document.querySelectorAll('[data-gate-log-native-record]')).find(card => card.dataset.recordId === ${JSON.stringify(card.id)})?.querySelector('.gate-traffic-footer button')?.click(); true;`)} /></View>)}
    {gateLogArrivals.map(card => <View key={card.id} pointerEvents={card.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`Array.from(document.querySelectorAll('[data-gate-log-native-arrival]')).find(card => card.dataset.arrivalId === ${JSON.stringify(card.id)})?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: card.top, left: card.left, width: card.width, opacity: card.active && !webOverlayOpen ? 1 : 0 }}><GateLogArrivalNative arrival={card.arrival} onOpen={() => setGateLogArrivalDetail({ runId: card.arrival.runId, siteId: card.arrival.siteId, previewDetail: card.arrival.previewDetail ?? null })} onAction={() => web.current?.injectJavaScript(`Array.from(document.querySelectorAll('[data-gate-log-native-arrival]')).find(card => card.dataset.arrivalId === ${JSON.stringify(card.id)})?.querySelector('.gate-traffic-footer button')?.click(); true;`)} /></View>)}
    {shiftNotesPageHeader && <View pointerEvents={shiftNotesPageHeader.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-shift-notes-page-header-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: shiftNotesPageHeader.top, left: shiftNotesPageHeader.left, width: shiftNotesPageHeader.width, opacity: shiftNotesPageHeader.active && !webOverlayOpen ? 1 : 0 }}><GateEntryHeaderNative title={shiftNotesPageHeader.title} subtitle={shiftNotesPageHeader.subtitle} backLabel={shiftNotesPageHeader.backLabel} statuses={[]} onBack={() => { if (router.canGoBack()) { pageBack(); return; } const target = new URL(shiftNotesPageHeader.fallbackHref, url.origin); router.replace({ pathname: "/change-over", params: { siteId: target.searchParams.get("siteId") ?? undefined, stationId: target.searchParams.get("stationId") ?? undefined } }); }} /></View>}
    {shiftNotesAllLink && <View pointerEvents={shiftNotesAllLink.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-all-shift-notes-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: shiftNotesAllLink.top, left: shiftNotesAllLink.left, width: shiftNotesAllLink.width, opacity: shiftNotesAllLink.active && !webOverlayOpen ? 1 : 0 }}><Pressable testID="native-all-shift-notes-link" accessibilityRole="link" accessibilityLabel={shiftNotesAllLink.label} onPress={() => { const target = new URL(shiftNotesAllLink.href, url.origin); router.push({ pathname: "/shift-notes", params: { siteId: target.searchParams.get("siteId") ?? undefined, stationId: target.searchParams.get("stationId") ?? undefined } }); }}><Text style={{ color: "#ececec", fontSize: 14, textDecorationLine: "underline" }}>{shiftNotesAllLink.label}</Text></Pressable></View>}
    {linkedNoteStatuses.map(item => <View key={item.status.id} pointerEvents={item.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.querySelector('[data-gate-linked-status-native-slot=${JSON.stringify(item.status.id)}]')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: item.top, left: item.left, width: item.width, opacity: item.active && !webOverlayOpen ? 1 : 0 }}><GateDashboardStatusNative status={item.status} onRetry={() => web.current?.injectJavaScript(`document.querySelector('[data-gate-linked-status-native-slot=${JSON.stringify(item.status.id)}] button')?.click(); true;`)} /></View>)}
    {shiftNotesHeader && <View pointerEvents={shiftNotesHeader.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-shift-notes-header-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: shiftNotesHeader.top, left: shiftNotesHeader.left, width: shiftNotesHeader.width, opacity: shiftNotesHeader.active && !webOverlayOpen ? 1 : 0 }}><GateShiftNotesListNative {...shiftNotesHeader} onSelect={value => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-shift-notes-header',{detail:${JSON.stringify({ field: "gate", value })}})); true;`)} onSearch={value => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-shift-notes-header',{detail:${JSON.stringify({ field: "search", value })}})); true;`)} /></View>}
    {shiftNoteCards.map(card => <View key={card.id} pointerEvents={card.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`Array.from(document.querySelectorAll('[data-shift-note-native-slot]')).find(card => card.dataset.noteId === ${JSON.stringify(card.id)})?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: card.top, left: card.left, width: card.width, opacity: card.active && !webOverlayOpen ? 1 : 0 }}><GateShiftNoteNativeCard note={card.note} /></View>)}
    {shiftAuditCard && <View pointerEvents={shiftAuditCard.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-shift-audit-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: shiftAuditCard.top, left: shiftAuditCard.left, width: shiftAuditCard.width, opacity: shiftAuditCard.active && !webOverlayOpen ? 1 : 0 }}><GateShiftAuditNativeCard actions={shiftAuditCard.actions} /></View>}
    {Platform.OS !== "ios" && path === "/gate" && user && <GateOfflineLog key={scope} user={user} pageFailed={pageFailed}
      onRetry={() => { setPageFailed(false); web.current?.reload(); }} />}
    {gateLogFilter && <View pointerEvents={gateLogFilter.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-log-filter-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateLogFilter.top, left: gateLogFilter.left, width: gateLogFilter.width, opacity: gateLogFilter.active && !webOverlayOpen ? 1 : 0 }}><GateLogFilterNative selected={gateLogFilter.selected} onSelect={view => web.current?.injectJavaScript(`Array.from(document.querySelectorAll('#gate-log-filter-native-slot button')).find(button => button.textContent?.trim() === ${JSON.stringify(view === "on_site" ? "On Site" : view === "arrivals" ? "Arrivals" : view === "departures" ? "Departures" : "All")})?.click(); true;`)} /></View>}
    {gateLogQuery && <View pointerEvents={gateLogQuery.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-log-query-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateLogQuery.top, left: gateLogQuery.left, width: gateLogQuery.width, opacity: gateLogQuery.active && !webOverlayOpen ? 1 : 0 }}><GateLogQueryNative query={gateLogQuery.query} onChange={(field, value) => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-log-query',{detail:${JSON.stringify({ field, value })}})); true;`)} /></View>}
    {gateLogSelect && <View pointerEvents={gateLogSelect.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-log-select-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateLogSelect.top, left: gateLogSelect.left, width: gateLogSelect.width, opacity: gateLogSelect.active && !webOverlayOpen ? 1 : 0 }}><GateSiteGateSelect wide sites={gateLogSelect.sites} gateOptions={gateLogSelect.gates} siteId={gateLogSelect.siteId} gate={gateLogSelect.gateId ? { id: gateLogSelect.gateId, name: gateLogSelect.gateName } : undefined} allOptionLabel={i18n.language?.startsWith("es") ? "Todos los accesos" : "All gates"} gpsStatus="unavailable" gpsLabel={i18n.language?.startsWith("es") ? "GPS no evaluado en el registro de accesos" : "GPS not evaluated in Gate Log"} onChange={(siteId, stationId) => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-log-selection',{detail:${JSON.stringify({ siteId, stationId })}})); true;`)} /></View>}
    {gateLogHeader && <View pointerEvents={gateLogHeader.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-log-header-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateLogHeader.top, left: gateLogHeader.left, width: gateLogHeader.width, opacity: gateLogHeader.active && !webOverlayOpen ? 1 : 0 }}><GateLogHeaderNative title={gateLogHeader.title} subtitle={gateLogHeader.subtitle} backLabel={gateLogHeader.backLabel} onBack={() => { if (router.canGoBack()) { pageBack(); return; } const target = new URL(gateLogHeader.fallbackHref, url.origin); router.replace({ pathname: "/change-over", params: { siteId: target.searchParams.get("siteId") ?? undefined, stationId: target.searchParams.get("stationId") ?? undefined } }); }} /></View>}
    {gateLogExport && <View pointerEvents={gateLogExport.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-log-export-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateLogExport.top, left: gateLogExport.left, width: gateLogExport.width, opacity: gateLogExport.active && !webOverlayOpen ? 1 : 0 }}><GateLogExportNative filters={gateLogExport.filters} disabled={gateLogExport.disabled} /></View>}
    {gateLogPages && <View pointerEvents={gateLogPages.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-log-pages-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateLogPages.top, left: gateLogPages.left, width: gateLogPages.width, opacity: gateLogPages.active && !webOverlayOpen ? 1 : 0 }}><GateLogPagesNative pages={gateLogPages.pages} onPrevious={() => web.current?.injectJavaScript("document.querySelector('#gate-log-pages-native-slot button:first-of-type')?.click(); true;")} onNext={() => web.current?.injectJavaScript("document.querySelector('#gate-log-pages-native-slot button:last-of-type')?.click(); true;")} /></View>}
    {path === "/gate/history" && <GateLogRecordDetailsNative recordId={gateLogDetailId} filters={gateLogExport?.filters ?? null} onClose={() => setGateLogDetailId(null)} />}
    {path === "/gate/history" && <GateLogArrivalDetailsNative runId={gateLogArrivalDetail?.runId ?? null} siteId={gateLogArrivalDetail?.siteId ?? null} previewDetail={gateLogArrivalDetail?.previewDetail ?? null} onClose={() => setGateLogArrivalDetail(null)} />}
    {gateLogCardHeading && <View pointerEvents="none" onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-log-card-heading-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateLogCardHeading.top, left: gateLogCardHeading.left, width: gateLogCardHeading.width, opacity: gateLogCardHeading.active && !webOverlayOpen ? 1 : 0 }}><GateLogCardHeadingNative title={gateLogCardHeading.title} /></View>}
    {gateLogStatus && <View pointerEvents="none" onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-log-status-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateLogStatus.top, left: gateLogStatus.left, width: gateLogStatus.width, opacity: gateLogStatus.active && !webOverlayOpen ? 1 : 0 }}><GateLogStatusNative status={gateLogStatus.status} /></View>}
    {gateLogMovements && <View pointerEvents={gateLogMovements.active && !webOverlayOpen ? "auto" : "none"} onLayout={event => web.current?.injectJavaScript(`document.getElementById('gate-log-movements-native-slot')?.style.setProperty('height','${Math.ceil(event.nativeEvent.layout.height)}px'); true;`)} style={{ position: "absolute", top: gateLogMovements.top, left: gateLogMovements.left, width: gateLogMovements.width, opacity: gateLogMovements.active && !webOverlayOpen ? 1 : 0 }}><GateLogMovementsNative siteId={gateLogMovements.siteId} gateId={gateLogMovements.gateId} expanded={gateLogMovements.expanded} onToggle={() => web.current?.injectJavaScript('document.querySelector("#gate-log-movements-native-slot > summary")?.click(); true;')} /></View>}
    {path === "/gate/change-over" && adminCard && adminDialog && <GateDashboardAdminDialogNative dialog={adminDialog} onAction={(id, action, value) => web.current?.injectJavaScript(`(() => { const card=document.getElementById('gate-admin-native-slot'); if(card?.dataset.nativeReplaceable!=='1'||card.dataset.nativeAdmin!=='1'||!window.__gateAdminDialogOwner) return; const node=document.querySelector('[data-native-admin-dialog-id=${JSON.stringify(id)}]'); if(!node) return; if(node.matches('option')) { const select=node.parentElement; if(!select?.matches('select')||select.disabled||node.disabled) return; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')?.set?.call(select,node.value); select.dispatchEvent(new Event('change',{bubbles:true})); } else if(${JSON.stringify(action)}==='change' && node.matches('input,textarea,select')) { const prototype=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,'value')?.set?.call(node,${JSON.stringify(value ?? "")}); node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true})); } else if(!node.disabled && node.getAttribute('aria-disabled')!=='true') node.click(); setTimeout(() => window.__gateAdminDialogReport?.(),50); })(); true;`)} />}
    {path === "/gate/change-over" && incidentReport && <GateIncidentReportNative data={incidentReport}
      onField={(field, value) => web.current?.injectJavaScript(`(() => { const sheet=document.querySelector('[data-native-gate-incident="1"][data-state="open"]');const form=sheet?.querySelector('[data-testid="safety-report-page"]');if(!form)return;const field=${JSON.stringify(field)};const ids={site:'input-safety-site-id',title:'input-safety-title',description:'input-safety-description',anonymous:'checkbox-safety-anonymous',stopWork:'checkbox-safety-stop-work'};const node=form.querySelector('[data-testid="'+ids[field]+'"]');if(!node)return;if(field==='anonymous'||field==='stopWork')node.click();else{const prototype=node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')?.set?.call(node,${JSON.stringify(value ?? "")});node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));}})()); true;`)}
      onEventType={id => web.current?.injectJavaScript(`(() => { const sheet=document.querySelector('[data-native-gate-incident="1"][data-state="open"]');sheet?.querySelector('[data-testid=${JSON.stringify(`button-event-type-${id}`)}]')?.click(); })(); true;`)}
      onSubmit={() => web.current?.injectJavaScript('document.querySelector("[data-native-gate-incident=\"1\"][data-state=open] [data-testid=button-submit-safety-report]")?.click(); true;')}
      onClose={() => web.current?.injectJavaScript('(() => { const sheet=document.querySelector("[data-native-gate-incident=\"1\"][data-state=open]");Array.from(sheet?.querySelectorAll("button") || []).find(button=>button.textContent?.trim()==="Close")?.click(); })(); true;')} />}
    {path === "/gate/change-over" && incidentConfirmation && <View testID="native-incident-confirmation" accessibilityRole="alert" style={{ position: "absolute", top: 72, right: 16, maxWidth: 360, backgroundColor: "#242426", borderColor: "#16c5df", borderWidth: 1, borderRadius: 8, padding: 14, elevation: 8 }}><Text style={{ color: "#f5f5f5", fontWeight: "700" }}>{incidentConfirmation.title}</Text><Text style={{ color: "#c9c9c9", marginTop: 4 }}>{incidentConfirmation.description}</Text></View>}
    {path === "/gate/change-over" && assumeWatch && <GateDashboardAssumeWatchNative data={assumeWatch}
      onAction={action => web.current?.injectJavaScript(`(() => { const dialog=document.querySelector('[data-native-gate-assume="1"][data-state="open"]'); const button=dialog?.querySelector('[data-native-assume-action=${JSON.stringify(action)}]'); if(button && !button.disabled) button.click(); })(); true;`)}
      onDiscrepancyChange={value => web.current?.injectJavaScript(`(() => { const dialog=document.querySelector('[data-native-gate-assume="1"][data-state="open"]'); const textarea=dialog?.querySelector('[data-native-assume-discrepancy="1"]'); if(!textarea || textarea.disabled)return; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set?.call(textarea,${JSON.stringify(value)}); textarea.dispatchEvent(new Event('input',{bubbles:true})); })(); true;`)} />}
    {path === "/gate/map" && mapGateForm && <GateMapGateFlyoutNative dialog={mapGateForm} onClose={() => web.current?.injectJavaScript('document.querySelector(".gate-administration-flyout .platform-agreement-close")?.click(); true;')} onAction={(id, action, value) => web.current?.injectJavaScript(`(() => { const root=document.getElementById('gate-map-gate-native-slot'); if(root?.dataset.nativeAuthorized!=='1') return; const node=document.querySelector('[data-native-map-gate-id=${JSON.stringify(id)}]'); const dialog=root.closest('[role="dialog"]'); if(!node || !(dialog?.contains(node) || node.getAttribute('role')==='option' && document.querySelector('[role="listbox"]')?.contains(node))) return; if(node.matches('option')) {const select=node.parentElement;if(!select?.matches('select')||select.disabled||node.disabled)return;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')?.set?.call(select,node.value);select.dispatchEvent(new Event('change',{bubbles:true}));} else if(${JSON.stringify(action)}==='change' && node.matches('input,textarea,select')) {const prototype=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')?.set?.call(node,${JSON.stringify(value ?? "")});node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));} else if(!node.disabled && node.getAttribute('aria-disabled')!=='true')node.click();setTimeout(()=>window.__gateMapGateFormReport?.(),50); })(); true;`)} />}
    {path === "/gate/map" && mapPinForm && <GateMapPinFlyoutNative key={mapPinForm.pin?.id ?? `draft:${mapPinForm.latitude}:${mapPinForm.longitude}`} form={mapPinForm} onClose={() => web.current?.injectJavaScript('window.dispatchEvent(new CustomEvent("gate-native-map-pin-flyout",{detail:{action:"close"}})); true;')} onSaved={pinId => web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('gate-native-map-pin-flyout',{detail:${JSON.stringify({ action: "saved", pinId })}})); true;`)} />}
  </View>;
}
