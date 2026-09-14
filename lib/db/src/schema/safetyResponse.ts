import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { safetyEventsTable } from "./safetyEvents";
import { usersTable } from "./users";

export const safetyEscalationChainsTable = pgTable(
  "safety_escalation_chains",
  {
    id: serial("id").primaryKey(),
    ownerType: text("owner_type").notNull(),
    ownerId: integer("owner_id").notNull(),
    name: text("name").notNull().default("Primary safety chain"),
    responderUserIds: integer("responder_user_ids").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ ownerActiveIdx: index("safety_escalation_chains_owner_active_idx").on(t.ownerType, t.ownerId, t.isActive) }),
);

export const safetyIncidentResponsesTable = pgTable(
  "safety_incident_responses",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull().references(() => safetyEventsTable.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("manual"),
    severity: text("severity").notNull().default("medium"),
    responseStatus: text("response_status").notNull().default("open"),
    originalReport: text("original_report").notNull(),
    responseDeadlineAt: timestamp("response_deadline_at", { withTimezone: true }),
    degradedCapabilities: text("degraded_capabilities").array().notNull().default([]),
    safetyChainSnapshot: integer("safety_chain_snapshot").array().notNull().default([]),
    configurationWarning: text("configuration_warning"),
    assignedResponderUserId: integer("assigned_responder_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByUserId: integer("acknowledged_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByUserId: integer("closed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ eventUnique: uniqueIndex("safety_incident_responses_event_unique").on(t.eventId), statusIdx: index("safety_incident_responses_status_idx").on(t.responseStatus, t.responseDeadlineAt) }),
);

export const safetyIncidentDeliveriesTable = pgTable(
  "safety_incident_deliveries",
  {
    id: serial("id").primaryKey(),
    responseId: integer("response_id").notNull().references(() => safetyIncidentResponsesTable.id, { onDelete: "cascade" }),
    recipientUserId: integer("recipient_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("pending"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ responseRecipientIdx: index("safety_incident_deliveries_response_recipient_idx").on(t.responseId, t.recipientUserId) }),
);

export const safetyIncidentEvidenceTable = pgTable("safety_incident_evidence", {
  id: serial("id").primaryKey(),
  responseId: integer("response_id").notNull().references(() => safetyIncidentResponsesTable.id, { onDelete: "cascade" }),
  actorUserId: integer("actor_user_id").notNull().references(() => usersTable.id),
  kind: text("kind").notNull(),
  value: text("value").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const safetyEvidenceHoldsTable = pgTable(
  "safety_evidence_holds",
  {
    id: serial("id").primaryKey(),
    responseId: integer("response_id").notNull().references(() => safetyIncidentResponsesTable.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    placedByUserId: integer("placed_by_user_id").notNull().references(() => usersTable.id),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    releasedByUserId: integer("released_by_user_id").references(() => usersTable.id),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => ({ activeHoldIdx: index("safety_evidence_holds_active_idx").on(t.responseId, t.releasedAt) }),
);
