import { pgTable, serial, text, timestamp, integer, jsonb, real, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { assistantConversationsTable } from "./assistantConversations";
import { assistantMessagesTable } from "./assistantMessages";

export const assistantActionAuditTable = pgTable(
  "assistant_action_audit",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    actorRole: text("actor_role"),
    actorMembershipRole: text("actor_membership_role"),
    partnerId: integer("partner_id"),
    vendorId: integer("vendor_id"),
    vendorPeopleId: integer("vendor_people_id"),
    clientSurface: text("client_surface").notNull(),
    inputMode: text("input_mode").notNull(),
    provider: text("provider").notNull(),
    conversationId: integer("conversation_id").references(() => assistantConversationsTable.id, { onDelete: "set null" }),
    assistantMessageId: integer("assistant_message_id").references(() => assistantMessagesTable.id, { onDelete: "set null" }),
    toolName: text("tool_name").notNull(),
    actionType: text("action_type").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    transcriptText: text("transcript_text"),
    parsedIntent: jsonb("parsed_intent"),
    toolInput: jsonb("tool_input"),
    toolOutput: jsonb("tool_output"),
    confidence: real("confidence"),
    confirmationPhrase: text("confirmation_phrase"),
    gpsLatitude: real("gps_latitude"),
    gpsLongitude: real("gps_longitude"),
    gpsAccuracyMeters: real("gps_accuracy_meters"),
    resultStatus: text("result_status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("assistant_action_audit_user_idx").on(t.userId, t.createdAt),
    byTool: index("assistant_action_audit_tool_idx").on(t.toolName, t.createdAt),
    byTarget: index("assistant_action_audit_target_idx").on(t.targetType, t.targetId, t.createdAt),
    byVendorTarget: index("assistant_action_audit_vendor_target_idx").on(t.vendorId, t.partnerId, t.targetType, t.targetId, t.id),
  }),
);

export type AssistantActionAudit = typeof assistantActionAuditTable.$inferSelect;
export type AssistantActionAuditInsert = typeof assistantActionAuditTable.$inferInsert;
