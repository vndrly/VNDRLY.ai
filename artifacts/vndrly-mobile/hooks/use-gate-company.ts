import { useLocalSearchParams } from "expo-router";
import { useAuth } from "./use-auth";
/** A platform admin can inspect a company without impersonating its users. Server authorization remains authoritative. */
export function useGateCompany() {
  const { user } = useAuth();
  const { vendorId } = useLocalSearchParams<{ vendorId?: string }>();
  const id = Number(vendorId);
  return user?.role === "admin" && Number.isSafeInteger(id) && id > 0
    ? id
    : user?.vendorId;
}
