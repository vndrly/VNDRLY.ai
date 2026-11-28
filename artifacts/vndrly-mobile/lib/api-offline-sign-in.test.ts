import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  token: null as string | null,
  generation: 1,
  held: null as { username: string; password: string } | null,
  remembered: null as unknown,
}));
const auth = vi.hoisted(() => ({ setUser: vi.fn(async () => undefined), clearIfCurrent: vi.fn() }));
const offline = vi.hoisted(() => ({ remember: vi.fn(async () => undefined), confirm: vi.fn(async () => undefined), signIn: vi.fn() }));

vi.mock("./auth", () => ({
  getToken: async () => state.token,
  getUser: async () => null,
  setToken: async (token: string | null) => { state.token = token; state.generation += 1; },
  setUser: auth.setUser,
  captureAuthScope: () => ({ generation: state.generation }),
  isAuthScopeCurrent: (scope: { generation: number }) => scope.generation === state.generation,
  clearAuthIfCurrent: auth.clearIfCurrent,
}));
vi.mock("./offline-sign-in", () => ({
  OFFLINE_TOKEN: "offline",
  rememberSignIn: offline.remember,
  confirmSignIn: offline.confirm,
  offlineSignIn: offline.signIn,
  heldOfflineSignIn: () => state.held,
  forgetOfflinePassword: () => { state.held = null; },
}));

import { apiFetch, login } from "./api";

const user = { id: 7, username: "gate@example.invalid", role: "field_employee", displayName: "Gate Keeper" };
const down = () => Promise.reject(new TypeError("Network request failed"));
const answer = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, headers: new Headers(), text: async () => JSON.stringify(body), json: async () => body } as Response);
const sent = (index: number) => {
  const [url, init] = vi.mocked(fetch).mock.calls[index];
  return { url: String(url), authorization: new Headers((init as RequestInit).headers).get("authorization") };
};

beforeEach(() => {
  state.token = null; state.generation = 1; state.held = null;
  auth.setUser.mockClear(); auth.clearIfCurrent.mockReset();
  auth.clearIfCurrent.mockImplementation(async () => { state.token = null; state.generation += 1; return true; });
  offline.remember.mockClear(); offline.confirm.mockClear(); offline.signIn.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

it("remembers a sign-in the server accepted, for use with no connection", async () => {
  vi.mocked(fetch).mockImplementationOnce(() => answer(200, { ...user, token: "real" }));
  await login("gate@example.invalid", "correct horse");
  expect(state.token).toBe("real");
  expect(offline.remember).toHaveBeenCalledWith("gate@example.invalid", "correct horse", expect.objectContaining({ id: 7 }));
});

it("signs in on the device when there is no connection and this device knows the sign-in", async () => {
  vi.mocked(fetch).mockImplementationOnce(down);
  offline.signIn.mockResolvedValue(user);
  expect(await login("gate@example.invalid", "correct horse")).toEqual(user);
  expect(state.token).toBe("offline");
  expect(auth.setUser).toHaveBeenCalledWith(user);
});

it("says why when there is no connection and this device does not know the sign-in", async () => {
  vi.mocked(fetch).mockImplementationOnce(down);
  offline.signIn.mockResolvedValue(null);
  await expect(login("gate@example.invalid", "wrong")).rejects.toMatchObject({ code: "network.offline_sign_in" });
  expect(state.token).toBeNull();
});

it("does not fall back to the device when the server itself refuses the password", async () => {
  vi.mocked(fetch).mockImplementationOnce(() => answer(401, { code: "auth.invalid_credentials", message: "Invalid username or password" }));
  await expect(login("gate@example.invalid", "wrong")).rejects.toMatchObject({ status: 401 });
  expect(offline.signIn).not.toHaveBeenCalled();
});

it("signs in with the server on the first request that reaches it, and never sends the offline token", async () => {
  state.token = "offline"; state.held = { username: "gate@example.invalid", password: "correct horse" };
  vi.mocked(fetch)
    .mockImplementationOnce(() => answer(200, { ...user, token: "real" }))
    .mockImplementationOnce(() => answer(200, [{ id: 1 }]));
  expect(await apiFetch("/api/visits")).toEqual([{ id: 1 }]);
  expect(sent(0)).toEqual({ url: expect.stringContaining("/api/auth/login"), authorization: null });
  expect(sent(1)).toEqual({ url: expect.stringContaining("/api/visits"), authorization: "Bearer real" });
  expect(state.held).toBeNull();
});

it("stays signed in on the device while the server still cannot be reached", async () => {
  state.token = "offline"; state.held = { username: "gate@example.invalid", password: "correct horse" };
  vi.mocked(fetch).mockImplementation(down);
  await expect(apiFetch("/api/visits")).rejects.toMatchObject({ code: "network.unreachable" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(state.token).toBe("offline");
  expect(state.held).not.toBeNull();
});

it("signs out when the server no longer accepts the password that was used offline", async () => {
  state.token = "offline"; state.held = { username: "gate@example.invalid", password: "old" };
  vi.mocked(fetch).mockImplementationOnce(() => answer(401, { code: "auth.invalid_credentials", message: "Invalid username or password" }));
  await expect(apiFetch("/api/visits")).rejects.toMatchObject({ status: 401 });
  expect(state.token).toBeNull();
  expect(state.held).toBeNull();
});

it("asks for a fresh sign-in once the server answers and the offline password is no longer held", async () => {
  state.token = "offline";
  vi.mocked(fetch).mockImplementationOnce(() => answer(401, { code: "auth.unauthenticated", message: "Login required" }));
  await expect(apiFetch("/api/visits")).rejects.toMatchObject({ status: 401 });
  expect(sent(0).authorization).toBeNull();
  expect(auth.clearIfCurrent).toHaveBeenCalled();
});
