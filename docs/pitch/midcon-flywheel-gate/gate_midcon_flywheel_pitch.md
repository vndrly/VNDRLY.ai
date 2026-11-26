# VNDRLY Gate — Commercial Pitch Package  
**Audience:** MidCon Solutions (vendor) → Flywheel Energy (partner) only  
**Brand on screen:** VNDRLY · **Voiceover / spoken:** “vendorly”  
**Capture date:** 2026-08-28 · Live prod: `https://vndrly.ai/gate`  
**Asset folder:** `/opt/cursor/artifacts/gate_pitch/`

---

## 1. What Gate is (accurate)

**VNDRLY Gate** is the visitor / vehicle access booth for field sites inside the VNDRLY multi-tenant platform.

- **Who staffs it:** Vendor users with role `gatekeeper` (booth tablet / phone). MidCon’s booth login lands directly on `/gate`.
- **Whose site:** Partner-hosted locations. Demo truth: MidCon Gate defaults to **Flywheel Energy Spur** with host **Flywheel Energy (partner)**.
- **What it records:** Plate (optional state), visitor name, company, purpose, notes in/out, expected duration, GPS check-in coords, photos, admission status, dwell / overdue, check-out.
- **Who watches live:** Partner and vendor **office** roles get **Gate Log** (`/gate-log`) — live traffic, 30-day history, staff hours, analytics. Booth gatekeepers do **not** get the ops bundle (by design).
- **Self-serve path:** Guests use **Continue as Visitor** → guest session → site-by-**name** check-in → **pending admit** for booth confirmation.
- **Not:** A standalone gate product. Gate rides the same partner ↔ vendor tenancy, branding, Ask V, EN/ES, and web + iOS surfaces as the rest of VNDRLY.

Pronunciation always: **vendorly**. On-screen logo/wordmark stays **VNDRLY**.

---

## 2. Major selling points (exhaustive, prioritized)

Grounded in shipped booth overhaul + live MidCon/Flywheel demo data.

### P0 — Must say in any MidCon → Flywheel pitch

1. **Built for this exact relationship**  
   MidCon Solutions brands the booth; Flywheel Energy owns the pad. Live UI already shows MidCon logo + “Flywheel Energy Spur” + host “Flywheel Energy (partner).” History already has MidCon traffic at Spur.

2. **Plate-first booth, not paperwork-first**  
   Vehicle plate is the lead field. **Read plate** camera OCR fills plate (and state when confidence is high). State is **optional** — specialty / dirty / no-state plates still check in.

3. **Human site names, never SITE- codes in the booth**  
   Operators pick **Flywheel Energy Spur** (name + distance). Site codes stay internal for APIs/QR. Removes the “what does SITE-B40D77D2 mean?” failure at the window.

4. **GPS geofence in miles — check-in won’t submit off-pad**  
   Shared `@workspace/gate-booth` fence logic: lock GPS, compute miles to site, compare to site radius (~1 mile / 1609 m on Spur in prod). Button stays disabled until inside fence. Status copy shows searching / denied / too far / inside.

5. **Tap-to-talk voice entry**  
   Sidebar **Voice entry** + Ask V transcription. Spoken plate/name/company/purpose/notes/duration → confirm check-in or check-out. Hands-free booth rhythm for MidCon gate staff.

6. **Visitor self check-in by site name + pending admit**  
   Guest session path: visitor picks site by name → check-in lands as **pending** → MidCon booth **Admit**. Partner keeps control; MidCon keeps throughput.

7. **Partner live Gate Log**  
   Flywheel admin sees on-site count, overdue, avg dwell, unique plates/visitors, live log, searchable history, gate staff hours (MidCon booth operators). Same visit MidCon just logged.

8. **Audit exports: PDF / Excel / Word**  
   Gate history one-tap exports for compliance, AFE conversations, and month-end packets — not screenshots of a clipboard.

### P1 — Differentiating product truth

9. **Memory of plates / names / companies**  
   Typing plate, name, or company surfaces prior visits; autofill returning trucks; suggest **other company drivers** when the truck’s last driver isn’t today’s driver.

10. **Visit notes in and out**  
    Booth notes at check-in; check-out notes field on active visits. Optional, capped, persisted.

11. **Duration chips + dwell / overdue**  
    30m / 2h / All day / Overnight (or custom minutes). On-site list shows minutes on site and overdue when past expected duration.

12. **Plate + vehicle photo evidence**  
    Staffed and visitor flows can attach plate/vehicle photos; OCR rate-limited server-side.

13. **Dedicated gatekeeper role (least privilege)**  
    Booth operators get Gate + History — not full vendor office. Office/partner get Gate Log. Clean separation MidCon can staff without oversharing Flywheel ops.

14. **EN / ES booth localization**  
    Same Gate chrome switches language for bilingual Permian / Mid-Con crews.

15. **Permissions-Policy for camera, mic, geo**  
    Live nginx: `camera=(self), microphone=(self), geolocation=(self)` — browsers allow the booth capabilities Gate needs.

16. **Web + iOS**  
    Web booth at `/gate`; mobile Gate tab with same plate-first / voice / fence contract. Recent iOS OTA path for Gate JS updates without App Store wait.

17. **Ask V on the Gate chrome**  
    Booth keeps Ask V available for field questions without leaving the tablet workflow.

18. **Auto check-out + expires**  
    Expected duration drives expiry / auto check-out signals visible in partner analytics (“Auto check-out” metric on Gate Log).

19. **Live connection pill / flash on new visits**  
    Booth “On site now” stays live; partner Gate Log shows **Live** badge — not a stale spreadsheet.

20. **Multi-tenant branding**  
    MidCon teal booth chrome; Flywheel partner portal chrome; Ask V MidCon/Flywheel mark variants in product assets.

### P2 — Supporting / trust

21. Guest session isolation (visitors can’t hit staff lists / ops).  
22. Host type partner vs vendor on visits.  
23. Composite plate matching when state known (`TX · ABC1234` display).  
24. Spoken plate-state parsing (e.g. “Texas…”).  
25. Preferred / national plate-state ranking for OCR suggestions.  
26. Gate ops access policy (admin/partner/vendor-office only).  
27. Assigned sites for gatekeepers (MidCon only sees sites they’re staffed for).  
28. SOC2 / audit-trail posture of the wider VNDRLY platform (Gate is on the same rails).

---

## 3. Suggested commercial narrative (beat sheet)

**Length target:** ~60–90s cut for Flywheel review; expandable to 2:00 with B-roll.  
**VO always says “vendorly.”** On-screen supers can show **VNDRLY**.

| Beat | Visual | Floating text | VO (says “vendorly”) |
|------|--------|---------------|----------------------|
| **1. Cold open** | Oilfield B-roll: trucks at Spur / crew in hard hats. Tablet wakes with MidCon logo. | `MidCon Solutions × Flywheel Energy` | “Out on a Flywheel pad, trucks stack at the gate.” |
| **2. Problem** | Clipboard / radio chatter / unclear who’s on site (stylized, not fake UI). | `Who’s on the pad?` | “Paper logs. Radio calls. Nobody’s sure who’s still on location.” |
| **3. Brand** | VNDRLY mark + Gate login (oilfield hero). | `VNDRLY Gate` | “MidCon runs the booth on vendorly Gate.” |
| **4. Plate-first** | Booth form: Read plate → OCR. Optional state. | `Plate-first · Optional state` | “One tap. Vendorly reads the plate — state when it can, skip it when it can’t.” |
| **5. Site by name** | Dropdown: **Flywheel Energy Spur**. Host: Flywheel Energy. | `No site codes at the window` | “The site is Flywheel Energy Spur — by name. Not a code.” |
| **6. Voice** | Voice entry mic. Confirm card. | `Tap to talk` | “Or say the plate and the name. Confirm. Done.” |
| **7. Fence** | GPS status / miles / disabled Check in until inside. | `Inside the fence` | “Check-in only locks when GPS is inside the fence.” |
| **8. Self check-in** | Visitor: Select Site of Visit by name. | `Visitor by site name` | “Visitors check themselves in by site name. MidCon admits them at the booth.” |
| **9. Partner view** | Flywheel Gate Log: Live, dwell, MidCon history at Spur. | `Flywheel sees it live` | “Flywheel sees the same traffic live — who’s on site, who’s overdue, who’s MidCon.” |
| **10. Exports** | History: PDF / Excel / Word pills. | `PDF · Excel · Word` | “And the log exports — PDF, Excel, Word — ready for the packet.” |
| **11. Close** | MidCon + Flywheel + VNDRLY logos. CTA. | `vndrly.ai/gate` | “Vendorly Gate. MidCon at Flywheel — on the record.” |

### Floating bullet track (lower-third sequence)

1. Plate-first OCR  
2. Site names, not codes  
3. GPS fence (miles)  
4. Voice check-in / out  
5. Pending admit  
6. Partner live log  
7. PDF / Excel / Word  
8. Memory of plates & drivers  

---

## 4. Shot list

### A. Real app screenshots (captured)

| File | Shot |
|------|------|
| `gate_pitch/gate_login_oilfield_hero.png` | Gate login + oilfield hero (cold open / brand) |
| `gate_pitch/gate_login_viewport.png` | Full Gate login (dark) |
| `gate_pitch/gate_booth_midcon_overview.png` | MidCon booth — On site now + New entry, Spur selected |
| `gate_pitch/gate_booth_midcon_form.png` | Full booth form |
| `gate_pitch/gate_booth_midcon_form_bottom.png` | Duration chips, Host=Flywheel, GPS-denied gate message |
| `gate_pitch/gate_voice_entry_midcon.png` | Voice entry + duration / fence CTA area |
| `gate_pitch/gate_history_exports_midcon.png` | History + PDF/Excel/Word; MidCon visit at Spur |
| `gate_pitch/gate_visitor_self_checkin.png` | Visitor: Select Site of Visit (name list) |
| `gate_pitch/gate_ops_live_flywheel.png` | Flywheel partner Gate Log (Live metrics + MidCon history) |
| `gate_pitch/gate_visitors_flywheel.png` | Flywheel Visitors / partner chrome |

### B. Logos / brand marks

| File | Source | Notes |
|------|--------|-------|
| `db_logo_midcon.png` / `db_logo_midcon_square.png` | **DB** `vendors.logo_url` / `logo_square_url` (MidCon Solutions id 1054) | Real MidCon marks from storage |
| `logo_midcon_pill.png` / `logo_midcon_square.png` | Repo `attached_assets` | MidCon UI chrome used in product |
| `logo_flywheel_pill.png` / `logo_flywheel_square.png` | Repo `attached_assets` | Flywheel UI chrome used in product |
| `askv_midcon.png` / `askv_flywheel.png` | Repo Ask V brand variants | |
| `logo_vndrly.png` | Repo | |

**Gap — Flywheel DB logos:** Partner row `Flywheel Energy` (id 566) has `logo_url` / `logo_square_url` pointing at storage object IDs that **404** (objects missing). Do **not** invent trademarks. Use repo Flywheel pill/square chrome + on-screen Flywheel branding in partner screenshots until storage is repaired.

### C. Storyboard frames (floating text)

`storyboard_01_cold_open` … `storyboard_06_close` (`.png` + `.svg`) — VO lines + shot notes for the cut.

### D. Optional oilfield B-roll concepts (to shoot / license)

1. Dawn pad approach — MidCon truck at Flywheel Spur gate.  
2. Booth tablet POV — gloved hand taps **Read plate**.  
3. Plate fill-in animation (from real OCR UI, not fake HUD).  
4. Gatekeeper taps **Voice entry**, speaks plate + name.  
5. Wide shot: fence / cattle guard / GPS “inside” supers.  
6. Visitor phone: Select Site → Flywheel Energy Spur.  
7. Office cutaway: Flywheel Gate Log Live badge flips.  
8. Close: MidCon logo → Flywheel logo → VNDRLY mark.

### E. Not captured (blockers / next pass)

- **Live OCR plate read** — needs camera + plate in frame (booth hardware).  
- **GPS inside fence submit** — Cloud VM GPS denied; capture on-site at Spur.  
- **Pending admit in action** — needs a fresh visitor pending row.  
- **Full edited commercial** — package is storyboard + real UI; edit cut is next.

---

## 5. Demo data & capture notes (internal)

| Org | Role | Prod identity used for captures |
|-----|------|----------------------------------|
| MidCon Solutions (vendor 1054) | gatekeeper | `gate@midconsolutions.com` |
| MidCon Solutions | vendor admin | `admin@midconsolutions.com` |
| Flywheel Energy (partner 566) | partner admin | `admin@flywheelenergy.com` |
| Site | — | **Flywheel Energy Spur** (`site_radius_meters` ≈ 1609 ≈ 1 mi) |

Passwords follow the team’s existing MidCon/Flywheel demo pattern (`midcon123` / `flywheel123`); do not rotate.

History sample used in pitch: **John Elerick · Midconsolutions · A915A1 · Flywheel Energy Spur**.

---

## 6. How to use this package next

1. Drop storyboard frames + screenshot stills on a timeline; VO from beat sheet.  
2. Replace storyboard stills with B-roll as licensed.  
3. On-site pickup day: OCR, GPS-inside submit, pending admit micro-clips.  
4. Repair Flywheel `logo_url` storage objects if partner wants DB logos in end cards.  
5. Optional: short silent screen recording of MidCon booth → History → Flywheel Gate Log (same accounts).

---

## 7. Product truth checklist (code → claim)

| Claim | Where |
|-------|--------|
| Plate-first + optional OCR state | `gatekeeper.tsx`, `gate-plate-ocr.ts`, booth overhaul verdict |
| Site **name** only in UI | `lib/gate-booth` `siteDisplayName`, overhaul verdict |
| GPS fence miles | `lib/gate-booth` `evaluateGpsFence` |
| Duration chips / dwell overdue | `GATE_DURATION_CHIPS`, `onSiteDwell` |
| Voice parse + Ask V transcribe | `gate-voice-entry.ts`, `transcribeAskVRecording` |
| Memory / company drivers | `gate-entry-memory.ts` |
| Pending admit | `admissionStatus` pending → admit API |
| Guest self check-in | `/api/auth/guest`, visitor check-in |
| Exports PDF/Excel/Word | `gatekeeper-log-export.ts` |
| Ops live log | `/gate-log`, `officeMayAccessGateOps` |
| Permissions-Policy | `scripts/server/vndrly.ai.nginx.conf` + live headers |
| Gatekeeper role routing | login → `/gate`; App gatekeeper chrome |
