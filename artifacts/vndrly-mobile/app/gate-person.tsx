import React, { useEffect, useState, useRef } from "react";
import { useGateCompany } from "@/hooks/use-gate-company";
import { Text, View, Switch } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
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
  GatePage,
  GateCard,
  GateField,
  GateError,
  GateLoading,
  GateRow,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
import TogglePillButton from "@/components/TogglePillButton";
import EmployeeCertificationsPanel from "@/components/EmployeeCertificationsPanel";
import EmployeePortalLoginPanel from "@/components/EmployeePortalLoginPanel";
export default function GatePersonPage() {
  const { user, activeMembershipId } = useAuth(),
    { id, vendorId } = useLocalSearchParams<{
      id: string;
      vendorId?: string;
    }>();
  return (
    <Editor
      key={[user?.id, activeMembershipId, id, vendorId].join(":")}
      id={id}
    />
  );
}
function Editor({ id }: { id?: string }) {
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
        pecCertification: !!form.pecCertification,
        pecExpirationDate: form.pecExpirationDate || null,
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
  return (
    <GatePage title={c("Gate employee", "Empleado de acceso")} back>
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
            icon="user"
          >
            <GateField
              label={c("First name", "Nombre")}
              value={form.firstName}
              onChangeText={(v) => setForm({ ...form, firstName: v })}
            />
            <GateField
              label={c("Last name", "Apellido")}
              value={form.lastName}
              onChangeText={(v) => setForm({ ...form, lastName: v })}
            />
            <GateField
              label={c("Email", "Correo")}
              value={form.email}
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={(v) => setForm({ ...form, email: v })}
            />
            <GateField
              label={c("Phone", "Teléfono")}
              value={form.phone ?? ""}
              keyboardType="phone-pad"
              onChangeText={(v) => setForm({ ...form, phone: v })}
            />
            <GateField
              label={c("Job title", "Puesto")}
              value={form.jobTitle ?? ""}
              onChangeText={(v) => setForm({ ...form, jobTitle: v })}
            />
          </GateCard>
          <GateCard
            title={c("Gate responsibilities", "Responsabilidades de acceso")}
            icon="shield"
          >
            {(["gatekeeper", "gate_supervisor"] as const).map((role) => (
              <View key={role} style={gateStyle.row}>
                <Text style={[gateStyle.text, { flex: 1 }]}>
                  {role === "gatekeeper"
                    ? c("Gatekeeper", "Guardia")
                    : c("Gate supervisor", "Supervisor de acceso")}
                </Text>
                <Switch
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
            {access.isAdmin && (
              <Text style={gateStyle.muted}>
                {c(
                  "Company administrators retain all authorized company sites.",
                  "Los administradores conservan todos los sitios autorizados de la empresa.",
                )}
              </Text>
            )}
          </GateCard>
          <GateCard
            title={c("Site authorization", "Autorización de sitios")}
            subtitle={c(
              "Assigning an employee to a site authorizes access. Schedule their shifts separately in Calendar.",
              "Asignar un empleado al sitio autoriza su acceso. Programa turnos por separado en Calendario.",
            )}
            icon="map-pin"
          >
            {permissions.data?.eligibleSites.map((site) => (
              <View key={site.id} style={gateStyle.row}>
                <View style={{ flex: 1 }}>
                  <Text style={gateStyle.text}>{site.name}</Text>
                  <Text style={gateStyle.muted}>{site.partnerName}</Text>
                </View>
                <Switch
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
            {!permissions.data?.eligibleSites.length && (
              <Text style={gateStyle.muted}>
                {c(
                  "Your company has no authorized Gate sites. A site owner must authorize the company first.",
                  "Tu empresa no tiene sitios autorizados. El propietario debe autorizar primero a la empresa.",
                )}
              </Text>
            )}
          </GateCard>
          <GateCard
            title={c("Existing credentials", "Credenciales existentes")}
            icon="award"
          >
            <View style={gateStyle.row}>
              <Text style={[gateStyle.text, { flex: 1 }]}>
                {c("PEC certification", "Certificación PEC")}
              </Text>
              <Switch
                value={!!form.pecCertification}
                onValueChange={(v) => setForm({ ...form, pecCertification: v })}
              />
            </View>
            <GateField
              label={c(
                "PEC expiration (YYYY-MM-DD)",
                "Vencimiento PEC (AAAA-MM-DD)",
              )}
              value={form.pecExpirationDate ?? ""}
              placeholder="YYYY-MM-DD"
              onChangeText={(v) => setForm({ ...form, pecExpirationDate: v })}
            />
          </GateCard>
          {message && (
            <Text accessibilityRole="alert" style={gateStyle.text}>
              {message}
            </Text>
          )}
          {uncertain ? (
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
          ) : (
            <TogglePillButton
              disabled={busy}
              loading={busy}
              onPress={() => void save()}
            >
              {c("Save employee and site access", "Guardar empleado y acceso")}
            </TogglePillButton>
          )}
          {savedId && <EmployeeCertificationsPanel employeeId={savedId} />}
          {savedId && (
            <EmployeePortalLoginPanel
              key={savedId}
              employeeId={savedId}
              defaultEmail={form.email}
              vendorRole={
                access.operationalRoles.includes("gate_supervisor")
                  ? "gate_supervisor"
                  : form.vendorRole
              }
            />
          )}
        </>
      )}
    </GatePage>
  );
}
