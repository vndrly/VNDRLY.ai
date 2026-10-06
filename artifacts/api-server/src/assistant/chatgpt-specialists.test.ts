import { describe, expect, it } from "vitest";
import { specialistDirectory } from "./chatgpt-specialists";
import { CHATGPT_READ_CAPABILITIES } from "./chatgpt-read-capabilities";

describe("connected specialist directory", () => {
  it("hides gate tools without a current authorized site while retaining other work", () => {
    const result = specialistDirectory([{ name: "query_gate_stations" }, { name: "query_active_visitors" }, { name: "query_asset_custody" }], [{ name: "manage_gate_shift" }], { hasGateSites: false });
    expect(result.specialists.map(item => item.id)).toEqual(["inventory"]);
    expect(result.coordinatorTools).toEqual([]);
    expect(specialistDirectory([{ name: "query_gate_stations" }], [], { hasGateSites: true }).specialists[0].id).toBe("gate");
  });
  it("hides domains with no authorized tools and never manufactures actions", () => {
    const result = specialistDirectory([{ name: "query_asset_custody" }], []);
    expect(result.specialists.map(item => item.id)).toEqual(["inventory"]);
    expect(result.specialists[0].prepareTools).toEqual([]);
    expect(result.verification.actionStatusAvailable).toBe(false);
  });
  it("separates permitted reads from prepared changes and deduplicates names", () => {
    const result = specialistDirectory([{ name: "query_asset_custody" }, { name: "query_asset_custody" }], [{ name: "confirm_asset_custody_action" }]);
    expect(result.specialists[0]).toMatchObject({ name: "Ivy", readTools: ["query_asset_custody"], prepareTools: ["confirm_asset_custody_action"] });
    expect(result.verification.actionStatusAvailable).toBe(true);
  });
  it("does not claim new Fleet, voices, or meeting identification exists", () => {
    const result = specialistDirectory([{ name: "query_field_trips" }], []);
    expect(result.specialists.find(item => item.id === "fleet")).toMatchObject({ name: "Felix", integrationStatus: "existing_trips_only; VENDRY Fleet not connected" });
    expect(result.voiceSwitchingAvailable).toBe(false);
    expect(result.speakerIdentificationAvailable).toBe(false);
    expect(specialistDirectory([], []).specialists).toEqual([]);
  });
  it("uses authoritative finance membership and retains every permitted tool", () => {
    const names = [...CHATGPT_READ_CAPABILITIES["finance:read"].tools, "query_notifications", "lookup_site_detail", "unknown_future_read"];
    const result = specialistDirectory(names.map(name => ({ name })), []);
    expect(result.specialists.find(item => item.id === "finance")?.readTools).toEqual([...CHATGPT_READ_CAPABILITIES["finance:read"].tools].sort());
    const represented = new Set([...result.coordinatorTools, ...result.specialists.flatMap(item => [...item.readTools, ...item.prepareTools])]);
    expect([...represented].sort()).toEqual([...names].sort());
  });
});
