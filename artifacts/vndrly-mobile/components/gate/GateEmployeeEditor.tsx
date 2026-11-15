import { companyRoleOptions, currentRoleLabel, type CompanyStaffRoleCatalog } from "../../../vndrly/src/lib/staff-role-catalog";
import { staffAuthorizationSites } from "../../../vndrly/src/lib/warwick-gate-label";
import React, { useEffect, useState, useRef } from "react";
import { useGateCompany } from "@/hooks/use-gate-company";
import { Text, View, Switch } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useGateQuery } from "@/hooks/use-gate-query";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import {
  toggleGateRole,
  type GatePerson,
  type GateAccess,
  type GatePeopleAccess,
} from "@/lib/gate-staff";
import {
  GateCard,
  GateError,
  GateLoading,
  GateRow,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
import ProfileMiniCardButton from "@/components/ProfileMiniCardButton";
import { BrandedOnboardingField } from "@/components/OnboardingControls";
import { useColors } from "@/hooks/useColors";

import EmployeeCertificationsPanel from "@/components/EmployeeCertificationsPanel";
import EmployeePortalLoginPanel from "@/components/EmployeePortalLoginPanel";
export default function GateEmployeeEditor({ id }: { id?: string }) {
  const [profileExpanded, setProfileExpanded] = useState(id === "new");
  const [dutiesExpanded, setDutiesExpanded] = useState(false);
  const [permissionsExpanded, setPermissionsExpanded] = useState(false);
  const savedAccess = useRef<GateAccess | null>(null);
  const [sitesExpanded, setSitesExpanded] = useState(false);
  const { primary } = useColors();
  const c = useGateCopy(),
    { user } = useAuth(),
    vendorId = useGateCompany(),
    cache = useQueryClient(),
    scope = useRef(captureAuthScope()),
    lock = useRef(false);
  const [savedId, setSavedId] = useState(
      id && id !== "new" ? Number(id) : null,
    ),
    [form, setForm] = useState<GatePerson | null>(
      id === "new"
        ? {
            id: 0,
            vendorId: vendorId ?? 0,
            firstName: "",
            lastName: "",
            email: "",
            vendorRole: "gatekeeper",
            jobTitle: "Gatekeeper",
          }
        : null,
    ),
    [access, setAccess] = useState<GateAccess | null>(
      id === "new"
        ? {
            vendorPeopleId: 0,
            isAdmin: false,
            operationalRoles: ["gatekeeper"],
            siteAccessMode: "selected",
            siteLocationIds: [],
          }
        : null,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const permissions = useGateQuery<GatePeopleAccess>(
    "/api/vendors/" + vendorId + "/people-access",
    !!vendorId,
  );
  const dutyCatalog = useGateQuery<CompanyStaffRoleCatalog>(
    "/api/vendors/" + vendorId + "/staff-roles",
    !!vendorId && dutiesExpanded,
  );
  const duties = dutyCatalog.data
    ? companyRoleOptions(["gate"], dutyCatalog.data).filter(({ label }) =>
        label !== "Team Member" && label !== "Office Staff")
    : [];
  const people = useGateQuery<GatePerson[]>(
    "/api/vendor-contacts?vendorId=" + vendorId,
    !!permissions.data && id !== "new",
  );
  const field = useGateQuery<GatePerson[]>(
    "/api/field-employees?vendorId=" + vendorId + "&includeInactive=true",
    !!permissions.data && id !== "new",
  );
  useEffect(() => {
    if (form || !permissions.data || !people.data || !field.data) return;
    const found = [...people.data, ...field.data].find((p) => p.id === savedId);
    const foundAccess = permissions.data.people.find(
      (p) => p.vendorPeopleId === savedId,
    );
    if (found && foundAccess) {
      setForm(found);
      setAccess(foundAccess);
      savedAccess.current = foundAccess;
    } else
      setError(
        c(
          "This employee is no longer available in this company.",
          "Este empleado ya no está disponible en esta empresa.",
        ),
      );
  }, [permissions.data, people.data, field.data]);
  const save = async () => {
    if (
      lock.current ||
      !form ||
      !access ||
      !vendorId ||
      !isAuthScopeCurrent(scope.current) ||
      uncertain
    )
      return;
    if (
      !form.firstName.trim() ||
      !form.lastName.trim() ||
      !/^.+@.+\..+$/.test(form.email.trim())
    ) {
      setError(
        c(
          "Enter first name, last name and a valid email.",
          "Ingresa nombre, apellido y correo válido.",
        ),
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    let currentId = savedId,
      profileSaved = false;
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone?.trim() || null,
        jobTitle: form.jobTitle?.trim() ?? "",
        ...(form.roles ? { roles: form.roles } : {}),
        ...(!currentId ? { vendorRole: "gatekeeper" } : {}),
      };
      const result = await apiFetch<GatePerson>(
        "/api/vendors/" +
          vendorId +
          "/contacts" +
          (currentId ? "/" + currentId : ""),
        { method: currentId ? "PATCH" : "POST", body: JSON.stringify(payload) },
        scope.current,
      );
      if (!isAuthScopeCurrent(scope.current)) return;
      if (!result.id) throw new Error("No saved employee ID returned.");
      currentId = result.id;
      profileSaved = true;
      setSavedId(currentId);
      if (!savedAccess.current ||
        JSON.stringify(access.operationalRoles) !== JSON.stringify(savedAccess.current.operationalRoles) ||
        JSON.stringify(access.siteLocationIds) !== JSON.stringify(savedAccess.current.siteLocationIds)) {
        await apiFetch(
          "/api/vendors/" + vendorId + "/people/" + currentId + "/access",
          {
            method: "PUT",
            body: JSON.stringify({
              operationalRoles: access.operationalRoles,
              siteLocationIds: access.siteLocationIds,
            }),
          },
          scope.current,
        );
        if (!isAuthScopeCurrent(scope.current)) return;
        savedAccess.current = access;
      }
      await cache.invalidateQueries({ queryKey: ["gate-release"] });
      await cache.invalidateQueries({ queryKey: ["gate-staff"] });
      setMessage(
        c(
          "Profile and site access saved. Configure login below if needed.",
          "Perfil y acceso guardados. Configura el inicio de sesión abajo si es necesario.",
        ),
      );
    } catch (e) {
      if (!isAuthScopeCurrent(scope.current)) return;
      setError(
        (e instanceof Error ? e.message : String(e)) +
          (profileSaved
            ? c(
                " Profile saved; site access was not confirmed. Retry saves to this same employee.",
                " Perfil guardado; acceso sin confirmar. Reintentar usa el mismo empleado.",
              )
            : ""),
      );
      if (!currentId && !profileSaved) setUncertain(true);
    } finally {
      lock.current = false;
      if (isAuthScopeCurrent(scope.current)) setBusy(false);
    }
  };
  const sites = staffAuthorizationSites(vendorId ?? undefined, permissions.data?.eligibleSites ?? []);
  return (
    <>
      <GateError
        message={
          error ||
          permissions.error?.message ||
          people.error?.message ||
          field.error?.message
        }
        retry={() => {
          void permissions.refetch();
          void people.refetch();
          void field.refetch();
        }}
      />
      {!vendorId && (
        <GateRow
          label={c("Select company context", "Selecciona empresa")}
          onPress={() => router.push("/profile")}
        />
      )}
      {permissions.isLoading && <GateLoading />}
      {form && access && permissions.isSuccess && (
        <>
          <GateCard
            title={c("Employee profile", "Perfil del empleado")}
            expanded={profileExpanded}
            onHeaderPress={() => setProfileExpanded(open => !open)}
            icon="user"
          >
            {profileExpanded && (
              <>
                <BrandedOnboardingField
                  label={c("First name", "Nombre")}
                  value={form.firstName}
                  onChangeText={(v) => setForm({ ...form, firstName: v })}
                />
                <BrandedOnboardingField
                  label={c("Last name", "Apellido")}
                  value={form.lastName}
                  onChangeText={(v) => setForm({ ...form, lastName: v })}
                />
                <BrandedOnboardingField
                  label={c("Email", "Correo")}
                  value={form.email}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onChangeText={(v) => setForm({ ...form, email: v })}
                />
                <BrandedOnboardingField
                  label={c("Phone", "Teléfono")}
                  value={form.phone ?? ""}
                  keyboardType="phone-pad"
                  onChangeText={(v) => setForm({ ...form, phone: v })}
                />
                <BrandedOnboardingField
                  label={c("Job title", "Puesto")}
                  value={form.jobTitle ?? ""}
                  onChangeText={(v) => setForm({ ...form, jobTitle: v })}
                />
              </>
            )}
          </GateCard>
          <GateCard
            title={c("Responsibilities", "Responsabilidades")}
            icon="briefcase"
            expanded={dutiesExpanded}
            onHeaderPress={() => setDutiesExpanded(open => !open)}
          >
            {dutiesExpanded && (
              <>
                <GateError message={dutyCatalog.error?.message} retry={() => void dutyCatalog.refetch()} />
                {dutyCatalog.isLoading && <GateLoading />}
                {duties.map(({ label }) => {
                  const matches = (role: string) => currentRoleLabel(role, dutyCatalog.data) === label;
                  return (
                    <View key={label} style={gateStyle.row}>
                      <Text style={[gateStyle.text, { flex: 1 }]}>{label}</Text>
                      <Switch
                        trackColor={{ false: "#6b7280", true: primary }}
                        accessibilityLabel={label}
                        disabled={busy}
                        value={form.roles?.some(matches) ?? false}
                        onValueChange={enabled => setForm(current => {
                          if (!current) return current;
                          const otherRoles = (current.roles ?? []).filter(role => !matches(role));
                          return { ...current, roles: enabled ? [...otherRoles, label] : otherRoles };
                        })}
                      />
                    </View>
                  );
                })}
              </>
            )}
          </GateCard>
          <GateCard
            title={c("Gate permissions", "Permisos de acceso")}
            expanded={permissionsExpanded}
            onHeaderPress={() => setPermissionsExpanded(open => !open)}
            icon="shield"
          >
            {permissionsExpanded && (["gatekeeper", "gate_supervisor"] as const).map((role) => (
              <View key={role} style={gateStyle.row}>
                <Text style={[gateStyle.text, { flex: 1 }]}>
                  {role === "gatekeeper"
                    ? c("Gatekeeper", "Guardia")
                    : c("Gate supervisor", "Supervisor de acceso")}
                </Text>
                <Switch
                  trackColor={{ false: "#6b7280", true: primary }}
                  accessibilityLabel={role}
                  disabled={busy || access.isAdmin}
                  value={access.operationalRoles.includes(role)}
                  onValueChange={(v) =>
                    setAccess({
                      ...access,
                      operationalRoles: toggleGateRole(
                        access.operationalRoles,
                        role,
                        v,
                      ),
                    })
                  }
                />
              </View>
            ))}
            {permissionsExpanded && access.isAdmin && (
              <Text style={gateStyle.muted}>
                {c(
                  "Company administrators retain all authorized company sites.",
                  "Los administradores conservan todos los sitios autorizados de la empresa.",
                )}
              </Text>
            )}
          </GateCard>
          <GateCard
            title={c("Site Authorizations", "Autorizaciones de sitios")}
            expanded={sitesExpanded}
            onHeaderPress={() => setSitesExpanded(open => !open)}
            subtitle={c(
              "Assigning an employee to a site authorizes access.",
              "Asignar un empleado al sitio autoriza su acceso.",
            )}
            headerAction={!uncertain && (
                <ProfileMiniCardButton
                  borderColor={primary}
                  inHeader
                  disabled={busy}
                  loading={busy}
                  onPress={() => void save()}
                >
                  {c("Save employee and site access", "Guardar empleado y acceso")}
                </ProfileMiniCardButton>
            )}
            icon="map-pin"
          >
            {sitesExpanded && sites.map((site) => (
              <View key={site.id} style={gateStyle.row}>
                <View style={{ flex: 1 }}>
                  <Text style={gateStyle.text}>{site.name}</Text>
                  <Text style={gateStyle.muted}>{site.partnerName}</Text>
                </View>
                <Switch
                  trackColor={{ false: "#6b7280", true: primary }}
                  accessibilityLabel={c("Authorize ", "Autorizar ") + site.name}
                  disabled={busy || access.isAdmin}
                  value={
                    access.isAdmin || access.siteLocationIds.includes(site.id)
                  }
                  onValueChange={(v) =>
                    setAccess({
                      ...access,
                      siteLocationIds: v
                        ? [...new Set([...access.siteLocationIds, site.id])]
                        : access.siteLocationIds.filter((x) => x !== site.id),
                    })
                  }
                />
              </View>
            ))}
            {sitesExpanded && !sites.length && (
              <Text style={gateStyle.muted}>
                {c(
                  "Your company has no authorized Gate sites. A site owner must authorize the company first.",
                  "Tu empresa no tiene sitios autorizados. El propietario debe autorizar primero a la empresa.",
                )}
              </Text>
            )}
          </GateCard>
          {message && (
            <Text accessibilityRole="alert" style={gateStyle.text}>
              {message}
            </Text>
          )}
          {uncertain && (
            <GateRow
              label={c(
                "Check staff list before creating again",
                "Revisa la lista antes de crear nuevamente",
              )}
              detail={c(
                "Creation was not confirmed. The employee may already exist.",
                "No se confirmó la creación. El empleado podría existir.",
              )}
              onPress={() => router.replace("/gate-staff")}
            />
          )}
          {savedId && <EmployeeCertificationsPanel employeeId={savedId} />}
          {savedId && (
            <EmployeePortalLoginPanel
              collapsible
              key={savedId}
              employeeId={savedId}
              defaultEmail={form.email}
              vendorId={vendorId ?? undefined}
              vendorRole={
                access.operationalRoles.includes("gate_supervisor")
                  ? "gate_supervisor"
                  : form.vendorRole
              }
            />
          )}
        </>
      )}
    </>
  );
}
