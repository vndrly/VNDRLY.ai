import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useListEmployeeCertifications, getListEmployeeCertificationsQueryKey } from "@workspace/api-client-react";
import { Camera, ShieldCheck } from "lucide-react";
import ImagePill from "@/components/image-pill";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Props = {
  employeeId: number;
  firstName: string;
  lastName: string;
  jobTitle?: string | null;
  vendorName?: string | null;
  vendorLogoUrl?: string | null;
  photoUrl?: string | null;
  profilePhotoPath?: string | null;
};

// Mirrors certifications-section.tsx#statusBadge: returns JSX directly
// so the Valid branch can render the canonical TogglePill (green = ON /
// valid per palette doctrine), height=24 to match the surrounding pill
// family. Expired / Expires-soon / No-expiration branches intentionally
// left as plain styled <span>s — same scope rule as the cert section.
function statusFor(expirationDate: string | null | undefined) {
  if (!expirationDate) return <ImagePill color="grey">No expiration</ImagePill>;
  const days = (new Date(expirationDate + "T00:00:00").getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days < 0) return <ImagePill color="red">Expired</ImagePill>;
  if (days <= 60) return <ImagePill color="amber">Expires in {Math.ceil(days)}d</ImagePill>;
  return <ImagePill color="green">Valid</ImagePill>;
}

export function ComplianceCard({ employeeId, firstName, lastName, jobTitle, vendorName, vendorLogoUrl, photoUrl, profilePhotoPath }: Props) {
  const { data: certs, isLoading } = useListEmployeeCertifications(employeeId, { query: { queryKey: getListEmployeeCertificationsQueryKey(employeeId) } });
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/field-employees/${employeeId}/compliance-token`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.verifyUrl) setVerifyUrl(d.verifyUrl); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [employeeId]);

  const photo = photoUrl || (profilePhotoPath
    ? (profilePhotoPath.startsWith("http") ? profilePhotoPath : `${API_BASE}/api/storage${profilePhotoPath.startsWith("/") ? profilePhotoPath : `/${profilePhotoPath}`}`)
    : null);

  return (
    <Card className="print:shadow-none print:border-2 print:border-black">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-600 font-semibold uppercase text-xs tracking-wider">
            <ShieldCheck className="w-4 h-4" /> VNDRLY Compliance
          </div>
          <div className="text-xs text-muted-foreground">ID #{employeeId}</div>
        </div>
        <div className="flex gap-4 items-center">
          {photo ? (
            <img src={photo} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-gray-200" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center border-2 border-gray-200"><Camera className="w-8 h-8 text-gray-400" /></div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-bold text-lg leading-tight">{firstName} {lastName}</div>
            {jobTitle && <div className="text-sm text-muted-foreground">{jobTitle}</div>}
            {vendorName && (
              <div className="flex items-center gap-2 mt-0.5">
                {vendorLogoUrl && <img src={vendorLogoUrl} alt="" className="w-5 h-5 rounded object-contain" />}
                <span className="text-sm font-medium">{vendorName}</span>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">Certifications</div>
          {isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : !certs || certs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No certifications recorded.</div>
          ) : (
            <ul className="space-y-1.5">
              {certs.map(c => (
                <li key={c.id} className="flex items-center justify-between text-sm border rounded p-2">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.issuer || "—"}{c.expirationDate ? ` · exp ${c.expirationDate}` : ""}
                    </div>
                  </div>
                  {statusFor(c.expirationDate)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col items-center pt-2 border-t">
          {verifyUrl ? (
            <>
              <QRCodeSVG value={verifyUrl} size={140} includeMargin />
              <div className="text-[10px] text-muted-foreground mt-2 break-all max-w-[240px] text-center">
                Scan to verify on VNDRLY
              </div>
            </>
          ) : (
            <Skeleton className="h-[140px] w-[140px]" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
