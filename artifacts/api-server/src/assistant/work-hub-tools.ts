import type { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";

export const WORK_HUB_TOOL_FAMILIES = [
  "command",
  "collaboration",
  "tasks",
  "scheduling",
  "calls",
  "meetings",
  "files",
  "finance",
  "administration",
] as const;

export type WorkHubToolFamily = (typeof WORK_HUB_TOOL_FAMILIES)[number];

type JsonSchema = Anthropic.Tool["input_schema"];
type Entry = Readonly<{
  tool: Anthropic.Tool;
  family: WorkHubToolFamily;
  mutating: boolean;
  companyAdminOnly?: boolean;
}>;

const text = (description?: string) => ({
  type: "string",
  ...(description ? { description } : {}),
});
const identifier = (description?: string) => text(description);
const nullableVersion = { anyOf: [{ type: "number" }, { type: "null" }] };
const owner = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["vendor", "partner"] },
    id: { type: "number" },
  },
  required: ["type", "id"],
  additionalProperties: false,
};
const context = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["organization", "ticket", "site", "crew", "gate", "project", "channel", "meeting"],
    },
    id: { anyOf: [{ type: "number" }, { type: "string" }] },
  },
  required: ["kind", "id"],
  additionalProperties: false,
};

function schema(
  properties: Record<string, unknown> = {},
  required: string[] = [],
): JsonSchema {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function writeSchema(
  properties: Record<string, unknown> = {},
  required: string[] = [],
): JsonSchema {
  return schema(
    {
      operationId: { type: "string", format: "uuid" },
      owner,
      context,
      expectedVersion: nullableVersion,
      ...properties,
    },
    ["operationId", "owner", "context", ...required],
  );
}

function read(
  name: string,
  family: WorkHubToolFamily,
  description: string,
  inputSchema: JsonSchema = schema(),
): Entry {
  return {
    tool: { name, description, input_schema: inputSchema },
    family,
    mutating: false,
  };
}

function write(
  name: string,
  family: WorkHubToolFamily,
  description: string,
  inputSchema: JsonSchema,
  companyAdminOnly = false,
): Entry {
  return {
    tool: { name, description, input_schema: inputSchema },
    family,
    mutating: true,
    companyAdminOnly,
  };
}

const entries: Entry[] = [
  read("get_work_hub_briefing", "command", "Get the caller''s permission-scoped Work Hub home briefing, required actions, summaries, and suggested next actions."),
  read("search_work_hub", "command", "Search authorized Work Hub messages, tasks, meetings, files, people, and activity.", schema({
    query: text("Natural-language search query."),
    start: text("Optional ISO start time."),
    end: text("Optional ISO end time."),
  }, ["query"])),
  read("get_work_hub_activity", "command", "List recent authorized Work Hub activity.", schema({
    query: text("Optional activity text filter."),
  })),

  read("find_work_hub_people", "collaboration", "Find people available to the active company by name or email.", schema({ query: text() })),
  read("list_work_hub_crews", "collaboration", "List crews visible to the caller."),
  write("manage_work_hub_crew", "collaboration", "Create or update a crew after confirmation.", writeSchema({
    action: { type: "string", enum: ["create", "update"] },
    crewId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"])),
  write("manage_work_hub_crew_member", "collaboration", "Add or remove a crew member after confirmation.", writeSchema({
    action: { type: "string", enum: ["add", "remove"] },
    crewId: identifier(),
    userId: { type: "number" },
    payload: { type: "object" },
  }, ["action", "crewId", "userId"])),
  read("list_work_hub_channels", "collaboration", "List channels visible to the caller.", schema({ crewId: identifier() })),
  write("manage_work_hub_channel", "collaboration", "Create or delete a channel after confirmation.", writeSchema({
    action: { type: "string", enum: ["create", "delete"] },
    channelId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"]), true),
  write("manage_work_hub_channel_member", "collaboration", "Add or invite a channel member after confirmation.", writeSchema({
    action: { type: "string", enum: ["add", "invite"] },
    channelId: identifier(),
    email: text("Existing VNDRLY user's email when adding a company member."),
    userId: { type: "number" },
  }, ["action", "channelId"])),
  read("list_work_hub_messages", "collaboration", "Read authorized messages in a channel.", schema({
    channelId: identifier(),
    before: text(),
  }, ["channelId"])),
  write("send_work_hub_message", "collaboration", "Send a message to an authorized channel after showing its destination and content.", writeSchema({
    channelId: identifier(),
    body: text(),
    replyToId: identifier(),
  }, ["channelId", "body"])),
  write("manage_work_hub_message", "collaboration", "Edit or delete the caller''s authorized message after confirmation.", writeSchema({
    action: { type: "string", enum: ["edit", "delete"] },
    channelId: identifier(),
    messageId: identifier(),
    body: text(),
  }, ["action", "channelId", "messageId"])),
  write("react_work_hub_message", "collaboration", "Add or remove the caller''s reaction to a message.", writeSchema({
    channelId: identifier(),
    messageId: identifier(),
    reaction: text(),
  }, ["channelId", "messageId", "reaction"])),
  write("mark_work_hub_channel_read", "collaboration", "Advance the caller''s read cursor in an authorized channel.", writeSchema({
    channelId: identifier(),
    messageId: identifier(),
  }, ["channelId"])),
  read("list_work_hub_notes", "collaboration", "List authorized channel notes.", schema({ channelId: identifier() }, ["channelId"])),
  write("manage_work_hub_note", "collaboration", "Create or update an authorized channel note after confirmation.", writeSchema({
    action: { type: "string", enum: ["create", "update"] },
    channelId: identifier(),
    noteId: identifier(),
    payload: { type: "object" },
  }, ["action", "channelId", "payload"])),
  write("manage_work_hub_chat", "collaboration", "Create a private chat with selected authorized participants after confirmation.", writeSchema({
    recipientUserId: { type: "number" },
    name: text(),
  }, ["recipientUserId"])),
  write("respond_work_hub_invitation", "collaboration", "Accept or decline a Work Hub invitation.", writeSchema({
    invitationId: identifier(),
    response: { type: "string", enum: ["accept", "decline"] },
  }, ["invitationId", "response"])),
  write("set_work_hub_preferences", "collaboration", "Update the caller''s Work Hub navigation, favorites, mute, or notification preferences.", writeSchema({
    payload: { type: "object" },
  }, ["payload"])),

  read("list_work_hub_tasks", "tasks", "List permission-scoped Work Hub tasks.", schema({ status: text(), assigneeUserId: { type: "number" } })),
  write("manage_work_hub_task", "tasks", "Create or change the status of a Work Hub task after confirmation.", writeSchema({
    action: { type: "string", enum: ["create", "update", "complete", "cancel"] },
    taskId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"])),
  write("manage_work_hub_form_template", "tasks", "Create or assign a form template after confirmation.", writeSchema({
    action: { type: "string", enum: ["create", "assign"] },
    templateId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"])),
  write("manage_work_hub_checklist_template", "tasks", "Create or assign a checklist template after confirmation.", writeSchema({
    action: { type: "string", enum: ["create", "assign"] },
    templateId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"])),
  write("respond_work_hub_form", "tasks", "Submit the caller''s authorized form response after confirmation.", writeSchema({
    formId: identifier(),
    payload: { type: "object" },
  }, ["formId", "payload"])),
  write("respond_work_hub_checklist", "tasks", "Submit the caller''s authorized checklist response after confirmation.", writeSchema({
    checklistId: identifier(),
    payload: { type: "object" },
  }, ["checklistId", "payload"])),
  write("manage_work_hub_approval", "tasks", "Request, approve, or reject a Work Hub approval after confirmation.", writeSchema({
    action: { type: "string", enum: ["request", "approve", "reject"] },
    approvalId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"])),
  write("manage_work_hub_announcement", "tasks", "Publish or acknowledge an authorized announcement after confirmation.", writeSchema({
    action: { type: "string", enum: ["publish", "acknowledge"] },
    announcementId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"])),
  write("manage_work_hub_shift", "tasks", "Create or claim an authorized shift after confirmation.", writeSchema({
    action: { type: "string", enum: ["create", "claim"] },
    shiftId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"])),

  read("get_work_hub_calendar", "scheduling", "Read the authorized Work Hub calendar.", schema({
    start: text("ISO start time."),
    end: text("ISO end time."),
  }, ["start", "end"])),
  read("list_work_hub_meeting_types", "scheduling", "List meeting types and scheduling pages visible to the caller."),
  write("manage_work_hub_meeting_type", "scheduling", "Create or update a meeting type after confirmation.", writeSchema({
    action: { type: "string", enum: ["create", "update"] },
    meetingTypeId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"])),
  write("manage_work_hub_scheduling", "scheduling", "Update availability or book a scheduled meeting after confirmation.", writeSchema({
    action: { type: "string", enum: ["set_availability", "book"] },
    meetingTypeId: identifier(),
    bookingId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"])),

  read("get_work_hub_calls", "calls", "List authorized internal call history.", schema({ direction: { type: "string", enum: ["all", "incoming", "outgoing", "missed"] } })),
  write("set_work_hub_call_availability", "calls", "Set whether the caller is available for internal calls.", writeSchema({
    available: { type: "boolean" },
  }, ["available"])),
  write("start_work_hub_call", "calls", "Start an internal call to an authorized person after confirmation.", writeSchema({
    calleeUserId: { type: "number" },
  }, ["calleeUserId"])),
  write("respond_work_hub_call", "calls", "Accept, decline, or end an internal call.", writeSchema({
    callId: identifier(),
    response: { type: "string", enum: ["accept", "decline", "end"] },
  }, ["callId", "response"])),
  read("list_work_hub_voicemail", "calls", "List voicemail visible to the caller."),
  write("manage_work_hub_voicemail", "calls", "Transcribe, create a callback task from, or delete a voicemail after confirmation.", writeSchema({
    action: { type: "string", enum: ["transcribe", "create_callback_task", "delete"] },
    voicemailId: identifier(),
    payload: { type: "object" },
  }, ["action", "voicemailId"])),

  write("manage_work_hub_meeting", "meetings", "Create, join, leave, or end an authorized meeting.", writeSchema({
    action: { type: "string", enum: ["create", "join", "leave", "end"] },
    occurrenceId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"])),
  read("get_work_hub_meeting_catchup", "meetings", "Get the authorized meeting catch-up, transcript projection, decisions, and action items.", schema({ occurrenceId: identifier() }, ["occurrenceId"])),
  write("ask_work_hub_meeting", "meetings", "Answer an Ask V question from the caller's authorized saved meeting message or transcript segment.", writeSchema({
    occurrenceId: identifier(),
    sourceId: identifier("Saved chat-message or transcript-segment id."),
    sourceType: { type: "string", enum: ["chat", "transcript"] },
  }, ["occurrenceId", "sourceId", "sourceType"])),
  read("search_work_hub_meeting", "meetings", "Search an authorized meeting transcript or replay for an exact topic or moment.", schema({
    occurrenceId: identifier(),
    query: text(),
  }, ["occurrenceId", "query"])),
  write("manage_work_hub_replay", "meetings", "Start a replay watch session or save authorized replay progress.", writeSchema({
    action: { type: "string", enum: ["start_watch", "save_progress"] },
    occurrenceId: identifier(),
    viewerSessionId: text("Server-issued watch session returned by start_watch."),
    payload: { type: "object" },
  }, ["action", "occurrenceId", "payload"])),
  write("manage_work_hub_meeting_file", "meetings", "Delete an authorized meeting file after confirmation.", writeSchema({
    action: { type: "string", enum: ["delete"] },
    occurrenceId: identifier(),
    fileId: identifier(),
    payload: { type: "object" },
  }, ["action", "occurrenceId", "fileId"])),
  write("manage_work_hub_replay_assignment", "meetings", "Assign or update replay review work after confirmation.", writeSchema({
    occurrenceId: identifier(),
    payload: { type: "object" },
  }, ["occurrenceId", "payload"])),

  read("list_work_hub_files", "files", "Search and list authorized Work Hub files.", schema({ query: text(), audience: text() })),
  read("get_work_hub_file_versions", "files", "List versions of an authorized Work Hub file.", schema({ fileId: identifier() }, ["fileId"])),
  write("prepare_work_hub_file_upload", "files", "Reserve an authorized Work Hub file upload with an exact audience and destination.", writeSchema({
    payload: { type: "object" },
  }, ["payload"])),
  write("manage_work_hub_file", "files", "Favorite, recycle, restore, finalize, or add a version to an authorized file.", writeSchema({
    action: { type: "string", enum: ["favorite", "unfavorite", "recycle", "restore", "finalize", "new_version"] },
    fileId: identifier(),
    payload: { type: "object" },
  }, ["action", "fileId", "payload"])),
  write("share_work_hub_file", "files", "Create or revoke an authorized file share after showing its audience and expiration.", writeSchema({
    action: { type: "string", enum: ["share", "revoke"] },
    fileId: identifier(),
    payload: { type: "object" },
  }, ["action", "fileId", "payload"])),

  read("get_work_hub_finance", "finance", "Read permission-scoped Work Hub billing, payroll, invoice, and approval information.", schema({ query: text(), status: text() })),
  write("manage_work_hub_finance", "finance", "Create or update an invoice draft, or send an invoice email after confirmation.", writeSchema({
    action: { type: "string", enum: ["create_draft", "update_draft", "send_email"] },
    recordId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"])),

  read("get_work_hub_audit", "administration", "Read the active company''s authorized Work Hub audit history.", schema({ query: text(), start: text(), end: text() })),
  write("manage_work_hub_export", "administration", "Create a company-scoped Work Hub export after confirming dataset and scope.", writeSchema({
    action: { type: "string", enum: ["create"] },
    exportId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"]), true),
  write("manage_work_hub_import", "administration", "Preview or apply a company-scoped import; apply always requires exact confirmation.", writeSchema({
    action: { type: "string", enum: ["preview", "apply"] },
    transferId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"]), true),
  read("get_work_hub_metrics", "administration", "Read aggregate operational metrics for the active company.", schema({ start: text(), end: text() })),
  write("manage_work_hub_retention", "administration", "Create a new versioned company retention policy or generate a non-destructive retention plan.", writeSchema({
    action: { type: "string", enum: ["create_policy", "create_plan"] },
    policyId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"]), true),
  write("manage_work_hub_legal_hold", "administration", "Create or release a company legal hold after strong confirmation.", writeSchema({
    action: { type: "string", enum: ["create", "release"] },
    holdId: identifier(),
    payload: { type: "object" },
  }, ["action", "payload"]), true),
];

export const WORK_HUB_TOOL_ENTRIES = Object.freeze(entries);
export const WORK_HUB_TOOLS: Anthropic.Tool[] = entries.map((entry) => entry.tool);
export const WORK_HUB_TOOL_NAMES = Object.freeze(entries.map((entry) => entry.tool.name));
const toolNamesByFamily = WORK_HUB_TOOL_FAMILIES.reduce(
  (result, family) => {
    result[family] = new Set(
      entries
        .filter((entry) => entry.family === family)
        .map((entry) => entry.tool.name),
    );
    return result;
  },
  {} as Record<WorkHubToolFamily, ReadonlySet<string>>,
);
export const WORK_HUB_TOOL_NAMES_BY_FAMILY: Readonly<
  Record<WorkHubToolFamily, ReadonlySet<string>>
> = Object.freeze(toolNamesByFamily);

export const WORK_HUB_TOOL_METADATA = Object.freeze(Object.fromEntries(
  entries.map((entry) => [
    entry.tool.name,
    {
      family: entry.family,
      mutating: entry.mutating,
      companyAdminOnly: entry.companyAdminOnly ?? false,
    },
  ]),
) as Record<string, { family: WorkHubToolFamily; mutating: boolean; companyAdminOnly: boolean }>);
