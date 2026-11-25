import { expect, it } from "vitest";
import { iosPreviewParentOrigin, isIosPreviewParent } from "./gate-dashboard-session";

it("talks to the loopback preview that actually embedded the page", () => {
  expect(iosPreviewParentOrigin("https://127.0.0.1:8081/change-over")).toBe("https://127.0.0.1:8081");
  expect(iosPreviewParentOrigin("http://localhost:8081/gate")).toBe("http://localhost:8081");
  expect(iosPreviewParentOrigin("https://vndrly.ai/change-over")).toBe("http://localhost:8081");
  expect(iosPreviewParentOrigin("")).toBe("http://localhost:8081");
  window.history.replaceState({}, "", "/gate/change-over?gateDashboardEmbed=1&gatePreviewOrigin=https%3A%2F%2F127.0.0.1%3A8081");
  expect(iosPreviewParentOrigin("")).toBe("https://127.0.0.1:8081");
});

it("accepts only the local iOS preview as the parent", () => {
  expect(isIosPreviewParent("https://127.0.0.1:8081")).toBe(true);
  expect(isIosPreviewParent("http://localhost:8081")).toBe(true);
  expect(isIosPreviewParent("http://127.0.0.1:5173")).toBe(false);
  expect(isIosPreviewParent("https://vndrly.ai")).toBe(false);
});
