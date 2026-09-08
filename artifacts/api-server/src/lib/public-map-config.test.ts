import { describe, expect, it } from "vitest";
import { publicMapConfig } from "./public-map-config";

describe("public map configuration", () => {
  it("returns only a public Mapbox token, never server secrets", () => {
    expect(publicMapConfig({ MAPBOX_ACCESS_TOKEN: "sk.private", DATABASE_URL: "private" }))
      .toEqual({ mapboxAccessToken: "" });
    expect(publicMapConfig({ MAPBOX_ACCESS_TOKEN: " pk.public " }))
      .toEqual({ mapboxAccessToken: "pk.public" });
  });
  it("can fall back to a public token when an earlier candidate is secret", () => {
    expect(publicMapConfig({ VITE_MAPBOX_ACCESS_TOKEN: "sk.private", MAPBOX_API_KEY: "pk.web" }))
      .toEqual({ mapboxAccessToken: "pk.web" });
  });
});
