# Majik

**Majik** is a standalone Windows desktop widget (Tauri) for the VNDRLY workgroup.
Each team member clicks **I'm Up** when they are at their desk; everyone else sees
live presence without phone calls.

This feature is **not** part of the VNDRLY web app or mobile app.

## Architecture

| Piece | Location |
|-------|----------|
| Desktop widget | `artifacts/majik-desktop/` |
| Shared constants + stale logic | `lib/majik/` |
| DB tables | `lib/db/src/schema/majik.ts` |
| REST + SSE API | `artifacts/api-server/src/routes/majik.ts` |
| Realtime bus | `artifacts/api-server/src/lib/majik-events.ts` |

## Rules

- **One team** (circle id `1`), **max 8 members**
- **Auth:** valid VNDRLY session cookie (`POST /api/auth/login`)
- **Stale:** `is_up` older than **4 hours** is treated as not reliably up (`state: stale`)
- Members only — non-members get `403 majik.not_member`

## Database setup

Push the new tables to Supabase (same as other schema changes):

```bash
pnpm --filter @workspace/db run push
```

Seed the singleton circle (idempotent):

```bash
pnpm --filter @workspace/api-server exec tsx scripts/ensure-majik-circle.ts
```

Add team members (admin session required):

```bash
curl -X POST http://localhost:8080/api/admin/majik/members \
  -H "Cookie: vndrly_session=..." \
  -H "Content-Type: application/json" \
  -d '{"userId": 1}'
```

Or use `GET /api/admin/majik/candidates?q=john` to find user ids.

## API (member)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/majik/me` | Membership check for logged-in user |
| GET | `/api/majik/circle` | Team roster + presence snapshot |
| POST | `/api/majik/up` | Mark yourself up |
| POST | `/api/majik/down` | Mark yourself down |
| GET | `/api/majik/events` | SSE presence stream |

## Desktop dev

Prerequisites: **Rust**, **Node 24**, **pnpm**, Windows SDK (for Tauri).

1. Start API + DB as usual (`pnpm dev:local` or existing workflow).
2. Copy env example and point at your API:

   ```bash
   cp artifacts/majik-desktop/.env.example artifacts/majik-desktop/.env
   ```

3. Install + run:

   ```bash
   pnpm install
   pnpm --filter @workspace/majik-desktop run tauri dev
   ```

Build installer:

```bash
pnpm --filter @workspace/majik-desktop run tauri build
```

## Widget sizing

Window height scales with roster size (see `majikWidgetHeightPx` in `@workspace/majik`):

- 1–4 members → ~200px body
- 5–6 → ~260px
- 7–8 → ~320px

Width stays ~280px.
