import React, { useEffect, useState } from "react";
import { AssignedLibraryReadSchema } from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
import { useCampaign } from "../form-campaigns/use-campaign";
import TogglePillButton from "@/components/brand-pill-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
const card =
  "rounded-xl border-2 border-[color:var(--brand-primary)] bg-card p-4 space-y-3";
export default function EmployeeResponse({
  instanceId,
}: {
  instanceId: string;
}) {
  const { t } = useTranslation(),
    api = useCampaign(`/library/instances/${instanceId}`, (v) =>
      AssignedLibraryReadSchema.parse(v),
    );
  const [lessons, setLessons] = useState<string[]>([]),
    [answers, setAnswers] = useState<Record<string, string[]>>({}),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [choices, setChoices] = useState<string[]>([]),
    [ack, setAck] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setLessons([]);
    setAnswers({});
    setValues({});
    setChoices([]);
    setAck(false);
    setNotice("");
  }, [instanceId, api.identity]);
  useEffect(() => {
    if (api.data) {
      setLessons(api.data.assignment.progress.lessonIds);
      setAnswers(api.data.assignment.progress.answers);
      if(api.data.assignment.status === "completed") {
        const saved=[...api.data.history].sort((a,b)=>b.version-a.version)[0]?.values;
        if(saved) {
          setValues(saved.values && typeof saved.values === "object" ? saved.values as Record<string,unknown> : saved);
          setAck(saved.acknowledged === true);
          setChoices(Array.isArray(saved.choices) ? saved.choices.filter((v):v is string=>typeof v === "string") : []);
        }
      }
    }
  }, [api.data?.instanceId, api.data?.version]);
  if (!api.data)
    return (
      <div className={card}>
        <p>{api.query.error?.message ?? t("workHubLibrary.loading")}</p>
        <TogglePillButton tone="brand" onClick={() => void api.query.refetch()}>
          {t("workHubLibrary.refresh")}
        </TogglePillButton>
      </div>
    );
  const data = api.data,
    content = data.metadata.content,
    training = content?.training,
    frozen = api.mutation.isPending || api.uncertain || !data.canSubmit;
  const toggle = (value: string, array: string[]) =>
    array.includes(value)
      ? array.filter((x) => x !== value)
      : [...array, value];
  const send = (mode: "progress" | "attempt" | "complete") =>
    api.send(
      {
        path: `/library/instances/${instanceId}/${mode}`,
        payload: {
          acknowledged: ack,
          lessonIds: lessons,
          answers,
          values,
          choices,
        },
        version: data.version,
      },
      {
        onSuccess: (r) => {
          const grade = r.resource.grade;
          setNotice(
            grade
              ? t(
                  grade.passed
                    ? "workHubLibrary.passed"
                    : "workHubLibrary.needsRetry",
                )
              : t(
                  mode === "progress"
                    ? "workHubLibrary.progressSaved"
                    : "workHubLibrary.responseSaved",
                ),
          );
        },
      },
    );
  return (
    <div className="space-y-4">
      <section className={card}>
        <h3 className="font-semibold text-lg">{data.title}</h3>
        <p>
          {t(`workHubLibrary.status_${data.assignment.status}`)} ·{" "}
          {t("workHubLibrary.version")} {data.metadata.contentVersion}
        </p>
        <p>
          {t("workHubLibrary.due")}:{" "}
          {new Date(data.assignment.dueAt).toLocaleString()}
        </p>
        <p className="whitespace-pre-wrap">{content?.description}</p>
        {data.attachments.map((file) => (
          <a
            key={file.fileId}
            className="underline"
            href={`/api/work-hub/library/instances/${instanceId}/files/${file.fileId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {file.fileName}
          </a>
        ))}
        {data.metadata.kind === "policy" && (
          <>
            <p className="whitespace-pre-wrap">{content?.policyText}</p>
            <label className="flex gap-2 items-center">
              <input
                type="checkbox"
                disabled={frozen}
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              {t("workHubLibrary.ackPolicy")}
            </label>
          </>
        )}
        {training && (
          <>
            {training.lessons.map((lesson) => (
              <section key={lesson.id} className={card}>
                <h4 className="font-semibold">{lesson.title}</h4>
                <p className="whitespace-pre-wrap">{lesson.body}</p>
                {lesson.links.map((link) => (
                  <a
                    className="block underline"
                    key={link}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("workHubLibrary.openResource")}
                  </a>
                ))}
                <label className="flex gap-2 items-center">
                  <input
                    type="checkbox"
                    checked={lessons.includes(lesson.id)}
                    disabled={frozen}
                    onChange={() => setLessons(toggle(lesson.id, lessons))}
                  />
                  {t("workHubLibrary.markLesson")}
                </label>
              </section>
            ))}
            {training.questions.map((q) => (
              <fieldset key={q.id} className={card}>
                <legend className="font-semibold">{q.prompt}</legend>
                <p>
                  {t(
                    q.multiple
                      ? "workHubLibrary.selectMultiple"
                      : "workHubLibrary.selectOne",
                  )}
                </p>
                {q.options.map((o) => (
                  <label key={o.id} className="flex gap-2 items-center">
                    <input
                      type={q.multiple ? "checkbox" : "radio"}
                      name={q.id}
                      checked={answers[q.id]?.includes(o.id) ?? false}
                      disabled={frozen}
                      onChange={() =>
                        setAnswers({
                          ...answers,
                          [q.id]: q.multiple
                            ? toggle(o.id, answers[q.id] ?? [])
                            : [o.id],
                        })
                      }
                    />
                    {o.label}
                  </label>
                ))}
              </fieldset>
            ))}
            {training.completionMode !== "quiz" && (
              <label className="flex gap-2 items-center">
                <input
                  type="checkbox"
                  disabled={frozen}
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                {t("workHubLibrary.ackTraining")}
              </label>
            )}
            <p>
              {t("workHubLibrary.passingScore")}: {training.passingPercent}%
            </p>
            <TogglePillButton
              tone="brand"
              disabled={frozen}
              onClick={() => send("progress")}
            >
              {t("workHubLibrary.saveProgress")}
            </TogglePillButton>
          </>
        )}
        {data.metadata.kind === "form" &&
          content?.fields.map((field) => (
            <div className="space-y-2" key={field.id}>
              <label className="block font-semibold" htmlFor={field.id}>
                {field.label}
                {field.required ? " *" : ""}
              </label>
              {field.type === "choice" ? (
                <select
                  id={field.id}
                  value={String(values[field.id] ?? "")}
                  disabled={frozen}
                  onChange={(e) =>
                    setValues({ ...values, [field.id]: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {field.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : field.type === "checkbox" ? (
                <input
                  id={field.id}
                  type="checkbox"
                  disabled={frozen}
                  checked={values[field.id] === true}
                  onChange={(e) =>
                    setValues({ ...values, [field.id]: e.target.checked })
                  }
                />
              ) : field.type === "textarea" ? (
                <Textarea
                  id={field.id}
                  disabled={frozen}
                  value={String(values[field.id] ?? "")}
                  onChange={(e) =>
                    setValues({ ...values, [field.id]: e.target.value })
                  }
                />
              ) : (
                <Input
                  id={field.id}
                  type={
                    field.type === "date"
                      ? "date"
                      : field.type === "number"
                        ? "number"
                        : "text"
                  }
                  disabled={frozen}
                  value={String(values[field.id] ?? "")}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [field.id]:
                        field.type === "number" && e.target.value !== ""
                          ? Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              )}
            </div>
          ))}
        {data.metadata.kind === "poll" &&
          content?.poll?.choices.map((o) => (
            <label className="flex gap-2 items-center" key={o.id}>
              <input
                type={content.poll!.maxSelections === 1 ? "radio" : "checkbox"}
                name="poll"
                disabled={frozen}
                checked={choices.includes(o.id)}
                onChange={() =>
                  setChoices(
                    content.poll!.maxSelections === 1
                      ? [o.id]
                      : toggle(o.id, choices),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        {(notice || api.mutation.error) && (
          <p role="status">{notice || api.mutation.error?.message}</p>
        )}
        {api.uncertain ? (
          <TogglePillButton
            tone="brand"
            disabled={api.mutation.isPending}
            onClick={api.retry}
          >
            {t("workHubLibrary.retry")}
          </TogglePillButton>
        ) : (
          data.canSubmit && (
            <TogglePillButton
              tone="brand"
              disabled={api.mutation.isPending}
              onClick={() =>
                send(
                  training && training.completionMode !== "checkoff"
                    ? "attempt"
                    : "complete",
                )
              }
            >
              {t(
                training && training.completionMode !== "checkoff"
                  ? "workHubLibrary.submitQuiz"
                  : "workHubLibrary.submitResponse",
              )}
            </TogglePillButton>
          )
        )}
      </section>
      {data.history.map((receipt) => (
        <section key={receipt.id} className={card}>
          <p>
            {t("workHubLibrary.receipt")} {receipt.version} ·{" "}
            {new Date(receipt.submittedAt).toLocaleString()}
          </p>
          {receipt.values.grade && typeof receipt.values.grade === "object" ? (
            <p>
              {t(
                (receipt.values.grade as { passed: boolean }).passed
                  ? "workHubLibrary.passed"
                  : "workHubLibrary.needsRetry",
              )}{" "}
              ·{" "}
              {(receipt.values.grade as { scorePercent: number }).scorePercent}%
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
