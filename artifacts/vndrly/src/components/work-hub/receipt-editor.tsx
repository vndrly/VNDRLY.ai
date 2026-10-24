import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ScanLine } from "lucide-react";
import { ConversationAttachments } from "./conversation-attachments";
import { BrandedSelect } from "./chrome";
import BrandPillButton from "@/components/brand-pill-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { commandEnvelope, createWorkHubOperationId, workHubRequest, type WorkHubOwner } from "@/lib/work-hub-client";
import { withRequestDeadline } from "@/lib/request-deadline";

type Fields = { merchant: string; date: string; subtotal: string; tax: string; tip: string; total: string; currency: string; category: string; siteProject: string; note: string };
type Receipt = { id: string; canEdit: boolean; data: { fields: Fields; photoDocumentId: string; photoFileId: string; version: number } };
const empty: Fields = { merchant: "", date: "", subtotal: "", tax: "", tip: "", total: "", currency: "USD", category: "", siteProject: "", note: "" };
type Attempt = { reserveId: string; finalizeId: string; saveId: string; resource?: { documentId: string; fileId: string; uploadURL: string }; finalized?: boolean };

export async function receiptOcrImage(file: File): Promise<{ imageBase64: string; mimeType: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot read this photo. Enter the receipt fields manually.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.65, 0.45]) {
      const data = canvas.toDataURL("image/jpeg", quality).split(",")[1];
      if (data && data.length < 1_400_000) return { imageBase64: data, mimeType: "image/jpeg" };
    }
    throw new Error("The photo is too detailed to read automatically. Enter the fields manually.");
  } finally { bitmap.close(); }
}

export function ReceiptEditor({ channelId, owner, initialReceiptId }: { channelId: string; owner: WorkHubOwner; initialReceiptId?: string | null }) {
  const cache = useQueryClient();
  const [fields, setFields] = useState<Fields>({ ...empty });
  const [selected, setSelected] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [retry, setRetry] = useState(false);
  const [dirty, setDirty] = useState(false);
  const attempt = useRef<Attempt | null>(null);
  const base = `/channels/${channelId}/receipts`;
  const key = ["work-hub-receipts", channelId, owner.type, owner.id];
  const list = useQuery({ queryKey: key, queryFn: () => workHubRequest<{ rows: Receipt[]; hasMore: boolean }>(base) });
  useEffect(() => { if (!photo) { setPreview(""); return; } const url = URL.createObjectURL(photo); setPreview(url); return () => URL.revokeObjectURL(url); }, [photo]);
  async function load(id: string, confirm = true) {
    if (confirm && dirty && !window.confirm("Discard your unsaved receipt changes?")) return;
    attempt.current = null; setRetry(false);
    setError(""); setSuccess(false);
    if (!id) { setSelected(""); setReceipt(null); setFields({ ...empty }); setPhoto(null); setReviewed(false); setDirty(false); return; }
    setBusy(true);
    try { const value = await workHubRequest<Receipt>(`${base}/${id}`); setReceipt(value); setSelected(id); setFields(value.data.fields); setPhoto(null); setReviewed(false); setDirty(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { if (initialReceiptId) void load(initialReceiptId, false); }, [initialReceiptId]);
  const locked = busy || reading || retry;
  const editable = !receipt || receipt.canEdit;
  async function read(file: File) {
    setReading(true); setError(""); setReviewed(false);
    try {
      const image = await receiptOcrImage(file);
      const result = await workHubRequest<{ fields: Partial<Fields> }>(`${base}/ocr`, { method: "POST", body: JSON.stringify(image) });
      setFields(old => ({ ...old, ...result.fields })); setDirty(true);
    } catch (e) { setError((e as Error).message || "Could not read this photo. Enter the fields manually."); }
    finally { setReading(false); }
  }
  function choose(file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024 || !file.size) { setError("Choose a JPEG, PNG, or WebP photo up to 15 MB."); return; }
    attempt.current = null; setPhoto(file); setFields({ ...empty }); setDirty(true); setSuccess(false); void read(file);
  }
  async function save() {
    if (!reviewed || (!photo && !receipt)) return;
    setBusy(true); setError("");
    const current: Attempt = attempt.current ?? { reserveId: createWorkHubOperationId(), finalizeId: createWorkHubOperationId(), saveId: createWorkHubOperationId() };
    attempt.current = current;
    try {
      let photoDocumentId = receipt?.data.photoDocumentId;
      if (photo && !receipt) {
        if (!current.resource) {
          const digest = await crypto.subtle.digest("SHA-256", await photo.arrayBuffer());
          const checksumSha256 = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
          const reserved = await workHubRequest<{ resource: NonNullable<Attempt["resource"]> }>("/file-library/reserve", { method: "POST", body: JSON.stringify(commandEnvelope(owner, { scope: "channel", channelId, fileName: photo.name, byteSize: photo.size, contentType: photo.type, checksumSha256 }, current.reserveId)) });
          current.resource = reserved.resource;
        }
        if (!current.finalized) {
          const response = await withRequestDeadline(signal => fetch(current.resource!.uploadURL, { method: "PUT", headers: { "Content-Type": photo.type }, body: photo, signal }), { timeoutMs: 120000, timeoutMessage: "Photo save was not confirmed. Retry to finish this receipt." });
          if (!response.ok) throw new Error("Photo upload failed. Retry to finish saving.");
          await workHubRequest("/file-library/finalize", { method: "POST", body: JSON.stringify(commandEnvelope(owner, { id: current.resource.documentId, fileId: current.resource.fileId }, current.finalizeId)) });
          current.finalized = true;
        }
        photoDocumentId = current.resource.documentId;
      }
      const saved = await workHubRequest<{ resource: Receipt }>(`${base}${receipt ? `/${receipt.id}` : ""}`, { method: receipt ? "PATCH" : "POST", body: JSON.stringify(commandEnvelope(owner, { fields, photoDocumentId, reviewed: true }, current.saveId, receipt?.data.version)) });
      setReceipt({ ...saved.resource, canEdit: true }); setSelected(saved.resource.id); setFields(saved.resource.data.fields); setPhoto(null); setDirty(false); setSuccess(true); setRetry(false); attempt.current = null;
      await Promise.all([cache.invalidateQueries({ queryKey: key }), cache.invalidateQueries({ queryKey: ["work-hub"] }), cache.invalidateQueries({ queryKey: ["work-hub-file-library"] })]);
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      if (status === 400 || status === 409) { setRetry(false); } else setRetry(true);
      setError((e as Error).message);
    } finally { setBusy(false); }
  }
  const imageUrl = receipt ? `/api/work-hub/file-library/${receipt.data.photoDocumentId}/download?preview=1&version=${receipt.data.photoFileId}` : preview;
  const exportBase = `/api/work-hub${base}/export`;
  return <section aria-label="Receipt editor" className="space-y-3">
    <div className="flex min-w-0 items-center gap-2">
      <BrandedSelect aria-label="Open saved receipt" className="min-w-0 flex-1" value={selected} disabled={locked} onChange={e => void load(e.target.value)}>
        <option value="">New receipt</option>
        {list.data?.rows.map(r => <option key={r.id} value={r.id}>{r.data.fields.date} · {r.data.fields.merchant} · {r.data.fields.total} {r.data.fields.currency}</option>)}
        {receipt && !list.data?.rows.some(r => r.id === receipt.id) && <option value={receipt.id}>{receipt.data.fields.merchant}</option>}
      </BrandedSelect>
      <button type="button" className="hub-conversation-tool" title="New receipt" aria-label="New receipt" disabled={locked} onClick={() => void load("")}><Plus size={18} /></button>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="text-muted-foreground">Export {receipt ? "receipt" : "conversation receipts"}</span>
      {["csv", "xlsx"].map(format => <a key={format} className="font-semibold hover:text-[color:var(--brand-primary)]" href={`${exportBase}?format=${format}${receipt ? `&id=${receipt.id}` : ""}`}>{format === "csv" ? "CSV" : "EXCEL"}</a>)}
      {receipt && <a className="text-muted-foreground" href={`${exportBase}?format=xlsx`}>Export all</a>}
    </div>
    {list.data?.hasMore && <p className="text-xs text-muted-foreground">Showing the latest 200 receipts. Export includes all conversation receipts.</p>}
    {!receipt && !locked && <div className="flex items-center gap-2"><ConversationAttachments photosOnly onSelect={choose} /><span className="text-sm text-muted-foreground">Photo or camera</span>{photo && <button type="button" className="hub-conversation-tool ml-auto" aria-label="Read receipt again" title="Read receipt again" onClick={() => void read(photo)}><ScanLine size={18} /></button>}</div>}
    {imageUrl && <a href={imageUrl} target="_blank" rel="noreferrer"><img src={imageUrl} alt="Receipt photo" className="mx-auto max-h-40 rounded-lg object-contain" /></a>}
    {reading && <p role="status" className="text-sm text-muted-foreground">Reading receipt…</p>}
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={locked || !editable} className="grid min-w-0 grid-cols-2 gap-3">
        {([['merchant', 'Merchant'], ['date', 'Date'], ['subtotal', 'Subtotal'], ['tax', 'Tax'], ['tip', 'Tip'], ['total', 'Total'], ['currency', 'Currency'], ['category', 'Category'], ['siteProject', 'Site / Project']] as const).map(([name, label]) => <label key={name} className={`min-w-0 text-xs ${name === "merchant" || name === "siteProject" ? "col-span-2" : ""}`}>{label}<Input aria-label={label} className="mt-1 w-full min-w-0" type={name === "date" ? "date" : "text"} inputMode={["subtotal", "tax", "tip", "total"].includes(name) ? "decimal" : undefined} required={!["category", "siteProject"].includes(name)} maxLength={name === "currency" ? 3 : 200} value={fields[name]} onChange={e => { setFields(f => ({ ...f, [name]: name === "currency" ? e.target.value.toUpperCase() : e.target.value })); setReviewed(false); setDirty(true); setSuccess(false); }} /></label>)}
        <label className="col-span-2 text-xs">Note<Textarea aria-label="Receipt note" className="mt-1 !min-h-16" maxLength={2000} value={fields.note} onChange={e => { setFields(f => ({ ...f, note: e.target.value })); setReviewed(false); setDirty(true); }} /></label>
      </fieldset>
      {editable && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={reviewed} disabled={locked} onChange={e => setReviewed(e.target.checked)} />I checked the photo and receipt fields.</label>}
      {editable && <BrandPillButton tone="brand" type="submit" disabled={busy || reading || !reviewed || (!photo && !receipt) || (success && !dirty)}>{busy ? "Saving…" : retry ? "Retry save" : "Save receipt"}</BrandPillButton>}
    </form>
    {success && <p role="status" className="text-sm text-green-400">Receipt saved. Its link is in the conversation.</p>}
    {(error || list.error) && <p role="alert" className="text-sm text-red-400">{error || "Saved receipts could not load."}</p>}
  </section>;
}
