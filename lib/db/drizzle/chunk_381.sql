CREATE TABLE IF NOT EXISTS "vendor_crew_presets" (
  "id" serial PRIMARY KEY NOT NULL,
  "vendor_id" integer NOT NULL,
  "name" text NOT NULL,
  "member_employee_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by_user_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "vendor_crew_presets"
    ADD CONSTRAINT "vendor_crew_presets_vendor_id_vendors_id_fk"
    FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "vendor_crew_presets"
    ADD CONSTRAINT "vendor_crew_presets_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "vendor_crew_presets_vendor_id_idx" ON "vendor_crew_presets" USING btree ("vendor_id");
