import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CalendarCreateCards from "./calendar-create-cards";

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
  it("uses equal creation cards and switches the fixed-height attendee list between crews and individuals", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CalendarCreateCards owner={{ type: "vendor", id: 1 }} />
      </QueryClientProvider>,
    );

    const row = screen.getByTestId("calendar-create-card-row");
    expect(row.className).toContain("lg:grid-cols-2");
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
});
