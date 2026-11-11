import type { SessionPayload } from "../lib/session";
import { ChangeOverError, listChangeOverSites, listChangeOverStations } from "../services/gate-change-over";
import { runClientTool } from "./client-tools";

type Site = { id: number; name: string; partnerName?: string | null };
type Station = { id: string; name: string };
const ignored = new Set(["open", "show", "me", "the", "please", "site", "gate", "gates", "dashboard", "map", "at", "for", "to"]);
const numbers: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5" };
function words(value: string): string[] {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(word => word && !ignored.has(word)).map(word => Object.hasOwn(numbers, word) ? numbers[word] : word);
}
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (/\d/.test(a + b) || Math.min(a.length, b.length) < 4) return 0;
  if (a.startsWith(b) || b.startsWith(a)) return .94;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length] <= (Math.min(a.length, b.length) >= 8 ? 2 : 1) ? .88 : 0;
}

/** Match only current authorized records. Numbers remain exact; ties need clarification. */
export async function resolveGateNavigation(query: string, sites: Site[], stationsForSite: (id: number) => Promise<Station[]>) {
  const requested = words(query);
  if (!requested.length) return { ok: false as const, error: "Name the site or gate to open." };
  const candidates: { siteId: number; stationId: string; name: string; score: number }[] = [];
  // Shortlist locally before station reads; never search the nationwide catalogue.
  const relevant = sites.filter(site => {
    const siteWords = words(site.name);
    return requested.some(word => siteWords.some(token => similarity(word, token) > 0));
  });
  for (const site of relevant) {
    for (const station of await stationsForSite(site.id)) {
      const aliases = words(`${site.partnerName ?? ""} ${site.name} ${station.name}`);
      const scores = requested.map(word => Math.max(0, ...aliases.map(token => similarity(word, token))));
      if (scores.every(score => score > 0)) candidates.push({ siteId: site.id, stationId: station.id, name: station.name, score: scores.reduce((a, b) => a + b, 0) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return { ok: false as const, error: "No current authorized gate matched that name. Ask which site or gate they meant; do not claim the site does not exist." };
  const tied = candidates.filter(candidate => best.score - candidate.score < .04);
  if (tied.length > 1) return { ok: false as const, error: "More than one authorized gate matches. Ask which gate to open.", candidates: tied.slice(0, 8).map(({ score: _, ...candidate }) => candidate) };
  return { ok: true as const, siteId: best.siteId, stationId: best.stationId, name: best.name };
}

/** Same entity resolution for spoken and typed navigation, with current account access. */
export async function runGateNavigationTool(input: unknown, session: SessionPayload): Promise<string | null> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const args = input as Record<string, unknown>;
  if (!["gate-dashboard", "gate-map"].includes(String(args.screen)) || (args.query == null && args.siteId == null && args.stationId == null)) return null;
  const fail = (error: string) => JSON.stringify({ ok: false, error });
  try {
    const sites = await listChangeOverSites(session);
    if (args.query != null) {
      if (typeof args.query !== "string" || args.query.length > 200) return fail("Use a site or gate name up to 200 characters.");
      const target = await resolveGateNavigation(args.query, sites, id => listChangeOverStations(session, id));
      if (!target.ok) return JSON.stringify(target);
      return runClientTool("open_screen", { screen: args.screen, siteId: target.siteId, stationId: target.stationId }, session);
    }
    const site = sites.find(site => site.id === args.siteId);
    if (!site) return fail("Choose a currently authorized site.");
    const stations = await listChangeOverStations(session, site.id);
    const station = stations.find(station => station.id === args.stationId) ?? (args.stationId == null && stations.length === 1 ? stations[0] : undefined);
    if (!station) return fail("Choose a currently authorized gate at that site.");
    return runClientTool("open_screen", { screen: args.screen, siteId: site.id, stationId: station.id }, session);
  } catch (error) {
    return fail(error instanceof ChangeOverError ? error.message : "Gate lookup is unavailable. Try again.");
  }
}
