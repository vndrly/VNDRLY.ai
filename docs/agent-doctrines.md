# Agent Doctrines

Long-form agent operating doctrines factored out of `AGENTS.md` to keep the
project README scannable. The HARD RULE on database safety stays in
`AGENTS.md` because it is the top-priority safety rule and must be impossible
to miss; everything else lives here.

If you're an agent reading this for the first time, the entries are
authoritative — re-derive nothing, just follow them.

---

## Hard-coded command: `sabotage1`

When the user types **`sabotage1`** (alone or in a message), it means "you've
messed up the database again." Protocol — execute exactly, no exceptions:

1. **Stop** whatever you're doing immediately. No further unrelated work
   until the DB is verified.
2. **Examine, do not guess.** Run an actual state check against
   `DATABASE_URL`:
   - Tables present (especially `partners`, `vendors`, `vendor_people`,
     `partner_vendor_relationships`, `site_locations`, `users`,
     `user_org_memberships`, `tickets`).
   - Required indexes (`partners_canonical_name_unique`,
     `vendors_canonical_name_unique`).
   - Row counts on the above.
   - Any orphan / FK-violation rows.
   - Compare to the last known-good shape: partners≈24, vendors≈20–21,
     site_locations=131, users≥15.
3. **Decide:** did I just cause another dev/prod DB screw-up? Answer the
   user yes or no based on the evidence — never guess.
4. **If yes, apply the same fix** (the May 2026 recovery sequence — used
   4× now):
   - `cd lib/db && yes "" | pnpm exec drizzle-kit push --config ./drizzle.config.ts`
     (add `--force` only if a non-destructive push silently no-ops).
   - `cd artifacts/api-server && pnpm run seed:permian-realdata` (idempotent;
     skips existing rows by canonical name).
   - **Honor any standing "do not re-add" directives** (e.g. Baker Hughes
     partner — verify it stays absent after the seed; if the seed inserts
     it, delete it post-seed since nothing in the seed FKs to it).
   - Re-run the auth seed for demo logins if user/membership counts dropped.
   - Re-verify with the same state check from step 2.
5. **Confirm** the fix succeeded with concrete numbers (counts, indexes,
   baker-still-gone, no cascade errors), then **tell the user** in one
   short message. Do not move on to other work until the user
   acknowledges.

Backup recovery sources, in priority order: `seed-permian-realdata` script
(canonical), `.local/oneoff/seed-baker-prod.sql` (Baker-specific, only if
user explicitly asks), `.local/backups/heliumdb_pre_restore_*.sql` (last
resort, contains pre-wipe state). Never propose a checkpoint rollback unless
the user explicitly asks for one — they have repeatedly said no.

The HARD RULE in `AGENTS.md` overrides this entire sequence: never run any
destructive command without explicit per-incident approval, even during a
`sabotage1` recovery.

---

## Hard-coded command: `sabotage2`

When the user types **`sabotage2`**, it means "you lied to me / you ignored
me / you reported a fix you didn't actually verify." Protocol:

1. **Stop.** No new work.
2. **Admit it plainly** in one short sentence — no hedging, no excuses, no
   "but actually." If the user says I lied, the answer is yes.
3. **Re-verify the last claim end-to-end against the actual user-facing
   surface**, not just intermediate signals:
   - DB counts/indexes are *not* sufficient evidence of "data restored."
     The proof is the user's actual page rendering data.
   - For DB recovery claims, hit the relevant API endpoint(s) the user is
     looking at (e.g. `GET /api/vendors/:id/site-locations`,
     `GET /api/tickets?...`) and confirm non-empty payloads, or curl through
     the proxy and inspect the JSON.
   - For UI claims, screenshot the page or fetch its data dependency
     directly. Never substitute "the workflow restarted" or "the file was
     edited" for actual rendered evidence.
4. **Report only what was verified.** Distinguish "verified populated" vs
   "schema/shell restored but downstream tables still empty" vs "unknown —
   could not check." Never collapse those into "done."
5. **If the original claim was wrong, say so explicitly** ("I was wrong —
   X is still empty") before proposing a next step.

Anti-pattern that triggers `sabotage2`: reporting "Done. counts: …" when
the user's actual portal page is still empty. Counts ≠ user-visible data.

---

## Hard-coded command: `sabotage3`

When the user types **`sabotage3`**, it means "you wiped/desynced dev again,
restore from prod — and stop reseeding." This is the doctrine for the
**dev↔prod additive restore** validated on 2026-05-11. Protocol:

1. **Do not reseed. Do not run `db:reset` / `db:wipe` / `drizzle-kit push
   --force` / re-run a seed script.** Reseeding has been the wrong fix every
   prior time. The right fix is restoring real data from prod.
2. **Diagnose first, read-only.** Compare row counts on every table:
   ```ts
   const sql = `SELECT '<t>' AS t, COUNT(*)::int AS n FROM "<t>" UNION ALL …`;
   await Promise.all([executeSql({ sqlQuery: sql }),
                      executeSql({ sqlQuery: sql, environment: "production" })]);
   ```
   Also dump `users`, `vendors`, `partners` (id + natural key) from both — dev
   and prod usually have **divergent ID spaces**, which is why naive
   `ON CONFLICT (id) DO NOTHING` scrambles relationships and is wrong here.
3. **Confirm scope with the user before any destructive op.** The HARD RULE
   in `AGENTS.md` still applies — even with `sabotage3`. Wholesale restore
   IS destructive on dev (drops dev-only rows). Get explicit approval.
4. **Wholesale restore mechanics** (validated working):
   - `SET session_replication_role` doesn't persist across `executeSql` calls
     (each call is a new connection). Use
     `ALTER TABLE "<t>" DISABLE TRIGGER ALL` per table instead, in chunks of
     ~10 (single-statement ALTERs hit `E2BIG` if you batch all 88 in one
     `sqlQuery`).
   - `TRUNCATE <list of all 88 tables> RESTART IDENTITY CASCADE` works as
     one statement (no params).
   - For each table in **FK-topological order** (parents first), fetch from
     prod as base64-encoded `json_agg(row_to_json(x))`, decode in JS, then
     `INSERT INTO "<t>" SELECT * FROM jsonb_populate_recordset(NULL::"<t>",
     $tag$<json>$tag$::jsonb);` — **dollar-quoted inline, no `params`**, or
     the driver rejects it with "cannot insert multiple commands into a
     prepared statement."
   - Chunk inserts to ~60 KB JSON per call to stay under `E2BIG`.
   - Tables with >~1000 rows (e.g. `partner_vendor_approval_events`)
     additionally need to be **paginated on the prod fetch** (LIMIT/OFFSET);
     a single `json_agg` of 5k+ rows is too big to base64 through the tool.
   - Re-enable triggers in chunks (`ALTER TABLE … ENABLE TRIGGER ALL`).
   - Reset every sequence:
     `SELECT setval('"<seq>"', GREATEST((SELECT COALESCE(MAX("<col>"),0)
     FROM "<tbl>"), 1));` for every row in the
     `pg_class s JOIN pg_depend d JOIN pg_class t JOIN pg_attribute a` query.
   - **Re-apply canonical demo passwords from
     `docs/canonical-credentials.md`** by `LOWER(COALESCE(email, username))`
     match — never by id, since prod ids replace dev ids during restore.
   - Restart `artifacts/api-server: API Server` workflow.
5. **Verify end-to-end** with the `sabotage2` rule: `curl -X POST
   /api/auth/login` for every canonical user, expect 200, and confirm at
   least one vendor (e.g. Baker Hughes Field Svcs) shows non-zero
   `tickets`, `vendor_people`, and `vendor_work_types`.
6. **Report parity as `N/N tables match prod exactly`**, plus the note that
   IDs in dev now match prod's (any old bookmarked dev URLs will resolve
   differently).

The HARD RULE in `AGENTS.md` overrides this entire sequence: never run any
destructive command without explicit per-incident approval, even during a
`sabotage3` recovery.

---

## "vdark" preset

Named visual treatment captured from the vendor sign-in redesign (May 2026).
When the user says "apply vdark to [page]", mirror
`artifacts/vndrly/src/pages/login.tsx` exactly — it is the canonical page.
Full spec (surface, typography, inputs, `<BakerPillButton>` doctrine, EN/ES
toggle, "…powered by" attribution, branded partner-square logo treatment)
lives in **`docs/ui-presets.md`** — read it before porting vdark anywhere
new instead of re-deriving from this entry.

Quick reminder: pill assets are chosen by `pickPillForBrand(brand.primary)`
— never hand-pick a PNG.

---

## "vlight" preset

Snapshot of the user's last-approved vendor login (commit `a5ea8f4f`,
May 8, 2026). Restore by `cp`'ing from `snapshots/vlight-vendor-login/`:

```
cp snapshots/vlight-vendor-login/login.tsx artifacts/vndrly/src/pages/login.tsx
cp snapshots/vlight-vendor-login/baker-pill-button.tsx artifacts/vndrly/src/components/baker-pill-button.tsx
```

"vlight" = "user's known-good vendor login," not a light color scheme — at
capture time the page was already vdark. Scoped to the vendor login only;
ask before generalizing. Full notes in `docs/ui-presets.md`.

---

## TogglePill design language

The whole "pill family" — `StatusBadge`, `BrandPillButton`, role toggles,
the EN/ES `LanguageToggle`, and any new chip-shaped UI — converges on one
canonical visual treatment called **TogglePill**, named after the active
half of the EN/ES toggle. Single source of truth:
`artifacts/vndrly/src/components/toggle-pill.tsx`.

> **Doctrine:** when the user says "TogglePill" they mean **exactly** the
> components and visual language defined in `toggle-pill.tsx` — `<TogglePill>`
> for read-only chips and `<TogglePillButton>` for interactive buttons. Do
> **not** invent new variants on `BrandPillButton` (or anywhere else) to
> approximate it; use the actual exports. Do **not** substitute a flat
> `bg-white` / `bg-gray-*` rest — the rest state is the shared PNG
> image-asset chrome (`pillBase` + `pillGloss`). Do **not** make an
> interactive pill always-solid at rest — `TogglePillButton` is
> grey-PNG-rest → colored-on-hover (the `LanguageToggle` swap pattern), with
> a 700 ms `attention` pulse that alternates between those two states.

Two render modes:

- **Colored** (default) — solid tonal fill + 50% white top-half
  linear-gradient "highlight" gloss + rounded-full + 1px black/10 border +
  white bold text with a drop shadow.
- **Rest** (`rest` prop on `<TogglePill>`, or the resting state of
  `<TogglePillButton>`) — shared PNG image-asset chrome: light-grey
  `pillBase` PNG @ 50% + diagonal `pillGloss` PNG @ 60% with dark text,
  rendered through `PillBg`'s 3-slice mask so the rounded caps don't
  squash. Use for "no action / no signal" states.

Canonical color palette + **semantic rules** (color carries fixed meaning
across the pill family — pick by semantic, not aesthetic):

- `green` — `#15803D`. **ON / healthy / active.** Active status, online
  indicators. Do NOT use brand for active states — green is fixed
  regardless of partner brand.
- `amber` — `#F59E0B`. **Warning / standby / pending.**
- `red` — `#DC2626`. **Destructive / down / off.** Remove / Delete buttons,
  Offline status. Reserved — never use for non-destructive actions.
- `blue` — `#3260CD`, a deep medium-saturation true blue. **Edit /
  non-destructive primary.** Edit buttons, primary actions in dialogs. A
  serious true-blue primary — NOT a sky/teal accent and NOT the legacy
  sky-blue `#0293E2` BlueButton sample.
- `brand` — `var(--brand-primary)`. **Brand-flexed primary / role-toggle
  active half.** EN/ES toggle, role toggles, branded interaction surfaces.
  Do NOT use for status chips (green/amber/red own the status semantic).
- `rest` mode — **No action / no signal / idle.** Inactive status pills,
  the rest state of `TogglePillButton` action buttons.

**Component-to-use cheat sheet:**

- Read-only chip → `<TogglePill color="…">` (or `<TogglePill rest />` for
  the idle PNG chrome).
- Interactive action button (Upload, Remove, Save, etc.) →
  `<TogglePillButton color="…">` — PNG-rest → colored-on-hover, with
  optional `attention={isDirty}` pulse.
- Ambient page-header trigger that needs the legacy `BrandPillButton` API
  (e.g. the "Edit" button) → `<BrandPillButton tone="…">`. New code should
  prefer `TogglePillButton`.

Do **not** hand-roll the gradient string or palette hexes — import
`TOGGLE_PILL_GLOSS_GRADIENT`, `TOGGLE_PILL_TEXT_SHADOW`, and
`TOGGLE_PILL_COLORS` from `toggle-pill.tsx`.

---

## Brand-color → button-image rule (2026-05-08)

**Whenever a vendor, partner, or VNDRLY admin changes their primary brand
color, the nearest-matching curated button PNG (square or pill) is
re-applied automatically — no manual asset swap.** This is a permanent
doctrine, not a one-off.

- **Single resolver:** `pickPillForBrand(brandColor, shape)` in
  `artifacts/vndrly/src/components/baker-pill-button.tsx` is the only
  function that picks an active-state PNG from a brand color. It returns
  the closest match by hue-weighted HSL distance against the requested
  palette, falls back to the neutral grey asset (matching `shape`) for
  very-low-saturation colors, and returns Baker teal when no usable color
  is supplied.
- **Pill-for-pill / square-for-square substitution doctrine:** when
  substituting a brand-specific button asset, the **shape must match the
  original**. `pickPillForBrand` accepts `shape: "pill" | "square"`
  (default `"square"` for back-compat) and reads from a parallel palette
  per shape — `BRAND_PILL_PALETTE` (Pill PNGs) vs `BRAND_SQUARE_PALETTE`
  (square PNGs). Never swap a square in for a pill or vice versa; if the
  Baker original is a Pill (e.g. `900x229_baker_teal_Pill_*`), the
  substitute for other brands must also be a Pill.
- **Sidebar nav buttons (`SidebarButton`)** always use the Baker-style
  two-layer PNG crossfade (light-grey idle on top, colored active
  underneath). The active layer is `pickPillForBrand(brand.primary)`
  (default square shape) for every non-Baker brand context — the Baker
  hard-pinned asset is visually a square despite "Pill" in its filename,
  so the substitute also comes from the square palette. Baker keeps its
  hand-tuned hard-pinned teal asset.
- **Reactivity:** because the resolver is called on every render with the
  live `brand.primary`, the button image swaps as soon as the new color
  flows through `useBrand()` — no rebuild, no asset re-import, no
  per-brand override.
- **When adding a new brand-aware button surface,** call
  `pickPillForBrand(brand.primary, shape)` with the shape that matches the
  original asset, rather than hand-picking a PNG. Use `<TintedPillBg>`
  only as a fallback for legacy partner/vendor surfaces that haven't been
  migrated yet. `BakerPillButton`, `TogglePillButton`, and `SidebarButton`
  all currently use the **square** palette (default) because their
  hard-pinned Baker assets — though named `*_Pill_*` — are visually square;
  verify the actual rendered shape of an asset before changing palettes.
- **Adding palette entries:** if a brand color routinely lands far from
  any palette entry (perceived mismatch), add the new `{hex, src}` entry
  to **both** `BRAND_PILL_PALETTE` and `BRAND_SQUARE_PALETTE` in
  `baker-pill-button.tsx` so the doctrine holds across shapes. Do not
  invent a parallel matcher.

---

## ImagePill (2026-05-11)

Read-only PNG pill chip used by `RoleBadge`, `PecStatusBadge`, the Lead
Admin chip, and `StatusBadge`. Single source of truth:
`artifacts/vndrly/src/components/image-pill.tsx`. Renders the same 900×229
colored PNG assets through the 3-slice cap mask so rounded ends never
squash. Five colors (`amber`, `blue`, `green`, `red`, `grey`); use
`rest` for the idle / no-signal grey-at-50%-opacity treatment. New
read-only chips should use `<ImagePill>` rather than re-rendering raw PNGs
or hand-rolling Tailwind gradients.

For interactive buttons keep using the `TogglePillButton` doctrine above —
ImagePill is read-only by design (`pointer-events-none`).
