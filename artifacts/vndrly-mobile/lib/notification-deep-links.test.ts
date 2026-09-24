import { beforeEach, describe, expect, it, vi } from "vitest";
import { openNotificationDestination, resolveNotificationHref } from "./notification-deep-links";
import type { GateNotificationRow } from "./notifications-ui";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./api", () => ({ apiFetch }));

const row: GateNotificationRow = {
  id: 42, type: "work_hub_task_assigned", category: "system", displayCategory: "tasks",
  title: "Assigned task", body: null, link: "/untrusted-stale-link", isRead: false,
  createdAt: "2026-09-24T12:00:00.000Z",
};

beforeEach(() => { apiFetch.mockReset(); });

describe("notification destination resolution", () => {
  it.each([
    ["schedule", "/(tabs)/work-hub?section=calendar"],
    ["gate_crew", "/(tabs)/work-hub?section=groups"],
    ["messages", "/(tabs)/work-hub?section=communications"],
    ["handoffs", "/(tabs)/shift-notes"],
    ["tasks", "/(tabs)/work-hub?section=my-work"],
    ["compliance", "/(tabs)/profile?section=compliance"],
    ["alerts", "/(tabs)/work-hub?section=activity"],
  ])("uses the authorized %s href without inferring a category fallback", async (_, href) => {
    apiFetch.mockResolvedValueOnce({ href });
    await expect(resolveNotificationHref(row)).resolves.toBe(href);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/api/notifications/42/resolve", { method: "POST" });
  });

  it("preserves an exact Work Hub item and resolves before navigation and read", async () => {
    const href = "/work-hub?section=communications&channel=7b077b60-17aa-4e3b-9d23-f622311ff274&messageId=86ec8edf-d36f-4eca-9874-7fd6443a1070";
    const events: string[] = [];
    apiFetch.mockImplementation(async (path: string) => {
      events.push(path);
      return path.endsWith("/resolve") ? { href } : { ok: true };
    });
    const router = { push: vi.fn((target: unknown) => { events.push(String(target)); }) };
    await expect(openNotificationDestination(row, router)).resolves.toBe("opened");
    expect(events).toEqual(["/api/notifications/42/resolve", href, "/api/notifications/42/read"]);
  });

  it.each([
    "/(tabs)/gate?siteId=3&stationId=2",
    "/gate-change-over?siteId=3&handoffId=9",
    "/work-hub/calendar?shift=7b077b60-17aa-4e3b-9d23-f622311ff274",
    "/work-hub/tasks?task=7b077b60-17aa-4e3b-9d23-f622311ff274",
    "/work-hub/tasks/7b077b60-17aa-4e3b-9d23-f622311ff274",
  ])("preserves supported server destination %s", async (href) => {
    apiFetch.mockResolvedValueOnce({ href });
    await expect(resolveNotificationHref(row)).resolves.toBe(href);
  });

  it.each([
    "https://evil.example/work-hub", "//evil.example/work-hub", "javascript:alert(1)",
    "/\\evil.example/work-hub", "/%5cevil.example/work-hub", "/%2fevil.example/work-hub",
    "/(tabs)/work-hub/../profile", "/(tabs)/work-hub/%2e%2e/profile", "/(tabs)/work-hub\n",
    "/(tabs)/work-hub?section=calendar%0a", "/(tabs)/work-hub?bad=%", "/unsupported", "", null, 123,
  ])("rejects unsafe or unsupported href %s without navigation or read", async (href) => {
    apiFetch.mockResolvedValueOnce({ href });
    const router = { push: vi.fn() };
    await expect(openNotificationDestination(row, router)).resolves.toBe("unavailable");
    expect(router.push).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(row.isRead).toBe(false);
  });

  it("does not use a stored link or mark read when resolve rejects", async () => {
    apiFetch.mockRejectedValueOnce(new Error("404 notification.unavailable"));
    const router = { push: vi.fn() };
    await expect(openNotificationDestination({ ...row, link: "/(tabs)/work-hub?section=my-work" }, router)).resolves.toBe("unavailable");
    expect(router.push).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not mark read when navigation fails", async () => {
    apiFetch.mockResolvedValueOnce({ href: "/(tabs)/shift-notes?siteId=3&handoffId=9" });
    const router = { push: vi.fn(() => { throw new Error("navigation failed"); }) };
    await expect(openNotificationDestination(row, router)).resolves.toBe("unavailable");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("propagates a read failure after navigation rather than claiming read success", async () => {
    apiFetch.mockResolvedValueOnce({ href: "/(tabs)/profile?section=compliance&credentialId=8" });
    apiFetch.mockRejectedValueOnce(new Error("read failed"));
    const router = { push: vi.fn() };
    await expect(openNotificationDestination(row, router)).rejects.toThrow("read failed");
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});
