import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const account = vi.hoisted(() => ({ user: { userId: 9, role: "vendor", activeMembershipId: 5, vendorId: 4, partnerId: null } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => account }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@/components/png-pill-rollover", () => ({ PngPillButton: ({ color, ...props }: any) => <button {...props} /> }));
import TicketLaborFinalization from "./ticket-labor-finalization";
const version = "2026-10-07T10:00:00.000Z";
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body });
beforeEach(() => { sessionStorage.clear(); account.user.userId = 9; vi.restoreAllMocks(); });
function confirm() { fireEvent.click(screen.getByText("Finalize recorded labor")); fireEvent.click(screen.getByText("Confirm freeze")); }
it("uses current server capability instead of role labels", () => {
  render(<TicketLaborFinalization ticketId={7} updatedAt={version} canFinalize={false} onSaved={vi.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
});
it("retains original timestamp and UUID after dropped POST and recovers without a duplicate effect", async () => {
  let original: any;
  const fetcher = vi.fn().mockResolvedValueOnce(response({ receipt: null })).mockImplementationOnce(async (_path, init) => { original = JSON.parse(init.body); throw Error("dropped"); });
  vi.stubGlobal("fetch", fetcher);
  const saved = vi.fn(), view = render(<React.StrictMode><TicketLaborFinalization ticketId={7} updatedAt={version} canFinalize onSaved={saved} /></React.StrictMode>);
  confirm(); await screen.findByText(/Result unresolved/);
  view.rerender(<React.StrictMode><TicketLaborFinalization ticketId={7} updatedAt="2026-10-07T11:00:00.000Z" canFinalize={false} onSaved={saved} /></React.StrictMode>);
  fetcher.mockResolvedValueOnce(response({ receipt: { ticketId: 7, actorUserId: 9, closedById: 9, ...original, updatedAt: "2026-10-07T10:01:00.000Z", closedAt: "2026-10-07T10:01:00.000Z", autoLaborLineCount: 2, status: "applied", physicalWorkVerified: false, submitted: false } }));
  fireEvent.click(screen.getByText("Check saved request"));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[2][0]).toContain(original.operationId);
  expect(screen.queryByRole("button")).toBeNull();
});
it("denied operation readback keeps the exact attempt and never sends another POST", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ receipt: null })).mockRejectedValueOnce(Error("dropped")).mockResolvedValueOnce(response({}, 403));
  vi.stubGlobal("fetch", fetcher);
  render(<TicketLaborFinalization ticketId={7} updatedAt={version} canFinalize onSaved={vi.fn()} />);
  confirm(); await screen.findByText(/Result unresolved/);
  const before = sessionStorage.getItem("vndrly-labor-finalize:9:vendor:5:4::7");
  fireEvent.click(screen.getByText("Check saved request"));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(sessionStorage.getItem("vndrly-labor-finalize:9:vendor:5:4::7")).toBe(before);
  expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
});
it("fences a delayed account response and aborts the old request", async () => {
  let finish!: (value: unknown) => void;
  const fetcher = vi.fn((_path: string, _init: RequestInit) => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const saved = vi.fn(), view = render(<TicketLaborFinalization ticketId={7} updatedAt={version} canFinalize onSaved={saved} />);
  confirm();
  const signal = fetcher.mock.calls[0][1].signal;
  account.user.userId = 10;
  view.rerender(<TicketLaborFinalization ticketId={8} updatedAt={version} canFinalize={false} onSaved={saved} />);
  finish(response({ receipt: null }));
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(fetcher).toHaveBeenCalledOnce(); expect(saved).not.toHaveBeenCalled();
  expect(screen.queryByText(/Result unresolved/)).toBeNull();
});
it("shows journal storage failure without issuing a read or mutation", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("storage full"); });
  render(<TicketLaborFinalization ticketId={7} updatedAt={version} canFinalize onSaved={vi.fn()} />);
  confirm(); await screen.findByText("Could not save the request. No change was sent.");
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByText("Check saved request")).toBeNull();
});
it("requires a changed authoritative timestamp and another review after definitive conflict", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ receipt: null })).mockResolvedValueOnce(response({}, 409));
  vi.stubGlobal("fetch", fetcher);
  const refresh = vi.fn();
  const view = render(<TicketLaborFinalization ticketId={7} updatedAt={version} canFinalize onSaved={refresh} />);
  confirm(); await screen.findByText(/The ticket changed/);
  expect(refresh).toHaveBeenCalledOnce(); expect(screen.queryByRole("button")).toBeNull();
  view.rerender(<TicketLaborFinalization ticketId={7} updatedAt={version} canFinalize onSaved={refresh} />);
  expect(screen.queryByRole("button")).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(2);
  const fresh = "2026-10-07T10:02:00.000Z";
  view.rerender(<TicketLaborFinalization ticketId={7} updatedAt={fresh} canFinalize onSaved={refresh} />);
  await screen.findByText("Finalize recorded labor"); expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockResolvedValueOnce(response({ receipt: null })).mockImplementationOnce(async (_path, init) => {
    const body = JSON.parse(init.body);
    return response({ ticketId: 7, actorUserId: 9, closedById: 9, ...body, updatedAt: "2026-10-07T10:03:00.000Z", closedAt: "2026-10-07T10:03:00.000Z", autoLaborLineCount: 0, status: "applied", physicalWorkVerified: false, submitted: false });
  });
  confirm(); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  const first = JSON.parse(fetcher.mock.calls[1][1].body), second = JSON.parse(fetcher.mock.calls[3][1].body);
  expect(second.expectedUpdatedAt).toBe(fresh); expect(second.operationId).not.toBe(first.operationId);
});
it("a failed refresh after exact saved receipt remains saved and never becomes an uncertain retry", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ receipt: null })).mockImplementationOnce(async (_path, init) => response({ ticketId: 7, actorUserId: 9, closedById: 9, ...JSON.parse(init.body), updatedAt: "2026-10-07T10:01:00.000Z", closedAt: "2026-10-07T10:01:00.000Z", autoLaborLineCount: 0, status: "applied", physicalWorkVerified: false, submitted: false }));
  vi.stubGlobal("fetch", fetcher);
  render(<TicketLaborFinalization ticketId={7} updatedAt={version} canFinalize onSaved={() => { throw Error("refresh unavailable"); }} />);
  confirm(); await screen.findByText(/Totals saved and frozen. The view could not refresh/);
  expect(screen.queryByRole("button")).toBeNull(); expect(screen.queryByText(/Result unresolved/)).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2); expect(sessionStorage.length).toBe(0);
});
