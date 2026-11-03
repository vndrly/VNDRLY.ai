import { expect, it } from "vitest";
import { trainingExperimentMethod } from "./training-performance";
it("restricts production cache bypass to current company administrators", () => {
  for (const role of ["field", "office", "training coordinator", "member", ""]) {
    for (const method of ["baseline", "server", "render", "cache"]) expect(trainingExperimentMethod(method, role, true)).toBeNull();
  }
  expect(trainingExperimentMethod("server", "admin", true)).toBe("server");
});
it("ignores unknown or missing methods even for administrators", () => {
  for (const value of [undefined, "", "default", "other", ["server"]]) expect(trainingExperimentMethod(value, "admin", true)).toBeNull();
});
