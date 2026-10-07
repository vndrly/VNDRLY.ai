import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const m = vi.hoisted(() => ({
  api: vi.fn(),
  current: true,
  userId: 1069,
  clear: () => {},
}));
vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => m.api(...args),
}));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => m.current,
  getUser: async () => ({ id: m.userId }),
  subscribeToken: (fn: () => void) => {
    m.clear = fn;
    return () => {};
  },
  subscribeUser: () => () => {},
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: async (_algorithm: string, text: string) =>
    createHash("sha256").update(text).digest("hex"),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: () => <div />,
}));
import FleetDriverAvailability from "./FleetDriverAvailability";
const record = {
  id: "22222222-2222-4222-8222-222222222222",
  startsAt: "2026-10-08T18:00:00.000Z",
  endsAt: "2026-10-08T19:00:00.000Z",
  available: true,
  recurring: false,
};
const current = {
  driverUserId: 133,
  fingerprint: "a".repeat(64),
  records: [record],
  canManage: true,
  physicalReadinessVerified: false,
};
beforeEach(() => {
  cleanup();
  m.api.mockReset();
  m.current = true;
  m.userId = 1069;
});
async function prepare() {
  fireEvent.click(screen.getByText("fleetAvailability.read"));
  await screen.findByText("fleetAvailability.edit");
  fireEvent.click(screen.getByText("fleetAvailability.edit"));
  fireEvent.click(screen.getByText("fleetAvailability.review"));
  await screen.findByText("fleetAvailability.confirm");
}
it("uses canonical driver read-only permission and no fabricated default interval", async () => {
  m.api.mockResolvedValue({ ...current, canManage: false });
  render(
    <FleetDriverAvailability
      driverUserId={133}
      actorUserId={1069}
      companyId={609}
    />,
  );
  fireEvent.click(screen.getByText("fleetAvailability.read"));
  await screen.findByText(/fleetAvailability.boundary/);
  await waitFor(() => expect(m.api).toHaveBeenCalledOnce());
  expect(screen.queryByText("fleetAvailability.review")).toBeNull();
});
it("keeps the reviewed UUID/body after a dropped POST and denied readback", async () => {
  m.api
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce({ receipt: null })
    .mockResolvedValueOnce(current)
    .mockRejectedValueOnce(Error("dropped"))
    .mockRejectedValueOnce(Error("denied"));
  render(
    <FleetDriverAvailability
      driverUserId={133}
      actorUserId={1069}
      companyId={609}
    />,
  );
  await prepare();
  fireEvent.click(screen.getByText("fleetAvailability.confirm"));
  await screen.findByText("fleetAvailability.unknown");
  const original = JSON.parse(m.api.mock.calls[3][1].body);
  expect(original).toMatchObject({
    recordId: record.id,
    expectedFingerprint: current.fingerprint,
    operationId: "11111111-1111-4111-8111-111111111111",
  });
  fireEvent.click(screen.getByText("fleetAvailability.check"));
  await waitFor(() => expect(m.api).toHaveBeenCalledTimes(5));
  expect(m.api.mock.calls[4][0]).toContain(original.operationId);
  expect(
    m.api.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
});
it("clears reviewed controls and suppresses late reads on an account change", async () => {
  let finish!: (value: unknown) => void;
  m.api.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <FleetDriverAvailability
      driverUserId={133}
      actorUserId={1069}
      companyId={609}
    />,
  );
  fireEvent.click(screen.getByText("fleetAvailability.read"));
  await waitFor(() => expect(m.api).toHaveBeenCalledOnce());
  m.userId = 1073;
  view.rerender(
    <FleetDriverAvailability
      driverUserId={133}
      actorUserId={1073}
      companyId={609}
    />,
  );
  finish(current);
  await waitFor(() =>
    expect(
      (screen.getByText("fleetAvailability.read") as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(screen.queryByText("fleetAvailability.edit")).toBeNull();
});
it("requires date and time selection rather than saving the current picker clock", async () => {
  m.api.mockResolvedValue({ ...current, records: [] });
  render(
    <FleetDriverAvailability
      driverUserId={133}
      actorUserId={1069}
      companyId={609}
    />,
  );
  fireEvent.click(screen.getByText("fleetAvailability.read"));
  await screen.findByText("fleetAvailability.review");
  fireEvent.click(screen.getByText("fleetAvailability.review"));
  await screen.findByText("fleetAvailability.invalidTime");
  expect(screen.queryByText("fleetAvailability.confirm")).toBeNull();
  expect(m.api).toHaveBeenCalledOnce();
});
