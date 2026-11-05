import { useState } from "react";

type Charge = { day: string; chargeCents: number };
type Ticket = {
  id: number;
  siteName: string;
  gateName: string | null;
  invoiceCents: number;
  payrollCents: number | null;
  revenueByDay?: Charge[];
};
const demoExpenses: Record<number, { shifts?: number; items: [string, string, number][] }> = {
  1870000255: { shifts: 12, items: [["Purchase", "Visitor badges and printer rolls", 18500], ["Rental", "Portable light tower", 72000]] },
  1870000256: { shifts: 10, items: [["Rental", "Mobile gate booth", 65000], ["Owned equipment", "Radio and tablet usage", 14500]] },
  1870000257: { shifts: 6, items: [["Purchase", "Traffic cones and reflective vests", 24600]] },
  1870000258: { shifts: 0, items: [] },
  1870000259: { items: [["Rental", "Portable light tower", 96000], ["Owned equipment", "Gate radio usage", 21000]] },
  1870000260: { items: [["Rental", "Climate-controlled gate booth", 185000], ["Purchase", "Logbooks and printer supplies", 17400], ["Owned equipment", "Tablet and radio usage", 36000]] },
};

export function gateGoDemoCosts(ticket: Ticket) {
  const fixture = demoExpenses[ticket.id];
  if (!fixture) return null;
  const wages = ticket.payrollCents ?? (fixture.shifts ?? 0) * 15000;
  const employerTaxes = Math.round(wages * 0.1);
  const equipment = fixture.items.reduce((total, [, , cents]) => total + cents, 0);
  const profit = ticket.invoiceCents - wages - employerTaxes - equipment;
  return { ...fixture, wages, employerTaxes, equipment, profit, reserve: Math.round(Math.max(0, profit) * 0.21) };
}

const views = ["Profit waterfall", "By gate", "By week"] as const;
const periods = ["This Quarter", "Year to Date"] as const;
const colors = { revenue: "#86efac", cost: "#fca5a5", equipment: "#fbbf24", profit: "#7dd3fc" };

export function GateTicketProfitability({ tickets, money }: { tickets: Ticket[]; money: (cents: number) => string }) {
  const [view, setView] = useState<(typeof views)[number]>("Profit waterfall");
  const [period, setPeriod] = useState<(typeof periods)[number]>("This Quarter");
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const month = period === "This Quarter" ? Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1 : 1;
  const start = `${today.slice(0, 4)}-${String(month).padStart(2, "0")}-01`;
  const rows = tickets.flatMap(ticket => {
    const costs = gateGoDemoCosts(ticket);
    const days = (ticket.revenueByDay ?? []).filter(charge => charge.day >= start && charge.day <= today);
    if (!costs || !days.length || !ticket.invoiceCents) return [];
    const revenue = days.reduce((sum, charge) => sum + charge.chargeCents, 0);
    const share = revenue / ticket.invoiceCents;
    return [{ ticket, days, revenue, wages: Math.round(costs.wages * share),
      employerTaxes: Math.round(costs.employerTaxes * share), equipment: Math.round(costs.equipment * share) }];
  });
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const wages = rows.reduce((sum, row) => sum + row.wages, 0);
  const employerTaxes = rows.reduce((sum, row) => sum + row.employerTaxes, 0);
  const equipment = rows.reduce((sum, row) => sum + row.equipment, 0);
  const profit = revenue - wages - employerTaxes - equipment;
  const reserve = Math.round(Math.max(0, profit) * 0.21);
  const waterfall = [
    { label: "Accrued revenue", from: 0, to: revenue, amount: revenue, color: colors.revenue },
    { label: "Wages", from: revenue, to: revenue - wages, amount: -wages, color: colors.cost },
    { label: "Employer payroll taxes", from: revenue - wages, to: revenue - wages - employerTaxes, amount: -employerTaxes, color: colors.cost },
    { label: "Equipment and supplies", from: revenue - wages - employerTaxes, to: profit, amount: -equipment, color: colors.equipment },
    { label: "Federal tax reserve", from: profit, to: profit - reserve, amount: -reserve, color: colors.cost },
    { label: "Profit after reserve", from: 0, to: profit - reserve, amount: profit - reserve, color: colors.profit },
  ];
  const groups = new Map<string, { revenue: number; labor: number; equipment: number }>();
  const weeks = new Map<string, { revenue: number; cost: number }>();
  for (const row of rows) {
    const name = [row.ticket.siteName, row.ticket.gateName].filter(Boolean).join(" · ");
    const group = groups.get(name) ?? { revenue: 0, labor: 0, equipment: 0 };
    group.revenue += row.revenue;
    group.labor += row.wages + row.employerTaxes;
    group.equipment += row.equipment;
    groups.set(name, group);
    for (const charge of row.days) {
      const monday = new Date(`${charge.day}T12:00:00Z`);
      monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
      const key = monday.toISOString().slice(0, 10);
      const week = weeks.get(key) ?? { revenue: 0, cost: 0 };
      week.revenue += charge.chargeCents;
      week.cost += (row.wages + row.employerTaxes + row.equipment) * charge.chargeCents / row.revenue;
      weeks.set(key, week);
    }
  }
  const weekly = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b));
  const weeklyMax = Math.max(1, ...weekly.flatMap(([, values]) => [values.revenue, values.cost]));
  const scale = (amount: number) => `${100 * Math.max(0, amount) / Math.max(1, revenue)}%`;
  return (
    <details className="gate-panel-disclosure gate-profitability-card">
      <summary><span className="mr-auto">Estimated Profitability</span></summary>
      <section className="space-y-3 pb-3" aria-label="Profitability charts">
        <div className="flex flex-wrap gap-2" aria-label="Reporting period">
          {periods.map(label => <button key={label} type="button" aria-pressed={period === label} className="min-h-7 rounded border border-[#55555a] px-2 aria-pressed:border-[var(--brand-primary)]" onClick={() => setPeriod(label)}>{label}</button>)}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Chart view">
          {views.map(label => <button key={label} type="button" aria-pressed={view === label} className="min-h-7 rounded border border-[#55555a] px-2 aria-pressed:border-[var(--brand-primary)]" onClick={() => setView(label)}>{label}</button>)}
        </div>
        <p className="text-xs text-[#b3b3b3]">Demo expenses and tax assumptions. Employer payroll tax uses 10% and the federal reserve uses 21% of positive operating profit.</p>
        {!rows.length ? <p>No demo ticket activity for this period.</p> : view === "Profit waterfall" ? (
          <ul className="space-y-2" aria-label="Profit waterfall">
            {waterfall.map(step => <li key={step.label}>
              <div className="flex justify-between gap-2"><span>{step.label}</span><span>{money(step.amount)}</span></div>
              <div className="relative h-2 rounded bg-[#414145]" aria-hidden="true"><span className="absolute h-full rounded" style={{ left: scale(Math.min(step.from, step.to)), width: scale(Math.abs(step.to - step.from)), background: step.color }} /></div>
            </li>)}
          </ul>
        ) : view === "By gate" ? (
          <ul className="space-y-3" aria-label="Profitability by gate">
            {[...groups.entries()].map(([name, group]) => {
              const net = group.revenue - group.labor - group.equipment;
              return <li key={name}>
                <strong>{name}</strong>
                <div className="flex h-2 overflow-hidden rounded bg-[#414145]" aria-hidden="true">
                  <span style={{ width: scale(group.labor), background: colors.cost }} />
                  <span style={{ width: scale(group.equipment), background: colors.equipment }} />
                  <span style={{ width: scale(net), background: colors.profit }} />
                </div>
                <p className="text-xs">Labor {money(group.labor)} · Equipment {money(group.equipment)} · Profit {money(net)}</p>
              </li>;
            })}
          </ul>
        ) : (
          <div className="space-y-2" aria-label="Weekly revenue and cost">
            <svg viewBox="0 0 300 105" className="w-full" role="img" aria-label="Weekly revenue in green and operating cost in red">
              <path d="M10 10V95H290" stroke="#777" fill="none" />
              {(["revenue", "cost"] as const).map(key => <polyline key={key} fill="none" stroke={colors[key]} strokeWidth="2"
                points={weekly.map(([, week], index) => `${10 + 280 * index / Math.max(1, weekly.length - 1)},${95 - 80 * week[key] / weeklyMax}`).join(" ")} />)}
            </svg>
            {weekly.map(([week, values]) => <p key={week} className="text-xs">{week} · Revenue {money(values.revenue)} · Cost {money(Math.round(values.cost))}</p>)}
          </div>
        )}
      </section>
    </details>
  );
}
