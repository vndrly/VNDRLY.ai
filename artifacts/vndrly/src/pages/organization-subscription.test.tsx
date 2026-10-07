import { StrictMode } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Page from "./organization-subscription";
const state = vi.hoisted(() => ({ user: {} as any }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => state }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: (p: any) => <button {...p} />,
}));
const saved = {
  configured: true,
  plans: [{ key: "team", label: "Team" }],
  customerLinked: false,
  subscription: null,
  accessEnforcementImplemented: false,
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function mount(strict = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const page = (
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}
beforeEach(() => {
  sessionStorage.clear();
  state.user = {
    userId: 1,
    role: "vendor",
    vendorId: 10,
    activeMembershipId: 20,
    availableMemberships: [
      {
        id: 20,
        role: "admin",
        orgType: "vendor",
        orgId: 10,
        orgName: "Synthetic company",
      },
    ],
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("denies a platform role without fetching company billing", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  state.user.role = "admin";
  mount();
  expect(screen.getByText(/current company administrator/)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not turn a return URL or disabled configuration into purchase or payment", async () => {
  history.replaceState(null, "", "?checkout=returned");
  const fetcher = vi.fn(async () => response({ ...saved, configured: false }));
  vi.stubGlobal("fetch", fetcher);
  mount();
  await screen.findByText(/Checkout is not configured/);
  expect(screen.queryByText(/Review Stripe Checkout:/)).toBeNull();
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(
    screen.getByText(/Returning from Stripe does not verify payment/),
  ).toBeTruthy();
});
it("accepts a saved hosted result under StrictMode only after explicit review", async () => {
  const fetcher = vi.fn(async (_url: unknown, init: any) =>
    init.method === "POST"
      ? response({
          url: "https://checkout.stripe.com/c/pay/test",
          sessionId: "cs_synthetic",
          paymentVerified: false,
        })
      : response(saved),
  );
  vi.stubGlobal("fetch", fetcher);
  mount(true);
  fireEvent.click(await screen.findByText("Review Stripe Checkout: Team"));
  expect(fetcher.mock.calls.filter((c) => c[1].method === "POST")).toHaveLength(
    0,
  );
  fireEvent.click(screen.getByText("Open reviewed hosted flow"));
  expect(
    (await screen.findByText("Continue to Stripe")).getAttribute("href"),
  ).toBe("https://checkout.stripe.com/c/pay/test");
  expect(
    screen.getByText(/Hosted link saved; payment is not verified/),
  ).toBeTruthy();
});
it("retains exact UUID and body after an unknown response and retries the same request", async () => {
  const bodies: string[] = [];
  const fetcher = vi.fn(async (_url: unknown, init: any) => {
    if (init.method !== "POST") return response(saved);
    bodies.push(init.body);
    if (bodies.length === 1) throw Error("Dropped response");
    return response({
      url: null,
      sessionId: "cs_synthetic",
      paymentVerified: false,
    });
  });
  vi.stubGlobal("fetch", fetcher);
  mount();
  fireEvent.click(await screen.findByText("Review Stripe Checkout: Team"));
  fireEvent.click(screen.getByText("Open reviewed hosted flow"));
  fireEvent.click(await screen.findByText("Retry same hosted request"));
  await screen.findByText(/Hosted link saved/);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(JSON.parse(bodies[0]).operationId).toMatch(/^[0-9a-f-]{36}$/);
});
it("fences a late hosted result after the current account changes", async () => {
  let finish!: (r: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: any) =>
      init.method === "POST"
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : response(saved),
    ),
  );
  const mounted = mount();
  fireEvent.click(await screen.findByText("Review Stripe Checkout: Team"));
  fireEvent.click(screen.getByText("Open reviewed hosted flow"));
  await waitFor(() => expect(finish).toBeTruthy());
  state.user = { ...state.user, userId: 2 };
  mounted.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
  finish(
    response({
      url: "https://checkout.stripe.com/c/pay/old",
      sessionId: "cs_old",
      paymentVerified: false,
    }),
  );
  await screen.findByText("Review Stripe Checkout: Team");
  expect(screen.queryByText("Continue to Stripe")).toBeNull();
  expect(Object.keys(sessionStorage)).toHaveLength(1);
});
it("rejects an untrusted hosted URL and retains the exact request", async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: any) => {
      if (init.method !== "POST") return response(saved);
      bodies.push(init.body);
      return response({
        url: "https://checkout.stripe.com.evil.example/pay",
        sessionId: "cs_synthetic",
        paymentVerified: false,
      });
    }),
  );
  mount();
  fireEvent.click(await screen.findByText("Review Stripe Checkout: Team"));
  fireEvent.click(screen.getByText("Open reviewed hosted flow"));
  fireEvent.click(await screen.findByText("Retry same hosted request"));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toBe(bodies[0]);
  expect(screen.queryByText("Continue to Stripe")).toBeNull();
  expect(Object.keys(sessionStorage)).toHaveLength(1);
});
