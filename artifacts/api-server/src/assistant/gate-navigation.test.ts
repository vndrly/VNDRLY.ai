import { beforeEach, describe, expect, it, vi } from "vitest";
const reads = vi.hoisted(() => ({ sites: vi.fn(), stations: vi.fn() }));
vi.mock("../services/gate-change-over", () => ({ ChangeOverError: class extends Error {}, listChangeOverSites: reads.sites, listChangeOverStations: reads.stations }));
import { resolveGateNavigation, runGateNavigationTool } from "./gate-navigation";
const session = { userId: 10, role: "vendor", vendorId: 1054 };
const site = { id: 411, name: "San Roman Completions", partnerName: "Warwick Energy Group" };
const station = { id: "e00cb909-a716-4a65-9375-dd84f337bf6b", name: "Warwick San Roman Completions 2" };
beforeEach(() => { reads.sites.mockReset().mockResolvedValue([site]); reads.stations.mockReset().mockResolvedValue([station]); });
describe("authorized conversational Gate navigation", () => {
  it.each(["Open San Roman six", "Abre el mapa de San Roman seis por favor"])("resolves number words in %s without changing numeric identity", async query => {
    reads.stations.mockResolvedValue([{ ...station, name: "San Roman 6" }]);
    expect(await resolveGateNavigation(query, [site], reads.stations)).toMatchObject({ ok: true, stationId: station.id });
    reads.stations.mockResolvedValue([{ ...station, name: "San Roman 7" }]);
    expect(await resolveGateNavigation(query, [site], reads.stations)).toMatchObject({ ok: false });
  });
  it.each(["Sand Roman", "Sand Roman two"])("tolerates speech transcription %s", async query => {
    expect(await resolveGateNavigation(query, [site], reads.stations)).toMatchObject({ ok: true, stationId: station.id });
  });
  it("finds gate-only names even when neither the site nor partner name matches", async () => {
    reads.stations.mockResolvedValue([{ ...station, name: "North entrance" }]);
    expect(await resolveGateNavigation("North entrance", [site], reads.stations)).toMatchObject({ ok: true, stationId: station.id });
  });
  it("keeps short ambiguous speech matches as choices", async () => {
    reads.stations.mockResolvedValue([station, { ...station, id: "other", name: "Sand Roman Completions 2" }]);
    const result = await resolveGateNavigation("San Roman", [site], reads.stations);
    expect(result).toMatchObject({ ok: false, candidates: expect.any(Array) });
  });
  it.each(["San Roman", "San Roman Completions", "Warwick San Roman Completions 2", "san romen completion two", "Show me San Roman please", "Warwick San Roman Gate 2"])("resolves %s without exact display text", async query => {
    const result = JSON.parse((await runGateNavigationTool({ screen: "gate-dashboard", query }, session))!);
    expect(result).toMatchObject({ ok: true, intent: { arguments: { path: `/gate/change-over?siteId=411&stationId=${station.id}` } } });
    expect(reads.sites).toHaveBeenCalledWith(session);
    expect(reads.stations).toHaveBeenCalledWith(session, site.id);
  });
  it("asks once for a real ambiguity instead of choosing an arbitrary gate", async () => {
    reads.stations.mockResolvedValue([station, { id: "0bc8695d-3a9b-4692-9609-6ec69ae07444", name: "Warwick San Roman Completions 1" }]);
    const ambiguous = JSON.parse((await runGateNavigationTool({ screen: "gate-dashboard", query: "San Roman" }, session))!);
    expect(ambiguous).toMatchObject({ ok: false, candidates: expect.arrayContaining([expect.objectContaining({ stationId: station.id })]) });
    expect(ambiguous.candidates).toHaveLength(2);
    expect(ambiguous.candidates[0].href).toBe(`/gate/change-over?siteId=411&stationId=${station.id}`);
    expect(ambiguous.guidance).toContain("never guess");
    expect(JSON.parse((await runGateNavigationTool({ screen: "gate-dashboard", query: "San Roman 2" }, session))!)).toHaveProperty("ok", true);
  });
  it("never fuzzy-matches a gate number or invents a site", async () => {
    for (const query of ["San Roman 1", "Nonexistent oilfield 2"]) expect(JSON.parse((await runGateNavigationTool({ screen: "gate-dashboard", query }, session))!)).toHaveProperty("ok", false);
  });
  it("does not query stations outside the account's authorized sites", async () => {
    const result = await resolveGateNavigation("Other Company Private Site 2", [site], reads.stations);
    expect(result.ok).toBe(false);
    expect(reads.stations).toHaveBeenCalledWith(site.id);
  });
  it("rechecks explicit IDs and rejects a gate belonging to another site", async () => {
    expect(JSON.parse((await runGateNavigationTool({ screen: "gate-map", siteId: 999, stationId: station.id }, session))!)).toHaveProperty("ok", false);
    expect(reads.stations).not.toHaveBeenCalled();
    expect(JSON.parse((await runGateNavigationTool({ screen: "gate-map", siteId: site.id, stationId: "0bc8695d-3a9b-4692-9609-6ec69ae07444" }, session))!)).toHaveProperty("ok", false);
  });
  it("returns the resolved target to Gate Map and leaves other client actions alone", async () => {
    expect(JSON.parse((await runGateNavigationTool({ screen: "gate-map", query: "San Roman" }, session))!)).toMatchObject({ ok: true, intent: { arguments: { path: `/gate/map?siteId=411&stationId=${station.id}` } } });
    expect(await runGateNavigationTool({ screen: "tickets", query: "San Roman" }, session)).toBeNull();
  });
});
