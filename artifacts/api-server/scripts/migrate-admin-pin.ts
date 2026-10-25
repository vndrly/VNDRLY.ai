import { pool } from "@workspace/db";
import { ADMIN_PIN_SCHEMA } from "../src/lib/admin-pin";
pool.query(ADMIN_PIN_SCHEMA).then(() => console.log("Admin PIN additive migration complete"))
  .catch(() => { console.error("Admin PIN migration failed"); process.exitCode = 1; }).finally(() => pool.end());
