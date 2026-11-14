import React, { useState, useRef } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch, logout, refreshAuthMe } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent, setToken } from "@/lib/auth";
import { clearBiometricCredentials } from "@/lib/biometrics";
import { takeGateHandoffDestination } from "@/lib/gate-handoff-return";
import { GATE_HOME } from "@/lib/gate-release";
import {
  GatePage,
  GateCard,
  GateField,
  GateError,
  gateStyle,
  useGateCopy,
} from "@/components/gate/GateChrome";
import TogglePillButton from "@/components/TogglePillButton";
export default function GatePassword() {
  const c = useGateCopy(),
    { user } = useAuth(),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    lock = useRef(false);
  async function save() {
    if (lock.current) return;
    if (password.length < 8 || password !== confirmation) {
      setError(
        c(
          "Use at least 8 characters and matching passwords.",
          "Usa al menos 8 caracteres y contraseñas iguales.",
        ),
      );
      return;
    }
    const scope = captureAuthScope();
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ ok: boolean; token: string }>(
        "/api/auth/change-password",
        { method: "POST", body: JSON.stringify({ newPassword: password }) },
        scope,
      );
      if (!isAuthScopeCurrent(scope)) return;
      if (!result.ok || !result.token)
        throw Error(
          c(
            "Password change could not be verified.",
            "No se pudo verificar el cambio.",
          ),
        );
      await setToken(result.token);
      await clearBiometricCredentials();
      setPassword("");
      setConfirmation("");
      const refreshed = await refreshAuthMe();
      if (!refreshed || refreshed.mustChangePassword)
        throw Error(
          c(
            "Password saved. Sign out and sign in again with your new password.",
            "Contraseña guardada. Cierra sesión y vuelve a entrar con la nueva contraseña.",
          ),
        );
      router.replace((takeGateHandoffDestination() ?? GATE_HOME) as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <GatePage title={c("Set your password", "Crea tu contraseña")}>
      <GateCard title={user?.displayName ?? "VNDRLY Gate"} icon="lock">
        <Text style={gateStyle.text}>
          {c(
            "Your administrator provided a temporary password. Choose your own password to finish account setup.",
            "Tu administrador proporcionó una contraseña temporal. Elige tu propia contraseña para completar la cuenta.",
          )}
        </Text>
        <GateError message={error} />
        <GateField
          label={c("New password", "Nueva contraseña")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />
        <GateField
          label={c("Confirm password", "Confirmar contraseña")}
          value={confirmation}
          onChangeText={setConfirmation}
          secureTextEntry
          autoCapitalize="none"
        />
        <TogglePillButton
          loading={busy}
          disabled={busy}
          onPress={() => void save()}
        >
          {c("Save password and continue", "Guardar contraseña y continuar")}
        </TogglePillButton>
        <TogglePillButton
          disabled={busy}
          onPress={() => void logout().then(() => router.replace("/login"))}
        >
          {c("Sign out", "Cerrar sesión")}
        </TogglePillButton>
      </GateCard>
    </GatePage>
  );
}
