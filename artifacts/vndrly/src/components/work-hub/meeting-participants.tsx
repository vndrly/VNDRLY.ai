import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import BrandPillButton from "@/components/brand-pill-button";
import { workHubRequest } from "@/lib/work-hub-client";

const peopleSchema = z.array(
  z.object({
    id: z.number().int().positive(),
    displayName: z.string(),
    sameCompany: z.boolean(),
  }),
);
export function MeetingParticipants({
  identity,
  selected,
  onChange,
  onReady,
  onChoices,
}: {
  identity: string;
  selected: number[];
  onChange: (ids: number[]) => void;
  onReady: (ready: boolean) => void;
  onChoices?: (people: { id: number; displayName: string }[]) => void;
}) {
  const { t } = useTranslation();
  const [people, setPeople] = useState<z.infer<typeof peopleSchema>>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPeople([]);
    setState("loading");
    onChange([]);
    onReady(false);
    onChoices?.([]);
    void workHubRequest("/people", { signal: controller.signal })
      .then((raw) => {
        if (!active) return;
        const values = peopleSchema
          .parse(raw)
          .filter((person) => person.sameCompany);
        setPeople(values);
        onChoices?.(values);
        setState("ready");
        onReady(true);
      })
      .catch(() => {
        if (active) {
          setState("error");
          onReady(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [identity]);
  return (
    <fieldset>
      <legend>
        {t("meetingParticipants.company")}
      </legend>
      <p>
        {t("meetingParticipants.hint")}
      </p>
      {state === "loading" && (
        <p>{t("meetingParticipants.loading")}</p>
      )}
      {state === "error" && (
        <p role="alert">
          {t("meetingParticipants.unavailable")}
        </p>
      )}
      {state === "ready" &&
        people.map((person) => (
          <BrandPillButton
            key={person.id}
            type="button"
            tone="brand"
            aria-pressed={selected.includes(person.id)}
            onClick={() =>
              onChange(
                selected.includes(person.id)
                  ? selected.filter((id) => id !== person.id)
                  : [...selected, person.id],
              )
            }
          >
            {person.displayName}
          </BrandPillButton>
        ))}
    </fieldset>
  );
}
