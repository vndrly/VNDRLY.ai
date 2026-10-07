import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkHubPage from "./work-hub";

const env = vi.hoisted(() => ({ path: "/work-hub/meetings", request: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => [env.path, vi.fn()] }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 1069, role: "partner", partnerId: 609, membershipRole: "member" } }) }));
vi.mock("@/components/meeting-workspace", () => ({ default: ({ occurrenceId }: any) => <div>Workspace occurrence: {occurrenceId}</div> }));
vi.mock("@/lib/work-hub-client", async (original) => ({ ...(await original<any>()), workHubRequest: env.request }));
afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

describe("canonical Work Hub calendar meeting envelopes", () => {
  it.each(["meetings", "calendar"])("renders authorized wrapped meetings on the %s page without joining", async (page) => {
    env.path = `/work-hub/${page}`;
    window.history.replaceState({}, "", `${env.path}?meeting=9845cacc-c88e-410b-a8c6-8ae52328796d`);
    const meeting = { id: "meeting-1", title: "Synthetic attendance review", agenda: "Recorded agenda", recordingAllowed: false };
    const occurrence = { id: "9845cacc-c88e-410b-a8c6-8ae52328796d", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 900000).toISOString(), status: "scheduled" };
    env.request.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith("/calendar?")) return { shifts: [], tasks: [], meetings: [{ source: "vndrly", authority: "work_hub_meeting", item: { meeting, occurrence } }], external: [] };
      if (path.endsWith("/catch-up")) return { meeting, occurrence, participationMode: "view_only", startedAt: null };
      return [];
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkHubPage /></QueryClientProvider>);
    expect((await screen.findAllByText("Synthetic attendance review")).length).toBeGreaterThan(0);
    if (page === "meetings") expect(await screen.findByText("Workspace occurrence: 9845cacc-c88e-410b-a8c6-8ae52328796d")).toBeTruthy();
    expect(env.request.mock.calls.some(([path, init]) => path.endsWith("/join") || init?.method === "POST")).toBe(false);
  });
});
