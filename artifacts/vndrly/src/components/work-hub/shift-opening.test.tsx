import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
const state = vi.hoisted(() => ({ user: { userId: 2, role: "vendor", vendorId: 7, partnerId: null, membershipRole: "admin", activeMembershipId: 12 } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@/components/png-pill-rollover", () => ({ PngPillButton: ({ children, color, ...props }: any) => <button {...props}>{children}</button> }));
import ShiftOpening from "./shift-opening";
const id = "932cd920-1e24-4799-9918-752c8a83494c";
const item = { id, title: "Future test shift", ownerOrgType: "vendor", ownerOrgId: 7, version: 2, open: false, startsAt: "2099-10-08T03:00:00Z", endsAt: "2099-10-08T04:00:00Z", milestoneStatus: "upcoming", assigneeUserIds: [], siteLocationId: 392 };
const result = (data: unknown) => ({ ok: true, json: async () => data });
beforeEach(() => { cleanup(); sessionStorage.clear(); state.user.vendorId = 7; vi.stubGlobal("crypto", webcrypto); });
async function review() {
  fireEvent.change(screen.getByLabelText("Choose a shift"), { target: { value: id } });
  fireEvent.click(screen.getByText("Review change"));
  await screen.findByText("Save reviewed change");
}
it("uses fresh selected version and refuses assigned shifts without writing", async () => {
  const fetch = vi.fn().mockResolvedValue(result({ item: { ...item, assigneeUserIds: [42] } })); vi.stubGlobal("fetch", fetch);
  render(<ShiftOpening shifts={[{ item }]} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Choose a shift"), { target: { value: id } }); fireEvent.click(screen.getByText("Review change"));
  await screen.findByText("This shift cannot be changed. Refresh the calendar.");
  expect(fetch).toHaveBeenCalledTimes(1); expect(sessionStorage.length).toBe(0);
});
it("a receipt transport failure never submits and retains the exact request for retry", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(result({ item })).mockRejectedValue(Error("offline")); vi.stubGlobal("fetch", fetch);
  render(<ShiftOpening shifts={[{ item }]} onSaved={vi.fn()} />); await review();
  const original = sessionStorage.getItem(sessionStorage.key(0)!);
  fireEvent.click(screen.getByText("Save reviewed change")); await screen.findByText(/result is unresolved/);
  expect(fetch.mock.calls.every(call => call[1].method === "GET")).toBe(true);
  fireEvent.click(screen.getByText("Check the same request")); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(fetch.mock.calls[2][0]).toBe(fetch.mock.calls[1][0]); expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(original);
});
it("a saved exact receipt remains saved when calendar refresh fails", async () => {
  const fetch = vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("calendar/items")) return result({ item });
    const attempt = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
    return result({ receipt: { operationId: attempt.input.operationId, actorUserId: 2, ownerOrgType: "vendor", ownerOrgId: 7, shiftId: id, previousVersion: 2, resultingVersion: 3, open: true, commandFingerprint: attempt.commandFingerprint, recordedAt: "2026-10-07T23:00:00Z", physicalAttendanceVerified: false } });
  }); vi.stubGlobal("fetch", fetch);
  render(<ShiftOpening shifts={[{ item }]} onSaved={vi.fn().mockRejectedValue(Error("refresh"))} />); await review(); fireEvent.click(screen.getByText("Save reviewed change"));
  await screen.findByText("Change saved. Calendar refresh failed."); expect(sessionStorage.length).toBe(0); expect(fetch.mock.calls.every(call => call[1].method === "GET")).toBe(true);
});
it("an account switch prevents a pending snapshot from becoming a request", async () => {
  let resolve!: (value: unknown) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise(r => { resolve = r; })));
  const view = render(<ShiftOpening shifts={[{ item }]} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Choose a shift"), { target: { value: id } }); fireEvent.click(screen.getByText("Review change"));
  state.user.vendorId = 8; view.rerender(<ShiftOpening shifts={[{ item }]} onSaved={vi.fn()} />); resolve(result({ item }));
  await waitFor(() => expect(screen.queryByText("Save reviewed change")).toBeNull()); expect(sessionStorage.length).toBe(0);
});
it("rejects a body-tampered persisted request before any server request", async () => {
  const fetch = vi.fn().mockResolvedValue(result({ item })); vi.stubGlobal("fetch", fetch);
  const view = render(<ShiftOpening shifts={[{ item }]} onSaved={vi.fn()} />); await review();
  const key = sessionStorage.key(0)!; const attempt = JSON.parse(sessionStorage.getItem(key)!);
  attempt.input.open = false; sessionStorage.setItem(key, JSON.stringify(attempt)); view.unmount(); fetch.mockClear();
  render(<ShiftOpening shifts={[{ item }]} onSaved={vi.fn()} />);
  fireEvent.click(await screen.findByText("Check the same request"));
  await screen.findByText("A saved request could not be verified. Do not create a replacement request."); expect(fetch).not.toHaveBeenCalled();
});
