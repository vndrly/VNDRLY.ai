import { useTranslation } from "react-i18next";
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, ScrollView } from "react-native";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import TogglePillButton from "./TogglePillButton";
export default function MeetingStartNow({
  busy,
  onStart,
  original,
}: {
  busy: boolean;
  original?:{title:string;agenda?:string;admissionMode:"company_open"|"host_approval";participantUserIds:number[]}|null;
  onStart: (p: {
    title: string;
    agenda: string;
    admissionMode: "company_open" | "host_approval";
    participantUserIds: number[];
  }) => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const [title, setTitle] = useState(""),
    [agenda, setAgenda] = useState(""),
    [mode, setMode] = useState<"company_open" | "host_approval">(
      "host_approval",
    ),
    [search, setSearch] = useState(""),
    [people, setPeople] = useState<
      {
        id: number;
        displayName: string;
        sameCompany: boolean;
      }[]
    >([]),
    [selected, setSelected] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    const scope = captureAuthScope();
    void apiFetch<typeof people>("/api/work-hub/people", undefined, scope)
      .then((p) => {
        if (active && isAuthScopeCurrent(scope))
          setPeople(p.filter((p) => p.sameCompany));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const input = {
    // Restored from the frozen request when a response is uncertain.
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
  };
  useEffect(()=>{if(original){setTitle(original.title);setAgenda(original.agenda??"");setMode(original.admissionMode);setSelected(original.participantUserIds);}},[original?.title,original?.agenda,original?.admissionMode]);
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>
        {t("liveMeetings.startNow", { defaultValue: "Start meeting now" })}
      </Text>
      <TextInput
        accessibilityLabel={t("liveMeetings.title", {
          defaultValue: "Meeting title",
        })}
        placeholder={t("liveMeetings.titleHint", {
          defaultValue: "What are we meeting about?",
        })}
        value={title}
        onChangeText={setTitle}
        editable={!busy}
        style={input}
      />
      <TextInput
        accessibilityLabel={t("liveMeetings.description", {
          defaultValue: "Meeting description",
        })}
        placeholder={t("liveMeetings.descriptionHint", {
          defaultValue: "Description or agenda (optional)",
        })}
        multiline
        value={agenda}
        onChangeText={setAgenda}
        editable={!busy}
        style={input}
      />
      <Text style={{ color: colors.text }}>
        {t("liveMeetings.who", { defaultValue: "Who can join?" })}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <TogglePillButton
          color="brand"
          solid={mode === "host_approval"}
          disabled={busy}
          onPress={() => setMode("host_approval")}
        >
          {t("liveMeetings.approval", { defaultValue: "Host approval" })}
        </TogglePillButton>
        <TogglePillButton
          color="brand"
          solid={mode === "company_open"}
          disabled={busy}
          onPress={() => setMode("company_open")}
        >
          {t("liveMeetings.members", { defaultValue: "Company members" })}
        </TogglePillButton>
      </View>
      <Text style={{ color: colors.mutedForeground }}>
        {mode === "host_approval"
          ? t("liveMeetings.approvalHint", {
              defaultValue:
                "Members ask to join; the host or company admin admits them.",
            })
          : t("liveMeetings.openHint", {
              defaultValue: "Current company members can join immediately.",
            })}
      </Text>
      <TextInput
        accessibilityLabel={t("liveMeetings.findInvitees", {
          defaultValue: "Find people to invite",
        })}
        placeholder={t("liveMeetings.inviteHint", {
          defaultValue: "Invite people (optional)",
        })}
        value={search}
        onChangeText={setSearch}
        style={input}
      />
      <ScrollView style={{ maxHeight: 180 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {people
            .filter((p) =>
              p.displayName.toLowerCase().includes(search.toLowerCase()),
            )
            .map((p) => (
              <TogglePillButton
                key={p.id}
                color="brand"
                solid={selected.includes(p.id)}
                disabled={busy}
                onPress={() =>
                  setSelected((ids) =>
                    ids.includes(p.id)
                      ? ids.filter((id) => id !== p.id)
                      : [...ids, p.id],
                  )
                }
              >
                {p.displayName}
              </TogglePillButton>
            ))}
        </View>
      </ScrollView>
      <TogglePillButton
        color="brand"
        disabled={busy || !title.trim()}
        onPress={() =>
          onStart({
            title: title.trim(),
            agenda,
            admissionMode: mode,
            participantUserIds: selected,
          })
        }
      >
        {busy
          ? t("liveMeetings.starting", { defaultValue: "Starting\u2026" })
          : t("liveMeetings.start", { defaultValue: "Start meeting" })}
      </TogglePillButton>
    </View>
  );
}
