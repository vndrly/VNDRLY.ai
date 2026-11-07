import { brandStyleVars, type Brand } from "@/hooks/use-brand";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import OnboardingPillButton from "@/components/onboarding-pill-button";
import { onboardingApi } from "@/lib/onboarding-api";
import { onboardingServiceDescriptions } from "@/lib/onboarding-service-descriptions";

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

function formatRate(row: Row) {
  const currency = row.currency || "USD";
  const amount = /^[A-Z]{3}$/.test(currency)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(row.unitPrice))
    : `${currency} ${row.unitPrice}`;
  const unit = units.find(([value]) => value === row.unit)?.[1];
  return unit ? `${amount} ${unit.toLowerCase()}` : amount;
}

type RateDraft = { amount: string; unit: string };

function RateEditor({ rows, baseRates, brand, onSaved, close }: { rows: Row[]; baseRates: Catalog["baseRates"]; brand: Brand; onSaved: () => void; close: () => void }) {
  const master = rows.find(row => row.partnerId === null);
  const partners = rows.filter(row => row.partnerId !== null);
  const anchor = rows.find(row => row.canonicalId !== null) ?? master ?? rows[0];
  const baseKey = anchor.canonicalId === null ? `work-type:${anchor.id}` : `canonical:${anchor.canonicalId}`;
  const [drafts, setDrafts] = useState<Record<number, RateDraft>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savedRate = (row: Row): RateDraft => ({ amount: row.unitPrice ?? "", unit: row.unit ?? "per_day" });
  const [base, setBase] = useState<RateDraft>(() => baseRates?.[baseKey] ?? (master ? savedRate(master) : { amount: "", unit: "per_day" }));
  const [baseEdited, setBaseEdited] = useState(false);

  function rateFields(label: string, rate: RateDraft, update: (change: Partial<RateDraft>) => void, key: string | number) {
    return (
      <div key={key} className="rounded-lg border border-white/15 p-2">
        <div className="mb-1 font-semibold">{label}</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-24 flex-1">Rate (USD)
            <Input aria-label={label === "Base rate" ? "Base rate (USD)" : label + " rate (USD)"} type="number" min="0" max="9999999999.99" step="0.01"
              value={rate.amount} onChange={event => update({ amount: event.target.value })} />
          </label>
          <div>
            <div>Billing unit</div>
            <Select value={rate.unit} onValueChange={unit => update({ unit })}>
              <SelectTrigger aria-label={label + " billing unit"}><SelectValue /></SelectTrigger>
              <SelectContent style={brandStyleVars(brand)}>
                {units.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault();
      if (saving) return;
      const rates: Parameters<typeof onboardingApi.saveWorkTypeRates>[0] = partners.flatMap(row => {
        const draft = drafts[row.id];
        const rate = draft?.amount.trim() ? draft : row.partnerId !== null && row.unitPrice === null ? base : undefined;
        return rate?.amount.trim() ? [{ id: row.id, amount: Number(rate.amount), unit: rate.unit }] : [];
      });
      if (baseEdited && base.amount.trim()) {
        if (!baseRates) { setError("Base rate saving is unavailable. Refresh the page and try again."); return; }
        rates.push({ id: anchor.id, amount: Number(base.amount), unit: base.unit, base: true });
      }
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
      {rateFields("Base rate", base, change => { setBase({ ...base, ...change }); setBaseEdited(true); }, "base")}
      {partners.length > 0 && <p className="text-xs">The base rate fills partner rates that haven’t been set. Saved partner rates can be edited individually.</p>}
      {partners.map(row => {
        const rate = drafts[row.id] ?? savedRate(row);
        const label = (row.partnerName ?? "Partner") +
          (partners.some(other => other.id !== row.id && other.partnerId === row.partnerId) ? " · " + row.name : "");
        return rateFields(label, rate, change => setDrafts(current => ({ ...current, [row.id]: { ...rate, ...change } })), row.id);
      })}
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <OnboardingPillButton type="button" tone="secondary" onClick={close} disabled={saving}>Skip for now</OnboardingPillButton>
        <OnboardingPillButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save rates"}</OnboardingPillButton>
      </div>
    </form>
  );
}

export function OnboardingServiceCatalog({ catalog, brand, selected, onSelect, onRatesSaved }: {
  catalog: Catalog;
  brand: Brand;
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
    [service.name, service.category, ...service.terms, ...service.rows.flatMap(row => [row.name, row.canonicalDefinition, row.description, row.partnerName])]
      .some(value => value && normalized(value).includes(normalized(search))),
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">Search services
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Service or partner name" />
        </label>
        <div>
          <label htmlFor="onboarding-partner-filter">Partner</label>
          <Select value={partner || "all"} onValueChange={value => { setPartner(value === "all" ? "" : value); setOpen(null); }}>
            <SelectTrigger id="onboarding-partner-filter"><SelectValue /></SelectTrigger>
            <SelectContent style={brandStyleVars(brand)}>
              <SelectItem value="all">All partners</SelectItem>
              {[...partners].map(([id, name]) => <SelectItem key={id} value={String(id)}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-[#bdbdbd]">Base rates may vary based on service enhancements or travel distance.</p>
      <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-[12px] border p-2"
        style={{ borderColor: "var(--brand-primary)" }}>
        {filtered.map(service => {
          const rows = partner ? service.rows.filter(row => String(row.partnerId) === partner) : service.rows;
          const ids = rows.map(row => row.id);
          const checkedCount = ids.filter(id => selected.includes(id)).length;
          const savedRates = rows.filter(row => row.unitPrice?.trim()).map(row => ({ row, rate: formatRate(row) }));
          const distinctRates = new Set(savedRates.map(({ rate }) => rate));
          const description = service.rows.find(row => row.canonicalDefinition?.trim())?.canonicalDefinition
            ?? onboardingServiceDescriptions[normalized(service.name)]
            ?? rows.find(row => row.partnerId === null && row.description?.trim())?.description
            ?? rows.find(row => row.description?.trim())?.description;
          return (
            <div key={service.key} className="onboarding-service-rate-card relative rounded-[12px] border bg-[#303034]"
              style={{ borderColor: savedRates.length ? "var(--brand-primary)" : "#5b5b60" }}>
              <div className="space-y-2 px-3 py-2">
              <label className="flex min-w-0 cursor-pointer items-center gap-2">
                <Checkbox checked={checkedCount === ids.length ? true : checkedCount > 0 ? "indeterminate" : false}
                  onCheckedChange={checked => {
                    onSelect(ids, checked === true);
                    setOpen(checked === true ? service.key : null);
                  }} />
                <span className="min-w-0 break-words font-semibold">{service.name}</span>
              </label>
              {description && <p className="line-clamp-2 break-words text-xs text-[#bdbdbd]">{description}</p>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-[11px] border-t border-white/10 bg-[#28282a] px-3 py-2">
                {savedRates.length > 0 && (
                  <div className="min-w-0 flex-1 basis-24 break-words text-xs font-semibold text-[#e7e7e7]">
                    {distinctRates.size === 1 && savedRates.length === rows.length
                      ? savedRates[0].rate
                      : savedRates.map(({ row, rate }) => (
                        <div key={row.id}>
                          {row.partnerName || "Default"}{rows.filter(other => other.partnerId === row.partnerId).length > 1 ? ` · ${row.name}` : ""} · {rate}
                        </div>
                      ))}
                  </div>
                )}
              <Popover open={open === service.key} onOpenChange={value => setOpen(value ? service.key : null)}>
                <PopoverTrigger asChild>
                  <button type="button" className="vendor-mini-card-button ml-auto shrink-0" aria-label={`Set your Rate(s) for ${service.name}`}>Set your Rate(s)</button>
                </PopoverTrigger>
                <PopoverContent inline className="onboarding-rate-flyout" style={brandStyleVars(brand)} align="end"
                  onOpenAutoFocus={event => event.preventDefault()}>
                  <h3 className="mb-3 font-semibold">{service.name} rates</h3>
                  <RateEditor rows={service.rows} baseRates={catalog.baseRates} brand={brand} onSaved={() => { onSelect(ids, true); onRatesSaved(); }} close={() => setOpen(null)} />
                </PopoverContent>
              </Popover>
              </div>
            </div>
          );
        })}
        {!filtered.length && <p>No matching services.</p>}
      </div>
    </div>
  );
}
