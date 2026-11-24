import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
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
vi.mock("./GateSiteGateSelect", () => ({ default: (props: any) => <button data-testid="native-gate-log-select" data-site={props.siteId} data-gate={props.gate?.id} data-gates={props.gateOptions?.length} onClick={() => props.onChange?.(2,"gate-2")} /> }));
vi.mock("@/lib/gate-offline-runtime", () => ({ saveOfflineGate: vi.fn() }));
vi.mock("@/lib/gate-askv-bridge", () => ({ createGateAskVBridge: () => ({ dispose() {}, clear() {}, receive() {} }) }));
vi.mock("react-native-webview", () => ({ WebView: React.forwardRef((props: any, ref) => { mocks.props = props; React.useImperativeHandle(ref, () => ({ injectJavaScript: mocks.inject })); return <div />; }) }));
import GateWebPage from "./GateWebPage";
import {overlayOwner} from "@/lib/overlay-owner";

afterEach(() => { cleanup(); mocks.inject.mockClear(); mocks.back.mockClear(); mocks.replace.mockClear(); mocks.push.mockClear(); mocks.params = {}; mocks.canGoBack = true; mocks.update.mockClear(); mocks.register.mockClear(); mocks.controls.clear(); mocks.gateDraft = null; mocks.props = null; mocks.header = false; mocks.platform = "web"; });

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

it.each(["/gate", "/gate/change-over", "/gate/map", "/gate/history", "/gate/shift-notes", "/work-hub", "/work-hub/chat", "/work-hub/calendar", "/work-hub/assets", "/work-hub/files", "/work-hub/library"] as const)("retains %s in the trusted companion instead of extracting converted native cards", async path => {
 mocks.platform = "ios";
 render(<GateWebPage path={path}/>);
 await waitFor(()=>expect(mocks.props).not.toBeNull());
 const url=new URL(mocks.props.source.uri);
 expect(url.origin).toBe("https://example.test"); expect(url.pathname).toBe(path);
 expect(url.searchParams.get("gateDashboardEmbed")).toBe("1");
 expect(url.searchParams.get("gateDevice")).toBe("ios");
 expect(url.searchParams.has("gateNativeCards")).toBe(false);
});
it("routes only trusted current-channel companion links into the native workspace",async()=>{
 render(<GateWebPage path="/work-hub/chat"/>);await waitFor(()=>expect(mocks.props).not.toBeNull());
 const url=new URL(mocks.props.source.uri),channel=url.searchParams.get("gateVoiceChannel");
 const send=(source:string,token:string|null,href:string)=>mocks.props.onMessage({nativeEvent:{url:source,data:JSON.stringify({type:"workspace-navigate",channel:token,href})}});
 send("https://untrusted.test/work-hub/chat",channel,"/work-hub/calendar");send(url.href,"stale","/work-hub/calendar");send(url.href,channel,"https://untrusted.test/");expect(mocks.push).not.toHaveBeenCalled();
 send(url.href,channel,"/work-hub/calendar");expect(mocks.push).toHaveBeenCalledWith("/work-hub/calendar");
});
