import { CardHeading } from "@/components/ui/card-heading";
import type { ShiftNote } from "@workspace/gate-booth";
import { GateActivityCard } from "./gate-activity-card";
import { useTranslation } from "react-i18next";

const disclaimer = /\[gatego-operations-v2\]\s*Fictional GateGo test data; no real attendance, GPS proof, payroll approval or payment\.?/gi;
export function cleanShiftText(text: string) { return text.replace(disclaimer, "").trim(); }
export function GateShiftNoteContent({ note }: { note: ShiftNote }) {
  const { i18n } = useTranslation();
  const es = i18n.language?.startsWith("es");
  const items = note.snapshot.taskItems ?? note.snapshot.openItems;
  let notes = cleanShiftText(note.notes ?? "");
  const parsed = items.map(item => {
    const text = cleanShiftText(item.text);
    const parts = text.split(/\n(?:Resolution:\s*)?/i);
    const instruction = parts[0];
    if (instruction) notes = notes.split(instruction).join("").trim();
    return { ...item, text: instruction, resolution: item.resolution ?? parts.slice(1).join("\n").trim() };
  });
  return <>
    <div className="gate-shift-activity-records"><GateActivityCard contentOnly snapshot={note.snapshot} historyBaseHref={`/gate/history?siteId=${note.site_id ?? ""}`} showAllLogLink={false} /></div>
    {notes && <p className="whitespace-pre-wrap">{notes}</p>}
    <section aria-label="Unassigned Task Hopper" className="mt-3">
      <CardHeading as="h3" className="font-semibold">{es ? "Tareas sin asignar" : "Unassigned Task Hopper"}</CardHeading>
      {parsed.length ? <ul className="mt-2 space-y-3">{parsed.map(item => <li key={item.id}>
        <p className="whitespace-pre-wrap">{item.text}</p>
        <small>{item.status === "resolved" ? es ? "Resuelto" : "Resolved" : es ? "Abierto" : "Open"}</small>
        {item.status === "resolved" && <p className="whitespace-pre-wrap">{es ? "Resolución" : "Resolution"}: {item.resolution || (es ? "No se registró una resolución." : "No resolution was recorded.")}</p>}
      </li>)}</ul> : <p>{es ? "No hay tareas sin asignar." : "No unassigned tasks."}</p>}
    </section>
  </>;
}
