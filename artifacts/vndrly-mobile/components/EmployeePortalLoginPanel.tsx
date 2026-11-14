import React, { useEffect, useRef, useState } from "react";
import { Text, View, Switch } from "react-native";
import { useGateQuery } from "@/hooks/use-gate-query";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import {
  GateCard,
  GateField,
  GateError,
  GateLoading,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
import TogglePillButton from "./TogglePillButton";
type Props = {
  employeeId: number;
  defaultEmail?: string;
  vendorRole?: string | null;
  onSaved?: () => void;
};
type LoginStatus = {
  hasLogin?: boolean;
  portalLoginEnabled?: boolean;
  email?: string;
  mustChangePassword?: boolean;
};
export default function EmployeePortalLoginPanel({
  employeeId,
  defaultEmail = "",
  onSaved,
}: Props) {
  const c = useGateCopy(),
    scope = useRef(captureAuthScope()),
    lock = useRef(false),
    path = "/api/field-employees/" + employeeId + "/login",
    query = useGateQuery<LoginStatus>(path),
    [email, setEmail] = useState(defaultEmail),
    [password, setPassword] = useState(""),
    [mustChange, setMustChange] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [disableReview, setDisableReview] = useState(false);
  useEffect(() => {
    if (query.data) {
      setEmail(query.data.email ?? defaultEmail);
      setMustChange(
        query.data.hasLogin ? !!query.data.mustChangePassword : true,
      );
    }
  }, [query.data]);
  async function save(disable = false) {
    if (lock.current || !query.isSuccess || !isAuthScopeCurrent(scope.current))
      return;
    if (
      !disable &&
      (!email.trim() ||
        (!query.data.hasLogin && password.length < 8) ||
        (password.length > 0 && password.length < 8))
    ) {
      setError(
        c(
          "Enter an email and a password of at least 8 characters. Existing passwords may be left unchanged.",
          "Ingresa un correo y una contraseña de al menos 8 caracteres. Puedes conservar la contraseña existente.",
        ),
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(
        path,
        disable
          ? { method: "DELETE" }
          : {
              method: "POST",
              body: JSON.stringify({
                email: email.trim(),
                portalLoginEnabled: true,
                mustChangePassword: mustChange,
                ...(password ? { password } : {}),
              }),
            },
        scope.current,
      );
      if (!isAuthScopeCurrent(scope.current)) return;
      setPassword("");
      setDisableReview(false);
      const result = await query.refetch();
      if (result.error) throw result.error;
      setNotice(
        disable
          ? c("Login disabled.", "Inicio de sesión deshabilitado.")
          : c(
              "Login saved and verified.",
              "Inicio de sesión guardado y verificado.",
            ),
      );
      onSaved?.();
    } catch (e) {
      if (isAuthScopeCurrent(scope.current))
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      if (isAuthScopeCurrent(scope.current)) setBusy(false);
    }
  }
  return (
    <GateCard title={c("App login", "Acceso a la aplicación")} icon="key">
      <GateError
        message={error || query.error?.message}
        retry={() => void query.refetch()}
      />
      {query.isLoading && <GateLoading />}
      {query.isSuccess && (
        <>
          <Text style={gateStyle.muted}>
            {query.data.hasLogin
              ? c(
                  "An app login exists for this employee.",
                  "Este empleado tiene acceso a la aplicación.",
                )
              : c(
                  "Create login after saving the employee and site authorization.",
                  "Crea el acceso después de guardar al empleado y la autorización de sitios.",
                )}
          </Text>
          <GateField
            label={c("Login email", "Correo de acceso")}
            value={email}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
          />
          <GateField
            label={
              query.data.hasLogin
                ? c("New password (optional)", "Nueva contraseña (opcional)")
                : c("Temporary password", "Contraseña temporal")
            }
            value={password}
            secureTextEntry
            autoCapitalize="none"
            onChangeText={setPassword}
          />
          <View style={gateStyle.row}>
            <Text style={[gateStyle.text, { flex: 1 }]}>
              {c(
                "Require password change at next login",
                "Exigir cambio de contraseña al iniciar sesión",
              )}
            </Text>
            <Switch value={mustChange} onValueChange={setMustChange} />
          </View>
          <TogglePillButton
            loading={busy}
            disabled={busy}
            onPress={() => void save()}
          >
            {c("Save login", "Guardar acceso")}
          </TogglePillButton>
          {query.data.hasLogin &&
            (disableReview ? (
              <>
                <Text style={gateStyle.text}>
                  {c(
                    "Disable this employee’s app login? Site permissions and history remain saved.",
                    "¿Deshabilitar el acceso del empleado? Los permisos e historial se conservan.",
                  )}
                </Text>
                <TogglePillButton
                  color="red"
                  disabled={busy}
                  onPress={() => void save(true)}
                >
                  {c("Confirm disable login", "Confirmar deshabilitación")}
                </TogglePillButton>
                <TogglePillButton
                  disabled={busy}
                  onPress={() => setDisableReview(false)}
                >
                  {c("Cancel", "Cancelar")}
                </TogglePillButton>
              </>
            ) : (
              <TogglePillButton
                disabled={busy}
                onPress={() => setDisableReview(true)}
              >
                {c("Disable login", "Deshabilitar acceso")}
              </TogglePillButton>
            ))}
        </>
      )}
      {notice && (
        <Text accessibilityRole="alert" style={gateStyle.text}>
          {notice}
        </Text>
      )}
    </GateCard>
  );
}
