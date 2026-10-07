import { describe, expect, it } from "vitest";
import {
  bindWorkHubToolScope,
  inferWorkHubAuditTargetId,
  describeWorkHubToolResult,
  resolveExecutableWorkHubToolRequest,
  resolveWorkHubToolRequest,
} from "./work-hub-tool-runtime";
import { WORK_HUB_TOOL_NAMES } from "./work-hub-tools";
import { IMPLEMENTATION_A_CAPABILITY_TOOLS } from "./tool-registry";
import { sanitizeChatGptActionInput, validateChatGptActionInput } from "./chatgpt-write-capabilities";

const command = {
  operationId: "00000000-0000-4000-8000-000000000001",
  owner: { type: "vendor" as const, id: 42 },
  context: { kind: "organization" as const, id: 42 },
  expectedVersion: null,
};
it("keeps authenticated exact read arguments separate from injected envelope authority", () => {
  const session={userId:9,role:"partner",partnerId:609,membershipRole:"admin"};
  const occurrenceId="00000000-0000-4000-8000-000000000002";
  for(const [name,args,path] of [
    ["query_work_hub_away_responder",{},"/work-hub/away-responder"],
    ["query_work_hub_away_channels",{},"/work-hub/away-responder/channels"],
    ["query_work_hub_meeting_responses",{occurrenceId},`/work-hub/calendar-response/${occurrenceId}/snapshot`],
    ["query_calendar_reschedule_snapshot",{occurrenceId},`/work-hub/calendar-reschedule/${occurrenceId}/snapshot`],
  ] as const){
    const bound=bindWorkHubToolScope(args,session,name);
    expect(resolveExecutableWorkHubToolRequest(name,bound,false,session)).toMatchObject({method:"GET",path});
    for(const extra of [{owner:{type:"vendor",id:999}},{context:{kind:"organization",id:999}},{companyId:999}])expect(resolveExecutableWorkHubToolRequest(name,bindWorkHubToolScope({...args,...extra},session,name),false,session)).toHaveProperty("error");
  }
  const vendor={userId:9,role:"vendor",vendorId:1107,membershipRole:"admin"};
  expect(resolveExecutableWorkHubToolRequest("query_ticket_invoice_candidates",bindWorkHubToolScope({},vendor,"query_ticket_invoice_candidates"),false,vendor)).toMatchObject({method:"GET",path:expect.stringContaining("/invoices/ticket-preparation/candidates")});
  expect(bindWorkHubToolScope({},session,"send_work_hub_message")).toMatchObject({owner:{type:"partner",id:609},context:{kind:"organization",id:609}});
});

describe("resolveWorkHubToolRequest", () => {
  it("reads transfer choices only for an exact asset through the canonical authority endpoint", () => {
    const assetId = "11111111-1111-4111-8111-111111111111";
    expect(resolveExecutableWorkHubToolRequest("query_asset_transfer_recipients", { assetId }, false)).toEqual({ method: "GET", path: `/implementation-a/assets/${assetId}/transfer-recipients`, body: {} });
    for (const input of [{}, { assetId: "../other" }, { resourceId: assetId }]) expect(resolveExecutableWorkHubToolRequest("query_asset_transfer_recipients", input, false)).toHaveProperty("error");
  });
  it("requires an exact trip for the ETA read adapter", () => {
    const resourceId = "00000000-0000-4000-8000-000000000009";
    expect(resolveExecutableWorkHubToolRequest("query_field_trip_eta", { resourceId }, false)).toMatchObject({ method: "GET", path: `/implementation-a/trips/${resourceId}/eta` });
    expect(resolveExecutableWorkHubToolRequest("query_field_trip_eta", {}, false)).toHaveProperty("error");
  });
  it("reads channel participants through the existing authorized endpoint without a mutation", () => {
    const channelId = "00000000-0000-4000-8000-000000000002";
    expect(resolveExecutableWorkHubToolRequest("list_work_hub_channel_members", { channelId }, false)).toMatchObject({ method: "GET", path: `/work-hub/channels/${channelId}/members` });
    expect(resolveWorkHubToolRequest("list_work_hub_channel_members", {})).toHaveProperty("error");
  });
  it("reads selection candidates without arbitrary scope or private-contact fields", () => {
    expect(resolveExecutableWorkHubToolRequest("query_ticket_assignment_candidates", { vendorId: 12, name: "Bob", limit: 10, includePrivate: true }, false)).toMatchObject({ method: "GET", path: "/implementation-a/workforce/ticket-assignment-candidates?vendorId=12&name=Bob&limit=10" });
  });
  it("uses the canonical text message kind for an ordinary spoken message", () => {
    const channelId = "00000000-0000-4000-8000-000000000002";
    const input = { ...command, channelId, body: "SYNTHETIC DEMO: I am running late" };
    expect(resolveExecutableWorkHubToolRequest("send_work_hub_message", input, false)).toMatchObject({ requiresConfirmation: true });
    const resolved = resolveExecutableWorkHubToolRequest("send_work_hub_message", input, true);
    expect(resolved).toMatchObject({ method: "POST", path: `/work-hub/channels/${channelId}/messages`, body: { payload: { body: input.body, kind: "text", mentionUserIds: [] } } });
  });
  it("reads registered displays without accepting model-supplied screen control", () => {
    for (const name of ["query_operations_displays", "prepare_operations_displays_action"])
      expect(resolveExecutableWorkHubToolRequest(name, { owner: { type: "vendor", id: 999 }, action: "route", payload: {} }, false))
        .toMatchObject({ method: "GET", path: "/implementation-a/operations-displays" });
    expect(resolveExecutableWorkHubToolRequest("confirm_operations_displays_action", { action: "route" }, true)).toHaveProperty("error");
  });
  it("binds carry-forward changes to the saved item and station after trusted authorization", () => {
    const stationId = "00000000-0000-4000-8000-000000000001";
    const itemId = "00000000-0000-4000-8000-000000000002";
    const actor = { userId: 17, role: "field_employee" };
    for (const [action, kind] of [["open_item", "open"], ["resolve_item", "resolve"], ["reopen_item", "reopen"]]) {
      const input = { stationId, itemId, action, text: " Worker note ", actorId: 999, kind: "transfer" };
      expect(resolveExecutableWorkHubToolRequest("manage_gate_shift", input, false, actor)).toMatchObject({ requiresConfirmation: true });
      expect(resolveExecutableWorkHubToolRequest("manage_gate_shift", input, true, actor)).toEqual({ method: "POST", path: `/gate-change-over/${stationId}/items`, body: { itemId, kind, text: "Worker note" } });
      for (const bad of [{ itemId: "../other" }, { text: " " }, { text: "x".repeat(2001) }, { stationId: "../foreign" }]) expect(resolveExecutableWorkHubToolRequest("manage_gate_shift", { ...input, ...bad }, true, actor)).toHaveProperty("error");
    }
  });
  it("acknowledges only the caller's assignment after trusted authorization", () => {
    const input = { ticketId: 12, status: "confirmed", note: "I will be there", employeeId: 999, vendorId: 888 };
    const actor = { userId: 17, role: "field_employee" };
    expect(resolveExecutableWorkHubToolRequest("acknowledge_ticket_assignment", input, false, actor)).toMatchObject({ requiresConfirmation: true });
    expect(resolveExecutableWorkHubToolRequest("acknowledge_ticket_assignment", input, true, actor)).toEqual({ method: "POST", path: "/tickets/12/crew/ack", body: { status: "confirmed", note: "I will be there" } });
    expect(resolveExecutableWorkHubToolRequest("acknowledge_ticket_assignment", { ...input, ticketId: "12/crew" }, true, actor)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("acknowledge_ticket_assignment", { ...input, status: "accept-contract" }, true, actor)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("acknowledge_ticket_assignment", { ...input, note: "x".repeat(501) }, true, actor)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("acknowledge_ticket_assignment", input, true, { userId: 1, role: "admin" })).toHaveProperty("error");
  });
  it("ends exact Gate sessions only with trusted authorization and required handoff facts", () => {
    const stationId = "00000000-0000-4000-8000-000000000001";
    const dutySessionId = "00000000-0000-4000-8000-000000000002";
    const workSessionId = "00000000-0000-4000-8000-000000000003";
    const actor = { userId: 17, role: "field_employee" };
    const input = { stationId, dutySessionId, action: "end_duty", reason: "Shift finished", handoffCompleted: false };
    expect(resolveExecutableWorkHubToolRequest("manage_gate_shift", input, false, actor)).toMatchObject({ requiresConfirmation: true });
    expect(resolveExecutableWorkHubToolRequest("manage_gate_shift", { ...input, handoffCompleted: undefined }, true, actor)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("manage_gate_shift", input, true, actor)).toMatchObject({ path: `/gate-change-over/${stationId}/duty/${dutySessionId}/end`, body: { reason: "Shift finished", handoffCompleted: false } });
    expect(resolveExecutableWorkHubToolRequest("manage_gate_shift", { stationId, workSessionId, action: "end_work" }, true, actor)).toMatchObject({ path: `/gate-change-over/${stationId}/work-sessions/${workSessionId}/end` });
    expect(resolveExecutableWorkHubToolRequest("manage_gate_shift", { stationId, action: "transfer", proof: "invented" }, true, actor)).toHaveProperty("error");
  });
  it("records a payment only after trusted authorization without moving money", () => {
    const input = { ticketId: 12, paymentMethod: "check", paymentReference: "1234", note: "Already paid" };
    expect(resolveExecutableWorkHubToolRequest("record_ticket_payment", input, false)).toMatchObject({ requiresConfirmation: true });
    expect(resolveExecutableWorkHubToolRequest("record_ticket_payment", input, true)).toMatchObject({ method: "POST", path: "/tickets/12/disperse-funds", body: { paymentMethod: "check", paymentReference: "1234", note: "Already paid" } });
  });
  it("reverses only the payment record with trusted authorization and a bounded reason", () => {
    const input = { ticketId: 12, reason: "  Recorded against wrong check  ", paymentReference: "override", actorUserId: 999 };
    expect(resolveExecutableWorkHubToolRequest("reverse_ticket_payment_record", input, false, { userId: 1, role: "partner" })).toMatchObject({ requiresConfirmation: true });
    const resolved = resolveExecutableWorkHubToolRequest("reverse_ticket_payment_record", input, true, { userId: 1, role: "partner" });
    expect(resolved).toMatchObject({ method: "POST", path: "/tickets/12/reverse-dispersal" });
    expect((resolved as { body: unknown }).body).toEqual({ reason: "Recorded against wrong check" });
    for (const reason of [" ", "x".repeat(501), 17]) expect(resolveExecutableWorkHubToolRequest("reverse_ticket_payment_record", { ticketId: 12, reason }, true)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("reverse_ticket_payment_record", { ...input, ticketId: "12/reverse-dispersal" }, true)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("reverse_ticket_payment_record", input, true, { userId: 1, role: "vendor" })).toHaveProperty("error");
  });
  it("unlocks corrections only for platform administrators and ignores supplied state overrides", () => {
    const input = { action: "unlock", ticketId: 12, payload: { reason: "  Correct labor entry  ", status: "funds_dispersed", actorUserId: 999 } };
    expect(resolveExecutableWorkHubToolRequest("manage_ticket_record", input, false, { userId: 1, role: "admin" })).toMatchObject({ requiresConfirmation: true });
    expect(resolveExecutableWorkHubToolRequest("manage_ticket_record", input, true, { userId: 1, role: "partner" })).toHaveProperty("error");
    const resolved = resolveExecutableWorkHubToolRequest("manage_ticket_record", input, true, { userId: 1, role: "admin" });
    expect(resolved).toMatchObject({ path: "/tickets/12/unlock", method: "POST" });
    expect((resolved as { body: unknown }).body).toEqual({ reason: "Correct labor entry" });
    for (const reason of [" ", "x".repeat(501), 17]) expect(resolveExecutableWorkHubToolRequest("manage_ticket_record", { ...input, payload: { reason } }, true, { userId: 1, role: "admin" })).toHaveProperty("error");
  });
  it("requires trusted authorization and the right role for ticket transitions", () => {
    expect(resolveExecutableWorkHubToolRequest("manage_ticket_record", { action: "approve", ticketId: 12, payload: {} }, false, { userId: 1, role: "partner" })).toMatchObject({ requiresConfirmation: true });
    expect(resolveExecutableWorkHubToolRequest("manage_ticket_record", { action: "approve", ticketId: 12, payload: {} }, true, { userId: 1, role: "field_employee" })).toMatchObject({ error: "This ticket action is unavailable to your role." });
    expect(resolveExecutableWorkHubToolRequest("manage_ticket_record", { action: "approve", ticketId: 12, payload: {} }, true, { userId: 1, role: "partner" })).toMatchObject({ path: "/tickets/12/approve", method: "POST" });
    expect(resolveExecutableWorkHubToolRequest("manage_ticket_record", { action: "update", ticketId: "12/approve", payload: {} }, true)).toMatchObject({ error: "Select an exact authorized ticket." });
    expect(resolveExecutableWorkHubToolRequest("manage_ticket_record", { action: "transfer-money", ticketId: 12, payload: {} }, true)).toMatchObject({ error: "That Work Hub ticket action action is not supported." });
  });
  it("finds inventory by exact plate without allowing caller scope overrides", () => {
    expect(resolveExecutableWorkHubToolRequest("query_asset_custody", { alias: { kind: "plate", value: "TX 123", jurisdiction: "TX", owner: "foreign" } }, false)).toMatchObject({ method: "GET", path: "/implementation-a/assets/find?kind=plate&value=TX+123&jurisdiction=TX" });
    expect(resolveExecutableWorkHubToolRequest("query_asset_custody", { alias: { kind: "plate", value: " " } }, false)).toMatchObject({ error: "Supply an exact valid asset identifier." });
    expect(resolveExecutableWorkHubToolRequest("query_asset_custody", { assetId: "asset-one", alias: { kind: "plate", value: "TX123" } }, false)).toMatchObject({ path: "/implementation-a/assets/asset-one" });
  });
  it("creates provisional inventory only after authorization with a bounded exact identifier", () => {
    const input = { ...command, action: "provisional", payload: { alias: { kind: "plate", value: " TX123 ", jurisdiction: " TX ", owner: "foreign" }, responsibleOwner: { type: "partner", id: 999 }, holderUserId: 99 } };
    expect(resolveExecutableWorkHubToolRequest("confirm_asset_custody_action", input, false)).toMatchObject({ requiresConfirmation: true });
    expect(resolveExecutableWorkHubToolRequest("confirm_asset_custody_action", input, true)).toEqual({ method: "POST", path: "/implementation-a/assets/provisional", body: { identifier: { kind: "plate", value: "TX123", jurisdiction: "TX" } } });
    expect(resolveExecutableWorkHubToolRequest("prepare_asset_custody_action", input, false)).toMatchObject({ method: "GET", path: "/implementation-a/assets/find?kind=plate&value=TX123&jurisdiction=TX" });
    for (const alias of [{ kind: "plate", value: " " }, { kind: "gps", value: "TX123" }, { kind: "vin", value: "x".repeat(201) }, { kind: "plate", value: "TX123", jurisdiction: "T" }]) expect(resolveExecutableWorkHubToolRequest("confirm_asset_custody_action", { ...input, payload: { alias } }, true)).toHaveProperty("error");
  });
  it("uses server-owned replay IDs for workforce and trips and bounds subscription confirmation", () => {
    const resume = { ...command, action: "resume", resourceId: "trip-one", payload: { expectedVersion: 4 } };
    expect(resolveExecutableWorkHubToolRequest("confirm_field_trips_action", resume, false)).toMatchObject({ requiresConfirmation: true });
    expect(resolveExecutableWorkHubToolRequest("confirm_field_trips_action", resume, true)).toMatchObject({ method: "POST", path: "/implementation-a/trips/trip-one/resume", body: { expectedVersion: 4 } });
    for (const [name, action] of [["confirm_workforce_coverage_action", "assign"], ["confirm_field_trips_action", "start"]]) {
      const input = { ...command, action, payload: { operationId: "model-replay", owner: { type: "partner", id: 999 } } };
      expect(resolveExecutableWorkHubToolRequest(name, input, false)).toMatchObject({ requiresConfirmation: true });
      const result = resolveExecutableWorkHubToolRequest(name, input, true);
      expect(result).toMatchObject({ body: { operationId: command.operationId } });
      if (action === "start") expect(result).toMatchObject({ body: { owner: command.owner } });
    }
    expect(resolveExecutableWorkHubToolRequest("confirm_worker_subscriptions_action", { ...command, action: "create", payload: { confirmed: false } }, true)).toMatchObject({ body: { confirmed: true } });
  });
  it("wires every advertised typed Work Hub tool into the runtime", () => {
    const names = [
      ...WORK_HUB_TOOL_NAMES,
      ...IMPLEMENTATION_A_CAPABILITY_TOOLS.map((tool) => tool.name),
    ];
    const missing = names.filter(
      (name) => resolveExecutableWorkHubToolRequest(name, {}, false) === null,
    );
    expect(missing).toEqual([]);
  });
  it("lists managed files in the authenticated organization, not a model-supplied owner", () => {
    const scoped = bindWorkHubToolScope({ owner: { type: "partner", id: 999 }, query: "pump", audience: "channel" }, { vendorId: 42 });
    expect(resolveExecutableWorkHubToolRequest("list_work_hub_files", scoped, false)).toMatchObject({ path: "/work-hub/file-library?orgType=vendor&orgId=42&q=pump&scope=channel" });
  });
  it("records the gate station instead of the site's numeric ID", () => {
    const station = "7be22c7d-4638-4144-bb18-0d2a66996a43";
    expect(inferWorkHubAuditTargetId({ payload: { siteId: 9, id: station } }, undefined, "confirm_work_hub_gate_location")).toBe(station);
    expect(inferWorkHubAuditTargetId({ payload: { siteId: 9 } }, { station: { id: station } }, "confirm_work_hub_gate_location")).toBe(station);
    expect(inferWorkHubAuditTargetId({ payload: { siteId: 9 } }, JSON.stringify({ id: station, siteId: 9 }), "confirm_work_hub_gate_location")).toBe(station);
    expect(inferWorkHubAuditTargetId({ payload: { siteId: 9 } }, undefined, "prepare_work_hub_gate_location")).toBeNull();
  });
  it("normalizes reviewed file-share payloads without sending realtime nulls", () => {
    expect(resolveExecutableWorkHubToolRequest("share_work_hub_file", { ...command, fileId: "doc", action: "share", payload: { expiresInDays: 3, shareId: null } }, true)).toMatchObject({ path: "/work-hub/file-library/share", body: { payload: { id: "doc", expiresInDays: 3 } } });
    const revoked = resolveExecutableWorkHubToolRequest("share_work_hub_file", { ...command, fileId: "doc", action: "revoke", payload: { shareId: "share", expiresInDays: null } }, true);
    expect(revoked).toMatchObject({ path: "/work-hub/file-library/revoke-share", body: { payload: { id: "doc", shareId: "share" } } });
    expect(revoked && "body" in revoked ? revoked.body.payload : {}).not.toHaveProperty("expiresInDays");
  });
  it("requires an exact share to revoke and a reviewed expiry to create a share", () => {
    expect(resolveExecutableWorkHubToolRequest("share_work_hub_file", { ...command, fileId: "doc", action: "revoke", payload: {} }, true)).toHaveProperty("error");
    for (const expiresInDays of [null, 0, 31, 1.5]) expect(resolveExecutableWorkHubToolRequest("share_work_hub_file", { ...command, fileId: "doc", action: "share", payload: { expiresInDays } }, true)).toHaveProperty("error");
  });
  it("reads settings and connections and confines language edits to supported values", () => {
    expect(resolveExecutableWorkHubToolRequest("get_work_hub_settings", {}, false)).toMatchObject({ method: "GET", path: "/auth/me" });
    expect(resolveExecutableWorkHubToolRequest("get_work_hub_connections", {}, false)).toMatchObject({ method: "GET", path: "/work-hub/connectors/microsoft-365" });
    expect(resolveExecutableWorkHubToolRequest("set_work_hub_language", { ...command, language: "es" }, false)).toMatchObject({ requiresConfirmation: true });
    expect(resolveExecutableWorkHubToolRequest("set_work_hub_language", { ...command, language: "es" }, true)).toMatchObject({ method: "PATCH", path: "/auth/me/language", body: { language: "es" } });
    expect(resolveExecutableWorkHubToolRequest("set_work_hub_language", { ...command, language: "invalid" }, true)).toHaveProperty("error");
  });
  it("reports reservations and stale custody results without claiming completion", () => {
    expect(describeWorkHubToolResult("prepare_work_hub_file_upload", {}, { resource: { documentId: "doc-1", fileId: "file-2" } })).toMatchObject({ state: "reserved", uploaded: false, finalized: false });
    expect(describeWorkHubToolResult("confirm_asset_custody_action", {}, { status: "conflict", code: "asset.version_conflict" })).toMatchObject({ ok: false, status: "conflict", code: "asset.version_conflict" });
    expect(inferWorkHubAuditTargetId({}, { resource: { documentId: "doc-1", fileId: "file-2" } })).toBe("doc-1");
  });
  it("rejects arbitrary Implementation A action paths", () => {
    expect(resolveExecutableWorkHubToolRequest("confirm_worker_subscriptions_action", { resourceId: "id", action: "../../unexpected", payload: {} }, true)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("confirm_operations_displays_action", { resourceId: "id", action: "../../unexpected", payload: {} }, true)).toHaveProperty("error");
  });
  it("creates assets only under the bound owner and normalizes optional realtime values", () => {
    expect(resolveExecutableWorkHubToolRequest("confirm_asset_custody_action", { ...command, action: "create", payload: { name: "Radio", category: "equipment", legalOwner: "Vendor", responsibleOwner: { type: "vendor", id: 999 } } }, true)).toMatchObject({ method: "POST", path: "/implementation-a/assets", body: { responsibleOwner: command.owner } });
    const result = resolveExecutableWorkHubToolRequest("confirm_asset_custody_action", { ...command, action: "checkout", assetId: "asset-1", expectedVersion: 2, payload: { condition: "good", holderUserId: null, photos: null, note: null } }, true);
    expect(result).toMatchObject({ method: "POST", body: { condition: "good", expectedVersion: 2 } });
    expect(result && "body" in result ? result.body : {}).not.toHaveProperty("holderUserId");
    const created = resolveExecutableWorkHubToolRequest("confirm_asset_custody_action", { ...command, action: "create", payload: { name: "Radio", aliases: [{ kind: "asset_tag", value: "R1", jurisdiction: null }] } }, true);
    expect(created).toMatchObject({ body: { aliases: [{ kind: "asset_tag", value: "R1" }] } });
    expect(created && "body" in created ? (created.body.aliases as object[])[0] : {}).not.toHaveProperty("jurisdiction");
  });
  it("denies anonymous asset reads and non-admin gate location execution", () => {
    expect(resolveExecutableWorkHubToolRequest("query_asset_custody", {}, false, { role: "any" })).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("confirm_work_hub_gate_location", { ...command, confirmation: "token", payload: {} }, true, { userId: 1, role: "vendor", membershipRole: "member", vendorRole: "gatekeeper", vendorId: 42 })).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("query_worker_subscriptions", {}, false, { userId: 1, role: "field_employee" })).toHaveProperty("error");
  });
  it("keeps gate-location tools available when a vendor admin also holds a gate role", () => {
    const payload = { siteId: 9, name: "West", latitude: 35, longitude: -97, geofenceRadiusM: 100, active: true };
    expect(
      resolveExecutableWorkHubToolRequest(
        "prepare_work_hub_gate_location",
        { payload },
        false,
        {
          userId: 1,
          role: "vendor",
          membershipRole: "admin",
          vendorRole: "gate_supervisor",
          vendorId: 42,
        },
      ),
    ).toMatchObject({ path: "/gate-locations/preview" });
  });
  it("records exact Work Hub audit identifiers including nested gate changes", () => {
    for (const key of ["fileId", "documentId", "assetId", "stationId", "channelId", "taskId", "occurrenceId", "exportId"])
      expect(inferWorkHubAuditTargetId({ [key]: "exact-record" })).toBe("exact-record");
    expect(inferWorkHubAuditTargetId({ payload: { id: "gate-1" } })).toBe("gate-1");
  });
  it("executes registered asset reads and prepares the exact asset", () => {
    expect(resolveExecutableWorkHubToolRequest("query_asset_custody", {}, false)).toMatchObject({ method: "GET", path: "/implementation-a/assets" });
    expect(resolveExecutableWorkHubToolRequest("prepare_asset_custody_action", { action: "checkout", assetId: "asset-1" }, false)).toMatchObject({ method: "GET", path: "/implementation-a/assets/asset-1" });
    expect(resolveExecutableWorkHubToolRequest("prepare_asset_custody_action", { action: "erase", assetId: "asset-1" }, false)).toHaveProperty("error");
  });
  it("requires server confirmation and preserves custody concurrency and retry fields", () => {
    const input = { ...command, assetId: "asset-1", action: "checkout", expectedVersion: 3, payload: { condition: "good", photos: [], confirmed: true } };
    expect(resolveExecutableWorkHubToolRequest("confirm_asset_custody_action", input, false)).toMatchObject({ requiresConfirmation: true });
    expect(resolveExecutableWorkHubToolRequest("confirm_asset_custody_action", input, true)).toMatchObject({ method: "POST", path: "/implementation-a/assets/asset-1/checkout", body: { operationId: command.operationId, expectedVersion: 3, confirmed: true, condition: "good" } });
    expect(resolveExecutableWorkHubToolRequest("confirm_asset_custody_action", { ...input, expectedVersion: null }, true)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("confirm_asset_custody_action", { ...input, action: "erase" }, true)).toHaveProperty("error");
  });
  it("preserves inventory search filters and pagination", () => {
    expect(resolveExecutableWorkHubToolRequest("search_work_hub", { query: "pump", types: ["asset", "note"], cursor: "next" }, false)).toMatchObject({ path: "/work-hub/search?q=pump&type=asset%2Cnote&cursor=next" });
  });
  it("binds role export preview to the session owner and rejects unknown datasets", () => {
    expect(resolveExecutableWorkHubToolRequest("preview_work_hub_role_export", { ...command, dataset: "staffing", scope: { ownerOrgId: 999 } }, false)).toMatchObject({ method: "POST", path: "/work-hub/exports/implementation-a/preview", body: { dataset: "staffing", scope: { ownerOrgType: "vendor", ownerOrgId: 42 } } });
    expect(resolveExecutableWorkHubToolRequest("preview_work_hub_role_export", { ...command, dataset: "secrets" }, false)).toHaveProperty("error");
  });
  it("previews exact gate values and requires the returned token for save", () => {
    const payload = { siteId: 9, name: "West", latitude: 35, longitude: -97, geofenceRadiusM: 100, active: true };
    expect(resolveExecutableWorkHubToolRequest("prepare_work_hub_gate_location", { payload }, false)).toMatchObject({ method: "POST", path: "/gate-locations/preview", body: payload });
    expect(resolveExecutableWorkHubToolRequest("confirm_work_hub_gate_location", { ...command, payload }, true)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("confirm_work_hub_gate_location", { ...command, payload, confirmation: "server-token" }, true)).toMatchObject({ method: "POST", path: "/gate-locations", body: { ...payload, confirmation: "server-token", idempotencyKey: command.operationId } });
  });
  it("restricts profile and compliance edits to safe exact fields", () => {
    expect(resolveExecutableWorkHubToolRequest("prepare_work_hub_profile", {}, false)).toMatchObject({ method: "GET", path: "/field/me" });
    expect(resolveExecutableWorkHubToolRequest("confirm_work_hub_profile", { ...command, payload: { phone: "555-0100", pecExpirationDate: "2027-01-01" } }, true)).toMatchObject({ method: "PATCH", path: "/field/me", body: { phone: "555-0100", pecExpirationDate: "2027-01-01" } });
    expect(resolveExecutableWorkHubToolRequest("confirm_work_hub_profile", { ...command, payload: { password: "forbidden" } }, true)).toHaveProperty("error");
  });
  it("does not clear unspecified profile fields supplied as realtime nulls", () => {
    expect(resolveExecutableWorkHubToolRequest("confirm_work_hub_profile", { ...command, payload: { phone: "555-0100", jobTitle: null, pecExpirationDate: null } }, true)).toMatchObject({ body: { phone: "555-0100" } });
    const result = resolveExecutableWorkHubToolRequest("confirm_work_hub_profile", { ...command, payload: { phone: "555-0100", jobTitle: null } }, true);
    expect("body" in result! && result.body).not.toHaveProperty("jobTitle");
    expect(resolveExecutableWorkHubToolRequest("confirm_work_hub_profile", { ...command, payload: { phone: null } }, true)).toHaveProperty("error");
  });
  it("requires both document and reserved file IDs to finalize uploaded bytes", () => {
    expect(resolveExecutableWorkHubToolRequest("manage_work_hub_file", { ...command, action: "finalize", fileId: "document-1", payload: {} }, true)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("manage_work_hub_file", { ...command, action: "finalize", fileId: "document-1", payload: { fileId: "reserved-2" } }, true)).toMatchObject({ body: { payload: { id: "document-1", fileId: "reserved-2" } } });
  });
  it("binds organization scope from the authenticated session instead of model arguments", () => {
    expect(
      bindWorkHubToolScope(
        {
          owner: { type: "partner", id: 999 },
          context: { kind: "organization", id: 999 },
          payload: {},
        },
        { vendorId: 42, partnerId: null },
      ),
    ).toMatchObject({
      owner: { type: "vendor", id: 42 },
      context: { kind: "organization", id: 42 },
    });
  });

  it("independently blocks every unconfirmed Work Hub mutation", () => {
    expect(
      resolveExecutableWorkHubToolRequest("manage_work_hub_channel", {
        ...command,
        action: "create",
        payload: { name: "Dispatch", visibility: "company" },
      }, false),
    ).toMatchObject({
      error: "Please confirm the exact Work Hub action first.",
      requiresConfirmation: true,
    });
    expect(
      resolveExecutableWorkHubToolRequest("manage_work_hub_channel", {
        ...command,
        action: "create",
        payload: { name: "Dispatch", visibility: "company" },
      }, true),
    ).toMatchObject({ method: "POST", path: "/work-hub/channels" });
  });

  it("encodes bounded read queries", () => {
    expect(
      resolveWorkHubToolRequest("search_work_hub", {
        query: "late pump & gate",
        start: "2026-09-12T00:00:00.000Z",
      }),
    ).toEqual({
      method: "GET",
      path: "/work-hub/search?q=late+pump+%26+gate&start=2026-09-12T00%3A00%3A00.000Z",
      body: {},
    });
  });

  it("defaults optional meeting details without turning scheduling into a questionnaire", () => {
    expect(resolveWorkHubToolRequest("manage_work_hub_calendar_item", {
      ...command,
      action: "create",
      kind: "meeting",
      payload: {
        startsAt: "2026-09-18T14:00:00.000Z",
        timezone: "America/Chicago",
        participantUserIds: [11, 12],
      },
    })).toMatchObject({
      method: "POST",
      path: "/work-hub/meetings",
      body: {
        payload: {
          title: "Meeting",
          startsAt: "2026-09-18T14:00:00.000Z",
          endsAt: "2026-09-18T14:30:00.000Z",
          timezone: "America/Chicago",
          participantUserIds: [11, 12],
        },
      },
    });
  });
  it("uses the privacy-safe scheduling availability endpoint", () => {
    expect(
      resolveWorkHubToolRequest("find_work_hub_meeting_times", {
        participantUserIds: [11, 12],
        requestedStart: "2026-09-18T14:00:00.000Z",
        searchStart: "2026-09-18T14:00:00.000Z",
        searchEnd: "2026-09-18T22:00:00.000Z",
        durationMinutes: 30,
        timezone: "America/Chicago",
        limit: 3,
      }),
    ).toEqual({
      method: "POST",
      path: "/work-hub/scheduling/availability-check",
      body: {
        participantUserIds: [11, 12],
        requestedStart: "2026-09-18T14:00:00.000Z",
        searchStart: "2026-09-18T14:00:00.000Z",
        searchEnd: "2026-09-18T22:00:00.000Z",
        durationMinutes: 30,
        timezone: "America/Chicago",
        limit: 3,
      },
    });
  });

  it("builds the canonical command envelope for channel creation", () => {
    expect(
      resolveWorkHubToolRequest("manage_work_hub_channel", {
        ...command,
        action: "create",
        payload: { name: "Dispatch", visibility: "company" },
      }),
    ).toEqual({
      method: "POST",
      path: "/work-hub/channels",
      body: {
        ...command,
        payloadVersion: 1,
        payload: { name: "Dispatch", visibility: "company" },
      },
    });
  });

  it("uses direct route payloads for call settings", () => {
    expect(
      resolveWorkHubToolRequest("set_work_hub_call_availability", {
        ...command,
        available: false,
      }),
    ).toEqual({
      method: "PUT",
      path: "/work-hub/calls/settings",
      body: { available: false },
    });
  });

  it("uses the collaboration route''s exact participant and invitation shapes", () => {
    const channelId = "7be22c7d-4638-4144-bb18-0d2a66996a43";
    expect(resolveWorkHubToolRequest("manage_work_hub_channel_member", {
      ...command, action: "add", channelId, email: "worker@example.com",
    })).toMatchObject({ body: { email: "worker@example.com" } });
    expect(resolveWorkHubToolRequest("manage_work_hub_channel_member", {
      ...command, action: "invite", channelId, userId: 17,
    })).toMatchObject({ body: { recipientUserId: 17 } });
    expect(resolveWorkHubToolRequest("manage_work_hub_chat", {
      ...command, recipientUserId: 17,
    })).toMatchObject({ body: { recipientUserId: 17 } });
    expect(resolveWorkHubToolRequest("respond_work_hub_invitation", {
      ...command, invitationId: channelId, response: "accept",
    })).toMatchObject({ body: { accept: true } });
  });

  it("sends the canonical meeting cancellation action rather than an ignored status", () => {
    const occurrenceId = "7be22c7d-4638-4144-bb18-0d2a66996a43";
    expect(resolveWorkHubToolRequest("manage_work_hub_meeting", {
      ...command, action: "cancel", occurrenceId, payload: {},
    })).toMatchObject({ method: "PATCH", path: `/work-hub/meetings/${occurrenceId}`, body: { payload: { action: "cancel" } } });
  });

  it("preserves task update fields while translating complete and cancel statuses", () => {
    const taskId = "7be22c7d-4638-4144-bb18-0d2a66996a43";
    const description = JSON.stringify({ version: 4, steps: [{ id: "gate_coverage", state: "waiting" }] });
    expect(resolveWorkHubToolRequest("manage_work_hub_task", {
      ...command, action: "update", taskId, expectedVersion: 3,
      payload: { status: "open", description },
    })).toMatchObject({ body: { expectedVersion: 3, payload: { status: "open", description } } });
    expect(resolveWorkHubToolRequest("manage_work_hub_task", {
      ...command, action: "complete", taskId, payload: {},
    })).toMatchObject({ body: { payload: { status: "completed" } } });
    expect(resolveWorkHubToolRequest("manage_work_hub_task", {
      ...command, action: "cancel", taskId, payload: {},
    })).toMatchObject({ body: { payload: { status: "cancelled" } } });
  });

  it("preserves status-free task changes through prepared action validation and trusted execution", () => {
    const taskId = "7be22c7d-4638-4144-bb18-0d2a66996a43";
    for (const payload of [
      { title: "Review the saved report", description: "Recorded work only" },
      { dueAt: "2026-10-10T15:00:00.000Z", assigneeUserId: 17, priority: "high" },
    ]) {
      const prepared = sanitizeChatGptActionInput("manage_work_hub_task", {
        action: "update", taskId, expectedVersion: 4, payload,
      });
      validateChatGptActionInput("manage_work_hub_task", prepared);
      const bound = { ...prepared, ...command, expectedVersion: 4 };
      expect(resolveExecutableWorkHubToolRequest("manage_work_hub_task", bound, false))
        .toMatchObject({ requiresConfirmation: true });
      expect(resolveExecutableWorkHubToolRequest("manage_work_hub_task", bound, true))
        .toEqual({ method: "PATCH", path: `/work-hub/tasks/${taskId}`, body: {
          ...command, payloadVersion: 1, expectedVersion: 4, payload,
        } });
    }
    expect(resolveExecutableWorkHubToolRequest("manage_work_hub_task", {
      ...command, action: "update", taskId, payload: { status: "invented" },
    }, true)).toHaveProperty("error");
    for (const [action, status] of [["complete", "completed"], ["cancel", "cancelled"]]) {
      expect(resolveExecutableWorkHubToolRequest("manage_work_hub_task", {
        ...command, action, taskId, expectedVersion: 4,
        payload: { status: "open", title: "Ignored override" },
      }, true)).toMatchObject({ body: { expectedVersion: 4, payload: { status } } });
    }
  });

  it("uses a server-issued watch token when saving replay progress", () => {
    expect(resolveWorkHubToolRequest("manage_work_hub_replay", {
      ...command,
      action: "save_progress",
      occurrenceId: "7be22c7d-4638-4144-bb18-0d2a66996a43",
      viewerSessionId: "server-issued-token",
      payload: { playheadMs: 1200 },
    })).toMatchObject({
      body: { playheadMs: 1200 },
      headers: { "x-replay-view-session": "server-issued-token" },
    });
  });

  it("wraps invoice email in the canonical command envelope", () => {
    expect(resolveWorkHubToolRequest("manage_work_hub_finance", {
      ...command,
      action: "send_email",
      payload: { id: "7be22c7d-4638-4144-bb18-0d2a66996a43", to: "ap@example.com" },
    })).toMatchObject({
      path: "/work-hub/finance/email",
      body: {
        ...command,
        payloadVersion: 1,
        payload: { id: "7be22c7d-4638-4144-bb18-0d2a66996a43", to: "ap@example.com" },
      },
    });
  });

  it("translates human approval verbs to the endpoint's canonical decisions", () => {
    const approvalId = "7be22c7d-4638-4144-bb18-0d2a66996a43";
    expect(resolveWorkHubToolRequest("manage_work_hub_approval", {
      ...command, action: "approve", approvalId, payload: { comment: "Ready" },
    })).toMatchObject({
      body: { payload: { decision: "approved", comment: "Ready" } },
    });
    expect(resolveWorkHubToolRequest("manage_work_hub_approval", {
      ...command, action: "reject", approvalId, payload: { comment: "Fix it" },
    })).toMatchObject({
      body: { payload: { decision: "rejected", comment: "Fix it" } },
    });
  });

  it("asks meeting questions only from an authorized saved source", () => {
    expect(resolveWorkHubToolRequest("ask_work_hub_meeting", {
      ...command,
      occurrenceId: "7be22c7d-4638-4144-bb18-0d2a66996a43",
      sourceId: "3c23827f-f18c-4517-aecd-c855aba5f518",
      sourceType: "chat",
    })).toMatchObject({
      body: {
        sourceId: "3c23827f-f18c-4517-aecd-c855aba5f518",
        sourceType: "chat",
      },
    });
  });

  it("routes meeting-owner moderation through the canonical protected endpoints", () => {
    expect(resolveWorkHubToolRequest("moderate_work_hub_meeting", {
      action: "host_mute", occurrenceId: "meeting-1", targetUserId: 42,
    })).toMatchObject({ method: "POST", path: "/work-hub/meetings/meeting-1/participants/42/host-mute" });
    expect(resolveWorkHubToolRequest("moderate_work_hub_meeting", {
      action: "release_host_mute", occurrenceId: "meeting-1", targetUserId: 42,
    })).toMatchObject({ method: "DELETE", path: "/work-hub/meetings/meeting-1/participants/42/host-mute" });
    expect(resolveWorkHubToolRequest("moderate_work_hub_meeting", {
      action: "request_to_speak", occurrenceId: "11111111-1111-4111-8111-111111111111", operationId: "22222222-2222-4222-8222-222222222222",
    })).toMatchObject({ method: "POST", path: "/work-hub/meetings/11111111-1111-4111-8111-111111111111/request-to-speak", body: { operationId: "22222222-2222-4222-8222-222222222222" } });
    expect(resolveWorkHubToolRequest("moderate_work_hub_meeting", {
      action: "check_in", occurrenceId: "meeting-1", targetUserId: 42,
    })).toMatchObject({ method: "POST", path: "/work-hub/meetings/meeting-1/participants/42/check-in" });
    expect(resolveWorkHubToolRequest("moderate_work_hub_meeting", {
      action: "check_out", occurrenceId: "meeting-1", targetUserId: 42,
    })).toMatchObject({ method: "DELETE", path: "/work-hub/meetings/meeting-1/participants/42/check-in" });
  });

  it("reserves a new file version without adding fields rejected by the strict schema", () => {
    expect(resolveWorkHubToolRequest("manage_work_hub_file", {
      ...command,
      action: "new_version",
      fileId: "7be22c7d-4638-4144-bb18-0d2a66996a43",
      payload: {
        scope: "personal",
        fileName: "brief.pdf",
        contentType: "application/pdf",
        byteSize: 100,
        checksumSha256: "a".repeat(64),
      },
    })).toMatchObject({
      path: "/work-hub/file-library/reserve",
      body: {
        payload: {
          documentId: "7be22c7d-4638-4144-bb18-0d2a66996a43",
          fileName: "brief.pdf",
        },
      },
    });
    const result = resolveWorkHubToolRequest("manage_work_hub_file", {
      ...command,
      action: "new_version",
      fileId: "7be22c7d-4638-4144-bb18-0d2a66996a43",
      payload: {
        scope: "personal",
        fileName: "brief.pdf",
        contentType: "application/pdf",
        byteSize: 100,
        checksumSha256: "a".repeat(64),
      },
    });
    expect("body" in result! ? result.body.payload : {}).not.toHaveProperty("id");
  });

  it("maps destructive scoped actions without weakening endpoint authorization", () => {
    expect(
      resolveWorkHubToolRequest("manage_work_hub_channel", {
        ...command,
        action: "delete",
        channelId: "7be22c7d-4638-4144-bb18-0d2a66996a43",
        payload: {},
      }),
    ).toEqual({
      method: "DELETE",
      path: "/work-hub/channels/7be22c7d-4638-4144-bb18-0d2a66996a43",
      body: { ...command, payloadVersion: 1, payload: {} },
    });
  });

  it("returns an explicit refusal for an action the product does not support", () => {
    expect(
      resolveWorkHubToolRequest("manage_work_hub_channel", {
        ...command,
        action: "archive",
        channelId: "7be22c7d-4638-4144-bb18-0d2a66996a43",
        payload: {},
      }),
    ).toEqual({
      error: "That Work Hub channel action is not supported.",
    });
  });

  it("maps company-scoped exports and guarded downloads", () => {
    expect(
      resolveWorkHubToolRequest("manage_work_hub_export", {
        ...command,
        action: "create",
        payload: { dataset: "messages", format: "csv" },
      }),
    ).toEqual({
      method: "POST",
      path: "/work-hub/exports",
      body: {
        operationId: command.operationId,
        owner: command.owner,
        dataset: "messages",
        format: "csv",
      },
    });
    expect(
      resolveWorkHubToolRequest("manage_work_hub_export", {
        ...command,
        action: "download",
        exportId: "3c23827f-f18c-4517-aecd-c855aba5f518",
        payload: {},
      }),
    ).toEqual({
      method: "GET",
      path: "/work-hub/exports/3c23827f-f18c-4517-aecd-c855aba5f518/download",
      body: {},
    });
  });
});

describe("initial safety report canonical request", () => {
  it("requires approval and targets initial report rather than incident response", () => {
    const input = { action: "report", payload: { siteLocationId: 1, title: "Synthetic", eventType: "observation" } };
    expect(resolveExecutableWorkHubToolRequest("confirm_incident_response_action", input, false)).toMatchObject({ requiresConfirmation: true });
    expect(resolveExecutableWorkHubToolRequest("confirm_incident_response_action", input, true)).toMatchObject({ method: "POST", path: "/safety/events" });
  });
});

it("requests a bounded long-held equipment report through the authorized asset list", () => {
  expect(resolveExecutableWorkHubToolRequest("query_asset_custody", { checkedOutLongerThanDays: 90 }, false)).toMatchObject({ method: "GET", path: "/implementation-a/assets?checkedOutLongerThanDays=90" });
  expect(resolveExecutableWorkHubToolRequest("query_asset_custody", { checkedOutLongerThanDays: -1 }, false)).toHaveProperty("error");
});

it("forwards ACH payment evidence only through confirmed payment records", () => {
 const input = { ticketId: 12, paymentMethod: "ach", paymentReference: "SYNTHETIC-ACH", paymentReceiptUrl: "private/authorized-receipt.png", note: "Already paid" };
 expect(resolveExecutableWorkHubToolRequest("record_ticket_payment", input, false)).toMatchObject({ requiresConfirmation: true });
 expect(resolveExecutableWorkHubToolRequest("record_ticket_payment", input, true)).toMatchObject({ method: "POST", path: "/tickets/12/disperse-funds", body: { paymentMethod: input.paymentMethod, paymentReference: input.paymentReference, note: input.note, paymentReceiptUrl: input.paymentReceiptUrl } });
});

it('maps exact Inventory hold release to the separate scoped endpoint without custody or physical-repair fields',()=>{const input={owner:{type:'vendor',id:7},assetId:'11111111-1111-4111-8111-111111111111',action:'release_hold',operationId:'22222222-2222-4222-8222-222222222222',expectedVersion:4,payload:{holdId:'33333333-3333-4333-8333-333333333333',reason:'Administrative release'}};expect(resolveExecutableWorkHubToolRequest('confirm_asset_custody_action',input,true)).toEqual({method:'POST',path:'/implementation-a/assets/'+input.assetId+'/holds/'+input.payload.holdId+'/release',body:{operationId:input.operationId,expectedVersion:4,reason:'Administrative release'}});expect(resolveExecutableWorkHubToolRequest('confirm_asset_custody_action',{...input,payload:{reason:'Missing exact hold'}},true)).toHaveProperty('error');});

it("reads current scheduling slots/windows/version through exact scoped canonical GET without write authority", () => {
  const meetingTypeId = "11111111-1111-4111-8111-111111111111";
  expect(
    resolveExecutableWorkHubToolRequest(
      "get_work_hub_scheduling_availability",
      { meetingTypeId, owner: { type: "vendor", id: 999 } },
      false,
    ),
  ).toEqual({
    method: "GET",
    path: "/work-hub/scheduling/types/" + meetingTypeId + "/availability",
    body: {},
  });
  for (const bad of [undefined, "../foreign", 123])
    expect(
      resolveWorkHubToolRequest("get_work_hub_scheduling_availability", {
        meetingTypeId: bad,
      }),
    ).toHaveProperty("error");
  const projection = {
    windows: [],
    slots: ["2026-10-08T12:00:00Z"],
    version: 7,
  };
  expect(
    describeWorkHubToolResult(
      "get_work_hub_scheduling_availability",
      { meetingTypeId },
      projection,
    ),
  ).toEqual(projection);
  expect(
    describeWorkHubToolResult(
      "get_work_hub_scheduling_availability",
      { meetingTypeId },
      { ok: false, error: "Forbidden" },
    ),
  ).toEqual({ ok: false, error: "Forbidden" });
});
it("meeting search validates query before HTTP and respects denial rather than returning raw catchup", () => {
  const occurrenceId = "11111111-1111-4111-8111-111111111111";
  expect(
    resolveExecutableWorkHubToolRequest(
      "search_work_hub_meeting",
      { occurrenceId, query: "pump" },
      false,
    ),
  ).toMatchObject({
    method: "GET",
    path: "/work-hub/meetings/" + occurrenceId + "/catch-up",
  });
  for (const query of [undefined, "", " ", "x".repeat(501)])
    expect(
      resolveWorkHubToolRequest("search_work_hub_meeting", {
        occurrenceId,
        query,
      }),
    ).toHaveProperty("error");
  expect(
    describeWorkHubToolResult(
      "search_work_hub_meeting",
      { occurrenceId, query: "pump" },
      { ok: false, error: "Current participant denied" },
    ),
  ).toEqual({ ok: false, error: "Current participant denied" });
  expect(
    describeWorkHubToolResult(
      "search_work_hub_meeting",
      { occurrenceId, query: "pump" },
      {
        occurrence: { id: occurrenceId },
        chat: [],
        transcript: [],
        recap: "unrelated private summary",
      },
    ),
  ).toMatchObject({ ok: true, matches: [], matchCount: 0 });
});
it("routes requester continuation only through trusted authorization and the saved claim revision", () => {
 const assetId="11111111-1111-4111-8111-111111111111",claimId="22222222-2222-4222-8222-222222222222";
 for(const [action,endpoint] of [["respond_identifier_claim","respond"],["withdraw_identifier_claim","withdraw"]]) {
  const input={...command,assetId,action,expectedVersion:4,payload:{claimId,reason:"Actual user explanation"}};
  expect(resolveExecutableWorkHubToolRequest("confirm_asset_custody_action",input,false)).toHaveProperty("error");
  expect(resolveExecutableWorkHubToolRequest("confirm_asset_custody_action",input,true)).toEqual({method:"POST",path:`/implementation-a/assets/${assetId}/identifier-claims/${claimId}/${endpoint}`,body:{operationId:command.operationId,expectedVersion:4,reason:"Actual user explanation",confirmed:true}});
  expect(resolveExecutableWorkHubToolRequest("prepare_asset_custody_action",input,false)).toMatchObject({method:"GET",path:`/implementation-a/assets/${assetId}/identifier-claims`});
  expect(resolveExecutableWorkHubToolRequest("confirm_asset_custody_action",{...input,payload:{...input.payload,photos:["invented"]}},true)).toHaveProperty("error");
 }
});

it("lets canonical saved parent ancestry determine the reply root", () => {
  const result = resolveWorkHubToolRequest("send_work_hub_message", { ...command, channelId: "channel", body: "Nested reply", replyToId: "reply-B" });
  expect(result).toMatchObject({ method: "POST", path: "/work-hub/channels/channel/messages", body: { payload: { parentMessageId: "reply-B" } } });
  if (!result || !("body" in result)) throw new Error("Expected canonical message request");
  expect(result.body).toHaveProperty("payload.parentMessageId", "reply-B");
  expect(result.body).not.toHaveProperty("payload.rootMessageId");
});
