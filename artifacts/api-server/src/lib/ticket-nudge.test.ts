import { describe, expect, it } from "vitest";
import {
  nudgeTitleFor,
  resolveActorTier,
  resolveTargetTier,
} from "./ticket-nudge";

describe("resolveActorTier", () => {
  it("maps session roles to workflow tiers", () => {
    expect(resolveActorTier({ role: "field_employee" })).toBe("field");
    expect(resolveActorTier({ role: "vendor" })).toBe("vendor_office");
    expect(resolveActorTier({ role: "partner" })).toBe("partner");
    expect(resolveActorTier({ role: "admin" })).toBe("admin");
    expect(resolveActorTier({ role: "guest" })).toBeNull();
  });
});

describe("resolveTargetTier", () => {
  it("field nudges up to vendor office and cannot nudge down", () => {
    expect(resolveTargetTier("field", "up")).toBe("vendor_office");
    expect(resolveTargetTier("field", "down")).toBeNull();
  });

  it("vendor office nudges up to partner and down to field", () => {
    expect(resolveTargetTier("vendor_office", "up")).toBe("partner");
    expect(resolveTargetTier("vendor_office", "down")).toBe("field");
  });

  it("partner nudges down to vendor office and cannot nudge up", () => {
    expect(resolveTargetTier("partner", "up")).toBeNull();
    expect(resolveTargetTier("partner", "down")).toBe("vendor_office");
  });

  it("admin uses vendor_office as the pivot tier", () => {
    expect(resolveTargetTier("admin", "up")).toBe("partner");
    expect(resolveTargetTier("admin", "down")).toBe("field");
  });
});

describe("nudgeTitleFor", () => {
  it("builds human-readable titles", () => {
    expect(nudgeTitleFor("up", "vendor_office", "#0042")).toContain("office review");
    expect(nudgeTitleFor("up", "partner", "#0042")).toContain("partner approval");
    expect(nudgeTitleFor("down", "field", "#0042")).toContain("field crew");
  });
});
