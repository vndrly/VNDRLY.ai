import { useEffect, useState } from "react";
import { Checkbox } from "./ui/checkbox";
export default function CompanyOperationsChoice({ vendorId }: { vendorId?: number }) {
  const [categories, setCategories] = useState<string[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; void fetch(`/api/company-operations${vendorId ? `?vendorId=${vendorId}` : ""}`, { credentials: "include", cache: "no-store" }).then(async response => { if (!response.ok) throw new Error("Unable to load company operations."); return response.json(); }).then(value => { if (alive) { setCategories(value.categories); setCanManage(value.canManage); } }).catch(cause => { if (alive) setError(cause.message); }); return () => { alive = false; }; }, [vendorId]);
  return <section className="space-y-3" aria-label="Company operations"><h2 className="text-lg font-semibold">Company operations</h2><p>Choose the categories for your company’s daily workspace. Selections save automatically.</p>
    {canManage ? <div className="flex flex-wrap gap-2">{([ ["field", "Field Ops"], ["fleet", "Fleet Ops"], ["gate", "Gate Ops"] ] as const).map(([value, label]) => <label key={value} className="flex items-center gap-2"><Checkbox checked={categories.includes(value)} disabled={busy} onCheckedChange={async () => { setBusy(true); setError(""); try { const response = await fetch("/api/company-operations", { credentials: "include", method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categories: categories.includes(value) ? categories.filter(item => item !== value) : [...categories, value], ...(vendorId ? { vendorId } : {}) }) }); if (!response.ok) throw new Error("Unable to save company operations."); const result = await response.json(); setCategories(result.categories); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save."); } finally { setBusy(false); } }} />{label}</label>)}</div> : null}
    {error ? <p role="alert">{error}</p> : null}</section>;
}
