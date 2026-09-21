import { expect, it } from "vitest";
import { toolsForRealtime } from "./tool-packs";
import { ASK_V_TOOL_REGISTRY } from "./tool-registry";
it("makes grounded read-only handoff tools available in Gate on web and iOS", () => {
  for (const role of ["vendor", "field_employee"] as const) {
    const names = toolsForRealtime({ role, workflow: "gate" }).map(
      (t) => t.name,
    );
    for (const name of [
      "query_gate_stations",
      "query_gate_change_over",
      "query_shift_notes",
    ]) {
      expect(names).toContain(name);
      expect(ASK_V_TOOL_REGISTRY.find((t) => t.name === name)).toMatchObject({
        mutating: false,
        confirmation: "none",
        execution: "server",
      });
    }
  }
});
