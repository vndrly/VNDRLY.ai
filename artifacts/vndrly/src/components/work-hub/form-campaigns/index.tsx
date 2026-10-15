import { useTranslation } from "react-i18next";
import { isWorkHubAdmin } from "@/lib/work-hub-client";
import React, { useEffect, useState } from "react";
import { z } from "zod/v4";
import {
  GeneralCampaignFieldSchema,
  FormCampaignConfigSchema,
  FormCampaignSummarySchema,
  FormCampaignInstanceSchema,
  FormCampaignProgressSchema,
  type FormCampaignConfig,
} from "@workspace/api-zod";
import { useCampaign } from "./use-campaign";
import BrandPillButton from "@/components/brand-pill-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
const card =
  "rounded-xl border-2 border-[color:var(--brand-primary)] bg-card p-4 space-y-3";
function ErrorNotice({ api }: { api: ReturnType<typeof useCampaign<any>> }) {
  const { t } = useTranslation();

  return (
    <>
      {(api.query.isError || api.mutation.isError) && (
        <p role="alert">
          {api.mutation.error?.message ?? t("formCampaignLabels.e000")}
        </p>
      )}
      {api.uncertain && (
        <BrandPillButton
          tone="brand"
          disabled={api.mutation.isPending}
          onClick={api.retry}
        >
          {t("formCampaignLabels.c000")}
        </BrandPillButton>
      )}
    </>
  );
}
function CampaignEditor({
  initial,
  id,
  version,
  onClose,
  onSaved,
}: {
  initial?: FormCampaignConfig;
  id?: string;
  version?: number;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();

  const api = useCampaign("/form-campaigns/options", (v) =>
    z
      .object({
        forms: z
          .array(z.object({ id: z.string(), name: z.string() }))
          .default([]),
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
      })
      .parse(v),
  );
  const [config, setConfig] = useState<FormCampaignConfig>(
      () =>
        initial ??
        FormCampaignConfigSchema.parse({
          kind: "acknowledgement",
          title: t("formCampaignLabels.e001"),
          briefing: { enabled: true, hour: 8, minute: 0, push: false },
        }),
    ),
    [choiceText, setChoiceText] = useState(
      initial?.choices.map((c) => c.label).join("\n") ?? "A\nB\nC\nD",
    ),
    [review, setReview] = useState<FormCampaignConfig | null>(null),
    [error, setError] = useState("");
  const edit = (change: Partial<FormCampaignConfig>) => {
    setReview(null);
    setConfig((c) => ({ ...c, ...change }));
  };
  const inspect = () => {
    try {
      const choices =
        config.kind === "poll"
          ? choiceText
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean)
              .map((label, i) => ({ id: String.fromCharCode(97 + i), label }))
          : [];
      setReview(FormCampaignConfigSchema.parse({ ...config, choices }));
      setError("");
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => i.message).join("; ")
          : t("formCampaignLabels.e002"),
      );
    }
  };
  const checkbox = (
    label: string,
    checked: boolean,
    onChange: (value: boolean) => void,
  ) => (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={api.mutation.isPending || api.uncertain}
      />
      {label}
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !api.mutation.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("formCampaignLabels.c001")}</DialogTitle>
        </DialogHeader>
        {review ? (
          <section className="space-y-3">
            <h3>{review.title}</h3>
            <p>
              {review.audience.mode === "all_active"
                ? t("formCampaignLabels.e003")
                : `${review.audience.userIds.length} selected employees`}{" "}
              · {review.durationHours ?? (review.kind === "poll" ? 24 : 720)}{" "}
              {t("formCampaignLabels.c002")}
            </p>
            <p>{t("formCampaignLabels.c003")}</p>
            <BrandPillButton
              disabled={api.mutation.isPending || api.uncertain}
              onClick={() => setReview(null)}
            >
              {t("formCampaignLabels.c004")}
            </BrandPillButton>
            <BrandPillButton
              tone="brand"
              disabled={api.mutation.isPending || api.uncertain}
              onClick={() =>
                api.send(
                  {
                    path: id ? `/form-campaigns/${id}` : "/form-campaigns",
                    payload: review,
                    version,
                    method: id ? "PATCH" : "POST",
                  },
                  {
                    onSuccess: (r) => {
                      onSaved(String(r.resource.campaignId));
                      onClose();
                    },
                  },
                )
              }
            >
              {t("formCampaignLabels.c005")}
            </BrandPillButton>
          </section>
        ) : (
          <section className="space-y-3">
            <select
              aria-label={t("formCampaignLabels.c006")}
              className="border-2 rounded p-2 bg-card"
              value={config.kind}
              onChange={(e) =>
                edit({
                  kind: e.target.value as FormCampaignConfig["kind"],
                  durationHours: e.target.value === "poll" ? 24 : 720,
                  choices:
                    e.target.value === "poll"
                      ? [
                          { id: "a", label: "A" },
                          { id: "b", label: "B" },
                          { id: "c", label: "C" },
                          { id: "d", label: "D" },
                        ]
                      : [],
                  maxSelections: 1,
                  anonymous: false,
                  policyText: "",
                  policyAttachmentId: null,
                })
              }
            >
              <option value="acknowledgement">
                {t("formCampaignLabels.c007")}
              </option>
              <option value="poll">{t("formCampaignLabels.c008")}</option>
              <option value="form">{t("formCampaignLabels.c009")}</option>
            </select>
            {config.kind === "form" && (
              <select
                aria-label={t("formCampaignLabels.c010")}
                value={config.sourceTemplateId ?? ""}
                onChange={(e) =>
                  edit({ sourceTemplateId: e.target.value || null })
                }
              >
                <option value="">{t("formCampaignLabels.c011")}</option>
                {api.data?.forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
            <Input
              aria-label={t("formCampaignLabels.c012")}
              value={config.title}
              onChange={(e) => edit({ title: e.target.value })}
            />
            <Textarea
              aria-label={t("formCampaignLabels.c013")}
              placeholder={t("formCampaignLabels.c014")}
              value={config.description}
              onChange={(e) => edit({ description: e.target.value })}
            />
            {config.kind === "acknowledgement" ? (
              <>
                <Input
                  aria-label={t("formCampaignLabels.c015")}
                  value={config.policyVersion}
                  onChange={(e) => edit({ policyVersion: e.target.value })}
                />
                <Textarea
                  aria-label={t("formCampaignLabels.c016")}
                  placeholder={t("formCampaignLabels.c017")}
                  value={config.policyText}
                  onChange={(e) => edit({ policyText: e.target.value })}
                />
                <label>
                  {t("formCampaignLabels.c018")}
                  <select
                    aria-label={t("formCampaignLabels.c019")}
                    value={config.policyAttachmentId ?? ""}
                    onChange={(e) =>
                      edit({ policyAttachmentId: e.target.value || null })
                    }
                  >
                    <option value="">{t("formCampaignLabels.c020")}</option>
                    {api.data?.files.map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.fileName}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : config.kind === "poll" ? (
              <>
                <Textarea
                  aria-label={t("formCampaignLabels.c021")}
                  value={choiceText}
                  onChange={(e) => {
                    setChoiceText(e.target.value);
                    setReview(null);
                  }}
                />
                <Input
                  aria-label={t("formCampaignLabels.c022")}
                  type="number"
                  min={1}
                  max={20}
                  value={config.maxSelections}
                  onChange={(e) =>
                    edit({ maxSelections: Number(e.target.value) })
                  }
                />
                {checkbox(
                  t("formCampaignLabels.e004"),
                  config.anonymous,
                  (value) => edit({ anonymous: value }),
                )}
                {checkbox(
                  t("formCampaignLabels.e005"),
                  config.allowVoteChanges,
                  (value) => edit({ allowVoteChanges: value }),
                )}
                {checkbox(
                  t("formCampaignLabels.e006"),
                  config.resultsTiming === "live",
                  (value) =>
                    edit({ resultsTiming: value ? "live" : "at_close" }),
                )}
              </>
            ) : null}
            <label>
              {t("formCampaignLabels.c023")}
              <Input
                aria-label={t("formCampaignLabels.c024")}
                type="number"
                value={
                  config.durationHours ?? (config.kind === "poll" ? 24 : 720)
                }
                onChange={(e) =>
                  edit({ durationHours: Number(e.target.value) })
                }
              />
            </label>
            <Input
              aria-label={t("formCampaignLabels.c025")}
              value={config.timezone}
              onChange={(e) => edit({ timezone: e.target.value })}
            />
            {checkbox(
              t("formCampaignLabels.e007"),
              config.audience.mode === "all_active",
              (value) =>
                edit({
                  audience: {
                    ...config.audience,
                    mode: value ? "all_active" : "selected",
                    userIds: [],
                  },
                }),
            )}
            {checkbox(
              t("formCampaignLabels.e008"),
              config.audience.rolling,
              (value) =>
                edit({ audience: { ...config.audience, rolling: value } }),
            )}
            {config.audience.mode === "selected" && (
              <div className="flex gap-2 flex-wrap">
                {api.data?.people.map((p) => (
                  <BrandPillButton
                    key={p.userId}
                    aria-pressed={config.audience.userIds.includes(p.userId)}
                    onClick={() =>
                      edit({
                        audience: {
                          ...config.audience,
                          userIds: config.audience.userIds.includes(p.userId)
                            ? config.audience.userIds.filter(
                                (id) => id !== p.userId,
                              )
                            : [...config.audience.userIds, p.userId],
                        },
                      })
                    }
                  >
                    {p.name ?? "Employee"}
                  </BrandPillButton>
                ))}
              </div>
            )}
            {checkbox(
              t("formCampaignLabels.e009"),
              config.reminderHours !== null,
              (value) => edit({ reminderHours: value ? 24 : null }),
            )}
            {config.reminderHours !== null && (
              <Input
                aria-label={t("formCampaignLabels.c026")}
                type="number"
                value={config.reminderHours}
                onChange={(e) =>
                  edit({ reminderHours: Number(e.target.value) })
                }
              />
            )}
            {checkbox(
              t("formCampaignLabels.e010"),
              config.briefing.enabled,
              (value) =>
                edit({ briefing: { ...config.briefing, enabled: value } }),
            )}
            {config.briefing.enabled && (
              <>
                <Input
                  aria-label={t("formCampaignLabels.c027")}
                  type="time"
                  value={`${String(config.briefing.hour).padStart(2, "0")}:${String(config.briefing.minute).padStart(2, "0")}`}
                  onChange={(e) => {
                    const [hour, minute] = e.target.value
                      .split(":")
                      .map(Number);
                    edit({ briefing: { ...config.briefing, hour, minute } });
                  }}
                />
                {checkbox(
                  t("formCampaignLabels.e011"),
                  config.briefing.push,
                  (value) =>
                    edit({ briefing: { ...config.briefing, push: value } }),
                )}
              </>
            )}
            {config.kind === "acknowledgement" && (
              <>
                <label>
                  {t("formCampaignLabels.c028")}
                  <select
                    aria-label={t("formCampaignLabels.c029")}
                    value={config.escalation?.userId ?? ""}
                    onChange={(e) =>
                      edit({
                        escalation: e.target.value
                          ? {
                              userId: Number(e.target.value),
                              delayHours: config.escalation?.delayHours ?? 24,
                            }
                          : null,
                      })
                    }
                  >
                    <option value="">{t("formCampaignLabels.c030")}</option>
                    {api.data?.people
                      .filter((p) => p.role === "admin")
                      .map((p) => (
                        <option key={p.userId} value={p.userId}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                {config.escalation && (
                  <Input
                    aria-label={t("formCampaignLabels.c031")}
                    type="number"
                    value={config.escalation.delayHours}
                    onChange={(e) =>
                      edit({
                        escalation: {
                          ...config.escalation!,
                          delayHours: Number(e.target.value),
                        },
                      })
                    }
                  />
                )}
              </>
            )}
            <BrandPillButton
              tone="brand"
              disabled={
                api.query.isError ||
                api.query.isLoading ||
                api.mutation.isPending ||
                api.uncertain
              }
              onClick={inspect}
            >
              {t("formCampaignLabels.c032")}
            </BrandPillButton>
          </section>
        )}
        {error && <p role="alert">{error}</p>}
        <ErrorNotice api={api} />
      </DialogContent>
    </Dialog>
  );
}
function EmployeeForm({ id }: { id: string }) {
  const { t } = useTranslation();

  const api = useCampaign(`/form-campaigns/instances/${id}`, (v) =>
      FormCampaignInstanceSchema.parse(v),
    ),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [ack, setAck] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const r = api.data?.response;
    setValues(r?.values ?? {});
    setAck(r?.values.acknowledged === true);
    setSelected(
      Array.isArray(r?.values.choices)
        ? r.values.choices.filter((x): x is string => typeof x === "string")
        : [],
    );
  }, [api.data?.response?.version, api.identity]);
  if (!api.data)
    return (
      <section className={card}>
        <ErrorNotice api={api} />
        <p>{t("formCampaignLabels.c033")}</p>
      </section>
    );
  const d = api.data,
    c = d.config,
    deadline = d.state.deadline ? Date.parse(d.state.deadline) : null,
    remaining =
      deadline === null
        ? null
        : Math.max(0, Math.ceil((deadline - tick) / 1000)),
    canSubmit = d.canSubmit && !(c.kind === "poll" && remaining === 0);
  return (
    <section className={card}>
      <h3 className="font-bold text-lg">{c.title}</h3>
      <p>{c.description}</p>
      <p>
        {c.kind === "poll" ? "Closes" : "Due"}:{" "}
        {deadline
          ? new Date(deadline).toLocaleString()
          : t("formCampaignLabels.e012")}{" "}
        · {c.timezone}
      </p>
      {c.kind === "poll" && remaining !== null && (
        <p>
          {remaining
            ? `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m remaining`
            : t("formCampaignLabels.e013")}
        </p>
      )}
      {c.kind === "form" ? (
        <>
          {d.definition.map((raw) => {
            const f = GeneralCampaignFieldSchema.parse(raw);
            return (
              <label key={f.id} className="block">
                {f.label}
                {f.required ? " *" : ""}
                {f.type === "checkbox" ? (
                  <input
                    type="checkbox"
                    checked={values[f.id] === true}
                    disabled={
                      !canSubmit || api.uncertain || api.mutation.isPending
                    }
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.id]: e.target.checked }))
                    }
                  />
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : "text"}
                    value={String(values[f.id] ?? "")}
                    disabled={
                      !canSubmit || api.uncertain || api.mutation.isPending
                    }
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        [f.id]:
                          f.type === "number" && e.target.value !== ""
                            ? Number(e.target.value)
                            : e.target.value,
                      }))
                    }
                  />
                )}
              </label>
            );
          })}
        </>
      ) : c.kind === "acknowledgement" ? (
        <>
          <p>
            {t("formCampaignLabels.c015")}
            {c.policyVersion}
          </p>
          <p className="whitespace-pre-wrap">{c.policyText}</p>
          {d.attachment && (
            <BrandPillButton
              tone="brand"
              onClick={() => {
                const identity = api.identity;
                void fetch(
                  `/api/work-hub/form-campaigns/instances/${id}/attachment`,
                  { credentials: "include" },
                )
                  .then(async (response) => {
                    if (!response.ok) throw Error(t("formCampaignLabels.e014"));
                    const blob = await response.blob();
                    if (!api.isCurrent(identity))
                      throw Error(t("formCampaignLabels.e015"));
                    const url = URL.createObjectURL(blob),
                      anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = d.attachment!.fileName;
                    anchor.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  })
                  .catch(() => window.alert(t("formCampaignLabels.e016")));
              }}
            >
              {t("formCampaignLabels.c034")}
            </BrandPillButton>
          )}
          <label>
            <input
              type="checkbox"
              aria-label={t("formCampaignLabels.c035")}
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              disabled={!canSubmit || api.mutation.isPending || api.uncertain}
            />{" "}
            {t("formCampaignLabels.c036")}
          </label>
        </>
      ) : (
        <>
          <p>
            {c.anonymous
              ? t("formCampaignLabels.e004")
              : t("formCampaignLabels.e017")}
            {t("formCampaignLabels.c037")} {c.maxSelections}
          </p>
          {c.choices.map((choice) => (
            <label key={choice.id} className="flex gap-2">
              <input
                type={c.maxSelections === 1 ? "radio" : "checkbox"}
                name="poll-choice"
                checked={selected.includes(choice.id)}
                disabled={!canSubmit || api.mutation.isPending || api.uncertain}
                onChange={() =>
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
              />
              {choice.label}
            </label>
          ))}
        </>
      )}
      {d.response && (
        <p>
          {t("formCampaignLabels.c038")}
          {new Date(d.response.submittedAt).toLocaleString()}
          {t("formCampaignLabels.c039")} {d.response.version}
        </p>
      )}
      {canSubmit && (
        <BrandPillButton
          tone="brand"
          disabled={
            api.mutation.isPending ||
            api.uncertain ||
            (c.kind === "acknowledgement"
              ? !ack
              : c.kind === "poll"
                ? !selected.length
                : false)
          }
          onClick={() =>
            api.send({
              path: `/form-campaigns/instances/${id}/respond`,
              payload:
                c.kind === "form"
                  ? { values }
                  : c.kind === "acknowledgement"
                    ? { acknowledged: ack }
                    : { choices: selected },
              version: d.version,
            })
          }
        >
          {d.response
            ? t("formCampaignLabels.e018")
            : c.kind === "poll"
              ? t("formCampaignLabels.e019")
              : c.kind === "form"
                ? t("formCampaignLabels.e020")
                : t("formCampaignLabels.e021")}
        </BrandPillButton>
      )}
      <ErrorNotice api={api} />
      {d.totals && (
        <div>
          <h4>{t("formCampaignLabels.c040")}</h4>
          {d.totals.map((t) => (
            <p key={t.id}>
              {t.label}: {t.votes}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
function OwnerProgress({
  id,
  onEdit,
}: {
  id: string;
  onEdit: (c: FormCampaignConfig, version: number) => void;
}) {
  const { t } = useTranslation();

  const api = useCampaign(`/form-campaigns/${id}`, (v) =>
      FormCampaignProgressSchema.parse(v),
    ),
    [review, setReview] = useState(false);
  if (!api.data)
    return (
      <section className={card}>
        <a
          className="underline"
          href={`/api/work-hub/form-campaigns/${id}/export`}
          download
        >
          {t("formCampaignLabels.c041")}
        </a>
        <ErrorNotice api={api} />
        <p>{t("formCampaignLabels.c042")}</p>
      </section>
    );
  const d = api.data;
  return (
    <section className={card}>
      <h3 className="font-bold text-lg">{d.config.title}</h3>
      <p>
        {d.state.status} ·{" "}
        {d.state.deadline
          ? new Date(d.state.deadline).toLocaleString()
          : t("formCampaignLabels.e022")}
      </p>
      <p>
        {d.counts.responded} / {d.counts.eligible}
        {t("formCampaignLabels.c043")} {d.counts.pending}
        {t("formCampaignLabels.c044")}
        {d.counts.overdue}
        {t("formCampaignLabels.c045")} {d.counts.excluded}
        {t("formCampaignLabels.c046")}
      </p>
      {d.state.status === "draft" && (
        <>
          <BrandPillButton onClick={() => onEdit(d.config, d.state.version)}>
            {t("formCampaignLabels.c047")}
          </BrandPillButton>
          <BrandPillButton tone="brand" onClick={() => setReview(true)}>
            {t("formCampaignLabels.c048")}
          </BrandPillButton>
        </>
      )}
      {review && (
        <div>
          {d.publicationPreview && (
            <p>
              {t("formCampaignLabels.preview", {
                count: d.publicationPreview.audienceCount,
                date: new Date(
                  d.publicationPreview.estimatedDeadline,
                ).toLocaleString(),
                timezone: d.publicationPreview.timezone,
              })}
            </p>
          )}
          <p>
            {t("formCampaignLabels.c049")}{" "}
            {d.config.audience.mode === "all_active"
              ? "all currently active company employees"
              : `${d.config.audience.userIds.length} selected employees`}
            {t("formCampaignLabels.c050")}
          </p>
          <BrandPillButton
            tone="brand"
            disabled={api.mutation.isPending || api.uncertain}
            onClick={() =>
              api.send(
                {
                  path: `/form-campaigns/${id}/publish`,
                  payload: {},
                  version: d.state.version,
                },
                { onSuccess: () => setReview(false) },
              )
            }
          >
            {t("formCampaignLabels.c051")}
          </BrandPillButton>
          <BrandPillButton onClick={() => setReview(false)}>
            {t("formCampaignLabels.c052")}
          </BrandPillButton>
        </div>
      )}
      {d.state.status === "published" && (
        <BrandPillButton
          disabled={api.mutation.isPending || api.uncertain}
          onClick={() =>
            api.send({
              path: `/form-campaigns/${id}/pause`,
              payload: {},
              version: d.state.version,
            })
          }
        >
          {t("formCampaignLabels.c053")}
        </BrandPillButton>
      )}
      <ErrorNotice api={api} />
      {d.totals && (
        <div>
          <h4>{t("formCampaignLabels.c040")}</h4>
          {d.totals.map((t) => (
            <p key={t.id}>
              {t.label}: {t.votes}
            </p>
          ))}
        </div>
      )}
      {!d.config.anonymous && d.receipts && (
        <div>
          <h4>{t("formCampaignLabels.c054")}</h4>
          {d.receipts.map((r) => (
            <p key={r.instanceId}>
              {r.name} ·{" "}
              {r.excluded
                ? "Excluded"
                : r.submittedAt
                  ? `${r.late ? t("formCampaignLabels.e023") : ""}${new Date(r.submittedAt).toLocaleString()}`
                  : "Outstanding"}
              {d.config.kind === "form" &&
                r.values &&
                Object.entries(r.values).map(([field, value]) => (
                  <span key={field} className="block">
                    {d.definition
                      .map((raw) => GeneralCampaignFieldSchema.parse(raw))
                      .find((f) => f.id === field)?.label ?? field}
                    : {String(value)}
                  </span>
                ))}
            </p>
          ))}
        </div>
      )}
      {d.config.anonymous && <p>{t("formCampaignLabels.c055")}</p>}
      <div>
        <h4>{t("formCampaignLabels.c056")}</h4>
        {d.briefings.map((b) => (
          <p key={b.id}>
            {new Date(b.createdAt).toLocaleString()} · {b.body} ·{" "}
            {b.deliveryStatus}
          </p>
        ))}
      </div>
    </section>
  );
}
export default function FormCampaignsArea({completed}:{completed?:boolean}) {
  const { t } = useTranslation();

  const api = useCampaign("/form-campaigns", (v) =>
      z.object({ campaigns: z.array(FormCampaignSummarySchema) }).parse(v),
    ),
    [editor, setEditor] = useState<{
      id?: string;
      config?: FormCampaignConfig;
      version?: number;
    } | null>(null),
    [selection, setSelection] = useState<{
      kind: "form" | "campaign";
      id: string;
    } | null>(() => {
      const q = new URLSearchParams(window.location.search);
      const kind = q.has("form") ? "form" : "campaign",
        id = q.get(kind);
      return id && z.uuid().safeParse(id).success ? { kind, id } : null;
    });
  useEffect(() => {
    setEditor(null);
  }, [api.identity]);
  const admin = isWorkHubAdmin(api.user);
  return (
    <section className="space-y-4 mb-4">
      <header className="flex items-center justify-between gap-2">
        {completed === undefined && <h2 className="font-bold text-xl">{t("formCampaignLabels.c057")}</h2>}
        {admin && completed === undefined && (
          <BrandPillButton tone="brand" onClick={() => setEditor({})}>
            {t("formCampaignLabels.c058")}
          </BrandPillButton>
        )}
      </header>
      <ErrorNotice api={api} />
      {api.data?.campaigns.filter(c=>completed === undefined || (!!c.instanceId && c.completed === completed)).map((c) => (
        <article className={card} key={c.campaignId}>
          <h3>{c.title}</h3>
          <p>
            {c.kind} · {c.state.status} ·{" "}
            {c.state.deadline
              ? new Date(c.state.deadline).toLocaleString()
              : "Draft"}
          </p>
          {c.instanceId && (
            <BrandPillButton
              tone="brand"
              onClick={() => setSelection({ kind: "form", id: c.instanceId! })}
            >
              {t("formCampaignLabels.c059")}
            </BrandPillButton>
          )}
          {c.canManage && (
            <BrandPillButton
              onClick={() =>
                setSelection({ kind: "campaign", id: c.campaignId })
              }
            >
              {t("formCampaignLabels.c060")}
            </BrandPillButton>
          )}
        </article>
      ))}
      {selection?.kind === "form" && (
        <EmployeeForm
          key={`${api.identity}:${selection.id}`}
          id={selection.id}
        />
      )}{" "}
      {selection?.kind === "campaign" && (
        <OwnerProgress
          key={`${api.identity}:${selection.id}`}
          id={selection.id}
          onEdit={(config, version) =>
            setEditor({ id: selection.id, config, version })
          }
        />
      )}
      {editor && (
        <CampaignEditor
          key={`${api.identity}:${editor.id ?? "new"}`}
          initial={editor.config}
          id={editor.id}
          version={editor.version}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            void api.query.refetch();
            setSelection({ kind: "campaign", id });
          }}
        />
      )}
    </section>
  );
}
