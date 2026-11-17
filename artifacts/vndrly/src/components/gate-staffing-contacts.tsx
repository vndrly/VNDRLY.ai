import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { withRequestDeadline } from "@/lib/request-deadline";
type Contact = { userId: number; name: string; phone: string | null; email: string | null; pickupShifts: boolean; onCall: boolean };

export default function GateStaffingContacts({ alertId, es }: { alertId: string; es: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const contacts = useQuery({
    queryKey: ["gate-staffing-contacts", user?.userId, user?.activeMembershipId, user?.vendorId, alertId],
    enabled: open, retry: false, refetchInterval: open ? 30000 : false,
    queryFn: ({ signal }) => withRequestDeadline(async requestSignal => {
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/gate-staffing-alerts/${encodeURIComponent(alertId)}/contacts`, { credentials: "include", signal: requestSignal });
      if (!response.ok) throw Error("Contacts unavailable");
      return response.json() as Promise<{ people: Contact[] }>;
    }, { signal, timeoutMs: 20000, timeoutMessage: "Contacts could not load." }),
  });
  return <details className="mt-3 border-t border-current/20 pt-3" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">{es ? "Contactos para cubrir el turno" : "Coverage contacts"}</summary>
    {open && <div className="mt-2 space-y-2">
      {contacts.isPending && <p role="status">{es ? "Cargando contactos…" : "Loading contacts…"}</p>}
      {contacts.isError && <p role="alert">{es ? "No se pudieron cargar los contactos." : "Contacts could not load."} <button type="button" className="underline" onClick={() => void contacts.refetch()}>{es ? "Reintentar" : "Retry"}</button></p>}
      {contacts.data && <>
        <p className="text-xs">{es ? "En verde: quiere turnos extra." : "Green: wants extra shifts."}</p>
        <ul className="space-y-2">{contacts.data.people.map(person => <li key={person.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-current/20 bg-[#242426] p-3 text-[#f8fafc]">
          <div><strong className={person.pickupShifts ? "text-green-400" : undefined}>{person.name}</strong>
            <div className="flex flex-wrap gap-3 text-xs">{person.pickupShifts && <span className="text-green-400">{es ? "Turno extra" : "Pickup Shift"}</span>}{person.onCall && <span>On Call</span>}</div>
          </div>
          <div className="flex flex-wrap gap-3">{person.phone && <a className="underline" href={`tel:${person.phone}`}>{es ? "Llamar" : "Call"}</a>}{person.email && <a className="underline" href={`mailto:${person.email}`}>{es ? "Correo" : "Email"}</a>}</div>
        </li>)}</ul>
        {!contacts.data.people.length && <p>{es ? "No hay personal de acceso registrado." : "No Gate staff recorded."}</p>}
      </>}
    </div>}
  </details>;
}
