import GateEmployeeEditor from "@/components/gate/GateEmployeeEditor";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";
import { useColors } from "@/hooks/useColors";
import { BrandedOnboardingField } from "@/components/OnboardingControls";
import React, { useState } from "react";
import { useGateCompany } from "@/hooks/use-gate-company";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useGateQuery } from "@/hooks/use-gate-query";
import { apiFetch } from "@/lib/api";
import {
  GatePage,
  GateCard,
  GateRow,
  GateError,
  GateLoading,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
import {
  mergeGatePeople,
  type GatePerson,
  type GatePeopleAccess,
} from "@/lib/gate-staff";
import { useQuery } from "@tanstack/react-query";
import { captureAuthScope } from "@/lib/auth";
export default function GateStaff() {
  const { primary } = useColors();
  const c = useGateCopy(),
    { user, activeMembershipId } = useAuth(),
    [search, setSearch] = useState(""),
    vendorId = useGateCompany(),
    scope = captureAuthScope();
  const [expandedEmployeeKey, setExpandedEmployeeKey] = useState<string | null>(null);
  const access = useGateQuery<GatePeopleAccess>(
    "/api/vendors/" + vendorId + "/people-access",
    !!vendorId,
  );
  const people = useQuery({
    queryKey: [
      "gate-staff",
      user?.id,
      activeMembershipId,
      vendorId,
      scope.generation,
    ],
    enabled: !!access.data,
    queryFn: async () => {
      const [field, office] = await Promise.all([
        apiFetch<GatePerson[]>(
          "/api/field-employees?vendorId=" + vendorId + "&includeInactive=true",
          {},
          scope,
        ),
        apiFetch<GatePerson[]>(
          "/api/vendor-contacts?vendorId=" + vendorId,
          {},
          scope,
        ),
      ]);
      return mergeGatePeople(field, office, access.data!);
    },
    retry: false,
  });
  return (
    <GatePage
      title={c("Staff and site access", "Personal y acceso a sitios")}
      back
    >
      <GateCard title={c("Company staff", "Personal de empresa")} icon="users">
        {!vendorId && (
          <GateRow
            label={c(
              "Choose your company context",
              "Selecciona el contexto de empresa",
            )}
            onPress={() =>
              router.push(
                user?.role === "admin" ? "/gate-companies" : "/profile",
              )
            }
          />
        )}
        <GateError
          message={access.error?.message ?? people.error?.message}
          retry={() => {
            void access.refetch();
            void people.refetch();
          }}
        />
        {(access.isLoading || (people.isLoading && access.isSuccess)) && (
          <GateLoading />
        )}
        {access.isSuccess && (
          <>
            <ProfileMiniCardButton
              borderColor={primary}
              onPress={() =>
                router.push(
                  ("/gate-person?id=new&vendorId=" + vendorId) as never,
                )
              }
            >
              {c("Add gate employee", "Agregar empleado de acceso")}
            </ProfileMiniCardButton>
            <BrandedOnboardingField
              label={c("Find employee", "Buscar empleado")}
              value={search}
              onChangeText={setSearch}
            />
            {people.data
              ?.filter((p) =>
                (p.firstName + " " + p.lastName + " " + p.email)
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((p) => {
                const editorKey = [scope.generation, vendorId, p.id].join(":");
                const expanded = expandedEmployeeKey === editorKey;
                return (
                  <View key={editorKey}>
                    <GateRow
                      label={p.firstName + " " + p.lastName}
                      detail={[
                        p.jobTitle,
                        p.email,
                        p.isActive === false ? c("Inactive", "Inactivo") : null,
                      ].filter(Boolean).join(" · ")}
                      icon={expanded ? "chevron-down" : "chevron-right"}
                      expanded={expanded}
                      onPress={() => setExpandedEmployeeKey(current => current === editorKey ? null : editorKey)}
                    />
                    {expanded && (
                      <View style={{ gap: 10, paddingBottom: 10 }}>
                        <GateEmployeeEditor id={String(p.id)} />
                      </View>
                    )}
                  </View>
                );
              })}
            {people.isSuccess && !people.data?.length && (
              <Text style={gateStyle.muted}>
                {c(
                  "No employee profiles yet.",
                  "Todavía no hay perfiles de empleados.",
                )}
              </Text>
            )}
          </>
        )}
      </GateCard>
    </GatePage>
  );
}
