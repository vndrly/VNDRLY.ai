import { beforeEach, expect, it, vi } from "vitest";
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./api", () => ({ apiFetch }));
import { loadNotificationDestination, parseNotificationTarget } from "./notification-destination";
beforeEach(() => apiFetch.mockReset());
it("loads an exact safety event through its authorized reader", async () => {
  const target = parseNotificationTarget("/safety/41");
  expect(target).toEqual({ kind: "safety", id: "41" });
  apiFetch.mockResolvedValue({ success: true, data: { event: { id: 41, title: "Stop work", description: "Gate closed", status: "submitted" } } });
  expect(await loadNotificationDestination(target!)).toMatchObject({ subjectId: "41", title: "Stop work", lines: ["Gate closed", "submitted"] });
  expect(apiFetch).toHaveBeenCalledWith("/api/safety/events/41");
});
it("rejects a safety reader returning another event or revoked access", async () => {
  const target = parseNotificationTarget("/safety/41");
  expect(target).not.toBeNull();
  apiFetch.mockResolvedValueOnce({ data: { event: { id: 42, title: "Other site" } } });
  await expect(loadNotificationDestination(target!)).rejects.toThrow("notification.unavailable");
  apiFetch.mockRejectedValueOnce(new Error("revoked"));
  await expect(loadNotificationDestination(target!)).rejects.toThrow("revoked");
});
it.each(["/safety", "/safety/0", "/safety/41?siteId=99", "/safety/41#secret"])("rejects a non-exact safety link %s", href => {
  expect(parseNotificationTarget(href)).toBeNull();
});
