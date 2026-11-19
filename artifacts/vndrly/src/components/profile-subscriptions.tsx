import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CreditCard } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ProfileRow } from "@/components/gate-profile-chrome";
import { implementationARequest } from "@/components/implementation-a/client";
import type { EmployeeSubscription } from "@workspace/api-zod";

export default function ProfileSubscriptions() {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const [open, setOpen] = useState(false);
  const subscriptions = useQuery<{ subscriptions: EmployeeSubscription[] }>({
    queryKey: ["profile-subscriptions", user?.userId, user?.activeMembershipId],
    queryFn: () => implementationARequest("/subscriptions/mine"),
    enabled: open && Boolean(user),
  });
  const state = (value: string) => value === "active" ? c("Active", "Activa")
    : value === "paused" ? c("Paused", "Pausada")
    : value === "cancelled" ? c("Cancelled", "Cancelada") : value;
  const intervals = { week: c("week", "semana"), month: c("month", "mes"), quarter: c("quarter", "trimestre"), year: c("year", "año"), one_time: c("one-time", "único") };
  return <ProfileRow label={c("My subscriptions", "Mis suscripciones")} icon={CreditCard} open={open} onClick={() => setOpen(!open)} unframed>
    {subscriptions.isPending ? <p role="status">{c("Loading subscriptions…", "Cargando suscripciones…")}</p>
      : subscriptions.isError ? <p role="alert">{c("Could not load your subscriptions.", "No se pudieron cargar sus suscripciones.")} <button type="button" className="underline" onClick={() => void subscriptions.refetch()}>{c("Retry", "Reintentar")}</button></p>
      : subscriptions.data?.subscriptions.length ? <ul className="divide-y divide-white/10">{subscriptions.data.subscriptions.map(item => <li key={item.id} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-1 text-sm leading-[18px]">
        <p className="truncate font-medium" title={item.name}>{item.name}</p>
        <p className="whitespace-nowrap text-right text-xs">{new Intl.NumberFormat(undefined, { style: "currency", currency: item.currency }).format(item.amountCents / 100)} / {intervals[item.billingInterval]}</p>
        <p className="truncate text-xs text-muted-foreground" title={[item.purpose, item.companyName].filter(Boolean).join(" · ")}>{[item.purpose, item.companyName].filter(Boolean).join(" · ")}</p>
        <span className="text-right text-xs text-muted-foreground">{state(item.status)}</span>
      </li>)}</ul>
      : <p>{c("No subscriptions are assigned to you.", "No tiene suscripciones asignadas.")}</p>}
  </ProfileRow>;
}
