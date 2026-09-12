import { describe, expect, it } from "vitest";
import {
  bindWorkHubToolScope,
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
