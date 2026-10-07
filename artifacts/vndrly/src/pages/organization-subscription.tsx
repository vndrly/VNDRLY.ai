import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod/v4";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { PngPillButton } from "@/components/png-pill-rollover";
const statusSchema = z.object({
  configured: z.boolean(),
  plans: z.array(z.object({ key: z.string(), label: z.string() })),
  customerLinked: z.boolean(),
  subscription: z
    .object({
      status: z.string(),
      planKey: z.string().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      observedAt: z.string(),
    })
    .nullable(),
  accessEnforcementImplemented: z.literal(false),
});
const attemptSchema = z
  .object({
    identity: z.string(),
    kind: z.enum(["checkout", "portal"]),
    body: z
      .object({ operationId: z.uuid(), planKey: z.string().optional() })
      .strict(),
  })
  .strict();
type Attempt = z.infer<typeof attemptSchema>;
const key = "vndrly-subscription-reviewed-attempt";
const en = {
  title: "Organization subscription",
  denied: "The current company administrator must open this page.",
  none: "No saved subscription is recorded.",
  notConfigured:
    "Subscription Checkout is not configured. No prices or purchase are available.",
  note: "This subscription is separate from field-ticket invoices and payments. Returning from Stripe does not verify payment. Current saved Stripe records appear below; access enforcement is not implemented.",
  refresh: "Refresh saved status",
  checkout: "Review Stripe Checkout",
  portal: "Review Stripe billing portal",
  confirm: "Open reviewed hosted flow",
  retry: "Retry same hosted request",
  open: "Continue to Stripe",
  unknown:
    "Result unverified. Retain this exact request and retry it; do not start another purchase.",
  unavailable: "Current subscription status is unavailable.",
  review:
    "Review this company and configured plan before opening Stripe. Stripe shows the actual price and purchase terms.",
  saved: "Hosted link saved; payment is not verified.",
  pending:
    "An earlier reviewed request is retained. Retry it before preparing another flow.",
  clear: "Dismiss refused request and refresh",
  refused:
    "The request was refused. Refresh and review before another operation.",
};
const es: Record<keyof typeof en, string> = {
  title: "Suscripción de la organización",
  denied: "El administrador de la empresa actual debe abrir esta página.",
  none: "No hay una suscripción guardada.",
  notConfigured:
    "Checkout no está configurado. No hay precios ni compra disponibles.",
  note: "Esta suscripción es independiente de facturas y pagos de campo. Volver de Stripe no verifica el pago. Los registros guardados aparecen abajo; el control de acceso por suscripción no está implementado.",
  refresh: "Actualizar estado guardado",
  checkout: "Revisar Checkout de Stripe",
  portal: "Revisar portal de facturación",
  confirm: "Abrir flujo revisado",
  retry: "Reintentar misma solicitud",
  open: "Continuar a Stripe",
  unknown:
    "Resultado sin verificar. Conserve y reintente esta solicitud exacta; no inicie otra compra.",
  unavailable: "Estado de suscripción no disponible.",
  review:
    "Revise empresa y plan configurado. Stripe muestra precio y condiciones reales.",
  saved: "Enlace guardado; pago sin verificar.",
  pending:
    "Hay una solicitud revisada pendiente. Reintente antes de preparar otra.",
  clear: "Descartar solicitud rechazada y actualizar",
  refused: "Solicitud rechazada. Actualice y revise antes de otra operación.",
};
class BillingRequestError extends Error {
  constructor(
    public status: number,
    public code?: string,
  ) {
    super("Billing request unavailable");
  }
}
async function api(path: string, signal: AbortSignal, body?: unknown) {
  const r = await fetch("/api/organization-subscription" + path, {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    signal,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) {
    const error = await r.json().catch(() => null);
    throw new BillingRequestError(r.status, error?.code);
  }
  return r.json();
}
export default function OrganizationSubscription() {
  const { user } = useAuth(),
    membership = user?.availableMemberships.find(
      (m) => m.id === user.activeMembershipId,
    ),
    allowed =
      !!user &&
      !user.managedSubcontractor &&
      ["vendor", "partner"].includes(user.role) &&
      membership?.role === "admin" &&
      membership.orgType === user.role &&
      membership.orgId === (user.vendorId ?? user.partnerId);
  const identity = JSON.stringify([
    user?.userId,
    user?.role,
    user?.activeMembershipId,
    user?.vendorId,
    user?.partnerId,
  ]);
  const { i18n } = useTranslation(),
    c = i18n.language.startsWith("es") ? es : en;
  if (!allowed)
    return (
      <main className="p-6">
        <h1>{c.title}</h1>
        <p>{c.denied}</p>
      </main>
    );
  return (
    <BillingPanel
      key={identity}
      identity={identity}
      company={membership.orgName}
      c={c}
    />
  );
}
function BillingPanel({
  identity,
  company,
  c,
}: {
  identity: string;
  company: string;
  c: typeof en;
}) {
  const storageKey = key + ":" + identity;
  const [attempt, setAttempt] = useState<Attempt | null>(() => {
      try {
        const p = attemptSchema.safeParse(
          JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
        );
        return p.success && p.data.identity === identity ? p.data : null;
      } catch {
        return null;
      }
    }),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [refused, setRefused] = useState(false),
    [url, setUrl] = useState<string | null>(null),
    [message, setMessage] = useState("");
  const alive = useRef(true),
    controllers = useRef(new Set<AbortController>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const ctrl of controllers.current) ctrl.abort();
    };
  }, []);
  const status = useQuery({
    queryKey: ["organization-subscription", identity],
    queryFn: async ({ signal }) => statusSchema.parse(await api("", signal)),
    retry: false,
  });
  function prepare(kind: Attempt["kind"], planKey?: string) {
    const next: Attempt = {
      identity,
      kind,
      body: {
        operationId: crypto.randomUUID(),
        ...(planKey ? { planKey } : {}),
      },
    };
    sessionStorage.setItem(storageKey, JSON.stringify(next));
    setAttempt(next);
    setUrl(null);
    setMessage("");
    setRefused(false);
  }
  async function execute() {
    if (!attempt) return;
    const sent = attempt,
      ctrl = new AbortController();
    controllers.current.add(ctrl);
    setBusy(true);
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const result = await api("/" + sent.kind, ctrl.signal, sent.body);
      if (!alive.current) return;
      const value = z
        .object({
          url: z.string().url().nullable(),
          ...(sent.kind === "checkout"
            ? { sessionId: z.string(), paymentVerified: z.literal(false) }
            : {}),
        })
        .parse(result);
      if (value.url !== null) {
        const u = new URL(value.url);
        if (
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          !["checkout.stripe.com", "billing.stripe.com"].includes(u.hostname)
        )
          throw Error("Unexpected hosted URL");
      }
      setUrl(value.url);
      setUnknown(false);
      setMessage(c.saved);
      sessionStorage.removeItem(storageKey);
      setAttempt(null);
      await status.refetch();
    } catch (e) {
      if (!alive.current) return;
      const definitive =
        e instanceof BillingRequestError &&
        [
          "billing.invalid_arguments",
          "billing.plan_unavailable",
          "billing.price_unavailable",
          "billing.use_portal",
          "billing.current_origin_required",
        ].includes(e.code ?? "");
      setRefused(definitive);
      setUnknown(!definitive);
      setMessage(definitive ? c.refused : c.unknown);
    } finally {
      clearTimeout(timer);
      controllers.current.delete(ctrl);
      if (alive.current) setBusy(false);
    }
  }
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-6">
      <h1>{c.title}</h1>
      <p>{company}</p>
      <p>{c.note}</p>
      <PngPillButton disabled={busy} onClick={() => void status.refetch()}>
        {c.refresh}
      </PngPillButton>
      {status.isError ? (
        <p>{c.unavailable}</p>
      ) : status.data ? (
        <>
          <p>
            {status.data.subscription
              ? `${status.data.subscription.status} · ${status.data.subscription.observedAt}`
              : c.none}
          </p>
          {!status.data.configured && <p>{c.notConfigured}</p>}
          {status.data.configured && !attempt && !url && (
            <div className="grid gap-2">
              {status.data.plans.map((p) => (
                <PngPillButton
                  key={p.key}
                  disabled={busy}
                  onClick={() => prepare("checkout", p.key)}
                >
                  {c.checkout}: {p.label}
                </PngPillButton>
              ))}
              {status.data.customerLinked && (
                <PngPillButton
                  disabled={busy}
                  onClick={() => prepare("portal")}
                >
                  {c.portal}
                </PngPillButton>
              )}
            </div>
          )}
        </>
      ) : null}
      {attempt && (
        <section>
          <p>{c.review}</p>
          <p>
            {company} ·{" "}
            {status.data?.plans.find((p) => p.key === attempt.body.planKey)
              ?.label ?? attempt.kind}
          </p>
          {refused ? (
            <PngPillButton
              disabled={busy}
              onClick={async () => {
                const refreshed = await status.refetch();
                if (alive.current && !refreshed.isError) {
                  sessionStorage.removeItem(storageKey);
                  setAttempt(null);
                  setRefused(false);
                  setMessage("");
                }
              }}
            >
              {c.clear}
            </PngPillButton>
          ) : (
            <PngPillButton disabled={busy} onClick={() => void execute()}>
              {unknown ? c.retry : c.confirm}
            </PngPillButton>
          )}
        </section>
      )}
      {url && (
        <a href={url} rel="noreferrer">
          {c.open}
        </a>
      )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}
