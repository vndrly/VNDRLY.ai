-- Partner-scoped work types + hotlist work_type_id linkage
ALTER TABLE "work_types" ADD COLUMN IF NOT EXISTS "partner_id" integer;
DO $$ BEGIN
  ALTER TABLE "work_types" ADD CONSTRAINT "work_types_partner_id_partners_id_fk"
    FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DROP INDEX IF EXISTS "work_types_canonical_name_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "work_types_global_canonical_name_unique"
  ON "work_types" (lower(btrim("name"))) WHERE "partner_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "work_types_partner_canonical_name_unique"
  ON "work_types" ("partner_id", lower(btrim("name"))) WHERE "partner_id" IS NOT NULL;
ALTER TABLE "hotlist_jobs" ADD COLUMN IF NOT EXISTS "work_type_id" integer;
DO $$ BEGIN
  ALTER TABLE "hotlist_jobs" ADD CONSTRAINT "hotlist_jobs_work_type_id_work_types_id_fk"
    FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
