import { useTranslation } from "react-i18next";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { downloadAndShareProtectedFile } from "@/lib/meeting-files";
import React, { useEffect, useState } from "react";
import { Linking, Switch, Text, TextInput, View } from "react-native";
import {
  FormCampaignInstanceSchema,
  GeneralCampaignFieldSchema,
} from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useFormCampaigns } from "@/lib/use-form-campaigns";
import TogglePillButton from "../TogglePillButton";
export default function FormCampaignResponse({
  instanceId,
}: {
  instanceId: string;
}) {
  const { t } = useTranslation();

  const colors = useColors(),
    api = useFormCampaigns(
      `/api/work-hub/form-campaigns/instances/${instanceId}`,
      (value) => FormCampaignInstanceSchema.parse(value),
    );
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [ack, setAck] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [notice, setNotice] = useState(""),
    [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setValues({});
    setAck(false);
    setSelected([]);
    setNotice("");
  }, [instanceId, api.contextKey]);
  useEffect(() => {
    if (!api.data?.response) return;
    setValues(api.data.response.values);
    setAck(api.data.response.values.acknowledged === true);
    const choices = api.data.response.values.choices;
    setSelected(
      Array.isArray(choices)
        ? choices.filter((x): x is string => typeof x === "string")
        : [],
    );
  }, [api.data?.response?.version]);
  const card = {
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 14,
      padding: 16,
      gap: 12,
      backgroundColor: colors.card,
    },
    label = { color: colors.text };
  if (!api.data)
    return (
      <View style={card}>
        <Text style={label}>{api.error || t("formCampaignLabels.e035")}</Text>
        <TogglePillButton color="brand" onPress={() => void api.reload()}>
          {t("formCampaignLabels.c081")}
        </TogglePillButton>
      </View>
    );
  const data = api.data,
    c = data.config,
    deadline = data.state.deadline ? Date.parse(data.state.deadline) : null,
    remaining =
      deadline === null
        ? null
        : Math.max(0, Math.ceil((deadline - tick) / 1000)),
    pollClosed = c.kind === "poll" && remaining === 0,
    canSubmit = data.canSubmit && !pollClosed;
  const send = async () => {
    try {
      const r = await api.send(
        `/api/work-hub/form-campaigns/instances/${instanceId}/respond`,
        c.kind === "form"
          ? { values }
          : c.kind === "acknowledgement"
            ? { acknowledged: ack }
            : { choices: selected },
        data.version,
      );
      setNotice(
        `Saved ${String(r.resource.submittedAt)}${r.resource.late ? " · Late acknowledgement" : ""}`,
      );
    } catch {}
  };
  return (
    <View style={{ gap: 12 }}>
      <View style={card}>
        <Text style={{ ...label, fontSize: 20, fontWeight: "700" }}>
          {c.title}
        </Text>
        {!!c.description && <Text style={label}>{c.description}</Text>}
        {c.kind === "poll" && !!c.question && (
          <Text style={{ ...label, fontSize: 17, fontWeight: "600" }}>
            {c.question}
          </Text>
        )}
        <Text style={label}>
          {c.kind === "poll" ? "Closes" : "Due"}:{" "}
          {deadline
            ? new Date(deadline).toLocaleString()
            : t("formCampaignLabels.e012")}{" "}
          · {c.timezone}
        </Text>
        {c.kind === "poll" && remaining !== null && (
          <Text style={label}>
            {pollClosed
              ? t("formCampaignLabels.e013")
              : `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m ${remaining % 60}s remaining`}
          </Text>
        )}
        {c.kind === "form" ? (
          <>
            {data.definition.map((raw) => {
              const f = GeneralCampaignFieldSchema.parse(raw);
              return (
                <View key={f.id}>
                  <Text style={label}>
                    {f.label}
                    {f.required ? " *" : ""}
                  </Text>
                  {f.type === "checkbox" ? (
                    <Switch
                      accessibilityLabel={f.label}
                      value={values[f.id] === true}
                      disabled={!canSubmit || api.busy || api.uncertain}
                      onValueChange={(x) =>
                        setValues((v) => ({ ...v, [f.id]: x }))
                      }
                    />
                  ) : (
                    <TextInput
                      accessibilityLabel={f.label}
                      value={String(values[f.id] ?? "")}
                      multiline={f.type === "textarea"}
                      keyboardType={f.type === "number" ? "numeric" : "default"}
                      editable={canSubmit && !api.busy && !api.uncertain}
                      style={{
                        ...label,
                        borderWidth: 1,
                        borderColor: colors.primary,
                        padding: 12,
                      }}
                      onChangeText={(x) =>
                        setValues((v) => ({
                          ...v,
                          [f.id]:
                            f.type === "number" && x !== "" ? Number(x) : x,
                        }))
                      }
                    />
                  )}
                </View>
              );
            })}
          </>
        ) : c.kind === "acknowledgement" ? (
          <>
            <Text style={label}>
              {t("formCampaignLabels.c015")}
              {c.policyVersion}
            </Text>
            <Text selectable style={label}>
              {c.policyText}
            </Text>
            {data.attachment && (
              <TogglePillButton
                color="brand"
                onPress={() => {
                  const authScope = captureAuthScope();
                  void downloadAndShareProtectedFile(
                    {
                      ...data.attachment!,
                      authScope,
                      assertCurrent: () => {
                        if (!isAuthScopeCurrent(authScope))
                          throw Error(t("formCampaignLabels.e015"));
                      },
                    },
                    `/api/work-hub/form-campaigns/instances/${instanceId}/attachment`,
                  ).catch((e) =>
                    setNotice(
                      e instanceof Error
                        ? e.message
                        : t("formCampaignLabels.e014"),
                    ),
                  );
                }}
              >
                {t("formCampaignLabels.c034")}
              </TogglePillButton>
            )}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <Text style={[label, { flex: 1 }]}>
                {t("formCampaignLabels.c036")}
              </Text>
              <Switch
                accessibilityLabel={t("formCampaignLabels.c035")}
                value={ack}
                onValueChange={setAck}
                disabled={!canSubmit || api.busy || api.uncertain}
              />
            </View>
          </>
        ) : (
          <>
            <Text style={label}>
              {c.maxSelections === 1
                ? t("formCampaignLabels.e036")
                : `Choose up to ${c.maxSelections} options`}{" "}
              ·{" "}
              {c.anonymous
                ? t("formCampaignLabels.e004")
                : t("formCampaignLabels.e017")}
            </Text>
            {c.choices.map((choice) => (
              <TogglePillButton
                key={choice.id}
                color="brand"
                solid={selected.includes(choice.id)}
                disabled={!canSubmit || api.busy || api.uncertain}
                onPress={() =>
                  setSelected((ids) =>
                    c.maxSelections === 1
                      ? [choice.id]
                      : ids.includes(choice.id)
                        ? ids.filter((id) => id !== choice.id)
                        : ids.length < c.maxSelections
                          ? [...ids, choice.id]
                          : ids,
                  )
                }
              >
                {choice.label}
              </TogglePillButton>
            ))}
          </>
        )}
        {data.response && (
          <Text style={label}>
            {t("formCampaignLabels.c093")}{" "}
            {new Date(data.response.submittedAt).toLocaleString()}
            {t("formCampaignLabels.c039")} {data.response.version}
          </Text>
        )}
        {canSubmit && (
          <TogglePillButton
            color="brand"
            disabled={
              api.busy ||
              api.uncertain ||
              (c.kind === "acknowledgement"
                ? !ack
                : c.kind === "poll"
                  ? !selected.length
                  : false)
            }
            onPress={() => void send()}
          >
            {data.response
              ? t("formCampaignLabels.e018")
              : c.kind === "poll"
                ? t("formCampaignLabels.e019")
                : c.kind === "form"
                  ? t("formCampaignLabels.e020")
                  : t("formCampaignLabels.e021")}
          </TogglePillButton>
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
                .then((r) =>
                  setNotice(`Saved ${String(r.resource.submittedAt)}`),
                )
                .catch(() => {})
            }
          >
            {t("formCampaignLabels.c000")}
          </TogglePillButton>
        )}
      </View>
      {data.totals && (
        <View style={card}>
          <Text style={{ ...label, fontWeight: "700" }}>
            {t("formCampaignLabels.c094")}
          </Text>
          {data.totals.map((choice) => (
            <Text key={choice.id} style={label}>
              {choice.label}: {choice.votes}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
