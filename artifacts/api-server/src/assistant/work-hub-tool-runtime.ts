export type WorkHubHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type WorkHubToolRequest =
  | {
      method: WorkHubHttpMethod;
      path: string;
      body: Record<string, unknown>;
      headers?: Record<string, string>;
    }
  | { error: string; requiresConfirmation?: boolean };

type Input = Record<string, unknown>;

const record = (value: unknown): Input =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Input)
    : {};
const id = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return String(value);
  return null;
};
const encoded = (value: unknown): string | null => {
  const valueId = id(value);
  return valueId ? encodeURIComponent(valueId) : null;
};
const request = (
  method: WorkHubHttpMethod,
  path: string,
  body: Input = {},
  headers?: Record<string, string>,
): WorkHubToolRequest => ({ method, path, body, ...(headers ? { headers } : {}) });
const unsupported = (domain: string): WorkHubToolRequest => ({
  error: `That Work Hub ${domain} action is not supported.`,
});
const required = (value: unknown, label: string): string | WorkHubToolRequest =>
  encoded(value) ?? { error: `A valid ${label} is required.` };
const queryPath = (
  path: string,
  values: Record<string, unknown>,
): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== null && String(value).trim())
      params.set(key, String(value));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
};
const envelope = (input: Input, payload = record(input.payload)): Input => ({
  operationId: input.operationId,
  owner: input.owner,
  context: input.context,
  expectedVersion: input.expectedVersion ?? null,
  payloadVersion: 1,
  payload,
});
const direct = (input: Input, extra: Input = {}): Input => ({
  operationId: input.operationId,
  ...record(input.payload),
  ...extra,
});

export function resolveWorkHubToolRequest(
  name: string,
  rawInput: unknown,
): WorkHubToolRequest | null {
  const input = record(rawInput);
  const payload = record(input.payload);
  let target: string | WorkHubToolRequest;

  switch (name) {
    case "get_work_hub_briefing":
      return request("GET", "/work-hub/home");
    case "search_work_hub":
      return request("GET", queryPath("/work-hub/search", {
        q: input.query,
        start: input.start,
        end: input.end,
      }));
    case "get_work_hub_activity":
      return request("GET", queryPath("/work-hub/activity", { q: input.query }));
    case "find_work_hub_people":
      return request("GET", queryPath("/work-hub/people", { q: input.query }));
    case "list_work_hub_crews":
      return request("GET", "/work-hub/crews");
    case "manage_work_hub_crew":
      if (input.action === "create")
        return request("POST", "/work-hub/crews", direct(input, { owner: input.owner }));
      target = required(input.crewId, "crew id");
      if (typeof target !== "string") return target;
      if (input.action === "update")
        return request("PATCH", `/work-hub/crews/${target}`, payload);
      return unsupported("crew");
    case "manage_work_hub_crew_member":
      target = required(input.crewId, "crew id");
      if (typeof target !== "string") return target;
      if (input.action === "add")
        return request("POST", `/work-hub/crews/${target}/members`, {
          userId: input.userId,
          ...payload,
        });
      if (input.action === "remove") {
        const userId = required(input.userId, "user id");
        return typeof userId === "string"
          ? request("DELETE", `/work-hub/crews/${target}/members/${userId}`)
          : userId;
      }
      return unsupported("crew member");
    case "list_work_hub_channels":
      return request("GET", input.crewId
        ? queryPath("/work-hub/channels", { crewId: input.crewId })
        : "/work-hub/channels");
    case "manage_work_hub_channel":
      if (input.action === "create")
        return request("POST", "/work-hub/channels", envelope(input));
      target = required(input.channelId, "channel id");
      if (typeof target !== "string") return target;
      if (input.action === "delete")
        return request("DELETE", `/work-hub/channels/${target}`, envelope(input));
      return unsupported("channel");
    case "manage_work_hub_channel_member":
      target = required(input.channelId, "channel id");
      if (typeof target !== "string") return target;
      if (input.action === "add")
        return typeof input.email === "string" && input.email.trim()
          ? request("POST", `/work-hub/channels/${target}/members`, {
              email: input.email.trim(),
            })
          : { error: "A valid member email is required." };
      if (input.action === "invite")
        return typeof input.userId === "number" &&
          Number.isSafeInteger(input.userId) &&
          input.userId > 0
          ? request("POST", `/work-hub/channels/${target}/invitations`, {
              recipientUserId: input.userId,
            })
          : { error: "A valid recipient user id is required." };
      return unsupported("channel member");
    case "list_work_hub_messages":
      target = required(input.channelId, "channel id");
      return typeof target === "string"
        ? request("GET", queryPath(`/work-hub/channels/${target}/messages`, { before: input.before }))
        : target;
    case "send_work_hub_message":
      target = required(input.channelId, "channel id");
      return typeof target === "string"
        ? request("POST", `/work-hub/channels/${target}/messages`, envelope(input, {
            body: input.body,
            parentMessageId: input.replyToId,
            rootMessageId: input.replyToId,
            mentionUserIds: payload.mentionUserIds ?? [],
            kind: payload.kind ?? "message",
          }))
        : target;
    case "manage_work_hub_message": {
      const channel = required(input.channelId, "channel id");
      const message = required(input.messageId, "message id");
      if (typeof channel !== "string") return channel;
      if (typeof message !== "string") return message;
      const path = `/work-hub/channels/${channel}/messages/${message}`;
      if (input.action === "edit")
        return request("PATCH", path, envelope(input, { body: input.body }));
      if (input.action === "delete") return request("DELETE", path, envelope(input));
      return unsupported("message");
    }
    case "react_work_hub_message": {
      const channel = required(input.channelId, "channel id");
      const message = required(input.messageId, "message id");
      if (typeof channel !== "string") return channel;
      if (typeof message !== "string") return message;
      return request("POST", `/work-hub/channels/${channel}/messages/${message}/reactions`,
        envelope(input, { emoji: input.reaction }));
    }
    case "mark_work_hub_channel_read":
      target = required(input.channelId, "channel id");
      return typeof target === "string"
        ? request("PUT", `/work-hub/channels/${target}/read-cursor`, {
            lastMessageId: input.messageId ?? null,
          })
        : target;
    case "list_work_hub_notes":
      target = required(input.channelId, "channel id");
      return typeof target === "string"
        ? request("GET", `/work-hub/channels/${target}/notes`)
        : target;
    case "manage_work_hub_note": {
      const channel = required(input.channelId, "channel id");
      if (typeof channel !== "string") return channel;
      if (input.action === "create")
        return request("POST", `/work-hub/channels/${channel}/notes`, envelope(input));
      const note = required(input.noteId, "note id");
      if (typeof note !== "string") return note;
      return input.action === "update"
        ? request("PATCH", `/work-hub/channels/${channel}/notes/${note}`, envelope(input))
        : unsupported("note");
    }
    case "manage_work_hub_chat":
      return typeof input.recipientUserId === "number" &&
        Number.isSafeInteger(input.recipientUserId) &&
        input.recipientUserId > 0
        ? request("POST", "/work-hub/chats", {
            recipientUserId: input.recipientUserId,
            ...(typeof input.name === "string" && input.name.trim()
              ? { name: input.name.trim() }
              : {}),
          })
        : { error: "A valid recipient user id is required." };
    case "respond_work_hub_invitation":
      target = required(input.invitationId, "invitation id");
      return typeof target === "string"
        ? request("POST", `/work-hub/invitations/${target}/respond`, {
            accept: input.response === "accept",
          })
        : target;
    case "set_work_hub_preferences":
      return request("PUT", "/work-hub/preferences", payload);

    case "list_work_hub_tasks":
      return request("GET", queryPath("/work-hub/tasks", {
        status: input.status,
        assigneeUserId: input.assigneeUserId,
      }));
    case "manage_work_hub_task":
      if (input.action === "create")
        return request("POST", "/work-hub/tasks", envelope(input));
      target = required(input.taskId, "task id");
      if (typeof target !== "string") return target;
      if (!["update", "complete", "cancel"].includes(String(input.action)))
        return unsupported("task");
      {
        const status =
          input.action === "complete"
            ? "completed"
            : input.action === "cancel"
              ? "cancelled"
              : payload.status;
        if (!["open", "in_progress", "completed", "cancelled"].includes(String(status)))
          return { error: "A valid task status is required." };
        return request("PATCH", `/work-hub/tasks/${target}`, envelope(input, {
          status,
        }));
      }
    case "manage_work_hub_form_template":
    case "manage_work_hub_checklist_template": {
      const kind = name.includes("form") ? "forms" : "checklists";
      if (input.action === "create")
        return request("POST", `/work-hub/admin/${kind}`, envelope(input));
      target = required(input.templateId, "template id");
      return typeof target === "string" && input.action === "assign"
        ? request("POST", `/work-hub/admin/${kind}/${target}/assign`, envelope(input))
        : unsupported(`${kind.slice(0, -1)} template`);
    }
    case "respond_work_hub_form":
    case "respond_work_hub_checklist": {
      const kind = name.includes("_form") ? "forms" : "checklists";
      target = required(kind === "forms" ? input.formId : input.checklistId, `${kind.slice(0, -1)} id`);
      return typeof target === "string"
        ? request("POST", `/work-hub/${kind}/${target}/${kind === "forms" ? "submit" : "respond"}`, envelope(input))
        : target;
    }
    case "manage_work_hub_approval":
      if (input.action === "request")
        return request("POST", "/work-hub/admin/approvals", envelope(input));
      target = required(input.approvalId, "approval id");
      return typeof target === "string" && ["approve", "reject"].includes(String(input.action))
        ? request("POST", `/work-hub/admin/approvals/${target}/decide`, envelope(input, {
            ...payload,
            decision: input.action === "approve" ? "approved" : "rejected",
          }))
        : typeof target === "string" ? unsupported("approval") : target;
    case "manage_work_hub_announcement":
      if (input.action === "publish")
        return request("POST", "/work-hub/announcements", envelope(input));
      target = required(input.announcementId, "announcement id");
      return typeof target === "string" && input.action === "acknowledge"
        ? request("POST", `/work-hub/announcements/${target}/acknowledge`)
        : typeof target === "string" ? unsupported("announcement") : target;
    case "manage_work_hub_shift":
      if (input.action === "create")
        return request("POST", "/work-hub/shifts", envelope(input));
      target = required(input.shiftId, "shift id");
      return typeof target === "string" && input.action === "claim"
        ? request("POST", `/work-hub/shifts/${target}/claim`)
        : typeof target === "string" ? unsupported("shift") : target;

    case "get_work_hub_calendar":
      return request("GET", queryPath("/work-hub/calendar", { start: input.start, end: input.end }));
    case "list_work_hub_meeting_types":
      return request("GET", "/work-hub/scheduling/types");
    case "manage_work_hub_meeting_type":
      if (input.action === "create")
        return request("POST", "/work-hub/scheduling/types", direct(input));
      target = required(input.meetingTypeId, "meeting type id");
      return typeof target === "string" && input.action === "update"
        ? request("PATCH", `/work-hub/scheduling/types/${target}`, direct(input, {
            expectedVersion: input.expectedVersion,
          }))
        : typeof target === "string" ? unsupported("meeting type") : target;
    case "manage_work_hub_scheduling":
      target = required(input.meetingTypeId, "meeting type id");
      if (typeof target !== "string") return target;
      if (input.action === "set_availability")
        return request("PUT", `/work-hub/scheduling/types/${target}/availability`,
          direct(input, { expectedVersion: input.expectedVersion }));
      if (input.action === "book")
        return request("POST", `/work-hub/scheduling/types/${target}/book`, direct(input));
      return unsupported("scheduling");

    case "get_work_hub_calls":
      return request("GET", queryPath("/work-hub/calls", { filter: input.direction ?? "all" }));
    case "set_work_hub_call_availability":
      return request("PUT", "/work-hub/calls/settings", { available: input.available });
    case "start_work_hub_call":
      return request("POST", "/work-hub/calls", {
        recipientUserId: input.calleeUserId,
        operationId: input.operationId,
      });
    case "respond_work_hub_call":
      target = required(input.callId, "call id");
      return typeof target === "string"
        ? request("POST", `/work-hub/calls/${target}/respond`, { action: input.response })
        : target;
    case "list_work_hub_voicemail":
      return request("GET", "/work-hub/voicemail");
    case "manage_work_hub_voicemail":
      target = required(input.voicemailId, "voicemail id");
      if (typeof target !== "string") return target;
      if (input.action === "transcribe")
        return request("POST", `/work-hub/voicemail/${target}/transcribe`);
      if (input.action === "delete")
        return request("DELETE", `/work-hub/voicemail/${target}`);
      if (input.action === "create_callback_task")
        return request("POST", "/work-hub/tasks", envelope(input, payload));
      return unsupported("voicemail");

    case "manage_work_hub_meeting":
      if (input.action === "create")
        return request("POST", "/work-hub/meetings", envelope(input));
      target = required(input.occurrenceId, "meeting occurrence id");
      if (typeof target !== "string") return target;
      if (["join", "leave", "end"].includes(String(input.action)))
        return request("POST", `/work-hub/meetings/${target}/${input.action}`, payload);
      return unsupported("meeting");
    case "get_work_hub_meeting_catchup":
      target = required(input.occurrenceId, "meeting occurrence id");
      return typeof target === "string"
        ? request("GET", `/work-hub/meetings/${target}/catch-up`)
        : target;
    case "ask_work_hub_meeting":
      target = required(input.occurrenceId, "meeting occurrence id");
      return typeof target === "string"
        ? request("POST", `/work-hub/meetings/${target}/askv/question`, {
            sourceId: input.sourceId,
            sourceType: input.sourceType,
          })
        : target;
    case "search_work_hub_meeting":
      target = required(input.occurrenceId, "meeting occurrence id");
      return typeof target === "string"
        ? request("GET", `/work-hub/meetings/${target}/catch-up`)
        : target;
    case "manage_work_hub_replay":
      target = required(input.occurrenceId, "meeting occurrence id");
      if (typeof target !== "string") return target;
      if (input.action === "start_watch")
        return request("POST", `/work-hub/meetings/${target}/replay/watch/session`, payload);
      if (input.action === "save_progress")
        return typeof input.viewerSessionId === "string" &&
          input.viewerSessionId.trim()
          ? request(
              "POST",
              `/work-hub/meetings/${target}/replay/watch/progress`,
              payload,
              { "x-replay-view-session": input.viewerSessionId.trim() },
            )
          : { error: "A valid replay watch session is required." };
      return unsupported("replay");
    case "manage_work_hub_meeting_file":
      target = required(input.occurrenceId, "meeting occurrence id");
      if (typeof target !== "string") return target;
      if (input.action === "delete") {
        const file = required(input.fileId, "file id");
        return typeof file === "string"
          ? request("DELETE", `/work-hub/meetings/${target}/files/${file}`)
          : file;
      }
      return unsupported("meeting file");
    case "manage_work_hub_replay_assignment":
      target = required(input.occurrenceId, "meeting occurrence id");
      return typeof target === "string"
        ? request("POST", `/work-hub/meetings/${target}/replay/assignments`, payload)
        : target;

    case "list_work_hub_files":
      return request("GET", queryPath("/work-hub/file-library", { q: input.query, scope: input.audience }));
    case "get_work_hub_file_versions":
      target = required(input.fileId, "file id");
      return typeof target === "string"
        ? request("GET", `/work-hub/file-library/${target}/versions`)
        : target;
    case "prepare_work_hub_file_upload":
      return request("POST", "/work-hub/file-library/reserve", envelope(input));
    case "manage_work_hub_file": {
      const actionMap: Record<string, string> = {
        favorite: "favorite", unfavorite: "favorite", recycle: "recycle",
        restore: "restore", finalize: "finalize", new_version: "reserve",
      };
      const action = actionMap[String(input.action)];
      if (!action) return unsupported("file");
      if (input.action === "new_version")
        return request("POST", "/work-hub/file-library/reserve", envelope(input, {
          ...payload,
          documentId: input.fileId,
        }));
      return request("POST", `/work-hub/file-library/${action}`, envelope(input, {
        ...payload,
        id: input.fileId,
        ...(input.action === "unfavorite" ? { active: false } : {}),
        ...(input.action === "favorite" ? { active: true } : {}),
      }));
    }
    case "share_work_hub_file": {
      const action = input.action === "share" ? "share" : input.action === "revoke" ? "revoke-share" : null;
      return action
        ? request("POST", `/work-hub/file-library/${action}`, envelope(input, { ...payload, id: input.fileId }))
        : unsupported("file share");
    }

    case "get_work_hub_finance":
      return request("GET", queryPath("/work-hub/finance", { q: input.query, status: input.status }));
    case "manage_work_hub_finance":
      if (["create_draft", "update_draft"].includes(String(input.action)))
        return request("POST", "/work-hub/finance/invoice-save", envelope(input, {
          ...payload,
          ...(input.recordId ? { id: input.recordId } : {}),
        }));
      if (input.action === "send_email")
        return request("POST", "/work-hub/finance/email", envelope(input));
      return unsupported("finance");

    case "get_work_hub_audit":
      return request("GET", queryPath("/work-hub/audit", { q: input.query, start: input.start, end: input.end }));
    case "manage_work_hub_export":
      if (input.action === "create")
        return request("POST", "/work-hub/exports", {
          operationId: input.operationId,
          owner: input.owner,
          ...payload,
        });
      target = required(input.exportId, "export id");
      return typeof target === "string" && input.action === "download"
        ? request("GET", `/work-hub/exports/${target}/download`)
        : typeof target === "string" ? unsupported("export") : target;
    case "manage_work_hub_import":
      if (input.action === "preview")
        return request("POST", "/work-hub/transfers/preview", direct(input));
      target = required(input.transferId, "transfer id");
      return typeof target === "string" && input.action === "apply"
        ? request("POST", `/work-hub/transfers/${target}/apply`, {
            operationId: input.operationId,
            confirm: true,
          })
        : typeof target === "string" ? unsupported("import") : target;
    case "get_work_hub_metrics":
      return request("GET", queryPath("/work-hub/governance/metrics", {
        ownerType: record(input.owner).type,
        ownerId: record(input.owner).id,
        start: input.start,
        end: input.end,
      }));
    case "manage_work_hub_retention":
      if (input.action === "create_policy")
        return request("POST", "/work-hub/governance/retention/policies", {
          operationId: input.operationId,
          owner: input.owner,
          rules: payload.rules ?? payload,
        });
      if (input.action === "create_plan")
        return request("POST", "/work-hub/governance/retention/plans", {
          operationId: input.operationId,
          owner: input.owner,
        });
      return unsupported("retention");
    case "manage_work_hub_legal_hold":
      if (input.action === "create")
        return request("POST", "/work-hub/governance/legal-holds", {
          operationId: input.operationId,
          owner: input.owner,
          subject: payload.subject,
          reason: payload.reason,
        });
      if (input.action === "release") {
        target = required(input.holdId, "legal hold id");
        return typeof target === "string"
          ? request("POST", `/work-hub/governance/legal-holds/${target}/release`, {
              operationId: input.operationId,
            })
          : target;
      }
      return unsupported("legal hold");
    default:
      return null;
  }
}

export function resolveExecutableWorkHubToolRequest(
  name: string,
  rawInput: unknown,
  mutationAuthorizedByServer: boolean,
): WorkHubToolRequest | null {
  const metadata = WORK_HUB_TOOL_METADATA[name];
  if (!metadata) return null;
  const input = record(rawInput);
  if (metadata.mutating && !mutationAuthorizedByServer)
    return {
      error: "Please confirm the exact Work Hub action first.",
      requiresConfirmation: true,
    };
  return resolveWorkHubToolRequest(name, input);
}
import { WORK_HUB_TOOL_METADATA } from "./work-hub-tools";

export const isTypedWorkHubTool = (name: string): boolean =>
  Boolean(WORK_HUB_TOOL_METADATA[name]);

export function bindWorkHubToolScope(
  rawInput: unknown,
  session: { vendorId?: number | null; partnerId?: number | null },
): Input {
  const input = record(rawInput);
  const owner = session.vendorId
    ? { type: "vendor", id: session.vendorId }
    : session.partnerId
      ? { type: "partner", id: session.partnerId }
      : null;
  if (!owner) return input;
  const currentContext = record(input.context);
  const context =
    !currentContext.kind || currentContext.kind === "organization"
      ? { kind: "organization", id: owner.id }
      : currentContext;
  return { ...input, owner, context };
}
