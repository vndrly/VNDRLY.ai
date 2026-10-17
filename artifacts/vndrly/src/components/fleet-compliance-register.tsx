import { useState } from "react";
import { useInfiniteQuery,useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { FleetComplianceSubject } from "@workspace/api-zod";
import { fleetClient } from "@/lib/fleet-client";
import { PngPillButton } from "./png-pill-rollover";
import {FleetEvidenceReview} from "./fleet-evidence-review";
import {FleetComplianceReviewers} from "./fleet-compliance-reviewers";
import {FleetComplianceFactsEditor} from "./fleet-compliance-facts";

export function FleetComplianceRegister({ identity,companyId }: { identity: string;companyId?:number }) {
  const cache=useQueryClient(),[factsSubject,setFactsSubject]=useState<FleetComplianceSubject|null>(null);
  const { i18n } = useTranslation(),
    es = i18n.language.startsWith("es");
  const [kind, setKind] = useState<"" | FleetComplianceSubject["kind"]>("");
  const [selected,setSelected]=useState<{id:string;revision:number}|null>(null);
  const registers = {
    carrier: es ? "Transportista y seguros" : "Carrier & insurance",
    vehicle: es ? "Vehículos" : "Vehicles",
    component: es ? "Componentes y tanques" : "Components & tanks",
    driver: es ? "Conductores" : "Drivers",
    trip: es ? "Documentos del viaje" : "Trip documents",
  };
  const verification = {
    document_received: es ? "Documento recibido" : "Document received",
    reviewed: es ? "Revisado" : "Reviewed",
    verified: es ? "Verificado" : "Verified",
    revoked: es ? "Revocado" : "Revoked",
    failed: es ? "Incumplido" : "Failed",
  };
  const reasons = {
    missing: es ? "Evidencia faltante" : "Missing evidence",
    expired: es ? "Evidencia vencida" : "Expired evidence",
    revoked: es ? "Credencial revocada" : "Revoked credential",
    failed: es ? "Requisito incumplido" : "Requirement not satisfied",
    unverified: es ? "Sin verificar" : "Unverified",
    excluded: es ? "El alcance no coincide" : "Scope does not match",
  };
  const query = useInfiniteQuery({
    queryKey: ["fleet-compliance-register", identity, kind],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fleetClient.complianceRegister({
        ...(kind ? { subjectKind: kind } : {}),
        ...(pageParam ? { after: pageParam } : {}),
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const entries = query.isError
    ? []
    : (query.data?.pages.flatMap((page) => page.entries) ?? []);
  const date = (value: string) =>
    new Date(value).toLocaleString(es ? "es-US" : "en-US");
  return (
    <section
      className="space-y-4"
      aria-label={es ? "Registros de cumplimiento" : "Compliance registers"}
    >
      <h2>{es ? "Registros de cumplimiento" : "Compliance registers"}</h2>
      <FleetComplianceReviewers identity={identity} onChanged={()=>{setSelected(null);setFactsSubject(null);void query.refetch();}}/>
      {typeof companyId==="number"&&Number.isInteger(companyId)&&companyId>0&&<PngPillButton onClick={()=>{setSelected(null);setFactsSubject({kind:"carrier",id:companyId});}}>{es?"Aplicabilidad del transportista":"Carrier applicability"}</PngPillButton>}
      <div className="fleet-detail-group">
        <p>
          {es
            ? "Las advertencias no bloquean el trabajo ni los tickets. El estado de la evidencia es distinto de la disponibilidad y la cobertura del recorrido."
            : "Compliance warnings do not block work or tickets. Evidence status is separate from availability and run-specific coverage."}
        </p>
        <p>
          {es
            ? "Los documentos privados solo están disponibles para revisores designados. Recibir un documento no equivale a verificarlo."
            : "Private documents are restricted to appointed reviewers. Receiving a document does not verify it."}
        </p>
      </div>
      <label>
        {es ? "Registro" : "Register"}
        <select
          value={kind}
          onChange={(event) => {setSelected(null);setFactsSubject(null);setKind(event.target.value as typeof kind);}}
        >
          <option value="">
            {es
              ? "Todos los registros autorizados"
              : "All authorized registers"}
          </option>
          {Object.entries(registers).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <PngPillButton
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        {es ? "Actualizar cumplimiento" : "Refresh compliance"}
      </PngPillButton>
      {query.isPending && (
        <p>{es ? "Cargando registros…" : "Loading registers…"}</p>
      )}
      {query.isError && (
        <p role="alert">
          {es
            ? "Registros no disponibles. Actualice para comprobar el acceso."
            : "Registers unavailable. Refresh to check access."}
        </p>
      )}
      {!query.isPending && !query.isError && !entries.length && (
        <p>
          {es
            ? "No hay evidencia registrada en esta vista. Esto no demuestra cumplimiento."
            : "No evidence recorded in this view. This does not establish compliance."}
        </p>
      )}
      {selected&&!query.isError&&<FleetEvidenceReview identity={identity} evidenceId={selected.id} revision={selected.revision} onClose={()=>setSelected(null)} onSaved={()=>{setSelected(null);void query.refetch();void cache.invalidateQueries({queryKey:["fleet-detail-compliance",identity]});}}/>}
      {factsSubject&&!query.isError&&<FleetComplianceFactsEditor identity={identity} subject={factsSubject} onClose={()=>setFactsSubject(null)} onSaved={()=>{setFactsSubject(null);void query.refetch();void cache.invalidateQueries({queryKey:["fleet-detail-compliance",identity]});}}/>}
      <div className="grid gap-3 md:grid-cols-2">
        {entries.map((entry) => (
          <article key={entry.id} className="fleet-detail-group space-y-2">
            <h3>
              {registers[entry.subject.kind]} · {String(entry.subject.id)}
            </h3>
            <p>
              <span
                aria-hidden="true"
                style={{
                  color: entry.status === "green" ? "#15803D" : "#DC2626",
                }}
              >
                ●{" "}
              </span>
              {entry.status === "green"
                ? es
                  ? "Evidencia configurada vigente"
                  : "Configured evidence current"
                : es
                  ? "Requiere revisión"
                  : "Needs review"}
            </p>
            <p>{verification[entry.verification]}</p>
            {entry.maskedIdentifier && <p>{entry.maskedIdentifier}</p>}
            <p>
              {entry.requirementId} · {es ? "Versión" : "Revision"}{" "}
              {entry.revision}
            </p>
            <ul>
              {entry.reasons.map((reason) => (
                <li key={reason}>{reasons[reason]}</li>
              ))}
            </ul>
            <p>
              {es ? "Vencimiento" : "Expires"}:{" "}
              {entry.validUntil
                ? date(entry.validUntil)
                : es
                  ? "Sin vencimiento revisado"
                  : "No reviewed expiry"}
            </p>
            <p>
              {es ? "Evaluado" : "Evaluated"}: {date(entry.evaluatedAt)}
            </p>
            {entry.mayReview&&<PngPillButton onClick={()=>{setFactsSubject(null);setSelected({id:entry.id,revision:entry.revision});}}>{es?"Revisar evidencia":"Review evidence"}</PngPillButton>}
            <PngPillButton onClick={()=>{setSelected(null);setFactsSubject(entry.subject);}}>{es?"Hechos de aplicabilidad":"Applicability facts"}</PngPillButton>
          </article>
        ))}
      </div>
      {!query.isError && query.hasNextPage && (
        <PngPillButton
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {es ? "Cargar más evidencia" : "Load more evidence"}
        </PngPillButton>
      )}
    </section>
  );
}
