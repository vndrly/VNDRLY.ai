import { useQuery } from "@tanstack/react-query";
import type { EquipmentItem, EquipmentActivity, EquipmentType, EquipmentListResponse } from "@workspace/api-zod";
import { EquipmentListResponseSchema } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "./api";
import { captureAuthScope } from "./auth";

export const equipmentTypes: EquipmentType[] = ["truck", "cab", "trailer", "towed_rig", "booth", "other"];
export const equipmentActivities: EquipmentActivity[] = ["en_route", "on_run", "in_yard", "working", "unassigned"];
export const equipmentLabels: Record<EquipmentType | EquipmentActivity, [string, string]> = {
  truck: ["Truck", "Camión"], cab: ["Cab", "Cabina"], trailer: ["Trailer", "Remolque"], towed_rig: ["Towed rig", "Equipo remolcado"], booth: ["Booth", "Caseta"], other: ["Other", "Otro"],
  en_route: ["En Route", "En camino"], on_run: ["On Run", "En recorrido"], in_yard: ["In Yard", "En patio"], working: ["Working", "Trabajando"], unassigned: ["Last Known / Unassigned", "Última ubicación / Sin asignar"],
};
export function equipmentLabel(value: EquipmentType | EquipmentActivity, es = false) { return equipmentLabels[value][es ? 1 : 0]; }
export function equipmentMapPoints(items: EquipmentItem[]) {
  return items.filter(item => item.profile.trackOnMap && item.location && Number.isFinite(item.location.latitude) && Number.isFinite(item.location.longitude) && Math.abs(item.location.latitude) <= 90 && Math.abs(item.location.longitude) <= 180).map(item => ({ id: `equipment-${item.id}`, latitude: item.location!.latitude, longitude: item.location!.longitude, title: item.name, label: "E" }));
}
export function useEquipmentData(enabled = true) {
  const { user } = useAuth();
  const scope = captureAuthScope();
  return useQuery({ queryKey: ["equipment", user?.id, user?.activeMembershipId, scope.generation], enabled: !!user && enabled, refetchInterval: enabled ? 30000 : false, queryFn: async ({ signal }): Promise<EquipmentListResponse> => EquipmentListResponseSchema.parse(await apiFetch("/api/equipment", { signal }, scope)) });
}
