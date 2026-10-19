/** GasGo / FieldGo / FleetGo / GateGo: 30 days of synthetic company work life.
 *
 * Additive and one-shot: refuses to run when any Go company already exists,
 * never updates or deletes pre-existing rows, never rotates credentials.
 * Targets only a loopback database or the isolated `vndrly_prairie_demo`
 * database; production URLs are refused. Default is a dry run that rolls back.
 *
 *   GO_DEMO_DATABASE_URL=postgres://.../db pnpm --filter @workspace/scripts exec tsx ../scripts/go-ecosphere/provision.ts [--apply]
 *   GO_DEMO_NOW=2026-10-18T19:30:00-05:00   (optional; anchors "now" for repeatable output)
 */
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { FleetRunSchema, FleetGrantSchema, FleetDefinitionSchema } from "../../lib/api-zod/src/fleet";
import { FleetDestinationSchema, FleetTicketPlanSchema, FleetCommercialSettingsSchema } from "../../lib/api-zod/src/fleet-commercial";
import { FleetLocationObservationSchema } from "../../lib/api-zod/src/fleet-location";
import { initialNativeState } from "../../artifacts/api-server/src/services/native-operations-policy";
import { PLATFORM_EULA_TEXT, PLATFORM_EULA_VERSION } from "../../lib/platform-eula/src/index";
import {
  GO_VERSION, GO_MARKER, GO_TIMEZONE, ORGS, PEOPLE, REVIEWER, SITES, DESTINATIONS, WORK_TYPES,
  FLEET_ASSETS, FIELD_ASSETS, type OrgKey, type PersonSpec, type SiteSpec, type WorkTypeSpec,
} from "./cast";

const requireDb = createRequire(new URL("../../lib/db/package.json", import.meta.url));
const requireApi = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { Client } = requireDb("pg");
const bcrypt = requireApi("bcryptjs");

// ---------------------------------------------------------------- guards
const APPLY = process.argv.includes("--apply");
const rawUrl = process.env.GO_DEMO_DATABASE_URL;
if (!rawUrl) throw new Error("GO_DEMO_DATABASE_URL is required; there is no default and no production fallback");
const target = new URL(rawUrl);
const targetDb = target.pathname.replace(/^\//, "");
const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(target.hostname);
if (!["postgres:", "postgresql:"].includes(target.protocol)) throw new Error("Not a Postgres URL");
if (/supabase|pooler|neon|rds\.amazonaws/i.test(target.hostname) && targetDb !== "vndrly_prairie_demo")
  throw new Error("Hosted database refused; only loopback or vndrly_prairie_demo are allowed");
if (!((loopback && targetDb && targetDb !== "postgres") || targetDb === "vndrly_prairie_demo"))
  throw new Error(`Refusing database '${targetDb}' on '${target.hostname}'. Allowed: loopback non-'postgres' database or vndrly_prairie_demo`);

// ---------------------------------------------------------------- deterministic helpers
const uuid = (key: string) => {
  const h = createHash("sha256").update(`${GO_VERSION}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
function seeded(seed: string) {
  let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = seeded(GO_VERSION);
const rand = (a: number, b: number) => a + R() * (b - a);
const int = (a: number, b: number) => Math.floor(rand(a, b + 1));
const chance = (p: number) => R() < p;
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)];
const weighted = <T,>(xs: readonly T[], w: (x: T) => number): T => {
  const total = xs.reduce((s, x) => s + w(x), 0);
  let r = R() * total;
  for (const x of xs) { r -= w(x); if (r <= 0) return x; }
  return xs[xs.length - 1];
};
const shuffle = <T,>(xs: T[]) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };
const round2 = (n: number) => Math.round(n * 100) / 100;

// America/Chicago is UTC-5 (CDT) for the whole Sept–Oct window.
const NOW = new Date(process.env.GO_DEMO_NOW ?? Date.now());
if (Number.isNaN(NOW.getTime())) throw new Error("Invalid GO_DEMO_NOW");
const OFFSET_MS = 5 * 3600e3;
const localNow = new Date(NOW.getTime() - OFFSET_MS);
const [Y, M, D] = [localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()];
/** d = days before the anchor day (0 = today, negative = upcoming). Local wall-clock hour/minute. */
const at = (d: number, h: number, m = 0) => new Date(Date.UTC(Y, M, D - d, h, m) + OFFSET_MS);
const addMin = (t: Date, min: number) => new Date(t.getTime() + min * 60e3);
const workDate = (d: number) => new Date(Date.UTC(Y, M, D - d)).toISOString().slice(0, 10);
const dow = (d: number) => new Date(Date.UTC(Y, M, D - d)).getUTCDay();
const isWeekend = (d: number) => dow(d) === 0 || dow(d) === 6;
const past = (t: Date | null | undefined): t is Date => !!t && t.getTime() <= NOW.getTime();
const HISTORY_DAYS = 30;
const UPCOMING_DAYS = 7;
const BUSY = (d: number) => d >= 15 && d <= 21; // workover campaign week
const RAIN_DAY = 18;

// ---------------------------------------------------------------- geo
const toRad = (x: number) => (x * Math.PI) / 180;
function miles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R0 = 3958.8, dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R0 * Math.asin(Math.sqrt(h));
}
type Pt = { lat: number; lng: number };
const GRID = 1 / 60; // section-line county roads on a ~1-mile grid
/** Lease road to the nearest section line, then along the grid (east-west, then north-south), then lease road in. */
function roadPath(a: Pt, b: Pt): { pts: Pt[]; speeds: number[] } {
  const snap = (v: number) => Math.round(v / GRID) * GRID;
  const aRoad = { lat: snap(a.lat), lng: a.lng };
  const bRoad = { lat: snap(b.lat), lng: b.lng };
  const corner = { lat: aRoad.lat, lng: snap(b.lng) };
  const corner2 = { lat: bRoad.lat, lng: snap(b.lng) };
  return { pts: [a, aRoad, corner, corner2, bRoad, b], speeds: [15, 45, 50, 45, 15] };
}
/** Samples every `stepSec` along the path at the segment speeds. Returns points with timestamps. */
function drive(a: Pt, b: Pt, start: Date, stepSec = 30) {
  const { pts, speeds } = roadPath(a, b);
  const out: { lat: number; lng: number; t: Date; acc: number }[] = [];
  let t = start.getTime();
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const segMiles = miles(pts[i], pts[i + 1]);
    if (segMiles < 0.01) continue;
    const segSec = (segMiles / speeds[i]) * 3600;
    let s = carry;
    while (s < segSec) {
      const f = s / segSec;
      const jitter = () => (R() - 0.5) * 0.00008;
      out.push({ lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * f + jitter(), lng: pts[i].lng + (pts[i + 1].lng - pts[i].lng) * f + jitter(), t: new Date(t + s * 1000), acc: Math.round(rand(4, 14)) });
      s += stepSec;
    }
    carry = s - segSec;
    t += segSec * 1000;
  }
  out.push({ ...b, t: new Date(t), acc: 6 });
  const totalMiles = pts.slice(1).reduce((s, p, i) => s + miles(pts[i], p), 0);
  return { points: out, arrive: new Date(t), miles: totalMiles };
}

// ---------------------------------------------------------------- db
const client = new Client({ connectionString: target.toString() });
const ALLOWED = new Set([
  "partners", "vendors", "users", "user_org_memberships", "vendor_people", "partner_contacts", "vendor_person_operational_roles", "vendor_person_site_access",
  "site_locations", "work_types", "vendor_work_types", "partner_vendor_work_type_approvals", "site_work_assignments", "work_type_site_locations",
  "partner_vendor_relationships", "partner_work_type_afes", "vendor_site_location_afes", "gate_stations", "tax_rates", "onboarding_progress",
  "vendor_catalog_versions", "partner_eula_acceptances", "assets", "asset_aliases", "employee_certifications",
  "tickets", "ticket_crew", "ticket_check_ins", "ticket_line_items", "ticket_status_history", "gps_logs", "ticket_note_logs", "ticket_flags",
  "ticket_nudges", "ticket_unlocks", "vendor_ratings", "site_visits", "gate_duty_sessions", "work_hub_shifts", "work_hub_shift_assignments",
  "work_hub_channels", "work_hub_channel_members", "work_hub_messages", "work_hub_tasks", "work_hub_meetings", "work_hub_meeting_occurrences",
  "work_hub_meeting_participants", "work_hub_announcements", "work_hub_announcement_recipients", "work_hub_device_preferences",
  "location_consents", "hotlist_jobs", "hotlist_bids", "invoices", "invoice_lines", "invoice_ticket_links", "invoice_payments",
  "notifications", "safety_events", "assistant_action_audit", "work_hub_crews", "work_hub_crew_members", "work_hub_collaboration_channels",
]);
const colTypes = new Map<string, Map<string, string>>();
const counts: Record<string, number> = {};
const q = (s: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Bad identifier ${s}`); return `"${s}"`; };
async function columns(table: string) {
  if (!colTypes.has(table)) {
    const { rows } = await client.query("select column_name,udt_name from information_schema.columns where table_schema='public' and table_name=$1", [table]);
    if (!rows.length) throw new Error(`Table ${table} missing; this script performs no schema changes`);
    colTypes.set(table, new Map(rows.map((r: any) => [r.column_name, r.udt_name])));
  }
  return colTypes.get(table)!;
}
async function insertMany<T = any>(table: string, rows: Record<string, unknown>[], returning = "id"): Promise<T[]> {
  if (!ALLOWED.has(table)) throw new Error(`Unapproved table ${table}`);
  if (!rows.length) return [];
  const types = await columns(table);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  for (const k of keys) if (!types.has(k)) throw new Error(`Missing column ${table}.${k}`);
  const out: T[] = [];
  const per = Math.max(1, Math.floor(30000 / keys.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const params: unknown[] = [];
    const values = chunk.map((r) => `(${keys.map((k) => {
      let v = r[k];
      if (v === undefined) return "DEFAULT";
      if (types.get(k) === "jsonb" && v !== null && typeof v !== "string") v = JSON.stringify(v);
      params.push(v);
      return `$${params.length}`;
    }).join(",")})`);
    const { rows: res } = await client.query(`insert into ${q(table)} (${keys.map(q).join(",")}) values ${values.join(",")} returning ${returning}`, params);
    out.push(...res);
  }
  counts[table] = (counts[table] ?? 0) + rows.length;
  return out;
}
const insertOne = async (table: string, row: Record<string, unknown>, returning = "id") => (await insertMany(table, [row], returning))[0] as any;

// ---------------------------------------------------------------- main
type Person = PersonSpec & { userId: number; peopleId: number | null; membershipId: number; name: string; device: string; preferred_language?: string };
async function main() {
  await client.connect();
  const ident = (await client.query("select current_database() db, coalesce(host(inet_server_addr()),'local') addr")).rows[0];
  if (ident.db !== targetDb) throw new Error("Connected database identity mismatch");
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [GO_VERSION]);
  const names = Object.values(ORGS).map((o) => o.name.toLowerCase());
  const existing = await client.query("select name, blurb from partners where lower(btrim(name))=any($1) union all select name, blurb from vendors where lower(btrim(name))=any($1)", [names]);
  if (existing.rows.length) {
    const ours = existing.rows.every((r: any) => r.blurb === GO_MARKER);
    throw new Error(ours ? "Go companies are already provisioned in this database; nothing was changed (one-shot, additive)" : "A real organization already uses a Go company name; nothing was changed");
  }
  const preexistingUsers = await client.query("select count(*)::int n from users where username like 'go-demo-%@example.invalid'");
  if (preexistingUsers.rows[0].n) throw new Error("go-demo users already exist; nothing was changed");

  const password = randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const eulaHash = createHash("sha256").update(PLATFORM_EULA_TEXT).digest("hex");
  const companySince = at(HISTORY_DAYS + 60, 9);

  // ---------------- organizations
  const gg = ORGS.gasgo;
  const partner = await insertOne("partners", {
    name: gg.name, contact_name: gg.contact, contact_email: "operations@gasgo.example.invalid", contact_phone: gg.phone,
    physical_address: gg.address, billing_address: gg.address, business_phone: gg.phone, hours_of_operation: "Mon–Fri 07:00–17:00; field 24/7",
    state_tax_id: "SYN-TX-0001", federal_tax_id: "00-0000001", blurb: GO_MARKER, operating_radius_miles: 80,
    brand_primary_color: gg.primary, brand_accent_color: gg.accent, created_at: companySince,
  });
  const partnerId: number = partner.id;
  const vendorIds = {} as Record<Exclude<OrgKey, "gasgo">, number>;
  for (const key of ["fieldgo", "fleetgo", "gatego"] as const) {
    const o = ORGS[key];
    const glExp = key === "fieldgo" ? workDate(-20) : workDate(-210);
    const row = await insertOne("vendors", {
      name: o.name, contact_name: o.contact, contact_email: `office@${key}.example.invalid`, contact_phone: o.phone,
      physical_address: o.address, billing_address: o.address, business_phone: o.phone, hours_of_operation: key === "gatego" ? "24/7 posts; office Mon–Fri 08:00–17:00" : "Mon–Sat 06:00–18:00; on call 24/7",
      operating_radius_miles: 75, latitude: 32.1293, longitude: -101.7887, state_tax_id: `SYN-TX-${key}`, federal_tax_id: `00-000000${key.length}`,
      blurb: GO_MARKER, brand_primary_color: o.primary, brand_accent_color: o.accent, operations_categories: [...o.categories],
      daily_ot_hours: "10", weekly_ot_hours: "40", overtime_multiplier: "1.5",
      insurance_carrier: "Synthetic Mutual Casualty", insurance_policy_number: `SYN-COI-${key.toUpperCase()}`, insurance_expiration_date: glExp,
      gl_carrier: "Synthetic Mutual Casualty", gl_policy_number: `SYN-GL-${key.toUpperCase()}`, gl_expiration_date: glExp,
      wc_carrier: "Synthetic Workers Comp Co.", wc_policy_number: `SYN-WC-${key.toUpperCase()}`, wc_expiration_date: workDate(-150),
      auto_liability_carrier: "Synthetic Fleet Insurance", auto_liability_policy_number: `SYN-AL-${key.toUpperCase()}`, auto_liability_expiration_date: key === "fleetgo" ? workDate(-9) : workDate(-240),
      e_delivery_consent: true, e_delivery_consent_at: companySince, e_delivery_email: `office@${key}.example.invalid`,
      accounting_failure_notifications_enabled: false, created_at: companySince,
    });
    vendorIds[key] = row.id;
  }
  const orgId = (o: OrgKey) => (o === "gasgo" ? partnerId : vendorIds[o]);

  // ---------------- people
  const people: Record<string, Person> = {};
  const userRows = PEOPLE.map((s) => ({
    username: `go-demo-${s.key}@example.invalid`, email: `go-demo-${s.key}@example.invalid`, password_hash: passwordHash,
    role: s.userRole, display_name: `${s.first} ${s.last}`, preferred_language: ["luis-garza", "mateo-silva", "maria-sanchez", "rudy-villarreal", "victor-pena"].includes(s.key) ? "es" : "en",
    email_verified_at: companySince, created_at: addMin(companySince, int(0, 60 * 24 * 40)),
  }));
  const users = await insertMany<{ id: number }>("users", userRows);
  const reviewer = await insertOne("users", { username: "go-demo-review@example.invalid", email: "go-demo-review@example.invalid", password_hash: passwordHash, role: "partner", display_name: `${REVIEWER.first} ${REVIEWER.last}`, email_verified_at: companySince, created_at: companySince });
  for (let i = 0; i < PEOPLE.length; i++) {
    const s = PEOPLE[i];
    let peopleId: number | null = null;
    if (s.org !== "gasgo") {
      const roles = [...(s.operationalRoles ?? []), ...(s.extraRoles ?? [])];
      const row = await insertOne("vendor_people", {
        vendor_id: orgId(s.org), user_id: users[i].id, first_name: s.first, last_name: s.last, email: `go-demo-${s.key}@example.invalid`,
        phone: `(432) 555-${String(1000 + i).slice(-4)}`, job_title: s.title, vendor_role: s.vendorRole ?? "office", roles,
        hourly_rate: s.hourlyRate ? String(s.hourlyRate) : null, pec_certification: s.userRole === "field_employee",
        pec_expiration_date: s.userRole === "field_employee" ? workDate(-int(90, 500)) : null, preferred_language: userRows[i].preferred_language,
        created_at: userRows[i].created_at,
      });
      peopleId = row.id;
    }
    const m = await insertOne("user_org_memberships", {
      user_id: users[i].id, org_type: s.org === "gasgo" ? "partner" : "vendor", partner_id: s.org === "gasgo" ? partnerId : null,
      vendor_id: s.org === "gasgo" ? null : orgId(s.org), role: s.membership, ...(peopleId ? { vendor_people_id: peopleId } : {}),
    });
    people[s.key] = { ...s, userId: users[i].id, peopleId, membershipId: m.id, name: `${s.first} ${s.last}`, device: `ios-${uuid(`device:${s.key}`).slice(0, 13)}` };
  }
  for (const s of PEOPLE) await client.query("update users set active_membership_id=$1 where id=$2 and active_membership_id is null", [people[s.key].membershipId, people[s.key].userId]);
  await insertOne("user_org_memberships", { user_id: reviewer.id, org_type: "partner", partner_id: partnerId, role: "admin" });
  for (const v of Object.values(vendorIds)) await insertOne("user_org_memberships", { user_id: reviewer.id, org_type: "vendor", vendor_id: v, role: "admin" });
  await insertMany("partner_contacts", PEOPLE.filter((s) => s.org === "gasgo").map((s) => ({
    partner_id: partnerId, job_title: s.title, name: `${s.first} ${s.last}`, email: `go-demo-${s.key}@example.invalid`, phone: "(432) 555-0101",
    roles: s.membership === "ap" ? ["Accounts Payable"] : ["office"], user_id: people[s.key].userId, accepted_at: companySince, created_at: companySince,
  })));
  await insertMany("vendor_person_operational_roles", PEOPLE.filter((s) => s.org !== "gasgo").flatMap((s) => (s.operationalRoles ?? []).map((role) => ({
    vendor_people_id: people[s.key].peopleId, role, is_active: true, granted_by_user_id: people[s.org === "fieldgo" ? "ray-castillo" : s.org === "fleetgo" ? "curtis-lyle" : "sharon-pike"].userId, created_at: companySince,
  }))));
  const byOrg = (o: OrgKey) => PEOPLE.filter((s) => s.org === o).map((s) => people[s.key]);
  const P = (k: string) => people[k];

  // ---------------- sites, catalog, relationships
  const siteIds: Record<string, number> = {};
  for (const s of SITES) {
    const row = await insertOne("site_locations", {
      partner_id: partnerId, name: s.name, address: `${s.name} lease road, ${s.county} County, TX (fictional)`, latitude: s.lat, longitude: s.lng,
      state: "TX", site_code: `GG-${s.key.toUpperCase()}`, site_radius_meters: s.kind === "pad" ? 350 : 450, afe: s.afe,
      tax_jurisdiction_county: s.county, tax_jurisdiction_label: `${s.county} County, TX`, state_tax_rate: "0.0625", local_tax_rate: "0", combined_tax_rate: "0.0625",
      tax_jurisdiction_resolved_at: companySince, tax_provider: "manual", created_at: addMin(companySince, int(60, 60 * 24 * 20)),
    });
    siteIds[s.key] = row.id;
  }
  const site = (k: string) => SITES.find((s) => s.key === k)!;
  const wtIds: Record<string, number> = {};
  for (const w of WORK_TYPES) {
    const row = await insertOne("work_types", { partner_id: partnerId, name: w.name, category: w.category, description: `${w.name}. ${GO_MARKER}`, estimated_price: String(w.price), required_certifications: w.certs ?? null });
    wtIds[w.key] = row.id;
  }
  const vendorOf = (w: WorkTypeSpec) => vendorIds[w.vendor as Exclude<OrgKey, "gasgo">];
  await insertMany("vendor_work_types", WORK_TYPES.map((w) => ({ vendor_id: vendorOf(w), work_type_id: wtIds[w.key], unit_price: String(w.price), unit: w.unit, currency: "USD", notes: GO_MARKER, price_authority_acknowledged_at: companySince })));
  await insertMany("partner_vendor_work_type_approvals", WORK_TYPES.map((w) => ({ partner_id: partnerId, vendor_id: vendorOf(w), work_type_id: wtIds[w.key], approved_unit_price: String(w.price), approved_unit: w.unit, approved_currency: "USD", approved_at: companySince, approved_by_user_id: P("dana-whitfield").userId })));
  await insertMany("partner_vendor_relationships", Object.values(vendorIds).map((v) => ({ partner_id: partnerId, vendor_id: v, status: "approved", notes: GO_MARKER, approved_at: companySince, approved_by_user_id: P("dana-whitfield").userId })));
  const assignments: Record<string, unknown>[] = [];
  for (const w of WORK_TYPES) for (const s of SITES) {
    const ok = w.vendor === "fieldgo" ? true
      : w.key === "hotshot" ? s.key === "stanton-yard"
      : w.vendor === "fleetgo" ? s.kind === "ctb" || (w.key === "pw-haul" && s.kind === "pad")
      : s.gated;
    if (ok) assignments.push({ site_location_id: siteIds[s.key], work_type_id: wtIds[w.key], vendor_id: vendorOf(w), afe: s.afe, is_gate_contractor: w.vendor === "gatego" });
  }
  await insertMany("site_work_assignments", assignments);
  const siteGrantor = { fieldgo: "ray-castillo", fleetgo: "curtis-lyle", gatego: "sharon-pike" } as const;
  await insertMany("vendor_person_site_access", PEOPLE.filter((s) => s.org !== "gasgo" && s.membership !== "admin").flatMap((s) => {
    const org = s.org as Exclude<OrgKey, "gasgo">;
    const contracted = [...new Set(assignments.filter((a) => a.vendor_id === vendorIds[org]).map((a) => a.site_location_id as number))];
    return contracted.map((siteId) => ({ vendor_people_id: people[s.key].peopleId, site_location_id: siteId, is_active: true, granted_by_user_id: people[siteGrantor[org]].userId, created_at: companySince }));
  }));
  await insertMany("work_type_site_locations", assignments.map((a) => ({ work_type_id: a.work_type_id, site_location_id: a.site_location_id })), "work_type_id");
  await insertMany("partner_work_type_afes", WORK_TYPES.map((w, i) => ({ partner_id: partnerId, work_type_id: wtIds[w.key], afe: `AFE-26-LOE-${String(100 + i)}` })));
  await insertMany("vendor_site_location_afes", Object.values(vendorIds).flatMap((v) => SITES.map((s) => ({ vendor_id: v, site_location_id: siteIds[s.key], afe: s.afe }))));
  const stations: Record<string, string> = {};
  for (const s of SITES.filter((x) => x.gated)) {
    const row = await insertOne("gate_stations", { id: uuid(`station:${s.key}`), site_id: siteIds[s.key], name: "Main Gate", latitude: s.lat + 0.0011, longitude: s.lng - 0.0004, geofence_radius_m: 150, created_at: companySince }, "id");
    stations[s.key] = row.id;
  }
  if (!(await client.query("select 1 from tax_rates where state='TX'")).rowCount) await insertOne("tax_rates", { state: "TX", state_name: "Texas", rate: "0.0625" });
  await insertMany("onboarding_progress", [
    { org_type: "partner", partner_id: partnerId, current_step: "done", completed_steps: ["company", "sites", "vendors", "eula"], started_at: companySince, completed_at: addMin(companySince, 90), updated_at: addMin(companySince, 90) },
    ...Object.values(vendorIds).map((v) => ({ org_type: "vendor", vendor_id: v, current_step: "done", completed_steps: ["company", "catalog", "people", "eula"], started_at: companySince, completed_at: addMin(companySince, 120), updated_at: addMin(companySince, 120) })),
  ]);
  const eulaPatch = (uid: number) => [companySince, PLATFORM_EULA_VERSION, eulaHash, uid];
  await client.query("update partners set platform_eula_accepted_at=$1,platform_eula_version=$2,platform_eula_hash=$3,platform_eula_accepted_by_user_id=$4 where id=$5 and blurb=$6", [...eulaPatch(P("dana-whitfield").userId), partnerId, GO_MARKER]);
  const owners = { fieldgo: "ray-castillo", fleetgo: "curtis-lyle", gatego: "sharon-pike" } as const;
  for (const [k, v] of Object.entries(vendorIds)) {
    const owner = P(owners[k as keyof typeof owners]).userId;
    const wts = WORK_TYPES.filter((w) => w.vendor === k);
    const eulaText = `${ORGS[k as keyof typeof owners].name} service terms (synthetic). ${GO_MARKER}`;
    const version = await insertOne("vendor_catalog_versions", {
      vendor_id: v, version: 1, published_at: companySince, published_by_user_id: owner, change_summary: "Initial catalog",
      rates_snapshot: wts.map((w) => ({ workTypeId: wtIds[w.key], unitPrice: w.price, unit: w.unit, currency: "USD" })),
      work_types_snapshot: wts.map((w) => ({ id: wtIds[w.key], name: w.name, category: w.category })), compliance_snapshot: { synthetic: true },
      eula_text: eulaText, eula_hash: createHash("sha256").update(eulaText).digest("hex"),
    });
    await client.query("update vendors set platform_eula_accepted_at=$1,platform_eula_version=$2,platform_eula_hash=$3,platform_eula_accepted_by_user_id=$4,current_catalog_version_id=$5,catalog_authority_attested_at=$1,catalog_authority_attested_by_user_id=$4 where id=$6 and blurb=$7", [...eulaPatch(owner), version.id, v, GO_MARKER]);
    await insertOne("partner_eula_acceptances", { partner_id: partnerId, vendor_id: v, vendor_catalog_version_id: version.id, accepted_by_user_id: P("dana-whitfield").userId, accepted_eula_hash: createHash("sha256").update(eulaText).digest("hex"), accepted_at: addMin(companySince, 200) });
  }

  // ---------------- assets
  const assetIds: Record<string, string> = {};
  const assetRows = [
    ...FLEET_ASSETS.map((a) => ({ ...a, org: "fleetgo" as const })),
    ...FIELD_ASSETS.map((a) => ({ ...a, vin: undefined as string | undefined, org: "fieldgo" as const })),
  ];
  for (const a of assetRows) {
    const id = uuid(`asset:${a.key}`);
    assetIds[a.key] = id;
    await insertOne("assets", { id, name: a.name, category: a.category, legal_owner_name: ORGS[a.org].legal, responsible_org_type: "vendor", responsible_org_id: vendorIds[a.org], status: a.key === "u105" ? "held" : "available", created_by_user_id: P(a.org === "fleetgo" ? "tanya-brooks" : "ray-castillo").userId, created_at: companySince }, "id");
    await insertOne("asset_aliases", { id: uuid(`plate:${a.key}`), asset_id: id, kind: "plate", jurisdiction: "TX", normalized_value: a.plate.replace(/-/g, ""), display_value: a.plate }, "id");
    if (a.vin) await insertOne("asset_aliases", { id: uuid(`vin:${a.key}`), asset_id: id, kind: "vin", normalized_value: a.vin, display_value: a.vin }, "id");
  }
  const plateOf = (k: string) => [...FLEET_ASSETS, ...FIELD_ASSETS].find((a) => a.key === k)!.plate;

  // ---------------- certifications (two expiring inside the window, one expired)
  const certRows: Record<string, unknown>[] = [];
  for (const s of PEOPLE.filter((x) => x.userRole === "field_employee")) {
    const base = s.org === "fleetgo" ? ["CDL Class A", "DOT Medical Card", "SafeLand USA", "H2S Clear"] : s.org === "gatego" ? ["Texas Level II Security", "H2S Clear", "First Aid / CPR"] : ["SafeLand USA", "H2S Clear", "First Aid / CPR"];
    if (s.key === "victor-pena" || s.key === "trent-dawson") base.push("Hazmat Endorsement");
    for (const name of base) {
      let exp = workDate(-int(60, 700));
      if (s.key === "cody-harmon" && name === "H2S Clear") exp = workDate(-6);
      if (s.key === "kenny-watts" && name === "DOT Medical Card") exp = workDate(-12);
      if (s.key === "glen-whitaker" && name === "Texas Level II Security") exp = workDate(3);
      certRows.push({ employee_id: people[s.key].peopleId, name, issuer: name.includes("CDL") || name.includes("DOT") ? "Texas DPS (synthetic)" : "Synthetic Safety Council", cert_number: `SYN-${s.key.slice(0, 3).toUpperCase()}-${int(10000, 99999)}`, issued_date: workDate(int(200, 700)), expiration_date: exp, vendor_verified_at: companySince, vendor_verified_by_user_id: P(owners[s.org as keyof typeof owners]).userId, created_at: companySince });
    }
  }
  await insertMany("employee_certifications", certRows);

  // ======================================================================
  // Simulation state
  // ======================================================================
  type History = { from: string | null; to: string; at: Date; by: number; role: string; reason?: string };
  type TicketPlan = {
    key: string; org: "fieldgo" | "fleetgo" | "gatego"; d: number; siteKey: string; wt: WorkTypeSpec; lead: Person; crew: Person[]; foreman: Person | null;
    intake: string; createdBy: Person; createdAt: Date; scheduled: Date; durationMin: number; history: History[];
    status: string; lifecycle: string | null; enRoute: Date | null; onLocation: Date | null; checkIn: Date | null; checkOut: Date | null; closedAt: Date | null; closedBy: Person | null;
    approvedAt: Date | null; cancelledAt: Date | null; cancelledBy: Person | null; preCancel: string | null; kickbackReason: string | null; dispersedAt: Date | null; dispersedBy: Person | null; paymentMethod: string | null;
    lines: { type: string; description: string; quantity: number; unitPrice: number; at: Date; runId?: string }[];
    gps: { lat: number; lng: number; type: string; at: Date }[]; notes: { by: Person; at: Date; content: string }[];
    mileage: [number, number] | null; fleetPlan?: any; truck?: string; id?: number; flagged?: boolean; unlocked?: Date | null; hotlist?: boolean;
  };
  const tickets: TicketPlan[] = [];
  const gpsForTicket = (s: SiteSpec, from: Pt, t: TicketPlan) => {
    const g: TicketPlan["gps"] = [];
    if (t.enRoute) g.push({ ...from, type: "en_route", at: t.enRoute });
    if (t.onLocation) g.push({ lat: s.lat + 0.0025, lng: s.lng - 0.0012, type: "on_location", at: t.onLocation });
    if (t.checkIn) {
      g.push({ lat: s.lat + rand(-0.0003, 0.0003), lng: s.lng + rand(-0.0003, 0.0003), type: "check_in", at: t.checkIn });
      const end = t.checkOut ?? new Date(Math.min(NOW.getTime(), addMin(t.checkIn, 12 * 60).getTime()));
      for (let x = addMin(t.checkIn, 20); x < end; x = addMin(x, 20)) g.push({ lat: s.lat + rand(-0.0004, 0.0004), lng: s.lng + rand(-0.0004, 0.0004), type: "tracking", at: x });
    }
    if (t.checkOut) g.push({ lat: s.lat + rand(-0.0003, 0.0003), lng: s.lng + rand(-0.0003, 0.0003), type: "check_out", at: t.checkOut });
    return g;
  };
  /** Walks a ticket's intended office path and stops at the first step that is still in the future. */
  function settle(t: TicketPlan, steps: { to: string; at: Date; by: Person; role: string; reason?: string; apply?: () => void }[]) {
    let from: string | null = null;
    for (const s of steps) {
      if (!past(s.at)) break;
      t.history.push({ from, to: s.to, at: s.at, by: s.by.userId, role: s.role, reason: s.reason });
      s.apply?.();
      from = s.to;
      t.status = s.to;
    }
    if (!t.history.length) { t.status = t.intake === "partner_self_service" ? "awaiting_acceptance" : "initiated"; }
  }
  const gasgoApprover = () => (chance(0.6) ? P("marcus-delgado") : P("earl-tatum"));
  const KICKBACK_REASONS = [
    "Missing supervisor signature on the JSA — please attach and resubmit.",
    "Labor hours exceed the posted job window; confirm crew check-out times.",
    "Wrong AFE — this work belongs on the workover AFE, not LOE.",
    "Parts line lacks a receipt or part number.",
    "Please add before/after photos of the repair.",
  ];
  const NOTE_TEXT: Record<string, string[]> = {
    roustabout: ["Replaced 2\" ball valve on separator dump line, tested, no leaks.", "Dug out and re-set cattle guard on lease road; graded approach.", "Painted and labeled flowline risers per GasGo spec."],
    wellhead: ["Re-packed stuffing box, adjusted to 1/8 drip.", "Replaced wellhead gasket; pressure tested to 1,500 psi, held 15 min.", "Greased master valve and wing valve, function tested."],
    "pumping-unit": ["Changed gearbox oil, inspected belts — two replaced.", "Re-spaced pump, tagged bottom, unit running smooth at 8 SPM.", "Replaced polished rod clamp; checked counterbalance."],
    flowline: ["Located leak at 1,200 ft; clamped and replaced 20 ft section.", "Hydro-tested repaired section, no drop over 30 min."],
    "tank-battery": ["Replaced thief hatch gaskets on tanks 2 and 3.", "Cleaned and tested level floats; high-level shutdown verified."],
    valve: ["Swapped 3\" gate valve on header; torque log attached.", "Valve replaced, flange bolts re-torqued in star pattern."],
    cleanup: ["Picked up trash and old pipe; hauled to yard.", "Weed-eated pad perimeter and around tanks."],
    instrumentation: ["Replaced pressure transmitter on sales line, recalibrated.", "Swapped RTU battery; comms restored to SCADA."],
    backhoe: ["Dug bell hole for flowline repair, backfilled and compacted.", "Built berm around produced water tank per SPCC."],
    spill: ["Contained ~4 bbl produced water spill inside berm; boom deployed, vac truck recovered fluids.", "Scraped and staged impacted soil for disposal; photos attached."],
  };

  // ---------------- gate schedule (computed first: visits need the on-duty attendant)
  const gatekeepers = byOrg("gatego").filter((p) => p.vendorRole === "gatekeeper");
  const supervisor = P("luis-ortega");
  type Post = { stationKey: string; d: number; shift: "day" | "night"; start: Date; end: Date; user: Person | null; actualStart: Date | null; actualEnd: Date | null; shiftId: string; late: boolean };
  const posts: Post[] = [];
  for (let d = HISTORY_DAYS - 1; d >= -UPCOMING_DAYS; d--) {
    const dayNum = HISTORY_DAYS - 1 - d;
    const onRotation = gatekeepers.filter((_, i) => Math.floor((dayNum + i * 3) / 7) % 2 === 0 || (i % 4 === 0 && Math.floor((dayNum + i) / 5) % 3 !== 0));
    const off = new Set<string>();
    if (d === 11 || d === 10) off.add("frank-oneal");
    if (d === 4) off.add("tasha-greene");
    const available = shuffle(onRotation.filter((p) => !off.has(p.key)));
    const workedLastNight = new Set(posts.filter((p) => p.d === d + 1 && p.shift === "night" && p.user).map((p) => p.user!.key));
    const order: [string, "day" | "night"][] = [["adr-ctb", "day"], ["crg-ctb", "day"], ["adr-ctb", "night"], ["crg-ctb", "night"], ["stanton-yard", "day"], ["stanton-yard", "night"]];
    for (const [stationKey, shift] of order) {
      const start = shift === "day" ? at(d, 6) : at(d, 18);
      const end = shift === "day" ? at(d, 18) : at(d - 1, 6);
      const idx = available.findIndex((p) => shift === "night" || !workedLastNight.has(p.key));
      let user = idx >= 0 ? available.splice(idx, 1)[0] : null;
      if (!user && shift === "day" && !isWeekend(d) && !posts.some((p) => p.d === d && p.user?.key === supervisor.key)) user = supervisor;
      const late = !!user && chance(0.05);
      const actualStart = user ? addMin(start, late ? int(18, 35) : int(-12, 6)) : null;
      const actualEnd = user ? addMin(end, int(0, 12)) : null;
      posts.push({ stationKey, d, shift, start, end, user, actualStart: past(actualStart) ? actualStart : null, actualEnd: past(actualEnd) ? actualEnd : null, shiftId: uuid(`gate-shift:${stationKey}:${d}:${shift}`), late });
    }
  }
  const onDuty = (stationKey: string, t: Date) => posts.find((p) => p.stationKey === stationKey && p.actualStart && p.actualStart <= t && (!p.actualEnd || p.actualEnd > t))?.user ?? null;

  // ---------------- field tickets
  const fieldYard: Pt = { lat: 32.1293, lng: -101.7887 };
  const crewA = byOrg("fieldgo").filter((p) => p.crew === "A");
  const crewB = byOrg("fieldgo").filter((p) => p.crew === "B");
  const techs = byOrg("fieldgo").filter((p) => p.crew === "tech");
  const techSpecialty: Record<string, string[]> = { "sam-kowalski": ["wellhead", "valve"], "rosa-mendez": ["instrumentation"], "nick-fuentes": ["pumping-unit"], "grady-cole": ["backhoe", "cleanup"] };
  const crewTruck: Record<string, string> = { "hector-ruiz": "ct1", "wade-pruitt": "ct3", "sam-kowalski": "ct5", "rosa-mendez": "ct6", "nick-fuentes": "ct2", "grady-cole": "bh1" };
  const absent = (k: string, d: number) => (k === "cody-harmon" && d >= 10 && d <= 14) || (k === "eli-morrison" && d === 5) || (k === "rosa-mendez" && (d === 22 || d === 23));
  const fieldWts = WORK_TYPES.filter((w) => w.vendor === "fieldgo");
  const crewWts = fieldWts.filter((w) => ["roustabout", "flowline", "tank-battery", "cleanup"].includes(w.key));
  let ticketSeq = 0;
  let stuckUsed = false;
  function planFieldTicket(d: number, lead: Person, crew: Person[], wt: WorkTypeSpec, siteKey: string, start: Date, foreman: Person | null, forcedIntake?: string): TicketPlan {
    const s = site(siteKey);
    const intake = forcedIntake ?? weighted([["partner_self_service", 45], ["office_on_behalf_of_partner", 35], ["vendor_field_self_service", 20]] as const, (x) => x[1])[0];
    const createdBy = intake === "partner_self_service" ? (chance(0.5) ? P("earl-tatum") : P("lena-okafor")) : intake === "vendor_field_self_service" ? lead : P("brenda-nguyen");
    const createdAt = intake === "vendor_field_self_service" ? addMin(start, -int(20, 40)) : addMin(start, -int(60 * 14, 60 * 60));
    const durationMin = Math.round(rand(wt.hours[0], wt.hours[1]) * 4) * 15;
    const t: TicketPlan = {
      key: `field-${++ticketSeq}`, org: "fieldgo", d, siteKey, wt, lead, crew, foreman, intake, createdBy, createdAt, scheduled: start, durationMin, history: [],
      status: "initiated", lifecycle: null, enRoute: null, onLocation: null, checkIn: null, checkOut: null, closedAt: null, closedBy: null, approvedAt: null,
      cancelledAt: null, cancelledBy: null, preCancel: null, kickbackReason: null, dispersedAt: null, dispersedBy: null, paymentMethod: null, lines: [], gps: [], notes: [],
      mileage: null, truck: crewTruck[lead.key] ?? "ct4", unlocked: null, hotlist: forcedIntake === "partner_hotlist",
    };
    const enRoute = addMin(start, -int(25, 45));
    const onLoc = addMin(start, int(-8, 12));
    const checkIn = addMin(onLoc, int(2, 9));
    const checkOut = addMin(checkIn, durationMin);
    const closed = addMin(checkOut, int(5, 40));
    const cancel = chance(0.04);
    const deny = !cancel && chance(0.03);
    const kick = !cancel && !deny && chance(0.14);
    const stuck = d === 2 && lead.key === "nick-fuentes" && !stuckUsed && !cancel && !deny;
    if (stuck) stuckUsed = true;
    const submitAt = addMin(at(d - pick([1, 1, 2, 2, 3, 4, 6]), 8), int(0, 150));
    const approveAt = addMin(submitAt, int(60 * 20, 60 * 24 * 4));
    const kickAt = addMin(submitAt, int(60 * 6, 60 * 48));
    const resubmitAt = addMin(kickAt, int(60 * 3, 60 * 24 * 5));
    const approve2 = addMin(resubmitAt, int(60 * 12, 60 * 60));
    const finalApprove = kick ? approve2 : approveAt;
    const awaitingAt = addMin(finalApprove, int(60 * 18, 60 * 24 * 3));
    const disperseAt = addMin(awaitingAt, int(60 * 24 * 7, 60 * 24 * 20));
    const office = P(chance(0.7) ? "kim-albright" : "brenda-nguyen");
    const approver = gasgoApprover();
    const steps: Parameters<typeof settle>[1] = [];
    const vendorRole = "vendor", fieldRole = "field_employee", partnerRole = "partner";
    if (intake === "partner_self_service" || intake === "partner_hotlist") {
      steps.push({ to: "awaiting_acceptance", at: createdAt, by: createdBy, role: intake === "partner_hotlist" ? vendorRole : partnerRole });
      steps.push({ to: "initiated", at: addMin(createdAt, int(30, 360)), by: P("brenda-nguyen"), role: vendorRole });
    } else steps.push({ to: "initiated", at: createdAt, by: createdBy, role: intake === "vendor_field_self_service" ? fieldRole : vendorRole });
    if (cancel) {
      const at0 = new Date(Math.max(addMin(start, -int(60, 600)).getTime(), addMin(steps.at(-1)!.at, int(15, 60)).getTime()));
      steps.push({ to: "cancelled", at: at0, by: createdBy, role: createdBy.org === "gasgo" ? partnerRole : vendorRole, reason: pick(["Well shut in by GasGo — job postponed.", "Duplicate ticket.", "Weather — lease roads closed."]), apply: () => { t.cancelledAt = at0; t.cancelledBy = createdBy; t.preCancel = "initiated"; } });
    } else {
      t.enRoute = past(enRoute) ? enRoute : null;
      t.onLocation = past(onLoc) ? onLoc : null;
      steps.push({ to: "in_progress", at: checkIn, by: lead, role: fieldRole, apply: () => { t.checkIn = checkIn; } });
      if (!stuck) {
        steps.push({ to: "pending_review", at: closed, by: foreman ?? lead, role: fieldRole, apply: () => { t.checkOut = checkOut; t.closedAt = closed; t.closedBy = foreman ?? lead; } });
        steps.push({ to: "submitted", at: submitAt, by: office, role: vendorRole });
        if (deny) steps.push({ to: "denied", at: approveAt, by: approver, role: partnerRole, reason: "Work not authorized on this AFE; no prior approval on file." });
        else {
          if (kick) {
            const reason = pick(KICKBACK_REASONS);
            steps.push({ to: "kicked_back", at: kickAt, by: approver, role: partnerRole, reason, apply: () => { t.kickbackReason = reason; } });
            steps.push({ to: "submitted", at: resubmitAt, by: office, role: vendorRole, reason: "Corrected and resubmitted" });
          }
          steps.push({ to: "approved", at: finalApprove, by: approver, role: partnerRole, apply: () => { t.approvedAt = finalApprove; } });
          steps.push({ to: "awaiting_payment", at: awaitingAt, by: P("priya-raman"), role: partnerRole });
          const method = chance(0.7) ? "ach" : "check";
          steps.push({ to: "funds_dispersed", at: disperseAt, by: P("priya-raman"), role: partnerRole, apply: () => { t.dispersedAt = disperseAt; t.dispersedBy = P("priya-raman"); t.paymentMethod = method; } });
        }
      } else t.checkOut = null;
    }
    settle(t, steps);
    if (t.status === "kicked_back" || (t.history.some((h) => h.to === "kicked_back") && t.status !== "kicked_back")) t.kickbackReason ??= pick(KICKBACK_REASONS);
    if (["initiated", "awaiting_acceptance"].includes(t.status)) t.lifecycle = t.onLocation ? "on_location" : t.enRoute ? "en_route" : "pending_arrival";
    else if (t.status === "in_progress") t.lifecycle = "on_site";
    else t.lifecycle = "off_site";
    if (t.status === "cancelled") { t.enRoute = null; t.onLocation = null; }
    if (t.checkIn) {
      const end = t.checkOut;
      const hrs = end ? round2((end.getTime() - t.checkIn.getTime()) / 3600e3) : null;
      if (hrs) {
        if (wt.unit === "per_job") t.lines.push({ type: "labor", description: `${wt.name} — flat rate`, quantity: 1, unitPrice: wt.price, at: end! });
        else for (const m of crew) t.lines.push({ type: "labor", description: `${m.title} — ${m.name}`, quantity: hrs, unitPrice: wt.price, at: end! });
        for (const [part, price] of shuffle([...(wt.parts ?? [])]).slice(0, int(0, Math.min(3, wt.parts?.length ?? 0)))) t.lines.push({ type: "part", description: part, quantity: int(1, 3), unitPrice: price, at: end! });
        if (wt.key === "backhoe" || (wt.key === "flowline" && chance(0.5))) t.lines.push({ type: "equipment", description: wt.key === "backhoe" ? "CAT 420F2 backhoe" : "Welding rig", quantity: hrs, unitPrice: wt.key === "backhoe" ? 0 : 45, at: end! });
        if (chance(0.45)) { const startMi = int(41000, 98000); t.mileage = [startMi, startMi + Math.round(miles(fieldYard, s) * 2 + rand(2, 12))]; }
      }
      t.gps = gpsForTicket(s, fieldYard, t);
      const notesPool = NOTE_TEXT[wt.key] ?? [];
      if (notesPool.length && (t.checkOut || chance(0.3)) && chance(0.55)) t.notes.push({ by: foreman ?? lead, at: addMin(t.checkOut ?? NOW, -int(5, 30)), content: pick(notesPool) });
      if (lead.preferred_language === "es" && chance(0.4)) t.notes.push({ by: lead, at: addMin(t.checkIn, int(10, 60)), content: "Llegamos al sitio, revisando el equipo antes de empezar." });
    } else if (t.enRoute) t.gps = gpsForTicket(s, fieldYard, t);
    t.flagged = t.history.some((h) => h.to === "kicked_back") && chance(0.3);
    return t;
  }
  for (const p of Object.values(people)) p.preferred_language = ["luis-garza", "mateo-silva", "maria-sanchez", "rudy-villarreal", "victor-pena"].includes(p.key) ? "es" : "en";
  const pickSite = (kinds: SiteSpec["kind"][] = ["pad", "ctb", "yard"]) => weighted(SITES.filter((s) => kinds.includes(s.kind)), (s) => (s.kind === "pad" ? 7 : s.kind === "ctb" ? 4 : 1));
  for (let d = HISTORY_DAYS - 1; d >= -UPCOMING_DAYS; d--) {
    const weekend = isWeekend(d);
    const rain = d === RAIN_DAY;
    const crews: [Person, Person[]][] = [];
    if (!rain) {
      if (!weekend || dow(d) === 6 ? !(weekend && (HISTORY_DAYS - d) % 2) : false) crews.push([P("hector-ruiz"), crewA.filter((m) => !absent(m.key, d))]);
      if (!weekend || dow(d) === 6 ? !(weekend && (HISTORY_DAYS - d) % 2 === 0) : false) crews.push([P("wade-pruitt"), crewB.filter((m) => !absent(m.key, d))]);
    }
    for (const [foreman, members] of crews) {
      const jobs = d < 0 ? 1 : BUSY(d) ? 2 : chance(0.45) ? 2 : 1;
      let start = at(d, 7, int(0, 30));
      for (let j = 0; j < jobs; j++) {
        const wt = d === 12 && foreman.key === "wade-pruitt" && j === 0 ? WORK_TYPES.find((w) => w.key === "spill")! : weighted(crewWts, (w) => w.weight);
        const siteKey = wt.key === "spill" ? "crg-ctb" : pickSite().key;
        const size = Math.min(members.length, int(wt.crewSize[0], wt.crewSize[1]) - 1);
        const crew = [foreman, ...shuffle(members.filter((m) => m.key !== foreman.key)).slice(0, Math.max(1, size))];
        const t = planFieldTicket(d, foreman, crew, wt, siteKey, start, foreman);
        tickets.push(t);
        start = addMin(start, t.durationMin + int(40, 70));
        if (start > at(d, 15)) break;
      }
    }
    for (const tech of techs) {
      if (absent(tech.key, d)) continue;
      if (weekend && (HISTORY_DAYS - d + techs.indexOf(tech)) % 3 !== 0) continue;
      if (d < 0 && chance(0.4)) continue;
      const jobs = rain ? 1 : weekend ? 1 : BUSY(d) ? int(2, 3) : int(1, 3);
      let start = at(d, 7, int(0, 45));
      for (let j = 0; j < jobs; j++) {
        const wtKey = pick(techSpecialty[tech.key]);
        const wt = WORK_TYPES.find((w) => w.key === wtKey)!;
        const t = planFieldTicket(d, tech, [tech], wt, pickSite().key, start, null);
        tickets.push(t);
        if (t.status === "in_progress") break;
        start = addMin(start, t.durationMin + int(30, 60));
        if (start > at(d, 15, 30)) break;
      }
    }
  }

  // After-hours call-outs relative to "now": one crew on site, one tech driving in.
  tickets.push(planFieldTicket(0, P("wade-pruitt"), [P("wade-pruitt"), P("mateo-silva"), P("travis-boone")], WORK_TYPES.find((w) => w.key === "flowline")!, "rbl-7-3h", addMin(NOW, -55), P("wade-pruitt"), "partner_self_service"));
  tickets.push(planFieldTicket(0, P("sam-kowalski"), [P("sam-kowalski")], WORK_TYPES.find((w) => w.key === "wellhead")!, "adr-ctb", addMin(NOW, 25), null, "partner_self_service"));

  // ---------------- hotlist (GasGo posts; FieldGo / FleetGo bid; awards become tickets)
  type HotJob = { title: string; wt: WorkTypeSpec; siteKey: string; postedD: number; status: "open" | "awarded"; bids: { org: "fieldgo" | "fleetgo"; amount: number; eta: number; status: string; notes: string }[]; ticket?: TicketPlan };
  const hot: HotJob[] = [];
  const hotTitles: [string, string, string][] = [
    ["Replace corroded header manifold", "roustabout", "adr-ctb"], ["Rebuild pumping unit gearbox seals", "pumping-unit", "cpk-15-4h"],
    ["Install new SCADA pressure transmitters (6)", "instrumentation", "crg-ctb"], ["Lease road pothole repair — 1.2 mi", "backhoe", "mft-4-1h"],
    ["Flowline reroute around new pad", "flowline", "rbl-7-3h"], ["Tank battery berm rebuild (SPCC)", "tank-battery", "crg-ctb"],
    ["Wellhead conversion to plunger lift", "wellhead", "shl-22-3h"], ["Location cleanup after workover rig move", "cleanup", "adr-12-2h"],
    ["Emergency valve replacement — sales line", "valve", "adr-ctb"], ["Install wind sock and signage (H2S)", "roustabout", "dck-31-2h"],
    ["Paint and label all risers — Windmill 18", "roustabout", "wml-18-1h"], ["Frac water transfer support — 3 days", "pw-haul", "rbl-7-3h"],
    ["Stage frac tanks at Mustang Flats", "hotshot", "stanton-yard"], ["Pump-off controller retrofit (4 wells)", "instrumentation", "cpk-15-4h"],
  ];
  hotTitles.forEach(([title, wk, sk], i) => {
    const wt = WORK_TYPES.find((w) => w.key === wk)!;
    const postedD = 28 - i * 2;
    const awarded = postedD > 4 && i % 5 !== 3;
    const org = wt.vendor === "fleetgo" ? "fleetgo" : "fieldgo";
    const est = wt.unit === "per_job" ? wt.price * int(1, 3) : wt.price * int(16, 60);
    const job: HotJob = { title, wt, siteKey: sk, postedD, status: awarded ? "awarded" : "open", bids: [{ org, amount: est, eta: int(1, 5), status: awarded ? "awarded" : "pending", notes: `${ORGS[org].name} can mobilize within ${int(1, 3)} days. Synthetic bid.` }] };
    if (org === "fieldgo" && chance(0.4)) job.bids.push({ org: "fleetgo", amount: round2(est * 1.2), eta: int(2, 6), status: awarded ? "declined" : "pending", notes: "Alternate equipment-only bid. Synthetic." });
    if (awarded && org === "fieldgo") {
      const d = postedD - int(2, 4);
      const crewLead = wt.crewSize[1] > 2 ? P("hector-ruiz") : techs.find((x) => techSpecialty[x.key]?.includes(wk)) ?? P("sam-kowalski");
      const crew = crewLead.key === "hector-ruiz" ? [crewLead, ...crewA.filter((m) => m.key !== "hector-ruiz" && !absent(m.key, d)).slice(0, 3)] : [crewLead];
      const keys = new Set(crew.map((m) => m.key));
      const busyUntil = tickets.filter((x) => x.d === d && x.crew.some((m) => keys.has(m.key))).reduce((m, x) => Math.max(m, (x.checkOut ?? addMin(x.scheduled, x.durationMin)).getTime()), 0);
      const t = planFieldTicket(d, crewLead, crew, wt, sk, new Date(Math.max(at(d, 12, 30).getTime(), busyUntil + int(30, 50) * 60e3)), crewLead.key === "hector-ruiz" ? crewLead : null, "partner_hotlist");
      tickets.push(t);
      job.ticket = t;
    }
    hot.push(job);
  });

  // ---------------- fleet runs + fleet tickets
  const fleetVendorId = vendorIds.fleetgo;
  const fleetId = uuid("fleet:permian");
  const destObjs = DESTINATIONS.map((x, i) => FleetDestinationSchema.parse({ id: uuid(`dest:${x.key}`), revision: 1, name: x.name, kind: x.kind, address: `${x.name}, Martin County, TX (fictional)`, latitude: x.lat, longitude: x.lng, materials: x.materials, hours: x.hours, instructions: "Synthetic destination. Check in at the scale house; no real deliveries.", active: true, ownerType: "vendor", ownerId: fleetVendorId }));
  const padDrops = ["adr-12-1h", "mft-4-1h", "cpk-15-4h", "dck-31-2h"].map((k) => FleetDestinationSchema.parse({ id: uuid(`drop:${k}`), revision: 1, name: `${site(k).name} — equipment drop`, kind: "delivery", address: `${site(k).name}, Martin County, TX (fictional)`, latitude: site(k).lat, longitude: site(k).lng, materials: ["equipment"], hours: "Daylight — synthetic", instructions: "Call the company man before unloading. Synthetic.", active: true, ownerType: "partner", ownerId: partnerId }));
  const dest = (k: string) => destObjs[DESTINATIONS.findIndex((x) => x.key === k)];
  const yardPt: Pt = { lat: DESTINATIONS[3].lat, lng: DESTINATIONS[3].lng };
  const drivers = byOrg("fleetgo").filter((p) => p.title === "CDL Driver");
  const driverTruck: Record<string, { truck: string; trailer: string | null; type: "vac" | "crude" | "hotshot" }> = {
    "bobby-jenkins": { truck: "u101", trailer: null, type: "vac" }, "ray-alvarado": { truck: "u102", trailer: "t31", type: "vac" },
    "kenny-watts": { truck: "u103", trailer: null, type: "vac" }, "omar-haddad": { truck: "u104", trailer: "t32", type: "vac" },
    "shane-mcbride": { truck: "u105", trailer: null, type: "vac" }, "victor-pena": { truck: "u201", trailer: "t11", type: "crude" },
    "trent-dawson": { truck: "u202", trailer: "t12", type: "crude" }, "alicia-romero": { truck: "u301", trailer: "t21", type: "hotshot" },
  };
  const u105Down = (d: number) => d <= 4 || (d >= 18 && d <= 20);
  type Run = { id: string; d: number; driver: Person; truck: string; trailer: string | null; type: "vac" | "crude" | "hotshot"; originKey: string; destination: any; wt: WorkTypeSpec; events: any[]; points: { lat: number; lng: number; t: Date; acc: number }[]; loads: any[]; inspections: any[]; records: any[]; stops: any[]; status: string; phase: string | null; currentStopId: string | null; visited: string[]; ticket?: TicketPlan; billingQty: number; arrivePickup: Date | null; departPickup: Date | null; acceptAt: Date | null; dispatchedAt: Date; reviewer: Person; returned: boolean; cancelled: boolean; reassignedFrom?: Person; lastAt: Date };
  const runs: Run[] = [];
  const fleetTickets = new Map<string, TicketPlan>();
  let meter: Record<string, number> = Object.fromEntries(FLEET_ASSETS.map((a) => [a.key, int(180000, 420000)]));
  const ev = (run: Run, type: string, actor: Person, t: Date, details: Record<string, unknown> = {}) => run.events.push({ id: uuid(`ev:${run.id}:${run.events.length}`), operationId: uuid(`op:${run.id}:${run.events.length}`), type, actorUserId: actor.userId, recordedAt: t.toISOString(), source: "user_report", details });
  function fleetTicketFor(run: Run, firstEventAt: Date): TicketPlan {
    const s = site(run.originKey);
    const mode = run.type === "hotshot" ? "singles" : s.fleetMode;
    const key = mode === "batch" ? `fleet:${run.originKey}:${run.wt.key}:${run.d}` : `fleet:run:${run.id}`;
    let t = fleetTickets.get(key);
    if (t) return t;
    t = {
      key, org: "fleetgo", d: run.d, siteKey: run.originKey, wt: run.wt, lead: run.driver, crew: [run.driver], foreman: null, intake: "office_on_behalf_of_partner",
      createdBy: P("javier-soto"), createdAt: firstEventAt, scheduled: firstEventAt, durationMin: 60, history: [], status: "initiated", lifecycle: "pending_arrival",
      enRoute: null, onLocation: null, checkIn: null, checkOut: null, closedAt: null, closedBy: null, approvedAt: null, cancelledAt: null, cancelledBy: null, preCancel: null,
      kickbackReason: null, dispersedAt: null, dispersedBy: null, paymentMethod: null, lines: [], gps: [], notes: [], mileage: null, truck: run.truck,
      fleetPlan: { mode, unit: run.wt.unit, afe: s.afe, workDate: workDate(run.d) },
    };
    fleetTickets.set(key, t);
    tickets.push(t);
    return t;
  }
  for (let d = HISTORY_DAYS - 1; d >= -1; d--) {
    const weekend = isWeekend(d);
    const dayNum = HISTORY_DAYS - 1 - d;
    for (const [i, driver] of drivers.entries()) {
      const offDay = (dayNum + i) % 7 === 5 || (dayNum + i * 2) % 7 === 6 || (weekend && i % 2 === 0) || (d === RAIN_DAY && i % 2 === 1);
      if (offDay) continue;
      let assign = { ...driverTruck[driver.key] };
      if (assign.truck === "u105" && u105Down(d)) assign = { truck: "u301", trailer: "t21", type: "hotshot" };
      if (driver.key === "alicia-romero" && u105Down(d)) continue; // Shane covers the hotshot while 105 is in the shop
      if (driver.key === "kenny-watts" && d >= 0 && d <= 1) continue; // DOT medical card renewal appointment
      const nRuns = d === -1 ? (chance(0.5) ? 2 : 1) : assign.type === "vac" ? (d === RAIN_DAY ? 2 : BUSY(d) ? int(5, 6) : int(4, 5)) : assign.type === "crude" ? int(2, 3) : int(1, 2);
      const nightShift = driver.key === "omar-haddad" && dayNum % 2 === 1;
      let pos: Pt = yardPt;
      let clock = nightShift ? at(d, 15, int(15, 40)) : at(d, 5, int(15, 40));
      const shiftEnd = addMin(clock, 13 * 60);
      let prev: Run | null = null;
      for (let r = 0; r < nRuns; r++) {
        if (prev && !["submitted_for_review", "completed", "cancelled"].includes(prev.status)) break;
        const wt = WORK_TYPES.find((w) => w.key === (assign.type === "vac" ? "pw-haul" : assign.type === "crude" ? "crude-haul" : "hotshot"))!;
        const originKey = assign.type === "hotshot" ? "stanton-yard" : assign.type === "crude" ? pick(["adr-ctb", "crg-ctb"]) : weighted(SITES.filter((s) => s.kind !== "yard"), (s) => (s.kind === "ctb" ? 10 : s.fleetMode === "batch" ? 3 : 1)).key;
        const o = site(originKey);
        const destination = assign.type === "hotshot" ? pick(padDrops) : assign.type === "crude" ? dest("midland-crude") : miles(o, DESTINATIONS[0]) < miles(o, DESTINATIONS[1]) || clock > at(d, 20) ? dest("lone-mesa-swd") : dest("cr1200-swd");
        const id = uuid(`run:${driver.key}:${d}:${r}`);
        const pickupStop = uuid(`stop:${id}:pickup`), deliveryStop = uuid(`stop:${id}:delivery`);
        const dispatcher = chance(0.8) ? P("javier-soto") : P("tanya-brooks");
        const dispatchedAt = r === 0 ? addMin(at(d + 1, 18), int(0, 120)) : addMin(clock, -int(15, 45));
        const run: Run = {
          id, d, driver, truck: assign.truck, trailer: assign.trailer, type: assign.type, originKey, destination, wt, events: [], points: [], loads: [], inspections: [], records: [],
          stops: [{ id: pickupStop, siteId: siteIds[originKey], kind: "pickup", sequence: 0 }, { id: deliveryStop, siteId: siteIds[originKey], kind: "delivery", sequence: 1, destination }],
          status: "draft", phase: null, currentStopId: null, visited: [], billingQty: 1, arrivePickup: null, departPickup: null, acceptAt: null, dispatchedAt, reviewer: P("tanya-brooks"), returned: false, cancelled: false, lastAt: dispatchedAt,
        };
        runs.push(run);
        prev = run;
        const step = (t: Date, fn: () => void) => { if (past(t)) { fn(); run.lastAt = t; return true; } return false; };
        if (!step(addMin(dispatchedAt, -int(2, 10)), () => ev(run, "created", dispatcher, addMin(dispatchedAt, -5)))) { run.status = "draft"; continue; }
        if (!step(dispatchedAt, () => { run.status = "dispatched"; ev(run, "dispatch", dispatcher, dispatchedAt); })) continue;
        let redispatchAt: Date | null = null;
        if (chance(0.02) && d > 0) { const other = drivers.find((x) => x.key !== driver.key && driverTruck[x.key].type === assign.type); if (other) { const t0 = addMin(dispatchedAt, int(5, 30)); redispatchAt = addMin(t0, 1); step(t0, () => { ev(run, "reassign", dispatcher, t0, { reason: `${other.first} out of hours — reassigned to ${driver.first}`, priorAssignment: { driverUserId: other.userId } }); ev(run, "dispatch", dispatcher, addMin(t0, 1)); }); run.reassignedFrom = other; } }
        if (chance(0.03) && d > 0) { const t0 = addMin(dispatchedAt, int(20, 90)); if (step(t0, () => { run.status = "cancelled"; run.cancelled = true; ev(run, "cancel", dispatcher, t0, { reason: pick(["Battery tanks below haul level", "SWD down for maintenance", "Company man cancelled — rig moving"]) }); })) continue; }
        const ackAt = addMin(r === 0 ? addMin(clock, -int(18, 35)) : dispatchedAt, r === 0 ? 0 : int(2, 12));
        if (redispatchAt && ackAt <= redispatchAt) ackAt.setTime(redispatchAt.getTime() + int(2, 8) * 60e3);
        if (!step(ackAt, () => { run.status = "acknowledged"; ev(run, "acknowledge", driver, ackAt); })) continue;
        const startAt = new Date(Math.max(clock.getTime(), ackAt.getTime() + 60e3));
        if (r === 0) {
          const insp = addMin(startAt, -int(8, 15));
          const defect = (assign.truck === "u105" && d === 5) || (assign.truck === "u103" && d === 15);
          if (!step(insp, () => { run.inspections.push({ driverUserId: driver.userId, vehicleAssetId: assetIds[assign.truck], trailerAssetId: assign.trailer ? assetIds[assign.trailer] : null, outcome: defect ? "defect_reported" : "passed", notes: defect ? (assign.truck === "u105" ? "Turbo whining, losing boost on grade. Reporting to shop." : "Right rear outer tire sidewall bulge.") : "Pre-trip complete. Lights, brakes, hoses, valves OK.", recordedByUserId: driver.userId, recordedAt: insp.toISOString(), source: "user_report" }); ev(run, "inspect", driver, insp, { notes: "Pre-trip" }); })) continue;
          meter[assign.truck] += int(5, 30);
          step(addMin(insp, 2), () => { run.records.push({ id: uuid(`meter:${id}`), vehicleAssetId: assetIds[assign.truck], kind: "meter", quantity: null, reading: meter[assign.truck], unit: "mi", notes: "Start-of-day odometer", recordedByUserId: driver.userId, recordedAt: addMin(insp, 2).toISOString(), capturedAt: null, source: "user_report" }); ev(run, "record_meter", driver, addMin(insp, 2)); });
        }
        if (!step(startAt, () => { run.status = "in_progress"; run.phase = "traveling_to_pickup"; ev(run, "start", driver, startAt); })) continue;
        const leg1 = drive(pos, o, startAt);
        run.points.push(...leg1.points.filter((p) => past(p.t)));
        const arriveP = addMin(leg1.arrive, int(1, 4));
        if (!step(arriveP, () => { run.currentStopId = pickupStop; run.phase = "at_pickup"; run.arrivePickup = arriveP; ev(run, "arrive_stop", driver, arriveP); })) continue;
        const qty = assign.type === "vac" ? int(105, 130) : assign.type === "crude" ? int(165, 180) : 1;
        const loadAt = addMin(arriveP, int(3, 8));
        const loadId = uuid(`load:${id}`);
        const manifest = `${assign.type === "crude" ? "BOL" : "MAN"}-${workDate(d).replace(/-/g, "")}-${String(runs.length).padStart(4, "0")}`;
        if (!step(loadAt, () => { run.loads.push({ id: loadId, pickupStopId: pickupStop, deliveryStopId: null, commodity: assign.type === "vac" ? "Produced water" : assign.type === "crude" ? "Crude oil" : pick(["Pump jack motor", "500 bbl frac tank", "Pipe rack (40 joints)", "Generator 45 kVA"]), quantity: qty, unit: assign.type === "hotshot" ? "load" : "bbl", manifestReference: manifest, deliveryReference: null, recordedByUserId: driver.userId, recordedAt: loadAt.toISOString(), deliveredAt: null, source: "user_report" }); run.phase = "loading"; ev(run, "record_load", driver, loadAt); })) continue;
        const departP = addMin(loadAt, assign.type === "vac" ? int(18, 32) : assign.type === "crude" ? int(28, 45) : int(15, 30));
        if (!step(departP, () => { run.visited.push(pickupStop); run.currentStopId = null; run.phase = "traveling_to_next_stop"; run.departPickup = departP; ev(run, "depart_stop", driver, departP); })) continue;
        const target = { lat: destination.latitude, lng: destination.longitude };
        const leg2 = drive(o, target, departP);
        run.points.push(...leg2.points.filter((p) => past(p.t)));
        meter[assign.truck] += Math.round(leg1.miles + leg2.miles);
        const waitSwd = destination.kind === "disposal" && chance(0.15) ? int(20, 45) : 0;
        const arriveD = addMin(leg2.arrive, int(1, 4) + waitSwd);
        if (!step(arriveD, () => { run.currentStopId = deliveryStop; run.phase = "at_delivery"; ev(run, "arrive_stop", driver, arriveD, waitSwd ? { notes: `Waited ${waitSwd} min in SWD line` } : {}); })) continue;
        const delivAt = addMin(arriveD, int(10, 22));
        if (!step(delivAt, () => { const l = run.loads[0]; l.deliveryStopId = deliveryStop; l.deliveryReference = `${destination.kind === "disposal" ? "SWD-TKT" : "RCPT"}-${int(100000, 999999)}`; l.deliveredAt = delivAt.toISOString(); run.phase = "unloading"; ev(run, "record_delivery", driver, delivAt); })) continue;
        if (r === 2 && assign.type !== "hotshot") { const fuelAt = addMin(delivAt, 2); step(fuelAt, () => { run.records.push({ id: uuid(`fuel:${id}`), vehicleAssetId: assetIds[assign.truck], kind: "fuel", quantity: int(55, 95), reading: null, unit: "gal", notes: "Diesel — fleet card (synthetic)", recordedByUserId: driver.userId, recordedAt: fuelAt.toISOString(), capturedAt: null, source: "user_report" }); ev(run, "record_fuel", driver, fuelAt); }); }
        const departD = addMin(delivAt, int(4, 10));
        if (!step(departD, () => { run.visited.push(deliveryStop); run.currentStopId = null; run.phase = "traveling_to_next_stop"; ev(run, "depart_stop", driver, departD); })) continue;
        const closeAt = addMin(departD, int(1, 6));
        if (assign.type === "hotshot") run.billingQty = round2(Math.max(1, Math.ceil(((closeAt.getTime() - startAt.getTime()) / 3600e3) * 4) / 4));
        if (!step(closeAt, () => { run.status = "submitted_for_review"; run.phase = null; ev(run, "submit_closeout", driver, closeAt); })) { pos = target; clock = addMin(departD, 2); continue; }
        pos = target;
        clock = addMin(closeAt, int(2, 8));
        const reviewAt = chance(0.6) ? addMin(at(d - 1, 7, 30), int(0, 90)) : addMin(closeAt, int(30, 180));
        run.returned = chance(0.04);
        if (run.returned) {
          if (!step(reviewAt, () => { run.status = "in_progress"; ev(run, "review", run.reviewer, reviewAt, { decision: "return", reason: "Manifest number does not match SWD ticket — please correct." }); })) continue;
          const fixAt = addMin(reviewAt, int(30, 240));
          if (!step(fixAt, () => { run.status = "submitted_for_review"; ev(run, "submit_closeout", driver, fixAt, { notes: "Corrected manifest reference" }); })) continue;
          const re = addMin(fixAt, int(30, 300));
          step(re, () => { run.status = "completed"; run.acceptAt = re; ev(run, "review", run.reviewer, re, { decision: "accept", reason: "Corrected — accepted" }); });
        } else step(reviewAt, () => { run.status = "completed"; run.acceptAt = reviewAt; ev(run, "review", run.reviewer, reviewAt, { decision: "accept", reason: "Manifest and SWD ticket match" }); });
        if (clock > addMin(shiftEnd, -150)) break;
      }
    }
  }
  // Runs whose creation is still in the future do not exist yet.
  for (let i = runs.length - 1; i >= 0; i--) if (!runs[i].events.length) runs.splice(i, 1);
  // Billing: every non-draft, non-cancelled run belongs to a ticket (new or shared).
  for (const run of runs) {
    if (run.status === "draft" || run.cancelled) continue;
    const t = fleetTicketFor(run, run.dispatchedAt);
    run.ticket = t;
    if (!t.crew.some((c) => c.key === run.driver.key)) t.crew.push(run.driver);
    if (run.arrivePickup && (!t.checkIn || run.arrivePickup < t.checkIn)) t.checkIn = run.arrivePickup;
    if (run.departPickup && (!t.checkOut || run.departPickup > t.checkOut)) t.checkOut = run.departPickup;
    if (run.acceptAt) t.lines.push({ type: "other", description: `Fleet run ${run.id}`, quantity: run.billingQty, unitPrice: run.wt.price, at: run.acceptAt, runId: run.id });
  }
  for (const t of fleetTickets.values()) {
    const tRuns = runs.filter((r) => r.ticket === t);
    const allReviewed = tRuns.every((r) => r.status === "completed" || r.cancelled);
    const lastAccept = tRuns.reduce((m, r) => (r.acceptAt && r.acceptAt > m ? r.acceptAt : m), new Date(0));
    const steps: Parameters<typeof settle>[1] = [{ to: "initiated", at: t.createdAt, by: P("javier-soto"), role: "vendor" }];
    if (allReviewed && lastAccept.getTime() > 0) {
      const finalize = addMin(new Date(Math.max(lastAccept.getTime(), at(t.d - 1, 9).getTime())), int(10, 120));
      const approver = gasgoApprover();
      const approve = addMin(finalize, int(60 * 10, 60 * 72));
      const kick = chance(0.06);
      const kickAt = addMin(finalize, int(60 * 4, 60 * 30));
      const resub = addMin(kickAt, int(60 * 2, 60 * 20));
      const approveFinal = kick ? addMin(resub, int(60 * 8, 60 * 40)) : approve;
      const awaiting = addMin(approveFinal, int(60 * 20, 60 * 72));
      const disperse = addMin(awaiting, int(60 * 24 * 10, 60 * 24 * 25));
      steps.push({ to: "submitted", at: finalize, by: P(chance(0.5) ? "tanya-brooks" : "monica-reyes"), role: "vendor", reason: "Finalize and submit ticket" });
      if (kick) {
        const reason = "AFE on ticket does not match the site's current AFE — please confirm.";
        steps.push({ to: "kicked_back", at: kickAt, by: approver, role: "partner", reason, apply: () => { t.kickbackReason = reason; } });
        steps.push({ to: "submitted", at: resub, by: P("monica-reyes"), role: "vendor", reason: "AFE confirmed with GasGo and resubmitted" });
      }
      steps.push({ to: "approved", at: approveFinal, by: approver, role: "partner", apply: () => { t.approvedAt = approveFinal; } });
      steps.push({ to: "awaiting_payment", at: awaiting, by: P("priya-raman"), role: "partner" });
      steps.push({ to: "funds_dispersed", at: disperse, by: P("priya-raman"), role: "partner", apply: () => { t.dispersedAt = disperse; t.dispersedBy = P("priya-raman"); t.paymentMethod = "ach"; } });
    }
    settle(t, steps);
    t.lifecycle = ["initiated"].includes(t.status) ? "pending_arrival" : "off_site";
    if (t.status !== "initiated") t.closedAt = t.history.find((h) => h.to === "submitted")?.at ?? null;
    t.closedBy = t.closedAt ? P("tanya-brooks") : null;
  }

  // ---------------- gate coverage tickets (GateGo bills each post-day per station)
  const gateWt = WORK_TYPES.find((w) => w.key === "gate-coverage")!;
  for (const sk of Object.keys(stations)) {
    for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
      const dayPosts = posts.filter((p) => p.stationKey === sk && p.d === d && p.user && p.actualStart);
      if (!dayPosts.length) continue;
      const created = addMin(at(d + 1, 15), int(0, 90));
      const t: TicketPlan = {
        key: `gate:${sk}:${d}`, org: "gatego", d, siteKey: sk, wt: gateWt, lead: dayPosts[0].user!, crew: [...new Map(dayPosts.map((p) => [p.user!.key, p.user!])).values()], foreman: null,
        intake: "office_on_behalf_of_partner", createdBy: P("amber-cole"), createdAt: created, scheduled: at(d, 6), durationMin: 24 * 60, history: [], status: "initiated", lifecycle: "pending_arrival",
        enRoute: null, onLocation: null, checkIn: dayPosts[0].actualStart, checkOut: dayPosts.every((p) => p.actualEnd) ? dayPosts[dayPosts.length - 1].actualEnd : null, closedAt: null, closedBy: null,
        approvedAt: null, cancelledAt: null, cancelledBy: null, preCancel: null, kickbackReason: null, dispersedAt: null, dispersedBy: null, paymentMethod: null, lines: [], gps: [], notes: [], mileage: null,
      };
      const closed = t.checkOut ? addMin(t.checkOut, int(10, 60)) : null;
      const monday = (() => { let x = d - 1; while (dow(x) !== 1) x--; return x; })();
      const submit = addMin(at(monday, 9), int(0, 120));
      const approve = addMin(submit, int(60 * 20, 60 * 96));
      const awaiting = addMin(approve, int(60 * 24, 60 * 72));
      const disperse = addMin(awaiting, int(60 * 24 * 10, 60 * 24 * 20));
      const steps: Parameters<typeof settle>[1] = [{ to: "initiated", at: created, by: P("amber-cole"), role: "vendor" }, { to: "in_progress", at: t.checkIn!, by: t.lead, role: "field_employee" }];
      if (closed) {
        steps.push({ to: "pending_review", at: closed, by: supervisor, role: "field_employee", apply: () => { t.closedAt = closed; t.closedBy = supervisor; } });
        steps.push({ to: "submitted", at: submit, by: P("sharon-pike"), role: "vendor" });
        steps.push({ to: "approved", at: approve, by: P("marcus-delgado"), role: "partner", apply: () => { t.approvedAt = approve; } });
        steps.push({ to: "awaiting_payment", at: awaiting, by: P("priya-raman"), role: "partner" });
        steps.push({ to: "funds_dispersed", at: disperse, by: P("priya-raman"), role: "partner", apply: () => { t.dispersedAt = disperse; t.dispersedBy = P("priya-raman"); t.paymentMethod = "ach"; } });
      }
      // in_progress is recorded at the first check-in, which precedes creation for same-day tickets; keep chronology.
      if (t.checkIn! < created) { t.createdAt = addMin(t.checkIn!, -int(60 * 10, 60 * 16)); steps[0].at = t.createdAt; }
      settle(t, steps);
      t.lifecycle = t.status === "in_progress" ? "on_site" : t.status === "initiated" ? "pending_arrival" : "off_site";
      for (const p of dayPosts) if (p.actualEnd) t.lines.push({ type: "labor", description: `Gate attendant — ${p.user!.name} (${p.shift} post)`, quantity: round2((p.actualEnd.getTime() - p.actualStart!.getTime()) / 3600e3), unitPrice: gateWt.price, at: p.actualEnd });
      tickets.push(t);
    }
  }

  // ======================================================================
  // Persist tickets and children
  // ======================================================================
  tickets.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const vendorIdFor = (t: TicketPlan) => vendorIds[t.org];
  const ticketRows = tickets.map((t) => {
    const s = site(t.siteKey);
    const lastHist = t.history.at(-1)?.at ?? t.createdAt;
    return {
      site_location_id: siteIds[t.siteKey], vendor_id: vendorIdFor(t), field_employee_id: t.lead.peopleId, work_type_id: wtIds[t.wt.key], status: t.status, intake_channel: t.intake,
      description: t.org === "fleetgo" ? `${t.wt.name} — ${s.name} (${t.fleetPlan.mode === "batch" ? `batch ${t.fleetPlan.workDate}` : "single run"})` : t.org === "gatego" ? `${t.wt.name} — ${s.name} — ${workDate(t.d)}` : `${t.wt.name} — ${s.name}`,
      notes: `${GO_MARKER} [${t.key}]`, kickback_reason: t.kickbackReason,
      check_in_time: t.checkIn, check_out_time: t.checkOut, check_in_latitude: t.checkIn ? s.lat : null, check_in_longitude: t.checkIn ? s.lng : null,
      check_out_latitude: t.checkOut ? s.lat : null, check_out_longitude: t.checkOut ? s.lng : null, lifecycle_state: t.lifecycle,
      en_route_at: t.enRoute, on_location_at: t.onLocation, on_location_latitude: t.onLocation ? s.lat + 0.0025 : null, on_location_longitude: t.onLocation ? s.lng - 0.0012 : null,
      arrived_at: t.checkIn, departure_latitude: t.checkOut ? s.lat : null, departure_longitude: t.checkOut ? s.lng : null,
      starting_mileage: t.mileage ? String(t.mileage[0]) : null, ending_mileage: t.mileage ? String(t.mileage[1]) : null,
      created_by_id: t.createdBy.userId, closed_by_id: t.closedBy?.userId ?? null, closed_at: t.closedAt, pre_cancel_status: t.preCancel, cancelled_at: t.cancelledAt, cancelled_by_id: t.cancelledBy?.userId ?? null,
      scheduled_start_at: t.scheduled, scheduled_duration_minutes: t.durationMin, foreman_user_id: t.foreman?.userId ?? null, scheduled_at: t.createdAt, scheduled_by_id: t.createdBy.userId,
      approved_at: t.approvedAt, payment_method: t.paymentMethod, payment_reference: t.dispersedAt ? `SYN-NOT-PAID-${t.key.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(-12)}` : null,
      payment_note: t.dispersedAt ? "Synthetic — no real money moved." : null, payment_dispersed_at: t.dispersedAt, payment_dispersed_by_id: t.dispersedBy?.userId ?? null,
      created_at: t.createdAt, updated_at: lastHist, unlock_count: 0,
    };
  });
  const inserted = await insertMany<{ id: number }>("tickets", ticketRows);
  tickets.forEach((t, i) => (t.id = inserted[i].id));
  // fleet plans need the ticket id's site/vendor/partner
  for (const t of tickets.filter((x) => x.org === "fleetgo")) {
    const plan = FleetTicketPlanSchema.parse({
      billingWorkflow: true, billingUnit: t.fleetPlan.unit, afeNumber: t.fleetPlan.afe, workDate: t.fleetPlan.workDate, version: 1, siteId: siteIds[t.siteKey], vendorId: fleetVendorId, partnerId,
      mode: t.fleetPlan.mode, rateCents: t.wt.price * 100, currency: "USD", closure: "manual", closesAt: null,
      destinations: t.wt.key === "hotshot" ? padDrops : t.wt.key === "crude-haul" ? [dest("midland-crude")] : [dest("lone-mesa-swd"), dest("cr1200-swd")],
      closedAt: t.status !== "initiated" ? t.closedAt?.toISOString() ?? null : null, createdByUserId: P("javier-soto").userId, createdAt: t.createdAt.toISOString(), operations: [],
    });
    await client.query("update tickets set fleet_plan=$2::jsonb where id=$1 and vendor_id=$3 and fleet_plan is null", [t.id, JSON.stringify(plan), fleetVendorId]);
  }
  await insertMany("ticket_status_history", tickets.flatMap((t) => t.history.map((h) => ({ ticket_id: t.id, from_status: h.from, to_status: h.to, actor_user_id: h.by, actor_role: h.role, reason: h.reason ?? null, created_at: h.at }))));
  await insertMany("ticket_crew", tickets.flatMap((t) => t.crew.map((m) => ({ ticket_id: t.id, employee_id: m.peopleId, added_by_user_id: t.createdBy.userId, added_at: t.createdAt, ack_status: "accepted", ack_at: addMin(t.createdAt, int(5, 90)) }))));
  await insertMany("ticket_check_ins", tickets.filter((t) => t.org !== "fleetgo" && t.checkIn).flatMap((t) => {
    const s = site(t.siteKey);
    if (t.org === "gatego") return posts.filter((p) => p.stationKey === t.siteKey && p.d === t.d && p.user && p.actualStart).map((p) => ({ ticket_id: t.id, employee_id: p.user!.peopleId, check_in_at: p.actualStart, check_out_at: p.actualEnd, check_in_latitude: s.lat, check_in_longitude: s.lng, check_out_latitude: p.actualEnd ? s.lat : null, check_out_longitude: p.actualEnd ? s.lng : null, hourly_rate_at_time: String(p.user!.hourlyRate ?? 19), source: "manual", created_at: p.actualStart }));
    return t.crew.map((m) => ({ ticket_id: t.id, employee_id: m.peopleId, check_in_at: addMin(t.checkIn!, m === t.lead ? 0 : int(0, 4)), check_out_at: t.checkOut, check_in_latitude: s.lat, check_in_longitude: s.lng, check_out_latitude: t.checkOut ? s.lat : null, check_out_longitude: t.checkOut ? s.lng : null, hourly_rate_at_time: String(m.hourlyRate ?? 25), source: "manual", created_at: t.checkIn }));
  }));
  const lineRows = tickets.flatMap((t) => t.lines.map((l) => ({ ticket_id: t.id, type: l.type, description: l.description, quantity: String(l.quantity), unit_price: String(l.unitPrice), tax_rate: l.type === "part" ? "0.0625" : null, created_at: l.at, _run: l.runId })));
  const lineIds = await insertMany<{ id: number }>("ticket_line_items", lineRows.map(({ _run, ...r }) => r));
  const runLine = new Map<string, number>();
  lineRows.forEach((l, i) => l._run && runLine.set(l._run, lineIds[i].id));
  const lineId = new Map<object, number>();
  tickets.flatMap((t) => t.lines).forEach((l, i) => lineId.set(l, lineIds[i].id));
  await insertMany("gps_logs", tickets.flatMap((t) => t.gps.map((g) => ({ ticket_id: t.id, latitude: g.lat, longitude: g.lng, event_type: g.type, recorded_at: g.at }))));
  await insertMany("ticket_note_logs", tickets.flatMap((t) => t.notes.filter((n) => past(n.at)).map((n) => ({ ticket_id: t.id, content: n.content, created_by_id: n.by.userId, created_at: n.at }))));
  const flagged = tickets.filter((t) => t.flagged);
  if (flagged.length) {
    const flagCols = await columns("ticket_flags");
    await insertMany("ticket_flags", flagged.map((t) => ({ ticket_id: t.id, flagged_by_user_id: P("marcus-delgado").userId, actor_role: "partner", ...(flagCols.has("reason") ? { reason: "Repeat kick-back — review crew documentation" } : {}), ...(flagCols.has("created_at") ? { created_at: t.history.find((h) => h.to === "kicked_back")!.at } : {}) })));
  }
  const nudgeRows: Record<string, unknown>[] = [];
  for (const t of tickets) {
    if (t.status === "pending_review" && t.d >= 2) nudgeRows.push({ ticket_id: t.id, actor_user_id: P("earl-tatum").userId, actor_role: "partner", direction: "down", target_tier: "vendor_office", ticket_status: t.status, created_at: addMin(at(t.d - 2, 10), int(0, 120)) });
    if (t.status === "in_progress" && t.org === "fieldgo" && t.d >= 1) nudgeRows.push({ ticket_id: t.id, actor_user_id: P("brenda-nguyen").userId, actor_role: "vendor", direction: "down", target_tier: "field", ticket_status: t.status, created_at: addMin(at(t.d - 1, 8), int(0, 60)) });
  }
  if (nudgeRows.length) {
    const nc = await columns("ticket_nudges");
    await insertMany("ticket_nudges", nudgeRows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => nc.has(k)))));
  }
  const ratingTargets = tickets.filter((t) => t.approvedAt && t.org === "fieldgo" && chance(0.25));
  await insertMany("vendor_ratings", ratingTargets.map((t) => ({ vendor_id: vendorIds.fieldgo, partner_id: partnerId, user_id: P("earl-tatum").userId, ticket_id: t.id, rating: weighted([3, 4, 5], (r) => (r === 5 ? 6 : r === 4 ? 3 : 1)), review: pick(["Clean location, good documentation.", "Crew showed up on time and worked safe.", "Good work; JSA was late.", "Fast turnaround on the valve swap."]), created_at: addMin(t.approvedAt!, int(30, 600)) })));

  // ---------------- hotlist
  for (const h of hot) {
    const s = site(h.siteKey);
    const created = addMin(at(h.postedD, 9), int(0, 300));
    const job = await insertOne("hotlist_jobs", { partner_id: partnerId, work_type_id: wtIds[h.wt.key], title: h.title, description: `${h.title} at ${s.name}. Scope and safety requirements attached in synthetic packet. ${GO_MARKER}`, location_address: `${s.name}, ${s.county} County, TX (fictional)`, latitude: s.lat, longitude: s.lng, deadline: workDate(h.postedD - 5), estimated_duration_days: int(1, 5), status: "open", created_at: created });
    const bidRows = await insertMany<{ id: number }>("hotlist_bids", h.bids.map((b, i) => ({ job_id: job.id, vendor_id: vendorIds[b.org], amount_usd: String(b.amount), eta_days: b.eta, notes: b.notes, status: b.status, created_at: addMin(created, int(60, 60 * 30) + i * 90) })));
    if (h.status === "awarded") {
      const winner = h.bids.findIndex((b) => b.status === "awarded");
      await client.query("update hotlist_jobs set status='awarded', awarded_bid_id=$2, awarded_vendor_id=$3, converted_ticket_id=$4 where id=$1 and partner_id=$5", [job.id, bidRows[winner].id, vendorIds[h.bids[winner].org], h.ticket?.id ?? null, partnerId]);
    }
  }

  // ---------------- gate: duty sessions, posts as Work Hub shifts, visits
  const gateVendor = vendorIds.gatego;
  await insertMany("work_hub_shifts", posts.map((p) => ({ id: p.shiftId, owner_org_type: "vendor", owner_org_id: gateVendor, title: `${site(p.stationKey).name} — ${p.shift === "day" ? "Day" : "Night"} gate post`, starts_at: p.start, ends_at: p.end, timezone: GO_TIMEZONE, open: !p.user, qualification_codes: ["Texas Level II Security"], instructions: "Log every entry and exit. Confirm H2S briefing for first-time visitors. Synthetic.", site_location_id: siteIds[p.stationKey], gate_station_id: stations[p.stationKey], required_staff_count: 1, created_by_id: P("amber-cole").userId, created_at: addMin(p.start, -60 * 24 * int(7, 12)) })), "id");
  await insertMany("work_hub_shift_assignments", posts.filter((p) => p.user).map((p) => ({ shift_id: p.shiftId, user_id: p.user!.userId, assigned_by_id: P("amber-cole").userId })), "id");
  await insertMany("gate_duty_sessions", posts.filter((p) => p.user && p.actualStart).map((p) => ({ station_id: stations[p.stationKey], user_id: p.user!.userId, work_hub_shift_id: p.shiftId, started_at: p.actualStart, ended_at: p.actualEnd, ended_by_user_id: p.actualEnd ? p.user!.userId : null, end_reason: p.actualEnd ? "Shift handoff" : null, source: p.stationKey === "stanton-yard" ? "web" : "ios", idempotency_key: `${GO_VERSION}:${p.stationKey}:${p.d}:${p.shift}`, post_coverage: { vendorId: gateVendor, synthetic: true, late: p.late }, created_at: p.actualStart })), "id");
  type Visit = Record<string, unknown> & { check_in_time: Date };
  const visits: Visit[] = [];
  const baseVisit = (sk: string, t: Date) => {
    const st = site(sk);
    const who = onDuty(sk, t);
    return { site_location_id: siteIds[sk], host_type: "partner", host_partner_id: partnerId, check_in_time: t, check_in_latitude: st.lat + 0.0011, check_in_longitude: st.lng - 0.0004, recorded_by_user_id: who?.userId ?? null, observation_source: who ? "gatekeeper" : "geofence", reconciliation_state: who ? "not_required" : "needs_review", admission_status: "admitted", plate_state: "TX", created_at: t };
  };
  for (const t of tickets.filter((x) => x.org === "fieldgo" && site(x.siteKey).gated && x.onLocation)) {
    const inAt = addMin(t.onLocation!, -int(1, 3));
    const outAt = t.checkOut ? addMin(t.checkOut, int(2, 6)) : null;
    visits.push({ ...baseVisit(t.siteKey, inAt), first_name: t.lead.first, last_name: t.lead.last, phone: "(432) 555-0199", company: "FieldGo", vehicle_plate: plateOf(t.truck!), purpose: `${t.wt.name} — ticket #${t.id}`, entry_category: "routine_vendor_work", expected_duration_minutes: t.durationMin, check_out_time: outAt, check_out_latitude: outAt ? site(t.siteKey).lat : null, check_out_longitude: outAt ? site(t.siteKey).lng : null, safety_acknowledged_at: inAt, notes: `${t.crew.length} in vehicle. [${GO_VERSION}]` });
  }
  for (const r of runs.filter((x) => site(x.originKey).gated && x.arrivePickup)) {
    const inAt = addMin(r.arrivePickup!, -1);
    const outAt = r.departPickup ? addMin(r.departPickup, 1) : null;
    visits.push({ ...baseVisit(r.originKey, inAt), first_name: r.driver.first, last_name: r.driver.last, phone: "(432) 555-0299", company: "FleetGo", vehicle_plate: plateOf(r.truck), purpose: `${r.wt.name} — run ${r.id.slice(0, 8)}`, entry_category: "routine_vendor_work", expected_duration_minutes: 45, check_out_time: outAt, check_out_latitude: outAt ? site(r.originKey).lat : null, check_out_longitude: outAt ? site(r.originKey).lng : null, safety_acknowledged_at: inAt, observed_arrival_at: inAt, observed_departure_at: outAt, notes: `Trailer ${r.trailer ? plateOf(r.trailer) : "none"}. [${GO_VERSION}]` });
  }
  const outsiders = [
    { company: "Permian Chemical Supply (fictional)", purpose: "Chemical delivery — corrosion inhibitor", cat: "visitor", ctb: 0.6, yard: 0.2, people: [["Rick", "Hale"], ["Stacy", "Moon"]] },
    { company: "Basin Wireline (fictional)", purpose: "Wireline — slickline run", cat: "visitor", ctb: 0.15, yard: 0, people: [["Lonnie", "Pratt"]] },
    { company: "West Texas Electric Co-op (fictional)", purpose: "Meter read / line work", cat: "visitor", ctb: 0.2, yard: 0.1, people: [["Gil", "Ybarra"]] },
    { company: "Midland Crude Purchasing (fictional)", purpose: "Gauger — tank strap and sample", cat: "visitor", ctb: 1.2, yard: 0, people: [["Hank", "Lowry"], ["Bea", "Quiroga"]] },
    { company: "Railroad Commission District 8 (fictional)", purpose: "Field inspection", cat: "visitor", ctb: 0.08, yard: 0.05, people: [["Inspector", "Dunn"]] },
    { company: "Lone Star Survey Co. (fictional)", purpose: "Pipeline survey", cat: "visitor", ctb: 0.1, yard: 0.05, people: [["Kurt", "Ames"]] },
    { company: "Stanton Parts & Supply (fictional)", purpose: "Parts delivery", cat: "visitor", ctb: 0.1, yard: 2.5, people: [["Joe", "Briggs"], ["Ana", "Lugo"]] },
    { company: "GasGo", purpose: "Lease operator rounds", cat: "partner_admin", ctb: 1.5, yard: 3, people: [["Lena", "Okafor"], ["Earl", "Tatum"], ["Marcus", "Delgado"]] },
    { company: "FieldGo", purpose: "Office visit — job walk", cat: "vendor_admin", ctb: 0.1, yard: 0.4, people: [["Ray", "Castillo"], ["Brenda", "Nguyen"]] },
    { company: "FleetGo", purpose: "Office visit — dispatch planning", cat: "vendor_admin", ctb: 0.05, yard: 0.3, people: [["Curtis", "Lyle"], ["Tanya", "Brooks"]] },
  ];
  for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
    for (const sk of Object.keys(stations)) {
      const kind = site(sk).kind;
      for (const o of outsiders) {
        const lambda = (kind === "yard" ? o.yard : o.ctb) * (isWeekend(d) ? 0.35 : 1) * (d === RAIN_DAY ? 0.4 : 1);
        let n = Math.floor(lambda) + (chance(lambda - Math.floor(lambda)) ? 1 : 0);
        while (n-- > 0) {
          const night = o.company.includes("Crude") && chance(0.3);
          const inAt = night ? at(d, int(19, 23), int(0, 59)) : at(d, int(7, 16), int(0, 59));
          if (!past(inAt)) continue;
          const stay = int(15, 120);
          let outAt: Date | null = addMin(inAt, stay);
          let auto = false;
          if (!past(outAt)) outAt = null;
          else if (chance(0.03)) { outAt = addMin(inAt, 12 * 60); auto = true; }
          else if (chance(0.03) && d > 1) outAt = null;
          const [first, last] = pick(o.people);
          visits.push({ ...baseVisit(sk, inAt), first_name: first, last_name: last, phone: `(432) 555-${int(2000, 9999)}`, company: o.company, vehicle_plate: `${pick(["HJK", "PLM", "RTX", "BVN", "QWE", "DMX"])}-${int(1000, 9999)}`, purpose: o.purpose, entry_category: chance(0.1) ? null : o.cat, expected_duration_minutes: stay, check_out_time: outAt && past(outAt) ? outAt : null, auto_checked_out: auto, safety_acknowledged_at: inAt, notes: `[${GO_VERSION}]` });
        }
      }
      if (chance(isWeekend(d) ? 0.1 : 0.25)) {
        const inAt = at(d, int(9, 17), int(0, 59));
        if (past(inAt)) visits.push({ ...baseVisit(sk, inAt), first_name: "Unknown", last_name: "Driver", company: null, vehicle_plate: chance(0.5) ? `${pick(["XKR", "TYU"])}-${int(1000, 9999)}` : null, purpose: "No appointment — turned away", entry_category: "visitor", admission_status: "denied", check_out_time: addMin(inAt, int(2, 6)), notes: `Denied entry: no work order on file. [${GO_VERSION}]` });
      }
    }
  }
  for (const sk of Object.keys(stations)) {
    const inAt = addMin(NOW, -int(3, 12));
    visits.push({ ...baseVisit(sk, inAt), first_name: pick(["Dee", "Rob", "Sal"]), last_name: pick(["Marsh", "Kent", "Ruiz"]), company: "Stanton Parts & Supply (fictional)", vehicle_plate: `PLM-${int(1000, 9999)}`, purpose: "Parts delivery — awaiting host approval", entry_category: "visitor", admission_status: "pending", check_out_time: null, notes: `[${GO_VERSION}]` });
  }
  visits.sort((a, b) => a.check_in_time.getTime() - b.check_in_time.getTime());
  await insertMany("site_visits", visits);

  // ---------------- fleet state: open runs on the vendor row, every run snapshot + route in the audit store
  const fleets = [FleetDefinitionSchema.parse({ id: fleetId, name: "FleetGo Permian Fleet", siteIds: SITES.map((s) => siteIds[s.key]), equipmentAssetIds: FLEET_ASSETS.map((a) => assetIds[a.key]), requiredCertifications: ["CDL Class A", "DOT Medical Card"] })];
  const allSites = SITES.map((s) => siteIds[s.key]);
  const grants = [
    { userId: P("curtis-lyle").userId, fleetIds: [fleetId], siteIds: allSites, roles: ["fleet_manager", "dispatcher"], safetyRelease: true, financeRead: true },
    { userId: P("tanya-brooks").userId, fleetIds: [fleetId], siteIds: allSites, roles: ["fleet_manager", "dispatcher"], safetyRelease: true, financeRead: true },
    { userId: P("javier-soto").userId, fleetIds: [fleetId], siteIds: allSites, roles: ["dispatcher"], safetyRelease: false, financeRead: false },
    { userId: reviewer.id, fleetIds: [fleetId], siteIds: allSites, roles: ["fleet_manager", "dispatcher"], safetyRelease: false, financeRead: true },
    ...drivers.map((dr) => ({ userId: dr.userId, fleetIds: [fleetId], siteIds: allSites, roles: ["driver"], safetyRelease: false, financeRead: false })),
  ].map((g) => FleetGrantSchema.parse(g));
  const runDoc = (r: Run) => FleetRunSchema.parse({
    id: r.id, fleetId, companyId: fleetVendorId, title: `${r.wt.name.replace(" — per load", "")} · ${site(r.originKey).name} → ${r.destination.name}`, driverUserId: r.driver.userId,
    vehicleAssetId: assetIds[r.truck], trailerAssetId: r.trailer ? assetIds[r.trailer] : null, siteIds: [siteIds[r.originKey]], status: r.status, phase: r.status === "in_progress" ? r.phase : null,
    pausedFromPhase: null, records: r.records, version: Math.max(1, r.events.length), stops: r.stops, loads: r.loads, inspections: r.inspections, currentStopId: r.status === "in_progress" ? r.currentStopId : null,
    visitedStopIds: r.visited, events: r.events, linkedTicketId: r.ticket?.id ?? null, allowedActions: [],
    ...(r.ticket ? { billing: { afeNumber: site(r.originKey).afe, workDate: workDate(r.d), unit: r.wt.unit, ...(r.acceptAt ? { quantity: r.billingQty, billedLineId: runLine.get(r.id) ?? null } : {}) } } : {}),
  });
  const docs = runs.map((r) => ({ r, doc: runDoc(r) }));
  const openRuns = docs.filter(({ doc }) => !["completed", "cancelled"].includes(doc.status)).map(({ doc }) => doc);
  if (openRuns.length > 500) throw new Error(`Too many open runs (${openRuns.length})`);
  const fleetState = { version: 1, enabled: true, fleets, grants, supportGrants: [], runs: openRuns, preferences: [], operations: [] };
  const commercial = FleetCommercialSettingsSchema.parse({ version: 1, defaultMode: "batch", destinations: [...destObjs, ...padDrops], operations: [] });
  await client.query("update vendors set fleet_ops_state=$2::jsonb, fleet_commercial_settings=$3::jsonb where id=$1 and blurb=$4", [fleetVendorId, JSON.stringify(fleetState), JSON.stringify(commercial), GO_MARKER]);
  docs.sort((a, b) => a.r.lastAt.getTime() - b.r.lastAt.getTime());
  await insertMany("assistant_action_audit", docs.map(({ r, doc }) => ({ user_id: (doc.events.at(-1)?.actorUserId as number) ?? P("javier-soto").userId, vendor_id: fleetVendorId, client_surface: "fleet", input_mode: "typed", provider: "canonical", tool_name: "fleet_run", action_type: "fleet-run-snapshot", target_type: "fleet-run", target_id: r.id, tool_output: doc, result_status: "completed", created_at: r.lastAt })));
  const consentRows = Object.values(people).filter((p) => p.surface !== "web" && p.org !== "gasgo").map((p) => ({ user_id: p.userId, device_id: p.device, accepted_at: addMin(companySince, int(60, 60 * 24 * 30)) }));
  consentRows.push(...Object.values(people).filter((p) => p.org === "gasgo" && p.surface !== "web").map((p) => ({ user_id: p.userId, device_id: p.device, accepted_at: companySince })));
  await insertMany("location_consents", consentRows);
  const routeRows: Record<string, unknown>[] = [];
  for (const r of runs) {
    const assignment = JSON.stringify([r.id, fleetVendorId, r.driver.userId, assetIds[r.truck], r.trailer ? assetIds[r.trailer] : null]);
    r.points.forEach((pt, i) => {
      const observation = FleetLocationObservationSchema.parse({ runId: r.id, vehicleAssetId: assetIds[r.truck], driverUserId: r.driver.userId, latitude: pt.lat, longitude: pt.lng, accuracyMeters: pt.acc, recordedAt: pt.t.toISOString(), receivedAt: addMin(pt.t, 0.05).toISOString(), source: "driver_phone", freshness: "recent", physicalProofVerified: false });
      const operationId = uuid(`loc:${r.id}:${i}`);
      routeRows.push({ user_id: r.driver.userId, vendor_id: fleetVendorId, client_surface: "fleet", input_mode: "device", provider: "canonical", tool_name: "fleet_phone_location", action_type: "device-report", target_type: "fleet-location", target_id: r.id, tool_output: { operationId, fingerprint: createHash("sha256").update(operationId).digest("hex"), deviceId: r.driver.device, assignment, observation }, result_status: "completed", created_at: pt.t });
    });
  }
  routeRows.sort((a, b) => (a.created_at as Date).getTime() - (b.created_at as Date).getTime());
  await insertMany("assistant_action_audit", routeRows);

  // ---------------- invoices (weekly per vendor)
  const weekStart = (d: number) => { let x = d; while (dow(x) !== 1) x++; return x; }; // Monday on/before day d
  for (const org of ["fieldgo", "fleetgo", "gatego"] as const) {
    const billable = tickets.filter((t) => t.org === org && t.approvedAt);
    const weeks = new Map<number, TicketPlan[]>();
    for (const t of billable) { const w = weekStart(t.d); weeks.set(w, [...(weeks.get(w) ?? []), t]); }
    let seq = 0;
    for (const [w, ts] of [...weeks.entries()].sort((a, b) => b[0] - a[0])) {
      const start = at(w, 0), end = at(w - 6, 23, 59);
      const generated = addMin(new Date(Math.max(at(w - 7, 10).getTime(), ...ts.map((t) => t.approvedAt!.getTime()))), int(30, 300));
      if (!past(generated)) continue;
      const lines = ts.flatMap((t) => t.lines.map((l) => ({ t, l })));
      const subtotal = round2(lines.reduce((s, { l }) => s + l.quantity * l.unitPrice, 0));
      const tax = round2(lines.filter(({ l }) => l.type === "part").reduce((s, { l }) => s + l.quantity * l.unitPrice * 0.0625, 0));
      const total = round2(subtotal + tax);
      const allPaid = ts.every((t) => t.dispersedAt);
      const paidAt = allPaid ? new Date(Math.max(...ts.map((t) => t.dispersedAt!.getTime()))) : null;
      const due = addMin(generated, 60 * 24 * 30);
      const sentAt = addMin(generated, int(30, 600));
      const status = allPaid ? "paid" : !past(sentAt) ? "draft" : due < NOW ? "overdue" : "sent";
      const inv = await insertOne("invoices", {
        invoice_number: `${ORGS[org].name.toUpperCase()}-${workDate(w).replace(/-/g, "")}-${String(++seq).padStart(2, "0")}`, vendor_id: vendorIds[org], partner_id: partnerId, cadence: "weekly", status,
        period_start: start, period_end: end, due_date: due, payment_terms_days: 30, remit_to_address: ORGS[org].address, remit_to_name: ORGS[org].legal, subtotal: String(subtotal), tax_total: String(tax), total: String(total),
        paid_amount: allPaid ? String(total) : "0", billing_contact_email: "go-demo-priya-raman@example.invalid", notes: GO_MARKER, generated_at: generated, sent_at: status === "draft" ? null : sentAt, paid_at: paidAt,
        last_recomputed_at: generated, created_at: generated, updated_at: paidAt ?? generated,
      });
      await insertMany("invoice_ticket_links", ts.map((t) => ({ invoice_id: inv.id, ticket_id: t.id, approved_at: t.approvedAt })));
      await insertMany("invoice_lines", lines.map(({ t, l }, i) => ({ invoice_id: inv.id, ticket_id: t.id, source_type: "ticket_line_item", source_id: lineId.get(l), afe: site(t.siteKey).afe, sort_order: i, taxable: l.type === "part", tax_state: "TX", tax_rate: l.type === "part" ? "0.0625" : "0", tax_amount: l.type === "part" ? String(round2(l.quantity * l.unitPrice * 0.0625)) : "0", created_at: generated, line_type: l.type === "labor" ? "labor_regular" : l.type === "part" ? "materials" : l.type === "equipment" ? "equipment" : "other", description: `#${t.id} ${l.description}`, quantity: String(l.quantity), unit: t.wt.unit === "per_hour" && l.type === "labor" ? "hour" : "each", unit_price: String(l.unitPrice), amount: String(round2(l.quantity * l.unitPrice)) })));
      if (allPaid) await insertOne("invoice_payments", { invoice_id: inv.id, method: "ach", amount: String(total), paid_at: paidAt, ...((await columns("invoice_payments")).has("reference") ? { reference: `SYN-ACH-${inv.id}` } : {}) });
    }
  }

  // ---------------- safety events
  const safety = [
    { d: 26, type: "near_miss", site: "adr-ctb", title: "Dropped wrench from catwalk", desc: "12\" wrench fell from tank catwalk, landed 3 ft from a crew member. No injury. Tool lanyards issued.", by: "wade-pruitt", vendor: "fieldgo", status: "closed", hipo: true },
    { d: 21, type: "observation", site: "crg-ctb", title: "Gate left open after hours", desc: "Night attendant found the east cattle gate unlatched at 02:10. Latched and logged.", by: "dewayne-carter", vendor: "gatego", status: "closed" },
    { d: 15, type: "vehicle_incident", site: "rbl-7-3h", title: "Vac truck backed into cattle guard post", desc: "Unit 103 backed into a cattle guard post while turning around. Minor bumper damage; no fluids released.", by: "kenny-watts", vendor: "fleetgo", status: "resolved" },
    { d: 12, type: "property_damage", site: "crg-ctb", title: "Produced water spill inside berm (~4 bbl)", desc: "Dump valve failure released ~4 bbl inside the containment berm. Contained; FieldGo spill response and FleetGo vac truck recovered fluids.", by: "lena-okafor", vendor: "fieldgo", status: "under_review", stop: true },
    { d: 9, type: "unsafe_condition", site: "adr-ctb", title: "H2S monitor alarm at tank 3 thief hatch", desc: "Personal monitor alarmed at 12 ppm near open thief hatch. Area evacuated upwind; hatch gasket replaced.", by: "luis-garza", vendor: "fieldgo", status: "resolved", hipo: true },
    { d: 7, type: "injury", site: "shl-22-3h", title: "Hand laceration — first aid only", desc: "Roustabout cut left hand on burr while handling pipe. First aid on site; returned to work.", by: "hector-ruiz", vendor: "fieldgo", status: "closed", recordable: false },
    { d: 5, type: "vehicle_incident", site: "stanton-yard", title: "Unit 105 turbo failure on lease road", desc: "Driver reported loss of boost on grade during pre-trip; unit tagged out of service.", by: "shane-mcbride", vendor: "fleetgo", status: "under_review" },
    { d: 3, type: "unsafe_act", site: "crg-ctb", title: "Visitor drove past gate without stopping", desc: "Third-party pickup bypassed the attendant at 14:20. Plate logged; GasGo notified the contractor.", by: "maria-sanchez", vendor: "gatego", status: "submitted" },
    { d: 1, type: "near_miss", site: "cpk-15-4h", title: "Overhead line contact risk during equipment drop", desc: "Hotshot crane boom came within 10 ft of a power line. Spotter stopped the lift.", by: "alicia-romero", vendor: "fleetgo", status: "submitted", hipo: true },
    { d: 0, type: "observation", site: "adr-12-1h", title: "Lease road washout near cattle guard", desc: "Ruts 8–10 in. deep after rain. Recommend grading before heavy haul traffic.", by: "earl-tatum", vendor: null, status: "submitted" },
  ];
  await insertMany("safety_events", safety.filter((e) => past(at(e.d, 14))).map((e, i) => {
    const s = site(e.site);
    const created = addMin(at(e.d, 9), int(0, 400));
    const t = e.d === 12 ? tickets.find((x) => x.wt.key === "spill") : undefined;
    return { event_number: `SE-GG-${Y}-${String(i + 1).padStart(4, "0")}`, event_type: e.type, status: e.status, title: e.title, description: `${e.desc} Synthetic record.`, site_location_id: siteIds[e.site], partner_id: partnerId, vendor_id: e.vendor ? vendorIds[e.vendor as keyof typeof vendorIds] : null, ticket_id: t?.id ?? null, field_employee_id: e.vendor ? P(e.by).peopleId : null, reported_by_user_id: P(e.by).userId, is_high_potential: !!e.hipo, is_recordable: e.recordable ?? null, is_stop_work: !!e.stop, latitude: s.lat, longitude: s.lng, closed_at: e.status === "closed" ? addMin(created, 60 * 24 * int(2, 6)) : null, closed_by_user_id: e.status === "closed" ? P("marcus-delgado").userId : null, created_at: created, updated_at: addMin(created, 60) };
  }));

  // ---------------- Work Hub: channels, chatter, tasks, shifts, meetings, announcements
  type Ch = { id: string; org: OrgKey; name: string; members: Person[]; kind: string; ctx: string; vis: string };
  const channels: Ch[] = [];
  const mkCh = (org: OrgKey, key: string, name: string, members: Person[], kind = "organization", ctx?: string, vis = "organization") => { const c = { id: uuid(`ch:${key}`), org, name, members, kind, ctx: ctx ?? `${orgId(org)}:${uuid(`ch-op:${key}`)}`, vis }; channels.push(c); return c; };
  const crewIds = { a: uuid("crew:a"), b: uuid("crew:b") };
  await insertMany("work_hub_crews", [
    { id: crewIds.a, name: "Crew A — Hector Ruiz", owner_org_type: "vendor", owner_org_id: vendorIds.fieldgo, created_by_id: P("brenda-nguyen").userId, created_at: companySince },
    { id: crewIds.b, name: "Crew B — Wade Pruitt", owner_org_type: "vendor", owner_org_id: vendorIds.fieldgo, created_by_id: P("brenda-nguyen").userId, created_at: companySince },
  ], "id");
  await insertMany("work_hub_crew_members", [...crewA.map((m) => ({ crew_id: crewIds.a, user_id: m.userId, mode: m.vendorRole === "foreman" ? "owner" : "member" })), ...crewB.map((m) => ({ crew_id: crewIds.b, user_id: m.userId, mode: m.vendorRole === "foreman" ? "owner" : "member" }))], "id");
  const chGasOps = mkCh("gasgo", "gasgo-ops", "GasGo — Production Ops", byOrg("gasgo"));
  const chGasAp = mkCh("gasgo", "gasgo-ap", "GasGo — Accounts Payable", [P("priya-raman"), P("dana-whitfield"), P("marcus-delgado")], "organization", undefined, "private");
  const chFieldAll = mkCh("fieldgo", "fieldgo-all", "FieldGo — All Hands", byOrg("fieldgo"));
  const chCrewA = mkCh("fieldgo", "crew-a", "Crew A — Hector", [...crewA, P("brenda-nguyen")], "crew", `${crewIds.a}:${uuid("crew-ch:a")}`, "group");
  const chCrewB = mkCh("fieldgo", "crew-b", "Crew B — Wade", [...crewB, P("brenda-nguyen")], "crew", `${crewIds.b}:${uuid("crew-ch:b")}`, "group");
  const chFieldOffice = mkCh("fieldgo", "field-office", "FieldGo — Office", [P("ray-castillo"), P("brenda-nguyen"), P("kim-albright"), P("hector-ruiz"), P("wade-pruitt")], "organization", undefined, "private");
  const chFleetAll = mkCh("fleetgo", "fleetgo-all", "FleetGo — All Hands", byOrg("fleetgo"));
  const chDispatch = mkCh("fleetgo", "dispatch", "FleetGo — Dispatch Board", byOrg("fleetgo"));
  const chShop = mkCh("fleetgo", "shop", "FleetGo — Shop & Maintenance", [P("curtis-lyle"), P("tanya-brooks"), P("dale-hutchins"), P("javier-soto")], "organization", undefined, "private");
  const chGateAll = mkCh("gatego", "gatego-all", "GateGo — All Hands", byOrg("gatego"));
  const chGateSup = mkCh("gatego", "gate-sup", "GateGo — Supervisors", [P("sharon-pike"), supervisor, P("amber-cole")], "organization", undefined, "private");
  const chStation: Record<string, Ch> = {};
  for (const sk of Object.keys(stations)) chStation[sk] = mkCh("gatego", `gate-${sk}`, `Gate — ${site(sk).name}`, byOrg("gatego"), "gate", stations[sk], "group");
  await insertMany("work_hub_channels", channels.map((c) => ({ id: c.id, owner_org_type: c.org === "gasgo" ? "partner" : "vendor", owner_org_id: orgId(c.org), context_kind: c.kind, context_id: c.ctx, name: c.name, visibility: c.vis, created_by_id: c.members[0].userId, created_at: companySince, updated_at: companySince })), "id");
  await insertMany("work_hub_collaboration_channels", [{ channel_id: chCrewA.id, crew_id: crewIds.a, kind: "crew" }, { channel_id: chCrewB.id, crew_id: crewIds.b, kind: "crew" }], "channel_id");
  await insertMany("work_hub_channel_members", channels.flatMap((c) => [...new Map([...c.members, { userId: reviewer.id } as Person].map((m) => [m.userId, m])).values()].map((m) => ({ channel_id: c.id, user_id: m.userId, mode: "member", created_at: companySince }))), "id");
  const msgs: { channel: Ch; by: Person; at: Date; body: string }[] = [];
  const say = (channel: Ch, by: Person, t: Date, body: string) => { if (past(t)) msgs.push({ channel, by, at: t, body }); };
  for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
    const dayRuns = runs.filter((r) => r.d === d);
    const nextRuns = runs.filter((r) => r.d === d - 1);
    if (d === RAIN_DAY) { say(chFieldAll, P("ray-castillo"), at(d, 5, 30), "Heavy rain overnight — lease roads closed per GasGo. Crews stand by at the yard; techs only on paved access."); say(chDispatch, P("javier-soto"), at(d, 5, 10), "Rain day: half the trucks parked. SWD at County Road 1200 says their lot is flooded, route everything to Lone Mesa."); }
    if (dayRuns.length) {
      say(chDispatch, P("javier-soto"), at(d + 1, 19, int(0, 50)), `Tomorrow: ${dayRuns.length} loads planned — ${new Set(dayRuns.map((r) => r.driver.first)).size} drivers. First trucks roll 05:30. Check the board for your sequence.`);
      if (u105Down(d) && !u105Down(d + 1)) say(chShop, P("dale-hutchins"), at(d, 7, 40), "Unit 105 is tagged out — turbo is shot. Parts ETA 5–7 days. Shane moves to the hotshot.");
      for (const r of dayRuns.filter(() => chance(0.25))) if (r.arrivePickup) say(chDispatch, r.driver, addMin(r.arrivePickup, int(2, 25)), r.driver.key === "victor-pena" && chance(0.5) ? `Cargando en ${site(r.originKey).name}. Salgo en 30 min.` : pick([`Loading at ${site(r.originKey).name}, ${r.loads[0]?.quantity ?? 120} ${r.loads[0]?.unit ?? "bbl"}.`, `On location ${site(r.originKey).name}. Tanks were higher than expected.`, `Headed to ${r.destination.name} next.`]));
      for (const r of dayRuns.filter((x) => x.events.some((e) => e.details?.notes?.startsWith?.("Waited")))) say(chDispatch, r.driver, addMin(r.lastAt, -20), `Long line at ${r.destination.name} — ${r.events.find((e) => e.details?.notes?.startsWith?.("Waited"))?.details.notes}.`);
      for (const r of dayRuns.filter((x) => x.returned)) say(chDispatch, P("tanya-brooks"), addMin(r.events.find((e) => e.details?.decision === "return")?.recordedAt ? new Date(r.events.find((e) => e.details?.decision === "return")!.recordedAt) : r.lastAt, 3), `@${r.driver.first} returned your run from ${site(r.originKey).name} — manifest # doesn't match the SWD ticket. Fix and resubmit please.`);
    }
    if (nextRuns.length === 0 && d === 0) say(chDispatch, P("javier-soto"), at(0, 18, 20), "Board for tomorrow is posted. Two trucks dispatched so far; rest after the CTB levels come in.");
    for (const [ch, foreman] of [[chCrewA, P("hector-ruiz")], [chCrewB, P("wade-pruitt")]] as const) {
      const ts = tickets.filter((t) => t.org === "fieldgo" && t.d === d && t.foreman?.key === foreman.key && t.checkIn);
      if (!ts.length) continue;
      say(ch, foreman, addMin(ts[0].enRoute ?? ts[0].checkIn!, -15), `JSA done. Today: ${ts.map((t) => `${t.wt.name} at ${site(t.siteKey).name}`).join("; ")}. Hydrate — it's going to be hot.`);
      const es = ch.members.find((m) => m.preferred_language === "es");
      if (es && chance(0.35)) say(ch, es, addMin(ts[0].checkIn!, int(30, 120)), pick(["Ya terminé con las válvulas, voy a ayudar con la línea.", "Necesitamos más cinta teflón en la camioneta.", "Todo bien aquí, sin fugas."]));
      if (ts.every((t) => t.checkOut)) say(ch, foreman, addMin(ts.at(-1)!.checkOut!, int(10, 40)), `All tickets closed for today. ${ts.reduce((s, t) => s + t.lines.filter((l) => l.type === "part").length, 0)} part lines entered. Good work.`);
    }
    const submittedToday = tickets.filter((t) => t.org === "fieldgo" && t.history.some((h) => h.to === "submitted" && h.at >= at(d, 0) && h.at < at(d - 1, 0)));
    if (submittedToday.length) say(chFieldOffice, P("kim-albright"), at(d, 11, int(0, 50)), `Submitted ${submittedToday.length} tickets to GasGo this morning.`);
    for (const t of tickets.filter((x) => x.history.some((h) => h.to === "kicked_back" && h.at >= at(d, 0) && h.at < at(d - 1, 0)))) {
      const h = t.history.find((x) => x.to === "kicked_back")!;
      const ch = t.org === "fleetgo" ? chDispatch : chFieldOffice;
      say(ch, t.org === "fleetgo" ? P("monica-reyes") : P("kim-albright"), addMin(h.at, int(10, 90)), `GasGo kicked back #${t.id}: "${h.reason}" — on it.`);
      say(chGasOps, P(h.by === P("marcus-delgado").userId ? "marcus-delgado" : "earl-tatum"), addMin(h.at, int(1, 5)), `Kicked back #${t.id} (${t.org === "fleetgo" ? "FleetGo" : "FieldGo"}) — ${h.reason}`);
    }
    for (const sk of Object.keys(stations)) {
      for (const p of posts.filter((x) => x.stationKey === sk && x.d === d)) {
        if (p.user && p.actualEnd) {
          const onSite = visits.filter((v) => v.site_location_id === siteIds[sk] && v.check_in_time < p.end && (!v.check_out_time || (v.check_out_time as Date) > p.end)).length;
          const lang = p.user.preferred_language === "es";
          say(chStation[sk], p.user, addMin(p.end, -int(2, 10)), lang ? `Entrega de turno ${p.shift === "day" ? "18:00" : "06:00"} — ${onSite} en sitio. Registro conciliado.` : `Handoff ${p.shift === "day" ? "18:00" : "06:00"} — ${onSite} on site. Gate log reconciled.${p.late ? " Relief was late; logged." : ""}`);
        }
        if (!p.user) say(chGateSup, P("amber-cole"), addMin(p.start, -60 * int(10, 30)), `No coverage for ${site(sk).name} ${p.shift} post on ${workDate(d)}. Anyone available? Otherwise geofence-only and I'll flag it to GasGo.`);
      }
    }
    if (!isWeekend(d)) say(chGasOps, pick([P("marcus-delgado"), P("lena-okafor"), P("dana-whitfield")]), at(d, 7, int(0, 50)), pick([
      "Morning: Coyote Ridge CTB levels high again — FleetGo please prioritize water hauls.",
      "Reminder: all vendor tickets need the AFE from the site card, not the LOE default.",
      "Workover rig moves to Red Bluff 7 tomorrow. Expect extra traffic at the Antelope Draw gate.",
      "Production down 2% at Antelope Draw — Rosa is checking the transmitter on the sales line.",
      "Please get tickets closed same day. Pending review is piling up.",
    ]));
    if (dow(d) === 2) say(chGasAp, P("priya-raman"), at(d, 10, int(0, 59)), pick(["Received this week's FieldGo invoice. Matching tickets now.", "FleetGo invoice short one ticket — asked Monica for the line.", "ACH batch released for last week's approved work (synthetic)."]));
    if (dow(d) === 1) say(chFleetAll, P("curtis-lyle"), at(d, 6, 30), "Week starts — check your DOT med card and CDL dates in your profile. Two people are close to expiring.");
  }
  msgs.sort((a, b) => a.at.getTime() - b.at.getTime());
  await insertMany("work_hub_messages", msgs.map((m, i) => ({ id: uuid(`msg:${i}`), channel_id: m.channel.id, author_user_id: m.by.userId, kind: "text", body: m.body, client_operation_id: uuid(`msg-op:${i}`), created_at: m.at })), "id");

  const tasks: Record<string, unknown>[] = [];
  const task = (org: OrgKey, channel: Ch | null, title: string, assignee: Person, by: Person, created: Date, due: Date, doneAt: Date | null, priority = "normal", description = "") => {
    if (!past(created)) return;
    tasks.push({ id: uuid(`task:${tasks.length}:${title}`), owner_org_type: org === "gasgo" ? "partner" : "vendor", owner_org_id: orgId(org), channel_id: channel?.id ?? null, title, description: `${description} ${GO_MARKER}`.trim(), status: doneAt && past(doneAt) ? "completed" : past(addMin(created, 60)) && chance(0.4) ? "in_progress" : "open", priority, assignee_user_id: assignee.userId, created_by_id: by.userId, due_at: due, created_at: created, updated_at: doneAt && past(doneAt) ? doneAt : created });
  };
  for (const t of tickets.filter((x) => x.history.some((h) => h.to === "kicked_back"))) {
    const h = t.history.find((x) => x.to === "kicked_back")!;
    const resub = t.history.find((x) => x.to === "submitted" && x.at > h.at)?.at ?? null;
    task(t.org, t.org === "fleetgo" ? chDispatch : chFieldOffice, `Correct kicked-back ticket #${t.id}`, t.org === "fleetgo" ? P("monica-reyes") : P("kim-albright"), t.org === "fleetgo" ? P("tanya-brooks") : P("brenda-nguyen"), addMin(h.at, 20), addMin(h.at, 60 * 48), resub, "high", h.reason);
  }
  for (const c of certRows.filter((c) => (c.expiration_date as string) <= workDate(-30))) {
    const person = Object.values(people).find((p) => p.peopleId === c.employee_id)!;
    const org = person.org;
    task(org, null, `Renew ${c.name} — ${person.name}`, P(org === "fieldgo" ? "brenda-nguyen" : org === "fleetgo" ? "tanya-brooks" : "amber-cole"), P(owners[org as keyof typeof owners]), at(int(14, 25), 9), new Date(`${c.expiration_date}T17:00:00-05:00`), null, "high", "Certification expires within 30 days; scheduling blocks after expiry.");
  }
  task("fleetgo", chShop, "Replace turbo — Unit 105", P("dale-hutchins"), P("tanya-brooks"), at(5, 8), at(-2, 17), null, "urgent", "Out of service since pre-trip defect. Parts on order.");
  task("fleetgo", chShop, "Replace right rear outer tire — Unit 103", P("dale-hutchins"), P("tanya-brooks"), at(15, 7), at(15, 12), at(15, 11, 20), "high");
  task("fleetgo", chShop, "PM service A — Unit 102 (oil, filters, grease)", P("dale-hutchins"), P("tanya-brooks"), at(9, 8), at(6, 17), at(7, 15), "normal");
  for (const p of posts.filter((x) => !x.user && x.d >= 0)) task("gatego", chGateSup, `Fill ${p.shift} post — ${site(p.stationKey).name} ${workDate(p.d)}`, P("amber-cole"), P("sharon-pike"), addMin(p.start, -60 * 36), p.start, null, "high");
  for (let d = HISTORY_DAYS - 1; d >= 0; d -= 7) {
    task("gasgo", chGasAp, `Weekly invoice match — week of ${workDate(d)}`, P("priya-raman"), P("dana-whitfield"), at(d, 8), at(d - 2, 17), at(d - 2, 15), "normal");
    task("fieldgo", chFieldOffice, `Weekly safety meeting minutes — ${workDate(d)}`, P("wade-pruitt"), P("ray-castillo"), at(d, 7), at(d - 1, 17), at(d - 1, 12), "normal");
    task("gatego", chGateSup, `Publish next week's gate post schedule`, P("amber-cole"), P("sharon-pike"), at(d, 9), at(d - 3, 17), at(d - 3, 14), "normal");
  }
  task("gasgo", chGasOps, "Grade lease road near Antelope Draw 12-1H cattle guard", P("lena-okafor"), P("marcus-delgado"), at(0, 15), at(-2, 17), null, "high", "Washout reported by Earl after rain.");
  task("fieldgo", chFieldOffice, "Renew FieldGo general liability certificate", P("brenda-nguyen"), P("ray-castillo"), at(10, 9), at(-15, 17), null, "high", "GL expires in about 20 days; GasGo requires a current COI.");
  task("fleetgo", chFleetAll, "Renew FleetGo auto liability policy", P("curtis-lyle"), P("curtis-lyle"), at(8, 9), at(-7, 17), null, "urgent", "Auto liability expires in about 9 days.");
  for (const t of tickets.filter((x) => x.org === "fieldgo" && x.foreman && x.checkIn && chance(0.3))) {
    task("fieldgo", t.foreman!.key === "hector-ruiz" ? chCrewA : chCrewB, `JSA / tailgate briefing — ${site(t.siteKey).name}`, t.foreman!, P("wade-pruitt"), addMin(t.checkIn!, -40), addMin(t.checkIn!, 10), addMin(t.checkIn!, int(-15, 5)), "high", `${t.wt.name}. Sign-in sheet photo attached to ticket #${t.id}.`);
  }
  for (const t of tickets.filter((x) => x.org === "fieldgo" && x.crew.length > 1 && x.history.some((h) => h.to === "kicked_back" || h.to === "denied"))) {
    const hand = t.crew.find((m) => m.key !== t.lead.key) ?? t.lead;
    const h = t.history.find((x) => x.to === "kicked_back" || x.to === "denied")!;
    task("fieldgo", t.foreman?.key === "wade-pruitt" ? chCrewB : chCrewA, `Upload before/after photos — ticket #${t.id}`, hand, t.lead, addMin(h.at, 30), addMin(h.at, 60 * 24), chance(0.8) ? addMin(h.at, int(90, 60 * 20)) : null, "normal", "GasGo asked for photo evidence before re-review.");
  }
  for (let d = HISTORY_DAYS - 2; d >= 0; d -= 7) for (const driver of byOrg("fleetgo").filter((p) => p.vendorRole === "field")) {
    task("fleetgo", chDispatch, `Upload SWD / BOL tickets — week ending ${workDate(d)}`, driver, P("monica-reyes"), at(d, 16), at(d - 1, 12), chance(0.85) ? addMin(at(d - 1, 6), int(0, 300)) : null, "normal", "Scan every disposal and crude receipt so billing can close the week.");
  }
  const gks = byOrg("gatego").filter((p) => p.vendorRole === "gatekeeper");
  for (let d = HISTORY_DAYS - 3, i = 0; d >= 0; d -= 7, i++) {
    task("gatego", chGateAll, "Visitor badge and sign-in sheet count — all stations", gks[i % gks.length], P("luis-ortega"), at(d, 7), at(d, 18), at(d, int(10, 16)), "low");
  }
  task("gatego", chGateAll, "Replace gate arm light — Antelope Draw CTB (night visibility)", gks[2], P("luis-ortega"), at(RAIN_DAY - 1, 6, 30), at(RAIN_DAY - 3, 18), at(RAIN_DAY - 2, 22), "high", "Night crew reported the arm light out after the storm.");
  await insertMany("work_hub_tasks", tasks, "id");

  const wh: Record<string, unknown>[] = [], whA: Record<string, unknown>[] = [];
  for (let d = HISTORY_DAYS - 1; d >= -UPCOMING_DAYS; d--) {
    if (isWeekend(d)) continue;
    for (const [crew, foreman, label] of [[crewA, P("hector-ruiz"), "Crew A"], [crewB, P("wade-pruitt"), "Crew B"]] as const) {
      const id = uuid(`fshift:${label}:${d}`);
      wh.push({ id, owner_org_type: "vendor", owner_org_id: vendorIds.fieldgo, channel_id: (label === "Crew A" ? chCrewA : chCrewB).id, title: `${label} — field day`, starts_at: at(d, 6, 30), ends_at: at(d, 17, 30), timezone: GO_TIMEZONE, site_location_id: null, instructions: "Meet at the FieldGo yard 06:15 for JSA. Synthetic.", owner_user_id: foreman.userId, required_staff_count: crew.length, created_by_id: P("brenda-nguyen").userId, created_at: at(d + 7, 10) });
      for (const m of crew.filter((x) => !absent(x.key, d))) whA.push({ shift_id: id, user_id: m.userId, assigned_by_id: P("brenda-nguyen").userId });
    }
    for (const dr of drivers) {
      const id = uuid(`dshift:${dr.key}:${d}`);
      wh.push({ id, owner_org_type: "vendor", owner_org_id: fleetVendorId, channel_id: chDispatch.id, title: `${dr.first} — ${driverTruck[dr.key].truck.toUpperCase()} driving shift`, starts_at: at(d, 5, 15), ends_at: at(d, 17, 15), timezone: GO_TIMEZONE, instructions: "Pre-trip before first load. 11/14 HOS applies. Synthetic.", owner_user_id: P("javier-soto").userId, required_staff_count: 1, qualification_codes: ["CDL Class A"], created_by_id: P("javier-soto").userId, created_at: at(d + 6, 15) });
      whA.push({ shift_id: id, user_id: dr.userId, assigned_by_id: P("javier-soto").userId });
    }
  }
  await insertMany("work_hub_shifts", wh, "id");
  await insertMany("work_hub_shift_assignments", whA, "id");

  const meetings = [
    { org: "fieldgo" as OrgKey, title: "Monday Safety Meeting", ch: chFieldAll, host: P("wade-pruitt"), dow: 1, h: 6, m: 15, len: 30, members: byOrg("fieldgo") },
    { org: "fleetgo" as OrgKey, title: "Daily Dispatch Huddle", ch: chDispatch, host: P("javier-soto"), dow: -1, h: 5, m: 0, len: 15, members: byOrg("fleetgo") },
    { org: "gatego" as OrgKey, title: "Weekly Supervisor Sync", ch: chGateSup, host: P("sharon-pike"), dow: 3, h: 9, m: 0, len: 45, members: chGateSup.members },
    { org: "gasgo" as OrgKey, title: "Weekly Vendor Performance Review", ch: chGasOps, host: P("dana-whitfield"), dow: 4, h: 13, m: 0, len: 60, members: byOrg("gasgo") },
  ];
  for (const mt of meetings) {
    const id = uuid(`meeting:${mt.title}`);
    await insertOne("work_hub_meetings", { id, owner_org_type: mt.org === "gasgo" ? "partner" : "vendor", owner_org_id: orgId(mt.org), channel_id: mt.ch.id, title: mt.title, agenda: "Safety moment · last week's incidents · this week's plan · open items. Synthetic.", timezone: GO_TIMEZONE, admission_mode: "company_open", created_by_id: mt.host.userId, created_at: companySince }, "id");
    const occ: Record<string, unknown>[] = [], parts: Record<string, unknown>[] = [];
    for (let d = HISTORY_DAYS - 1; d >= -UPCOMING_DAYS; d--) {
      if (mt.dow === -1 ? isWeekend(d) : dow(d) !== mt.dow) continue;
      const oid = uuid(`occ:${mt.title}:${d}`);
      const s = at(d, mt.h, mt.m), e = addMin(s, mt.len);
      occ.push({ id: oid, meeting_id: id, starts_at: s, ends_at: e, status: past(e) ? "ended" : "scheduled", created_at: addMin(s, -60 * 24 * 7) });
      for (const m of mt.members) parts.push({ occurrence_id: oid, user_id: m.userId, role: m === mt.host ? "host" : "participant", rsvp: past(e) ? (chance(0.85) ? "accepted" : "declined") : chance(0.5) ? "accepted" : "pending" });
    }
    await insertMany("work_hub_meeting_occurrences", occ, "id");
    await insertMany("work_hub_meeting_participants", parts, "id");
  }

  const ann = [
    { org: "gasgo" as OrgKey, d: 27, by: "dana-whitfield", title: "Vendor ticket AFE policy", body: "Effective immediately, every vendor ticket must use the site AFE shown on the site card. LOE defaults will be kicked back.", urgent: false, ack: true },
    { org: "fieldgo" as OrgKey, d: 26, by: "wade-pruitt", title: "Tool lanyards required on catwalks", body: "After Monday's dropped-object near miss, tool lanyards are mandatory above 4 ft.", urgent: true, ack: true },
    { org: "fleetgo" as OrgKey, d: 22, by: "tanya-brooks", title: "County Road 1200 SWD hours change", body: "CR 1200 SWD now closes at 22:00. Late loads go to Lone Mesa.", urgent: false, ack: false },
    { org: "fieldgo" as OrgKey, d: 18, by: "ray-castillo", title: "Rain day — stand by", body: "Lease roads closed. Report to the yard for shop work; techs on paved access only.", urgent: true, ack: false },
    { org: "gatego" as OrgKey, d: 17, by: "sharon-pike", title: "Workover traffic at Antelope Draw", body: "Expect rig-move traffic this week. Verify work orders for all heavy-haul carriers.", urgent: false, ack: true },
    { org: "gasgo" as OrgKey, d: 12, by: "marcus-delgado", title: "Stop work — Coyote Ridge CTB spill", body: "Spill contained inside berm. All non-response work at Coyote Ridge CTB paused until cleared.", urgent: true, ack: true },
    { org: "fieldgo" as OrgKey, d: 9, by: "wade-pruitt", title: "H2S refresher — Thursday 06:00", body: "Mandatory after Tuesday's monitor alarm. Bring your personal monitor for bump test.", urgent: false, ack: true },
    { org: "fleetgo" as OrgKey, d: 5, by: "dale-hutchins", title: "Unit 105 out of service", body: "Turbo failure. Do not dispatch 105 until the shop releases it.", urgent: true, ack: true },
    { org: "gatego" as OrgKey, d: 3, by: "luis-ortega", title: "Gate bypass incident — stop every vehicle", body: "A pickup drove past the Coyote Ridge gate. Stop and log every vehicle, no exceptions.", urgent: true, ack: true },
    { org: "fleetgo" as OrgKey, d: 2, by: "curtis-lyle", title: "Overhead lines — crane lifts need a spotter", body: "Hotshot crane lifts near power lines require a dedicated spotter. No exceptions.", urgent: true, ack: true },
  ];
  for (const [i, a] of ann.entries()) {
    const pub = addMin(at(a.d, 7), int(0, 180));
    const id = uuid(`ann:${i}`);
    await insertOne("work_hub_announcements", { id, owner_org_type: a.org === "gasgo" ? "partner" : "vendor", owner_org_id: orgId(a.org), title: a.title, body: `${a.body} (Synthetic.)`, urgency: a.urgent ? "urgent" : "normal", acknowledgement_required: a.ack, published_by_id: P(a.by).userId, published_at: pub }, "id");
    await insertMany("work_hub_announcement_recipients", byOrg(a.org).map((m) => { const viewed = chance(0.9) ? addMin(pub, int(5, 600)) : null; return { announcement_id: id, user_id: m.userId, viewed_at: viewed && past(viewed) ? viewed : null, acknowledged_at: a.ack && viewed && past(viewed) && chance(0.85) ? addMin(viewed, int(0, 20)) : null }; }), "id");
  }

  // ---------------- devices, notifications, assistant usage
  await insertMany("work_hub_device_preferences", Object.values(people).filter((p) => p.surface !== "web").map((p) => {
    const native = initialNativeState() as any;
    native.designatedDeviceId = p.device;
    if (native.consent) native.consent.locationSharing = p.org !== "gasgo";
    return { user_id: p.userId, owner_org_type: p.org === "gasgo" ? "partner" : "vendor", owner_org_id: orgId(p.org), native_operations: native };
  }), "id");
  const notes: Record<string, unknown>[] = [];
  const category = (type: string) => (type.startsWith("cert_") ? "compliance" : type === "bid_placed" || type === "job_awarded" ? "hotlist" : "tickets");
  const notify = (p: Person, type: string, title: string, body: string, t: Date, link?: string) => { if (past(t)) notes.push({ user_id: p.userId, type, category: category(type), title, body, link: link ?? null, is_read: t < addMin(NOW, -60 * 24 * 2) ? true : chance(0.3), delivery_status: "delivered", delivered_at: t, created_at: t }); };
  for (const t of tickets) {
    for (const h of t.history) {
      if (h.to === "kicked_back") notify(t.org === "fleetgo" ? P("monica-reyes") : P("kim-albright"), "ticket_kicked_back", `Ticket #${t.id} kicked back`, h.reason ?? "", h.at, `/tickets/${t.id}`);
      if (h.to === "approved") notify(t.org === "fieldgo" ? P("kim-albright") : t.org === "fleetgo" ? P("monica-reyes") : P("sharon-pike"), "ticket_approved", `Ticket #${t.id} approved`, `${t.wt.name} at ${site(t.siteKey).name}`, h.at, `/tickets/${t.id}`);
      if (h.to === "funds_dispersed") notify(t.org === "fieldgo" ? P("ray-castillo") : t.org === "fleetgo" ? P("curtis-lyle") : P("sharon-pike"), "funds_dispersed", `Payment recorded for #${t.id}`, "Synthetic — no real money moved.", h.at, `/tickets/${t.id}`);
      if (h.to === "denied") notify(P("brenda-nguyen"), "ticket_rejected", `Ticket #${t.id} denied`, h.reason ?? "", h.at, `/tickets/${t.id}`);
      if (h.to === "awaiting_acceptance" && t.org === "fieldgo") notify(P("brenda-nguyen"), "ticket_assigned", `New ticket from GasGo #${t.id}`, `${t.wt.name} at ${site(t.siteKey).name}`, h.at, `/tickets/${t.id}`);
    }
    if (t.status === "pending_review" && t.d >= 2) notify(P("kim-albright"), "ticket_pending_long", `#${t.id} pending review for ${t.d} days`, "Close or submit to keep billing current.", at(t.d - 2, 8), `/tickets/${t.id}`);
  }
  for (const c of certRows.filter((c) => (c.expiration_date as string) <= workDate(-30))) {
    const person = Object.values(people).find((p) => p.peopleId === c.employee_id)!;
    notify(person, (c.expiration_date as string) < workDate(0) ? "cert_expired" : "cert_expiring", `${c.name} ${(c.expiration_date as string) < workDate(0) ? "expired" : "expires soon"}`, `Expiration ${c.expiration_date}.`, at(int(5, 20), 6));
  }
  for (const p of posts.filter((x) => !x.user)) for (const who of [P("amber-cole"), P("sharon-pike")]) notify(who, "workflow_nudge", `Uncovered gate post — ${site(p.stationKey).name}`, `${p.shift} post ${workDate(p.d)} has no attendant.`, addMin(p.start, -60 * 12));
  for (const r of runs.filter((x) => x.events.length > 2 && chance(0.12))) notify(P("tanya-brooks"), "workflow_nudge", `Run ${r.id.slice(0, 8)} ${r.status.replace(/_/g, " ")}`, `${site(r.originKey).name} → ${r.destination.name}`, r.lastAt);
  for (const h of hot) for (const b of h.bids) notify(b.status === "awarded" ? P(b.org === "fieldgo" ? "ray-castillo" : "curtis-lyle") : P("dana-whitfield"), b.status === "awarded" ? "job_awarded" : "bid_placed", b.status === "awarded" ? `Awarded: ${h.title}` : `New bid on ${h.title}`, b.notes, at(h.postedD - 1, 11));
  await insertMany("notifications", notes);
  const audit: Record<string, unknown>[] = [];
  const toolsBy: Record<OrgKey, [string, string][]> = {
    gasgo: [["query_gate_report", "Who was on site at Antelope Draw yesterday?"], ["query_invoice_activity", "What invoices are waiting on me?"], ["v_show_workspace", "Show my workspace"], ["query_active_visitors", "Who's on site at Coyote Ridge right now?"]],
    fieldgo: [["list_work_hub_tasks", "What's on my list today?"], ["v_open_ticket_entry", "Open a ticket for wellhead repair at Sand Hill"], ["query_ticket_assignment_candidates", "Who can cover a flowline job tomorrow?"], ["manage_work_hub_task", "Mark the JSA task done"]],
    fleetgo: [["manage_fleet_run_dispatch", "Dispatch Bobby to Coyote Ridge CTB"], ["review_fleet_run_accept", "Accept yesterday's runs that match"], ["v_open_fleet_run", "Open my current run"], ["query_asset_custody", "Who has trailer T-21?"]],
    gatego: [["query_gate_stations", "Which gates am I assigned to?"], ["query_gate_change_over", "What's the handoff status?"], ["manage_gate_shift", "Start my shift at the Antelope Draw gate"], ["query_shift_notes", "Any notes from last night?"]],
  };
  for (let d = HISTORY_DAYS - 1; d >= 0; d--) for (const p of Object.values(people)) {
    if (!chance(p.membership === "admin" ? 0.45 : 0.18)) continue;
    const [tool, text] = pick(toolsBy[p.org]);
    const surface = tool.startsWith("v_") || (p.surface === "web" && chance(0.3)) ? "chatgpt" : p.surface === "web" ? "web" : p.surface === "ios" ? "ios" : pick(["web", "ios", "chatgpt"]);
    const t = at(d, int(6, 19), int(0, 59));
    if (!past(t)) continue;
    audit.push({ user_id: p.userId, actor_role: p.userRole, actor_membership_role: p.membership, partner_id: p.org === "gasgo" ? partnerId : null, vendor_id: p.org === "gasgo" ? null : orgId(p.org), vendor_people_id: p.peopleId, client_surface: surface, input_mode: surface === "ios" && chance(0.5) ? "voice" : "typed", provider: surface === "chatgpt" ? "openai" : "anthropic", tool_name: tool, action_type: tool.startsWith("manage_") || tool.startsWith("review_") ? "write" : "read", target_type: "synthetic", transcript_text: text, tool_input: { synthetic: true }, tool_output: { synthetic: true, note: "Synthetic usage history; no model call was made." }, result_status: chance(0.94) ? "completed" : "failed", error_code: null, created_at: t });
  }
  audit.sort((a, b) => (a.created_at as Date).getTime() - (b.created_at as Date).getTime());
  await insertMany("assistant_action_audit", audit);

  // ---------------- report
  const statusMix = (org: string) => Object.fromEntries(Object.entries(tickets.filter((t) => t.org === org).reduce((m, t) => ({ ...m, [t.status]: (m[t.status] ?? 0) + 1 }), {} as Record<string, number>)).sort());
  const report = {
    version: GO_VERSION, database: targetDb, now: NOW.toISOString(), window: { from: workDate(HISTORY_DAYS - 1), to: workDate(0), upcomingTo: workDate(-UPCOMING_DAYS) }, applied: APPLY,
    organizations: { partnerId, ...vendorIds }, users: PEOPLE.length + 1,
    tickets: { fieldgo: statusMix("fieldgo"), fleetgo: statusMix("fleetgo"), gatego: statusMix("gatego") },
    fleetRuns: Object.fromEntries(Object.entries(runs.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {} as Record<string, number>)).sort()),
    routePoints: routeRows.length, gatePosts: { total: posts.length, uncovered: posts.filter((p) => !p.user).length, late: posts.filter((p) => p.late).length }, visits: visits.length, rows: counts,
  };
  if (APPLY) {
    await client.query("commit");
    await mkdir(new URL("../../.local/", import.meta.url), { recursive: true });
    await writeFile(new URL("../../.local/go-demo-accounts.json", import.meta.url), JSON.stringify({ version: GO_VERSION, database: targetDb, password, accounts: [...PEOPLE.map((s) => ({ username: `go-demo-${s.key}@example.invalid`, name: `${s.first} ${s.last}`, company: ORGS[s.org].name, title: s.title, membership: s.membership })), { username: "go-demo-review@example.invalid", name: "Go Reviewer", company: "all four", title: REVIEWER.title, membership: "admin" }] }, null, 2), { mode: 0o600 });
    await writeFile(new URL("../../.local/go-demo-report.json", import.meta.url), JSON.stringify(report, null, 2));
  } else await client.query("rollback");
  console.log(JSON.stringify(report, null, 2));
}

main().catch(async (e) => { await client.query("rollback").catch(() => undefined); console.error(e); process.exitCode = 1; }).finally(() => client.end());
