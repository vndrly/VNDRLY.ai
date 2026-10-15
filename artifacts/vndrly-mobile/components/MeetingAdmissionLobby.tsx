import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  TextInput,
  Platform,
  Share,
  useWindowDimensions,
} from "react-native";
import { LiveMeetingLobbySchema } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useLiveMeetings } from "@/lib/use-live-meetings";
import TogglePillButton from "./TogglePillButton";
import MeetingWaitingRoom from "./MeetingWaitingRoom";
import type { z } from "zod/v4";
export default function MeetingAdmissionLobby({
  occurrenceId,
  children,
}: {
  occurrenceId: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const wide = useWindowDimensions().width >= 900;
  const colors = useColors(),
    live = useLiveMeetings<z.infer<typeof LiveMeetingLobbySchema>>(
      `/api/work-hub/live-meetings/${occurrenceId}`,
    );
  const [panel, setPanel] = useState<"waiting" | "invite" | null>(null),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<number[]>([]),
    [notice, setNotice] = useState("");
  const seen = useRef(new Set<string>());
  const raw = live.data,
    parsed = raw ? LiveMeetingLobbySchema.safeParse(raw) : null,
    data = parsed?.success ? parsed.data : null;
  useEffect(() => {
    seen.current.clear();
    setPanel(null);
    setNotice("");
    setSearch("");
    setSelected([]);
  }, [occurrenceId, live.contextKey]);
  useEffect(() => {
    for (const r of data?.requests ?? []) {
      const key = `${r.userId}:${r.requestedAt}`;
      if (!seen.current.has(key)) {
        seen.current.add(key);
        setPanel("waiting");
      }
    }
  }, [data?.requests]);
  const run = (
    suffix: string,
    payload: unknown,
    version: number | null = data?.meeting.version ?? null,
    method = "POST",
  ) =>
    live
      .send(
        `/api/work-hub/live-meetings/${occurrenceId}/${suffix}`,
        payload,
        version,
        method,
      )
      .catch(() => undefined);
  if (live.unavailable || data?.meeting.admissionMode === null)
    return <>{children}</>;
  if (!data)
    return (
      <View style={{ padding: 18, gap: 12 }}>
        <Text style={{ color: colors.text }}>
          {live.error ||
            t("liveMeetings.loading", {
              defaultValue: "Loading meeting\u2026",
            })}
        </Text>
        <TogglePillButton color="brand" onPress={() => void live.reload()}>
          {t("liveMeetings.retry", { defaultValue: "Retry" })}
        </TogglePillButton>
      </View>
    );
  const m = data.meeting,
    entered = m.ownAdmissionState === "admitted";
  const card = {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    backgroundColor: colors.card,
  };
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <View style={card}>
        <Text style={{ color: colors.primary, fontWeight: "700" }}>
          {["live", "active"].includes(m.status)
            ? t("liveMeetings.live", { defaultValue: "LIVE" })
            : t("liveMeetings.ended", { defaultValue: "MEETING ENDED" })}{" "}
          · {m.connectedCount} connected
        </Text>
        <Text style={{ color: colors.text, fontSize: 21, fontWeight: "700" }}>
          {m.title}
        </Text>
        <Text style={{ color: colors.mutedForeground }}>
          {t("liveMeetings.hostedBy", { defaultValue: "Hosted by " })}
          {m.hostName} ·{" "}
          {m.admissionMode === "company_open"
            ? t("liveMeetings.companyOpen", {
                defaultValue: "Open to company members",
              })
            : t("liveMeetings.approval", { defaultValue: "Host approval" })}
        </Text>
        {!!m.agenda && <Text style={{ color: colors.text }}>{m.agenda}</Text>}
        {!entered && (
          <TogglePillButton
            color="brand"
            disabled={
              live.busy ||
              (!m.canEnter && !m.canRequest) ||
              (!!m.requestedAt && !m.canEnter)
            }
            onPress={() => void run("request-admission", {}, null)}
          >
            {m.canEnter
              ? t("liveMeetings.join", { defaultValue: "Join meeting" })
              : m.ownAdmissionState === "declined"
                ? t("liveMeetings.declined", {
                    defaultValue: "Request declined",
                  })
                : m.requestedAt
                  ? t("liveMeetings.waitingHost", {
                      defaultValue: "Waiting for host",
                    })
                  : t("liveMeetings.ask", { defaultValue: "Ask to join" })}
          </TogglePillButton>
        )}
        {m.canManage && ["live", "active"].includes(m.status) && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <TogglePillButton color="brand" onPress={() => setPanel("invite")}>
              {t("liveMeetings.invite", { defaultValue: "Invite people" })}
            </TogglePillButton>
            <TogglePillButton color="brand" onPress={() => setPanel("waiting")}>
              {t("liveMeetings.waiting", {
                defaultValue: "Waiting room \u00B7 ",
              })}
              {data.requests.length}
            </TogglePillButton>
            <TogglePillButton
              color="brand"
              disabled={live.busy}
              onPress={() =>
                void run(
                  "admission-mode",
                  {
                    admissionMode:
                      m.admissionMode === "company_open"
                        ? "host_approval"
                        : "company_open",
                  },
                  m.version,
                  "PATCH",
                )
              }
            >
              {m.admissionMode === "company_open"
                ? t("liveMeetings.switchApproval", {
                    defaultValue: "Use host approval",
                  })
                : t("liveMeetings.switchOpen", {
                    defaultValue: "Open to company",
                  })}
            </TogglePillButton>
          </View>
        )}
        <TogglePillButton
          color="brand"
          onPress={() => {
            const url = `https://vndrly.ai/work-hub/meeting/${occurrenceId}`;
            void (
              Platform.OS === "web"
                ? navigator.clipboard.writeText(url)
                : Share.share({ message: url })
            )
              .then(() =>
                setNotice(
                  Platform.OS === "web"
                    ? t("liveMeetings.copied", {
                        defaultValue: "Meeting link copied",
                      })
                    : "Meeting link ready to share",
                ),
              )
              .catch(() =>
                setNotice(
                  t("liveMeetings.copyFailed", {
                    defaultValue: "Could not copy the meeting link.",
                  }),
                ),
              );
          }}
        >
          {t("liveMeetings.copy", { defaultValue: "Copy meeting link" })}
        </TogglePillButton>
        {!!notice && <Text style={{ color: colors.text }}>{notice}</Text>}
        {!!live.error && (
          <Text style={{ color: colors.text }}>{live.error}</Text>
        )}
        {live.retrying && (
          <TogglePillButton
            color="brand"
            disabled={live.busy}
            onPress={() => void live.retryOriginal().catch(() => undefined)}
          >
            Retry original request
          </TogglePillButton>
        )}
      </View>
      {entered && children}
      <Modal
        visible={panel !== null && m.canManage}
        transparent
        animationType="fade"
        onRequestClose={() => setPanel(null)}
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
                maxWidth: panel === "waiting" && wide ? 380 : 560,
                width: "100%",
                maxHeight: "85%",
                alignSelf: panel === "waiting" && wide ? "flex-end" : "center",
              },
            ]}
          >
            <TogglePillButton color="brand" onPress={() => setPanel(null)}>
              {t("liveMeetings.close", { defaultValue: "Close" })}
            </TogglePillButton>
            <ScrollView>
              {panel === "waiting" ? (
                <MeetingWaitingRoom
                  requests={data.requests}
                  busy={live.busy || live.retrying}
                  onDecision={(uid, decision) =>
                    void run(`admission/${uid}`, { decision })
                  }
                />
              ) : (
                <View style={{ gap: 12 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 20,
                      fontWeight: "700",
                    }}
                  >
                    {t("liveMeetings.invite", {
                      defaultValue: "Invite people",
                    })}
                  </Text>
                  <TextInput
                    accessibilityLabel="Find meeting invitees"
                    placeholder="Search company members"
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
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    {data.members
                      .filter((p) =>
                        p.name.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((p) => (
                        <TogglePillButton
                          key={p.userId}
                          color="brand"
                          solid={selected.includes(p.userId)}
                          onPress={() =>
                            setSelected((ids) =>
                              ids.includes(p.userId)
                                ? ids.filter((id) => id !== p.userId)
                                : [...ids, p.userId],
                            )
                          }
                        >
                          {p.name}
                        </TogglePillButton>
                      ))}
                  </View>
                  <TogglePillButton
                    color="brand"
                    disabled={live.busy || !selected.length}
                    onPress={() =>
                      void run("invitations", {
                        participantUserIds: selected,
                      }).then((result) => {
                        if (result) {
                          setSelected([]);
                          setPanel(null);
                        }
                      })
                    }
                  >
                    {t("liveMeetings.sendInvites", {
                      defaultValue: "Send live invitations",
                    })}
                  </TogglePillButton>
                </View>
              )}
            </ScrollView>
            {!!live.error && (
              <Text style={{ color: colors.text }}>{live.error}</Text>
            )}
            {live.retrying && (
              <TogglePillButton
                color="brand"
                disabled={live.busy}
                onPress={() => void live.retryOriginal().catch(() => undefined)}
              >
                Retry original request
              </TogglePillButton>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
