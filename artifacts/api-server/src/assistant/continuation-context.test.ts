import { describe, expect, it } from "vitest";
import { continuationContext } from "./continuation-context";
describe("saved continuation observations", () => {
  const call = { organizationKey: "vendor:2", name: "list_work_hub_tasks", input: { status: "open", cursor: "previous" }, output: JSON.stringify({ items: [{ id: "exact" }], nextCursor: "next" }) };
  const row = { id: 1, createdAt: new Date(0), toolCalls: [call] };
  it("preserves query, cursor and ordered result references after refresh", () => {
    expect(JSON.parse(continuationContext([row], new Set([call.name]), "vendor:2"))[0]).toMatchObject({ arguments: call.input, result: { nextCursor: "next", items: [{ id: "exact" }] } });
  });
  it("does not replay another organization's data or revoked tool access", () => {
    expect(continuationContext([row], new Set([call.name]), "vendor:3")).toBe("[]");
    expect(continuationContext([row], new Set(), "vendor:2")).toBe("[]");
  });
  it("excludes legacy unscoped and private results", () => {
    expect(continuationContext([{ ...row, toolCalls: [{ ...call, organizationKey: undefined }, { ...call, output: '{"privatePersonalResult":true}' }] }], new Set([call.name]), "vendor:2")).toBe("[]");
  });
});
