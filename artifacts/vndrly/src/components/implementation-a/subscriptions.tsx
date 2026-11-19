import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { EmployeeSubscriptionFieldsSchema, subscriptionMonthlyEquivalent, type EmployeeSubscription, type EmployeeSubscriptionFields, type EmployeeSubscriptionsResponse } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { ProfileActionButton } from "@/components/gate-profile-chrome";
import ImagePill from "@/components/image-pill";
import { implementationARequest } from "./client";
import { ImplementationSurface } from "./surface";
import "./subscriptions.css";

type Draft = EmployeeSubscriptionFields & { amount: string; id?: string; version?: number };
const emptyDraft = (): Draft => ({ name: "", employeeKey: "", amount: "", amountCents: 0, currency: "USD", billingInterval: "month", category: "", purpose: "", renewalDate: null, status: "active" });
const inputClass = "worker-subscription-input w-full min-h-11 rounded-lg border border-[var(--brand-primary)] bg-[#303034] px-3 py-2 text-sm text-[#ececec] focus-visible:bg-[#353539]";
const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

export function Subscriptions() {
  const { user } = useAuth(), { i18n } = useTranslation(), cache = useQueryClient();
  const c = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const identity = [user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId].join(":");
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const key = ["implementation-a", "subscriptions", identity];
  const query = useQuery<EmployeeSubscriptionsResponse>({ queryKey: key, queryFn: () => implementationARequest("/subscriptions"), enabled: Boolean(user), retry: false });
  const [draft, setDraft] = useState<Draft | null>(null), [draftIdentity, setDraftIdentity] = useState(identity);
  const [operationId, setOperationId] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [search, setSearch] = useState(""), [employee, setEmployee] = useState(""), [category, setCategory] = useState(""), [status, setStatus] = useState("active");
  const intervalLabels = { week: c("week", "semana"), month: c("month", "mes"), quarter: c("quarter", "trimestre"), year: c("year", "año"), one_time: c("one-time", "único") };
  const statusLabels = { active: c("Active", "Activa"), paused: c("Paused", "Pausada"), cancelled: c("Cancelled", "Cancelada") };
  const all = query.data?.subscriptions ?? [];
  const categories = [...new Set(all.map(row => row.category).filter(Boolean))].sort();
  const filtered = all.filter(row => (!employee || row.employeeKey === employee) && (!category || row.category === category) && (!status || row.status === status) &&
    `${row.name} ${row.employeeName} ${row.category} ${row.purpose}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const totals = filtered.reduce<Record<string, number>>((out, row) => { out[row.currency] = (out[row.currency] ?? 0) + subscriptionMonthlyEquivalent(row); return out; }, {});
  const activeDraft = draftIdentity === identity ? draft : null;
  function edit(row?: EmployeeSubscription) {
    setDraft(row ? { ...row, amount: (row.amountCents / 100).toFixed(2) } : emptyDraft());
    setDraftIdentity(identity); setOperationId(crypto.randomUUID()); setError(""); setNotice("");
  }
  async function save() {
    if (!activeDraft || busy) return;
    if (!/^\d+(?:\.\d{1,2})?$/.test(activeDraft.amount)) { setError(c("Enter the subscription cost using at most two decimal places.", "Indique el costo con un máximo de dos decimales.")); return; }
    const [whole, fraction = ""] = activeDraft.amount.split(".");
    const fields = EmployeeSubscriptionFieldsSchema.safeParse({ name: activeDraft.name, employeeKey: activeDraft.employeeKey,
      amountCents: Number(whole) * 100 + Number(fraction.padEnd(2, "0")), currency: activeDraft.currency, billingInterval: activeDraft.billingInterval,
      category: activeDraft.category, purpose: activeDraft.purpose, renewalDate: activeDraft.renewalDate, status: activeDraft.status });
    if (!fields.success) { setError(c("Check the name, employee, cost, and billing period.", "Revise el nombre, empleado, costo y período de facturación.")); return; }
    const originalIdentity = identity; setBusy(true); setError("");
    try {
      await implementationARequest(activeDraft.id ? `/subscriptions/${activeDraft.id}` : "/subscriptions", {
        method: activeDraft.id ? "PUT" : "POST", body: JSON.stringify({ ...fields.data, ...(activeDraft.id ? { expectedVersion: activeDraft.version } : { operationId }) }),
      });
      if (currentIdentity.current !== originalIdentity) return;
      setDraft(null); setNotice(c("Subscription saved.", "Suscripción guardada."));
      await cache.invalidateQueries({ queryKey: key });
      await cache.invalidateQueries({ queryKey: ["profile-subscriptions"] });
    } catch (failure) { if (currentIdentity.current === originalIdentity) setError(failure instanceof Error ? failure.message : c("Could not save the subscription.", "No se pudo guardar la suscripción.")); }
    finally { setBusy(false); }
  }
  const field = (label: string, control: React.ReactNode) => <label className="grid min-w-0 gap-1 text-sm">{label}{control}</label>;
  function change<K extends keyof Draft>(property: K, value: Draft[K]) { setDraft(previous => previous ? { ...previous, [property]: value } : previous); }
  return <ImplementationSurface module="subscriptions" title={c("Subscriptions", "Suscripciones")} description={c("Track subscriptions, employee assignments, and costs.", "Controle suscripciones, empleados asignados y costos.")}>
    {query.isPending ? <p role="status">{c("Loading subscriptions…", "Cargando suscripciones…")}</p>
      : query.isError ? <p role="alert">{query.error.message} <button type="button" className="underline" onClick={() => void query.refetch()}>{c("Retry", "Reintentar")}</button></p>
      : <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">{query.data?.companyName}</p>{query.data?.canManage && <ProfileActionButton onClick={() => edit()} disabled={busy}>{c("Add subscription", "Añadir suscripción")}</ProfileActionButton>}</div>
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        {activeDraft && <form className="grid gap-3 border-y border-white/15 py-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void save(); }}>
          {field(c("Subscription name", "Nombre de la suscripción"), <input className={inputClass} required maxLength={160} value={activeDraft.name} onChange={event => change("name", event.target.value)} />)}
          {field(c("Assigned employee", "Empleado asignado"), <select className={inputClass} required value={activeDraft.employeeKey} onChange={event => change("employeeKey", event.target.value)}><option value="">{c("Choose employee", "Elija empleado")}</option>{query.data?.employees.map(person => <option key={person.key} value={person.key}>{person.name}{person.email ? ` · ${person.email}` : ""}</option>)}</select>)}
          {field(c("Cost per billing period", "Costo por período"), <input className={inputClass} inputMode="decimal" required value={activeDraft.amount} onChange={event => change("amount", event.target.value)} />)}
          {field(c("Billing period", "Período de facturación"), <select className={inputClass} value={activeDraft.billingInterval} onChange={event => change("billingInterval", event.target.value as Draft["billingInterval"])}>{Object.entries(intervalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>)}
          {field(c("Currency", "Moneda"), <input className={inputClass} maxLength={3} pattern="[A-Z]{3}" required value={activeDraft.currency} onChange={event => change("currency", event.target.value.toUpperCase())} />)}
          {field(c("Category", "Categoría"), <input className={inputClass} maxLength={80} list="subscription-categories" value={activeDraft.category} onChange={event => change("category", event.target.value)} />)}
          {field(c("Next renewal (optional)", "Próxima renovación (opcional)"), <input className={inputClass} type="date" value={activeDraft.renewalDate ?? ""} onChange={event => change("renewalDate", event.target.value || null)} />)}
          {field(c("Status", "Estado"), <select className={inputClass} value={activeDraft.status} onChange={event => change("status", event.target.value as Draft["status"])}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>)}
          <div className="sm:col-span-2">{field(c("Work purpose / notes", "Uso laboral / notas"), <textarea className={inputClass} rows={2} maxLength={2000} value={activeDraft.purpose} onChange={event => change("purpose", event.target.value)} />)}</div>
          <div className="flex flex-wrap gap-2 sm:col-span-2"><ProfileActionButton type="submit" disabled={busy}>{busy ? c("Saving…", "Guardando…") : c("Save subscription", "Guardar suscripción")}</ProfileActionButton><ProfileActionButton onClick={() => { setDraft(null); setError(""); }} disabled={busy}>{c("Cancel", "Cancelar")}</ProfileActionButton></div>
          {!query.data?.employees.length && <p className="text-sm sm:col-span-2">{c("Add employees to your company before assigning a subscription.", "Añada empleados a su empresa antes de asignar una suscripción.")}</p>}
        </form>}
        <datalist id="subscription-categories">{categories.map(value => <option key={value} value={value} />)}</datalist>
        <div className="space-y-2">
          <input className={inputClass} aria-label={c("Search subscriptions", "Buscar suscripciones")} placeholder={c("Search subscriptions", "Buscar suscripciones")} value={search} onChange={event => setSearch(event.target.value)} />
          <div className="grid gap-2 sm:grid-cols-3">
          <select className={inputClass} aria-label={c("Filter by employee", "Filtrar por empleado")} value={employee} onChange={event => setEmployee(event.target.value)}><option value="">{c("All employees", "Todos los empleados")}</option>{[...new Map(all.map(row => [row.employeeKey, row.employeeName])).entries()].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select className={inputClass} aria-label={c("Filter by category", "Filtrar por categoría")} value={category} onChange={event => setCategory(event.target.value)}><option value="">{c("All categories", "Todas las categorías")}</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <select className={inputClass} aria-label={c("Filter by status", "Filtrar por estado")} value={status} onChange={event => setStatus(event.target.value)}><option value="">{c("All statuses", "Todos los estados")}</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label={c("Filtered cost totals", "Totales de costos filtrados")}><span>{filtered.length} {c("subscriptions", "suscripciones")}</span>{Object.entries(totals).map(([currency, cents]) => <span key={currency}>{c("Monthly equivalent", "Equivalente mensual")}: <strong>{money(cents, currency)}</strong> {currency}</span>)}</div>
        {filtered.length ? <ul className="divide-y divide-white/15">{filtered.map(row => <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
          <div className="min-w-0 flex-1 basis-48"><p className="font-semibold break-words">{row.name}</p><p>{row.employeeName}</p>{row.category && <p className="text-muted-foreground">{row.category}</p>}{row.purpose && <p className="whitespace-pre-wrap break-words text-muted-foreground">{row.purpose}</p>}{row.renewalDate && <p className="text-muted-foreground">{c("Next renewal", "Próxima renovación")}: {row.renewalDate}</p>}</div>
          <div className="flex flex-wrap items-center gap-3"><span>{money(row.amountCents, row.currency)} {row.currency} / {intervalLabels[row.billingInterval]}</span><ImagePill color={row.status === "active" ? "green" : row.status === "paused" ? "amber" : "grey"}>{statusLabels[row.status]}</ImagePill>{query.data?.canManage && <ProfileActionButton onClick={() => edit(row)} disabled={busy} aria-label={`${c("Edit", "Editar")} ${row.name}`}>{c("Edit", "Editar")}</ProfileActionButton>}</div>
        </li>)}</ul> : <p className="py-4 text-sm text-muted-foreground">{all.length ? c("No subscriptions match these filters.", "No hay suscripciones con estos filtros.") : c("No subscriptions yet.", "Todavía no hay suscripciones.")}</p>}
      </div>}
  </ImplementationSurface>;
}
