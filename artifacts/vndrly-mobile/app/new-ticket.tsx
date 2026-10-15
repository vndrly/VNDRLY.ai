import * as Location from "expo-location";
import { router, Stack, useLocalSearchParams } from "expo-router";
import PortalPageHeader from "@/components/PortalPageHeader";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import { useBrand } from "@/hooks/use-brand";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { Feather } from "@expo/vector-icons";
import LayeredPillButton from "@/components/LayeredPillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { getApiErrorCode, translateApiError } from "@/lib/apiErrors";
import { isFieldEmployeeUser, isPartnerOfficeUser, isForemanEmployeeUser } from "@/lib/mobile-viewer";

type Site = {
  id: number;
  name: string;
  address: string | null;
  state: string | null;
  siteCode: string;
  partnerName: string | null;
};

type WorkType = { id: number; name: string; category: string | null };

// Task #498 — option in the foreman picker on the adjacent-ticket form.
// `userId` is what the server's `foremanUserId` body field expects (a
// validated, vendor-scoped, foreman-eligible user id). `vendorPersonId`
// is unused on the wire but kept for stable React keys / future labels.
type ForemanOption = {
  vendorPersonId: number;
  userId: number;
  firstName: string | null;
  lastName: string | null;
};

type FieldMe = {
  employeeId: number;
  // Task #498: returned alongside employeeId so the foreman picker can
  // identify the "self" chip — /api/field/foremen lists `userId`, not
  // `employeeId`, so we need this to match against the picker selection.
  userId: number;
  firstName: string | null;
  lastName: string | null;
  vendorId: number;
};

type VendorOption = { id: number; name: string };

type SiteAssignment = {
  workTypeId: number;
  workTypeName: string;
  workTypeCategory: string | null;
  vendorId: number;
  vendorName: string;
};

export default function NewTicketScreen() {
  const colors = useColors();
  const brand = useBrand();
  const scrollRef = useRef<ScrollView>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  useEffect(() => { scrollRef.current?.scrollTo?.({ y: 0, animated: false }); }, [step]);
  const [sitePickerOpen, setSitePickerOpen] = useState(false);
  const [siteSearch, setSiteSearch] = useState("");
  const [siteLimit, setSiteLimit] = useState(12);
  const { t } = useTranslation();
  const { user } = useAuth();
  const isFieldFlow = isFieldEmployeeUser(user);
  const isPartnerFlow = isPartnerOfficeUser(user);
  const { siteCode, siteId: siteIdParam, adjacent } = useLocalSearchParams<{
    siteCode?: string;
    siteId?: string;
    adjacent?: string;
  }>();
  // Task #498: when launched from a live ticket, the screen is acting as
  // an "adjacent ticket" initiator — header text changes to make that
  // intent clear AND a foreman picker is shown (defaulting to self) so
  // the on-site lead can attribute the new ticket to a teammate when
  // appropriate. Spec: "suggested foreman = self (overridable)".
  const isAdjacent = adjacent === "1";
  const [sites, setSites] = useState<Site[]>([]);
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [selectedWorkTypeIds, setSelectedWorkTypeIds] = useState<number[]>([]);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const canAssign = isForemanEmployeeUser(user) || user?.role === "vendor" || user?.role === "admin";
  const [assignMode, setAssignMode] = useState(canAssign);
  const [assignees, setAssignees] = useState<Array<{id:number;firstName:string|null;lastName:string|null}>>([]);
  const [assigneeId, setAssigneeId] = useState<number|null>(null);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [assigneeError, setAssigneeError] = useState<string|null>(null);
  const [onSiteNow, setOnSiteNow] = useState(!canAssign);
  useEffect(() => {
    if (!canAssign) return;
    let current = true;
    setAssigneesLoading(true);
    apiFetch<typeof assignees>(`/api/field-employees${user?.vendorId ? `?vendorId=${user.vendorId}` : ""}`)
      .then(rows => { if(current) {setAssignees(rows);setAssigneeError(null);} })
      .catch(error => { if(current) setAssigneeError(translateApiError(error,t)); })
      .finally(() => { if(current) setAssigneesLoading(false); });
    return () => {current=false;};
  }, [canAssign,user?.vendorId,t]);
  // Task #498 — adjacent-ticket foreman picker state. Both lists default
  // to empty / null so a non-adjacent flow never pays the
  // /api/field/foremen + /api/field/me round-trip cost.
  const [foremen, setForemen] = useState<ForemanOption[]>([]);
  const [me, setMe] = useState<FieldMe | null>(null);
  const [foremanUserId, setForemanUserId] = useState<number | null>(null);
  // Task #526: surface server-side structured validation codes inline on
  // the offending picker rather than just popping a generic alert. We
  // track ONE active code at a time (the server returns one per request),
  // mirroring the web phone-intake form (Task #509 + #517). The codes we
  // recognize here are the same ones the office POST /tickets endpoint
  // emits — if the field POST endpoint is ever migrated to emit them
  // too, this UI will pick them up automatically without further changes.
  type FieldErrorCode =
    | ""
    | "site_not_found"
    | "site_vendor_mismatch"
    | "work_type_not_allowed";
  const [fieldErrorCode, setFieldErrorCode] = useState<FieldErrorCode>("");
  // Task #535: when the server tells us a site is no longer available
  // (POST /api/field/tickets responds with `site_not_found`), we refresh
  // the list, clear the stale selection, and surface a friendly banner
  // at the top of the form so the operator understands why their picker
  // was reset. We avoid stacking it with the inline `errors.site_not_found`
  // string under the picker — the banner replaces it for this case.
  const [siteUnavailableNotice, setSiteUnavailableNotice] = useState(false);
  // Task #560: same idea for work types — when POST responds with
  // `work_type_not_allowed`, re-fetch /api/field/sites/:id/work-types,
  // drop any selected work types that are no longer in the list, and
  // surface a friendly banner above the chips. This replaces the inline
  // `errors.work_type_not_allowed` text for this case so the operator
  // sees a single, action-oriented message instead of stale chips +
  // generic copy.
  const [workTypeUnavailableNotice, setWorkTypeUnavailableNotice] =
    useState(false);
  // Guard against a race when the operator switches sites: the previous
  // site's work-type chips must disappear immediately and submit must
  // stay disabled until the new site's list has loaded.
  const [workTypesSiteId, setWorkTypesSiteId] = useState<number | null>(null);
  const [workTypesLoading, setWorkTypesLoading] = useState(false);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(
    user?.vendorId ?? null,
  );
  const siteErrorCode =
    fieldErrorCode === "site_not_found" ||
    fieldErrorCode === "site_vendor_mismatch"
      ? fieldErrorCode
      : "";
  const workTypeErrorCode =
    fieldErrorCode === "work_type_not_allowed" ? fieldErrorCode : "";

  const loadSites = useCallback(async (): Promise<Site[]> => {
    if (isFieldFlow) {
      const data = await apiFetch<Site[]>("/api/field/sites");
      const next = data || [];
      setSites(next);
      return next;
    }
    const data = await apiFetch<
      Array<{
        id: number;
        name: string;
        address: string | null;
        state: string | null;
        siteCode: string;
        partnerName: string | null;
      }>
    >("/api/site-locations");
    const next = (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      state: row.state,
      siteCode: row.siteCode,
      partnerName: row.partnerName ?? null,
    }));
    setSites(next);
    return next;
  }, [isFieldFlow]);

  useEffect(() => {
    if (!isPartnerFlow) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await apiFetch<VendorOption[]>("/api/vendors");
        if (!cancelled) setVendors(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setVendors([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPartnerFlow]);

  // Task #560: extracted so the post-submit recovery path can re-use it
  // when the server emits `work_type_not_allowed`. Returns the fresh
  // list so the caller can prune any selected ids that disappeared.
  const loadWorkTypes = useCallback(
    async (forSiteId: number): Promise<WorkType[]> => {
      if (isFieldFlow) {
        const data = await apiFetch<WorkType[]>(
          `/api/field/sites/${forSiteId}/work-types`,
        );
        const next = data || [];
        setWorkTypes(next);
        return next;
      }
      const assignments = await apiFetch<SiteAssignment[]>(
        `/api/site-locations/${forSiteId}/assignments`,
      );
      const vendorScope =
        user?.role === "partner" ? selectedVendorId : user?.vendorId ?? null;
      const filtered =
        vendorScope != null
          ? (assignments ?? []).filter((row) => row.vendorId === vendorScope)
          : assignments ?? [];
      const seen = new Set<number>();
      const next: WorkType[] = [];
      for (const row of filtered) {
        if (seen.has(row.workTypeId)) continue;
        seen.add(row.workTypeId);
        next.push({
          id: row.workTypeId,
          name: row.workTypeName,
          category: row.workTypeCategory,
        });
      }
      setWorkTypes(next);
      return next;
    },
    [isFieldFlow, selectedVendorId, user?.role, user?.vendorId],
  );

  useEffect(() => {
    (async () => {
      try {
        const data = await loadSites();
        if (siteIdParam) {
          const idNum = Number(siteIdParam);
          if (Number.isFinite(idNum) && data.some((s) => s.id === idNum)) {
            setSiteId(idNum);
          }
        } else if (siteCode) {
          const match = data.find((s) => s.siteCode === siteCode);
          if (match) setSiteId(match.id);
        }
      } catch (e) {
        Alert.alert(t("common.error"), t("tickets.errorLoadOpen"));
      } finally {
        setLoading(false);
      }
    })();
  }, [siteCode, siteIdParam, t, loadSites]);

  // Task #498 — load the foreman picker options + the current user only
  // when the form is in adjacent mode. Both endpoints are cheap, but
  // there's no value in paying for them on the regular self-create flow
  // where the foreman is implicitly the creator. We never block the
  // submit on a load failure: if either fetch fails we leave
  // `foremanUserId` null and the server's default ("foreman = self")
  // takes over, matching the behavior before this picker existed.
  useEffect(() => {
    if (!isAdjacent) return;
    let cancelled = false;
    (async () => {
      try {
        const [meData, foremenData] = await Promise.all([
          apiFetch<FieldMe>("/api/field/me"),
          apiFetch<ForemanOption[]>("/api/field/foremen"),
        ]);
        if (cancelled) return;
        setMe(meData ?? null);
        setForemen(foremenData ?? []);
      } catch {
        // Soft-fail: the server still defaults foreman to the creator
        // when the body field is absent, so the form stays usable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdjacent]);

  useEffect(() => {
    // Always clear selections when site changes — a previously selected
    // work type may not be valid for the new site.
    setSelectedWorkTypeIds([]);
    // Task #526: clear any inline field error when the site changes —
    // both the site-level codes and work-type-level codes are scoped to
    // a (site, vendor, work_type) tuple, so a new site invalidates them.
    setFieldErrorCode("");
    // Task #535: a fresh site selection means the operator has acted on
    // the "site no longer available" banner — drop it.
    if (siteId) setSiteUnavailableNotice(false);
    // Task #560: a different site means a different work-type list — the
    // "work type no longer approved" banner only ever applies to the
    // site it was raised for, so drop it on any site change.
    setWorkTypeUnavailableNotice(false);
    if (!siteId) {
      setWorkTypes([]);
      setWorkTypesSiteId(null);
      setWorkTypesLoading(false);
      return;
    }
    let cancelled = false;
    setWorkTypes([]);
    setWorkTypesSiteId(null);
    setWorkTypesLoading(true);
    (async () => {
      try {
        await loadWorkTypes(siteId);
        if (!cancelled) setWorkTypesSiteId(siteId);
      } catch (e) {
        if (!cancelled) {
          Alert.alert(
            t("common.error"),
            e instanceof Error ? e.message : t("toasts.failed"),
          );
        }
      } finally {
        if (!cancelled) setWorkTypesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId, t, loadWorkTypes, selectedVendorId, user?.vendorId]);

  useEffect(() => {
    if (user?.vendorId != null) setSelectedVendorId(user.vendorId);
  }, [user?.vendorId]);

  const toggleWorkType = (id: number) => {
    setSelectedWorkTypeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    // Task #526: any work-type change invalidates a prior
    // work_type_not_allowed inline error.
    if (workTypeErrorCode) setFieldErrorCode("");
    // Task #560: picking from the refreshed list means the operator has
    // acted on the "work type no longer approved" banner — drop it.
    if (workTypeUnavailableNotice) setWorkTypeUnavailableNotice(false);
  };

  const onCreate = async () => {
    if ((assignMode && (!assigneeId || assigneesLoading || assigneeError)) || !siteId || selectedWorkTypeIds.length === 0) {
      Alert.alert(t("tickets.newJob.missingInfoTitle"), t("tickets.newJob.missingInfoBody"));
      return;
    }
    if (workTypesLoading || workTypesSiteId !== siteId) {
      Alert.alert(t("common.error"), t("tickets.newJob.workTypesLoading"));
      return;
    }
    const allowedWorkTypeIds = new Set(workTypes.map((w) => w.id));
    const staleSelection = selectedWorkTypeIds.some((id) => !allowedWorkTypeIds.has(id));
    if (staleSelection) {
      setSelectedWorkTypeIds((prev) => prev.filter((id) => allowedWorkTypeIds.has(id)));
      setWorkTypeUnavailableNotice(true);
      return;
    }
    // Task #526: clear any prior structured field error before retrying —
    // without this the inline message would stick around even after the
    // operator changed the offending picker.
    setFieldErrorCode("");
    setCreating(true);
    try {
      let lat: number | null = null;
      let lng: number | null = null;
      if (isFieldFlow && !assignMode && onSiteNow) {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status === "granted") {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        }
      }

      const ticketVendorId =
        user?.role === "partner" ? selectedVendorId : user?.vendorId ?? null;
      if (!isFieldFlow && (ticketVendorId == null || !Number.isFinite(ticketVendorId))) {
        Alert.alert(t("common.error"), t("tickets.newJob.pickVendor"));
        setCreating(false);
        return;
      }

      const results = await Promise.allSettled(
        selectedWorkTypeIds.map((wtId) =>
          isFieldFlow
            ? apiFetch<{ id: number }>("/api/field/tickets", {
                method: "POST",
                body: JSON.stringify({
                  siteLocationId: siteId,
                  workTypeId: wtId,
                  latitude: lat,
                  longitude: lng,
                  description: description || null,
                  initialState: !assignMode && onSiteNow ? "on_site" : "pending_arrival",
                  ...(assignMode ? {fieldEmployeeId:assigneeId} : {}),
                  adjacent: !assignMode && isAdjacent,
                  ...(isAdjacent && foremanUserId != null
                    ? { foremanUserId }
                    : {}),
                }),
              })
            : apiFetch<{ id: number }>("/api/tickets", {
                method: "POST",
                body: JSON.stringify({
                  siteLocationId: siteId,
                  vendorId: ticketVendorId,
                  workTypeId: wtId,
                  description: description || null,
                  initialState: !assignMode && onSiteNow ? "on_site" : "pending_arrival",
                  ...(assignMode ? {fieldEmployeeId:assigneeId} : {}),
                  intakeChannel:
                    user?.role === "partner"
                      ? "office_on_behalf_of_partner"
                      : null,
                }),
              }),
        ),
      );

      const created = results
        .filter(
          (r): r is PromiseFulfilledResult<{ id: number }> =>
            r.status === "fulfilled",
        )
        .map((r) => r.value);
      const failed = results.filter((r) => r.status === "rejected").length;

      if (created.length === 0) {
        const firstErr = results.find((r) => r.status === "rejected") as
          | PromiseRejectedResult
          | undefined;
        const reason = firstErr?.reason;
        // Task #526: detect structured field-level codes and surface
        // them inline next to the offending picker instead of (or in
        // addition to) the alert. translateApiError() handles all
        // localization — the off_geofence interpolation, the legacy
        // English-message fallback, and the new structured code lookup
        // (`errors.<code>`) all flow through a single helper.
        const code = getApiErrorCode(reason);
        if (code === "site_not_found") {
          setStep(0); setSiteSearch("");
          // Task #535: the picker's selected site disappeared between
          // load and submit (deleted or unassigned by the office).
          // Refresh /api/field/sites so the picker shows the current
          // options, drop the now-invalid selection, and surface a
          // friendly banner at the top — far more informative than the
          // generic inline `errors.site_not_found` text under a picker
          // the operator already chose.
          try {
            await loadSites();
          } catch {
            // Refresh failure is non-fatal — the banner still tells the
            // operator the picked site isn't available, and they can
            // pull-to-refresh manually if the rest of the list is stale.
          }
          setSiteId(null);
          setFieldErrorCode("");
          setSiteUnavailableNotice(true);
          return;
        }
        if (code === "work_type_not_allowed") {
          setStep(1);
          // Task #560: parallel of the site_not_found recovery above —
          // the office removed the work type from this site between the
          // picker load and submit. Re-fetch the work-type list, prune
          // any selected ids that no longer appear, and surface a
          // friendly banner that replaces the generic inline error so
          // the operator immediately sees what happened.
          if (siteId) {
            try {
              const fresh = await loadWorkTypes(siteId);
              const allowed = new Set(fresh.map((w) => w.id));
              setSelectedWorkTypeIds((prev) =>
                prev.filter((id) => allowed.has(id)),
              );
            } catch {
              // Refresh failure is non-fatal — clearing the selection
              // below + showing the banner still gives the operator a
              // recoverable path. They can change site or pull-to-refresh.
              setSelectedWorkTypeIds([]);
            }
          } else {
            setSelectedWorkTypeIds([]);
          }
          setFieldErrorCode("");
          setWorkTypeUnavailableNotice(true);
          return;
        }
        if (code === "site_vendor_mismatch") {
          setStep(1);
          setFieldErrorCode(code);
          // No alert — the inline message under the picker is the UX.
          return;
        }
        const msg = translateApiError(
          reason,
          t,
          t("tickets.newJob.failedToCreate"),
        );
        Alert.alert(t("common.error"), msg);
        return;
      }

      if (created.length === 1 && failed === 0) {
        router.replace(`/ticket/${created[0]!.id}`);
        return;
      }

      const numbers = created
        .map((c) => `#${String(c.id).padStart(4, "0")}`)
        .join(", ");
      const partial = failed > 0 ? t("tickets.newJob.failedSuffix", { count: failed }) : "";
      Alert.alert(
        t("tickets.newJob.createdManyTitle", { count: created.length, partial }),
        numbers,
        [{ text: t("common.ok"), onPress: () => router.replace("/(tabs)") }],
      );
    } catch (e: unknown) {
      // Task #526: route through translateApiError so structured codes
      // and language-aware copy reach the operator instead of raw
      // English from the server.
      const msg = translateApiError(e, t, t("tickets.newJob.failedToCreate"));
      Alert.alert(t("common.error"), msg);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenSafeArea includeTopGap={false} edges={["top", "left", "right"]}><PortalPageHeader title={t("stack.newTicket")} testIdPrefix="new-job" fallbackHref="/" backBehavior="history" notificationHref="/notifications" /></ScreenSafeArea>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  const workTypesReady =
    siteId != null && !workTypesLoading && workTypesSiteId === siteId;
  const submitDisabled =
    creating ||
    (assignMode && (!assigneeId || assigneesLoading || !!assigneeError)) ||
    !siteId ||
    !workTypesReady ||
    selectedWorkTypeIds.length === 0 ||
    (isPartnerFlow && selectedVendorId == null);

  const selectedSite = sites.find(site => site.id === siteId);
  const matchedSites = sites.filter(site => [site.name, site.partnerName, site.address, site.state, site.siteCode].some(value => value?.toLowerCase().includes(siteSearch.trim().toLowerCase())));
  const selectedNames = workTypes.filter(work => selectedWorkTypeIds.includes(work.id)).map(work => work.name);
  const cardStyle = [styles.wizardCard, { borderColor: brand.primary, backgroundColor: colors.card }];
  const stepLabels = [t("tickets.newJob.wizard.site"), t("tickets.newJob.wizard.work"), t("tickets.newJob.wizard.review")];
  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenSafeArea includeTopGap={false} edges={["top", "left", "right"]}>
        <PortalPageHeader title={t("stack.newTicket")} testIdPrefix="new-job" fallbackHref="/" backBehavior="history" notificationHref="/notifications" />
      </ScreenSafeArea>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:16,paddingBottom:40,gap:16}}>
        <Text style={{color:colors.mutedForeground}}>{t("tickets.newJob.wizard.intro")}</Text>
        <View style={{flexDirection:"row",gap:8}}>
          {stepLabels.map((label,index)=><TouchableOpacity key={label} accessibilityRole="button" accessibilityState={{selected:step===index}} disabled={creating || index>step} onPress={()=>setStep(index as 0|1|2)} style={{flex:1,paddingVertical:12,borderBottomWidth:3,borderBottomColor:step===index?brand.primary:colors.border}} testID={`new-job-step-${index}`}><Text style={{color:step===index?brand.primary:colors.mutedForeground,fontFamily:"Inter_700Bold"}}>{index+1}. {label}</Text></TouchableOpacity>)}
        </View>
      {isAdjacent ? (
        <Text
          style={{
            color: colors.foreground,
            fontFamily: "Inter_700Bold",
            fontSize: 18,
            marginBottom: 12,
          }}
          testID="header-adjacent-ticket"
        >
          {t("tickets.initiateAdjacentTicket", {
            defaultValue: "Initiate adjacent ticket",
          })}
        </Text>
      ) : null}
      {siteUnavailableNotice ? (
        <View
          style={{
            backgroundColor: colors.accent,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
          }}
          testID="site-unavailable-banner"
        >
          <Text
            style={{
              color: colors.accentForeground,
              fontFamily: "Inter_500Medium",
              fontSize: 13,
            }}
          >
            {t("tickets.newJob.siteUnavailableRefreshed")}
          </Text>
        </View>
      ) : null}

        {siteErrorCode && !siteUnavailableNotice ? <Text testID="site-field-error" style={{color:colors.destructive}}>{t(`errors.${siteErrorCode}`)}</Text> : null}
        <View style={[cardStyle,{display:step===0?"flex":"none"}]} testID="new-job-site-step">
          <Text style={[styles.label,{color:colors.foreground}]}>{t("tickets.newJob.wizard.chooseSite")}</Text>
          <TouchableOpacity testID="new-job-site-dropdown" accessibilityRole="button" accessibilityState={{expanded:sitePickerOpen}} onPress={()=>setSitePickerOpen(open=>!open)} style={{minHeight:48,paddingHorizontal:12,borderWidth:2,borderColor:brand.primary,borderRadius:10,flexDirection:"row",alignItems:"center",gap:12}}>
            <Feather name="map-pin" size={20} color={brand.primary} />
            <Text style={{flex:1,color:colors.foreground,fontFamily:"Inter_600SemiBold"}}>{selectedSite?.name ?? t("tickets.newJob.wizard.selectSite")}</Text>
            <Feather name={sitePickerOpen?"chevron-up":"chevron-down"} size={20} color={brand.primary} />
          </TouchableOpacity>
          <View style={{display:sitePickerOpen?"flex":"none",marginTop:12}} testID="new-job-site-options">
          <View style={{flexDirection:"row",alignItems:"center",gap:8,borderWidth:2,borderColor:brand.primary,borderRadius:10,paddingHorizontal:12,marginBottom:12}}>
            <Feather name="search" size={18} color={colors.mutedForeground} />
            <TextInput testID="new-job-site-search" accessibilityLabel={t("tickets.newJob.wizard.searchSites")} placeholder={t("tickets.newJob.wizard.searchSites")} placeholderTextColor={colors.mutedForeground} value={siteSearch} onChangeText={value=>{setSiteSearch(value);setSiteLimit(12);}} style={{flex:1,minHeight:44,color:colors.foreground}} />
          </View>
          {matchedSites.slice(0,siteLimit).map(site=><TouchableOpacity key={site.id} testID={`new-job-site-${site.id}`} accessibilityRole="button" accessibilityState={{selected:siteId===site.id}} onPress={()=>{setSiteId(site.id);setSitePickerOpen(false);setStep(1);}} style={{padding:14,borderWidth:2,borderColor:siteId===site.id?brand.primary:colors.border,borderRadius:10,marginBottom:8,flexDirection:"row",alignItems:"center",gap:12}}>
            <Feather name="map-pin" size={20} color={brand.primary} /><View style={{flex:1}}><Text style={{color:colors.foreground,fontFamily:"Inter_700Bold"}}>{site.name}</Text><Text style={{color:colors.mutedForeground,fontSize:12,marginTop:4}}>{[site.partnerName,site.address,site.state].filter(Boolean).join(" · ")}</Text></View><Feather name={siteId===site.id?"check-circle":"chevron-right"} size={18} color={brand.primary} />
          </TouchableOpacity>)}
          {!matchedSites.length?<Text style={{color:colors.mutedForeground}}>{sites.length?t("common.noResults"):t("tickets.newJob.noSites")}</Text>:null}
          {matchedSites.length>siteLimit?<LayeredPillButton onPress={()=>setSiteLimit(value=>value+12)} inactive><Text style={{color:colors.foreground}}>{t("tickets.newJob.wizard.moreSites")}</Text></LayeredPillButton>:null}
          </View>
        </View>
        <View style={[cardStyle,{display:step===1?"flex":"none"}]} testID="new-job-work-step">
          <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:12}}><View style={{flex:1}}><Text style={{color:colors.mutedForeground,fontSize:12}}>{t("tickets.site")}</Text><Text style={{color:colors.foreground,fontFamily:"Inter_700Bold"}}>{selectedSite?.name}</Text></View><TouchableOpacity accessibilityRole="button" onPress={()=>setStep(0)} testID="new-job-change-site"><Text style={{color:brand.primary}}>{t("tickets.newJob.wizard.change")}</Text></TouchableOpacity></View>
      {isPartnerFlow ? (
        <>
          <Text style={[styles.label, { color: colors.foreground }]}>
            {t("tickets.newJob.vendorLabel")}
          </Text>
          <View style={styles.chips}>
            {vendors.map((v) => (
              <TouchableOpacity
                key={v.id}
                onPress={() => setSelectedVendorId(v.id)}
                style={[
                  styles.chip,
                  {
                    borderColor: colors.border,
                    backgroundColor:
                      selectedVendorId === v.id ? colors.primary : colors.card,
                  },
                ]}
              >
                <Text
                  style={{
                    color: selectedVendorId === v.id ? "#ffffff" : colors.foreground,
                    fontFamily: "Inter_500Medium",
                  }}
                >
                  {v.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}
      {siteId ? (
        <>
          <Text
            style={[
              styles.label,
              { color: colors.foreground, marginTop: 18 },
            ]}
          >
            {t("tickets.newJob.workTypes")}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 12,
              marginBottom: 8,
              fontFamily: "Inter_400Regular",
            }}
          >
            {t("tickets.newJob.workTypesHelp")}
          </Text>
          {workTypeUnavailableNotice ? (
            <View
              style={{
                backgroundColor: colors.accent,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 8,
                padding: 12,
                marginBottom: 12,
              }}
              testID="work-type-unavailable-banner"
            >
              <Text
                style={{
                  color: colors.accentForeground,
                  fontFamily: "Inter_500Medium",
                  fontSize: 13,
                }}
              >
                {t("tickets.newJob.workTypeUnavailableRefreshed")}
              </Text>
              <Text
                style={{
                  color: colors.accentForeground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  marginTop: 6,
                }}
              >
                {t("tickets.newJob.workTypeContactAdmin")}
              </Text>
            </View>
          ) : null}
          {workTypesLoading ? (
            <ActivityIndicator
              color={colors.primary}
              style={{ marginVertical: 12 }}
              testID="work-types-loading"
            />
          ) : null}
          <View style={styles.chips}>
            {workTypesReady
              ? workTypes.map((w) => {
              const selected = selectedWorkTypeIds.includes(w.id);
              return (
                <TouchableOpacity
                  key={w.id}
                  onPress={() => toggleWorkType(w.id)}
                  style={[
                    styles.chip,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.primary : colors.card,
                      borderWidth: selected ? 2 : 1,
                    },
                  ]}
                  testID={`work-type-${w.id}`}
                >
                  <Text
                    style={{
                      color: selected
                        ? colors.primaryForeground
                        : colors.foreground,
                      fontFamily: "Inter_500Medium",
                    }}
                  >
                    {selected ? "✓ " : ""}
                    {w.name}
                  </Text>
                </TouchableOpacity>
              );
            })
              : null}
          </View>
          {selectedWorkTypeIds.length > 0 ? (
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                marginTop: 8,
                fontFamily: "Inter_400Regular",
              }}
            >
              {t("tickets.newJob.selected", { count: selectedWorkTypeIds.length })}
            </Text>
          ) : null}
          {workTypeErrorCode ? (
            <Text
              style={{
                color: colors.destructive,
                fontSize: 12,
                marginTop: 8,
                fontFamily: "Inter_500Medium",
              }}
              testID="work-type-field-error"
            >
              {t(`errors.${workTypeErrorCode}`)}
            </Text>
          ) : null}
        </>
      ) : null}

      {isAdjacent ? (
        <>
          <Text
            style={[styles.label, { color: colors.foreground, marginTop: 18 }]}
          >
            {t("tickets.newJob.foremanLabel")}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 12,
              marginBottom: 8,
              fontFamily: "Inter_400Regular",
            }}
          >
            {t("tickets.newJob.foremanHelp")}
          </Text>
          <View style={styles.chips} testID="foreman-picker">
            {/* Self chip is always present and selected by default — the
                spec calls for "suggested foreman = self (overridable)".
                We render it from `me` when the lookup succeeds, falling
                back to a generic "Me" label if the /api/field/me call
                soft-failed so the picker still works. Selection is
                tracked via foremanUserId === me.userId, treating null
                as "self" for the highlight state. */}
            {(() => {
              const selfSelected =
                foremanUserId == null ||
                (me != null && foremanUserId === me.userId);
              const selfLabel = me
                ? `${me.firstName ?? ""} ${me.lastName ?? ""}`.trim() ||
                  t("tickets.newJob.foremanSelf")
                : t("tickets.newJob.foremanSelf");
              return (
                <TouchableOpacity
                  key="self"
                  onPress={() => setForemanUserId(null)}
                  style={[
                    styles.chip,
                    {
                      borderColor: selfSelected
                        ? colors.primary
                        : colors.border,
                      backgroundColor: selfSelected
                        ? colors.primary
                        : colors.card,
                      borderWidth: selfSelected ? 2 : 1,
                    },
                  ]}
                  testID="foreman-self"
                >
                  <Text
                    style={{
                      color: selfSelected
                        ? colors.primaryForeground
                        : colors.foreground,
                      fontFamily: "Inter_500Medium",
                    }}
                  >
                    {selfSelected ? "✓ " : ""}
                    {selfLabel} {t("tickets.newJob.foremanSelfSuffix")}
                  </Text>
                </TouchableOpacity>
              );
            })()}
            {foremen
              .filter((f) => f.userId != null && f.userId !== me?.userId)
              .map((f) => {
                const selected = foremanUserId === f.userId;
                const label =
                  `${f.firstName ?? ""} ${f.lastName ?? ""}`.trim() ||
                  `#${f.userId}`;
                return (
                  <TouchableOpacity
                    key={f.vendorPersonId}
                    onPress={() => setForemanUserId(f.userId)}
                    style={[
                      styles.chip,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected
                          ? colors.primary
                          : colors.card,
                        borderWidth: selected ? 2 : 1,
                      },
                    ]}
                    testID={`foreman-${f.userId}`}
                  >
                    <Text
                      style={{
                        color: selected
                          ? colors.primaryForeground
                          : colors.foreground,
                        fontFamily: "Inter_500Medium",
                      }}
                    >
                      {selected ? "✓ " : ""}
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
          </View>
        </>
      ) : null}

      {canAssign ? <View style={{gap:12,marginVertical:12}}>
        <Text style={[styles.label,{color:colors.foreground}]}>{t("tickets.newJob.assignment.title")}</Text>
        <View style={{flexDirection:"row",gap:8}}>
          <LayeredPillButton testID="new-job-assign-mode" inactive={!assignMode} onPress={()=>{setAssignMode(true);setOnSiteNow(false);}}><Text>{t("tickets.newJob.assignment.assign")}</Text></LayeredPillButton>
          <LayeredPillButton testID="new-job-self-mode" inactive={assignMode} onPress={()=>{setAssignMode(false);setOnSiteNow(false);}}><Text>{t("tickets.newJob.assignment.myself")}</Text></LayeredPillButton>
        </View>
        {assignMode ? <View style={{gap:8}}>
          {assigneesLoading ? <ActivityIndicator /> : assignees.map(person=><TouchableOpacity key={person.id} testID={`new-job-assignee-${person.id}`} accessibilityRole="button" accessibilityState={{selected:assigneeId===person.id}} onPress={()=>setAssigneeId(person.id)} style={{padding:12,borderRadius:8,borderWidth:2,borderColor:assigneeId===person.id?brand.primary:colors.border}}><Text style={{color:colors.foreground}}>{[person.firstName,person.lastName].filter(Boolean).join(" ")}</Text></TouchableOpacity>)}
          {assigneeError ? <Text style={{color:colors.destructive}}>{assigneeError}</Text> : !assigneesLoading && !assignees.length ? <Text style={{color:colors.mutedForeground}}>{t("tickets.newJob.assignment.empty")}</Text>:null}
          <Text style={{color:colors.mutedForeground}}>{t("tickets.newJob.assignment.help")}</Text>
        </View>:null}
      </View>:null}
      <View style={{display:assignMode?"none":"flex"}}>
      <Text
        style={[styles.label, { color: colors.foreground, marginTop: 18 }]}
      >
        {t("common.notes")}
      </Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder={t("tickets.newJob.noticePlaceholder")}
        placeholderTextColor={colors.mutedForeground}
        multiline
        style={[
          styles.textarea,
          {
            borderColor: colors.border,
            color: colors.foreground,
            backgroundColor: colors.card,
          },
        ]}
      />

      <Text
        style={[styles.label, { color: colors.foreground, marginTop: 18 }]}
      >
        {t("tickets.newJob.onSiteNow")}
      </Text>
      <View style={styles.pillRow}>
        <LayeredPillButton
          onPress={() => setOnSiteNow(true)}
          inactive={!onSiteNow}
          height={40}
          style={styles.pillHalf}
          testID="toggle-on-site-now"
        >
          <Feather name="map-pin" size={16} color="#ffffff" style={styles.pillIconShadow} />
          <Text style={[styles.pillText, styles.pillTextShadow, { color: "#ffffff" }]}>
            {t("tickets.newJob.yesHere")}
          </Text>
        </LayeredPillButton>
        <LayeredPillButton
          onPress={() => setOnSiteNow(false)}
          inactive={onSiteNow}
          height={40}
          style={styles.pillHalf}
          testID="toggle-not-yet"
        >
          <Feather name="clock" size={16} color="#ffffff" style={styles.pillIconShadow} />
          <Text style={[styles.pillText, styles.pillTextShadow, { color: "#ffffff" }]}>
            {t("tickets.newJob.notYet")}
          </Text>
        </LayeredPillButton>
      </View>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 12,
          marginTop: 6,
        }}
      >
        {onSiteNow
          ? t("tickets.newJob.onSiteHelp")
          : t("tickets.newJob.notYetHelp")}
      </Text>


        </View>
      </View>
        <View style={[cardStyle,{display:step===2?"flex":"none"}]} testID="new-job-review-step">
          <Text style={[styles.label,{color:colors.foreground,fontSize:18}]}>{t("tickets.newJob.wizard.reviewTitle")}</Text>
          <Text style={{color:colors.mutedForeground,marginBottom:16}}>{t("tickets.newJob.wizard.reviewHelp")}</Text>
          {[[t("tickets.newJob.assignment.title"),assignMode?assignees.filter(person=>person.id===assigneeId).map(person=>[person.firstName,person.lastName].filter(Boolean).join(" ")).join(""):null],[t("tickets.site"),selectedSite?.name],[t("tickets.newJob.vendorLabel"),isPartnerFlow?vendors.find(vendor=>vendor.id===selectedVendorId)?.name:brand.name],[t("tickets.newJob.workTypes"),selectedNames.join(" · ")],[t("tickets.newJob.onSiteNow"),t(!assignMode && onSiteNow?"tickets.newJob.yesHere":"tickets.newJob.notYet")],[t("common.notes"),description]].filter(([,value])=>Boolean(value)).map(([label,value])=><View key={label} style={{paddingVertical:12,borderBottomWidth:1,borderBottomColor:colors.border}}><Text style={{color:colors.mutedForeground,fontSize:12}}>{label}</Text><Text style={{color:colors.foreground,fontFamily:"Inter_600SemiBold",marginTop:4}}>{value}</Text></View>)}
      <LayeredPillButton
        onPress={onCreate}
        disabled={submitDisabled}
        loading={creating}
        inactive={submitDisabled}
        height={48}
        style={styles.startBtn}
        testID="button-create-tickets"
      >
        <Feather name="play" size={16} color="#ffffff" style={styles.pillIconShadow} />
        <Text style={[styles.pillText, styles.pillTextShadow, { color: "#ffffff" }]}>
          {selectedWorkTypeIds.length > 1
            ? t("tickets.newJob.wizard.createMany", { count: selectedWorkTypeIds.length })
            : t("tickets.newJob.wizard.create")}
        </Text>
      </LayeredPillButton>

        </View>
        {step>0?<View style={{flexDirection:"row",gap:12}}>
          <LayeredPillButton inactive disabled={creating} onPress={()=>setStep(step===2?1:0)} testID="new-job-previous" style={{flex:1}}><Text style={{color:colors.foreground}}>{t("tickets.newJob.wizard.previous")}</Text></LayeredPillButton>
          {step===1?<LayeredPillButton disabled={submitDisabled} inactive={submitDisabled} onPress={()=>setStep(2)} testID="new-job-review" style={{flex:1}}><Text style={{color:"#ffffff",fontFamily:"Inter_700Bold"}}>{t("tickets.newJob.wizard.review")}</Text></LayeredPillButton>:null}
        </View>:null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wizardCard: { borderWidth: 2, borderRadius: 12, padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 100,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlignVertical: "top",
  },
  button: {
    marginTop: 24,
    height: 50,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  pillRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  pillHalf: { flex: 1 },
  pillText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  pillTextShadow: {
    textShadowColor: "rgba(0, 0, 0, 0.63)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  pillIconShadow: {
    textShadowColor: "rgba(0, 0, 0, 0.63)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  startBtn: { marginTop: 24, alignSelf: "stretch" },
});
