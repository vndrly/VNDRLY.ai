import { describe, expect, it } from "vitest";
import {
  bindWorkHubToolScope,
  inferWorkHubAuditTargetId,
  describeWorkHubToolResult,
  resolveExecutableWorkHubToolRequest,
  resolveWorkHubToolRequest,
} from "./work-hub-tool-runtime";

const command = {
  operationId: "00000000-0000-4000-8000-000000000001",
  owner: { type: "vendor" as const, id: 42 },
  context: { kind: "organization" as const, id: 42 },
  expectedVersion: null,
};

describe("resolveWorkHubToolRequest", () => {
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

  it("translates natural task actions to the API''s status-only update contract", () => {
    const taskId = "7be22c7d-4638-4144-bb18-0d2a66996a43";
    expect(resolveWorkHubToolRequest("manage_work_hub_task", {
      ...command, action: "complete", taskId, payload: {},
    })).toMatchObject({ body: { payload: { status: "completed" } } });
    expect(resolveWorkHubToolRequest("manage_work_hub_task", {
      ...command, action: "cancel", taskId, payload: {},
    })).toMatchObject({ body: { payload: { status: "cancelled" } } });
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
      action: "request_to_speak", occurrenceId: "meeting-1",
    })).toMatchObject({ method: "POST", path: "/work-hub/meetings/meeting-1/request-to-speak" });
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
