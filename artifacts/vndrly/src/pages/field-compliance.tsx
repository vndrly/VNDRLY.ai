import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Shield, User as UserIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import CertificationsSection from "@/components/certifications-section";
import { usePortalBase } from "@/lib/portal-base";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FieldMe {
  employeeId: number;
  firstName: string;
  lastName: string;
  email: string;
  vendorName: string | null;
  jobTitle: string | null;
  vendorLogoUrl: string | null;
  profilePhotoPath: string | null;
  photoUrl?: string | null;
}

interface ComplianceToken {
  token: string;
  verifyUrl: string;
  expiresAt: string;
}

function resolveUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.startsWith("/api/")) return `${BASE}${normalized}`;
  return `${BASE}/api/storage${normalized}`;
}

/**
 * Compliance status bucket for a certification's expiration date.
 *
 * Four fixed buckets (no fuzzy "expires in N days" copy) so the
 * field-portal compliance card reads the same regardless of viewport
 * and matches the TogglePill semantic palette:
 *
 *   - `noExpiration` → null expiration date  (rest, grey PNG chrome)
 *   - `expired`      → days < 0              (red)
 *   - `expiringSoon` → 0 ≤ days ≤ 60         (amber, "warning")
 *   - `active`       → days > 60             (green, "healthy")
 *
 * Pure function — exported for unit testing. Pass `now` for
 * deterministic tests; defaults to the wall clock.
 */
export type ComplianceBucket = "noExpiration" | "expired" | "expiringSoon" | "active";

export function complianceBucket(expirationDate: string | null, now: Date = new Date()): ComplianceBucket {
  if (!expirationDate) return "noExpiration";
  const expMs = new Date(expirationDate + "T00:00:00").getTime();
  const days = (expMs - now.getTime()) / (1000 * 60 * 60 * 24);
  if (days < 0) return "expired";
  if (days <= 60) return "expiringSoon";
  return "active";
}

const BUCKET_TO_PILL: Record<ComplianceBucket, { color: "green" | "amber" | "red" | null; key: string }> = {
  active: { color: "green", key: "compliance.active" },
  expiringSoon: { color: "amber", key: "compliance.expiringSoon" },
  expired: { color: "red", key: "compliance.expired" },
  noExpiration: { color: null, key: "compliance.noExpiration" },
};

function statusOf(
  expirationDate: string | null,
  t: (k: string, opts?: Record<string, unknown>) => string,
): { color: "green" | "amber" | "red" | null; label: string } {
  const bucket = complianceBucket(expirationDate);
  const meta = BUCKET_TO_PILL[bucket];
  return { color: meta.color, label: t(meta.key) };
}

export default function FieldCompliance() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const portalBase = usePortalBase();
  const [me, setMe] = useState<FieldMe | null>(null);
  const [token, setToken] = useState<ComplianceToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch(`${BASE}/api/field/me`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null));
        if (cancelled || !meRes) {
          if (!meRes) setError(t("compliance.loadFailed"));
          return;
        }
        setMe(meRes as FieldMe);
        const tokenRes = await fetch(`${BASE}/api/field-employees/${meRes.employeeId}/compliance-token`, { credentials: "include" }).then((r) =>
          r.ok ? r.json() : null,
        );
        if (cancelled) return;
        setToken((tokenRes as ComplianceToken | null) ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const photoUrl = resolveUrl(me?.photoUrl ?? me?.profilePhotoPath ?? null);

  return (
    <div className="px-4 pt-4 pb-6 max-w-2xl mx-auto w-full" data-testid="field-compliance">
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => navigate(`${portalBase}/profile`)}
          className="p-2 -ml-2 rounded-md hover:bg-muted"
          aria-label={t("common.back")}
          data-testid="button-back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">{t("compliance.title")}</h1>
      </div>

      {error ? (
        <p className="text-sm text-destructive text-center py-8">{error}</p>
      ) : !me ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[color:var(--brand-primary)]" />
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[color:var(--brand-primary)]">
              <Shield className="w-4 h-4" />
              <span className="text-[11px] font-bold uppercase tracking-widest">{t("compliance.brand")}</span>
            </div>
            <span className="text-[11px] text-muted-foreground">{t("compliance.id", { id: me.employeeId })}</span>
          </div>

          <div className="flex items-center gap-3">
            {photoUrl ? (
              <img src={photoUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <UserIcon className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-lg font-bold truncate">
                {me.firstName} {me.lastName}
              </p>
              {me.jobTitle ? <p className="text-sm text-muted-foreground truncate">{me.jobTitle}</p> : null}
              {me.vendorName ? <p className="text-sm font-semibold mt-0.5 truncate">{me.vendorName}</p> : null}
            </div>
          </div>

          <CertificationsSection
            employeeId={me.employeeId}
            variant="inline"
            testIdPrefix="field-self-certifications"
          />

          <div className="flex flex-col items-center pt-4 border-t border-border">
            {token ? (
              <>
                <div className="bg-white p-3 rounded-lg" data-testid="compliance-qr">
                  <QRCodeSVG value={token.verifyUrl} size={180} />
                </div>
                <p className="text-xs text-muted-foreground mt-2 text-center">{t("compliance.qrCaption")}</p>
              </>
            ) : (
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[color:var(--brand-primary)]" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
