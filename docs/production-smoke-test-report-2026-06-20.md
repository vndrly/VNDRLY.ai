# VNDRLY Production Smoke Test Report

**Date:** 2026-06-20 (evening session)  
**Target:** https://vndrly.ai (production API + static web; **not** localhost)  
**Tester:** Agent (automated API probes + HTTP web fetches; interactive browser MCP unavailable)

---

## 1. Executive summary

**Production core is healthy.** Health, auth, dashboard, tickets, sites, hotlist, notifications, safety metrics/events, invoices, analytics, and field-employee APIs all return **200** for the tested personas.

**One P0 production bug confirmed:** `/api/tickets/flagged` returns **400** (route shadowed by `GET /tickets/:id` — `"flagged"` parsed as ticket id → NaN). The **Flagged jobs** web page (`/flagged`) is broken against production API until a deploy includes the router-order fix applied locally.

**One P0 local/build bug fixed (not yet deployed):** Web `dashboard.tsx` was missing `HotlistSection` import — would **fail `pnpm run typecheck`** and break the next web deploy.

**Safety Phase 1 is partially live on production:** `GET /api/safety/metrics`, `/api/safety/events`, `/api/safety/training/status` work. **`/api/safety/capabilities` returns 404** on prod (local-only; needed for site reactivate UI).

**Web HTTP verification (subagent):** All tested routes return **200** with the Vite SPA shell (1544 B). Exxon login + `/api/dashboard/summary` JSON confirmed. Public `/visit/SITE-PB42EX01` loads. **Client-side modals, AskV, and post-hydration UI not exercised** — see `docs/_smoke-web-results.txt`.

**Browser UI walkthrough:** Interactive click-through still not completed (Cursor browser MCP unavailable). HTTP-level route + auth checks done; manual post-hydration pass recommended after dinner.

**iOS TestFlight build 79:** Mobile **typecheck passes**; device verification checklist included in §7.

**Overall readiness:** Safe for dinner review of **core ops** (tickets, sites, dashboard, hotlist, safety inbox API). **Do not ship** flagged-tickets fix or latest web bundle until deploy includes fixes in §5.

---

## 2. Production vs local gap

| Feature | Production (vndrly.ai) | Local repo |
|--------|------------------------|------------|
| Safety events/metrics/training status API | ✅ 200 | ✅ |
| Safety `/api/safety/capabilities` (HSE reactivate gate) | ❌ 404 | ✅ |
| Flagged tickets API | ❌ 400 (route bug) | ✅ fixed (router order) |
| Web safety pages `/safety`, `/safety-training` | Static SPA routes load; API-backed | ✅ |
| Web dashboard HotlistSection | Prod bundle OK (older deploy) | ❌ was broken in source; **fixed** |
| AskV 17 new data tools | Server-side if API deployed | ✅ code |
| Site reactivate UI (web site-locations) | Depends on capabilities 404 | ✅ code, needs deploy |
| iOS safety screens | Build 79 on TestFlight | ✅ typecheck clean |

---

## 3. Results matrix (API-verified on production)

Legend: ✅ 200 · ⚠️ wrong status · ❌ fail · 🔍 not tested · 🌐 SPA shell 200 (HTTP only, no hydration)

### Admin (`admin` / `vndrly123`)

| Surface | API | UI |
|---------|-----|-----|
| Login | ✅ | 🔍 |
| Dashboard summary | ✅ | 🔍 |
| Tickets list | ✅ | 🔍 |
| Site locations | ✅ | 🔍 |
| Notifications | ✅ | 🔍 |
| Hotlist jobs | ✅ | 🔍 |
| Safety metrics / events | ✅ | 🔍 |
| Safety training status | ✅ | 🔍 |
| Safety capabilities | ❌ 404 | 🔍 |
| Flagged tickets | ⚠️ 400 | 🔍 (likely empty/error UI) |
| Assistant conversations | ✅ | 🔍 |
| Admin pages | 🔍 | 🔍 |

### Partner (`exxon` / `exxon123`)

| Surface | API | UI |
|---------|-----|-----|
| Login | ✅ | 🌐 |
| Dashboard / tickets / sites | ✅ | 🌐 `/tickets`, `/site-locations` |
| Hotlist / notifications | ✅ | 🔍 |
| Safety metrics / events / training | ✅ | 🌐 `/safety` |
| Flagged tickets | ⚠️ 400 | 🔍 |
| Analytics `/api/analytics/partner/1` | ✅ | 🔍 |
| Reports | 🔍 | 🌐 `/reports` |
| Safety inbox `/safety` | ✅ API | 🌐 |

### Vendor (`baker` / `baker123`)

| Surface | API | UI |
|---------|-----|-----|
| Login | ✅ | 🔍 |
| Core lists (tickets, sites, dashboard) | ✅ | 🔍 |
| Invoices | ✅ | 🔍 |
| Safety | ✅ | 🔍 |
| Flagged tickets | ⚠️ 400 | 🔍 |

### Field employee (`joe.boggs@winchester.com` / `winchester2`)

| Surface | API | UI |
|---------|-----|-----|
| Login | ✅ | 🔍 (mobile / field portal) |
| `/api/field/open-tickets` | ✅ | 🔍 |
| `/api/field/me` | ✅ | 🔍 |
| `/api/safety/events` (my reports) | ✅ | 🔍 TestFlight 79 |
| `/api/tickets` | ✅ | 🔍 |

### Public

| Surface | Status |
|---------|--------|
| `/api/health` | ✅ 200 `{"status":"ok"}` |
| `/` / `/login` HTML | ✅ 200 🌐 |
| `/visit/SITE` | ✅ 200 🌐 (placeholder code) |
| `/visit/SITE-PB42EX01` | ✅ 200 🌐 (Permian Basin Well #42) |

---

## 4. Failures by severity

### P0 — Production broken today

| Issue | Evidence | Impact |
|-------|----------|--------|
| **Flagged tickets API shadowed** | `GET /api/tickets/flagged` → 400 validation `id: NaN` | `/flagged` page fails for admin/partner/vendor |
| **Web dashboard typecheck (local)** | Missing `HotlistSection` import | **Blocks next web deploy** until fixed |

### P1 — Deploy gap / partial features

| Issue | Evidence | Impact |
|-------|----------|--------|
| **`/api/safety/capabilities` 404 on prod** | 404 on exxon session | Site reactivate HSE gate UI won't work on prod until API deployed |
| **Post-hydration UI not smoke-tested** | Browser MCP unavailable; HTTP fetch only | Modals, AskV panel, client auth gates after JS load unverified |
| **Mobile locale orphans (26 keys)** | `noOrphanedKeys.test.ts` fails | CI/lint-i18n gate noise; pre-existing + safety keys cleaned partially |

### P2 — Polish / manual verification

| Issue | Notes |
|-------|-------|
| Safety ticket-detail pre-fill (iOS) | Not wired |
| Soft training banner (iOS Home) | API only on web dashboard |
| OpenAPI regen for safety | Not blocking runtime |
| `/api/tickets/events` SSE | Long-lived; not fully probed |

---

## 5. Fixes applied this session (local, uncommitted)

| File | Change |
|------|--------|
| `artifacts/vndrly/src/pages/dashboard.tsx` | Restored `import HotlistSection from "@/components/hotlist-section"` |
| `artifacts/api-server/src/routes/index.ts` | Mount `ticketFlagsRouter` **before** `ticketsRouter` so `/tickets/flagged` is not captured by `/tickets/:id` |
| `artifacts/vndrly-mobile/lib/locales/en.json` | Removed unused `safety.inboxTitle` / `inboxSubtitle` (web-only keys) |
| `artifacts/vndrly-mobile/lib/locales/es.json` | Same orphan cleanup |
| `scripts/smoke-prod-api.ps1` | Added reusable production API probe script |
| `docs/_smoke-api-results.txt` | Raw API probe output |
| `docs/_smoke-web-results.txt` | Raw HTTP web fetch output ([Web fetch production pages](38ae7134-05f7-4687-8dbf-dcb1d3d54dbd)) |

**Verification after fixes:**
- `pnpm run typecheck` (@workspace/vndrly) — **pass**
- `pnpm run typecheck` (@workspace/vndrly-mobile) — **pass**
- Production `/api/tickets/flagged` — **still 400 until deploy**

---

## 6. Remaining items needing your decision

1. **Deploy** flagged-router fix + web dashboard fix + safety capabilities endpoint to production?
2. **Manual browser pass** after dinner (§8) — SPA shells verified; modals/AskV still need click-through.
3. **Flagged page** — confirm expected behavior once fix is live (may legitimately return empty list).
4. **Mobile orphaned locale keys** (~26) — bulk remove or `ALLOWED_ORPHANS`?
5. **Commit** smoke-test fixes + safety work as a single release branch?

---

## 7. iOS TestFlight build 79 — manual verification checklist

Device login with canonical creds; verify on **production API** (`EXPO_PUBLIC_DOMAIN=vndrly.ai`):

- [ ] **Home** — ticket list loads; org switcher; notifications badge
- [ ] **Report safety issue** — form submit → success → appears in My reports
- [ ] **My safety reports** — list loads (`GET /api/safety/events`)
- [ ] **Safety event detail** — opens from list
- [ ] **AskV tab** — open chat, send message, header actions (transcript/delete if present)
- [ ] **Ticket detail** — open ticket, comments/comms tab, status actions
- [ ] **Notifications** — inbox + action modals
- [ ] **New ticket** — site picker; confirm inactive site shows `safety.site_inactive` if stop-work tested
- [ ] **Crew map / schedule / profile** — no crash on focus
- [ ] **Field employee (Joe)** — open tickets, GPS lifecycle buttons

---

## 8. Recommended post-dinner actions (15 min)

1. Deploy api-server with **ticketFlags router order** fix → retest `/flagged` in browser.
2. Click through **exxon** dashboard → tickets → site detail → safety inbox → AskV.
3. On iPhone TestFlight 79: run §7 checklist (5 critical paths minimum).
4. If all green, commit + tag release; if not, paste failing URL + screenshot to agent.

---

## Appendix: Raw API probe summary

See `docs/_smoke-api-results.txt` — 33 endpoint×persona rows, all **200** except `/api/tickets/flagged` (**400** all personas).

See `docs/_smoke-web-results.txt` — 8 unauthenticated + 3 authenticated URLs, all **200**; no real error-page content (only false-positive `500` in Google Fonts URL).

**Safety on production (confirmed live):**
```
admin/partner/vendor → GET /api/safety/metrics → 200
admin/partner/vendor → GET /api/safety/events?limit=5 → 200
exxon → GET /api/safety/training/status → 200
field → GET /api/safety/events?limit=3 → 200
```

**Not on production yet:**
```
GET /api/safety/capabilities → 404
```
