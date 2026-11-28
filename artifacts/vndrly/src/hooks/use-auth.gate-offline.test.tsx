import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AuthProvider, useAuth } from "./use-auth";

const store = vi.hoisted(() => ({
  held: null as { username: string; password: string } | null,
  remember: vi.fn(async () => undefined),
  confirm: vi.fn(async () => undefined),
  offline: vi.fn(),
  retained: vi.fn(),
  release: vi.fn(async () => undefined),
}));
vi.mock("@/lib/gate-offline-store", () => ({
  rememberGateSignIn: store.remember,
  confirmGateSignIn: store.confirm,
  offlineGateSignIn: store.offline,
  retainedGateSignIn: store.retained,
  releaseGateSignIn: store.release,
  heldGateSignIn: () => store.held,
  forgetGatePassword: () => { store.held = null; },
  isGateOffline: (error: { status?: number }) => typeof error?.status !== "number",
}));
vi.mock("@/lib/fleet-offline-bootstrap", () => ({ readWebFleetOfflineAuth: vi.fn(async () => null), deactivateWebFleetOffline: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ default: { language: "en", changeLanguage: vi.fn() } }));

const keeper = { userId: 7, role: "vendor", vendorId: 11, activeMembershipId: 9, displayName: "Gate Keeper" };
const down = () => Promise.reject(new TypeError("Failed to fetch"));
const answer = (status: number, body: unknown = {}) => Promise.resolve({ ok: status < 400, status, json: async () => body });
/** A server that answers each path with whatever the test currently says. */
const server = (routes: Record<string, () => Promise<unknown>>) =>
  vi.stubGlobal("fetch", vi.fn((url: string) => (Object.entries(routes).find(([path]) => String(url).endsWith(path))?.[1] ?? down)()));

let failure: unknown;
function View() {
  const { user, isLoading, login, logout } = useAuth();
  return <div>
    <p>{isLoading ? "Loading" : user ? `${user.displayName}:${user.offlineOnly ? "offline" : "live"}` : "Signed out"}</p>
    <button onClick={() => void login("keeper", "correct horse").catch((error) => { failure = error; })}>Sign in</button>
    <button onClick={() => void logout()}>Sign out</button>
  </div>;
}
const signIn = () => act(async () => { screen.getByText("Sign in").click(); });

beforeEach(() => { failure = undefined; store.held = null; window.localStorage.clear(); window.history.replaceState({}, "", "/login"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("remembers a gate company's sign-in for use with no connection, and nobody else's", async () => {
  server({ "/api/auth/me": () => answer(401), "/api/auth/login": () => answer(200, keeper) });
  render(<AuthProvider><View /></AuthProvider>);
  await screen.findByText("Signed out");
  await signIn();
  expect(await screen.findByText("Gate Keeper:live")).toBeTruthy();
  expect(store.remember).toHaveBeenCalledWith("keeper", "correct horse", expect.objectContaining({ userId: 7 }));
  cleanup();
  store.remember.mockClear();
  server({ "/api/auth/me": () => answer(401), "/api/auth/login": () => answer(200, { ...keeper, role: "partner", vendorId: null, partnerId: 3 }) });
  render(<AuthProvider><View /></AuthProvider>);
  await screen.findByText("Signed out");
  await signIn();
  await screen.findByText("Gate Keeper:live");
  expect(store.remember).not.toHaveBeenCalled();
});

it("signs in on this computer with no connection, then for real when the server answers", async () => {
  const routes: Record<string, () => Promise<unknown>> = { "/api/auth/me": down, "/api/auth/login": down };
  server(routes);
  store.offline.mockImplementation(async (username: string, password: string) => { store.held = { username, password }; return keeper; });
  render(<AuthProvider><View /></AuthProvider>);
  await signIn();
  expect(await screen.findByText("Gate Keeper:offline")).toBeTruthy();
  expect(store.offline).toHaveBeenCalledWith("keeper", "correct horse");
  // The connection returns: there is no server session yet, so the typed password signs in for real.
  routes["/api/auth/me"] = () => answer(401);
  routes["/api/auth/login"] = () => answer(200, keeper);
  await act(async () => { window.dispatchEvent(new Event("online")); });
  expect(await screen.findByText("Gate Keeper:live")).toBeTruthy();
  expect(store.held).toBeNull();
  expect(store.release).not.toHaveBeenCalled();
});

it("refuses an offline sign-in this computer cannot confirm, and says why", async () => {
  server({ "/api/auth/me": down, "/api/auth/login": down });
  store.offline.mockResolvedValue(null);
  render(<AuthProvider><View /></AuthProvider>);
  // The sign-in form shows with no connection, instead of waiting on the server.
  await screen.findByText("Signed out");
  await signIn();
  await vi.waitFor(() => expect(failure).toMatchObject({ data: { code: "network.offline_sign_in" } }));
  expect(screen.queryByText(/offline$/)).toBeNull();
});

it("never signs in offline after the server itself refused the password", async () => {
  server({ "/api/auth/me": () => answer(401), "/api/auth/login": () => answer(401, { code: "auth.invalid_credentials" }) });
  render(<AuthProvider><View /></AuthProvider>);
  await screen.findByText("Signed out");
  await signIn();
  await vi.waitFor(() => expect(failure).toMatchObject({ status: 401 }));
  expect(store.offline).not.toHaveBeenCalled();
});

it("keeps the gatekeeper signed in on the Gate when the connection is lost, and nowhere else", async () => {
  server({ "/api/auth/me": down });
  store.retained.mockResolvedValue(keeper);
  window.history.replaceState({}, "", "/gate");
  const gate = render(<AuthProvider><View /></AuthProvider>);
  expect(await screen.findByText("Gate Keeper:offline")).toBeTruthy();
  gate.unmount();
  store.retained.mockClear();
  window.history.replaceState({}, "", "/tickets");
  render(<AuthProvider><View /></AuthProvider>);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(store.retained).not.toHaveBeenCalled();
  expect(screen.getByText("Loading")).toBeTruthy();
});

it("signs out, and stops accepting the password offline, when the server refuses it after the connection returns", async () => {
  const routes: Record<string, () => Promise<unknown>> = { "/api/auth/me": down, "/api/auth/login": down };
  server(routes);
  store.offline.mockImplementation(async (username: string, password: string) => { store.held = { username, password }; return keeper; });
  render(<AuthProvider><View /></AuthProvider>);
  await signIn();
  await screen.findByText("Gate Keeper:offline");
  routes["/api/auth/me"] = () => answer(401);
  routes["/api/auth/login"] = () => answer(401, { code: "auth.invalid_credentials" });
  await act(async () => { window.dispatchEvent(new Event("online")); });
  expect(await screen.findByText("Signed out")).toBeTruthy();
  expect(store.release).toHaveBeenCalledWith(true);
});

it("confirms an offline sign-in with a real sign-in, never with a session someone else left on this computer", async () => {
  const routes: Record<string, () => Promise<unknown>> = { "/api/auth/me": down, "/api/auth/login": down };
  server(routes);
  store.offline.mockImplementation(async (username: string, password: string) => { store.held = { username, password }; return keeper; });
  render(<AuthProvider><View /></AuthProvider>);
  await signIn();
  await screen.findByText("Gate Keeper:offline");
  // The connection returns, and the server still holds another person's session for this browser.
  routes["/api/auth/me"] = () => answer(200, { ...keeper, userId: 8, displayName: "Someone Else" });
  routes["/api/auth/login"] = () => answer(200, keeper);
  await act(async () => { window.dispatchEvent(new Event("online")); });
  expect(await screen.findByText("Gate Keeper:live")).toBeTruthy();
  expect(screen.queryByText(/Someone Else/)).toBeNull();
  expect(store.held).toBeNull();
});

it("delivers a sign-out made with no connection before the server's session is trusted again", async () => {
  let ended = false;
  const routes: Record<string, () => Promise<unknown>> = { "/api/auth/me": () => (ended ? answer(401) : answer(200, keeper)), "/api/auth/logout": down };
  server(routes);
  render(<AuthProvider><View /></AuthProvider>);
  await screen.findByText("Gate Keeper:live");
  // No connection: the sign-out cannot reach the server, which still holds the session.
  routes["/api/auth/me"] = down;
  await act(async () => { screen.getByText("Sign out").click(); });
  await screen.findByText("Signed out");
  // The connection returns: the server is told first, so nobody is signed back in without the password.
  routes["/api/auth/logout"] = () => { ended = true; return answer(200); };
  routes["/api/auth/me"] = () => (ended ? answer(401) : answer(200, keeper));
  await act(async () => { window.dispatchEvent(new Event("online")); });
  await vi.waitFor(() => expect(ended).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByText("Signed out")).toBeTruthy();
});
