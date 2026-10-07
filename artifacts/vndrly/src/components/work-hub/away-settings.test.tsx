import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({
    children,
    color,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { color: string }) => (
    <button {...props}>{children}</button>
  ),
}));
import { WorkHubAwaySettings } from "./away-settings";
import { AwayRequestError } from "@/lib/work-hub-away-client";
const channelId = "00000000-0000-4000-8000-000000000002";
const props = {
  identity: "17:vendor:4:12",
  actorId: 17,
  owner: { type: "vendor" as const, id: 4 },
};
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
function fixture() {
  const bodies: Record<string, unknown>[] = [];
  const request = vi.fn(
    async (path: string, init?: RequestInit): Promise<unknown> => {
      if (path === "/away-responder/channels")
        return {
          channels: [{ id: channelId, name: "Exact joined conversation" }],
          truncated: false,
          source: "joined_writable_channels",
        };
      if (path.includes("/operations/")) return { receipt: null };
      if (init?.method !== "POST")
        return { rule: null, version: 0, providerDeliveryVerified: false };
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (bodies.length === 1) throw Error("response dropped");
      return {
        operationId: body.operationId,
        fingerprint: "a".repeat(64),
        status: "configured",
        rule: {
          id: body.operationId,
          version: 1,
          userId: 17,
          owner: props.owner,
          status: "active",
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          replyText: body.replyText,
          channelIds: body.channelIds,
          configuredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        savedAt: new Date().toISOString(),
        providerDeliveryVerified: false,
      };
    },
  );
  return { request, bodies };
}
async function configure() {
  await screen.findByText("Exact joined conversation");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Exact joined conversation" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Use this exact reply/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save away reply" }));
}
it("retains original operation/version/body after unknown response and reads exact receipt before retry", async () => {
  const f = fixture();
  render(<WorkHubAwaySettings {...props} request={f.request} />);
  await configure();
  await screen.findByText(/The result is unverified/);
  expect(
    (
      screen.getByRole("textbox", {
        name: "Exact reply",
      }) as HTMLTextAreaElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Check / retry exact request" }),
  );
  await screen.findByText(/The exact request was saved/);
  expect(f.bodies).toHaveLength(2);
  expect(f.bodies[1]).toEqual(f.bodies[0]);
  const calls = f.request.mock.calls;
  const readIndex = calls.findIndex(([path]) => path.includes("/operations/"));
  expect(
    calls.slice(readIndex + 1).some(([, init]) => init?.method === "POST"),
  ).toBe(true);
});
it("fences a late rejected save after account/company identity changes", async () => {
  const f = fixture();
  let reject: (error: Error) => void = () => {};
  f.request.mockImplementation(async (path, init) => {
    if (path === "/away-responder/channels")
      return {
        channels: [{ id: channelId, name: "Exact joined conversation" }],
        truncated: false,
        source: "joined_writable_channels",
      };
    if (init?.method === "POST")
      return new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest;
      });
    return { rule: null, version: 0, providerDeliveryVerified: false };
  });
  const view = render(<WorkHubAwaySettings {...props} request={f.request} />);
  await configure();
  await waitFor(() =>
    expect(
      f.request.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(true),
  );
  view.rerender(
    <WorkHubAwaySettings
      {...props}
      identity="99:vendor:8:20"
      actorId={99}
      owner={{ type: "vendor", id: 8 }}
      request={f.request}
    />,
  );
  await screen.findByText("Exact joined conversation");
  reject(Error("late original rejection"));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save away reply" }),
    ).not.toBeNull(),
  );
  expect(screen.queryByText(/result is unverified/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Check / retry exact request" }),
  ).toBeNull();
});
it("retains the exact journal and performs no POST when uncertain-save readback is denied", async () => {
  const f = fixture();
  render(<WorkHubAwaySettings {...props} request={f.request} />);
  await configure();
  await screen.findByText(/The result is unverified/);
  const original = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
  f.request.mockImplementation(async (path) => {
    if (path.includes("/operations/"))
      throw new AwayRequestError(403, "Denied");
    throw Error("Unexpected further request");
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Check / retry exact request" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Check / retry exact request",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!)).toEqual(
    original,
  );
  expect(f.bodies).toHaveLength(1);
  expect(
    (
      screen.getByRole("textbox", {
        name: "Exact reply",
      }) as HTMLTextAreaElement
    ).disabled,
  ).toBe(true);
});
