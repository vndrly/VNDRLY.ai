import { Ionicons } from "@expo/vector-icons";
import type { LiveMeetingSummary } from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
import React, { useState } from "react";
import {
  Modal,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/use-auth";
import TogglePillButton from "./TogglePillButton";
import MeetingScheduling from "./MeetingScheduling";
import WorkHubLiveMeetings from "./WorkHubLiveMeetings";

type Meeting = {
  id: string;
  title?: string;
  agenda?: string;
  attendanceConfirmationRequired?: boolean;
  startsAt?: string;
  endsAt?: string;
  status?: string;
  invited?: boolean;
  admissionMode?: string | null;
  canEnter?: boolean;
  canRequest?: boolean;
  requestedAt?: string | null;
  ownAdmissionState?: string | null;
};
export default function WorkHubMeetings({
  meetings,
  onOpen,
  onSaved,
}: {
  meetings: Meeting[];
  onOpen: (id: string) => void;
  onSaved: () => Promise<unknown>;
}) {
  const colors = useColors();
  const { t } = useTranslation();
  const { user } = useAuth();
  const canSchedule =
    user?.role === "admin" ||
    user?.availableMemberships?.some(
      (m) => m.id === user.activeMembershipId && m.role === "admin",
    );
  const wide = useWindowDimensions().width >= 900;
  const [history, setHistory] = useState(false),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [scheduling, setScheduling] = useState(false);
  const [discovered, setDiscovered] = useState<LiveMeetingSummary[]>([]);
  const [discoveryError, setDiscoveryError] = useState("");
  const combined = new Map(meetings.map((m) => [m.id, m]));
  for (const m of discovered)
    combined.set(m.occurrenceId, {
      ...combined.get(m.occurrenceId),
      id: m.occurrenceId,
      title: m.title,
      agenda: m.agenda ?? undefined,
      startsAt: m.startsAt ?? m.startedAt ?? undefined,
      endsAt: m.plannedEndsAt ?? undefined,
      status: m.status,
      invited: m.invited,
      admissionMode: m.admissionMode,
      canEnter: m.canEnter,
      canRequest: m.canRequest,
      requestedAt: m.requestedAt,
      ownAdmissionState: m.ownAdmissionState,
    });
  const now = Date.now();
  const past = (m: Meeting) =>
    !["live", "active"].includes(m.status ?? "") &&
    (["ended", "completed", "cancelled"].includes(m.status ?? "") ||
      (!!m.endsAt && Date.parse(m.endsAt) <= now));
  const ordered = [...combined.values()].sort(
    (a, b) =>
      Number(["live", "active"].includes(b.status ?? "")) -
        Number(["live", "active"].includes(a.status ?? "")) ||
      (Date.parse(a.startsAt ?? "") || 0) - (Date.parse(b.startsAt ?? "") || 0),
  );
  const visible = ordered.filter(
    (m) =>
      past(m) === history &&
      `${m.title ?? ""} ${m.agenda ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  if (history) visible.reverse();
  const detail = visible.find((m) => m.id === selected);
  const card = {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    backgroundColor: colors.card,
  };
  const date = (m: Meeting) =>
    m.startsAt && Number.isFinite(Date.parse(m.startsAt))
      ? new Date(m.startsAt).toLocaleString()
      : "Time not available";
  return (
    <View style={{ gap: 14 }}>
      <WorkHubLiveMeetings
        onOpen={onOpen}
        onMeetingsChange={setDiscovered}
        onErrorChange={setDiscoveryError}
        headerRightAction={
          canSchedule ? (
            <TogglePillButton color="brand" onPress={() => setScheduling(true)}>
              Schedule meeting
            </TogglePillButton>
          ) : null
        }
      />
      <View style={card}>
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>
          Meetings
        </Text>
        {!!discoveryError && (
          <Text style={{ color: colors.mutedForeground }}>
            {discoveryError}
          </Text>
        )}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TogglePillButton
            color="brand"
            solid={!history}
            onPress={() => setHistory(false)}
          >
            Upcoming
          </TogglePillButton>
          <TogglePillButton
            color="brand"
            solid={history}
            onPress={() => setHistory(true)}
          >
            History
          </TogglePillButton>
        </View>
        <TextInput
          accessibilityLabel="Search meetings"
          placeholder="Search meetings"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          style={{
            borderWidth: 2,
            borderColor: colors.primary,
            borderRadius: 12,
            padding: 12,
            color: colors.text,
          }}
        />
        <View style={{ flexDirection: wide ? "row" : "column", gap: 14 }}>
          <View style={{ flex: 1, gap: 8 }}>
            {visible.map((m) => (
              <View key={m.id} style={card}>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  {m.invited && (
                    <Ionicons
                      name="mail-outline"
                      size={16}
                      color={colors.primary}
                      accessibilityLabel="Invited"
                    />
                  )}
                  {m.admissionMode === "host_approval" && (
                    <Ionicons
                      name="lock-closed-outline"
                      size={16}
                      color={colors.mutedForeground}
                      accessibilityLabel="Private — host approval"
                    />
                  )}
                  {["live", "active"].includes(m.status ?? "") && (
                    <Ionicons
                      name="ellipse"
                      size={8}
                      color={colors.primary}
                      accessibilityLabel="Live"
                    />
                  )}
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    {m.title ?? "Meeting"}
                  </Text>
                </View>
                <Text style={{ color: colors.mutedForeground }}>
                  {date(m)} · {m.status ?? "Scheduled"}
                </Text>
                <TogglePillButton
                  color="brand"
                  accessibilityLabel={
                    ["live", "active"].includes(m.status ?? "")
                      ? undefined
                      : t("meetingWorkspace.openMeetingLabel", {
                          name: m.title ?? "Meeting",
                        })
                  }
                  onPress={() => onOpen(m.id)}
                >
                  {["live", "active"].includes(m.status ?? "")
                    ? m.ownAdmissionState === "declined"
                      ? "Request declined"
                      : m.canEnter
                        ? "Join"
                        : m.requestedAt
                          ? "Waiting for host"
                          : "Ask to Join"
                    : t("meetingWorkspace.openMeeting")}
                </TogglePillButton>
                <TogglePillButton
                  color="brand"
                  onPress={() => setSelected(m.id)}
                >
                  View details
                </TogglePillButton>
              </View>
            ))}
            {!visible.length && (
              <Text style={{ color: colors.mutedForeground }}>
                {search
                  ? "No matching meetings."
                  : history
                    ? "No past meetings."
                    : "No upcoming meetings."}
              </Text>
            )}
          </View>
          {detail && (
            <View
              style={[
                card,
                wide ? { width: 320, alignSelf: "flex-start" } : {},
              ]}
            >
              <Text
                style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}
              >
                {detail.title ?? "Meeting"}
              </Text>
              <Text style={{ color: colors.text }}>{date(detail)}</Text>
              {!!detail.agenda && (
                <Text style={{ color: colors.text }}>{detail.agenda}</Text>
              )}
              {detail.attendanceConfirmationRequired && (
                <Text style={{ color: colors.text }}>
                  Attendance confirmation required
                </Text>
              )}
              <TogglePillButton
                color="brand"
                accessibilityLabel={t("meetingWorkspace.openMeetingLabel", {
                  name: detail.title ?? "Meeting",
                })}
                onPress={() => onOpen(detail.id)}
              >
                {t("meetingWorkspace.openMeeting")}
              </TogglePillButton>
            </View>
          )}
        </View>
      </View>
      <Modal
        visible={scheduling}
        transparent
        animationType="fade"
        onRequestClose={() => setScheduling(false)}
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
            style={[
              card,
              {
                width: "100%",
                maxWidth: 640,
                maxHeight: "90%",
                alignSelf: "center",
              },
            ]}
          >
            <TogglePillButton
              color="brand"
              onPress={() => setScheduling(false)}
            >
              Close scheduler
            </TogglePillButton>
            <ScrollView>
              <MeetingScheduling onSaved={onSaved} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
