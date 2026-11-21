import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { BrandedInput } from "./chrome";
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
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<z.infer<typeof peopleSchema>>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPeople([]);
    setState("loading");
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
      <BrandedInput aria-label="Find meeting participants" placeholder="Search people by name" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="mt-3 grid h-48 content-start gap-x-4 gap-y-1 overflow-y-auto rounded-xl border-2 border-[var(--brand-primary)] bg-[#242426] p-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, max(250px, 40%)), 1fr))" }} aria-label="Choose meeting participants">
        {state === "ready" && people.filter(person => person.displayName.toLowerCase().includes(search.toLowerCase())).map(person => (
          <label key={person.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={selected.includes(person.id)} onChange={() => onChange(selected.includes(person.id) ? selected.filter(id => id !== person.id) : [...selected, person.id])} />
            <span>{person.displayName}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
