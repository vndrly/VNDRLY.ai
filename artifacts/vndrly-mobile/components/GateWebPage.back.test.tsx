import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ props: null as any, inject: vi.fn(), back: vi.fn(), replace: vi.fn(), push: vi.fn(), params: {} as Record<string, string>, canGoBack: true, user: { id: 1 }, update: vi.fn(), register: vi.fn(() => () => {}), controls: new Map<string, () => boolean>(), gateDraft: null as null | ((draft: any) => Promise<any>), header: false, platform: "web" }));
vi.mock("react-native", async importOriginal => {
  const actual = await importOriginal<typeof import("react-native")>();
  return { ...actual, Platform: { ...actual.Platform, get OS() { return mocks.platform; } } };
});
vi.mock("@/hooks/use-askv-voice-session",()=>({useAskVVoiceSession:()=>({assistant:{messages:[],streaming:false,send:vi.fn()},error:null})}));
vi.mock("@/lib/page-back", () => ({ pageBack: mocks.back }));
vi.mock("@/lib/askv-client-tools", () => ({ registerAskVControl: (path: string, id: string, focus: () => boolean) => { const key = `${path}:${id}`; mocks.controls.set(key, focus); return () => { if (mocks.controls.get(key) === focus) mocks.controls.delete(key); }; }, subscribeAskVGateCreateDraft: (listener: (draft: any) => Promise<any>) => { mocks.gateDraft = listener; return () => { if (mocks.gateDraft === listener) mocks.gateDraft = null; }; } }));
vi.mock("expo-router", () => ({ router: { canGoBack: () => mocks.canGoBack, replace: mocks.replace, push: mocks.push }, useFocusEffect: React.useEffect, useLocalSearchParams: () => mocks.params, usePathname: () => "/work-hub/profile" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user, activeMembershipId: 1 }) }));
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://example.test" }));
vi.mock("@/lib/auth", () => ({ getToken: async () => "synthetic-test-token" }));
vi.mock("./gate/GateHeaderActions", () => ({ useGateHeaderActions: () => mocks.header ? { update: mocks.update, register: mocks.register } : undefined }));
vi.mock("./GateOfflineLog", () => ({ default: () => null }));
vi.mock("./gate/GateDashboardAdministratorCard", () => ({ default: (props: any) => <div data-testid="native-admin-card" data-demo={String(props.gateGoDemo)} /> }));
vi.mock("./gate/GateDashboardAdminDialogNative", () => ({ default: (props: any) => <button data-testid="native-admin-dialog" data-title={props.dialog.title} onClick={() => props.onAction("control-1", "change", "2026-11-23")} /> }));
vi.mock("./gate/GateIncidentReportNative", () => ({ default: (props: any) => <div data-testid="native-incident-report" data-title={props.data.title}><button onClick={() => props.onField("title", "Synthetic incident")}>Title</button><button onClick={() => props.onField("anonymous")}>Anonymous</button><button onClick={() => props.onEventType("near_miss")}>Type</button><button onClick={props.onSubmit}>Submit</button><button onClick={props.onClose}>Close</button></div> }));
vi.mock("./gate/GateEntryHeaderNative", () => ({ default: (props: any) => <button data-testid="native-gate-entry-header" data-title={props.title} data-subtitle={props.subtitle} data-statuses={props.statuses.join("|")} onClick={props.onBack}>Back</button> }));
vi.mock("./gate/GateDashboardAssumeWatchNative", () => ({ default: (props: any) => <div data-testid="native-assume-watch" data-title={props.data.title} data-pending={props.data.pendingMessage}><button onClick={() => props.onAction("confirm")}>Confirm watch</button><button onClick={() => props.onAction("retry")}>Retry watch</button><button onClick={() => props.onAction("save-discrepancy")}>Save discrepancy</button><button onClick={() => props.onDiscrepancyChange("Synthetic discrepancy")}>Enter discrepancy</button><button onClick={() => props.onAction("close")}>Close watch</button></div> }));
vi.mock("./gate/GateDashboardHeaderNative", () => ({ default: (props: any) => <button data-testid="native-gate-header" data-title={props.title} onClick={props.onReport}>{props.subtitle}</button> }));
vi.mock("./gate/GateDashboardWorkdayCard", () => ({ default: () => <div data-testid="native-workday-card" /> }));
vi.mock("./gate/GateDashboardStatusNative", () => ({ default: (props: any) => <button data-testid={`native-dashboard-status-${props.status.id}`} data-message={props.status.message} onClick={props.onRetry}>{props.status.retryLabel}</button> }));
vi.mock("./gate/GateDashboardActivityCard", () => ({ default: (props: any) => <div data-testid="native-activity-card" data-history={props.historyBaseHref} data-check-ins={props.snapshot?.metrics.checkIns} /> }));
vi.mock("./gate/GateMapActivityNative", () => ({ default: (props: any) => <div data-testid="native-map-activity-card" data-mode={props.mode} data-status={props.status} data-history={props.historyBaseHref} /> }));
vi.mock("./gate/GateDashboardOnSiteCard", () => ({ default: (props: any) => <div data-testid="native-on-site-card" data-all-gates={String(props.allGates)} data-visitors={props.snapshot?.metrics.onSiteVisitorRecords} /> }));
vi.mock("./work-hub/HomeDashboardTasks", () => ({ default: (props: any) => <div data-testid="native-tasks-card" data-web-card={String(props.webCard)} /> }));
vi.mock("./gate/GateDashboardWatchCard", () => ({ default: (props: any) => <div data-testid="native-watch-card" data-station={props.stationId} data-operator={props.current?.shift?.operator_name} data-phase={props.phase} /> }));
vi.mock("./gate/GateDashboardHandoffNative", () => ({ default: (props: any) => <div data-testid="native-handoff-card" data-station={props.stationId} data-operator={props.current?.shift?.operator_name} />, GateDashboardHandoffPending: (props: any) => <div data-testid="native-handoff-pending" data-phase={props.phase} /> }));
vi.mock("./gate/GateDashboardSupervisorCard", () => ({ default: (props: any) => <div data-testid="native-supervisor-card" data-station={props.stationId} data-operator={props.current?.shift?.operator_name} /> }));
vi.mock("./gate/GateMapStaffLocationsCard", () => ({ default: (props: any) => <div data-testid="native-map-staff-card" data-count={props.groups?.[0]?.people?.length} /> }));
vi.mock("./gate/GateMapHeaderNative", () => ({ default: (props: any) => <button data-testid="native-map-header" data-gate={props.gateId} onClick={() => props.onSelect("next-gate")} /> }));
vi.mock("./gate/GateMapPageHeaderNative", () => ({ default: (props: any) => <button data-testid="native-map-page-header" data-title={props.title} data-back={props.backLabel} onClick={props.onBack}>Back</button> }));
vi.mock("./gate/GateMapStatusNative", () => ({ default: (props: any) => <button data-testid="native-map-status" data-status={props.status.id} data-message={props.status.message} onClick={props.onAction}>{props.status.actionLabel}</button> }));
vi.mock("./gate/GateMapCanvasNative", () => ({ default: (props: any) => <div><button data-testid="native-map-canvas" data-points={props.data.points.length} onClick={() => { props.onMapAction("point", "gate:synthetic"); props.onControl("fit"); }} />{props.data.pinDetail && <button data-testid="native-map-pin-detail" onClick={() => props.onPinDetail("edit",props.data.pinDetail.id)}>{props.data.pinDetail.label}</button>}{props.data.equipmentDetail && <button data-testid="native-map-equipment-detail" onClick={() => props.onEquipmentDetail("open",props.data.equipmentDetail.id)}>{props.data.equipmentDetail.name}</button>}</div> }));
vi.mock("./gate/GateEntryNativeCard", () => ({ default: (props: any) => <div data-testid="native-gate-entry" data-title={props.card.title}><button onClick={() => props.onAction("checkin")}>Check in</button><button onClick={() => props.onChange("gate-first-name", "Synthetic")}>Name</button><button onClick={() => props.onFocus("gate-first-name")}>Focus</button><button onClick={() => props.onPick("17")}>Pick</button><button onClick={() => props.onPlateState("TX")}>State</button><button onClick={() => props.onPhoto("plate", "abc", "image/jpeg")}>Photo</button><button onClick={() => props.onCrop({x:0,y:0,w:1,h:1})}>Crop</button></div> }));
vi.mock("./gate/GatePresenceNativeCard", () => ({ default: (props: any) => <div data-testid="native-gate-presence" data-tabs={props.card.tabs.length}><button onClick={() => props.onPress("presence-1")}>Open record</button><button onClick={() => props.onChange("presence-2", "remain")}>Destination</button><button onClick={() => props.onPhoto("17", "abc", "image/jpeg")}>Exit photo</button>{props.card.dialog && <button onClick={props.onCloseDialog}>Close details</button>}</div> }));
vi.mock("./gate/GateEntryWorkdayCard", () => ({ default: (props: any) => <button data-testid="native-entry-workday" data-gps={props.data.gpsStatus} data-gate={props.data.gateId} onClick={() => props.onSelection(2,"gate-b")}>Select Gate B</button> }));
vi.mock("./gate/GateLiveFlashNative", () => ({ default: (props: any) => <button data-testid="native-gate-live-flash" data-status={props.data.status} data-photo={props.data.photo} onClick={props.onRefresh}>{props.data.message}</button> }));
vi.mock("./gate/GateMapPinFlyoutNative", () => ({ default: (props: any) => <button data-testid="native-map-pin-form" data-site={props.form.siteId} onClick={() => props.onSaved("saved-pin")} /> }));
vi.mock("./gate/GateMapGateFlyoutNative", () => ({ default: (props: any) => <div data-testid="native-map-gate-form" data-title={props.dialog.title}><button onClick={() => props.onAction("gate-name", "change", "Synthetic Gate")}>Name</button><button onClick={() => props.onAction("save-gate", "press")}>Save</button><button onClick={props.onClose}>Close</button></div> }));
vi.mock("./gate/GateMapActivityPopupNative", () => ({ default: (props: any) => <button data-testid="native-map-activity-popup" data-gate={props.data.stationId} data-count={props.data.activity?.metrics.checkIns} onClick={() => props.onAction("status")} /> }));
vi.mock("./gate/GateMapAdministrationNative", () => ({ default: (props: any) => <div data-testid="native-map-administration" data-title={props.card.title} data-mode={props.card.mode}><button onClick={() => props.onMode("edit")}>Mode</button><button onClick={() => props.onChange("gate-admin-1", "Synthetic Gate")}>Name</button><button onClick={() => props.onPress("gate-admin-2")}>Save</button></div> }));
vi.mock("./gate/GateMapSitePresenceCard", () => ({ default: (props: any) => <div data-testid="native-map-presence-card" data-site={props.sites?.[0]?.siteName} /> }));
vi.mock("./gate/GateMapConfirmedLocationsCard", () => ({ default: (props: any) => <div data-testid="native-confirmed-locations" data-name={props.visits?.[0]?.name} /> }));
vi.mock("./gate/GateMapTimeNative", () => ({ default: (props: any) => <div data-testid="native-map-time" data-instant={props.instant ?? "live"} /> }));
vi.mock("./gate/GateLogRecordNative", () => ({ default: (props: any) => <button data-testid="native-gate-log-record" data-person={props.record.name} onClick={props.onOpen} /> }));
vi.mock("./gate/GateLogArrivalNative", () => ({ default: (props: any) => <button data-testid="native-gate-log-arrival" data-person={props.arrival.name} onClick={props.onOpen} /> }));
vi.mock("./gate/GateLogFilterNative", () => ({ default: (props: any) => <div data-testid="native-gate-log-filter" data-selected={props.selected} /> }));
vi.mock("./gate/GateLogQueryNative", () => ({ default: (props: any) => <div data-testid="native-gate-log-query" data-search={props.query.search}><button onClick={() => props.onChange("search", "Synthetic search")}>Search</button><button onClick={() => props.onChange("range", "7d")}>Range</button><button onClick={() => props.onChange("recordType", "check_ins")}>Record type</button></div> }));
vi.mock("./GateSiteGateSelect", () => ({ default: (props: any) => <button data-testid="native-gate-log-select" data-site={props.siteId} data-gate={props.gate?.id} data-gates={props.gateOptions?.length} onClick={() => props.onChange?.(2,"gate-2")} /> }));
vi.mock("./gate/GateLogHeaderNative", () => ({ default: (props: any) => <button data-testid="native-gate-log-header" data-title={props.title} onClick={props.onBack} /> }));
vi.mock("./gate/GateLogExportNative", () => ({ default: (props: any) => <div data-testid="native-gate-log-export" data-range={props.filters?.range} /> }));
vi.mock("./gate/GateLogPagesNative", () => ({ default: (props: any) => <div data-testid="native-gate-log-pages" data-total={props.pages.total}><button onClick={props.onPrevious}>Previous</button><button onClick={props.onNext}>Next</button></div> }));
vi.mock("./gate/GateLogRecordDetailsNative", () => ({ default: (props: any) => <div data-testid="native-gate-log-details" data-record={props.recordId ?? ""} /> }));
vi.mock("./gate/GateLogArrivalDetailsNative", () => ({ default: (props: any) => <div data-testid="native-gate-arrival-details" data-run={props.runId ?? ""} data-preview={props.previewDetail?.title ?? ""} /> }));
vi.mock("./gate/GateLogCardHeadingNative", () => ({ default: (props: any) => <div data-testid="native-gate-log-card-heading" data-title={props.title} /> }));
vi.mock("./gate/GateLogStatusNative", () => ({ default: (props: any) => <div data-testid="native-gate-log-status" data-message={props.status.messages[0]?.text} /> }));
vi.mock("./gate/GateLogMovementsNative", () => ({ default: (props: any) => <button data-testid="native-gate-log-movements" data-site={props.siteId} data-expanded={String(props.expanded)} onClick={props.onToggle} /> }));
vi.mock("./gate/GateShiftNotesListNative", () => ({ default: (props: any) => <button data-testid="native-shift-notes-header" data-gate={props.gateId} data-search={props.search} data-count={props.gates?.length} onClick={() => { props.onSelect("other-gate"); props.onSearch("review"); }} /> }));
vi.mock("./gate/GateShiftNoteNativeCard", () => ({ default: (props: any) => <div data-testid="native-shift-note-card" data-note={props.note.id} /> }));
vi.mock("./gate/GateShiftAuditNativeCard", () => ({ default: (props: any) => <div data-testid="native-shift-audit-card" data-count={props.actions.length} /> }));
vi.mock("@/lib/gate-offline-runtime", () => ({ saveOfflineGate: vi.fn() }));
vi.mock("@/lib/gate-askv-bridge", () => ({ createGateAskVBridge: () => ({ dispose() {}, clear() {}, receive() {} }) }));
vi.mock("react-native-webview", () => ({ WebView: React.forwardRef((props: any, ref) => { mocks.props = props; React.useImperativeHandle(ref, () => ({ injectJavaScript: mocks.inject })); return <div />; }) }));
import GateWebPage from "./GateWebPage";
import {overlayOwner} from "@/lib/overlay-owner";

afterEach(() => { cleanup(); mocks.inject.mockClear(); mocks.back.mockClear(); mocks.replace.mockClear(); mocks.push.mockClear(); mocks.params = {}; mocks.canGoBack = true; mocks.update.mockClear(); mocks.register.mockClear(); mocks.controls.clear(); mocks.gateDraft = null; mocks.props = null; mocks.header = false; mocks.platform = "web"; });

it("renders the trusted native Gate entry card and delegates its form, photo, and crop actions", async () => {
  mocks.platform = "ios";
  const { queryByTestId, getByText } = render(<GateWebPage path="/gate" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const data = { top: 120, left: 20, width: 320, height: 600, active: true, title: "Check in/out", switchLabel: "Switch", checkInLabel: "Check in", checkInDisabled: false, resetLabel: "Reset", resetDisabled: false, platePhotoLabel: "Capture plate", platePhotoDisabled: false, vehiclePhotoLabel: "Vehicle photo", vehiclePhotoDisabled: false, plateState: "TX", preferredStates: '["TX"]', plateStateError: "", fields: [{id:"gate-first-name",label:"First name",value:"",placeholder:"",disabled:false,required:true}], memoryField: "", suggestions: '[{"id":17,"label":"Synthetic visitor","detail":"Prior visit"}]', arrival: null, error: "", voice: null, previous: null, lastDriver: "", notices: [], siteLoading: false, recognition: {preview:"data:image/jpeg;base64,abc",width:400,height:300,guide:"Select plate",summary:[],cancel:"Cancel",cropLabel:"Read crop",disabled:false}, es: false };
  const send = (source: string, token: string | null) => mocks.props.onMessage({nativeEvent:{url:source,data:JSON.stringify({type:"gate-native-entry-card",channel:token,data})}});
  send("https://untrusted.test/gate", channel);
  send(url.href, "stale");
  expect(queryByTestId("native-gate-entry")).toBeNull();
  send(url.href, channel);
  await waitFor(() => expect(queryByTestId("native-gate-entry")?.getAttribute("data-title")).toBe("Check in/out"));
  for (const label of ["Check in","Name","Focus","Pick","State","Photo","Crop"]) fireEvent.click(getByText(label));
  for (const value of ['button-gate-check-in','gate-first-name','"firstName"','"17"','"TX"','"photo"','"crop"']) expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining(value));
});

it("renders the Gate title and live voice statuses natively and returns through actual page history", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  mocks.props.onLoad();
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("gate-entry-header-native-slot"));
  const bounds = { top: 20, left: 12, width: 320, height: 58, active: true, title: "Gate", backLabel: "Dashboard", statuses: ["Listening", "Checking site"] };
  const send = (source: string, token: string | null, value: typeof bounds | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-entry-header", channel: token, bounds: value }) } });
  send("https://untrusted.test/gate", channel, bounds);
  send(url.href, "stale", bounds);
  expect(queryByTestId("native-gate-entry-header")).toBeNull();
  send(url.href, channel, bounds);
  await waitFor(() => expect(queryByTestId("native-gate-entry-header")?.getAttribute("data-statuses")).toBe("Listening|Checking site"));
  fireEvent.click(queryByTestId("native-gate-entry-header")!);
  expect(mocks.back).toHaveBeenCalledOnce();
  mocks.canGoBack = false;
  fireEvent.click(queryByTestId("native-gate-entry-header")!);
  expect(mocks.replace).toHaveBeenCalledWith("/change-over");
  send(url.href, channel, null);
  await waitFor(() => expect(queryByTestId("native-gate-entry-header")).toBeNull());
});

it("renders the standalone Shift Notes page header natively with history Back and selected-gate direct-entry fallback", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/shift-notes" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  mocks.props.onLoad();
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("gate-shift-notes-page-header-native-slot"));
  const bounds = { top: 20, left: 12, width: 320, height: 50, active: true, title: "Shift Notes", backLabel: "Dashboard", fallbackHref: "/gate/change-over?siteId=8&stationId=gate-a" };
  const send = (source: string, token: string | null, value: typeof bounds | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-shift-notes-page-header", channel: token, bounds: value }) } });
  send("https://untrusted.test/gate/shift-notes", channel, bounds);
  send(url.href, "stale", bounds);
  expect(queryByTestId("native-gate-entry-header")).toBeNull();
  send(url.href, channel, bounds);
  await waitFor(() => expect(queryByTestId("native-gate-entry-header")?.getAttribute("data-title")).toBe("Shift Notes"));
  fireEvent.click(queryByTestId("native-gate-entry-header")!);
  expect(mocks.back).toHaveBeenCalledOnce();
  mocks.canGoBack = false;
  fireEvent.click(queryByTestId("native-gate-entry-header")!);
  expect(mocks.replace).toHaveBeenCalledWith({ pathname: "/change-over", params: { siteId: "8", stationId: "gate-a" } });
  send(url.href, channel, null);
  await waitFor(() => expect(queryByTestId("native-gate-entry-header")).toBeNull());
});

it("renders a linked Shift Note header and All Shift Notes link natively", async () => {
  mocks.platform = "ios";
  mocks.params = { siteId: "8", stationId: "gate-a", handoffId: "note-1" };
  mocks.canGoBack = false;
  const { queryByTestId, getByRole } = render(<GateWebPage path="/gate/shift-notes" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  expect(url.searchParams.get("handoffId")).toBe("note-1");
  const channel = url.searchParams.get("gateVoiceChannel");
  mocks.props.onLoad();
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("gate-all-shift-notes-native-slot"));
  const send = (type: string, bounds: object | null) => mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify({ type, channel, bounds }) } });
  send("gate-native-shift-notes-page-header", { top: 20, left: 12, width: 320, height: 72, active: true, title: "Shift Notes", subtitle: "Saved notes for the selected watch.", backLabel: "Back", fallbackHref: "/gate/change-over?siteId=8&stationId=gate-a" });
  await waitFor(() => expect(queryByTestId("native-gate-entry-header")?.getAttribute("data-subtitle")).toBe("Saved notes for the selected watch."));
  fireEvent.click(queryByTestId("native-gate-entry-header")!);
  expect(mocks.replace).toHaveBeenCalledWith({ pathname: "/change-over", params: { siteId: "8", stationId: "gate-a" } });
  send("gate-native-all-shift-notes-link", { top: 105, left: 12, width: 200, height: 20, active: true, label: "All shift notes", href: "/gate/shift-notes?siteId=8&stationId=gate-a" });
  await waitFor(() => expect(getByRole("link", { name: "All shift notes" })).toBeTruthy());
  fireEvent.click(getByRole("link", { name: "All shift notes" }));
  expect(mocks.push).toHaveBeenCalledWith({ pathname: "/shift-notes", params: { siteId: "8", stationId: "gate-a" } });
  send("gate-native-all-shift-notes-link", null);
  await waitFor(() => expect(queryByTestId("native-all-shift-notes-link")).toBeNull());
});

it("renders linked Shift Note status and Retry natively", async () => {
  mocks.platform = "ios";
  mocks.params = { siteId: "8", stationId: "gate-a", handoffId: "note-1" };
  const { queryByTestId } = render(<GateWebPage path="/gate/shift-notes" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (source: string, token: string | null, strips: object[]) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-linked-note-statuses", channel: token, strips }) } });
  const loading = { id: "loading", top: 100, left: 12, width: 320, height: 20, active: true, message: "Loading…", retryLabel: "" };
  send("https://untrusted.test/gate/shift-notes", channel, [loading]);
  send(url.href, "stale", [loading]);
  expect(queryByTestId("native-dashboard-status-loading")).toBeNull();
  send(url.href, channel, [loading]);
  await waitFor(() => expect(queryByTestId("native-dashboard-status-loading")?.getAttribute("data-message")).toBe("Loading…"));
  send(url.href, channel, [{ ...loading, id: "error", message: "Notes unavailable", retryLabel: "Retry" }]);
  await waitFor(() => expect(queryByTestId("native-dashboard-status-error")?.getAttribute("data-message")).toBe("Notes unavailable"));
  fireEvent.click(queryByTestId("native-dashboard-status-error")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("data-gate-linked-status-native-slot"));
  send(url.href, channel, [{ ...loading, id: "no-notes", message: "No notes" }]);
  await waitFor(() => expect(queryByTestId("native-dashboard-status-no-notes")?.getAttribute("data-message")).toBe("No notes"));
});

it("renders the adjacent native Gate presence card and delegates record, destination, photo, and dialog actions", async () => {
  mocks.platform = "ios";
  const { queryByTestId, getByText } = render(<GateWebPage path="/gate" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const data = { top: 120, left: 20, width: 320, height: 500, active: true, tabs: ["switch","arrivals","active","departures"].map((label,index)=>({id:`presence-${index}`,label,count:"0",pressed:index===2,alert:false,disabled:false})), refresh: {id:"presence-5",label:"Refresh",disabled:false}, items: [{kind:"record",children:[{kind:"action",id:"presence-1",text:"Synthetic Visitor",disabled:false}]}], history: {id:"presence-6",label:"Full history"}, dialog: null as any, es: false };
  const send = (source: string, token: string | null, value: typeof data | null) => mocks.props.onMessage({nativeEvent:{url:source,data:JSON.stringify({type:"gate-native-presence-card",channel:token,data:value})}});
  send("https://untrusted.test/gate",channel,data);
  send(url.href,"stale",data);
  expect(queryByTestId("native-gate-presence")).toBeNull();
  send(url.href,channel,data);
  await waitFor(() => expect(queryByTestId("native-gate-presence")?.getAttribute("data-tabs")).toBe("4"));
  fireEvent.click(getByText("Open record"));
  fireEvent.click(getByText("Destination"));
  fireEvent.click(getByText("Exit photo"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("presence-1"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("presence-2"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("gate-native-presence-exit-photo"));
  send(url.href,channel,{...data,active:false,dialog:{title:"Edit visit",description:"Correct saved details",items:[{kind:"input",id:"presence-7",text:"First name",value:"Synthetic",disabled:false}],closeId:"presence-8"}});
  await waitFor(() => expect(getByText("Close details")).toBeTruthy());
  fireEvent.click(getByText("Close details"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("presence-8"));
  send(url.href,channel,null);
  await waitFor(() => expect(queryByTestId("native-gate-presence")).toBeNull());
});

it("renders the trusted native Gate entry workday strip and delegates gate selection", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const data = {top:80,left:20,width:320,height:78,active:true,sites:'[{"id":2,"name":"Synthetic Site"}]',siteId:2,gateId:"gate-a",gateName:"Gate A",gpsStatus:"verified",gpsLabel:"At gate",gpsDetail:"Within fence"};
  const send = (source: string, token: string | null, value: typeof data | null) => mocks.props.onMessage({nativeEvent:{url:source,data:JSON.stringify({type:"gate-native-entry-workday",channel:token,data:value})}});
  send("https://untrusted.test/gate",channel,data);
  send(url.href,"stale",data);
  expect(queryByTestId("native-entry-workday")).toBeNull();
  send(url.href,channel,data);
  await waitFor(() => expect(queryByTestId("native-entry-workday")?.getAttribute("data-gps")).toBe("verified"));
  expect(queryByTestId("native-entry-workday")?.getAttribute("data-gate")).toBe("gate-a");
  fireEvent.click(queryByTestId("native-entry-workday")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining('gate-native-entry-gate-selection'));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining('gate-b'));
  send(url.href,channel,null);
  await waitFor(() => expect(queryByTestId("native-entry-workday")).toBeNull());
});

it("extracts the Gate entry workday strip bounds, assigned sites, and GPS evidence", async () => {
  mocks.platform = "ios";
  render(<GateWebPage path="/gate" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const slot = document.createElement("div");
  slot.id = "gate-entry-workday-native-slot";
  slot.dataset.nativeSites = JSON.stringify([{id:2,name:"Synthetic Site"}]);
  slot.dataset.siteId = "2";
  slot.dataset.stationId = "gate-a";
  slot.dataset.gateName = "Gate A";
  slot.dataset.gpsStatus = "mismatch";
  slot.dataset.gpsLabel = "Outside fence";
  slot.dataset.gpsDetail = "2 miles away";
  slot.getBoundingClientRect = () => ({top:100,left:20,width:320,height:78,bottom:178,right:340,x:20,y:100,toJSON(){}}) as DOMRect;
  document.body.append(slot);
  const send = vi.fn();
  (window as any).ReactNativeWebView = {postMessage:send};
  mocks.props.onLoad();
  const bridge = mocks.inject.mock.calls.map(call => call[0] as string).find(script => script.includes("gate-native-entry-workday"));
  expect(bridge).toBeTruthy();
  new Function(bridge!)();
  const message = JSON.parse(send.mock.calls.at(-1)![0]);
  expect(message.data.sites).toBe('[{"id":2,"name":"Synthetic Site"}]');
  expect(message.data.gpsStatus).toBe("mismatch");
  expect(message.data.gpsDetail).toBe("2 miles away");
  (window as any).__gateEntryWorkdayCleanup?.();
  delete (window as any).ReactNativeWebView;
  slot.remove();
});

it("renders the trusted native live Gate flash and delegates reconnect refresh", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const data = {top:160,left:20,width:320,height:96,active:true,message:"Synthetic Visitor just checked in",detail:"Synthetic Company · TX ABC123 · Synthetic Site",photo:`${url.origin}/api/storage/objects/synthetic.jpg`,status:"reconnecting",statusLabel:"Reconnecting — refresh now",refreshLabel:"Refresh now"};
  const send = (source: string, token: string | null, value: typeof data | null) => mocks.props.onMessage({nativeEvent:{url:source,data:JSON.stringify({type:"gate-native-live-flash",channel:token,data:value})}});
  send("https://untrusted.test/gate",channel,data);
  send(url.href,"stale",data);
  expect(queryByTestId("native-gate-live-flash")).toBeNull();
  send(url.href,channel,data);
  await waitFor(() => expect(queryByTestId("native-gate-live-flash")?.getAttribute("data-status")).toBe("reconnecting"));
  expect(queryByTestId("native-gate-live-flash")?.getAttribute("data-photo")).toBe(data.photo);
  fireEvent.click(queryByTestId("native-gate-live-flash")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining('gate-live-flash-native-slot [data-testid="live-connection-pill"]'));
  send(url.href,channel,null);
  await waitFor(() => expect(queryByTestId("native-gate-live-flash")).toBeNull());
});

it("extracts the live flash text, photo, status and refresh label from its web slot", async () => {
  mocks.platform = "ios";
  render(<GateWebPage path="/gate" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const slot = document.createElement("div");
  slot.id = "gate-live-flash-native-slot";
  slot.dataset.nativeMessage = "Synthetic Visitor just checked out";
  slot.dataset.nativeDetail = "TX ABC123 · Synthetic Site";
  slot.dataset.nativePhoto = "https://example.test/api/storage/objects/synthetic.jpg";
  slot.dataset.nativeStatus = "reconnecting";
  slot.innerHTML = '<button data-testid="live-connection-pill" aria-label="Refresh now"><span data-testid="live-connection-pill-label">Reconnecting — refresh now</span></button>';
  slot.getBoundingClientRect = () => ({top:160,left:20,width:320,height:96,bottom:256,right:340,x:20,y:160,toJSON(){}}) as DOMRect;
  document.body.append(slot);
  const send = vi.fn();
  (window as any).ReactNativeWebView = {postMessage:send};
  mocks.props.onLoad();
  const bridge = mocks.inject.mock.calls.map(call => call[0] as string).find(script => script.includes("gate-native-live-flash"));
  expect(bridge).toBeTruthy();
  new Function(bridge!)();
  const message = JSON.parse(send.mock.calls.at(-1)![0]);
  expect(message.data.message).toBe("Synthetic Visitor just checked out");
  expect(message.data.photo).toBe("https://example.test/api/storage/objects/synthetic.jpg");
  expect(message.data.statusLabel).toBe("Reconnecting — refresh now");
  (window as any).__gateLiveFlashCleanup?.();
  delete (window as any).ReactNativeWebView;
  slot.remove();
});

it("extracts the live Gate presence tabs and records for the native card", async () => {
  mocks.platform = "ios";
  render(<GateWebPage path="/gate" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const panel = document.createElement("div");
  panel.id = "gate-activity-panel";
  panel.innerHTML = `<section data-testid="gate-on-site-card"><button class="gate-card-swap-icon" aria-label="Switch card">Switch</button><button class="gate-presence-minicard" aria-label="Arrivals"><span class="gate-presence-count">1</span></button><button class="gate-presence-minicard" aria-label="On site" aria-pressed="true"><span class="gate-presence-count">2</span></button><button class="gate-presence-minicard" aria-label="Departures"><span class="gate-presence-count">0</span></button><button data-testid="button-gate-refresh" aria-label="Refresh">Refresh</button><div role="region"><div class="gate-traffic-record"><button class="gate-record-link gate-arrival-record"><span><span class="font-semibold">Synthetic Visitor</span><span class="gate-traffic-status">On site</span></span><span class="text-xs">Synthetic Truck</span></button><div class="gate-traffic-footer"><button>Check out</button></div></div></div><a data-testid="button-gate-full-history">Full history</a></section>`;
  document.body.append(panel);
  const card = panel.querySelector("[data-testid=gate-on-site-card]")!;
  card.getBoundingClientRect = () => ({top:100,left:20,width:320,height:500,bottom:600,right:340,x:20,y:100,toJSON(){}}) as DOMRect;
  const send = vi.fn();
  (window as any).ReactNativeWebView = {postMessage:send};
  mocks.props.onLoad();
  const bridge = mocks.inject.mock.calls.map(call => call[0] as string).find(script => script.includes("gate-native-presence-card"));
  expect(bridge).toBeTruthy();
  new Function(bridge!)();
  const message = JSON.parse(send.mock.calls.at(-1)![0]);
  expect(message.data.tabs.map((tab: any) => tab.label)).toEqual(["Switch card","Arrivals","On site","Departures"]);
  expect(JSON.stringify(message.data.items)).toContain("Synthetic Visitor");
  expect(message.data.history.label).toBe("Full history");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("data-state", "open");
  dialog.innerHTML = `<div data-testid="modal-body"><h2 role="heading">Edit visit</h2><p id="edit-description">Correct saved details</p><form><label>First name<input value="Synthetic" /></label><button type="submit">Save</button></form></div><button>Close</button>`;
  (window as any).__gatePresenceOwnDialog = true;
  document.body.append(dialog);
  await waitFor(() => expect(JSON.parse(send.mock.calls.at(-1)![0]).data.dialog?.title).toBe("Edit visit"));
  expect(JSON.stringify(JSON.parse(send.mock.calls.at(-1)![0]).data.dialog.items)).toContain("First name");
  expect(dialog.style.opacity).toBe("0");
  (window as any).__gatePresenceBridgeCleanup?.();
  delete (window as any).ReactNativeWebView;
  dialog.remove();
  panel.remove();
});

it("renders the trusted native Gate Map header and forwards gate selection", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const bounds = { top: 120, left: 18, width: 320, height: 52, active: true, sites: JSON.stringify([{ id: 2, name: "Synthetic Site" }]), siteId: 2, gateId: "gate-a", gateName: "Gate A", showTitle: true, showSelector: true };
  const send = (source: string, token: string | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-map-header", channel: token, bounds }) } });
  send("https://untrusted.test/gate/map", channel);
  send(url.href, "stale");
  expect(queryByTestId("native-map-header")).toBeNull();
  send(url.href, channel);
  await waitFor(() => expect(queryByTestId("native-map-header")?.getAttribute("data-gate")).toBe("gate-a"));
  fireEvent.click(queryByTestId("native-map-header")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("gate-native-map-selection"));
});

it("renders the Gate Map page and expanded headers with distinct Back actions", async () => {
  mocks.platform = "ios";
  const { queryAllByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const page = { expanded: false, top: 20, left: 20, width: 320, height: 48, active: true, title: "Gate Map", backLabel: "Back", fallbackHref: "/gate/change-over" };
  const send = (source: string, headers: object[]) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-map-page-headers", channel, headers }) } });
  send("https://untrusted.test/gate/map", [page]);
  expect(queryAllByTestId("native-map-page-header")).toHaveLength(0);
  send(url.href, [page]);
  await waitFor(() => expect(queryAllByTestId("native-map-page-header")).toHaveLength(1));
  fireEvent.click(queryAllByTestId("native-map-page-header")[0]);
  expect(mocks.back).toHaveBeenCalledOnce();
  mocks.canGoBack = false;
  fireEvent.click(queryAllByTestId("native-map-page-header")[0]);
  expect(mocks.replace).toHaveBeenCalledWith({ pathname: "/change-over", params: { siteId: undefined, stationId: undefined } });
  const expanded = { ...page, expanded: true, top: 8, backLabel: "Close expanded map" };
  send(url.href, [{ ...page, active: false }, expanded]);
  await waitFor(() => expect(queryAllByTestId("native-map-page-header")).toHaveLength(2));
  fireEvent.click(queryAllByTestId("native-map-page-header")[1]);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("#gate-map-expanded-page-header-native-slot [data-page-back]"));
  expect(mocks.back).toHaveBeenCalledOnce();
});

it("renders trusted Gate Map status strips and forwards their existing actions", async () => {
  mocks.platform = "ios";
  const { queryAllByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const status = { top: 88, left: 18, width: 320, height: 36, active: true, status: { id: "coverage-error", message: "Gate coverage could not be loaded.", actionLabel: "Retry", actionDisabled: false, tone: "error" } };
  const send = (source: string, strips: object[]) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-map-statuses", channel, strips }) } });
  send("https://untrusted.test/gate/map", [status]);
  expect(queryAllByTestId("native-map-status")).toHaveLength(0);
  send(url.href, [status]);
  await waitFor(() => expect(queryAllByTestId("native-map-status")).toHaveLength(1));
  expect(queryAllByTestId("native-map-status")[0].getAttribute("data-message")).toBe("Gate coverage could not be loaded.");
  fireEvent.click(queryAllByTestId("native-map-status")[0]);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("data-gate-map-status-native-slot"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("button.click()"));
  send(url.href, []);
  await waitFor(() => expect(queryAllByTestId("native-map-status")).toHaveLength(0));
});

it("renders the scoped native map canvas and delegates marker and fit actions", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const bounds = { top: 120, left: 18, width: 320, height: 420, active: true, points: JSON.stringify([{id:"gate:synthetic",latitude:31,longitude:-102,label:"G"}]),fitPoints:"[]",lines:"[]",circles:"[]",accessToken:"pk.synthetic",center:"null",selectedPointId:"",styleKind:"satellite",cameraRevision:0,expanded:false,instant:false,showLinks:true,showSiteLocations:false,staffVisible:true,equipmentVisible:false,settingsOpen:false,revealOpen:false,equipmentOpen:false,droppingGate:false,droppingPin:false,movingPointId:"",managementAllowed:true,siteAvailable:true,es:false,menu:[] };
  const send = (source: string, token: string | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-map-canvas", channel: token, bounds }) } });
  send("https://untrusted.test/gate/map", channel);
  send(url.href, "stale");
  expect(queryByTestId("native-map-canvas")).toBeNull();
  send(url.href, channel);
  await waitFor(() => expect(queryByTestId("native-map-canvas")?.getAttribute("data-points")).toBe("1"));
  fireEvent.click(queryByTestId("native-map-canvas")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("gate-native-map-action"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("gate-map-view-controls"));
});

it("renders the selected pin detail on the native canvas and delegates its edit action", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const pin = {id:"pin-1",label:"Synthetic Pin",notes:"Synthetic detail",latitude:31,longitude:-102,createdAt:"2026-01-01T00:00:00Z",historical:false,pending:false,error:"",es:false};
  const bounds = {top:120,left:18,width:320,height:420,active:true,points:JSON.stringify([{id:"pin:pin-1",latitude:31,longitude:-102,label:"P"}]),fitPoints:"[]",lines:"[]",circles:"[]",accessToken:"pk.synthetic",center:"[-102,31]",selectedPointId:"pin:pin-1",styleKind:"satellite",cameraRevision:1,expanded:false,instant:false,showLinks:true,showSiteLocations:false,staffVisible:true,equipmentVisible:false,settingsOpen:false,revealOpen:false,equipmentOpen:false,droppingGate:false,droppingPin:false,movingPointId:"",managementAllowed:true,siteAvailable:true,es:false,menu:[],pinDetail:JSON.stringify(pin)};
  const send = (source: string, token: string | null) => mocks.props.onMessage({nativeEvent:{url:source,data:JSON.stringify({type:"gate-native-map-canvas",channel:token,bounds})}});
  send("https://untrusted.test/gate/map",channel);
  send(url.href,"stale");
  expect(queryByTestId("native-map-pin-detail")).toBeNull();
  send(url.href,channel);
  await waitFor(() => expect(queryByTestId("native-map-pin-detail")?.textContent).toBe("Synthetic Pin"));
  fireEvent.click(queryByTestId("native-map-pin-detail")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("gate-native-map-pin-detail"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("pin-1"));
});

it("renders selected equipment details on the native canvas and delegates the history link", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const detail = {id:"equipment-1",name:"Synthetic Trailer",lines:["Trailer · Inspection","Assigned to Synthetic Holder","Current report · GPS"],linkLabel:"Open equipment / history",href:"/work-hub/assets?equipmentId=equipment-1",latitude:31,longitude:-102};
  const bounds = {top:120,left:18,width:320,height:420,active:true,points:JSON.stringify([{id:"equipment:equipment-1",latitude:31,longitude:-102,label:"T"}]),fitPoints:"[]",lines:"[]",circles:"[]",accessToken:"pk.synthetic",center:"[-102,31]",selectedPointId:"equipment:equipment-1",styleKind:"satellite",cameraRevision:1,expanded:false,instant:false,showLinks:true,showSiteLocations:false,staffVisible:true,equipmentVisible:true,settingsOpen:false,revealOpen:false,equipmentOpen:false,droppingGate:false,droppingPin:false,movingPointId:"",managementAllowed:true,siteAvailable:true,es:false,menu:[],equipmentDetail:JSON.stringify(detail)};
  const send = (source: string, token: string | null) => mocks.props.onMessage({nativeEvent:{url:source,data:JSON.stringify({type:"gate-native-map-canvas",channel:token,bounds})}});
  send("https://untrusted.test/gate/map",channel);
  send(url.href,"stale");
  expect(queryByTestId("native-map-equipment-detail")).toBeNull();
  send(url.href,channel);
  await waitFor(() => expect(queryByTestId("native-map-equipment-detail")?.textContent).toBe("Synthetic Trailer"));
  fireEvent.click(queryByTestId("native-map-equipment-detail")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("equipment:equipment-1"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("/work-hub/assets"));
});

it("extracts the selected equipment popup fields from the Gate Map web slot", async () => {
  mocks.platform = "ios";
  render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const slot = document.createElement("div");
  slot.id = "gate-map-canvas-native-slot";
  slot.dataset.points = JSON.stringify([{id:"equipment:equipment-1",latitude:31,longitude:-102,label:"T"}]);
  slot.dataset.selectedPointId = "equipment:equipment-1";
  slot.innerHTML = '<div class="gate-map-canvas" data-native-map-token="pk.synthetic"></div><section class="equipment-map-detail"><h3>Synthetic Trailer</h3><p>Trailer · Inspection</p><p>Synthetic Holder</p><a href="/work-hub/assets?equipmentId=equipment-1">Open equipment / history</a></section>';
  slot.getBoundingClientRect = () => ({top:120,left:18,width:320,height:420,bottom:540,right:338,x:18,y:120,toJSON(){}}) as DOMRect;
  document.body.append(slot);
  const send = vi.fn();
  (window as any).ReactNativeWebView = {postMessage:send};
  mocks.props.onLoad();
  const bridge = mocks.inject.mock.calls.map(call => call[0] as string).find(script => script.includes('gate-native-map-canvas'));
  expect(bridge).toBeTruthy();
  new Function(bridge!)();
  const message = JSON.parse(send.mock.calls.at(-1)![0]);
  expect(JSON.parse(message.bounds.equipmentDetail)).toMatchObject({id:"equipment-1",name:"Synthetic Trailer",lines:["Trailer · Inspection","Synthetic Holder"],href:"/work-hub/assets?equipmentId=equipment-1",latitude:31,longitude:-102});
  (window as any).__gateMapCanvasBridgeCleanup?.();
  delete (window as any).ReactNativeWebView;
  slot.remove();
});

it("opens the native map pin form only from the trusted Gate Map page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const data = { pin: "", latitude: 30.1, longitude: -96.2, siteId: 2, sites: JSON.stringify([{ id: 2, name: "Synthetic Site" }]) };
  const send = (source: string, token: string | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-map-pin-form", channel: token, data }) } });
  send("https://untrusted.test/gate/map", channel);
  send(url.href, "stale");
  expect(queryByTestId("native-map-pin-form")).toBeNull();
  send(url.href, channel);
  await waitFor(() => expect(queryByTestId("native-map-pin-form")?.getAttribute("data-site")).toBe("2"));
  fireEvent.click(queryByTestId("native-map-pin-form")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("gate-native-map-pin-flyout"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("saved-pin"));
});

it("renders the authorized Gate Map Create Gate flyout natively and delegates form actions", async () => {
  mocks.platform = "ios";
  const { queryByTestId, getByText } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  mocks.props.onLoad();
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("gate-map-gate-native-slot"));
  const data = { title: "Create Gate Here", description: "", items: [{ id: "gate-name", kind: "input", label: "Gate name", value: "" }, { id: "save-gate", kind: "button", label: "Add Gate" }] };
  const send = (source: string, token: string | null, value: typeof data | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-map-gate-form", channel: token, data: value }) } });
  send("https://untrusted.test/gate/map", channel, data);
  send(url.href, "stale", data);
  expect(queryByTestId("native-map-gate-form")).toBeNull();
  send(url.href, channel, data);
  await waitFor(() => expect(queryByTestId("native-map-gate-form")?.getAttribute("data-title")).toBe("Create Gate Here"));
  fireEvent.click(getByText("Name"));
  fireEvent.click(getByText("Save"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("dataset.nativeAuthorized!=='1'"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("Synthetic Gate"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("save-gate"));
  fireEvent.click(getByText("Close"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("platform-agreement-close"));
  send(url.href, channel, null);
  await waitFor(() => expect(queryByTestId("native-map-gate-form")).toBeNull());
});

it("renders a scoped Gate Map activity popup and delegates its status action", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const data = { top: 120, left: 20, width: 320, height: 290, stationId: "gate-a", siteId: 2, siteName: "Synthetic Site", gateName: "Gate A", gateActive: true, latitude: 30.1, longitude: -96.2, historical: false, es: false, activity: JSON.stringify({ stationId: "gate-a", siteId: 2, scope: "gate_attributed", generatedAt: "2026-11-23T12:00:00Z", startedAt: "2026-11-23T10:00:00Z", window: "current_shift", metrics: { checkIns: 4, checkOuts: 2, pendingAdmission: 1, itemsToReview: 0 } }), loading: false, error: false, refreshing: false, statusLabel: "Active", statusActionLabel: "Deactivate Gate A", confirmation: "", confirmationAction: "", confirmationError: "", statusBusy: false, editAllowed: true };
  const send = (source: string, token: string | null, value: typeof data) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-map-activity-popup", channel: token, data: value }) } });
  send("https://untrusted.test/gate/map", channel, data);
  send(url.href, "stale", data);
  expect(queryByTestId("native-map-activity-popup")).toBeNull();
  send(url.href, channel, { ...data, activity: data.activity.replace('"gate-a"', '"other-gate"') });
  expect(queryByTestId("native-map-activity-popup")).toBeNull();
  send(url.href, channel, data);
  await waitFor(() => expect(queryByTestId("native-map-activity-popup")?.getAttribute("data-count")).toBe("4"));
  fireEvent.click(queryByTestId("native-map-activity-popup")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("button.gate-map-gate-status"));
  send(url.href, channel, null as never);
  await waitFor(() => expect(queryByTestId("native-map-activity-popup")).toBeNull());
});

it("shows the native Gate administration card only when the authorized web form exists", async () => {
  mocks.platform = "ios";
  const { queryByTestId, getByText } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const data = { top: 180, left: 18, width: 320, height: 560, active: true, title: "Administrative functions", subtitle: "Create gates and edit gate locations.", mode: "create", es: false, busy: false, items: [
    { id: "gate-admin-1", kind: "field", label: "New Gate", value: "", inputKind: "input", inputType: "text", disabled: false },
    { id: "gate-admin-2", kind: "button", label: "Add Gate", disabled: true },
  ] };
  const send = (source: string, token: string | null, value: typeof data | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-map-administration", channel: token, data: value }) } });
  send("https://untrusted.test/gate/map", channel, data);
  send(url.href, "stale", data);
  expect(queryByTestId("native-map-administration")).toBeNull();
  send(url.href, channel, data);
  await waitFor(() => expect(queryByTestId("native-map-administration")?.getAttribute("data-mode")).toBe("create"));
  fireEvent.click(getByText("Mode"));
  fireEvent.click(getByText("Name"));
  fireEvent.click(getByText("Save"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("gate-native-admin-mode"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("Synthetic Gate"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("button[data-gate-native-id]"));
  send(url.href, channel, null);
  await waitFor(() => expect(queryByTestId("native-map-administration")).toBeNull());
});

it("renders the trusted native Shift Notes list and forwards filter changes", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/shift-notes" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const bounds = { top: 130, left: 20, width: 300, height: 104, active: true, sites: JSON.stringify([{ id: 2, name: "Synthetic Site" }]), gates: JSON.stringify([{ id: "gate-a", name: "Gate A", siteId: 2, siteName: "Synthetic Site" }]), siteId: 2, gateId: "gate-a", gateName: "Gate A", filters: JSON.stringify({ siteId: 2, range: "30d", recordType: "all" }), search: "", loading: false, error: false };
  const send = (source: string, token: string | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-shift-notes-header", channel: token, bounds }) } });
  send("https://untrusted.test/gate/shift-notes", channel);
  send(url.href, "stale");
  expect(queryByTestId("native-shift-notes-header")).toBeNull();
  send(url.href, channel);
  await waitFor(() => expect(queryByTestId("native-shift-notes-header")?.getAttribute("data-gate")).toBe("gate-a"));
  expect(queryByTestId("native-shift-notes-header")?.getAttribute("data-count")).toBe("1");
  fireEvent.click(queryByTestId("native-shift-notes-header")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining('"field":"gate"'));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining('"field":"search"'));
});

it("accepts a Gate creation draft result only from the trusted map page and current channel", async () => {
  mocks.platform = "ios";
  render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.gateDraft).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  mocks.props.onLoad();
  const request = { requestId: "synthetic-draft", target: "administration", siteId: 10, name: "North Gate" };
  const pending = mocks.gateDraft!(request);
  const result = { requestId: request.requestId, ok: true, state: { mode: "create", siteId: 10, missing: ["gate location"], readyToReview: false } };
  const send = (source: string, token: string | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-create-draft-result", channel: token, result }) } });
  send("https://untrusted.test/gate/map", channel);
  send(url.href, "stale");
  send(url.href, channel);
  await expect(pending).resolves.toEqual(result);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("askv:gate-create-draft"));
});

it("registers only trusted, enabled Gate Map AskV form targets", async () => {
  mocks.platform = "ios";
  render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (source: string, token: string | null, targets: string[]) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-focus-targets", channel: token, targets }) } });
  send("https://untrusted.test/gate/map", channel, ["gate-name"]);
  send(url.href, "stale", ["gate-name"]);
  expect(mocks.controls.has("/gate/map:gate-name")).toBe(false);
  send(url.href, channel, ["gate-name", "gate-latitude"]);
  await waitFor(() => expect(mocks.controls.has("/gate/map:gate-name")).toBe(true));
  expect(mocks.controls.has("/gate/map:gate-latitude")).toBe(true);
  send(url.href, channel, ["unregistered-control"]);
  expect(mocks.controls.has("/gate/map:unregistered-control")).toBe(false);
});

it("mounts the native Gate dashboard header only for its trusted page and channel", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (source: string, token: string | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-dashboard-header", channel: token, bounds: { top: 20, left: 20, width: 320, height: 75, active: true, title: "Gate Dashboard", subtitle: "Keep the next shift informed" } }) } });
  send("https://untrusted.test/gate/change-over", channel);
  send(url.href, "stale");
  expect(queryByTestId("native-gate-header")).toBeNull();
  send(url.href, channel);
  await waitFor(() => expect(queryByTestId("native-gate-header")?.getAttribute("data-title")).toBe("Gate Dashboard"));
});

it("renders the Gate incident report sheet natively and delegates its fields and submission", async () => {
  mocks.platform = "ios";
  const { queryByTestId, getByText } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  mocks.props.onLoad();
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("data-native-gate-incident"));
  const data = { title: "Report an incident", description: "Submit a safety report", formTitle: "Safety report", siteLabel: "Site", siteId: "2", sites: [{ id: "2", name: "Synthetic Site" }], eventTypes: [{ id: "near_miss", label: "Near miss", selected: true }], incidentTitleLabel: "Title", incidentTitle: "", descriptionLabel: "Description", incidentDescription: "", anonymousLabel: "Anonymous", anonymous: false, stopWorkLabel: "Stop work", stopWork: false, submitLabel: "Submit", submitting: false, error: "", requiredMessage: "Site and title required" };
  const send = (source: string, token: string | null, value: typeof data | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-incident-report", channel: token, data: value }) } });
  send("https://untrusted.test/gate/change-over", channel, data);
  send(url.href, "stale", data);
  expect(queryByTestId("native-incident-report")).toBeNull();
  send(url.href, channel, data);
  await waitFor(() => expect(queryByTestId("native-incident-report")?.getAttribute("data-title")).toBe("Report an incident"));
  fireEvent.click(getByText("Title"));
  fireEvent.click(getByText("Anonymous"));
  fireEvent.click(getByText("Type"));
  fireEvent.click(getByText("Submit"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("Synthetic incident"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("checkbox-safety-anonymous"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("button-event-type-near_miss"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("button-submit-safety-report"));
  fireEvent.click(getByText("Close"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("data-native-gate-incident"));
  mocks.props.onMessage({ nativeEvent: { url: "https://untrusted.test/gate/change-over", data: JSON.stringify({ type: "gate-native-incident-success", channel, title: "Submitted", description: "HSE notified" }) } });
  expect(queryByTestId("native-incident-confirmation")).toBeNull();
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify({ type: "gate-native-incident-success", channel, title: "Submitted", description: "HSE notified" }) } });
  await waitFor(() => expect(getByText("HSE notified")).toBeTruthy());
  send(url.href, channel, null);
  await waitFor(() => expect(queryByTestId("native-incident-report")).toBeNull());
});

it("renders trusted Assume Watch review natively and delegates confirmation, retry, and discrepancy actions", async () => {
  mocks.platform = "ios";
  const { queryByTestId, getByText } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  mocks.props.onLoad();
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("data-native-gate-assume"));
  const data = { title: "Assume Watch", description: "Review the watch", closeLabel: "Close watch summary", loading: false, loadError: false, loadingLabel: "Loading", loadErrorLabel: "Failed", retryLabel: "Retry", siteGate: "Synthetic site · Main Gate", calendarLabel: "", wrongCalendarGate: "", calendarNotCurrent: "", watchLabel: "Outgoing worker", handoverTitle: "Saved handover", handoverFacts: ["Two vehicles remain"], handoverNotes: "Radio battery replaced", handoverOpenItems: ["Check barrier lamp"], showCurrentActivity: false, currentActivityTitle: "Current gate activity", staleMessage: "", currentFacts: [], areaTitle: "Open visits", areas: [{ area: "South", count: 1 }], areaError: "", ownMessage: "", changedMessage: "", discrepancyAvailable: true, discrepancyTitle: "Report a discrepancy", discrepancyLabel: "What needs checking?", discrepancy: "", discrepancyDisabled: false, saveDiscrepancyLabel: "Save discrepancy", saveDiscrepancyDisabled: true, error: "", reportSavedMessage: "", pendingMessage: "", confirmLabel: "ASSUME", confirmDisabled: false };
  const send = (source: string, token: string | null, value: typeof data | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-assume-watch", channel: token, data: value }) } });
  send("https://untrusted.test/gate/change-over", channel, data);
  send(url.href, "stale", data);
  expect(queryByTestId("native-assume-watch")).toBeNull();
  send(url.href, channel, data);
  await waitFor(() => expect(queryByTestId("native-assume-watch")?.getAttribute("data-title")).toBe("Assume Watch"));
  for (const label of ["Confirm watch", "Retry watch", "Save discrepancy", "Enter discrepancy", "Close watch"]) fireEvent.click(getByText(label));
  for (const value of ['data-native-assume-action="confirm"', 'data-native-assume-action="retry"', 'data-native-assume-action="save-discrepancy"', "Synthetic discrepancy", 'data-native-assume-action="close"']) expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining(value));
  send(url.href, channel, { ...data, pendingMessage: "Checking is required", confirmLabel: "Check assumption" });
  await waitFor(() => expect(queryByTestId("native-assume-watch")?.getAttribute("data-pending")).toBe("Checking is required"));
  send(url.href, channel, null);
  await waitFor(() => expect(queryByTestId("native-assume-watch")).toBeNull());
});

it("mounts the Gate Log card heading only for its trusted page and channel", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const bounds = { top: 160, left: 24, width: 340, height: 70, active: true, title: "Gate Log" };
  const send = (source: string, token: string | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-log-card-heading", channel: token, bounds }) } });
  send("https://untrusted.test/gate/history", channel);
  send(url.href, "stale");
  expect(queryByTestId("native-gate-log-card-heading")).toBeNull();
  send(url.href, channel);
  await waitFor(() => expect(queryByTestId("native-gate-log-card-heading")?.getAttribute("data-title")).toBe("Gate Log"));
});

it("mounts Gate Log status only from its trusted page and channel", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const bounds = { top: 300, left: 24, width: 340, height: 30, active: true, loading: false, messages: JSON.stringify([{ text: "No records match", tone: "muted" }]) };
  const send = (source: string, token: string | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-log-status", channel: token, bounds }) } });
  send("https://untrusted.test/gate/history", channel);
  send(url.href, "stale");
  expect(queryByTestId("native-gate-log-status")).toBeNull();
  send(url.href, channel);
  await waitFor(() => expect(queryByTestId("native-gate-log-status")?.getAttribute("data-message")).toBe("No records match"));
});

it("mounts current site movements only from the trusted Gate Log page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const bounds = { top: 350, left: 24, width: 340, height: 44, active: true, siteId: 411, gateId: "gate-1", expanded: false };
  const send = (source: string, token: string | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-log-movements", channel: token, bounds }) } });
  send("https://untrusted.test/gate/history", channel);
  send(url.href, "stale");
  expect(queryByTestId("native-gate-log-movements")).toBeNull();
  send(url.href, channel);
  await waitFor(() => expect(queryByTestId("native-gate-log-movements")?.getAttribute("data-site")).toBe("411"));
});

it("mounts a Shift Notes card only from the trusted page and channel", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/shift-notes" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const card = { id: "synthetic-note", note: JSON.stringify({ id: "synthetic-note", snapshot: { openItems: [], metrics: {} } }), top: 120, left: 20, width: 300, height: 250, active: true };
  const auditCard = { actions: JSON.stringify([{ id: "synthetic-action", actor_name: "Tester", text: "Reviewed", kind: "note", created_at: "2026-11-23T00:00:00Z" }]), top: 390, left: 20, width: 300, height: 120, active: true };
  const send = (source: string, token: string | null) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ type: "gate-native-shift-notes", channel: token, cards: [card], auditCard }) } });
  send("https://untrusted.test/gate/shift-notes", channel);
  send(url.href, "stale");
  expect(queryByTestId("native-shift-note-card")).toBeNull();
  expect(queryByTestId("native-shift-audit-card")).toBeNull();
  send(url.href, channel);
  await waitFor(() => expect(queryByTestId("native-shift-note-card")?.getAttribute("data-note")).toBe("synthetic-note"));
  expect(queryByTestId("native-shift-audit-card")?.getAttribute("data-count")).toBe("1");
});

it("returns to the native previous page only for the current trusted WebView", async () => {
  render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  expect(url.searchParams.get("gateBackBridge")).toBe("1");
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (origin: string, value: string | null) => mocks.props.onMessage({ nativeEvent: {
    url: origin + "/gate/map", data: JSON.stringify({ type: "gate-page-back", channel: value }),
  } });
  send("https://untrusted.test", channel);
  send(url.origin, "stale-channel");
  expect(mocks.back).not.toHaveBeenCalled();
  send(url.origin, channel);
  expect(mocks.back).toHaveBeenCalledOnce();
});
it("mounts the native Gate Map staff card only from the trusted map page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (source: string, token: string | null, message: object) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ ...message, channel: token }) } });
  const bounds = { top: 180, left: 20, width: 320, height: 270, active: true };
  const data = { type: "gate-native-map-staff-data", groups: JSON.stringify([{ id: "watch", title: "On Watch", people: [{ userId: 1, name: "Synthetic Operator" }] }]), locationError: "", sort: "name" };
  send("https://untrusted.test/gate/map", channel, { type: "gate-native-map-staff-layout", bounds });
  send(url.href, "stale", data);
  expect(queryByTestId("native-map-staff-card")).toBeNull();
  send(url.href, channel, { type: "gate-native-map-staff-layout", bounds });
  send(url.href, channel, data);
  await waitFor(() => expect(queryByTestId("native-map-staff-card")?.getAttribute("data-count")).toBe("1"));
});
it("mounts Gate-confirmed locations only from the trusted map page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const message = { type: "gate-native-confirmed-locations", channel, bounds: { top: 600, left: 20, width: 320, height: 100, active: true, visits: JSON.stringify([{ id: "visit:1", name: "Synthetic Person", location: "Gate A", destination: null }]) } };
  mocks.props.onMessage({ nativeEvent: { url: "https://untrusted.test/gate/map", data: JSON.stringify(message) } });
  expect(queryByTestId("native-confirmed-locations")).toBeNull();
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify(message) } });
  await waitFor(() => expect(queryByTestId("native-confirmed-locations")?.getAttribute("data-name")).toBe("Synthetic Person"));
});
it("mounts the native Gate Map time control with live page state", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const message = { type: "gate-native-map-time", channel, bounds: { top: 200, left: 20, width: 320, height: 50, active: true, instant: "2026-11-23T16:00:00Z", liveConnected: true } };
  mocks.props.onMessage({ nativeEvent: { url: "https://untrusted.test/gate/map", data: JSON.stringify(message) } });
  expect(queryByTestId("native-map-time")).toBeNull();
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify(message) } });
  await waitFor(() => expect(queryByTestId("native-map-time")?.getAttribute("data-instant")).toBe("2026-11-23T16:00:00Z"));
});
it("mounts the native Gate Map activity card with its record source links", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (source: string, token: string | null, message: object) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ ...message, channel: token }) } });
  const bounds = { top: 410, left: 20, width: 320, height: 250, active: true };
  const data = { type: "gate-native-map-activity-data", snapshot: "", historyBaseHref: "/gate/history?range=24h", recordHistoryHrefs: JSON.stringify({ "synthetic:1": "/gate/history?siteId=1&stationId=gate-1" }), showAllLogLink: false, mode: "metrics", status: "", statusTone: "normal" };
  send("https://untrusted.test/gate/map", channel, { type: "gate-native-map-activity-layout", bounds });
  send(url.href, "stale", data);
  expect(queryByTestId("native-map-activity-card")).toBeNull();
  send(url.href, channel, { type: "gate-native-map-activity-layout", bounds });
  send(url.href, channel, data);
  await waitFor(() => expect(queryByTestId("native-map-activity-card")?.getAttribute("data-history")).toBe("/gate/history?range=24h"));
  send(url.href, channel, { ...data, mode: "fallback", status: "Loading activity…" });
  await waitFor(() => expect(queryByTestId("native-map-activity-card")?.getAttribute("data-status")).toBe("Loading activity…"));
  expect(queryByTestId("native-map-activity-card")?.getAttribute("data-mode")).toBe("fallback");
  send(url.href, channel, { ...data, mode: "fallback", status: "Activity unavailable.", statusTone: "error" });
  await waitFor(() => expect(queryByTestId("native-map-activity-card")?.getAttribute("data-status")).toBe("Activity unavailable."));
});
it("mounts the native Site Presence card only from the trusted map page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/map" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (source: string, token: string | null, message: object) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ ...message, channel: token }) } });
  const bounds = { top: 600, left: 20, width: 320, height: 250, active: true };
  const data = { type: "gate-native-map-presence-data", snapshot: "", loading: false, sites: JSON.stringify([{ siteId: 1, siteName: "Synthetic Site" }]), recordHistoryHrefs: "{}", historyBaseHref: "/gate/history?range=24h" };
  send("https://untrusted.test/gate/map", channel, { type: "gate-native-map-presence-layout", bounds });
  send(url.href, "stale", data);
  expect(queryByTestId("native-map-presence-card")).toBeNull();
  send(url.href, channel, { type: "gate-native-map-presence-layout", bounds });
  send(url.href, channel, data);
  await waitFor(() => expect(queryByTestId("native-map-presence-card")?.getAttribute("data-site")).toBe("Synthetic Site"));
});
it("accepts overlay ownership only from the current trusted page and releases it on unmount",async()=>{
 const view=render(<GateWebPage path="/gate/map"/>);await waitFor(()=>expect(mocks.props).not.toBeNull());
 const url=new URL(mocks.props.source.uri), channel=url.searchParams.get("gateVoiceChannel");
 const send=(source:string,token:string|null)=>mocks.props.onMessage({nativeEvent:{url:source,data:JSON.stringify({type:"gate-overlay-state",channel:token,open:true})}});
 send('https://untrusted.test/gate/map',channel);send(url.href,'stale');expect(overlayOwner.current()).toBeUndefined();
 send(url.href,channel);expect(overlayOwner.current()).toBe('web:/gate/map');view.unmount();expect(overlayOwner.current()).toBeUndefined();
});

it("uses the active WebView's Next Steps state after navigation within that WebView", async () => {
  mocks.header = true;
  render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (origin: string, token: string | null) => mocks.props.onMessage({ nativeEvent: {
    url: origin + "/gate/history",
    data: JSON.stringify({ type: "gate-next-steps-state", channel: token, enabled: true, open: false, count: 2 }),
  } });
  send("https://untrusted.test", channel);
  send(url.origin, "old-page-channel");
  expect(mocks.update).not.toHaveBeenCalled();
  send(url.origin, channel);
  expect(mocks.update).toHaveBeenCalledOnce();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ open: false, count: 2 }));
});

it("uses the dark surface and omits the system input bar on iOS Gate entry only", async () => {
  mocks.platform = "ios";
  const view = render(<GateWebPage path="/gate" />);
  await waitFor(() => expect(mocks.props?.hideKeyboardAccessoryView).toBe(true));
  expect(mocks.props.style).toContainEqual({ backgroundColor: "#3a3d42" });
  view.rerender(<GateWebPage path="/gate/map" />);
  expect(mocks.props.hideKeyboardAccessoryView).toBe(false);
});

it("passes the current native page to explicitly opened contextual help", async () => {
  render(<GateWebPage path="/gate/header" control="next-steps" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  expect(new URL(mocks.props.source.uri).searchParams.get("helpPage")).toBe("/work-hub/profile");
});

it("shows the native Administrator Controls card only for a trusted iOS Gate Dashboard layout message", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const bounds = { top: 200, left: 24, width: 320, height: 300, stationId: "gate-1", active: true, gateGoDemo: true };
  const send = (origin: string, token: string | null) => mocks.props.onMessage({ nativeEvent: {
    url: `${origin}/gate/change-over`, data: JSON.stringify({ type: "gate-native-admin-layout", channel: token, bounds }),
  } });
  send("https://untrusted.test", channel);
  send(url.origin, "stale-channel");
  expect(queryByTestId("native-admin-card")).toBeNull();
  send(url.origin, channel);
  await waitFor(() => expect(queryByTestId("native-admin-card")).not.toBeNull());
  expect(queryByTestId("native-admin-card")?.getAttribute("data-demo")).toBe("true");
});

it("renders only a trusted admin action dialog and sends its native field change through the guarded bridge", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  mocks.props.onMessage({ nativeEvent: { url: `${url.origin}/gate/change-over`, data: JSON.stringify({ type: "gate-native-admin-layout", channel, bounds: { top: 200, left: 24, width: 320, height: 300, stationId: "gate-1", active: false, gateGoDemo: true } }) } });
  const dialog = { title: "Start Ticket", description: "Choose an approved service", items: [{ id: "control-1", kind: "input", label: "Period starts", value: "" }] };
  const send = (origin: string, token: string | null) => mocks.props.onMessage({ nativeEvent: { url: `${origin}/gate/change-over`, data: JSON.stringify({ type: "gate-native-admin-dialog", channel: token, dialog }) } });
  send("https://untrusted.test", channel);
  send(url.origin, "stale-channel");
  expect(queryByTestId("native-admin-dialog")).toBeNull();
  send(url.origin, channel);
  await waitFor(() => expect(queryByTestId("native-admin-dialog")?.getAttribute("data-title")).toBe("Start Ticket"));
  fireEvent.click(queryByTestId("native-admin-dialog")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("control-1"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("dataset.nativeAdmin!=='1'"));
});

it("shows the native Workday card only for a trusted iOS Gate Dashboard layout message", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const bounds = { top: 120, left: 24, width: 600, height: 74, siteId: 1, stationId: "gate-1", gateName: "Outer Circle", active: true };
  const send = (origin: string, token: string | null) => mocks.props.onMessage({ nativeEvent: {
    url: `${origin}/gate/change-over`, data: JSON.stringify({ type: "gate-native-workday-layout", channel: token, bounds }),
  } });
  send("https://untrusted.test", channel);
  send(url.origin, "stale-channel");
  expect(queryByTestId("native-workday-card")).toBeNull();
  send(url.origin, channel);
  await waitFor(() => expect(queryByTestId("native-workday-card")).not.toBeNull());
});

it("renders Gate Dashboard loading and error lines natively and delegates Retry", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (origin: string, token: string | null, strips: object[]) => mocks.props.onMessage({ nativeEvent: { url: `${origin}/gate/change-over`, data: JSON.stringify({ type: "gate-native-dashboard-statuses", channel: token, strips }) } });
  const loading = { id: "loading", top: 160, left: 20, width: 300, height: 20, active: true, message: "Loading…", retryLabel: "" };
  send("https://untrusted.test", channel, [loading]);
  send(url.origin, "stale", [loading]);
  expect(queryByTestId("native-dashboard-status-loading")).toBeNull();
  send(url.origin, channel, [loading]);
  await waitFor(() => expect(queryByTestId("native-dashboard-status-loading")?.getAttribute("data-message")).toBe("Loading…"));
  const error = { id: "error", top: 160, left: 20, width: 300, height: 20, active: true, message: "State unavailable", retryLabel: "Retry" };
  send(url.origin, channel, [error]);
  await waitFor(() => expect(queryByTestId("native-dashboard-status-error")?.getAttribute("data-message")).toBe("State unavailable"));
  fireEvent.click(queryByTestId("native-dashboard-status-error")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("data-gate-dashboard-status-native-slot"));
  send(url.origin, channel, []);
  await waitFor(() => expect(queryByTestId("native-dashboard-status-error")).toBeNull());
});

it("shows Gate activity only after trusted layout and live data arrive", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (origin: string, token: string | null, message: object) => mocks.props.onMessage({ nativeEvent: {
    url: `${origin}/gate/change-over`, data: JSON.stringify({ ...message, channel: token }),
  } });
  const bounds = { top: 220, left: 24, width: 320, height: 300, active: true };
  const data = { type: "gate-native-activity-data", historyBaseHref: "/gate/history?range=24h", snapshot: JSON.stringify({ metrics: { checkIns: 4 } }) };
  send("https://untrusted.test", channel, { type: "gate-native-activity-layout", bounds });
  send(url.origin, "old-channel", data);
  expect(queryByTestId("native-activity-card")).toBeNull();
  send(url.origin, channel, { type: "gate-native-activity-layout", bounds });
  expect(queryByTestId("native-activity-card")).toBeNull();
  send(url.origin, channel, data);
  await waitFor(() => expect(queryByTestId("native-activity-card")?.getAttribute("data-check-ins")).toBe("4"));
  expect(queryByTestId("native-activity-card")?.getAttribute("data-history")).toBe("/gate/history?range=24h");
});

it("mounts the Gate Log activity card from its trusted history page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (source: string, token: string | null, message: object) => mocks.props.onMessage({ nativeEvent: { url: source, data: JSON.stringify({ ...message, channel: token }) } });
  send(url.href, channel, { type: "gate-native-activity-layout", bounds: { top: 100, left: 20, width: 320, height: 280, active: true } });
  send("https://untrusted.test/gate/history", channel, { type: "gate-native-activity-data", historyBaseHref: "/gate/history?range=24h", snapshot: JSON.stringify({ metrics: { checkIns: 9 } }) });
  expect(queryByTestId("native-activity-card")).toBeNull();
  send(url.href, channel, { type: "gate-native-activity-data", historyBaseHref: "/gate/history?range=24h", snapshot: JSON.stringify({ metrics: { checkIns: 9 } }) });
  await waitFor(() => expect(queryByTestId("native-activity-card")?.getAttribute("data-check-ins")).toBe("9"));
});
it("mounts Gate Log visit cards only from the trusted history page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const record = { id: "visit:1", name: "Synthetic Visitor", description: "Test Company", status: "On Site", overdue: false, flags: [], footer: null, actionLabel: "View", actionDisabled: false, checkedIn: null, checkedOut: null, duration: null };
  const message = { type: "gate-native-log-records", channel, cards: [{ id: record.id, record: JSON.stringify(record), top: 100, left: 20, width: 320, height: 100, active: true }], arrivals: [] };
  mocks.props.onMessage({ nativeEvent: { url: "https://untrusted.test/gate/history", data: JSON.stringify(message) } });
  expect(queryByTestId("native-gate-log-record")).toBeNull();
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify(message) } });
  await waitFor(() => expect(queryByTestId("native-gate-log-record")?.getAttribute("data-person")).toBe("Synthetic Visitor"));
  fireEvent.click(queryByTestId("native-gate-log-record")!);
  expect(queryByTestId("native-gate-log-details")?.getAttribute("data-record")).toBe("visit:1");
});
it("mounts Gate Log arrival cards only from the trusted history page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const arrival = { id: "arrival:1", runId: "run-1", siteId: 10, name: "Synthetic Driver", description: "Test Company", status: "Arriving", flags: [], footer: null, detail: "#123", eta: "5 min", actionLabel: null, isNew: false };
  const message = { type: "gate-native-log-records", channel, cards: [], arrivals: [{ id: arrival.id, arrival: JSON.stringify(arrival), top: 100, left: 20, width: 320, height: 100, active: true }] };
  mocks.props.onMessage({ nativeEvent: { url: "https://untrusted.test/gate/history", data: JSON.stringify(message) } });
  expect(queryByTestId("native-gate-log-arrival")).toBeNull();
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify(message) } });
  await waitFor(() => expect(queryByTestId("native-gate-log-arrival")?.getAttribute("data-person")).toBe("Synthetic Driver"));
  fireEvent.click(queryByTestId("native-gate-log-arrival")!);
  expect(queryByTestId("native-gate-arrival-details")?.getAttribute("data-run")).toBe("run-1");
});
it("opens sample inbound arrival detail natively with the preview record", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const previewDetail = { runId: "sample-inbound-10-1", siteLocationId: 10, title: "Synthetic delivery", loads: [], events: [], linkedVisitIds: [] };
  const arrival = { id: "sample-inbound-10-1", runId: previewDetail.runId, siteId: 10, name: "Synthetic Driver", description: "Test Company", status: "Arriving", flags: [], footer: null, detail: "#SAMPLE-1", eta: "5 min", actionLabel: null, isNew: false, previewDetail };
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify({ type: "gate-native-log-records", channel, cards: [], arrivals: [{ id: arrival.id, arrival: JSON.stringify(arrival), top: 100, left: 20, width: 320, height: 100, active: true }] }) } });
  await waitFor(() => expect(queryByTestId("native-gate-log-arrival")).not.toBeNull());
  fireEvent.click(queryByTestId("native-gate-log-arrival")!);
  expect(queryByTestId("native-gate-arrival-details")?.getAttribute("data-preview")).toBe("Synthetic delivery");
  expect(mocks.inject).not.toHaveBeenCalledWith(expect.stringContaining(".gate-record-link')?.click"));
});
it("mounts Gate Log filters only from the trusted history page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const message = { type: "gate-native-log-filter", channel, bounds: { top: 80, left: 20, width: 320, height: 45, active: true, selected: "on_site" } };
  mocks.props.onMessage({ nativeEvent: { url: "https://untrusted.test/gate/history", data: JSON.stringify(message) } });
  expect(queryByTestId("native-gate-log-filter")).toBeNull();
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify(message) } });
  await waitFor(() => expect(queryByTestId("native-gate-log-filter")?.getAttribute("data-selected")).toBe("on_site"));
});
it("mounts Gate Log query controls only from the trusted history page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const message = { type: "gate-native-log-query", channel, bounds: { top: 130, left: 20, width: 320, height: 130, active: true, query: { search: "Synthetic Visitor", range: "24h", recordType: "all", recordTypeDisabled: false, customWindow: null } } };
  mocks.props.onMessage({ nativeEvent: { url: "https://untrusted.test/gate/history", data: JSON.stringify(message) } });
  expect(queryByTestId("native-gate-log-query")).toBeNull();
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify(message) } });
  await waitFor(() => expect(queryByTestId("native-gate-log-query")?.getAttribute("data-search")).toBe("Synthetic Visitor"));
  fireEvent.click(queryByTestId("native-gate-log-query")!.querySelector("button:nth-of-type(1)")!);
  fireEvent.click(queryByTestId("native-gate-log-query")!.querySelector("button:nth-of-type(2)")!);
  fireEvent.click(queryByTestId("native-gate-log-query")!.querySelector("button:nth-of-type(3)")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining('"field":"search","value":"Synthetic search"'));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining('"field":"range","value":"7d"'));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining('"field":"recordType","value":"check_ins"'));
});
it("mounts the Gate Log site and gate selector only from its trusted page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const message = { type: "gate-native-log-select", channel, bounds: { top: 50, left: 20, width: 320, height: 75, active: true, sites: JSON.stringify([{ id: 2, name: "Synthetic Site" }]), gates: JSON.stringify([{ id: "gate-1", name: "Gate One", siteId: 2 }, { id: "gate-2", name: "Gate Two", siteId: 2 }]), siteId: 2, gateId: "gate-1", gateName: "Gate One" } };
  mocks.props.onMessage({ nativeEvent: { url: "https://untrusted.test/gate/history", data: JSON.stringify(message) } });
  expect(queryByTestId("native-gate-log-select")).toBeNull();
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify(message) } });
  await waitFor(() => expect(queryByTestId("native-gate-log-select")?.getAttribute("data-gate")).toBe("gate-1"));
  expect(queryByTestId("native-gate-log-select")?.getAttribute("data-gates")).toBe("2");
  fireEvent.click(queryByTestId("native-gate-log-select")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining('gate-native-log-selection'));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining('gate-2'));
});
it("mounts the Gate Log header only from its trusted page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const message = { type: "gate-native-log-header", channel, bounds: { top: 20, left: 20, width: 320, height: 55, active: true, title: "Gate Log", subtitle: "Review gate activity", backLabel: "Back to Gate", fallbackHref: "/gate/change-over?siteId=2&stationId=gate-1" } };
  mocks.props.onMessage({ nativeEvent: { url: "https://untrusted.test/gate/history", data: JSON.stringify(message) } });
  expect(queryByTestId("native-gate-log-header")).toBeNull();
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify(message) } });
  await waitFor(() => expect(queryByTestId("native-gate-log-header")?.getAttribute("data-title")).toBe("Gate Log"));
  fireEvent.click(queryByTestId("native-gate-log-header")!);
  expect(mocks.back).toHaveBeenCalledOnce();
  mocks.canGoBack = false;
  fireEvent.click(queryByTestId("native-gate-log-header")!);
  expect(mocks.replace).toHaveBeenCalledWith({ pathname: "/change-over", params: { siteId: "2", stationId: "gate-1" } });
});
it("mounts the Gate Log export control only from its trusted page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const message = { type: "gate-native-log-export", channel, bounds: { top: 50, left: 350, width: 144, height: 40, active: true, filters: JSON.stringify({ siteId: 2, range: "24h", recordType: "all" }), disabled: false } };
  mocks.props.onMessage({ nativeEvent: { url: "https://untrusted.test/gate/history", data: JSON.stringify(message) } });
  expect(queryByTestId("native-gate-log-export")).toBeNull();
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify(message) } });
  await waitFor(() => expect(queryByTestId("native-gate-log-export")?.getAttribute("data-range")).toBe("24h"));
});
it("mounts Gate Log pagination only from its trusted page", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/history" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const message = { type: "gate-native-log-pages", channel, bounds: { top: 500, left: 20, width: 320, height: 44, active: true, pages: { start: 1, end: 50, total: 83, page: 0, lastPage: 1 } } };
  mocks.props.onMessage({ nativeEvent: { url: "https://untrusted.test/gate/history", data: JSON.stringify(message) } });
  expect(queryByTestId("native-gate-log-pages")).toBeNull();
  mocks.props.onMessage({ nativeEvent: { url: url.href, data: JSON.stringify(message) } });
  await waitFor(() => expect(queryByTestId("native-gate-log-pages")?.getAttribute("data-total")).toBe("83"));
  fireEvent.click(queryByTestId("native-gate-log-pages")!.querySelector("button:nth-of-type(1)")!);
  fireEvent.click(queryByTestId("native-gate-log-pages")!.querySelector("button:nth-of-type(2)")!);
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("#gate-log-pages-native-slot button:first-of-type"));
  expect(mocks.inject).toHaveBeenCalledWith(expect.stringContaining("#gate-log-pages-native-slot button:last-of-type"));
});

it("shows On site in its native slot with the current Gate snapshot", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (message: object) => mocks.props.onMessage({ nativeEvent: {
    url: `${url.origin}/gate/change-over`, data: JSON.stringify({ ...message, channel }),
  } });
  send({ type: "gate-native-on-site-layout", bounds: { top: 220, left: 360, width: 320, height: 300, active: true, allGates: true } });
  expect(queryByTestId("native-on-site-card")).toBeNull();
  send({ type: "gate-native-activity-data", historyBaseHref: "/gate/history?range=24h", snapshot: JSON.stringify({ metrics: { onSiteVisitorRecords: 3 } }) });
  await waitFor(() => expect(queryByTestId("native-on-site-card")?.getAttribute("data-visitors")).toBe("3"));
  expect(queryByTestId("native-on-site-card")?.getAttribute("data-all-gates")).toBe("true");
});

it("mounts the native Tasks card only for its trusted Gate layout", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (origin: string, token: string | null) => mocks.props.onMessage({ nativeEvent: {
    url: `${origin}/gate/change-over`, data: JSON.stringify({ type: "gate-native-tasks-layout", channel: token, bounds: { top: 300, left: 350, width: 320, height: 280, active: true } }),
  } });
  send("https://untrusted.test", channel);
  send(url.origin, "stale-channel");
  expect(queryByTestId("native-tasks-card")).toBeNull();
  send(url.origin, channel);
  await waitFor(() => expect(queryByTestId("native-tasks-card")?.getAttribute("data-web-card")).toBe("true"));
});

it("mounts Watch & handover only after trusted Gate layout and state arrive", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (origin: string, token: string | null, message: object) => mocks.props.onMessage({ nativeEvent: {
    url: `${origin}/gate/change-over`, data: JSON.stringify({ ...message, channel: token }),
  } });
  const bounds = { top: 200, left: 20, width: 320, height: 280, active: true };
  const data = { type: "gate-native-watch-data", stationId: "gate-1", current: JSON.stringify({ shift: { operator_name: "John" } }) };
  send("https://untrusted.test", channel, { type: "gate-native-watch-layout", bounds });
  send(url.origin, "stale", data);
  expect(queryByTestId("native-watch-card")).toBeNull();
  send(url.origin, channel, { type: "gate-native-watch-layout", bounds });
  expect(queryByTestId("native-watch-card")).toBeNull();
  send(url.origin, channel, { type: "gate-native-watch-data", stationId: "gate-1", phase: "pending", current: "" });
  await waitFor(() => expect(queryByTestId("native-watch-card")?.getAttribute("data-phase")).toBe("pending"));
  send(url.origin, channel, { type: "gate-native-watch-data", stationId: "gate-1", phase: "error", current: "" });
  await waitFor(() => expect(queryByTestId("native-watch-card")?.getAttribute("data-phase")).toBe("error"));
  send(url.origin, channel, data);
  await waitFor(() => expect(queryByTestId("native-watch-card")?.getAttribute("data-operator")).toBe("John"));
  expect(queryByTestId("native-watch-card")?.getAttribute("data-phase")).toBe("ready");
  expect(queryByTestId("native-watch-card")?.getAttribute("data-station")).toBe("gate-1");
});

it("mounts Shift handoff only after trusted Gate layout and state arrive", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (origin: string, token: string | null, message: object) => mocks.props.onMessage({ nativeEvent: {
    url: `${origin}/gate/change-over`, data: JSON.stringify({ ...message, channel: token }),
  } });
  const bounds = { top: 200, left: 20, width: 320, height: 280, active: true };
  const data = { type: "gate-native-handoff-data", stationId: "gate-1", current: JSON.stringify({ shift: { operator_name: "John" } }), gatekeeperOnDuty: true, online: true, readError: false, pendingWatch: false };
  send("https://untrusted.test", channel, { type: "gate-native-handoff-layout", bounds });
  send(url.origin, "stale", data);
  expect(queryByTestId("native-handoff-card")).toBeNull();
  send(url.origin, channel, { type: "gate-native-handoff-layout", bounds });
  expect(queryByTestId("native-handoff-card")).toBeNull();
  send(url.origin, channel, { type: "gate-native-handoff-data", stationId: "gate-1", phase: "pending", current: "", gatekeeperOnDuty: false, online: true, readError: false, pendingWatch: false });
  await waitFor(() => expect(queryByTestId("native-handoff-pending")?.getAttribute("data-phase")).toBe("pending"));
  send(url.origin, channel, { type: "gate-native-handoff-data", stationId: "gate-1", phase: "error", current: "", gatekeeperOnDuty: false, online: true, readError: true, pendingWatch: false });
  await waitFor(() => expect(queryByTestId("native-handoff-pending")?.getAttribute("data-phase")).toBe("error"));
  send(url.origin, channel, data);
  await waitFor(() => expect(queryByTestId("native-handoff-card")?.getAttribute("data-operator")).toBe("John"));
  expect(queryByTestId("native-handoff-pending")).toBeNull();
  expect(queryByTestId("native-handoff-card")?.getAttribute("data-station")).toBe("gate-1");
});

it("mounts Supervisor recovery only after trusted Gate layout and state arrive", async () => {
  mocks.platform = "ios";
  const { queryByTestId } = render(<GateWebPage path="/gate/change-over" />);
  await waitFor(() => expect(mocks.props).not.toBeNull());
  const url = new URL(mocks.props.source.uri);
  const channel = url.searchParams.get("gateVoiceChannel");
  const send = (origin: string, token: string | null, message: object) => mocks.props.onMessage({ nativeEvent: {
    url: `${origin}/gate/change-over`, data: JSON.stringify({ ...message, channel: token }),
  } });
  const bounds = { top: 200, left: 20, width: 320, height: 280, active: true };
  const data = { type: "gate-native-supervisor-data", stationId: "gate-1", current: JSON.stringify({ shift: { operator_name: "John" } }) };
  send("https://untrusted.test", channel, { type: "gate-native-supervisor-layout", bounds });
  send(url.origin, "stale", data);
  expect(queryByTestId("native-supervisor-card")).toBeNull();
  send(url.origin, channel, { type: "gate-native-supervisor-layout", bounds });
  expect(queryByTestId("native-supervisor-card")).toBeNull();
  send(url.origin, channel, data);
  await waitFor(() => expect(queryByTestId("native-supervisor-card")?.getAttribute("data-operator")).toBe("John"));
  expect(queryByTestId("native-supervisor-card")?.getAttribute("data-station")).toBe("gate-1");
});
