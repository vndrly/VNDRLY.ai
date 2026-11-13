import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearMapboxRouteCache, estimateMapboxDrivingRoute } from "./mapbox-routing";

describe("estimateMapboxDrivingRoute", () => {
  beforeEach(() => {
    clearMapboxRouteCache();
  });

  it("normalizes Mapbox driving route distance and duration", async () => {
    const fetchImpl = async (url: string) => {
      expect(url).toContain("api.mapbox.com/directions/v5/mapbox/driving-traffic");
      expect(url).toContain("-101.944");
      expect(url).toContain("31.997");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          routes: [{ distance: 32186.9, duration: 2420.2 }],
          code: "Ok",
        }),
      } as Response;
    };

    const result = await estimateMapboxDrivingRoute(
      {
        origin: { latitude: 31.997, longitude: -102.077 },
        destination: { latitude: 31.834, longitude: -101.944 },
      },
      { accessToken: "pk.test", fetchImpl },
    );

    expect(result).toEqual({
      ok: true,
      provider: "mapbox",
      trafficAware: true,
      distanceMiles: 20,
      durationMinutes: 40,
      routeConfidence: "high",
    });
  });

  it("returns a configuration error when no token is available", async () => {
    const result = await estimateMapboxDrivingRoute(
      {
        origin: { latitude: 31.997, longitude: -102.077 },
        destination: { latitude: 31.834, longitude: -101.944 },
      },
      { accessToken: "" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("mapbox.missing_token");
    }
  });

  it("reuses a cached estimate for the same origin and destination", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          routes: [{ distance: 16093.44, duration: 900 }],
          code: "Ok",
        }),
      } as Response;
    };
    const args = {
      origin: { latitude: 31.9972, longitude: -102.0779 },
      destination: { latitude: 31.8342, longitude: -101.9443 },
    };

    const first = await estimateMapboxDrivingRoute(args, { accessToken: "pk.test", fetchImpl });
    const second = await estimateMapboxDrivingRoute(args, { accessToken: "pk.test", fetchImpl });

    expect(first).toEqual(second);
    expect(calls).toBe(1);
  });

  it("rounds minor GPS jitter into the same cache key", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          routes: [{ distance: 16093.44, duration: 900 }],
          code: "Ok",
        }),
      } as Response;
    };

    await estimateMapboxDrivingRoute(
      {
        origin: { latitude: 31.997201, longitude: -102.077901 },
        destination: { latitude: 31.834201, longitude: -101.944301 },
      },
      { accessToken: "pk.test", fetchImpl },
    );
    await estimateMapboxDrivingRoute(
      {
        origin: { latitude: 31.997204, longitude: -102.077904 },
        destination: { latitude: 31.834204, longitude: -101.944304 },
      },
      { accessToken: "pk.test", fetchImpl },
    );

    expect(calls).toBe(1);
  });

  it("expires cached estimates after the configured ttl", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchImpl = async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            routes: [{ distance: 16093.44, duration: 900 }],
            code: "Ok",
          }),
        } as Response;
      };
      const args = {
        origin: { latitude: 31.9972, longitude: -102.0779 },
        destination: { latitude: 31.8342, longitude: -101.9443 },
      };

      await estimateMapboxDrivingRoute(args, { accessToken: "pk.test", fetchImpl, cacheTtlMs: 1000 });
      vi.advanceTimersByTime(1001);
      await estimateMapboxDrivingRoute(args, { accessToken: "pk.test", fetchImpl, cacheTtlMs: 1000 });

      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

it("requests road geometry separately from distance-only cache entries", async () => {
  clearMapboxRouteCache();
  const coordinates = [[-102.077,31.997],[-102,31.9],[-101.944,31.834]];
  const fetchImpl = vi.fn(async (url: string) => ({ ok:true, status:200, json:async () => ({ code:"Ok", routes:[{ distance:32186.9,duration:2400, ...(url.includes("overview=full") ? {geometry:{type:"LineString",coordinates}} : {}) }] }) } as Response));
  const args = {origin:{latitude:31.997,longitude:-102.077},destination:{latitude:31.834,longitude:-101.944}};
  await estimateMapboxDrivingRoute(args,{accessToken:"pk.test",fetchImpl});
  const route = await estimateMapboxDrivingRoute(args,{accessToken:"pk.test",fetchImpl,includeGeometry:true});
  expect(route).toMatchObject({ok:true,coordinates});
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  await estimateMapboxDrivingRoute(args,{accessToken:"pk.test",fetchImpl,includeGeometry:true});
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
