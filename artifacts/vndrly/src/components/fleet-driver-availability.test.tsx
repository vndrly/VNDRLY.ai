import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
const account = vi.hoisted(() => ({
  user: { userId: 1069, vendorId: 609, activeMembershipId: 9, role: "vendor", availableMemberships: [{ id: 9, role: "admin" }] },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => account }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({ color, ...props }: any) => <button {...props} />,
}));
import { FleetDriverAvailability } from "./fleet-driver-availability";
const current = {
  driverUserId: 133,
  fingerprint: "a".repeat(64),
  records: [],
  canManage: true,
  physicalReadinessVerified: false,
};
const response = (value: unknown) => ({ ok: true, json: async () => value });
beforeEach(() => {
  vi.restoreAllMocks();
  account.user.userId = 1069;
  account.user.availableMemberships[0].role = "admin";
  vi.stubGlobal("crypto", webcrypto);
});
it("clears reviewed edits when the same membership loses its management role", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(current)));
  const view = render(<FleetDriverAvailability driverUserId={133} />);
  await prepare();
  account.user.availableMemberships[0].role = "member";
  view.rerender(<FleetDriverAvailability driverUserId={133} />);
  await waitFor(() => expect(screen.queryByText("fleetAvailability.confirm")).toBeNull());
  expect(screen.queryByText("fleetAvailability.review")).toBeNull();
  expect(screen.getByText("fleetAvailability.read")).toBeTruthy();
});
async function prepare() {
  fireEvent.click(screen.getByText("fleetAvailability.read"));
  await screen.findByText("fleetAvailability.review");
  fireEvent.change(screen.getByLabelText(/fleetAvailability.start/), {
    target: { value: "2026-10-08T10:00" },
  });
  fireEvent.change(screen.getByLabelText(/fleetAvailability.end/), {
    target: { value: "2026-10-08T11:00" },
  });
  fireEvent.click(screen.getByText("fleetAvailability.review"));
  await screen.findByText("fleetAvailability.confirm");
}
it("uses canonical management permission and does not expose an editor to own read-only driver", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(response({ ...current, canManage: false }));
  vi.stubGlobal("fetch", fetcher);
  render(<FleetDriverAvailability driverUserId={133} />);
  fireEvent.click(screen.getByText("fleetAvailability.read"));
  await screen.findByText("fleetAvailability.noRecords");
  expect(screen.queryByText("fleetAvailability.review")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
});
it("retains exact reviewed body on a dropped save and denied recovery without a second POST", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(current))
    .mockResolvedValueOnce(response({ receipt: null }))
    .mockResolvedValueOnce(response(current))
    .mockRejectedValueOnce(Error("dropped"))
    .mockResolvedValueOnce({ ok: false });
  vi.stubGlobal("fetch", fetcher);
  render(<FleetDriverAvailability driverUserId={133} />);
  await prepare();
  fireEvent.click(screen.getByText("fleetAvailability.confirm"));
  await screen.findByText("fleetAvailability.unknown");
  const original = JSON.parse(fetcher.mock.calls[3][1].body);
  expect(original).toMatchObject({
    driverUserId: 133,
    expectedFingerprint: current.fingerprint,
    available: true,
    recordId: null,
  });
  expect(original.window.plannedEndAt).not.toBe(original.window.plannedStartAt);
  expect(
    (screen.getByLabelText(/fleetAvailability.start/) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByText("fleetAvailability.check"));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));
  expect(fetcher.mock.calls[4][0]).toContain(original.operationId);
  expect(
    fetcher.mock.calls.filter(([, init]) => init.method === "POST"),
  ).toHaveLength(1);
  expect(
    (screen.getByText("fleetAvailability.check") as HTMLButtonElement).disabled,
  ).toBe(false);
});
it("blocks changed evidence before a POST and requires a fresh explicit review", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(current))
    .mockResolvedValueOnce(response({ receipt: null }))
    .mockResolvedValueOnce(
      response({ ...current, fingerprint: "b".repeat(64) }),
    );
  vi.stubGlobal("fetch", fetcher);
  render(<FleetDriverAvailability driverUserId={133} />);
  await prepare();
  fireEvent.click(screen.getByText("fleetAvailability.confirm"));
  await screen.findByText("fleetAvailability.conflict");
  expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(
    true,
  );
  fireEvent.click(screen.getByText("fleetAvailability.reviewCurrent"));
  expect(screen.queryByText("fleetAvailability.confirm")).toBeNull();
  expect(
    (screen.getByText("fleetAvailability.read") as HTMLButtonElement).disabled,
  ).toBe(false);
});
it("does not display a late previous-account read", async () => {
  let finish!: (value: unknown) => void;
  const fetcher = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(<FleetDriverAvailability driverUserId={133} />);
  fireEvent.click(screen.getByText("fleetAvailability.read"));
  account.user.userId = 1073;
  view.rerender(<FleetDriverAvailability driverUserId={133} />);
  finish(response(current));
  await waitFor(() =>
    expect(
      (screen.getByText("fleetAvailability.read") as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(screen.queryByText("fleetAvailability.review")).toBeNull();
});
it("keeps a verified saved result distinct and removes stale controls until a new read", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(current))
    .mockResolvedValueOnce(response({ receipt: null }))
    .mockResolvedValueOnce(response(current))
    .mockImplementationOnce(async (_path, init) => {
      const command = JSON.parse(init.body);
      const values = { actorUserId: 1069, companyId: 609, ...command };
      const fingerprint = Buffer.from(
        await webcrypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(values)),
        ),
      ).toString("hex");
      return response({
        operationId: command.operationId,
        actorUserId: 1069,
        companyId: 609,
        driverUserId: 133,
        commandFingerprint: fingerprint,
        previousFingerprint: current.fingerprint,
        resultingFingerprint: "b".repeat(64),
        record: {
          id: "22222222-2222-4222-8222-222222222222",
          startsAt: command.window.plannedStartAt,
          endsAt: command.window.plannedEndAt,
          available: command.available,
          recurring: false,
        },
        recordedAt: "2026-10-07T18:00:00.000Z",
        physicalReadinessVerified: false,
      });
    });
  vi.stubGlobal("fetch", fetcher);
  render(<FleetDriverAvailability driverUserId={133} />);
  await prepare();
  fireEvent.click(screen.getByText("fleetAvailability.confirm"));
  await screen.findByText("fleetAvailability.saved");
  expect(screen.queryByText("fleetAvailability.review")).toBeNull();
  expect(screen.queryByText("fleetAvailability.check")).toBeNull();
  expect(
    (screen.getByText("fleetAvailability.read") as HTMLButtonElement).disabled,
  ).toBe(false);
});
