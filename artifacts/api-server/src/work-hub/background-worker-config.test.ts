import { describe, expect, it } from "vitest";
import { workHubBackgroundWorkersEnabled } from "./background-worker-config";

describe("workHubBackgroundWorkersEnabled", () => {
  it("keeps production workers enabled unless the local preview explicitly disables them", () => {
    expect(workHubBackgroundWorkersEnabled({})).toBe(true);
    expect(workHubBackgroundWorkersEnabled({ WORK_HUB_BACKGROUND_WORKERS_ENABLED: "1" })).toBe(true);
    expect(workHubBackgroundWorkersEnabled({ WORK_HUB_BACKGROUND_WORKERS_ENABLED: "0" })).toBe(false);
  });
});
