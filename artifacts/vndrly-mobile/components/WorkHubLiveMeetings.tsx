import { useTranslation } from "react-i18next";
import React, { useEffect, useState } from "react";
import { View, Text, Modal, ScrollView } from "react-native";
import type { LiveMeetingSummary } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import { useLiveMeetings } from "@/lib/use-live-meetings";
import TogglePillButton from "./TogglePillButton";
import MeetingStartNow from "./MeetingStartNow";
export default function WorkHubLiveMeetings({
  onOpen,
  headerContent,
  headerRightAction,
  onMeetingsChange,
  onErrorChange,
}: {
  onOpen: (id: string) => void;
  headerContent?: React.ReactNode;
  headerRightAction?: React.ReactNode;
  onMeetingsChange?: (meetings: LiveMeetingSummary[]) => void;
  onErrorChange?: (error: string) => void;
}) {
  const { t } = useTranslation();
  const colors = useColors(),
    { user } = useAuth(),
    live = useLiveMeetings<{
      meetings: LiveMeetingSummary[];
    }>("/api/work-hub/live-meetings"),
    [starting, setStarting] = useState(false);
  useEffect(() => setStarting(false), [live.contextKey]);
  useEffect(() => {
    onMeetingsChange?.(live.data?.meetings ?? []);
  }, [live.data, onMeetingsChange]);
  useEffect(() => {
    onErrorChange?.(
      live.error
        ? live.unavailable
          ? "Meeting updates are unavailable right now."
          : live.error
        : "",
    );
  }, [live.error, live.unavailable, onErrorChange]);
  const allowed =
    !!user?.vendorId &&
    (user.role === "admin" ||
      user.availableMemberships?.some(
        (m) => m.id === user.activeMembershipId && m.role === "admin",
      ));
  const card = {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    backgroundColor: colors.card,
  };
  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          ...(onMeetingsChange
            ? {
                borderWidth: 2,
                borderColor: colors.primary,
                borderRadius: 14,
                padding: 16,
                backgroundColor: colors.card,
              }
            : {}),
        }}
      >
        {!headerContent && !onMeetingsChange && (
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>
            {t("liveMeetings.liveNow", { defaultValue: "Live now" })}
          </Text>
        )}
        {allowed && (
          <TogglePillButton color="brand" onPress={() => setStarting(true)}>
            {t("liveMeetings.startNow", { defaultValue: "Start meeting now" })}
          </TogglePillButton>
        )}
        {headerRightAction}
      </View>
      {headerContent}
      {!onMeetingsChange && headerContent && (
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>
          {t("liveMeetings.liveNow", { defaultValue: "Live now" })}
        </Text>
      )}
      {!onMeetingsChange &&
        live.data?.meetings
          .filter((m) => ["live", "active"].includes(m.status))
          .map((m) => (
            <View style={card} key={m.occurrenceId}>
              <Text style={{ color: colors.primary, fontWeight: "700" }}>
                LIVE · {m.connectedCount} connected ·{" "}
                {m.startedAt
                  ? `${Math.max(0, Math.floor((Date.now() - Date.parse(m.startedAt)) / 60000))} min`
                  : "Starting"}
              </Text>
              <Text
                style={{ color: colors.text, fontSize: 19, fontWeight: "700" }}
              >
                {m.title}
              </Text>
              <Text style={{ color: colors.mutedForeground }}>
                {m.hostName} ·{" "}
                {m.admissionMode === "company_open"
                  ? t("liveMeetings.members", {
                      defaultValue: "Company members",
                    })
                  : t("liveMeetings.approval", {
                      defaultValue: "Host approval",
                    })}
              </Text>
              <TogglePillButton
                color="brand"
                onPress={() => onOpen(m.occurrenceId)}
              >
                {m.canManage
                  ? t("liveMeetings.openMeeting", {
                      defaultValue: "Open meeting",
                    })
                  : m.canEnter
                    ? t("liveMeetings.joinShort", { defaultValue: "Join" })
                    : m.ownAdmissionState === "declined"
                      ? t("liveMeetings.declined", {
                          defaultValue: "Request declined",
                        })
                      : m.requestedAt
                        ? t("liveMeetings.waitingHost", {
                            defaultValue: "Waiting for host",
                          })
                        : t("liveMeetings.ask", {
                            defaultValue: "Ask to join",
                          })}
              </TogglePillButton>
            </View>
          ))}
      {!onMeetingsChange && live.data && !live.data.meetings.length && (
        <Text style={{ color: colors.mutedForeground }}>
          {t("liveMeetings.noLive", {
            defaultValue: "No meetings in progress.",
          })}
        </Text>
      )}
      {!onErrorChange && !!live.error && (
        <Text style={{ color: colors.text }}>
          {live.unavailable
            ? t("liveMeetings.unavailable", {
                defaultValue: "Live meetings are unavailable right now.",
              })
            : live.error}
        </Text>
      )}
      <Modal
        visible={starting}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!live.busy) setStarting(false);
        }}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.65)",
            padding: 20,
          }}
        >
          <View
            style={[
              card,
              {
                maxWidth: 600,
                width: "100%",
                maxHeight: "90%",
                alignSelf: "center",
              },
            ]}
          >
            <TogglePillButton
              color="brand"
              disabled={live.busy}
              onPress={() => setStarting(false)}
            >
              {t("liveMeetings.close", { defaultValue: "Close" })}
            </TogglePillButton>
            <ScrollView>
              <MeetingStartNow
                key={live.contextKey}
                original={live.originalPayload}
                busy={live.busy || live.retrying}
                onStart={(p) => {
                  void live
                    .send("/api/work-hub/live-meetings", p, null)
                    .then((r) => {
                      setStarting(false);
                      onOpen(r.resource.meeting.occurrenceId);
                    })
                    .catch(() => undefined);
                }}
              />
            </ScrollView>
            {live.retrying && (
              <TogglePillButton
                color="brand"
                disabled={live.busy}
                onPress={() =>
                  void live
                    .retryOriginal()
                    .then((r) => {
                      setStarting(false);
                      onOpen(r.resource.meeting.occurrenceId);
                    })
                    .catch(() => undefined)
                }
              >
                {t("liveMeetings.retryStart", {
                  defaultValue: "Retry original start request",
                })}
              </TogglePillButton>
            )}
            {!!live.error && (
              <Text style={{ color: colors.text }}>{live.error}</Text>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
