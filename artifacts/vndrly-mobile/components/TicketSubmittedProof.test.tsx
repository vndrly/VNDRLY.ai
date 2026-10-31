import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  apiFetch: api,
  getApiBase: () => "https://example.invalid",
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    foreground: "black",
    card: "white",
    primary: "blue",
    destructive: "red",
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
import TicketSubmittedProof from "./TicketSubmittedProof";
const proof = (revision = 2) => ({
  jobId: 50,
  revision,
  approvedRevision: null,
  submissions: [
    {
      revision,
      jobId: 50,
      afe: "PARTNER-AFE",
      submittedAt: "2026-10-30T12:00:00Z",
      ticket: { description: "Gatekeeping", notes: "Shift completed" },
      lineItems: [
        {
          id: 1,
          description: "Gate coverage",
          quantity: 1,
          unit_price: "100.01",
        },
      ],
      notes: [{ id: 2, content: "Saved work evidence", attachments: [] }],
      checkIns: [],
      gate: null,
    },
  ],
});
beforeEach(() => api.mockReset().mockResolvedValue(proof()));
afterEach(cleanup);
it("shows immutable job and proof and approves the displayed revision without fetching a replacement at click time", async () => {
  const changed = vi.fn();
  render(
    <TicketSubmittedProof
      ticketId={100}
      role="partner"
      status="submitted"
      onChanged={changed}
    />,
  );
  expect(await screen.findByText("Job: #50 · AFE: PARTNER-AFE")).toBeTruthy();
  expect(screen.getByText("Saved work evidence")).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Approve this revision",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("switch", { name: "I reviewed this submitted revision." }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Approve this revision" }),
  );
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(api.mock.calls[1]).toEqual([
    "/api/tickets/100/approve",
    { method: "POST", headers: { "X-Submission-Revision": "2" } },
  ]);
});
it("returns a specific reviewed revision with the correction reason", async () => {
  render(
    <TicketSubmittedProof
      ticketId={100}
      role="partner"
      status="submitted"
      onChanged={() => {}}
    />,
  );
  await screen.findByText("Saved work evidence");
  fireEvent.click(
    screen.getByRole("switch", { name: "I reviewed this submitted revision." }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Reason for correction" }),
    { target: { value: "Missing shift photo" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Return for correction" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/tickets/100/kickback", {
      method: "POST",
      headers: { "X-Submission-Revision": "2" },
      body: JSON.stringify({ reason: "Missing shift photo" }),
    }),
  );
});
it("does not expose partner decisions to a vendor and blocks review when proof failed to load", async () => {
  const view = render(
    <TicketSubmittedProof
      ticketId={100}
      role="vendor"
      status="submitted"
      onChanged={() => {}}
    />,
  );
  await screen.findByText("Saved work evidence");
  expect(
    screen.queryByRole("button", { name: "Approve this revision" }),
  ).toBeNull();
  view.unmount();
  api.mockRejectedValueOnce(new Error("unavailable"));
  render(
    <TicketSubmittedProof
      ticketId={101}
      role="partner"
      status="submitted"
      onChanged={() => {}}
    />,
  );
  expect(
    await screen.findByText(
      "Proof sheet could not be loaded. Refresh before reviewing.",
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Approve this revision" }),
  ).toBeNull();
});
