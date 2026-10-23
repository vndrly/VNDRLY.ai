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
  it("keeps both creation forms in one scheduling panel and switches attendees between crews and individuals", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CalendarCreateCards owner={{ type: "vendor", id: 1 }} />
      </QueryClientProvider>,
    );

    const row = screen.getByTestId("calendar-create-card-row");
    expect(row.querySelectorAll(".hub-home-card")).toHaveLength(1);
    expect(screen.getByRole("form", { name: "Create Shift/Event" })).toBeTruthy();
    expect(screen.getByRole("form", { name: "Create Task" })).toBeTruthy();
    expect(screen.getAllByTestId("calendar-assignee-toggle")).toHaveLength(2);
    await waitFor(() => expect(screen.getAllByText("Gatekeepers")).toHaveLength(2));
    expect(screen.queryByText("Alex Field")).toBeNull();

    const individuals = screen.getAllByRole("button", { name: "Individuals" })[0];
    fireEvent.click(individuals);
    expect(individuals.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(screen.getByText("Alex Field")).toBeTruthy());
    expect(screen.getAllByText("Gatekeepers")).toHaveLength(1);
    const notes = screen.getByLabelText("Notes");
    const description = screen.getByLabelText("Description");
    const mandatory = screen.getByRole("checkbox", { name: "Mandatory" });
    for (const field of [notes, description]) {
      expect(field.className).toContain("rounded-xl");
      expect(field.className).toContain("border-[color:var(--brand-primary)]");
      expect(field.className).toContain("bg-white");
    }
    expect(mandatory.className).toContain("accent-[var(--brand-primary)]");
    expect(mandatory.className).toContain("bg-white");
    for (const list of screen.getAllByTestId("calendar-assignee-list")) {
      expect(list.style.colorScheme).toBe("light");
    }
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox.style.colorScheme).toBe("light");
      expect(checkbox.style.accentColor).toBe("var(--brand-primary)");
      expect(checkbox.className).toContain("bg-white");
    }
    for (const name of ["Work type", "Calendar", "Priority"]) {
      const select = screen.getByRole("combobox", { name });
      expect(select.className).toContain("rounded-full");
      expect(select.className).toContain("bg-white");
      expect(select.className).toContain("[&>option:hover]:bg-[var(--brand-primary)]");
      expect(select.style.colorScheme).toBe("light");
    }
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
  it.each(["shift", "event", "task"])("preserves the %s submission fields after regrouping", async (kind) => {
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
      fireEvent.change(fields.getByLabelText("Starts"), { target: { value: "2026-11-01T08:00" } });
      fireEvent.change(fields.getByLabelText("Ends"), { target: { value: "2026-11-01T16:00" } });
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
