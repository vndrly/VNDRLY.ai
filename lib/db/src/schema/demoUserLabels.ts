import {
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-locale display label overrides for the demo accounts surfaced by
// `GET /api/auth/demo-users`. The canonical demo-user list still lives
// in source (`artifacts/api-server/src/lib/demo-users.ts`) so seeding
// stays self-contained, but the human-readable picker label for each
// (username, locale) pair is now overridable from the admin UI without
// a code deploy. A row here for ("admin", "es") wins over the static
// `labels.es` value; missing rows fall back to the source-of-truth
// label, then to the English label.
export const demoUserLabelOverridesTable = pgTable(
  "demo_user_label_overrides",
  {
    id: serial("id").primaryKey(),
    /** Demo account username (matches `DEMO_USERS[].username` in source). */
    username: text("username").notNull(),
    /** BCP-47-ish base locale, e.g. "en" or "es". */
    locale: text("locale").notNull(),
    /** Display label shown in the demo-account picker. */
    label: text("label").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqByUsernameLocale: uniqueIndex(
      "demo_user_label_overrides_username_locale_unique",
    ).on(t.username, t.locale),
  }),
);

export const insertDemoUserLabelOverrideSchema = createInsertSchema(
  demoUserLabelOverridesTable,
).omit({ id: true, updatedAt: true });
export type InsertDemoUserLabelOverride = z.infer<
  typeof insertDemoUserLabelOverrideSchema
>;
export type DemoUserLabelOverride =
  typeof demoUserLabelOverridesTable.$inferSelect;
