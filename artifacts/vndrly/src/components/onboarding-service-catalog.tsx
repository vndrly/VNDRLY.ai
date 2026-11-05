import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import OnboardingPillButton from "@/components/onboarding-pill-button";
import { onboardingApi } from "@/lib/onboarding-api";

type Catalog = Awaited<ReturnType<typeof onboardingApi.getWorkTypes>>;
type Row = Catalog["rows"][number];
const normalized = (value: string) => value.trim().toLowerCase();
const nameKey = (row: Row) => JSON.stringify([normalized(row.category), normalized(row.name)]);

function groupServices({ rows, aliases }: Catalog) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const mappedByName = new Map<string, Map<number, Row>>();
  for (const row of rows) {
    if (row.canonicalId === null) continue;
    const key = nameKey(row);
    const matches = mappedByName.get(key) ?? new Map<number, Row>();
    matches.set(row.canonicalId, row);
    mappedByName.set(key, matches);
  }

  const groups = new Map<string, { key: string; name: string; category: string; rows: Row[]; terms: string[] }>();
  for (const row of rows) {
    const source = byId.get(row.sourceWorkTypeId ?? row.id) ?? row;
    const matches = mappedByName.get(nameKey(source));
    const match = row.canonicalId !== null ? row : matches?.size === 1 ? matches.values().next().value : undefined;
    const key = match ? `canonical:${match.canonicalId}` : nameKey(source);
    const group: { key: string; name: string; category: string; rows: Row[]; terms: string[] } = groups.get(key) ?? {
      key, name: match?.canonicalName ?? source.name, category: match?.canonicalCategory ?? source.category,
      rows: [], terms: match ? aliases.filter(alias => alias.canonicalId === match.canonicalId).map(alias => alias.alias) : [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const units = [["per_hour", "Per hour"], ["per_day", "Per day"], ["per_job", "Per job"], ["lump_sum", "Lump sum"]];

function RateEditor({ rows, onSaved, close }: { rows: Row[]; onSaved: () => void; close: () => void }) {
  const master = rows.find(row => row.partnerId === null);
  const single = rows.length === 1 ? rows[0] : undefined;
  const [amount, setAmount] = useState((master ?? single)?.unitPrice ?? "");
  const [unit, setUnit] = useState((master ?? single)?.unit ?? "per_day");
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  return (
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault();
      const rates = rows.flatMap(row => {
        const inheritsDefault = row.unitPrice === null || (!!master &&
          row.unitPrice === master.unitPrice && row.unit === master.unit && row.currency === master.currency);
        const value = overrides[row.id] || (row === master || row === single || inheritsDefault ? amount : "");
        return value.trim() === "" ? [] : [{ id: row.id, amount: Number(value), unit }];
      });
      if (!rates.length) { close(); return; }
      setSaving(true);
      setError("");
      try {
        await onboardingApi.saveWorkTypeRates(rates);
        onSaved();
        close();
      } catch (error) {
        setError((error as Error).message);
      } finally {
        setSaving(false);
      }
    }}>
      <div className="flex flex-wrap gap-2">
        <label className="min-w-0 flex-1">{master || rows.length > 1 ? "Default rate (USD)" : "Rate (USD)"}
          <Input type="number" min="0" max="9999999999.99" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} />
        </label>
        <label>Billing unit
          <select className="onboarding-catalog-select" value={unit} onChange={event => setUnit(event.target.value)}>
            {units.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      {rows.filter(row => row.partnerId !== null && (master || rows.length > 1)).map(row => (
        <label key={row.id} className="block">{row.partnerName}{rows.filter(other => other.partnerId === row.partnerId).length > 1 ? ` · ${row.name}` : ""}
          <Input type="number" min="0" max="9999999999.99" step="0.01"
            placeholder={row.unitPrice === null ? "Uses default" : `${row.currency ?? "USD"} ${row.unitPrice} · ${units.find(([value]) => value === row.unit)?.[1] ?? "Saved rate"}`}
            value={overrides[row.id] ?? ""} onChange={event => setOverrides({ ...overrides, [row.id]: event.target.value })} />
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <OnboardingPillButton type="button" tone="secondary" onClick={close} disabled={saving}>Skip for now</OnboardingPillButton>
        <OnboardingPillButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save rates"}</OnboardingPillButton>
      </div>
    </form>
  );
}

export function OnboardingServiceCatalog({ catalog, selected, onSelect, onRatesSaved }: {
  catalog: Catalog;
  selected: number[];
  onSelect: (ids: number[], checked: boolean) => void;
  onRatesSaved: () => void;
}) {
  const [search, setSearch] = useState("");
  const [partner, setPartner] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const services = useMemo(() => groupServices(catalog), [catalog]);
  const partners = new Map(catalog.rows.flatMap(row => row.partnerId === null ? [] : [[row.partnerId, row.partnerName] as const]));
  const filtered = services.filter(service =>
    (!partner || service.rows.some(row => String(row.partnerId) === partner)) &&
    [service.name, service.category, ...service.terms, ...service.rows.flatMap(row => [row.name, row.description, row.partnerName])]
      .some(value => value && normalized(value).includes(normalized(search))),
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">Search services
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Service or partner name" />
        </label>
        <label>Partner
          <select className="onboarding-catalog-select" value={partner} onChange={event => { setPartner(event.target.value); setOpen(null); }}>
            <option value="">All partners</option>
            {[...partners].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </div>
      <div className="max-h-[420px] space-y-1 overflow-y-auto pr-2">
        {filtered.map(service => {
          const rows = partner ? service.rows.filter(row => String(row.partnerId) === partner) : service.rows;
          const ids = rows.map(row => row.id);
          const checkedCount = ids.filter(id => selected.includes(id)).length;
          return (
            <div key={service.key} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <label className="flex min-w-0 cursor-pointer items-center gap-2">
                <Checkbox checked={checkedCount === ids.length ? true : checkedCount > 0 ? "indeterminate" : false}
                  onCheckedChange={checked => {
                    onSelect(ids, checked === true);
                    setOpen(checked === true ? service.key : null);
                  }} />
                <span>{service.name}</span>
              </label>
              <Popover open={open === service.key} onOpenChange={value => setOpen(value ? service.key : null)}>
                <PopoverTrigger asChild>
                  <button type="button" className="vendor-mini-card-button" aria-label={`Rates for ${service.name}`}>Rates</button>
                </PopoverTrigger>
                <PopoverContent className="onboarding-rate-flyout" align="end">
                  <h3 className="mb-3 font-semibold">{service.name} rates</h3>
                  <RateEditor rows={rows} onSaved={() => { onSelect(ids, true); onRatesSaved(); }} close={() => setOpen(null)} />
                </PopoverContent>
              </Popover>
            </div>
          );
        })}
        {!filtered.length && <p>No matching services.</p>}
      </div>
    </div>
  );
}
