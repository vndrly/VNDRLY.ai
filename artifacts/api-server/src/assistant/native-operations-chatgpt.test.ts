import { describe, expect, it } from "vitest";
import { chatGptActionTools, chatGptReadableTools, chatGptReadToolOutput } from "./chatgpt-tool-access";
import { findAskVTool } from "./tool-registry";

describe("native work preserves existing ChatGPT grants", () => {
  const actor = { userId: 1, role: "vendor", vendorId: 3, membershipRole: "admin" };
  const reads = ["query_native_work_status", "query_native_device_requests"];
  const writes = ["request_native_location", "request_native_ticket_photo"];
  it("exposes native reads through work_hub:read without adding authority to other scopes", () => {
    const names = chatGptReadableTools(actor, ["work_hub:read"]).map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(reads));
    expect(names).not.toEqual(expect.arrayContaining(writes));
    for (const scopes of [[], ["gate:read"], ["*"]]) expect(chatGptReadableTools(actor, scopes).some(tool => [...reads, ...writes].includes(tool.name))).toBe(false);
  });
  it("native writes require existing work_hub:write and durable authenticated confirmation", () => {
    const withoutCrew = chatGptActionTools(actor, ["work_hub:write"]).map(tool => tool.name);
    expect(withoutCrew).toContain("request_native_ticket_photo");
    expect(withoutCrew).not.toContain("request_native_location");
    expect(chatGptActionTools(actor, ["work_hub:write", "crew:read"]).map(tool => tool.name)).toEqual(expect.arrayContaining(writes));
    expect(chatGptActionTools(actor, ["work_hub:read"]).some(tool => writes.includes(tool.name))).toBe(false);
    for (const name of writes) expect(findAskVTool(name)).toMatchObject({ mutating: true, confirmation: "required", execution: "server" });
  });
  it("withholds native measurements without crew consent while retaining request status", () => {
    const output = {requests:[{id:"request",state:"saved",result:{location:{latitude:35,longitude:-97,accuracy:5,capturedAt:"now"},lastKnown:{latitude:34}}}],lastLocation:{latitude:35}};
    for (const name of reads) {
      const result = chatGptReadToolOutput(name,output,["work_hub:read"]);
      expect(result).toEqual({requests:[{id:"request",state:"saved",result:{}}]});
      expect(chatGptReadToolOutput(name,output,["work_hub:read","crew:read"])).toEqual(output);
    }
  });
  it("does not expose native tools to unsigned or unsupported identities", () => {
    expect(chatGptReadableTools({}, ["work_hub:read"])).toEqual([]);
    expect(chatGptActionTools({ userId: 1, role: "guest" }, ["work_hub:write"])).toEqual([]);
  });
});
