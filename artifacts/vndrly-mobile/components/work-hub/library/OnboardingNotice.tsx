import {LibraryEntryNoticeSchema} from "@workspace/api-zod";
import React, { useEffect, useState } from "react";
import { AppState, Modal, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { z } from "zod/v4";
import * as Crypto from "expo-crypto";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { mobileOwner, mobileCommandEnvelope } from "@/lib/work-hub-mobile";
import TogglePillButton from "../../TogglePillButton";
const schema = LibraryEntryNoticeSchema;
type Row = z.infer<typeof schema>["present"][number];
export default function OnboardingNotice({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation(),
    { user } = useAuth(),
    colors = useColors(),
    path = usePathname(),
    owner = mobileOwner(user),
    identity = [
      user?.id,
      user?.activeMembershipId,
      owner?.type,
      owner?.id,
    ].join(":");
  const [items, setItems] = useState<Row[]>([]),
    [dataIdentity, setDataIdentity] = useState(""),
    [dismissed, setDismissed] = useState<string[]>([]);
  const essential =
    /^\/(?:safety-event|scan|ticket|work-hub\/(?:calls|chat|meeting|training|checklist))(?:\/|$)/.test(
      path,
    );
  const currentItems = dataIdentity === identity ? items : [];
  const visible = enabled && !essential && currentItems.length > 0;
  useEffect(() => {
    setItems([]);
    setDataIdentity(identity);
    setDismissed([]);
    if (!enabled || !owner) return;
    const scope = captureAuthScope();
    let active = true,
      running = false;
    const load = async () => {
      if (running || !active || !isAuthScopeCurrent(scope)) return;
      running = true;
      try {
        const data = schema.parse(
          await apiFetch(
            "/api/work-hub/library/entry",
            { method: "POST", body: "{}" },
            scope,
          ),
        );
        if (active && isAuthScopeCurrent(scope)) setItems(data.present);
      } catch {
        /* Missing rollout APIs must not block login or essential communications. */
      } finally {
        running = false;
      }
    };
    void load();
    const state = AppState.addEventListener("change", (s) => {
      if (s === "active") void load();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void load();
    }, 60000);
    return () => {
      active = false;
      state.remove();
      clearInterval(timer);
    };
  }, [enabled, identity]);
  const shown = currentItems
    .filter((i) => !dismissed.includes(i.instanceId))
    .slice(0, 3);
  useEffect(() => {
    if (!visible || !owner || !shown.length) return;
    const scope = captureAuthScope();
    for (const item of shown) {
      void apiFetch(
        `/api/work-hub/library/instances/${item.instanceId}/presented`,
        {
          method: "POST",
          body: JSON.stringify(
            mobileCommandEnvelope(
              owner,
              {},
              item.assignment.version,
              { kind: "organization", id: owner.id },
              Crypto.randomUUID(),
            ),
          ),
        },
        scope,
      ).catch(() => undefined);
    }
  }, [visible, items, identity]);
  return (
    <Modal
      visible={visible && shown.length > 0}
      transparent
      animationType="fade"
      onRequestClose={() => setDismissed(items.map((i) => i.instanceId))}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.65)",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 2,
            borderColor: colors.primary,
            borderRadius: 14,
            padding: 16,
            gap: 12,
            maxWidth: 600,
            width: "100%",
            alignSelf: "center",
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 20 }}>
            {t("workHubLibrary.newAssignments")}
          </Text>
          {shown.map((item) => (
            <TogglePillButton
              key={item.instanceId}
              color="brand"
              onPress={() => {
                setDismissed(items.map((i) => i.instanceId));
                router.push(
                  `/work-hub/${item.kind === "training" ? "training" : "checklist"}/${item.instanceId}` as never,
                );
              }}
            >
              {item.title}
            </TogglePillButton>
          ))}
          <TogglePillButton
            color="brand"
            onPress={() => setDismissed(items.map((i) => i.instanceId))}
          >
            {t("workHubLibrary.close")}
          </TogglePillButton>
        </View>
      </View>
    </Modal>
  );
}
