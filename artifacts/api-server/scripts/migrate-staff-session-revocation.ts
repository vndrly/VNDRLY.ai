import { pool } from "@workspace/db";
import { STAFF_SESSION_REVOCATION_SCHEMA } from "../src/lib/staff-session-revocation";

pool.query(STAFF_SESSION_REVOCATION_SCHEMA).then(() => {
  console.log("Staff session revocation additive migration complete");
}).catch(() => {
  console.error("Staff session revocation migration failed");
  process.exitCode = 1;
}).finally(() => pool.end());
