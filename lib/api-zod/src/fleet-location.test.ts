import { expect, it } from "vitest";
import * as contracts from "./index";

it("requires bounded explicit pages for the recorded location feed", () => {
  const schema = contracts.FleetLocationPageQuerySchema;
  expect(schema.parse({})).toEqual({ limit: 50 });
  expect(schema.parse({ limit: "10", cursor: "200:150" })).toEqual({ limit: 10, cursor: "200:150" });
  for (const value of [{ limit: 0 }, { limit: 51 }, { cursor: "invalid" }, { userId: 4 }])
    expect(schema.safeParse(value).success).toBe(false);
});
