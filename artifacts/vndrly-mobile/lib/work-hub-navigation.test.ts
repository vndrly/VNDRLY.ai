import { describe, expect, it } from "vitest";
import { workHubExitRoute, workHubModuleRoute } from "./work-hub-navigation";
describe("focused iOS Work Hub navigation", () => { it("navigates within Work Hub and exits to the main experience", () => { expect(workHubModuleRoute("Tasks & Forms")).toBe("/work-hub/tasks-forms"); expect(workHubExitRoute()).toBe("/(tabs)"); }); });
