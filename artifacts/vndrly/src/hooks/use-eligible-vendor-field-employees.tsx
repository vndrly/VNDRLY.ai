import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import {
  useListFieldEmployees,
  getListFieldEmployeesQueryKey,
  type FieldEmployee,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";

export type ServiceEmployee = FieldEmployee & {credentialMatch?:{status:string;missing:string[];expired:string[];required:string[];assignmentAllowed:boolean}};
export function useServiceEmployees(vendorId:number|undefined,workTypeIds:number[],siteId:number|undefined){
 return useQuery<ServiceEmployee[]>({queryKey:["service-employees",vendorId,workTypeIds,siteId],enabled:!!vendorId&&workTypeIds.length>0&&!!siteId,
 queryFn:async({signal})=>{const response=await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/field-employees?vendorId=${vendorId}&workTypeIds=${workTypeIds.join(',')}&siteId=${siteId}`,{credentials:'include',signal});if(!response.ok)throw new Error('Unable to load service employees');return response.json();}});
}
export function credentialMatchText(person:ServiceEmployee,es=false){
 const m=person.credentialMatch;if(!m)return '';
 if(m.status==='not_configured')return es?'Requisitos sin configurar':'Requirements not configured';
 if(m.status==='recorded_match')return es?'Credenciales registradas coinciden':'Recorded credentials match';
 return [m.missing.length?`${es?'Faltan':'Missing'}: ${m.missing.join(', ')}`:'',m.expired.length?`${es?'Vencidas':'Expired'}: ${m.expired.join(', ')}`:''].filter(Boolean).join(' · ');
}
// Task #516: shared source of truth for "which vendor_people may a vendor
// operator legally pick in an employee picker". Centralizes the eligibility
// rule that backs the phone-intake foreman dropdown and the Create New Job
// Field Employee dropdown in tickets.tsx — and any future picker hardened
// against the Task #507 server tenancy guard.
//
// The /field-employees endpoint already filters out soft-deleted rows,
// scopes vendor sessions to their own vendor, and (since #512) defaults to
// active-only. We still re-assert vendorId on the client because a stale
// cached page from a previous vendor membership can briefly leak after a
// membership switch — listing such a foreman would let the user submit a
// fieldEmployeeId the server's #507 guard would 400 on. We also drop
// `isActive === false` rows defensively in case a deactivated worker
// slips through (the dialog could have been opened before the deactivation
// landed in the cache).
function filterEligible(
  fieldEmployees: ServiceEmployee[] | undefined,
  vendorId: number | null,
): ServiceEmployee[] {
  if (!fieldEmployees || vendorId == null) return [];
  return fieldEmployees.filter(
    (fe) => fe.vendorId === vendorId && fe.isActive !== false,
  );
}

export function useEligibleVendorFieldEmployees(): {
  eligibleForemen: ServiceEmployee[];
  fieldEmployees: FieldEmployee[] | undefined;
} {
  const { user } = useAuth();
  const isVendor = user?.role === "vendor" && !!user.vendorId;
  const vendorId = isVendor ? user!.vendorId! : null;
  const { data: fieldEmployees } = useListFieldEmployees(
    vendorId != null ? { vendorId } : undefined,
  );
  const eligibleForemen = useMemo(
    () => filterEligible(fieldEmployees, vendorId),
    [fieldEmployees, vendorId],
  );
  return { eligibleForemen, fieldEmployees };
}

// Task #523: thin variant for surfaces that need to pick from a *specific*
// vendor's field employees rather than the operator's active vendor —
// schedule-ticket-dialog (the ticket's vendor, which an admin/partner may
// not belong to), the portal sign-in (the QR-selected vendor), and the
// vendor-detail employees card (the vendor in the URL). The defense is
// the same: re-assert vendorId on the client so a stale cached page can't
// leak a foreman the operator can't legally submit, and drop inactive
// rows so a deactivation that landed mid-dialog can't slip through.
export function useEligibleVendorFieldEmployeesByVendorId(
  vendorId: number | null | undefined,
  enabled = true,
  ticketId?: number,
): {
  eligibleForemen: ServiceEmployee[];
  fieldEmployees: FieldEmployee[] | undefined;
} {
  const normalizedId = vendorId ?? null;
  const { data: genericEmployees } = useListFieldEmployees(
    normalizedId != null ? { vendorId: normalizedId } : undefined,
    { query: { enabled: enabled && !ticketId, queryKey: getListFieldEmployeesQueryKey(normalizedId != null ? { vendorId: normalizedId } : undefined) } },
  );
  const {data: ticketEmployees} = useQuery<ServiceEmployee[]>({
    queryKey:["ticket-eligible-employees",normalizedId,ticketId],enabled:enabled && !!ticketId && !!normalizedId,
    queryFn:async ({signal})=>{
      const response=await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/field-employees?vendorId=${normalizedId}&ticketId=${ticketId}`,{credentials:"include",signal});
      if(!response.ok) throw new Error("Unable to load eligible ticket employees");
      return response.json();
    }
  });
  const fieldEmployees = ticketId ? ticketEmployees : genericEmployees;
  const eligibleForemen = useMemo(
    () => filterEligible(fieldEmployees, normalizedId),
    [fieldEmployees, normalizedId],
  );
  return { eligibleForemen, fieldEmployees };
}

// Task #516: companion helper that nulls out a no-longer-eligible selection.
// Mirrors the per-picker cleanup effects that previously lived inline in
// tickets.tsx — the operator may have switched their active vendor
// membership, the foreman may have been soft-deleted / deactivated since
// the dialog was opened, etc. In all of those cases we must drop the stale
// pick so we don't POST a fieldEmployeeId the Task #507 server tenancy
// guard would reject.
//
// `onClear` is held in a ref so a fresh inline arrow on every render won't
// retrigger the effect — we only want to react to the eligibility set or
// the selection itself changing, matching the original deps list.
//
// Task #523: `getId` is optional so callers that pick by something other
// than `field_employee.id` (e.g. schedule-ticket-dialog's foreman dropdown,
// which is keyed by `userId` because the server expects a user id) can
// reuse the same cleanup contract. Defaults to `String(fe.id)`.
export function useClearStaleFieldEmployeeSelection(args: {
  selectedId: string;
  eligibleForemen: ServiceEmployee[];
  fieldEmployees: FieldEmployee[] | undefined;
  onClear: () => void;
  getId?: (fe: FieldEmployee) => string | null;
}): void {
  const { selectedId, eligibleForemen, fieldEmployees, onClear, getId } = args;
  const onClearRef = useRef(onClear);
  const getIdRef = useRef(getId);
  useEffect(() => {
    onClearRef.current = onClear;
  }, [onClear]);
  useEffect(() => {
    getIdRef.current = getId;
  }, [getId]);
  useEffect(() => {
    if (!selectedId) return;
    if (!fieldEmployees) return; // wait for the list before deciding
    const matchId = getIdRef.current ?? ((fe: FieldEmployee) => String(fe.id));
    const stillEligible = eligibleForemen.some((fe) => {
      const id = matchId(fe);
      return id != null && id === selectedId;
    });
    if (!stillEligible) onClearRef.current();
  }, [eligibleForemen, fieldEmployees, selectedId]);
}
