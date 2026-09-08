CREATE TABLE IF NOT EXISTS "work_hub_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_org_type" text NOT NULL, "owner_org_id" integer NOT NULL,
  "context_kind" text NOT NULL, "context_id" text NOT NULL, "name" text NOT NULL, "status" text NOT NULL DEFAULT 'active',
  "created_by_id" integer NOT NULL REFERENCES "users"("id"), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_channels_context_unique" ON "work_hub_channels" ("owner_org_type", "owner_org_id", "context_kind", "context_id");
CREATE INDEX IF NOT EXISTS "work_hub_channels_owner_idx" ON "work_hub_channels" ("owner_org_type", "owner_org_id", "updated_at");
CREATE TABLE IF NOT EXISTS "work_hub_channel_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "channel_id" uuid NOT NULL REFERENCES "work_hub_channels"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE, "mode" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_channel_members_unique" ON "work_hub_channel_members" ("channel_id", "user_id");
CREATE TABLE IF NOT EXISTS "work_hub_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "channel_id" uuid NOT NULL REFERENCES "work_hub_channels"("id") ON DELETE CASCADE,
  "root_message_id" uuid REFERENCES "work_hub_messages"("id"), "parent_message_id" uuid REFERENCES "work_hub_messages"("id"),
  "author_user_id" integer NOT NULL REFERENCES "users"("id"), "kind" text NOT NULL DEFAULT 'text', "body" text NOT NULL DEFAULT '',
  "version" integer NOT NULL DEFAULT 1, "client_operation_id" uuid NOT NULL, "edited_at" timestamptz, "deleted_at" timestamptz,
  "deleted_by_id" integer REFERENCES "users"("id"), "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "work_hub_messages_channel_cursor_idx" ON "work_hub_messages" ("channel_id", "created_at", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_messages_author_operation_unique" ON "work_hub_messages" ("author_user_id", "client_operation_id");
CREATE TABLE IF NOT EXISTS "work_hub_message_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "message_id" uuid NOT NULL REFERENCES "work_hub_messages"("id") ON DELETE CASCADE,
  "version" integer NOT NULL, "body" text NOT NULL, "editor_user_id" integer NOT NULL REFERENCES "users"("id"), "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_message_versions_unique" ON "work_hub_message_versions" ("message_id", "version");
CREATE TABLE IF NOT EXISTS "work_hub_mentions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "message_id" uuid NOT NULL REFERENCES "work_hub_messages"("id") ON DELETE CASCADE,
  "mentioned_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_mentions_unique" ON "work_hub_mentions" ("message_id", "mentioned_user_id");
CREATE TABLE IF NOT EXISTS "work_hub_reactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "message_id" uuid NOT NULL REFERENCES "work_hub_messages"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE, "emoji" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_reactions_unique" ON "work_hub_reactions" ("message_id", "user_id", "emoji");
CREATE TABLE IF NOT EXISTS "work_hub_read_cursors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "channel_id" uuid NOT NULL REFERENCES "work_hub_channels"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE, "last_message_id" uuid REFERENCES "work_hub_messages"("id"), "seen_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_read_cursors_unique" ON "work_hub_read_cursors" ("channel_id", "user_id");
CREATE TABLE IF NOT EXISTS "work_hub_message_metadata" (
  "message_id" uuid PRIMARY KEY REFERENCES "work_hub_messages"("id") ON DELETE CASCADE, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS "work_hub_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_org_type" text NOT NULL, "owner_org_id" integer NOT NULL,
  "channel_id" uuid REFERENCES "work_hub_channels"("id") ON DELETE CASCADE, "uploaded_by_id" integer NOT NULL REFERENCES "users"("id"),
  "storage_key" text NOT NULL UNIQUE, "file_name" text NOT NULL, "content_type" text NOT NULL, "byte_size" integer NOT NULL,
  "checksum_sha256" text NOT NULL, "state" text NOT NULL DEFAULT 'reserved', "retention_class" text NOT NULL DEFAULT 'standard',
  "media_metadata" jsonb, "expires_at" timestamptz, "finalized_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "work_hub_files_owner_idx" ON "work_hub_files" ("owner_org_type", "owner_org_id", "created_at");
CREATE TABLE IF NOT EXISTS "work_hub_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "channel_id" uuid NOT NULL REFERENCES "work_hub_channels"("id") ON DELETE CASCADE,
  "title" text NOT NULL, "body" text NOT NULL DEFAULT '', "version" integer NOT NULL DEFAULT 1,
  "created_by_id" integer NOT NULL REFERENCES "users"("id"), "updated_by_id" integer NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "work_hub_notes_channel_idx" ON "work_hub_notes" ("channel_id", "updated_at");
CREATE TABLE IF NOT EXISTS "work_hub_note_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "note_id" uuid NOT NULL REFERENCES "work_hub_notes"("id") ON DELETE CASCADE,
  "version" integer NOT NULL, "title" text NOT NULL, "body" text NOT NULL, "editor_user_id" integer NOT NULL REFERENCES "users"("id"), "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_note_versions_unique" ON "work_hub_note_versions" ("note_id", "version");
CREATE TABLE IF NOT EXISTS "work_hub_client_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "command_kind" text NOT NULL, "operation_id" uuid NOT NULL, "owner_org_type" text NOT NULL, "owner_org_id" integer NOT NULL,
  "result_json" jsonb, "applied_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_client_operations_unique" ON "work_hub_client_operations" ("user_id", "command_kind", "operation_id");
CREATE TABLE IF NOT EXISTS "work_hub_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "actor_user_id" integer REFERENCES "users"("id"), "owner_org_type" text NOT NULL,
  "owner_org_id" integer NOT NULL, "action" text NOT NULL, "subject_type" text NOT NULL, "subject_id" text NOT NULL,
  "prior_version" integer, "new_version" integer, "source" text NOT NULL, "operation_id" uuid, "metadata" jsonb, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "work_hub_audit_owner_cursor_idx" ON "work_hub_audit_log" ("owner_org_type", "owner_org_id", "created_at", "id");
CREATE TABLE IF NOT EXISTS "work_hub_retention_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_org_type" text NOT NULL, "owner_org_id" integer NOT NULL,
  "policy_version" integer NOT NULL DEFAULT 1, "rules" jsonb NOT NULL, "created_by_id" integer NOT NULL REFERENCES "users"("id"), "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_retention_policy_unique" ON "work_hub_retention_policies" ("owner_org_type", "owner_org_id", "policy_version");
CREATE TABLE IF NOT EXISTS "work_hub_legal_holds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_org_type" text NOT NULL, "owner_org_id" integer NOT NULL,
  "subject_type" text NOT NULL, "subject_id" text NOT NULL, "reason" text NOT NULL, "active" boolean NOT NULL DEFAULT true,
  "created_by_id" integer NOT NULL REFERENCES "users"("id"), "released_by_id" integer REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(), "released_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "work_hub_legal_holds_subject_idx" ON "work_hub_legal_holds" ("owner_org_type", "owner_org_id", "subject_type", "subject_id");
