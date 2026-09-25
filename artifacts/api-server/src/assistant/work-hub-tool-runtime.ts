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
const withoutNulls = (value: Input): Input => Object.fromEntries(Object.entries(value).filter(([, item]) => item != null));

export function inferWorkHubAuditTargetId(rawInput: unknown, rawOutput?: unknown): string | number | null {
  const input = record(rawInput);
  let output = rawOutput;
  if (typeof output === "string") { try { output = JSON.parse(output); } catch { output = null; } }
  const result = record(output);
  for (const source of [input, record(input.payload), record(result.resource), record(result.asset), result]) {
    for (const key of ["documentId", "fileId", "assetId", "stationId", "channelId", "taskId", "occurrenceId", "exportId", "resourceId", "messageId", "noteId", "ticketId", "visitId", "notificationId", "siteId", "siteLocationId", "crewEmployeeId", "vendorId", "partnerId", "id"]) {
      const value = source[key];
      if (typeof value === "string" && value.trim() || typeof value === "number" && Number.isFinite(value)) return value as string | number;
    }
  }
  return null;
}

export function describeWorkHubToolResult(name: string, rawInput: unknown, result: Record<string, unknown> | unknown[]) {
  if (Array.isArray(result) || result.ok === false || result.error) return result;
  if (name === "confirm_asset_custody_action" && ["conflict", "blocked"].includes(String(result.status)))
    return { ...result, ok: false, error: result.code ?? "The asset changed or this action is blocked. Read it again before preparing a new action." };
  const input = record(rawInput);
  if ((name === "prepare_work_hub_file_upload" || name === "manage_work_hub_file" && input.action === "new_version") && record(result.resource).fileId)
    return { ...result, state: "reserved", uploaded: false, finalized: false, nextStep: "Upload the selected bytes on the device, then finalize the returned documentId and fileId." };
  return result;
}
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
const zonedDayBoundary = (date: unknown, timezone: unknown, dayOffset: number): string | null => {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day + dayOffset);
  const zone = typeof timezone === "string" && timezone.trim() ? timezone.trim() : "UTC";
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    let guess = desired;
    for (let pass = 0; pass < 2; pass += 1) {
      const values = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
      const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
      guess += desired - represented;
    }
    return new Date(guess).toISOString();
  } catch {
    return null;
  }
};
const envelope = (input: Input, payload = record(input.payload)): Input => ({
  operationId: input.operationId,
  owner: input.owner,
  context: input.context,
  expectedVersion: input.expectedVersion ?? null,
  payloadVersion: 1,
  payload,
});
const normalizedMeetingCreatePayload = (input: Input): Input => {
  const payload = record(input.payload);
  const startsAt = typeof payload.startsAt === "string" ? new Date(payload.startsAt) : null;
  const validStart = startsAt && Number.isFinite(startsAt.getTime()) ? startsAt : null;
  const title = typeof payload.title === "string" && payload.title.trim()
    ? payload.title.trim()
    : typeof payload.meetingType === "string" && payload.meetingType.trim()
      ? payload.meetingType.trim()
      : "Meeting";
  return {
    ...payload,
    title,
    ...(payload.endsAt || !validStart
      ? {}
      : { endsAt: new Date(validStart.getTime() + 30 * 60_000).toISOString() }),
  };
};
const direct = (input: Input, extra: Input = {}): Input => ({
  operationId: input.operationId,
  ...record(input.payload),
  ...extra,
});

function resolveImplementationACapabilityRequest(name: string, input: Input): WorkHubToolRequest | null {
  const action = typeof input.action === "string" ? input.action : "";
  const payload = record(input.payload);
  const resourceId = encoded(input.resourceId ?? input.id ?? input.assetId ?? input.tripId ?? input.eventId ?? input.invitationId);
  if (name.includes("operations_displays")) return unsupported("operations display; use the authenticated companion");
  if (name.includes("asset_custody")) {
    const assetPayload = { ...withoutNulls(payload), ...(Array.isArray(payload.aliases) ? { aliases: payload.aliases.map(value => withoutNulls(record(value))) } : {}), ...(payload.alias ? { alias: withoutNulls(record(payload.alias)) } : {}) };
    const actions = ["create", "aliases", "checkout", "return", "transfer", "condition", "hold", "merge", "verify-issued"];
    if (name === "query_asset_custody") return request("GET", resourceId ? `/implementation-a/assets/${resourceId}` : "/implementation-a/assets");
    if (!actions.includes(action)) return unsupported("asset custody");
    if (action === "create") return name === "prepare_asset_custody_action" ? request("GET", "/implementation-a/assets") : request("POST", "/implementation-a/assets", { ...assetPayload, responsibleOwner: input.owner });
    if (!resourceId) return { error: "A valid asset id is required." };
    if (name === "prepare_asset_custody_action") return request("GET", `/implementation-a/assets/${resourceId}`);
    if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1)
      return { error: "Read the current asset version before confirming custody." };
    return request("POST", `/implementation-a/assets/${resourceId}/${action}`, { ...assetPayload, operationId: input.operationId, expectedVersion: input.expectedVersion, confirmed: true });
  }
  const readPaths: Record<string, string> = {
    query_account_invitations: "/implementation-a/account-invitations",
    query_workforce_coverage: "/implementation-a/workforce/coverage",
    query_asset_custody: "/implementation-a/assets",
    query_field_trips: resourceId ? `/implementation-a/trips/${resourceId}` : "/implementation-a/trips",
    query_incident_response: resourceId ? `/implementation-a/safety/incidents/${resourceId}` : "/implementation-a/safety/incidents",
    query_worker_subscriptions: "/implementation-a/subscriptions",
    query_operations_displays: "/implementation-a/displays",
  };
  if (readPaths[name]) return request("GET", readPaths[name]);
  if (name.startsWith("prepare_") && name.endsWith("_action")) {
    const queryName = name.replace(/^prepare_/, "query_").replace(/_action$/, "");
    const path = readPaths[queryName];
    return path
      ? request("GET", queryPath(path, { prepareAction: action, resourceId }))
      : unsupported("prepared capability");
  }
  if (!name.startsWith("confirm_") || !name.endsWith("_action")) return null;
  if (name === "confirm_account_invitations_action") {
    if (action === "create") return request("POST", "/implementation-a/account-invitations", payload);
    if (!resourceId) return { error: "A valid invitation id is required." };
    if (action === "resend") return request("POST", `/implementation-a/account-invitations/${resourceId}/resend`, payload);
    if (action === "revoke") return request("DELETE", `/implementation-a/account-invitations/${resourceId}`, payload);
  }
  if (name === "confirm_workforce_coverage_action") {
    if (action === "assign") return request("POST", "/implementation-a/workforce/assignments", payload);
    if (!resourceId) return { error: "A valid assignment or coverage id is required." };
    if (action === "acknowledge") return request("PATCH", `/implementation-a/workforce/assignments/${resourceId}/acknowledge`, payload);
    if (["evaluate", "escalate"].includes(action)) return request("POST", `/implementation-a/workforce/coverage/${resourceId}/${action}`, payload);
  }
  if (name === "confirm_asset_custody_action") {
    if (!resourceId) return { error: "A valid asset id is required." };
    if (["checkout", "return", "transfer", "condition", "hold", "merge"].includes(action)) return request("POST", `/implementation-a/assets/${resourceId}/${action}`, payload);
  }
  if (name === "confirm_field_trips_action") {
    if (action === "start") return request("POST", "/implementation-a/trips", payload);
    if (!resourceId) return { error: "A valid trip id is required." };
    if (["location", "pause"].includes(action)) return request("POST", `/implementation-a/trips/${resourceId}/${action}`, payload);
  }
  if (name === "confirm_incident_response_action") {
    if (action === "create") return request("POST", "/implementation-a/safety/incidents", payload);
    if (!resourceId) return { error: "A valid safety event id is required." };
    if (["escalate", "acknowledge", "evidence", "hold", "close"].includes(action)) return request("POST", `/implementation-a/safety/incidents/${resourceId}/${action}`, payload);
  }
  if (name === "confirm_worker_subscriptions_action") {
    if (action === "create") return request("POST", "/implementation-a/subscriptions", payload);
    if (resourceId && ["pause", "terminate", "reactivate"].includes(action)) return request("POST", `/implementation-a/subscriptions/${resourceId}/${action}`, payload);
  }
  return unsupported("capability");
}
export function resolveWorkHubToolRequest(
  name: string,
  rawInput: unknown,
): WorkHubToolRequest | null {
  const input = record(rawInput);
  const payload = record(input.payload);
  let target: string | WorkHubToolRequest;

  switch (name) {
    case "get_work_hub_settings": return request("GET", "/auth/me");
    case "get_work_hub_connections": return request("GET", "/work-hub/connectors/microsoft-365");
    case "set_work_hub_language":
      return ["en", "es", "pt"].includes(String(input.language)) ? request("PATCH", "/auth/me/language", { language: input.language }) : unsupported("language");
    case "preview_work_hub_role_export":
      if (!["payroll", "quickbooks-time", "assets", "staffing", "safety"].includes(String(input.dataset))) return unsupported("export dataset");
      return request("POST", "/work-hub/exports/implementation-a/preview", { dataset: input.dataset, scope: { ownerOrgType: record(input.owner).type, ownerOrgId: record(input.owner).id } });
    case "get_work_hub_gate_locations":
      return request("GET", input.siteId ? queryPath("/gate-locations", { siteId: input.siteId }) : "/gate-locations/sites");
    case "prepare_work_hub_gate_location":
      return request("POST", "/gate-locations/preview", withoutNulls(payload));
    case "confirm_work_hub_gate_location":
      if (!id(input.confirmation)) return { error: "Preview the exact gate values first." };
      return request("POST", "/gate-locations", { ...withoutNulls(payload), confirmation: input.confirmation, idempotencyKey: input.operationId });
    case "prepare_work_hub_profile":
      return request("GET", "/field/me");
    case "confirm_work_hub_profile":
      if (!Object.keys(withoutNulls(payload)).length || Object.keys(payload).some(key => !["firstName", "lastName", "jobTitle", "phone", "pecExpirationDate"].includes(key))) return unsupported("profile field");
      return request("PATCH", "/field/me", withoutNulls(payload));
    case "get_work_hub_briefing":
      return request("GET", "/work-hub/home");
    case "search_work_hub":
      return request("GET", queryPath("/work-hub/search", {
        q: input.query,
        start: input.start,
        end: input.end,
        type: Array.isArray(input.types) ? input.types.join(",") : input.type,
        cursor: input.cursor,
      }));
    case "get_work_hub_activity":
      return request("GET", queryPath("/work-hub/activity", { q: input.query }));
    case "find_work_hub_people":
      return request("GET", queryPath("/work-hub/people", { q: input.query }));
    case "list_work_hub_crews":
      return request("GET", "/work-hub/crews");
    case "get_work_hub_crew_members":
      target = required(input.crewId, "crew id");
      return typeof target === "string"
        ? request("GET", `/work-hub/crews/${target}/members`)
        : target;
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
      if (typeof target !== "string") return target;
      if (input.action === "claim")
        return request("POST", `/work-hub/shifts/${target}/claim`);
      if (["update", "reschedule", "cancel"].includes(String(input.action)))
        return request("PATCH", `/work-hub/shifts/${target}`, envelope(input, {
          ...payload,
          ...(input.action === "cancel" ? { status: "cancelled" } : {}),
        }));
      return unsupported("shift");

    case "get_work_hub_calendar":
      return request("GET", queryPath("/work-hub/calendar", { start: input.start, end: input.end }));
    case "get_work_hub_agenda":
      {
        const start = zonedDayBoundary(input.date, input.timezone, 0);
        const end = zonedDayBoundary(input.date, input.timezone, 1);
        return start && end
          ? request("GET", queryPath("/work-hub/calendar", { start, end }))
          : { error: "A valid local date and timezone are required." };
      }
    case "get_work_hub_calendar_item":
      target = required(input.itemId, "calendar item id");
      return typeof target === "string"
        ? request("GET", `/work-hub/calendar/items/${encodeURIComponent(String(input.kind))}/${target}`)
        : target;
    case "find_work_hub_meeting_times":
      return request("POST", "/work-hub/scheduling/availability-check", {
        participantUserIds: input.participantUserIds,
        requestedStart: input.requestedStart,
        searchStart: input.searchStart,
        searchEnd: input.searchEnd,
        durationMinutes: input.durationMinutes ?? 30,
        timezone: input.timezone,
        limit: input.limit ?? 3,
      });
    case "manage_work_hub_calendar_item":
      {
        const kind = typeof input.kind === "string" ? input.kind : "";
        const action = typeof input.action === "string" ? input.action : "";
        if (action === "create") {
          if (kind === "shift") return request("POST", "/work-hub/shifts", envelope(input));
          if (kind === "event" || kind === "meeting") return request("POST", "/work-hub/meetings", envelope(input, normalizedMeetingCreatePayload(input)));
          if (kind === "task") return request("POST", "/work-hub/tasks", envelope(input));
        }
        target = required(input.itemId, "calendar item id");
        if (typeof target !== "string") return target;
        if (kind === "shift") return request("PATCH", `/work-hub/shifts/${target}`, envelope(input, { action, ...payload }));
        if (kind === "event" || kind === "meeting") return request("PATCH", `/work-hub/meetings/${target}`, envelope(input, { action, ...payload }));
        if (kind === "task") return request("PATCH", `/work-hub/tasks/${target}`, envelope(input, { action, ...payload }));
        return unsupported("calendar item");
      }
    case "get_work_hub_subcontractor_hours":
      {
        const owner = record(input.owner);
        const vendorId = encoded(owner.id);
        const companyId = encoded(input.companyId);
        return vendorId && companyId ? request("GET", queryPath(`/vendors/${vendorId}/managed-subcontractors/${companyId}/hours`, {
        start: input.start,
        end: input.end,
        })) : { error: "A vendor owner and subcontractor company are required." };
      }
    case "manage_work_hub_subcontractor_hours":
      {
        const owner = record(input.owner);
        const vendorId = encoded(owner.id);
        const companyId = encoded(input.companyId);
        if (!vendorId || !companyId) return { error: "A vendor owner and subcontractor company are required." };
        const base = `/vendors/${vendorId}/managed-subcontractors/${companyId}/hours`;
        const path = input.action === "approve" ? `${base}/approve` : input.action === "email" ? `${base}/email` : input.action === "prepare_pdf" ? `${base}/pdf` : null;
        if (!path) return unsupported("subcontractor hours");
        return request(input.action === "prepare_pdf" ? "GET" : "POST", queryPath(path, {
        start: input.start,
        end: input.end,
        }), payload);
      }
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
        return request("POST", "/work-hub/meetings", envelope(input, normalizedMeetingCreatePayload(input)));
      target = required(input.occurrenceId, "meeting occurrence id");
      if (typeof target !== "string") return target;
      if (["join", "leave", "end"].includes(String(input.action)))
        return request("POST", `/work-hub/meetings/${target}/${input.action}`, payload);
      if (["update", "reschedule", "cancel"].includes(String(input.action)))
        return request("PATCH", `/work-hub/meetings/${target}`, envelope(input, {
          ...payload,
          ...(input.action === "cancel" ? { status: "cancelled" } : {}),
        }));
      return unsupported("meeting");
    case "moderate_work_hub_meeting": {
      target = required(input.occurrenceId, "meeting occurrence id");
      if (typeof target !== "string") return target;
      if (input.action === "request_to_speak")
        return request("POST", `/work-hub/meetings/${target}/request-to-speak`);
      const userId = required(input.targetUserId, "target user id");
      if (typeof userId !== "string") return userId;
      if (input.action === "host_mute")
        return request("POST", `/work-hub/meetings/${target}/participants/${userId}/host-mute`);
      if (input.action === "release_host_mute")
        return request("DELETE", `/work-hub/meetings/${target}/participants/${userId}/host-mute`);
      if (input.action === "remove")
        return request("POST", `/work-hub/meetings/${target}/participants/${userId}/remove`);
      if (input.action === "check_in")
        return request("POST", `/work-hub/meetings/${target}/participants/${userId}/check-in`);
      if (input.action === "check_out")
        return request("DELETE", `/work-hub/meetings/${target}/participants/${userId}/check-in`);
      return unsupported("meeting moderation");
    }
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
      return request("POST", "/work-hub/file-library/reserve", envelope(input, withoutNulls(payload)));
    case "manage_work_hub_file": {
      if (input.action === "finalize" && (!id(input.fileId) || !id(payload.fileId)))
        return { error: "Finalize requires the document id and reserved file id after the device uploads the bytes." };
      const actionMap: Record<string, string> = {
        favorite: "favorite", unfavorite: "favorite", recycle: "recycle",
        restore: "restore", finalize: "finalize", new_version: "reserve",
      };
      const action = actionMap[String(input.action)];
      if (!action) return unsupported("file");
      if (input.action === "new_version")
        return request("POST", "/work-hub/file-library/reserve", envelope(input, {
          ...withoutNulls(payload),
          documentId: input.fileId,
        }));
      return request("POST", `/work-hub/file-library/${action}`, envelope(input, {
        ...withoutNulls(payload),
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
  session?: { userId?: number; role?: string; membershipRole?: string | null; vendorRole?: string | null; vendorId?: number | null; managedSubcontractor?: unknown },
): WorkHubToolRequest | null {
  const metadata = resolveWorkHubToolMetadata(name);
  if (!metadata) return null;
  if (session && (!session.userId || !metadata.roles.includes(session.role as never))) return { error: "This tool is not available to your role." };
  if (session && metadata.companyAdminOnly && session.membershipRole !== "admin") return { error: "Organization administrator access is required." };
  if (session && name.includes("gate_location") && (session.role !== "vendor" || !session.vendorId || session.membershipRole !== "admin" || session.managedSubcontractor || ["gatekeeper", "gate_supervisor"].includes(session.vendorRole ?? ""))) return { error: "Only a current vendor organization administrator may manage gate locations." };
  const input = record(rawInput);
  if (metadata.mutating && !mutationAuthorizedByServer)
    return {
      error: "Please confirm the exact Work Hub action first.",
      requiresConfirmation: true,
    };
  return resolveWorkHubToolRequest(name, input) ?? resolveImplementationACapabilityRequest(name, input) ?? unsupported("tool");
}
import { WORK_HUB_TOOL_METADATA } from "./work-hub-tools";
import { IMPLEMENTATION_A_CAPABILITY_TOOLS, findAskVTool } from "./tool-registry";

export const isTypedWorkHubTool = (name: string): boolean =>
  Boolean(resolveWorkHubToolMetadata(name));

export const resolveWorkHubToolMetadata = (name: string) =>
  WORK_HUB_TOOL_METADATA[name] || IMPLEMENTATION_A_CAPABILITY_TOOLS.some((tool) => tool.name === name) ? findAskVTool(name) : null;

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
