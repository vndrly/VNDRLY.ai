vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, activeMembershipId: 1 } }) }));
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingScheduling } from "./meeting-scheduling";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/components/brand-pill-button", () => ({
  default: ({ children, tone: _tone, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("./collaboration", () => ({
  HubError: ({ error }: any) =>
    error ? <p role="alert">{error.message}</p> : null,
}));
vi.mock("@/lib/work-hub-client", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  workHubRequest: mocks.request,
}));
describe("meeting scheduling page", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (init) return { occurrence: { id: "booked-occurrence" } };
        if (path === "/scheduling/types")
          return [
            {
              id: "personal",
              title: "My availability",
              description: "",
              durationMinutes: 30,
              timezone: "America/Chicago",
              visibility: "personal",
              active: true,
              version: 1,
              canManage: true,
            },
            {
              id: "shared",
              title: "Team review",
              description: "Review work",
              durationMinutes: 30,
              timezone: "America/Chicago",
              visibility: "shared",
              active: true,
              version: 1,
              canManage: false,
            },
          ];
        return { windows: [], slots: ["2027-03-15T15:00:00Z"], version: 1 };
      },
    );
  });
  it("separates shared schedules and reserves an actual selected slot", async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MeetingScheduling />
      </QueryClientProvider>,
    );
    await screen.findByText("My availability");
    expect(screen.queryByText("Team review")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Shared pages" }));
    fireEvent.click(await screen.findByText("Team review"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: new Date("2027-03-15T15:00:00Z").toLocaleString(),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Reserve / }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Meeting reserved",
      ),
    );
    const call = mocks.request.mock.calls.find(
      ([path, init]) => path === "/scheduling/types/shared/book" && init,
    )!;
    expect(JSON.parse(call[1].body)).toMatchObject({
      startsAt: "2027-03-15T15:00:00Z",
      operationId: expect.any(String),
    });
    expect(
      screen
        .getByRole("link", { name: "Open your meeting" })
        .getAttribute("href"),
    ).toBe("/work-hub/meetings?meeting=booked-occurrence");
    expect(screen.queryByText("Manage availability")).toBeNull();
  });
});
