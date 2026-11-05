import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import type { GateBillingRequest } from "@workspace/api-zod";

const reserves = [
  { risk: "low", label: "Maximum reserve · Low risk", rate: 25 },
  { risk: "moderate", label: "Moderate reserve · Moderate risk", rate: 21 },
  { risk: "high", label: "Least reserve · High risk", rate: 17 },
] as const;

export type TicketEstimate = {
  risk: (typeof reserves)[number]["risk"];
  equipment: { kind: "purchase" | "rental"; description: string; cents: number }[];
};

export function calculateTicketEstimate(revenue: number, payroll: number, estimate: TicketEstimate) {
  const purchases = estimate.equipment.reduce((sum, item) => sum + (item.kind === "purchase" ? item.cents : 0), 0);
  const rentals = estimate.equipment.reduce((sum, item) => sum + (item.kind === "rental" ? item.cents : 0), 0);
  const operating = revenue - payroll - rentals - purchases;
  const taxBase = Math.max(0, operating + purchases);
  const rate = reserves.find(option => option.risk === estimate.risk)!.rate;
  const reserve = Math.round(taxBase * rate / 100);
  return { purchases, rentals, operating, taxBase, reserve, afterTax: operating - reserve };
}

export function GateTicketEstimate({ ticket, request, money, close, saved }: {
  ticket: { id: number; siteName: string; gateName: string | null; serviceName: string | null; invoiceCents: number; payrollCents: number | null; estimate?: TicketEstimate | null };
  request: GateBillingRequest;
  money: (cents: number) => string;
  close: () => void;
  saved: (estimate: TicketEstimate) => void;
}) {
  const [position, setPosition] = useState(() => reserves.findIndex(option => option.risk === (ticket.estimate?.risk ?? "moderate")));
  const [items, setItems] = useState(() => (ticket.estimate?.equipment ?? []).map(item => ({ ...item, amount: (item.cents / 100).toFixed(2) })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selection = reserves[position]!;
  const estimate = { risk: selection.risk, equipment: items.map(({ kind, description, amount }) => ({
    kind, description: description.trim(), cents: Math.round(Number(amount) * 100),
  })) };
  const valid = estimate.equipment.every(item => item.description && item.cents > 0 && item.cents <= 100_000_000);
  const figures = valid && ticket.payrollCents != null ? calculateTicketEstimate(ticket.invoiceCents, ticket.payrollCents, estimate) : null;
  const field = "min-w-0 rounded-lg border border-[var(--brand-primary)] bg-[#2b2b2f] px-3 py-2 text-inherit";
  const action = "min-h-11 rounded-lg border border-[var(--brand-primary)] px-3 disabled:opacity-50";
  const update = (index: number, patch: Partial<(typeof items)[number]>) =>
    setItems(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Ticket · {formatTicketTrackingNumber(ticket.id)}</DialogTitle>
          <DialogDescription>{[ticket.serviceName, ticket.siteName, ticket.gateName].filter(Boolean).join(" · ")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={async event => {
          event.preventDefault();
          if (busy || !valid) return;
          setBusy(true);
          setError("");
          try {
            await request(`/gate-billing/tickets/${ticket.id}/estimate`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(estimate),
            });
            saved(estimate);
          } catch {
            setError("Could not save the estimate. Check that the ticket is still open and try again.");
          } finally {
            setBusy(false);
          }
        }}>
          <fieldset disabled={busy} className="space-y-2">
            <legend className="font-semibold">Equipment Purchases and Rentals</legend>
            {items.map((item, index) => (
              <div key={index} className="grid gap-2 rounded-lg border border-[#55555a] p-2">
                <select aria-label={`Equipment type ${index + 1}`} className={field} value={item.kind}
                  onChange={event => update(index, { kind: event.target.value === "purchase" ? "purchase" : "rental" })}>
                  <option value="purchase">Purchase</option>
                  <option value="rental">Rental</option>
                </select>
                <input aria-label={`Equipment description ${index + 1}`} placeholder="Description" className={field}
                  required maxLength={200} value={item.description} onChange={event => update(index, { description: event.target.value })} />
                <input aria-label={`Equipment cost ${index + 1} in dollars`} placeholder="Cost ($)" className={field}
                  type="number" min="0.01" max="1000000" step="0.01" required value={item.amount}
                  onChange={event => update(index, { amount: event.target.value })} />
                <button type="button" className="justify-self-start" onClick={() => setItems(current => current.filter((_, i) => i !== index))}>Remove</button>
              </div>
            ))}
            <button type="button" className={action} disabled={items.length >= 100}
              onClick={() => setItems(current => [...current, { kind: "purchase", description: "", cents: 0, amount: "" }])}>Add equipment cost</button>
          </fieldset>
          <div className="space-y-2">
            <label htmlFor="gate-ticket-tax-reserve" className="font-semibold">Tax Reserve</label>
            <input id="gate-ticket-tax-reserve" type="range" min={0} max={2} step={1} value={position}
              className="w-full accent-[var(--brand-primary)]" aria-valuetext={selection.label} disabled={busy}
              onChange={event => setPosition(Number(event.target.value))} />
            <p>{selection.label} ({selection.rate}%)</p>
            <p className="text-xs text-[#b3b3b3]">Planning rates. Equipment purchases reduce ticket cash profit and are excluded from the assumed tax deductions.</p>
          </div>
          {figures ? (
            <dl className="grid grid-cols-[1fr_auto] gap-1" aria-live="polite">
              <dt>Invoice amount</dt><dd>{money(ticket.invoiceCents)}</dd>
              <dt>Estimated operating profit</dt><dd>{money(figures.operating)}</dd>
              <dt>Estimated taxable profit</dt><dd>{money(figures.taxBase)}</dd>
              <dt>Estimated tax reserve</dt><dd>{money(figures.reserve)}</dd>
              <dt>Estimated after-tax profit</dt><dd>{money(figures.afterTax)}</dd>
              {ticket.invoiceCents > 0 && <><dt>Estimated after-tax margin</dt><dd>{(100 * figures.afterTax / ticket.invoiceCents).toFixed(1)}%</dd></>}
            </dl>
          ) : <p>{ticket.payrollCents == null ? "Payroll is unavailable for this ticket." : "Complete the equipment costs to see the estimate."}</p>}
          {error && <p role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={action} disabled={busy} onClick={close}>Cancel</button>
            <button type="submit" className={action} disabled={busy || !valid}>{busy ? "Saving…" : "Save estimate"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
