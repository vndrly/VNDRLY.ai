import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WorkHubPage from "./work-hub";
const env = vi.hoisted(() => ({
  request: vi.fn(),
  user: {
    userId: 1069,
    role: "partner",
    partnerId: 609,
    membershipRole: "admin",
    activeMembershipId: 1,
  },
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/work-hub/meetings", vi.fn()],
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock("@/lib/work-hub-client", async (original) => ({
  ...(await original<any>()),
  workHubRequest: env.request,
}));
afterEach(cleanup);
it("an uncertain start-now also blocks the scheduled creation entrypoint", async () => {
  env.request.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") throw Error("Response lost");
    if (path === "/people") return [{ id: 1074, displayName: "Joe", sameCompany: true }];
    if (path.startsWith("/calendar")) return { meetings: [] };
    return [];
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><WorkHubPage /></QueryClientProvider>);
  await screen.findByRole("button", { name: "Joe" });
  fireEvent.click(screen.getByRole("button", { name: "Start meeting now" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Review meeting" }) as HTMLButtonElement).disabled).toBe(true));
  fireEvent.submit(document.getElementById("schedule-meeting")!.querySelector("form")!);
  expect(screen.queryByRole("button", { name: "Save reviewed meeting" })).toBeNull();
  expect(env.request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});
it("reviews named company participants before exact create and refuses blind retry after uncertainty", async () => {
  env.request.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") throw Error("Response lost");
    if (path === "/people")
      return [
        { id: 1074, displayName: "Joe", sameCompany: true },
        { id: 999, displayName: "Foreign", sameCompany: false },
      ];
    if (path.startsWith("/calendar")) return { meetings: [] };
    return [];
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <WorkHubPage />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Joe" }));
  expect(screen.queryByText("Foreign")).toBeNull();
  expect(screen.queryByText("Participant user IDs")).toBeNull();
  const form = document
    .getElementById("schedule-meeting")!
    .querySelector("form")!;
  const inputs = form.querySelectorAll("input");
  fireEvent.change(inputs[0], { target: { value: "Synthetic review" } });
  fireEvent.change(inputs[1], { target: { value: "2026-10-08T10:00" } });
  fireEvent.change(inputs[2], { target: { value: "2026-10-08T11:00" } });
  fireEvent.submit(form);
  expect(screen.getAllByText("Joe").length).toBeGreaterThan(1);
  fireEvent.change(inputs[0], { target: { value: "Changed review" } });
  expect(screen.queryByRole("button", { name: "Save reviewed meeting" })).toBeNull();
  fireEvent.change(inputs[0], { target: { value: "Synthetic review" } });
  fireEvent.submit(form);
  expect(
    env.request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
  fireEvent.click(
    await screen.findByRole("button", { name: "Save reviewed meeting" }),
  );
  await screen.findByText(
    "Outcome unverified. Check saved meetings before preparing another request.",
  );
  const calls = env.request.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][1].body)).toMatchObject({
    owner: { type: "partner", id: 609 },
    payload: {
      title: "Synthetic review",
      participantUserIds: [1074],
      recordingAllowed: false,
    },
    operationId: expect.any(String),
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Save reviewed meeting",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect((screen.getByRole("button", { name: "Start meeting now" }) as HTMLButtonElement).disabled).toBe(true);
});
