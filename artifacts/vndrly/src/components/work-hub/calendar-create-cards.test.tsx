import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CalendarCreateCards from "./calendar-create-cards";
import { workHubRequest } from "@/lib/work-hub-client";

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#3260cd", name: "MidCon Solutions" }),
}));

vi.mock("@/lib/work-hub-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/work-hub-client")>("@/lib/work-hub-client");
  return {
    ...actual,
    workHubRequest: vi.fn(async (path: string) => {
      if (path === "/people") return [{ id: 7, displayName: "Alex Field" }];
      if (path === "/crews") return [{ id: "crew-1", name: "Gatekeepers" }];
      if (path === "/scheduling/types") return [];
      return [];
    }),
  };
});

describe("CalendarCreateCards", () => {
  it("keeps shift scheduling inline without the old task form", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><CalendarCreateCards owner={{ type: "vendor", id: 1 }} /></QueryClientProvider>);
    expect(screen.getByRole("form", { name: "Create Shift/Event" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Create Task" })).toBeNull();
    await waitFor(() => expect(screen.getByText("Gatekeepers")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Individual" }));
    expect(await screen.findByText("Alex Field")).toBeTruthy();
    expect(screen.getByLabelText("Starts").getAttribute("placeholder")).toBe("MM/DD/YY hh:mm AM/PM");
  });
  it("shows branded Gate staffing and paid-travel selectors for Gate shifts", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => String(url).includes("stations")
        ? { stations: [{ id: "11111111-1111-4111-8111-111111111111", name: "Main gate" }] }
        : { sites: [{ id: 19, name: "Big Cs Deep" }] },
    })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CalendarCreateCards owner={{ type: "vendor", id: 1 }} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Shift type" }), { target: { value: "gate" } });
    const site = await screen.findByRole("combobox", { name: "Gate site" });
    await waitFor(() => expect(screen.getByRole("option", { name: "Big Cs Deep" })).toBeTruthy());
    fireEvent.change(site, { target: { value: "19" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "Main gate" })).toBeTruthy());
    expect(screen.getByRole("spinbutton", { name: "Required gatekeepers" }).getAttribute("value")).toBe("1");
    expect(screen.getByRole("combobox", { name: "Work start policy" }).className).toContain("rounded-full");
  });
  it.each(["shift", "event"])("preserves the %s submission fields after regrouping", async (kind) => {
    vi.mocked(workHubRequest).mockClear();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><CalendarCreateCards owner={{ type: "vendor", id: 1 }} /></QueryClientProvider>);
    const form = screen.getByRole("form", { name: kind === "task" ? "Create Task" : "Create Shift/Event" });
    const fields = within(form);
    fireEvent.change(fields.getByLabelText("Title"), { target: { value: "Coverage test" } });
    if (kind === "task") {
      fireEvent.change(fields.getByLabelText("Description"), { target: { value: "Inspect the gate" } });
      fireEvent.change(fields.getByLabelText("Priority"), { target: { value: "high" } });
    } else {
      expect(fields.queryByLabelText("Meeting Type")).toBeNull();
      if (kind === "event") {
        fireEvent.change(fields.getByLabelText("Work type"), { target: { value: "event" } });
        expect(fields.getByLabelText("Meeting Type")).toBeTruthy();
      }
      fireEvent.change(fields.getByLabelText("Starts"), { target: { value: "11/01/26 08:00 AM" } });
      fireEvent.change(fields.getByLabelText("Ends"), { target: { value: "11/01/26 04:00 PM" } });
      fireEvent.change(fields.getByLabelText("Notes"), { target: { value: "Gate instructions" } });
    }
    fireEvent.submit(form);
    const endpoint = kind === "task" ? "/tasks" : kind === "event" ? "/meetings" : "/shifts";
    await waitFor(() => expect(vi.mocked(workHubRequest).mock.calls.some(([path, options]) => path === endpoint && options?.method === "POST")).toBe(true));
    const [, options] = vi.mocked(workHubRequest).mock.calls.find(([path, options]) => path === endpoint && options?.method === "POST")!;
    const envelope = JSON.parse(options!.body as string);
    expect(envelope.owner).toEqual({ type: "vendor", id: 1 });
    const body = envelope.payload;
    expect(body.title).toBe("Coverage test");
    if (kind === "task") expect(body).toMatchObject({ priority: "high", description: "Inspect the gate", assigneeUserId: null });
    else {
      expect(body.startsAt).toBe(new Date("2026-11-01T08:00").toISOString());
      expect(body.endsAt).toBe(new Date("2026-11-01T16:00").toISOString());
      expect(kind === "event" ? body.agenda : body.instructions).toBe("Gate instructions");
    }
  });

});
