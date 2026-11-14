import { guardAdditiveReplay } from "../../../scripts/guard-additive-replay.mjs";
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(
    guardAdditiveReplay(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS account_deletion_request jsonb",
    ),
  );
  console.log("Account deletion request storage ready. No accounts changed.");
} finally {
  await client.end();
}
