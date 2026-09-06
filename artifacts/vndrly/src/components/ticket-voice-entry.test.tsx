import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { TicketEntryDialog, TicketVoiceEntry } from "./ticket-voice-entry";
import { mileageActionFor, mileageValue, type EntryTicket } from "@/lib/ticket-voice-entry";

// Keep the entry form real; replace shared visual chrome that loads unrelated organization queries.
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({ children, onClick, disabled }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: React.PropsWithChildren) => <>{children}</>,
  DialogContent: ({ children }: React.PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
}));

const ticket: EntryTicket = { id: 42, status: "initiated", lifecycleState: "pending_arrival" };
const props = { ticket, role: "field_employee", accessAllowed: true, onClose: vi.fn(), onSaved: vi.fn() };
const fetchMock = vi.fn();
const gps = vi.fn();
const response = (data: unknown = {}, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const fix = { coords: { latitude: 32.5, longitude: -102.25 } } as GeolocationPosition;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const selectPhoto = () => fireEvent.change(screen.getByLabelText("Choose ticket photo"), {
  target: { files: [new File(["image-data"], "pump.jpg", { type: "image/jpeg" })] },
});

beforeEach(async () => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  gps.mockReset().mockImplementation((success: PositionCallback) => success(fix));
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: gps } });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:photo-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  window.history.replaceState(null, "", "/tickets/42");
  await i18n.changeLanguage("en");
});
afterEach(() => vi.unstubAllGlobals());

describe("voice-opened ticket entries", () => {
  it("selects parts and labor for repeated same-ticket navigation, preserving unrelated URL state", async () => {
    window.history.replaceState(null, "", "/tickets/42?view=crew&askvEntry=parts#items");
    const onLineItem = vi.fn();
    render(<TicketVoiceEntry {...props} onLineItem={onLineItem} />);
    await waitFor(() => expect(onLineItem).toHaveBeenCalledWith("parts"));
    expect(window.location.search).toBe("?view=crew");
    expect(window.location.hash).toBe("#items");
    act(() => window.history.pushState(null, "", "/tickets/42?askvEntry=labor"));
    await waitFor(() => expect(onLineItem).toHaveBeenLastCalledWith("labor"));
    expect(onLineItem).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens photo selection from the query without uploading", async () => {
    window.history.replaceState(null, "", "/tickets/42?askvEntry=photo");
    render(<TicketVoiceEntry {...props} onLineItem={vi.fn()} />);
    expect(await screen.findByLabelText("Choose ticket photo")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { role: "partner", status: "initiated", accessAllowed: true },
    { role: "admin", status: "initiated", accessAllowed: true },
    { role: "field_employee", status: "approved", accessAllowed: true },
    { role: "field_employee", status: "initiated", accessAllowed: false },
  ])("blocks entries for unauthorized access or closed tickets: %j", (override) => {
    render(<TicketEntryDialog {...props} {...override} ticket={{ ...ticket, status: override.status }} kind="photo" />);
    expect(screen.getByRole("status").textContent).toContain("cannot add entries");
    expect(screen.queryByLabelText("Choose ticket photo")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads privately and attaches a photo only after a reviewed confirmation", async () => {
    fetchMock.mockResolvedValueOnce(response({ uploadURL: "https://signed.example/upload", objectPath: "/objects/uploads/test-photo" }))
      .mockResolvedValueOnce(response()).mockResolvedValueOnce(response()).mockResolvedValueOnce(response());
    render(<TicketEntryDialog {...props} kind="photo" />);
    selectPhoto();
    expect(fetchMock).not.toHaveBeenCalled();
    click("Review");
    expect(screen.getByTestId("ticket-entry-review").textContent).toContain("privately");
    expect(fetchMock).not.toHaveBeenCalled();
    click("Save photo");
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/storage/uploads/request-url", "https://signed.example/upload", "/api/storage/uploads/finalize", "/api/tickets/42/note-logs",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ objectURL: "https://signed.example/upload", visibility: "private" });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ content: "[photo] /objects/uploads/test-photo" });
    expect(fetchMock.mock.calls[1][1].credentials).toBeUndefined();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not attach a photo after private finalization fails", async () => {
    fetchMock.mockResolvedValueOnce(response({ uploadURL: "https://signed.example/upload", objectPath: "/objects/uploads/test-photo" }))
      .mockResolvedValueOnce(response()).mockResolvedValueOnce(response({ error: "Forbidden" }, 403));
    render(<TicketEntryDialog {...props} kind="photo" />);
    selectPhoto(); click("Review"); click("Save photo");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it("shows readable localized copy when the upload response is incomplete", async () => {
    fetchMock.mockResolvedValueOnce(response({}));
    render(<TicketEntryDialog {...props} kind="photo" />);
    selectPhoto(); click("Review"); click("Save photo");
    expect((await screen.findByRole("alert")).textContent).toBe("Could not save the ticket entry. Please try again.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it("retains the finalized photo for an explicit attach retry", async () => {
    fetchMock.mockResolvedValueOnce(response({ uploadURL: "https://signed.example/upload", objectPath: "/objects/uploads/test-photo" }))
      .mockResolvedValueOnce(response()).mockResolvedValueOnce(response()).mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response());
    render(<TicketEntryDialog {...props} kind="photo" />);
    selectPhoto(); click("Review"); click("Save photo");
    await screen.findByRole("alert");
    click("Save photo");
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4][0]).toBe("/api/tickets/42/note-logs");
  });

  it("requires an entered starting reading and reviews real GPS before changing the ticket", async () => {
    fetchMock.mockResolvedValue(response());
    render(<TicketEntryDialog {...props} kind="mileage" />);
    expect((screen.getByLabelText("Starting odometer (miles)") as HTMLInputElement).value).toBe("");
    click("Review");
    expect(gps).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Starting odometer (miles)"), { target: { value: "101.2" } });
    click("Review");
    await screen.findByTestId("ticket-entry-review");
    expect(screen.getByTestId("ticket-entry-review").textContent).toContain("En Route");
    expect(fetchMock).not.toHaveBeenCalled();
    click("Save and start travel");
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/42/en-route");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ latitude: 32.5, longitude: -102.25, startingMileage: 101.2 });
  });

  it("reviews checkout, clock stop, and pending review before saving ending mileage", async () => {
    fetchMock.mockResolvedValue(response());
    render(<TicketEntryDialog {...props} ticket={{ ...ticket, status: "in_progress", lifecycleState: "on_site", startingMileage: "100.0" }} kind="mileage" />);
    fireEvent.change(screen.getByLabelText("Ending odometer (miles)"), { target: { value: "99.9" } });
    click("Review");
    expect(gps).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Ending odometer (miles)"), { target: { value: "120.3" } });
    click("Review");
    const review = await screen.findByTestId("ticket-entry-review");
    expect(review.textContent).toContain("stop the work clock");
    expect(review.textContent).toContain("send the ticket for review");
    expect(fetchMock).not.toHaveBeenCalled();
    click("Check out and send for review");
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/42/check-out");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ latitude: 32.5, longitude: -102.25, endingMileage: 120.3, workCompleted: false });
  });

  it("does not submit or fabricate coordinates when location access is denied", async () => {
    gps.mockImplementation((_success, failure) => failure({ code: 1 }));
    render(<TicketEntryDialog {...props} kind="mileage" />);
    fireEvent.change(screen.getByLabelText("Starting odometer (miles)"), { target: { value: "5" } });
    click("Review");
    expect((await screen.findByRole("alert")).textContent).toContain("Allow location access");
    expect(screen.queryByTestId("ticket-entry-review")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("discards a late location callback when the entry is unmounted", async () => {
    let resolvePosition!: PositionCallback;
    gps.mockImplementation((success: PositionCallback) => { resolvePosition = success; });
    const view = render(<TicketEntryDialog {...props} kind="mileage" />);
    fireEvent.change(screen.getByLabelText("Starting odometer (miles)"), { target: { value: "5" } });
    click("Review");
    view.unmount();
    await act(async () => resolvePosition(fix));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it("invalidates prepared mileage if the ticket changes before confirmation", async () => {
    const view = render(<TicketEntryDialog {...props} kind="mileage" />);
    fireEvent.change(screen.getByLabelText("Starting odometer (miles)"), { target: { value: "5" } });
    click("Review");
    await screen.findByTestId("ticket-entry-review");
    view.rerender(<TicketEntryDialog {...props} ticket={{ ...ticket, status: "approved" }} kind="mileage" />);
    expect(screen.queryByTestId("ticket-entry-review")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save and start travel" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates mileage storage precision and available lifecycle steps", () => {
    for (const input of ["", "-1", "1.23", "Infinity", "1e3", "1000000000"]) expect(mileageValue(input, "en-route")).toBeNull();
    expect(mileageValue("0", "en-route")).toBe(0);
    expect(mileageValue("999999999.9", "en-route")).toBe(999999999.9);
    expect(mileageActionFor({ ...ticket, status: "pending_review", lifecycleState: "off_site" })).toBeNull();
  });
});
