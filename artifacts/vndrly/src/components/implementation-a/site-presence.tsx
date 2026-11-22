import { MapPinned } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChangeOverSnapshot } from "@workspace/gate-booth";
import { WorkspacePanel } from "@/components/work-hub/workspace-panel";

export function SitePresence({ snapshot, loading, sites, recordHref }: {
  snapshot: ChangeOverSnapshot | null;
  loading: boolean;
  sites: { siteId: number; siteName: string }[];
  recordHref: (id: string) => string;
}) {
  const { i18n } = useTranslation();
  const es = i18n.language?.startsWith("es");
  const people = [...new Map((snapshot?.outstanding ?? []).filter(row => row.kind === "employee" || row.kind === "visitor").map(row => [row.id, row])).values()];
  return <WorkspacePanel title={es ? "Presencia en el sitio" : "Site Presence"} subtitle={es ? "Presencia registrada por el acceso" : "Gate-recorded on-site presence"} icon={MapPinned}>
    {loading && !snapshot ? <p role="status">{es ? "Cargando presencia…" : "Loading site presence…"}</p> : !snapshot ? <p role="status">{es ? "Registros no disponibles." : "Site presence records unavailable."}</p> : <>
      <p className="text-xs text-muted-foreground">{new Date(snapshot.generatedAt).toLocaleString()}</p>
      <ul className="divide-y divide-white/15">{people.map(person => <li key={person.id} className="py-3">
        <a className="block" href={`${recordHref(person.id)}&recordType=on_site&recordId=${encodeURIComponent(person.id)}&view=record`}>
          <strong>{person.name}</strong>
          <p className="text-sm">{[person.company, sites.find(site => site.siteId === person.siteId)?.siteName ?? snapshot.linkedScope?.name ?? (sites.length === 1 ? sites[0]?.siteName : null)].filter(Boolean).join(" · ")}</p>
          <p className="text-xs text-muted-foreground">{es ? "Entrada" : "Checked in"}: {new Date(person.checkIn).toLocaleString()}</p>
        </a>
      </li>)}</ul>
      {!people.length && <p>{es ? "No hay personas registradas en el sitio." : "No people are currently recorded on site."}</p>}
    </>}
  </WorkspacePanel>;
}
