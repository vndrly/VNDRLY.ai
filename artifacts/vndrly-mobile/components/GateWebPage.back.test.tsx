import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ props: null as any, back: vi.fn(), user: { id: 1 }, update: vi.fn(), register: vi.fn(() => () => {}), header: false, platform: "web" }));
vi.mock("react-native", async importOriginal => {
  const actual = await importOriginal<typeof import("react-native")>();
  return { ...actual, Platform: { ...actual.Platform, get OS() { return mocks.platform; } } };
});
vi.mock("@/hooks/use-askv-voice-session",()=>({useAskVVoiceSession:()=>({assistant:{messages:[],streaming:false,send:vi.fn()},error:null})}));
vi.mock("@/lib/page-back", () => ({ pageBack: mocks.back }));
vi.mock("expo-router", () => ({ useFocusEffect: React.useEffect, useLocalSearchParams: () => ({}), usePathname: () => "/work-hub/profile" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user, activeMembershipId: 1 }) }));
vi.mock("@/lib/api", () => ({ getApiBase: () => "https://example.test" }));
vi.mock("@/lib/auth", () => ({ getToken: async () => "synthetic-test-token" }));
vi.mock("./gate/GateHeaderActions", () => ({ useGateHeaderActions: () => mocks.header ? { update: mocks.update, register: mocks.register } : undefined }));
vi.mock("./GateOfflineLog", () => ({ default: () => null }));
vi.mock("@/lib/gate-offline-runtime", () => ({ saveOfflineGate: vi.fn() }));
vi.mock("@/lib/gate-askv-bridge", () => ({ createGateAskVBridge: () => ({ dispose() {}, clear() {}, receive() {} }) }));
vi.mock("react-native-webview", () => ({ WebView: (props: any) => { mocks.props = props; return <div />; } }));
import GateWebPage from "./GateWebPage";
import {overlayOwner} from "@/lib/overlay-owner";

afterEach(() => { cleanup(); mocks.back.mockClear(); mocks.update.mockClear(); mocks.register.mockClear(); mocks.props = null; mocks.header = false; mocks.platform = "web"; });

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
