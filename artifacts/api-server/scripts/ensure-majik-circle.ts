#!/usr/bin/env tsx
/**
 * Idempotent bootstrap for the singleton Majik team circle (id=1).
 * Does not add members — use POST /api/admin/majik/members for that.
 */
import {
  MAJIK_DEFAULT_CIRCLE_ID,
  MAJIK_MAX_MEMBERS,
} from "@workspace/majik";
import { db, majikCirclesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  await db
    .insert(majikCirclesTable)
    .values({
      id: MAJIK_DEFAULT_CIRCLE_ID,
      name: "Majik",
      maxMembers: MAJIK_MAX_MEMBERS,
    })
    .onConflictDoNothing();

  const [circle] = await db
    .select()
    .from(majikCirclesTable)
    .where(eq(majikCirclesTable.id, MAJIK_DEFAULT_CIRCLE_ID));

  console.log(
    circle
      ? `Majik circle ready: id=${circle.id} name="${circle.name}" maxMembers=${circle.maxMembers}`
      : "Failed to ensure Majik circle",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
