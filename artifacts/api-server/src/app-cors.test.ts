import { describe, expect, it } from "vitest";
import { isAllowedCorsOrigin } from "./lib/corsOrigins";

describe("isAllowedCorsOrigin", () => {
  it("allows local Expo web preview origins", () => {
    expect(isAllowedCorsOrigin("http://localhost:8082")).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:8082")).toBe(true);
    expect(isAllowedCorsOrigin("http://localhost:8081")).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:8081")).toBe(true);
  });

  it("rejects unknown web origins", () => {
    expect(isAllowedCorsOrigin("https://example.invalid")).toBe(false);
  });
});
