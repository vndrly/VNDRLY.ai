import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PngPillButton } from "@/components/png-pill-rollover";

type ImportRow = { row: number; code: string; name: string; unit: string; outcome: string; workTypeId?: number; reason?: string };
type ImportReport = { sourceHash: string; fileName: string; rows: ImportRow[]; created: number; duplicates: number; conflicts: number; importId?: number; replayed?: boolean };
export default function PartnerCatalogImport({ partnerId }: { partnerId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const imports = useQuery<{ items: ImportReport[] }>({ queryKey: ["partner-catalog-imports", partnerId], queryFn: async () => {
    const response = await fetch(`/api/partners/${partnerId}/catalog-imports`, { credentials: "include" });
    if (!response.ok) throw new Error("Unable to load original catalogs");
    return response.json();
  } });
  const [source, setSource] = useState<{ fileName: string; sourceBase64: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const run = async (mode: "preview" | "import") => {
    if (!source || busy) return;
    setBusy(true); setError(false);
    try {
      const response = await fetch(`/api/partners/${partnerId}/catalog-import`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...source, mode }) });
      if (!response.ok) throw new Error("Import failed");
      setReport(await response.json());
      if (mode === "import") await queryClient.invalidateQueries();
    } catch { setError(true); }
    finally { setBusy(false); }
  };
  return <section className="rounded border p-4 space-y-3" aria-label={t("partnerCatalogImport.title")}>
    <h2 className="font-semibold">{t("partnerCatalogImport.title")}</h2>
    <p className="text-sm">{t("partnerCatalogImport.instructions")}</p>
    <label className="block text-sm">{t("partnerCatalogImport.file")}
      <input className="block mt-1" type="file" accept=".csv,text/csv" disabled={busy} onChange={async event => {
        const file = event.target.files?.[0]; setSource(null); setReport(null); setError(false);
        if (!file) return;
        if (file.size > 1024 * 1024 || !/\.csv$/i.test(file.name)) { setError(true); return; }
        setBusy(true);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = ""; for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          setSource({ fileName: file.name, sourceBase64: btoa(binary) });
        } catch { setError(true); } finally { setBusy(false); }
      }} />
    </label>
    <PngPillButton color="blue" type="button" disabled={!source || busy} onClick={() => void run("preview")}>{t("partnerCatalogImport.preview")}</PngPillButton>
    {!!imports.data?.items.length && <details><summary>{t("partnerCatalogImport.history")}</summary><ul>{imports.data.items.map(item => <li key={item.importId}><button className="underline text-sm" type="button" disabled={busy} onClick={() => setReport(item)}>{item.fileName} · #{item.importId}</button></li>)}</ul></details>}
    {error && <p role="alert">{t("partnerCatalogImport.error")}</p>}
    {report && <>
      {report.replayed && <p>{t("partnerCatalogImport.alreadyImported")}</p>}
      <p role="status">{report.rows.length} {t("partnerCatalogImport.rows")} · {report.created} {t("partnerCatalogImport.created")} · {report.duplicates} {t("partnerCatalogImport.duplicates")} · {report.conflicts} {t("partnerCatalogImport.conflicts")}</p>
      <div className="overflow-auto max-h-80"><table className="w-full text-sm"><thead><tr>
        <th>{t("partnerCatalogImport.row")}</th><th>{t("partnerCatalogImport.code")}</th><th>{t("partnerCatalogImport.name")}</th><th>{t("partnerCatalogImport.unit")}</th><th>{t("partnerCatalogImport.outcome")}</th>
      </tr></thead><tbody>{report.rows.map(row => <tr key={row.row}><td>{row.row}</td><td>{row.code}</td><td>{row.name}</td><td>{row.unit}</td><td>{t(`partnerCatalogImport.results.${row.outcome}`)}{row.workTypeId ? ` · #${row.workTypeId}` : ""}</td></tr>)}</tbody></table></div>
      {!report.importId && <PngPillButton color="blue" type="button" disabled={busy} onClick={() => void run("import")}>{t("partnerCatalogImport.import")}</PngPillButton>}
      {report.importId && <a className="underline text-sm" href={`/api/partners/${partnerId}/catalog-imports/${report.importId}/source`}>{t("partnerCatalogImport.download")}</a>}
      <p className="text-sm">{t("partnerCatalogImport.preservation")}</p>
    </>}
  </section>;
}
