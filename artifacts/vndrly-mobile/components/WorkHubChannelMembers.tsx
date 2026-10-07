import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import TogglePillButton from "./TogglePillButton";
import {
  addWorkHubChannelMember,
  type ChannelMemberAttempt,
} from "@/lib/work-hub-channel-member";
const copy = {
  en: {
    open: "Participants",
    add: "Add participant",
    email: "Existing VNDRLY account email",
    review: "Review participant",
    save: "Add reviewed participant",
    retry: "Check the same participant",
    unknown:
      "Result unresolved. Keep the same email and check membership before retrying.",
    saved:
      "Participant membership is currently recorded. This does not prove notification delivery.",
    denied: "Participant management is unavailable for this channel.",
    hint: "Only permitted existing accounts may be added. New chat consent uses the existing new-conversation flow.",
  },
  es: {
    open: "Participantes",
    add: "Agregar participante",
    email: "Correo de una cuenta existente de VNDRLY",
    review: "Revisar participante",
    save: "Agregar participante revisado",
    retry: "Consultar el mismo participante",
    unknown:
      "Resultado sin resolver. Conserve el mismo correo y consulte la membresía antes de reintentar.",
    saved:
      "La membresía del participante está registrada actualmente. No verifica la entrega de una notificación.",
    denied: "La gestión de participantes no está disponible para este canal.",
    hint: "Solo se pueden agregar cuentas existentes permitidas. El consentimiento de un chat nuevo usa el flujo de nueva conversación.",
  },
};
export default function WorkHubChannelMembers({
  channelId,
}: {
  channelId: string;
}) {
  const { user } = useAuth();
  const scope = captureAuthScope();
  return user ? (
    <Panel
      key={JSON.stringify([
        scope.generation,
        user.id,
        user.activeMembershipId,
        user.vendorId,
        user.partnerId,
        channelId,
      ])}
      channelId={channelId}
      identity={JSON.stringify([
        user.id,
        user.activeMembershipId,
        user.vendorId,
        user.partnerId,
        channelId,
      ])}
    />
  ) : null;
}
function Panel({
  channelId,
  identity,
}: {
  channelId: string;
  identity: string;
}) {
  const { i18n } = useTranslation(),
    c = copy[i18n.language.startsWith("es") ? "es" : "en"],
    scope = useRef(captureAuthScope()).current,
    alive = useRef(true),
    working = useRef(false),
    key = "work-hub-channel-member:" + identity;
  const [open, setOpen] = useState(false),
    [canManage, setCanManage] = useState(false),
    [email, setEmail] = useState(""),
    [review, setReview] = useState<ChannelMemberAttempt | null>(null),
    [pending, setPending] = useState<ChannelMemberAttempt | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [blocked, setBlocked] = useState(false);
  const current = () => alive.current && isAuthScopeCurrent(scope),
    assertCurrent = () => {
      if (!current()) throw Error("account_changed");
    };
  const request = async (path: string, init?: RequestInit) => {
    assertCurrent();
    const out = await apiFetch(path, init, scope);
    assertCurrent();
    return out;
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function show() {
    setOpen(true);
    try {
      const raw = await AsyncStorage.getItem(key);
      assertCurrent();
      if (raw) {
        const attempt = JSON.parse(raw);
        if (
          attempt.channelId !== channelId ||
          typeof attempt.email !== "string"
        )
          throw Error("journal");
        setPending(attempt);
        setEmail(attempt.email);
      }
      const access = (await request(
        "/api/work-hub/channels/" + channelId + "/member-access",
      )) as { canManage: boolean };
      setCanManage(access.canManage === true);
      if (!access.canManage) setMessage(c.denied);
    } catch {
      if (current()) {
        setBlocked(true);
        setMessage(c.unknown);
      }
    }
  }
  async function save() {
    const attempt = pending ?? review;
    if (!attempt || working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await AsyncStorage.setItem(key, JSON.stringify(attempt));
      assertCurrent();
      setPending(attempt);
      setReview(null);
      await addWorkHubChannelMember(attempt, { request, assertCurrent });
      assertCurrent();
      setMessage(c.saved);
      try {
        await AsyncStorage.removeItem(key);
        assertCurrent();
        setPending(null);
        setEmail("");
      } catch {
        if (current()) setMessage(c.saved);
      }
    } catch {
      if (current()) setMessage(c.unknown);
    } finally {
      working.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <View>
      <TogglePillButton onPress={() => void show()} disabled={busy}>
        {c.open}
      </TogglePillButton>
      {open && (
        <>
          <Text>{c.hint}</Text>
          {canManage && (
            <>
              <TextInput
                accessibilityLabel={c.email}
                value={email}
                onChangeText={setEmail}
                editable={!pending && !review && !busy && !blocked}
              />
              {!pending && !review && (
                <TogglePillButton
                  disabled={
                    busy || blocked || !/^\S+@\S+\.\S+$/.test(email.trim())
                  }
                  onPress={() =>
                    setReview({ channelId, email: email.trim().toLowerCase() })
                  }
                >
                  {c.review}
                </TogglePillButton>
              )}
              {review && <Text>{review.email}</Text>}
              {(pending || review) && (
                <TogglePillButton
                  disabled={busy || blocked}
                  onPress={() => void save()}
                >
                  {pending ? c.retry : c.save}
                </TogglePillButton>
              )}
            </>
          )}
          {!!message && <Text accessibilityRole="alert">{message}</Text>}
        </>
      )}
    </View>
  );
}
