import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  api: vi.fn(),
  generation: 1,
  listeners: new Set<() => void>(),
  user: { id: 17, role: "vendor", vendorId: 4 },
}));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/lib/auth", () => ({
  getUser: async () => env.user,
  captureAuthScope: () => ({ generation: env.generation }),
  isAuthScopeCurrent: (s: any) => s.generation === env.generation,
  subscribeUser: (f: () => void) => {
    env.listeners.add(f);
    return () => env.listeners.delete(f);
  },
  subscribeToken: () => () => {},
}));
vi.mock("@/lib/native-uuid", () => ({
  nativeUuid: () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    foreground: "#fff",
    mutedForeground: "#aaa",
    border: "#444",
  }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: any) => (
    <input
      value={value}
      aria-label={accessibilityLabel}
      disabled={editable === false}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  Switch: ({ value, onValueChange, accessibilityLabel, disabled }: any) => (
    <input
      type="checkbox"
      aria-label={accessibilityLabel}
      checked={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.checked)}
    />
  ),
  ActivityIndicator: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
import WorkHubAwaySettings from "./WorkHubAwaySettings";
const channel = "22222222-2222-4222-8222-222222222222";
const rule = {
  id: "11111111-1111-4111-8111-111111111111",
  version: 2,
  userId: 17,
  owner: { type: "vendor", id: 4 },
  status: "active",
  startsAt: "2026-10-08T10:00:00.000Z",
  endsAt: "2026-10-09T10:00:00.000Z",
  replyText: "Neutral saved reply",
  channelIds: [channel],
  configuredAt: "2026-10-07T10:00:00.000Z",
  updatedAt: "2026-10-07T10:00:00.000Z",
};
beforeEach(() => {
  env.api.mockReset();
  env.generation = 1;
  env.api.mockImplementation(async (path: string) =>
    path.endsWith("/channels")
      ? {
          channels: [{ id: channel, name: "Joined team" }],
          truncated: false,
          source: "joined_writable_channels",
        }
      : { rule, version: 2, providerDeliveryVerified: false },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("loads only after opening and never configures merely by editing", async () => {
  render(<WorkHubAwaySettings />);
  expect(env.api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("workHubAway.open"));
  await screen.findByLabelText("workHubAway.reply");
  fireEvent.change(screen.getByLabelText("workHubAway.reply"), {
    target: { value: "Edited" },
  });
  expect(env.api.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
});
it("saves only the explicitly selected current conversation and reviewed window", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-07T10:00:00Z"));
  env.api.mockImplementation(async (path: string, init: any) => {
    if (init?.method === "POST") {
      const command = JSON.parse(init.body);
      return {
        operationId: command.operationId,
        fingerprint: "a".repeat(64),
        status: "configured",
        rule: {
          ...rule,
          version: 3,
          startsAt: command.startsAt,
          endsAt: command.endsAt,
          replyText: command.replyText,
          channelIds: command.channelIds,
        },
        savedAt: rule.updatedAt,
        providerDeliveryVerified: false,
      };
    }
    return path.endsWith("/channels")
      ? {
          channels: [{ id: channel, name: "Joined team" }],
          truncated: false,
          source: "joined_writable_channels",
        }
      : { rule, version: 2, providerDeliveryVerified: false };
  });
  render(<WorkHubAwaySettings />);
  fireEvent.click(screen.getByText("workHubAway.open"));
  await screen.findByLabelText("workHubAway.reply");
  fireEvent.change(screen.getByLabelText("workHubAway.reply"), {
    target: { value: "I will reply tomorrow." },
  });
  fireEvent.click(screen.getByText("workHubAway.save"));
  await screen.findByText("workHubAway.saved");
  expect(
    JSON.parse(
      env.api.mock.calls.find((c) => c[1]?.method === "POST")![1].body,
    ),
  ).toMatchObject({
    action: "configure",
    expectedVersion: 2,
    channelIds: [channel],
    replyText: "I will reply tomorrow.",
  });
  expect(env.api.mock.calls.every((call) => call[2]?.generation === 1)).toBe(
    true,
  );
});
it("does not show an old-company rule returned under the new current account", async () => {
  env.api.mockImplementation(async (path: string) =>
    path.endsWith("/channels")
      ? { channels: [], truncated: false, source: "joined_writable_channels" }
      : {
          rule: { ...rule, owner: { type: "vendor", id: 99 } },
          version: 2,
          providerDeliveryVerified: false,
        },
  );
  render(<WorkHubAwaySettings />);
  fireEvent.click(screen.getByText("workHubAway.open"));
  await screen.findByText("workHubAway.loadFailed");
  expect(screen.queryByDisplayValue("Neutral saved reply")).toBeNull();
  expect(screen.queryByText("workHubAway.pause")).toBeNull();
});
it("records explicit pause for exact saved rule revision", async () => {
  env.api.mockImplementation(async (path: string, init: any) =>
    init?.method === "POST"
      ? {
          operationId: rule.id,
          fingerprint: "a".repeat(64),
          status: "paused",
          rule: { ...rule, version: 3, status: "paused" },
          savedAt: rule.updatedAt,
          providerDeliveryVerified: false,
        }
      : path.endsWith("/channels")
        ? {
            channels: [{ id: channel, name: "Joined team" }],
            truncated: false,
            source: "joined_writable_channels",
          }
        : { rule, version: 2, providerDeliveryVerified: false },
  );
  render(<WorkHubAwaySettings />);
  fireEvent.click(screen.getByText("workHubAway.open"));
  await screen.findByText("workHubAway.pause");
  fireEvent.click(screen.getByText("workHubAway.pause"));
  await screen.findByText("workHubAway.saved");
  expect(
    JSON.parse(
      env.api.mock.calls.find((c) => c[1]?.method === "POST")![1].body,
    ),
  ).toMatchObject({ action: "pause", expectedVersion: 2, ruleId: rule.id });
});
it("clears saved text and pending controls on current-account invalidation", async () => {
  render(<WorkHubAwaySettings />);
  fireEvent.click(screen.getByText("workHubAway.open"));
  await screen.findByDisplayValue("Neutral saved reply");
  await act(async () => {
    env.generation++;
    env.listeners.forEach((f) => f());
  });
  expect(screen.queryByDisplayValue("Neutral saved reply")).toBeNull();
  expect(screen.queryByText("workHubAway.pause")).toBeNull();
});
it("requires an explicit current refresh after a definitive version conflict", async () => {
  env.api.mockImplementation(async (path: string, init: any) => {
    if (init?.method === "POST")
      throw Object.assign(Error("Conflict"), { status: 409 });
    return path.endsWith("/channels")
      ? {
          channels: [{ id: channel, name: "Joined team" }],
          truncated: false,
          source: "joined_writable_channels",
        }
      : { rule, version: 2, providerDeliveryVerified: false };
  });
  render(<WorkHubAwaySettings />);
  fireEvent.click(screen.getByText("workHubAway.open"));
  fireEvent.click(await screen.findByText("workHubAway.pause"));
  await screen.findByText("workHubAway.conflict");
  expect(screen.queryByText("workHubAway.retry")).toBeNull();
  expect(screen.queryByText("workHubAway.pause")).toBeNull();
  fireEvent.click(screen.getByText("workHubAway.refresh"));
  await screen.findByText("workHubAway.pause");
  expect(
    env.api.mock.calls.filter((call) => call[1]?.method === "POST"),
  ).toHaveLength(1);
});
it("retains an unknown operation and retries readback before identical POST", async () => {
  let posts = 0;
  env.api.mockImplementation(async (path: string, init: any) => {
    if (init?.method === "POST") {
      posts++;
      throw Error("Lost response");
    }
    if (path.includes("/operations/")) return { receipt: null };
    return path.endsWith("/channels")
      ? {
          channels: [{ id: channel, name: "Joined team" }],
          truncated: false,
          source: "joined_writable_channels",
        }
      : { rule, version: 2, providerDeliveryVerified: false };
  });
  render(<WorkHubAwaySettings />);
  fireEvent.click(screen.getByText("workHubAway.open"));
  fireEvent.click(await screen.findByText("workHubAway.pause"));
  fireEvent.click(await screen.findByText("workHubAway.retry"));
  await waitFor(() => expect(posts).toBe(2));
  const calls = env.api.mock.calls.filter((c) => c[1]?.method === "POST");
  expect(calls[0][1].body).toBe(calls[1][1].body);
  expect(env.api.mock.calls.some((c) => c[0].includes("/operations/"))).toBe(
    true,
  );
});
