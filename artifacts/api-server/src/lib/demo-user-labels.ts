// Read/write helpers for the per-locale demo-account label overrides
// surfaced via `GET /api/auth/demo-users` and editable from the admin
// UI. The static defaults still live in `demo-users.ts` (and stay the
// source of truth used at seed time); this module just merges in the
// optional DB overrides so admins can tweak picker wording without a
// code deploy.

import { db, demoUserLabelOverridesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  DEMO_LOCALES,
  DEMO_USERS,
  type DemoLocale,
  type DemoUser,
} from "./demo-users";

/** A demo username we're willing to store overrides for. */
const VALID_USERNAMES: ReadonlySet<string> = new Set(
  DEMO_USERS.map((u) => u.username),
);

/** Locales we accept overrides for (matches the runtime resolver). */
const VALID_LOCALES: ReadonlySet<DemoLocale> = new Set(DEMO_LOCALES);

export interface DemoLabelEntry {
  username: string;
  /** Locale -> override label set in the DB. Missing locales are unset. */
  overrides: Partial<Record<DemoLocale, string>>;
  /** Locale -> baked-in default from source code (always populated). */
  defaults: Record<DemoLocale, string>;
  /** Convenience field mirroring `DemoUser.displayName`. */
  displayName: string;
  /** Convenience field mirroring `DemoUser.role`. */
  role: DemoUser["role"];
}

export function isValidDemoUsername(username: string): boolean {
  return VALID_USERNAMES.has(username);
}

export function isValidDemoLocale(locale: string): locale is DemoLocale {
  return VALID_LOCALES.has(locale as DemoLocale);
}

/** Pull every override row keyed by `username|locale`. */
async function loadOverrideMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      username: demoUserLabelOverridesTable.username,
      locale: demoUserLabelOverridesTable.locale,
      label: demoUserLabelOverridesTable.label,
    })
    .from(demoUserLabelOverridesTable);
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(`${r.username}|${r.locale}`, r.label);
  }
  return map;
}

/**
 * Resolve the display label for a demo user in `locale`. Order of
 * precedence: DB override (locale) -> source default (locale) ->
 * source default (en).
 */
export function resolveLabel(
  demo: DemoUser,
  locale: DemoLocale,
  overrides: Map<string, string>,
): string {
  const overrideKey = `${demo.username}|${locale}`;
  return (
    overrides.get(overrideKey) ??
    demo.labels[locale] ??
    demo.labels.en
  );
}

/**
 * Returns the demo accounts with each picker label resolved for the
 * given locale. Used by `GET /api/auth/demo-users` so the login screen
 * always sees overrides + defaults merged.
 */
export async function getLocalizedDemoLabels(
  locale: DemoLocale,
): Promise<Array<{
  username: string;
  password: string;
  label: string;
  role: DemoUser["role"];
}>> {
  const overrides = await loadOverrideMap();
  return DEMO_USERS.map((demo) => ({
    username: demo.username,
    password: demo.password,
    label: resolveLabel(demo, locale, overrides),
    role: demo.role,
  }));
}

/**
 * Returns one entry per demo account with its per-locale defaults and
 * any DB overrides spelled out separately. Powers the admin editor so
 * the UI can show "no override / falling back to <default>" hints.
 */
export async function listDemoLabelEntries(): Promise<DemoLabelEntry[]> {
  const overrides = await loadOverrideMap();
  return DEMO_USERS.map((demo) => {
    const entryOverrides: Partial<Record<DemoLocale, string>> = {};
    for (const loc of DEMO_LOCALES) {
      const v = overrides.get(`${demo.username}|${loc}`);
      if (v !== undefined) entryOverrides[loc] = v;
    }
    return {
      username: demo.username,
      displayName: demo.displayName,
      role: demo.role,
      defaults: { ...demo.labels },
      overrides: entryOverrides,
    };
  });
}

/**
 * Upsert an override for one (username, locale). Trims the label and
 * rejects empty strings — callers wanting to clear an override should
 * use `clearDemoLabelOverride` instead so the DB row is removed and
 * the source default takes over again.
 */
export async function upsertDemoLabelOverride(params: {
  username: string;
  locale: DemoLocale;
  label: string;
}): Promise<void> {
  const trimmed = params.label.trim();
  if (trimmed.length === 0) {
    throw new Error("label must not be empty");
  }
  await db
    .insert(demoUserLabelOverridesTable)
    .values({
      username: params.username,
      locale: params.locale,
      label: trimmed,
    })
    .onConflictDoUpdate({
      target: [
        demoUserLabelOverridesTable.username,
        demoUserLabelOverridesTable.locale,
      ],
      set: { label: trimmed, updatedAt: new Date() },
    });
}

/** Remove the override for a (username, locale) pair, falling back to source. */
export async function clearDemoLabelOverride(params: {
  username: string;
  locale: DemoLocale;
}): Promise<void> {
  await db
    .delete(demoUserLabelOverridesTable)
    .where(
      and(
        eq(demoUserLabelOverridesTable.username, params.username),
        eq(demoUserLabelOverridesTable.locale, params.locale),
      ),
    );
}
