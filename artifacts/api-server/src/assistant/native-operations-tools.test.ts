import { describe, expect, it } from "vitest";
import { nativeOperationsToolRequest, NATIVE_OPERATIONS_TOOL_ENTRIES } from "./native-operations-tools";
import { resolveExecutableWorkHubToolRequest, bindWorkHubToolScope } from "./work-hub-tool-runtime";

describe("native device work uses the canonical authority", () => {
  const key = "dd0ca77f-7511-4841-a7ae-2066e03f9166";
  it("requires server authorization even if model supplies confirmed", () => {
    expect(resolveExecutableWorkHubToolRequest("request_native_ticket_photo", { confirmed: true }, false)).toMatchObject({ requiresConfirmation: true });
  });
  it("does not allow models to supply device measurements or change worker consent", () => {
    expect(nativeOperationsToolRequest("request_native_location", { workerUserId: 2, vendorId: 3, purpose: "ETA", idempotencyKey: key, latitude: 35 })).toHaveProperty("error");
    expect(NATIVE_OPERATIONS_TOOL_ENTRIES.some(entry => /consent|respond|camera|set_device/.test(entry.tool.name))).toBe(false);
  });
  it("passes one exact idempotent ticket photo request to the shared endpoint", () => {
    const input = { workerUserId: 2, vendorId: 3, ticketId: 4, purpose: "Delivery proof", idempotencyKey: key };
    expect(nativeOperationsToolRequest("request_native_ticket_photo", input)).toEqual({ method: "POST", path: "/native-operations/requests", body: { ...input, kind: "photo" } });
    expect(bindWorkHubToolScope(input, { vendorId: 3 }, "request_native_ticket_photo")).toEqual(input);
  });
  it("reads only an exact saved request without claiming capture completion", () => {
    expect(nativeOperationsToolRequest("query_native_device_requests", { requestId: key })).toEqual({ method: "GET", path: `/native-operations/requests/${key}`, body: {} });
  });
  it("bridges server-confirmed execution identity to one deterministic canonical request UUID", () => {
    const input = { workerUserId: 2, vendorId: 3, ticketId: 4, purpose: "Delivery proof", idempotencyKey: "typed:123:server-fingerprint", confirmed: true, voiceSessionId: "conversation:8" };
    const first = resolveExecutableWorkHubToolRequest("request_native_ticket_photo", input, true, { userId: 1, role: "vendor", vendorId: 3, membershipRole: "admin" });
    const repeated = resolveExecutableWorkHubToolRequest("request_native_ticket_photo", input, true, { userId: 1, role: "vendor", vendorId: 3, membershipRole: "admin" });
    expect(first).toMatchObject({ method: "POST", path: "/native-operations/requests", body: { workerUserId: 2, vendorId: 3, ticketId: 4, kind: "photo", idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/) } });
    expect(first).toEqual(repeated);
    if (first && "body" in first) {
      expect(first.body).not.toHaveProperty("confirmed");
      expect(first.body).not.toHaveProperty("voiceSessionId");
    }
    expect(resolveExecutableWorkHubToolRequest("request_native_ticket_photo", input, false)).toMatchObject({ requiresConfirmation: true });
  });
});

describe("own shift and on-call commands", () => {
 it("rejects model confirmation and arbitrary worker or consent overrides", () => {
  expect(nativeOperationsToolRequest("set_my_shift_status", {action:"end",confirmed:true})).toMatchObject({requiresConfirmation:true});
  expect(nativeOperationsToolRequest("set_my_shift_status", {action:"start",workerUserId:5},true)).toHaveProperty("error");
  expect(nativeOperationsToolRequest("set_my_on_call_status", {active:true,locationSharing:true},true)).toHaveProperty("error");
 });
 it("routes all four confirmed actions to canonical own-user endpoints", () => {
  for(const action of ["start","end"]) expect(resolveExecutableWorkHubToolRequest("set_my_shift_status",{action,confirmed:true,idempotencyKey:"server-owned"},true,{userId:1,role:"field_employee",vendorId:3})).toEqual({method:"POST",path:"/native-operations/duty",body:{action,mode:"manual"}});
  for(const active of [true,false]) expect(resolveExecutableWorkHubToolRequest("set_my_on_call_status",{active},true,{userId:1,role:"vendor",vendorId:3})).toEqual({method:"PUT",path:"/native-operations/on-call",body:{active,consent:true}});
 });
});

import { toolsForRealtime } from "./tool-packs";
it("keeps own work-status actions available from mobile and web Work Hub AskV", () => {
 for(const role of ["vendor","field_employee"]) for(const path of ["/mobile/work-hub","/mobile/work-hub/askv","/work-hub/askv","/work-hub"]){
 expect(toolsForRealtime({role,path}).map(tool=>tool.name)).toEqual(expect.arrayContaining(["query_native_work_status","set_my_shift_status","set_my_on_call_status"]));
 }
});
