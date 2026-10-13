import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/components/png-pill-rollover", () => ({ PngPillButton: ({ children, color: _color, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("@/components/work-hub/chrome", () => ({ BrandedInput: (props: any) => <input {...props} /> }));
import { TicketFieldActions } from "./ticket-field-actions";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("travel requires confirmation and captured GPS, saves optional mileage and reads back", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (done: any) => done({ coords: { latitude: 31.9, longitude: -102.1 } }) } });
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }), saved = vi.fn();
  vi.stubGlobal("fetch", request);
  render(<TicketFieldActions id={42} status="initiated" lifecycleState="pending_arrival" onSaved={saved} />);
  fireEvent.change(screen.getByLabelText(/Starting mileage/), { target: { value: "100.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Start Travel" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(request.mock.calls[0][0]).toBe("/api/tickets/42/en-route");
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ latitude: 31.9, longitude: -102.1, startingMileage: 100.5 });
});
it("declining arrival confirmation makes no GPS request or mutation", () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const request = vi.fn(); vi.stubGlobal("fetch", request);
  render(<TicketFieldActions id={42} status="initiated" lifecycleState="en_route" onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Record Arrival" }));
  expect(request).not.toHaveBeenCalled();
});
it("paid on-site work and terminal tickets do not offer travel or arrival", () => {
  const { rerender } = render(<TicketFieldActions id={42} status="in_progress" lifecycleState="on_site" onSaved={vi.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<TicketFieldActions id={42} status="approved" lifecycleState="off_site" onSaved={vi.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
});
