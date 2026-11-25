import { expect, it } from "vitest";
import { mapCredentialCompliance, readMapCredentialCompliance } from "./gate-map-compliance";
const now = new Date("2026-11-25T12:00:00Z");
const cert = (expirationDate: string | null, verified = true) => ({ name: "H2S", expirationDate, verified });
it("uses awarded Site Security for gate duty without overriding additional requirements", async () => {
  const at = new Date();
  const row = { required: [] as string[], gate_duty: true, certificates: [], licenses: [], awards: [{programId:'VUC116',progress:{credential:{awardedAt:new Date(at.getTime()-86400000).toISOString(),expiresAt:new Date(at.getTime()+365*86400000).toISOString()}}}] };
  const client = {query: async () => ({rows:[structuredClone(row)]})} as any;
  expect((await readMapCredentialCompliance(client, 1, 2, at)).color).toBe('green');
  row.required = ['External security license'];
  expect((await readMapCredentialCompliance(client, 1, 2, at)).color).toBe('red');
  row.required = [];
  row.awards[0].progress.credential.expiresAt = new Date(at.getTime()+30*86400000).toISOString();
  expect((await readMapCredentialCompliance(client, 1, 2, at)).color).toBe('amber');
  row.awards[0].progress.credential.expiresAt = '2020-01-01';
  expect((await readMapCredentialCompliance(client, 1, 2, at)).color).toBe('red');
  row.awards = [];
  expect((await readMapCredentialCompliance(client, 1, 2, at)).color).toBe('red');
});
it("uses green only for a current verified required credential beyond 60 days", () => {
  expect(mapCredentialCompliance(["H2S"], [cert("2027-01-25")], now).color).toBe("green");
  expect(mapCredentialCompliance(["H2S"], [cert(null)], now).color).toBe("green");
});
it("includes the full 60-day boundary and today in amber", () => {
  expect(mapCredentialCompliance(["H2S"], [cert("2027-01-24")], now).color).toBe("amber");
  expect(mapCredentialCompliance(["H2S"], [cert("2026-11-25")], now).color).toBe("amber");
});
it("uses red for missing, expired, unverified or unconfigured qualifications", () => {
  for (const credentials of [[], [cert("2026-11-24")], [cert("2027-05-01", false)]]) expect(mapCredentialCompliance(["H2S"], credentials, now).color).toBe("red");
  expect(mapCredentialCompliance([], [cert(null)], now).color).toBe("red");
});
it("accepts a renewed credential and gives missing requirements precedence over amber", () => {
  expect(mapCredentialCompliance(["H2S"], [cert("2026-01-01"), cert("2027-05-01")], now).color).toBe("green");
  expect(mapCredentialCompliance(["H2S", "Site training"], [cert("2027-01-01")], now).color).toBe("red");
});
