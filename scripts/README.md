# `@workspace/scripts`

One-shot maintenance scripts that run against the VNDRLY operational
database. Each script is idempotent unless noted otherwise.

```sh
pnpm --filter @workspace/scripts run <script>
```

## audit:1099-overrides — clean up stale `default_income_category_overrides`

```sh
# Report only (no writes)
pnpm --filter @workspace/scripts run audit:1099-overrides

# Drop only the offending entries from each map (keeps still-valid ones)
pnpm --filter @workspace/scripts run audit:1099-overrides -- --clean

# Wipe the whole column for affected rows
pnpm --filter @workspace/scripts run audit:1099-overrides -- --clear-all

# Skip the interactive y/N prompt (CI / cron)
pnpm --filter @workspace/scripts run audit:1099-overrides -- --clean --yes
```

`vendor_partner_billing_settings.default_income_category_overrides` is
a JSON map from invoice line-type → 1099 income category that the
invoice generator consults for every freshly-emitted line. Task #408
made the API reject invalid keys/values on write, but rows persisted
*before* that protection landed (e.g. left over from a renamed or
removed enum value) are still in the database and would silently flow
into every regenerated invoice line.

This script joins each settings row to its vendor + partner names,
flags any entry whose key is not in `INVOICE_LINE_TYPES` or whose
value is not in `INVOICE_LINE_INCOME_CATEGORIES`, and (optionally)
clears them.

**Run it after** any change to those two tuples in
`lib/db/src/schema/invoiceLines.ts` — renames, removals, splits.
Also safe to run at any time as a periodic audit; with no flags it is
strictly read-only.

## seed:demo-phase2 — reset the demo accounts and unschedule sample tickets

See `src/seed-demo-phase2.ts` for what gets reset. Refuses to run in
production unless `ALLOW_DEMO_SEED=true`.

## backfill:object-acls — stamp public ACL on legacy private objects

See the script header in `src/backfill-object-acls.ts` for context.
Walks every column that may reference a private object-storage entity
and stamps a `{visibility: "public"}` ACL where one is missing.

## lint:i18n — verify Spanish locale parity (Task #139)

```sh
# Run from the repo root (recommended, used by CI):
pnpm lint:i18n

# Or directly:
pnpm --filter @workspace/scripts run lint:i18n
```

Walks the hand-maintained `en.json` / `es.json` files for each artifact
that ships translations:

- `artifacts/vndrly-mobile/lib/locales/{en,es}.json`
- `artifacts/vndrly/src/lib/locales/{en,es}.json`

For each artifact it reports:

- keys present in `en.json` but missing from `es.json`
- keys present in `es.json` but missing from `en.json`
- empty `""` translation values on either side
- shape mismatches where the same dotted path is a string in one
  locale and an object in the other (silently breaks i18next lookups)

Exits non-zero on any mismatch so it can gate CI. Per-artifact unit
tests (`parity.test.ts`, `placeholderParity.test.ts`,
`noOrphanedKeys.test.ts`) cover the same parity rules plus richer
checks like placeholder consistency and orphaned-key detection — this
script is the fast, cross-artifact summary intended for CI pre-checks
and local edits to the JSON files.

## hello — connectivity smoke test

`pnpm --filter @workspace/scripts run hello` — confirms the script
runner can reach the database. Useful as a first check after pulling
the repo.
