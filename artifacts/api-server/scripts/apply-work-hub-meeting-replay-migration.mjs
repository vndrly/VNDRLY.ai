import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runWorkHubMeetingReplayMigration } from "../../../scripts/work-hub-meeting-replay-migration.mjs";
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl)
  throw new Error(
    "DATABASE_URL is required for the Work Hub meeting replay migration",
  );
const migrationPath = fileURLToPath(
  new URL(
    "../../../lib/db/drizzle/chunk_409_work_hub_meeting_replay.sql",
    import.meta.url,
  ),
);
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await runWorkHubMeetingReplayMigration(
    client,
    await readFile(migrationPath, "utf8"),
  );
  process.stdout.write("Work Hub meeting replay migration passed\n");
} finally {
  await client.end().catch(() => undefined);
}
