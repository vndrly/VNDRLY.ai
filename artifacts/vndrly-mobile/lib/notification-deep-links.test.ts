import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openNotificationDestination,
  resolveNotificationHref,
  confirmNotificationRendered,
  getNotificationOpenRequest,
} from "./notification-deep-links";
import type { GateNotificationRow } from "./notifications-ui";
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./api", () => ({ apiFetch }));
const row: GateNotificationRow = {
  id: 42,
  type: "work_hub_task_assigned",
  category: "system",
  displayCategory: "tasks",
  title: "Assigned task",
  body: null,
  link: "/stale-link",
  isRead: false,
  createdAt: "2026-09-24T12:00:00Z",
};
const id = "7b077b60-17aa-4e3b-9d23-f622311ff274";
beforeEach(() => {
  apiFetch.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});
describe("notification destinations", () => {
  it.each(["resolve", "reject"])(
    "expires a hung read and ignores a late %s",
    async (late) => {
      vi.useFakeTimers();
      let finish!: (value: unknown) => void;
      let fail!: (reason: Error) => void;
      let signal: AbortSignal | undefined;
      apiFetch.mockImplementation(async (path: string, init?: RequestInit) =>
        path.endsWith("/resolve")
          ? { href: `/work-hub/tasks/${id}` }
          : new Promise((resolve, reject) => {
              signal = init?.signal ?? undefined;
              finish = resolve;
              fail = reject;
            }),
      );
      const push = vi.fn();
      const result = vi.fn();
      const confirmation = vi.fn();
      void openNotificationDestination(row, { push }).then(result);
      await vi.advanceTimersByTimeAsync(1);
      const requestId = new URL(
        push.mock.calls[0][0],
        "https://app.invalid",
      ).searchParams.get("requestId")!;
      void confirmNotificationRendered(requestId).then(confirmation);
      await vi.advanceTimersByTimeAsync(1);
      expect(finish).toBeTypeOf("function");
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(signal?.aborted).toBe(true);
      expect(getNotificationOpenRequest(requestId)).toBeUndefined();
      expect(result).toHaveBeenCalledExactlyOnceWith("unavailable");
      expect(confirmation).toHaveBeenCalledExactlyOnceWith("unavailable");
      if (late === "resolve") finish({ ok: true });
      else fail(new Error("late failure"));
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toHaveBeenCalledExactlyOnceWith("unavailable");
      expect(confirmation).toHaveBeenCalledExactlyOnceWith("unavailable");
    },
  );
  it("preserves the authorized subject instead of trusting a saved link", async () => {
    const href = `/work-hub/tasks/${id}`;
    apiFetch.mockResolvedValueOnce({ href });
    await expect(resolveNotificationHref(row)).resolves.toBe(href);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith(
      "/api/notifications/42/resolve",
      { method: "POST" },
    );
  });
  it("does not mark read just because Expo accepted a navigation request", async () => {
    vi.useFakeTimers();
    apiFetch.mockResolvedValueOnce({ href: `/work-hub/tasks/${id}` });
    const router = { push: vi.fn() };
    const result = openNotificationDestination(row, router);
    await vi.advanceTimersByTimeAsync(1);
    expect(router.push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/work-hub\/notification\?requestId=/),
    );
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toBe("unavailable");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    "https://evil.example/work-hub",
    "//evil.example/work-hub",
    "javascript:alert(1)",
    "/\\evil.example/work-hub",
    "/%5cevil.example/work-hub",
    "/%2fevil.example/work-hub",
    "/(tabs)/work-hub/../profile",
    "/(tabs)/work-hub/%2e%2e/profile",
    "/(tabs)/work-hub\n",
    "/(tabs)/work-hub?section=calendar%0a",
    "/(tabs)/work-hub?bad=%",
    "/unsupported",
    "",
    null,
    123,
    "/work-hub/tasks",
    "/work-hub?section=calendar",
    `/work-hub?task=${id}&shift=${id}`,
    `/work-hub/tasks/${id}?task=${id}`,
    `/work-hub?task=${id}&redirect=https://evil.example`,
  ])("rejects unhandled href %s without navigation or read", async (href) => {
    apiFetch.mockResolvedValueOnce({ href });
    const router = { push: vi.fn() };
    await expect(openNotificationDestination(row, router)).resolves.toBe(
      "unavailable",
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
  it("does not navigate or mark read when resolve rejects", async () => {
    apiFetch.mockRejectedValueOnce(new Error("404 notification.unavailable"));
    const router = { push: vi.fn() };
    await expect(openNotificationDestination(row, router)).resolves.toBe(
      "unavailable",
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
  it("does not mark read when navigation throws", async () => {
    apiFetch.mockResolvedValueOnce({ href: `/work-hub?task=${id}` });
    const router = {
      push: vi.fn(() => {
        throw new Error("navigation failed");
      }),
    };
    await expect(openNotificationDestination(row, router)).resolves.toBe(
      "unavailable",
    );
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
