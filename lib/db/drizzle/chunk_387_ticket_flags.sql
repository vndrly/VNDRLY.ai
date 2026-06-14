CREATE TABLE IF NOT EXISTS "ticket_flags" (
  "id" serial PRIMARY KEY NOT NULL,
  "ticket_id" integer NOT NULL REFERENCES "tickets"("id") ON DELETE cascade,
  "flagged_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "actor_role" text NOT NULL,
  "reason" text,
  "cleared_at" timestamp with time zone,
  "cleared_by_user_id" integer REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ticket_flags_ticket_active_idx" ON "ticket_flags" ("ticket_id", "cleared_at");
