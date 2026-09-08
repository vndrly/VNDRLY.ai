import { describe, expect, it } from "vitest";
import { mapboxMarkerContent } from "./mapbox-map";

describe("Mapbox marker content", () => {
  it("uses an owning-partner logo without changing the marker footprint", () => {
    expect(mapboxMarkerContent({ label: "S", imageUrl: "/warwick.png", title: "Warwick site" })).toContain('class="vndrly-mapbox-marker-logo"');
    expect(mapboxMarkerContent({ label: "S", imageUrl: "/warwick.png", title: "Warwick site" })).toContain('src="/warwick.png"');
  });

  it("falls back to the generic text marker", () => {
    expect(mapboxMarkerContent({ label: "S" })).toBe("<span>S</span>");
  });
});
