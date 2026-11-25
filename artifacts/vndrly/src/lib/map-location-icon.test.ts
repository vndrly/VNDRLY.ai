import { expect, it } from "vitest";
import { mapLocationIcon } from "./map-location-icon";
it("uses distinct brand-colored vector symbols with a neutral outline", () => {
  for (const kind of ["gate", "site"] as const) {
    expect(mapLocationIcon(kind)).toContain('fill="currentColor"');
    expect(mapLocationIcon(kind)).toContain('stroke="#fff"');
  }
  expect(mapLocationIcon("gate")).not.toBe(mapLocationIcon("site"));
});
