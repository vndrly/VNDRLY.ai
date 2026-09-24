import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { apiFetch, params } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  params: { requestId: "" },
}));
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => params,
  Stack: { Screen: () => null },
}));
vi.mock("@/lib/notificationBadge", () => ({ syncAppIconBadge: vi.fn() }));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "orange", card: "white" }),
}));
vi.mock("@/components/ScreenSafeArea", () => ({
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("@/components/WorkHubPageTitle", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
function translate(key: string, options?: { defaultValue?: string }) {
  return options?.defaultValue ?? key;
}
import DestinationScreen from "../work-hub/notification";
import { openNotificationDestination } from "../../lib/notification-deep-links";
import { setUser, setToken } from "../../lib/auth";
const id = "7b077b60-17aa-4e3b-9d23-f622311ff274";
const other = "86ec8edf-d36f-4eca-9874-7fd6443a1070";
it.each(["identity", "context", "token"])(
  "clears acknowledged content immediately when %s changes",
  async (change) => {
    await setUser({
      id: 9,
      username: "worker",
      displayName: "Worker",
      role: "vendor",
      vendorId: 3,
      activeMembershipId: 1,
    });
    apiFetch.mockImplementation(async (path: string) =>
      path.endsWith("/resolve")
        ? { href: `/work-hub/tasks/${id}` }
        : path.endsWith("/read")
          ? { ok: true }
          : { item: { id, title: "Private loaded task" } },
    );
    render(<Host />);
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(screen.getByText("opened")).toBeTruthy());
    expect(screen.getByText("Private loaded task")).toBeTruthy();
    await act(async () => {
      if (change === "token") await setToken("new-session-token");
      else
        await setUser({
          id: change === "identity" ? 10 : 9,
          username: "worker",
          displayName: "Worker",
          role: "vendor",
          vendorId: 4,
          activeMembershipId: 2,
        });
    });
    expect(screen.queryByText("Private loaded task")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "no longer available",
    );
  },
);

it("finds an exact channel on page two using updatedAt rather than createdAt", async () => {
  const updatedAt = "2026-09-22T12:00:00Z";
  apiFetch.mockImplementation(async (path: string) => {
    if (path.endsWith("/resolve")) return { href: `/work-hub/channels/${id}` };
    if (path.endsWith("/read")) return { ok: true };
    if (path === "/api/work-hub/channels?limit=100")
      return Array.from({ length: 100 }, (_, n) => ({
        id: `other-${n}`,
        name: "Other channel",
        createdAt: "2020-01-01T00:00:00Z",
        updatedAt,
      }));
    if (
      path ===
      `/api/work-hub/channels?limit=100&before=${encodeURIComponent(updatedAt)}`
    )
      return [{ id, name: "Exact older channel" }];
    throw new Error(`Wrong cursor ${path}`);
  });
  render(<Host />);
  fireEvent.click(screen.getByText("Open"));
  await waitFor(() => expect(screen.getByText("opened")).toBeTruthy());
  expect(screen.getByText("Exact older channel")).toBeTruthy();
});
const row = {
  id: 42,
  type: "work_hub_task_assigned",
  category: "system",
  title: "Notification title",
  body: null,
  link: null,
  isRead: false,
  createdAt: "2026-09-24T12:00:00Z",
};
function Host() {
  const [path, setPath] = useState("");
  const [result, setResult] = useState("");
  return (
    <>
      <button
        onClick={() =>
          void openNotificationDestination(row, {
            push: (href) => {
              if (
                typeof href !== "string" ||
                !href.startsWith("/work-hub/notification?")
              )
                throw new Error("No such mobile route");
              params.requestId = new URL(
                href,
                "https://app.invalid",
              ).searchParams.get("requestId")!;
              setPath(href);
            },
          }).then(setResult)
        }
      >
        Open
      </button>
      {path ? <DestinationScreen /> : null}
      <output>{result}</output>
    </>
  );
}
beforeEach(() => {
  apiFetch.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const cases = [
  {
    name: "task path",
    href: `/work-hub/tasks/${id}`,
    endpoint: `/api/work-hub/calendar/items/task/${id}`,
    data: {
      item: { id, title: "Exact task", description: "Inspect east gate" },
    },
    text: "Exact task",
  },
  {
    name: "task query",
    href: `/work-hub/tasks?task=${id}`,
    endpoint: `/api/work-hub/calendar/items/task/${id}`,
    data: { item: { id, title: "Exact task" } },
    text: "Exact task",
  },
  {
    name: "schedule",
    href: `/(tabs)/work-hub?section=calendar&shift=${id}`,
    endpoint: `/api/work-hub/calendar/items/shift/${id}`,
    data: {
      item: { id, title: "Exact shift", instructions: "East gate only" },
    },
    text: "Exact shift",
  },
  {
    name: "meeting",
    href: `/work-hub/meetings/${id}`,
    endpoint: `/api/work-hub/calendar/items/meeting/${id}`,
    data: {
      item: {
        occurrence: { id, startsAt: "2026-09-24T12:00:00Z" },
        meeting: { title: "Exact meeting", agenda: "Gate coverage" },
      },
    },
    text: "Exact meeting",
  },
  {
    name: "gate crew channel",
    href: `/work-hub/channels/${id}`,
    endpoint: "/api/work-hub/channels?limit=100",
    data: [
      { id: other, name: "Wrong crew" },
      { id, name: "Exact gate crew" },
    ],
    text: "Exact gate crew",
  },
  {
    name: "message",
    href: `/work-hub?section=communications&channel=${id}&messageId=${other}`,
    endpoint: `/api/work-hub/channels/${id}/messages?limit=100`,
    data: [
      { id, body: "Wrong message" },
      { id: other, body: "Exact message", createdAt: "2026-09-24T12:00:00Z" },
    ],
    text: "Exact message",
  },
  {
    name: "alert announcement",
    href: `/work-hub?section=activity&announcement=${id}`,
    endpoint: "/api/work-hub/home",
    data: {
      announcements: [
        { announcement: { id: other, title: "Wrong alert" } },
        {
          announcement: {
            id,
            title: "Exact urgent alert",
            body: "Close east gate",
          },
        },
      ],
    },
    text: "Exact urgent alert",
  },
  {
    name: "handoff",
    href: `/shift-notes?siteId=3&stationId=${other}&handoffId=${id}`,
    endpoint: `/api/gate-change-over/${other}/notes?days=3650`,
    data: {
      rows: [
        { id: other, notes: "Wrong handoff" },
        {
          id,
          notes: "Exact handoff",
          outgoing_name: "Pat",
          incoming_name: "Sam",
        },
      ],
      nextBefore: null,
    },
    text: "Exact handoff",
  },
  {
    name: "gate station",
    href: `/gate-change-over?siteId=3&stationId=${id}`,
    endpoint: `/api/gate-change-over/${id}/state`,
    data: {
      station: { id, name: "Exact gate", site_id: 3 },
      site: { id: 3, name: "East site" },
      snapshot: { coverage: "Coverage active" },
    },
    text: "Exact gate",
  },
  {
    name: "gate site",
    href: "/gate?siteId=3",
    endpoint: "/api/gate-change-over/sites",
    data: {
      sites: [
        { id: 8, name: "Wrong site" },
        { id: 3, name: "Exact gate site" },
      ],
    },
    text: "Exact gate site",
  },
  {
    name: "compliance",
    href: "/(tabs)/profile?section=compliance&credentialId=8",
    endpoint: "/api/field-employees/12/certifications",
    data: [
      { id: 1, name: "Wrong credential" },
      { id: 8, name: "Exact PEC credential", certNumber: "PEC-8" },
    ],
    text: "Exact PEC credential",
  },
  {
    name: "form",
    href: `/work-hub?form=${id}`,
    endpoint: `/api/work-hub/required-actions/form/${id}`,
    data: {
      instance: { id },
      template: {
        name: "Exact form",
        definition: [{ label: "Gate check" }],
      },
    },
    text: "Exact form",
  },
  {
    name: "checklist",
    href: `/work-hub?checklist=${id}`,
    endpoint: `/api/work-hub/required-actions/checklist/${id}`,
    data: {
      instance: { id },
      template: {
        name: "Exact checklist",
        definition: [{ label: "Inspect lock" }],
      },
    },
    text: "Exact checklist",
  },
];
it.each(cases)(
  "renders the exact $name subject before marking the notification read",
  async ({ href, endpoint, data, text }) => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/resolve")) return { href };
      if (path === endpoint) return data;
      if (path === "/api/field/me") return { employeeId: 12 };
      if (path === "/api/notifications/42/read") {
        expect(screen.getByText(text)).toBeTruthy();
        expect(
          screen.queryByText(
            /Wrong (task|message|crew|alert|handoff|site|credential)/,
          ),
        ).toBeNull();
        return { ok: true };
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<Host />);
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(screen.getByText("opened")).toBeTruthy());
    expect(apiFetch).toHaveBeenCalledWith(endpoint);
    expect(apiFetch).toHaveBeenCalledWith("/api/notifications/42/read", {
      method: "POST",
      signal: expect.any(AbortSignal),
    });
  },
);
it.each(["missing", "rejected", "wrong-id"])(
  "keeps an unavailable %s subject unread after navigating",
  async (mode) => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/resolve")) return { href: `/work-hub/tasks/${id}` };
      if (mode === "rejected") throw new Error("403 forbidden");
      return {
        item: mode === "missing" ? null : { id: other, title: "Wrong task" },
      };
    });
    render(<Host />);
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(screen.getByText("unavailable")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain(
      "no longer available",
    );
    expect(apiFetch.mock.calls.some(([path]) => path.endsWith("/read"))).toBe(
      false,
    );
  },
);
it("does not mark read while the exact item is still loading or after leaving", async () => {
  let finish!: (value: unknown) => void;
  apiFetch.mockImplementation(async (path: string) =>
    path.endsWith("/resolve")
      ? { href: `/work-hub/tasks/${id}` }
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  const view = render(<Host />);
  fireEvent.click(screen.getByText("Open"));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(apiFetch.mock.calls.some(([path]) => path.endsWith("/read"))).toBe(
    false,
  );
  view.unmount();
  await act(async () => finish({ item: { id, title: "Late task" } }));
  expect(apiFetch.mock.calls.some(([path]) => path.endsWith("/read"))).toBe(
    false,
  );
});

it.each([
  ["form", "denied"],
  ["form", "wrong-id"],
  ["checklist", "denied"],
  ["checklist", "wrong-id"],
])(
  "keeps an unavailable exact %s %s lookup unread without history fallback",
  async (kind, failure) => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/resolve")) return { href: `/work-hub?${kind}=${id}` };
      expect(path).toBe(`/api/work-hub/required-actions/${kind}/${id}`);
      if (failure === "denied") throw new Error("404 not found");
      return {
        instance: { id: other },
        template: { name: "Wrong assigned record" },
      };
    });
    render(<Host />);
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(screen.getByText("unavailable")).toBeTruthy());
    expect(screen.queryByText("Wrong assigned record")).toBeNull();
    expect(apiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/api/notifications/42/resolve",
      `/api/work-hub/required-actions/${kind}/${id}`,
    ]);
  },
);

it("opens only once when React replays destination mount effects", async () => {
  apiFetch.mockImplementation(async (path: string) => {
    if (path.endsWith("/resolve")) return { href: `/work-hub/tasks/${id}` };
    if (path.endsWith("/read")) return { ok: true };
    return { item: { id, title: "Exact strict task" } };
  });
  render(
    <React.StrictMode>
      <Host />
    </React.StrictMode>,
  );
  fireEvent.click(screen.getByText("Open"));
  await waitFor(() => expect(screen.getByText("opened")).toBeTruthy());
  expect(
    apiFetch.mock.calls.filter(([path]) => path.endsWith("/read")),
  ).toHaveLength(1);
});

it("does not acknowledge a second destination using the first destination's rendered record", async () => {
  let currentId = id;
  apiFetch.mockImplementation(async (path: string) => {
    if (path.endsWith("/resolve"))
      return { href: `/work-hub/tasks/${currentId}` };
    if (path.endsWith("/read")) return { ok: true };
    if (path.endsWith(other)) return new Promise(() => {});
    return { item: { id, title: "First task" } };
  });
  render(<Host />);
  fireEvent.click(screen.getByText("Open"));
  await waitFor(() => expect(screen.getByText("opened")).toBeTruthy());
  currentId = other;
  fireEvent.click(screen.getByText("Open"));
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      `/api/work-hub/calendar/items/task/${other}`,
    ),
  );
  await act(async () => {});
  expect(
    apiFetch.mock.calls.filter(([path]) => path.endsWith("/read")),
  ).toHaveLength(1);
  expect(screen.queryByText("First task")).toBeNull();
});

it.each(["form", "checklist"])(
  "renders the assigned %s definition rather than a revised template",
  async (kind) => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith("/resolve")) return { href: `/work-hub?${kind}=${id}` };
      if (path.endsWith("/read")) return { ok: true };
      expect(path).toBe(`/api/work-hub/required-actions/${kind}/${id}`);
      return {
        instance: {
          id,
          [kind === "form" ? "definitionSnapshot" : "snapshot"]: [
            { id: "f1", label: "Original assigned field" },
          ],
        },
        template: {
          name: "Assigned record",
          definition: [{ id: "f2", label: "Revised template field" }],
        },
      };
    });
    render(<Host />);
    fireEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(screen.getByText("opened")).toBeTruthy());
    expect(screen.getByText("Original assigned field")).toBeTruthy();
    expect(screen.queryByText("Revised template field")).toBeNull();
  },
);

it("does not display or mark read data loaded across an account change", async () => {
  let finish!: (value: unknown) => void;
  apiFetch.mockImplementation(async (path: string) =>
    path.endsWith("/resolve")
      ? { href: `/work-hub/tasks/${id}` }
      : path.endsWith("/read")
        ? { ok: true }
        : new Promise((resolve) => {
            finish = resolve;
          }),
  );
  render(<Host />);
  fireEvent.click(screen.getByText("Open"));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await setUser({
    id: 9,
    username: "new-account",
    role: "vendor",
    displayName: "New account",
  });
  await act(async () =>
    finish({ item: { id, title: "Previous account task" } }),
  );
  await waitFor(() => expect(screen.getByText("unavailable")).toBeTruthy());
  expect(screen.queryByText("Previous account task")).toBeNull();
  expect(apiFetch.mock.calls.some(([path]) => path.endsWith("/read"))).toBe(
    false,
  );
});
