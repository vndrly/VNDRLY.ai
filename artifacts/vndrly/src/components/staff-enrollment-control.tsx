import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetVendor, getGetVendorQueryKey } from "@workspace/api-client-react";
import { Dialog } from "./ui/dialog";
import { VendorEditFlyout } from "./vendor-edit-flyout";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import "./staff-enrollment-control.css";

type Status = { state: "unsent" | "sent" | "accepted" | "revoked"; email: string; expired: boolean; hasLogin: boolean; sentAt?: string; acceptedAt?: string; targetKey?: string };
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load enrollment");
  return data;
}
const deliverable = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/\.(invalid|test)$/i.test(value);
export default function StaffEnrollmentControl({ vendorId, personKey, name, email = "", canManage = true }: { vendorId: number; personKey: string; name: string; email?: string; canManage?: boolean }) {
  const cache = useQueryClient(), base = `/api/vendors/${vendorId}/staff-enrollments`;
  const query = useQuery({ queryKey: ["staff-enrollments", vendorId], queryFn: () => request<{ entries: Record<string, Status> }>(base), enabled: canManage, staleTime: 15000, refetchInterval: 30000 });
  const { data: vendor } = useGetVendor(vendorId, { query: { enabled: canManage, queryKey: getGetVendorQueryKey(vendorId) } });
  const status = query.data?.entries?.[personKey];
  const [open, setOpen] = useState(false), [address, setAddress] = useState(""), [preview, setPreview] = useState(false);
  const send = useMutation({ mutationFn: () => request(base + "/send", { key: status?.targetKey || personKey, email: address.trim() }), onSuccess: async () => {
    await cache.invalidateQueries({ queryKey: ["staff-enrollments", vendorId] });
    void cache.invalidateQueries({ predicate: q => /employee.*login|field-employees|vendor-contacts|managed-subcontractors|org-members/.test(JSON.stringify(q.queryKey)) });
    setOpen(false);
  } });
  if (!canManage) return null;
  if (query.isError) return <button type="button" className="staff-enrollment-link" onClick={() => void query.refetch()} title="Unable to load invitation status. Retry.">Retry</button>;
  if (!status) return <span className="text-muted-foreground" aria-label="Loading enrollment status">—</span>;
  const label = status.state === "accepted" ? "ACCEPTED" : status.state === "revoked" ? "REVOKED" : status.state === "sent" && !status.expired ? "SENT" : "SEND";
  const close = () => { if (!send.isPending) setOpen(false); };
  return <span className="staff-enrollment-control" onClick={event => event.stopPropagation()}>
    {label === "ACCEPTED" || label === "REVOKED" ? <span className={`staff-enrollment-status is-${status.state}`} title={status.acceptedAt ? `Accepted ${new Date(status.acceptedAt).toLocaleString()}` : "Login access revoked"}>{label}</span> : <button type="button" className={`staff-enrollment-link is-${status.state}`} title={status.expired ? "Invitation expired. Send again." : status.sentAt ? `Sent ${new Date(status.sentAt).toLocaleString()}` : `Send ${name} an enrollment invite`} onClick={() => { send.reset(); setAddress(status.email || (deliverable(email) ? email : "")); setPreview(false); setOpen(true); }}>{label}{status.expired && <small>Expired</small>}</button>}
    <Dialog open={open} onOpenChange={value => { if (value) setOpen(true); else close(); }}>
      <VendorEditFlyout title="Enrollment Invitation" logoSrc={vendor?.logoSquareUrl || vendor?.logoUrl || undefined} logoAlt={`${vendor?.name || "Company"} logo`} onClose={close}>
        <form className="staff-enrollment-form" onSubmit={event => { event.preventDefault(); send.mutate(); }}>
          <p>Send <strong>{name}</strong> an enrollment invite to sign into VNDRLY.ai or use our VNDRLY app for the first time.</p>
          <div><Label htmlFor={`enrollment-email-${personKey}`}>{status.email ? "Verify email address" : "Email address"}</Label><Input id={`enrollment-email-${personKey}`} type="email" required value={address} readOnly={status.hasLogin && !!status.email} onChange={event => setAddress(event.target.value)} autoComplete="email" /></div>
          <div className="staff-enrollment-access"><strong>Web portal and VNDRLY app login</strong><p>{status.hasLogin ? "Their existing password and company permissions are preserved." : "A random eight-character temporary password is included in the invitation."}</p>{!status.hasLogin && <strong>Require password change at next sign-in</strong>}</div>
          {status.state === "sent" && <p className="text-muted-foreground">{status.expired ? "This invitation has expired. You can send a new invitation." : `Invitation sent ${status.sentAt ? new Date(status.sentAt).toLocaleString() : "previously"}. Waiting for first sign-in.`}</p>}
          {send.isError && <p role="alert" className="text-red-300">{send.error.message}</p>}
          <div className="staff-enrollment-actions"><button type="submit" className="vendor-mini-card-button" disabled={send.isPending || !deliverable(address) || status.state === "sent" && !status.expired}>{send.isPending ? "Sending…" : "Send"}</button><button type="button" className="vendor-mini-card-button" onClick={() => setPreview(!preview)}>{preview ? "Hide email preview" : "Preview email"}</button><button type="button" className="vendor-mini-card-button" disabled={send.isPending} onClick={close}>Cancel</button></div>
          {preview && <iframe className="staff-enrollment-email-preview" title="Enrollment email preview" sandbox="" src={`${base}/preview?name=${encodeURIComponent(name)}`} />}
        </form>
      </VendorEditFlyout>
    </Dialog>
  </span>;
}
