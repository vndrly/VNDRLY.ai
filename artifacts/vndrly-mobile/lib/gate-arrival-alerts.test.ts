import { expect, it } from "vitest";
import { createGateArrivalTracker } from "./gate-arrival-alerts";
it("alerts once per newly observed run identity after the baseline", () => {
 const observe = createGateArrivalTracker();
 expect([...observe(["run-1"])]).toEqual([]);
 expect([...observe(["run-1"])]).toEqual([]);
 expect([...observe(["run-1", "run-2"])]).toEqual(["run-2"]);
 expect([...observe(["run-1", "run-2"])]).toEqual([]);
 expect([...observe([])]).toEqual([]);
 expect([...observe(["run-2"])]).toEqual([]);
});
