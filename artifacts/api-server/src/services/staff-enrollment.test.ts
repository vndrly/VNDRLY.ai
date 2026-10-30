import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", async () => ({ ...(await vi.importActual("@workspace/db/schema")), db: {} }));
import { enrollmentPassword, enrollmentStatus } from "./staff-enrollment";
describe("staff enrollment status", () => {
  it("does not infer acceptance from merely having a login", () => {
    expect(enrollmentStatus(null, "worker@example.com", true, false).state).toBe("unsent");
    expect(enrollmentStatus({ sentAt: "2026-10-29T12:00:00Z" }, "worker@example.com", true, false).state).toBe("sent");
  });
  it("keeps acceptance, expiry and revocation distinct", () => {
    const sent = { sentAt: "2026-10-27T12:00:00Z", expiresAt: "2026-10-28T12:00:00Z" };
    expect(enrollmentStatus(sent, "worker@example.com", true, false, Date.parse("2026-10-29T12:00:00Z"))).toMatchObject({ state: "sent", expired: true });
    expect(enrollmentStatus({ ...sent, acceptedAt: "2026-10-27T13:00:00Z" }, "worker@example.com", true, false)).toMatchObject({ state: "accepted", expired: false });
    expect(enrollmentStatus({ ...sent, acceptedAt: "2026-10-27T13:00:00Z" }, "worker@example.com", true, true).state).toBe("revoked");
    expect(enrollmentStatus(null, "placeholder@unenrolled.invalid", true, false).email).toBe("");
  });
  it("generates eight-character temporary passwords with all character classes", () => {
    const passwords = new Set(Array.from({ length: 50 }, enrollmentPassword));
    expect(passwords.size).toBe(50);
    for (const password of passwords) { expect(password).toHaveLength(8); expect(password).toMatch(/[A-Z]/); expect(password).toMatch(/[a-z]/); expect(password).toMatch(/[0-9]/); expect(password).toMatch(/[!@#$%]/); }
  });
});
