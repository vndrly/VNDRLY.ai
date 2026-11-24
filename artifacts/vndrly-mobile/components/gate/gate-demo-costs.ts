export type GateDemoTicket = { id: number; siteName: string; gateName: string | null; invoiceCents: number; payrollCents: number | null; revenueByDay?: { day: string; chargeCents: number }[] };

const expenses: Record<number, { shifts?: number; items: [string, string, number][] }> = {
  1870000255: { shifts: 12, items: [["Purchase", "Visitor badges and printer rolls", 18500], ["Rental", "Portable light tower", 72000]] },
  1870000256: { shifts: 10, items: [["Rental", "Mobile gate booth", 65000], ["Owned equipment", "Radio and tablet usage", 14500]] },
  1870000257: { shifts: 6, items: [["Purchase", "Traffic cones and reflective vests", 24600]] },
  1870000258: { shifts: 0, items: [] },
  1870000259: { items: [["Rental", "Portable light tower", 96000], ["Owned equipment", "Gate radio usage", 21000]] },
  1870000260: { items: [["Rental", "Climate-controlled gate booth", 185000], ["Purchase", "Logbooks and printer supplies", 17400], ["Owned equipment", "Tablet and radio usage", 36000]] },
};

export function gateGoDemoCosts(ticket: GateDemoTicket) {
  const fixture = expenses[ticket.id];
  if (!fixture) return null;
  const wages = ticket.payrollCents ?? (fixture.shifts ?? 0) * 15000;
  const employerTaxes = Math.round(wages * 0.1);
  const equipment = fixture.items.reduce((total, [, , cents]) => total + cents, 0);
  const profit = ticket.invoiceCents - wages - employerTaxes - equipment;
  return { ...fixture, wages, employerTaxes, equipment, profit, reserve: Math.round(Math.max(0, profit) * 0.21) };
}
