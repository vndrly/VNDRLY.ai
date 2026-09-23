CREATE TABLE IF NOT EXISTS "camera_gateways" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_location_id" integer NOT NULL REFERENCES "site_locations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "software_version" text,
  "playback_base_url" text,
  "last_seen_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "camera_gateways_site_name_unique" ON "camera_gateways" ("site_location_id", "name");
CREATE INDEX IF NOT EXISTS "camera_gateways_site_status_idx" ON "camera_gateways" ("site_location_id", "status");

CREATE TABLE IF NOT EXISTS "camera_credential_references" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gateway_id" uuid NOT NULL REFERENCES "camera_gateways"("id") ON DELETE CASCADE,
  "external_ref" text NOT NULL,
  "label" text NOT NULL,
  "scope" jsonb NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "camera_credential_refs_gateway_ref_unique" ON "camera_credential_references" ("gateway_id", "external_ref");

CREATE TABLE IF NOT EXISTS "camera_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gateway_id" uuid NOT NULL REFERENCES "camera_gateways"("id") ON DELETE CASCADE,
  "stable_key" text NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "manufacturer" text,
  "model" text,
  "adapter" text NOT NULL,
  "protocols" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "credential_reference_id" uuid REFERENCES "camera_credential_references"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'online' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "camera_devices_gateway_stable_key_unique" ON "camera_devices" ("gateway_id", "stable_key");
CREATE INDEX IF NOT EXISTS "camera_devices_gateway_status_idx" ON "camera_devices" ("gateway_id", "status");

CREATE TABLE IF NOT EXISTS "camera_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "device_id" uuid NOT NULL REFERENCES "camera_devices"("id") ON DELETE CASCADE,
  "stable_key" text NOT NULL,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "status" text DEFAULT 'online' NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "camera_channels_device_stable_key_unique" ON "camera_channels" ("device_id", "stable_key");

CREATE TABLE IF NOT EXISTS "camera_audit_log" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "site_location_id" integer NOT NULL REFERENCES "site_locations"("id") ON DELETE CASCADE,
  "actor_user_id" integer REFERENCES "users"("id"),
  "gateway_id" uuid REFERENCES "camera_gateways"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "camera_audit_log_site_created_idx" ON "camera_audit_log" ("site_location_id", "created_at");
