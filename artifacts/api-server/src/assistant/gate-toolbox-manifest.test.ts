import { describe, expect, it } from "vitest";
import {
  GATE_TOOLBOX_MANIFEST,
  REQUIRED_GATE_ACTIONS,
} from "./gate-toolbox-manifest";
import { ASK_V_TOOL_REGISTRY } from "./tool-registry";

describe("Ask V Gate toolbox manifest", () => {
  it("maps every Gate action to safe, platform-parity tooling", () => {
    expect(new Set(GATE_TOOLBOX_MANIFEST.map((row) => row.action))).toEqual(
      new Set(REQUIRED_GATE_ACTIONS),
    );

    for (const row of GATE_TOOLBOX_MANIFEST) {
      expect(row.web).toBe(true);
      expect(row.ios).toBe(true);
      const tool = ASK_V_TOOL_REGISTRY.find(
        (candidate) => candidate.name === row.tool,
      );
      expect(tool, `${row.action} -> ${row.tool}`).toBeTruthy();
      if (row.mutating) {
        expect(tool).toMatchObject({
          mutating: true,
          confirmation: "required",
        });
        expect(tool?.auditTarget).toBeTruthy();
      }
      if (row.kind === "client") {
        expect(tool?.execution).toBe("client");
      }
    }
  });
});
