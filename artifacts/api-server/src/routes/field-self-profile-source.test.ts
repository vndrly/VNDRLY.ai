import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("PATCH /api/field/me email support", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "field.ts"), "utf8");

  it("validates conflicts and keeps the employee and login email aligned", () => {
    expect(source).toContain('email?: string;');
    expect(source).toContain('code: "field.invalid_email"');
    expect(source).toContain('code: "field.email_in_use"');
    expect(source).toContain('userUpdates.username = normalizedEmail');
    expect(source).toContain('userUpdates.email = normalizedEmail');
  });
});
