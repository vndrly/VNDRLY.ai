import { expect, it, vi } from "vitest";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({}) }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: 1 }) }));
import { equipmentMapPoints } from "./equipment";
import type { EquipmentItem } from "@workspace/api-zod";
it("maps only opted-in equipment with real finite coordinates, including retained last-known locations", () => {
  const row = (id: string, track: boolean, location: any) => ({ id, name: id, profile: { trackOnMap: track }, location } as EquipmentItem);
  const point = { latitude: 31, longitude: -102, freshness: "last_known" };
  expect(equipmentMapPoints([row("retained", true, point), row("hidden", false, point), row("unavailable", true, null), row("invalid", true, { latitude: NaN, longitude: -102 })])).toEqual([{ id: "equipment-retained", title: "retained", label: "E", latitude: 31, longitude: -102 }]);
});
