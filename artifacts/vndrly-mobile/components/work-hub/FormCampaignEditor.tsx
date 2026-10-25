import { useTranslation } from "react-i18next";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { z } from "zod/v4";
import {
  FormCampaignConfigSchema,
  type FormCampaignConfig,
} from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useFormCampaigns } from "@/lib/use-form-campaigns";
import TogglePillButton from "../TogglePillButton";
const options = z.object({
  forms: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  files: z
    .array(z.object({ id: z.string(), fileName: z.string() }))
    .default([]),
  people: z.array(
    z.object({
      userId: z.number(),
      name: z.string().nullable(),
      role: z.string(),
    }),
  ),
});
export default function FormCampaignEditor({
  visible,
  onClose,
  onSaved,
  initial,
  campaignId,
  version,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  initial?: FormCampaignConfig;
  campaignId?: string;
  version?: number;
}) {
  const { t } = useTranslation();

  const colors = useColors(),
    api = useFormCampaigns("/api/work-hub/form-campaigns/options", (value) =>
      options.parse(value),
    );
  const [kind, setKind] =
      useState<FormCampaignConfig["kind"]>("acknowledgement"),
    [sourceTemplateId, setSourceTemplateId] = useState<string | null>(null),
    [title, setTitle] = useState(t("formCampaignLabels.e001")),
    [description, setDescription] = useState(""),
    [question, setQuestion] = useState(""),
    [policy, setPolicy] = useState(""),
    [policyVersion, setPolicyVersion] = useState("1"),
    [attachmentId, setAttachmentId] = useState<string | null>(null),
    [choiceText, setChoiceText] = useState("A\nB\nC\nD"),
    [multiple, setMultiple] = useState(false),
    [anonymous, setAnonymous] = useState(false),
    [edits, setEdits] = useState(false),
    [liveResults, setLiveResults] = useState(false),
    [all, setAll] = useState(true),
    [selected, setSelected] = useState<number[]>([]),
    [rolling, setRolling] = useState(false),
    [duration, setDuration] = useState("30"),
    [timezone, setTimezone] = useState("America/Chicago"),
    [reminders, setReminders] = useState(false),
    [reminderHours, setReminderHours] = useState("24"),
    [brief, setBrief] = useState(true),
    [briefTime, setBriefTime] = useState("08:00"),
    [briefPush, setBriefPush] = useState(false),
    [escalate, setEscalate] = useState<number | null>(null),
    [escalateHours, setEscalateHours] = useState("24"),
    [search, setSearch] = useState(""),
    [review, setReview] = useState<FormCampaignConfig | null>(null),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setReview(null);
    setNotice("");
    if (!initial) {
      setSourceTemplateId(null);
      setKind("acknowledgement");
      setTitle(t("formCampaignLabels.e001"));
      setDescription("");
      setQuestion("");
      setPolicy("");
      setPolicyVersion("1");
      setAttachmentId(null);
      setChoiceText("A\nB\nC\nD");
      setMultiple(false);
      setAnonymous(false);
      setEdits(false);
      setLiveResults(false);
      setAll(true);
      setSelected([]);
      setRolling(false);
      setDuration("30");
      setTimezone("America/Chicago");
      setReminders(false);
      setBrief(true);
      setEscalate(null);
      setSearch("");
      return;
    }
    setKind(initial.kind);
    setSourceTemplateId(initial.sourceTemplateId);
    setTitle(initial.title);
    setDescription(initial.description);
    setQuestion(initial.question);
    setPolicy(initial.policyText);
    setPolicyVersion(initial.policyVersion);
    setAttachmentId(initial.policyAttachmentId);
    setChoiceText(initial.choices.map((c) => c.label).join("\n"));
    setMultiple(initial.maxSelections > 1);
    setAnonymous(initial.anonymous);
    setEdits(initial.allowVoteChanges);
    setLiveResults(initial.resultsTiming === "live");
    setAll(initial.audience.mode === "all_active");
    setSelected(initial.audience.userIds);
    setRolling(initial.audience.rolling);
    setDuration(
      String(
        (initial.durationHours ?? (initial.kind === "poll" ? 24 : 720)) /
          (initial.kind === "poll" ? 1 : 24),
      ),
    );
    setTimezone(initial.timezone);
    setReminders(initial.reminderHours !== null);
    setReminderHours(String(initial.reminderHours ?? 24));
    setBrief(initial.briefing.enabled);
    setBriefTime(
      `${String(initial.briefing.hour).padStart(2, "0")}:${String(initial.briefing.minute).padStart(2, "0")}`,
    );
    setBriefPush(initial.briefing.push);
    setEscalate(initial.escalation?.userId ?? null);
    setEscalateHours(String(initial.escalation?.delayHours ?? 24));
  }, [campaignId, visible, api.contextKey]);
  const field = {
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 10,
      padding: 12,
      color: colors.text,
    },
    label = { color: colors.text };
  const toggle = (name: string, value: boolean, set: (v: boolean) => void) => (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Text style={[label, { flex: 1 }]}>{name}</Text>
      <Switch
        accessibilityLabel={name}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.text}
        {...(Platform.OS === "web" ? { activeThumbColor: colors.text } : {})}
        ios_backgroundColor={colors.border}
        style={{ width: 48, height: 28 }}
        value={value}
        onValueChange={set}
        disabled={api.busy || api.uncertain}
      />
    </View>
  );
  const inspect = () => {
    try {
      const [hour, minute] = briefTime.split(":").map(Number);
      if (!/^\d{2}:\d{2}$/.test(briefTime))
        throw Error(t("formCampaignLabels.e024"));
      const choices =
        kind === "poll"
          ? choiceText
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean)
              .map((label, i) => ({ id: String.fromCharCode(97 + i), label }))
          : [];
      const config = FormCampaignConfigSchema.parse({
        kind,
        sourceTemplateId,
        title,
        description,
        question: kind === "poll" ? question : "",
        policyText: kind === "acknowledgement" ? policy : "",
        policyVersion,
        policyAttachmentId: kind === "acknowledgement" ? attachmentId : null,
        choices,
        maxSelections: multiple ? choices.length : 1,
        anonymous: kind === "poll" && anonymous,
        allowVoteChanges: kind === "poll" && edits,
        resultsTiming: liveResults ? "live" : "at_close",
        audience: {
          mode: all ? "all_active" : "selected",
          userIds: all ? [] : selected,
          rolling,
        },
        durationHours: Number(duration) * (kind === "poll" ? 1 : 24),
        timezone,
        reminderHours: reminders ? Number(reminderHours) : null,
        briefing: { enabled: brief, hour, minute, push: briefPush },
        escalation: escalate
          ? { userId: escalate, delayHours: Number(escalateHours) }
          : null,
      });
      setReview(config);
      setNotice("");
    } catch (e) {
      setNotice(
        e instanceof z.ZodError
          ? e.issues.map((i) => i.message).join("; ")
          : e instanceof Error
            ? e.message
            : t("formCampaignLabels.e002"),
      );
    }
  };
  const save = async () => {
    if (!review) return;
    try {
      const r = await api.send(
        campaignId
          ? `/api/work-hub/form-campaigns/${campaignId}`
          : "/api/work-hub/form-campaigns",
        review,
        version,
        campaignId ? "PATCH" : "POST",
      );
      onSaved(String(r.resource.campaignId));
      onClose();
    } catch {}
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!api.busy) onClose();
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,.65)",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 2,
            borderColor: colors.primary,
            borderRadius: 14,
            padding: 16,
            width: "100%",
            maxWidth: 680,
            maxHeight: "92%",
            alignSelf: "center",
            gap: 12,
          }}
        >
          <Text style={{ ...label, fontSize: 20, fontWeight: "700" }}>
            {t("formCampaignLabels.c001")}
          </Text>
          <TogglePillButton color="brand" disabled={api.busy} onPress={onClose}>
            {t("formCampaignLabels.c061")}
          </TogglePillButton>
          <ScrollView contentContainerStyle={{ gap: 12 }}>
            {review ? (
              <View style={{ gap: 12 }}>
                <Text style={label}>
                  {review.title} · {review.kind}
                </Text>
                <Text style={label}>
                  {review.audience.mode === "all_active"
                    ? t("formCampaignLabels.e007")
                    : `${review.audience.userIds.length} selected employees`}{" "}
                  · {review.durationHours}
                  {t("formCampaignLabels.c062")}
                </Text>
                <Text style={label}>
                  {t("formCampaignLabels.c063")}{" "}
                  {review.briefing.enabled
                    ? `${briefTime} ${review.timezone}`
                    : "Off"}{" "}
                  {t("formCampaignLabels.c064")}{" "}
                  {review.reminderHours
                    ? `${review.reminderHours} hours`
                    : "Off"}
                </Text>
                <Text style={label}>{t("formCampaignLabels.c065")}</Text>
                {review.kind === "acknowledgement" &&
                  !review.policyText.trim() &&
                  !review.policyAttachmentId && (
                    <Text style={label}>{t("formCampaignLabels.c066")}</Text>
                  )}
                <TogglePillButton
                  color="brand"
                  disabled={api.busy || api.uncertain}
                  onPress={() => setReview(null)}
                >
                  {t("formCampaignLabels.c004")}
                </TogglePillButton>
                <TogglePillButton
                  color="brand"
                  disabled={api.busy}
                  onPress={() => void save()}
                >
                  {t("formCampaignLabels.c005")}
                </TogglePillButton>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["acknowledgement", "poll", "form"] as const).map((k) => (
                    <TogglePillButton
                      key={k}
                      color="brand"
                      solid={kind === k}
                      onPress={() => {
                        setKind(k);
                        setDuration(k === "poll" ? "24" : "30");
                      }}
                    >
                      {k === "poll"
                        ? "Poll"
                        : k === "form"
                          ? t("formCampaignLabels.e025")
                          : t("formCampaignLabels.e026")}
                    </TogglePillButton>
                  ))}
                </View>
                {kind === "form" && (
                  <View>
                    <Text style={label}>{t("formCampaignLabels.c011")}</Text>
                    {api.data?.forms.map((f) => (
                      <TogglePillButton
                        key={f.id}
                        color="brand"
                        solid={sourceTemplateId === f.id}
                        onPress={() => setSourceTemplateId(f.id)}
                      >
                        {f.name}
                      </TogglePillButton>
                    ))}
                  </View>
                )}
                <TextInput
                  accessibilityLabel={t("formCampaignLabels.c012")}
                  placeholder={t("formCampaignLabels.c067")}
                  value={title}
                  onChangeText={setTitle}
                  style={field}
                />
                <TextInput
                  accessibilityLabel={t("formCampaignLabels.c013")}
                  placeholder={t("formCampaignLabels.c068")}
                  multiline
                  value={description}
                  onChangeText={setDescription}
                  style={field}
                />
                {kind === "poll" && (
                  <TextInput
                    accessibilityLabel="Poll question"
                    placeholder="Question"
                    multiline
                    value={question}
                    onChangeText={setQuestion}
                    style={field}
                  />
                )}
                {kind === "acknowledgement" ? (
                  <>
                    <TextInput
                      accessibilityLabel={t("formCampaignLabels.c015")}
                      placeholder={t("formCampaignLabels.c015")}
                      value={policyVersion}
                      onChangeText={setPolicyVersion}
                      style={field}
                    />
                    <TextInput
                      accessibilityLabel={t("formCampaignLabels.c016")}
                      placeholder={t("formCampaignLabels.c069")}
                      multiline
                      value={policy}
                      onChangeText={setPolicy}
                      style={[field, { minHeight: 140 }]}
                    />
                    <Text style={label}>{t("formCampaignLabels.c070")}</Text>
                    <TogglePillButton
                      color="brand"
                      solid={!attachmentId}
                      onPress={() => setAttachmentId(null)}
                    >
                      {t("formCampaignLabels.c020")}
                    </TogglePillButton>
                    {api.data?.files.map((file) => (
                      <TogglePillButton
                        key={file.id}
                        color="brand"
                        solid={attachmentId === file.id}
                        onPress={() => setAttachmentId(file.id)}
                      >
                        {file.fileName}
                      </TogglePillButton>
                    ))}
                    <Text style={label}>{t("formCampaignLabels.c071")}</Text>
                  </>
                ) : kind === "poll" ? (
                  <>
                    <TextInput
                      accessibilityLabel={t("formCampaignLabels.c021")}
                      placeholder={t("formCampaignLabels.c072")}
                      multiline
                      value={choiceText}
                      onChangeText={setChoiceText}
                      style={[field, { minHeight: 100 }]}
                    />
                    {toggle(
                      t("formCampaignLabels.e027"),
                      multiple,
                      setMultiple,
                    )}
                    {toggle(
                      t("formCampaignLabels.e004"),
                      anonymous,
                      setAnonymous,
                    )}
                    {toggle(t("formCampaignLabels.e028"), edits, setEdits)}
                    {toggle(
                      t("formCampaignLabels.e006"),
                      liveResults,
                      setLiveResults,
                    )}
                  </>
                ) : null}
                <Text style={label}>
                  {kind === "poll"
                    ? t("formCampaignLabels.e029")
                    : t("formCampaignLabels.e030")}
                </Text>
                <TextInput
                  accessibilityLabel={t("formCampaignLabels.c073")}
                  keyboardType="numeric"
                  value={duration}
                  onChangeText={setDuration}
                  style={field}
                />
                <TextInput
                  accessibilityLabel={t("formCampaignLabels.c025")}
                  value={timezone}
                  onChangeText={setTimezone}
                  style={field}
                />
                {toggle(t("formCampaignLabels.e007"), all, setAll)}
                {toggle(t("formCampaignLabels.e008"), rolling, setRolling)}
                {!all && (
                  <>
                    <TextInput
                      accessibilityLabel={t("formCampaignLabels.c074")}
                      placeholder={t("formCampaignLabels.c075")}
                      value={search}
                      onChangeText={setSearch}
                      style={field}
                    />
                    <View
                      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                    >
                      {api.data?.people
                        .filter((p) =>
                          (p.name ?? "")
                            .toLowerCase()
                            .includes(search.toLowerCase()),
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
                            {p.name ?? "Employee"}
                          </TogglePillButton>
                        ))}
                    </View>
                  </>
                )}
                {toggle(t("formCampaignLabels.e009"), reminders, setReminders)}
                {reminders && (
                  <TextInput
                    accessibilityLabel={t("formCampaignLabels.c026")}
                    keyboardType="numeric"
                    value={reminderHours}
                    onChangeText={setReminderHours}
                    style={field}
                  />
                )}
                {toggle(t("formCampaignLabels.e010"), brief, setBrief)}
                {brief && (
                  <>
                    <TextInput
                      accessibilityLabel={t("formCampaignLabels.c076")}
                      placeholder={t("formCampaignLabels.c077")}
                      value={briefTime}
                      onChangeText={setBriefTime}
                      style={field}
                    />
                    {toggle(
                      t("formCampaignLabels.e011"),
                      briefPush,
                      setBriefPush,
                    )}
                  </>
                )}
                {kind === "acknowledgement" && (
                  <View style={{ gap: 8 }}>
                    <Text style={label}>{t("formCampaignLabels.c078")}</Text>
                    <TogglePillButton
                      color="brand"
                      solid={!escalate}
                      onPress={() => setEscalate(null)}
                    >
                      {t("formCampaignLabels.c030")}
                    </TogglePillButton>
                    {api.data?.people
                      .filter((p) => p.role === "admin")
                      .map((p) => (
                        <TogglePillButton
                          key={p.userId}
                          color="brand"
                          solid={escalate === p.userId}
                          onPress={() => setEscalate(p.userId)}
                        >
                          {p.name ?? "Administrator"}
                        </TogglePillButton>
                      ))}
                    {escalate && (
                      <TextInput
                        accessibilityLabel={t("formCampaignLabels.c079")}
                        keyboardType="numeric"
                        value={escalateHours}
                        onChangeText={setEscalateHours}
                        style={field}
                      />
                    )}
                  </View>
                )}
                <TogglePillButton
                  color="brand"
                  disabled={api.loading || api.busy || api.uncertain}
                  onPress={inspect}
                >
                  {t("formCampaignLabels.c032")}
                </TogglePillButton>
              </View>
            )}
            {!!(notice || api.error) && (
              <Text accessibilityLiveRegion="polite" style={label}>
                {notice || api.error}
              </Text>
            )}
            {api.uncertain && (
              <TogglePillButton
                color="brand"
                disabled={api.busy}
                onPress={() =>
                  void api
                    .retryOriginal()
                    .then((r) => {
                      onSaved(String(r.resource.campaignId));
                      onClose();
                    })
                    .catch(() => {})
                }
              >
                {t("formCampaignLabels.c000")}
              </TogglePillButton>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
