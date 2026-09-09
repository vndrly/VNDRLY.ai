import { describe, expect, it } from "vitest";
import { transferRowSchema, transferSourceKey } from "./transfer-policy";
describe("CSV transfer policy", () => {
  it("allows only supported work fields", () => {
    expect(transferRowSchema.safeParse({ externalId: "task-1", title: "Review", bankAccount: "unsupported" }).success).toBe(false);
    expect(transferRowSchema.safeParse({ externalId: "task-1", title: "Review", dueAt: "invalid" }).success).toBe(false);
    expect(transferRowSchema.safeParse({ externalId: "task-1", title: "Review" }).success).toBe(true);
  });
  it("namespaces source identities by company and category", () => {
    const key = transferSourceKey("vendor", 1, "Source", "tasks", "1");
    expect(key).toBe(transferSourceKey("vendor", 1, " source ", "tasks", "1"));
    expect(key).not.toBe(transferSourceKey("vendor", 2, "Source", "tasks", "1"));
    expect(key).not.toBe(transferSourceKey("vendor", 1, "Source", "notes", "1"));
  });
});
